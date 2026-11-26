/** hintMode 全链透传：store 默认 mate，move 模式演示传入正解，匹配失败显示错误。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInitialState } from '../../engine/board';
import { legalMovesWithNotation } from '../../training/legalNotation';
import type { GameState } from '../../engine/types';
import { SimulationPage } from '../../ui/SimulationPage';
import { useSimulationStore } from '../simulationStore';

afterEach(() => {
  cleanup();
  useSimulationStore.getState().reset();
});

describe('simulation hintMode contract', () => {
  it('defaults to mate and keeps the legacy setHint/reset signatures', () => {
    useSimulationStore.getState().reset();
    expect(useSimulationStore.getState().hintMode).toBe('mate');
    expect(useSimulationStore.getState().hintMove).toBeNull();
    useSimulationStore.getState().setHint('一步杀');
    expect(useSimulationStore.getState().hintNotation).toBe('一步杀');
    expect(useSimulationStore.getState().hintMode).toBe('mate');
  });

  it('reset accepts mode and explicit best move', () => {
    const best = legalMovesWithNotation(createInitialState('red'))[0];
    useSimulationStore.getState().reset(createInitialState('red'), best.notation, 'move', best);
    const state = useSimulationStore.getState();
    expect(state.hintMode).toBe('move');
    expect(state.hintMove).toBe(best);
    expect(state.hintNotation).toBe(best.notation);
  });

  it('move mode shows the generic hint and plays the passed legal move', async () => {
    const initial: GameState = createInitialState('red');
    const best = legalMovesWithNotation(initial)[0];
    render(<SimulationPage onBack={vi.fn()} initialState={initial}
      hintNotation={best.notation} hintMode="move" hintMove={best} />);
    expect(screen.getByText(/讲解指导：这一手建议走/)).toBeInTheDocument();
    expect(screen.queryByText(/形成一步杀/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('show-best'));
    await waitFor(() => {
      expect(useSimulationStore.getState().currentNode().move?.notation).toBe(best.notation);
    });
    expect(useSimulationStore.getState().lastError).toBeNull();
  });

  it('move mode surfaces a visible error when the best move cannot be matched', async () => {
    render(<SimulationPage onBack={vi.fn()} initialState={createInitialState('red')}
      hintNotation="不存在的着法" hintMode="move" hintMove={null} />);
    fireEvent.click(screen.getByTestId('show-best'));
    await waitFor(() => {
      expect(useSimulationStore.getState().lastError).toMatch(/无法匹配/);
    });
    expect(screen.getByText(/无法匹配/)).toBeInTheDocument();
  });
});
