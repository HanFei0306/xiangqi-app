/** Pure decoration geometry: cannon/pawn marks and scaled L-brackets. */
import { describe, it, expect } from 'vitest';
import {
  BRACKET_ARM,
  BRACKET_GAP,
  CANNON_MARK_POINTS,
  DECOR_POINTS,
  PAWN_MARK_POINTS,
  allDecorationSegments,
  bracketSegments,
  pointCenter,
  palaceAreas,
  PALACE_DIAGONALS,
} from '../boardDecor';

describe('board decoration points', () => {
  it('marks the four cannon intersections', () => {
    expect(CANNON_MARK_POINTS).toEqual([
      { col: 1, row: 2 },
      { col: 7, row: 2 },
      { col: 1, row: 7 },
      { col: 7, row: 7 },
    ]);
  });

  it('marks the ten pawn intersections', () => {
    expect(PAWN_MARK_POINTS).toHaveLength(10);
    for (const point of PAWN_MARK_POINTS) {
      expect(point.row === 3 || point.row === 6).toBe(true);
      expect(point.col % 2).toBe(0);
    }
  });

  it('combines to fourteen unique intersections', () => {
    expect(DECOR_POINTS).toHaveLength(14);
    const unique = new Set(DECOR_POINTS.map((p) => `${p.col},${p.row}`));
    expect(unique.size).toBe(14);
  });
});

describe('scaled L-brackets', () => {
  it('draws eight segments around one intersection', () => {
    const segments = bracketSegments(1, 2, 40);
    expect(segments).toHaveLength(8);
    for (const s of segments) {
      expect(Number.isFinite(s.x1) && Number.isFinite(s.y1)).toBe(true);
      expect(Number.isFinite(s.x2) && Number.isFinite(s.y2)).toBe(true);
    }
  });

  it('scales linearly with cell size', () => {
    const small = bracketSegments(1, 2, 24);
    const large = bracketSegments(1, 2, 48);
    for (let i = 0; i < small.length; i++) {
      expect(large[i].x1).toBeCloseTo(small[i].x1 * 2, 6);
      expect(large[i].y2).toBeCloseTo(small[i].y2 * 2, 6);
    }
    expect(BRACKET_GAP).toBeGreaterThan(0);
    expect(BRACKET_ARM).toBeGreaterThan(0);
  });

  it('centres marks on the correct board intersection', () => {
    expect(pointCenter(0, 0, 40)).toEqual({ col: 20, row: 380 });
    expect(pointCenter(8, 9, 40)).toEqual({ col: 340, row: 20 });
  });

  it('produces 112 segments for the whole board', () => {
    expect(allDecorationSegments(40)).toHaveLength(14 * 8);
  });
});

/** v1.13: the 将/帅 zone geometry must stay exact while its styling changes. */
describe('九宫 palace geometry', () => {
  it('covers exactly the two 3x3 palaces and scales with cell', () => {
    expect(palaceAreas(40)).toEqual([
      { x: 140, y: 300, width: 80, height: 80 },
      { x: 140, y: 20, width: 80, height: 80 },
    ]);
    const small = palaceAreas(24);
    const large = palaceAreas(48);
    for (let i = 0; i < small.length; i++) {
      expect(large[i].x).toBeCloseTo(small[i].x * 2, 6);
      expect(large[i].y).toBeCloseTo(small[i].y * 2, 6);
      expect(large[i].width).toBeCloseTo(small[i].width * 2, 6);
      expect(large[i].height).toBeCloseTo(small[i].height * 2, 6);
    }
  });

  it('draws both X diagonals in each palace', () => {
    expect(PALACE_DIAGONALS).toEqual([
      [3, 0, 5, 2],
      [5, 0, 3, 2],
      [3, 7, 5, 9],
      [5, 7, 3, 9],
    ]);
  });
});
