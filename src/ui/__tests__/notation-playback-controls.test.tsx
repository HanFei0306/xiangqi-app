/**
 * v2026.11.23.4 记谱回放控制回归：
 * 加载棋谱后必须能「重播 / 上一步 / 下一步 / 自动播放」，走到末尾按钮
 * 变为重播而不是消失；进退步必须沿变招树而非裸数组下标。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { SimulationPage } from '../SimulationPage';
import { useSimulationStore } from '../../store/simulationStore';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import type { GameState, Move } from '../../engine/types';
import { saveNotation } from '../../data/notation-storage';
import type { VariationMove } from '../../data/notation-storage';

/** Record real legal moves from the initial position so playback can replay them. */
function buildLine(count: number): Move[] {
  let state: GameState = createInitialState('red');
  const out: Move[] = [];
  for (let i = 0; i < count; i++) {
    const move: Move = generateLegalMoves(state.board, state.turn)[i % 3];
    state = applyMoveToState(state, move);
    out.push(state.history[state.history.length - 1]);
  }
  return out;
}

/** Load the first saved notation from the 棋谱本 dialog. */
function loadFirstNotation(name: string): void {
  fireEvent.click(screen.getByLabelText('查看棋谱'));
  // The delete IconButton is labelled 删除<name>, so anchor the name at the start.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  act(() => { useSimulationStore.getState().reset(createInitialState('red')); });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('记谱回放控制（v2026.11.23.4）', () => {
  it('replays from the start, steps back/forward, and turns 自动播放 into 重播 at the end', () => {
    const moves = buildLine(3);
    saveNotation({ name: '回放三步', setup: '', moves });
    render(<SimulationPage onBack={() => {}} />);
    loadFirstNotation('回放三步');

    // Loading auto-plays after 300ms; fake timers keep the test deterministic.
    expect(screen.getByText('回放 0/3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('replay-toggle')); // pause
    expect(screen.getByTestId('replay-toggle')).toHaveTextContent('▶自动播放');
    expect(screen.getByTestId('replay-prev')).toBeDisabled();

    const rootId: number = useSimulationStore.getState().currentId;
    fireEvent.click(screen.getByTestId('replay-next'));
    expect(screen.getByText('回放 1/3')).toBeInTheDocument();
    expect(useSimulationStore.getState().currentId).not.toBe(rootId);
    fireEvent.click(screen.getByTestId('replay-next'));
    expect(screen.getByText('回放 2/3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('replay-prev'));
    expect(screen.getByText('回放 1/3')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('replay-next'));
    fireEvent.click(screen.getByTestId('replay-next'));
    expect(screen.getByText('回放 3/3')).toBeInTheDocument();
    expect(screen.getByTestId('replay-next')).toBeDisabled();
    expect(screen.getByTestId('replay-toggle')).toHaveTextContent('▶重播');

    // The dedicated restart and the end-state toggle both replay from move 0.
    fireEvent.click(screen.getByTestId('replay-toggle'));
    expect(screen.getByText('回放 0/3')).toBeInTheDocument();
    expect(useSimulationStore.getState().currentId).toBe(rootId);
    fireEvent.click(screen.getByTestId('replay-next'));
    expect(screen.getByText('回放 1/3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('replay-restart'));
    expect(screen.getByText('回放 0/3')).toBeInTheDocument();
  });

  it('steps along the variation tree when replaying a branch', () => {
    const initial = createInitialState('red');
    const mainFirst: Move = generateLegalMoves(initial.board, 'red')[0];
    const altFirst: Move = generateLegalMoves(initial.board, 'red')[1];
    const afterMain: GameState = applyMoveToState(initial, mainFirst);
    const blackReply: Move = generateLegalMoves(afterMain.board, 'black')[0];
    const mainLine: Move[] = [mainFirst, blackReply];
    const variations: VariationMove[] = [
      { parent: -1, move: mainFirst },
      { parent: 0, move: blackReply },
      { parent: -1, move: altFirst }, // alternative first move
    ];
    saveNotation({ name: '变招回放', setup: '', moves: mainLine, variations });
    render(<SimulationPage onBack={() => {}} />);
    loadFirstNotation('变招回放');

    fireEvent.click(screen.getByTestId('replay-toggle')); // pause at ply 0
    // Two different first moves at the root -> the branch chooser is visible.
    fireEvent.click(screen.getByTestId('variation-2'));
    expect(screen.getByText('回放 0/1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('replay-toggle')); // pause again
    fireEvent.click(screen.getByTestId('replay-next'));

    const node = useSimulationStore.getState().currentNode();
    expect(node.move).not.toBeNull();
    expect(node.move!.from).toEqual(altFirst.from);
    expect(node.move!.to).toEqual(altFirst.to);
    expect(screen.getByText('回放 1/1')).toBeInTheDocument();
  });

  it('leaving replay clears the progress bar and branch state', () => {
    saveNotation({ name: '退出回放', setup: '', moves: buildLine(2) });
    render(<SimulationPage onBack={() => {}} />);
    loadFirstNotation('退出回放');
    fireEvent.click(screen.getByTestId('replay-toggle'));
    fireEvent.click(screen.getByTestId('replay-exit'));
    expect(screen.queryByTestId('replay-next')).toBeNull();
    expect(screen.queryByText(/回放 \d+\/\d+/)).toBeNull();
  });
});
