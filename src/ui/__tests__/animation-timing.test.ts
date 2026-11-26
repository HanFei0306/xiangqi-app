import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard: the flying piece overlay used to be removed at 320ms
 * while its CSS flight ran 520ms, so pieces jumped home mid-flight. Keep the
 * JS timer and the CSS animation in lockstep.
 */
describe('飞行动画时长一致性', () => {
  it('Board 的清理计时与 CSS 飞行时长完全一致', () => {
    const board = readFileSync(resolve(process.cwd(), 'src/ui/Board.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

    const jsMatch = board.match(/const MOVE_ANIM_MS = (\d+);/);
    const cssMatch = css.match(/animation: xiangqi-fly (\d+)ms/);
    expect(jsMatch).not.toBeNull();
    expect(cssMatch).not.toBeNull();
    expect(jsMatch?.[1]).toBe(cssMatch?.[1]);
  });
});
