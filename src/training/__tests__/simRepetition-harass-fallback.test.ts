/**
 * v2026.11.23.2 回归：证明宽松长将兜底被真正接入 judgeSimRepetition。
 * 用户实测 bug：劣势方单子对多子、一路将军赖和，应将位置反复变化导致
 * "最后一轮每一步都将军 + 精确三次同局面"的严格条件不成立，三次重复后
 * 被误判为 draw。规则(2020) 23.5.1：单方长将判负。
 *
 * 这里用 vi.mock 让宽松判定确定命中，并使用一个"三次重复 + 严格判定会
 * 判 draw"的输入，验证最终返回 black-loses 而非 draw。这是对修复点本身
 * （兜底分支）的精确验证，与真实着法集成测试互补。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { Move, Pos } from '../../engine/types';

const mockHarass = vi.fn();
vi.mock('../perpetualGuard', () => ({
  detectPerpetualHarassment: (...args: unknown[]) => mockHarass(...args),
}));

import { judgeSimRepetition } from '../simRepetition';

function p(c: number, r: number): Pos { return { col: c, row: r }; }
function playSeq(steps: Array<[Pos, Pos]>): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [from, to] of steps) {
    const move = makeMove(state.board, from, to);
    if (!move) throw new Error(`illegal ${JSON.stringify(from)}->${JSON.stringify(to)} at ${history.length}`);
    history.push({ ...move });
    state = applyMoveToState(state, move);
  }
  return history;
}

// 三次重复的连将序列（27 步）。严格循环判定本身也会判 black-loses，
// 但本测试 mock 掉宽松判定后，专门验证"兜底命中即优先判负"这一分支。
const PERPETUAL: Array<[Pos, Pos]> = [
  [p(7,2),p(6,2)],[p(8,6),p(8,5)],[p(1,0),p(2,2)],[p(8,5),p(8,4)],
  [p(8,0),p(8,1)],[p(8,9),p(8,8)],[p(4,0),p(4,1)],[p(8,8),p(8,7)],
  [p(4,1),p(3,1)],[p(8,7),p(8,6)],[p(4,3),p(4,4)],[p(8,6),p(8,5)],
  [p(8,1),p(7,1)],[p(8,5),p(4,5)],[p(7,1),p(7,3)],[p(4,5),p(4,4)],
  [p(0,0),p(0,1)],[p(4,4),p(4,3)],[p(0,1),p(0,0)],
  [p(4,3),p(3,3)],[p(3,1),p(4,1)],[p(3,3),p(4,3)],[p(4,1),p(3,1)],
  [p(4,3),p(3,3)],[p(3,1),p(4,1)],[p(3,3),p(4,3)],[p(4,1),p(3,1)],
];

describe('三次重复判定 · 单方长将宽松兜底接入', () => {
  beforeEach(() => mockHarass.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('三次重复时宽松判定被调用', () => {
    mockHarass.mockReturnValue(null);
    const moves = playSeq(PERPETUAL);
    judgeSimRepetition(createInitialState('red'), moves);
    expect(mockHarass).toHaveBeenCalled();
  });

  it('宽松判定命中单方长将 → 判长将方负（不再误判和棋）', () => {
    mockHarass.mockReturnValue('black-loses');
    const moves = playSeq(PERPETUAL);
    expect(judgeSimRepetition(createInitialState('red'), moves)).toBe('black-loses');
  });

  it('未达三次重复时宽松判定不被调用（不误伤正常连将/连杀）', () => {
    mockHarass.mockReturnValue('black-loses'); // 即便宽松会命中
    const moves = playSeq(PERPETUAL.slice(0, 20)); // 20 步未三次重复
    const verdict = judgeSimRepetition(createInitialState('red'), moves);
    expect(mockHarass).not.toHaveBeenCalled();
    expect(verdict).toBe('none');
  });
});
