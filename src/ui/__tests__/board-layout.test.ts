/**
 * Responsive board sizing. The pure function is called with explicit widths so
 * the assertions never depend on a real `window` / WebView viewport report.
 */
import { describe, it, expect } from 'vitest';
import { computeCellFromWidth } from '../Board';

const WIDTHS: number[] = [360, 390, 414, 768, 1440];

describe('computeCellFromWidth — whole board fits the viewport', () => {
  for (const width of WIDTHS) {
    it(`9*cell + 2*framePad <= ${width}px`, () => {
      const cell: number = computeCellFromWidth(width);
      const framePad: number = width < 600 ? 8 : 14;
      expect(cell).toBeGreaterThanOrEqual(24);
      expect(cell).toBeLessThanOrEqual(52);
      expect(9 * cell + 2 * framePad).toBeLessThanOrEqual(width);
    });
  }

  it('caps at 52 on wide screens and clamps to 24 on degenerate input', () => {
    expect(computeCellFromWidth(1440)).toBe(52);
    expect(computeCellFromWidth(0)).toBe(52);
    expect(computeCellFromWidth(Number.NaN)).toBe(52);
    expect(computeCellFromWidth(200)).toBe(24);
  });
});
