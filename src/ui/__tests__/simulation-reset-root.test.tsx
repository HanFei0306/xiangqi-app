/**
 * 推演页「重置回到残局起点」+「双人手动模式」回归测试（v2026.11.23.10）。
 *
 * 覆盖两类问题：
 *   A. P0 用户 bug：残局推演到一半点「重置」，此前是无参 reset() → 棋盘被摆成
 *      32 子标准开局。本测试证明重置必须回到本次会话的根局面（残局起点）。
 *   B. 新能力 manual：双人手动推演时隐藏全部 AI 入口、显示说明行、双方都能走子，
 *      且即使 auto 残留也不会真的让引擎走子。
 *
 * 测试之间必须重置 store，否则订阅同一 zustand store 的用例会互相污染。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SimulationPage } from '../SimulationPage';
import { useSimulationStore } from '../../store/simulationStore';
import { Board as BoardModel, createInitialState } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import type { GameState } from '../../engine/types';

/** 构造合法三子残局：红帅(4,0)、黑将(3,9)、红车(0,0)，红先。
 *  注意帅(4,0)与将(3,9)不同列，不会照面。 */
function endgameState(): GameState {
  return {
    board: BoardModel.fromSetup('4,0,K,red;3,9,K,black;0,0,R,red'),
    turn: 'red',
    history: [],
    status: 'playing',
    moveCount: 0,
  };
}

/** 数棋盘上的棋子总数。 */
function countPieces(state: GameState): number {
  let n = 0;
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      if (state.board.getPiece({ col, row })) n += 1;
    }
  }
  return n;
}

/** 用 store 直接走一步（静默，不发声），返回是否成功。 */
function playFirstLegal(): boolean {
  const st = useSimulationStore.getState();
  const n = st.currentNode();
  const move = generateLegalMoves(n.state.board, n.state.turn)[0];
  if (!move) return false;
  act(() => { useSimulationStore.getState().playMove(move, true); });
  return true;
}

/** 点击「重置」按钮。 */
function clickReset(): void {
  fireEvent.click(screen.getByTestId('sim-reset'));
}

beforeEach(() => {
  act(() => { useSimulationStore.getState().reset(createInitialState('red')); });
});

afterEach(cleanup);

describe('重置回到本次会话的根局面（P0 回归）', () => {
  it('残局推演走几步后点重置，棋盘回到 3 子残局而非 32 子开局', () => {
    render(<SimulationPage initialState={endgameState()} onBack={() => {}} />);

    // 会话根局面应为 3 子残局。
    expect(useSimulationStore.getState().path().length).toBe(1);
    expect(countPieces(useSimulationStore.getState().currentNode().state)).toBe(3);

    // 走 1-2 步（红、黑各一步）。
    expect(playFirstLegal()).toBe(true);
    expect(playFirstLegal()).toBe(true);
    expect(useSimulationStore.getState().path().length).toBe(3);

    // 点重置。
    clickReset();

    const st = useSimulationStore.getState();
    // 只剩根节点。
    expect(st.path().length).toBe(1);
    const root = st.currentNode().state;
    // 核心防回归断言：不是 32 子开局，而是原来那 3 子残局。
    expect(countPieces(root)).toBe(3);
    // 关键棋子各就各位。
    expect(root.board.getPiece({ col: 0, row: 0 })).toEqual({ type: 'R', side: 'red' });
    expect(root.board.getPiece({ col: 4, row: 0 })).toEqual({ type: 'K', side: 'red' });
    expect(root.board.getPiece({ col: 3, row: 9 })).toEqual({ type: 'K', side: 'black' });
  });

  it('重置保留漏杀/讲解提示（hintNotation 不被抹掉）', () => {
    render(
      <SimulationPage
        initialState={endgameState()}
        hintNotation="车一进三"
        hintMode="move"
        onBack={() => {}}
      />,
    );

    // 先走一步让局面偏离根，再重置。
    expect(playFirstLegal()).toBe(true);
    clickReset();

    expect(useSimulationStore.getState().hintNotation).toBe('车一进三');
    expect(useSimulationStore.getState().hintMode).toBe('move');
  });
});

describe('manual 双人手动模式', () => {
  it('manual 模式下隐藏全部 AI 入口并显示说明行', () => {
    render(<SimulationPage initialState={endgameState()} onBack={() => {}} manual />);

    expect(screen.queryByText('自动推演')).toBeNull();
    expect(screen.queryByText('AI走一步')).toBeNull();
    expect(screen.queryByText('AI档位')).toBeNull();
    // 保留回退/重置。
    expect(screen.getByText('回退')).toBeTruthy();
    expect(screen.getByTestId('sim-reset')).toBeTruthy();
    // 说明行存在。
    expect(screen.getByTestId('sim-manual-tip')).toBeTruthy();
  });

  it('非 manual（默认）时三个 AI 文案都在，且没有说明行', () => {
    render(<SimulationPage initialState={endgameState()} onBack={() => {}} />);

    expect(screen.queryByText('自动推演')).toBeTruthy();
    expect(screen.queryByText('AI走一步')).toBeTruthy();
    expect(screen.queryByText('AI档位')).toBeTruthy();
    expect(screen.queryByTestId('sim-manual-tip')).toBeNull();
  });

  it('manual 模式下红黑双方都能手动落子（path 增至 3）', () => {
    render(<SimulationPage initialState={endgameState()} onBack={() => {}} manual />);

    // 红方走一步。
    const redMove = generateLegalMoves(
      useSimulationStore.getState().currentNode().state.board,
      'red',
    )[0];
    let ok = false;
    act(() => {
      ok = useSimulationStore.getState().tryMove(redMove.from, redMove.to);
    });
    expect(ok).toBe(true);
    expect(useSimulationStore.getState().currentNode().state.turn).toBe('black');

    // 黑方（正常对局里由 AI 走）也由玩家手动走一步。
    const blackMove = generateLegalMoves(
      useSimulationStore.getState().currentNode().state.board,
      'black',
    )[0];
    act(() => {
      ok = useSimulationStore.getState().tryMove(blackMove.from, blackMove.to);
    });
    expect(ok).toBe(true);

    expect(useSimulationStore.getState().path().length).toBe(3);
  });
});
