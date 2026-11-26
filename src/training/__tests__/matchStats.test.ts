import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import type { GameState, Move } from '../../engine/types';
import { buildMatchSummary } from '../matchStats';
import { classifyTactic } from '../tacticArt';

function mv(from: [number, number], to: [number, number], piece: Move['piece'], captured: Move['captured'] = null): Move {
  return { from: { col: from[0], row: from[1] }, to: { col: to[0], row: to[1] }, piece, captured, notation: '' };
}

describe('对局技术统计', () => {
  it('空历史返回 0 步 0 失误 0 漏杀', () => {
    const d = buildMatchSummary([], [], 'red');
    expect(d.plies).toBe(0);
    expect(d.blunders).toBe(0);
    expect(d.missedMates).toEqual([]);
  });

  it('步数=历史长度，失误数来自复盘标注', () => {
    const history = [mv([0, 0], [1, 1], 'R')];
    const d = buildMatchSummary(history, [
      { moveIndex: 0, tag: 'blunder', comment: 'x' },
    ], 'red');
    expect(d.plies).toBe(1);
    expect(d.blunders).toBe(1);
  });

  it('杀法识别：无法归入定式返回绝杀', () => {
    const s: GameState = createInitialState('red');
    const r = classifyTactic(s.board, null);
    expect(r.name).toBe('绝杀');
    expect(r.note.length).toBeGreaterThan(2);
  });
});
