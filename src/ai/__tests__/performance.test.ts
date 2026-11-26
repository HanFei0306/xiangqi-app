/**
 * Performance guard for the AI search rewrite.
 *
 * Before the rewrite, `getBestMove` at the opening position took ~2.0s
 * (beginner d2), ~8.8s (intermediate d3) and ~2.0s for master d4 (capped at
 * 1500ms). The threshold below is deliberately loose for slow CI machines,
 * but still far below the old numbers while proving the time cap works.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import { EngineImpl, defaultConfig, defaultYield } from '../engine';
import type { Difficulty } from '../types';

const TIERS: Difficulty[] = ['beginner', 'easy', 'intermediate', 'master'];

describe('AI search performance at the opening position', () => {
  it('warms up the module then keeps master within the budget', () => {
    const engine = new EngineImpl(() => 0.5);

    // Warm-up (JIT / module init) with the weakest tier.
    engine.getBestMove(createInitialState('red'), defaultConfig('beginner'));

    const start: number = Date.now();
    const move = engine.getBestMove(createInitialState('red'), defaultConfig('master'));
    const elapsed: number = Date.now() - start;

    expect(move).not.toBeNull();
    const legal = generateLegalMoves(createInitialState('red').board, 'red');
    expect(
      legal.some(
        (m) =>
          m.from.col === move!.from.col &&
          m.from.row === move!.from.row &&
          m.to.col === move!.to.col &&
          m.to.row === move!.to.row,
      ),
    ).toBe(true);
    // Local measurement is ~110ms; 1500ms leaves a wide CI margin and is
    // still below the old ~2.0s master cost.
    expect(elapsed).toBeLessThan(1500);
  });

  it('every tier keeps a strict per-move budget', () => {
    const engine = new EngineImpl(() => 0.5);
    for (const tier of TIERS) {
      const cfg = defaultConfig(tier);
      const start: number = Date.now();
      const move = engine.getBestMove(createInitialState('red'), cfg);
      const elapsed: number = Date.now() - start;
      expect(move, `${tier} produced no move`).not.toBeNull();
      expect(elapsed, `${tier} took ${elapsed}ms`).toBeLessThan(1500);
    }
  });

  it('async slice-yielding search yields to the event loop and returns a legal move', async () => {
    const engine = new EngineImpl(() => 0.5);
    let yields = 0;
    const countedYield = async () => { yields += 1; await defaultYield(); };
    // Force an off-book move (兵九进一): a book hit returns instantly and
    // would bypass the yielding search entirely in this regression test.
    const { applyMoveToState, makeMove } = await import('../../engine/rules');
    let state = createInitialState('red');
    const first = makeMove(state.board, { col: 0, row: 3 }, { col: 0, row: 4 })!;
    state = applyMoveToState(state, first);
    // Depth 5 keeps the first root move below the 300ms soft cap so the test
    // actually observes yields between root candidates.
    const cfg = { ...defaultConfig('master'), depth: 5 };
    const move = await engine.getBestMoveAsync(state, cfg, countedYield);
    expect(move).not.toBeNull();
    expect(yields).toBeGreaterThan(0); // proves the UI gets rendering slots
    const legal = generateLegalMoves(state.board, state.turn);
    expect(legal.some((m) => m.from.col === move!.from.col && m.from.row === move!.from.row &&
      m.to.col === move!.to.col && m.to.row === move!.to.row)).toBe(true);
  });

  it('async search iterates deeper than a single ply (no depth-1 regression)', async () => {
    // Regression guard: an earlier refactor left the async (match) path at a
    // single depth, so the app played far weaker than its sync counterpart.
    const engine = new EngineImpl(() => 0.5);
    const { applyMoveToState, makeMove } = await import('../../engine/rules');
    let state = createInitialState('red');
    const first = makeMove(state.board, { col: 0, row: 3 }, { col: 0, row: 4 })!;
    state = applyMoveToState(state, first); // leave the opening book
    const t = Date.now();
    const move = await engine.getBestMoveAsync(
      state, { ...defaultConfig('master'), depth: 5 },
    );
    const elapsed = Date.now() - t;
    expect(move).not.toBeNull();
    // A depth-1-only implementation returns in a few ms; deep iterative
    // deepening must consume meaningful time on later iterations.
    expect(elapsed, `async search finished in ${elapsed}ms (stuck at depth 1?)`).toBeGreaterThan(60);
  });
});
