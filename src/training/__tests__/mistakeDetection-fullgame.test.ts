/**
 * 整局覆盖回归（v2026.11.23.6）：旧默认 maxPlies=48 会漏掉第 49 手之后的失误。
 *
 * 用一段真实合法的 56 手棋局（双方车来回挪动，均势且子力不变），
 * 配合注入式评估分稳定构造第 52 手（红方）的大失误：
 * 只验证"扫描范围是否覆盖整局"这一控制流，不重复静态评估的棋力测试。
 * 显式 maxPlies 截断的既有语义同时保留断言。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState, Move } from '../../engine/types';

const { evaluateStateMock } = vi.hoisted(() => ({ evaluateStateMock: vi.fn() }));

vi.mock('../../ai/evaluate', () => ({
  evaluateState: (state: GameState) => evaluateStateMock(state),
}));

import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import { analyzeMistakes } from '../mistakeDetection';

/** 双方车各走一步再走回，循环 28 回合得到 56 手合法棋谱。 */
function shuttleGame(plies: number): Move[] {
  const SHUTTLE: Readonly<Record<'red' | 'black', ReadonlyArray<readonly [number, number, number, number]>>> = {
    red: [[0, 0, 0, 1], [0, 1, 0, 0]],
    black: [[8, 9, 8, 8], [8, 8, 8, 9]],
  };
  let state = createInitialState('red');
  const history: Move[] = [];
  for (let ply = 0; ply < plies; ply++) {
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

const history: Move[] = shuttleGame(56);
const yieldNow = async (): Promise<void> => { await Promise.resolve(); };

beforeEach(() => {
  evaluateStateMock.mockReset();
  evaluateStateMock.mockImplementation((state: GameState) => {
    if (state.moveCount === 52) return 300;  // 失误前的优势局面
    if (state.moveCount === 53) return -100; // 第 52 手走完后的崩盘局面
    return 0;
  });
});

describe('analyzeMistakes 整局覆盖', () => {
  it('56 手棋局默认扫描超过 48 手，并检测到第 52 手的失误', async () => {
    expect(history).toHaveLength(56);
    const result = await analyzeMistakes(history, { playerSide: 'red' }, yieldNow);
    expect(result.analyzedPlies).toBe(28); // 红方 0,2,...,54 共 28 手
    expect(result.mistakes).toHaveLength(1);
    expect(result.mistakes[0].ply).toBe(52);
    expect(result.mistakes[0].grade).toBe('missed-win');
    expect(result.mistakes[0].wpl).toBeGreaterThan(5);
    expect(result.mistakes[0].playedNotation.length).toBeGreaterThan(0);
    expect(result.mistakes[0].beforeState.moveCount).toBe(52);
  });

  it('显式 maxPlies 仍能按调用方要求截断分析范围', async () => {
    const capped = await analyzeMistakes(history, { playerSide: 'red', maxPlies: 48 }, yieldNow);
    expect(capped.analyzedPlies).toBe(24);
    expect(capped.mistakes).toEqual([]);
  });
});
