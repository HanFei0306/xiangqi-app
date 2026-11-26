/**
 * v2026.11.25 用户反馈回归：适情雅趣里"一步棋会响两次 / 艺术字闪两次"。
 *
 * 第一局「气吞关右」正解：首着 炮五平九（红，将军），应手 马七进五（黑，吃车）。
 * 因此每走一步都能同时观察到落子声、语音（将军/吃）与艺术字。
 *
 * 判定基线：**一步棋 = 一次落子 + 至多一次语音 + 至多一次艺术字**。
 *
 * 复现与判定：
 *  1. 正常走一着 -> 红着一套；+300ms 黑应手一套。各一次。
 *  2. 走完立刻悔棋/重置 -> 已预约的黑应手必须**彻底消失**（不响、不弹字）。
 *     修复前：只 clear 了页面定时器，语音与 showCue 仍在 +300ms 幽灵出场。
 *  3. 走完立刻连点两次提示（第一次高亮、第二次演示那条应手）-> 演示的正是
 *     已预约的应手：同一着只允许一次语音、一次艺术字。
 *     修复前：预约的那条在 +300ms 又演一遍。
 *
 * 这些用例在修复前都会失败，修复后全绿。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import type { Move } from '../../engine/types';

const playMock = vi.fn();
const playAtMock = vi.fn((..._args: unknown[]) => vi.fn());
const resumeMock = vi.fn();
const announceMock = vi.fn();
/** 每次 playAt 返回的取消器，用于证明"预约的声音真的被撤销"。 */
const playAtCancels: Mock[] = [];

vi.mock('../../audio/sound', () => ({
  play: (...args: unknown[]) => playMock(...args),
  playAt: (...args: unknown[]) => playAtMock(...args),
  resume: () => resumeMock(),
  setMuted: () => { /* noop in tests */ },
  isMuted: () => false,
}));

vi.mock('../../audio/voice', () => ({
  announceEvent: (...args: unknown[]) => announceMock(...args),
  announceMove: () => { /* not used by this page */ },
  stopVoice: () => { /* noop in tests */ },
  voiceAvailable: () => true,
}));

vi.mock('../../audio/nativeCue', () => ({ playNativeCue: () => false }));

import { AncientPracticePage } from '../AncientPracticePage';
import { useSettings } from '../../store/settings';
import { useCueDisplay, resetCueDedupe } from '../../store/cueDisplayStore';
import { resetCueDedupe as resetSoundDedupe } from '../../audio/unifiedCue';
import { resetProgress } from '../../data/ancient-progress';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';

/** 第一局正解首着：炮五平九 = (4,4) -> (0,4)。 */
const RED_FROM = '4,4';
const RED_TO = '0,4';
const AUTO_REPLY_DELAY_MS = 300;

beforeEach(() => {
  playMock.mockClear();
  playAtMock.mockReset();
  playAtCancels.length = 0;
  playAtMock.mockImplementation((..._args: unknown[]) => {
    const cancel = vi.fn();
    playAtCancels.push(cancel);
    return cancel;
  });
  resumeMock.mockClear();
  announceMock.mockClear();
  resetProgress();
  resetCueDedupe();
  resetSoundDedupe();
  useCueDisplay.setState({ cue: null });
  useSettings.setState({ soundEnabled: true });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** 订阅特效状态，记录每一次真正弹字（id 递增即一次演出）。 */
function collectCueIds(): { ids: number[]; stop: () => void } {
  const ids: number[] = [];
  const stop = useCueDisplay.subscribe((state) => {
    if (state.cue) ids.push(state.cue.id);
  });
  return { ids, stop };
}

function square(container: HTMLElement, key: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-square="${key}"]`);
  if (!el) throw new Error(`square ${key} not found`);
  return el;
}

/** 点棋子 + 点目标格，走出一着（第一局正解首着）。 */
function playRedBookMove(container: HTMLElement): void {
  fireEvent.click(square(container, RED_FROM));
  fireEvent.click(square(container, RED_TO));
}

function voicesOf(event: string): number {
  return announceMock.mock.calls.filter((call) => call[0] === event).length;
}

describe('一步棋只演一次（适情雅趣）', () => {
  it('正常走一着：红着一套 + 应手一套，各一次', () => {
    const { container } = render(<AncientPracticePage />);
    const { ids, stop } = collectCueIds();

    playRedBookMove(container);
    // 红着：落子声一次 + 将军语音一次 + 「将军」艺术字一次。
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock.mock.calls[0][0]).toBe('check');
    expect(voicesOf('check')).toBe(1);
    expect(ids).toHaveLength(1);
    // 应手的声音在点击手势内预约（节点现在就建，+300ms 才起振）。
    expect(playAtMock).toHaveBeenCalledTimes(1);
    expect(voicesOf('capture')).toBe(0);

    act(() => { vi.advanceTimersByTime(AUTO_REPLY_DELAY_MS + 10); });

    // 应手：吃子语音一次 + 「吃」艺术字一次；落子声依旧是"预约的那一次"。
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(voicesOf('capture')).toBe(1);
    expect(ids).toHaveLength(2);
    stop();
  });

  it('走完立刻悔棋：已预约的黑应手彻底消失（不响、不弹字）', () => {
    const { container } = render(<AncientPracticePage />);
    const { ids, stop } = collectCueIds();

    playRedBookMove(container);
    expect(ids).toHaveLength(1); // 红着的「将军」

    fireEvent.click(screen.getByRole('button', { name: '悔棋' }));
    // 声音预约必须被真正撤销（不是只 clear 了 UI 定时器）。
    expect(playAtCancels[0]).toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(2000); });

    // 修复前：幽灵应手在 +300ms 播报"吃"并弹一次「吃」字。
    expect(voicesOf('capture')).toBe(0);
    expect(ids).toHaveLength(1);
    stop();
  });

  it('走完立刻重置：同样不留幽灵应手', () => {
    const { container } = render(<AncientPracticePage />);
    const { ids, stop } = collectCueIds();

    playRedBookMove(container);
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(playAtCancels[0]).toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(2000); });

    expect(voicesOf('capture')).toBe(0);
    expect(ids).toHaveLength(1);
    stop();
  });

  it('走完立刻连点两次提示：提示演示的那一着只响一次、只弹一次字', () => {
    const { container } = render(<AncientPracticePage />);
    const { ids, stop } = collectCueIds();

    playRedBookMove(container);
    expect(playMock).toHaveBeenCalledTimes(1);

    // 等到特效去重窗口之外（>120ms），再演示同一着，确认"不是因为去重才没重复"。
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.click(screen.getByRole('button', { name: '提示' })); // 高亮 + 撤销预约
    fireEvent.click(screen.getByRole('button', { name: '提示' })); // 演示该应手
    expect(playMock).toHaveBeenCalledTimes(2); // 红着一 + 演示一
    expect(playAtCancels[0]).toHaveBeenCalled(); // 预约被撤销

    act(() => { vi.advanceTimersByTime(2000); });

    // 修复前：预约的那条应手在 +300ms 又演一遍 -> 吃子语音 2 次、艺术字 3 次。
    expect(playMock).toHaveBeenCalledTimes(2);
    expect(voicesOf('capture')).toBe(1);
    expect(ids).toHaveLength(2);
    stop();
  });

  it('提示演示整条正解：每一着各一次，不出现连环叠响', () => {
    render(<AncientPracticePage />);
    const { ids, stop } = collectCueIds();
    const total: number = SHIQINGYAQU[0].solution.length;

    fireEvent.click(screen.getByRole('button', { name: '提示' })); // 只高亮
    let played: number = 0;
    for (let i = 0; i < total; i++) {
      fireEvent.click(screen.getByRole('button', { name: '提示' }));
      played += 1;
      act(() => { vi.advanceTimersByTime(2000); });
      expect(playMock).toHaveBeenCalledTimes(played);
      expect(ids.length).toBeLessThanOrEqual(played);
    }
    stop();
  });
});

describe('特效去重键', () => {
  it('同一着即使分类不同也只弹一次字（key 只含坐标）', () => {
    const move: Move = {
      from: { col: 4, row: 4 }, to: { col: 0, row: 4 },
      piece: 'C', captured: 'R', notation: '炮五平九',
    };
    useCueDisplay.getState().showCue(move, 'check');
    const first = useCueDisplay.getState().cue;
    useCueDisplay.getState().showCue(move, 'playing'); // 同坐标，分类不同
    expect(useCueDisplay.getState().cue?.id).toBe(first?.id);
  });

  it('不同着法各弹各的', () => {
    const a: Move = { from: { col: 4, row: 4 }, to: { col: 0, row: 4 }, piece: 'C', captured: 'R', notation: '' };
    const b: Move = { from: { col: 6, row: 3 }, to: { col: 4, row: 2 }, piece: 'N', captured: 'R', notation: '' };
    useCueDisplay.getState().showCue(a, 'playing');
    const first = useCueDisplay.getState().cue?.id ?? 0;
    useCueDisplay.getState().showCue(b, 'playing');
    expect(useCueDisplay.getState().cue?.id).not.toBe(first);
  });
});
