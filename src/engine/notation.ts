/**
 * Chinese notation (记谱) generation for Xiangqi moves.
 *
 * Rules (shared knowledge from the system design):
 * - File numbers are counted from the player's RIGHT hand, 1..9.
 *     fileNumber(side, col) = side === 'red' ? 9 - col : col + 1
 * - Verb:
 *     '平' (horizontal, drow === 0)
 *     '进' (forward: row increases for red, decreases for black)
 *     '退' (backward: the opposite)
 * - Target number:
 *     '平' -> target file number
 *     '进'/'退' for R/C/P(forward)/K -> step count (|drow|)
 *     '进'/'退' for N/B/A -> target file number (diagonal moves always change file)
 *
 * Examples that MUST hold: 炮二平五, 马八进七, 车二进三.
 */

import type { Board } from './board';
import type { Move, PieceType, Pos, Side } from './types';
import { PIECE_CHAR } from './pieces';

/** File (column) number from a side's perspective, 1..9. */
export function fileNumber(side: Side, col: number): number {
  return side === 'red' ? 9 - col : col + 1;
}

/** Maps a piece type to its single-character notation glyph (side aware). */
function pieceGlyph(side: Side, type: PieceType): string {
  return PIECE_CHAR[side][type];
}

/** Chinese numerals 0..9 used in move notation. */
const CN_NUMERALS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** Converts a small non-negative number (file / step count) to a Chinese numeral. */
function toChineseNum(n: number): string {
  return CN_NUMERALS[n] ?? String(n);
}

/** Piece types that, on a forward/backward move, use the target FILE (not steps). */
const FILE_TARGET_TYPES: ReadonlySet<PieceType> = new Set<PieceType>(['N', 'B', 'A']);

/**
 * Generates the Chinese notation string for a move.
 * `board` is accepted for forward compatibility (e.g. future disambiguation),
 * though the current algorithm only needs the move geometry and side.
 */
export function generateNotation(_board: Board, move: Move, side: Side): string {
  const glyph = pieceGlyph(side, move.piece);
  const fromFile = fileNumber(side, move.from.col);

  const drow = move.to.row - move.from.row;
  const forwardDir = side === 'red' ? 1 : -1;

  let verb: '平' | '进' | '退';
  if (drow === 0) {
    verb = '平';
  } else {
    verb = drow * forwardDir > 0 ? '进' : '退';
  }

  let target: number;
  if (verb === '平') {
    target = fileNumber(side, move.to.col);
  } else if (FILE_TARGET_TYPES.has(move.piece)) {
    target = fileNumber(side, move.to.col);
  } else {
    target = Math.abs(drow);
  }

  return `${glyph}${toChineseNum(fromFile)}${verb}${toChineseNum(target)}`;
}

/**
 * Builds a human-readable description of a positional square, used by hints
 * and replay comments.
 */
export function describePos(side: Side, pos: Pos): string {
  return `${fileNumber(side, pos.col)}.${(pos.row + 1).toString()}`;
}
