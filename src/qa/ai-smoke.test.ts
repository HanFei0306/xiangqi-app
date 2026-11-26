/**
 * Human-vs-AI regression smoke test (红线保护).
 *
 * Verifies that adding the standalone position validator did NOT change the
 * AI/move-generation path: EngineImpl still returns legal moves at both
 * beginner and master tiers, and every self-play ply is applicable through
 * the existing rules layer without throwing.
 */

import { describe, it, expect } from 'vitest';
import { createInitialState } from '../engine/board';
import { applyMoveToState, generateLegalMoves } from '../engine/rules';
import type { GameState, Move } from '../engine/types';
import { EngineImpl, defaultConfig } from '../ai/engine';
import type { Difficulty } from '../ai/types';

/** Same from/to squares, independent of notation/captured metadata. */
function sameSquares(a: Move, b: Move): boolean {
  return (
    a.from.col === b.from.col &&
    a.from.row === b.from.row &&
    a.to.col === b.to.col &&
    a.to.row === b.to.row
  );
}

/** Plays `plies` moves from the initial position using EngineImpl for both sides. */
function selfPlay(difficulty: Difficulty, plies: number): GameState {
  const engine = new EngineImpl(() => 0.5); // deterministic rng
  const config = defaultConfig(difficulty);
  let state: GameState = createInitialState('red');
  for (let ply = 0; ply < plies; ply++) {
    const move: Move | null = engine.getBestMove(state, config);
    expect(move, `${difficulty} ply ${ply}: engine returned no move`).not.toBeNull();
    const legal = generateLegalMoves(state.board, state.turn);
    expect(
      legal.some((candidate) => sameSquares(candidate, move!)),
      `${difficulty} ply ${ply}: engine returned an illegal move`,
    ).toBe(true);
    state = applyMoveToState(state, move!);
  }
  expect(state.moveCount).toBe(plies);
  return state;
}

describe('human-vs-AI smoke: AI path unaffected by position validation', () => {
  it('beginner tier self-plays 6 legal plies from the opening position', () => {
    const state = selfPlay('beginner', 6);
    expect(state.history).toHaveLength(6);
    expect(state.history.every((move) => move.notation.length > 0)).toBe(true);
  });

  it('master tier self-plays 2 legal plies from the opening position', () => {
    const state = selfPlay('master', 2);
    expect(state.history).toHaveLength(2);
  });
});
