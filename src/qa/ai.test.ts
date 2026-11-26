/**
 * QA acceptance tests — AI layer (evaluate / search / engine).
 *
 * Almost every function here routes through `material()`, which reads
 * `PIECE_VALUE[piece.type]`. `pieces.ts` does NOT export
 * `PIECE_VALUE`, so `evaluateState`, `bestMove`, `alphabeta` and
 * `EngineImpl.getBestMove` all throw today. The assertions below
 * describe the CORRECT behaviour; they currently FAIL because of the
 * missing `PIECE_VALUE` export (see QA report).
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../engine/board';
import { initialBoardGrid } from '../engine/pieces';
import { generateLegalMoves, checkStatus } from '../engine/rules';
import { evaluateState, material } from '../ai/evaluate';
import { alphabeta, bestMove, MATE_SCORE } from '../ai/search';
import { EngineImpl } from '../ai/engine';
import type { GameState, Piece, Pos, Side } from '../engine/types';
import type { AIConfig } from '../ai/types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

function boardWith(pieces: Array<{ pos: Pos; piece: Piece }>): Board {
  const board = new Board(
    Array.from({ length: 9 }, () => new Array(10).fill(null)),
  );
  for (const { pos: p, piece } of pieces) {
    board.setPiece(p, piece);
  }
  return board;
}

function state(board: Board, turn: Side): GameState {
  return { board, turn, history: [], status: 'playing', moveCount: 0 };
}

function initialBoard(): Board {
  return new Board(initialBoardGrid());
}

describe('material (requires PIECE_VALUE — currently broken)', () => {
  it('counts piece values from the side perspective (equal -> 0)', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'R', side: 'black' } },
    ]);
    expect(material(board, 'red')).toBe(0);
    expect(material(board, 'black')).toBe(0);
  });

  it('is positive when the side is ahead', () => {
    const board = boardWith([
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'N', side: 'black' } },
    ]);
    expect(material(board, 'red')).toBeGreaterThan(0);
    expect(material(board, 'black')).toBeLessThan(0);
  });
});

describe('evaluateState (requires PIECE_VALUE — currently broken)', () => {
  it('is antisymmetric between sides', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'R', side: 'black' } },
    ]);
    const s = state(board, 'red');
    expect(evaluateState(s, 'red')).toBeCloseTo(-evaluateState(s, 'black'), 6);
  });

  it('returns a finite number on the opening position', () => {
    const s = state(initialBoard(), 'red');
    expect(Number.isFinite(evaluateState(s, 'red'))).toBe(true);
  });
});

describe('alphabeta mate detection (requires PIECE_VALUE — currently broken)', () => {
  it('scores a checkmated side to a large negative value', () => {
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(0, 9), piece: { type: 'R', side: 'red' } },
    ]);
    const s = state(board, 'black');
    expect(generateLegalMoves(board, 'black')).toHaveLength(0);
    expect(checkStatus(board, 'black')).toBe('checkmate');
    const fromRed = alphabeta(s, 1, -Infinity, Infinity, 'red');
    const fromBlack = alphabeta(s, 1, -Infinity, Infinity, 'black');
    expect(fromRed).toBeGreaterThan(MATE_SCORE - 100);
    expect(fromBlack).toBeLessThan(-(MATE_SCORE - 100));
  });
});

describe('bestMove (requires PIECE_VALUE — currently broken)', () => {
  it('returns a legal move from the opening position', () => {
    const s = state(initialBoard(), 'red');
    const mv = bestMove(s, 2);
    expect(mv).not.toBeNull();
    const legal = generateLegalMoves(s.board, 'red');
    expect(
      legal.some(
        (m) =>
          m.to.col === mv!.to.col &&
          m.to.row === mv!.to.row &&
          m.from.col === mv!.from.col &&
          m.from.row === mv!.from.row,
      ),
    ).toBe(true);
  });

  it('captures a free enemy rook (material gain)', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 4), piece: { type: 'P', side: 'red' } }, // blocks flying general
      { pos: pos(0, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 9), piece: { type: 'R', side: 'black' } },
    ]);
    const s = state(board, 'red');
    const mv = bestMove(s, 2);
    expect(mv).not.toBeNull();
    expect(mv!.to).toEqual(pos(0, 9)); // capture the black rook
  });
});

describe('EngineImpl difficulty (requires PIECE_VALUE / defaultConfig — currently broken)', () => {
  it('beginner config resolves and returns a legal move', () => {
    const engine = new EngineImpl(() => 0.5);
    const cfg: AIConfig = {
      difficulty: 'beginner',
      depth: 0,
      randomness: 0,
      mistakeRate: 0,
    };
    const mv = engine.getBestMove(state(initialBoard(), 'red'), cfg);
    expect(mv).not.toBeNull();
  });

  it('returns null when the side to move has no legal moves', () => {
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(0, 9), piece: { type: 'R', side: 'red' } },
    ]);
    const engine = new EngineImpl();
    expect(
      engine.getBestMove(state(board, 'black'), {
        difficulty: 'master',
        depth: 3,
        randomness: 0,
        mistakeRate: 0,
      }),
    ).toBeNull();
  });
});
