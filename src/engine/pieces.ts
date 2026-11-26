/**
 * Piece definitions: Chinese display characters, serialization characters, and the
 * standard initial layout. Pure data + helpers, no board logic.
 */

import type { Piece, PieceType, Side } from './types';

/**
 * Chinese display characters (used by the UI and notation).
 * Red and black share the same name for many pieces; the side is conveyed by color.
 */
export const PIECE_DISPLAY: Record<Side, Record<PieceType, string>> = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '砲', P: '卒' },
};

/**
 * Single-character notation glyphs for each piece, side-aware. This is exactly
 * the Chinese display name exposed by `PIECE_DISPLAY` and is what the notation
 * generator (`generateNotation`) needs to render moves such as 炮二平五.
 */
export const PIECE_CHAR: Record<Side, Record<PieceType, string>> = PIECE_DISPLAY;

/**
 * Relative material values for each piece type, used by the evaluation and
 * search layers. v2026.11.19.1 adopts the ElephantEye 3.3 scale so the baked
 * PST values share one origin: R=900, C=N=400, B=A=200, P=100. The king's
 * 10000 sentinel remains far above MATE_THRESHOLD=999000's safety margin
 * (total material ≤ ~9400), so mate detection cannot be confused by material.
 */
export const PIECE_VALUE: Record<PieceType, number> = {
  K: 10000,
  R: 900,
  C: 400,
  N: 400,
  B: 200,
  A: 200,
  P: 100,
};

/**
 * Single-character tokens used by `Board.toNotationSetup()` / `parseSetup()`.
 * Red uses uppercase, Black uses lowercase to keep the string unambiguous.
 */
export const PIECE_SETUP_CHAR: Record<Side, Record<PieceType, string>> = {
  red: { K: 'K', A: 'A', B: 'B', N: 'N', R: 'R', C: 'C', P: 'P' },
  black: { K: 'k', A: 'a', B: 'b', N: 'n', R: 'r', C: 'c', P: 'p' },
};

/** Reverse map: setup character -> { side, type }. */
export const CHAR_TO_PIECE: Record<string, { side: Side; type: PieceType }> = {
  K: { side: 'red', type: 'K' },
  k: { side: 'black', type: 'K' },
  A: { side: 'red', type: 'A' },
  a: { side: 'black', type: 'A' },
  B: { side: 'red', type: 'B' },
  b: { side: 'black', type: 'B' },
  N: { side: 'red', type: 'N' },
  n: { side: 'black', type: 'N' },
  R: { side: 'red', type: 'R' },
  r: { side: 'black', type: 'R' },
  C: { side: 'red', type: 'C' },
  c: { side: 'black', type: 'C' },
  P: { side: 'red', type: 'P' },
  p: { side: 'black', type: 'P' },
};

/** Back-rank piece order (col 0..8) for both sides. */
const BACK_RANK: PieceType[] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];

/**
 * Builds the initial 9x10 grid (grid[col][row]) for a brand new game.
 * Red occupies rows 0-3, Black occupies rows 6-9.
 */
export function initialBoardGrid(): (Piece | null)[][] {
  const grid: (Piece | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 10 }, () => null as Piece | null)
  );

  // Red back rank (row 0) and Black back rank (row 9).
  for (let col = 0; col < 9; col++) {
    grid[col][0] = { type: BACK_RANK[col], side: 'red' };
    grid[col][9] = { type: BACK_RANK[col], side: 'black' };
  }

  // Cannons on row 2 (red) and row 7 (black).
  grid[1][2] = { type: 'C', side: 'red' };
  grid[7][2] = { type: 'C', side: 'red' };
  grid[1][7] = { type: 'C', side: 'black' };
  grid[7][7] = { type: 'C', side: 'black' };

  // Pawns on row 3 (red) and row 6 (black), every other column.
  for (const col of [0, 2, 4, 6, 8]) {
    grid[col][3] = { type: 'P', side: 'red' };
    grid[col][6] = { type: 'P', side: 'black' };
  }

  return grid;
}

/**
 * Returns the piece at the standard starting square `(col,row)`, or `null`
 * when that square is empty. Mirrors the layout produced by
 * `initialBoardGrid` and is used by `Board`'s no-arg constructor to build the
 * opening position one square at a time.
 */
export function initialPiece(col: number, row: number): Piece | null {
  if (col < 0 || col > 8 || row < 0 || row > 9) {
    return null;
  }
  // Back ranks.
  if (row === 0) {
    return { type: BACK_RANK[col], side: 'red' };
  }
  if (row === 9) {
    return { type: BACK_RANK[col], side: 'black' };
  }
  // Cannons on row 2 (red) and row 7 (black).
  if ((row === 2 || row === 7) && (col === 1 || col === 7)) {
    return { type: 'C', side: row === 2 ? 'red' : 'black' };
  }
  // Pawns on row 3 (red) and row 6 (black), every other column.
  if ((row === 3 || row === 6) && col % 2 === 0) {
    return { type: 'P', side: row === 3 ? 'red' : 'black' };
  }
  return null;
}
