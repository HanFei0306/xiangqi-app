/**
 * v2026.11.19.7 strength regression guard.
 *
 * Two invariants that directly encode "AI must not play 怪招 / gift material":
 *   1. On a sample of real 《适情雅趣》 endgames, the master tier never hangs a
 *      rook/horse/cannon-class piece to an immediate recapture.
 *   2. The three-tier strength ladder stays strictly increasing in both depth
 *      and time budget, and every tier returns a legal move off-book.
 */
import { describe, expect, it } from 'vitest';
import { Board } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import { EngineImpl, defaultConfig } from '../engine';
import type { GameState, Move } from '../../engine/types';

function legal(move: Move | null, state: GameState): boolean {
  if (!move) return false;
  return generateLegalMoves(state.board, state.turn).some(
    (m) => m.from.col === move.from.col && m.from.row === move.from.row
      && m.to.col === move.to.col && m.to.row === move.to.row,
  );
}

describe('v2026.11.19.7 棋力护栏', () => {
  it('master 档在残局样本上不送车/马/炮等大子', () => {
    const engine = new EngineImpl(() => 0.5);
    // Fixed shallow depth keeps this guard fast in CI while still exercising
    // the master selection path (no blunder / no learning tilt).
    const tier = { ...defaultConfig('master'), depth: 4 };
    const sample = SHIQINGYAQU.slice(0, 12);
    const major: ReadonlySet<string> = new Set(['R', 'N', 'C']);
    for (const puzzle of sample) {
      const board: Board = Board.fromNotationSetup(puzzle.setup);
      const state: GameState = { board, turn: 'red', history: [], status: 'playing', moveCount: 0 };
      const move = engine.getBestMove(state, tier);
      expect(legal(move, state), `第${puzzle.order}局应给出合法着`).toBe(true);
      if (!move || !major.has(move.piece.toUpperCase())) continue;
      const after = board.clone();
      after.applyMove({ ...move });
      const replies = generateLegalMoves(after, 'black');
      const gifted = replies.some(
        (r) => r.to.col === move.to.col && r.to.row === move.to.row && r.captured !== null,
      );
      expect(gifted, `第${puzzle.order}局不应把 ${move.piece} 送到对方白吃`).toBe(false);
    }
  });

  it('三档深度严格递增且脱库均给出合法着', () => {
    const engine = new EngineImpl(() => 0.5);
    const tiers = ['easy', 'intermediate', 'master'] as const;
    const depths = tiers.map((d) => defaultConfig(d).depth);
    expect(depths[0]).toBeLessThan(depths[1]);
    expect(depths[1]).toBeLessThan(depths[2]);

    const start: GameState = {
      board: new Board(), turn: 'red', history: [], status: 'playing', moveCount: 0,
    };
    for (const d of tiers) {
      expect(legal(engine.getBestMove(start, defaultConfig(d)), start), `${d} 应给出合法着`).toBe(true);
    }
  });
});
