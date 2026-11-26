/** 适情雅趣闯关进度：持久化、续关推进与坏数据回退。 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SHIQINGYAQU } from '../shiqingyaqu';
import {
  emptyProgress,
  loadProgress,
  markSolved,
  resetProgress,
  saveProgress,
} from '../ancient-progress';

const KEY = 'xiangqi-trainer:ancient-progress-v1';

beforeEach(() => {
  localStorage.clear();
});

describe('ancient-progress', () => {
  it('无记录与坏 JSON 均回退到空进度', () => {
    expect(loadProgress()).toEqual({ current: 0, solved: [], updatedAt: 0 });
    localStorage.setItem(KEY, '{not-json');
    expect(loadProgress()).toEqual({ current: 0, solved: [], updatedAt: 0 });
    localStorage.setItem(KEY, 'null');
    expect(loadProgress()).toEqual(emptyProgress());
  });

  it('save/load 往返保留进度，并过滤数组中的残缺元素', () => {
    saveProgress({
      current: 3,
      solved: [0, 1, -1, SHIQINGYAQU.length + 10, 2, 1, 'x' as unknown as number],
      updatedAt: 12345,
    });
    expect(loadProgress()).toEqual({ current: 3, solved: [0, 1, 2], updatedAt: 12345 });

    localStorage.setItem(KEY, JSON.stringify({ current: '2', solved: [0, null, 1], updatedAt: null }));
    expect(loadProgress()).toEqual({ current: 0, solved: [0, 1], updatedAt: 0 });
  });

  it('markSolved 合并去重、推进到下一关，末局封顶', () => {
    const first = markSolved(0);
    expect(first.current).toBe(1);
    expect(first.solved).toEqual([0]);
    expect(first.updatedAt).toBeGreaterThan(0);
    expect(loadProgress()).toEqual(first);

    const replayed = markSolved(0);
    expect(replayed.solved).toEqual([0]);
    expect(replayed.current).toBe(1);

    const second = markSolved(1);
    expect(second.current).toBe(2);
    expect(second.solved).toEqual([0, 1]);

    const last = SHIQINGYAQU.length - 1;
    const final = markSolved(last);
    expect(final.current).toBe(last);
    expect(final.solved).toContain(last);

    const before = loadProgress();
    markSolved(-1);
    markSolved(SHIQINGYAQU.length);
    expect(loadProgress()).toEqual(before);
  });

  it('resetProgress 清空存储与内存进度', () => {
    markSolved(2);
    expect(loadProgress().current).toBe(3);
    expect(resetProgress()).toEqual(emptyProgress());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadProgress()).toEqual(emptyProgress());
  });
});
