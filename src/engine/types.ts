/**
 * Core shared types for the Xiangqi (Chinese Chess) engine layer.
 *
 * Coordinate convention (shared across the whole app):
 * - col: 0..8 (left to right from the viewer's perspective)
 * - row: 0..9 (0 = red's back rank, 9 = black's back rank)
 * - Red moves upward (row increases), Black moves downward (row decreases).
 * - Board.grid[col][row] stores a Piece | null.
 *
 * This module is pure TypeScript with ZERO UI dependencies so it can be
 * reused by the Web app, future native wrappers (Capacitor/Electron), and
 * unit tests running in Node.
 */

import type { Board } from './board';

/** The two sides. */
export type Side = 'red' | 'black';

/**
 * Piece types. Red and black share the same letter; the Side distinguishes
 * them. Mapping to Chinese display characters lives in pieces.ts.
 * K=King(帅/将) A=Advisor(仕/士) B=Elephant(相/象) N=Horse(马)
 * R=Chariot/Rook(车) C=Cannon(炮) P=Pawn(兵/卒)
 */
export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';

/** A position on the 9x10 board. */
export interface Pos {
  /** 0..8 left to right. */
  col: number;
  /** 0..9, 0 = red back rank, 9 = black back rank. */
  row: number;
}

/** A single piece identified by its type and side. */
export interface Piece {
  type: PieceType;
  side: Side;
}

/**
 * A move. `from`/`to` are board coordinates; `piece` is the moving piece type;
 * `captured` is the type of the captured piece (or null); `notation` is the
 * Chinese notation string, filled by the engine when the move is applied.
 */
export interface Move {
  from: Pos;
  to: Pos;
  piece: PieceType;
  captured: PieceType | null;
  notation: string;
}

/**
 * Game status enumeration.
 *
 * 'perpetual' means the side to move (`turn`) WINS: the opponent just lost by
 * perpetual check (长将判负). The perpetually-checking side made the last
 * move, so `turn` after that move is the victim of the checks — and per the
 * Chinese chess rules the victim wins. This keeps the invariant "the side
 * whose turn it is has won" for this status.
 */
export type GameStatus =
  | 'playing'
  | 'check'
  | 'checkmate'
  | 'stalemate'
  | 'draw'
  | 'perpetual';

/** A full game state snapshot. */
export interface GameState {
  board: Board;
  turn: Side;
  history: Move[];
  status: GameStatus;
  /** Total moves played (both sides). */
  moveCount: number;
}

/** Board dimension constants. */
export const BOARD_COLS = 9;
export const BOARD_ROWS = 10;

/** Returns true when the given coordinates are inside the board. */
export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < BOARD_COLS && row >= 0 && row < BOARD_ROWS;
}

/** Returns true when the given position is inside the board. */
export function posInBounds(p: Pos): boolean {
  return inBounds(p.col, p.row);
}

/** Deep-compares two positions for equality. */
export function samePos(a: Pos, b: Pos): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Returns the opponent side. */
export function opponent(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

/** Forward direction (row delta) for a side: red +1, black -1. */
export function forward(side: Side): number {
  return side === 'red' ? 1 : -1;
}
