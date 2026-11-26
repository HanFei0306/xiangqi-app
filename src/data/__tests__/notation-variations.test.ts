/**
 * v22.6 变招树存储回归：树结构保存/读取 + 老棋谱（只有 moves）向后兼容。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadNotations, saveNotation, exportVariations,
  mainVariationPath, variationChildren, variationLineFrom,
  type VariationMove,
} from '../notation-storage';
import type { Move, PieceType } from '../../engine/types';

const KEY = 'xiangqi-trainer:notations-v1';

function mv(notation: string, piece: PieceType = 'P'): Move {
  return {
    from: { col: 0, row: 3 },
    to: { col: 0, row: 4 },
    piece,
    captured: null,
    notation,
  };
}

describe('v22.6 变招树', () => {
  beforeEach(() => { localStorage.removeItem(KEY); });

  it('保存后可完整读回变招树（含每个节点的父下标）', () => {
    const variations: VariationMove[] = [
      { parent: -1, move: mv('兵三进一') },
      { parent: 0, move: mv('马二进三', 'N') },
      { parent: -1, move: mv('炮二平五', 'C') },
    ];
    saveNotation({ name: '有变招', setup: '', moves: [variations[0].move], variations });
    const loaded = loadNotations()[0];
    expect(loaded.variations).toEqual(variations);
    expect(variationChildren(loaded.variations, -1)).toEqual([0, 2]);
    expect(variationChildren(loaded.variations, 0)).toEqual([1]);
    expect(variationLineFrom(loaded.variations, 2).map((m) => m.notation)).toEqual(['炮二平五']);
  });

  it('老棋谱只有 moves 仍能读取回放，不因缺少 variations 崩溃', () => {
    const old = { id: 'old', name: '老棋谱', setup: '', moves: [mv('老着')], createdAt: 1 };
    localStorage.setItem(KEY, JSON.stringify([old]));
    const loaded = loadNotations()[0];
    expect(loaded.moves[0].notation).toBe('老着');
    expect(loaded.variations).toBeUndefined();
    expect(variationChildren(loaded.variations, -1)).toEqual([]);
    expect(variationLineFrom(loaded.variations, 0)).toEqual([]);
    expect(mainVariationPath(loaded.variations, loaded.moves)).toEqual([]);
  });

  it('导出时主线在每条分支链上排第一，保证 variations 与 moves 对齐', () => {
    const nodes = {
      0: { move: null, children: [1, 2] },
      1: { move: mv('主线第一着'), children: [3] },
      2: { move: mv('变招第一着'), children: [] },
      3: { move: mv('主线第二着'), children: [] },
    };
    const variations = exportVariations(nodes, 0, [0, 1, 3]);
    expect(variations.map((v) => v.move.notation)).toEqual(['主线第一着', '主线第二着', '变招第一着']);
    expect(variations.map((v) => v.parent)).toEqual([-1, 0, -1]);
    expect(mainVariationPath(variations, [nodes[1].move!, nodes[3].move!])).toEqual([0, 1]);
    expect(variationLineFrom(variations, 2).map((m) => m.notation)).toEqual(['变招第一着']);
  });

  it('主线不在最后一条分支时也能正确按 mainLineIds 排序', () => {
    const nodes = {
      0: { move: null, children: [1, 2] },
      1: { move: mv('变招'), children: [] },
      2: { move: mv('当前主线'), children: [] },
    };
    const variations = exportVariations(nodes, 0, [0, 2]);
    expect(variations.map((v) => v.move.notation)).toEqual(['当前主线', '变招']);
  });
});
