import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { applyMoveToState } from '../../engine/rules';
import { match } from '../tactics';
import type { GameState, Piece, Pos, Side } from '../../engine/types';

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

function state(board: Board, turn: Side): GameState {
  return { board, turn, history: [], status: 'playing', moveCount: 0 };
}

function move(from: Pos, to: Pos, piece: Piece['type']): GameState['history'][number] {
  return { from, to, piece, captured: null, notation: '' };
}

describe('tactics.match', () => {
  it('detects a check', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 2), piece: { type: 'R', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    // Red rook slides up the file to (4,7), giving check to the black king at
    // (4,9) along file 4 (the rook is two squares away, so it is not hanging).
    const m = move(pos(4, 2), pos(4, 7), 'R');
    const before = state(board, 'red');
    const after = applyMoveToState(before, m);
    expect(after.status).toBe('check');
    expect(match(before, m)?.kind).toBe('check');
  });

  it('detects a fork (one piece attacks two enemies)', () => {
    const board = boardWith([
      { pos: pos(8, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 6), piece: { type: 'N', side: 'red' } },
      { pos: pos(7, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(6, 9), piece: { type: 'R', side: 'black' } },
      { pos: pos(4, 9), piece: { type: 'R', side: 'black' } },
    ]);
    // Knight to (5,7) attacks both black rooks at (4,9) and (6,9).
    const m = move(pos(3, 6), pos(5, 7), 'N');
    const before = state(board, 'red');
    const res = match(before, m);
    expect(res?.kind).toBe('fork');
  });

  it('detects a blunder (a hanging valuable piece)', () => {
    const board = boardWith([
      { pos: pos(8, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(7, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 9), piece: { type: 'R', side: 'black' } },
    ]);
    // Red rook moves to (0,0), where the black rook on file 0 captures it.
    const m = move(pos(4, 0), pos(0, 0), 'R');
    const before = state(board, 'red');
    expect(match(before, m)?.kind).toBe('blunder');
  });

  it('returns null for a quiet, safe move', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(1, 2), piece: { type: 'C', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 7), piece: { type: 'C', side: 'black' } },
    ]);
    const m = move(pos(1, 2), pos(1, 3), 'C');
    const before = state(board, 'red');
    expect(match(before, m)).toBeNull();
  });
});
