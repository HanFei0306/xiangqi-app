/**
 * Regression tests for the Zobrist transposition-table key.
 *
 * The v1.9 rewrite initially used `p = code + 2` as the piece index. Black
 * pieces have negative codes (-7..-1), so `p` went negative and
 * `Uint32Array[negative]` returned `undefined` — every black piece silently
 * xored nothing, and any two positions that differed ONLY in black's layout
 * collided in the TT. The visible symptom: black opened with absurd king
 * moves ("将五进一") because unrelated positions' cached scores leaked in.
 */
import { describe, it, expect } from 'vitest';
import { makeKey } from '../search';
import { Board } from '../../engine/board';
import { bestMove } from '../search';
import type { GameState, Side } from '../../engine/types';

/** Flat-board index used internally by the search (col * 10 + row). */
function idx(col: number, row: number): number {
  return col * 10 + row;
}

/** Codes: K=1, A=2, B=3, N=4, R=5, C=6, P=7; negative for black. */
function emptySquares(): Int8Array {
  return new Int8Array(90);
}

function state(board: Board, turn: Side): GameState {
  return { board, turn, history: [], status: 'playing', moveCount: 0 };
}

describe('Zobrist TT key', () => {
  it('distinguishes positions differing only in BLACK piece layout', () => {
    // Both: red king (4,0) + black king (4,9); black rook at (0,9) vs (1,9).
    const a = emptySquares();
    a[idx(4, 0)] = 1;
    a[idx(4, 9)] = -1;
    a[idx(0, 9)] = -5;

    const b = emptySquares();
    b[idx(4, 0)] = 1;
    b[idx(4, 9)] = -1;
    b[idx(1, 9)] = -5;

    expect(makeKey(a, -1, 1)).not.toBe(makeKey(b, -1, 1));
  });

  it('distinguishes positions differing only in RED piece layout', () => {
    const a = emptySquares();
    a[idx(4, 0)] = 1;
    a[idx(4, 9)] = -1;
    a[idx(0, 0)] = 5;

    const b = emptySquares();
    b[idx(4, 0)] = 1;
    b[idx(4, 9)] = -1;
    b[idx(1, 0)] = 5;

    expect(makeKey(a, 1, -1)).not.toBe(makeKey(b, 1, -1));
  });

  it('distinguishes the same position with a different side to move', () => {
    const a = emptySquares();
    a[idx(4, 0)] = 1;
    a[idx(4, 9)] = -1;

    expect(makeKey(a, 1, 1)).not.toBe(makeKey(a, -1, 1));
  });

  it('always produces a safe integer (negative allowed: JS xor is Int32)', () => {
    const a = emptySquares();
    for (let i = 0; i < 90; i++) {
      a[i] = ((i % 15) - 7) % 2 === 0 ? (i % 7) + 1 : -((i % 7) + 1);
    }
    for (const turn of [1, -1]) {
      const key = makeKey(a, turn, 1);
      expect(Math.abs(key)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      expect(Number.isInteger(key)).toBe(true);
    }
  });

  it('black never opens with a king move (TT pollution symptom)', () => {
    // The reported QA failure: after red's edge-pawn advance, black (master
    // search) played 将五进一 — a king move no sane opening search produces.
    const board = new Board();
    const s = state(board, 'black');
    const move = bestMove(s, 3);
    expect(move).not.toBeNull();
    expect(move!.piece).not.toBe('K');
  });
});
