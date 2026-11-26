/**
 * v22.6 执黑翻转：验证显示坐标映射是 180° 旋转、逻辑坐标不变、字母标签正确。
 */
import { describe, expect, it } from 'vitest';
import { fileLabelAt, flipSquare, squareCenter } from '../Board';

describe('v22.6 Board 翻转坐标映射', () => {
  it('不翻转时保持原有逻辑/显示坐标', () => {
    expect(flipSquare(0, 0, false)).toEqual({ col: 0, row: 0 });
    expect(squareCenter(0, 0, 40, false)).toEqual({ x: 20, y: 380 });
    expect(fileLabelAt(0, false)).toBe(9);
  });

  it('翻转时红黑双方上下互换（黑方在下）', () => {
    expect(flipSquare(0, 0, true)).toEqual({ col: 8, row: 9 });
    expect(flipSquare(8, 9, true)).toEqual({ col: 0, row: 0 });
    expect(flipSquare(4, 4, true)).toEqual({ col: 4, row: 5 });
    // 红帅逻辑 (4,0) 从底部翻到顶部；黑将逻辑 (4,9) 从顶部翻到底部。
    expect(squareCenter(4, 0, 40, true)).toEqual({ x: 180, y: 20 });
    expect(squareCenter(4, 9, 40, true)).toEqual({ x: 180, y: 380 });
  });

  it('旋转是严格对合：翻两次回到原逻辑坐标', () => {
    for (let col = 0; col < 9; col++) {
      for (let row = 0; row < 10; row++) {
        const once = flipSquare(col, row, true);
        expect(flipSquare(once.col, once.row, true)).toEqual({ col, row });
      }
    }
  });

  it('底部数字随视角从 9→1 变为 1→9', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => fileLabelAt(c, false)))
      .toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => fileLabelAt(c, true)))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
