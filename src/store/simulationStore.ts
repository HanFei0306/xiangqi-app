/**
 * 推演 / 模拟 store（v2026.11.21.5）。
 *
 * 一棵"变化树"：每个节点是一步棋之后的局面，节点可有多个分支（不同走法）。
 * 用途：
 *   - 双人对弈推演：双方 AI 沿当前主线自动往下走，随时暂停/接管/回退；
 *   - 自由试走：玩家在任意节点走一步，AI 立即回应，不影响正式对局；
 *   - 分支树：同一局面下的不同走法保存为不同子节点，可切换比较。
 *
 * 与 gameStore 完全隔离——推演不改变正式对局、不写战绩、不写学习数据。
 */
import { create } from 'zustand';
import type { GameState, Move, Pos } from '../engine/types';
import { createInitialState } from '../engine/board';
import type { Board as BoardModel } from '../engine/board';
import { applyMoveToState, generateLegalMoves, insufficientMaterial } from '../engine/rules';
import { moveEngine } from '../ai/activeEngine';
import { defaultConfig } from '../ai/engine';
import type { Difficulty } from '../ai/types';
import { cueFromMove } from '../audio/unifiedCue';
import { useCueDisplay } from './cueDisplayStore';
import { useSettings } from './settings';
import { judgeSimRepetition, type SimRepetition } from '../training/simRepetition';
import { withMoveNotation } from '../training/legalNotation';

export interface SimNode {
  id: number;
  parentId: number | null;
  /** The move that led from parent's state to this node's state (null at root). */
  move: Move | null;
  state: GameState;
  children: number[];
}

/** 推演提示条/演示按钮的模式：漏杀使用 mate，通用讲解使用 move。 */
export type SimHintMode = 'mate' | 'move';

/** 从结算页携带到推演页的提示选项（全部可选、默认 mate）。 */
export interface SimHintOptions {
  mode?: SimHintMode;
  move?: Move | null;
}

interface SimulationStore {
  nodes: Record<number, SimNode>;
  rootId: number;
  currentId: number;
  nextId: number;
  difficulty: Difficulty;
  /** Last AI/engine failure, surfaced in the UI if native engine is absent. */
  lastError: string | null;
  /** v21.7: 漏杀指导——正确杀着记谱，在推演页顶部提示。 */
  hintNotation: string | null;
  /** v2026.11.23.2: mate=漏杀一步杀；move=通用讲解正解着法。 */
  hintMode: SimHintMode;
  /** v2026.11.23.2: move 模式下"让 AI 演示"要播放的正解着法。 */
  hintMove: Move | null;
  /** v21.8: 长将/重复判定结果，非 none 时推演应停止。 */
  verdict: SimRepetition;
  setHint: (hint: string | null, mode?: SimHintMode, move?: Move | null) => void;
  reset: (start?: GameState, hint?: string, mode?: SimHintMode, move?: Move | null) => void;
  setDifficulty: (d: Difficulty) => void;
  gotoNode: (id: number) => void;
  undo: () => void;
  /** Play a concrete legal move from the current node; reuses an existing child on the same move. */
  playMove: (move: Move, silent?: boolean) => void;
  /** Try a click-derived move (from/to); validates legality. Returns true if applied. */
  tryMove: (from: Pos, to: Pos) => boolean;
  /** Let the engine choose and play for the side to move. fastMode caps think time for auto-play. */
  aiStep: (fastMode?: boolean) => boolean;
  /** v22.8: 异步版——搜索期间让出主线程，UI 每帧可绘制，解决"只听声不见走子"。 */
  aiStepAsync: (fastMode?: boolean) => Promise<boolean>;
  /** v22.6: 子力不足（只剩将帅士象）时标记和棋并停止推演。 */
  markInsufficientDraw: () => void;
  /** Current node (convenience selector result). */
  currentNode: () => SimNode;
  /** Path from root to current node (for the move list). */
  path: () => SimNode[];
}

function rootNode(start: GameState): SimNode {
  return { id: 0, parentId: null, move: null, state: start, children: [] };
}

function sameMove(a: Move, b: Move): boolean {
  return a.from.col === b.from.col && a.from.row === b.from.row &&
    a.to.col === b.to.col && a.to.row === b.to.row && a.piece === b.piece;
}

/**
 * v22.6 双响修复：每一步棋的音效 + 特效在这里成对发出，且只有这一个出口。
 * 此前 UI 侧监听 currentId 再次 showCue，和 store 的音效/特效形成第二份演出，
 * 回放吃子时尤其明显；现在 UI 只订阅 cue 显示，不再重复触发。
 */
let cueClearTimer: number | null = null;
function dispatchMoveCue(
  move: Move, afterStatus: GameState['status'], boardBefore: BoardModel,
  afterBoard: BoardModel,
): void {
  cueFromMove(move, afterStatus, boardBefore, 0, useSettings.getState().soundEnabled);
  useCueDisplay.getState().showCue(move, afterStatus, boardBefore, afterBoard);
  if (cueClearTimer !== null) window.clearTimeout(cueClearTimer);
  cueClearTimer = window.setTimeout(() => {
    useCueDisplay.getState().clearCue();
    cueClearTimer = null;
  }, 1300);
}

function resetMoveCue(): void {
  if (cueClearTimer !== null) {
    window.clearTimeout(cueClearTimer);
    cueClearTimer = null;
  }
  useCueDisplay.getState().clearCue();
}

/**
 * v21.8: 沿根到当前节点的主线重放，判定长将/三次重复。
 * 不依赖引擎历史（Pikafish 只收当前 FEN），是规则层的权威判定。
 */
function detectVerdict(
  nodes: Record<number, SimNode>, currentId: number, rootId: number,
): SimRepetition {
  const pathNodes: SimNode[] = [];
  let id: number | null = currentId;
  while (id !== null && nodes[id]) {
    pathNodes.unshift(nodes[id]);
    id = nodes[id].parentId;
  }
  if (pathNodes.length === 0 || pathNodes[0].id !== rootId) return 'none';
  const rootState = pathNodes[0].state;
  const moves = pathNodes.slice(1).map((n) => n.move as Move);
  const verdict = judgeSimRepetition(rootState, moves);
  if (verdict !== 'none') return verdict;
  return verdict;
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  nodes: { 0: rootNode(createInitialState('red')) },
  rootId: 0,
  currentId: 0,
  nextId: 1,
  difficulty: 'intermediate',
  lastError: null,
  hintNotation: null,
  hintMode: 'mate',
  hintMove: null,
  verdict: 'none',

  setHint: (hint, mode, move) => set({
    hintNotation: hint,
    hintMode: mode ?? 'mate',
    hintMove: move ?? null,
  }),

  reset: (start, hint, mode, move) => {
    const root = rootNode(start ?? createInitialState('red'));
    resetMoveCue(); // v22.6: 换局时清掉上一局残留的吃/将军特效
    set({
      nodes: { 0: root }, rootId: 0, currentId: 0, nextId: 1,
      lastError: null,
      hintNotation: hint ?? null,
      hintMode: mode ?? 'mate',
      hintMove: move ?? null,
      verdict: 'none',
    });
  },

  setDifficulty: (d) => set({ difficulty: d }),

  gotoNode: (id) => {
    const state = get();
    if (state.nodes[id]) set({ currentId: id, verdict: detectVerdict(state.nodes, id, state.rootId) });
  },

  undo: () => {
    const { nodes, currentId, rootId } = get();
    const node = nodes[currentId];
    if (node?.parentId !== null && node?.parentId !== undefined) {
      set({ currentId: node.parentId, verdict: detectVerdict(nodes, node.parentId, rootId) });
    }
  },

  playMove: (move, silent) => {
    const state = get();
    const cur = state.nodes[state.currentId];
    if (!cur) return;
    // 单一出口记谱归一化：棋盘点击(tryMove)、引擎(aiStep)、回放(replayTo)、
    // 提示演示等来源可能只给坐标(generateLegalMoves 的 notation 为空)。
    // 必须在 applyMoveToState 之前、用当前节点的棋盘补齐，否则棋盘已变、
    // 记谱会按错误局面生成。sameMove 只比坐标/棋子，补记谱不影响分支复用。
    const playedMove: Move = move.notation
      ? move
      : withMoveNotation(cur.state.board, move);
    // Reuse an identical existing child so branching stays clean.
    const existing = cur.children.find((id) => {
      const cm = state.nodes[id]?.move;
      return cm !== null && cm !== undefined && sameMove(cm, playedMove);
    });
    if (existing !== undefined) {
      const nodes = { ...state.nodes };
      set({ currentId: existing, verdict: detectVerdict(nodes, existing, state.rootId) });
      // v22.6: 单一出口——音效 + 特效各一次（silent 用于静默重建回放路径）。
      if (!silent) dispatchMoveCue(playedMove, state.nodes[existing].state.status, cur.state.board, state.nodes[existing].state.board);
      return;
    }
    const boardBefore = cur.state.board;
    const nextState = applyMoveToState(cur.state, playedMove);
    const id = state.nextId;
    const child: SimNode = { id, parentId: cur.id, move: playedMove, state: nextState, children: [] };
    const newNodes = {
      ...state.nodes,
      [cur.id]: { ...cur, children: [...cur.children, id] },
      [id]: child,
    };
    set({
      nodes: newNodes,
      currentId: id,
      nextId: id + 1,
      lastError: null,
      verdict: detectVerdict(newNodes, id, state.rootId),
    });
    // v22.6: 推演/记谱里每步的音效 + 艺术字特效只在这里发一次。
    if (!silent) dispatchMoveCue(playedMove, nextState.status, boardBefore, nextState.board);
  },

  tryMove: (from, to) => {
    const state = get();
    const cur = state.nodes[state.currentId];
    if (!cur) return false;
    const move = generateLegalMoves(cur.state.board, cur.state.turn)
      .find((m) => m.from.col === from.col && m.from.row === from.row && m.to.col === to.col && m.to.row === to.row);
    if (!move) return false;
    get().playMove(move);
    return true;
  },

  aiStep: (fastMode) => {
    const state = get();
    const cur = state.nodes[state.currentId];
    if (!cur) return false;
    const status = cur.state.status;
    if (status === 'checkmate' || status === 'stalemate' || status === 'draw' || status === 'perpetual') return false;
    // v22.6: 只剩将帅士象，双方都无进攻子力——直接判和并停推演，别再磨。
    if (insufficientMaterial(cur.state.board)) {
      get().markInsufficientDraw();
      return false;
    }
    // v21.8: 长将/三次重复已判定，停止自动推演（劣势方不能再赖和）。
    if (state.verdict !== 'none') return false;
    const cfg = { ...defaultConfig(state.difficulty), fastMode: !!fastMode,
      budgetMs: fastMode ? 900 : defaultConfig(state.difficulty).budgetMs };
    let move: Move | null = null;
    try { move = moveEngine.getBestMove(cur.state, cfg); } catch { move = null; }
    if (!move) {
      set({ lastError: '引擎未能给出着法（原生引擎可能不可用）' });
      return false;
    }
    get().playMove(move);
    return true;
  },

  aiStepAsync: async (fastMode) => {
    const state = get();
    const cur = state.nodes[state.currentId];
    if (!cur) return false;
    const status = cur.state.status;
    if (status === 'checkmate' || status === 'stalemate' || status === 'draw' || status === 'perpetual') return false;
    if (insufficientMaterial(cur.state.board)) {
      get().markInsufficientDraw();
      return false;
    }
    if (state.verdict !== 'none') return false;
    const cfg = { ...defaultConfig(state.difficulty), fastMode: !!fastMode,
      budgetMs: fastMode ? 900 : defaultConfig(state.difficulty).budgetMs };
    // v22.8: 搜索期间记录发起时的节点 id；异步返回后若用户已暂停/接管/回退
    // （currentId 变了），丢弃这步过期着法，避免落进错误局面。
    const issuedId = state.currentId;
    let move: Move | null = null;
    try {
      move = moveEngine.getBestMoveAsync
        ? await moveEngine.getBestMoveAsync(cur.state, cfg)
        : moveEngine.getBestMove(cur.state, cfg);
    } catch { move = null; }
    if (!move) {
      set({ lastError: '引擎未能给出着法（原生引擎可能不可用）' });
      return false;
    }
    if (get().currentId !== issuedId) return false; // 局面已变，作废
    get().playMove(move);
    return true;
  },

  markInsufficientDraw: () => set({ verdict: 'draw' }),

  currentNode: () => {
    const state = get();
    const node: SimNode | undefined = state.nodes[state.currentId] ?? state.nodes[state.rootId];
    return node;
  },

  path: () => {
    const state = get();
    const out: SimNode[] = [];
    let id: number | null = state.currentId;
    while (id !== null && state.nodes[id]) {
      const node: SimNode = state.nodes[id];
      out.unshift(node);
      id = node.parentId;
    }
    return out;
  },
}));
