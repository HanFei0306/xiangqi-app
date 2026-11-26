import { describe, it, expect } from 'vitest';
import { Board, createInitialState } from '../../engine/board';
import { makeMove, applyMoveToState } from '../../engine/rules';
import { evaluateState, material } from '../evaluate';
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

describe('material', () => {
  it('counts piece values from the side perspective', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'R', side: 'black' } },
    ]);
    // Equal material -> 0.
    expect(material(board, 'red')).toBe(0);
    expect(material(board, 'black')).toBe(0);
  });

  it('is positive when the side is ahead', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'N', side: 'black' } },
    ]);
    expect(material(board, 'red')).toBeGreaterThan(0);
    expect(material(board, 'black')).toBeLessThan(0);
  });
});

describe('v2026.11.19.1 evaluation resolution', () => {
  it('prefers the developing 卒七进一 over the premature 砲八进四 by >=30', () => {
    const start = createInitialState('black');
    const advance = (fc: number, fr: number, tc: number, tr: number): number => {
      const move = makeMove(start.board, pos(fc, fr), pos(tc, tr));
      expect(move).not.toBeNull();
      const next = applyMoveToState(start, move!);
      return evaluateState(next, 'black');
    };
    const healthy = advance(6, 6, 6, 5); // 卒七进一
    const reckless = advance(7, 7, 7, 3); // 砲八进四
    expect(healthy).toBeGreaterThan(reckless + 30);
    // Both evaluation levels share the same source and agree on the ranking.
    const healthyLeaf = evaluateState(
      applyMoveToState(start, makeMove(start.board, pos(6, 6), pos(6, 5))!), 'black', 'leaf',
    );
    const recklessLeaf = evaluateState(
      applyMoveToState(start, makeMove(start.board, pos(7, 7), pos(7, 3))!), 'black', 'leaf',
    );
    expect(healthyLeaf).toBeGreaterThan(recklessLeaf + 30);
  });
});

describe('evaluateState', () => {
  it('is antisymmetric between sides', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'R', side: 'black' } },
    ]);
    const s = state(board, 'red');
    expect(evaluateState(s, 'red')).toBeCloseTo(-evaluateState(s, 'black'), 6);
  });

  it('prefers advanced pawns', () => {
    const back = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 3), piece: { type: 'P', side: 'red' } },
    ]);
    const adv = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 7), piece: { type: 'P', side: 'red' } },
    ]);
    const redBack = state(back, 'red');
    const redAdv = state(adv, 'red');
    expect(evaluateState(redAdv, 'red')).toBeGreaterThan(
      evaluateState(redBack, 'red'),
    );
  });

  it('returns a finite number on the opening position', () => {
    const s = state(new Board(), 'red');
    expect(Number.isFinite(evaluateState(s, 'red'))).toBe(true);
  });
});
