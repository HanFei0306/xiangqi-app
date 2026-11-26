import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import { analyzeGameForLessons, getLessonStats, resetLessons } from '../selfReview';

describe('赛后自我复盘', () => {
  beforeEach(() => resetLessons());

  it('reviewing a short game is safe and reads back through lesson stats', () => {
    let game = createInitialState('red');
    const first = makeMove(game.board, { col: 0, row: 3 }, { col: 0, row: 4 })!;
    game = applyMoveToState(game, first);
    const result = analyzeGameForLessons(game, 'red');
    expect(Array.isArray(result.lessons)).toBe(true);
    const stats = getLessonStats();
    expect(stats.blunders + stats.missedMates + stats.good).toBeGreaterThanOrEqual(0);
  });

  it('an empty history produces no lessons', () => {
    const result = analyzeGameForLessons(createInitialState('red'), 'red');
    expect(result.lessons).toHaveLength(0);
  });
});
