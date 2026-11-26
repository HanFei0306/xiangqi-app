/**
 * Mate scores must be `±(MATE_SCORE - ply)`: an immediate mate is worth more
 * than a mate that needs a move, and every mate stays above MATE_THRESHOLD.
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import type { Piece } from '../../engine/types';
import {
  alphabeta,
  createSearchContext,
  MATE_SCORE,
  MATE_THRESHOLD,
  rankedMoves,
} from '../search';

/**
 * Local fixture: the former built-in "end-1" mate-in-one position (red to move,
 * 車五進一 mates). Inlined so this engine test no longer depends on the removed
 * puzzle library.
 */
const END1_SETUP = [
  '.,.,.,.,K,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,.,.,.,.,.',
  '.,.,.,.,R,R,.,.,.',
  '.,.,.,k,.,.,.,.,.',
].join('/');

function matedBoard(): Board {
  const board = new Board(
    Array.from({ length: 9 }, () => new Array(10).fill(null)),
  );
  const pieces: Array<[number, number, Piece]> = [
    [4, 9, { type: 'K', side: 'black' }],
    [4, 0, { type: 'R', side: 'red' }],
    [0, 9, { type: 'R', side: 'red' }],
  ];
  for (const [col, row, piece] of pieces) board.setPiece({ col, row }, piece);
  return board;
}

describe('ply-relative mate scores', () => {
  it('scores an already-mated root higher than a mate in one move', () => {
    // Terminal root: black to move, no legal reply, red is the maximiser.
    const immediate = alphabeta(
      { board: matedBoard(), turn: 'black', history: [], status: 'playing', moveCount: 0 },
      2, -Infinity, Infinity, 'red',
    );
    // end-1 fixture: red to move and mate with 车五进一 at ply 1.
    const board = Board.fromNotationSetup(END1_SETUP);
    const mateInOne = rankedMoves(
      { board, turn: 'red', history: [], status: 'playing', moveCount: 0 }, 1,
    )[0].score;
    expect(immediate).toBe(MATE_SCORE);
    expect(mateInOne).toBe(MATE_SCORE - 1);
    expect(immediate).toBeGreaterThan(mateInOne);
    expect(mateInOne).toBeGreaterThan(MATE_THRESHOLD);
  });

  it('keeps mate scores out of the transposition table', () => {
    const board = Board.fromNotationSetup(END1_SETUP);
    const ctx = createSearchContext();
    rankedMoves(
      { board, turn: 'red', history: [], status: 'playing', moveCount: 0 }, 1, ctx,
    );
    for (const entry of ctx.tt.values()) {
      expect(Math.abs(entry.score)).toBeLessThan(MATE_THRESHOLD);
    }
  });

  it('never emits a score above MATE_SCORE even with check extensions', () => {
    const board = Board.fromNotationSetup(END1_SETUP);
    const score = alphabeta(
      { board, turn: 'red', history: [], status: 'playing', moveCount: 0 },
      4, -Infinity, Infinity, 'red',
    );
    expect(score).toBeLessThanOrEqual(MATE_SCORE);
    expect(score).toBeGreaterThan(MATE_THRESHOLD);
  });
});
