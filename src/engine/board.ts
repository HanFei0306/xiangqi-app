/**
 * Board representation for Xiangqi.
 *
 * The board is stored as a 9 (col) x 10 (row) grid of `Piece | null`.
 * Column 0 is the left-most file from the viewer's perspective, row 0 is the
 * red back rank, row 9 is the black back rank.
 *
 * This module is pure TypeScript and has no UI dependencies.
 */

import type { GameState, Move, Piece, PieceType, Pos, Side } from './types';
import {
  BOARD_COLS,
  BOARD_ROWS,
  inBounds,
  opponent,
} from './types';
import { initialPiece, CHAR_TO_PIECE } from './pieces';
import { generateNotation } from './notation';

/**
 * Concrete board implementation. Implements `BoardInterface` re-exported from
 * types so that `GameState.board` can be typed against the interface.
 */
export class Board {
  /** grid[col][row] -> Piece | null. */
  private grid: Array<Array<Piece | null>>;

  constructor(grid?: Array<Array<Piece | null>>) {
    if (grid) {
      // Deep-copy the provided grid so callers keep their own instance.
      this.grid = grid.map((column) => column.map((cell) => (cell ? { ...cell } : null)));
    } else {
      this.grid = Board.emptyGrid();
      for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
          this.grid[col][row] = initialPiece(col, row);
        }
      }
    }
  }

  /** Builds an empty 9x10 grid. */
  private static emptyGrid(): Array<Array<Piece | null>> {
    const grid: Array<Array<Piece | null>> = [];
    for (let col = 0; col < BOARD_COLS; col++) {
      grid.push(new Array<Piece | null>(BOARD_ROWS).fill(null));
    }
    return grid;
  }

  /** Returns a deep copy of this board. */
  clone(): Board {
    return new Board(this.grid);
  }

  /** Returns the piece at a position, or null when empty / out of bounds. */
  getPiece(p: Pos): Piece | null {
    if (!inBounds(p.col, p.row)) {
      return null;
    }
    const cell = this.grid[p.col][p.row];
    return cell ? { ...cell } : null;
  }

  /** Places (or clears, when piece is null) a piece at a position. */
  setPiece(p: Pos, piece: Piece | null): void {
    if (!inBounds(p.col, p.row)) {
      return;
    }
    this.grid[p.col][p.row] = piece ? { ...piece } : null;
  }

  /**
   * Applies a move in place: moves the piece, captures any target, and fills
   * `move.notation` with the Chinese notation string. The move object is
   * mutated (notation assigned) and also returned for convenience.
   */
  applyMove(move: Move): Move {
    const piece = this.getPiece(move.from);
    if (piece === null) {
      throw new Error(
        `applyMove: no piece at from (${move.from.col},${move.from.row})`,
      );
    }
    const target = this.getPiece(move.to);
    move.captured = target ? target.type : null;
    move.piece = piece.type;
    // Move the piece.
    this.setPiece(move.to, piece);
    this.setPiece(move.from, null);
    // Fill notation now that captured info is known.
    move.notation = generateNotation(this, move, piece.side);
    return move;
  }

  /**
   * Serializes the board into a compact, deterministic setup string used by
   * the puzzle database and for persistence. Format:
   *   `col,row,type,side;` repeated for every occupied square, sorted by
   *   (col asc, row asc). Empty board serializes to an empty string.
   */
  toNotationSetup(): string {
    const parts: string[] = [];
    for (let col = 0; col < BOARD_COLS; col++) {
      for (let row = 0; row < BOARD_ROWS; row++) {
        const piece = this.grid[col][row];
        if (piece) {
          parts.push(`${col},${row},${piece.type},${piece.side}`);
        }
      }
    }
    return parts.join(';');
  }

  /** Whether the board has no pieces. */
  isEmpty(): boolean {
    for (let col = 0; col < BOARD_COLS; col++) {
      for (let row = 0; row < BOARD_ROWS; row++) {
        if (this.grid[col][row]) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Parses a FEN-like notation setup string into a Board.
   *
   * Format: 10 rows separated by '/', each row a comma-separated list of 9
   * cells where '.' means empty and any other token is a piece setup character
   * (see `CHAR_TO_PIECE`). Row 0 is the first segment (red back rank), row 9
   * the last. This is the format used by the puzzle library and the game store.
   */
  static fromNotationSetup(setup: string): Board {
    const board = new Board(Board.emptyGrid());
    if (setup.trim().length === 0) {
      return board;
    }
    const rows = setup.split('/');
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].split(',');
      for (let c = 0; c < cells.length; c++) {
        const ch = cells[c].trim();
        if (ch === '' || ch === '.') {
          continue;
        }
        const info = CHAR_TO_PIECE[ch];
        if (!info) {
          continue;
        }
        board.grid[c][r] = { type: info.type, side: info.side };
      }
    }
    return board;
  }

  /**
   * Parses a setup string produced by `toNotationSetup` back into a Board.
   * Throws when the string is malformed.
   */
  static fromSetup(setup: string): Board {
    const board = new Board(Board.emptyGrid());
    if (setup.trim().length === 0) {
      return board;
    }
    const parts = setup.split(';');
    for (const part of parts) {
      if (part.length === 0) {
        continue;
      }
      const [colStr, rowStr, typeStr, sideStr] = part.split(',');
      const col = Number(colStr);
      const row = Number(rowStr);
      const type = typeStr as PieceType;
      const side = sideStr as Side;
      if (!inBounds(col, row)) {
        throw new Error(`fromSetup: out of bounds square ${part}`);
      }
      board.grid[col][row] = { type, side };
    }
    return board;
  }
}

/**
 * Convenience factory: builds a fresh starting-position GameState for the
 * given side to move (defaults to red).
 */
export function createInitialState(turn: Side = 'red'): GameState {
  return {
    board: new Board(),
    turn,
    history: [],
    status: 'playing',
    moveCount: 0,
  };
}

/** Returns the side to move after the given state. */
export function nextTurn(state: GameState): Side {
  return opponent(state.turn);
}

/**
 * Module-level helper that parses a FEN-like notation setup string into a
 * Board. This is the function form of {@link Board.fromNotationSetup}, used by
 * callers (e.g. the game store) that prefer a plain function over the static
 * method.
 */
export function parseSetup(setup: string): Board {
  return Board.fromNotationSetup(setup);
}
