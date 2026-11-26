/**
 * Public evaluation façade (v2026.11.19.1).
 *
 * All scoring now lives in `pst.ts` (public ElephantEye numbers) and
 * `evalTerms.ts` (leaf/full terms). This module only converts a public
 * `GameState` into the shared `FastState` and selects the detail level, so
 * `evaluateState` and search-leaf evaluation can no longer disagree.
 *
 * Score is from `side`'s perspective (positive = good for `side`).
 */

import type { Board } from '../../../engine/board';
import type { GameState, PieceType, Side } from '../../../engine/types';
import { PIECE_VALUE } from '../../../engine/pieces';
import { fastStateFromBoard, fullTerms, leafTerms } from './evalTerms';
import { mgTableValue } from './pst';
import type { EvalDetail } from './types';

/** Kept for API compatibility; actual weights live in `evalTerms.ts`. */
export const MOBILITY_WEIGHT = 2;
/** Kept for API compatibility. */
export const FAST_MOBILITY_WEIGHT = 1;
/** Kept for API compatibility. */
export const KING_SAFETY_WEIGHT = 12;

/** Material balance from `side`'s perspective. */
export function material(board: Board, side: Side): number {
  let score: number = 0;
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece) score += piece.side === side ? PIECE_VALUE[piece.type] : -PIECE_VALUE[piece.type];
    }
  }
  return score;
}

/** Positional PST bonus for one piece (red perspective), for diagnostics. */
export function positionalBonusFor(
  type: PieceType,
  isRed: boolean,
  col: number,
  row: number,
): number {
  const code: number = (isRed ? 1 : -1) * ({ K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 } as const)[type];
  return mgTableValue(code, col, row);
}

/**
 * Full evaluation from `side`'s perspective.
 *
 * @param detail `'full'` (default) runs every term; `'leaf'` shares the exact
 *   search-leaf formula. The legacy boolean form is accepted: `true` = full,
 *   `false` = leaf.
 */
export function evaluateState(
  state: GameState,
  side: Side,
  detail: EvalDetail | boolean = 'full',
): number {
  const level: EvalDetail = typeof detail === 'boolean' ? (detail ? 'full' : 'leaf') : detail;
  const st = fastStateFromBoard(state.board, side === 'red' ? 1 : -1);
  return level === 'full'
    ? fullTerms(st, side === 'red' ? 1 : -1)
    : leafTerms(st, side === 'red' ? 1 : -1);
}

/** Evaluation namespace mirroring the class diagram `Evaluate`. */
export const Evaluate = {
  material,
  positional: positionalBonusFor,
  evaluate: evaluateState,
};
