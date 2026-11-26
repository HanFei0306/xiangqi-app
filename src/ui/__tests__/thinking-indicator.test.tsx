/**
 * v2026.11.23.4: the 14s master wait now has a restrained progress cue.
 * It must be driven by the existing `thinking` flag, stay out of the board
 * layout, and disappear the moment the AI move lands.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MatchPage } from '../MatchPage';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';

afterEach(() => {
  cleanup();
  act(() => {
    useGameStore.getState().newGame();
    useSettings.setState({
      difficulty: 'beginner',
      soundEnabled: false,
      playerSide: 'red',
      boardTheme: 'classic',
      musicTrack: 'off',
      effects: { capture: true, check: true, mate: true },
    });
  });
});

describe('MatchPage thinking progress cue', () => {
  it('renders only during the AI turn and never changes the status text API', () => {
    act(() => {
      useSettings.setState({ playerSide: 'red', soundEnabled: false, difficulty: 'master' });
    });
    render(<MatchPage onOpenSetup={() => {}} onOpenPractice={() => {}} onSimulate={() => {}} />);
    expect(screen.queryByTestId('thinking-indicator')).toBeNull();

    // Put the live game in the AI's turn (black) and flip the existing store flag.
    const live = useGameStore.getState().game;
    act(() => {
      useGameStore.setState({ game: { ...live, turn: 'black' }, thinking: true });
    });
    expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
    expect(screen.getByText(/引擎思考中/)).toBeInTheDocument();
    // The indicator is an empty absolute overlay: no text, no sound, no layout.
    expect(screen.getByTestId('thinking-indicator').textContent).toBe('');

    act(() => {
      useGameStore.setState({ thinking: false });
    });
    expect(screen.queryByTestId('thinking-indicator')).toBeNull();
  });
});
