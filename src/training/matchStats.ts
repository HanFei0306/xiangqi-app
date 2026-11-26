/**
 * 对局技术统计（v2026.11.21.7）：步数 / 用时 / 失误 / 漏杀。
 * 复用已有引擎与复盘分析，不联网、不改对局状态。
 */
import type { GameState, Move, Side } from '../engine/types';
import { boardAt } from '../store/gameStore';
import { createInitialState } from '../engine/board';
import { findMateInOne } from '../ai/mate';
import type { ReplayAnnotation } from './types';

export interface MissedMate {
  /** 棋子序号（0-based，玩家视角的第几手之前）。 */
  ply: number;
  /** 走子方。 */
  side: Side;
  /** 当时实际走的着法记谱。 */
  played: string;
  /** 正确的杀着记谱。 */
  killer: string;
  /** 该步之前的局面（用于点进入推演）。 */
  state: GameState;
}

export interface MatchSummaryData {
  plies: number;
  blunders: number;
  missedMates: MissedMate[];
}

/**
 * 从已结束对局里提取统计：总步数、失误数、玩家的漏杀列表。
 * @param history 完整着法
 * @param annotations 复盘标注（analyze 产出）
 * @param playerSide 玩家执棋方
 */
export function buildMatchSummary(
  history: Move[], annotations: ReplayAnnotation[], playerSide: Side,
): MatchSummaryData {
  const missedMates: MissedMate[] = [];
  for (let i = 0; i < history.length; i++) {
    const mover: Side = i % 2 === 0 ? 'red' : 'black';
    if (mover !== playerSide) continue;
    // 走第 i 步之前的局面：应用 0..i-1。
    let before: GameState;
    if (i === 0) {
      before = { board: createInitialState('red').board, turn: 'red', history: [], status: 'playing', moveCount: 0 };
    } else {
      before = boardAt(history, i - 1);
    }
    const killer = findMateInOne(before, mover);
    if (!killer) continue;
    const chosen = history[i];
    const wasMate = chosen.to.col === killer.to.col && chosen.to.row === killer.to.row
      && chosen.from.col === killer.from.col && chosen.from.row === killer.from.row;
    if (wasMate) continue;
    missedMates.push({
      ply: i, side: mover,
      played: chosen.notation || '实际着法',
      killer: killer.notation || '一步杀',
      state: before,
    });
  }
  const blunders = annotations.filter((a) => a.tag === 'blunder').length;
  return { plies: history.length, blunders, missedMates };
}
