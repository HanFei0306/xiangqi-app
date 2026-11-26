/**
 * QA acceptance tests — game store (store/gameStore).
 *
 * `gameStore.ts` imports `parseSetup` (board.ts, not exported),
 * `INITIAL_SETUP` (puzzles.ts, not exported), `getGameStatus`
 * (rules.ts, not exported), `makeMove` (rules.ts, not implemented)
 * and `defaultConfig` (engine.ts, not exported). The zustand
 * store initialiser calls `createInitialGame()` synchronously at module
 * load, which invokes `parseSetup(INITIAL_SETUP)` and throws
 * ("undefined is not a function"). So importing this module FAILS
 * today, and every test below errors at import time. They document
 * the required (correct) behaviour once the missing exports are added
 * (see QA report).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../store/gameStore';
import type { Pos } from '../engine/types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

beforeEach(() => {
  useGameStore.getState().newGame();
});

describe('gameStore.newGame', () => {
  it('starts with red to move, playing, empty history', () => {
    const g = useGameStore.getState().game;
    expect(g.turn).toBe('red');
    expect(g.status).toBe('playing');
    expect(g.history).toHaveLength(0);
  });
});

describe('gameStore.playerMove + undo', () => {
  it('accepts a legal red move and triggers the AI response', () => {
    // Red cannon (file 2) -> middle of the board is a legal opening move.
    const ok = useGameStore.getState().playerMove(pos(7, 2), pos(4, 2));
    expect(ok).toBe(true);
    const g = useGameStore.getState().game;
    expect(g.history.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a move to an illegal destination', () => {
    // (7,2) -> (7,0) would land on the red knight occupying (7,0); a cannon
    // cannot capture its own piece, so the move is illegal and rejected.
    const ok = useGameStore.getState().playerMove(pos(7, 2), pos(7, 0));
    expect(ok).toBe(false);
  });

  it('undo reverts to the previous state and pops the undo stack', () => {
    const before = useGameStore.getState().game;
    useGameStore.getState().playerMove(pos(7, 2), pos(4, 2));
    // Wait out the 300ms AI delay in a real run; here we just check undo.
    useGameStore.getState().undo();
    const after = useGameStore.getState().game;
    expect(after).toEqual(before);
  });
});

describe('gameStore.requestHint', () => {
  it('populates a hint for the side to move', () => {
    useGameStore.getState().requestHint();
    const hint = useGameStore.getState().hint;
    expect(hint).not.toBeNull();
    expect(hint!.explanation.length).toBeLessThanOrEqual(30);
  });
});
