/**
 * v1.14 anti-mechanical variety: deterministic inside a game, different
 * between games, and only between moves the search considers equal.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, makeMove } from '../../engine/rules';
import type { GameState } from '../../engine/types';
import { EngineImpl, defaultConfig } from '../engine';
import { chooseByRoll, decisionRoll, flatMoveCode, mix32, pickWeighted } from '../variety';

describe('deterministic variety helpers', () => {
  it('mixes numbers avalanche-style and stays pure', () => {
    expect(mix32(1234)).toBe(mix32(1234));
    expect(mix32(1234)).not.toBe(mix32(1235));
    expect(Number.isInteger(mix32(1234))).toBe(true);
  });

  it('is stable for one game salt and changes with another', () => {
    const items: number[] = [10, 20, 30, 40];
    const codeOf = (item: number): number => item;
    expect(chooseByRoll(items, codeOf, 77, 0x1234))
      .toBe(chooseByRoll(items, codeOf, 77, 0x1234));
    const picked: Set<number> = new Set<number>();
    for (let salt = 0; salt < 24; salt++) {
      picked.add(chooseByRoll(items, codeOf, salt, 0x1234)!);
    }
    expect(picked.size).toBeGreaterThan(1);
    expect(decisionRoll(1, 2, 3)).not.toBe(decisionRoll(2, 2, 3));
  });

  it('keeps weighted opening branches proportionally frequent', () => {
    const weights: number[] = [20, 8, 5, 5];
    let first: number = 0;
    for (let salt = 0; salt < 2000; salt++) {
      if (pickWeighted(weights, decisionRoll(salt, 0x55aa, 0)) === 0) first += 1;
    }
    expect(first / 2000).toBeGreaterThan(0.4);
    expect(first / 2000).toBeLessThan(0.6);
    expect(pickWeighted([0, 0], 7)).toBe(-1);
  });

  it('encodes distinct moves without collisions', () => {
    expect(flatMoveCode(0, 1, 1)).not.toBe(flatMoveCode(1, 0, 1));
    expect(flatMoveCode(12, 13, 4)).not.toBe(flatMoveCode(12, 13, 5));
  });
});

describe('engine opening and middlegame variety', () => {
  it('different games open differently, but every reply is legal', () => {
    const openings: Set<string> = new Set<string>();
    const start: GameState = createInitialState('red');
    for (let game = 0; game < 12; game++) {
      const engine = new EngineImpl(() => 0.5);
      engine.setGameSalt(1000 + game * 7919);
      const move = engine.getBestMove(start, defaultConfig('master'));
      expect(move).not.toBeNull();
      openings.add(`${move!.piece}:${move!.from.col},${move!.from.row}->${move!.to.col},${move!.to.row}`);
    }
    expect(openings.size, 'twelve games should show more than one opener').toBeGreaterThan(1);
  });

  it('one repeated middlegame position is always answered identically', () => {
    let state: GameState = createInitialState('red');
    const first = makeMove(state.board, { col: 0, row: 3 }, { col: 0, row: 4 })!;
    state = applyMoveToState(state, first);
    const engine = new EngineImpl(() => 0.5);
    engine.setGameSalt(2026);
    const cfg = { ...defaultConfig('master'), depth: 4 };
    const a = engine.getBestMove(state, cfg);
    const b = engine.getBestMove(state, cfg);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });
});
