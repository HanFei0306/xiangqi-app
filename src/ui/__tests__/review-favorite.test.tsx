/**
 * v2026.11.23.4 复盘菜单收藏：不再终局自动弹框，玩家在复盘里主动收藏。
 * 收藏不得打断复盘位置，重复点击不得重复写入记谱本。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { MatchPage } from '../MatchPage';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import { loadNotations } from '../../data/notation-storage';

function gameWithMoves(plies: number) {
  let state = createInitialState('red');
  for (let i = 0; i < plies; i++) {
    state = applyMoveToState(state, generateLegalMoves(state.board, state.turn)[i % 3]);
  }
  return state;
}

function openMore(): void {
  // MUI keeps the closing Dialog in the tree for its fade transition; that
  // marks the rest of the page aria-hidden, so query by text here.
  fireEvent.click(screen.getByText('更多'));
}

beforeEach(() => {
  localStorage.clear();
  act(() => {
    useSettings.setState({ playerSide: 'red', difficulty: 'beginner', soundEnabled: false });
  });
});

afterEach(() => {
  cleanup();
  act(() => { useGameStore.getState().newGame(); });
});

describe('复盘菜单「收藏棋谱」', () => {
  it('saves once from the review menu without moving the review cursor', () => {
    const played = gameWithMoves(4);
    act(() => {
      useGameStore.setState({ game: played, reviewIndex: 2, result: null, thinking: false });
    });
    render(<MatchPage onOpenSetup={() => {}} onOpenPractice={() => {}} onSimulate={() => {}} />);

    openMore();
    expect(screen.getByText('收藏棋谱').closest('button')).not.toBeDisabled();
    fireEvent.click(screen.getByText('收藏棋谱'));
    expect(screen.getByTestId('favorite-dialog')).toBeInTheDocument();

    const nameInput = screen.getByLabelText('棋谱名称');
    fireEvent.change(nameInput, { target: { value: '复盘收藏测试' } });
    fireEvent.click(screen.getByTestId('favorite-confirm'));

    const saved = loadNotations();
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('复盘收藏测试');
    expect(saved[0].moves).toHaveLength(4);
    expect(useGameStore.getState().reviewIndex).toBe(2); // 复盘位置没被打断

    // Repeat click: menu flips to「已收藏棋谱」and writes nothing more.
    openMore();
    expect(screen.getByText('已收藏棋谱').closest('button')).toBeDisabled();
    expect(loadNotations()).toHaveLength(1);
  });

  it('stays disabled outside review mode', () => {
    act(() => {
      useGameStore.setState({ game: gameWithMoves(2), reviewIndex: null });
    });
    render(<MatchPage onOpenSetup={() => {}} onOpenPractice={() => {}} onSimulate={() => {}} />);
    openMore();
    expect(screen.getByText('收藏棋谱').closest('button')).toBeDisabled();
    expect(loadNotations()).toHaveLength(0);
  });
});
