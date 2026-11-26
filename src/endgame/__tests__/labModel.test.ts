/**
 * 自摆残局数据模型单测（v2026.11.23.9）。
 *
 * 覆盖三类风险：
 *   1. 编辑函数的**不可变性**（历史 bug：原地改传入盘面导致 React 不重渲染）；
 *   2. `buildLabState` 的每一条拒绝理由（缺将 / 出九宫 / 超编 / 照面 / 已绝杀）；
 *   3. 持久化的防御式解析（脏数据一律返回 null，绝不抛异常）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAB_KEY,
  LAB_UNDO_LIMIT,
  TRAY_LIMITS,
  TRAY_ORDER,
  TRAY_SIDES,
  buildLabState,
  countOnBoard,
  emptyLabBoard,
  erasePiece,
  isTrayExhausted,
  loadLabDraft,
  placePiece,
  saveLabDraft,
} from '../labModel';
import { Board } from '../../engine/board';
import { CHAR_TO_PIECE } from '../../engine/pieces';
import type { Piece, PieceType, Pos, Side } from '../../engine/types';

/** 用 `[col, row, 布子字符]` 三元组快速拼一个盘面（字符见 CHAR_TO_PIECE）。 */
function boardOf(placements: Array<[number, number, string]>): Board {
  const board: Board = emptyLabBoard();
  for (const [col, row, ch] of placements) {
    const info = { type: CHAR_TO_PIECE[ch].type, side: CHAR_TO_PIECE[ch].side } as Piece;
    board.setPiece({ col, row }, info);
  }
  return board;
}

/** 空棋盘一条边都在 9x10 之内。 */
const POS_A1: Pos = { col: 0, row: 0 };
const POS_RK: Pos = { col: 4, row: 0 };

beforeEach(() => {
  localStorage.clear();
});

describe('托盘定义', () => {
  it('每型上限与引擎的 PIECE_LIMITS 一致（K1 A2 B2 N2 R2 C2 P5）', () => {
    expect(TRAY_LIMITS).toEqual({ K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 });
  });

  it('托盘顺序与阵营顺序稳定（红在下、黑在上）', () => {
    expect(TRAY_ORDER).toEqual(['K', 'A', 'B', 'N', 'R', 'C', 'P']);
    expect(TRAY_SIDES).toEqual(['red', 'black']);
  });

  it('撤销栈上限是 40 步', () => {
    expect(LAB_UNDO_LIMIT).toBe(40);
  });

  it('存储键带版本号', () => {
    expect(LAB_KEY).toBe('xiangqi-trainer:endgame-lab-v1');
  });
});

describe('emptyLabBoard', () => {
  it('返回一块空盘', () => {
    expect(emptyLabBoard().isEmpty()).toBe(true);
  });

  it('每次返回独立实例', () => {
    expect(emptyLabBoard()).not.toBe(emptyLabBoard());
  });
});

describe('placePiece / erasePiece 不可变', () => {
  it('placePiece 返回新盘且不修改入参', () => {
    const base: Board = emptyLabBoard();
    const next: Board = placePiece(base, POS_RK, { type: 'K', side: 'red' });
    expect(next).not.toBe(base);
    expect(base.getPiece(POS_RK)).toBeNull();
    expect(next.getPiece(POS_RK)).toEqual({ type: 'K', side: 'red' });
  });

  it('placePiece 可以覆盖已有的子（改放）', () => {
    const base: Board = boardOf([[0, 0, 'R']]);
    const next: Board = placePiece(base, POS_A1, { type: 'P', side: 'black' });
    expect(next.getPiece(POS_A1)).toEqual({ type: 'P', side: 'black' });
    // 原盘保持红车
    expect(base.getPiece(POS_A1)).toEqual({ type: 'R', side: 'red' });
  });

  it('placePiece 落点越界时不抛异常且不改动盘面', () => {
    const base: Board = emptyLabBoard();
    const next: Board = placePiece(base, { col: 99, row: -3 }, { type: 'K', side: 'red' });
    expect(next.isEmpty()).toBe(true);
    expect(base.isEmpty()).toBe(true);
  });

  it('erasePiece 返回新盘且不修改入参', () => {
    const base: Board = boardOf([[0, 0, 'R'], [4, 0, 'K'], [3, 9, 'k']]);
    const next: Board = erasePiece(base, POS_A1);
    expect(next).not.toBe(base);
    expect(next.getPiece(POS_A1)).toBeNull();
    expect(base.getPiece(POS_A1)).toEqual({ type: 'R', side: 'red' });
    // 其它子不受影响
    expect(next.getPiece(POS_RK)).toEqual({ type: 'K', side: 'red' });
  });

  it('erasePiece 擦空格不抛异常', () => {
    const base: Board = emptyLabBoard();
    const next: Board = erasePiece(base, { col: 8, row: 9 });
    expect(next.isEmpty()).toBe(true);
  });
});

describe('countOnBoard / isTrayExhausted', () => {
  it('按阵营和棋型分别计数', () => {
    const board: Board = boardOf([
      [4, 0, 'K'],
      [3, 9, 'k'],
      [0, 0, 'R'],
      [0, 3, 'P'],
      [2, 3, 'P'],
      [1, 7, 'c'],
    ]);
    const counts = countOnBoard(board);
    expect(counts.red.K).toBe(1);
    expect(counts.red.R).toBe(1);
    expect(counts.red.P).toBe(2);
    expect(counts.red.C).toBe(0);
    expect(counts.black.K).toBe(1);
    expect(counts.black.C).toBe(1);
    expect(counts.black.P).toBe(0);
  });

  it('空盘全部为 0', () => {
    const counts = countOnBoard(emptyLabBoard());
    const sides: Side[] = ['red', 'black'];
    const types: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];
    for (const side of sides) {
      for (const type of types) {
        expect(counts[side][type]).toBe(0);
      }
    }
  });

  it('放满即视为该型不可再放', () => {
    const board: Board = boardOf([[0, 3, 'P'], [2, 3, 'P'], [4, 3, 'P'], [6, 3, 'P']]);
    expect(isTrayExhausted(board, 'red', 'P')).toBe(false);
    const full: Board = placePiece(board, { col: 8, row: 3 }, { type: 'P', side: 'red' });
    expect(isTrayExhausted(full, 'red', 'P')).toBe(true);
    // 另一阵营不受影响
    expect(isTrayExhausted(full, 'black', 'P')).toBe(false);
  });
});

describe('buildLabState —— 拒绝理由', () => {
  it('缺将：只有红帅时拒绝', () => {
    const result = buildLabState(boardOf([[4, 0, 'K']]), 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.join('\n')).toContain('C2');
    }
  });

  it('将不在九宫：拒绝', () => {
    const result = buildLabState(boardOf([[0, 5, 'K'], [3, 9, 'k']]), 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('C3');
    }
  });

  it('三个车（超编）：拒绝', () => {
    const result = buildLabState(
      boardOf([[4, 0, 'K'], [3, 9, 'k'], [0, 0, 'R'], [0, 1, 'R'], [0, 2, 'R']]),
      'red',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('C4');
    }
  });

  it('将帅照面：拒绝', () => {
    const result = buildLabState(boardOf([[4, 0, 'K'], [4, 9, 'k']]), 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('C5');
    }
  });

  it('已经绝杀的局面：给人话提示而不是条款编号', () => {
    // 红帅 (4,0) 被黑车 (0,0) 与 (4,5) 同时封死，三个逃格全被控制 → 绝杀。
    const result = buildLabState(
      boardOf([[4, 0, 'K'], [0, 0, 'r'], [4, 5, 'r'], [4, 9, 'k']]),
      'red',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('终局');
      expect(result.errors[0]).toContain('绝杀');
    }
  });

  it('拒绝时不修改传入的盘面', () => {
    const board: Board = boardOf([[4, 0, 'K']]);
    const before: string = board.toNotationSetup();
    buildLabState(board, 'red');
    expect(board.toNotationSetup()).toBe(before);
  });
});

describe('buildLabState —— 合法局面', () => {
  it('双将残局合法时返回可推演的 GameState', () => {
    const board: Board = boardOf([[4, 0, 'K'], [3, 9, 'k'], [0, 0, 'R']]);
    const result = buildLabState(board, 'red');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.turn).toBe('red');
      expect(result.state.status).toBe('playing');
      expect(result.state.history).toEqual([]);
      expect(result.state.moveCount).toBe(0);
      // 交给推演页的是一份新盘，后续推演不会污染本页状态
      expect(result.state.board).not.toBe(board);
      expect(result.state.board.getPiece(POS_A1)).toEqual({ type: 'R', side: 'red' });
    }
  });

  it('黑先的合法局面也能通过', () => {
    const board: Board = boardOf([[4, 0, 'K'], [3, 9, 'k'], [0, 0, 'R']]);
    const result = buildLabState(board, 'black');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.turn).toBe('black');
    }
  });

  it('非走子方被将军的局面（C6）被拒绝', () => {
    // 轮到红走，但黑将正被红车将军 → 不可能由合法着法产生。
    const board: Board = boardOf([[4, 0, 'K'], [3, 9, 'k'], [3, 0, 'R']]);
    const result = buildLabState(board, 'red');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('C6');
    }
  });
});

describe('持久化 loadLabDraft / saveLabDraft', () => {
  it('保存后能原样读回（含先手方）', () => {
    const board: Board = boardOf([[4, 0, 'K'], [3, 9, 'k'], [0, 0, 'R']]);
    saveLabDraft(board, 'black');
    const draft = loadLabDraft();
    expect(draft).not.toBeNull();
    if (draft) {
      expect(draft.turn).toBe('black');
      expect(draft.board.toNotationSetup()).toBe(board.toNotationSetup());
    }
  });

  it('没有草稿时返回 null', () => {
    expect(loadLabDraft()).toBeNull();
  });

  it('空盘草稿也能读回', () => {
    saveLabDraft(emptyLabBoard(), 'red');
    const draft = loadLabDraft();
    expect(draft).not.toBeNull();
    if (draft) {
      expect(draft.board.isEmpty()).toBe(true);
      expect(draft.turn).toBe('red');
    }
  });

  it('坏 JSON 不抛异常，返回 null', () => {
    localStorage.setItem(LAB_KEY, '{not json at all');
    expect(() => loadLabDraft()).not.toThrow();
    expect(loadLabDraft()).toBeNull();
  });

  it('顶层不是对象时返回 null', () => {
    localStorage.setItem(LAB_KEY, JSON.stringify(['a', 'b']));
    expect(loadLabDraft()).toBeNull();
    localStorage.setItem(LAB_KEY, JSON.stringify(42));
    expect(loadLabDraft()).toBeNull();
    localStorage.setItem(LAB_KEY, JSON.stringify(null));
    expect(loadLabDraft()).toBeNull();
  });

  it('setup 字段类型不对时返回 null', () => {
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup: 123, turn: 'red' }));
    expect(loadLabDraft()).toBeNull();
  });

  it('turn 只接受 red / black', () => {
    const setup: string = '3,9,K,black;4,0,K,red';
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup, turn: 'purple' }));
    expect(loadLabDraft()).toBeNull();
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup }));
    expect(loadLabDraft()).toBeNull();
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup, turn: 'red' }));
    expect(loadLabDraft()).not.toBeNull();
  });

  it('坐标越界（fromSetup 抛错）时整条丢弃', () => {
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup: '99,0,K,red', turn: 'red' }));
    expect(() => loadLabDraft()).not.toThrow();
    expect(loadLabDraft()).toBeNull();
  });

  it('棋子类型/阵营非法时整条丢弃', () => {
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup: '0,0,X,red', turn: 'red' }));
    expect(loadLabDraft()).toBeNull();
    localStorage.setItem(LAB_KEY, JSON.stringify({ setup: '0,0,K,blue', turn: 'red' }));
    expect(loadLabDraft()).toBeNull();
  });

  it('saveLabDraft 写入的正是带版本号的键', () => {
    saveLabDraft(boardOf([[4, 0, 'K'], [3, 9, 'k']]), 'red');
    const raw: string | null = localStorage.getItem(LAB_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw)) as { setup: string; turn: string };
    expect(parsed.turn).toBe('red');
    // toNotationSetup 按 (col asc, row asc) 排序 → col3 的黑将排在前面
    expect(parsed.setup).toBe('3,9,K,black;4,0,K,red');
  });
});
