/**
 * v2026.11.19.7: a soft-capped async iteration must be retried on a narrowed
 * root set instead of discarding the remaining time budget. The retry is still
 * a COMPLETE search over its (smaller) root set, so partial/noise scores are
 * never promoted — that contract stays intact (see softcap.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/board';
import {
  rankedMovesAsync,
  createSearchContext,
  type ScoredMove,
} from '../search';

function keyOf(move: ScoredMove['move']): number {
  return (move.from.col * 10 + move.from.row) * 90 + (move.to.col * 10 + move.to.row);
}

describe('async narrowed-root retry', () => {
  it('rootKeys restricts the search to exactly the requested root moves', async () => {
    const state = createInitialState('red');
    const ctx = createSearchContext(Date.now() + 5000);
    const full = await rankedMovesAsync(state, 2, ctx, async () => {});
    expect(full.length).toBeGreaterThan(2);

    const allowed = new Set(full.slice(0, 3).map((e) => keyOf(e.move)));
    const ctx2 = createSearchContext(Date.now() + 5000);
    const narrowed = await rankedMovesAsync(state, 2, ctx2, async () => {}, -Infinity, Infinity, allowed);
    expect(narrowed.length).toBe(3);
    for (const entry of narrowed) expect(allowed.has(keyOf(entry.move))).toBe(true);
  });

  it('a narrowed complete retry keeps the normal complete-iteration flags', async () => {
    const state = createInitialState('red');
    const ctx = createSearchContext(Date.now() + 5000);
    const full = await rankedMovesAsync(state, 2, ctx, async () => {});
    const allowed = new Set(full.slice(0, 4).map((e) => keyOf(e.move)));
    const ctx2 = createSearchContext(Date.now() + 5000);
    const sentinel: ScoredMove[] = [{
      move: full[0].move, score: 12345,
    }];
    ctx2.lastCompleteRanked = sentinel;
    const narrowed = await rankedMovesAsync(state, 2, ctx2, async () => {}, -Infinity, Infinity, allowed);
    expect(ctx2.incomplete).toBe(false);
    expect(ctx2.aborted).toBe(false);
    // The kernel itself never touches lastCompleteRanked; the engine does only
    // for a complete iteration. A narrowed COMPLETE search is such an iteration.
    expect(narrowed.length).toBe(4);
  });
});
