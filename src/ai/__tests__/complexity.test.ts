import { describe, it, expect } from 'vitest';
import { Board, createInitialState } from '../../engine/board';
import { makeMove } from '../../engine/rules';
import { complexityFactor } from '../engine';

describe('complexity-driven time allocation', () => {
  it('gives a full-piece middlegame more budget than the opening', () => {
    const state = createInitialState('red');
    const opening = complexityFactor(state);
    const sample = makeMove(state.board, { col: 0, row: 3 }, { col: 0, row: 4 })!;
    // Complexity only reads board piece count + history length, so a history
    // proxy is enough for this unit test (no need to replay 10 real plies).
    const middlegame = { ...state, history: Array(10).fill(sample) };
    expect(opening).toBe(1.08);
    expect(complexityFactor(middlegame)).toBe(1.18);
  });

  it('spends much less time in a bare endgame', () => {
    const setup = [
      '.,.,.,.,K,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,.,.,.,.,.',
      '.,.,.,.,k,.,.,R,.',
    ].join('/');
    const board = Board.fromNotationSetup(setup);
    expect(complexityFactor({ board, turn: 'red', history: [], status: 'playing', moveCount: 0 }))
      .toBe(0.72);
  });
});
