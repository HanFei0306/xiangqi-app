/**
 * 《适情雅趣》数据集引擎自检。
 * 校验每个 puzzle 的 setup 结构/局面合法，且 solution 每步都合法、红方先行。
 */
import { describe, it, expect } from 'vitest';
import { SHIQINGYAQU } from '../shiqingyaqu';
import { Board } from '../../engine/board';
import { validateSetupString, validatePosition } from '../../engine/validate';
import { legalMoveAt, applyMoveToState } from '../../engine/rules';
import type { GameState } from '../../engine/types';

describe('SHIQINGYAQU 数据集', () => {
  it('非空、按 order 升序、order 唯一', () => {
    expect(SHIQINGYAQU.length).toBeGreaterThan(0);
    const orders = SHIQINGYAQU.map((p) => p.order);
    const sorted = [...orders].sort((a, b) => a - b);
    expect(orders).toEqual(sorted);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('每局：setup 结构合法、局面合法、solution 全程合法且红先', () => {
    for (const p of SHIQINGYAQU) {
      // 1. setup 结构
      expect(validateSetupString(p.setup), `局 ${p.order} setup 结构`).toEqual([]);
      // 2. 局面合法（红先，黑方不得处于被将状态）
      const board = Board.fromNotationSetup(p.setup);
      const pos = validatePosition(board, 'red');
      expect(pos.errors, `局 ${p.order} 局面 ${pos.errors.join(';')}`).toEqual([]);
      // 3. 着法回放
      expect(p.solution.length, `局 ${p.order} 无着法`).toBeGreaterThan(0);
      let side: 'red' | 'black' = 'red';
      let state: GameState = { board, turn: side, history: [], status: 'playing', moveCount: 0 };
      // 首着必须是红方棋子
      const firstPiece = board.getPiece(p.solution[0].from);
      expect(firstPiece?.side, `局 ${p.order} 首着非红方`).toBe('red');
      for (let i = 0; i < p.solution.length; i++) {
        const mv = p.solution[i];
        const legal = legalMoveAt(state.board, mv.from, mv.to, side);
        expect(legal, `局 ${p.order} 第 ${i} 步非法`).not.toBeNull();
        if (!legal) break;
        state = applyMoveToState(state, legal);
        side = side === 'red' ? 'black' : 'red';
      }
    }
  });
});
