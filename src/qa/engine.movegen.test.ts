/**
 * QA acceptance tests — move generation (engine/movegen).
 *
 * These tests assert the CORRECT Xiangqi rules. They deliberately avoid the
 * `new Board()` no-arg path (which depends on the missing `initialPiece`
 * export) by passing an explicit grid, so move *geometry* is validated
 * independently of the board-init defect.
 *
 * NOTE: the two elephant "river" tests below are expected to FAIL on the
 * current source — they expose a genuine off-by-one logic bug in
 * `ownHalf` (see QA report). Everything else should pass and proves the
 * geometry engine is correct.
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../engine/board';
import { initialBoardGrid } from '../engine/pieces';
import { generatePieceMoves, generateAllMoves, kingsFacing } from '../engine/movegen';
import type { Piece, Pos } from '../engine/types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

/** Builds a board with only the given pieces (empty otherwise). */
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

function initialBoard(): Board {
  return new Board(initialBoardGrid());
}

describe('Rook (车)', () => {
  it('slides freely until blocked: 17 moves on empty board', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
    ]);
    expect(generatePieceMoves(board, pos(0, 0))).toHaveLength(17);
  });

  it('stops at and can capture the first enemy, but not beyond', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(0, 5), piece: { type: 'P', side: 'black' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(0, 0)));
    expect(t.has('0,5')).toBe(true); // can capture
    expect(t.has('0,6')).toBe(false); // blocked beyond
  });

  it('is blocked by its own piece', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(0, 3), piece: { type: 'P', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(0, 0)));
    expect(t.has('0,3')).toBe(false);
  });
});

describe('Cannon (炮)', () => {
  it('moves like a rook over empty squares when not capturing', () => {
    const board = boardWith([
      { pos: pos(1, 2), piece: { type: 'C', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(1, 2)));
    expect(t.has('1,5')).toBe(true);
    expect(t.has('4,2')).toBe(true);
  });

  it('captures ONLY with exactly one screen', () => {
    const board = boardWith([
      { pos: pos(1, 2), piece: { type: 'C', side: 'red' } },
      { pos: pos(1, 4), piece: { type: 'P', side: 'red' } }, // screen
      { pos: pos(1, 6), piece: { type: 'P', side: 'black' } }, // target
    ]);
    const t = targets(generatePieceMoves(board, pos(1, 2)));
    expect(t.has('1,6')).toBe(true); // capture over the screen
    expect(t.has('1,8')).toBe(false); // nothing beyond, no second capture
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

describe('Horse (马) leg blocking (蹩马腿)', () => {
  it('all 8 moves on empty board', () => {
    const board = boardWith([
      { pos: pos(4, 4), piece: { type: 'N', side: 'red' } },
    ]);
    expect(generatePieceMoves(board, pos(4, 4))).toHaveLength(8);
  });

  it('is blocked by the horse leg', () => {
    const board = boardWith([
      { pos: pos(4, 4), piece: { type: 'N', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } }, // leg for the two "up" moves
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 4)));
    expect(t.has('3,6')).toBe(false); // up-left blocked
    expect(t.has('5,6')).toBe(false); // up-right blocked
    expect(t.has('2,5')).toBe(true); // left-up still open (leg at 3,4 empty)
  });
});

describe('Elephant (相/象) eye blocking and river (逻辑缺陷检查)', () => {
  it('cannot cross the river: red elephant must stay on rows 0..4', () => {
    const board = boardWith([
      { pos: pos(2, 3), piece: { type: 'B', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(2, 3)));
    // From (2,3) the diagonal targets are (0,5),(4,5),(0,1),(4,1).
    // (0,5) and (4,5) lie on row 5 = across the river -> ILLEGAL.
    expect(t.has('0,5')).toBe(false);
    expect(t.has('4,5')).toBe(false);
    // (0,1) and (4,1) are on the red side -> legal.
    expect(t.has('0,1')).toBe(true);
    expect(t.has('4,1')).toBe(true);
  });

  it('black elephant must stay on rows 5..9 (cannot reach row 4)', () => {
    const board = boardWith([
      { pos: pos(6, 6), piece: { type: 'B', side: 'black' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(6, 6)));
    // From (6,6) the diagonal targets are (4,4),(8,4),(4,8),(8,8).
    // (4,4) and (8,4) lie on row 4 = across the river -> ILLEGAL.
    expect(t.has('4,4')).toBe(false);
    expect(t.has('8,4')).toBe(false);
    expect(t.has('4,8')).toBe(true);
    expect(t.has('8,8')).toBe(true);
  });

  it('is blocked by the elephant eye (塞象眼)', () => {
    const board = boardWith([
      { pos: pos(2, 0), piece: { type: 'B', side: 'red' } },
      { pos: pos(1, 1), piece: { type: 'P', side: 'red' } }, // eye for (0,2)
    ]);
    const t = targets(generatePieceMoves(board, pos(2, 0)));
    expect(t.has('0,2')).toBe(false);
    expect(t.has('4,2')).toBe(true);
  });
});

describe('Pawn (兵/卒) river crossing', () => {
  it('red pawn moves only forward before crossing', () => {
    const board = boardWith([
      { pos: pos(4, 3), piece: { type: 'P', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 3)));
    expect(t.has('4,4')).toBe(true);
    expect(t.has('3,3')).toBe(false);
    expect(t.has('5,3')).toBe(false);
  });

  it('red pawn can move sideways after crossing (row >= 5)', () => {
    const board = boardWith([
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 5)));
    expect(t.has('4,6')).toBe(true); // forward
    expect(t.has('3,5')).toBe(true); // sideways
    expect(t.has('5,5')).toBe(true); // sideways
  });

  it('black pawn moves downward (row decreases) and sideways after crossing', () => {
    const board = boardWith([
      { pos: pos(4, 4), piece: { type: 'P', side: 'black' } },
    ]);
    const t = targets(generatePieceMoves(board, pos(4, 4)));
    expect(t.has('4,3')).toBe(true); // forward (down)
    expect(t.has('3,4')).toBe(true); // sideways (already across)
    expect(t.has('5,4')).toBe(true);
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

describe('Flying generals (将帅不可照面)', () => {
  it('detects two kings facing on an open file', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(kingsFacing(board)).toBe(true);
  });

  it('does not report facing when a piece blocks the file', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(kingsFacing(board)).toBe(false);
  });
});

describe('generateAllMoves from the standard start', () => {
  it('red has exactly 44 opening moves (canonical Xiangqi count)', () => {
    const board = initialBoard();
    expect(generateAllMoves(board, 'red').length).toBe(44);
  });

  it('black has the same symmetric count from its start', () => {
    const board = initialBoard();
    expect(generateAllMoves(board, 'black').length).toBe(44);
  });
});
