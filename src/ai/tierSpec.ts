/**
 * 四档棋力的只读契约（v2026.11.23.2）。
 *
 * 只固化既有档位参数，绝不复制第二份数值：label 来自 UI 唯一来源，
 * 深度 / 随机 / 失误率来自 engine.defaultConfig，预算来自 engine.budgetForDifficulty。
 * 原生搜索计划仍从 nativeEngine.searchPlanForDifficulty 读取，供校验使用。
 */
import { budgetForDifficulty, defaultConfig } from './engine';
import { searchPlanForDifficulty } from './nativeEngine';
import type { Difficulty } from './types';
import { DIFFICULTY_LABELS } from '../ui/difficultyLabels';

/** 从现有引擎参数推导出的档位期望值（不是可执行的第二份配置）。 */
export interface TierExpected {
  depth: number;
  randomness: number;
  mistakeRate: number;
  budgetMs: number;
}

/** 单个档位对外展示与校验用的规格。 */
export interface TierSpec {
  key: Difficulty;
  /** 与 DIFFICULTY_LABELS 同源的历史显示名（easy=中级、intermediate=高级）。 */
  label: string;
  strengthPct: 25 | 50 | 75 | 100;
  badge: string;
  tooltip: string;
  expected: TierExpected;
}

interface TierSeed {
  strengthPct: TierSpec['strengthPct'];
  badge?: string;
}

const SEEDS: Record<Difficulty, TierSeed> = {
  beginner: { strengthPct: 25 },
  easy: { strengthPct: 50 },
  intermediate: { strengthPct: 75 },
  master: { strengthPct: 100, badge: '100% 全力' },
};

function specOf(difficulty: Difficulty): TierSpec {
  const seed: TierSeed = SEEDS[difficulty] ?? SEEDS.intermediate;
  const cfg = defaultConfig(difficulty);
  return {
    key: difficulty,
    label: DIFFICULTY_LABELS[difficulty],
    strengthPct: seed.strengthPct,
    badge: seed.badge ?? `${seed.strengthPct}%`,
    tooltip: '依据自对弈标定，详见档位标定报告',
    expected: {
      depth: cfg.depth,
      randomness: cfg.randomness,
      mistakeRate: cfg.mistakeRate,
      budgetMs: budgetForDifficulty(difficulty),
    },
  };
}

/** 四档规格表，顺序 beginner→master，与 DIFFICULTIES 一致。 */
export const TIER_SPECS: readonly TierSpec[] = [
  specOf('beginner'),
  specOf('easy'),
  specOf('intermediate'),
  specOf('master'),
];

/** 非法档位回退到高级档，保持既有引擎的容错语义。 */
export function tierSpecOf(difficulty: Difficulty): TierSpec {
  return TIER_SPECS.find((spec) => spec.key === difficulty) ?? TIER_SPECS[2];
}

/** 原生侧权威搜索计划（只读），供档位报告与校验使用。 */
export function tierNativePlanOf(difficulty: Difficulty): { depth: number; movetime: number } {
  return searchPlanForDifficulty(difficulty);
}
