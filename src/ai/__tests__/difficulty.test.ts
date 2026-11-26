/** Four-tier difficulty contract: presets, legal moves and config defaults. */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import type { Move } from '../../engine/types';
import { EngineImpl, budgetForDifficulty, defaultConfig } from '../engine';
import { nativeTimeoutMs, searchPlanForDifficulty } from '../nativeEngine';
import { TIER_SPECS, tierNativePlanOf, tierSpecOf } from '../tierSpec';
import { DIFFICULTIES, isDifficulty, type Difficulty } from '../types';

function sameSquares(a: Move, b: Move): boolean {
  return (
    a.from.col === b.from.col &&
    a.from.row === b.from.row &&
    a.to.col === b.to.col &&
    a.to.row === b.to.row
  );
}

describe('four difficulty tiers', () => {
  it('exposes exactly four tiers in ascending order', () => {
    expect(DIFFICULTIES).toEqual(['beginner', 'easy', 'intermediate', 'master']);
    expect(DIFFICULTIES).toHaveLength(4);
    expect(isDifficulty('easy')).toBe(true);
    expect(isDifficulty('superhard')).toBe(false);
    expect(isDifficulty(null)).toBe(false);
  });

  it('defaultConfig resolves all four presets with increasing depth', () => {
    const depths = DIFFICULTIES.map((d) => defaultConfig(d).depth);
    expect(depths).toHaveLength(4);
    for (let i = 1; i < depths.length; i++) {
      expect(depths[i]).toBeGreaterThan(depths[i - 1]);
    }
    for (const difficulty of DIFFICULTIES) {
      const cfg = defaultConfig(difficulty);
      expect(cfg.difficulty).toBe(difficulty);
      expect(cfg.depth).toBeGreaterThan(0);
      expect(cfg.randomness).toBeGreaterThanOrEqual(0);
      expect(cfg.mistakeRate).toBeGreaterThanOrEqual(0);
    }
  });

  it('tier specs expose 25/50/75/100% and master is labelled full strength', () => {
    expect(TIER_SPECS).toHaveLength(4);
    expect(TIER_SPECS.map((s) => s.key)).toEqual([...DIFFICULTIES]);
    expect(TIER_SPECS.map((s) => s.strengthPct)).toEqual([25, 50, 75, 100]);
    expect(TIER_SPECS.map((s) => s.label)).toEqual(['初级', '中级', '高级', '大师']);
    expect(tierSpecOf('master').badge).toBe('100% 全力');
    expect(tierSpecOf('master').tooltip).toBe('依据自对弈标定，详见档位标定报告');
    for (const difficulty of DIFFICULTIES) {
      const spec = tierSpecOf(difficulty);
      expect(spec.expected.depth).toBe(defaultConfig(difficulty).depth);
      expect(spec.expected.randomness).toBe(defaultConfig(difficulty).randomness);
      expect(spec.expected.mistakeRate).toBe(defaultConfig(difficulty).mistakeRate);
      expect(spec.expected.budgetMs).toBe(budgetForDifficulty(difficulty));
      const plan = searchPlanForDifficulty(difficulty);
      expect(tierNativePlanOf(difficulty).depth).toBe(plan.depth);
      expect(tierNativePlanOf(difficulty).movetime).toBe(plan.movetime);
    }
  });

  it('master is full strength with no handicap dials; 4s is the agreed fast exception, depth stays max', () => {
    const master = defaultConfig('master');
    expect(master.randomness).toBe(0);
    expect(master.mistakeRate).toBe(0);
    expect(master.fastMode).toBeFalsy();
    // v2026.11.23.5: 用户要求大师档 4 秒内响应。高级档 6s/6.5s 保持不变，
    // 因此「预算随时长单调」的唯一例外就是大师档；深度上限仍保持单调最大。
    expect(budgetForDifficulty('master')).toBe(4000);
    expect(tierSpecOf('master').expected.budgetMs).toBe(4000);
    expect(searchPlanForDifficulty('master').movetime).toBe(4000);
    expect(searchPlanForDifficulty('master').movetime)
      .toBeLessThan(searchPlanForDifficulty('intermediate').movetime);
    expect(searchPlanForDifficulty('master').depth).toBe(Math.max(...DIFFICULTIES.map(
      (d) => searchPlanForDifficulty(d).depth,
    )));
    // 超时兜底公式仍在：budget + 6000ms，且至少 8000ms。
    expect(nativeTimeoutMs(searchPlanForDifficulty('master').movetime)).toBe(10000);
    expect(nativeTimeoutMs(undefined)).toBe(22000);
    expect(nativeTimeoutMs(100)).toBe(8000);
  });

  it('each tier returns a legal opening move', () => {
    const engine = new EngineImpl(() => 0.5);
    for (const difficulty of DIFFICULTIES as Difficulty[]) {
      const state = createInitialState('red');
      const move = engine.getBestMove(state, defaultConfig(difficulty));
      expect(move, `${difficulty} returned null`).not.toBeNull();
      const legal = generateLegalMoves(state.board, state.turn);
      expect(
        legal.some((candidate) => sameSquares(candidate, move!)),
        `${difficulty} returned an illegal move`,
      ).toBe(true);
    }
  });
});
