/**
 * v2026.11.25 双响根治 —— 统一音效派发的两条硬约束：
 *
 * A. **一步棋只有一个发声通道**：原生桥接存在时，绝不允许"原生响了、Web 再响"。
 *    旧代码用 `playUnified(...) === true` 判定成功，于是返回 undefined 的
 *    旧版桥接会被判成失败并回退 Web —— 同一着响两次。
 *
 * B. **延迟派发必须可撤销**：旧代码把延迟交给原生 Handler.postDelayed，
 *    没有取消 API；悔棋/重置/连续点提示后，幽灵应手仍在 +300ms 响一声，
 *    与紧接着的提示演示叠成"同一着响两次"。现在延迟定时器归 JS 所有，
 *    cancel() 之后一声不响，不取消则到点恰好响一次（且 delayMs=0，
 *    声音仍由 Java MediaPlayer 发出，不碰 Web Audio 手势栈）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Move } from '../../engine/types';

const playMock = vi.fn();
const playAtMock = vi.fn((..._args: unknown[]) => vi.fn());
const resumeMock = vi.fn();
const announceMock = vi.fn();

vi.mock('../sound', () => ({
  play: (...args: unknown[]) => playMock(...args),
  playAt: (...args: unknown[]) => playAtMock(...args),
  resume: () => resumeMock(),
}));

vi.mock('../voice', () => ({
  announceEvent: (...args: unknown[]) => announceMock(...args),
}));

import { cueFromMove, cueMove, planCue, resetCueDedupe } from '../unifiedCue';

type Bridge = { playUnified?: (cue: string, delayMs: number) => boolean | void };

function installBridge(bridge: Bridge | null): void {
  if (bridge === null) {
    delete (window as unknown as { XiangqiNative?: unknown }).XiangqiNative;
    return;
  }
  (window as unknown as { XiangqiNative?: unknown }).XiangqiNative = bridge;
}

/** 一着"吃"（capture），便于断言 voice 也走同一通道。 */
function captureMove(): Move {
  return {
    from: { col: 4, row: 4 }, to: { col: 0, row: 4 },
    piece: 'C', captured: 'R', notation: '炮五平九',
  };
}

beforeEach(() => {
  playMock.mockClear();
  playAtMock.mockClear();
  resumeMock.mockClear();
  announceMock.mockClear();
  resetCueDedupe();
  installBridge(null);
  vi.useFakeTimers();
});

afterEach(() => {
  installBridge(null);
  vi.useRealTimers();
});

describe('A. 原生优先，绝不双通道', () => {
  it('原生返回 true：Web 完全不发声', () => {
    const calls: Array<[string, number]> = [];
    installBridge({ playUnified: (cue, delayMs) => { calls.push([cue, delayMs]); return true; } });

    cueFromMove(captureMove(), 'playing');

    expect(calls).toEqual([['capture', 0]]);
    expect(playMock).not.toHaveBeenCalled();
    expect(playAtMock).not.toHaveBeenCalled();
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('原生返回 void（旧桥接）：视为已处理，不再走 Web', () => {
    installBridge({ playUnified: () => { /* legacy: no return value */ } });

    cueFromMove(captureMove(), 'playing');

    expect(playMock).not.toHaveBeenCalled();
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('原生显式返回 false（资源缺失）：只回退一次 Web', () => {
    installBridge({ playUnified: () => false });

    cueFromMove(captureMove(), 'playing');

    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock.mock.calls[0][0]).toBe('capture');
    expect(announceMock).toHaveBeenCalledTimes(1);
    expect(announceMock.mock.calls[0][0]).toBe('capture');
  });

  it('无原生桥接：Web 收子声 + 语音各一次', () => {
    cueFromMove(captureMove(), 'playing');

    expect(playMock).toHaveBeenCalledTimes(1);
    expect(announceMock).toHaveBeenCalledTimes(1);
  });
});

describe('B. 延迟派发可撤销（悔棋/重置后不再响）', () => {
  it('预约瞬间不发声；不取消则到点恰好响一次且 delayMs=0', () => {
    const calls: Array<[string, number]> = [];
    installBridge({ playUnified: (cue, delayMs) => { calls.push([cue, delayMs]); return true; } });

    cueFromMove(captureMove(), 'playing', undefined, 0.3);
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(299);
    expect(calls).toHaveLength(0);

    vi.advanceTimersByTime(2);
    // delayMs 必须是 0：延迟已由 JS 定时器持有，原生只负责"立刻发声"。
    expect(calls).toEqual([['capture', 0]]);
  });

  it('取消后彻底静音：原生一声不响、Web 也不再补一声', () => {
    const calls: Array<[string, number]> = [];
    installBridge({ playUnified: (cue, delayMs) => { calls.push([cue, delayMs]); return true; } });

    const cancel = cueFromMove(captureMove(), 'playing', undefined, 0.3);
    cancel();
    vi.advanceTimersByTime(2000);

    expect(calls).toHaveLength(0);
    expect(playMock).not.toHaveBeenCalled();
    expect(announceMock).not.toHaveBeenCalled();
  });

  it('Web 回退路径的语音预约同样可撤销', () => {
    const cancel = cueFromMove(captureMove(), 'playing', undefined, 0.3);
    expect(playAtMock).toHaveBeenCalledTimes(1);

    cancel();
    vi.advanceTimersByTime(2000);

    expect(announceMock).not.toHaveBeenCalled();
  });

  it('重复 cancel 是幂等的，不会误伤后续派发', () => {
    const calls: Array<[string, number]> = [];
    installBridge({ playUnified: (cue, delayMs) => { calls.push([cue, delayMs]); return true; } });

    const stale = cueFromMove(captureMove(), 'playing', undefined, 0.3);
    stale();
    stale();

    cueFromMove({ ...captureMove(), from: { col: 2, row: 7 }, to: { col: 2, row: 4 } }, 'playing', undefined, 0.3);
    vi.advanceTimersByTime(400);

    expect(calls).toHaveLength(1);
  });
});

describe('C. cueMove 的 plan 直传（无去重干扰）', () => {
  it('同一 plan 连续两次调用各响一次（delay=0 的去重锁只在 cueFromMove 里）', () => {
    const calls: string[] = [];
    installBridge({ playUnified: (cue) => { calls.push(cue); return true; } });

    cueMove(planCue(captureMove(), 'playing'), 'C', 0, true);
    cueMove(planCue(captureMove(), 'playing'), 'C', 0, true);

    expect(calls).toEqual(['capture', 'capture']);
  });
});
