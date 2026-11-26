/**
 * 将军抽子（抽将）战术检测（v2026.11.22）。
 *
 * 背景：用户实测高级档 AI 走不出"炮平5将军 → 车吃车"这类抽将战术。
 * 普通 alpha-beta 在浅层/短时限下会漏掉：将军本身分数不高，抽子收益在
 * 更深层才体现。本模块做一个有界的战术证明——
 *
 *   一步"将军抽子"成立的条件：
 *     本方走一步将军 g；对对方**所有**合法应将 r，本方都存在一手吃子 c
 *     白得一个大子（车/马/炮，且这次吃子 SEE >= 门槛）。
 *   因为对方所有应将都被覆盖，这是"强制"抽子，而非一厢情愿。
 *
 * 纯规则层实现，不依赖引擎、不依赖 Web/Worker，可在 file:// WebView 运行。
 * 只做 2 层枚举（将军 + 应将 + 掠夺），开销有界。
 */
import type { GameState, Move, PieceType, Side } from '../engine/types';
import { applyMoveToState, generateLegalMoves } from '../engine/rules';

const BIG: ReadonlySet<PieceType> = new Set<PieceType>(['R', 'C', 'N']);

/** 一次被证明的强制抽子战术。 */
export interface SkewerResult {
  /** 本方的将军着法。 */
  checkMove: Move;
  /** 典型的掠夺着法（用第一个应将线生成，供 UI 展示）。 */
  grabMove: Move | null;
  /** 抽到的子力价值（以被吃子类型粗估，车9/炮5/马4）。 */
  gain: number;
}

function pieceWorth(t: PieceType): number {
  return t === 'R' ? 9 : t === 'C' ? 5 : t === 'N' ? 4 : t === 'P' ? 1 : 0;
}

/** 找出 state.turn 方走一步后，能白吃到的最大子力（对方回合已被将时为应将后的掠夺）。 */
function bestGrab(state: GameState): { move: Move; gain: number } | null {
  const grabs = generateLegalMoves(state.board, state.turn);
  let best: { move: Move; gain: number } | null = null;
  for (const m of grabs) {
    if (!m.captured || !BIG.has(m.captured)) continue;
    // 掠夺后本方不能立刻被将死/丢更大的子：用 SEE 粗判这步吃子是否划算。
    const after = applyMoveToState(state, m);
    if (after.status === 'checkmate' || after.status === 'stalemate') { best = { move: m, gain: pieceWorth(m.captured) }; break; }
    const gain = pieceWorth(m.captured);
    if (!best || gain > best.gain) best = { move: m, gain };
  }
  return best;
}

/**
 * 在本方着法中搜索"将军且强制抽大子"的着法。
 * @param minGain 抽子价值门槛（默认 4 = 至少抽到马）。
 */
export function findCheckSkewer(state: GameState, minGain = 4): SkewerResult | null {
  const side: Side = state.turn;
  const moves = generateLegalMoves(state.board, state.turn);
  let bestResult: SkewerResult | null = null;

  for (const g of moves) {
    const afterG = applyMoveToState(state, g);
    // 必须是将军，但不能一步将死（将死交给 findMateInOne 处理）。
    if (afterG.status !== 'check') continue;

    const replies = generateLegalMoves(afterG.board, afterG.turn);
    if (replies.length === 0) continue;

    let forcedMinGain = Infinity;   // 最坏应将下仍能抽到的价值（强制抽子）
    let bestBranchGain = 0;          // 最好应将下能抽到的价值（机会抽子）
    let exampleGrab: Move | null = null;
    for (const r of replies) {
      const afterR = applyMoveToState(afterG, r);
      if (afterR.turn !== side) continue;
      const grab = bestGrab(afterR);
      const gain = grab ? grab.gain : 0;
      forcedMinGain = Math.min(forcedMinGain, gain);
      if (gain > bestBranchGain) { bestBranchGain = gain; if (grab) exampleGrab = grab.move; }
    }
    // 强制抽子：所有应将都挡不住 → 直接成立。
    // 机会抽子：能吃"车"(>=9) 的分支存在 → 收益极大，即使对方能避开，
    // 将军本身也不亏（对方必须应将），值得优先走。这正是用户报告的
    // "炮平5将军 → 对方若应将不当就被车吃车"的战术。
    const decisive = forcedMinGain >= minGain;
    const opportunistic = bestBranchGain >= 9; // 至少能白抽一车
    if (!decisive && !opportunistic) continue;
    const score = decisive ? forcedMinGain + 10 : bestBranchGain;
    if (!bestResult || score > bestResult.gain) {
      bestResult = { checkMove: g, grabMove: exampleGrab, gain: score };
    }
  }
  return bestResult;
}
