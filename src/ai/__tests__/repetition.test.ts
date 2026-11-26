/**
 * Regression tests for repetition / perpetual-check handling.
 *
 * Before v1.9 the engine had no repetition memory: a side ahead in material
 * happily shuffled perpetual checks forever (observed in self-play as
 * 砲七进二/砲七退二 looping against 帅六进一/帅六退一 to move 140). Two layers
 * fix it: the search scores a repeated position as a draw, and the game
 * declares a draw on threefold repetition.
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { makeMove } from '../../engine/rules';
import {
  createSearchContext,
  rankedMoves,
  positionKeysFor,
  positionKeyOf,
  MATE_SCORE,
} from '../search';
import type { GameState, Piece, Pos, Side } from '../../engine/types';

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

describe('positionKeysFor', () => {
  it('returns [] for an empty history (custom setups)', () => {
    expect(positionKeysFor([])).toEqual([]);
  });

  it('replays the standard start and keys every ply', () => {
    const board = new Board();
    // 炮二平五: red cannon from (7,2) to the center file (4,2).
    const move = makeMove(board, pos(7, 2), pos(4, 2));
    expect(move).not.toBeNull();
    const keys = positionKeysFor([move!]);
    expect(keys).toHaveLength(2); // initial + after the move
    expect(keys[0]).toBe(positionKeyOf(new Board(), 'red'));
    const applied = board.clone();
    applied.applyMove({ ...move! });
    expect(keys[1]).toBe(positionKeyOf(applied, 'black'));
  });
});

describe('null-move repetition safety', () => {
  it('does not score a null child as a cross-history repetition', () => {
    // The board is untouched but a null child flips the logical side to move.
    // Seeding the OPPOSITE-side key must not create a false draw there.
    const board = new Board();
    const s = state(board, 'red');
    const ctx = createSearchContext();
    ctx.seenKeys = [positionKeyOf(board, 'black')];
    const ranked = rankedMoves(s, 3, ctx);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].score).not.toBe(0);
    expect(Number.isFinite(ranked[0].score)).toBe(true);
  });
});

describe('search-level repetition guard', () => {
  it('a winning engine never continues the shuttle into a known repetition', () => {
    // Mid-shuttle position: black has just checked from (5,3) and red's king
    // was forced to (4,0). The position before the shuttle (rook (4,3), king
    // (5,0), black to move) is part of the real game history, so — exactly as
    // the engine seeds `seenKeys` in the app — the re-check line walks back
    // into a known position. v1.9 scored that as a draw (0). v1.10 judges
    // the cycle as a black perpetual check (长将判负, a near-mate loss for
    // black). Either way the winning engine must strictly prefer a quiet
    // move over the re-check.
    const preShuttle = boardWith([
      { pos: pos(5, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const mid = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(5, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const s = state(mid, 'black');
    const ctx = createSearchContext();
    ctx.seenKeys = [positionKeyOf(preShuttle, 'black')];
    const ranked = rankedMoves(s, 4, ctx);
    const recheck = ranked.find(
      (r) =>
        r.move.from.col === 5 && r.move.from.row === 3 &&
        r.move.to.col === 4 && r.move.to.row === 3,
    );
    expect(recheck).toBeDefined();
    expect(recheck!.score).toBeLessThan(ranked[0].score);
  });

  it('scores a perpetual-check line as a near-mate LOSS for the checker', () => {
    // Black is BEHIND in material (rook + cannon vs advisor + rook + cannon
    // for red... concretely: black has one rook, red has rook + cannon +
    // advisor). The only line that used to rescue black was the perpetual
    // shuttle R(4,3)<->(5,3) — v1.9 scored the repeat as a draw (0) which
    // beat every losing alternative, so the engine long-checked. v1.10
    // judges the cycle: black checks on every move, red does not, so the
    // shuttle now scores like a lost mate (-MATE_SCORE + 100) as soon as
    // red cooperates by returning the king — and red always cooperates
    // because the repetition means black loses.
    const board = boardWith([
      { pos: pos(5, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(8, 0), piece: { type: 'R', side: 'red' } },
      { pos: pos(2, 2), piece: { type: 'C', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const s = state(board, 'black');
    const ranked = rankedMoves(s, 4);
    const shuttle = ranked.find(
      (r) =>
        r.move.from.col === 4 && r.move.from.row === 3 &&
        r.move.to.col === 5 && r.move.to.row === 3,
    );
    expect(shuttle).toBeDefined();
    // v1.9 scored this exactly 0 (draw); v1.10 must score it strictly negative.
    expect(shuttle!.score).toBeLessThan(0);
  });

  it('judges a CROSS-HISTORY cycle: the checker scores a near-mate loss', () => {
    // Regression for the v1.10.1 seenKeys short-circuit bug: once the shuttle
    // has already been played once in the real game, every mid-shuttle node
    // hits seenKeys. The old code returned 0 (draw) there, so a side behind
    // in material could rescue itself with a perpetual check — the loss
    // judgment only fired for cycles fully inside the search tree.
    //
    // Real game so far: B0 (black to move, rook (4,3)) --R(4,3)->(5,3)+-->
    // afterCheck (red to move, in check) --K(5,0)->(4,0)--> P1 (black to
    // move, the search root below). Seeding seenKeys/seenChecked exactly as
    // the engine now does. The re-check R(5,3)->(4,3)+ closes the cycle at
    // B0 (inside the tree red's king return is forced), and the judged cycle
    // is a black perpetual check -> -(MATE_SCORE - 100) for black.
    const b0 = boardWith([
      { pos: pos(5, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const afterCheck = boardWith([
      { pos: pos(5, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(5, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const p1 = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(5, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const s = state(p1, 'black');
    const ctx = createSearchContext();
    ctx.seenKeys = [
      positionKeyOf(b0, 'black'),
      positionKeyOf(afterCheck, 'red'),
      positionKeyOf(p1, 'black'),
    ];
    ctx.seenChecked = [false, true, false];
    const ranked = rankedMoves(s, 4, ctx);
    const recheck = ranked.find(
      (r) =>
        r.move.from.col === 5 && r.move.from.row === 3 &&
        r.move.to.col === 4 && r.move.to.row === 3,
    );
    expect(recheck).toBeDefined();
    // The checker (black) must now see the cycle as a lost near-mate, not a
    // draw (0), despite the cycle closing on a real-history position.
    expect(recheck!.score).toBe(-(MATE_SCORE - 100));
  });

  it('judges a CROSS-HISTORY cycle: the victim scores a near-mate win', () => {
    // Same cycle, but the search root sits one ply deeper: red to move, in
    // check (black has just re-checked from (4,3)). Returning the king to
    // (5,0) closes the cross-history cycle at B0 — a black perpetual check —
    // so from RED's perspective the repetition is a forced near-mate WIN:
    // +MATE_SCORE - 100, strictly better than blocking with the advisor.
    const b0 = boardWith([
      { pos: pos(5, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const afterCheck = boardWith([
      { pos: pos(5, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(5, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const p1 = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(5, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const recheckPos = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(3, 0), piece: { type: 'A', side: 'red' } },
      { pos: pos(4, 3), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const s = state(recheckPos, 'red');
    const ctx = createSearchContext();
    ctx.seenKeys = [
      positionKeyOf(b0, 'black'),
      positionKeyOf(afterCheck, 'red'),
      positionKeyOf(p1, 'black'),
      positionKeyOf(recheckPos, 'red'),
    ];
    ctx.seenChecked = [false, true, false, true];
    const ranked = rankedMoves(s, 4, ctx);
    // Best move for red = the king return that closes the losing repetition
    // for black, scored as a near-mate win.
    expect(ranked[0].score).toBe(MATE_SCORE - 100);
  });
});
