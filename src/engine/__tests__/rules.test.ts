import { describe, it, expect } from 'vitest';
import { Board } from '../board';
import { isInCheck, isLegalMove, generateLegalMoves, checkStatus } from '../rules';
import type { GameState, Piece, Pos, Side } from '../types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

function boardWith(pieces: Array<{ pos: Pos; piece: Piece }>): Board {
  const board = new Board(
    Array.from({ length: 9 }, () => new Array(10).fill(null)),
  );
  for (const { pos: p, piece } of pieces) {
    board.setPiece(p, piece);
  }
  return board;
}

describe('isInCheck', () => {
  it('detects a rook check', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'R', side: 'black' } },
    ]);
    expect(isInCheck(board, 'red')).toBe(true);
    expect(isInCheck(board, 'black')).toBe(false);
  });

  it('detects the flying-general rule (via the enemy-K ray, not a side-agnostic fallback)', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    // Both sides are genuinely in check on an open shared file: each king's
    // ray scan finds the enemy K as its first attacker. This is now derived
    // from `side` inside squareAttackedBy, not from a global kingsFacing()
    // shortcut that returned true for either side regardless of who is asked.
    expect(isInCheck(board, 'red')).toBe(true);
    expect(isInCheck(board, 'black')).toBe(true);
  });

  it('reports NO check in an ordinary position with no attacking pieces', () => {
    // Kings on different files, nothing else on the board: neither side is
    // attacked. This is the regression guard against "无将军误报将军".
    const board = boardWith([
      { pos: pos(3, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(5, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(board, 'red')).toBe(false);
    expect(isInCheck(board, 'black')).toBe(false);
  });

  it('still reports check for real rook / knight / cannon / pawn attacks', () => {
    // Removing the flying-general fallback must not weaken genuine checks.
    const rook = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(rook, 'red')).toBe(true);
    expect(isInCheck(rook, 'black')).toBe(false);

    const knight = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 2), piece: { type: 'N', side: 'black' } }, // leg (3,1) is free
      { pos: pos(5, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(knight, 'red')).toBe(true);
    expect(isInCheck(knight, 'black')).toBe(false);

    const cannon = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'P', side: 'red' } }, // screen
      { pos: pos(4, 5), piece: { type: 'C', side: 'black' } },
      { pos: pos(5, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(cannon, 'red')).toBe(true);
    expect(isInCheck(cannon, 'black')).toBe(false);

    const pawn = boardWith([
      { pos: pos(4, 2), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'P', side: 'black' } }, // advances downward
      { pos: pos(5, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(pawn, 'red')).toBe(true);
    expect(isInCheck(pawn, 'black')).toBe(false);
  });

  it('does NOT report check when a piece blocks the kings', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(board, 'red')).toBe(false);
    expect(isInCheck(board, 'black')).toBe(false);
  });
});

describe('isLegalMove', () => {
  it('rejects a move that leaves the king in check (pinned piece)', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 1), piece: { type: 'R', side: 'red' } }, // pinned vertically
      { pos: pos(4, 9), piece: { type: 'R', side: 'black' } },
    ]);
    // Rook at (4,1) cannot leave the file or the king is exposed.
    expect(
      isLegalMove(board, {
        from: pos(4, 1),
        to: pos(0, 1),
        piece: 'R',
        captured: null,
        notation: '',
      }),
    ).toBe(false);
    // Moving along the file is legal.
    expect(
      isLegalMove(board, {
        from: pos(4, 1),
        to: pos(4, 3),
        piece: 'R',
        captured: null,
        notation: '',
      }),
    ).toBe(true);
  });

  it('rejects moves that would expose the king to flying generals', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } }, // screen
    ]);
    // Moving the screen away exposes flying generals -> illegal.
    expect(
      isLegalMove(board, {
        from: pos(4, 5),
        to: pos(3, 5),
        piece: 'P',
        captured: null,
        notation: '',
      }),
    ).toBe(false);
  });
});

describe('checkStatus', () => {
  it('reports checkmate with two rooks', () => {
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } }, // file 4
      { pos: pos(0, 9), piece: { type: 'R', side: 'red' } }, // rank 9
    ]);
    expect(checkStatus(board, 'black')).toBe('checkmate');
    expect(generateLegalMoves(board, 'black')).toHaveLength(0);
  });

  it('reports stalemate (困毙) when no moves but not in check', () => {
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(3, 8), piece: { type: 'R', side: 'red' } },
      { pos: pos(5, 8), piece: { type: 'R', side: 'red' } },
    ]);
    expect(isInCheck(board, 'black')).toBe(false);
    expect(generateLegalMoves(board, 'black')).toHaveLength(0);
    expect(checkStatus(board, 'black')).toBe('stalemate');
  });

  it('reports check when the king is attacked but has an escape', () => {
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
    ]);
    expect(checkStatus(board, 'black')).toBe('check');
    expect(generateLegalMoves(board, 'black').length).toBeGreaterThan(0);
  });
});

describe('game status integration', () => {
  it('a fresh game is playing for red with no check', () => {
    const board = new Board();
    const state: GameState = {
      board,
      turn: 'red',
      history: [],
      status: 'playing',
      moveCount: 0,
    };
    expect(checkStatus(board, 'red')).toBe('playing');
    void (state as GameState);
    void ('red' as Side);
  });
});
