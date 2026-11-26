/**
 * v22.7 回归：自动推演走子后页面必须跟着重绘。
 *
 * 症状：v22.6 删掉监听 currentId 的 showCue effect 时，连同
 * `const currentId = useSimulationStore(s => s.currentId)` 订阅一起被删，
 * 导致 playMove 更新了 store 数据（音效照响）但组件不重渲染，画面卡住，
 * 只有暂停/setAuto 触发 state 变化才一次性刷新。
 *
 * 本测试证明：仅调用 store.playMove（模拟推演走子，不碰 React 本地 state），
 * 由 node=currentNode() 派生的 DOM（回退按钮 disabled）就会跟着更新。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { SimulationPage } from '../SimulationPage';
import { useSimulationStore } from '../../store/simulationStore';
import { createInitialState } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';

beforeEach(() => {
  act(() => { useSimulationStore.getState().reset(createInitialState('red')); });
});
afterEach(cleanup);

describe('推演走子后画面重绘（currentId 订阅回归）', () => {
  it('playMove 走一步后，回退按钮由禁用变为可用，说明 node 已随 currentId 重算', () => {
    render(<SimulationPage onBack={() => {}} />);
    const undoBtn = screen.getByText('回退').closest('button') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true); // 根节点，无可回退

    const first = generateLegalMoves(useSimulationStore.getState().nodes[0].state.board, 'red')[0];
    act(() => { useSimulationStore.getState().playMove(first, true); });

    // 关键断言：没有触碰任何 React 本地 state，纯 store 走子，DOM 也应刷新。
    expect(undoBtn.disabled).toBe(false);
  });

  it('连续多步走子后 currentId 单调递增且回退始终可用', () => {
    render(<SimulationPage onBack={() => {}} />);
    const startId = useSimulationStore.getState().currentId;
    for (let i = 0; i < 3; i++) {
      const st = useSimulationStore.getState();
      const n = st.currentNode();
      const mv = generateLegalMoves(n.state.board, n.state.turn)[0];
      act(() => { useSimulationStore.getState().playMove(mv, true); });
    }
    expect(useSimulationStore.getState().currentId).toBeGreaterThan(startId);
    const undoBtn = screen.getByText('回退').closest('button') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);
  });
});
