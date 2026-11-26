import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { Move, Pos } from '../../engine/types';
import { detectPerpetualHarassment } from '../perpetualGuard';

function p(c: number, r: number): Pos { return { col: c, row: r }; }
function playSeq(steps: Array<[Pos, Pos]>): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [from, to] of steps) {
    const move = makeMove(state.board, from, to);
    if (!move) throw new Error(`illegal at ${history.length}`);
    history.push({ ...move });
    state = applyMoveToState(state, move);
  }
  return history;
}

const BLACK_HARASS: Array<[Pos, Pos]> = [
  [p(7,2),p(6,2)],[p(8,6),p(8,5)],[p(1,0),p(2,2)],[p(8,5),p(8,4)],
  [p(8,0),p(8,1)],[p(8,9),p(8,8)],[p(4,0),p(4,1)],[p(8,8),p(8,7)],
  [p(4,1),p(3,1)],[p(8,7),p(8,6)],[p(4,3),p(4,4)],[p(8,6),p(8,5)],
  [p(8,1),p(7,1)],[p(8,5),p(4,5)],[p(7,1),p(7,3)],[p(4,5),p(4,4)],
  [p(0,0),p(0,1)],[p(4,4),p(4,3)],[p(0,1),p(0,0)],
  [p(4,3),p(3,3)],[p(3,1),p(4,1)],[p(3,3),p(4,3)],[p(4,1),p(3,1)],
  // 第三个将军，凑满连续 3 步将军。
  [p(4,3),p(3,3)],
];

describe('长将骚扰防护', () => {
  it('黑方连续将军 → black-loses', () => {
    const history = playSeq(BLACK_HARASS);
    expect(detectPerpetualHarassment(history)).toBe('black-loses');
  });

  it('短历史不误判', () => {
    expect(detectPerpetualHarassment([])).toBeNull();
    expect(detectPerpetualHarassment(playSeq(BLACK_HARASS.slice(0, 6)))).toBeNull();
  });

  it('普通布局（无连续将军）返回 null', () => {
    const history = playSeq(BLACK_HARASS.slice(0, 12));
    expect(detectPerpetualHarassment(history)).toBeNull();
  });
});
