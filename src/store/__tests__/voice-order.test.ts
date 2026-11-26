import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Captured landing callbacks, so the test can advance time deterministically. */
const { announceMock, stopVoiceMock } = vi.hoisted(() => ({
  announceMock: vi.fn(),
  stopVoiceMock: vi.fn(),
}));

vi.mock('../../audio/voice', () => ({
  announceMove: announceMock,
  announceEvent: announceMock,
  stopVoice: stopVoiceMock,
}));

import { setYieldFrame } from '../../ai/engine';
import { useGameStore } from '../gameStore';
import { useSettings } from '../settings';

/** Landing callbacks captured from announceTurn's internal timers. */
function fireLanding(): void {
  vi.advanceTimersByTime(420); // > LAND_MS (200) — plays the single clack
  vi.advanceTimersByTime(120); // post-impact beat, then onDone
}

describe('走棋时序（普通走子静音 + 事件播报 + 提前算棋）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom does not deliver MessageChannel messages; use a timer-based yield
    // so the slice-yielding search is driven by fake timers deterministically.
    setYieldFrame(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    announceMock.mockReset();
    stopVoiceMock.mockReset();
    useSettings.getState().setSoundEnabled(true);
    useSettings.getState().setDifficulty('beginner');
    useGameStore.getState().newGame();
  });

  it('玩家走子不播报任何语音，落子声走完后 AI 才落子', async () => {
    const store = useGameStore.getState();

    expect(store.playerMove({ col: 0, row: 3 }, { col: 0, row: 4 })).toBe(true);
    expect(useGameStore.getState().game.history.length).toBe(1);
    expect(useGameStore.getState().thinking).toBe(true);

    // No spoken callout at any point.
    expect(announceMock).not.toHaveBeenCalled();

    fireLanding();
    vi.advanceTimersByTime(120); // AI_REPLY_GAP_MS
    // The slice-yielding search resolves over several macrotasks.
    for (let i = 0; i < 200 && useGameStore.getState().game.history.length < 2; i++) {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    }

    expect(useGameStore.getState().game.history.length).toBe(2);
  });

  it('新对局会作废尚未落地的回调，不会把旧 AI 着法落进新棋盘', async () => {
    const store = useGameStore.getState();
    expect(store.playerMove({ col: 0, row: 3 }, { col: 0, row: 4 })).toBe(true);

    useGameStore.getState().newGame();
    fireLanding();
    vi.advanceTimersByTime(2000);
    await Promise.resolve();

    expect(useGameStore.getState().game.history.length).toBe(0);
    expect(stopVoiceMock).toHaveBeenCalled();
  });
});
