/**
 * Repetition judge for the Chinese chess rules on draws and perpetual check.
 *
 * When the same position (layout + side to move) occurs for the third time in
 * a game that started from the standard initial position, the rules say:
 *   - if one side delivered check with EVERY move of the last full cycle
 *     while the opponent did not (长将 / perpetual check), the checking side
 *     LOSES (长将判负);
 *   - otherwise the game is a draw (三次重复判和).
 *
 * The judgment is a pure function of the move history so it is trivially
 * testable. The last full cycle (between the final two occurrences of the
 * repeated position) is replayed from the standard start; for each ply the
 * mover gives check when the opponent is in check right after the move.
 */

import { positionKeysFor } from '../ai/search';
import { createInitialState } from '../engine/board';
import { applyMoveToState, isInCheck } from '../engine/rules';
import type { Move } from '../engine/types';
import { detectPerpetualHarassment } from '../training/perpetualGuard';

/**
 * Outcome of the repetition judgment:
 *  - 'none'       : no threefold repetition (game continues);
 *  - 'draw'       : threefold repetition without perpetual check;
 *  - 'red-loses'  : red performed perpetual check — red loses;
 *  - 'black-loses': black performed perpetual check — black loses.
 */
export type RepetitionJudgment =
  | 'none'
  | 'draw'
  | 'red-loses'
  | 'black-loses';

/**
 * Judges the position after `history` for threefold repetition and, when it
 * occurs, whether the last cycle was a perpetual check by one side.
 *
 * Only meaningful for histories that started from the standard initial
 * position (the replay below assumes it); callers gate on that.
 */
export function judgeRepetition(history: ReadonlyArray<Move>): RepetitionJudgment {
  // One full cycle needs at least 4 plies; three occurrences need two cycles.
  if (history.length < 8) return 'none';

  // Position key after every ply (index 0 = the initial position).
  const keys = positionKeysFor(history);
  const current = keys[keys.length - 1];

  // Collect every occurrence index of the current position key.
  const occurrences: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === current) occurrences.push(i);
  }
  if (occurrences.length < 3) return 'none';

  // v2026.11.23.2 BUG FIX — 单方长将赖和漏判（规则 2020 §23.5.1）。
  // 已构成三次重复：先宽松识别单方长将。严格循环判定在劣势方反复将军、
  // 应将位置多变时常漏判，导致一路长将被判和。宽松判定只在三次重复之后
  // 启用，未形成重复不判负，不误伤"连续将军直接将死"的正常棋。
  const harassment = detectPerpetualHarassment(history);
  if (harassment) return harassment;

  // The most recent full cycle spans the final two occurrences: keys[i2]
  // (start of the cycle) through keys[i3] (the same position again). The
  // cycle's moves are history[i2 .. i3-1].
  const i3 = occurrences[occurrences.length - 1];
  const i2 = occurrences[occurrences.length - 2];
  if (i3 - i2 < 4) return 'none'; // degenerate: cannot hold a check cycle

  // Replay from the standard initial position up to the start of the cycle,
  // then walk the cycle counting checks per mover.
  let state = createInitialState('red');
  for (let i = 0; i < i2; i++) {
    state = applyMoveToState(state, history[i]);
  }

  let redChecks = 0;
  let redMoves = 0;
  let blackChecks = 0;
  let blackMoves = 0;
  for (let i = i2; i < i3; i++) {
    const mover = state.turn;
    state = applyMoveToState(state, history[i]);
    // After the move it is the opponent's turn; them being in check means
    // the mover just delivered check.
    if (isInCheck(state.board, state.turn)) {
      if (mover === 'red') redChecks++;
      else blackChecks++;
    }
    if (mover === 'red') redMoves++;
    else blackMoves++;
  }

  // Perpetual check: the side checked on EVERY one of its cycle moves while
  // the opponent had at least one non-checking move.
  const redPerp = redMoves > 0 && redChecks === redMoves && blackChecks < blackMoves;
  const blackPerp = blackMoves > 0 && blackChecks === blackMoves && redChecks < redMoves;
  if (redPerp) return 'red-loses';
  if (blackPerp) return 'black-loses';
  return 'draw';
}
