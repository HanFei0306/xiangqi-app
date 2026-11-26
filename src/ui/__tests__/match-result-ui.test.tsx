/**
 * 结算页重设计验收（v2026.11.23.5）：
 * 四个底部主按钮及回调、新的一局回设置页回调、深绿底浅字对比度、既有区块保留。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const analyzeSpy = vi.fn(async (_history?: unknown, _opts?: unknown, _yieldFrame?: unknown) => ({
  mistakes: [], analyzedPlies: 0, skippedPlies: 0, elapsedMs: 0,
}));

vi.mock('../../training/mistakeDetection', () => ({
  analyzeMistakes: (...args: unknown[]) => analyzeSpy(...args),
}));

import { MatchResultDialog } from '../MatchResultDialog';
import type { Move } from '../../engine/types';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import { MATCH_BG_SOLID, MATCH_GOLD, MATCH_TEXT } from '../theme';

/** 真实合法着法，保证 buildMatchSummary 可重放且复盘按钮可用。 */
function legalHistory(coords: ReadonlyArray<readonly [number, number, number, number]>): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [fc, fr, tc, tr] of coords) {
    const move = generateLegalMoves(state.board, state.turn).find((m) =>
      m.from.col === fc && m.from.row === fr && m.to.col === tc && m.to.row === tr);
    if (!move) break;
    state = applyMoveToState(state, move);
    history.push(move);
  }
  return history;
}

const history = legalHistory([[0, 0, 0, 1], [1, 7, 1, 3]]);

function makeProps() {
  return {
    open: true,
    history,
    annotations: [],
    playerSide: 'red' as const,
    elapsedSec: 75,
    resultLabel: '红方胜（将死黑方）',
    onClose: vi.fn(),
    onNewGame: vi.fn(),
    onReview: vi.fn(),
    onReviewMiss: vi.fn(),
    onNewSetup: vi.fn(),
  };
}

/** WCAG 相对亮度与对比度：用于证明绿底浅字真的看得清。 */
function relativeLuminance(hex: string): number {
  const channels: number[] = [1, 3, 5].map((start) => {
    const raw: number = parseInt(hex.slice(start, start + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(fg: string, bg: string): number {
  const a: number = relativeLuminance(fg);
  const b: number = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

afterEach(() => {
  cleanup();
  analyzeSpy.mockClear();
});

describe('结算页四按钮（v2026.11.23.5）', () => {
  it('底部固定四个大按钮，顺序为 再来一局 / 新的一局 / 复盘分析 / 分享', () => {
    render(<MatchResultDialog {...makeProps()} />);
    for (const label of ['再来一局', '新的一局', '复盘分析', '分享']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    const actions = screen.getByTestId('result-actions');
    expect(Array.from(actions.children).map((el) => el.getAttribute('data-testid'))).toEqual([
      'result-action-replay',
      'result-action-new-setup',
      'result-action-review',
      'result-action-share',
    ]);
  });

  it('四个按钮分别调用正确回调：新的一局走 onNewSetup 而非 onClose', () => {
    const props = makeProps();
    render(<MatchResultDialog {...props} />);
    fireEvent.click(screen.getByTestId('result-action-replay'));
    fireEvent.click(screen.getByTestId('result-action-new-setup'));
    fireEvent.click(screen.getByTestId('result-action-review'));

    expect(props.onNewGame).toHaveBeenCalledTimes(1);
    expect(props.onNewSetup).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onReview).toHaveBeenCalledTimes(1);
  });

  it('分享仍复制棋谱到剪贴板并弹出 toast', async () => {
    const writeText = vi.fn(async (_text?: string) => undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<MatchResultDialog {...makeProps()} />);
    fireEvent.click(screen.getByTestId('result-action-share'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('红方胜（将死黑方）');
    await waitFor(() => expect(screen.getByText('棋谱已复制到剪贴板')).toBeInTheDocument());
  });

  it('未提供 onNewSetup 时，新的一局退化为 onClose（向后兼容）', () => {
    const props = makeProps();
    const { onNewSetup: _ignored, ...withoutSetup } = props;
    render(<MatchResultDialog {...withoutSetup} />);
    fireEvent.click(screen.getByTestId('result-action-new-setup'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮保留原关闭路径', () => {
    const props = makeProps();
    render(<MatchResultDialog {...props} />);
    fireEvent.click(screen.getByTestId('result-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('结算页配色与既有区块', () => {
  it('深绿背景上的正文/强调字对比度均 >= 4.5:1，且结算页实际使用浅字', () => {
    expect(contrastRatio(MATCH_TEXT, MATCH_BG_SOLID)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(MATCH_GOLD, MATCH_BG_SOLID)).toBeGreaterThanOrEqual(4.5);
    render(<MatchResultDialog {...makeProps()} />);
    const heading: HTMLElement = screen.getByTestId('result-heading');
    expect(heading).toHaveStyle(`color: ${MATCH_TEXT}`);
    expect(screen.getByText('总步数')).toBeInTheDocument();
    expect(screen.getByText('1分15秒')).toBeInTheDocument();
  });

  it('保存棋谱 / 漏杀分析 / 失误讲解 / 书法抬头全部保留', () => {
    render(<MatchResultDialog {...makeProps()} />);
    expect(screen.getByText('保存这盘棋谱')).toBeInTheDocument();
    expect(screen.getByLabelText('棋谱名称（日期时间已自动填入）')).toBeInTheDocument();
    expect(screen.getByText('漏杀分析（0）')).toBeInTheDocument();
    expect(screen.getByText('失误讲解（0）')).toBeInTheDocument();
    expect(screen.getByText('棋 局 已 终')).toBeInTheDocument();
  });
});
