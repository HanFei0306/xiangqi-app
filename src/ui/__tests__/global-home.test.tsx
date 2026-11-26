/**
 * v2026.11.23.8 全局主页入口（HomeButton）覆盖审计。
 *
 * 用户原话：「全局都要有一个主页按钮，可以从容的选择直接退到主页。」
 * 本文件锁定「每个可到达的页面都有一个统一的「主页」按钮，且都能退回设置页」：
 *   1. 残局推演页  —— lab-home
 *   2. 记谱/推演页 —— sim-home
 *   3. 适情雅趣页  —— practice-home（本轮把旧的「‹ 返回」换成 HomeButton）
 *   4. 学棋/好习惯 —— habit-home（同上）
 *   5. 对局页      —— match-home（另有 match-home-button.test.tsx 专测）
 *
 * 反斜杠断言：所有按钮的可访问名都必须是「主页」，而不是「返回」——
 * 用户之所以提这条需求，就是因为旧界面东一处「‹ 返回」西一处「退出」，找不到家。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import App from '../../App';
import { HabitCoachPage } from '../HabitCoachPage';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';

afterEach(() => {
  cleanup();
  useGameStore.getState().newGame();
  useSettings.setState({ difficulty: 'beginner', playerSide: 'red', soundEnabled: false });
});

/** 主页的标志物：开始挑战按钮。用它判断「现在在主页」。 */
function expectOnSetupPage() {
  expect(screen.getByRole('button', { name: '开始挑战' })).toBeInTheDocument();
}

describe('全局主页按钮（v2026.11.23.8）', () => {
  it('残局推演页有主页按钮，点了回主页', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('entry-endgame-lab'));
    const home = screen.getByTestId('lab-home');
    expect(home).toHaveAttribute('aria-label', '主页');
    fireEvent.click(home);
    expectOnSetupPage();
  });

  it('记谱页有主页按钮，点了回主页', () => {
    render(<App />);
    fireEvent.click(screen.getByText('记谱'));
    const home = screen.getByTestId('sim-home');
    expect(home).toHaveAttribute('aria-label', '主页');
    fireEvent.click(home);
    expectOnSetupPage();
  });

  it('适情雅趣页把「‹ 返回」换成了主页按钮，点了回主页', () => {
    render(<App />);
    fireEvent.click(screen.getByText('适情雅趣'));
    // 旧的返回文案必须已经消失
    expect(screen.queryByText('‹ 返回')).toBeNull();
    const home = screen.getByTestId('practice-home');
    expect(home).toHaveAttribute('aria-label', '主页');
    fireEvent.click(home);
    expectOnSetupPage();
  });

  it('学棋页把「‹ 返回」换成了主页按钮，点了回主页', () => {
    const onBack = vi.fn();
    render(<HabitCoachPage onBack={onBack} />);
    expect(screen.queryByText('‹ 返回')).toBeNull();
    const home = screen.getByTestId('habit-home');
    expect(home).toHaveAttribute('aria-label', '主页');
    fireEvent.click(home);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('从主页进学棋再点主页，能回到主页（整链路）', () => {
    render(<App />);
    fireEvent.click(screen.getByText('学棋'));
    expect(screen.getByText('学棋 · 好习惯')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('habit-home'));
    expectOnSetupPage();
  });
});
