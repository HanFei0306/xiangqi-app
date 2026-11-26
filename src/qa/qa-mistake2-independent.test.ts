/**
 * QA2 independent verification (v2026.11.23.6 改动验收).
 *
 * 不复用工程师新增的测试：自己实现"旧版每 ply 从头重放"的参照实现，
 * 验证 statesBefore 的 O(n) 增量快照在残缺着法/轮次/整局覆盖上与其等价，
 * 并核对候选上限、结果上限、分帧让出与显式 maxPlies 截断语义。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, Move } from '../engine/types';

const { evaluateStateMock } = vi.hoisted(() => ({ evaluateStateMock: vi.fn() }));
vi.mock('../ai/evaluate', () => ({
  evaluateState: (state: GameState) => evaluateStateMock(state),
}));

import { createInitialState } from '../engine/board';
import { applyMoveToState, generateLegalMoves } from '../engine/rules';
import { analyzeMistakes } from '../training/mistakeDetection';

/** 双方车来回挪动；corruptAt 处插入一条残缺着法（不应用到局面）。 */
function shuttleGame(plies: number, corruptAt = -1): Move[] {
  const SHUTTLE: Readonly<Record<'red' | 'black', ReadonlyArray<readonly [number, number, number, number]>>> = {
    red: [[0, 0, 0, 1], [0, 1, 0, 0]],
    black: [[8, 9, 8, 8], [8, 8, 8, 9]],
  };
  let state = createInitialState('red');
  const history: Move[] = [];
  for (let ply = 0; ply < plies; ply++) {
    if (ply === corruptAt) {
      history.push({ from: null, to: null } as unknown as Move);
      continue;
    }
    const legal: Move[] = generateLegalMoves(state.board, state.turn);
    if (legal.length === 0) break;
    const [fc, fr, tc, tr] = SHUTTLE[state.turn][Math.floor(ply / 2) % 2];
    const chosen: Move = legal.find((m) => m.from.col === fc && m.from.row === fr
      && m.to.col === tc && m.to.row === tr) ?? legal[0];
    state = applyMoveToState(state, chosen);
    chosen.notation = state.history[state.history.length - 1].notation;
    history.push(chosen);
  }
  return history;
}

/** 参照实现：每个 ply 都从开局完整重放一遍（旧 O(n²) 语义）。 */
function naiveStatesBefore(history: readonly Move[]): GameState[] {
  const states: GameState[] = [];
  for (let ply = 0; ply <= history.length; ply++) {
    let state: GameState = createInitialState('red');
    for (let i = 0; i < ply; i++) {
      const move = history[i];
      if (!move || !move.from || !move.to
        || !Number.isInteger(move.from.col) || !Number.isInteger(move.from.row)
        || !Number.isInteger(move.to.col) || !Number.isInteger(move.to.row)) continue;
      try { state = applyMoveToState(state, move); } catch { /* 坏记谱跳过 */ }
    }
    states.push({ ...state, turn: ply % 2 === 0 ? 'red' : 'black', moveCount: ply });
  }
  return states;
}

const yieldNow = async (): Promise<void> => { await Promise.resolve(); };

beforeEach(() => {
  evaluateStateMock.mockReset();
  evaluateStateMock.mockImplementation((state: GameState) => {
    if (state.moveCount === 52) return 200;
    if (state.moveCount === 53) return -200;
    return 0;
  });
});

describe('QA2 增量快照与旧重放语义等价', () => {
  it.each([-1, 3, 10, 47, 55])('残缺着法下标 %s: 第52手失误前局面与旧重放逐子一致', async (corruptAt) => {
    const history = shuttleGame(56, corruptAt);
    const naive = naiveStatesBefore(history);
    const result = await analyzeMistakes(history, { playerSide: 'red' }, yieldNow);

    expect(result.mistakes).toHaveLength(1);
    const hit = result.mistakes[0];
    expect(hit.ply).toBe(52);
    expect(hit.beforeState.moveCount).toBe(52);
    expect(hit.beforeState.turn).toBe('red');
    expect(hit.beforeState.board.toNotationSetup()).toBe(naive[52].board.toNotationSetup());
    // 任一实物棋子的坐标也一致（帥在 (4,0)，车在 (0,0) 附近）
    expect(hit.beforeState.board.getPiece({ col: 4, row: 0 })?.type).toBe('K');
    expect(hit.beforeState.board.getPiece({ col: 4, row: 0 })?.side).toBe('red');
    // skippedPlies 只统计被分析方（红方）的跳过着；黑方残缺着在轮次判断处直接忽略。
    if (corruptAt >= 0 && corruptAt % 2 === 0) expect(result.skippedPlies).toBeGreaterThanOrEqual(1);
    else expect(result.skippedPlies).toBe(0);
  });

  it('显式 maxPlies=48 仍截断，默认则覆盖整局', async () => {
    const history = shuttleGame(56);
    const capped = await analyzeMistakes(history, { playerSide: 'red', maxPlies: 48 }, yieldNow);
    expect(capped.mistakes).toEqual([]);
    expect(capped.analyzedPlies).toBe(24);
    const full = await analyzeMistakes(history, { playerSide: 'red' }, yieldNow);
    expect(full.analyzedPlies).toBe(28);
    expect(full.mistakes[0].ply).toBe(52);
  });
});

describe('QA2 粗筛候选/结果上限与分帧让出', () => {
  it('30 个粗筛候选仍只产出 ≤5 条结果，且每 chunk 让出一帧', async () => {
    const history = shuttleGame(60);
    evaluateStateMock.mockImplementation((state: GameState) => state.moveCount % 2 === 0 ? 300 : -300);
    const yields = vi.fn(async () => { await Promise.resolve(); });
    const result = await analyzeMistakes(history, { playerSide: 'red' }, yields);

    expect(result.analyzedPlies).toBe(30);
    expect(result.mistakes.length).toBeGreaterThan(0);
    expect(result.mistakes.length).toBeLessThanOrEqual(5);
    expect(new Set(result.mistakes.map((m) => m.ply)).size).toBe(result.mistakes.length);
    // Pass1 每 6 个已分析 ply 让一帧(5 次)，Pass2 每条存活候选再让一帧。
    expect(yields.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('chunkSize=1 的让帧次数明显多于 chunkSize=100', async () => {
    const history = shuttleGame(60);
    evaluateStateMock.mockImplementation(() => 0);
    const fine = vi.fn(async () => { await Promise.resolve(); });
    const coarse = vi.fn(async () => { await Promise.resolve(); });
    await analyzeMistakes(history, { playerSide: 'red', chunkSize: 1 }, fine);
    await analyzeMistakes(history, { playerSide: 'red', chunkSize: 100 }, coarse);
    expect(fine.mock.calls.length).toBeGreaterThan(coarse.mock.calls.length);
  });

  it('空局面/残缺着法数组返回空结果且不抛异常', async () => {
    const empty = await analyzeMistakes([], { playerSide: 'red' }, yieldNow);
    expect(empty.mistakes).toEqual([]);
    const bad = await analyzeMistakes(
      [null, {}, { from: { col: -1, row: -1 }, to: { col: 0, row: 0 } }, undefined] as unknown as Move[],
      { playerSide: 'red' }, yieldNow,
    );
    expect(Array.isArray(bad.mistakes)).toBe(true);
  });
});
