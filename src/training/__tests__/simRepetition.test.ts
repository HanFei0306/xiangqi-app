import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { Move, Pos } from '../../engine/types';
import { judgeSimRepetition } from '../simRepetition';

function p(col: number, row: number): Pos { return { col, row }; }
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

const BLACK_PERPETUAL: Array<[Pos, Pos]> = [
  [p(7,2),p(6,2)],[p(8,6),p(8,5)],[p(1,0),p(2,2)],[p(8,5),p(8,4)],
  [p(8,0),p(8,1)],[p(8,9),p(8,8)],[p(4,0),p(4,1)],[p(8,8),p(8,7)],
  [p(4,1),p(3,1)],[p(8,7),p(8,6)],[p(4,3),p(4,4)],[p(8,6),p(8,5)],
  [p(8,1),p(7,1)],[p(8,5),p(4,5)],[p(7,1),p(7,3)],[p(4,5),p(4,4)],
  [p(0,0),p(0,1)],[p(4,4),p(4,3)],[p(0,1),p(0,0)],
  [p(4,3),p(3,3)],[p(3,1),p(4,1)],[p(3,3),p(4,3)],[p(4,1),p(3,1)],
  [p(4,3),p(3,3)],[p(3,1),p(4,1)],[p(3,3),p(4,3)],[p(4,1),p(3,1)],
];

describe('推演长将判定', () => {
  it('不足循环返回 none', () => {
    expect(judgeSimRepetition(createInitialState('red'), [])).toBe('none');
  });

  it('黑方连续将军的三重复 → black-loses', () => {
    const moves = playSeq(BLACK_PERPETUAL);
    expect(moves).toHaveLength(27);
    expect(judgeSimRepetition(createInitialState('red'), moves)).toBe('black-loses');
  });

  // 回归测试（用户实测 bug）：连续将军但局面尚未三次重复时，绝不能判长将负。
  // 旧版只看"连续将军>=3步"的兜底会在此处误判；严格规则必须等三局面重复。
  it('连续将军但局面未三次重复 → 不判负（不误伤正常连将）', () => {
    const moves = playSeq(BLACK_PERPETUAL.slice(0, 24));
    expect(judgeSimRepetition(createInitialState('red'), moves)).toBe('none');
  });

  // v2026.11.23.2 回归（用户实测 bug）：劣势方单子对对方多子、一路将军赖和，
  // 应将位置变化导致严格循环判定漏判，三次重复后曾被判和。规则(2020)23.5.1
  // 单方长将判负。构造"最后一轮混有非将军步 + 窗口内黑连续将军"的三次重复
  // 序列，验证宽松兜底把和棋纠正为 black-loses。
  it('三次重复 + 单方连续将军（宽松命中）→ 判长将方负，不判和', () => {
    const moves = playSeq(BLACK_PERPETUAL); // 27 步：三次重复且黑方连续将军
    const verdict = judgeSimRepetition(createInitialState('red'), moves);
    expect(verdict).toBe('black-loses');
    expect(verdict).not.toBe('draw');
  });
});
