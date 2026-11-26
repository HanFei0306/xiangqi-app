/**
 * v2026.11.23.4 speed release — native engine opening book.
 *
 * Covers the two contracts that keep the 14s master search from firing in the
 * opening WITHOUT weakening the engine:
 *   1. openingBookReply is the one shared decision function: legal book move
 *      on a known main line, null off-line / off-horizon / low material;
 *   2. AncientBookEngine short-circuits ONLY a native Pikafish base, and only
 *      on a book hit — the self-engine path is untouched.
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import { generateNotation } from '../../engine/notation';
import type { GameState, Move } from '../../engine/types';
import { Board } from '../../engine/board';
import {
  BOOK_LINES,
  MAX_BOOK_PLY,
  bookRepliesFor,
  openingBookReplyForState,
  type BookLine,
} from '../openingBook';
import { defaultConfig } from '../engine';
import { PikafishEngine } from '../nativeEngine';
import { AncientBookEngine } from '../activeEngine';
import type { Engine } from '../types';

/** Replay a book line with the real rules so history notations are genuine. */
function replay(line: BookLine, plies: number): GameState {
  let state = createInitialState('red');
  for (let i = 0; i < plies; i++) {
    const move: Move | undefined = generateLegalMoves(state.board, state.turn).find(
      (candidate) => generateNotation(state.board, candidate, state.turn) === line.moves[i],
    );
    if (!move) throw new Error(`${line.system} ply ${i + 1} (${line.moves[i]}) is not legal`);
    state = applyMoveToState(state, move);
  }
  return state;
}

function isLegal(state: GameState, move: Move): boolean {
  return generateLegalMoves(state.board, state.turn).some(
    (candidate) => candidate.from.col === move.from.col && candidate.from.row === move.from.row
      && candidate.to.col === move.to.col && candidate.to.row === move.to.row,
  );
}

/** Native adapter with call counters — proves whether deep search was skipped. */
class SpyPikafish extends PikafishEngine {
  public asyncCalls = 0;
  public syncCalls = 0;

  override async getBestMoveAsync(
    state: GameState, cfg: Parameters<PikafishEngine['getBestMove']>[1],
  ): Promise<Move | null> {
    this.asyncCalls += 1;
    return super.getBestMoveAsync(state, cfg);
  }

  override getBestMove(state: GameState, cfg: Parameters<PikafishEngine['getBestMove']>[1]): Move | null {
    this.syncCalls += 1;
    return super.getBestMove(state, cfg);
  }
}

describe('shared opening book decision (v2026.11.23.4)', () => {
  it('returns a legal, non-passive book move from the initial position', () => {
    const state = createInitialState('red');
    const move = openingBookReplyForState(state);
    expect(move).not.toBeNull();
    expect(isLegal(state, move!)).toBe(true);
    // Legal-move generation leaves `notation` empty; Board.applyMove fills it
    // later. Compare the notation this move WOULD produce.
    const notation = generateNotation(state.board, move!, state.turn);
    expect(bookRepliesFor([])).toContain(notation);
    expect('相象仕士帅将').not.toContain(notation.charAt(0));
  });

  it('hits every ply of all six main lines with a legal move', () => {
    let hits = 0;
    let checked = 0;
    for (const line of BOOK_LINES) {
      for (let ply = 0; ply < line.moves.length - 1; ply++) {
        const state = replay(line, ply);
        const move = openingBookReplyForState(state);
        checked += 1;
        if (move) {
          hits += 1;
          expect(isLegal(state, move)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(80);
    expect(hits).toBe(checked); // 100% on-line hit rate
  });

  it('returns null after a human deviation (no longest-prefix guessing)', () => {
    const state = replay(BOOK_LINES[0], 2);
    const offLine: GameState = {
      ...state,
      history: [
        state.history[0],
        { ...state.history[1], notation: '车九进九' }, // not a known main-line prefix
      ],
    };
    expect(openingBookReplyForState(offLine)).toBeNull();
  });

  it('returns null past the book horizon and on a low-material setup', () => {
    // A long on-line history past MAX_BOOK_PLY must hand over to full search.
    const long: GameState = {
      ...createInitialState('red'),
      history: Array.from({ length: MAX_BOOK_PLY + 1 }, (_, i) => ({
        from: { col: 7, row: 2 }, to: { col: 4, row: 2 },
        piece: 'C' as const, captured: null,
        notation: i % 2 === 0 ? '炮二平五' : '砲八平五',
      })),
    };
    expect(openingBookReplyForState(long)).toBeNull();

    // A minimal two-kings endgame (the first ancient puzzle has 25 men, which
    // legitimately passes the >=24 opener gate).
    const rows: string[][] = Array.from({ length: 10 }, () => Array(9).fill('.'));
    rows[0][4] = 'K';
    rows[9][4] = 'k';
    const endgame: GameState = {
      board: Board.fromNotationSetup(rows.map((row) => row.join(',')).join('/')),
      turn: 'red', history: [], status: 'playing', moveCount: 0,
    };
    expect(openingBookReplyForState(endgame)).toBeNull();
  });
});

describe('AncientBookEngine native shortcut', () => {
  const cfg = defaultConfig('master');

  it('skips the native search entirely on a book hit (both sync and async)', async () => {
    const state = createInitialState('red');
    const native = new SpyPikafish();
    const engine = new AncientBookEngine(native);

    const asyncMove = await engine.getBestMoveAsync(state, cfg);
    expect(asyncMove).not.toBeNull();
    expect(isLegal(state, asyncMove!)).toBe(true);
    expect(native.asyncCalls).toBe(0); // 14s search never started

    const syncMove = engine.getBestMove(state, cfg);
    expect(syncMove).not.toBeNull();
    expect(native.syncCalls).toBe(0);
  });

  it('falls through to full native search when off book', async () => {
    const played = replay(BOOK_LINES[0], 2);
    const offLine: GameState = {
      ...played,
      history: [played.history[0], { ...played.history[1], notation: '车九进九' }],
    };
    const native = new SpyPikafish();
    const engine = new AncientBookEngine(native);
    // No native bridge in jsdom: the base returns null, but it MUST be called.
    expect(await engine.getBestMoveAsync(offLine, cfg)).toBeNull();
    expect(native.asyncCalls).toBe(1);
  });

  it('never applies the book a second time to the self-engine path', () => {
    const state = createInitialState('red');
    const expected = generateLegalMoves(state.board, state.turn)[0];
    let calls = 0;
    const stub: Engine = {
      getBestMove(): Move | null { calls += 1; return expected; },
      evaluate(): number { return 0; },
    };
    const engine = new AncientBookEngine(stub);
    expect(engine.getBestMove(state, cfg)).toEqual(expected);
    expect(calls).toBe(1); // base really was consulted, not bypassed by the book
  });
});
