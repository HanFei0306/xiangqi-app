/**
 * Pure geometry for the traditional Xiangqi board decorations.
 *
 * Real boards print L-shaped corner brackets around the cannon (炮位) and
 * pawn (兵位) intersections. v1.12 added the two 3x3 palace areas and their
 * diagonals; v1.13 keeps the geometry and makes the fill/border far more
 * contrasty. Everything here is pure, testable and scales with `cell` at every
 * screen width — no absolute pixels leak into the SVG.
 */

import type { Pos } from '../engine/types';

/** A single SVG line segment in board-local coordinates. */
export interface DecorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Cannon intersections: cols 1/7 on rows 2/7. */
export const CANNON_MARK_POINTS: readonly Pos[] = [
  { col: 1, row: 2 },
  { col: 7, row: 2 },
  { col: 1, row: 7 },
  { col: 7, row: 7 },
];

/** Pawn intersections: even cols on rows 3/6. */
export const PAWN_MARK_POINTS: readonly Pos[] = [
  { col: 0, row: 3 },
  { col: 2, row: 3 },
  { col: 4, row: 3 },
  { col: 6, row: 3 },
  { col: 8, row: 3 },
  { col: 0, row: 6 },
  { col: 2, row: 6 },
  { col: 4, row: 6 },
  { col: 6, row: 6 },
  { col: 8, row: 6 },
];

/** All 14 decorated intersections. */
export const DECOR_POINTS: readonly Pos[] = [
  ...CANNON_MARK_POINTS,
  ...PAWN_MARK_POINTS,
];

/** Gap from the intersection centre to each bracket, as a cell fraction. */
export const BRACKET_GAP = 0.14;
/** Length of each bracket arm, as a cell fraction. */
export const BRACKET_ARM = 0.16;

/** The four diagonals (as col/row endpoint pairs) inside the two palaces. */
export const PALACE_DIAGONALS: ReadonlyArray<readonly [number, number, number, number]> = [
  [3, 0, 5, 2],
  [5, 0, 3, 2],
  [3, 7, 5, 9],
  [5, 7, 3, 9],
];

/** An axis-aligned palace highlight rectangle in board-local coordinates. */
export interface PalaceArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The two 3x3 palaces: cols 3..5 x rows 0..2 and rows 7..9. Row 0 is drawn at
 * the bottom, so the lower palace starts at y=7.5*cell and the upper one at
 * y=0.5*cell. Each area spans exactly two cells in each direction.
 */
export function palaceAreas(cell: number): PalaceArea[] {
  const x = 3.5 * cell;
  const width = 2 * cell;
  const height = 2 * cell;
  return [
    { x, y: 7.5 * cell, width, height }, // rows 0..2 — bottom (red) side
    { x, y: 0.5 * cell, width, height }, // rows 7..9 — top (black) side
  ];
}

/** Board-local centre of an intersection (row 0 is drawn at the bottom). */
export function pointCenter(col: number, row: number, cell: number): Pos {
  return { col: col * cell + cell / 2, row: (9 - row) * cell + cell / 2 };
}

/**
 * The eight L-bracket segments around one intersection. Both the offset and
 * the arm length are proportional to `cell`, so marks scale on any device.
 */
export function bracketSegments(col: number, row: number, cell: number): DecorSegment[] {
  const center = pointCenter(col, row, cell);
  const cx: number = center.col;
  const cy: number = center.row;
  const gap: number = cell * BRACKET_GAP;
  const arm: number = cell * BRACKET_ARM;
  const inner: number = gap;
  const outer: number = gap + arm;
  const segments: DecorSegment[] = [];

  // Top-left, top-right, bottom-left, bottom-right corner brackets.
  segments.push({ x1: cx - outer, y1: cy - inner, x2: cx - inner, y2: cy - inner });
  segments.push({ x1: cx - inner, y1: cy - outer, x2: cx - inner, y2: cy - inner });
  segments.push({ x1: cx + inner, y1: cy - inner, x2: cx + outer, y2: cy - inner });
  segments.push({ x1: cx + inner, y1: cy - outer, x2: cx + inner, y2: cy - inner });
  segments.push({ x1: cx - outer, y1: cy + inner, x2: cx - inner, y2: cy + inner });
  segments.push({ x1: cx - inner, y1: cy + inner, x2: cx - inner, y2: cy + outer });
  segments.push({ x1: cx + inner, y1: cy + inner, x2: cx + outer, y2: cy + inner });
  segments.push({ x1: cx + inner, y1: cy + inner, x2: cx + inner, y2: cy + outer });
  return segments;
}

/** All bracket segments for the whole board at the given cell size. */
export function allDecorationSegments(cell: number): DecorSegment[] {
  const out: DecorSegment[] = [];
  for (const point of DECOR_POINTS) {
    out.push(...bracketSegments(point.col, point.row, cell));
  }
  return out;
}
