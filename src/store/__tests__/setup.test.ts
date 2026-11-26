/**
 * Runtime guard against illegal externally authored positions.
 *
 * A hand-authored setup with three red rooks must be rejected at the store
 * entry point (not merely by the puzzle-library self-check), with the reason
 * surfaced through `setupError` and the live board left untouched.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../gameStore';
import { Board } from '../../engine/board';
import { validatePosition } from '../../engine/validate';
import { INITIAL_SETUP } from '../../data/puzzles';

const EMPTY_ROW = '.,.,.,.,.,.,.,.,.';

/** Red has rooks at (0,0), (8,0) and (1,8): three rooks -> C4. */
const THREE_RED_ROOKS = [
  'R,.,.,K,.,.,.,.,R',
  EMPTY_ROW,
  EMPTY_ROW,
  EMPTY_ROW,
  EMPTY_ROW,
  EMPTY_ROW,
  EMPTY_ROW,
  EMPTY_ROW,
  '.,R,.,.,.,.,.,.,.',
  '.,.,.,.,k,.,.,.,.',
].join('/');

beforeEach(() => {
  useGameStore.getState().newGame();
});

describe('three-rook illegality', () => {
  it('validatePosition reports valid=false with a C4 error', () => {
    const result = validatePosition(Board.fromNotationSetup(THREE_RED_ROOKS), 'red');
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.startsWith('C4'))).toBe(true);
    expect(result.errors.join(' ')).toContain('红方车 3 枚，超过上限 2');
  });
});

describe('gameStore external setup validation', () => {
  it('rejects three red rooks, exposes the C4 error and keeps the old board', () => {
    const store = useGameStore.getState();
    const boardBefore = store.game.board;

    expect(store.loadPosition(THREE_RED_ROOKS)).toBe(false);
    const after = useGameStore.getState();
    expect(after.game.board).toBe(boardBefore);
    expect(after.setupError).not.toBeNull();
    expect(after.setupError).toContain('C4');

    after.clearSetupError();
    expect(useGameStore.getState().setupError).toBeNull();
  });

  it('rejects a king outside the palace with a C3 error', () => {
    const illegal = [
      'K,.,.,.,.,.,.,.,.', // red king at (0,0), outside the palace
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      EMPTY_ROW,
      '.,.,.,.,k,.,.,.,.',
    ].join('/');
    expect(useGameStore.getState().loadPuzzle(illegal)).toBe(false);
    expect(useGameStore.getState().setupError).toContain('C3');
  });

  it('accepts a legal position through both loadPosition and loadPuzzle', () => {
    expect(useGameStore.getState().loadPosition(INITIAL_SETUP)).toBe(true);
    expect(useGameStore.getState().setupError).toBeNull();
    expect(useGameStore.getState().game.turn).toBe('red');
    expect(useGameStore.getState().loadPuzzle(INITIAL_SETUP)).toBe(true);
  });

  it('rejects malformed setup strings before parsing', () => {
    expect(useGameStore.getState().loadPosition('R,.,.,K')).toBe(false);
    expect(useGameStore.getState().setupError).toContain('局面格式非法');
  });

  it('newGame clears a previous setup error', () => {
    useGameStore.getState().loadPosition(THREE_RED_ROOKS);
    expect(useGameStore.getState().setupError).not.toBeNull();
    useGameStore.getState().newGame();
    expect(useGameStore.getState().setupError).toBeNull();
  });
});
