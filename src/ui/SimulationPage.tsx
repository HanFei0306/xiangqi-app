/**
 * 推演 / 模拟页（v2026.11.21.5）。
 *
 * 借鉴 JJ 象棋电脑版「模拟推演」：从当前局面双方 AI 自动往下走，
 * 玩家可暂停 / 单步 / 接管走子 / 回退；每一步的不同走法保存为分支，
 * 可在「棋谱主线」里点选切换比较。完全不影响正式对局。
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, IconButton, Paper, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import UndoIcon from '@mui/icons-material/Undo';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import HomeIcon from '@mui/icons-material/Home';
import FlipIcon from '@mui/icons-material/Flip';
import { useSimulationStore, type SimHintMode, type SimNode } from '../store/simulationStore';
import { useSettings } from '../store/settings';
import { findMateInOne } from '../ai/mate';
import {
  loadNotations, saveNotation, deleteNotation, exportVariations,
  variationChildren, variationLineFrom, type SavedNotation, type VariationMove,
} from '../data/notation-storage';
import { generateLegalMoves, insufficientMaterial } from '../engine/rules';
import { legalMovesWithNotation } from '../training/legalNotation';
import { Board as BoardModel, createInitialState } from '../engine/board';
import type { Pos, GameState, Move } from '../engine/types';
import { samePos } from '../engine/types';
import { DIFFICULTY_LABELS } from './ControlPanel';
import { CALLIGRAPHY_FONT, GOLD_BUTTON_BG, BLACK_COLOR, getEnv, SKIN, SKIN_RADIUS } from './theme';
import { TacticCue } from './TacticCue';
import { HomeButton } from './HomeButton';
import { useCueDisplay } from '../store/cueDisplayStore';
import { Board } from './Board';
import type { Difficulty } from '../ai/types';

interface Props {
  onBack: () => void;
  /** v21.6: 从对局跳出时携带的当前局面；缺省则从标准开局开始。 */
  initialState?: GameState | null;
  /** v21.7: 漏杀指导的正确杀着提示。 */
  hintNotation?: string | null;
  /** v2026.11.23.2: mate=漏杀原文案；move=通用讲解正解。默认 mate。 */
  hintMode?: SimHintMode;
  /** v2026.11.23.2: move 模式下 AI 演示要播放的正解着法。 */
  hintMove?: Move | null;
  /**
   * v2026.11.23.8: 直接回主页。
   * 从对局跳进来时「返回」只能回到对局，用户会被困在"对局 ↔ 推演"之间；
   * 这里再给一个明确的回家出口。缺省不渲染，既有测试零影响。
   */
  onHome?: () => void;
  /** 顶栏标题：记谱本 / 残局推演 共用一个沙盘，标题按来处变。 */
  title?: string;
  /**
   * v2026.11.23.10: 双人手动推演模式。
   *
   * 适情雅趣等场景下用户希望「双方棋子都由我自己动，不用人机介入」。
   * 置 true 时：主控制条只保留「回退 / 重置」，并隐藏所有 AI 入口
   * （自动推演 / AI走一步 / AI档位），同时自动推演 effect 直接短路，
   * 即使 auto 残留为 true 也不会真的让引擎走子。默认 false，行为与旧版一致。
   */
  manual?: boolean;
}

// v21.7: 自动推演间隔 1600ms——太快人眼跟不上，太慢没耐心。
const TICK_MS = 1600;

/** v2026.11.26: 反转视角持久化——切页/重开 App 后保持上次的红下/黑下选择。 */
const FLIP_STORAGE_KEY = 'xiangqi-trainer:sim-flip-v1';

function readFlipPreference(): boolean {
  try { return window.localStorage.getItem(FLIP_STORAGE_KEY) === '1'; } catch { return false; }
}

/** v2026.11.26: 分支编号前缀——同一局面第 N 种走法显示为 ①②③…，超出兜底数字。 */
const BRANCH_MARKS: readonly string[] = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

/** v22.6: 回放时按坐标/棋子匹配着法（变招树与主线共用）。 */
function sameMoveCoord(a: Move, b: Move): boolean {
  return a.from.col === b.from.col && a.from.row === b.from.row
    && a.to.col === b.to.col && a.to.row === b.to.row && a.piece === b.piece;
}

/**
 * v2026.11.23.4: find the legal Move matching a recorded one. Try the side to
 * move first, then the other side so a saved position with a non-standard
 * starting turn can still be replayed (same fallback as the original doLoad).
 */
function matchReplayMove(state: GameState, recorded: Move): Move | null {
  const find = (turn: 'red' | 'black') => generateLegalMoves(state.board, turn)
    .find((m) => sameMoveCoord(m, recorded));
  return find(state.turn) ?? find(state.turn === 'red' ? 'black' : 'red') ?? null;
}

export function SimulationPage({
  onBack, initialState, hintNotation, hintMode = 'mate', hintMove = null,
  onHome, title = '记谱', manual = false,
}: Props) {
  const difficulty = useSimulationStore((s) => s.difficulty);
  const setDifficulty = useSimulationStore((s) => s.setDifficulty);
  const lastError = useSimulationStore((s) => s.lastError);
  const storeHint = useSimulationStore((s) => s.hintNotation);
  const verdict = useSimulationStore((s) => s.verdict);
  const reset = useSimulationStore((s) => s.reset);
  const undo = useSimulationStore((s) => s.undo);
  const tryMove = useSimulationStore((s) => s.tryMove);
  const aiStepAsync = useSimulationStore((s) => s.aiStepAsync);
  const path = useSimulationStore((s) => s.path);
  const currentNode = useSimulationStore((s) => s.currentNode);
  // v22.7: 必须订阅 currentId——它是走子后画面刷新的触发器。v22.6 删掉监听
  // currentId 的 showCue effect 时误删了本订阅，导致自动推演时 store 数据在走
  // （音效照响）但组件不重渲染，画面卡住；暂停触发 setAuto 才一次性刷新。
  // 这里只做订阅触发重渲染，showCue 仍在 store.playMove 单一出口，不会双响。
  const currentId = useSimulationStore((s) => s.currentId);
  void currentId;
  // v2026.11.26: 棋谱主线面板需要读整棵树（兄弟分支 / 子分支 chips）。
  const nodes = useSimulationStore((s) => s.nodes);
  const gotoNode = useSimulationStore((s) => s.gotoNode);

  const boardTheme = useSettings((s) => s.boardTheme);
  const effects = useSettings((s) => s.effects);

  // v2026.11.26: 反转棋盘视角（红下 ↔ 黑下）。初始化读 localStorage，异常容错回 false。
  const [flipped, setFlipped] = useState<boolean>(readFlipPreference);
  useEffect(() => {
    try { window.localStorage.setItem(FLIP_STORAGE_KEY, flipped ? '1' : '0'); } catch { /* 忽略 */ }
  }, [flipped]);

  const [auto, setAuto] = useState(false);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [legalTargets, setLegalTargets] = useState<Pos[]>([]);
  // 记谱本 UI 状态
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [notations, setNotations] = useState<SavedNotation[]>(() => loadNotations());
  // v21.8 棋谱回放：加载棋谱后按记录着法逐步演示（非 AI 走子）。
  const [playbackMoves, setPlaybackMoves] = useState<Move[] | null>(null);
  const [playbackIdx, setPlaybackIdx] = useState(0);
  const [playbackOn, setPlaybackOn] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  // v22.6: 变招回放——保留整棵变招树、起始局面，以及已走节点在树中的下标路径。
  const [playbackVariations, setPlaybackVariations] = useState<VariationMove[] | null>(null);
  const [playbackStartState, setPlaybackStartState] = useState<GameState | null>(null);
  const [playbackPath, setPlaybackPath] = useState<number[]>([]);
  // v21.9: 特效显示只订阅；v22.6 触发已统一收敛到 simulationStore.playMove。
  const cue = useCueDisplay((s) => s.cue);
  // v2026.11.26: 棋谱主线面板着法区的滚动容器，走子后自动滚到当前着法。
  const moveListRef = useRef<HTMLDivElement | null>(null);
  // v2026.11.26: 「我的棋谱」删除二次确认——正在确认删除的棋谱 id（防误删）。
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // 进入页面时，用传入的局面（对局当前局面）或标准开局重建推演树。
  useEffect(() => {
    reset(initialState ?? undefined, hintNotation ?? undefined, hintMode, hintMove ?? undefined);
    setAuto(false);
    setSelected(null);
    setLegalTargets([]);
    setPlaybackMoves(null);
    setPlaybackOn(false);
    setPlaybackIdx(0);
    setPlaybackError(null);
    setPlaybackVariations(null);
    setPlaybackStartState(null);
    setPlaybackPath([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialState, hintNotation, hintMode, hintMove]);

  const node = currentNode();
  const line = path();
  const status = node.state.status;
  // v22.6: 只剩将帅士象也算终局，自动推演与点击都要停。
  const noMaterial = insufficientMaterial(node.state.board);
  const terminal = status === 'checkmate' || status === 'stalemate' || status === 'draw'
    || status === 'perpetual' || noMaterial;

  // v2026.11.23.4: 推演到终局不再自动弹保存框。收藏改为玩家主动操作
  // （右上角保存图标 / 对局复盘菜单的「收藏棋谱」）。

  // v22.6: 吃/将军/绝杀艺术字与音效已在 simulationStore.playMove 内成对发出，
  // 这里不再监听 currentId 重复 showCue（此前吃子出现双份特效/双响的根因）。

  // 自动推演：双方 AI 交替往下走，到终局自动停止。玩家点棋盘会暂停并接管。
  useEffect(() => {
    // v2026.11.23.10: 双人手动模式下永不自动走子——即使 auto 因切换残留为 true，
    // 也不能把局面交给引擎，否则用户「双方都由我自己动」的诉求会被打破。
    if (manual) return;
    if (!auto || terminal || playbackOn) return;
    let cancelled = false;
    let timer = 0;
    // v21.7: 链式调度——走完一步再排下一步，绝不堆积；fastMode 限制单步思考
    // 时间，避免大师档 9 秒阻塞导致"两步齐走"和卡死。
    const step = async () => {
      if (cancelled) return;
      const store = useSimulationStore.getState();
      const n = store.currentNode();
      const st = n.state.status;
      if (st === 'checkmate' || st === 'stalemate' || st === 'draw' || st === 'perpetual') {
        setAuto(false);
        return;
      }
      // v22.6: 自动推演中走到只剩将帅士象的局面，也要立刻判和并停住。
      if (insufficientMaterial(n.state.board)) {
        store.markInsufficientDraw();
        setAuto(false);
        return;
      }
      // v22.8: 用异步搜索——每搜一个根着让出一帧，UI 能实时绘制棋子，
      // 根治此前同步搜索阻塞主线程导致"只听声不见走子/暂停才刷新"。
      const ok = await store.aiStepAsync(true);
      if (cancelled) return;
      if (!ok) { setAuto(false); return; }
      timer = window.setTimeout(step, TICK_MS);
    };
    timer = window.setTimeout(step, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [auto, terminal, manual]);

  const onSquareClick = (col: number, row: number) => {
    const pos: Pos = { col, row };
    const piece = node.state.board.getPiece(pos);
    if (selected) {
      if (legalTargets.some((t) => samePos(t, pos))) {
        setAuto(false); // 玩家接管即暂停自动推演
        tryMove(selected, pos);
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      if (piece && piece.side === node.state.turn) {
        setSelected(pos);
        setLegalTargets(generateLegalMoves(node.state.board, node.state.turn)
          .filter((m) => samePos(m.from, pos)).map((m) => m.to));
      } else { setSelected(null); setLegalTargets([]); }
      return;
    }
    if (piece && piece.side === node.state.turn) {
      setSelected(pos);
      setLegalTargets(generateLegalMoves(node.state.board, node.state.turn)
        .filter((m) => samePos(m.from, pos)).map((m) => m.to));
    }
  };

  /**
   * v2026.11.23.10: 「重置」必须回到**本次会话的根局面**，而不是标准开局。
   *
   * 此前这里是无参调用 `reset()`，store 会回落到 `createInitialState('red')`，
   * 于是残局推演到一半点重置 → 棋盘被摆成 32 子开局，用户「重新推演残局」的
   * 意图被破坏（用户报的 P0 bug）。
   *
   * 根局面优先级：
   *   1. 已加载过棋谱回放 → 回到回放起始局面，重播仍可继续；
   *   2. 否则回到进入页面时传入的 initialState（残局起点）；
   *   3. 两者都为空（记谱模式从主页直接进来）才允许回落到标准开局。
   *
   * hint 参数按挂载时同样的口径回传，否则一重置漏杀/讲解提示卡就消失。
   */
  const handleReset = (): void => {
    setAuto(false);
    const root: GameState | undefined = playbackStartState ?? initialState ?? undefined;
    reset(root, hintNotation ?? undefined, hintMode, hintMove ?? undefined);
    // 回到根局面后，回放进度指针也归零，点「重播/下一步」可从第一步继续。
    if (playbackStartState) {
      setPlaybackIdx(0);
      setPlaybackPath([]);
      setPlaybackError(null);
    }
    setSelected(null);
    setLegalTargets([]);
  };

  const lastMove = node.move ? { from: node.move.from, to: node.move.to } : null;
  // 保存当前主线为棋谱（名称由用户输入）。
  const doSave = () => {
    const moves = line.filter((n) => n.move !== null).map((n) => n.move as NonNullable<typeof n.move>);
    if (moves.length === 0) return;
    const rootState = line[0]?.state;
    const setup = rootState ? rootState.board.toNotationSetup() : '';
    // v22.6: 导出整棵变化树（含当前主线之外的变招），老棋谱无此字段仍可回放。
    const st = useSimulationStore.getState();
    const variations = exportVariations(st.nodes, st.rootId, line.map((n) => n.id));
    const name = saveName.trim() || `棋谱 ${new Date().toLocaleString('zh-CN')}`;
    setNotations(saveNotation({ name, setup, moves, variations }));
    setSaveName('');
    setSaveOpen(false);
  };

  // 加载一个已存棋谱：从起始局面逐步回放整局（带头像/音效），不是直接跳到末局面。
  const doLoad = (n: SavedNotation) => {
    setAuto(false);
    setListOpen(false);
    setSelected(null);
    setLegalTargets([]);
    // v22.4 BUGFIX: 棋谱的 setup 由 toNotationSetup() 生成（"col,row,type,side;..."），
    // 必须用 fromSetup() 反序列化。此前误用 fromNotationSetup()（期望"行/行/行"字符格式），
    // 导致棋盘恢复成空、所有着法匹配失败——用户看到的就是"棋谱打不开/回放不动"。
    const startBoard = n.setup ? BoardModel.fromSetup(n.setup) : createInitialState('red').board;
    const startState: GameState = { board: startBoard, turn: 'red', history: [], status: 'playing', moveCount: 0 };
    reset(startState);
    setPlaybackMoves(n.moves);
    setPlaybackIdx(0);
    setPlaybackError(null);
    // v22.6: 有变招树时保留下来，供棋盘下方的分支切换 UI 使用。
    setPlaybackVariations(n.variations && n.variations.length > 0 ? n.variations : null);
    setPlaybackStartState(startState);
    setPlaybackPath([]);
    setPlaybackOn(true);
  };

  /**
   * v2026.11.23.4: 把沙盘静默重建到一条回放线的第 targetPly 步。
   *
   * 不变量：`playbackMoves` 始终是从起始局面到该分支末尾的**完整**着法线，
   * `playbackIdx` 是已走的步数。因此「重播 / 上一步 / 下一步 / 切变招」全部
   * 复用这一个函数，不会再出现走到末尾只能退出重开的情况。
   * 除最后一步（前进单步时）外全部静默重建，音效/特效仍由 store.playMove
   * 单一出口发出；变招路径按 variationChildren 逐层匹配，不走数组裸下标。
   */
  const replayTo = (
    line: readonly Move[],
    targetPly: number,
    options: { auto?: boolean; cueLast?: boolean } = {},
  ): boolean => {
    if (!playbackStartState) return false;
    const target: number = Math.max(0, Math.min(targetPly, line.length));
    setAuto(false);
    setPlaybackOn(options.auto ?? false);
    setPlaybackError(null);
    useSimulationStore.getState().reset(playbackStartState);
    const path: number[] = [];
    for (let i = 0; i < target; i++) {
      const current = useSimulationStore.getState().currentNode().state;
      const legal = matchReplayMove(current, line[i]);
      if (!legal) {
        setPlaybackError(`第 ${i + 1} 步无法在棋盘上重现，已停止`);
        setPlaybackIdx(i);
        setPlaybackPath(path);
        return false;
      }
      // 单步前进让最新一步照常发声/出特效；其余历史步骤静默重建。
      useSimulationStore.getState().playMove(legal, !(options.cueLast === true && i === target - 1));
      if (playbackVariations) {
        const parent: number = path.length > 0 ? path[path.length - 1] : -1;
        const found: number | undefined = variationChildren(playbackVariations, parent)
          .find((idx: number) => sameMoveCoord(playbackVariations[idx].move, legal));
        if (found !== undefined) path.push(found);
      }
    }
    setPlaybackIdx(target);
    setPlaybackPath(path);
    return true;
  };

  /** 从头再看一遍：回到起始局面并自动播放整条主线。 */
  const replayFromStart = (): void => {
    if (playbackMoves) replayTo(playbackMoves, 0, { auto: true });
  };

  /** 手动后退一步：静默重建，不重复发声。 */
  const playbackPrev = (): void => {
    if (playbackMoves) replayTo(playbackMoves, playbackIdx - 1);
  };

  /** 手动前进一步：最新一步保留回放的音效/特效语义。 */
  const playbackNext = (): void => {
    if (playbackMoves) replayTo(playbackMoves, playbackIdx + 1, { cueLast: true });
  };

  /** 退出回放：清空所有回放态，避免残留变招按钮/进度文字。 */
  const exitPlayback = (): void => {
    setPlaybackOn(false);
    setPlaybackMoves(null);
    setPlaybackIdx(0);
    setPlaybackError(null);
    setPlaybackVariations(null);
    setPlaybackStartState(null);
    setPlaybackPath([]);
  };

  // 棋谱回放调度：每 TICK_MS 走一步（按记录着法），到末自动停。
  useEffect(() => {
    if (!playbackOn || !playbackMoves) return;
    if (playbackIdx >= playbackMoves.length) { setPlaybackOn(false); return; }
    let cancelled = false;
    let timer = 0;
    timer = window.setTimeout(() => {
      if (cancelled) return;
      const mv = playbackMoves[playbackIdx];
      const st = useSimulationStore.getState();
      const cur = st.currentNode();
      const matches = (turn: 'red' | 'black') => generateLegalMoves(cur.state.board, turn)
        .find((m) => m.from.col === mv.from.col && m.from.row === mv.from.row
          && m.to.col === mv.to.col && m.to.row === mv.to.row);
      // v22.4: 先按当前走子方匹配；若棋谱起始轮次与局面不符（如从黑先局面保存），
      // 再试对方走子方，避免第一步匹配不到导致整局回放"卡住打不开"。
      const legal = matches(cur.state.turn) ?? matches(cur.state.turn === 'red' ? 'black' : 'red');
      if (legal) {
        // v22.6: store 内已保证「一次音效 + 一次特效」，此处不再另行派发。
        st.playMove(legal);
        // 记录这一步在变招树中的下标，供分支按钮定位"当前局面"。
        if (playbackVariations) {
          setPlaybackPath((prev) => {
            const parent: number = prev.length > 0 ? prev[prev.length - 1] : -1;
            const found: number | undefined = variationChildren(playbackVariations, parent)
              .find((i: number) => sameMoveCoord(playbackVariations[i].move, legal));
            return found === undefined ? prev : [...prev, found];
          });
        }
      } else setPlaybackError(`第 ${playbackIdx + 1} 步无法在棋盘上重现，已跳过`);
      setPlaybackIdx((i) => i + 1);
    }, playbackIdx === 0 ? 300 : TICK_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [playbackOn, playbackMoves, playbackIdx, playbackVariations]);

  // v22.6: 当前所在局面在变招树中的下标（-1 = 根），有多个子招就展示变招按钮。
  const currentVarIndex: number = playbackPath.length > 0 ? playbackPath[playbackPath.length - 1] : -1;
  const branchIndices: number[] = playbackVariations
    ? variationChildren(playbackVariations, currentVarIndex) : [];
  // 走到末尾时自动播放按钮变成「重播」，绝不再消失或禁用。
  const playbackAtEnd: boolean = playbackMoves !== null && playbackIdx >= playbackMoves.length;

  /* ------------------------------------------------------------------ *
   * v2026.11.26 棋谱主线面板（仅非回放时渲染）：
   *   - 主线着法（path 跳过根）成对显示「回合号. 红着 黑着」，点击跳转；
   *   - 当前节点有兄弟分支（父局面试过多种走法）或有多个子节点时，
   *     显示 ①②③… 分支 chips，点击 gotoNode 切换走势；
   *   - gotoNode 回中后走出不同着法，store.playMove 自动追加子节点，
     面板随 nodes/currentId 刷新即见新 chip，无需额外逻辑。
   * ------------------------------------------------------------------ */
  const mainlineMoves: SimNode[] = line.filter((n) => n.move !== null);
  const parentNode: SimNode | null = node.parentId !== null ? (nodes[node.parentId] ?? null) : null;
  const siblingIds: number[] = parentNode ? parentNode.children : [];
  const childIds: number[] = node.children;
  // 保存对话框：树里有多少处「一个局面走了多种走法」的分支点。
  const branchCount: number = Object.values(nodes).filter((n) => n.children.length > 1).length;

  // 当前着法变化时把列表滚到可见位置（jsdom 无 scrollIntoView，运行时守卫）。
  useEffect(() => {
    const c = moveListRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>(`[data-testid="sim-move-${currentId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [currentId, playbackMoves]);

  /** 主线着法成对渲染：奇数着（红先局面下第 1、3、5…手）为红着，偶数为黑着。 */
  const renderMainlineRows = (moves: SimNode[]): JSX.Element[] => {
    const rows: JSX.Element[] = [];
    for (let i = 0; i < moves.length; i += 2) {
      const round = Math.floor(i / 2) + 1;
      const pair = [moves[i], moves[i + 1]];
      rows.push(
        <Box key={moves[i].id} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Typography sx={{ color: SKIN.textMuted, fontSize: 11.5, width: 24, flexShrink: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{round}.</Typography>
          {pair.map((n, j) => (n ? (
            <Button key={n.id} data-testid={`sim-move-${n.id}`} size="small"
              onClick={() => gotoNode(n.id)}
              sx={{
                flex: 1, justifyContent: 'flex-start', textTransform: 'none', minWidth: 0,
                px: 0.6, py: 0.15, borderRadius: 1, fontSize: 12,
                color: n.id === node.id ? SKIN.gold : SKIN.text,
                border: n.id === node.id ? `1px solid ${SKIN.gold}` : '1px solid transparent',
              }}>
              {n.move?.notation ?? ''}
            </Button>
          ) : (
            <Box key={`filler-${j}`} sx={{ flex: 1 }} />
          )))}
        </Box>,
      );
    }
    return rows;
  };

  /** 分支 chips：同一局面的多种走法，编号 ①②③…，当前所在分支金色高亮。 */
  const renderBranchChips = (ids: number[], title: string): JSX.Element | null => {
    if (ids.length <= 1) return null;
    return (
      <Box sx={{ mt: 0.5 }}>
        <Typography sx={{ color: SKIN.textSecondary, fontSize: 11 }}>{title}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.4 }}>
          {ids.map((cid, i) => {
            const child = nodes[cid];
            const active = cid === node.id;
            const mark = BRANCH_MARKS[i] ?? String(i + 1);
            return (
              <Button key={cid} data-testid={`sim-branch-${cid}`} size="small" variant="outlined"
                onClick={() => gotoNode(cid)}
                sx={{
                  color: active ? SKIN.gold : SKIN.text,
                  borderColor: active ? SKIN.gold : SKIN.border,
                  fontSize: 11.5, px: 1, py: 0.2, minWidth: 0,
                }}>
                {`${mark} ${child?.move?.notation ?? ''}`}
              </Button>
            );
          })}
        </Box>
      </Box>
    );
  };


  /**
   * v22.6 / v2026.11.23.4: 切到指定变招——先按 playbackPath 静默重建到分叉局面，
   * 再把「祖先着法 + 新分支」合成一条完整回放线，从分支第一着继续自动播放。
   * 始终沿变招树走，不能用 playbackMoves 的裸数组下标，否则分支会错乱。
   */
  const switchVariation = (childIndex: number): void => {
    if (!playbackVariations || !playbackStartState) return;
    const ancestorMoves: Move[] = playbackPath
      .map((idx: number) => playbackVariations[idx]?.move)
      .filter((move): move is Move => Boolean(move));
    const continueLine: Move[] = variationLineFrom(playbackVariations, childIndex);
    if (continueLine.length === 0) return;
    const fullLine: Move[] = [...ancestorMoves, ...continueLine];
    setPlaybackMoves(fullLine);
    replayTo(fullLine, ancestorMoves.length, { auto: true });
  };

  return (
    <Box sx={{
      minHeight: '100dvh', background: getEnv(boardTheme).matchBg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', py: 0.8, px: 1, boxSizing: 'border-box', width: '100%', overflowX: 'hidden',
    }}>
      <Box sx={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 0.7, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
          {/* v2026.11.23.8: 左上角固定「主页」出口；没传 onHome 时保留占位保持标题居中。 */}
          {onHome
            ? <HomeButton onClick={onHome} tone="dark" size="sm" testId="sim-home" />
            : <Box sx={{ width: 44 }} />}
          <Typography sx={{
            flex: 1, textAlign: 'center', color: SKIN.gold, fontFamily: CALLIGRAPHY_FONT,
            fontWeight: 800, fontSize: 16, letterSpacing: '0.1em', whiteSpace: 'nowrap',
          }}>
            {title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0 }}>
            <IconButton size="small" data-testid="notation-open" onClick={() => setListOpen(true)} aria-label="查看棋谱" sx={{ color: SKIN.gold }}>
              <FolderOpenIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" data-testid="notation-save" onClick={() => setSaveOpen(true)} aria-label="保存棋谱" sx={{ color: SKIN.gold }}>
              <SaveIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', position: 'relative' }}>
          <TacticCue cue={cue} />
          <Board
            board={node.state.board}
            selected={selected}
            legalTargets={legalTargets}
            lastMove={lastMove}
            hint={null}
            status={terminal ? undefined : node.state.status}
            boardThemeId={boardTheme}
            effects={effects}
            interactive={!terminal}
            flipped={flipped}
            onSquareClick={onSquareClick}
          />
        </Box>

        {(verdict !== 'none' || noMaterial) && (
          <Paper elevation={1} sx={{ p: 1, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid rgba(242,164,140,0.45)`, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
            <Typography sx={{ color: SKIN.danger, fontSize: 12.5, textAlign: 'center' }}>
              {verdict === 'red-loses' ? '红方单方长将，按规则判负（黑方胜）'
                : verdict === 'black-loses' ? '黑方单方长将，按规则判负（红方胜）'
                  : noMaterial ? '双方只剩将帅士象，子力不足判和'
                    : '三次重复局面，双方均无长将，按规则判和'}。
              {noMaterial ? '推演已停止——双方都无法将死对方。'
                : verdict === 'red-loses' || verdict === 'black-loses'
                  ? '推演已停止——单方长将赖和行不通，长将方判负。'
                  : '推演已停止——双方局面三次重复且无单方长将，判和。'}
            </Typography>
          </Paper>
        )}
        {storeHint && (
          <Paper elevation={1} sx={{ p: 1, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid ${SKIN.border}`, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
            <Typography sx={{ color: SKIN.gold, fontSize: 12.5, textAlign: 'center' }}>
              {hintMode === 'move' ? (
                `讲解指导：这一手建议走「${storeHint ?? ''}」。你可以自己试走，或让 AI 演示。`
              ) : (
                <>漏杀指导：这一手可以走「{storeHint}」形成一步杀。你先在棋盘上试着走出来，或让 AI 演示最优解。</>
              )}
            </Typography>
            <Button data-testid="show-best" size="small" fullWidth sx={{ color: SKIN.text, borderColor: SKIN.border, fontSize: 12, mt: 0.6 }}
              variant="outlined"
              onClick={() => {
                const st = useSimulationStore.getState();
                const root = st.nodes[st.rootId];
                if (!root) return;
                setAuto(false);
                if (hintMode === 'move') {
                  // 通用讲解：只播放传入的正解着法，绝不调用 findMateInOne。
                  const legal: Move[] = legalMovesWithNotation(root.state);
                  const preferred: Move | null = hintMove ?? useSimulationStore.getState().hintMove ?? null;
                  let move: Move | null = preferred
                    ? legal.find((m) => sameMoveCoord(m, preferred)) ?? null : null;
                  if (!move && storeHint) {
                    move = legal.find((m) => m.notation === storeHint) ?? null;
                  }
                  reset(root.state, storeHint ?? undefined, 'move', move ?? undefined);
                  if (!move) {
                    useSimulationStore.setState({
                      lastError: `讲解正解「${storeHint ?? '未知着法'}」在当前局面无法匹配，请检查记谱。`,
                    });
                    return;
                  }
                  setTimeout(() => useSimulationStore.getState().playMove(move), 50);
                  return;
                }
                reset(root.state, storeHint); // 回到漏杀前的局面
                const killer = findMateInOne(root.state, root.state.turn);
                if (killer) setTimeout(() => useSimulationStore.getState().playMove(killer), 50);
              }}>
              让 AI 演示最优解（{storeHint}）
            </Button>
          </Paper>
        )}
        {lastError && <Typography sx={{ color: SKIN.danger, fontSize: 12, textAlign: 'center' }}>{lastError}</Typography>}

        {/* v2026.11.23.9: 双人手动模式的说明行——告知双方都由玩家自己走子。 */}
        {manual && (
          <Typography data-testid="sim-manual-tip"
            sx={{ color: SKIN.textSecondary, fontSize: 11.5, textAlign: 'center', lineHeight: 1.5 }}>
            双人推演 · 红黑双方都由你走子，点「回退」或「重置」随时重来
          </Typography>
        )}

        {/* 主控制条：manual 模式只保留「回退 / 重置 / 反转」，隐藏全部 AI 入口。
            v2026.11.26: 新增「反转」——翻转棋盘视角（红下↔黑下），所有模式可用。 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: manual ? 'repeat(3, minmax(0,1fr))' : 'repeat(6, minmax(0,1fr))', gap: 0.5, p: 0.6, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid ${SKIN.border}` }}>
          {!manual && (
            <Button onClick={() => { if (auto) setAuto(false); else setAuto(true); }} disabled={terminal}
              sx={{ color: auto ? SKIN.gold : SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6 }}>
              {auto ? <PauseIcon sx={{ fontSize: 19 }} /> : <PlayArrowIcon sx={{ fontSize: 19 }} />}
              <Typography sx={{ fontSize: 11 }}>{auto ? '暂停' : '自动推演'}</Typography>
            </Button>
          )}
          {!manual && (
            <Button onClick={() => { setAuto(false); void aiStepAsync(true); }} disabled={terminal}
              sx={{ color: SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6 }}>
              <SkipNextIcon sx={{ fontSize: 19 }} />
              <Typography sx={{ fontSize: 11 }}>AI走一步</Typography>
            </Button>
          )}
          <Button onClick={() => { setAuto(false); undo(); }} disabled={node.parentId === null}
            sx={{ color: SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6 }}>
            <UndoIcon sx={{ fontSize: 19 }} />
            <Typography sx={{ fontSize: 11 }}>回退</Typography>
          </Button>
          <Button data-testid="sim-reset" onClick={handleReset}
            sx={{ color: SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6 }}>
            <RestartAltIcon sx={{ fontSize: 19 }} />
            <Typography sx={{ fontSize: 11 }}>重置</Typography>
          </Button>
          {/* v2026.11.26: 反转视角——黑方在下（激活）时按钮高亮金色。 */}
          <Button data-testid="sim-flip" onClick={() => setFlipped((f) => !f)}
            sx={{ color: flipped ? SKIN.gold : SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6 }}>
            <FlipIcon sx={{ fontSize: 19 }} />
            <Typography sx={{ fontSize: 11 }}>反转</Typography>
          </Button>
          {!manual && (
            <Button onClick={() => setDifficulty(((['beginner','easy','intermediate','master'] as Difficulty[])[((['beginner','easy','intermediate','master'] as Difficulty[]).indexOf(difficulty) + 1) % 4]))}
              sx={{ color: SKIN.gold, flexDirection: 'column', minWidth: 0, py: 0.6 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{DIFFICULTY_LABELS[difficulty]}</Typography>
              <Typography sx={{ fontSize: 11 }}>AI档位</Typography>
            </Button>
          )}
        </Box>

        {/* v2026.11.26 棋谱主线面板：录入时实时可见主线 + 分支切换。
            回放模式（playbackMoves 非空）保留原回放控制条与变招按钮，不双份。 */}
        {!playbackMoves && (
          <Box data-testid="sim-movelist" sx={{ p: 0.8, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid ${SKIN.border}` }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
              <Typography sx={{ color: SKIN.gold, fontSize: 12, fontWeight: 700 }}>棋谱主线 · 第 {mainlineMoves.length} 步</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', background: node.state.turn === 'red' ? SKIN.danger : BLACK_COLOR }} />
                <Typography data-testid="sim-turn" sx={{ color: SKIN.text, fontSize: 11 }}>
                  轮到：{node.state.turn === 'red' ? '红方' : '黑方'}
                </Typography>
              </Box>
            </Box>
            {mainlineMoves.length === 0 ? (
              <Typography sx={{ color: SKIN.textMuted, fontSize: 11.5, textAlign: 'center', py: 1 }}>
                还没有着法——在棋盘上走出第一步
              </Typography>
            ) : (
              <Box ref={moveListRef} sx={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25, mt: 0.5 }}>
                {renderMainlineRows(mainlineMoves)}
              </Box>
            )}
            {renderBranchChips(siblingIds, `同一局面有 ${siblingIds.length} 种走法，点击切换`)}
            {renderBranchChips(childIds, `这个局面有 ${childIds.length} 种后续走法`)}
          </Box>
        )}

        {/* v21.8 / v2026.11.23.4 棋谱回放控制条：重播 / 上一步 / 下一步 / 自动播放 / 退出 */}
        {playbackError && (
          <Typography sx={{ color: SKIN.danger, fontSize: 12, textAlign: 'center' }}>{playbackError}</Typography>
        )}
        {playbackMoves && (
          <Box sx={{ p: 0.6, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid ${SKIN.border}` }}>
            <Typography sx={{ color: SKIN.text, fontSize: 12, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
              回放 {Math.min(playbackIdx, playbackMoves.length)}/{playbackMoves.length}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 0.5, mt: 0.5 }}>
              <Button size="small" data-testid="replay-restart" onClick={replayFromStart}
                sx={{ color: SKIN.gold, minWidth: 0, fontSize: 11.5, px: 0.2 }}>⟲重播</Button>
              <Button size="small" data-testid="replay-prev" onClick={playbackPrev} disabled={playbackIdx === 0}
                sx={{ color: SKIN.text, minWidth: 0, fontSize: 11.5, px: 0.2 }}>‹上一步</Button>
              <Button size="small" data-testid="replay-next" onClick={playbackNext} disabled={playbackAtEnd}
                sx={{ color: SKIN.text, minWidth: 0, fontSize: 11.5, px: 0.2 }}>下一步›</Button>
              <Button size="small" data-testid="replay-toggle" onClick={playbackAtEnd ? replayFromStart : () => setPlaybackOn(!playbackOn)}
                sx={{ color: SKIN.gold, minWidth: 0, fontSize: 11.5, px: 0.2 }}>
                {playbackAtEnd ? '▶重播' : playbackOn ? '⏸暂停' : '▶自动播放'}
              </Button>
              <Button size="small" data-testid="replay-exit" onClick={exitPlayback}
                sx={{ color: SKIN.text, minWidth: 0, fontSize: 11.5, px: 0.2 }}>退出回放</Button>
            </Box>
          </Box>
        )}

        {/* v22.6 变招切换：当前局面有两个以上走法时列出各分支第一着，点击继续回放该变招 */}
        {playbackMoves && branchIndices.length > 1 && playbackVariations && (
          <Paper elevation={1} sx={{ p: 0.8, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid ${SKIN.border}` }}>
            <Typography sx={{ color: SKIN.gold, fontSize: 11.5, textAlign: 'center', mb: 0.5 }}>
              这个局面还有 {branchIndices.length} 种走法，点击变招继续回放：
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'center' }}>
              {branchIndices.map((idx: number) => (
                <Button key={`var${idx}`} data-testid={`variation-${idx}`} size="small" variant="outlined"
                  onClick={() => switchVariation(idx)}
                  sx={{ color: SKIN.text, borderColor: SKIN.border, fontSize: 11.5, px: 1, minWidth: 0 }}>
                  {playbackVariations[idx].move.notation || '变招'}
                </Button>
              ))}
            </Box>
          </Paper>
        )}

        <Typography sx={{ color: SKIN.textMuted, fontSize: 11.5, textAlign: 'center', lineHeight: 1.6 }}>
          这是与当前棋子摆放一致的独立沙盘：你控制双方棋子随意推演，不必心算；也可自动推演。推演不影响正式对局与战绩。
          {/* v2026.11.26: 记谱模式下补一句分支说明——用户此前不知道同一局面可走多种变化。 */}
          {title === '记谱' && '同一局面走出不同着法会自动记为变化 ①②③…，点着法可回跳。'}
          {terminal && <Box component="span" sx={{ color: SKIN.gold }}> · 本局已终局</Box>}
        </Typography>
        {/* v22.4: 返回按钮移到右下角，单手更好操作 */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', width: '100%', mt: 0.3 }}>
          <Button data-testid="sim-back" onClick={onBack} variant="contained"
            startIcon={<HomeIcon sx={{ fontSize: 18 }} />}
            sx={{ color: SKIN.ink, background: GOLD_BUTTON_BG, fontFamily: CALLIGRAPHY_FONT, fontWeight: 800, borderRadius: SKIN_RADIUS, px: 2, py: 0.6, boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>
            返回
          </Button>
        </Box>
      </Box>

      {/* 保存棋谱对话框 */}
      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        maxWidth="xs"
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            background: SKIN.surfaceStrong,
            border: `1px solid ${SKIN.border}`,
          },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: SKIN.border },
          '& .MuiButton-text': { color: SKIN.gold },
        }}
      >
        <DialogTitle sx={{ fontFamily: CALLIGRAPHY_FONT }}>保存棋谱</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            将当前主线（{Math.max(0, line.length - 1)} 步）及所有变招保存到记谱本，随时可查看回放。
          </Typography>
          {/* v2026.11.26: 树里有分支时明确告知变招会被一起保存，避免「我的变化怎么没了」。 */}
          {branchCount > 0 && (
            <Typography data-testid="save-branch-info" variant="body2" sx={{ color: SKIN.gold, mb: 1.5 }}>
              含 {branchCount} 处变化分支，保存后回放时可切换比较。
            </Typography>
          )}
          <TextField
            autoFocus fullWidth size="small" label="棋谱名称"
            value={saveName} onChange={(e) => setSaveName(e.target.value)}
            placeholder={`棋谱 ${new Date().toLocaleDateString('zh-CN')}`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveOpen(false)}>取消</Button>
          <Button variant="contained" onClick={doSave} disabled={line.length < 2}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 查看棋谱对话框 */}
      <Dialog
        open={listOpen}
        onClose={() => setListOpen(false)}
        maxWidth="xs"
        fullWidth
        sx={{
          '& .MuiDialog-paper': {
            background: SKIN.surfaceStrong,
            border: `1px solid ${SKIN.border}`,
          },
          '& .MuiButton-text': { color: SKIN.gold },
          '& .MuiOutlinedInput-notchedOutline': { borderColor: SKIN.border },
        }}
      >
        <DialogTitle sx={{ fontFamily: CALLIGRAPHY_FONT }}>
          我的棋谱（{notations.length}）
        </DialogTitle>
        <DialogContent dividers>
          {notations.length === 0 ? (
            <Typography variant="body2" color="text.secondary">还没有保存棋谱。推演出精彩对局后点右上角的保存图标。</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {notations.map((n) => (
                <Box key={n.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '0.5px solid', borderColor: 'divider', borderRadius: 2 }}>
                  <Button size="small" onClick={() => doLoad(n)} sx={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left' }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>{n.name}</Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                        {n.moves.length} 步{n.variations && n.variations.length > n.moves.length
                          ? ` · ${n.variations.length - n.moves.length} 变招` : ''} · {new Date(n.createdAt).toLocaleDateString('zh-CN')}
                      </Typography>
                    </Box>
                  </Button>
                  {/* v2026.11.26: 删除不再一键直删——先就地二次确认，防误删。 */}
                  {confirmDeleteId === n.id ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography sx={{ fontSize: 11, color: SKIN.danger, whiteSpace: 'nowrap' }}>确认删除？</Typography>
                      <Button size="small" data-testid="notation-confirm-delete" variant="outlined"
                        onClick={() => { setNotations(deleteNotation(n.id)); setConfirmDeleteId(null); }}
                        sx={{ color: SKIN.danger, borderColor: SKIN.danger, minWidth: 0, px: 0.8, fontSize: 11.5 }}>
                        删除
                      </Button>
                      <Button size="small" onClick={() => setConfirmDeleteId(null)}
                        sx={{ color: SKIN.text, minWidth: 0, px: 0.8, fontSize: 11.5 }}>
                        取消
                      </Button>
                    </Box>
                  ) : (
                    <IconButton size="small" aria-label={`删除${n.name}`} onClick={() => setConfirmDeleteId(n.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setListOpen(false)}>关闭</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
