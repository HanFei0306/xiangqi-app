import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import { ancientBookMove, ancientBookSize } from '../ancientBook';

describe('适情雅趣棋谱反哺', () => {
  it('replays 548 composed endgames into a position -> solution table', () => {
    expect(ancientBookSize()).toBeGreaterThan(500);
  });

  it('returns the verified solution move for the exact puzzle position', () => {
    const puzzle = SHIQINGYAQU[0];
    const board = Board.fromNotationSetup(puzzle.setup);
    const state = {
      board, turn: 'red' as const, history: [], status: 'playing' as const, moveCount: 0,
    };
    const move = ancientBookMove(state);
    expect(move).not.toBeNull();
    expect(move!.from).toEqual(puzzle.solution[0].from);
    expect(move!.to).toEqual(puzzle.solution[0].to);
  });

  it('never intercepts a full-material opening position', () => {
    const board = new Board();
    const state = {
      board, turn: 'red' as const, history: [], status: 'playing' as const, moveCount: 0,
    };
    expect(ancientBookMove(state)).toBeNull();
  });
});
