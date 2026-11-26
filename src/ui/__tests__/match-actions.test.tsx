/**
 * UI acceptance for the five in-match buttons and the settings panel.
 * Renders the real App (setup -> match) and checks each required affordance
 * exists, opens the modal, and writes the persisted settings store.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import App from '../../App';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { MUSIC_TRACKS } from '../../audio/music';

afterEach(() => {
  cleanup();
  useGameStore.getState().newGame();
  useSettings.setState({
    difficulty: 'beginner',
    soundEnabled: false,
    playerSide: 'red',
    boardTheme: 'classic',
    musicTrack: 'off',
    musicVolume: 0.45,
    effects: { capture: true, check: true, mate: true },
    tacticsHintEnabled: true,
  });
});

function startMatch(): void {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
}

describe('MatchPage actions (v2026.11.21.4 single toolbar)', () => {
  /** v21.4: the primary toolbar shows 分析/悔棋/提示/设置/更多; match actions live in 更多. */
  function openMore(): void {
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
  }

  it('renders 设置 on the toolbar and 认输 / 提和 / 退出 / 重来 in the 更多 drawer', () => {
    startMatch();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument();
    // The toolbar is a 5-column grid with minmax(0,1fr): no fixed min width.
    const action = screen.getByRole('button', { name: '设置' });
    const row = action.parentElement as HTMLElement;
    expect(row.style.gridTemplateColumns || window.getComputedStyle(row).gridTemplateColumns).toBeTruthy();
    // Then open 更多 and check the match actions are reachable.
    openMore();
    for (const label of ['认输', '提和', '退出', '重来']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('设置 opens the panel; theme / effects / music choices persist', async () => {
    startMatch();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('整体风格皮肤（棋盘 + 界面 + 背景）')).toBeInTheDocument();
    for (const label of ['温润新中式', '素雅原木', '翡翠青玉', '墨韵水墨']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '完成设置' })).toBeInTheDocument();
    expect(screen.getByText('杀法提示')).toBeInTheDocument();

    expect(screen.getByText('古琴《阳关三叠》')).toBeInTheDocument();
    expect(screen.getByText('背景音乐来源')).toBeInTheDocument();
    expect(screen.getByText(/Debussy 作曲 \/ 美国空军乐团演奏/)).toBeInTheDocument();
    expect(screen.getByText(/Pachelbel 作曲 \/ CC BY-SA 3\.0/)).toBeInTheDocument();
    expect(screen.getByText(/古琴 CharlieHuang 演奏 \/ CC BY-SA 3\.0/)).toBeInTheDocument();
    expect(screen.getByText(/《松窗棋罢》为现代版权歌曲/)).toBeInTheDocument();
    expect(screen.getByText('AI 学习（本地）')).toBeInTheDocument();

    fireEvent.click(screen.getByText('翡翠青玉'));
    expect(useSettings.getState().boardTheme).toBe('jade');

    fireEvent.click(screen.getByRole('checkbox', { name: '吃子特效' }));
    expect(useSettings.getState().effects.capture).toBe(false);

    fireEvent.click(screen.getByRole('checkbox', { name: '杀法提示' }));
    expect(useSettings.getState().tacticsHintEnabled).toBe(false);

    fireEvent.click(screen.getByText(MUSIC_TRACKS[0].label));
    expect(useSettings.getState().musicTrack).toBe('moonlight');

    fireEvent.click(screen.getByRole('button', { name: '完成设置' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('主页按钮唯一且位于底部任务栏最右（右下角）', () => {
    startMatch();
    // v2026.11.23.8：「返回」出口统一升级为 HomeButton（data-testid=match-home），
    // 行为也由「结束本局回设置页」改为「挂起本局回主页」，这里只校验位置与唯一性。
    const home: HTMLElement = screen.getByTestId('match-home');
    const homes: HTMLElement[] = screen.getAllByRole('button', { name: '主页' });
    expect(homes).toHaveLength(1);
    expect(homes[0]).toBe(home);
    // 第六层任务栏 4 格：复盘 / 推演 / 练习 / 主页，主页是 DOM 最后一格。
    const taskbar: HTMLElement = home.parentElement as HTMLElement;
    expect(taskbar.children).toHaveLength(4);
    expect(taskbar.lastElementChild).toBe(home);
  });

  it('认输 ends the match; 重来 starts a fresh one', async () => {
    startMatch();
    openMore();
    fireEvent.click(screen.getByRole('button', { name: '认输' }));
    expect(useGameStore.getState().result!.winner).toBe('black');

    // v21.10: 对局结束弹结算页（延迟 700ms），不再自动复盘/文字弹窗。
    await waitFor(() => expect(screen.getByRole('button', { name: /再来一局/ })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /复盘分析/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(useGameStore.getState().result!.winner).toBe('black');

    openMore();
    fireEvent.click(screen.getByRole('button', { name: '重来' }));
    expect(useGameStore.getState().result).toBeNull();
    expect(useGameStore.getState().game.history).toHaveLength(0);

    openMore();
    // 版本徽标按「日期+当日修改次数」迭代，用正则匹配避免锁死具体版本号。
    expect(screen.getByText(/象棋训练 v\d{4}\.\d{2}\.\d{2}\.\d+/)).toBeInTheDocument();
    // 该用例走完整「认输 -> 结算页 -> 重来」链路，含 700ms 终局延迟与
    // 失误分析异步任务；并行跑全量套件时偶发超过 vitest 默认 5s，放宽到 20s。
  }, 20000);
});
