/**
 * QA 严过关 · v2026.11.19.3 独立实证验收测试 (Task #7)
 *
 * 原则：以全新视角独立构造输入、独立断言完整链路的真实输出，
 *       不复用工程师测试里的断言，只为“证明代码真的能工作”。
 * 覆盖：C(胜负 BUG / 按钮) · D(548 局数据与交互) · B(存档迁移 / 音轨接线)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { SHIQINGYAQU } from '../data/shiqingyaqu';
import {
  AncientPracticePage,
  PAGE_SIZE,
  filterAncientPuzzles,
  advanceAncientHint,
  ancientUndoLength,
} from '../ui/AncientPracticePage';
import { createInitialState } from '../engine/board';
import { applyMoveToState, makeMove } from '../engine/rules';
import type { Move, Pos } from '../engine/types';
import { INITIAL_SETUP } from '../data/puzzles';
import { useGameStore } from '../store/gameStore';
import { useSettings } from '../store/settings';
import { loadMatchStats } from '../store/matchStats';
import { statusText } from '../ui/MatchPage';
import { loadSettings, saveSettings } from '../data/storage';
import { MUSIC_TRACKS, currentMusicTrack, playMusic } from '../audio/music';
import { EVOLUTION_STORAGE_KEY } from '../data/evolution-storage';
import { getEvolutionStats, invalidateEvolutionCache } from '../ai/evolution';

// ---------------------------------------------------------------------------
// C 段：黑方长将判负 BUG 独立复现
// ---------------------------------------------------------------------------
const STATS_KEY = 'xiangqi-trainer:match-stats';
const pos = (c: number, r: number): Pos => ({ col: c, row: r });

/** 用真实规则引擎重放坐标序列，得到引擎实际落子的着法对象。 */
function replaySteps(steps: Array<[Pos, Pos]>): Move[] {
  let state = createInitialState('red');
  const out: Move[] = [];
  for (const [from, to] of steps) {
    const move = makeMove(state.board, from, to);
    if (!move) throw new Error(`独立验收: 非法步 ${JSON.stringify(from)}->${JSON.stringify(to)} @${out.length}`);
    state = applyMoveToState(state, move);
    out.push({ ...state.history[state.history.length - 1] });
  }
  return out;
}

/** 黑方双车在 4/3 路来回将军、红王腾挪，最后一手红着触发第三次重复。 */
const BLACK_PERPETUAL: Array<[Pos, Pos]> = [
  [pos(7, 2), pos(6, 2)], [pos(8, 6), pos(8, 5)],
  [pos(1, 0), pos(2, 2)], [pos(8, 5), pos(8, 4)],
  [pos(8, 0), pos(8, 1)], [pos(8, 9), pos(8, 8)],
  [pos(4, 0), pos(4, 1)], [pos(8, 8), pos(8, 7)],
  [pos(4, 1), pos(3, 1)], [pos(8, 7), pos(8, 6)],
  [pos(4, 3), pos(4, 4)], [pos(8, 6), pos(8, 5)],
  [pos(8, 1), pos(7, 1)], [pos(8, 5), pos(4, 5)],
  [pos(7, 1), pos(7, 3)], [pos(4, 5), pos(4, 4)],
  [pos(0, 0), pos(0, 1)], [pos(4, 4), pos(4, 3)],
  [pos(0, 1), pos(0, 0)],
  [pos(4, 3), pos(3, 3)], [pos(3, 1), pos(4, 1)],
  [pos(3, 3), pos(4, 3)], [pos(4, 1), pos(3, 1)],
  [pos(4, 3), pos(3, 3)], [pos(3, 1), pos(4, 1)],
  [pos(3, 3), pos(4, 3)], [pos(4, 1), pos(3, 1)],
];

describe('QA独立验收 · C 黑方长将判负（用户投诉核心）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem(EVOLUTION_STORAGE_KEY);
    invalidateEvolutionCache();
    useSettings.setState({ playerSide: 'red', soundEnabled: false, difficulty: 'beginner' });
    useGameStore.getState().newGame();
  });
  afterEach(() => {
    useGameStore.getState().newGame();
    vi.useRealTimers();
    localStorage.removeItem(STATS_KEY);
  });

  it('独立复现：走完 27 手后 status/winner/loser/战绩/文案全部与“黑方长将判负”一致', () => {
    const first26 = replaySteps(BLACK_PERPETUAL.slice(0, 26));
    let state = createInitialState('red');
    for (const m of first26) state = applyMoveToState(state, m);
    // 前置条件：第 26 手后轮到红方，黑方即将被判长将。
    expect(state.turn).toBe('red');

    useGameStore.setState({
      game: { board: state.board, turn: 'red', history: first26, status: state.status, moveCount: 26 },
      standardHistory: true,
      result: null,
      thinking: false,
    });
    expect(useGameStore.getState().playerMove(pos(4, 1), pos(3, 1))).toBe(true);

    const after = useGameStore.getState();
    // —— 独立核对：即使最后一手是红方走的（turn=black），输家也必须是黑方 ——
    expect(after.game.status).toBe('perpetual');
    expect(after.game.turn).toBe('black');
    expect(after.result).toEqual({
      status: 'perpetual', reason: 'perpetual', winner: 'red', loser: 'black',
    });
    vi.advanceTimersByTime(600);
    const stats = loadMatchStats('beginner');
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(0);
    expect(getEvolutionStats().totalGames).toBe(1);
    const caption = statusText(after.game.status, after.game.turn, 'red', after.result);
    expect(caption).toBe('红方胜（黑方长将判负）');
    // 输出实证，供报告引用
    console.log('[QA-C] 长将判定=', JSON.stringify(after.result), '文案=', caption,
      '战绩=', JSON.stringify(stats));
  });

  it('将军提示双主体无歧义，且执黑时困毙文案不硬编码红方', () => {
    const redInCheck = statusText('check', 'red', 'red', null);
    const blackInCheck = statusText('check', 'black', 'red', null);
    expect(redInCheck).toBe('黑方将军 · 红方被将军');
    expect(blackInCheck).toBe('红方将军 · 黑方被将军');
    // 用显式 result 的困毙：黑胜时不该出现“红方胜”
    const blackWins = statusText('stalemate', 'red', 'red',
      { status: 'stalemate', reason: 'stalemate', winner: 'black', loser: 'red' });
    expect(blackWins).toBe('黑方胜（困毙红方）');
    console.log('[QA-C] 将军提示=', redInCheck, '/', blackInCheck, '困毙=', blackWins);
  });

  it('认输判负 / 均势提和接受 / AI 大优拒和：战绩与提示均正确', () => {
    useGameStore.getState().resign();
    expect(useGameStore.getState().result?.reason).toBe('resign');
    expect(useGameStore.getState().result?.winner).toBe('black');
    expect(loadMatchStats('beginner').losses).toBe(1);

    vi.advanceTimersByTime(600);
    useGameStore.getState().newGame();
    localStorage.removeItem(STATS_KEY);
    useGameStore.getState().offerDraw();
    expect(useGameStore.getState().result?.reason).toBe('draw-agreed');
    expect(useGameStore.getState().result?.winner).toBeNull();
    expect(loadMatchStats('beginner').draws).toBe(1);

    // 移除红方一车 -> 黑方大优 -> 拒和
    const blackBetter = INITIAL_SETUP.split('/')
      .map((row, i) => (i === 0 ? '.,N,B,A,K,A,B,N,R' : row)).join('/');
    expect(useGameStore.getState().loadPosition(blackBetter)).toBe(true);
    useGameStore.getState().offerDraw();
    expect(useGameStore.getState().game.status).toBe('playing');
    expect(useGameStore.getState().notice).toContain('拒绝提和');
    console.log('[QA-C] 认输/提和: losses=', 1, 'draws=', loadMatchStats('beginner').draws,
      '拒和提示=', useGameStore.getState().notice);
  });
});

// ---------------------------------------------------------------------------
// D 段：548 局数据与逐步提示交互
// ---------------------------------------------------------------------------
describe('QA独立验收 · D 适情雅趣 548 局', () => {
  // 进度记忆是跨会话的；本段 UI 用例固定从第 1 关开始。
  beforeEach(() => localStorage.removeItem('xiangqi-trainer:ancient-progress-v1'));
  afterEach(() => cleanup());

  it('数据独立核验：548 局 / 首局气吞关右 / order 严格升序且缺 482、546', () => {
    expect(SHIQINGYAQU.length).toBe(548);
    expect(SHIQINGYAQU[0].order).toBe(1);
    expect(SHIQINGYAQU[0].title).toBe('气吞关右');
    expect(SHIQINGYAQU[0].solution.length).toBe(11);
    const orders = SHIQINGYAQU.map((p) => p.order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(548);
    expect(orders).not.toContain(482);
    expect(orders).not.toContain(546);
    expect(Math.max(...orders)).toBe(550);
    expect(PAGE_SIZE).toBe(50);
    expect(Math.ceil(548 / PAGE_SIZE)).toBe(11);
    console.log('[QA-D] 局数=', SHIQINGYAQU.length, '首局=', SHIQINGYAQU[0].title,
      '页数=', Math.ceil(548 / PAGE_SIZE), '缺号=482,546');
  });

  it('搜索按局号/局名过滤，保持 order 升序', () => {
    const byName = filterAncientPuzzles('气吞关右');
    expect(byName.length).toBeGreaterThanOrEqual(1);
    expect(byName[0].order).toBe(1);
    const byNo = filterAncientPuzzles('1');
    expect(byNo.some((p) => p.order === 1)).toBe(true);
    expect(filterAncientPuzzles('').length).toBe(548);
  });

  it('提示状态机独立推演：11 步需 13 次点击走到 done，进度到 11/11', () => {
    let cursor = 0;
    let hintIndex: number | null = null;
    let clicks = 0;
    const total = SHIQINGYAQU[0].solution.length; // 11
    // 模拟连续点“提示”。注意状态机的 play 会预置 nextHighlight=cursor+1，
    // 因此除第一步外后续点击可直接 play（无需再次高亮）。
    while (clicks < 40) {
      const action = advanceAncientHint(total, cursor, hintIndex, false);
      clicks += 1;
      if (action.kind === 'done') break;
      if (action.kind === 'play') {
        cursor = action.index + 1;
        hintIndex = action.nextHighlight;
      } else if (action.kind === 'highlight') {
        hintIndex = action.index;
      }
    }
    expect(cursor).toBe(11);
    expect(clicks).toBe(13); // 1 次高亮 + 11 次走出 + 1 次 done
    console.log('[QA-D] 第1局 solution=11, 连续点提示次数=', clicks, '最终进度=', cursor + '/' + total);
  });

  it('悔棋退一个完整回合：奇数退 1、偶数退 2', () => {
    expect(ancientUndoLength(0)).toBe(0);
    expect(ancientUndoLength(1)).toBe(0);
    expect(ancientUndoLength(2)).toBe(0);
    expect(ancientUndoLength(3)).toBe(2);
    expect(ancientUndoLength(4)).toBe(2);
  });

  it('UI 集成：渲染第 1 局，连续点“提示”直到“解法演示完毕”且进度 11/11', () => {
    render(<AncientPracticePage />);
    // 进入残局默认棋盘页且已载入第1局（目录需点「残局目录」进入）
    expect(screen.getByText(/共 548 局/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '残局目录' })).toBeInTheDocument();
    const hintBtn = screen.getByRole('button', { name: '提示' });
    let done = false;
    for (let i = 0; i < 40; i++) {
      fireEvent.click(hintBtn);
      if (screen.queryByText('解法演示完毕')) { done = true; break; }
    }
    expect(done).toBe(true);
    expect(screen.getByText(/第 11 \/ 11 步/)).toBeInTheDocument();
    // 悔棋/重置可用
    const undoBtn = screen.getByRole('button', { name: '悔棋' });
    const resetBtn = screen.getByRole('button', { name: '重置' });
    expect(undoBtn).not.toBeDisabled();
    expect(resetBtn).not.toBeDisabled();
    fireEvent.click(resetBtn);
    expect(screen.getByText(/第 0 \/ 11 步/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// B 段：音乐音轨接线与老存档迁移
// ---------------------------------------------------------------------------
describe('QA独立验收 · B 音乐接线', () => {
  beforeEach(() => {
    localStorage.removeItem('xiangqi-trainer:settings');
    invalidateEvolutionCache();
  });

  it('三条音轨 src 为相对路径，第三首是公有领域古琴《阳关三叠》', () => {
    expect(MUSIC_TRACKS.map((t) => t.id)).toEqual(['moonlight', 'canon', 'yangguan']);
    expect(MUSIC_TRACKS.map((t) => t.src)).toEqual([
      'music/moonlight.m4a', 'music/canon.ogg', 'music/yangguan.ogg',
    ]);
    expect(MUSIC_TRACKS[2].label).toContain('阳关三叠');
    console.log('[QA-B] 音轨=', JSON.stringify(MUSIC_TRACKS.map((t) => [t.id, t.src])));
  });

  it('老存档 songchuang 启动自动迁移为 yangguan，不残留已下架版权曲', () => {
    localStorage.setItem('xiangqi-trainer:settings',
      JSON.stringify({ musicTrack: 'songchuang', musicVolume: 0.6 }));
    const loaded = loadSettings();
    expect(loaded.musicTrack).toBe('yangguan');
    expect(loaded.musicVolume).toBe(0.6);
    // 迁移后重新落盘，确保重启后仍是 yangguan
    saveSettings({});
    expect(loadSettings().musicTrack).toBe('yangguan');
    playMusic(loaded.musicTrack, loaded.musicVolume);
    expect(currentMusicTrack()).toBe('yangguan');
    console.log('[QA-B] 老存档迁移结果=', loadSettings().musicTrack);
  });
});
