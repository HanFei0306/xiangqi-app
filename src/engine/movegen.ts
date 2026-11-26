/**
 * Move generation for Xiangqi.
 *
 * Functions here produce PSEUDO-legal moves (geometrically valid but may leave
 * the mover's own king in check). Legality filtering (self-check, flying
 * generals) lives in rules.ts.
 *
 * Coordinate convention: col 0..8, row 0..9 (0 = red back rank).
 * Red moves upward (row+), black downward (row-).
 */

import type { Board } from './board';
import type { Move, Piece, Pos, Side } from './types';
import { BOARD_COLS, BOARD_ROWS, inBounds, opponent } from './types';

/** Palace column range. */
const PALACE_MIN_COL = 3;
const PALACE_MAX_COL = 5;
/** Palace rows: red 0..2, black 7..9. */
const RED_PALACE_ROWS: [number, number] = [0, 2];
const BLACK_PALACE_ROWS: [number, number] = [7, 9];
/** River rows: red pawns cross at row >= 5, black pawns at row <= 4. */
const RIVER_ROW = 5;

/** Builds a Move object with empty notation (filled by Board.applyMove). */
function makeMove(from: Pos, to: Pos, piece: Piece): Move {
  return {
    from: { col: from.col, row: from.row },
    to: { col: to.col, row: to.row },
    piece: piece.type,
    captured: null,
    notation: '',
  };
}

/** Whether the given position is inside the side's palace. */
function inPalace(pos: Pos, side: Side): boolean {
  if (pos.col < PALACE_MIN_COL || pos.col > PALACE_MAX_COL) {
    return false;
  }
  const [lo, hi] =
    side === 'red' ? RED_PALACE_ROWS : BLACK_PALACE_ROWS;
  return pos.row >= lo && pos.row <= hi;
}

/** Whether the piece is still on its own side of the river. */
function ownHalf(side: Side, row: number): boolean {
  // The river lies between row 4 and row 5 (0-based): red owns rows 0..4,
  // black owns rows 5..9. An elephant may never cross to the other side.
  return side === 'red' ? row < RIVER_ROW : row >= RIVER_ROW;
}

/** Adds a move to the list if the destination is either empty or an enemy. */
function addIfValid(
  board: Board,
  from: Pos,
  to: Pos,
  piece: Piece,
  out: Move[],
): void {
  if (!inBounds(to.col, to.row)) {
    return;
  }
  const target = board.getPiece(to);
  if (target === null) {
    out.push(makeMove(from, to, piece));
  } else if (target.side !== piece.side) {
    out.push(makeMove(from, to, piece));
  }
}

/** Generates moves for a single piece at `from`. */
export function generatePieceMoves(board: Board, from: Pos): Move[] {
  const piece = board.getPiece(from);
  if (piece === null) {
    return [];
  }
  switch (piece.type) {
    case 'K':
      return kingMoves(board, from, piece);
    case 'A':
      return advisorMoves(board, from, piece);
    case 'B':
      return elephantMoves(board, from, piece);
    case 'N':
      return horseMoves(board, from, piece);
    case 'R':
      return rookMoves(board, from, piece);
    case 'C':
      return cannonMoves(board, from, piece);
    case 'P':
      return pawnMoves(board, from, piece);
    default:
      return [];
  }
}

/** All pseudo-legal moves for a given side. */
export function generateAllMoves(board: Board, side: Side): Move[] {
  const moves: Move[] = [];
  for (let col = 0; col < BOARD_COLS; col++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const piece = board.getPiece({ col, row });
      if (piece && piece.side === side) {
        moves.push(...generatePieceMoves(board, { col, row }));
      }
    }
  }
  return moves;
}

function kingMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  const deltas = [
    { col: 0, row: 1 },
    { col: 0, row: -1 },
    { col: 1, row: 0 },
    { col: -1, row: 0 },
  ];
  for (const d of deltas) {
    const to = { col: from.col + d.col, row: from.row + d.row };
    if (inPalace(to, piece.side)) {
      addIfValid(board, from, to, piece, out);
    }
  }
  return out;
}

function advisorMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  const deltas = [
    { col: 1, row: 1 },
    { col: 1, row: -1 },
    { col: -1, row: 1 },
    { col: -1, row: -1 },
  ];
  for (const d of deltas) {
    const to = { col: from.col + d.col, row: from.row + d.row };
    if (inPalace(to, piece.side)) {
      addIfValid(board, from, to, piece, out);
    }
  }
  return out;
}

function elephantMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  const deltas = [
    { col: 2, row: 2 },
    { col: 2, row: -2 },
    { col: -2, row: 2 },
    { col: -2, row: -2 },
  ];
  for (const d of deltas) {
    const to = { col: from.col + d.col, row: from.row + d.row };
    if (!inBounds(to.col, to.row)) {
      continue;
    }
    // Elephant cannot cross the river.
    if (!ownHalf(piece.side, to.row)) {
      continue;
    }
    // Elephant eye (塞象眼) must be empty.
    const eye = {
      col: from.col + d.col / 2,
      row: from.row + d.row / 2,
    };
    if (board.getPiece(eye) !== null) {
      continue;
    }
    addIfValid(board, from, to, piece, out);
  }
  return out;
}

function horseMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  // Each horse move has an orthogonal "leg" that must be empty.
  const candidates: Array<{ leg: Pos; to: Pos }> = [
    { leg: { col: from.col, row: from.row + 1 }, to: { col: from.col + 1, row: from.row + 2 } },
    { leg: { col: from.col, row: from.row + 1 }, to: { col: from.col - 1, row: from.row + 2 } },
    { leg: { col: from.col, row: from.row - 1 }, to: { col: from.col + 1, row: from.row - 2 } },
    { leg: { col: from.col, row: from.row - 1 }, to: { col: from.col - 1, row: from.row - 2 } },
    { leg: { col: from.col + 1, row: from.row }, to: { col: from.col + 2, row: from.row + 1 } },
    { leg: { col: from.col + 1, row: from.row }, to: { col: from.col + 2, row: from.row - 1 } },
    { leg: { col: from.col - 1, row: from.row }, to: { col: from.col - 2, row: from.row + 1 } },
    { leg: { col: from.col - 1, row: from.row }, to: { col: from.col - 2, row: from.row - 1 } },
  ];
  for (const c of candidates) {
    if (board.getPiece(c.leg) !== null) {
      continue; // 蹩马腿
    }
    if (!inBounds(c.to.col, c.to.row)) {
      continue;
    }
    addIfValid(board, from, c.to, piece, out);
  }
  return out;
}

function rookMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  const dirs = [
    { col: 1, row: 0 },
    { col: -1, row: 0 },
    { col: 0, row: 1 },
    { col: 0, row: -1 },
  ];
  for (const d of dirs) {
    let col = from.col + d.col;
    let row = from.row + d.row;
    while (inBounds(col, row)) {
      const target = board.getPiece({ col, row });
      if (target === null) {
        out.push(makeMove(from, { col, row }, piece));
      } else {
        if (target.side !== piece.side) {
          out.push(makeMove(from, { col, row }, piece));
        }
        break;
      }
      col += d.col;
      row += d.row;
    }
  }
  return out;
}

function cannonMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  const dirs = [
    { col: 1, row: 0 },
    { col: -1, row: 0 },
    { col: 0, row: 1 },
    { col: 0, row: -1 },
  ];
  for (const d of dirs) {
    let col = from.col + d.col;
    let row = from.row + d.row;
    // Phase 1: walk until we hit the first screen (any piece).
    let screenFound = false;
    while (inBounds(col, row)) {
      const target = board.getPiece({ col, row });
      if (!screenFound) {
        if (target === null) {
          out.push(makeMove(from, { col, row }, piece)); // non-capturing move
        } else {
          screenFound = true; // this piece is the screen
        }
      } else {
        // Phase 2: past the screen, look for the first piece to capture.
        if (target !== null) {
          if (target.side !== piece.side) {
            out.push(makeMove(from, { col, row }, piece));
          }
          break;
        }
      }
      col += d.col;
      row += d.row;
    }
  }
  return out;
}

function pawnMoves(board: Board, from: Pos, piece: Piece): Move[] {
  const out: Move[] = [];
  const forward = piece.side === 'red' ? 1 : -1;
  // Forward move (always allowed).
  addIfValid(board, from, { col: from.col, row: from.row + forward }, piece, out);
  // Sideways moves only allowed after crossing the river.
  const crossedRiver = piece.side === 'red' ? from.row >= RIVER_ROW : from.row <= RIVER_ROW - 1;
  if (crossedRiver) {
    addIfValid(board, from, { col: from.col + 1, row: from.row }, piece, out);
    addIfValid(board, from, { col: from.col - 1, row: from.row }, piece, out);
  }
  return out;
}

/** Finds the position of a side's king, or null if missing. */
export function findKing(board: Board, side: Side): Pos | null {
  for (let col = 0; col < BOARD_COLS; col++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const piece = board.getPiece({ col, row });
      if (piece && piece.type === 'K' && piece.side === side) {
        return { col, row };
      }
    }
  }
  return null;
}

/** Whether the two kings face each other on an open file (flying general). */
export function kingsFacing(board: Board): boolean {
  const red = findKing(board, 'red');
  const black = findKing(board, 'black');
  if (!red || !black) {
    return false;
  }
  if (red.col !== black.col) {
    return false;
  }
  const lo = Math.min(red.row, black.row);
  const hi = Math.max(red.row, black.row);
  for (let row = lo + 1; row < hi; row++) {
    if (board.getPiece({ col: red.col, row }) !== null) {
      return false; // a piece blocks the file
    }
  }
  return true;
}

/** Re-export for convenience. */
export { opponent };
