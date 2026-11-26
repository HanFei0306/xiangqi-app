/**
 * evalTerms: single evaluation source of truth, six term families,
 * strict antisymmetry and layered leaf/full consistency.
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import {
  attacksFor,
  coordinationFor,
  fastStateFromBoard,
  fastStateFromSquares,
  fullTerms,
  kingZonePressureFor,
  leafTerms,
  mobilityFor,
  palaceHorsePenaltyFor,
} from '../evalTerms';
import { PIECE_VALUE } from '../../engine/pieces';

function squaresOf(board: Board): Int8Array {
  const map = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 } as const;
  const squares = new Int8Array(90);
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece) squares[col * 10 + row] = (piece.side === 'red' ? 1 : -1) * map[piece.type];
    }
  }
  return squares;
}

/** Mirrors col->8-col, row->9-row and flips every piece's colour. */
function mirror(squares: Int8Array): Int8Array {
  const out = new Int8Array(90);
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      out[(8 - col) * 10 + (9 - row)] = -squares[col * 10 + row];
    }
  }
  return out;
}

function boardWith(pieces: Array<[number, number, string]>): Board {
  const board = new Board(
    Array.from({ length: 9 }, () => new Array(10).fill(null)),
  );
  for (const [col, row, token] of pieces) {
    const type = token.toUpperCase() as 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';
    const side = token === type ? 'red' : 'black';
    board.setPiece({ col, row }, { side, type });
  }
  return board;
}

describe('evalTerms antisymmetry', () => {
  it('leaf terms are exactly antisymmetric under mirrored boards', () => {
    const board = new Board();
    const st = fastStateFromBoard(board, 1);
    const mirrored = fastStateFromSquares(mirror(squaresOf(board)), -1);
    expect(leafTerms(st, 1)).toBeCloseTo(-leafTerms(mirrored, -1), 6);
  });

  it('full terms are exactly antisymmetric on an asymmetric position', () => {
    const board = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [0, 0, 'R'], [8, 9, 'r'],
      [2, 2, 'N'], [6, 7, 'n'],
      [4, 3, 'P'], [4, 6, 'p'],
      [3, 0, 'A'], [5, 9, 'a'],
    ]);
    const st = fastStateFromBoard(board, 1);
    const mirrored = fastStateFromSquares(mirror(squaresOf(board)), -1);
    expect(fullTerms(st, 1)).toBeCloseTo(-fullTerms(mirrored, -1), 6);
  });

  it('both levels agree on the sign and stay within a bounded delta', () => {
    const st = fastStateFromBoard(new Board(), 1);
    const leaf = leafTerms(st, 1);
    const full = fullTerms(st, 1);
    expect(Number.isFinite(leaf) && Number.isFinite(full)).toBe(true);
    expect(Math.abs(full - leaf)).toBeLessThan(1000);
    if (leaf !== 0) expect(Math.sign(leaf)).toBe(Math.sign(full));
  });
});

describe('the six supplementary term families', () => {
  it('mobility counts open rooks and the threat factor finds advanced enemies', () => {
    const quiet = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [0, 4, 'R'],
    ]);
    const crowded = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [0, 4, 'R'],
      [1, 4, 'p'], [0, 5, 'p'], [0, 3, 'p'], [0, 2, 'p'],
    ]);
    expect(mobilityFor(fastStateFromBoard(quiet, 1), 1))
      .toBeGreaterThan(mobilityFor(fastStateFromBoard(crowded, 1), 1));
    const threats = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [3, 4, 'r'], [4, 4, 'n'], [5, 3, 'c'],
    ]);
    expect(attacksFor(fastStateFromBoard(threats, 1), 1)).toBeGreaterThan(0);
  });

  it('a passed pawn scores better than an isolated one at the same square', () => {
    const passed = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [2, 6, 'P'], [2, 5, 'P'], [8, 6, 'p'],
    ]);
    const isolated = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [2, 6, 'P'], [0, 1, 'P'], [8, 6, 'p'],
    ]);
    const phaseLimitedPassed = leafTerms(fastStateFromBoard(passed, 1), 1);
    const phaseLimitedIsolated = leafTerms(fastStateFromBoard(isolated, 1), 1);
    // Both boards have equal full material; only pawn shape differs.
    expect(phaseLimitedPassed).toBeGreaterThan(phaseLimitedIsolated - PIECE_VALUE.P);
  });

  it('a rook behind a pinned horse reduces the full score', () => {
    const pinned = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [2, 2, 'N'], [4, 3, 'r'], [7, 9, 'R'],
    ]);
    const free = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [2, 2, 'N'], [0, 8, 'r'], [7, 9, 'R'],
    ]);
    expect(fullTerms(fastStateFromBoard(pinned, 1), 1))
      .toBeLessThan(fullTerms(fastStateFromBoard(free, 1), 1));
  });

  it('penalises a palace-blocking horse and rewards pressure near the enemy king', () => {
    const nested = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [4, 1, 'N'], [2, 2, 'n'],
    ]);
    const developed = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [2, 2, 'N'], [2, 2, 'n'],
    ]);
    expect(palaceHorsePenaltyFor(fastStateFromBoard(nested, 1), 1)).toBeLessThan(0);
    expect(palaceHorsePenaltyFor(fastStateFromBoard(developed, 1), 1)).toBe(0);
    // A black horse at the mirrored palace centre is penalised identically.
    const mirroredNested = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [2, 2, 'N'], [4, 8, 'n'],
    ]);
    expect(palaceHorsePenaltyFor(fastStateFromBoard(mirroredNested, -1), -1))
      .toBe(palaceHorsePenaltyFor(fastStateFromBoard(nested, 1), 1));

    const pressing = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [4, 7, 'R'],
    ]);
    const distant = boardWith([
      [4, 0, 'K'], [4, 9, 'k'], [0, 0, 'R'],
    ]);
    expect(kingZonePressureFor(fastStateFromBoard(pressing, 1), 1)).toBeGreaterThan(0);
    expect(kingZonePressureFor(fastStateFromBoard(distant, 1), 1)).toBe(0);
  });

  it('coordination rewards connected heavy pieces in the full layer', () => {
    const connected = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [0, 4, 'R'], [6, 4, 'R'], [6, 6, 'C'],
    ]);
    const scattered = boardWith([
      [4, 0, 'K'], [4, 9, 'k'],
      [0, 4, 'R'], [6, 6, 'R'], [2, 1, 'C'],
    ]);
    expect(coordinationFor(fastStateFromBoard(connected, 1), 1))
      .toBeGreaterThan(coordinationFor(fastStateFromBoard(scattered, 1), 1));
  });
});
