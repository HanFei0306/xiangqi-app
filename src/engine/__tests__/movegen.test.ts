import { describe, it, expect } from 'vitest';
import { Board } from '../board';
import { generatePieceMoves, generateAllMoves } from '../movegen';
import type { Piece, Pos } from '../types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

/** Builds a board with only the given pieces. */
function boardWith(pieces: Array<{ pos: Pos; piece: Piece }>): Board {
  const board = new Board(
    Array.from({ length: 9 }, () => new Array(10).fill(null)),
  );
  for (const { pos: p, piece } of pieces) {
    board.setPiece(p, piece);
  }
  return board;
}

/** Returns the set of "col,row" target strings for given moves. */
function targets(moves: Array<{ to: Pos }>): Set<string> {
  return new Set(moves.map((m) => `${m.to.col},${m.to.row}`));
}

describe('Rook (车) moves', () => {
  it('slides freely until blocked', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
    ]);
    const out = generatePieceMoves(board, pos(0, 0));
    expect(out).toHaveLength(17); // 8 horizontal + 9 vertical on empty board
  });

  it('stops at and can capture the first enemy', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(0, 5), piece: { type: 'P', side: 'black' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(0, 0)));
    expect(t.has('0,5')).toBe(true); // can capture
    expect(t.has('0,6')).toBe(false); // blocked beyond
  });
});

describe('Cannon (炮) moves', () => {
  it('moves like a rook when not capturing', () => {
    const board = boardWith([
      { pos: pos(1, 2), piece: { type: 'C', side: 'red' } },
    ]);
    const out = generatePieceMoves(board, pos(1, 2));
    // No screen on file/rank -> behaves like rook over empty squares.
    expect(out.length).toBeGreaterThan(0);
    expect(targets(out).has('1,5')).toBe(true);
  });

  it('captures only with exactly one screen', () => {
    const board = boardWith([
      { pos: pos(1, 2), piece: { type: 'C', side: 'red' } },
      { pos: pos(1, 4), piece: { type: 'P', side: 'red' } }, // screen
      { pos: pos(1, 6), piece: { type: 'P', side: 'black' } }, // target
    ]);
    const t = targets(generatePieceMoves(board, pos(1, 2)));
    expect(t.has('1,6')).toBe(true); // capture over the screen
    expect(t.has('1,8')).toBe(false); // nothing beyond, and no second capture
  });

  it('does NOT capture without a screen', () => {
    const board = boardWith([
      { pos: pos(1, 2), piece: { type: 'C', side: 'red' } },
      { pos: pos(1, 6), piece: { type: 'P', side: 'black' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(1, 2)));
    expect(t.has('1,6')).toBe(false);
  });
});

describe('Horse (马) leg blocking', () => {
  it('all 8 moves on empty board', () => {
    const board = boardWith([
      { pos: pos(4, 4), piece: { type: 'N', side: 'red' } },
    ]);
    expect(generatePieceMoves(board, pos(4, 4))).toHaveLength(8);
  });

  it('is blocked by the horse leg (蹩马腿)', () => {
    const board = boardWith([
      { pos: pos(4, 4), piece: { type: 'N', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } }, // leg for up moves
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 4)));
    expect(t.has('3,6')).toBe(false); // up-left blocked
    expect(t.has('5,6')).toBe(false); // up-right blocked
    expect(t.has('2,5')).toBe(true); // left-up still open (leg at 3,4 empty)
  });
});

describe('Elephant (相) eye blocking and river', () => {
  it('cannot cross the river', () => {
    const board = boardWith([
      { pos: pos(2, 0), piece: { type: 'B', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(2, 0)));
    expect(t.has('0,2')).toBe(true);
    expect(t.has('4,2')).toBe(true);
    // Moving to row 4 is the river line; row >= 5 would cross -> not allowed.
    expect([...t].some((s) => Number(s.split(',')[1]) >= 5)).toBe(false);
  });

  it('is blocked by the elephant eye (塞象眼)', () => {
    const board = boardWith([
      { pos: pos(2, 0), piece: { type: 'B', side: 'red' } },
      { pos: pos(1, 1), piece: { type: 'P', side: 'red' } }, // eye for (0,2)
    ]);
    const t = targets(generatePieceMoves(board, pos(2, 0)));
    expect(t.has('0,2')).toBe(false);
  });
});

describe('Pawn (兵) river crossing', () => {
  it('moves only forward before crossing', () => {
    const board = boardWith([
      { pos: pos(4, 3), piece: { type: 'P', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 3)));
    expect(t.has('4,4')).toBe(true);
    expect(t.has('3,3')).toBe(false);
    expect(t.has('5,3')).toBe(false);
  });

  it('can move sideways after crossing', () => {
    const board = boardWith([
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 5)));
    expect(t.has('4,6')).toBe(true); // forward
    expect(t.has('3,5')).toBe(true); // sideways
    expect(t.has('5,5')).toBe(true); // sideways
  });
});

describe('King (将) and Advisor (士) palace', () => {
  it('king stays inside the palace', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
    ]);
    const out = generatePieceMoves(board, pos(4, 0));
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) {
      expect(m.to.col).toBeGreaterThanOrEqual(3);
      expect(m.to.col).toBeLessThanOrEqual(5);
      expect(m.to.row).toBeLessThanOrEqual(2);
    }
  });

  it('advisor stays on diagonal within palace', () => {
    const board = boardWith([
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
    ]);
    const out = generatePieceMoves(board, pos(3, 0));
    expect(out).toHaveLength(1); // only (4,1)
    expect(out[0].to).toEqual(pos(4, 1));
  });
});

describe('generateAllMoves', () => {
  it('produces 44 moves from the starting position for red', () => {
    const board = new Board();
    // Red has 44 legal-geometry moves at the opening (verified standard count).
    expect(generateAllMoves(board, 'red').length).toBe(44);
  });
});
