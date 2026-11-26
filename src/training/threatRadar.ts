/**
 * 预警雷达核心（好习惯培养 H1，v2026.11.24）。
 *
 * 站在玩家视角检测「对方下一手可能造成的强制威胁」，产出单一真相源
 * ThreatSignal[]，供棋盘高亮、对局提示条、三思弹窗共同消费。
 *
 * 设计约束：
 * - 纯函数、纯规则层：只依赖 engine / ai 的只读能力，零 React、零联网；
 * - 只报高价值威胁（车马炮 / 将死 / 强制抽子），闲手小兵不报；
 * - 有界开销：候选数、枚举层数均有上限，常规局面远低于 100ms。
 *
 * 关于 findCheckSkewer 的兼容性说明：
 * 现有 src/ai/skewer.ts 用 Move.captured 判断是否抽到大子，但
 * engine/movegen.ts 生成的走法 captured 恒为 null（要到 Board.applyMove
 * 才回填）。为遵守「不改搜索内核/棋力参数」的边界，本模块先按设计调用
 * findCheckSkewer；当它因上述历史原因返回 null 时，用同一套规则层原语
 * 做一次有界的等价探测（只在本模块内使用，不改动 AI 行为）。
 */
import type { GameState, Move, PieceType, Pos, Side } from '../engine/types';
import { opponent } from '../engine/types';
import { generateLegalMoves, isInCheck } from '../engine/rules';
import { PIECE_DISPLAY } from '../engine/pieces';
import { findCheckSkewer } from '../ai/skewer';
import { findMateInOne } from '../ai/mate';
import { cheapestAttacker, staticExchange } from '../ai/see';
import { zoneScoreOf } from '../ai/threat';
import { codeOf, fastStateFromBoard } from '../ai/evalTerms';

/** 威胁种类：送子 / 将军抽子 / 一步杀 / 王区受攻。 */
export type RadarThreatKind = 'hang' | 'skewer' | 'mate' | 'king-zone';

/** 一条预警信号。 */
export interface ThreatSignal {
  /** 棋盘上应被标注的格子（受威胁的己方子或己方将帅）。 */
  square: Pos;
  /** 信号关注方（受到威胁的一方，即 playerSide）。 */
  side: Side;
  kind: RadarThreatKind;
  /** 面向玩家的中文提示。 */
  text: string;
}

/** 只把车/马/炮视为「大子」。 */
const MAJOR: ReadonlySet<PieceType> = new Set<PieceType>(['R', 'N', 'C']);

/** 送子信号的最低 SEE 净赚分（约等于一个小兵以上的实利）。 */
const SEE_GAIN_THRESHOLD = 300;
/** 送子检测最多检查的玩家走法数（不含当前局面）。 */
const MAX_HANG_CANDIDATES = 8;
/** 最多展示的送子信号数，避免复杂局面刷屏。 */
const MAX_HANG_SIGNALS = 2;
/** 抽子检测最多检查的对方将军着数。 */
const MAX_SKEWER_CHECKS = 4;
/** 每个将军着最多抽查的应将数（保证有界）。 */
const MAX_SKEWER_REPLIES = 8;
/** 王区危险阈值（zoneScoreOf 的绝对值，red 视角）。 */
const KING_ZONE_THRESHOLD = 24;
/** 抽子收益门槛：至少抽到马/炮；>=9 视为「白抽一车」的机会战术。 */
const SKEWER_MIN_GAIN = 4;
const ROOK_GAIN = 9;

function squareIndex(pos: Pos): number {
  return pos.col * 10 + pos.row;
}

function pieceWorth(type: PieceType): number {
  if (type === 'R') return 9;
  if (type === 'C') return 5;
  if (type === 'N') return 4;
  return 0;
}

function pieceName(type: PieceType, side: Side): string {
  return PIECE_DISPLAY[side][type];
}

function sideSign(side: Side): number {
  return side === 'red' ? 1 : -1;
}

/**
 * 轻量推进局面：只做合法性检查与 isInCheck，不调用 checkStatus 里的
 * generateLegalMoves。雷达内部还要多次生成走法，省掉这一层可把开销减半。
 * mover 显式传入——state.turn 可能与我们正在模拟的走子方不同。
 */
function advanceState(state: GameState, move: Move, mover: Side): GameState {
  const board = state.board.clone();
  const applied: Move = { ...move };
  board.applyMove(applied);
  const nextTurn: Side = opponent(mover);
  return {
    board,
    turn: nextTurn,
    history: [...state.history, applied],
    status: isInCheck(board, nextTurn) ? 'check' : 'playing',
    moveCount: state.moveCount + 1,
  };
}

/** 找到己方将帅所在格；残局自定义局面缺将时回退到该方底线中路。 */
function kingSquare(board: GameState['board'], side: Side): Pos {
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece && piece.type === 'K' && piece.side === side) return { col, row };
    }
  }
  return { col: 4, row: side === 'red' ? 0 : 9 };
}

/** 对方是否已有一步杀；必须让 state.turn 等于检测方。 */
function mateSignal(
  state: GameState,
  playerSide: Side,
  foeSide: Side,
): ThreatSignal | null {
  const foeState: GameState = { ...state, turn: foeSide };
  const kill: Move | null = findMateInOne(foeState, foeSide);
  if (!kill) return null;
  return {
    square: kingSquare(state.board, playerSide),
    side: playerSide,
    kind: 'mate',
    text: `⚠ 对方「${kill.notation || '这一手'}」可能一步成杀，务必先解杀`,
  };
}

/**
 * 「站在当前局面就送子」+「走某手后送子」检测。
 * 用 cheapestAttacker 做 O(1) 预筛，再用 staticExchange 确认净赚。
 */
function hangSignals(
  state: GameState,
  playerSide: Side,
  foeSide: Side,
  baseSquares: Int8Array,
  playerMoves: readonly Move[],
): ThreatSignal[] {
  const playerSign: number = sideSign(playerSide);
  const foeSign: number = -playerSign;
  const scratch: Int8Array = new Int8Array(90);
  const ranked: Array<{ signal: ThreatSignal; gain: number }> = [];
  const seenSquares: Set<string> = new Set();

  // 候选 0：当前局面（已经挂着的子）。之后追加玩家大子的走法。
  const candidates: Array<{ move: Move | null; squares: Int8Array }> = [
    { move: null, squares: baseSquares },
  ];
  for (const move of playerMoves) {
    if (!MAJOR.has(move.piece)) continue;
    const target: number = squareIndex(move.to);
    // 只评估安静着法：主动吃子属于玩家已经看清的交换，不是「被动送子」，
    // 且会在开局把贪吃一手的假警报刷满屏（反例见单测）。
    if (baseSquares[target] !== 0) continue;
    const flat: Int8Array = new Int8Array(baseSquares);
    flat[squareIndex(move.from)] = 0;
    flat[target] = codeOf(move.piece, playerSign);
    if (cheapestAttacker(flat, target, foeSign) === null) continue;
    candidates.push({ move, squares: flat });
    if (candidates.length > MAX_HANG_CANDIDATES) break;
  }

  for (const candidate of candidates) {
    const after: GameState = candidate.move
      ? advanceState(state, candidate.move, playerSide)
      : state;
    const foeMoves: Move[] = generateLegalMoves(after.board, foeSide);
    if (foeMoves.length === 0) continue; // 已被将死/困毙，不再是「送子」问题
    for (const foeMove of foeMoves) {
      // generateLegalMoves 的 captured 恒为 null，必须从棋盘读取真正的被害子。
      const victim = after.board.getPiece(foeMove.to);
      if (!victim || victim.side !== playerSide || !MAJOR.has(victim.type)) continue;
      const key: string = `${foeMove.to.col},${foeMove.to.row}`;
      if (seenSquares.has(key)) continue;
      const gain: number = staticExchange(
        candidate.squares,
        squareIndex(foeMove.from),
        squareIndex(foeMove.to),
        codeOf(foeMove.piece, foeSign),
        codeOf(victim.type, playerSign),
        scratch,
      );
      if (gain < SEE_GAIN_THRESHOLD) continue;
      seenSquares.add(key);
      ranked.push({
        gain,
        signal: {
          square: { col: foeMove.to.col, row: foeMove.to.row },
          side: playerSide,
          kind: 'hang',
          text: `⚠ ${pieceName(victim.type, playerSide)}留在（${foeMove.to.col + 1},${foeMove.to.row + 1}）会被对方吃掉（净亏 ${gain} 分）`,
        },
      });
      break;
    }
  }
  // 只报最严重的两处送子，避免古谱复杂局面刷屏。
  ranked.sort((a, b) => b.gain - a.gain);
  return ranked.slice(0, MAX_HANG_SIGNALS).map((item) => item.signal);
}

/** 在指定局面下找对方能吃到的最大大子（用于等价抽子探测）。 */
function bestMajorGrab(board: GameState['board'], side: Side, victimSide: Side): {
  square: Pos;
  gain: number;
} | null {
  let best: { square: Pos; gain: number } | null = null;
  for (const move of generateLegalMoves(board, side)) {
    const victim = board.getPiece(move.to);
    if (!victim || victim.side !== victimSide || !MAJOR.has(victim.type)) continue;
    const gain: number = pieceWorth(victim.type);
    if (best === null || gain > best.gain) best = { square: move.to, gain };
  }
  return best;
}

interface LocalSkewer {
  square: Pos;
  gain: number;
}

/**
 * findCheckSkewer 的历史兼容兜底：用同一套规则原语做有界抽子证明。
 * 与 skewer.ts 的判据一致（所有应将都挡不住 = 强制；或存在白抽一车分支）。
 */
function localCheckSkewer(
  state: GameState,
  checkMoves: readonly Move[],
  playerSide: Side,
  foeSide: Side,
): LocalSkewer | null {
  for (const checkMove of checkMoves.slice(0, MAX_SKEWER_CHECKS)) {
    const afterCheck: GameState = advanceState(state, checkMove, foeSide);
    const replies: Move[] = generateLegalMoves(afterCheck.board, playerSide);
    if (replies.length === 0) continue; // 一步杀，交给 mate 信号
    let forcedMin: number = Infinity;
    let evaluated: number = 0;
    let bestBranch: number = 0;
    let exampleSquare: Pos | null = null;
    for (const reply of replies.slice(0, MAX_SKEWER_REPLIES)) {
      const afterReply: GameState = advanceState(afterCheck, reply, playerSide);
      evaluated += 1;
      // 注意：GameState.turn 由调用时的 state.turn 决定，这里显式按 sides
      // 选择搜索方，因此不能用 afterReply.turn 过滤，否则会漏掉所有分支。
      const grab = bestMajorGrab(afterReply.board, foeSide, playerSide);
      const gain: number = grab ? grab.gain : 0;
      if (gain < forcedMin) forcedMin = gain;
      if (gain > bestBranch) {
        bestBranch = gain;
        if (grab) exampleSquare = grab.square;
      }
      if (bestBranch >= ROOK_GAIN) break; // 白抽一车，机会战术已成立
    }
    const truncated: boolean = replies.length > MAX_SKEWER_REPLIES;
    const decisive: boolean = evaluated > 0 && !truncated && forcedMin >= SKEWER_MIN_GAIN;
    if (!decisive && bestBranch < ROOK_GAIN) continue;
    return {
      square: exampleSquare ?? kingSquare(state.board, playerSide),
      gain: decisive ? forcedMin + 10 : bestBranch,
    };
  }
  return null;
}

/** 对方将军抽子信号。 */
function skewerSignal(
  state: GameState,
  playerSide: Side,
  foeSide: Side,
  checkMoves: readonly Move[],
): ThreatSignal | null {
  if (checkMoves.length === 0 || checkMoves.length > MAX_SKEWER_CHECKS) return null;
  const foeState: GameState = { ...state, turn: foeSide };

  // 首选设计指定的现成能力；它返回 null 时再做本模块的有界等价探测。
  const proved = findCheckSkewer(foeState, SKEWER_MIN_GAIN);
  let square: Pos | null = null;
  if (proved && proved.grabMove) square = proved.grabMove.to;
  if (!square) {
    const local = localCheckSkewer(state, checkMoves, playerSide, foeSide);
    if (local) square = local.square;
  }
  if (!square) return null;
  const checkNotation: string = checkMoves[0].notation || '将军';
  return {
    square,
    side: playerSide,
    kind: 'skewer',
    text: `⚠ 对方可用「${checkNotation}」将军后抽走你的大子`,
  };
}

/** 王区危险信号（zoneScoreOf 为红方视角，红方危险即显著负值）。 */
function kingZoneSignal(score: number, playerSide: Side, board: GameState['board']): ThreatSignal | null {
  const danger: number = playerSide === 'red' ? -score : score;
  if (danger < KING_ZONE_THRESHOLD) return null;
  return {
    square: kingSquare(board, playerSide),
    side: playerSide,
    kind: 'king-zone',
    text: '⚠ 你的将帅周围压力明显增大，先加固九宫',
  };
}

/**
 * 检测对方下一手可能造成的强制威胁。
 *
 * @param state 当前局面（轮到谁都行；从 playerSide 视角评估）。
 * @param playerSide 玩家执棋方。
 * @returns 去重后的高价值威胁列表，按危险程度降序（mate > skewer > hang > king-zone）。
 */
export function detectThreats(state: GameState, playerSide: Side): ThreatSignal[] {
  if (
    state.status === 'checkmate'
    || state.status === 'stalemate'
    || state.status === 'draw'
    || state.status === 'perpetual'
  ) {
    return [];
  }
  const foeSide: Side = opponent(playerSide);
  const fast = fastStateFromBoard(state.board, sideSign(state.turn));
  const foeState: GameState = { ...state, turn: foeSide };
  const foeMoves: Move[] = generateLegalMoves(foeState.board, foeSide);

  // 预筛将军着：既用于抽子检测，也避免在无将军局面白跑 findCheckSkewer。
  const checkMoves: Move[] = [];
  for (const move of foeMoves) {
    const after: GameState = advanceState(foeState, move, foeSide);
    if (after.status === 'check') checkMoves.push({ ...move, notation: after.history[after.history.length - 1].notation });
    if (checkMoves.length >= MAX_SKEWER_CHECKS) break;
  }

  const playerMoves: Move[] = generateLegalMoves(state.board, playerSide);
  const signals: ThreatSignal[] = [];
  // 一步杀几乎必带将军；无将军且我方着法充裕时跳过昂贵的证明搜索，
  // 只在「我方可选着很少（可能困毙）」时补查安静杀。
  if (checkMoves.length > 0 || playerMoves.length <= 2) {
    const mate: ThreatSignal | null = mateSignal(state, playerSide, foeSide);
    if (mate) signals.push(mate);
  }

  const skewer: ThreatSignal | null = skewerSignal(state, playerSide, foeSide, checkMoves);
  if (skewer) signals.push(skewer);

  signals.push(...hangSignals(state, playerSide, foeSide, fast.squares, playerMoves));

  // 已将死/一步杀时不再叠加王区提示，避免刷屏。
  if (!signals.some((s) => s.kind === 'mate' || s.kind === 'skewer')) {
    const zone: ThreatSignal | null = kingZoneSignal(zoneScoreOf(fast), playerSide, state.board);
    if (zone) signals.push(zone);
  }

  const rank: Record<RadarThreatKind, number> = { mate: 4, skewer: 3, hang: 2, 'king-zone': 1 };
  signals.sort((a, b) => rank[b.kind] - rank[a.kind]);
  const seen: Set<string> = new Set();
  return signals.filter((signal) => {
    const key: string = `${signal.kind}:${signal.square.col},${signal.square.row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
