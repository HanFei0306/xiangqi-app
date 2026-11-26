/**
 * 《适情雅趣》残局练习页（Task #5）。
 *
 * 三个能力：
 * 1. 完整 548 局列表——严格按原版局号 order 升序，分页展示（每页 50 局），
 *    支持按局号 / 局名搜索，并可用「上一局 / 下一局」连续翻阅。
 * 2. 自由试走推演——玩家执红，走对正解红着后黑方按 solution 自动应手
 *    （300ms 延时让落子动画可见）；走错只给温和提示，不判负、不锁死。
 * 3. 连续点提示——每次点击推进半回合：先高亮下一着，再走出该着并高亮
 *    下一着，直到走完整个 solution 显示「解法演示完毕」。
 *
 * 约束：纯本地资源（file:// WebView 友好），不引入 Worker / CDN / 外部字体；
 * 不修改题库数据与引擎；不改任何版本徽标与音频模块本身。
 *
 * v2026.11.19.5: 接上落子音效——本页走子原本只 setMoves、完全绕过了主对局的
 * 音频层，所以静音。现在每步落子复用 sound.play() 的一步一响麻将声：红着、
 * 自动黑应、提示演示的每一次落子各响一声；吃子略沉（capture）；全程尊重
 * soundEnabled 开关，AudioContext 在用户手势中 resume。
 *
 * v2026.11.19.6: （a）选局目录剥离为独立视图，进入残局默认落在棋盘页且已
 * 载入第1局，棋盘页「残局目录」进入目录、选局后回棋盘，进度/提示归零；
 * （b）棋盘独占宽度并用浅色卡片衬底，手机竖屏顶宽显示；
 * （c）落子 cue 与主对局统一——将军 check / 吃子 capture / 其余 move。
 *
 * v2026.11.19.9: 真机无声根因修复——不再用 setTimeout 到点再调用 play()，
 * v2026.11.20.5 再次收紧：不再用 playAt 预约，落子当次点击直接 play()，
 * 因为部分 Android WebView 仍会静音掉“手势之后才起振”的 Web Audio 节点。
 * Android WebView 会丢弃非手势时刻创建的 AudioNode，这是此前反复"残局没声"
 * 的真正原因；重置/悔棋/换局时 stop 掉尚未起振的节点，不留空响。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { parseSetup, type Board as BoardModel } from '../engine/board';
import { validatePosition, validateSetupString } from '../engine/validate';
import { checkStatus, generateLegalMoves, isInCheck, makeMove } from '../engine/rules';
import type { GameState, Move, Pos, Side } from '../engine/types';
import { opponent, samePos } from '../engine/types';
import { SHIQINGYAQU, type AncientPuzzle } from '../data/shiqingyaqu';
import {
  loadLastOrder,
  loadProgress,
  markSolved,
  resetProgress,
  saveLastOrder,
  type AncientProgress,
} from '../data/ancient-progress';
import { ancientAiReply } from '../ai/ancientReply';
import { play, resume, type SoundType } from '../audio/sound';
import { cueFromMove } from '../audio/unifiedCue';
import { useCueDisplay } from '../store/cueDisplayStore';
import { TacticCue } from './TacticCue';
import { announceEvent, type VoiceEvent } from '../audio/voice';
import { playNativeCue, type NativeCue } from '../audio/nativeCue';
import { useSettings } from '../store/settings';
import { SKIN, SKIN_RADIUS } from './theme';
import { Board } from './Board';

/** 每页局数：548 局分 11 页，避免一次渲染 548 个 ListItem 卡顿。 */
export const PAGE_SIZE = 50;

/** 黑方自动应手的延时（毫秒），让红着落子动画先播完。 */
const AUTO_REPLY_DELAY_MS = 300;

/** 空棋盘 setup（未选局时的占位局面）。 */
const EMPTY_SETUP: string = Array(10).fill('.,.,.,.,.,.,.,.,.').join('/');

/** 温和提示文案（走错正解时使用）。 */
export const NOT_WRONG_TEXT = '此着非正解，可悔棋重试或点提示';

interface Notice {
  tone: 'info' | 'warn' | 'success';
  text: string;
}

/** 状态提示色（v2026.11.25.1 SKIN 化）：深绿底上旧蓝/深金/深绿均不可读。 */
const NOTICE_COLOR: Record<Notice['tone'], string> = {
  info: SKIN.textSecondary,
  warn: SKIN.danger,
  success: SKIN.gold,
};

// ---------------------------------------------------------------------------
// 纯函数（可单测；不依赖 React / DOM）
// ---------------------------------------------------------------------------

/** 深拷贝一着，避免 Board.applyMove 原地改写题库中的 Move。 */
export function cloneAncientMove(move: Move): Move {
  return {
    from: { col: move.from.col, row: move.from.row },
    to: { col: move.to.col, row: move.to.row },
    piece: move.piece,
    captured: move.captured,
    notation: move.notation,
  };
}

/** 只比较 from / to / piece：AI 应手与题库着法的 picky 比较。 */
export function sameAncientMove(a: Move, b: Move): boolean {
  return a.piece === b.piece && samePos(a.from, b.from) && samePos(a.to, b.to);
}

/**
 * 统一的落子音效判定（纯函数，可单测）。与主对局 gameStore.classifyEvent 同构：
 * 先看"该着落子之后"的局面里对方是否被将军 -> 'check'；再看是否吃子 -> 'capture'；
 * 否则 -> 'move'。`afterBoard` 必须是本着落地后的棋盘，`moverSide` 是行棋方。
 */
export function ancientCueFor(move: Move, afterBoard: BoardModel, moverSide: Side): SoundType {
  const defender: Side = opponent(moverSide);
  const status = checkStatus(afterBoard, defender);
  // 绝杀/困毙优先于将军和吃子：用 win 音色给出明确的终局反馈。
  if (status === 'checkmate' || status === 'stalemate') return 'win';
  if (status === 'check' || isInCheck(afterBoard, defender)) return 'check';
  if (move.captured) return 'capture';
  return 'move';
}

/**
 * 与落子声分离的三个“提示音”：吃 / 将军 / 绝杀，直接复用主对局的语音模块。
 * 普通走棋返回 null（主对局也是只在特殊事件才播报）。
 */
export function ancientVoiceFor(
  move: Move,
  afterBoard: BoardModel,
  moverSide: Side,
): VoiceEvent | null {
  const status = checkStatus(afterBoard, opponent(moverSide));
  if (status === 'checkmate' || status === 'stalemate') return 'checkmate';
  if (status === 'check') return 'check';
  if (move.captured) return 'capture';
  return null;
}

function voiceForCue(cue: SoundType): VoiceEvent | null {
  if (cue === 'check') return 'check';
  if (cue === 'capture') return 'capture';
  if (cue === 'win') return 'checkmate';
  if (cue === 'lose') return 'lose';
  return null;
}

/** Practice mode speaks cues through native MediaPlayer when available. */
function speakPracticeCue(voice: VoiceEvent | null): void {
  if (voice === null) return;
  const native: NativeCue | null =
    voice === 'check' ? 'check' :
    voice === 'capture' ? 'capture' :
    voice === 'checkmate' ? 'mate' : null;
  if (native !== null && playNativeCue(native)) return;
  announceEvent(voice);
}

/** 计算实际着法序列与正解的最长公共前缀长度（仍在主线上的着数）。 */
export function commonBookPrefix(moves: readonly Move[], solution: readonly Move[]): number {
  let count: number = 0;
  while (
    count < moves.length &&
    count < solution.length &&
    sameAncientMove(moves[count], solution[count])
  ) {
    count += 1;
  }
  return count;
}

/** 从 setup 重放着法得到当前局面。非法/陈旧着法直接跳过，保证 UI 不崩。 */
export function replayAncientMoves(setup: string, moves: readonly Move[]): BoardModel {
  const board: BoardModel = parseSetup(setup);
  for (const move of moves) {
    try {
      board.applyMove(cloneAncientMove(move));
    } catch {
      break;
    }
  }
  return board;
}

/** 按局号或局名过滤（保留 SHIQINGYAQU 的 order 升序，不重新排序）。 */
export function filterAncientPuzzles(query: string): AncientPuzzle[] {
  const trimmed: string = query.trim();
  if (trimmed.length === 0) return SHIQINGYAQU;
  return SHIQINGYAQU.filter(
    (p) =>
      String(p.order).includes(trimmed) ||
      p.title.includes(trimmed) ||
      `第${p.order}局`.includes(trimmed),
  );
}

export type AncientHintAction =
  | { kind: 'highlight'; index: number }
  | { kind: 'play'; index: number; nextHighlight: number | null }
  | { kind: 'realign' }
  | { kind: 'done' };

/**
 * 逐步提示状态机：
 * - 未高亮 -> 高亮 solution[cursor]；
 * - 已高亮 -> 走出该着，并高亮下一着（若有）；
 * - 已偏离主线 -> 先回到主线（realign），再高亮；
 * - 走完 -> done。
 */
export function advanceAncientHint(
  total: number,
  cursor: number,
  hintIndex: number | null,
  offBook: boolean,
): AncientHintAction {
  if (offBook) return { kind: 'realign' };
  if (cursor >= total) return { kind: 'done' };
  if (hintIndex !== null && hintIndex === cursor) {
    return {
      kind: 'play',
      index: cursor,
      nextHighlight: cursor + 1 < total ? cursor + 1 : null,
    };
  }
  return { kind: 'highlight', index: cursor };
}

/** 「悔棋」回退到上一次红方行棋前的着法数（一次退一个完整回合）。 */
export function ancientUndoLength(length: number): number {
  if (length <= 0) return 0;
  return length % 2 === 1 ? length - 1 : length - 2;
}

/** 走子后的温和提示文案：走错正解时明确告诉玩家可悔棋或点提示。 */
export function ancientMoveNotice(expected: Move | null, played: Move): Notice {
  if (expected && !sameAncientMove(played, expected)) {
    return { tone: 'warn', text: NOT_WRONG_TEXT };
  }
  return { tone: 'info', text: `红方 ${played.notation || '行棋'}，黑方应手……` };
}

/** 可注入的残局 AI 应手，便于单测确定性地替换。 */
export type AncientReplyFn = (board: BoardModel, side: Side) => Move | null;

/**
 * 红着之后的黑方应手：仍在主线则走古谱正解；一旦偏离主线，改用真正的
 * 残局 AI——先证明一步杀/两步杀，再做限时迭代搜索。v19.7 的 `legal[0]`
 * 只是合法着法列表的第一项，是"看不懂的废招"的根因，已彻底移除。
 */
export function ancientBlackReply(
  setup: string,
  movesAfterRed: readonly Move[],
  solution: readonly Move[],
  cursor: number,
  matched: boolean,
  replyFn: AncientReplyFn = ancientAiReply,
): Move | null {
  if (matched && cursor + 1 < solution.length) {
    return cloneAncientMove(solution[cursor + 1]);
  }
  if (!matched) {
    const board: BoardModel = replayAncientMoves(setup, movesAfterRed);
    const legal: Move[] = generateLegalMoves(board, 'black');
    if (legal.length === 0) return null;
    const chosen: Move | null = replyFn(board, 'black');
    return cloneAncientMove(chosen ?? legal[0]);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 页面组件
// ---------------------------------------------------------------------------

/** 传入推演沙盘的回调签名：接收当前盘面的完整快照。 */
export type AncientSimulateFn = (state: GameState) => void;

interface AncientPracticePageProps {
  /** 点击「推演」时回调；不传时按钮置灰、行为与旧版完全一致。 */
  onSimulate?: AncientSimulateFn;
}

/** Renders the 548-puzzle ancient practice page with paging and step hints. */
export function AncientPracticePage(
  { onSimulate }: AncientPracticePageProps = {},
): JSX.Element {
  const cue = useCueDisplay((st) => st.cue);
  const showCue = useCueDisplay((st) => st.showCue);
  const clearCue = useCueDisplay((st) => st.clearCue);
  const boardTheme = useSettings((s) => s.boardTheme);
  const effects = useSettings((s) => s.effects);
  const soundEnabled = useSettings((s) => s.soundEnabled);
  /** v2026.11.23.5: 从本地进度续关，不再每次打开都回到第 1 局。 */
  const [progress, setProgress] = useState<AncientProgress>(() => loadProgress());
  /**
   * v推演: 恢复「最后打开的局」——从推演页返回时本组件重新挂载，若只按
   * 闯关进度续关，玩家会发现自己被弹回 progress.current 那一局。优先读
   * last-order（存的是 1 基 order，用 findIndex 换算成 0 基下标），命中
   * 题库才用，否则回落到闯关进度。
   */
  const [puzzle, setPuzzle] = useState<AncientPuzzle | null>(() => {
    const lastOrder: number | null = loadLastOrder();
    if (lastOrder !== null) {
      const lastIndex: number = SHIQINGYAQU.findIndex((p) => p.order === lastOrder);
      if (lastIndex >= 0) return SHIQINGYAQU[lastIndex];
    }
    return SHIQINGYAQU[progress.current] ?? SHIQINGYAQU[0] ?? null;
  });
  const [moves, setMoves] = useState<Move[]>([]);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [legalTargets, setLegalTargets] = useState<Pos[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Pos; to: Pos } | null>(null);
  const [hintIndex, setHintIndex] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [page, setPage] = useState<number>(0);
  /** 独立目录页 / 棋盘页：进入残局默认落在棋盘页（且已载入第1局）。 */
  const [view, setView] = useState<'board' | 'catalog'>('board');

  /** 延时黑着的定时器 + token：选局/重置/悔棋/提示时使其失效。 */
  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef<number>(0);
  /**
   * v2026.11.25 双响根治：黑应手的"一整场演出"（声音 + 艺术字 + 清除）必须能
   * 作为一个整体被撤销。旧实现只 cancel 了音效、把 showCue 的 setTimeout 漏在
   * 外面，于是悔棋/连续点提示之后幽灵应手还会在 +300ms 弹一次字；原生预约的
   * 声音也早被 postDelayed 排好、根本撤不掉——同一着因此响两次、弹两次。
   * 现在音效取消器由 cueMove 提供（延迟定时器在 JS 手上，可真正撤销），
   * 艺术字的 showCue 定时器与"自动清除"定时器同样登记/受管，撤销时一并 clear。
   */
  const pendingReplyRef = useRef<{ cancelCue: () => void; showCueTimer: number | null } | null>(null);
  /** 特效自动清除定时器（同一时刻只允许有一个，避免旧定时器吃掉新特效）。 */
  const cueClearTimerRef = useRef<number | null>(null);

  const scheduleCueClear = (ms: number): void => {
    if (cueClearTimerRef.current !== null) window.clearTimeout(cueClearTimerRef.current);
    cueClearTimerRef.current = window.setTimeout(() => {
      cueClearTimerRef.current = null;
      clearCue();
    }, ms);
  };

  const cancelAutoReply = (): void => {
    tokenRef.current += 1;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingReplyRef.current;
    pendingReplyRef.current = null;
    if (pending) {
      pending.cancelCue();
      if (pending.showCueTimer !== null) window.clearTimeout(pending.showCueTimer);
    }
  };

  /**
   * 一步一响：落子当次点击手势内直接 play()，没有任何 setTimeout / 预约。
   * 这是 Android WebView 上唯一可靠的路径——节点在手势栈里创建并立即起振。
   */
  const clackFor = (move: Move, afterBoard: BoardModel, moverSide: Side): void => {
    // v21.10: 与所有模式统一——走原生优先的统一派发，吃/将/绝杀不再遗漏。
    const status = checkStatus(afterBoard, opponent(moverSide));
    cueFromMove(move, status, undefined, 0, useSettings.getState().soundEnabled);
    showCue(move, status, undefined, afterBoard);
    scheduleCueClear(1300);
  };

  /** 黑方应手：音效与艺术字一起预约，撤销时一起消失（见 pendingReplyRef）。 */
  const clackLater = (move: Move, afterBoard: BoardModel, moverSide: Side, delaySec: number): void => {
    const status = checkStatus(afterBoard, opponent(moverSide));
    const cancelCue = cueFromMove(move, status, undefined, delaySec, useSettings.getState().soundEnabled);
    const showCueTimer = window.setTimeout(
      () => showCue(move, status, undefined, afterBoard),
      delaySec * 1000,
    );
    pendingReplyRef.current = { cancelCue, showCueTimer };
    scheduleCueClear(delaySec * 1000 + 1300);
  };

  /** 用户可点的即时试听：不走预约、直接在本点击手势内发声。 */
  const previewSound = (cue: 'move' | 'capture' | 'check' | 'win', piece: 'R' | 'C'): void => {
    if (!soundEnabled) {
      setNotice({ tone: 'warn', text: '请先在设置中开启音效' });
      return;
    }
    resume();
    play(cue, piece);
    const voice = voiceForCue(cue);
    speakPracticeCue(voice);
  };

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (cueClearTimerRef.current !== null) window.clearTimeout(cueClearTimerRef.current);
    const pending = pendingReplyRef.current;
    pendingReplyRef.current = null;
    if (pending) {
      pending.cancelCue();
      if (pending.showCueTimer !== null) window.clearTimeout(pending.showCueTimer);
    }
  }, []);

  const filtered: AncientPuzzle[] = useMemo(() => filterAncientPuzzles(query), [query]);
  const pageCount: number = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage: number = Math.min(page, pageCount - 1);
  const visible: AncientPuzzle[] = useMemo(
    () => filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const solution: readonly Move[] = puzzle ? puzzle.solution : [];
  const cursor: number = puzzle ? commonBookPrefix(moves, solution) : 0;
  const offBook: boolean = puzzle ? moves.length > cursor : false;
  const isRedTurn: boolean = moves.length % 2 === 0;
  const board: BoardModel = useMemo(
    () => (puzzle ? replayAncientMoves(puzzle.setup, moves) : parseSetup(EMPTY_SETUP)),
    [puzzle, moves],
  );
  const hintMove: Move | null =
    hintIndex !== null && hintIndex < solution.length ? solution[hintIndex] : null;

  const currentIndex: number = puzzle
    ? SHIQINGYAQU.findIndex((p) => p.order === puzzle.order)
    : -1;

  /** 通关一局（正解走完或提示演示完毕）即写入本地进度，并给出明确反馈。 */
  const completePuzzle = (message: string): void => {
    if (currentIndex < 0) return;
    const next: AncientProgress = markSolved(currentIndex);
    setProgress(next);
    // 文案保持与既有交互一致；进度变化由顶部「闯关进度」实时呈现。
    setNotice({ tone: 'success', text: message });
  };

  const clearInteraction = (): void => {
    setSelected(null);
    setLegalTargets([]);
  };

  /** 统一的选局入口：始终先做 setup 结构校验 + 局面合法性校验。 */
  const startPuzzle = (p: AncientPuzzle): void => {
    const structural: string[] = validateSetupString(p.setup);
    if (structural.length > 0) {
      setSetupError(`局面格式非法，已拒绝加载：${structural.join('；')}`);
      return;
    }
    const parsed: BoardModel = parseSetup(p.setup);
    const validation = validatePosition(parsed, 'red');
    if (!validation.valid) {
      setSetupError(`非法局面，已拒绝加载：${validation.errors.join('；')}`);
      return;
    }
    setSetupError(null);
    cancelAutoReply();
    setPuzzle(p);
    // v推演: 记住这局，从推演页/重新进入时回到这里（goToOffset 也走本入口）。
    saveLastOrder(p.order);
    setView('board');
    setMoves([]);
    setHintIndex(null);
    setLastMove(null);
    setNotice({ tone: 'info', text: `已载入第${p.order}局「${p.title}」，红方先行。` });
    clearInteraction();
  };

  const reset = (): void => {
    if (!puzzle) return;
    cancelAutoReply();
    setMoves([]);
    setHintIndex(null);
    setLastMove(null);
    setNotice({ tone: 'info', text: '已重置到初始局面，红方先行。' });
    clearInteraction();
  };

  const undo = (): void => {
    if (!puzzle || moves.length === 0) return;
    cancelAutoReply();
    setMoves((prev) => prev.slice(0, ancientUndoLength(prev.length)));
    setHintIndex(null);
    setLastMove(null);
    setNotice({ tone: 'info', text: '已回退一步，轮到红方重新行棋。' });
    clearInteraction();
  };

  /** 走对正解 -> 300ms 后自动播放黑应手；走错 -> 温和提示 + 合法黑着继续推演。 */
  const playRedMove = (move: Move): void => {
    if (!puzzle) return;
    cancelAutoReply();
    setHintIndex(null);

    const expected: Move | null = offBook ? null : solution[cursor] ?? null;
    const matched: boolean = expected !== null && sameAncientMove(move, expected);
    setNotice(ancientMoveNotice(expected, move));

    const applied: Move = cloneAncientMove(move);
    const afterRed: Move[] = [...moves, applied];
    setMoves(afterRed);
    setLastMove({ from: applied.from, to: applied.to });
    clackFor(applied, replayAncientMoves(puzzle.setup, afterRed), 'red');

    const reply: Move | null = ancientBlackReply(
      puzzle.setup,
      afterRed,
      solution,
      cursor,
      matched,
    );
    if (!reply) {
      if (matched) completePuzzle('正解已走完，本局推演完毕！');
      return;
    }

    // 关键：黑方声音也在红方点击手势内预约，不能等到定时器里再创建 AudioNode。
    clackLater(
      reply,
      replayAncientMoves(puzzle.setup, [...afterRed, cloneAncientMove(reply)]),
      'black',
      AUTO_REPLY_DELAY_MS / 1000,
    );
    const token: number = ++tokenRef.current;
    timerRef.current = window.setTimeout(() => {
      if (token !== tokenRef.current) return;
      timerRef.current = null;
      // 应手已落盘，对应的预约演出签收完毕，避免后续误撤。
      pendingReplyRef.current = null;
      const appliedReply: Move = cloneAncientMove(reply);
      setMoves((prev) => [...prev, appliedReply]);
      setLastMove({ from: appliedReply.from, to: appliedReply.to });
    }, AUTO_REPLY_DELAY_MS);
  };

  const onSquareClick = (col: number, row: number): void => {
    if (!puzzle || !isRedTurn) return;
    const pos: Pos = { col, row };
    const piece = board.getPiece(pos);

    if (selected) {
      if (legalTargets.some((t) => samePos(t, pos))) {
        const move: Move | null = makeMove(board, selected, pos);
        clearInteraction();
        if (move) playRedMove(move);
        return;
      }
      if (piece && piece.side === 'red') {
        setSelected(pos);
        setLegalTargets(
          generateLegalMoves(board, 'red')
            .filter((m) => samePos(m.from, pos))
            .map((m) => m.to),
        );
      } else {
        clearInteraction();
      }
      return;
    }

    if (piece && piece.side === 'red') {
      setSelected(pos);
      setLegalTargets(
        generateLegalMoves(board, 'red')
          .filter((m) => samePos(m.from, pos))
          .map((m) => m.to),
      );
    }
  };

  /** 连续点提示：高亮 -> 走出并高亮下一着 -> …… -> 演示完毕。 */
  const showHint = (): void => {
    if (!puzzle) return;
    const action = advanceAncientHint(solution.length, cursor, hintIndex, offBook);

    switch (action.kind) {
      case 'done':
        setHintIndex(null);
        if (solution.length > 0) completePuzzle('解法演示完毕');
        else setNotice({ tone: 'success', text: '解法演示完毕' });
        return;
      case 'realign': {
        cancelAutoReply();
        setMoves(solution.slice(0, cursor).map(cloneAncientMove));
        setHintIndex(cursor < solution.length ? cursor : null);
        setLastMove(null);
        setNotice({ tone: 'info', text: '已回到正解主线，再点提示继续演示。' });
        clearInteraction();
        return;
      }
      case 'highlight': {
        const next: Move = solution[action.index];
        setHintIndex(action.index);
        setNotice({
          tone: 'info',
          text: `提示：第 ${action.index + 1} 着「${next.notation || '见棋盘高亮'}」，再点一次走出此着。`,
        });
        return;
      }
      case 'play': {
        cancelAutoReply();
        const played: Move = cloneAncientMove(solution[action.index]);
        const replayed: Move[] = moves.slice(0, cursor);
        setMoves([...replayed, played]);
        setLastMove({ from: played.from, to: played.to });
        setHintIndex(action.nextHighlight);
        clackFor(
          played,
          replayAncientMoves(puzzle.setup, [...replayed, played]),
          action.index % 2 === 0 ? 'red' : 'black',
        );
        clearInteraction();
        if (action.nextHighlight === null) {
          completePuzzle('解法演示完毕');
        } else {
          setNotice({
            tone: 'info',
            text: `已走出「${played.notation || '正解'}」，下一着待演示。`,
          });
        }
        return;
      }
      default:
        return;
    }
  };

  /**
   * v推演: 把当前盘面快照交给推演沙盘（SimulationPage）。
   * 必须在用户手势的同步路径里完成：先撤销待发的黑方应手（含其音效/艺术字），
   * 再清选中态，最后 clone 棋盘传出——推演页会往这份棋盘里走子，绝不能共享。
   * 不动 moves、不写闯关进度、不影响解法进度。
   */
  const simulateFromHere = (): void => {
    if (!puzzle || !onSimulate) return;
    cancelAutoReply();
    clearInteraction();
    const turn: Side = isRedTurn ? 'red' : 'black';
    const state: GameState = {
      board: board.clone(),
      turn,
      history: moves.slice(),
      // 用真实状态而不是硬写 'playing'：若玩家已经在练习盘上走成绝杀，
      // 推演页应立刻按终局处理，而不是假装还能继续走。
      status: checkStatus(board, turn),
      moveCount: moves.length,
    };
    onSimulate(state);
  };

  const goToOffset = (offset: number): void => {
    const targetIndex: number = currentIndex < 0 ? 0 : currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= SHIQINGYAQU.length) return;
    setPage(Math.floor(targetIndex / PAGE_SIZE));
    startPuzzle(SHIQINGYAQU[targetIndex]);
  };

  const listItems: JSX.Element[] = visible.map((p) => (
    <ListItemButton
      key={p.order}
      selected={puzzle?.order === p.order}
      aria-label={`第${p.order}局 ${p.title}`}
      title={`第${p.order}局 ${p.title}`}
      onClick={() => startPuzzle(p)}
    >
      <ListItemText primary={`第${p.order}局 · ${p.title}`} />
    </ListItemButton>
  ));

  return (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
      {setupError && (
        <Alert
          severity="error"
          sx={{ width: '100%', maxWidth: 520, overflowWrap: 'anywhere' }}
          onClose={() => setSetupError(null)}
        >
          {setupError}
        </Alert>
      )}

      {view === 'board' ? (
        <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75 }}>
          {/* 顶栏：当前局号标题 + 目录入口，一眼可见、随手可达 */}
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ width: '100%', maxWidth: 520, px: 0.5, gap: 1 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.1 }}>
                适情雅趣 · 共 {SHIQINGYAQU.length} 局
              </Typography>
              {puzzle && (
                <Typography variant="h6" component="h2" sx={{ fontWeight: 800, lineHeight: 1.25 }}>
                  第{puzzle.order}局 · {puzzle.title}
                </Typography>
              )}
              <Typography variant="caption" sx={{ display: 'block', color: SKIN.textMuted, fontSize: 11, lineHeight: 1.3 }}>
                闯关进度：第 {progress.current + 1} 关 · 已解 {progress.solved.length} 局
              </Typography>
            </Box>
            <Button
              size="small"
              variant="contained"
              onClick={() => setView('catalog')}
              sx={{ flexShrink: 0, borderRadius: 999, px: 1.5, fontWeight: 700 }}
            >
              残局目录
            </Button>
          </Stack>

          {/* 棋盘：浅色卡片衬底 + 尽量顶宽，桌面/手机都醒目清晰 */}
          <Paper
            elevation={3}
            sx={{
              p: { xs: 0.5, sm: 1.25 },
              width: '100%',
              maxWidth: 520,
              display: 'flex',
              justifyContent: 'center',
              position: 'relative',
              borderRadius: SKIN_RADIUS,
              boxSizing: 'border-box',
              border: `1px solid ${SKIN.lightBorder}`,
              background: 'linear-gradient(160deg,#FCFDF8 0%,#EEF3E4 100%)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            }}
          >
            <TacticCue cue={cue} />
            {puzzle ? (
              <Board
                board={board}
                selected={selected}
                legalTargets={legalTargets}
                lastMove={lastMove}
                hint={hintMove}
                boardThemeId={boardTheme}
                effects={effects}
                onSquareClick={onSquareClick}
              />
            ) : (
              <Typography sx={{ py: 6, color: SKIN.ink }}>残局数据未载入。</Typography>
            )}
          </Paper>

          {puzzle && (
            <Box sx={{ width: '100%', maxWidth: 520, px: 0.5 }}>
              {/* 主操作行：最高频操作紧贴棋盘，首屏即可触达 */}
              <Stack direction="row" spacing={1} sx={{ mb: 0.75 }}>
                <Button size="small" variant="contained" onClick={showHint} sx={{ borderRadius: 999, px: 1.5, fontWeight: 700 }}>提示</Button>
                <Button
                  size="small"
                  variant="outlined"
                  data-testid="ancient-simulate"
                  disabled={!puzzle || !onSimulate}
                  onClick={simulateFromHere}
                  sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}
                >
                  推演
                </Button>
                <Button size="small" variant="outlined" disabled={moves.length === 0} onClick={undo} sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}>悔棋</Button>
                <Button size="small" variant="outlined" disabled={moves.length === 0} onClick={reset} sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}>重置</Button>
              </Stack>

              {/* 音效试听：用户可直接验证残局音效是否生效（红底白字小 pill，深底上清晰） */}
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                <Typography variant="caption" sx={{ color: SKIN.textSecondary, fontSize: 11 }}>音效试听</Typography>
                {(
                  [
                    { label: '走棋', cue: 'move' as const, piece: 'R' as const },
                    { label: '吃子', cue: 'capture' as const, piece: 'R' as const },
                    { label: '将军', cue: 'check' as const, piece: 'C' as const },
                    { label: '绝杀', cue: 'win' as const, piece: 'R' as const },
                  ]
                ).map((item) => (
                  <Button
                    key={item.label}
                    size="small"
                    onClick={() => previewSound(item.cue, item.piece)}
                    sx={{
                      minWidth: 0,
                      px: 1.25,
                      py: 0.15,
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 999,
                      color: '#FFF2E2',
                      background: 'linear-gradient(180deg,#D2543F 0%,#C0392B 100%)',
                      border: '1px solid rgba(255,242,226,0.30)',
                      '&:active': { filter: 'brightness(1.12)' },
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </Stack>

              {/* 解法进度条 */}
              <Box>
                <Typography variant="body2" sx={{ fontSize: 13, color: SKIN.text, fontWeight: 600 }}>
                  解法进度：第 {cursor} / {solution.length} 步
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={solution.length > 0 ? (cursor / solution.length) * 100 : 100}
                  sx={{
                    my: 0.5,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: 'rgba(231,197,126,0.16)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: SKIN.gold,
                      borderRadius: 999,
                    },
                  }}
                />
              </Box>

              {/* 简短状态提示 */}
              {notice && (
                <Typography variant="body2" sx={{ color: NOTICE_COLOR[notice.tone], fontWeight: 600, minHeight: 22 }}>
                  {notice.text}
                </Typography>
              )}
              {hintMove && (
                <Typography variant="caption" sx={{ display: 'block', color: SKIN.gold }}>
                  高亮着法：{hintMove.notation || '见棋盘高亮'}
                </Typography>
              )}

              {/* 上一局 / 下一局：连续翻阅（禁用态依赖主题 SKIN.disabled，保证可辨认） */}
              <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={currentIndex <= 0}
                  onClick={() => goToOffset(-1)}
                  sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}
                >
                  上一局
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={currentIndex >= SHIQINGYAQU.length - 1}
                  onClick={() => goToOffset(1)}
                  sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}
                >
                  下一局
                </Button>
              </Stack>

              {/* 古谱讲解区：标题正文金/正文米/辅助弱化的清晰层级 */}
              <Typography variant="body2" sx={{ display: 'block', mt: 1, color: SKIN.text, fontSize: 12.5, lineHeight: 1.6 }}>
                {puzzle.hintText}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 1, color: SKIN.textMuted, fontSize: 11, lineHeight: 1.6 }}>
                自由试走：玩家执红，红着后黑方自动应手；偏离古谱时由残局 AI 应手（会捕捉杀棋），走错不判负，可悔棋或点提示。
              </Typography>
            </Box>
          )}
        </Box>
      ) : (
        /* 独立残局目录页：搜索 + 局号列表 + 分页，选局即回棋盘页 */
        <Box sx={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              适情雅趣 · 共 {SHIQINGYAQU.length} 局
            </Typography>
            <Button size="small" variant="outlined" onClick={() => setView('board')} sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}>
              返回棋盘
            </Button>
          </Stack>
          {/* 闯关进度：一键续玩当前关，重置后从第一关重新闯 */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="contained"
              data-testid="ancient-continue"
              onClick={() => {
                const target: AncientPuzzle | undefined =
                  SHIQINGYAQU[progress.current] ?? SHIQINGYAQU[0];
                if (target) startPuzzle(target);
              }}
              sx={{ borderRadius: 999, px: 1.5, fontWeight: 700 }}
            >
              继续闯关（第 {progress.current + 1} 关）
            </Button>
            <Button
              size="small"
              variant="outlined"
              data-testid="ancient-reset-progress"
              onClick={() => setProgress(resetProgress())}
              sx={{ borderRadius: 999, px: 1.5, borderColor: SKIN.border }}
            >
              重置进度
            </Button>
            <Typography variant="caption" sx={{ color: SKIN.textMuted, fontSize: 11 }}>
              已解开 {progress.solved.length} 局
            </Typography>
          </Stack>
          <TextField
            size="small"
            fullWidth
            value={query}
            placeholder="按局号或局名搜索，如 1 / 气吞关右"
            inputProps={{ 'aria-label': '搜索适情雅趣残局' }}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            sx={{
              '& .MuiOutlinedInput-notchedOutline': { borderColor: SKIN.border },
            }}
          />
          <List
            dense
            sx={{
              maxHeight: 520,
              overflow: 'auto',
              bgcolor: SKIN.surface,
              borderRadius: SKIN_RADIUS,
              border: `1px solid ${SKIN.border}`,
            }}
          >
            {listItems}
          </List>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Button size="small" disabled={safePage <= 0} onClick={() => setPage(safePage - 1)} sx={{ borderRadius: 999, px: 1.5 }}>
              上一页
            </Button>
            <Typography variant="caption">第 {safePage + 1} / {pageCount} 页</Typography>
            <Button
              size="small"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              sx={{ borderRadius: 999, px: 1.5 }}
            >
              下一页
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}
