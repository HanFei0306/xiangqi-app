import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { generateLegalMoves, checkStatus } from '../../engine/rules';
import { alphabeta, bestMove, MATE_SCORE } from '../search';
import { EngineImpl } from '../engine';
import type { GameState, Piece, Pos, Side } from '../../engine/types';
import type { AIConfig } from '../types';

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

describe('alphabeta mate detection', () => {
  it('scores a checkmated side to a large negative value', () => {
    // Black is checkmated (two red rooks). Red to deliver; black to move = mated.
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } }, // file 4
      { pos: pos(0, 9), piece: { type: 'R', side: 'red' } }, // rank 9
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

describe('bestMove', () => {
  it('returns a legal move from the opening position', () => {
    const s = state(new Board(), 'red');
    const move = bestMove(s, 2);
    expect(move).not.toBeNull();
    const legal = generateLegalMoves(s.board, 'red');
    expect(legal.some((m) => m.to.col === move!.to.col && m.to.row === move!.to.row && m.from.col === move!.from.col && m.from.row === move!.from.row)).toBe(true);
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
    const move = bestMove(s, 2);
    expect(move).not.toBeNull();
    expect(move!.to).toEqual(pos(0, 9)); // capture the black rook
  });
});

describe('EngineImpl difficulty', () => {
  it('beginner config resolves depth 2 with high randomness', () => {
    const engine = new EngineImpl(() => 0.5);
    const cfg: AIConfig = { difficulty: 'beginner', depth: 0, randomness: 0, mistakeRate: 0 };
    const move = engine.getBestMove(state(new Board(), 'red'), cfg);
    expect(move).not.toBeNull();
  });

  it('master never returns null on a normal position and plays a legal move', () => {
    const engine = new EngineImpl(() => 0.5);
    const cfg: AIConfig = { difficulty: 'master', depth: 4, randomness: 0, mistakeRate: 0 };
    const move = engine.getBestMove(state(new Board(), 'black'), cfg);
    expect(move).not.toBeNull();
    const legal = generateLegalMoves(new Board(), 'black');
    expect(legal.some((m) => m.to.col === move!.to.col && m.to.row === move!.to.row)).toBe(true);
  });

  it('returns null when the side to move has no legal moves', () => {
    // Black is checkmated.
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(0, 9), piece: { type: 'R', side: 'red' } },
    ]);
    const engine = new EngineImpl();
    expect(engine.getBestMove(state(board, 'black'), { difficulty: 'master', depth: 3, randomness: 0, mistakeRate: 0 })).toBeNull();
  });
});
