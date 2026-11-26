/**
 * Alpha-beta search for Xiangqi (v2026.11.19.1).
 *
 * The framework (PVS / TT / LMR / null-move / quiescence / repetition judging)
 * is intentionally preserved — this release fixes its *semantics* and speed:
 *   - mate scores use `MATE_SCORE - ply` (one-move mates now beat two-move ones);
 *   - quiescence adds up to 4 quiet checking moves at its first two plies;
 *   - soft-cap truncation marks the whole iteration `incomplete` and never
 *     overwrites the last complete ranking;
 *   - null children skip repetition bookkeeping;
 *   - FastState carries incremental mg/eg/phase/Zobrist/kingSq/pieceList so a
 *     leaf costs one division plus a ~32-piece scan, never a 90-square walk.
 *
 * Public API (`alphabeta` / `bestMove` / `rankedMoves` / `rankedMovesAsync` /
 * `makeKey` / `evaluateFast` / repetition helpers) is unchanged.
 */

import type { Board } from '../engine/board';
import { createInitialState } from '../engine/board';
import type { GameState, Move, PieceType, Side } from '../engine/types';
import { PIECE_VALUE } from '../engine/pieces';
import { isInCheck } from '../engine/rules';
import { computeKey } from './pst';
import {
  doMoveFast,
  fastStateFromSquares,
  leafTerms,
  toggleTurnInState,
  undoMoveFast,
  type FlatMove,
} from './evalTerms';
import type { FastState } from './types';
import { staticExchange } from './see';

/** Score assigned to a forced mate (adjusted by distance from the root). */
export const MATE_SCORE = 1_000_000;
/** Scores at/above this threshold are mate-range scores (never cached). */
export const MATE_THRESHOLD = MATE_SCORE - 1_000;
/** Max extra capture plies explored by quiescence. */
const QUIET_DEPTH = 6;
/** Max quiet-check extensions along a single quiescence line. */
const MAX_QUIET_CHECKS = 2;
/** Quiet checks are only generated in the first two quiescence plies. */
const QUIET_CHECK_DEPTH = QUIET_DEPTH - 2;
/** Absolute ply guard: keeps mate scores above MATE_THRESHOLD and q trees finite. */
const MAX_PLY = 999;

/** A root move paired with its search score (from the mover's perspective). */
export interface ScoredMove {
  move: Move;
  score: number;
}

type TTFlag = 'exact' | 'lower' | 'upper';

interface TTEntry {
  depth: number;
  score: number;
  flag: TTFlag;
  bestFrom: number;
  bestTo: number;
}

/** Internal move with cached piece-list slots (filled by doMoveFast). */
interface FastMove extends FlatMove {
  /** Quiet move that gives check, collected for quiescence search. */
  checkBonus?: boolean;
  /** Scratch field for allocation-free in-place move ordering. */
  sortScore: number;
}

export interface SearchContext {
  readonly tt: Map<number, TTEntry>;
  deadline?: number;
  aborted: boolean;
  nodes: number;
  incomplete?: boolean;
  /** Last fully searched iteration; the ONLY source for the final move. */
  lastCompleteRanked?: ScoredMove[];
  /** Scores observed in a truncated iteration (diagnostics only). */
  partialRanked?: ScoredMove[];
  pathKeys: number[];
  pathChecked: boolean[];
  seenKeys?: number[];
  seenChecked?: boolean[];
  killers: Array<[number, number]>;
  history: Int32Array;
  /** Reusable move objects: the tree allocates none on the hot path. */
  movePool: FastMove[];
  movePoolTop: number;
  /** Per-ply scratch lists: pseudo/legal/selected share no slots across plies. */
  pseudoLists: FastMove[][];
  legalLists: FastMove[][];
  selectedLists: FastMove[][];
  /** Reusable 90-cell scratch board for SEE (no allocation on the hot path). */
  seeScratch: Int8Array;
  /** v2026.11.20.1: prevents nested singular proof searches from exploding. */
  inSingular?: boolean;
  /** Diagnostic counter: how many singular extensions were proven this run. */
  singularCount?: number;
}

/** Number of preallocated per-ply scratch slots (MAX_PLY is 999, real trees < 128). */
const SCRATCH_PLIES = 128;

export function createSearchContext(deadline?: number): SearchContext {
  return {
    tt: new Map(), deadline, aborted: false, nodes: 0, incomplete: false,
    pathKeys: [], pathChecked: [],
    killers: Array.from({ length: SCRATCH_PLIES }, () => [-1, -1] as [number, number]),
    history: new Int32Array(90 * 90),
    movePool: [], movePoolTop: 0,
    pseudoLists: Array.from({ length: SCRATCH_PLIES }, () => []),
    legalLists: Array.from({ length: SCRATCH_PLIES }, () => []),
    selectedLists: Array.from({ length: SCRATCH_PLIES }, () => []),
    seeScratch: new Int8Array(90),
    inSingular: false,
    singularCount: 0,
  };
}

/**
 * Returns an empty scratch list for one ply. Reusing the array removes two
 * array allocations per visited node (pseudo + legal), which was the largest
 * remaining source of GC pressure in deep searches.
 */
function listAt(lists: FastMove[][], ply: number): FastMove[] {
  let list: FastMove[] | undefined = lists[ply];
  if (list === undefined) {
    list = [];
    lists[ply] = list;
  }
  list.length = 0;
  return list;
}

/** 迭代加深每层衰减历史分，避免早期迭代的过时信息压住新证据。 */
export function decaySearchHistory(ctx: SearchContext, factor: number = 0.75): void {
  const history: Int32Array = ctx.history;
  for (let i = 0; i < history.length; i++) history[i] = (history[i] * factor) | 0;
}

// --- Flat board encoding -----------------------------------------------------

const TYPE_CODE: Readonly<Record<PieceType, number>> = {
  K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7,
};
const CODE_TYPE: ReadonlyArray<PieceType> = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];

/** Bump-allocated pooled move; callers save/restore `movePoolTop` per node. */
function allocMove(
  ctx: SearchContext,
  from: number,
  to: number,
  piece: number,
  captured: number,
): FastMove {
  let move: FastMove | undefined = ctx.movePool[ctx.movePoolTop];
  if (move === undefined) {
    move = { from: 0, to: 0, piece: 0, captured: 0, sortScore: 0 };
    ctx.movePool.push(move);
  }
  ctx.movePoolTop += 1;
  move.from = from;
  move.to = to;
  move.piece = piece;
  move.captured = captured;
  move.slot = undefined;
  move.capSlot = undefined;
  move.checkBonus = false;
  move.sortScore = 0;
  return move;
}


const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const ELEPHANT: ReadonlyArray<readonly [number, number]> = [
  [2, 2], [2, -2], [-2, 2], [-2, -2],
];
/** [targetDc, targetDr, legDcFromPiece, legDrFromPiece] for a horse. */
const KNIGHT: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
  [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
];

function squareIndex(col: number, row: number): number {
  return col * 10 + row;
}
function colOf(index: number): number {
  return (index / 10) | 0;
}
function rowOf(index: number): number {
  return index % 10;
}
function onBoard(col: number, row: number): boolean {
  return col >= 0 && col < 9 && row >= 0 && row < 10;
}
function sameSide(a: number, b: number): boolean {
  return (a > 0) === (b > 0);
}
function typeOf(code: number): PieceType {
  return CODE_TYPE[Math.abs(code) - 1];
}
function signOf(side: Side): number {
  return side === 'red' ? 1 : -1;
}
function sideIndex(sign: number): number {
  return sign > 0 ? 0 : 1;
}
function inPalace(col: number, row: number, sign: number): boolean {
  if (col < 3 || col > 5) return false;
  return sign === 1 ? row >= 0 && row <= 2 : row >= 7 && row <= 9;
}
function ownHalf(sign: number, row: number): boolean {
  return sign === 1 ? row < 5 : row >= 5;
}

function boardToCodes(board: Board): Int8Array {
  const squares = new Int8Array(90);
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece) squares[squareIndex(col, row)] = signOf(piece.side) * TYPE_CODE[piece.type];
    }
  }
  return squares;
}

function toFastState(board: Board, turnSign: number): FastState {
  return fastStateFromSquares(boardToCodes(board), turnSign);
}

function codesToMove(move: FastMove): Move {
  return {
    from: { col: colOf(move.from), row: rowOf(move.from) },
    to: { col: colOf(move.to), row: rowOf(move.to) },
    piece: typeOf(move.piece),
    captured: move.captured === 0 ? null : typeOf(move.captured),
    notation: '',
  };
}

// --- Pseudo-legal move generation (mirrors engine/movegen.ts exactly) --------

function addTarget(
  squares: Int8Array,
  from: number,
  to: number,
  piece: number,
  out: FastMove[],
  ctx: SearchContext,
): void {
  const target = squares[to];
  if (target === 0 || !sameSide(target, piece)) {
    out.push(allocMove(ctx, from, to, piece, target));
  }
}

/** Generates pseudo-legal moves by walking the ~32 active pieces, not 90 squares. */
function generatePseudoMoves(
  st: FastState,
  sign: number,
  ctx: SearchContext,
  ply: number,
): FastMove[] {
  const squares = st.squares;
  const out: FastMove[] = listAt(ctx.pseudoLists, ply);
  for (let i = 0; i < 32; i++) {
    const piece = st.pieceList[i];
    if (piece === 0 || !sameSide(piece, sign)) continue;
    const from = st.pieceSq[i];
    const col = colOf(from);
    const row = rowOf(from);
    const type = Math.abs(piece);
    switch (type) {
      case 1:
        for (const [dc, dr] of ORTHO) {
          const c = col + dc;
          const r = row + dr;
          if (inPalace(c, r, sign)) addTarget(squares, from, squareIndex(c, r), piece, out, ctx);
        }
        break;
      case 2:
        for (const [dc, dr] of DIAG) {
          const c = col + dc;
          const r = row + dr;
          if (inPalace(c, r, sign)) addTarget(squares, from, squareIndex(c, r), piece, out, ctx);
        }
        break;
      case 3:
        for (const [dc, dr] of ELEPHANT) {
          const c = col + dc;
          const r = row + dr;
          if (!onBoard(c, r) || !ownHalf(sign, r)) continue;
          if (squares[squareIndex(col + dc / 2, row + dr / 2)] !== 0) continue;
          addTarget(squares, from, squareIndex(c, r), piece, out, ctx);
        }
        break;
      case 4:
        for (const [dc, dr, lc, lr] of KNIGHT) {
          const c = col + dc;
          const r = row + dr;
          if (!onBoard(c, r)) continue;
          if (squares[squareIndex(col + lc, row + lr)] !== 0) continue;
          addTarget(squares, from, squareIndex(c, r), piece, out, ctx);
        }
        break;
      case 5:
        for (const [dc, dr] of ORTHO) {
          let c = col + dc;
          let r = row + dr;
          while (onBoard(c, r)) {
            const to = squareIndex(c, r);
            const target = squares[to];
            if (target === 0) {
              out.push(allocMove(ctx, from, to, piece, 0));
            } else {
              if (!sameSide(target, piece)) out.push(allocMove(ctx, from, to, piece, target));
              break;
            }
            c += dc;
            r += dr;
          }
        }
        break;
      case 6:
        for (const [dc, dr] of ORTHO) {
          let c = col + dc;
          let r = row + dr;
          let screenFound = false;
          while (onBoard(c, r)) {
            const to = squareIndex(c, r);
            const target = squares[to];
            if (!screenFound) {
              if (target === 0) out.push(allocMove(ctx, from, to, piece, 0));
              else screenFound = true;
            } else if (target !== 0) {
              if (!sameSide(target, piece)) out.push(allocMove(ctx, from, to, piece, target));
              break;
            }
            c += dc;
            r += dr;
          }
        }
        break;
      case 7: {
        const forward = sign === 1 ? 1 : -1;
        const fr = row + forward;
        if (onBoard(col, fr)) addTarget(squares, from, squareIndex(col, fr), piece, out, ctx);
        if (sign === 1 ? row >= 5 : row <= 4) {
          for (const dc of [-1, 1]) {
            if (onBoard(col + dc, row)) {
              addTarget(squares, from, squareIndex(col + dc, row), piece, out, ctx);
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

// --- Attack detection --------------------------------------------------------

/** Whether `bySign` attacks `target` with a single pseudo-legal move. */
function attackedBy(squares: Int8Array, target: number, bySign: number): boolean {
  const col = colOf(target);
  const row = rowOf(target);
  const forward = bySign === 1 ? 1 : -1;

  const pawnFrontRow = row - forward;
  if (onBoard(col, pawnFrontRow)) {
    const piece = squares[squareIndex(col, pawnFrontRow)];
    if (piece !== 0 && sameSide(piece, bySign) && Math.abs(piece) === 7) return true;
  }
  const crossed = bySign === 1 ? row >= 5 : row <= 4;
  if (crossed) {
    for (const dc of [-1, 1]) {
      const c = col + dc;
      if (!onBoard(c, row)) continue;
      const piece = squares[squareIndex(c, row)];
      if (piece !== 0 && sameSide(piece, bySign) && Math.abs(piece) === 7) return true;
    }
  }
  for (const [dc, dr, legDc, legDr] of KNIGHT) {
    const oc = col - dc;
    const orow = row - dr;
    const lc = oc + legDc;
    const lrow = orow + legDr;
    if (!onBoard(oc, orow) || !onBoard(lc, lrow)) continue;
    if (squares[squareIndex(lc, lrow)] !== 0) continue;
    const piece = squares[squareIndex(oc, orow)];
    if (piece !== 0 && sameSide(piece, bySign) && Math.abs(piece) === 4) return true;
  }
  for (const [dc, dr] of ORTHO) {
    let c = col + dc;
    let r = row + dr;
    let screenFound = false;
    while (onBoard(c, r)) {
      const piece = squares[squareIndex(c, r)];
      if (piece !== 0) {
        const isEnemy = sameSide(piece, bySign);
        const type = Math.abs(piece);
        if (!screenFound) {
          if (isEnemy && (type === 5 || type === 1)) return true;
          screenFound = true;
        } else {
          if (isEnemy && type === 6) return true;
          break;
        }
      }
      c += dc;
      r += dr;
    }
  }
  return false;
}

/** Cached-king in-check test (O(attacks), no 90-square king scan). */
function inCheck(st: FastState, sign: number): boolean {
  const king: number = st.kingSq[sideIndex(sign)];
  if (king < 0) return false; // custom test positions may omit a king
  return attackedBy(st.squares, king, -sign);
}

/** Mate score from `rootSign`'s perspective, closer mates score higher. */
function mateScoreFor(rootSign: number, turnSign: number, ply: number): number {
  const magnitude = MATE_SCORE - Math.min(ply, MAX_PLY);
  return rootSign === turnSign ? -magnitude : magnitude;
}

/**
 * Quiescence search. Captures are always resolved; the first two plies may
 * additionally try up to four quiet checking moves (max two per line) so a
 * forced mate beginning with a non-capture is not invisible at the horizon.
 */
function quiescence(
  st: FastState,
  turnSign: number,
  alpha: number,
  beta: number,
  rootSign: number,
  ctx: SearchContext,
  qDepth: number,
  ply: number,
  checksLeft: number,
): number {
  const poolMark: number = ctx.movePoolTop;
  try {
  const squares = st.squares;
  ctx.nodes += 1;
  if ((ctx.nodes & 1023) === 0 && ctx.deadline !== undefined && Date.now() > ctx.deadline) {
    ctx.aborted = true;
  }
  if (ctx.aborted || ply > MAX_PLY) return leafTerms(st, rootSign);

  const checked: boolean = inCheck(st, turnSign);
  const stand: number = checked ? -Infinity : leafTerms(st, rootSign);
  const maximizing: boolean = turnSign === rootSign;
  if (!checked) {
    if (maximizing) {
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
    } else {
      if (stand <= alpha) return stand;
      if (stand < beta) beta = stand;
    }
  }
  if (qDepth <= 0 && !checked) return stand;
  // v2026.11.19.8: NEVER cut off while still in check. The old `qDepth < -2`
  // returned a static score mid-evasion, so a forced 8+ ply mating attack
  // looked like "equal" and the engine walked into it. In-check nodes now run
  // until the check is resolved (bounded only by MAX_PLY + the deadline).
  if (ply >= MAX_PLY) return leafTerms(st, rootSign);

  // Quiet checking moves: only while still relatively shallow and when the
  // stand-pat score has NOT already exceeded beta (delta-pruning guard).
  const wantQuietChecks: boolean =
    !checked && checksLeft > 0 && qDepth >= QUIET_CHECK_DEPTH && stand + 200 < beta;
  // Captures dominate quiescence; legality checks run an O(attacks) ray scan per
  // move. Skipping legality for quiet moves here removes the single hottest cost.
  const capturesOnly: boolean = !checked && !wantQuietChecks;
  const all = generateLegalMovesFast(st, turnSign, ctx, capturesOnly, ply);
  if (checked) {
    if (all.length === 0) return mateScoreFor(rootSign, turnSign, ply);
  }
  let moves: FastMove[];
  if (capturesOnly || checked) {
    moves = all;
  } else {
    moves = listAt(ctx.selectedLists, ply);
    for (const move of all) {
      if (move.captured !== 0) moves.push(move);
    }
  }

  if (wantQuietChecks) {
    let added = 0;
    for (const move of all) {
      if (move.captured !== 0 || added >= 4) continue;
      const enemyKing: number = st.kingSq[sideIndex(-turnSign)];
      if (enemyKing < 0) continue;
      const captured = squares[move.to];
      // v2026.11.19.8: the old branch tested `attackedBy(move.to)` for king
      // moves, which can never detect 飞将/闪将 — every quiet king check was
      // silently dropped from quiescence. After the move, always test whether
      // the mover attacks the ENEMY KING's square.
      squares[move.to] = move.piece;
      squares[move.from] = 0;
      const givesCheck: boolean = attackedBy(squares, enemyKing, turnSign);
      squares[move.from] = move.piece;
      squares[move.to] = captured;
      if (givesCheck) {
        move.checkBonus = true;
        moves.push(move);
        added += 1;
      }
    }
  }
  orderMoves(moves, st, undefined, ctx);

  let best: number = checked ? (maximizing ? -Infinity : Infinity) : stand;
  for (const move of moves) {
    // Delta pruning: when not in check, a capture whose best-case material gain
    // cannot lift stand-pat to alpha cannot improve the result — skip its tree.
    if (!checked && move.captured !== 0) {
      const gain: number = CAPTURE_VALUE[move.captured + 7] + 200;
      if (stand + gain < alpha) continue;
    }
    doMoveFast(st, move);
    const nextChecks: number = checksLeft - (move.checkBonus ? 1 : 0);
    const value = quiescence(
      st, -turnSign, alpha, beta, rootSign, ctx, qDepth - 1, ply + 1, nextChecks,
    );
    undoMoveFast(st, move);
    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best === -Infinity ? leafTerms(st, rootSign) : best;
  } finally {
    ctx.movePoolTop = poolMark;
  }
}

/**
 * Fully legal moves for `sign`, using the cached king square for legality.
 * When `capturesOnly` is set (quiescence hot path), quiet pseudo-moves are
 * discarded before the expensive `attackedBy` legality ray scan.
 */
function generateLegalMovesFast(
  st: FastState,
  sign: number,
  ctx: SearchContext,
  capturesOnly: boolean = false,
  ply: number = 0,
): FastMove[] {
  const squares = st.squares;
  const pseudo = generatePseudoMoves(st, sign, ctx, ply);
  const legal: FastMove[] = listAt(ctx.legalLists, ply);
  for (const move of pseudo) {
    if (capturesOnly && move.captured === 0) continue;
    const captured = squares[move.to];
    const king: number = move.piece === sign ? move.to : st.kingSq[sideIndex(sign)];
    squares[move.to] = move.piece;
    squares[move.from] = 0;
    const ok: boolean = king < 0 || !attackedBy(squares, king, -sign);
    squares[move.from] = move.piece;
    squares[move.to] = captured;
    if (ok) legal.push(move);
  }
  return legal;
}

// --- Move ordering -----------------------------------------------------------

/**
 * v2026.11.19.7: static exchange value of a capture, or +Infinity for quiet
 * moves. SEE ranks a "rook takes defended pawn" (-800) far below a free rook
 * (+900), so the winning capture is tried first and the blunder last. Better
 * ordering means more beta cut-offs at the same node budget — a genuine depth
 * gain, not just a cosmetic score change.
 */
function seeOfCapture(st: FastState, move: FastMove, ctx: SearchContext): number {
  if (move.captured === 0) return Infinity;
  return staticExchange(
    st.squares, move.from, move.to, move.piece, move.captured, ctx.seeScratch,
  );
}

/**
 * Captures first (SEE-refined MVV-LVA), then TT/killer/history/quiet-check.
 * `st` is the position BEFORE the moves are applied — required for SEE.
 */
function orderMoves(
  moves: FastMove[],
  st: FastState,
  ttMove?: FastMove,
  ctx?: SearchContext,
  depth?: number,
): void {
  const k1 = ctx && depth !== undefined ? ctx.killers[depth * 2] : undefined;
  const k2 = ctx && depth !== undefined ? ctx.killers[depth * 2 + 1] : undefined;
  // Score in place into `move.sortScore` — no {move,score} wrapper allocation
  // on the hottest path. Sort compares the field directly.
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    let score: number;
    if (move.captured !== 0) {
      // v2026.11.19.7: SEE folds "will this exchange actually win material?"
      // into the ordering. A free rook (+900) outranks a rook-sac (-800) by a
      // wide margin, so the sound capture is searched first and cuts sooner.
      const exchange: number = ctx ? seeOfCapture(st, move, ctx) : 0;
      score = 1_000_000
        + CAPTURE_VALUE[move.captured + 7] * 10
        - CAPTURE_VALUE[move.piece + 7]
        + Math.max(-1200, Math.min(1200, exchange));
    } else if (move.checkBonus) {
      score = 100_000;
    } else {
      score = 0;
      if (k1 && move.from === k1[0] && move.to === k1[1]) score = 900_000;
      else if (k2 && move.from === k2[0] && move.to === k2[1]) score = 800_000;
      else if (ctx) score = ctx.history[move.from * 90 + move.to];
    }
    if (ttMove && move.from === ttMove.from && move.to === ttMove.to) score = 2_000_000;
    move.sortScore = score;
  }
  moves.sort((a, b) => b.sortScore - a.sortScore);
}

function recordCutoff(move: FastMove, ctx: SearchContext, depth: number): void {
  if (move.captured !== 0) return;
  if (depth < 0 || depth * 2 + 1 >= ctx.killers.length) return;
  const primary = ctx.killers[depth * 2];
  if (primary[0] !== move.from || primary[1] !== move.to) {
    ctx.killers[depth * 2 + 1] = primary;
    ctx.killers[depth * 2] = [move.from, move.to];
  }
  ctx.history[move.from * 90 + move.to] += depth * depth + 1;
}

// --- Repetition / cycle judging ---------------------------------------------

const PERPETUAL_LOSS_SCORE = MATE_SCORE - 100;

interface CycleNode {
  turn: number;
  checked: boolean;
}

function judgeCycle(nodes: ReadonlyArray<CycleNode>): number {
  let redChecks = 0;
  let redMoves = 0;
  let blackChecks = 0;
  let blackMoves = 0;
  for (const node of nodes) {
    const mover = -node.turn;
    if (node.checked) {
      if (mover === 1) redChecks++;
      else blackChecks++;
    }
    if (mover === 1) redMoves++;
    else blackMoves++;
  }
  if (redMoves > 0 && redChecks === redMoves && blackChecks < blackMoves) return 1;
  if (blackMoves > 0 && blackChecks === blackMoves && redChecks < redMoves) return -1;
  return 0;
}

function cycleScore(loser: number, rootSign: number): number {
  if (loser === 0) return 0;
  return rootSign === loser ? -PERPETUAL_LOSS_SCORE : PERPETUAL_LOSS_SCORE;
}

function repetitionScore(
  ctx: SearchContext,
  idx: number,
  currentChecked: boolean,
  turnSign: number,
  rootSign: number,
): number {
  const nodes: CycleNode[] = [];
  for (let j = idx; j <= ctx.pathKeys.length; j++) {
    nodes.push({
      turn: (j - idx) % 2 === 0 ? turnSign : -turnSign,
      checked: j === ctx.pathKeys.length ? currentChecked : ctx.pathChecked[j],
    });
  }
  return cycleScore(judgeCycle(nodes), rootSign);
}

function seenRepetitionScore(
  ctx: SearchContext,
  seenIdx: number,
  currentChecked: boolean,
  turnSign: number,
  rootSign: number,
): number {
  const seenKeys = ctx.seenKeys;
  const seenChecked = ctx.seenChecked;
  if (!seenKeys || !seenChecked || seenChecked.length !== seenKeys.length) return 0;
  const n = seenKeys.length;
  const j = ctx.pathKeys.length;
  if (n - seenIdx + j < 4) return 0;
  if (((n - 1 - seenIdx) ^ j) & 1) return 0;
  const rootTurn = j % 2 === 0 ? turnSign : -turnSign;
  const nodes: CycleNode[] = [];
  for (let s = seenIdx; s < n; s++) {
    nodes.push({
      turn: (n - 1 - s) % 2 === 0 ? rootTurn : -rootTurn,
      checked: seenChecked[s],
    });
  }
  for (let k = 1; k <= j; k++) {
    nodes.push({
      turn: k % 2 === 0 ? rootTurn : -rootTurn,
      checked: k === j ? currentChecked : ctx.pathChecked[k],
    });
  }
  return cycleScore(judgeCycle(nodes), rootSign);
}

// --- Search core -------------------------------------------------------------

/**
 * Repetition guard + recursion. Null children (only the side-to-move flips)
 * deliberately skip repetition checks and do not enter pathKeys: that board
 * was never actually played, so treating it as history was a false draw.
 */
function searchNode(
  st: FastState,
  turnSign: number,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  rootSign: number,
  ctx: SearchContext,
  allowNull: boolean,
  nullMove: boolean,
): number {
  const checked: boolean = inCheck(st, turnSign);
  if (!nullMove) {
    const key: number = st.key;
    const idx: number = ctx.pathKeys.indexOf(key);
    if (idx !== -1) return repetitionScore(ctx, idx, checked, turnSign, rootSign);
    if (ctx.seenKeys !== undefined) {
      const seenIdx: number = ctx.seenKeys.indexOf(key);
      if (seenIdx !== -1) return seenRepetitionScore(ctx, seenIdx, checked, turnSign, rootSign);
    }
    ctx.pathKeys.push(key);
    ctx.pathChecked.push(checked);
  } else {
    // The board did not change, but the logical side to move did. Flip the
    // incremental key so TT probes and subsequent doMoveFast calls agree on
    // whose turn it is; restore it before returning to the real line.
    toggleTurnInState(st, turnSign);
  }
  const score = searchNodeInner(
    st, turnSign, depth, ply, alpha, beta, rootSign, ctx, checked, allowNull,
  );
  if (!nullMove) {
    ctx.pathKeys.pop();
    ctx.pathChecked.pop();
  } else {
    toggleTurnInState(st, turnSign);
  }
  return score;
}

function searchNodeInner(
  st: FastState,
  turnSign: number,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  rootSign: number,
  ctx: SearchContext,
  checked: boolean,
  allowNull: boolean,
): number {
  const poolMark: number = ctx.movePoolTop;
  try {
  const alphaOrig: number = alpha;
  const betaOrig: number = beta;
  ctx.nodes += 1;
  if ((ctx.nodes & 1023) === 0 && ctx.deadline !== undefined && Date.now() > ctx.deadline) {
    ctx.aborted = true;
  }
  if (ctx.aborted || ply > MAX_PLY) return leafTerms(st, rootSign);

  const key: number = st.key;
  const hit: TTEntry | undefined = ctx.tt.get(key);
  if (hit && hit.depth >= depth) {
    if (hit.flag === 'exact') return hit.score;
    if (hit.flag === 'lower') {
      if (hit.score > alpha) alpha = hit.score;
    } else if (hit.score < beta) {
      beta = hit.score;
    }
    if (alpha >= beta) return hit.score;
  }

  if (depth <= 0) {
    return quiescence(
      st, turnSign, alpha, beta, rootSign, ctx, QUIET_DEPTH, ply, MAX_QUIET_CHECKS,
    );
  }

  const moves: FastMove[] = generateLegalMovesFast(st, turnSign, ctx, false, ply);
  if (moves.length === 0) {
    if (checked) return mateScoreFor(rootSign, turnSign, ply);
    // v2026.11.19.8: 困毙判负 (stalemate is a LOSS in Xiangqi, not a draw —
    // engine/rules.ts:186-187). The old `return 0` made the engine walk into
    // stalemates and miss forced stalemate wins in the endgame.
    return mateScoreFor(rootSign, turnSign, ply);
  }

  if (allowNull && depth >= 3 && !checked) {
    const nullValue = searchNode(
      st, -turnSign, depth - 3, ply + 1, alpha, beta, rootSign, ctx, false, true,
    );
    if (Math.abs(nullValue) < MATE_THRESHOLD) {
      if (turnSign === rootSign && nullValue >= beta) return nullValue;
      if (turnSign !== rootSign && nullValue <= alpha) return nullValue;
    }
  }

  const ttMove: FastMove | undefined = hit
    ? moves.find((m) => m.from === hit.bestFrom && m.to === hit.bestTo)
    : undefined;

  /**
   * v2026.11.20.1 — Singular Extension. A TT best move is "singular" when
   * every ALTERNATIVE fails low against a narrow window around the TT value:
   * that means the position has essentially one strong continuation (a forced
   * kill or the only defence). Giving that move one extra ply is exactly what
   * ordinary alpha-beta misses at the horizon. Guarded by depth, exact TT
   * score, non-mate range and `inSingular` so the cost stays bounded.
   */
  let singularExtend: number = 0;
  if (
    ttMove !== undefined && hit !== undefined && hit.flag === 'exact'
    && depth >= 4 && Math.abs(hit.score) < MATE_THRESHOLD
    && ctx.inSingular !== true && !ctx.aborted && moves.length >= 2
  ) {
    const singularBeta: number = hit.score - (25 + depth * 5);
    const altDepth: number = Math.max(1, depth - 3);
    let singular: boolean = true;
    ctx.inSingular = true;
    try {
      for (const alt of moves) {
        if (alt.from === ttMove.from && alt.to === ttMove.to) continue;
        doMoveFast(st, alt);
        const value = searchNode(
          st, -turnSign, altDepth, ply + 1, singularBeta - 1, singularBeta,
          rootSign, ctx, false, false,
        );
        undoMoveFast(st, alt);
        if (ctx.aborted || value >= singularBeta) { singular = false; break; }
      }
    } finally {
      ctx.inSingular = false;
    }
    if (singular) {
      singularExtend = 1;
      if (ctx.singularCount !== undefined) ctx.singularCount += 1;
    }
  }

  orderMoves(moves, st, ttMove, ctx, depth);

  let best: number = turnSign === rootSign ? -Infinity : Infinity;
  let bestFrom: number = -1;
  let bestTo: number = -1;
  const maximizing: boolean = turnSign === rootSign;

  for (let i = 0; i < moves.length; i++) {
    const move: FastMove = moves[i];
    doMoveFast(st, move);
    const quiet: boolean = move.captured === 0;
    // Progressive late-move reduction: the first moves keep full depth; late
    // quiet moves at higher depth are searched shallower. This trims the
    // exponential tail that keeps d7 out of a mobile WebView's time budget.
    const reduce: number = quiet
      ? (depth >= 4 && i >= 6 ? 2 : depth >= 3 && i >= 4 ? 1 : 0)
      : 0;
    // A reduced move never needs check extension. Shallow nodes don't either:
    // their checks are already resolved by quiescence's quiet-check search.
    // Bounding extensions to depth >= 3 removes the exponential "perpetual
    // check extension" tail without hiding forced mates at the horizon.
    const isTtMove: boolean = ttMove !== undefined
      && move.from === ttMove.from && move.to === ttMove.to;
    const extend: number =
      (depth >= 3 && reduce === 0 && inCheck(st, -turnSign) ? 1 : 0)
      + (isTtMove ? singularExtend : 0);
    const childDepth: number = depth - 1 - reduce + extend;
    const fullDepth: number = depth - 1 + extend;
    const childPly: number = ply + 1;

    let value: number;
    if (i === 0) {
      value = searchNode(
        st, -turnSign, fullDepth, childPly, alpha, beta, rootSign, ctx, true, false,
      );
    } else if (maximizing) {
      value = searchNode(
        st, -turnSign, childDepth, childPly, alpha, alpha + 1, rootSign, ctx, true, false,
      );
      if (value > alpha) {
        value = searchNode(
          st, -turnSign, fullDepth, childPly, alpha, beta, rootSign, ctx, true, false,
        );
      }
    } else {
      value = searchNode(
        st, -turnSign, childDepth, childPly, beta - 1, beta, rootSign, ctx, true, false,
      );
      if (value < beta) {
        value = searchNode(
          st, -turnSign, fullDepth, childPly, alpha, beta, rootSign, ctx, true, false,
        );
      }
    }
    undoMoveFast(st, move);

    if (maximizing ? value > best : value < best) {
      best = value;
      bestFrom = move.from;
      bestTo = move.to;
    }
    if (maximizing) {
      if (best > alpha) alpha = best;
    } else if (best < beta) {
      beta = best;
    }
    if (alpha >= beta) {
      recordCutoff(move, ctx, depth);
      break;
    }
  }

  // Mate scores are ply-relative: never cache them.
  if (Math.abs(best) < MATE_THRESHOLD) {
    const flag: TTFlag = best <= alphaOrig
      ? 'upper'
      : best >= betaOrig ? 'lower' : 'exact';
    const previous: TTEntry | undefined = ctx.tt.get(key);
    if (!previous || previous.depth <= depth) {
      ctx.tt.set(key, { depth, score: best, flag, bestFrom, bestTo });
    }
  }
  return best;
  } finally {
    ctx.movePoolTop = poolMark;
  }
}

/** Scores one root move (ply=1) with an explicit window; always restores the board. */
function scoreRootMove(
  st: FastState,
  turnSign: number,
  move: FastMove,
  depth: number,
  ctx: SearchContext,
  alpha: number,
  beta: number,
): number {
  doMoveFast(st, move);
  const score = searchNode(
    st, -turnSign, depth - 1, 1, alpha, beta, turnSign, ctx, true, false,
  );
  undoMoveFast(st, move);
  return score;
}

// --- Public API --------------------------------------------------------------

export function alphabeta(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  side: Side,
): number {
  const turnSign: number = signOf(state.turn);
  return searchNode(
    toFastState(state.board, turnSign), turnSign, depth, 0, alpha, beta, signOf(side),
    createSearchContext(), true, false,
  );
}

/**
 * Root moves sorted best-first from the mover's perspective. Aspiration bounds
 * narrow the root window; a full window is the default for legacy callers.
 */
export function rankedMoves(
  state: GameState,
  depth: number,
  ctx: SearchContext = createSearchContext(),
  windowAlpha: number = -Infinity,
  windowBeta: number = Infinity,
): ScoredMove[] {
  const turnSign = signOf(state.turn);
  const st = toFastState(state.board, turnSign);
  const squares = st.squares;
  ctx.incomplete = false;
  ctx.movePoolTop = 0;
  ctx.pathKeys = [st.key];
  ctx.pathChecked = [inCheck(st, turnSign)];
  const moves = generateLegalMovesFast(st, turnSign, ctx, false, 0);

  const ordered = moves.map((move) => {
    const captured = squares[move.to];
    squares[move.to] = move.piece;
    squares[move.from] = 0;
    const hit = ctx.tt.get(computeKey(squares, -turnSign));
    squares[move.from] = move.piece;
    squares[move.to] = captured;
    const captureBonus = move.captured === 0 ? 0 : CAPTURE_VALUE[move.captured + 7] * 10;
    return { move, order: (hit ? hit.score : 0) + captureBonus };
  });
  ordered.sort((a, b) => b.order - a.order);

  let alpha: number = windowAlpha;
  const beta: number = windowBeta;
  const scored: ScoredMove[] = [];
  for (const entry of ordered) {
    if (ctx.aborted) break;
    let score: number;
    if (scored.length === 0) {
      score = scoreRootMove(st, turnSign, entry.move, depth, ctx, alpha, beta);
    } else {
      score = scoreRootMove(st, turnSign, entry.move, depth, ctx, alpha, alpha + 1);
      if (score > alpha) {
        score = scoreRootMove(st, turnSign, entry.move, depth, ctx, alpha, beta);
      }
    }
    scored.push({ move: codesToMove(entry.move), score });
    if (score > alpha) alpha = score;
    if (score >= beta) break;
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Best move for the side to move (rng breaks ties). */
export function bestMove(
  state: GameState,
  depth: number,
  rng: () => number = Math.random,
): Move | null {
  const ranked = rankedMoves(state, depth);
  if (ranked.length === 0) return null;
  const topScore = ranked[0].score;
  const top = ranked.filter((r) => r.score === topScore);
  return (top[Math.floor(rng() * top.length)] ?? ranked[0]).move;
}

export const Search = {
  alphabeta,
  rankedMoves,
  bestMove,
  createSearchContext,
};

/** Non-incremental leaf evaluation from a flat board (regression tests). */
export function evaluateFast(squares: Int8Array, rootSign: number): number {
  return leafTerms(fastStateFromSquares(squares, rootSign), rootSign);
}

/** Original Zobrist key API; now delegates to the shared implementation. */
export function makeKey(squares: Int8Array, turnSign: number, _rootSign: number): number {
  return computeKey(squares, turnSign);
}

/**
 * Flat MVV-LVA table indexed by `code + 7`. The hot path used to convert a
 * numeric piece code to a PieceType string and then look up PIECE_VALUE on
 * every capture ordering / delta-pruning check; this removes both lookups.
 */
const CAPTURE_VALUE: Int32Array = new Int32Array(15);
for (let code = -7; code <= 7; code++) {
  CAPTURE_VALUE[code + 7] = code === 0 ? 0 : PIECE_VALUE[typeOf(code)];
}

/**
 * 每个根节点的软上限，保持 v1.14 的 300ms 不动：这是帧间隔 <400ms 的硬保证。
 * 曾试过 350ms，实测最大帧间隔升到 354ms（余量只剩 46ms）而有效深度并未
 * 稳定提升，因此回退。超过上限仍立刻标记 incomplete，partial 永不覆盖完整迭代。
 */
const PER_MOVE_SOFT_CAP_MS = 300;

/**
 * Async root search: identical algorithm to `rankedMoves`, with one frame
 * yielded between root candidates. A per-root soft cap flags the iteration
 * `incomplete`; `partialRanked` is kept for diagnostics ONLY and must never
 * replace a completed iteration in the caller.
 */
export async function rankedMovesAsync(
  state: GameState,
  depth: number,
  ctx: SearchContext,
  yieldFrame: () => Promise<void>,
  windowAlpha: number = -Infinity,
  windowBeta: number = Infinity,
  /** v19.7: if set, only these root moves (key = from*90+to) are searched. */
  rootKeys?: ReadonlySet<number>,
): Promise<ScoredMove[]> {
  const turnSign = signOf(state.turn);
  const st = toFastState(state.board, turnSign);
  const squares = st.squares;
  ctx.incomplete = false;
  ctx.movePoolTop = 0;
  ctx.pathKeys = [st.key];
  ctx.pathChecked = [inCheck(st, turnSign)];
  const moves = generateLegalMovesFast(st, turnSign, ctx, false, 0);

  const ordered = moves.map((move) => {
    const captured = squares[move.to];
    squares[move.to] = move.piece;
    squares[move.from] = 0;
    const hit = ctx.tt.get(computeKey(squares, -turnSign));
    squares[move.from] = move.piece;
    squares[move.to] = captured;
    const captureBonus = move.captured === 0 ? 0 : CAPTURE_VALUE[move.captured + 7] * 10;
    return { move, order: (hit ? hit.score : 0) + captureBonus };
  });
  ordered.sort((a, b) => b.order - a.order);
  // v19.7: narrow the root to the most promising candidates for a retry of a
  // soft-capped iteration. Fewer root moves => each fits under the 300ms cap,
  // so the extra depth is actually banked instead of discarded.
  const candidates: Array<{ move: FastMove; order: number }> = rootKeys
    ? ordered.filter((e) => rootKeys.has(e.move.from * 90 + e.move.to))
    : ordered;

  let alpha: number = windowAlpha;
  const beta: number = windowBeta;
  const scored: ScoredMove[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (ctx.aborted) break;
    if (i > 0) {
      try { await yieldFrame(); } catch { /* ignore frame errors */ }
    }
    const move: FastMove = candidates[i].move;
    const overall: number | undefined = ctx.deadline;
    let softCapped = false;
    if (overall !== undefined) {
      const cap = Date.now() + PER_MOVE_SOFT_CAP_MS;
      if (cap < overall) {
        ctx.deadline = cap;
        softCapped = true;
      }
    }
    let score: number;
    if (scored.length === 0) {
      score = scoreRootMove(st, turnSign, move, depth, ctx, alpha, beta);
    } else {
      score = scoreRootMove(st, turnSign, move, depth, ctx, alpha, alpha + 1);
      if (score > alpha) {
        score = scoreRootMove(st, turnSign, move, depth, ctx, alpha, beta);
      }
    }
    ctx.deadline = overall;
    if (softCapped && ctx.aborted && (overall === undefined || Date.now() < overall)) {
      // The iteration is incomplete even though earlier root moves finished:
      // their bounds were computed for a different root-move set and cannot be
      // trusted as a complete ranking. Keep them for observation only.
      ctx.aborted = false;
      ctx.incomplete = true;
      ctx.partialRanked = scored.slice();
      break;
    }
    scored.push({ move: codesToMove(move), score });
    if (score > alpha) alpha = score;
    if (score >= beta) break;
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// --- Repetition helpers ------------------------------------------------------

export function positionKeyOf(board: Board, turn: Side): number {
  return makeKey(boardToCodes(board), turn === 'red' ? 1 : -1, 1);
}

export function positionKeysFor(history: ReadonlyArray<Move>): number[] {
  const keys: number[] = [];
  if (history.length === 0) return keys;
  let board: Board = createInitialState('red').board;
  let turn: Side = 'red';
  keys.push(positionKeyOf(board, turn));
  for (const move of history) {
    const next = board.clone();
    next.applyMove({ ...move });
    board = next;
    turn = turn === 'red' ? 'black' : 'red';
    keys.push(positionKeyOf(board, turn));
  }
  return keys;
}

export function positionHistoryFor(
  history: ReadonlyArray<Move>,
): Array<{ key: number; checked: boolean }> {
  const out: Array<{ key: number; checked: boolean }> = [];
  if (history.length === 0) return out;
  let board: Board = createInitialState('red').board;
  let turn: Side = 'red';
  out.push({ key: positionKeyOf(board, turn), checked: isInCheck(board, turn) });
  for (const move of history) {
    const next = board.clone();
    next.applyMove({ ...move });
    board = next;
    turn = turn === 'red' ? 'black' : 'red';
    out.push({ key: positionKeyOf(board, turn), checked: isInCheck(board, turn) });
  }
  return out;
}
