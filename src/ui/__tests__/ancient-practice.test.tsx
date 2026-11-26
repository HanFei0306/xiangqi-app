/**
 * Task #5 验收：《适情雅趣》练习页。
 * 覆盖 548 局分页/搜索、逐步提示状态机、自由试走的温和提示与黑应手、
 * 悔棋/重置，以及 PracticePage 直接进入适情雅趣的接入。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PracticePage } from '../PracticePage';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import {
  emptyProgress,
  loadProgress,
  resetProgress,
  saveProgress,
} from '../../data/ancient-progress';
import { generateLegalMoves } from '../../engine/rules';
import {
  PAGE_SIZE,
  NOT_WRONG_TEXT,
  advanceAncientHint,
  ancientBlackReply,
  ancientMoveNotice,
  ancientUndoLength,
  cloneAncientMove,
  commonBookPrefix,
  filterAncientPuzzles,
  replayAncientMoves,
  sameAncientMove,
} from '../AncientPracticePage';

// 闯关进度是跨会话持久化的；本套用例各自从第 1 关开始，故显式清空。
beforeEach(() => {
  resetProgress();
});

afterEach(() => {
  cleanup();
});

function openAncientTab(): void {
  render(<PracticePage />);
  fireEvent.click(screen.getByRole('tab', { name: '适情雅趣 (548)' }));
}

function puzzleByOrder(order: number) {
  const found = SHIQINGYAQU.find((p) => p.order === order);
  if (!found) throw new Error(`missing puzzle ${order}`);
  return found;
}

describe('适情雅趣数据与纯函数', () => {
  it('548 局严格按原版局号升序，首局为第1局 气吞关右', () => {
    expect(SHIQINGYAQU).toHaveLength(548);
    expect(SHIQINGYAQU[0].order).toBe(1);
    expect(SHIQINGYAQU[0].title).toBe('气吞关右');
    expect(SHIQINGYAQU[SHIQINGYAQU.length - 1].order).toBe(550);
    for (let i = 1; i < SHIQINGYAQU.length; i++) {
      expect(SHIQINGYAQU[i].order).toBeGreaterThan(SHIQINGYAQU[i - 1].order);
    }
  });

  it('按局号或局名搜索，空查询返回全部 548 局', () => {
    expect(filterAncientPuzzles('')).toHaveLength(548);
    expect(filterAncientPuzzles('气吞关右').map((p) => p.order)).toEqual([1]);
    expect(filterAncientPuzzles('550').map((p) => p.order)).toEqual([550]);
    expect(filterAncientPuzzles('第1局')[0].order).toBe(1);
  });

  it('commonBookPrefix 只统计与正解一致的连续着法', () => {
    const solution = puzzleByOrder(1).solution;
    expect(commonBookPrefix(solution.slice(0, 3), solution)).toBe(3);
    expect(commonBookPrefix([], solution)).toBe(0);
    const wrong = { ...cloneAncientMove(solution[1]), to: { col: 0, row: 0 } };
    expect(commonBookPrefix([cloneAncientMove(solution[0]), wrong], solution)).toBe(1);
  });

  it('advanceAncientHint 高亮 -> 走出并高亮下一着 -> 演示完毕', () => {
    expect(advanceAncientHint(3, 0, null, false)).toEqual({ kind: 'highlight', index: 0 });
    expect(advanceAncientHint(3, 0, 0, false)).toEqual({
      kind: 'play', index: 0, nextHighlight: 1,
    });
    expect(advanceAncientHint(3, 1, 1, false)).toEqual({
      kind: 'play', index: 1, nextHighlight: 2,
    });
    expect(advanceAncientHint(3, 2, 2, false)).toEqual({
      kind: 'play', index: 2, nextHighlight: null,
    });
    expect(advanceAncientHint(3, 3, null, false)).toEqual({ kind: 'done' });
    expect(advanceAncientHint(3, 0, 0, true)).toEqual({ kind: 'realign' });
  });

  it('ancientUndoLength 一次回退到红方行棋前', () => {
    expect(ancientUndoLength(0)).toBe(0);
    // 1 着（红已走）= 退 1 着；2 着（完整回合）= 退 2 着。
    expect(ancientUndoLength(1)).toBe(0);
    expect(ancientUndoLength(2)).toBe(0);
    expect(ancientUndoLength(3)).toBe(2);
    expect(ancientUndoLength(4)).toBe(2);
  });

  it('走错正解给出温和提示但不判负；走对则播放正解黑应手', () => {
    const p = puzzleByOrder(1);
    const board = replayAncientMoves(p.setup, []);
    const wrong = generateLegalMoves(board, 'red').find(
      (m) => !sameAncientMove(m, p.solution[0]),
    );
    expect(wrong).toBeDefined();
    expect(ancientMoveNotice(p.solution[0], wrong!)).toEqual({
      tone: 'warn', text: NOT_WRONG_TEXT,
    });
    expect(ancientMoveNotice(p.solution[0], p.solution[0]).tone).toBe('info');

    const expectedReply = ancientBlackReply(
      p.setup, [cloneAncientMove(p.solution[0])], p.solution, 0, true,
    );
    expect(expectedReply && sameAncientMove(expectedReply, p.solution[1])).toBe(true);
    // v19.8: off-book replies now come from the real endgame AI. Inject a
    // deterministic stand-in here so this pure-function test stays fast.
    const freeReply = ancientBlackReply(
      p.setup, [cloneAncientMove(wrong!)], p.solution, 0, false,
      (board) => generateLegalMoves(board, 'black')[1] ?? null,
    );
    expect(freeReply).not.toBeNull();
  });

  it('replayAncientMoves 不改写题库着法, 正确从第550局 setup 走出帅五进一', () => {
    const p = puzzleByOrder(550);
    const before = JSON.stringify(p.solution);
    const board0 = replayAncientMoves(p.setup, []);
    expect(board0.getPiece({ col: 4, row: 0 })?.type).toBe('K');
    const board1 = replayAncientMoves(p.setup, p.solution);
    expect(board1.getPiece({ col: 4, row: 0 })).toBeNull();
    expect(board1.getPiece({ col: 4, row: 1 })?.type).toBe('K');
    expect(JSON.stringify(p.solution)).toBe(before);
  });
});

describe('PracticePage 接入适情雅趣', () => {
  it('直接进入适情雅趣 (548)，不再保留残局/开局内置题 Tab', () => {
    render(<PracticePage />);
    expect(screen.queryByRole('tab', { name: /^残局 \(/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^开局 \(/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '适情雅趣 (548)' })).toBeInTheDocument();
    expect(screen.getByText('适情雅趣 · 共 548 局')).toBeInTheDocument();
  });

  it('局列表按 order 升序分页，每页 50 条，首项是第1局 气吞关右', () => {
    openAncientTab();
    // 进入残局默认棋盘页且已载入第1局；「残局目录」进入独立目录页。
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    expect(screen.getByText('适情雅趣 · 共 548 局')).toBeInTheDocument();
    const items = screen.getAllByRole('button', { name: /^第\d+局 / });
    expect(items).toHaveLength(PAGE_SIZE);
    expect(items[0]).toHaveAttribute('aria-label', '第1局 气吞关右');
    expect(items[0]).toHaveAttribute('title', '第1局 气吞关右');

    // 翻到第 2 页：第一项应为第 51 局。
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    const p51 = SHIQINGYAQU[PAGE_SIZE];
    expect(
      screen.getAllByRole('button', { name: /^第\d+局 / })[0],
    ).toHaveAttribute('aria-label', `第${p51.order}局 ${p51.title}`);
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    expect(
      screen.getAllByRole('button', { name: /^第\d+局 / })[0],
    ).toHaveAttribute('aria-label', '第1局 气吞关右');

    // 从目录点首局 -> 回到棋盘页并载入该局。
    fireEvent.click(screen.getAllByRole('button', { name: /^第\d+局 / })[0]);
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
  });

  it('搜索按局名/局号过滤，上下局切换自动翻页', () => {
    openAncientTab();
    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    fireEvent.change(screen.getByLabelText('搜索适情雅趣残局'), {
      target: { value: '气吞关右' },
    });
    const items = screen.getAllByRole('button', { name: /^第\d+局 / });
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('aria-label', '第1局 气吞关右');
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();

    fireEvent.click(items[0]);
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一局' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '下一局' }));
    expect(screen.getByRole('heading', { name: '第2局 · 马蹀阏氏' })).toBeInTheDocument();
  });

  it('独立目录页列出全部 548 局，选任意局即回棋盘并加载对应局面/进度归零', () => {
    openAncientTab();
    // 默认棋盘页 + 第1局
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    expect(screen.getByText('适情雅趣 · 共 548 局')).toBeInTheDocument();
    expect(screen.getByText('第 1 / 11 页')).toBeInTheDocument();

    // 搜索并跳转第 300 局，验证棋盘正确载入且进度/提示归零。
    const p300 = SHIQINGYAQU.find((p) => p.order === 300);
    expect(p300).toBeDefined();
    fireEvent.change(screen.getByLabelText('搜索适情雅趣残局'), {
      target: { value: '300' },
    });
    const item = screen.getByRole('button', { name: `第300局 ${p300!.title}` });
    fireEvent.click(item);
    expect(screen.queryByLabelText('搜索适情雅趣残局')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: `第300局 · ${p300!.title}` })).toBeInTheDocument();
    expect(screen.getByText(/解法进度：第\s*0\s*\/\s*\d+\s*步/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '悔棋' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled();

    // 目录页可再次打开（保留上次搜索）并返回棋盘
    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    expect(screen.getByLabelText('搜索适情雅趣残局')).toHaveValue('300');
    fireEvent.click(screen.getByRole('button', { name: '返回棋盘' }));
    expect(screen.getByRole('heading', { name: `第300局 · ${p300!.title}` })).toBeInTheDocument();
  });

  it('重新打开从已保存进度续关，目录可继续闯关并重置进度', () => {
    const target = SHIQINGYAQU[3];
    saveProgress({ current: 3, solved: [0, 1, 2], updatedAt: 123 });

    openAncientTab();
    expect(screen.getByRole('heading', { name: `第${target.order}局 · ${target.title}` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    fireEvent.click(screen.getByRole('button', { name: /继续闯关（第 4 关）/ }));
    expect(screen.getByRole('heading', { name: `第${target.order}局 · ${target.title}` })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    fireEvent.click(screen.getByRole('button', { name: '重置进度' }));
    expect(loadProgress()).toEqual(emptyProgress());
    expect(screen.getByRole('button', { name: /继续闯关（第 1 关）/ })).toBeInTheDocument();
  });
});

describe('逐步提示与自由试走交互', () => {
  it('单步局：两次点击演示完整解法并显示「解法演示完毕」', () => {
    openAncientTab();
    fireEvent.click(screen.getByRole('button', { name: '残局目录' }));
    fireEvent.change(screen.getByLabelText('搜索适情雅趣残局'), {
      target: { value: '550' },
    });
    fireEvent.click(screen.getByRole('button', { name: '第550局 势不两大' }));
    expect(screen.getByRole('heading', { name: '第550局 · 势不两大' })).toBeInTheDocument();
    expect(screen.getByText(/解法进度：第\s*0\s*\/\s*1\s*步/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(screen.getByText('高亮着法：帅五进一')).toBeInTheDocument();
    expect(screen.getByText(/提示：第 1 着/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(screen.getByText('解法演示完毕')).toBeInTheDocument();
    expect(screen.getByText(/解法进度：第\s*1\s*\/\s*1\s*步/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    expect(screen.getByText(/解法进度：第\s*0\s*\/\s*1\s*步/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重置' })).toBeDisabled();
  });

  it('长解局：每点一次提示推进半回合，进度条同步', () => {
    openAncientTab();
    const p1 = puzzleByOrder(1);
    expect(screen.getByText(/解法进度：第\s*0\s*\/\s*11\s*步/)).toBeInTheDocument();

    // 第1次高亮红着；第2次走出红着并高亮黑着；第3次走出黑着。
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(screen.getByText('高亮着法：炮五平九')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(screen.getByText(/解法进度：第\s*1\s*\/\s*11\s*步/)).toBeInTheDocument();
    expect(screen.getByText('高亮着法：马七进五')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(screen.getByText(/解法进度：第\s*2\s*\/\s*11\s*步/)).toBeInTheDocument();

    // 余下着法逐步走完。
    for (let i = 2; i < p1.solution.length; i++) {
      fireEvent.click(screen.getByRole('button', { name: '提示' }));
    }
    expect(screen.getByText('解法演示完毕')).toBeInTheDocument();
    expect(screen.getByText(/解法进度：第\s*11\s*\/\s*11\s*步/)).toBeInTheDocument();
  });

  it('重置回到初始局面并清空进度', () => {
    openAncientTab();
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(screen.getByText(/解法进度：第\s*1\s*\/\s*11\s*步/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(screen.getByText(/解法进度：第\s*0\s*\/\s*11\s*步/)).toBeInTheDocument();
    expect(screen.getByText('已重置到初始局面，红方先行。')).toBeInTheDocument();
  });
});
