/**
 * v22.6 吃子双响修复：推演/回放每一步只有唯一出口——store.playMove
 * 必须严格调用一次音效和一次艺术字特效；silent 重建路径两者都不发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cueFromMove: vi.fn(),
  showCue: vi.fn(),
  clearCue: vi.fn(),
}));

vi.mock('../../audio/unifiedCue', () => ({
  cueFromMove: mocks.cueFromMove,
  planCue: vi.fn(() => ({ kind: 'move', voice: null })),
  webSoundFor: vi.fn(() => 'move'),
}));

vi.mock('../cueDisplayStore', () => ({
  useCueDisplay: {
    getState: () => ({ showCue: mocks.showCue, clearCue: mocks.clearCue }),
  },
}));

import { useSimulationStore } from '../simulationStore';
import { generateLegalMoves } from '../../engine/rules';

describe('v22.6 推演走子音效/特效唯一出口', () => {
  beforeEach(() => {
    useSimulationStore.getState().reset();
    mocks.cueFromMove.mockClear();
    mocks.showCue.mockClear();
    mocks.clearCue.mockClear();
  });

  it('普通 playMove：一次音效 + 一次特效', () => {
    const move = generateLegalMoves(useSimulationStore.getState().currentNode().state.board, 'red')[0];
    useSimulationStore.getState().playMove(move);
    expect(mocks.cueFromMove).toHaveBeenCalledTimes(1);
    expect(mocks.showCue).toHaveBeenCalledTimes(1);
  });

  it('重走已存在的子节点：仍是一次音效 + 一次特效', () => {
    const store = useSimulationStore.getState();
    const root = store.currentId;
    const move = generateLegalMoves(store.currentNode().state.board, 'red')[0];
    store.playMove(move);
    mocks.cueFromMove.mockClear();
    mocks.showCue.mockClear();
    useSimulationStore.getState().gotoNode(root);
    useSimulationStore.getState().playMove(move);
    expect(mocks.cueFromMove).toHaveBeenCalledTimes(1);
    expect(mocks.showCue).toHaveBeenCalledTimes(1);
  });

  it('silent 回放路径重建：音效和特效都不发', () => {
    const move = generateLegalMoves(useSimulationStore.getState().currentNode().state.board, 'red')[0];
    useSimulationStore.getState().playMove(move, true);
    expect(mocks.cueFromMove).not.toHaveBeenCalled();
    expect(mocks.showCue).not.toHaveBeenCalled();
  });
});
