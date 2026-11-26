/**
 * QA 独立验收：结算页失误分析的模块级缓存命中（重复打开零重算）。
 * 用 vi.mock 统计 analyzeMistakes 调用次数；同一局 history 重开不重算，
 * 不同局面才触发第二次计算。这是 Step4 性能护栏的精确计数证据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const analyzeSpy = vi.fn(async (_history?: unknown, _opts?: unknown, _yieldFrame?: unknown) => ({
  mistakes: [], analyzedPlies: 6, skippedPlies: 0, elapsedMs: 12,
}));

vi.mock('../training/mistakeDetection', () => ({
  analyzeMistakes: (...args: unknown[]) => analyzeSpy(args[0], args[1], args[2]),
}));

import { MatchResultDialog } from '../ui/MatchResultDialog';
import type { Move } from '../engine/types';
import { createInitialState } from '../engine/board';
import { applyMoveToState, generateLegalMoves } from '../engine/rules';

/** 用真实合法着法构造 history，保证 buildMatchSummary 可重放。 */
function legalHistory(coords: ReadonlyArray<readonly [number, number, number, number]>): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [fc, fr, tc, tr] of coords) {
    const m = generateLegalMoves(state.board, state.turn).find((c) =>
      c.from.col === fc && c.from.row === fr && c.to.col === tc && c.to.row === tr);
    if (!m) break;
    state = applyMoveToState(state, m);
    m.notation = `${m.notation}#QA${history.length}`;
    history.push(m);
  }
  return history;
}

const baseProps = {
  open: true,
  annotations: [] as never[],
  playerSide: 'red' as const,
  elapsedSec: 10,
  resultLabel: '对局结束',
  onClose: vi.fn(), onNewGame: vi.fn(), onReview: vi.fn(), onReviewMiss: vi.fn(),
};

afterEach(() => { cleanup(); analyzeSpy.mockClear(); });

describe('结算页失误分析缓存', () => {
  it('同一局反复打开只分析一次（模块 Map 命中零重算）', async () => {
    const history = legalHistory([[0, 0, 0, 1], [1, 7, 1, 3], [0, 1, 2, 1]]);
    const first = render(<MatchResultDialog {...baseProps} history={history} />);
    await waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));
    expect(first.getByText('失误讲解（0）')).toBeTruthy();
    first.unmount();

    analyzeSpy.mockClear();
    const second = render(<MatchResultDialog {...baseProps} history={[...history]} />);
    expect(second.getByText('失误讲解（0）')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 120));
    expect(analyzeSpy).toHaveBeenCalledTimes(0); // 命中缓存，未重算
    second.unmount();
  });

  it('不同局面触发新的分析', async () => {
    // 合法开局前缀，长度不同 => 缓存键不同。
    const h1 = legalHistory([[0, 0, 0, 1], [1, 7, 1, 3], [0, 1, 2, 1], [5, 9, 4, 8]]);
    const h2 = legalHistory([[0, 0, 0, 1], [1, 7, 1, 3], [0, 1, 2, 1], [5, 9, 4, 8], [2, 1, 3, 1]]);
    const a = render(<MatchResultDialog {...baseProps} history={h1} />);
    await waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));
    a.unmount();
    analyzeSpy.mockClear();
    const b = render(<MatchResultDialog {...baseProps} history={h2} />);
    await waitFor(() => expect(analyzeSpy).toHaveBeenCalledTimes(1));
    b.unmount();
  });
});
