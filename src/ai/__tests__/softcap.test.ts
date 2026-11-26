/**
 * Soft per-root cap: the async kernel flags the iteration incomplete and the
 * caller keeps the last COMPLETE ranking. Partial scores are observation only.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import {
  createSearchContext,
  rankedMovesAsync,
  type ScoredMove,
} from '../search';

describe('async soft cap', () => {
  it('flags an over-budget iteration incomplete and never touches lastCompleteRanked', async () => {
    const state = createInitialState('red');
    const ctx = createSearchContext(Date.now() + 5000);
    const sentinel: ScoredMove[] = [{
      move: {
        from: { col: 0, row: 0 }, to: { col: 0, row: 1 },
        piece: 'R', captured: null, notation: 'sentinel',
      },
      score: 12345,
    }];
    ctx.lastCompleteRanked = sentinel;

    // v19.8: pruning + the O(1) threat layer made d7 finish inside the cap,
    // which is real progress. Use d9 so the contract is still tested against
    // a genuinely over-budget root instead of a hardcoded speed assumption.
    const partial = await rankedMovesAsync(state, 9, ctx, async () => { /* no frame delay */ });
    expect(ctx.incomplete, 'depth-9 root move must exceed the 300ms soft cap').toBe(true);
    expect(ctx.aborted, 'soft cap is distinct from the overall deadline').toBe(false);
    expect(ctx.partialRanked).toBeDefined();
    expect(partial.length).toBe(ctx.partialRanked!.length);
    expect(ctx.lastCompleteRanked).toBe(sentinel);
    expect(ctx.lastCompleteRanked![0].score).toBe(12345);
  }, 20000);
});
