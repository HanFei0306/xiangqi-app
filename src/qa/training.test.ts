/**
 * QA acceptance tests — training layer (tactics / hint / replay).
 *
 * `match()` applies the move (-> applyMove -> generateNotation ->
 * missing `PIECE_CHAR`) and also reads `PIECE_VALUE[moved.type]` in
 * `tactics.ts`. Both symbols are missing from pieces.ts, so most
 * `match` calls throw today (the one existing test that "passes" only
 * does so because the throw is swallowed by match's try/catch and
 * the test expected null). The assertions below describe the CORRECT
 * behaviour and currently FAIL (see QA report for root causes).
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../engine/board';
import { applyMoveToState } from '../engine/rules';
import { match } from '../training/tactics';
import { getHint } from '../training/hint';
import { analyze } from '../training/replay';
import type { GameState, Move, Piece, Pos, Side } from '../engine/types';
import { EngineImpl } from '../ai/engine';
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

function move(from: Pos, to: Pos, piece: Piece['type']): Move {
  return { from, to, piece, captured: null, notation: '' };
}

describe('tactics.match (requires PIECE_VALUE / PIECE_CHAR — currently broken)', () => {
  it('detects a check', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 2), piece: { type: 'R', side: 'red' } },
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
    ]);
    // Red rook slides up the file to (4,7), giving check to the black king at
    // (4,9) along file 4 (the rook is two squares away, so it is not hanging).
    const m = move(pos(4, 2), pos(4, 7), 'R');
    const before = state(board, 'red');
    const after = applyMoveToState(before, m);
    expect(after.status).toBe('check');
    expect(match(before, m)?.kind).toBe('check');
  });

  it('detects a fork (one piece attacks two enemies)', () => {
    const board = boardWith([
      { pos: pos(8, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 6), piece: { type: 'N', side: 'red' } },
      { pos: pos(7, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(6, 9), piece: { type: 'R', side: 'black' } },
      { pos: pos(4, 9), piece: { type: 'R', side: 'black' } },
    ]);
    const m = move(pos(3, 6), pos(5, 7), 'N');
    const before = state(board, 'red');
    expect(match(before, m)?.kind).toBe('fork');
  });

  it('detects a blunder (a hanging valuable piece)', () => {
    const board = boardWith([
      { pos: pos(8, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(7, 9), piece: { type: 'K', side: 'black' } },
      { pos: pos(0, 9), piece: { type: 'R', side: 'black' } },
    ]);
    const m = move(pos(4, 0), pos(0, 0), 'R');
    const before = state(board, 'red');
    expect(match(before, m)?.kind).toBe('blunder');
  });
});

describe('hint.getHint (requires engine + PIECE_VALUE — currently broken)', () => {
  it('returns a move plus a <=30-char explanation', () => {
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 2), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const s = state(board, 'red');
    const engine = new EngineImpl(() => 0.5);
    const cfg: AIConfig = {
      difficulty: 'intermediate',
      depth: 1,
      randomness: 0,
      mistakeRate: 0,
    };
    const hint = getHint(s, engine, cfg);
    expect(hint.move).toBeDefined();
    expect(hint.explanation.length).toBeLessThanOrEqual(30);
  });
});

describe('replay.analyze (requires tactics)', () => {
  it('tags the mating move as checkmate', () => {
    const board = boardWith([
      { pos: pos(4, 9), piece: { type: 'K', side: 'black' } },
      // Two red rooks on the 9th rank cover the black king's escape squares
      // (3,9) and (5,9); the third rook will check along file 4.
      { pos: pos(0, 9), piece: { type: 'R', side: 'red' } },
      { pos: pos(8, 9), piece: { type: 'R', side: 'red' } },
      { pos: pos(4, 0), piece: { type: 'R', side: 'red' } },
    ]);
    // Red delivers mate in one with R(4,0)->(4,7): checks along file 4 while
    // the rank-9 rooks cover the king's only escape squares.
    const mate: Move = move(pos(4, 0), pos(4, 7), 'R');
    const after = applyMoveToState(state(board, 'red'), mate);
    const annotations = analyze([mate], after);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].tag).toBe('checkmate');
  });
});
