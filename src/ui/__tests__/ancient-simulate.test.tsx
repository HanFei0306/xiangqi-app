/**
 * 《适情雅趣》残局页「推演」入口验收。
 *
 * 覆盖四件事：
 * 1. 「推演」按钮存在且可用（不传 onSimulate 时置灰）；
 * 2. 传出的 GameState 是当前盘面的正确快照（红先、history 空、棋盘逐格一致、
 *    且是 clone——改了它不影响原页面）；
 * 3. 红方走一步后传出的是黑先局面（turn 跟随 moves.length 奇偶）；
 * 4. 「最后打开的局」被持久化——重新挂载后回到那一局，而不是闯关进度那局；
 * 5. 进入推演会撤销已预约的黑方幽灵应手（300ms 后页面着法不增加）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { GameState } from '../../engine/types';
import { parseSetup } from '../../engine/board';
import { AncientPracticePage } from '../AncientPracticePage';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import { loadLastOrder, resetProgress } from '../../data/ancient-progress';

const LAST_ORDER_KEY = 'xiangqi-trainer:ancient-last-order-v1';

beforeEach(() => {
  resetProgress();
  try {
    localStorage.removeItem(LAST_ORDER_KEY);
  } catch {
    /* jsdom 下不会发生，防御式清理。 */
  }
});

afterEach(() => {
  cleanup();
  try {
    localStorage.removeItem(LAST_ORDER_KEY);
  } catch {
    /* 同上。 */
  }
});

function square(container: HTMLElement, key: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-square="${key}"]`);
  if (!el) throw new Error(`square ${key} not found`);
  return el;
}

/** 数一个棋盘上的棋子总数（逐格 getPiece）。 */
function pieceCount(board: ReturnType<typeof parseSetup>): number {
  let count = 0;
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      if (board.getPiece({ col, row })) count += 1;
    }
  }
  return count;
}

describe('适情雅趣推演入口', () => {
  it('推演按钮存在；不传 onSimulate 时置灰，传入后点击恰好回调一次', () => {
    // 不传 onSimulate：按钮渲染但 disabled（旧行为完全保留）。
    render(<AncientPracticePage />);
    const button = screen.getByTestId('ancient-simulate');
    expect(button).toHaveTextContent('推演');
    expect(button).toBeDisabled();
    cleanup();

    // 传入 onSimulate：可点，且恰好回调 1 次。
    const spy = vi.fn();
    render(<AncientPracticePage onSimulate={spy} />);
    fireEvent.click(screen.getByTestId('ancient-simulate'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('传出的局面正确：红先、history 空、棋盘逐格等于第1局 setup，且是 clone', () => {
    const spy = vi.fn<(state: GameState) => void>();
    const { container } = render(<AncientPracticePage onSimulate={spy} />);
    fireEvent.click(screen.getByTestId('ancient-simulate'));

    expect(spy).toHaveBeenCalledTimes(1);
    const state: GameState = spy.mock.calls[0][0];

    // 新载入的局是红先；解法进度为空。
    expect(state.turn).toBe('red');
    expect(state.history).toHaveLength(0);
    expect(state.moveCount).toBe(0);
    expect(state.status).toBe('playing');

    // 逐格比对：与第1局 setup 解析出的棋盘完全一致。
    const expected = parseSetup(SHIQINGYAQU[0].setup);
    expect(pieceCount(state.board)).toBe(pieceCount(expected));
    for (let col = 0; col < 9; col++) {
      for (let row = 0; row < 10; row++) {
        expect(state.board.getPiece({ col, row })).toEqual(
          expected.getPiece({ col, row }),
        );
      }
    }

    // clone 证明：改传出的棋盘（拿掉 4,4 的红炮），原页面棋盘纹丝不动。
    state.board.setPiece({ col: 4, row: 4 }, null);
    const pageSquare = square(container, '4,4');
    expect(pageSquare.textContent).toContain('炮');
  });

  it('红方走一步（炮五平九）后传出黑先局面，history 带着这一着', () => {
    const spy = vi.fn<(state: GameState) => void>();
    const { container } = render(<AncientPracticePage onSimulate={spy} />);

    // 第1局正解首着：炮五平九 = (4,4) -> (0,4)。走完 moves.length = 1（黑先）。
    fireEvent.click(square(container, '4,4'));
    fireEvent.click(square(container, '0,4'));
    fireEvent.click(screen.getByTestId('ancient-simulate'));

    expect(spy).toHaveBeenCalledTimes(1);
    const state: GameState = spy.mock.calls[0][0];
    expect(state.turn).toBe('black');
    expect(state.history).toHaveLength(1);
    expect(state.moveCount).toBe(1);
    // 页面层保存的着法不带 notation（落子时由 UI 层展示），锁定坐标与棋子。
    expect(state.history[0].from).toEqual({ col: 4, row: 4 });
    expect(state.history[0].to).toEqual({ col: 0, row: 4 });
    expect(state.history[0].piece).toBe('C');
  });

  it('最后打开的局会被记住：重挂载回到那一局，而不是闯关进度那局', () => {
    // 从第1局点「下一局」换到第2局。
    render(<AncientPracticePage />);
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一局' }));
    expect(screen.getByRole('heading', { name: '第2局 · 马蹀阏氏' })).toBeInTheDocument();
    expect(loadLastOrder()).toBe(SHIQINGYAQU[1].order);
    cleanup();

    // 闯关进度仍是第 1 关（progress.current = 0），但 last-order 已指向第2局。
    // 重挂载后应回到第2局。
    render(<AncientPracticePage />);
    expect(screen.getByRole('heading', { name: '第2局 · 马蹀阏氏' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '第1局 · 气吞关右' })).not.toBeInTheDocument();
  });

  it('进入推演会撤销幽灵应手：300ms 后页面着法数不增加', async () => {
    const spy = vi.fn<(state: GameState) => void>();
    const { container } = render(<AncientPracticePage onSimulate={spy} />);

    // 红方走一步：正解首着会预约一条 300ms 的黑方应手（马七进五）。
    fireEvent.click(square(container, '4,4'));
    fireEvent.click(square(container, '0,4'));
    // 传出时 history 只有红着这一条——应手被当场撤销。
    fireEvent.click(screen.getByTestId('ancient-simulate'));
    expect(spy.mock.calls[0][0].history).toHaveLength(1);

    // 等过幽灵应手的触发点，页面不得自己走子。
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(spy).toHaveBeenCalledTimes(1); // 没有第二次推演快照，页面也没有新着
  });
});
