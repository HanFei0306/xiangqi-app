import { describe, it, expect, beforeEach } from 'vitest';
import { useSimulationStore } from '../simulationStore';
import { generateLegalMoves } from '../../engine/rules';
import { Board } from '../../engine/board';

describe('推演 · 变化图 store', () => {
  beforeEach(() => useSimulationStore.getState().reset());

  it('初始只有根节点，轮到红方', () => {
    const s = useSimulationStore.getState();
    expect(s.currentId).toBe(s.rootId);
    expect(s.currentNode().state.turn).toBe('red');
    expect(s.path()).toHaveLength(1);
  });

  it('走一步后产生子节点，当前指针前移', () => {
    const s = useSimulationStore.getState();
    const move = generateLegalMoves(s.currentNode().state.board, 'red')[0];
    s.playMove(move);
    const after = useSimulationStore.getState();
    expect(after.currentId).not.toBe(after.rootId);
    expect(after.currentNode().move).not.toBeNull();
    expect(after.path()).toHaveLength(2);
    expect(after.currentNode().state.turn).toBe('black');
  });

  it('同一局面走不同着产生两个分支，可切换比较', () => {
    const s = useSimulationStore.getState();
    const root = s.currentId;
    const moves = generateLegalMoves(s.currentNode().state.board, 'red');
    s.playMove(moves[0]);
    useSimulationStore.getState().gotoNode(root);
    useSimulationStore.getState().playMove(moves[1]);
    const state = useSimulationStore.getState();
    expect(state.nodes[root].children).toHaveLength(2);
    expect(state.currentNode().move).not.toBeNull();
    // 切回第一个分支
    const firstChild = state.nodes[root].children[0];
    state.gotoNode(firstChild);
    expect(useSimulationStore.getState().currentId).toBe(firstChild);
  });

  it('重复走同一着不会新建分支', () => {
    const s = useSimulationStore.getState();
    const root = s.currentId;
    const move = generateLegalMoves(s.currentNode().state.board, 'red')[0];
    s.playMove(move);
    useSimulationStore.getState().gotoNode(root);
    useSimulationStore.getState().playMove(move);
    expect(useSimulationStore.getState().nodes[root].children).toHaveLength(1);
  });

  it('回退回到父节点', () => {
    const s = useSimulationStore.getState();
    const root = s.currentId;
    const move = generateLegalMoves(s.currentNode().state.board, 'red')[0];
    s.playMove(move);
    expect(useSimulationStore.getState().currentId).not.toBe(root);
    useSimulationStore.getState().undo();
    expect(useSimulationStore.getState().currentId).toBe(root);
  });

  it('非法着法被拒绝', () => {
    const s = useSimulationStore.getState();
    const ok = s.tryMove({ col: 0, row: 0 }, { col: 4, row: 4 });
    expect(ok).toBe(false);
    expect(useSimulationStore.getState().currentId).toBe(s.rootId);
  });
});

describe('推演 AI 走子', () => {
  it('v22.6: 只剩将帅士象时 aiStep 判和并停住', () => {
    const board = Board.fromSetup('');
    board.setPiece({ col: 4, row: 0 }, { type: 'K', side: 'red' });
    board.setPiece({ col: 4, row: 9 }, { type: 'K', side: 'black' });
    useSimulationStore.getState().reset({
      board, turn: 'red', history: [], status: 'playing', moveCount: 0,
    });
    const before = useSimulationStore.getState().currentId;
    expect(useSimulationStore.getState().aiStep(true)).toBe(false);
    const after = useSimulationStore.getState();
    expect(after.currentId).toBe(before);
    expect(after.verdict).toBe('draw');
  });

  it('aiStep 用引擎走出合法着并前移（自研引擎兜底）', () => {
    useSimulationStore.getState().reset();
    const root = useSimulationStore.getState().currentId;
    const ok = useSimulationStore.getState().aiStep();
    expect(ok).toBe(true);
    const state = useSimulationStore.getState();
    expect(state.currentId).not.toBe(root);
    expect(state.currentNode().move).not.toBeNull();
    expect(state.lastError).toBeNull();
  }, 20000);
});

describe('v22.8 aiStepAsync 异步走子（UI 不冻结）', () => {
  it('aiStepAsync 走一步并推进 currentId', async () => {
    useSimulationStore.getState().reset();
    const before = useSimulationStore.getState().currentId;
    const ok = await useSimulationStore.getState().aiStepAsync(true);
    expect(ok).toBe(true);
    expect(useSimulationStore.getState().currentId).toBeGreaterThan(before);
  });
});
