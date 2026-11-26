/**
 * QA INDEPENDENT verification of the v1.11 setup-page -> match closed loop.
 *
 * Renders the REAL <App> (SetupPage -> MatchPage routing) with
 * @testing-library/react and asserts:
 *   1. The setup page shows the difficulty master card (1-25 slider),
 *      the red/black side picker, the stats card and the gold 开始挑战 button.
 *   2. The stats card renders persisted matchStats values from localStorage.
 *   3. Clicking 开始挑战 calls beginGame() and routes to the match screen.
 *   4. After switching to 执黑, 开始挑战 makes the AI (red) open the game and
 *      the opponent/player bars show the correct side names.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from '../../App';
import { useSettings } from '../../store/settings';
import { useGameStore } from '../../store/gameStore';
import { tierFromSlider, sliderForTier } from '../setupTiers';

const STATS_KEY = 'xiangqi-trainer:match-stats';

afterEach(() => {
  cleanup();
  // newGame() cancels pending AI/voice timers so a test's async AI reply can
  // never leak into the next test's game state.
  useGameStore.getState().newGame();
  useSettings.setState({ difficulty: 'beginner', playerSide: 'red', soundEnabled: false });
  localStorage.removeItem(STATS_KEY);
});

describe('SetupPage (v1.11 landing screen)', () => {
  it('renders the difficulty master card, side picker, stats card and 开始挑战', () => {
    render(<App />);
    expect(screen.getByText('人机对战')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '难度设定' })).toBeInTheDocument();
    expect(screen.getByText('AI难度')).toBeInTheDocument();
    // side picker chips
    expect(screen.getByText('红方（先）')).toBeInTheDocument();
    expect(screen.getByText('黑方（后）')).toBeInTheDocument();
    // stats card
    expect(screen.getByText(/标准对局战绩/)).toBeInTheDocument();
    expect(screen.getAllByText(/胜率/).length).toBeGreaterThanOrEqual(2); // resource pill + cards
    // gold CTA + practice entry + version badge
    expect(screen.getByRole('button', { name: '开始挑战' })).toBeInTheDocument();
    expect(screen.getByText('适情雅趣')).toBeInTheDocument();
    expect(screen.getByText(/^v\d{4}\.\d{2}\.\d{2}\.\d+$/)).toBeInTheDocument();
  });

  it('stats card reflects persisted per-tier matchStats from localStorage', () => {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({
        beginner: { wins: 2, losses: 1, draws: 1, streak: 2, bestStreak: 3, total: 4 },
      }),
    );
    render(<App />);
    expect(screen.getByText('(胜2和1负1)')).toBeInTheDocument();
  });

  it('slider change maps 1-25 positions onto the three tiers', () => {
    render(<App />);
    // representative positions from the mapping table
    expect(sliderForTier(useSettings.getState().difficulty)).toBe(1); // beginner renders at 1
    expect(tierFromSlider(9)).toBe('intermediate');
    expect(tierFromSlider(18)).toBe('master');
  });

  it('clicking a side chip updates playerSide in the settings store', () => {
    render(<App />);
    fireEvent.click(screen.getByText('黑方（后）'));
    expect(useSettings.getState().playerSide).toBe('black');
    fireEvent.click(screen.getByText('红方（先）'));
    expect(useSettings.getState().playerSide).toBe('red');
  });

  it('开始挑战 with red starts a fresh match and routes to the match page', () => {
    useSettings.setState({ difficulty: 'beginner', playerSide: 'red', soundEnabled: false });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    // Setup page is gone; match page shows the opponent bar + player bar.
    expect(screen.queryByRole('button', { name: '开始挑战' })).not.toBeInTheDocument();
    expect(screen.getAllByText('初级').length).toBeGreaterThanOrEqual(1); // opponent bar tier name
    expect(screen.getByText('你 · 红方')).toBeInTheDocument();
    // The board rendered (SVG board + pieces).
    const svgs = document.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
    // beginGame reset the game: standard start, red to move, no AI reply pending.
    const g = useGameStore.getState().game;
    expect(g.history.length).toBe(0);
    expect(g.turn).toBe('red');
    expect(useGameStore.getState().thinking).toBe(false);
  });

  it('开始挑战 with black: the AI (red) opens and the bars show 执黑', async () => {
    useSettings.setState({ difficulty: 'beginner', playerSide: 'black', soundEnabled: false });
    render(<App />);
    fireEvent.click(screen.getByText('黑方（后）'));
    expect(useSettings.getState().playerSide).toBe('black');
    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    expect(screen.getByText('你 · 黑方')).toBeInTheDocument();
    // AI plays red and opens: exactly one history ply and it is the human's turn.
    await waitFor(
      () => expect(useGameStore.getState().game.history.length).toBe(1),
      { timeout: 6000 },
    );
    const g = useGameStore.getState().game;
    expect(g.turn).toBe('black'); // human (black) to move after the AI opening
  });
});
