/**
 * QA2 独立验收：失误卡一键跳转到推演页的既有链路未被本轮改动破坏。
 * 用一个真实的对局中途局面（失误前）验证 root 局面、提示条、show-best 演示正解。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInitialState } from '../engine/board';
import { applyMoveToState } from '../engine/rules';
import type { GameState, Move } from '../engine/types';
import { legalMovesWithNotation } from '../training/legalNotation';
import { SimulationPage } from '../ui/SimulationPage';
import { useSimulationStore } from '../store/simulationStore';

const FIRST_18: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 1], [1, 7, 1, 3], [0, 1, 2, 1], [5, 9, 4, 8], [2, 1, 3, 1], [4, 9, 5, 9],
  [3, 0, 4, 1], [0, 6, 0, 5], [1, 2, 2, 2], [7, 7, 8, 7], [3, 1, 3, 8], [8, 7, 2, 7],
  [7, 2, 7, 5], [2, 7, 2, 8], [2, 2, 5, 2], [7, 9, 8, 7], [5, 2, 5, 8], [1, 3, 1, 8],
];

function beforeMistake(): GameState {
  let state = createInitialState('red');
  for (const [fc, fr, tc, tr] of FIRST_18) {
    const chosen = legalMovesWithNotation(state).find((m) => m.from.col === fc && m.from.row === fr
      && m.to.col === tc && m.to.row === tr);
    if (!chosen) break;
    state = applyMoveToState(state, chosen);
  }
  return state;
}

afterEach(() => {
  cleanup();
  useSimulationStore.getState().reset();
});

describe('QA2 失误跳推演链路回归（中途局面）', () => {
  it('停在失误前局面、显示建议走法，show-best 播放传入正解', async () => {
    const before = beforeMistake();
    expect(before.moveCount).toBe(18);
    const best: Move = legalMovesWithNotation(before)[3];

    render(<SimulationPage onBack={vi.fn()} initialState={before}
      hintNotation={best.notation} hintMode="move" hintMove={best} />);

    const store = useSimulationStore.getState();
    expect(store.nodes[store.rootId].state.board.toNotationSetup()).toBe(before.board.toNotationSetup());
    expect(store.hintMode).toBe('move');
    expect(screen.getByText(new RegExp(`讲解指导：这一手建议走「${best.notation}」`))).toBeInTheDocument();
    expect(screen.queryByText(/形成一步杀/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('show-best'));
    await waitFor(() => {
      expect(useSimulationStore.getState().currentNode().move?.notation).toBe(best.notation);
    });
    expect(useSimulationStore.getState().lastError).toBeNull();
    expect(useSimulationStore.getState().currentId).toBe(1);
  });
});
