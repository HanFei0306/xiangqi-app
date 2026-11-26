/**
 * v2026.11.19.7「木质高清棋盘」美术方向回归护栏。
 * 参考截图标准：暖米黄木纹桌面 + 深棕木框 + 淡绿九宫 + 细棕网格线；
 * 米白立体浮雕棋子 + 正红/深蓝黑大字。断言围绕"红黑高对比、木质配色、
 * 无模糊描边/滤镜"。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_BG, BOARD_LINE, PALACE_FILL } from '../theme';

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

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('米白浮雕棋子（红黑一眼可分）', () => {
  const piece: string = read('src/ui/Piece.tsx');

  it('面色是米白象牙径向浮雕光，明亮通透', () => {
    expect(piece).toContain('radial-gradient(ellipse at 36% 26%');
    expect(piece).toContain("const faceMid = '#F4EFE2'");
    expect(piece).toContain("const faceLow = '#D8CFB8'");
    // 旧版浅橙底必须彻底移除
    expect(piece).not.toContain("const faceMid = '#F7D7A2'");
  });

  it('红方正红、黑方深蓝黑，色差足够大；字号 0.78；无深色粗描边', () => {
    expect(piece).toContain("const GLYPH_RED = '#C62828'");
    expect(piece).toContain("const GLYPH_BLACK = '#23364A'");
    expect(piece).toContain('fontSize: size * 0.78');
    expect(piece).not.toContain('fontSize: size * 0.72');
    // 旧版四向深色硬描边（发糊根源）必须移除
    expect(piece).not.toContain('-1px -1px 0 ${edge}');
    expect(piece).not.toContain('const EDGE_RED');
  });

  it('浮雕用实色 inset 高光/暗影，且无任何 filter/模糊投影', () => {
    expect(piece).toContain('inset 0 2px 2px');
    expect(piece).toContain('inset 0 -3px 3px');
    // 红黑字与米白面亮度差足够大
    const red: string = piece.match(/const GLYPH_RED = '(#[\dA-Fa-f]{6})'/)?.[1] ?? '#000000';
    const black: string = piece.match(/const GLYPH_BLACK = '(#[\dA-Fa-f]{6})'/)?.[1] ?? '#000000';
    const faceMid: string = piece.match(/const faceMid = '(#[\dA-Fa-f]{6})'/)?.[1] ?? '#000000';
    expect(luminance(red)).toBeLessThan(luminance(faceMid) * 0.62);
    expect(luminance(black)).toBeLessThan(luminance(faceMid) * 0.3);
    expect(Math.abs(luminance(red) - luminance(black))).toBeGreaterThan(18);
    expect(piece).not.toContain('filter:');
    expect(piece).not.toContain('blur(');
  });
});

describe('暖米黄木桌 + 淡绿九宫 + 深棕木框', () => {
  it('木桌是暖米黄，网格线深棕但仍清晰', () => {
    expect(luminance(BOARD_BG)).toBeGreaterThan(140);
    expect(luminance(BOARD_LINE)).toBeLessThan(luminance(BOARD_BG) * 0.62);
  });

  it('网格是单实线，无 1px 亮色 lip 叠线（防止双线重影发虚）', () => {
    const board: string = read('src/ui/Board.tsx');
    expect(board).not.toContain('highlightLines');
    expect(board).not.toContain('lipOffset');
    expect(board).not.toContain('rgba(255,255,230,0.55)');
  });

  it('棋子占格放大到 cell - 3，字面饱满', () => {
    const board: string = read('src/ui/Board.tsx');
    expect(board).toContain('const pieceSize = cell - 3');
    expect(board).not.toContain('const pieceSize = cell - 8');
  });

  it('淡绿九宫比木桌底色更暗/更绿，形成清晰独立色块', () => {
    // 参考图九宫是淡绿深色块（比米黄木底暗），不是旧版的亮金块。
    const [, pg, pb] = channels(PALACE_FILL);
    expect(pg).toBeGreaterThan(pb); // 九宫偏绿
    expect(luminance(PALACE_FILL)).toBeLessThan(luminance(BOARD_BG)); // 比木底暗
    // 与底色有足够色差，一眼识别
    expect(Math.abs(luminance(PALACE_FILL) - luminance(BOARD_BG))).toBeGreaterThan(12);
  });

  it('SVG 用宽周期木纹 pattern，不再用 feTurbulence 噪声层', () => {
    const mat: string = read('src/ui/boardMaterials.tsx');
    expect(mat).toContain('id="xq-bamboo-strip"');
    expect(mat).not.toContain('<feTurbulence');
    const board: string = read('src/ui/Board.tsx');
    expect(board).toContain('fill="url(#xq-bamboo-strip)"');
    expect(board).not.toContain('filter="url(#xq-wood-');
  });
});

describe('全程零 filter 模糊，动画仅 transform / opacity', () => {
  it('CSS 中没有 filter 属性，且飞子时长未被改动', () => {
    const css: string = read('src/index.css');
    expect(css).not.toContain('filter:');
    expect(css).toContain('animation: xiangqi-fly 260ms');
  });
});
