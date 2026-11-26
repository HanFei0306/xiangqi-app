/** The UI must expose the same four tiers as the AI layer, in the same order. */
import { describe, it, expect } from 'vitest';
import { DIFFICULTIES } from '../../ai/types';
import { DIFFICULTY_LABELS } from '../ControlPanel';

describe('difficulty labels', () => {
  it('has one label for every AI tier and no extras', () => {
    const keys = Object.keys(DIFFICULTY_LABELS);
    expect(keys).toEqual([...DIFFICULTIES]);
    expect(keys).toHaveLength(4);
  });

  it('uses the agreed Chinese labels (v2026.11.19.6 天天象棋对标)', () => {
    expect(DIFFICULTY_LABELS).toEqual({
      beginner: '初级',
      easy: '中级',
      intermediate: '高级',
      master: '大师',
    });
  });
});
