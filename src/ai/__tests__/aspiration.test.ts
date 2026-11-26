/**
 * v1.13 search enhancements: aspiration windows and quiescence check
 * extension must not change the actual move choice or break antisymmetry.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { GameState } from '../../engine/types';
import { Search, rankedMoves, alphabeta } from '../search';

/** One quiet pawn push out of the book so the real search runs. */
function midgame(): GameState {
  const state = createInitialState('red');
  const move = makeMove(state.board, { col: 0, row: 3 }, { col: 0, row: 4 });
  if (!move) throw new Error('illegal test move');
  return applyMoveToState(state, move);
}

describe('v1.13 aspiration window', () => {
  const state = midgame();

  it('an explicit full window is identical to the default call', () => {
    const a = rankedMoves(state, 2);
    const b = rankedMoves(state, 2, Search.createSearchContext(), -Infinity, Infinity);
    expect(b.map((r) => r.move.notation)).toEqual(a.map((r) => r.move.notation));
    expect(b.map((r) => r.score)).toEqual(a.map((r) => r.score));
  });

  it('a window around the true score keeps the same best move', () => {
    const reference = rankedMoves(state, 2);
    const centre = reference[0].score;
    const narrow = rankedMoves(
      state, 2, Search.createSearchContext(), centre - 20, centre + 20,
    );
    expect(narrow[0].move.notation).toBe(reference[0].move.notation);
    expect(narrow[0].score).toBeGreaterThan(centre - 20);
    expect(narrow[0].score).toBeLessThan(centre + 20);
  });

  it('a fail-high window is detectable and the full re-search recovers the move', () => {
    const reference = rankedMoves(state, 2);
    const centre = reference[0].score;
    const beta = centre - 1; // deliberately below the true best score
    const narrow = rankedMoves(state, 2, Search.createSearchContext(), centre - 100, beta);
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow[0].score).toBeGreaterThanOrEqual(beta); // fail-high signal

    const full = rankedMoves(state, 2, Search.createSearchContext());
    expect(full[0].move.notation).toBe(reference[0].move.notation);
  });
});

describe('v1.13 quiescence check extension', () => {
  it('keeps negamax scores finite and antisymmetric on a real position', () => {
    const state = midgame();
    const red: number = alphabeta(state, 3, -Infinity, Infinity, 'red');
    const black: number = alphabeta(state, 3, -Infinity, Infinity, 'black');
    expect(Number.isFinite(red)).toBe(true);
    expect(red).toBeCloseTo(-black, 5);
  });
});
