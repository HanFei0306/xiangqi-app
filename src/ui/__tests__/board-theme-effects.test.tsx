/**
 * v2026.11.19.3 集成回归：棋盘换肤 + 特效开关真的接到了 Board。
 *
 * 同时守住两条红线：
 *   - classic（含不传 boardThemeId）仍使用美术线交付的竹席/青绿框/淡金九宫；
 *   - 特效只影响额外视觉层，飞行本体、普通落子涟漪与一步一响音效都不受影响
 *     （音效在 store 层，本测试确保 Board 不再自行决定声音）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Board } from '../Board';
import { Board as BoardModel } from '../../engine/board';
import type { GameStatus, Pos } from '../../engine/types';
import type { SoundEffects } from '../../data/storage';
import { BOARD_THEME_ORDER, getBoardTheme } from '../theme';

afterEach(() => {
  cleanup();
});

const ALL_ON: SoundEffects = { capture: true, check: true, mate: true };
const ALL_OFF: SoundEffects = { capture: false, check: false, mate: false };

function baseProps() {
  return {
    board: new BoardModel(),
    selected: null,
    legalTargets: [],
    lastMove: null,
    hint: null,
  };
}

/**
 * Mounts a board, then feeds it a fresh lastMove so the 260ms travel overlay
 * (the only place the three effect layers live) is present in the DOM.
 */
function renderFlying(options: {
  status?: GameStatus;
  effects?: SoundEffects;
  withCapture?: boolean;
}): ReturnType<typeof render> {
  const before = new BoardModel();
  const after = new BoardModel();
  const target: Pos = { col: 1, row: 0 };
  if (options.withCapture) {
    before.setPiece(target, { side: 'black', type: 'R' });
    after.setPiece(target, { side: 'red', type: 'R' });
  }
  const props = {
    ...baseProps(),
    board: before,
    status: options.status,
    effects: options.effects,
  };
  const view = render(<Board {...props} />);
  view.rerender(
    <Board
      {...props}
      board={after}
      lastMove={{ from: { col: 1, row: 2 }, to: target }}
    />,
  );
  return view;
}

describe('Board 换肤接线', () => {
  it('四套主题各自渲染出自己的主色（网格 / 九宫 / 河界）', () => {
    for (const id of BOARD_THEME_ORDER) {
      const view = render(<Board {...baseProps()} boardThemeId={id} />);
      const palette = getBoardTheme(id);
      const html: string = view.container.innerHTML;
      expect(html, `${id}: 九宫填充色`).toContain(palette.palaceFill);
      expect(html, `${id}: 网格线色`).toContain(palette.line);
      expect(html, `${id}: 河界字色`).toContain(palette.river);
      expect(html, `${id}: 九宫边框色`).toContain(palette.palaceBorder);
      cleanup();
    }
  });

  it('不传 boardThemeId 与显式 classic 完全一致；navy 明显不同', () => {
    const implicit: string = render(<Board {...baseProps()} />).container.innerHTML;
    cleanup();
    const classic: string = render(
      <Board {...baseProps()} boardThemeId="classic" />,
    ).container.innerHTML;
    expect(classic).toBe(implicit);
    cleanup();
    const jade: string = render(<Board {...baseProps()} boardThemeId="jade" />).container.innerHTML;
    expect(jade).not.toBe(implicit);
    expect(jade).toContain(getBoardTheme('jade').line);
  });

  it('BoardMaterials 缺省 palaceFill 时使用美术线的淡绿九宫色', () => {
    // v2026.11.19.7 照参考图改为淡绿九宫：渐变 stop 取自主题 palette，
    // 不再硬编码旧的淡金 #FFDF8F。
    const html: string = render(<Board {...baseProps()} />).container.innerHTML;
    expect(html).toContain(`stop-color="${getBoardTheme('classic').palaceFill}"`);
    expect(html).not.toContain('stop-color="#FFDF8F"');
  });
});

describe('特效开关接线（仅视觉层）', () => {
  it('吃子特效：关掉不渲染 xiangqi-capture，打开则渲染', () => {
    const on = renderFlying({ effects: ALL_ON, withCapture: true });
    expect(on.container.querySelector('.xiangqi-fly')).not.toBeNull();
    expect(on.container.querySelector('.xiangqi-capture')).not.toBeNull();
    cleanup();

    const off = renderFlying({
      effects: { ...ALL_ON, capture: false },
      withCapture: true,
    });
    expect(off.container.querySelector('.xiangqi-fly')).not.toBeNull();
    expect(off.container.querySelector('.xiangqi-capture')).toBeNull();
  });

  it('将军特效：check 关掉后 alert-wave 消失，普通落子涟漪保留', () => {
    const on = renderFlying({ status: 'check', effects: ALL_ON });
    expect(on.container.querySelector('.xiangqi-alert-wave')).not.toBeNull();
    cleanup();

    const off = renderFlying({
      status: 'check',
      effects: { ...ALL_ON, check: false },
    });
    expect(off.container.querySelector('.xiangqi-alert-wave')).toBeNull();
    expect(off.container.querySelector('.xiangqi-land-ripple')).not.toBeNull();
  });

  it('绝杀特效：mate 关掉后 mate-glow 消失，普通落子涟漪保留', () => {
    const on = renderFlying({ status: 'checkmate', effects: ALL_ON });
    expect(on.container.querySelector('.xiangqi-mate-glow')).not.toBeNull();
    cleanup();

    const off = renderFlying({
      status: 'checkmate',
      effects: { ...ALL_ON, mate: false },
    });
    expect(off.container.querySelector('.xiangqi-mate-glow')).toBeNull();
    expect(off.container.querySelector('.xiangqi-land-ripple')).not.toBeNull();
  });

  it('三开关全关：飞行与落子涟漪照常，特效层全无', () => {
    const view = renderFlying({ status: 'playing', effects: ALL_OFF, withCapture: true });
    expect(view.container.querySelector('.xiangqi-fly')).not.toBeNull();
    expect(view.container.querySelector('.xiangqi-land-bounce')).not.toBeNull();
    expect(view.container.querySelector('.xiangqi-land-ripple')).not.toBeNull();
    expect(view.container.querySelector('.xiangqi-capture')).toBeNull();
    expect(view.container.querySelector('.xiangqi-alert-wave')).toBeNull();
    expect(view.container.querySelector('.xiangqi-mate-glow')).toBeNull();
  });

  it('不传 effects 时三个特效默认开启', () => {
    const view = renderFlying({ status: 'check', withCapture: true });
    expect(view.container.querySelector('.xiangqi-capture')).not.toBeNull();
    expect(view.container.querySelector('.xiangqi-alert-wave')).not.toBeNull();
  });
});
