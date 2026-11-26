import { describe, it, expect } from 'vitest';
import { Board, createInitialState } from '../board';
import { initialPiece } from '../pieces';
import type { Pos } from '../types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

describe('Board initialization', () => {
  it('places the standard starting position', () => {
    const board = new Board();
    // Red back rank pieces.
    expect(board.getPiece(pos(0, 0))).toEqual({ type: 'R', side: 'red' });
    expect(board.getPiece(pos(4, 0))).toEqual({ type: 'K', side: 'red' });
    expect(board.getPiece(pos(1, 2))).toEqual({ type: 'C', side: 'red' });
    expect(board.getPiece(pos(0, 3))).toEqual({ type: 'P', side: 'red' });
    // Black back rank pieces.
    expect(board.getPiece(pos(8, 9))).toEqual({ type: 'R', side: 'black' });
    expect(board.getPiece(pos(4, 9))).toEqual({ type: 'K', side: 'black' });
    expect(board.getPiece(pos(7, 7))).toEqual({ type: 'C', side: 'black' });
    // Empty center.
    expect(board.getPiece(pos(4, 4))).toBeNull();
  });

  it('initialPiece returns null for empty squares', () => {
    expect(initialPiece(4, 4)).toBeNull();
    expect(initialPiece(0, 1)).toBeNull();
  });
});

describe('Board.clone / setPiece / getPiece', () => {
  it('clone is a deep copy and does not share pieces', () => {
    const board = new Board();
    const copy = board.clone();
    copy.setPiece(pos(0, 0), null);
    expect(board.getPiece(pos(0, 0))).not.toBeNull();
    expect(copy.getPiece(pos(0, 0))).toBeNull();
  });

  it('getPiece returns null out of bounds', () => {
    const board = new Board();
    expect(board.getPiece(pos(-1, 0))).toBeNull();
    expect(board.getPiece(pos(9, 0))).toBeNull();
  });
});

describe('Board.applyMove', () => {
  it('moves a piece and clears the origin', () => {
    const board = new Board();
    const move = {
      from: pos(1, 2),
      to: pos(4, 2),
      piece: 'C' as const,
      captured: null,
      notation: '',
    };
    board.applyMove(move);
    expect(board.getPiece(pos(1, 2))).toBeNull();
    expect(board.getPiece(pos(4, 2))).toEqual({ type: 'C', side: 'red' });
  });

  it('fills notation and captured type', () => {
    const board = new Board();
    // Red cannon from (1,2) captures the black pawn at (1,6), with a red
    // pawn screen at (1,4) so the cannon capture is geometrically valid.
    board.setPiece(pos(1, 4), { type: 'P', side: 'red' });
    board.setPiece(pos(1, 6), { type: 'P', side: 'black' });
    const move = {
      from: pos(1, 2),
      to: pos(1, 6),
      piece: 'C' as const,
      captured: null,
      notation: '',
    };
    board.applyMove(move);
    expect(move.captured).toBe('P');
    // Vertical capture along the file: the cannon is on file 八 (col 1) and
    // advances four ranks, so the notation is 炮八进四.
    expect(move.notation).toBe('炮八进四');
  });
});

describe('Board serialization', () => {
  it('round-trips a board through setup string', () => {
    const board = new Board();
    const setup = board.toNotationSetup();
    const restored = Board.fromSetup(setup);
    expect(restored.toNotationSetup()).toBe(setup);
  });

  it('empty board serializes to empty string', () => {
    const empty = new Board(
      Array.from({ length: 9 }, () => new Array(10).fill(null)),
    );
    expect(empty.toNotationSetup()).toBe('');
    expect(Board.fromSetup('').isEmpty()).toBe(true);
  });
});

describe('createInitialState', () => {
  it('starts with red to move and an empty history', () => {
    const state = createInitialState();
    expect(state.turn).toBe('red');
    expect(state.history).toHaveLength(0);
    expect(state.status).toBe('playing');
  });
});
