/**
 * 推演/记谱自动对弈的长将判定（v2026.11.21.8）。
 *
 * 背景：Pikafish 的 UCI 请求只传当前 FEN、不传历史着法，引擎看不到重复局面，
 * 于是劣势方会"一直将军"赖和。主对局的 judgeRepetition 只适用于标准开局，
 * 这里做通用版：从任意起始局面重放主线，判定三次重复中的长将方。
 *
 * 规则：同一局面（布局+走子方）出现第三次时，若最后一轮循环里某一方
 * 每一步都将军、而对方并非步步将军，则该方长将判负；否则判和。
 */
import type { GameState, Move, Side } from '../engine/types';
import { positionKeyOf } from '../ai/search';
import { applyMoveToState, isInCheck } from '../engine/rules';
import { detectPerpetualHarassment } from './perpetualGuard';

export type SimRepetition =
  | 'none'
  | 'draw'
  | 'red-loses'   // 红方长将，红负
  | 'black-loses';

/** 从 startState 重放 moves，返回每个局面（含起始）的 key。 */
function replayKeys(startState: GameState, moves: ReadonlyArray<Move>): Array<{ key: number; checked: boolean }> {
  const out: Array<{ key: number; checked: boolean }> = [];
  let state = startState;
  out.push({ key: positionKeyOf(state.board, state.turn), checked: isInCheck(state.board, state.turn) });
  for (const move of moves) {
    state = applyMoveToState(state, move);
    out.push({ key: positionKeyOf(state.board, state.turn), checked: isInCheck(state.board, state.turn) });
  }
  return out;
}

/**
 * 判定从 startState 走完 moves 后的局面是否构成三次重复/长将。
 * @param startState 推演树的根局面（可能是任意局面，不一定标准开局）
 * @param moves 从根到当前的完整主线
 */
export function judgeSimRepetition(
  startState: GameState, moves: ReadonlyArray<Move>,
): SimRepetition {
  if (moves.length < 8) return 'none';
  const entries = replayKeys(startState, moves);
  const currentKey = entries[entries.length - 1].key;
  const occurrences: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].key === currentKey) occurrences.push(i);
  }
  if (occurrences.length < 3) return 'none';

  // v2026.11.23.2 BUG FIX — 单方长将赖和漏判（规则 2020 §23.5.1）。
  // 已构成三次重复（待判局面）：先用宽松判定识别单方长将。严格循环判定
  // 要求"最后一轮每一步都将军 + 循环长度为偶数"，劣势方（单子对五子）反复
  // 将军时应将位置不断变化，这两个条件常不成立 → 一路长将却被判和。
  // 放宽判定只在此处（三次重复之后）启用，未形成重复时不判负，故不会误伤
  // "连续将军直接将死"的正常棋。
  const harassment = detectPerpetualHarassment(moves, startState);
  if (harassment) return harassment;

  const i3 = occurrences[occurrences.length - 1];
  const i2 = occurrences[occurrences.length - 2];
  const cycleLen = i3 - i2;
  if (cycleLen < 4 || cycleLen % 2 !== 0) return 'draw';

  // 统计最后一轮循环（moves[i2 .. i3-1]）里各方步步将军情况。
  // entries[i].checked 表示"该局面走子方被将军"，即上一步走子方将军成功。
  let redChecks = 0, redMoves = 0, blackChecks = 0, blackMoves = 0;
  let state = startState;
  for (let i = 0; i < i2; i++) state = applyMoveToState(state, moves[i]);
  for (let i = i2; i < i3; i++) {
    const mover: Side = state.turn;
    state = applyMoveToState(state, moves[i]);
    const deliveredCheck = isInCheck(state.board, state.turn); // 对方被将
    if (mover === 'red') { redMoves++; if (deliveredCheck) redChecks++; }
    else { blackMoves++; if (deliveredCheck) blackChecks++; }
  }
  const redPerp = redMoves > 0 && redChecks === redMoves && blackChecks < blackMoves;
  const blackPerp = blackMoves > 0 && blackChecks === blackMoves && redChecks < redMoves;
  if (redPerp) return 'red-loses';
  if (blackPerp) return 'black-loses';
  return 'draw';
}
