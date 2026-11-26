/**
 * 棋谱保存/读取闭环回归（v22.4）。
 * 根因 bug：doLoad 用 fromNotationSetup 解析 toNotationSetup 生成的串，
 * 两种格式不兼容导致棋盘恢复成空、回放着法全部匹配失败（"棋谱打不开"）。
 */
import { describe, it, expect } from 'vitest';
import { Board, createInitialState } from '../../engine/board';
import { generateLegalMoves, applyMoveToState } from '../../engine/rules';
import type { Move, GameState } from '../../engine/types';

describe('棋谱 setup 序列化闭环', () => {
  it('toNotationSetup 的输出必须由 fromSetup（而非 fromNotationSetup）恢复', () => {
    let s: GameState = createInitialState('red');
    const moves: Move[] = [];
    for (let i = 0; i < 6; i++) {
      const legal = generateLegalMoves(s.board, s.turn);
      const m = legal.find((x) => x.piece === 'P' || x.piece === 'C') ?? legal[0];
      moves.push({ ...m });
      s = applyMoveToState(s, m);
    }
    // 模拟从对局中间保存：setup 是走完后的棋盘
    const setup = s.board.toNotationSetup();

    // 正确配对：fromSetup 能完整还原
    const restored = Board.fromSetup(setup);
    expect(restored.toNotationSetup()).toBe(setup);

    // 错误配对（旧 bug）：fromNotationSetup 解析这种串会抛异常或得到错误棋盘。
    // 旧版 doLoad 用它导致点击棋谱时抛错、回放整体崩溃——这就是"打不开"。
    let wrongOk = false;
    try {
      const wrong = Board.fromNotationSetup(setup);
      wrongOk = wrong.toNotationSetup() === setup; // 若没抛错，是否至少正确还原
    } catch { wrongOk = false; }
    expect(wrongOk).toBe(false);
  });

  it('还原后的棋盘能匹配回放着法', () => {
    let s: GameState = createInitialState('red');
    const moves: Move[] = [];
    for (let i = 0; i < 4; i++) {
      const legal = generateLegalMoves(s.board, s.turn);
      const m = legal[0];
      moves.push({ ...m });
      s = applyMoveToState(s, m);
    }
    const setup = Board.fromSetup(createInitialState('red').board.toNotationSetup());
    let cur: GameState = { board: setup, turn: 'red', history: [], status: 'playing', moveCount: 0 };
    for (const mv of moves) {
      const legal = generateLegalMoves(cur.board, cur.turn)
        .find((m) => m.from.col === mv.from.col && m.from.row === mv.from.row
          && m.to.col === mv.to.col && m.to.row === mv.to.row);
      expect(legal, `着法 ${mv.from.col},${mv.from.row}->${mv.to.col},${mv.to.row} 应可匹配`).toBeDefined();
      cur = applyMoveToState(cur, legal!);
    }
  });
});
