/**
 * v2026.11.23.9 端到端接线验收（真实 <App>，不是组件桩）。
 *
 * 覆盖用户本轮报的两件事的**接线层**（组件内部逻辑另有
 * simulation-reset-root.test.tsx / ancient-simulate.test.tsx 覆盖）：
 *
 *  1. 适情雅趣主操作行有「推演」，点了真的能进推演页；
 *  2. 进去的是「双人手动」模式：标题「自由推演」、有手动说明、AI 三个入口全部消失；
 *  3. 推演页「重置」回到的是**适情雅趣那个残局**，不是标准开局
 *     （判别法：标准开局在 (4,4) 是空点，而这个残局在 (4,4) 有红炮；
 *      棋子总数 25 枚，标准开局是 32 枚）；
 *  4. 从推演页点「返回」回到练习页后，仍停在刚才那一局（不会被闯关进度拽回第 1 局）。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from '../../App';
import { useSimulationStore } from '../../store/simulationStore';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';

const STATUS_KEY = 'xiangqi-trainer:ancient-progress-v1';
const LAST_ORDER_KEY = 'xiangqi-trainer:ancient-last-order-v1';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  useSimulationStore.getState().reset();
  useGameStore.getState().newGame();
  useSettings.setState({ difficulty: 'beginner', playerSide: 'red', soundEnabled: false });
  localStorage.removeItem(STATUS_KEY);
  localStorage.removeItem(LAST_ORDER_KEY);
});

/**
 * 从适情雅趣进推演后，练习页是「隐藏」而不是「卸载」，所以 DOM 里会同时存在
 * 两块棋盘（练习页那块 display:none + 推演页那块）。取格子时必须指明看哪一块，
 * 否则会把两块棋盘的棋子数加在一起。
 */
type Scope = 'sim' | 'practice';

function squaresIn(container: HTMLElement, scope: Scope): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('div[data-square]')).filter((el) => {
    const inPractice = el.closest('[data-testid="practice-root"]') !== null;
    return scope === 'practice' ? inPractice : !inPractice;
  });
}

/** 数棋盘上的棋子数（只看格子层，忽略落子动画层里的临时棋子）。 */
function countPieces(container: HTMLElement, scope: Scope = 'sim'): number {
  return squaresIn(container, scope).filter((el) => (el.textContent ?? '').trim().length > 0).length;
}

/** 取某个格子的文字（棋子字），空格返回空串。 */
function squareText(container: HTMLElement, col: number, row: number, scope: Scope = 'sim'): string {
  const el = squaresIn(container, scope)
    .find((s) => s.getAttribute('data-square') === `${col},${row}`);
  return (el?.textContent ?? '').trim();
}

function clickSquare(container: HTMLElement, col: number, row: number, scope: Scope = 'sim') {
  const el = squaresIn(container, scope)
    .find((s) => s.getAttribute('data-square') === `${col},${row}`);
  if (!el) throw new Error(`找不到格子 ${col},${row}（scope=${scope}）`);
  fireEvent.click(el);
}

/** 主页 → 适情雅趣。 */
function openAncient() {
  const view = render(<App />);
  fireEvent.click(screen.getByText('适情雅趣'));
  return view;
}

describe('适情雅趣 → 推演 的接线（v2026.11.23.9）', () => {
  it('点「推演」进的是双人手动模式：标题自由推演 + 无任何 AI 入口', () => {
    const { container } = openAncient();
    expect(screen.getByText(/适情雅趣 · 共 548 局/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ancient-simulate'));

    expect(screen.getByText('自由推演')).toBeInTheDocument();
    expect(screen.getByTestId('sim-manual-tip')).toBeInTheDocument();
    // 三个 AI 入口必须都不存在（用户要求「不用人机介入」）
    expect(screen.queryByText('自动推演')).toBeNull();
    expect(screen.queryByText('AI走一步')).toBeNull();
    expect(screen.queryByText('AI档位')).toBeNull();
    // 双人模式仍然要有回退 / 重置
    expect(screen.getByTestId('sim-reset')).toBeInTheDocument();
    expect(screen.getByText('回退')).toBeInTheDocument();
    // 棋盘带过来的是残局（25 子），不是标准开局（32 子）
    expect(countPieces(container)).toBe(25);
  });

  it('推演里走一步后点「重置」，回到的是这个残局而不是标准开局', () => {
    const { container } = openAncient();
    fireEvent.click(screen.getByTestId('ancient-simulate'));

    // 第 1 局「气吞关右」：红炮在 (4,4)，九路是空的
    expect(squareText(container, 4, 4)).toBe('炮');
    expect(countPieces(container)).toBe(25);

    // 炮五平九：(4,4) → (0,4)
    clickSquare(container, 4, 4);
    clickSquare(container, 0, 4);
    expect(squareText(container, 4, 4)).toBe('');
    expect(squareText(container, 0, 4)).toBe('炮');

    fireEvent.click(screen.getByTestId('sim-reset'));

    // 残局起点回来了：红炮回到 (4,4)，总数仍是 25
    expect(squareText(container, 4, 4)).toBe('炮');
    expect(countPieces(container)).toBe(25);
    // 标准开局的炮在 (1,2)/(7,2)，(4,4) 一定是空的 —— 这条排除"重置成新对局"
    expect(squareText(container, 1, 2)).not.toBe('炮');
  });

  it('从推演「返回」回到练习页，仍停在刚才那一局（第2局）', () => {
    openAncient();
    // 标题是 h2：「第N局 · 局名」
    const title = () => screen.getByRole('heading', { level: 2 }).textContent ?? '';
    expect(title()).toMatch(/第1局/);

    // 翻到下一局
    fireEvent.click(screen.getByText('下一局'));
    expect(title()).toMatch(/第2局/);

    fireEvent.click(screen.getByTestId('ancient-simulate'));
    expect(screen.getByText('自由推演')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sim-back'));

    // 回到练习页，并且没有被闯关进度拽回第 1 局
    expect(screen.getByText(/适情雅趣 · 共 548 局/)).toBeInTheDocument();
    expect(title()).toMatch(/第2局/);
  });

  it('从推演返回练习页后，刚才试走的着法仍在（练习页不卸载，只隐藏）', () => {
    const { container } = openAncient();

    // 在练习盘上走一步：炮五平九 (4,4) → (0,4)
    clickSquare(container, 4, 4, 'practice');
    clickSquare(container, 0, 4, 'practice');
    expect(squareText(container, 0, 4, 'practice')).toBe('炮');

    fireEvent.click(screen.getByTestId('ancient-simulate'));
    expect(screen.getByText('自由推演')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sim-back'));

    // 回来了，而且盘面还停在刚才那一手（不是被重置成残局初始局面）
    expect(screen.getByText(/适情雅趣 · 共 548 局/)).toBeInTheDocument();
    expect(squareText(container, 0, 4, 'practice')).toBe('炮');
    expect(squareText(container, 4, 4, 'practice')).toBe('');
  });

  it('残局推演（自摆残局）进推演后重置，回到自己摆的残局而不是新的一局', () => {
    const { container } = render(<App />);
    fireEvent.click(screen.getByTestId('entry-endgame-lab'));

    // 摆三子：红帅(4,0)、黑将(3,9)、红车(0,0)
    const place = (side: 'red' | 'black', type: string, col: number, row: number) => {
      fireEvent.click(screen.getByTestId(`lab-tray-${side}-${type}`));
      clickSquare(container, col, row);
    };
    place('red', 'K', 4, 0);
    place('black', 'K', 3, 9);
    place('red', 'R', 0, 0);
    fireEvent.click(screen.getByTestId('lab-finish'));

    // 进了推演页，而且是残局推演（AI 入口保留：用户要能"人机帮着推演"）
    expect(screen.getByText('残局推演')).toBeInTheDocument();
    expect(screen.getByText('自动推演')).toBeInTheDocument();
    expect(countPieces(container)).toBe(3);

    // 车一进九：(0,0) → (0,9)
    clickSquare(container, 0, 0);
    clickSquare(container, 0, 9);
    expect(squareText(container, 0, 0)).toBe('');
    expect(squareText(container, 0, 9)).toBe('车');

    fireEvent.click(screen.getByTestId('sim-reset'));

    // 用户原话：「重置回到我摆放残局的起点」——三子残局，不是整盘 32 子
    expect(countPieces(container)).toBe(3);
    expect(squareText(container, 0, 0)).toBe('车');
    expect(squareText(container, 4, 0)).toBe('帅');
    expect(squareText(container, 3, 9)).toBe('将');
  });
});
