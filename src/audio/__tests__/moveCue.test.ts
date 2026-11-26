import { describe, it, expect } from 'vitest';
import type { Move } from '../../engine/types';
import { cueForMove } from '../moveCue';

function mv(captured: Move['captured'] = null): Move {
  return { from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, piece: 'R', captured, notation: '' };
}

describe('着法音效/特效分类（推演与复盘共用）', () => {
  it('将死 → mate', () => {
    expect(cueForMove(mv(), 'checkmate')).toEqual({ cue: 'check', voice: 'checkmate' });
  });
  it('将军 → check', () => {
    expect(cueForMove(mv(), 'check')).toEqual({ cue: 'check', voice: 'check' });
  });
  it('吃子 → capture（即使 captured 字段丢失也能靠 boardBefore 判定由调用方保证）', () => {
    expect(cueForMove(mv('N'), 'playing')).toEqual({ cue: 'capture', voice: 'capture' });
  });
  it('普通走子 → 无语音', () => {
    expect(cueForMove(mv(), 'playing')).toEqual({ cue: 'move', voice: null });
  });
});
