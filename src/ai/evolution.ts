/**
 * AI 本地自适应学习（v1.15）。
 *
 * 定位要诚实：这是**基于对局结果的本地权重学习**，不是神经网络、不是云端训练，
 * 也不会"无限变强"。它只做三件可验证的小事：
 *   1. 记住人类在各开局/各开局应手上的胜负分布；
 *   2. 记住 AI 在中局着法模式上的胜负分布；
 *   3. 把这些统计折算成范围受限的乘子（开局 0.8~1.2，中局 0.85~1.15），
 *      叠加到既有主流开局权重和"等分候选"选择上。
 *
 * 所有乘子都带 6 局中性先验，且乘子区间不足以把冷门分支抬到主流分支之前，
 * 所以劣着永远不会被提到前面；学习只是温和倾斜。对局结束时外部调用
 * `recordGameResult(summary)`，落盘由 `src/data/evolution-storage.ts` 负责。
 */

import type { GameState, Move, Side } from '../engine/types';
import {
  clearEvolutionData,
  emptyEvolutionData,
  pruneTallyTable,
  loadEvolutionData,
  saveEvolutionData,
  type EvolutionData,
  type OutcomeTally,
} from '../data/evolution-storage';
import { detectOpeningFor, normalizeNotation } from './openingBook';
import { isDifficulty, type Difficulty } from './types';
import { flatMoveCode } from './variety';

/** 对局结果，统一从**人类玩家**视角描述。 */
export type GameOutcome = 'win' | 'loss' | 'draw';

/** 传给 `recordGameResult` 的对局复盘摘要。 */
export interface GameSummary {
  /** 本局难度档位。 */
  difficulty: Difficulty;
  /**
   * 直接给出结果（人类视角），**长将判负局必须显式传入**：仅凭
   * `game.status === 'perpetual'` 与 `game.turn` 无法知道谁是长将方，
   * 因此该情况下省略 outcome 会被安全忽略，不做猜测。
   * 省略时只对 checkmate/stalemate/draw 自动推导
   * （将死/困毙由最后走子方获胜）。
   */
  outcome?: GameOutcome;
  /** 完整对局快照；提供后可自动推导着法、开局与结果。 */
  game?: GameState;
  /** 着法记谱序列；`game` 缺失时的只读替代来源。 */
  history?: readonly string[];
  /** 开局名；缺省时从前缀自动识别。 */
  opening?: string;
  /** 人类执棋方，默认红方。 */
  playerSide?: Side;
  /**
   * 可选：显式指定 AI 着法的 flatMoveCode 列表。缺省时从 `game.history`
   * 按 `playerSide` 的对侧抽取。
   */
  aiMoveCodes?: readonly number[];
}

/** 学习产生的权重调整，供 engine 在选择开局/等分候选时叠加。 */
export interface EvolutionAdjustment {
  /** key = `开局名\u0000应手记谱`，值域 0.8~1.2（1 表示无偏好）。 */
  openingReply: Readonly<Record<string, number>>;
  /** key = flatMoveCode 字符串，值域 0.85~1.15。 */
  middlegame: Readonly<Record<string, number>>;
  /** key = 开局名，值域 0~1：人类在该开局的胜率优势。 */
  openingPressure: Readonly<Record<string, number>>;
  /** 累计对局数（含本次会话）。 */
  totalGames: number;
  /** 0~9 的学习等级，仅供 UI 展示。 */
  level: number;
  /** 学习是否启用；关闭时各表为空。 */
  enabled: boolean;
}

/** UI 可直接展示的学习进度摘要。 */
export interface EvolutionStats {
  totalGames: number;
  level: number;
  enabled: boolean;
  /** 样本最多的若干开局，按对局数降序。 */
  openings: Array<{
    name: string;
    games: number;
    /** AI 视角胜率（和棋按 0.5 计），已含中性先验。 */
    aiWinRate: number;
  }>;
}

/** 中性先验局数：样本少时权重几乎不动，避免"连胜一局就永久定型"。 */
const PRIOR_GAMES = 6;
/** 学习等级每级需要的对局数。 */
const GAMES_PER_LEVEL = 5;
/** 最高展示等级。 */
const MAX_LEVEL = 9;
/** 开局分支/中局统计的着法窗口（ply）。 */
const REPLY_PLY_LIMIT = 14;
const PATTERN_PLY_START = 10;
const PATTERN_PLY_LIMIT = 60;
/** key 拼接用的分隔符（记谱和开局名都不可能含 U+0000）。 */
const KEY_SEP = '\u0000';
const PIECE_CODE: Readonly<Record<string, number>> = {
  K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7,
};

let cachedData: EvolutionData | null = null;
let cachedAdjustment: EvolutionAdjustment | null = null;

/** 测试/外部清理 localStorage 后用它让本模块重新读取。 */
export function invalidateEvolutionCache(): void {
  cachedData = null;
  cachedAdjustment = null;
}

function currentData(): EvolutionData {
  if (cachedData === null) cachedData = loadEvolutionData();
  return cachedData;
}

function freshTally(): OutcomeTally {
  return { win: 0, loss: 0, draw: 0 };
}

function addTally(table: Record<string, OutcomeTally>, key: string, outcome: GameOutcome): void {
  const existing: OutcomeTally = table[key] ?? freshTally();
  existing[outcome] += 1;
  table[key] = existing;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function tallyGames(t: OutcomeTally | undefined): number {
  if (!t) return 0;
  return t.win + t.loss + t.draw;
}

/** AI 视角胜率（人类负 = AI 胜，和棋计 0.5），带中性先验。 */
function aiWinRate(t: OutcomeTally | undefined): number {
  if (!t) return 0.5;
  const games: number = tallyGames(t);
  return (t.loss + PRIOR_GAMES * 0.5) / (games + PRIOR_GAMES);
}

/** 人类视角胜率优势（0~1），带中性先验。 */
function humanPressure(t: OutcomeTally | undefined): number {
  if (!t) return 0;
  const games: number = tallyGames(t);
  const rate: number = (t.win + PRIOR_GAMES * 0.5) / (games + PRIOR_GAMES);
  return clamp((rate - 0.5) * 2, 0, 1);
}

/** 开局应手乘子：AI 胜率越高越倾向，区间 [0.8, 1.2]。 */
function replyFactor(t: OutcomeTally | undefined): number {
  return clamp(1 + 0.4 * (aiWinRate(t) - 0.5) * 2, 0.8, 1.2);
}

/** 中局着法乘子：与开局相比更保守，区间 [0.85, 1.15]。 */
function patternFactor(t: OutcomeTally | undefined): number {
  return clamp(1 + 0.3 * (aiWinRate(t) - 0.5) * 2, 0.85, 1.15);
}

function levelFor(totalGames: number): number {
  return Math.min(MAX_LEVEL, Math.floor(totalGames / GAMES_PER_LEVEL));
}

/** 把任意结果别名归一化；无法识别时返回 null。 */
function normalizeOutcome(value: unknown): GameOutcome | null {
  if (value === 'win' || value === 'loss' || value === 'draw') return value;
  if (value === 'lose') return 'loss';
  if (value === 'human_win') return 'win';
  if (value === 'human_loss') return 'loss';
  return null;
}

/**
 * 从 GameState 推导人类视角结果；无法可靠判定时返回 null（调用方忽略本局）。
 * 注意：'perpetual' 的胜负取决于谁是长将方，game.turn 在本项目里并不等于
 * 长将方，store 层现已用显式 result{winner, loser, reason} 记录。这里不做
 * 猜测，必须由调用方传显式 outcome（UI 线已在终局入口传）。
 */
function outcomeFromGame(game: GameState, playerSide: Side): GameOutcome | null {
  if (game.status === 'draw') return 'draw';
  if (game.status === 'perpetual') return null;
  if (game.status !== 'checkmate' && game.status !== 'stalemate') return null;
  const mover: Side = game.history.length % 2 === 0 ? 'red' : 'black';
  return mover === playerSide ? 'loss' : 'win';
}

/** 把一步棋压成与 engine.selectAmongPeers 完全相同的整数码。 */
export function movePatternCode(move: Move): number {
  const from: number = move.from.col * 10 + move.from.row;
  const to: number = move.to.col * 10 + move.to.row;
  const piece: number = PIECE_CODE[move.piece] ?? 1;
  return flatMoveCode(from, to, piece);
}

function historyNotations(summary: GameSummary): string[] {
  if (summary.game) return summary.game.history.map((m) => m.notation);
  return (summary.history ?? []).slice();
}

/**
 * 记录一局复盘结果。返回更新后的完整学习数据副本（便于测试与 UI 展示）。
 * 未终局或缺少可识别结果的摘要会被安全忽略，不写盘、不增加局数。
 */
export function recordGameResult(summary: GameSummary): EvolutionData {
  const playerSide: Side = summary.playerSide === 'black' ? 'black' : 'red';
  const outcome: GameOutcome | null = normalizeOutcome(summary.outcome)
    ?? (summary.game ? outcomeFromGame(summary.game, playerSide) : null);
  if (outcome === null) return currentData();

  const difficulty: Difficulty = isDifficulty(summary.difficulty)
    ? summary.difficulty
    : 'intermediate';
  const notations: string[] = historyNotations(summary);
  const detected: string | null = detectOpeningFor(notations);
  const opening: string = (summary.opening ?? detected ?? '未识别开局').trim() || '未识别开局';
  const aiSide: Side = playerSide === 'red' ? 'black' : 'red';

  // 开局应手：AI 在开局阶段走过的记谱，按 (开局, 应手) 累计。
  const replyKeys: string[] = [];
  // 中局模式：AI 在开局之后的着法整数码，只取一段有限窗口。
  const patternKeys: string[] = [];
  let explicitCodeIndex: number = 0;
  if (summary.aiMoveCodes !== undefined) {
    for (const code of summary.aiMoveCodes) {
      if (!Number.isFinite(code)) continue;
      patternKeys.push(String(Math.trunc(code)));
      explicitCodeIndex += 1;
      if (explicitCodeIndex >= 24) break;
    }
  } else if (summary.game) {
    for (let ply = 0; ply < summary.game.history.length; ply++) {
      const move: Move = summary.game.history[ply];
      const mover: Side = ply % 2 === 0 ? 'red' : 'black';
      if (mover !== aiSide) continue;
      if (ply < REPLY_PLY_LIMIT && move.notation) {
        // 应手必须挂在"AI 走这步之前"的开局前缀上，才能与 bookMove 查询时
        // 使用的 detectOpeningFor(history) 完全对齐（否则不同应手会被
        // 归到不同开局名下，学习就无法在同一分叉点比较它们）。
        const prefixOpening: string = detectOpeningFor(notations.slice(0, ply)) ?? opening;
        replyKeys.push(prefixOpening + KEY_SEP + normalizeNotation(move.notation));
      }
      if (ply >= PATTERN_PLY_START && ply < PATTERN_PLY_LIMIT) {
        patternKeys.push(String(movePatternCode(move)));
      }
    }
  }

  // 复制所有将被修改的层；未触及的表与旧数据不共享引用，避免外部观察到半写状态。
  const previous: EvolutionData = currentData();
  const next: EvolutionData = {
    ...previous,
    byDifficulty: { ...previous.byDifficulty },
    openings: { ...previous.openings },
    replies: { ...previous.replies },
    patterns: { ...previous.patterns },
  };
  next.totalGames += 1;
  addTally(next.byDifficulty, difficulty, outcome);
  addTally(next.openings, opening, outcome);
  for (const key of replyKeys) addTally(next.replies, key, outcome);
  for (const key of patternKeys) addTally(next.patterns, key, outcome);

  // 逐项裁剪，保持 localStorage 体积可控（顺序稳定，便于复现）。
  next.replies = pruneTallyTable(next.replies);
  next.patterns = pruneTallyTable(next.patterns);
  next.openings = pruneTallyTable(next.openings);

  cachedData = next;
  cachedAdjustment = null;
  if (next.enabled) saveEvolutionData(next);
  return next;
}

/** 当前生效的权重调整；未学习过或学习关闭时返回中性表。 */
export function getEvolutionAdjustment(): EvolutionAdjustment {
  const data: EvolutionData = currentData();
  if (cachedAdjustment !== null) return cachedAdjustment;
  const openingReply: Record<string, number> = {};
  const middlegame: Record<string, number> = {};
  const openingPressure: Record<string, number> = {};
  if (data.enabled) {
    for (const key of Object.keys(data.replies)) {
      openingReply[key] = replyFactor(data.replies[key]);
    }
    for (const key of Object.keys(data.patterns)) {
      middlegame[key] = patternFactor(data.patterns[key]);
    }
    for (const key of Object.keys(data.openings)) {
      openingPressure[key] = humanPressure(data.openings[key]);
    }
  }
  const adjustment: EvolutionAdjustment = {
    openingReply,
    middlegame,
    openingPressure,
    totalGames: data.totalGames,
    level: levelFor(data.totalGames),
    enabled: data.enabled,
  };
  cachedAdjustment = adjustment;
  return adjustment;
}

/** 供设置面板显示"已学习 N 局 / 等级 M / 各开局 AI 胜率"。 */
export function getEvolutionStats(): EvolutionStats {
  const data: EvolutionData = currentData();
  const openings: EvolutionStats['openings'] = Object.keys(data.openings)
    .map((name) => ({
      name,
      games: tallyGames(data.openings[name]),
      aiWinRate: Math.round(aiWinRate(data.openings[name]) * 1000) / 1000,
    }))
    .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  return {
    totalGames: data.totalGames,
    level: levelFor(data.totalGames),
    enabled: data.enabled,
    openings,
  };
}

/** 关闭/开启学习；关闭后 getEvolutionAdjustment 返回全中性表，历史数据保留。 */
export function setEvolutionEnabled(enabled: boolean): EvolutionData {
  const next: EvolutionData = { ...currentData(), enabled };
  cachedData = next;
  cachedAdjustment = null;
  saveEvolutionData(next);
  return next;
}

/** 一键重置：清空持久化数据与内存缓存。 */
export function resetEvolution(): void {
  clearEvolutionData();
  cachedData = emptyEvolutionData();
  cachedAdjustment = null;
}

/** 供测试构造确定状态的诊断入口；不会持久化。 */
export function peekEvolutionData(): EvolutionData {
  return currentData();
}
