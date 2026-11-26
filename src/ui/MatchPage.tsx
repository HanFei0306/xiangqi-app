import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, Snackbar, TextField, Typography } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import InsightsIcon from '@mui/icons-material/Insights';
import UndoIcon from '@mui/icons-material/Undo';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ExtensionIcon from '@mui/icons-material/Extension';
import HomeIcon from '@mui/icons-material/Home';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import SaveIcon from '@mui/icons-material/Save';
import FlagIcon from '@mui/icons-material/Flag';
import HandshakeIcon from '@mui/icons-material/Handshake';
import SettingsIcon from '@mui/icons-material/Settings';
import { useGameStore, boardAt, type MatchResult } from '../store/gameStore';
import { activeEngineLabel } from '../ai/activeEngine';
import { useSettings } from '../store/settings';
import { generateLegalMoves } from '../engine/rules';
import type { Pos, Move, Side } from '../engine/types';
import { samePos } from '../engine/types';
import { PIECE_DISPLAY } from '../engine/pieces';
import type { PieceType } from '../engine/types';
import { Board } from './Board';
import { HomeButton } from './HomeButton';
import { PlayerBar } from './PlayerBar';
import { DIFFICULTY_LABELS } from './ControlPanel';
import { HintBox } from './HintBox';
import { MatchResultDialog } from './MatchResultDialog';
import { TacticCue } from './TacticCue';
import { useCueDisplay } from '../store/cueDisplayStore';
import { SettingsPanel } from './SettingsPanel';
import {
  CALLIGRAPHY_FONT, SKIN, SKIN_RADIUS, getEnv,
} from './theme';
import { cueFromMove } from '../audio/unifiedCue';
import { findMateInOne } from '../ai/mate';
import { createInitialState } from '../engine/board';
import { saveNotation } from '../data/notation-storage';

/** Pieces captured by a side. Red moves occupy even history indices (red first). */
function capturedBy(history: Move[], side: 'red' | 'black'): string {
  const taken: string[] = [];
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const moverIsRed = i % 2 === 0;
    if (!m.captured || moverIsRed !== (side === 'red')) continue;
    // This side captured; the captured piece belonged to the opponent.
    taken.push(pieceChar(m.captured, side === 'red' ? 'black' : 'red'));
  }
  return taken.join(' ');
}

function pieceChar(type: PieceType, owner: 'red' | 'black'): string {
  return PIECE_DISPLAY[owner][type] ?? '';
}

function sideName(side: Side | null): string {
  return side === 'black' ? '黑方' : '红方';
}

/** Default name for the review-menu 收藏棋谱 action (no clock precision needed). */
function favoriteDefaultName(): string {
  return `对局 ${new Date().toLocaleString('zh-CN')}`;
}

/** Human-readable explanation attached to an explicit MatchResult. */
function reasonText(result: MatchResult): string {
  const loser = sideName(result.loser);
  switch (result.reason) {
    case 'checkmate':
      return `将死${loser}`;
    case 'stalemate':
      return `困毙${loser}`;
    case 'perpetual':
      return `${loser}长将判负`;
    case 'resign':
      return `${loser}认输`;
    case 'repetition':
      return '三次重复';
    case 'draw-agreed':
      return '提和成功';
  }
}

/**
 * Status caption. Terminal text comes from the explicit adjudication (`result`)
 * so "谁胜" can never disagree with the stored winner. Check text names BOTH
 * sides explicitly — "黑方将军 · 红方被将军" — which removes the old ambiguity
 * where "红方被将军" was misread as "红方在将军".
 */
export function statusText(
  status: string,
  turn: string,
  human: Side,
  result: MatchResult | null = null,
): string {
  if (result) {
    if (result.winner === null) return `和棋（${reasonText(result)}）`;
    return `${sideName(result.winner)}胜（${reasonText(result)}）`;
  }
  if (status === 'checkmate') return turn === 'red' ? '黑方胜（将死红方）' : '红方胜（将死黑方）';
  if (status === 'stalemate') return turn === 'red' ? '黑方胜（困毙红方）' : '红方胜（困毙黑方）';
  if (status === 'perpetual') return turn === 'red' ? '红方胜（对方长将判负）' : '黑方胜（对方长将判负）';
  if (status === 'draw') return '和棋';
  if (status === 'check') {
    const checked: Side = turn === 'red' ? 'red' : 'black';
    const checker: Side = checked === 'red' ? 'black' : 'red';
    return `${sideName(checker)}将军 · ${sideName(checked)}被将军`;
  }
  // No flashing "思考中" chatter here: it used to appear while the player's
  // own move was still being announced, which felt like a stalled turn.
  // v2026.11.23.4 shows a restrained, fixed-position progress line instead
  // (see ThinkingIndicator below), driven by the store's `thinking` flag.
  return turn === human ? '轮到你走棋' : '对局进行中';
}

/**
 * 引擎思考进度提示：对手条下沿一条 2px 不确定进度线 + 固定位置小字。
 * 只由 gameStore.thinking 驱动，不参与布局、不覆盖棋盘/棋子、不发声、
 * 不引入新依赖。原生搜索不暴露精确进度，故循环扫光，绝不伪造百分比。
 */
function ThinkingIndicator(): JSX.Element {
  return (
    <Box
      data-testid="thinking-indicator"
      role="status"
      aria-label="引擎思考中"
      sx={{
        position: 'absolute', left: 10, right: 10, bottom: -2, height: 2,
        borderRadius: 2, overflow: 'hidden', pointerEvents: 'none', zIndex: 2,
        background: 'rgba(217,178,106,0.18)',
      }}
    >
      <Box
        className="xq-thinking-sweep"
        sx={{
          width: '30%', height: '100%', borderRadius: 2,
          background: 'linear-gradient(90deg, rgba(217,178,106,0) 0%, rgba(244,212,150,0.95) 50%, rgba(217,178,106,0) 100%)',
        }}
      />
    </Box>
  );
}

interface MatchPageProps {
  /**
   * 回主页 (v2026.11.23.8：语义由「返回设置页」改为「回主页」)。
   * 名字保持不变以兼容既有接线；对局不会被结束，只在调用前挂起。
   * 底部工具条的 HomeButton、「更多」抽屉里的退出/返回设置页都走这里。
   */
  onOpenSetup: () => void;
  /** 练习模式 (menu entry). */
  onOpenPractice: () => void;
  /** v21.6: 带当前局面跳出到推演沙盘（与原对局完全隔离）。v2026.11.23.2 增加可选 hintMode。 */
  onSimulate: (
    state: import('../engine/types').GameState,
    hint?: string,
    options?: import('../store/simulationStore').SimHintOptions,
  ) => void;
}

/** Full Xiangqi match screen — v1.13 deep-green bamboo ambience, 天天象棋 style. */
export function MatchPage({ onOpenSetup, onOpenPractice, onSimulate }: MatchPageProps) {
  const game = useGameStore((s) => s.game);
  const result = useGameStore((s) => s.result);
  const notice = useGameStore((s) => s.notice);
  const clearNotice = useGameStore((s) => s.clearNotice);
  const thinking = useGameStore((s) => s.thinking);
  const hint = useGameStore((s) => s.hint);
  const replay = useGameStore((s) => s.replay);
  const reviewIndex = useGameStore((s) => s.reviewIndex);
  const setReviewIndex = useGameStore((s) => s.setReviewIndex);
  const exitReview = useGameStore((s) => s.exitReview);
  const playerMove = useGameStore((s) => s.playerMove);
  const beginGame = useGameStore((s) => s.beginGame);
  const newGame = useGameStore((s) => s.newGame);
  const undo = useGameStore((s) => s.undo);
  const resign = useGameStore((s) => s.resign);
  const offerDraw = useGameStore((s) => s.offerDraw);
  const requestHint = useGameStore((s) => s.requestHint);
  const requestReplay = useGameStore((s) => s.requestReplay);

  const canUndo = useGameStore((s) => s.undoStack.length > 0);

  const difficulty = useSettings((s) => s.difficulty);
  const playerSide = useSettings((s) => s.playerSide);
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const setSoundEnabled = useSettings((s) => s.setSoundEnabled);
  const boardTheme = useSettings((s) => s.boardTheme);
  const effects = useSettings((s) => s.effects);

  const [selected, setSelected] = useState<Pos | null>(null);
  const [legalTargets, setLegalTargets] = useState<Pos[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // v21.5: 整局自动演绎（复盘从头到尾重演双方走法）。
  const [replayPlaying, setReplayPlaying] = useState(false);
  // v21.6: 复盘默认每步间隔 2 秒，给看棋的人反应时间（原来是 900ms 太快）。
  const [replaySpeed, setReplaySpeed] = useState(2000); // ms per move
  // v2026.11.23.4: 复盘菜单主动收藏棋谱（不再终局自动弹保存框）。
  const [favoriteOpen, setFavoriteOpen] = useState(false);
  const [favoriteName, setFavoriteName] = useState('');
  const [favoriteKey, setFavoriteKey] = useState<string | null>(null);

  const isReviewing = reviewIndex !== null;
  // Identity of the current game: a repeat click on「收藏棋谱」cannot save twice.
  const favoriteGameKey = `${game.moveCount}:${game.history.length}:${game.history[game.history.length - 1]?.notation ?? ''}`;
  const favoriteDone: boolean = favoriteKey === favoriteGameKey;
  const gameOver =
    game.status === 'checkmate' ||
    game.status === 'stalemate' ||
    game.status === 'draw' ||
    game.status === 'perpetual';

  // 播放时逐步推进 reviewIndex；到末手自动停止。退出回放/非播放态自动清理。
  useEffect(() => {
    if (!replayPlaying || !isReviewing) return;
    let cancelled = false;
    let timer = 0;
    const step = () => {
      if (cancelled) return;
      const state = useGameStore.getState();
      const idx = state.reviewIndex;
      if (idx === null || idx >= state.game.history.length - 1) {
        setReplayPlaying(false);
        return; // 统计窗在对局结束时已弹出，这里不重复打断
      }
      // v22.2: 只推进步进；音效与特效统一由下方"走子反馈 effect"发出，
      // 避免此处 + 特效 effect 两处分别调用导致复盘音效/特效各出现两次。
      state.setReviewIndex(idx + 1);
      timer = window.setTimeout(step, replaySpeed);
    };
    timer = window.setTimeout(step, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [replayPlaying, replaySpeed, isReviewing]);

  // 退出回放时停止播放。
  useEffect(() => { if (!isReviewing) setReplayPlaying(false); }, [isReviewing]);

  const displayState = isReviewing ? boardAt(game.history, reviewIndex) : game;
  const liveLastMove = game.history.length
    ? { from: game.history[game.history.length - 1].from, to: game.history[game.history.length - 1].to }
    : null;
  const reviewLastMove = isReviewing
    ? { from: game.history[reviewIndex].from, to: game.history[reviewIndex].to }
    : null;
  const lastMove = isReviewing ? reviewLastMove : liveLastMove;

  const canInteract =
    !isReviewing && !thinking && game.turn === playerSide &&
    (game.status === 'playing' || game.status === 'check');

  const onSquareClick = (col: number, row: number) => {
    if (!canInteract) return;
    const pos: Pos = { col, row };
    const piece = game.board.getPiece(pos);
    if (selected) {
      if (legalTargets.some((t) => t.col === col && t.row === row)) {
        playerMove(selected, pos);
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      if (piece && piece.side === playerSide) {
        setSelected(pos);
        setLegalTargets(generateLegalMoves(game.board, playerSide).filter((m) => samePos(m.from, pos)).map((m) => m.to));
      } else {
        setSelected(null);
        setLegalTargets([]);
      }
      return;
    }
    if (piece && piece.side === playerSide) {
      setSelected(pos);
      setLegalTargets(generateLegalMoves(game.board, playerSide).filter((m) => samePos(m.from, pos)).map((m) => m.to));
    }
  };

  // v21.7: 对局结束自动进入棋盘复盘演绎（不是只弹文字列表）。
  // 终局音效先响约 1.2s，然后关闭文字弹窗、从第 1 步开始自动播放，
  // 用户可随时暂停思考、调速。用 ref 保证每局只触发一次。
  const autoReplayFired = useRef(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const pendingExitRef = useRef(false);
  // v21.7: 屏幕中央艺术字特效（吃/将军/绝杀/杀法）。
  const cue = useCueDisplay((s) => s.cue);
  const showCue = useCueDisplay((s) => s.showCue);
  const clearCue = useCueDisplay((s) => s.clearCue);
  const lastPlyRef = useRef(0);
  const lastReviewRef = useRef<number | null>(null);
  useEffect(() => {
    // v21.9: 对局走子与复盘播放都要弹艺术字特效。
    let mv: Move | null = null;
    let board = game.board;
    let st = game.status;
    if (isReviewing) {
      if (reviewIndex === lastReviewRef.current) return;
      lastReviewRef.current = reviewIndex;
      if (reviewIndex === null || reviewIndex < 0) return;
      mv = game.history[reviewIndex] ?? null;
      board = boardAt(game.history, reviewIndex).board;
      st = boardAt(game.history, reviewIndex).status;
    } else {
      lastReviewRef.current = null;
      const n = game.history.length;
      if (n <= lastPlyRef.current) { lastPlyRef.current = n; return; }
      lastPlyRef.current = n;
      mv = game.history[n - 1] ?? null;
    }
    if (!mv) return;
    // 走子前的局面：用于精确判定吃子。
    const idx = isReviewing ? reviewIndex! : game.history.length - 1;
    const before = idx > 0 ? boardAt(game.history, idx - 1).board : undefined;
    // v22.2: 复盘的音效与特效在这里成对发出（唯一出口）。
    // 正式对局的音效由 gameStore.announceTurn 原生播放，这里只弹特效，避免双响。
    if (isReviewing) {
      cueFromMove(mv, st, before, 0, useSettings.getState().soundEnabled);
    }
    showCue(mv, st, before, board);
    const timer = window.setTimeout(() => clearCue(), 1300);
    return () => window.clearTimeout(timer);
  }, [game.history, game.status, game.board, isReviewing, reviewIndex, showCue, clearCue]);
  const matchStartRef = useRef(Date.now());
  const [elapsedSec, setElapsedSec] = useState(0);
  // 新对局开始时重置计时基准。
  useEffect(() => { if (!gameOver && game.history.length === 0) { matchStartRef.current = Date.now(); setSummaryOpen(false); } }, [gameOver, game.history.length]);
  // v21.10: 对局结束只弹结算页，绝不自动复盘；复盘由用户点「复盘分析」触发。
  useEffect(() => {
    if (!gameOver || autoReplayFired.current) return;
    autoReplayFired.current = true;
    const t = window.setTimeout(() => {
      setElapsedSec((Date.now() - matchStartRef.current) / 1000);
      setSummaryOpen(true);          // 结算页（再来一局/分享/复盘分析/记谱）
    }, 700);
    return () => window.clearTimeout(t);
  }, [gameOver]);
  useEffect(() => { if (!gameOver) { autoReplayFired.current = false; } }, [gameOver]);

  const total = game.history.length;

  // v21.12: 对弈中实时漏杀监控——玩家每走一步后，检查这一步之前是否存在
  // 一步杀而玩家没走（漏杀）。只在分析面板内提示，不弹窗打断对弈。
  const [liveMiss, setLiveMiss] = useState<{ ply: number; killer: string } | null>(null);
  const lastLiveCheckPly = useRef(-1);
  useEffect(() => {
    if (isReviewing || gameOver) return;
    const len = game.history.length;
    if (len === 0 || len === lastLiveCheckPly.current) return;
    lastLiveCheckPly.current = len;
    const lastIdx = len - 1;
    const lastMover: Side = lastIdx % 2 === 0 ? 'red' : 'black';
    if (lastMover !== playerSide) return; // 只监控玩家自己的着法
    const before: import('../engine/types').GameState = lastIdx === 0
      ? { board: createInitialState('red').board, turn: 'red', history: [], status: 'playing', moveCount: 0 }
      : boardAt(game.history, lastIdx - 1);
    const killer = findMateInOne(before, playerSide);
    if (!killer) { setLiveMiss(null); return; }
    const played = game.history[lastIdx];
    const wasMate = played.to.col === killer.to.col && played.to.row === killer.to.row
      && played.from.col === killer.from.col && played.from.row === killer.from.row;
    setLiveMiss(wasMate ? null : { ply: lastIdx, killer: killer.notation || '一步杀' });
  }, [game.history, gameOver, isReviewing, playerSide]);

  // v21.8: 退出时若本局有棋谱，先弹统计/记谱框让用户保存，完成后再退出。
  const requestExit = () => {
    if (game.history.length > 0) {
      pendingExitRef.current = true;
      setElapsedSec((Date.now() - matchStartRef.current) / 1000);
      setReplayPlaying(false);
      setSummaryOpen(true);
      return;
    }
    newGame(); onOpenSetup();
  };

  /**
   * v2026.11.23.8 全局「主页」按钮：从容回家，但**不结束这一局**。
   *
   * 只做两件事：把后台还在跑的语音/AI 应手定时器挂起（pauseForHome 会取消
   * 预约并清掉 hint/replay/reviewIndex/notice 等瞬时 UI），然后把屏幕切回主页。
   * 棋盘、history、result 全部原样留在 store 里，回来时可以接着下。
   * 本页的本地 state（选中格、抽屉开合等）随组件卸载自动消失，无需手动清理。
   *
   * 刻意不走 requestExit：那条路径会弹结算/记谱框，等于把对局"结掉"了。
   */
  const handleHome = () => {
    useGameStore.getState().pauseForHome();   // 挂起，不结束对局
    onOpenSetup();
  };
  const cur = reviewIndex ?? total - 1;
  const aiSide = playerSide === 'red' ? 'black' : 'red';
  const aiActive = !isReviewing && game.turn === aiSide && !gameOver;
  const humanActive = !isReviewing && game.turn === playerSide && !gameOver;

  const reviewControls = total > 0 && (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
      <Button size="small" onClick={() => { setReviewIndex(0); setReplayPlaying(false); }} disabled={cur <= 0} sx={{ color: SKIN.text, minWidth: 0, '&.Mui-disabled': { color: SKIN.disabled } }}>⏮</Button>
      <Button size="small" onClick={() => { setReviewIndex(Math.max(0, cur - 1)); setReplayPlaying(false); }} disabled={cur <= 0} sx={{ color: SKIN.text, minWidth: 0, '&.Mui-disabled': { color: SKIN.disabled } }}>‹上一步</Button>
      <Typography variant="caption" sx={{ color: SKIN.gold, minWidth: 60, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {isReviewing ? `${cur + 1}/${total}` : `最新 ${total} 步`}
      </Typography>
      <Button size="small" onClick={() => { setReviewIndex(Math.min(total - 1, cur + 1)); setReplayPlaying(false); }} disabled={cur >= total - 1} sx={{ color: SKIN.text, minWidth: 0, '&.Mui-disabled': { color: SKIN.disabled } }}>下一步›</Button>
      {/* v21.5 自动演绎：从头到尾重演整局，可暂停与调速。 */}
      <Button
        size="small"
        variant={replayPlaying ? 'contained' : 'outlined'}
        onClick={() => {
          if (!isReviewing) { setReviewIndex(0); setReplayPlaying(true); return; }
          if (cur >= total - 1) setReviewIndex(0);
          setReplayPlaying(!replayPlaying);
        }}
        disabled={total < 2}
        sx={{ color: replayPlaying ? SKIN.text : SKIN.gold, borderColor: SKIN.border, minWidth: 0, '&.Mui-disabled': { color: SKIN.disabled, borderColor: SKIN.border } }}
      >
        {replayPlaying ? '⏸暂停' : '▶复盘'}
      </Button>
      <Button
        size="small"
        onClick={() => setReplaySpeed((s) => (s === 2000 ? 1200 : s === 1200 ? 3000 : 2000))}
        sx={{ color: SKIN.gold, minWidth: 0 }}
        title="切换复盘速度"
      >
        {replaySpeed === 2000 ? '2秒' : replaySpeed === 1200 ? '快' : '慢'}
      </Button>
      {isReviewing && (
        <Button size="small" variant="contained" color="warning" onClick={() => { setReplayPlaying(false); exitReview(); }}>退出回放</Button>
      )}
    </Box>
  );

  /**
   * v2026.11.21.5 — 底部合并为唯一工具栏（5 个高频动作），
   * 认输/提和/退出/重来等收进「更多」抽屉，棋盘因此获得更多屏幕高度。
   * 每个 label 与 onClick 保持不变，功能完全可达，只是入口更聚焦。
   */
  const tools: Array<{ label: string; icon: JSX.Element; onClick: () => void; disabled?: boolean }> = [
    { label: '显示分析', icon: <InsightsIcon sx={{ fontSize: 20 }} />, onClick: () => setAnalysisOpen(!analysisOpen) },
    { label: '悔棋', icon: <UndoIcon sx={{ fontSize: 20 }} />, onClick: undo, disabled: !canUndo || thinking || isReviewing },
    { label: '提示', icon: <LightbulbIcon sx={{ fontSize: 20 }} />, onClick: requestHint, disabled: thinking || gameOver || isReviewing },
    { label: '设置', icon: <SettingsIcon sx={{ fontSize: 20 }} />, onClick: () => setSettingsOpen(true) },
    { label: '更多', icon: <MenuIcon sx={{ fontSize: 20 }} />, onClick: () => setMenuOpen(true) },
  ];

  // "更多"抽屉：新对局 / 重来 / 认输 / 提和 / 退出 / 练习 / 返回设置页。
  const menuEntries: Array<{ label: string; icon: JSX.Element; onClick: () => void; disabled?: boolean }> = [
    // v21.6: 从当前局面跳出推演——棋子摆放与当下完全一致，可自由摆弄双方棋子。
    { label: '推演此局面', icon: <InsightsIcon />, onClick: () => { setMenuOpen(false); onSimulate(game); } },
    // v2026.11.23.4: 收藏入口只在复盘态开放；收藏后原复盘位置/播放态不变。
    {
      label: favoriteDone ? '已收藏棋谱' : '收藏棋谱',
      icon: <SaveIcon />,
      onClick: () => {
        setMenuOpen(false);
        if (!isReviewing || game.history.length === 0 || favoriteDone) return;
        setFavoriteName(favoriteDefaultName());
        setFavoriteOpen(true);
      },
      disabled: !isReviewing || game.history.length === 0 || favoriteDone,
    },
    { label: '新对局', icon: <RestartAltIcon />, onClick: () => { setMenuOpen(false); beginGame(); } },
    {
      label: '重来',
      icon: <RestartAltIcon />,
      onClick: () => { setMenuOpen(false); setSelected(null); setLegalTargets([]); setSettingsOpen(false); beginGame(); },
    },
    { label: '认输', icon: <FlagIcon />, onClick: () => { setMenuOpen(false); resign(); }, disabled: gameOver || thinking },
    { label: '提和', icon: <HandshakeIcon />, onClick: () => { setMenuOpen(false); offerDraw(); }, disabled: gameOver || thinking || !humanActive },
    {
      label: '退出',
      icon: <HomeIcon />,
      onClick: () => { setMenuOpen(false); setSelected(null); setLegalTargets([]); requestExit(); },
    },
    { label: '练习模式', icon: <ExtensionIcon />, onClick: () => { setMenuOpen(false); onOpenPractice(); } },
    { label: '返回设置页', icon: <HomeIcon />, onClick: () => { setMenuOpen(false); requestExit(); } },
  ];

  // Fixed-position caption: the words appear in the SAME slot as the normal
  // status text — never a floating toast, never a second flashing label.
  const opponentStatus = statusText(displayState.status, displayState.turn, playerSide, isReviewing ? null : result);
  const showThinking = thinking && !isReviewing && aiActive;
  const opponentCaption = showThinking ? `${opponentStatus} · 引擎思考中` : opponentStatus;

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        background: getEnv(boardTheme).matchBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 0.6,
        px: 1,
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: '100%',
        overflowX: 'hidden',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 0.6, minWidth: 0 }}>
        {/* ---- 顶部对手条：金色方框头像 + 档位名 ---- */}
        {/* v2026.11.23.4：思考进度条绝对定位在对手条下沿，不占布局、不遮棋子。 */}
        <Box sx={{ position: 'relative', width: '100%' }}>
          <PlayerBar
            side={aiSide}
            name={DIFFICULTY_LABELS[difficulty]}
            detail={opponentCaption}
            active={aiActive}
            capturedText={capturedBy(game.history, aiSide)}
          />
          {showThinking && <ThinkingIndicator />}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'center', width: '100%', position: 'relative' }}>
          <TacticCue cue={cue} />
          <Board
            board={displayState.board}
            selected={isReviewing ? null : selected}
            legalTargets={isReviewing ? [] : legalTargets}
            lastMove={lastMove}
            hint={isReviewing ? null : hint?.move ?? null}
            status={isReviewing ? undefined : displayState.status}
            boardThemeId={boardTheme}
            effects={effects}
            interactive={canInteract}
            onSquareClick={onSquareClick}
            flipped={playerSide === 'black'} // v22.6: 执黑时棋盘旋转 180°，黑方在下
          />
        </Box>

        {/* ---- 玩家条：头像 + N步 计数 ---- */}
        <PlayerBar
          side={playerSide}
          name={`你 · ${playerSide === 'red' ? '红方' : '黑方'}`}
          active={humanActive}
          capturedText={capturedBy(game.history, playerSide)}
          stepCount={total}
        />

        {/* ---- 底部唯一工具栏（v21.4）：分析 / 悔棋 / 提示 / 设置 / 更多 ---- */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 0.5,
            width: '100%',
            borderRadius: SKIN_RADIUS,
            p: 0.6,
            boxSizing: 'border-box',
            background: SKIN.surface,
            border: `1px solid ${SKIN.border}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35), inset 0 1px 2px rgba(0,0,0,0.4)',
          }}
        >
          {tools.map((t) => (
            <Button
              key={t.label}
              onClick={t.onClick}
              disabled={t.disabled}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.1,
                py: 0.7,
                borderRadius: '10px',
                minWidth: 0,
                // v2026.11.25.2 禁用态可读性：不再自定义近隐形颜色，
                // 禁用时统一落到 SKIN.disabled（对深底 5.1:1，可辨认出按钮本体）。
                color: SKIN.text,
                '&.Mui-disabled': { color: SKIN.disabled },
                background: SKIN.surfaceStrong,
                border: `1px solid ${SKIN.border}`,
                '&:hover': { background: 'rgba(231,197,126,0.12)' },
              }}
            >
              {t.icon}
              <Typography sx={{ fontSize: 11, fontWeight: 600, lineHeight: 1.2 }}>{t.label}</Typography>
            </Button>
          ))}
        </Box>

        {/* ---- v21.7 第六层任务栏：复盘 / 推演 / 练习 / 返回（天天象棋式常驻入口） ---- */}
        <Box
          sx={{
            display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 0.5,
            width: '100%', p: 0.6, borderRadius: SKIN_RADIUS, boxSizing: 'border-box',
            background: SKIN.surface, border: `1px solid ${SKIN.border}`,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          <Button onClick={() => { setAnalysisOpen(true); setReviewIndex(0); setReplayPlaying(false); }}
            disabled={total === 0}
            sx={{ color: SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6, px: 0.2, '&.Mui-disabled': { color: SKIN.disabled } }}>
            <MenuBookIcon sx={{ fontSize: 19 }} />
            <Typography sx={{ fontSize: 11, whiteSpace: 'nowrap' }}>复盘</Typography>
          </Button>
          <Button onClick={() => onSimulate(game)}
            sx={{ color: SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6, px: 0.2 }}>
            <InsightsIcon sx={{ fontSize: 19 }} />
            <Typography sx={{ fontSize: 11, whiteSpace: 'nowrap' }}>推演</Typography>
          </Button>
          <Button onClick={onOpenPractice}
            sx={{ color: SKIN.text, flexDirection: 'column', minWidth: 0, py: 0.6, px: 0.2 }}>
            <ExtensionIcon sx={{ fontSize: 19 }} />
            <Typography sx={{ fontSize: 11, whiteSpace: 'nowrap' }}>练习</Typography>
          </Button>
          {/* 全页唯一「回家」入口：固定在底部任务栏最右（右下角）。
              v2026.11.23.8：红色/棕色「返回」换成统一的 HomeButton ——
              点它只挂起对局回主页，不结束、不弹结算，回来可以接着下。 */}
          <HomeButton
            onClick={handleHome}
            tone="dark"
            size="md"
            testId="match-home"
            sx={{
              width: '100%',
              minHeight: 0,
              justifyContent: 'center',
              py: 0.55,
              px: 0.3,
              borderRadius: '9px',
              fontSize: 11,
              letterSpacing: '0.02em',
              '& .MuiButton-startIcon': { mr: 0.3, ml: 0 },
              '& .MuiSvgIcon-root': { fontSize: 18 },
            }}
          />
        </Box>

        {/* ---- 分析面板（显示分析 折叠区） ---- */}
        {analysisOpen && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
            {liveMiss && (
              <Box data-testid="live-miss" sx={{ p: 1, borderRadius: SKIN_RADIUS, background: SKIN.surface, border: `1px solid ${SKIN.goldDeep}` }}>
                <Typography sx={{ color: SKIN.gold, fontSize: 12.5, fontWeight: 700 }}>
                  ⚠ 这一手有漏杀：可走「{liveMiss.killer}」一步杀
                </Typography>
                <Button size="small" sx={{ color: SKIN.gold, fontSize: 11.5, mt: 0.3, p: 0 }}
                  onClick={() => {
                    const before = liveMiss.ply === 0
                      ? { board: createInitialState('red').board, turn: 'red' as Side, history: [], status: 'playing' as const, moveCount: 0 }
                      : boardAt(game.history, liveMiss.ply - 1);
                    onSimulate(before, liveMiss.killer);
                  }}>
                  进入推演，重走这一手 →
                </Button>
              </Box>
            )}
            <HintBox hint={hint} />
            {reviewControls}
            <Box sx={{ display: 'flex', gap: 0.6 }}>
              <Button fullWidth size="small" variant="outlined" onClick={requestReplay}
                disabled={gameOver || isReviewing}
                sx={{ color: SKIN.text, borderColor: SKIN.border, fontSize: 13, '&.Mui-disabled': { color: SKIN.disabled, borderColor: SKIN.border } }}>
                <MenuBookIcon sx={{ fontSize: 16, mr: 0.4 }} />复盘
              </Button>
              <Button fullWidth size="small" variant="outlined" onClick={() => setSoundEnabled(!soundEnabled)}
                aria-label="切换音效"
                sx={{ color: SKIN.text, borderColor: SKIN.border, fontSize: 13 }}>
                {soundEnabled ? <VolumeUpIcon sx={{ fontSize: 16, mr: 0.4 }} /> : <VolumeOffIcon sx={{ fontSize: 16, mr: 0.4 }} />}
                音效
              </Button>
            </Box>
            {/* v21.6: 移除着法记录——用户反馈看不懂这么多步骤；复盘演绎已足够。 */}
          </Box>
        )}
      </Box>

      {/* ---- 菜单弹层：新局 / 练习模式 / 返回设置页 / 版本号 ---- */}
      <Drawer
        anchor="bottom"
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        PaperProps={{
          sx: {
            maxWidth: 520,
            mx: 'auto',
            borderRadius: '16px 16px 0 0',
            background: SKIN.surfaceStrong,
            borderTop: `1px solid ${SKIN.border}`,
            px: 1.5,
            pt: 1.2,
            pb: 2,
          },
        }}
      >
        {menuEntries.map((entry) => (
          <Button
            key={entry.label}
            fullWidth
            onClick={entry.onClick}
            disabled={entry.disabled}
            startIcon={entry.icon}
            sx={{
              justifyContent: 'flex-start',
              color: SKIN.text,
              '&.Mui-disabled': { color: SKIN.disabled },
              fontSize: 15,
              fontWeight: 700,
              fontFamily: CALLIGRAPHY_FONT,
              py: 1.1,
              borderRadius: '10px',
              '&:hover': { background: 'rgba(231,197,126,0.10)' },
            }}
          >
            {entry.label}
          </Button>
        ))}
        <Typography sx={{ textAlign: 'center', fontSize: 11, color: SKIN.textMuted, mt: 1.5 }}>
          象棋训练 v2026.11.25.2 · 引擎：{activeEngineLabel()}
        </Typography>
      </Drawer>

      {/* ---- 设置面板 ---- */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* ---- 提和答复等瞬时提示 ---- */}
      <Snackbar
        open={notice !== null}
        autoHideDuration={3600}
        onClose={(_, reason) => { if (reason !== 'clickaway') clearNotice(); }}
        message={notice ?? ''}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ maxWidth: '92vw' }}
      />

      {/* v2026.11.23.5 结算页：再来一局 / 新的一局 / 复盘分析 / 分享 + 记谱保存 */}
      <MatchResultDialog
        open={summaryOpen}
        history={game.history}
        annotations={replay ?? []}
        playerSide={playerSide}
        elapsedSec={elapsedSec}
        resultLabel={result ? statusText(game.status, game.turn, playerSide, result) : '对局结束'}
        onClose={() => {
          setSummaryOpen(false);
          if (pendingExitRef.current) {
            pendingExitRef.current = false;
            newGame(); onOpenSetup();
          }
        }}
        onNewGame={() => { setSummaryOpen(false); pendingExitRef.current = false; beginGame(); }}
        // 不直接复用 requestExit：有棋谱时它会再次弹出结算页；这里清掉待退出标记，
        // 直接走父组件提供的设置页入口，让用户重选难度 / 执色 / 皮肤。
        onNewSetup={() => { setSummaryOpen(false); pendingExitRef.current = false; newGame(); onOpenSetup(); }}
        onReview={() => {
          setSummaryOpen(false);
          pendingExitRef.current = false;
          setReviewIndex(0);        // 进入复盘，停在第 1 步，由用户点播放/上一步/下一步
          setReplayPlaying(false);
          setAnalysisOpen(true);
        }}
        onReviewMiss={(state, killer, options) => {
          setSummaryOpen(false); pendingExitRef.current = false;
          onSimulate(state, killer, options);
        }}
      />

      {/* ---- v2026.11.23.4 复盘菜单「收藏棋谱」：只保存，不打断复盘 ---- */}
      <Dialog data-testid="favorite-dialog" open={favoriteOpen} onClose={() => setFavoriteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: CALLIGRAPHY_FONT }}>收藏棋谱</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            把本局 {game.history.length} 步保存到记谱本，之后可在「记谱 · 棋谱本」里重播。
          </Typography>
          <TextField autoFocus fullWidth size="small" label="棋谱名称"
            value={favoriteName} onChange={(e) => setFavoriteName(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFavoriteOpen(false)}>取消</Button>
          <Button data-testid="favorite-confirm" variant="contained" onClick={() => {
            if (game.history.length === 0 || favoriteDone) { setFavoriteOpen(false); return; }
            saveNotation({
              name: favoriteName.trim() || favoriteDefaultName(),
              setup: '', // 标准开局；与结算页保存口径一致
              moves: game.history,
            });
            setFavoriteKey(favoriteGameKey);
            setFavoriteOpen(false);
            // 刻意不动 reviewIndex / replayPlaying：收藏只是后台保存。
          }}>收藏</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
