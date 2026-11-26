import { describe, it, expect, beforeEach } from 'vitest';
import { loadNotations, saveNotation, deleteNotation, renameNotation } from '../notation-storage';
import type { Move } from '../../engine/types';

const KEY = 'xiangqi-trainer:notations-v1';
const dummy: Move[] = [{
  from: { col: 0, row: 0 }, to: { col: 1, row: 1 }, piece: 'R', captured: null, notation: '车一进一',
}];

describe('记谱本存储', () => {
  beforeEach(() => { localStorage.removeItem(KEY); });

  it('初始为空', () => { expect(loadNotations()).toEqual([]); });

  it('保存后可读回，含名称与着法', () => {
    const list = saveNotation({ name: '精彩对局', setup: '', moves: dummy });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('精彩对局');
    expect(list[0].moves).toHaveLength(1);
    expect(loadNotations()[0].moves[0].notation).toBe('车一进一');
  });

  it('多份棋谱按最新在前', () => {
    saveNotation({ name: '第一局', setup: '', moves: dummy });
    saveNotation({ name: '第二局', setup: '', moves: dummy });
    expect(loadNotations().map((n) => n.name)).toEqual(['第二局', '第一局']);
  });

  it('可删除与重命名', () => {
    const list = saveNotation({ name: 'A', setup: '', moves: dummy });
    const id = list[0].id;
    expect(renameNotation(id, 'B')[0].name).toBe('B');
    expect(deleteNotation(id)).toHaveLength(0);
    expect(loadNotations()).toEqual([]);
  });

  // QA-002 regression: a valid JSON array containing an incomplete element
  // used to crash the notation page (n.moves.length on undefined).
  it('QA-002 过滤残缺棋谱项，不让坏数据导致记谱页白屏', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { id: 'bad', name: '残缺数据' }, // missing moves/createdAt
      { id: 'ok', name: '正常棋谱', setup: '', moves: dummy, createdAt: 1 },
      null,
      { id: 'bad2', name: 42, setup: '', moves: dummy, createdAt: 1 },
    ]));
    const list = loadNotations();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('正常棋谱');
    expect(() => list.map((n) => n.moves.length)).not.toThrow();
  });

  it('整体 JSON 损坏时返回空列表不崩溃', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(loadNotations()).toEqual([]);
  });
});
