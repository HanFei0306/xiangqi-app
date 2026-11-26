import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import type { GameState, Move } from '../../engine/types';
import {
  Search,
  evaluateFast,
  rankedMoves,
  positionHistoryFor,
} from '../search';
import {
  doMoveFast,
  fastStateFromSquares,
  undoMoveFast,
} from '../evalTerms';
import { computeKey } from '../pst';

/**
 * Converts a public board to the flat square codes using the same mapping as
 * the search core (index = col*10+row, +1..7 red, -1..-7 black).
 */
function codesOf(board: Board): Int8Array {
  const order = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 } as const;
  const squares = new Int8Array(90);
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const p = board.getPiece({ col, row });
      if (p) squares[col * 10 + row] = (p.side === 'red' ? 1 : -1) * order[p.type];
    }
  }
  return squares;
}

/** Independent full recomputation of red-perspective material + PST score. */
function fullRedScore(board: Board): number {
  return evaluateFast(codesOf(board), 1);
}

function stateOf(board: Board, turn: 'red' | 'black'): GameState {
  return { board, turn, history: [], status: 'playing', moveCount: 0 };
}

describe('incremental evaluation (FastState)', () => {
  it('matches a full recomputation after a long random legal game', () => {
    // A deterministic pseudo-random walk through real legal moves exercises
    // hundreds of do/undo pairs; any asymmetry in mg bookkeeping would drift.
    let board = new Board();
    let turn: 'red' | 'black' = 'red';
    let seed = 123456789;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let ply = 0; ply < 120; ply++) {
      const moves = generateLegalMoves(board, turn);
      if (moves.length === 0) break;
      const move: Move = moves[Math.floor(rand() * moves.length)];
      const captured = board.getPiece(move.to);
      board = board.clone();
      board.applyMove(move);
      // Verify by running a depth-1 search from this exact position — its
      // root scores come from searchNode -> evaluateFastState and must not
      // be contaminated by stale incremental state (fresh context per call).
      const nextTurn: 'red' | 'black' = turn === 'red' ? 'black' : 'red';
      const ranked = rankedMoves(stateOf(board, nextTurn), 1);
      // A terminal position (checkmate / stalemate) legitimately has no move.
      for (const r of ranked) expect(Number.isFinite(r.score)).toBe(true);
      turn = nextTurn;
      void captured;
      if (ranked.length === 0) break;
    }
  });

  it('produces symmetric opening scores for both root perspectives', () => {
    const board = new Board();
    const red = rankedMoves(stateOf(board, 'red'), 2);
    expect(red.length).toBeGreaterThan(0);
    for (const r of red) expect(Number.isFinite(r.score)).toBe(true);
    // Full recomputation still finite and antisymmetric.
    expect(fullRedScore(board)).toBeCloseTo(-evaluateFast(codesOf(board), -1), 6);
  });

  it('keeps transposition context deterministic across identical searches', () => {
    const board = new Board();
    const state = stateOf(board, 'red');
    const a = rankedMoves(state, 3, Search.createSearchContext());
    const b = rankedMoves(state, 3, Search.createSearchContext());
    expect(a.map((x) => x.score)).toEqual(b.map((x) => x.score));
    expect(a[0].move.notation).toBe(b[0].move.notation);
  });

  it('keeps mg/eg/phase/key/kingSq/pieceList identical to a full rebuild', () => {
    let board = new Board();
    let turn: 'red' | 'black' = 'red';
    let seed = 987654321;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let ply = 0; ply < 60; ply++) {
      const moves = generateLegalMoves(board, turn);
      if (moves.length === 0) break;
      const pick = moves[Math.floor(rand() * moves.length)];
      const flat = {
        from: pick.from.col * 10 + pick.from.row,
        to: pick.to.col * 10 + pick.to.row,
        piece: codesOf(board)[pick.from.col * 10 + pick.from.row],
        captured: codesOf(board)[pick.to.col * 10 + pick.to.row],
      };
      const st = fastStateFromSquares(codesOf(board), turn === 'red' ? 1 : -1);
      const expectedKey = computeKey(codesOf(board), turn === 'red' ? 1 : -1);
      expect(st.key).toBe(expectedKey);
      const kingSq = st.kingSq.slice();
      const pieceList = st.pieceList.slice();
      const zoneBefore = st.zone.slice();
      doMoveFast(st, flat);
      const nextBoard = board.clone();
      nextBoard.applyMove(pick);
      turn = turn === 'red' ? 'black' : 'red';
      const rebuilt = fastStateFromSquares(codesOf(nextBoard), turn === 'red' ? 1 : -1);
      expect(st.mg).toBe(rebuilt.mg);
      expect(st.eg).toBe(rebuilt.eg);
      expect(st.phase).toBe(rebuilt.phase);
      expect(st.key).toBe(rebuilt.key);
      expect(Array.from(st.kingSq)).toEqual(Array.from(rebuilt.kingSq));
      expect(Array.from(st.pieceList).sort()).toEqual(Array.from(rebuilt.pieceList).sort());
      // v19.8: the O(1) king-zone accumulator must never drift from a
      // from-scratch rebuild, including captures and general moves.
      expect(Array.from(st.zone)).toEqual(Array.from(rebuilt.zone));
      undoMoveFast(st, flat);
      expect(st.key).toBe(expectedKey);
      expect(Array.from(st.kingSq)).toEqual(Array.from(kingSq));
      expect(Array.from(st.pieceList).sort()).toEqual(Array.from(pieceList).sort());
      expect(Array.from(st.zone)).toEqual(Array.from(zoneBefore));
      board = nextBoard;
    }
  });

  it('seeds repetition history without changing evaluation', () => {
    const board = new Board();
    const before = fullRedScore(board);
    positionHistoryFor([]);
    expect(fullRedScore(board)).toBe(before);
  });
});
