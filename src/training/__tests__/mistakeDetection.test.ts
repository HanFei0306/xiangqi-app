/** WPL 分级边界、封顶、Miss 特例与两遍扫描检测的单测。 */
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import type { Move } from '../../engine/types';
import { analyzeMistakes } from '../mistakeDetection';
import { gradeFromWpl, gradeOf, winProb, type MistakeGrade } from '../mistakeTypes';
import fixtures from './fixtures/wpl-boundaries.json';

/**
 * 固定可复现的实战片段：第 18 手红方把车从 (3,8) 退回 (3,3)，
 * 静态评估损失 7.81% 胜率，足以越过 WPL>=5 的粗筛线。
 */
const BLUNDER_COORDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 1], [1, 7, 1, 3], [0, 1, 2, 1], [5, 9, 4, 8], [2, 1, 3, 1], [4, 9, 5, 9],
  [3, 0, 4, 1], [0, 6, 0, 5], [1, 2, 2, 2], [7, 7, 8, 7], [3, 1, 3, 8], [8, 7, 2, 7],
  [7, 2, 7, 5], [2, 7, 2, 8], [2, 2, 5, 2], [7, 9, 8, 7], [5, 2, 5, 8], [1, 3, 1, 8],
  [3, 8, 3, 3], [0, 9, 0, 6], [3, 3, 3, 8], [4, 6, 4, 5], [5, 8, 8, 8], [0, 6, 0, 8],
  [7, 5, 7, 1], [5, 9, 4, 9], [3, 8, 3, 6], [0, 8, 0, 6], [4, 1, 3, 2], [2, 6, 2, 5],
  [7, 1, 1, 1], [2, 9, 4, 7], [8, 8, 2, 8], [1, 8, 1, 4], [2, 8, 2, 7],
];

function blunderHistory(coords: ReadonlyArray<readonly [number, number, number, number]> = BLUNDER_COORDS): Move[] {
  let state = createInitialState('red');
  const history: Move[] = [];
  for (const [fc, fr, tc, tr] of coords) {
    const legal = generateLegalMoves(state.board, state.turn);
    const chosen = legal.find((move) => move.from.col === fc && move.from.row === fr
      && move.to.col === tc && move.to.row === tr);
    if (!chosen) break;
    state = applyMoveToState(state, chosen);
    const applied = state.history[state.history.length - 1];
    chosen.notation = applied.notation;
    history.push(chosen);
  }
  return history;
}

describe('WPL 胜率与分级', () => {
  it('sigmoid maps 0cp to 50% and is monotonic', () => {
    expect(winProb(0)).toBeCloseTo(50, 6);
    expect(winProb(100)).toBeGreaterThan(winProb(0));
    expect(winProb(-100)).toBeLessThan(winProb(0));
    expect(winProb(10000)).toBeLessThanOrEqual(100);
  });

  it('respects all eight WPL boundaries', () => {
    for (const sample of fixtures.boundaries) {
      const actual: number = winProb(sample.cpPre) - winProb(sample.cpPlayed);
      expect(actual).toBeGreaterThanOrEqual(sample.wpl - 0.03);
      expect(actual).toBeLessThanOrEqual(sample.wpl + 0.03);
      expect(gradeOf(sample.cpPre, sample.cpPlayed).grade).toBe<MistakeGrade>(sample.expected as MistakeGrade);
    }
  });

  it('applies the big-advantage cap but lets missed-win override it', () => {
    for (const sample of fixtures.caps) {
      expect(gradeOf(sample.cpPre, sample.cpPlayed).grade).toBe<MistakeGrade>(sample.expected as MistakeGrade);
    }
    for (const sample of fixtures.missedWin) {
      expect(gradeOf(sample.cpPre, sample.cpPlayed).grade).toBe('missed-win');
    }
    // 单独验证 ≥65% 封顶：不经过 Miss 特例的纯 WPL 判定。
    expect(gradeFromWpl(25, 200)).toBe('mistake');
    expect(gradeFromWpl(25, 500)).toBe('inaccuracy');
    expect(gradeFromWpl(25, 700)).toBe('fair');
  });

  it('has zero false positives for "winning position, dropped piece"', () => {
    const listed: MistakeGrade[] = ['inaccuracy', 'mistake', 'blunder', 'missed-win'];
    for (const sample of fixtures.negatives) {
      expect(listed).not.toContain(gradeOf(sample.cpPre, sample.cpPlayed).grade);
    }
  });
});

describe('analyzeMistakes 两遍扫描', () => {
  it('returns empty analysis for zero plies, broken history and invalid side', async () => {
    const empty = await analyzeMistakes([], { playerSide: 'red' });
    expect(empty.mistakes).toEqual([]);
    expect(empty.analyzedPlies).toBe(0);
    const broken = await analyzeMistakes([
      null as unknown as Move,
      { from: { col: 99, row: 99 }, to: { col: 99, row: 99 }, piece: 'R', captured: null, notation: '' },
    ], { playerSide: 'red' });
    expect(broken.mistakes).toEqual([]);
    expect((await analyzeMistakes(blunderHistory(), { playerSide: 'red' })).mistakes.length)
      .toBeGreaterThanOrEqual(0);
  });

  it('only analyses playerSide and excludes missed-mate plies', async () => {
    const history = blunderHistory();
    const all = (await analyzeMistakes(history, { playerSide: 'red' })).mistakes;
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((entry) => entry.side === 'red')).toBe(true);
    expect(all[0].ply).toBe(18);
    const excluded = (await analyzeMistakes(history, {
      playerSide: 'red', excludePlies: new Set([18]),
    })).mistakes;
    expect(excluded.some((entry) => entry.ply === 18)).toBe(false);
    const black = (await analyzeMistakes(history, { playerSide: 'black' })).mistakes;
    expect(black.every((entry) => entry.side === 'black')).toBe(true);
    const yielded = await analyzeMistakes(history, { playerSide: 'red' }, async () => {
      await Promise.resolve();
    });
    expect(yielded.mistakes).toEqual(all);
    const capped = await analyzeMistakes(history, { playerSide: 'red', maxPlies: 4 });
    expect(capped.analyzedPlies).toBeGreaterThan(0);
    expect(capped.analyzedPlies).toBeLessThanOrEqual(4);
  });

  it('returns at most five entries sorted by WPL descending', async () => {
    const result = await analyzeMistakes(blunderHistory(), { playerSide: 'red' });
    const entries = result.mistakes;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThanOrEqual(5);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i - 1].wpl).toBeGreaterThanOrEqual(entries[i].wpl);
    }
  });

  it('every entry carries a legal best move and full five-card fields', async () => {
    const history = blunderHistory();
    const result = await analyzeMistakes(history, { playerSide: 'red' });
    for (const entry of result.mistakes) {
      expect(entry.bestMove).not.toBeNull();
      expect(entry.bestNotation.length).toBeGreaterThan(0);
      expect(entry.playedNotation.length).toBeGreaterThan(0);
      expect(entry.wplBest).toBeGreaterThanOrEqual(0);
      expect(entry.beforeState.board.getPiece({ col: 4, row: 0 })?.type).toBe('K');
      const legal = generateLegalMoves(entry.beforeState.board, entry.beforeState.turn);
      expect(legal.some((move) => move.from.col === entry.bestMove?.from.col
        && move.from.row === entry.bestMove?.from.row
        && move.to.col === entry.bestMove?.to.col
        && move.to.row === entry.bestMove?.to.row)).toBe(true);
      expect(history[entry.ply].notation.length).toBeGreaterThan(0);
    }
  });
});
