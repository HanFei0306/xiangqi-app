/**
 * 结算页一次性失误检测（v2026.11.23.2，v2026.11.23.6 覆盖整局）。
 *
 * 两遍扫描：Pass1 只算所走着的 WPL 做粗筛；Pass2 只对存活者（≤8 条）
 * 枚举合法着求正解。绝不调用 14 秒引擎，分析只在结算后执行。
 *
 * 默认覆盖整局（maxPlies 缺省为 history.length）：局面快照一次增量重放，
 * 把原本每 ply 从头重放 O(n²) 的开销降为 O(n)；仍默认每 chunkSize 个 ply
 * 让出一帧，调用方可注入 yieldFrame，满足"主线程无 >400ms 长帧"护栏。
 */
import { evaluateState } from '../ai/evaluate';
import { createInitialState } from '../engine/board';
import { applyMoveToState } from '../engine/rules';
import type { GameState, Move, Side } from '../engine/types';
import { legalMovesWithNotation } from './legalNotation';
import {
  isMissedWin, gradeOf, winProb,
  type AnalysisResult, type AnalyzeOptions, type MistakeEntry,
} from './mistakeTypes';

const DEFAULT_CHUNK = 6;
const MAX_CANDIDATES = 8;
const MAX_ENTRIES = 5;
const COARSE_WPL = 5;

interface RawCandidate {
  ply: number;
  side: Side;
  before: GameState;
  played: Move;
  cpPre: number;
  cpPlayed: number;
  wpl: number;
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value) : fallback;
}

function isMoveLike(value: unknown): value is Move {
  if (!value || typeof value !== 'object') return false;
  const move = value as Partial<Move>;
  return !!move.from && !!move.to
    && Number.isInteger(move.from.col) && Number.isInteger(move.from.row)
    && Number.isInteger(move.to.col) && Number.isInteger(move.to.row);
}

function toPlySet(source: AnalyzeOptions['excludePlies']): ReadonlySet<number> {
  if (!source) return new Set<number>();
  if (Array.isArray(source)) {
    return new Set<number>((source as readonly number[]).filter((n: number) => Number.isInteger(n)));
  }
  return source as ReadonlySet<number>;
}

/**
 * 一次性增量重放整局，得到「第 ply 手之前」的全部局面快照。
 *
 * 旧实现每个 ply 都从开局重放，长棋局会退化为 O(n²) 次 applyMoveToState；
 * 现在整局只走一遍 O(n)。残缺着法逐条跳过，轮次仍按 ply 奇偶强制校正，
 * 与旧实现逐 ply 重放的语义完全一致（包括异常快照）。
 */
function statesBefore(history: readonly Move[]): GameState[] {
  const states: GameState[] = [];
  let state: GameState = createInitialState('red');
  for (let ply = 0; ply <= history.length; ply++) {
    states.push({ ...state, turn: ply % 2 === 0 ? 'red' : 'black', moveCount: ply });
    if (ply === history.length) break;
    const move: Move = history[ply];
    if (!isMoveLike(move)) continue;
    try {
      state = applyMoveToState(state, move);
    } catch {
      // 坏记谱不改变局面；轮次仍按 ply 奇偶强制校正。
    }
  }
  return states;
}

function safeApply(before: GameState, move: Move): GameState | null {
  try { return applyMoveToState(before, move); } catch { return null; }
}

/** 与 selfReview.ts:58-70 bestAlternative 同口径：只枚举合法着，不做深度搜索。 */
function bestAlternative(
  before: GameState, mover: Side,
): { score: number; move: Move | null } {
  const moves: Move[] = legalMovesWithNotation(before);
  let best: number = -Infinity;
  let bestMove: Move | null = null;
  for (const move of moves) {
    const after = safeApply(before, move);
    if (!after) continue;
    const score: number = evaluateState(after, mover, 'full');
    if (score > best) { best = score; bestMove = move; }
  }
  return best === -Infinity
    ? { score: 0, move: null }
    : { score: best, move: bestMove };
}

const EMPTY_RESULT = (): AnalysisResult => ({
  mistakes: [], analyzedPlies: 0, skippedPlies: 0, elapsedMs: 0,
});

/**
 * 结算后一次性分析；返回 Promise<AnalysisResult>。
 * 即使 history 为空也走同一条异步路径，调用方无需分支。
 */
export async function analyzeMistakes(
  history: readonly Move[],
  opts: AnalyzeOptions,
  yieldFrame: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
): Promise<AnalysisResult> {
  const startedAt: number = Date.now();
  const list: readonly Move[] = Array.isArray(history) ? history : [];
  const options: AnalyzeOptions = opts ?? { playerSide: 'red' };
  const playerSide: Side = options.playerSide;
  if (list.length === 0 || (playerSide !== 'red' && playerSide !== 'black')) {
    return { ...EMPTY_RESULT(), elapsedMs: Date.now() - startedAt };
  }

  const excluded: ReadonlySet<number> = toPlySet(options.excludePlies);
  const chunk: number = positiveInt(options.chunkSize, DEFAULT_CHUNK);
  // 默认覆盖整局：只有调用方显式给 maxPlies 时才截断（兼容旧的分析上限用法）。
  const maxPlies: number = Math.min(list.length, positiveInt(options.maxPlies, list.length));
  const beforeStates: readonly GameState[] = statesBefore(list);
  const candidates: RawCandidate[] = [];
  let analyzedPlies: number = 0;
  let skippedPlies: number = 0;

  // Pass 1：只算 cpPre / cpPlayed，粗筛 WPL>=5 或命中痛失好局。
  for (let ply = 0; ply < maxPlies; ply++) {
    const mover: Side = ply % 2 === 0 ? 'red' : 'black';
    if (mover !== playerSide) continue;
    if (excluded.has(ply) || !isMoveLike(list[ply])) { skippedPlies++; continue; }
    const played: Move = list[ply];
    const before: GameState | undefined = beforeStates[ply];
    if (!before) { skippedPlies++; continue; }
    const afterPlayed: GameState | null = safeApply(before, played);
    if (!afterPlayed) { skippedPlies++; continue; }

    let cpPre: number = 0;
    let cpPlayed: number = 0;
    try {
      cpPre = evaluateState(before, mover, 'full');
      cpPlayed = evaluateState(afterPlayed, mover, 'full');
    } catch {
      skippedPlies++;
      continue;
    }
    analyzedPlies++;
    const wpl: number = Math.max(0, winProb(cpPre) - winProb(cpPlayed));
    if (wpl >= COARSE_WPL || isMissedWin(cpPre, cpPlayed)) {
      candidates.push({ ply, side: mover, before, played, cpPre, cpPlayed, wpl });
    }
    if (analyzedPlies % chunk === 0) await yieldFrame();
  }

  if (candidates.length === 0) {
    return {
      mistakes: [], analyzedPlies, skippedPlies, elapsedMs: Date.now() - startedAt,
    };
  }

  candidates.sort((a, b) => b.wpl - a.wpl || a.ply - b.ply);
  const survivors: RawCandidate[] = candidates.slice(0, MAX_CANDIDATES);

  // Pass 2：只对存活者枚举合法着，求正解与可挽回胜率。
  const entries: MistakeEntry[] = [];
  for (const raw of survivors) {
    const best = bestAlternative(raw.before, raw.side);
    const cpBest: number = best.move ? best.score : raw.cpPre;
    const graded = gradeOf(raw.cpPre, raw.cpPlayed);
    entries.push({
      ply: raw.ply,
      side: raw.side,
      grade: graded.grade,
      wpl: graded.wpl,
      wplBest: Math.max(0, winProb(cpBest) - winProb(raw.cpPlayed)),
      cpPre: raw.cpPre,
      cpBest,
      cpPlayed: raw.cpPlayed,
      playedNotation: raw.played.notation || '实际着法',
      bestNotation: best.move?.notation || raw.played.notation || '暂无更好着法',
      bestMove: best.move,
      beforeState: raw.before,
      missedWin: isMissedWin(raw.cpPre, raw.cpPlayed),
    });
    await yieldFrame();
  }

  entries.sort((a, b) => b.wpl - a.wpl || a.ply - b.ply);
  return {
    mistakes: entries.slice(0, MAX_ENTRIES),
    analyzedPlies,
    skippedPlies,
    elapsedMs: Date.now() - startedAt,
  };
}
