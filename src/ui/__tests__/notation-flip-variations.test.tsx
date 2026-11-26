/**
 * 记谱功能工位验收测试（v2026.11.26）：
 *
 *  A. 「反转」——控制条一键翻转棋盘视角（红下↔黑下），localStorage 持久化；
 *  B. 「棋谱主线」——非回放时实时展示主线着法（可点击回跳）+ 分支 ①②③ chips
 *     （同一局面走出不同着法自动成枝，点击切换走势）；
 *  C. 举一反三自查项——删除棋谱二次确认、保存对话框变化分支提示、记谱页脚文案。
 *
 * 数据层（simulationStore 的变招树）不改，本文件只验 UI 接线。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SimulationPage } from '../SimulationPage';
import { useSimulationStore } from '../../store/simulationStore';
import { createInitialState } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import { legalMovesWithNotation } from '../../training/legalNotation';
import { loadNotations, saveNotation } from '../../data/notation-storage';

const FLIP_KEY = 'xiangqi-trainer:sim-flip-v1';

/** 棋盘底部文件号是页面里唯一的"单个数字"span；首位 9 = 红下，首位 1 = 黑下（翻转）。 */
function fileLabels(): string[] {
  return Array.from(document.querySelectorAll('span'))
    .map((s) => (s.textContent ?? '').trim())
    .filter((t) => /^[1-9]$/.test(t));
}

/** 从当前局面走出第 n 个带记谱的合法着法（静默，不发声/不出特效）。 */
function playLegal(index = 0): void {
  const st = useSimulationStore.getState();
  const cur = st.currentNode();
  const move = legalMovesWithNotation(cur.state)[index];
  if (!move) throw new Error('没有合法着法');
  act(() => { useSimulationStore.getState().playMove(move, true); });
}

/** 中文记谱判定：必须含汉字着法名，不能是空白或下划线占位。 */
const CN_NOTATION = /[\u4e00-\u9fff]/;

/**
 * 真实棋盘点击路径：generateLegalMoves 只给坐标（notation 为空），
 * 仅把 from/to 交给 tryMove，等价于用户在棋盘上点两下。返回落子后的节点 id。
 */
function clickMove(index = 0): number {
  const st = useSimulationStore.getState();
  const cur = st.currentNode();
  const raw = generateLegalMoves(cur.state.board, cur.state.turn)[index];
  if (!raw) throw new Error('没有合法着法');
  expect(raw.notation).toBe(''); // 守护测试前提：这里模拟的就是"无记谱"的真实点击输入
  act(() => {
    expect(useSimulationStore.getState().tryMove(raw.from, raw.to)).toBe(true);
  });
  return useSimulationStore.getState().currentId;
}

beforeEach(() => {
  localStorage.clear();
  act(() => { useSimulationStore.getState().reset(createInitialState('red')); });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('功能 A：反转棋盘视角', () => {
  it('默认红下（文件号 9 开头）；点「反转」变黑下（1 开头）并写入 localStorage', () => {
    render(<SimulationPage onBack={() => {}} />);

    const flipBtn = screen.getByTestId('sim-flip');
    expect(fileLabels()[0]).toBe('9'); // 红下：文件号 9→1

    fireEvent.click(flipBtn);

    expect(fileLabels()[0]).toBe('1'); // 黑下：文件号 1→9
    expect(localStorage.getItem(FLIP_KEY)).toBe('1');
  });

  it('再点一次翻回红下（对合切换）', () => {
    render(<SimulationPage onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('sim-flip'));
    fireEvent.click(screen.getByTestId('sim-flip'));
    expect(fileLabels()[0]).toBe('9');
    expect(localStorage.getItem(FLIP_KEY)).toBe('0');
  });

  it('重新挂载（模拟切页返回/重开 App）后保持上次的视角', () => {
    localStorage.setItem(FLIP_KEY, '1');
    render(<SimulationPage onBack={() => {}} />);
    expect(fileLabels()[0]).toBe('1');
  });

  it('manual 双人模式也有「反转」按钮', () => {
    render(<SimulationPage onBack={() => {}} manual />);
    expect(screen.getByTestId('sim-flip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sim-flip'));
    expect(fileLabels()[0]).toBe('1');
  });
});

describe('功能 B：棋谱主线面板（录入时实时可见）', () => {
  it('空线显示占位文案，且轮到指示为红方', () => {
    render(<SimulationPage onBack={() => {}} />);

    expect(screen.getByTestId('sim-movelist')).toBeTruthy();
    expect(screen.getByText('还没有着法——在棋盘上走出第一步')).toBeTruthy();
    expect(screen.getByTestId('sim-turn').textContent).toBe('轮到：红方');
    expect(screen.getByText(/棋谱主线 · 第 0 步/)).toBeTruthy();
  });

  it('走子后成对显示着法，第 N 步与轮到指示随 currentId 刷新', () => {
    render(<SimulationPage onBack={() => {}} />);

    playLegal(0); // 红一步
    expect(screen.getByText(/棋谱主线 · 第 1 步/)).toBeTruthy();
    expect(screen.getByTestId('sim-turn').textContent).toBe('轮到：黑方');

    playLegal(1); // 黑一步
    expect(screen.getByText(/棋谱主线 · 第 2 步/)).toBeTruthy();
    expect(screen.getByTestId('sim-turn').textContent).toBe('轮到：红方');

    // 两个着法按钮都在（data-testid sim-move-<nodeId>）
    const st = useSimulationStore.getState();
    const firstChild = st.nodes[st.rootId].children[0];
    expect(screen.getByTestId(`sim-move-${firstChild}`)).toBeTruthy();
    expect(screen.getByTestId(`sim-move-${st.currentId}`)).toBeTruthy();
  });

  it('点击历史着法可跳转（gotoNode），轮到指示随之变化', () => {
    render(<SimulationPage onBack={() => {}} />);
    playLegal(0);
    playLegal(1);

    const st = useSimulationStore.getState();
    const firstNodeId = st.nodes[st.rootId].children[0];
    fireEvent.click(screen.getByTestId(`sim-move-${firstNodeId}`));

    expect(useSimulationStore.getState().currentId).toBe(firstNodeId);
    // 跳到第 1 步（红方已走完一手）→ 接下来轮黑方走，指示必须跟着变。
    expect(screen.getByTestId('sim-turn').textContent).toBe('轮到：黑方');
    expect(screen.getByText(/棋谱主线 · 第 1 步/)).toBeTruthy();
  });

  it('回中后走出不同着法自动成新枝：出现 ①② 分支 chips，点击切换走势', () => {
    render(<SimulationPage onBack={() => {}} />);

    playLegal(0); // 主线第一步 A
    const rootId = useSimulationStore.getState().rootId;
    const moveAId = useSimulationStore.getState().currentId;

    // 回到根局面，走出另一种着法 B
    act(() => { useSimulationStore.getState().gotoNode(rootId); });
    playLegal(1); // 不同的第一步 B
    const moveBId = useSimulationStore.getState().currentId;
    expect(moveBId).not.toBe(moveAId);

    // 根节点现在有两个子节点 → 分支 chips 出现，编号 ①②
    const chipA = screen.getByTestId(`sim-branch-${moveAId}`);
    const chipB = screen.getByTestId(`sim-branch-${moveBId}`);
    expect(chipA.textContent).toMatch(/^①/);
    expect(chipB.textContent).toMatch(/^②/);
    expect(screen.getByText(/同一局面有 2 种走法/)).toBeTruthy();

    // 点 chip A 切回第一种走法
    fireEvent.click(chipA);
    expect(useSimulationStore.getState().currentId).toBe(moveAId);
  });

  it('沿分支线继续走子后，当前分支 chip 金色高亮（仍有兄弟分支可切）', () => {
    render(<SimulationPage onBack={() => {}} />);
    playLegal(0);
    const rootId = useSimulationStore.getState().rootId;
    const moveAId = useSimulationStore.getState().currentId;
    act(() => { useSimulationStore.getState().gotoNode(rootId); });
    playLegal(1);
    const moveBId = useSimulationStore.getState().currentId;

    // 当前在分支 B：兄弟分支 chips（同一局面 2 种走法）存在
    expect(screen.getByTestId(`sim-branch-${moveAId}`)).toBeTruthy();
    expect(screen.getByTestId(`sim-branch-${moveBId}`)).toBeTruthy();
    expect(screen.getByText(/同一局面有 2 种走法/)).toBeTruthy();
  });
});

describe('功能 C：举一反三自查项', () => {
  it('保存对话框：树里有分支时显示「含 N 处变化分支」', () => {
    render(<SimulationPage onBack={() => {}} />);

    // 无分支时不应出现提示（用 testid 定位图标按钮：关闭的 MUI Dialog 在 jsdom
    // 里可能残留 DOM，aria-label 会与对话框标题「保存棋谱」撞车导致 multiple match）
    fireEvent.click(screen.getByTestId('notation-save'));
    expect(screen.queryByTestId('save-branch-info')).toBeNull();
    fireEvent.click(screen.getByText('取消'));

    // 制造一处分支（根局面两种走法）
    playLegal(0);
    act(() => { useSimulationStore.getState().gotoNode(useSimulationStore.getState().rootId); });
    playLegal(1);

    fireEvent.click(screen.getByTestId('notation-save'));
    expect(screen.getByTestId('save-branch-info').textContent).toMatch(/含 1 处变化分支/);
  });

  it('「我的棋谱」删除需二次确认：先出现确认按钮，确认后才真删', () => {
    saveNotation({ name: '测试谱', setup: '', moves: [] });
    render(<SimulationPage onBack={() => {}} />);

    fireEvent.click(screen.getByTestId('notation-open'));
    expect(screen.getByText('测试谱')).toBeTruthy();

    // 第一下只进入确认态，不真删
    fireEvent.click(screen.getByLabelText('删除测试谱'));
    expect(screen.getByText('测试谱')).toBeTruthy();
    expect(screen.getByText('确认删除？')).toBeTruthy();

    // 点确认才删除
    fireEvent.click(screen.getByTestId('notation-confirm-delete'));
    expect(screen.queryByText('测试谱')).toBeNull();
    expect(loadNotations().length).toBe(0);
  });

  it('确认前点「取消」退出确认态，棋谱不被删除', () => {
    saveNotation({ name: '别删我', setup: '', moves: [] });
    render(<SimulationPage onBack={() => {}} />);

    fireEvent.click(screen.getByTestId('notation-open'));
    fireEvent.click(screen.getByLabelText('删除别删我'));
    fireEvent.click(screen.getByText('取消'));
    expect(screen.getByText('别删我')).toBeTruthy();
    expect(screen.queryByText('确认删除？')).toBeNull();
    expect(loadNotations().length).toBe(1);
  });

  it('记谱模式页脚补充分支说明；其他来处（残局推演等）不显示', () => {
    render(<SimulationPage onBack={() => {}} />);
    expect(screen.getByText(/同一局面走出不同着法会自动记为变化/)).toBeTruthy();
  });

  it('非记谱标题（如残局推演）不显示分支说明句', () => {
    render(<SimulationPage onBack={() => {}} title="残局推演" />);
    expect(screen.queryByText(/同一局面走出不同着法会自动记为变化/)).toBeNull();
  });
});

describe('功能 D：真实点击路径的记谱回归（P1，禁止空白）', () => {
  it('tryMove(from,to) 落子节点必须带中文 notation/captured，不再存空文案', () => {
    const nodeId = clickMove(0);
    const move = useSimulationStore.getState().nodes[nodeId].move;
    expect(move).not.toBeNull();
    expect(move?.notation).toMatch(CN_NOTATION);
    expect(move?.captured).toBeNull(); // 首步无吃子，但字段已由 withMoveNotation 补齐
  });

  it('真实点击录入的主线着法按钮显示中文记谱，而不是「1. ____」', () => {
    render(<SimulationPage onBack={() => {}} />);

    const firstId = clickMove(0);
    const secondId = clickMove(0);
    const st = useSimulationStore.getState();
    expect(st.nodes[firstId].move?.notation).toMatch(CN_NOTATION);
    expect(st.nodes[secondId].move?.notation).toMatch(CN_NOTATION);

    const firstBtn = screen.getByTestId(`sim-move-${firstId}`);
    const secondBtn = screen.getByTestId(`sim-move-${secondId}`);
    expect(firstBtn.textContent?.trim()).toBe(st.nodes[firstId].move?.notation);
    expect(secondBtn.textContent?.trim()).toBe(st.nodes[secondId].move?.notation);
    expect(firstBtn.textContent).toMatch(CN_NOTATION);
    expect(secondBtn.textContent).toMatch(CN_NOTATION);
  });

  it('真实点击录入的分支 chips 在 ①/② 后显示中文着法名', () => {
    render(<SimulationPage onBack={() => {}} />);

    const firstId = clickMove(0);
    const rootId = useSimulationStore.getState().rootId;
    act(() => { useSimulationStore.getState().gotoNode(rootId); });
    const secondId = clickMove(1);
    const st = useSimulationStore.getState();
    expect(st.nodes[rootId].children).toHaveLength(2);

    const chipA = screen.getByTestId(`sim-branch-${firstId}`);
    const chipB = screen.getByTestId(`sim-branch-${secondId}`);
    expect(chipA.textContent).toMatch(/^①\s*[\u4e00-\u9fff]/);
    expect(chipB.textContent).toMatch(/^②\s*[\u4e00-\u9fff]/);
    expect(chipA.textContent).toContain(st.nodes[firstId].move?.notation ?? '');
    expect(chipB.textContent).toContain(st.nodes[secondId].move?.notation ?? '');
  });

  it('真实点击录入后保存：主线 moves 与变招 variations 都带中文记谱', () => {
    render(<SimulationPage onBack={() => {}} />);

    clickMove(0);
    const rootId = useSimulationStore.getState().rootId;
    act(() => { useSimulationStore.getState().gotoNode(rootId); });
    clickMove(1);

    fireEvent.click(screen.getByTestId('notation-save'));
    fireEvent.click(screen.getByText('保存'));

    const saved = loadNotations();
    expect(saved).toHaveLength(1);
    expect(saved[0].moves).toHaveLength(1);
    expect(saved[0].moves[0].notation).toMatch(CN_NOTATION);
    expect(saved[0].variations).toHaveLength(2);
    expect(saved[0].variations?.every((v) => CN_NOTATION.test(v.move.notation))).toBe(true);
  });
});
