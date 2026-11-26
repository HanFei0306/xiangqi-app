import { describe, it, expect } from 'vitest';
import { fastStateFromSquares, leafTerms, fullTerms } from '../evalTerms';
import { zoneContribution, zoneScoreOf } from '../threat';

function board(): Int8Array {
  const sq = new Int8Array(90);
  // red general (4,0), black general (4,9)
  sq[4 * 10 + 0] = 1;
  sq[4 * 10 + 9] = -1;
  return sq;
}

describe('O(1) king-zone threat layer', () => {
  it('is mirror symmetric (no red/black bias)', () => {
    const rook = 5;
    const blackKing = 4 * 10 + 9;
    const left = 2 * 10 + 4;
    const mirrored = 6 * 10 + 4; // col -> 8 - col
    expect(zoneContribution(rook, left, blackKing))
      .toBe(zoneContribution(-rook, mirrored, blackKing));
  });

  it('rewards driving a rook into the enemy palace zone', () => {
    const far = board();
    far[0 * 10 + 0] = 5; // red rook on its own edge file
    const near = board();
    near[4 * 10 + 6] = 5; // same rook in front of the black general

    const farSt = fastStateFromSquares(far, 1);
    const nearSt = fastStateFromSquares(near, 1);
    expect(zoneScoreOf(nearSt)).toBeGreaterThan(zoneScoreOf(farSt));
    expect(leafTerms(nearSt, 1)).toBeGreaterThan(leafTerms(farSt, 1));
  });

  it('keeps leaf and full evaluation on the same side of zero', () => {
    const sq = board();
    sq[4 * 10 + 6] = 5;
    sq[3 * 10 + 2] = -5;
    const st = fastStateFromSquares(sq, 1);
    const leaf = leafTerms(st, 1);
    const full = fullTerms(st, 1);
    expect(Number.isFinite(leaf) && Number.isFinite(full)).toBe(true);
    if (leaf !== 0) expect(Math.sign(leaf)).toBe(Math.sign(full));
  });

  it('ignores an unmoved pawn that has not crossed the river', () => {
    const king = 4 * 10 + 9;
    expect(zoneContribution(7, 4 * 10 + 4, king)).toBe(0);
    expect(zoneContribution(7, 4 * 10 + 6, king)).toBeGreaterThan(0);
  });
});
