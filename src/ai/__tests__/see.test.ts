/**
 * SEE regression guard (v2026.11.19.7). The static exchange value must match
 * hand-computed material outcomes so quiescence pruning never discards a
 * winning capture or searches a clearly losing one as if it were good.
 */
import { describe, expect, it } from 'vitest';
import { cheapestAttacker, staticExchange, SEE_VALUE } from '../see';

function board(placements: Array<[number, number, number]>): Int8Array {
  const squares = new Int8Array(90);
  for (const [col, row, code] of placements) squares[col * 10 + row] = code;
  return squares;
}

describe('SEE 静态交换评估', () => {
  const scratch = new Int8Array(90);

  it('value table matches the engine material scale', () => {
    expect(SEE_VALUE[5 + 7]).toBe(900); // rook
    expect(SEE_VALUE[4 + 7]).toBe(400); // horse
    expect(SEE_VALUE[7 + 7]).toBe(100); // pawn
    expect(SEE_VALUE[1 + 7]).toBeGreaterThan(9000); // king
  });

  it('free pawn captured by a rook is +100', () => {
    const squares = board([[0, 4, 5], [4, 4, -7]]);
    expect(staticExchange(squares, 0 * 10 + 4, 4 * 10 + 4, 5, -7, scratch)).toBe(100);
  });

  it('rook takes a pawn defended by a rook is -800 (the classic blunder)', () => {
    const squares = board([[0, 4, 5], [4, 4, -7], [4, 9, -5]]);
    expect(staticExchange(squares, 0 * 10 + 4, 4 * 10 + 4, 5, -7, scratch)).toBe(-800);
  });

  it('even pawn trade is 0', () => {
    const squares = board([[3, 4, 7], [3, 5, -7], [3, 6, -7]]);
    expect(staticExchange(squares, 3 * 10 + 4, 3 * 10 + 5, 7, -7, scratch)).toBe(0);
  });

  it('horse takes a rook defended by a pawn is +500', () => {
    const squares = board([[2, 2, 4], [4, 3, -5], [5, 3, -7]]);
    expect(staticExchange(squares, 2 * 10 + 2, 4 * 10 + 3, 4, -5, scratch)).toBe(500);
  });

  it('scratch board is left consistent for the caller (no mutation of input)', () => {
    const squares = board([[0, 4, 5], [4, 4, -7], [4, 9, -5]]);
    const snapshot = squares.slice();
    staticExchange(squares, 0 * 10 + 4, 4 * 10 + 4, 5, -7, scratch);
    expect(Array.from(squares)).toEqual(Array.from(snapshot));
  });

  it('cheapestAttacker excludes the king and finds the least valuable defender', () => {
    // Black advisor at (3,7) guards (4,8) diagonally inside the black palace;
    // a black rook at (4,9) also guards (4,8). The advisor (200) is cheaper.
    const squares = board([[3, 7, -2], [4, 9, -5]]);
    const attacker = cheapestAttacker(squares, 4 * 10 + 8, -1);
    expect(attacker).not.toBeNull();
    expect(attacker!.code).toBe(-2);
  });
});
