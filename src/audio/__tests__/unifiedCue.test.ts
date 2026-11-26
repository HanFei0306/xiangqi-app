import { describe, it, expect } from 'vitest';
import type { Move } from '../../engine/types';
import { Board } from '../../engine/board';
import { planCue, webSoundFor, cueFromMove } from '../unifiedCue';

function mv(captured: Move['captured'] = null): Move {
  return { from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, piece: 'R', captured, notation: '' };
}

describe('统一音效派发', () => {
  it('普通走子 → move 且 Web 音色是清脆 move（不是静音 slide）', () => {
    const plan = planCue(mv(), 'playing');
    expect(plan.kind).toBe('move');
    expect(webSoundFor(plan.kind)).toBe('move');
  });

  it('吃子 → capture', () => {
    expect(planCue(mv('N'), 'playing').kind).toBe('capture');
    expect(webSoundFor('capture')).toBe('capture');
  });

  it('将军 → check；绝杀 → mate 映射到 check 音色', () => {
    expect(planCue(mv(), 'check').kind).toBe('check');
    expect(webSoundFor('mate')).toBe('check');
  });

  it('captured 字段丢失时靠 boardBefore 实测吃子', () => {
    const grid: Array<Array<{ type: string; side: string } | null>> =
      Array.from({ length: 9 }, () => Array(10).fill(null));
    grid[1][1] = { type: 'N', side: 'black' } as never;
    const board = new Board(grid as never);
    expect(planCue(mv(), 'playing', board).kind).toBe('capture');
  });
});

describe('音效去重锁（复盘双响修复）', () => {
  it('同一着法 120ms 内重复调用只发一次', () => {
    // jsdom 环境有 window；mock playUnified 计数
    const calls: string[] = [];
    (window as unknown as { XiangqiNative?: unknown }).XiangqiNative = {
      playUnified: (cue: string) => { calls.push(cue); return true; },
    };
    const m = { from: { col: 2, row: 7 }, to: { col: 2, row: 5 }, piece: 'R' as const, captured: null, notation: '' };
    cueFromMove(m, 'playing');
    cueFromMove(m, 'playing'); // 立即重复
    expect(calls.length).toBe(1);
    delete (window as unknown as { XiangqiNative?: unknown }).XiangqiNative;
  });
});
