/**
 * v2026.11.23.8 对局页底部「主页」按钮验收。
 *
 * 三条硬要求：
 *   1. 按钮存在，且仍然固定在底部任务栏最右（右下角）。
 *   2. 点它只做「挂起 + 回主页」：pauseForHome 被调用一次、onOpenSetup 被调用一次。
 *   3. 绝不结束对局、绝不弹结算/保存弹窗 —— history 原样保留，result 不变。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatchPage } from '../MatchPage';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { generateLegalMoves } from '../../engine/rules';

function resetStores(): void {
  act(() => {
    useGameStore.getState().newGame();
    useSettings.setState({
      difficulty: 'beginner',
      soundEnabled: false,
      playerSide: 'red',
      boardTheme: 'classic',
      musicTrack: 'off',
      effects: { capture: true, check: true, mate: true },
    });
  });
}

beforeEach(() => {
  resetStores();
});

afterEach(() => {
  cleanup();
  resetStores();
  vi.restoreAllMocks();
});

/** MatchPage 只依赖 onOpenSetup / onOpenPractice / onSimulate 三个回调。 */
function renderMatch(onOpenSetup: () => void) {
  return render(
    <MatchPage onOpenSetup={onOpenSetup} onOpenPractice={() => {}} onSimulate={() => {}} />,
  );
}

describe('MatchPage 主页按钮', () => {
  it('位于底部任务栏最后一格（右下角），并且是唯一的回家入口', () => {
    renderMatch(() => {});

    const home = screen.getByTestId('match-home');
    expect(home).toBeInTheDocument();

    const taskbar = home.parentElement as HTMLElement;
    // 第六层任务栏仍是 4 格：复盘 / 推演 / 练习 / 主页。
    expect(taskbar.children).toHaveLength(4);
    expect(taskbar.lastElementChild).toBe(home);
    // 旧的「返回」出口已不存在，避免两个回家入口行为不一致。
    expect(screen.queryByTestId('match-back')).toBeNull();
  });

  it('点击后挂起对局（pauseForHome）并回主页，不结束、不弹结算框', () => {
    // 先真实走一步，让这一局变成「下到一半」的对局。
    act(() => {
      useGameStore.getState().beginGame();
    });
    const live = useGameStore.getState().game;
    const firstMove = generateLegalMoves(live.board, live.turn)[0];
    act(() => {
      useGameStore.getState().playerMove(firstMove.from, firstMove.to);
    });
    expect(useGameStore.getState().game.history).toHaveLength(1);

    const pauseSpy = vi.spyOn(useGameStore.getState(), 'pauseForHome');
    const onOpenSetup = vi.fn();
    renderMatch(onOpenSetup);

    fireEvent.click(screen.getByTestId('match-home'));

    // 挂起被调用、并且只调用一次。
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    // 屏幕切回主页由父组件负责。
    expect(onOpenSetup).toHaveBeenCalledTimes(1);
    // 对局本身一点没动：history 没被清空，也没有被 newGame 掉。
    expect(useGameStore.getState().game.history).toHaveLength(1);
    expect(useGameStore.getState().result).toBeNull();
    // 挂起后不应留下任何弹窗（结算页 / 记谱框都不该出现）。
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('挂起会清掉瞬时 UI（thinking / hint），但保留棋盘与历史供 resumeFromHome 使用', () => {
    act(() => {
      useGameStore.getState().beginGame();
    });
    const live = useGameStore.getState().game;
    const firstMove = generateLegalMoves(live.board, live.turn)[0];
    act(() => {
      useGameStore.getState().playerMove(firstMove.from, firstMove.to);
    });

    const historyBefore = useGameStore.getState().game.history;
    renderMatch(() => {});

    fireEvent.click(screen.getByTestId('match-home'));

    const after = useGameStore.getState();
    expect(after.thinking).toBe(false);
    expect(after.hint).toBeNull();
    expect(after.reviewIndex).toBeNull();
    expect(after.game.history).toBe(historyBefore); // 同一个数组，一根手指都没动它
  });
});
