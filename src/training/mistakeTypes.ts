/**
 * 失误讲解系统的公共契约（v2026.11.23.2）。
 *
 * 纯类型 + 纯函数：不依赖 React、不联网、不触碰对局中的 AI 走子。
 * 分级口径为 WPL（胜率百分点损失），并带"痛失好局"特例与大优封顶。
 */
import type { GameState, Move, Side } from '../engine/types';

/** 六级失误评级（由好到坏）：5 档 WPL + Miss 覆盖档。 */
export type MistakeGrade =
  | 'good'
  | 'fair'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'
  | 'missed-win';

/** 八类棋理类型（规则层与文案层共用唯一来源）。 */
export type MistakeType = 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8';

/** 评级严重度，数字越大越严重。 */
export const MISTAKE_GRADE_RANK: Record<MistakeGrade, number> = {
  good: 0,
  fair: 1,
  inaccuracy: 2,
  mistake: 3,
  blunder: 4,
  'missed-win': 5,
};

/** 结算页展示用的中文定性文案。 */
export const MISTAKE_GRADE_LABELS: Record<MistakeGrade, string> = {
  good: '好棋',
  fair: '一般',
  inaccuracy: '不精确',
  mistake: '失误',
  blunder: '大漏',
  'missed-win': '痛失好局',
};

/** WPL 分级阈值（百分点），与 PRD §5.1 逐字对应。 */
export const WPL_THRESHOLDS = {
  good: 2,
  fair: 5,
  inaccuracy: 10,
  mistake: 20,
} as const;

/** 痛失好局特例的评估阈值（centipawn）。 */
export const MISSED_WIN_CP = {
  cpPreMin: 150,
  swingMin: 100,
  cpPlayedMax: 150,
} as const;

/** 大优封顶阈值：走子前胜率下界 -> 最差评级。 */
export const WIN_PROB_CAP: ReadonlyArray<{ min: number; worst: MistakeGrade }> = [
  { min: 90, worst: 'fair' },
  { min: 80, worst: 'inaccuracy' },
  { min: 65, worst: 'mistake' },
];

/**
 * centipawn -> 胜率百分点（0..100）。
 * 与 PRD 的 `50 + 50 * (2 / (1 + exp(-0.00368208*cp)) - 1)` 完全等价。
 */
export function winProb(cp: number): number {
  if (!Number.isFinite(cp)) return 50;
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/** 是否命中"痛失好局"特例（优先级高于大优封顶）。 */
export function isMissedWin(cpPre: number, cpPlayed: number): boolean {
  return cpPre >= MISSED_WIN_CP.cpPreMin
    && cpPre - cpPlayed >= MISSED_WIN_CP.swingMin
    && cpPlayed < MISSED_WIN_CP.cpPlayedMax;
}

/** 由胜率损失与走子前胜率给出评级（含封顶；Miss 由 gradeOf 处理）。 */
export function gradeFromWpl(wpl: number, cpPre: number): MistakeGrade {
  let grade: MistakeGrade;
  if (wpl < WPL_THRESHOLDS.good) grade = 'good';
  else if (wpl < WPL_THRESHOLDS.fair) grade = 'fair';
  else if (wpl < WPL_THRESHOLDS.inaccuracy) grade = 'inaccuracy';
  else if (wpl < WPL_THRESHOLDS.mistake) grade = 'mistake';
  else grade = 'blunder';

  const preProb: number = winProb(cpPre);
  for (const cap of WIN_PROB_CAP) {
    if (preProb < cap.min) continue;
    if (MISTAKE_GRADE_RANK[grade] > MISTAKE_GRADE_RANK[cap.worst]) grade = cap.worst;
    break; // 从最严格的档开始，只应用一次封顶
  }
  return grade;
}

/** 评级结果：同时给出 grade 与 WPL，便于调用方一次取值。 */
export interface GradeResult {
  grade: MistakeGrade;
  wpl: number;
}

/** 由走子前 / 实际所走的评估分给出评级与 WPL。 */
export function gradeOf(cpPre: number, cpPlayed: number): GradeResult {
  const wpl: number = Math.max(0, winProb(cpPre) - winProb(cpPlayed));
  const grade: MistakeGrade = isMissedWin(cpPre, cpPlayed)
    ? 'missed-win' : gradeFromWpl(wpl, cpPre);
  return { grade, wpl };
}

/** 单条失误记录：结算页讲解卡片的完整数据来源。 */
export interface MistakeEntry {
  /** 0-based 着法下标（第 N 手 = ply + 1）。 */
  ply: number;
  /** 走子方（始终等于 playerSide）。 */
  side: Side;
  /** WPL 评级。 */
  grade: MistakeGrade;
  /** 胜率损失百分点（走子方视角，非负）。 */
  wpl: number;
  /** 正解可挽回的胜率百分点。 */
  wplBest: number;
  /** 走子前评估分（走子方视角）。 */
  cpPre: number;
  /** 走子前局面最佳应手后的评估分。 */
  cpBest: number;
  /** 实际所走后的评估分。 */
  cpPlayed: number;
  /** 实际所走的中文记谱。 */
  playedNotation: string;
  /** 正解着法的中文记谱。 */
  bestNotation: string;
  /** 正解着法对象；无合法着法时为 null。 */
  bestMove: Move | null;
  /** 失误前的局面快照（供推演页演示正解）。 */
  beforeState: GameState;
  /** 是否命中痛失好局特例。 */
  missedWin: boolean;
  /** P2 次要类型标签，默认不填。 */
  secondaryTypes?: MistakeType[];
}

/** 单条失误的完整讲解（卡片三段文案 + 演示参数）。 */
export interface MistakeExplanation {
  entry: MistakeEntry;
  type: MistakeType;
  verdict: string;
  why: string;
  advice: string;
  demoOptions: { mode: 'move' | 'mate'; move?: Move };
}

/** analyzeMistakes 的可选参数。 */
export interface AnalyzeOptions {
  /** 只分析该方的走子。 */
  playerSide: Side;
  /** 已归入"漏杀"的 ply，去重剔除；默认空集。 */
  excludePlies?: ReadonlySet<number>;
  /** 最多分析前多少个 ply；默认覆盖整局（history.length）。 */
  maxPlies?: number;
  /** 每处理多少个 ply 让出一帧，默认 6。 */
  chunkSize?: number;
}

/** 一次性分析的统计结果。 */
export interface AnalysisResult {
  /** ≤5 条，WPL 降序。 */
  mistakes: MistakeEntry[];
  analyzedPlies: number;
  skippedPlies: number;
  elapsedMs: number;
}
