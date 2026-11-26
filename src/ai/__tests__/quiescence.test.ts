/**
 * Quiescence must see a forced mate that starts with a QUIET check, not only
 * a capture. Depth 0 sends the root straight into quiescence.
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { alphabeta, MATE_SCORE, MATE_THRESHOLD } from '../search';

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

describe('quiescence quiet checks', () => {
  it('finds the mate-in-one 车五进一 at depth 0 via a quiet checking move', () => {
    const board = Board.fromNotationSetup(END1_SETUP);
    const score = alphabeta(
      { board, turn: 'red', history: [], status: 'playing', moveCount: 0 },
      0, -Infinity, Infinity, 'red',
    );
    expect(score).toBe(MATE_SCORE - 1);
    expect(score).toBeGreaterThan(MATE_THRESHOLD);
  });

  it('stays bounded on the opening position (quiet checks cannot explode)', () => {
    const board = new Board();
    const score = alphabeta(
      { board, turn: 'red', history: [], status: 'playing', moveCount: 0 },
      0, -Infinity, Infinity, 'red',
    );
    expect(Number.isFinite(score)).toBe(true);
    expect(Math.abs(score)).toBeLessThan(MATE_SCORE);
  });
});
