/**
 * QA acceptance tests — rules (engine/rules): check, legality, status.
 *
 * Avoids `new Board()` (missing `initialPiece`) by building boards
 * explicitly. `isInCheck` / `kingsFacing` are pure geometry and must
 * pass; `checkStatus` / `isLegalMove` / `generateLegalMoves` route
 * through `applyMove`, so they currently FAIL because `applyMove`
 * calls `generateNotation`, which needs the missing `PIECE_CHAR` export.
 * Those failures are documented in the QA report; the assertions here
 * describe the CORRECT behaviour the engine must satisfy once fixed.
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../engine/board';
import {
  isInCheck,
  isLegalMove,
  generateLegalMoves,
  checkStatus,
} from '../engine/rules';
import type { Piece, Pos } from '../engine/types';

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

  it('detects the flying-general rule (both kings "in check")', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    expect(isInCheck(board, 'red')).toBe(true);
    expect(isInCheck(board, 'black')).toBe(true);
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
    expect(
      isLegalMove(board, {
        from: pos(4, 1),
        to: pos(0, 1),
        piece: 'R',
        captured: null,
        notation: '',
      }),
    ).toBe(false);
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

  it('rejects a move exposing the king to flying generals', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } }, // screen
    ]);
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

  it('reports playing when nothing is wrong', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      // A piece on file 4 between the kings blocks the flying-general rule,
      // so neither side is in check.
      { pos: pos(4, 5), piece: { type: 'P', side: 'red' } },
    ]);
    expect(checkStatus(board, 'red')).toBe('playing');
  });
});
