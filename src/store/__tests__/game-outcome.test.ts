/**
 * v2026.11.19.3 regressions — 长将判负归属 / 将军提示方 / 胜负文案.
 *
 * The complaint was: 黑方反复将军却显示"红方将军"、并误判黑方获胜.
 * Root cause: judgeRepetition() returns an explicit loser, but the store used
 * to collapse it to status='perpetual' and infer the winner from `turn`.
 * In the shipped 27-ply black-perpetual line the LAST move is RED's, so
 * `turn` after it is BLACK — the old code crowned the checker. These tests
 * drive that exact line through the real store and assert the explicit result.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { Move, Pos } from '../../engine/types';
import { INITIAL_SETUP } from '../../data/puzzles';
import { loadMatchStats } from '../matchStats';
import { useGameStore } from '../gameStore';
import { useSettings } from '../settings';
import { statusText } from '../../ui/MatchPage';
import { EVOLUTION_STORAGE_KEY } from '../../data/evolution-storage';
import { getEvolutionStats, invalidateEvolutionCache } from '../../ai/evolution';

const STATS_KEY = 'xiangqi-trainer:match-stats';

function p(col: number, row: number): Pos {
  return { col, row };
}

/** Replays validated legal steps from the standard initial position. */
function playSeq(steps: Array<[Pos, Pos]>): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [from, to] of steps) {
    const move = makeMove(state.board, from, to);
    if (!move) throw new Error(`illegal step ${JSON.stringify(from)}->${JSON.stringify(to)} @${history.length}`);
    state = applyMoveToState(state, move);
    // Keep the move object the engine actually applied (with captured/notation
    // filled by Board.applyMove), so analyze() can reconstruct the game later.
    history.push({ ...state.history[state.history.length - 1] });
  }
  return history;
}

/** Full legal game: two black rook-check shuttle cycles, red king shuffles. */
const BLACK_PERPETUAL_GAME: Array<[Pos, Pos]> = [
  [p(7, 2), p(6, 2)], [p(8, 6), p(8, 5)],
  [p(1, 0), p(2, 2)], [p(8, 5), p(8, 4)],
  [p(8, 0), p(8, 1)], [p(8, 9), p(8, 8)],
  [p(4, 0), p(4, 1)], [p(8, 8), p(8, 7)],
  [p(4, 1), p(3, 1)], [p(8, 7), p(8, 6)],
  [p(4, 3), p(4, 4)], [p(8, 6), p(8, 5)],
  [p(8, 1), p(7, 1)], [p(8, 5), p(4, 5)],
  [p(7, 1), p(7, 3)], [p(4, 5), p(4, 4)],
  [p(0, 0), p(0, 1)], [p(4, 4), p(4, 3)],
  [p(0, 1), p(0, 0)], // cycle start: black to move
  [p(4, 3), p(3, 3)], [p(3, 1), p(4, 1)],
  [p(3, 3), p(4, 3)], [p(4, 1), p(3, 1)],
  [p(4, 3), p(3, 3)], [p(3, 1), p(4, 1)],
  [p(3, 3), p(4, 3)], [p(4, 1), p(3, 1)],
];

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.removeItem(STATS_KEY);
  localStorage.removeItem(EVOLUTION_STORAGE_KEY);
  invalidateEvolutionCache();
  useSettings.setState({
    playerSide: 'red',
    soundEnabled: false,
    difficulty: 'beginner',
    tacticsHintEnabled: true,
  });
  useGameStore.getState().newGame();
});

afterEach(() => {
  useGameStore.getState().newGame();
  vi.useRealTimers();
  localStorage.removeItem(STATS_KEY);
});

describe('黑方长将判负', () => {
  it('黑方连续将军：判黑负红胜，写入红方胜战绩', () => {
    // Set up the live game 1 ply before the third repetition (26 plies played).
    const history = playSeq(BLACK_PERPETUAL_GAME.slice(0, 26));
    let state = createInitialState('red');
    for (const move of history) state = applyMoveToState(state, move);
    expect(state.turn).toBe('red');

    useGameStore.setState({
      game: {
        board: state.board,
        turn: 'red',
        history,
        status: state.status,
        moveCount: 26,
      },
      standardHistory: true,
      result: null,
      thinking: false,
    });

    // Red's last king step completes the third occurrence of the cycle.
    expect(useGameStore.getState().playerMove(p(4, 1), p(3, 1))).toBe(true);
    const after = useGameStore.getState();
    expect(after.game.status).toBe('perpetual');
    expect(after.game.turn).toBe('black'); // black is to move, but BLACK lost
    expect(after.result).not.toBeNull();
    expect(after.result!.winner).toBe('red');
    expect(after.result!.loser).toBe('black');
    expect(after.result!.reason).toBe('perpetual');

    // Landing callbacks are scheduled with window.setTimeout — run them out.
    vi.advanceTimersByTime(600);
    expect(loadMatchStats('beginner').wins).toBe(1);
    expect(loadMatchStats('beginner').losses).toBe(0);
    expect(getEvolutionStats().totalGames).toBe(1); // AI 学习也收到终局结果
  });

  it('胜负文案与 status / result 一致：红方胜（黑方长将判负）', () => {
    const result = {
      status: 'perpetual' as const,
      reason: 'perpetual' as const,
      winner: 'red' as const,
      loser: 'black' as const,
    };
    const text = statusText('perpetual', 'black', 'red', result);
    expect(text).toContain('红方胜');
    expect(text).toContain('黑方长将判负');
    expect(text).not.toContain('黑方胜');
  });

  it('将军提示的将军方 / 被将军方与实际行棋方一致', () => {
    // Black just checked: red is in check (red to move).
    const redInCheck = statusText('check', 'red', 'red', null);
    expect(redInCheck).toContain('黑方将军');
    expect(redInCheck).toContain('红方被将军');
    expect(redInCheck).not.toContain('红方将军');

    // Red just checked: black is in check (black to move).
    const blackInCheck = statusText('check', 'black', 'red', null);
    expect(blackInCheck).toContain('红方将军');
    expect(blackInCheck).toContain('黑方被将军');
  });
});

describe('认输与提和', () => {
  it('认输判对方胜并写入战绩', () => {
    useGameStore.getState().resign();
    const after = useGameStore.getState();
    expect(after.game.status).toBe('checkmate');
    expect(after.result!.winner).toBe('black');
    expect(after.result!.loser).toBe('red');
    expect(after.result!.reason).toBe('resign');
    expect(loadMatchStats('beginner').losses).toBe(1);
    expect(getEvolutionStats().totalGames).toBe(1);
    expect(statusText('checkmate', 'red', 'red', after.result)).toContain('黑方胜（红方认输）');
  });

  it('均势局面提和被接受：和棋并写入和棋战绩', () => {
    useGameStore.getState().offerDraw();
    const after = useGameStore.getState();
    expect(after.game.status).toBe('draw');
    expect(after.result!.winner).toBeNull();
    expect(after.result!.reason).toBe('draw-agreed');
    expect(after.notice).toContain('接受提和');
    expect(loadMatchStats('beginner').draws).toBe(1);
  });

  it('AI 明显占优时拒绝提和：对局继续并给出提示', () => {
    // Remove one red rook from the standard setup -> black is up ~900 cp.
    const blackBetter = INITIAL_SETUP.split('/')
      .map((row, i) => (i === 0 ? '.,N,B,A,K,A,B,N,R' : row))
      .join('/');
    expect(useGameStore.getState().loadPosition(blackBetter)).toBe(true);
    useGameStore.getState().offerDraw();
    const after = useGameStore.getState();
    expect(after.game.status).toBe('playing');
    expect(after.result).toBeNull();
    expect(after.notice).toContain('拒绝提和');
  });
});
