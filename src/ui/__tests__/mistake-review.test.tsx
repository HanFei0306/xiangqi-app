/** 结算页失误讲解卡：五段结构、空态、演示按钮与残缺数据不白屏。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInitialState } from '../../engine/board';
import type { Move } from '../../engine/types';
import { MatchResultDialog } from '../MatchResultDialog';
import { MistakeReviewList, type MistakeCardData } from '../MistakeReviewList';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function card(): MistakeCardData {
  return {
    ply: 11,
    playedNotation: '马八进七',
    grade: 'blunder',
    type: 'T1',
    verdict: '白送一子',
    why: '这个子走到了对方能吃到的位置，而你没有足够保护。子力是形势的本钱，无代价丢子通常直接改变胜负。',
    advice: '落子前先看：对方下一步能吃我什么？',
    wpl: 18.3,
    wplBest: 8.1,
    bestNotation: '车九进一',
    beforeState: createInitialState('red'),
  };
}

describe('MistakeReviewList', () => {
  it('renders the empty state verbatim when there are no mistakes', () => {
    render(<MistakeReviewList entries={[]} />);
    expect(screen.getByText('失误讲解（0）')).toBeInTheDocument();
    expect(screen.getByText('本局没有明显失误，保持得很好。')).toBeInTheDocument();
  });

  it('摘要行无需展开即可一键跳到失误前节点，并携带正解着法', () => {
    const onReview = vi.fn();
    const sample = card();
    render(<MistakeReviewList cards={[sample]} onReview={onReview} />);

    // 未展开卡片时按钮就已经在摘要行上，与漏杀「进入棋盘，重走这一手」同层级。
    const jump = screen.getByTestId('review-this-move');
    expect(jump).toHaveTextContent('看这一手');
    fireEvent.click(jump);

    expect(onReview).toHaveBeenCalledTimes(1);
    const [state, notation, options] = onReview.mock.calls[0];
    expect(state).toBe(sample.beforeState);
    expect(state.board.getPiece({ col: 4, row: 0 })?.type).toBe('K');
    expect(notation).toBe('车九进一');
    expect(options?.mode).toBe('move');
    // 摘要行同时给出「你走的 vs 建议」的轻量对照。
    expect(screen.getByText('建议「车九进一」')).toBeInTheDocument();
  });

  it('shows a five-part accordion card and calls onReview with state + best notation', () => {
    const onReview = vi.fn();
    render(<MistakeReviewList cards={[card()]} onReview={onReview} />);
    expect(screen.getByText('第 12 手：你走了「马八进七」')).toBeInTheDocument();
    fireEvent.click(screen.getByText('第 12 手：你走了「马八进七」'));

    for (const label of ['① 你走了什么', '② 问题定性', '③ 应该走', '④ 为什么', '⑤ 演示正解']) {
      expect(screen.getByText(new RegExp(label.replace('①', '①')))).toBeInTheDocument();
    }
    expect(screen.getByText(/这里应该走「车九进一」/)).toBeInTheDocument();
    expect(screen.getByText(/子力是形势的本钱/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('demo-best'));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(onReview.mock.calls[0][1]).toBe('车九进一');
    expect(onReview.mock.calls[0][2]?.mode).toBe('move');
    expect(onReview.mock.calls[0][0].board.getPiece({ col: 4, row: 0 })?.type).toBe('K');
  });
});

describe('结算页冒烟', () => {
  const baseProps = {
    open: true,
    history: [] as Move[],
    annotations: [],
    playerSide: 'red' as const,
    elapsedSec: 0,
    resultLabel: '对局结束',
    onClose: vi.fn(),
    onNewGame: vi.fn(),
    onReview: vi.fn(),
    onReviewMiss: vi.fn(),
  };

  it('zero plies and malformed annotations do not white-screen', () => {
    render(<MatchResultDialog
      {...baseProps}
      annotations={[{ moveIndex: 0 } as never]}
    />);
    expect(screen.getByText('失误讲解（0）')).toBeInTheDocument();
    expect(screen.getByText('本局没有明显失误，保持得很好。')).toBeInTheDocument();
  });

  it('corrupted localStorage does not break the result dialog', () => {
    localStorage.setItem('xiangqi-trainer:notations-v1', '{broken json');
    render(<MatchResultDialog {...baseProps} />);
    expect(screen.getByText('漏杀分析（0）')).toBeInTheDocument();
    expect(screen.getByText('失误讲解（0）')).toBeInTheDocument();
  });

  it('失误区排在漏杀区之前且二者相邻（保存棋谱退到后面）', () => {
    render(<MatchResultDialog {...baseProps} />);
    const content = screen.getByTestId('result-content');
    const mistake = screen.getByTestId('mistake-review');
    const missed = screen.getByTestId('missed-mates-review');
    expect(content.contains(mistake)).toBe(true);
    expect(content.contains(missed)).toBe(true);
    expect(mistake.compareDocumentPosition(missed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mistake.nextElementSibling).toBe(missed);
    const children = Array.from(content.children);
    expect(children.indexOf(mistake)).toBeLessThan(children.indexOf(missed));
    expect(children.indexOf(screen.getByText('保存这盘棋谱')))
      .toBeGreaterThan(children.indexOf(missed));
  });
});
