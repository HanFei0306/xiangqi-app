/**
 * 《适情雅趣》残局 AI 应手 (v2026.11.19.8).
 *
 * The old practice page answered an off-book red move with `legal[0]` — the
 * first pseudo-ordered legal move, i.e. a textbook "看不懂的废招". This module
 * replaces that with a real endgame decision:
 *
 *   1. verified mate-in-1 / mate-in-2 proof (never abandon a kill);
 *   2. iterative-deepening alpha-beta with a hard wall-clock cap, so the UI
 *      never freezes and the last COMPLETE depth is the only answer used.
 *
 * It deliberately does NOT use the opening book or local learning — neither
 * has any business in a composed endgame.
 */

import type { Board } from '../engine/board';
import type { GameState, Move, Side } from '../engine/types';
import { checkStatus } from '../engine/rules';
import { findForcedMate, findMateInOne } from './mate';
import { Search } from './search';
import { ANCIENT_PROFILE } from './profiles';

export interface AncientAiOptions {
  /** Latest full ply to attempt (default 4). */
  maxDepth?: number;
  /** Wall-clock budget for the whole decision (default 180ms). */
  timeMs?: number;
  /** Proof-search budget for mate-in-2 (default 60ms). */
  mateTimeMs?: number;
}

/**
 * Picks a strong reply for `side` in a (usually sparse) endgame position.
 * Returns null only when there is no legal move or the position is already
 * lost — the caller keeps its own terminal handling.
 */
export function ancientAiReply(
  board: Board,
  side: Side,
  options: AncientAiOptions = {},
): Move | null {
  const maxDepth: number = Math.max(1, Math.min(6, options.maxDepth ?? ANCIENT_PROFILE.maxDepth));
  const timeMs: number = Math.max(20, options.timeMs ?? ANCIENT_PROFILE.searchMs);
  const mateTimeMs: number = Math.max(10, options.mateTimeMs ?? ANCIENT_PROFILE.mateProofMs);
  const state: GameState = {
    board,
    turn: side,
    history: [],
    status: checkStatus(board, side),
    moveCount: 0,
  };
  if (state.status === 'checkmate' || state.status === 'stalemate') return null;

  // The exact requirement: a verified kill outranks every positional notion.
  const kill: Move | null = findMateInOne(state, side);
  if (kill) return kill;
  const mate2 = findForcedMate(state, side, { maxOwnMoves: 2, timeMs: mateTimeMs });
  if (mate2) return mate2.move;

  const ctx = Search.createSearchContext(Date.now() + timeMs);
  let ranked = Search.rankedMoves(state, 1, ctx);
  for (let depth = 2; depth <= maxDepth; depth++) {
    if (ctx.aborted || Date.now() >= (ctx.deadline ?? Infinity)) break;
    const next = Search.rankedMoves(state, depth, ctx);
    // A truncated iteration is observation only: keep the last full ranking.
    if (ctx.aborted) break;
    if (next.length > 0) ranked = next;
  }
  return ranked.length > 0 ? ranked[0].move : null;
}
