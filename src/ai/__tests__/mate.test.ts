/**
 * v2026.11.19.8 forced-mate regression guard.
 * A mate solver must be PROVEN, not heuristic: it never claims a mate that
 * the defender can escape, and it finds real mates in the ancient corpus.
 */
import { describe, expect, it } from 'vitest';
import { Board } from '../../engine/board';
import { applyMoveToState } from '../../engine/rules';
import type { GameState } from '../../engine/types';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import { findMateInOne, findForcedMate } from '../mate';

function stateFrom(setup: string): GameState {
  return { board: Board.fromNotationSetup(setup), turn: 'red', history: [], status: 'playing', moveCount: 0 };
}

describe('v2026.11.19.8 杀棋求解器', () => {
  it('开局不存在一步杀，求解器不误报', () => {
    expect(findMateInOne(stateFrom(SHIQINGYAQU[0].setup), 'red')).toBeNull();
  });

  it('真实残局：求解器找到的一步杀确实将死对方', () => {
    let found = 0;
    for (const puzzle of SHIQINGYAQU.slice(0, 60)) {
      let state = stateFrom(puzzle.setup);
      for (let i = 0; i < puzzle.solution.length; i++) {
        const side = i % 2 === 0 ? 'red' : 'black';
        const mate = findMateInOne(state, side);
        if (mate) {
          found += 1;
          const after = applyMoveToState(state, mate);
          expect(['checkmate', 'stalemate']).toContain(after.status);
        }
        state = applyMoveToState(state, puzzle.solution[i]);
        if (state.status === 'checkmate' || state.status === 'stalemate') break;
      }
    }
    expect(found).toBeGreaterThan(30); // 45 on current corpus — a real guard, not a tautology
  });

  it('findForcedMate(mate-in-1 only) agrees with findMateInOne', () => {
    for (const puzzle of SHIQINGYAQU.slice(0, 40)) {
      const state = stateFrom(puzzle.setup);
      const quick = findMateInOne(state, 'red');
      const forced = findForcedMate(state, 'red', { maxOwnMoves: 1, timeMs: 500 });
      expect(!!forced).toBe(!!quick);
      if (forced) expect(forced.plies).toBe(1);
    }
  });

  it('行棋方不是自己时不返回着法', () => {
    const state = stateFrom(SHIQINGYAQU[0].setup);
    expect(findMateInOne(state, 'black')).toBeNull();
    expect(findForcedMate(state, 'black', { maxOwnMoves: 1 })).toBeNull();
  });
});
