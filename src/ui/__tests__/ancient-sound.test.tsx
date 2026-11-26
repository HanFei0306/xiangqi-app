/**
 * v2026.11.20.5 验收：《适情雅趣》音效必须在点击手势内直接发声。
 * 任何依赖 setTimeout / Web Audio 预约的路径在部分 Android WebView 上都会静音，
 * 因此这里只断言 click 之后 play() 立即被调用，且将军/吃子/绝杀分类正确。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const playMock = vi.fn();
const playAtMock = vi.fn((..._args: unknown[]) => vi.fn());
const resumeMock = vi.fn();
const announceMock = vi.fn();

vi.mock('../../audio/sound', () => ({
  playAt: (...args: unknown[]) => playAtMock(...args),
  play: (...args: unknown[]) => playMock(...args),
  resume: () => resumeMock(),
}));

vi.mock('../../audio/voice', () => ({
  announceEvent: (...args: unknown[]) => announceMock(...args),
}));
vi.mock('../../audio/nativeCue', () => ({ playNativeCue: () => false }));

import { AncientPracticePage, ancientCueFor, ancientVoiceFor } from '../AncientPracticePage';
import { useSettings } from '../../store/settings';
import { classifyEvent } from '../../store/gameStore';
import { parseSetup } from '../../engine/board';
import { isInCheck } from '../../engine/rules';
import type { GameStatus, Move } from '../../engine/types';

beforeEach(() => {
  playMock.mockClear();
  playAtMock.mockClear();
  resumeMock.mockClear();
  announceMock.mockClear();
  useSettings.setState({ soundEnabled: true });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function land(): void {
  act(() => { vi.advanceTimersByTime(220); });
}

describe('适情雅趣落子音效（一步一响，手势内直发）', () => {
  it('音效试听按钮在点击手势内直接发声，可被用户验证', () => {
    render(<AncientPracticePage />);
    fireEvent.click(screen.getByRole('button', { name: '吃子' }));
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock.mock.calls[0][0]).toBe('capture');
    fireEvent.click(screen.getByRole('button', { name: '将军' }));
    fireEvent.click(screen.getByRole('button', { name: '绝杀' }));
    expect(playMock.mock.calls[1][0]).toBe('check');
    expect(playMock.mock.calls[2][0]).toBe('win');
    expect(announceMock).toHaveBeenCalledTimes(3);
    expect(announceMock.mock.calls[0][0]).toBe('capture');
    expect(announceMock.mock.calls[1][0]).toBe('check');
    expect(announceMock.mock.calls[2][0]).toBe('checkmate');
    expect(resumeMock).toHaveBeenCalled();
  });

  it('提示演示：落子当次点击立刻响一声，不再依赖落地定时器', () => {
    render(<AncientPracticePage />);
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(playMock).not.toHaveBeenCalled(); // 只高亮

    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(playMock.mock.calls[0][0]).toBe('check');

    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(playMock).toHaveBeenCalledTimes(2);
    expect(playMock.mock.calls[1][0]).toBe('capture');
  });

  it('soundEnabled 关闭时完全静音', () => {
    useSettings.setState({ soundEnabled: false });
    render(<AncientPracticePage />);
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    land();
    expect(playMock).not.toHaveBeenCalled();
    expect(resumeMock).not.toHaveBeenCalled();
  });

  it('落子后立即重置不会漏声：声音已在点击手势内发出', () => {
    render(<AncientPracticePage />);
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    fireEvent.click(screen.getByRole('button', { name: '重置' }));
    expect(playMock).toHaveBeenCalledTimes(1);
  });

  it('将军正解落子播 check 音，与主对局一致', () => {
    render(<AncientPracticePage />);
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    fireEvent.click(screen.getByRole('button', { name: '提示' }));
    expect(playMock.mock.calls[0][0]).toBe('check');
  });

  it('ancientCueFor 纯函数：将军 check / 吃子 capture / 普通 move', () => {
    const empty = '.,.,.,.,.,.,.,.,.';
    // 落子后局面：红车 col4,row8 吃黑卒后正照黑将 col4,row9（红帅 col5 避开飞将）。
    const afterCheck = Array(10).fill(empty);
    afterCheck[0] = '.,.,.,.,.,K,.,.,.';
    afterCheck[7] = '.,.,.,.,R,.,.,.,.';
    afterCheck[9] = '.,.,.,.,k,.,.,.,.';
    const checkingCapture: Move = {
      from: { col: 4, row: 5 }, to: { col: 4, row: 7 },
      piece: 'R', captured: 'P', notation: '车五进二',
    };
    expect(ancientCueFor(checkingCapture, parseSetup(afterCheck.join('/')), 'red')).toBe('check');

    // 黑将移到 col3 后红车不再照将：同一吃子着降为 capture。
    const afterNoCheck = [...afterCheck];
    afterNoCheck[9] = '.,.,.,k,.,.,.,.,.';
    expect(ancientCueFor(checkingCapture, parseSetup(afterNoCheck.join('/')), 'red')).toBe('capture');

    // 不吃子、不将军的平移着 -> move。
    const quietAfter = Array(10).fill(empty);
    quietAfter[0] = '.,.,.,.,.,K,.,.,.';
    quietAfter[5] = '.,.,.,.,.,R,.,.,.';
    quietAfter[9] = '.,.,.,k,.,.,.,.,.';
    const quiet: Move = {
      from: { col: 4, row: 5 }, to: { col: 5, row: 5 },
      piece: 'R', captured: null, notation: '车五平六',
    };
    expect(ancientCueFor(quiet, parseSetup(quietAfter.join('/')), 'red')).toBe('move');
  });

  it('ancientVoiceFor：吃 / 将军 / 绝杀分别映射到主对局语音事件', () => {
    const empty = '.,.,.,.,.,.,.,.,.';
    const quiet = parseSetup(Array(10).fill(empty).map((r, i) =>
      i === 0 ? '.,.,.,.,K,.,.,.,.' : i === 9 ? '.,.,.,k,.,.,.,.,.' : r).join('/'));
    const capture: Move = {
      from: { col: 4, row: 5 }, to: { col: 4, row: 7 },
      piece: 'R', captured: 'P', notation: '车五进二',
    };
    expect(ancientVoiceFor(capture, quiet, 'red')).toBe('capture');

    const checkBoard = Array(10).fill(empty);
    checkBoard[0] = '.,.,.,.,K,.,.,.,.';
    checkBoard[7] = '.,.,.,.,R,.,.,.,.';
    checkBoard[9] = '.,.,.,.,k,.,.,.,.';
    expect(ancientVoiceFor(capture, parseSetup(checkBoard.join('/')), 'red')).toBe('check');

    const mate = Array(10).fill(empty);
    mate[0] = '.,.,.,.,K,.,.,.,.';
    mate[8] = 'R,.,.,.,R,.,.,.,.';
    mate[9] = 'R,.,.,.,k,.,.,R,.';
    expect(ancientVoiceFor(capture, parseSetup(mate.join('/')), 'red')).toBe('checkmate');
  });

  it('ancientCueFor：绝杀局面返回 win 音效，优先于 check/capture', () => {
    const empty = '.,.,.,.,.,.,.,.,.';
    const mate = Array(10).fill(empty);
    mate[0] = '.,.,.,.,K,.,.,.,.';
    mate[8] = 'R,.,.,.,R,.,.,.,.';
    mate[9] = 'R,.,.,.,k,.,.,R,.';
    const matingMove: Move = {
      from: { col: 4, row: 5 }, to: { col: 4, row: 7 },
      piece: 'R', captured: 'P', notation: '车五进二',
    };
    expect(ancientCueFor(matingMove, parseSetup(mate.join('/')), 'red')).toBe('win');
  });

  it('回归：ancientCueFor 与主对局 classifyEvent 的 check/capture/move 优先级一致', () => {
    const empty = '.,.,.,.,.,.,.,.,.';
    // 将军且吃子：红车吃卒后照住黑将 -> 两者都应判 check（将军优先于吃子）。
    const checkBoard = Array(10).fill(empty);
    checkBoard[0] = '.,.,.,.,.,K,.,.,.'; // 红帅
    checkBoard[7] = '.,.,.,.,R,.,.,.,.'; // 红车 col4,row8
    checkBoard[9] = '.,.,.,.,k,.,.,.,.'; // 黑将 col4,row9 被车照
    const checkingCapture: Move = {
      from: { col: 4, row: 5 }, to: { col: 4, row: 7 },
      piece: 'R', captured: 'P', notation: '车五进二',
    };
    // 只吃子不将军：黑将移开 col3，同一吃子着降为 capture。
    const captureBoard = [...checkBoard];
    captureBoard[9] = '.,.,.,k,.,.,.,.,.';
    // 普通平移：不吃子、不将军 -> move。
    const quietBoard = Array(10).fill(empty);
    quietBoard[0] = '.,.,.,.,.,K,.,.,.';
    quietBoard[5] = '.,.,.,.,.,R,.,.,.';
    quietBoard[9] = '.,.,.,k,.,.,.,.,.';
    const quietMove: Move = {
      from: { col: 5, row: 5 }, to: { col: 6, row: 5 },
      piece: 'R', captured: null, notation: '车五平七',
    };

    const cases: { move: Move; setup: string; expected: 'check' | 'capture' | 'move' }[] = [
      { move: checkingCapture, setup: checkBoard.join('/'), expected: 'check' },
      { move: checkingCapture, setup: captureBoard.join('/'), expected: 'capture' },
      { move: quietMove, setup: quietBoard.join('/'), expected: 'move' },
    ];

    for (const { move, setup, expected } of cases) {
      const after = parseSetup(setup);
      // 主对局 status 由是否将军推导；残局无胜方结算，result 传 null。
      const status: GameStatus = isInCheck(after, 'black') ? 'check' : 'playing';
      const ancientCue = ancientCueFor(move, after, 'red');
      const mainCue = classifyEvent(move, after, 'black', status, null).cue;
      expect(ancientCue).toBe(expected);
      expect(mainCue).toBe(expected);
      expect(ancientCue).toBe(mainCue); // 与主对局判定完全一致
    }
  });
});
