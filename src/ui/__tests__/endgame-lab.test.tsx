/**
 * 自摆残局页面集成验证（v2026.11.23.9）。
 *
 * 按用户口述的四步真机流程走一遍：
 *   点托盘棋子 → 点棋盘格 → 棋盘上出现该子；
 *   点「橡皮」 → 点该格 → 子消失；
 *   摆出一个合法残局 → 点「完毕」→ 把起始局面交给推演页（只调一次）；
 *   点主页 → onHome 被调用。
 *
 * 棋盘格用 Board.tsx 新增的 `data-square="col,row"` 定位（逻辑坐标）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EndgameLabPage } from '../EndgameLabPage';
import { LAB_KEY } from '../../endgame/labModel';
import type { GameState } from '../../engine/types';

/** 取棋盘上某个逻辑格（col,row）的 DOM 节点。 */
function square(container: HTMLElement, col: number, row: number): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-square="${col},${row}"]`);
  if (!el) {
    throw new Error(`找不到棋盘格 (${col},${row})`);
  }
  return el;
}

/** 渲染页面并返回两个回调 spy 与容器。 */
function renderPage() {
  const onHome = vi.fn();
  const onStartSimulation = vi.fn<(state: GameState) => void>();
  const utils = render(
    <EndgameLabPage onHome={onHome} onStartSimulation={onStartSimulation} />,
  );
  return { onHome, onStartSimulation, ...utils };
}

/**
 * 点托盘棋子，再点棋盘格落子。
 * 注意：托盘棋子是"再点一次取消选中"的开关，所以这里只在未选中时点它，
 * 否则连续摆同一型棋子时第二次点击会把选中态关掉。
 */
function place(container: HTMLElement, side: 'red' | 'black', type: string, col: number, row: number): void {
  const tile = screen.getByTestId(`lab-tray-${side}-${type}`);
  if (tile.getAttribute('aria-pressed') !== 'true') {
    fireEvent.click(tile);
  }
  fireEvent.click(square(container, col, row));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('托盘摆子', () => {
  it('点棋子再点棋盘，该子出现在目标格', () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByTestId('lab-tray-red-K'));
    fireEvent.click(square(container, 4, 0));
    expect(square(container, 4, 0).textContent).toContain('帅');
  });

  it('没选棋子时点棋盘不会凭空落子', () => {
    const { container } = renderPage();
    fireEvent.click(square(container, 4, 0));
    expect(square(container, 4, 0).textContent).toBe('');
  });

  it('再点一次已选中的棋子会取消选中（点棋盘不再落子）', () => {
    const { container } = renderPage();
    const tile = screen.getByTestId('lab-tray-red-P');
    fireEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(square(container, 0, 3));
    expect(square(container, 0, 3).textContent).toBe('');
  });

  it('放错位置可以用别的子覆盖', () => {
    const { container } = renderPage();
    place(container, 'red', 'R', 0, 0);
    expect(square(container, 0, 0).textContent).toContain('车');
    place(container, 'black', 'P', 0, 0);
    const text: string = square(container, 0, 0).textContent ?? '';
    expect(text).toContain('卒');
    expect(text).not.toContain('车');
  });

  it('同一型放满后托盘项置灰（aria-disabled）', () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByTestId('lab-tray-red-K'));
    fireEvent.click(square(container, 4, 0));
    // 帅上限 1 枚 → 放完自动取消选中并置灰
    expect(screen.getByTestId('lab-tray-red-K')).toHaveAttribute('aria-disabled', 'true');
  });

  it('点击后把草稿写进 localStorage', () => {
    const { container } = renderPage();
    place(container, 'red', 'K', 4, 0);
    const raw: string | null = localStorage.getItem(LAB_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(String(raw)) as { setup: string; turn: string };
    expect(parsed.turn).toBe('red');
    expect(parsed.setup).toContain('4,0,K,red');
  });
});

describe('橡皮与撤销', () => {
  it('点橡皮再点棋子，子被删除', () => {
    const { container } = renderPage();
    place(container, 'red', 'R', 0, 0);
    expect(square(container, 0, 0).textContent).toContain('车');

    fireEvent.click(screen.getByTestId('lab-erase'));
    fireEvent.click(square(container, 0, 0));
    expect(square(container, 0, 0).textContent).toBe('');
  });

  it('撤销一步能恢复刚擦掉的子', () => {
    const { container } = renderPage();
    place(container, 'red', 'R', 0, 0);
    fireEvent.click(screen.getByTestId('lab-erase'));
    fireEvent.click(square(container, 0, 0));
    expect(square(container, 0, 0).textContent).toBe('');

    fireEvent.click(screen.getByTestId('lab-undo'));
    expect(square(container, 0, 0).textContent).toContain('车');
  });

  it('清空后可以用撤销恢复', () => {
    const { container } = renderPage();
    place(container, 'red', 'K', 4, 0);
    fireEvent.click(screen.getByTestId('lab-clear'));
    expect(square(container, 4, 0).textContent).toBe('');
    fireEvent.click(screen.getByTestId('lab-undo'));
    expect(square(container, 4, 0).textContent).toContain('帅');
  });
});

describe('完毕后交给推演页', () => {
  it('合法残局点完毕 → onStartSimulation 只调一次，先手为红', () => {
    const { container, onStartSimulation } = renderPage();
    place(container, 'red', 'K', 4, 0);
    place(container, 'black', 'K', 3, 9);
    place(container, 'red', 'R', 0, 0);

    fireEvent.click(screen.getByTestId('lab-finish'));

    expect(onStartSimulation).toHaveBeenCalledTimes(1);
    const state = onStartSimulation.mock.calls[0][0];
    expect(state.turn).toBe('red');
    expect(state.history).toEqual([]);
    expect(state.moveCount).toBe(0);
    expect(state.board.getPiece({ col: 0, row: 0 })).toEqual({ type: 'R', side: 'red' });
    // 没有校验错误条
    expect(screen.queryByTestId('lab-validation')).toBeNull();
  });

  it('切到黑先再点完毕 → state.turn 为 black', () => {
    const { container, onStartSimulation } = renderPage();
    place(container, 'red', 'K', 4, 0);
    place(container, 'black', 'K', 3, 9);
    place(container, 'red', 'R', 0, 0);

    fireEvent.click(screen.getByTestId('lab-turn-black'));
    fireEvent.click(screen.getByTestId('lab-finish'));

    expect(onStartSimulation).toHaveBeenCalledTimes(1);
    expect(onStartSimulation.mock.calls[0][0].turn).toBe('black');
  });

  it('局面不合法时列出全部错误且不跳转', () => {
    const { container, onStartSimulation } = renderPage();
    // 只有一枚红车：双方都缺将 → C2
    place(container, 'red', 'R', 0, 0);

    fireEvent.click(screen.getByTestId('lab-finish'));

    expect(onStartSimulation).not.toHaveBeenCalled();
    const alert = screen.getByTestId('lab-validation');
    expect(alert.textContent).toContain('C2');
  });

  it('绝杀局面被拦下并给出人话提示', () => {
    const { container, onStartSimulation } = renderPage();
    place(container, 'red', 'K', 4, 0);
    place(container, 'black', 'K', 4, 9);
    place(container, 'black', 'R', 0, 0);
    place(container, 'black', 'R', 4, 5);

    fireEvent.click(screen.getByTestId('lab-finish'));

    expect(onStartSimulation).not.toHaveBeenCalled();
    expect(screen.getByTestId('lab-validation').textContent).toContain('终局');
  });
});

describe('主页出口', () => {
  it('点主页按钮调用 onHome', () => {
    const { onHome } = renderPage();
    fireEvent.click(screen.getByTestId('lab-home'));
    expect(onHome).toHaveBeenCalledTimes(1);
  });
});

describe('草稿恢复', () => {
  it('挂载时恢复上一次摆的局面', () => {
    localStorage.setItem(
      LAB_KEY,
      JSON.stringify({ setup: '4,0,K,red;3,9,K,black', turn: 'black' }),
    );
    const { container } = renderPage();
    expect(square(container, 4, 0).textContent).toContain('帅');
    expect(square(container, 3, 9).textContent).toContain('将');
    // 先手也被恢复：黑先 chip 处于选中态
    expect(screen.getByTestId('lab-turn-black')).toHaveAttribute('aria-pressed', 'true');
  });

  it('草稿损坏时页面照常渲染（空盘，不崩）', () => {
    localStorage.setItem(LAB_KEY, '{broken');
    const { container } = renderPage();
    expect(square(container, 4, 0).textContent).toBe('');
    expect(screen.getByTestId('lab-finish')).toBeInTheDocument();
  });
});
