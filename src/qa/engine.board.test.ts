/**
 * QA acceptance tests — Board (engine/board): serialization & applyMove.
 *
 * `toNotationSetup` / `fromSetup` do NOT call the missing `initialPiece`,
 * so they are verifiable NOW and must pass.
 *
 * `applyMove` ALWAYS calls `generateNotation`, which needs the missing
 * `PIECE_CHAR` export — so the applyMove assertions below currently FAIL.
 * They document the required (correct) behaviour. Root cause: missing
 * `PIECE_CHAR` in pieces.ts (see QA report).
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../engine/board';
import { initialBoardGrid } from '../engine/pieces';
import type { Pos } from '../engine/types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

function emptyBoard(): Board {
  return new Board(
    Array.from({ length: 9 }, () => new Array(10).fill(null)),
  );
}

describe('Board serialization (no missing-export dependency)', () => {
  it('round-trips the standard start through a setup string', () => {
    const board = new Board(initialBoardGrid());
    const setup = board.toNotationSetup();
    const restored = Board.fromSetup(setup);
    expect(restored.toNotationSetup()).toBe(setup);
  });

  it('empty board serializes to an empty string and parses back empty', () => {
    expect(emptyBoard().toNotationSetup()).toBe('');
    expect(Board.fromSetup('').isEmpty()).toBe(true);
  });

  it('preserves piece identity through a round-trip', () => {
    const b = emptyBoard();
    b.setPiece(pos(4, 0), { type: 'K', side: 'red' });
    const restored = Board.fromSetup(b.toNotationSetup());
    expect(restored.getPiece(pos(4, 0))).toEqual({ type: 'K', side: 'red' });
  });
});

describe('Board.applyMove (requires PIECE_CHAR — currently broken)', () => {
  it('moves a piece, clears the origin, and fills notation + captured type', () => {
    const board = emptyBoard();
    board.setPiece(pos(1, 2), { type: 'C', side: 'red' });
    board.setPiece(pos(1, 4), { type: 'P', side: 'red' }); // screen
    board.setPiece(pos(1, 6), { type: 'P', side: 'black' }); // target
    const move = {
      from: pos(1, 2),
      to: pos(1, 6),
      piece: 'C' as const,
      captured: null,
      notation: '',
    };
    board.applyMove(move);
    expect(board.getPiece(pos(1, 2))).toBeNull();
    expect(board.getPiece(pos(1, 6))).toEqual({ type: 'C', side: 'red' });
    expect(move.captured).toBe('P');
    // Vertical capture along the file: cannon is on file 八 (col 1), advances 4.
    expect(move.notation).toBe('炮八进四');
  });

  it('clone is a deep copy and does not share pieces', () => {
    const board = emptyBoard();
    board.setPiece(pos(0, 0), { type: 'R', side: 'red' });
    const copy = board.clone();
    copy.setPiece(pos(0, 0), null);
    expect(board.getPiece(pos(0, 0))).not.toBeNull();
    expect(copy.getPiece(pos(0, 0))).toBeNull();
  });

  it('getPiece returns null out of bounds', () => {
    const board = emptyBoard();
    expect(board.getPiece(pos(-1, 0))).toBeNull();
    expect(board.getPiece(pos(9, 0))).toBeNull();
  });
});
