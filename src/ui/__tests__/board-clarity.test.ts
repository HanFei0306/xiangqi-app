/**
 * v1.13 clarity regression guard: the board must stay high-contrast and the
 * 将/帅 palaces must remain a one-glance independent colour block. These are
 * presentation constants, so the guards check both the shared palette and the
 * source expressions that drive the SVG stroke weights / gradient opacity.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_BG, BOARD_LINE, PALACE_DIAGONAL, PALACE_FILL } from '../theme';

function channels(hex: string): [number, number, number] {
  const match: RegExpExecArray | null = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`expected #rrggbb, got ${hex}`);
  const n: number = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('v1.13 棋盘清晰度常量', () => {
  it('carved grid lines are markedly darker than the felt', () => {
    expect(luminance(BOARD_LINE)).toBeLessThan(luminance(BOARD_BG) * 0.8);
  });

  it('v2026.11.19.7: the light-green palace is a distinct block against the wood felt', () => {
    // 参考图为暖米黄木桌 + 淡绿九宫：九宫是明显更暗、偏绿的独立色块，
    // 与木底保持足够色差，一眼可辨「将/帅活动区」。
    expect(luminance(PALACE_FILL)).toBeLessThan(luminance(BOARD_BG));
    expect(Math.abs(luminance(PALACE_FILL) - luminance(BOARD_BG))).toBeGreaterThan(12);
    expect(PALACE_DIAGONAL).not.toBe(BOARD_LINE);
  });

  it('the palace gradient is opaque enough to read as an independent zone', () => {
    const source: string = readFileSync(
      resolve(process.cwd(), 'src/ui/boardMaterials.tsx'), 'utf8',
    );
    const gradient: string = source.match(
      /<linearGradient id="xq-palace-fill"[\s\S]*?<\/linearGradient>/,
    )?.[0] ?? '';
    const opacities: number[] = Array.from(
      gradient.matchAll(/stopOpacity="([\d.]+)"/g), (m) => Number(m[1]),
    );
    expect(opacities).toHaveLength(3);
    expect(Math.min(...opacities)).toBeGreaterThanOrEqual(0.35);
  });

  it('grid, palace border and X diagonals use thick crisp strokes', () => {
    const board: string = readFileSync(resolve(process.cwd(), 'src/ui/Board.tsx'), 'utf8');
    const inner: number = Number(board.match(
      /const innerLineWidth: number = Math\.max\(([\d.]+),/,
    )?.[1]);
    const diagonal: number = Number(board.match(
      /stroke=\{palette\.palaceDiagonal\} strokeWidth=\{Math\.max\(([\d.]+),/,
    )?.[1]);
    expect(inner).toBeGreaterThanOrEqual(1.5);
    expect(diagonal).toBeGreaterThanOrEqual(2.4);
    // The wide translucent ring gives an inner-glow effect with no blur filter.
    expect(board).toContain('stroke={PALACE_GLOW}');
    expect(board).not.toContain('<g transform={`translate(0,');
  });
});
