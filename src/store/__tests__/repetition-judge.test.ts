/**
 * Tests for the v1.10 repetition judge (src/store/repetition-judge.ts).
 *
 * Per the Chinese chess rules, a third occurrence of the same position is a
 * draw UNLESS the last full cycle was a perpetual check (长将) by one side —
 * then that side loses. The perpetual scenario below is a full legal game
 * replayed from the standard initial position: a black rook walks to (4,3)
 * and then shuttles (4,3)->(3,3)+ / (3,3)->(4,3)+ twice while the red king is
 * forced to shuffle (3,1)<->(4,1). Every move is validated by the rules
 * engine, so the sequence doubles as a legality regression for the judge's
 * replay logic.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { Move, Pos } from '../../engine/types';
import { judgeRepetition } from '../repetition-judge';

function p(col: number, row: number): Pos {
  return { col, row };
}

/** Plays the steps from the standard initial position, validating legality. */
function playSeq(steps: Array<[Pos, Pos]>): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [from, to] of steps) {
    const move = makeMove(state.board, from, to);
    if (!move) {
      throw new Error(
        `illegal step ${JSON.stringify(from)}->${JSON.stringify(to)} at ply ${history.length}`,
      );
    }
    history.push({ ...move });
    state = applyMoveToState(state, move);
  }
  return history;
}

/**
 * A full legal game (27 plies) that reaches a threefold repetition whose last
 * cycle is a black perpetual check:
 *  - plies 0..18: both sides develop; black's rook walks (8,9) -> (8,5) ->
 *    (4,5), captures the advanced red pawn on (4,4) and settles on (4,3);
 *    the red king steps to (3,1).
 *  - plies 19..26: two identical 4-ply shuttle cycles, black checking on
 *    every rook move, the red king shuttling (3,1)<->(4,1).
 */
const BLACK_PERPETUAL_GAME: Array<[Pos, Pos]> = [
  // Development: black clears col 8 for the rook, red develops naturally.
  [p(7, 2), p(6, 2)], // red cannon out
  [p(8, 6), p(8, 5)], // black pawn
  [p(1, 0), p(2, 2)], // red horse
  [p(8, 5), p(8, 4)], // black pawn
  [p(8, 0), p(8, 1)], // red rook
  [p(8, 9), p(8, 8)], // black rook starts down col 8
  [p(4, 0), p(4, 1)], // red king up
  [p(8, 8), p(8, 7)],
  [p(4, 1), p(3, 1)], // red king to (3,1)
  [p(8, 7), p(8, 6)],
  [p(4, 3), p(4, 4)], // red pawn advances (clears (4,3))
  [p(8, 6), p(8, 5)],
  [p(8, 1), p(7, 1)], // red rook aside
  [p(8, 5), p(4, 5)], // black rook across rank 5
  [p(7, 1), p(7, 3)], // red rook up
  [p(4, 5), p(4, 4)], // black rook takes the red pawn
  [p(0, 0), p(0, 1)], // red filler
  [p(4, 4), p(4, 3)], // black rook to (4,3)
  [p(0, 1), p(0, 0)], // red filler (cycle start position: black to move)
  // Shuttle cycle 1: black checks on every move, red king shuttles.
  [p(4, 3), p(3, 3)],
  [p(3, 1), p(4, 1)],
  [p(3, 3), p(4, 3)],
  [p(4, 1), p(3, 1)],
  // Shuttle cycle 2 (identical) -> third occurrence of the same position.
  [p(4, 3), p(3, 3)],
  [p(3, 1), p(4, 1)],
  [p(3, 3), p(4, 3)],
  [p(4, 1), p(3, 1)],
];

describe('judgeRepetition', () => {
  it('returns black-loses for a black perpetual-check threefold repetition', () => {
    const history = playSeq(BLACK_PERPETUAL_GAME);
    expect(history).toHaveLength(27);
    expect(judgeRepetition(history)).toBe('black-loses');
  });

  it('returns draw for a check-free threefold repetition', () => {
    // Both rooks shuttle back and forth twice; the initial position (red to
    // move) recurs at ply 4 and ply 8, nobody ever checks.
    const history = playSeq([
      [p(8, 0), p(8, 1)],
      [p(0, 9), p(0, 8)],
      [p(8, 1), p(8, 0)],
      [p(0, 8), p(0, 9)],
      [p(8, 0), p(8, 1)],
      [p(0, 9), p(0, 8)],
      [p(8, 1), p(8, 0)],
      [p(0, 8), p(0, 9)],
    ]);
    expect(judgeRepetition(history)).toBe('draw');
  });

  it('returns none below eight plies even when shuffling', () => {
    const history = playSeq(BLACK_PERPETUAL_GAME.slice(0, 4));
    expect(judgeRepetition(history)).toBe('none');
  });

  it('returns none for eight quiet plies without a repetition', () => {
    // The first ten plies of the perpetual game: no position has occurred
    // three times yet (the rook has not even reached (4,3)).
    const history = playSeq(BLACK_PERPETUAL_GAME.slice(0, 10));
    expect(judgeRepetition(history)).toBe('none');
  });
});
