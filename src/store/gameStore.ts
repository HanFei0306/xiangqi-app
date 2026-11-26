/**
 * Game store: holds the live game state, drives the human (red/black) <-> AI
 * loop, and exposes hint / replay / undo / review / resign / draw actions. The
 * AI "thinking" mask is a 120ms reply gap so the opponent's move does not snap
 * in instantly; the search itself overlaps the piece-flight animation.
 *
 * v2026.11.19.3 BUG FIX — 长将判负归属:
 * judgeRepetition() reports the LOSING side explicitly ('red-loses' /
 * 'black-loses'). The previous code collapsed that into status='perpetual' and
 * then inferred the winner from "whose turn it is", which is only correct when
 * the checker moved LAST. When the perpetual checker is the side to move at the
 * repeated position, that inference inverted the result: black kept checking,
 * yet the UI showed 黑方胜 and the stats credited black. We now carry an
 * explicit `result` ({ winner, loser, reason }) alongside `game.status`, and
 * ALL win/lose text, wood cues and persisted outcomes read from it.
 */

import { create } from 'zustand';
import { parseSetup, createInitialState, type Board } from '../engine/board';
import {
  type GameState,
  type GameStatus,
  type Move,
  type Pos,
  type Side,
  opponent,
} from '../engine/types';
import { getGameStatus, makeMove, applyMoveToState } from '../engine/rules';
import { validatePosition, validateSetupString } from '../engine/validate';
import { defaultConfig } from '../ai/engine';
import { moveEngine as engine } from '../ai/activeEngine';
import { judgeRepetition, type RepetitionJudgment } from './repetition-judge';
import { getHint } from '../training/hint';
import { renderByDelta } from '../training/templates';
import { analyze } from '../training/replay';
import { useSettings } from './settings';
import { INITIAL_SETUP } from '../data/puzzles';
import type { HintResult } from '../training/types';
import type { ReplayAnnotation } from '../training/types';
import { play, resume } from '../audio/sound';
import { announceEvent, stopVoice, type VoiceEvent } from '../audio/voice';
import { recordMatchOutcome, type MatchOutcome } from './matchStats';
import { recordGameResult } from '../ai/evolution';
import { analyzeGameForLessons } from '../training/selfReview';

/** Terminal statuses that end the game. */
const TERMINAL: ReadonlyArray<GameStatus> = [
  'checkmate',
  'stalemate',
  'draw',
  'perpetual',
];

/**
 * An AI evaluation at or above this many centipawns (roughly a horse) means
 * the engine is clearly better and will decline a draw offer.
 */
const DRAW_REJECT_SCORE = 350;

/** Small beat after the piece lands before the AI replies. */
const AI_REPLY_GAP_MS = 120;
/**
 * When the mahjong clack lands: synced to the v1.13 260ms smooth flight
 * (Board.MOVE_ANIM_MS = 260, easing cubic-bezier(0.3, 0.72, 0.28, 1)
 * touches down near 200ms). One clack here, never a second one at flight start.
 */
const LAND_MS = 200;

/** The side the HUMAN plays ('red' default; 'black' = the AI opens). */
function humanSide(): Side {
  return useSettings.getState().playerSide ?? 'red';
}

/** The side the AI plays (always the opposite of the human side). */
function aiSide(): Side {
  return opponent(humanSide());
}

/**
 * Explicit adjudication of a finished match. Kept OUTSIDE GameState so the
 * engine types stay untouched; the UI and stats always read this object
 * instead of reverse-engineering a winner from `turn`.
 */
export interface MatchResult {
  /** Terminal status mirrored onto game.status. */
  status: GameStatus;
  /** Why the match ended (drives the Chinese result caption). */
  reason: 'checkmate' | 'stalemate' | 'perpetual' | 'repetition' | 'resign' | 'draw-agreed';
  /** Winning side, or null for a draw. */
  winner: Side | null;
  /** Losing side, or null for a draw. */
  loser: Side | null;
}

function terminalResult(status: GameStatus, reason: MatchResult['reason'], winner: Side | null): MatchResult {
  return {
    status,
    reason,
    winner,
    loser: winner === null ? null : opponent(winner),
  };
}

/**
 * Converts a terminal move into an explicit result. `judgment` is the raw
 * repetition verdict; for 'perpetual' it is the SINGLE source of truth for who
 * lost (never `turnAfter`, which can be either the checker or the victim).
 */
function resultForMove(
  status: GameStatus,
  mover: Side,
  turnAfter: Side,
  judgment: RepetitionJudgment,
): MatchResult | null {
  if (status === 'checkmate') return terminalResult(status, 'checkmate', mover);
  if (status === 'stalemate') return terminalResult(status, 'stalemate', mover);
  if (status === 'draw') {
    return terminalResult(status, judgment === 'draw' ? 'repetition' : 'draw-agreed', null);
  }
  if (status === 'perpetual') {
    const winner: Side =
      judgment === 'red-loses' ? 'black' : judgment === 'black-loses' ? 'red' : turnAfter;
    return terminalResult(status, 'perpetual', winner);
  }
  return null;
}

/**
 * Speech scheduling is cancellable: 新对局 / 悔棋 / 载入局面 must invalidate a
 * pending "after announcement, let the AI move" callback, otherwise an old
 * timer would drop a move into the fresh game.
 */
let speechSequence = 0;
const pendingTimers = new Set<number>();

/** Async AI search started at the instant of the player's move, so it overlaps
 *  the piece-flight animation instead of freezing the board afterwards. */
let pendingSearch: { seq: number; promise: Promise<Move | null> } | null = null;

function startAiSearch(game: GameState): void {
  const cfg = defaultConfig(useSettings.getState().difficulty);
  const promise = engine.getBestMoveAsync
    ? engine.getBestMoveAsync(game, cfg).catch(() => null)
    : Promise.resolve(engine.getBestMove(game, cfg));
  pendingSearch = { seq: speechSequence, promise };
}

function cancelSpeech(): void {
  speechSequence += 1;
  for (const id of pendingTimers) window.clearTimeout(id);
  pendingTimers.clear();
  pendingSearch = null;
  stopVoice();
}

function afterBeat(fn: () => void, ms: number, seq: number): void {
  const id = window.setTimeout(() => {
    pendingTimers.delete(id);
    if (seq === speechSequence) fn();
  }, ms);
  pendingTimers.add(id);
}

function createInitialGame(): GameState {
  const board = parseSetup(INITIAL_SETUP);
  const turn: Side = 'red';
  // One-off development assertion: the shipped start position must itself be
  // legal (piece limits / palaces / no flying generals). Cheap: runs once.
  const check = validatePosition(board, turn);
  if (!check.valid) {
    console.error('[gameStore] INITIAL_SETUP is illegal:', check.errors.join(' | '));
  }
  return {
    board,
    turn,
    history: [],
    status: getGameStatus(board, turn),
    moveCount: 0,
  };
}

/**
 * Rebuilds the game state after applying the first `index + 1` moves of a
 * history. Used by the "棋谱回放" (review) feature to render any past position.
 */
export function boardAt(history: Move[], index: number): GameState {
  let state = createInitialState('red');
  for (let i = 0; i <= index && i < history.length; i++) {
    state = applyMoveToState(state, history[i]);
  }
  return state;
}

/**
 * Classifies the just-played move for both its wood cue and spoken event.
 * Win/lose cues are judged from the HUMAN player's side. For terminal
 * positions the explicit `result` decides — never the side to move.
 *
 * The check branch deliberately reads the SAME `status` the UI renders, instead
 * of re-running `isInCheck` on the board. Recomputing created a second source
 * of truth that could disagree with `game.status` (voice announcing 将军 while
 * the board showed a normal position, or vice versa). One status -> one event.
 */
export function classifyEvent(
  move: Move,
  _board: Board,
  _turnAfter: Side,
  status: GameStatus,
  result: MatchResult | null,
): { cue: Parameters<typeof play>[0]; event: VoiceEvent } {
  const human = humanSide();
  if (result && result.winner !== null) {
    const cue: Parameters<typeof play>[0] = result.winner === human ? 'win' : 'lose';
    if (status === 'checkmate') return { cue, event: 'checkmate' };
    if (status === 'perpetual') return { cue, event: 'win' };
    if (status === 'stalemate') return { cue, event: 'draw' };
  }
  if (status === 'draw') {
    // A true draw (e.g. threefold repetition / accepted offer): neutral tap + 和棋.
    return { cue: 'move', event: 'draw' };
  }
  if (status === 'check' || status === 'checkmate') {
    return { cue: 'check', event: 'check' };
  }
  if (move.captured) return { cue: 'capture', event: 'capture' };
  return { cue: 'move', event: 'move' };
}

/**
 * A tiny haptic tick at the moment of impact. Ignored on devices/WebViews
 * without vibration support; never throws.
 */
function tapFeedback(): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(14);
  } catch {
    /* ignore */
  }
}

/** Terminal match outcome from the HUMAN player's perspective. */
function matchOutcomeFor(result: MatchResult | null): MatchOutcome {
  if (!result || result.winner === null) return 'draw';
  return result.winner === humanSide() ? 'win' : 'loss';
}

/**
 * Single write path for every finished match: legacy per-tier stats plus the
 * AI's local evolution log. The outcome is ALWAYS passed explicitly from the
 * adjudication `result` — never inferred from `game.turn`, so a black
 * perpetual-check loss is recorded as a human win even when black is to move.
 * Both writers are synchronous localStorage operations and cannot affect the
 * one-clack-per-move audio timing (they run in the landing callback).
 */
function recordFinishedMatch(result: MatchResult | null, game: GameState): void {
  const outcome: MatchOutcome = matchOutcomeFor(result);
  const difficulty = useSettings.getState().difficulty;
  recordMatchOutcome(difficulty, outcome);
  const playerSide = humanSide();
  recordGameResult({ difficulty, outcome, game, playerSide });
  // Post-game self review: record missed mates and material blunders locally.
  analyzeGameForLessons(game, playerSide);
}

/**
 * Wood sound on every move; a spoken cue ONLY for special events
 * (吃 / 将军 / 绝杀 / 胜 / 和棋). Ordinary moves stay silent as requested.
 * Voice is fire-and-forget and never gates the AI's reply.
 */
function announceTurn(
  move: Move,
  board: Board,
  turnAfter: Side,
  status: GameStatus,
  result: MatchResult | null,
  onDone: () => void,
): void {
  const enabled = useSettings.getState().soundEnabled;
  const { cue, event } = classifyEvent(move, board, turnAfter, status, result);
  const seq = speechSequence;

  if (enabled) {
    resume();
    play('slide', move.piece);
  }
  afterBeat(() => {
    if (enabled) {
      play(cue, move.piece);
      tapFeedback();
      if (event !== 'move') announceEvent(event);
    }
    // Just enough breathing room for the impact to register before the reply.
    afterBeat(onDone, 120, seq);
  }, LAND_MS, seq);
}

interface GameStore {
  game: GameState;
  /** Explicit winner/loser adjudication of a finished game (null while playing). */
  result: MatchResult | null;
  /** Transient user-facing message (draw offer declined/accepted, etc.). */
  notice: string | null;
  /** True while the game started from the standard initial position. */
  standardHistory: boolean;
  /** Reason the last externally supplied position was rejected (null = none). */
  setupError: string | null;
  /** True while the AI is "thinking" (drives the input gate only). */
  thinking: boolean;
  hint: HintResult | null;
  replay: ReplayAnnotation[] | null;
  /** Snapshots taken before each human move, for undo (reverts player + AI). */
  undoStack: GameState[];
  /** When not null, the board shows the position after this many half-moves. */
  reviewIndex: number | null;

  newGame: () => void;
  /**
   * Starts a fresh standard match (newGame) and, when the human plays black,
   * lets the AI open the game (search + first move). Used by the setup page's
   * 开始挑战 and the in-match 重来 button so both honor the chosen side.
   */
  beginGame: () => void;
  /**
   * Loads an externally authored position (puzzle, practice setup or imported
   * score). Returns false and sets `setupError` without touching the live game
   * when the setup is illegal. Legal normal moves never go through this path.
   */
  loadPosition: (setup: string, turn?: Side) => boolean;
  /** Alias for loadPosition, for puzzle/endgame loading call sites. */
  loadPuzzle: (setup: string, turn?: Side) => boolean;
  clearSetupError: () => void;
  playerMove: (from: Pos, to: Pos) => boolean;
  undo: () => void;
  /** Human resigns: opponent wins, recorded in the persisted stats. */
  resign: () => void;
  /** Offers a draw; the AI evaluates the position and accepts or declines. */
  offerDraw: () => void;
  clearNotice: () => void;
  requestHint: () => void;
  requestReplay: () => void;
  clearReplay: () => void;
  setReviewIndex: (i: number) => void;
  exitReview: () => void;
  /**
   * v2026.11.23.8 主页挂起：离开对局屏但**不结束**对局。
   * 取消全部预约的语音/AI 应手定时器与在途搜索，避免"人已回主页、后台还在
   * 走棋发声"；棋盘、历史、结果一律原样保留，供 resumeFromHome 接着下。
   */
  pauseForHome: () => void;
  /**
   * 回到被挂起的对局。只有挂起那一刻恰好轮到引擎时才重新发起搜索并落子；
   * 轮到人、已终局、已有搜索在跑都直接返回，绝不重复走两步。
   */
  resumeFromHome: () => void;
  _aiMove: () => Promise<void>;
}

export const useGameStore = create<GameStore>((set, get) => {
  return ({
  /**
   * Human move: applies immediately. The removed 三思关 interceptor used to
   * queue a pending move behind a modal; the board now keeps the original
   * v2026.11.23.3 direct-move semantics while all later fixes (长将判负 etc.)
   * remain unchanged.
   */
  playerMove: (from: Pos, to: Pos): boolean => {
    const { game, thinking } = get();
    if (thinking) return false;
    if (game.status !== 'playing' && game.status !== 'check') return false;
    if (game.turn !== humanSide()) return false;

    const move = makeMove(game.board, from, to);
    if (!move) return false;

    const board = game.board.clone();
    board.applyMove(move);
    const turn: Side = aiSide();
    let status = getGameStatus(board, turn);
    // Threefold repetition: a draw unless the last cycle was a perpetual
    // check (长将判负) — then the judge names the loser explicitly.
    let judgment: RepetitionJudgment = 'none';
    if ((status === 'playing' || status === 'check') && get().standardHistory) {
      judgment = judgeRepetition([...game.history, move]);
      if (judgment === 'draw') status = 'draw';
      else if (judgment !== 'none') status = 'perpetual';
    }
    const result = resultForMove(status, humanSide(), turn, judgment);
    const newGameState: GameState = {
      board,
      turn,
      history: [...game.history, move],
      status,
      moveCount: game.moveCount + 1,
    };

    set({
      game: newGameState,
      result,
      notice: null,
      hint: null,
      undoStack: [...get().undoStack, game],
      reviewIndex: null,
      // Input gate only — no spinner is rendered anywhere in the UI.
      thinking: true,
    });

    const seq = speechSequence;

    if (TERMINAL.includes(status)) {
      announceTurn(move, board, turn, status, result, () => {
        recordFinishedMatch(result, newGameState);
        set({ replay: analyze(newGameState.history, newGameState), thinking: false });
      });
      return true;
    }

    // Start thinking NOW, overlapping the player's 260ms flight animation.
    // The AI move is applied only after both the landing sound and the search
    // finish, so the board never freezes between the two moves.
    startAiSearch(newGameState);
    announceTurn(move, board, turn, status, result, () => {
      afterBeat(() => { void get()._aiMove(); }, AI_REPLY_GAP_MS, seq);
    });
    return true;
  },
  game: createInitialGame(),
  result: null,
  notice: null,
  standardHistory: true,
  setupError: null,
  thinking: false,
  hint: null,
  replay: null,
  undoStack: [],
  reviewIndex: null,

  newGame: () => {
    cancelSpeech();
    set({
      game: createInitialGame(),
      result: null,
      notice: null,
      standardHistory: true,
      setupError: null,
      thinking: false,
      hint: null,
      replay: null,
      undoStack: [],
      reviewIndex: null,
    });
  },

  beginGame: () => {
    get().newGame();
    // Black-side play: the AI (red) opens. The search starts immediately and
    // the move lands after the short reply beat, mirroring the player->AI flow.
    if (humanSide() === 'black') {
      const fresh = get().game;
      if (fresh.status !== 'playing' && fresh.status !== 'check') return;
      set({ thinking: true });
      const seq = speechSequence;
      startAiSearch(fresh);
      afterBeat(() => { void get()._aiMove(); }, AI_REPLY_GAP_MS, seq);
    }
  },

  loadPosition: (setup: string, turn: Side = 'red') => {
    // Gate 1: raw-string shape, so malformed tokens cannot be silently dropped
    // by Board.fromNotationSetup into a plausible-looking illegal position.
    const structural = validateSetupString(setup);
    if (structural.length > 0) {
      set({ setupError: `局面格式非法，已拒绝加载：${structural.join('；')}` });
      return false;
    }
    const board = parseSetup(setup);
    // Gate 2: full rule validation (C1..C6), including per-side piece limits
    // such as "at most two rooks" and both kings inside their own palaces.
    const validation = validatePosition(board, turn);
    if (!validation.valid) {
      // Refuse and keep the current game untouched -- never accept silently.
      set({ setupError: `非法局面，已拒绝加载：${validation.errors.join('；')}` });
      return false;
    }
    cancelSpeech();
    set({
      game: {
        board,
        turn,
        history: [],
        status: getGameStatus(board, turn),
        moveCount: 0,
      },
      result: null,
      notice: null,
      // positionKeysFor replays from the standard start; only trust the
      // repetition check when this game really did start from there.
      standardHistory: setup === INITIAL_SETUP,
      setupError: null,
      thinking: false,
      hint: null,
      replay: null,
      undoStack: [],
      reviewIndex: null,
    });
    return true;
  },

  loadPuzzle: (setup: string, turn: Side = 'red') => get().loadPosition(setup, turn),

  clearSetupError: () => set({ setupError: null }),

  _aiMove: async () => {
    const { game } = get();
    if (game.turn !== aiSide()) {
      set({ thinking: false });
      return;
    }

    // Wait for the search that began during the player's animation. If it was
    // cancelled (new game / undo) the token changes and we bail out safely.
    const search = pendingSearch;
    const seq = speechSequence;
    const move = search
      ? await search.promise
      : engine.getBestMove(game, defaultConfig(useSettings.getState().difficulty));
    if (seq !== speechSequence || get().game !== game) return;

    if (!move) {
      // The AI has no legal move: it loses (困毙). Record the human win.
      const result = terminalResult('stalemate', 'stalemate', humanSide());
      recordFinishedMatch(result, game);
      set({ result, replay: analyze(game.history, game), thinking: false });
      return;
    }

    const board = game.board.clone();
    board.applyMove(move);
    const turn: Side = humanSide();
    let status = getGameStatus(board, turn);
    let judgment: RepetitionJudgment = 'none';
    if ((status === 'playing' || status === 'check') && get().standardHistory) {
      judgment = judgeRepetition([...game.history, move]);
      if (judgment === 'draw') status = 'draw';
      else if (judgment !== 'none') status = 'perpetual';
    }
    const result = resultForMove(status, aiSide(), turn, judgment);
    const newGameState: GameState = {
      board,
      turn,
      history: [...game.history, move],
      status,
      moveCount: game.moveCount + 1,
    };
    set({ game: newGameState, result, reviewIndex: null });

    // The AI only appears on screen after the player's callout has finished.
    // Its own landing tap and callout run next, then the board accepts input.
    if (TERMINAL.includes(status)) {
      announceTurn(move, board, turn, status, result, () => {
        recordFinishedMatch(result, newGameState);
        set({ replay: analyze(newGameState.history, newGameState), thinking: false });
      });
      return;
    }
    announceTurn(move, board, turn, status, result, () => {
      set({ thinking: false });
    });
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    cancelSpeech();
    const prev = undoStack[undoStack.length - 1];
    set({
      game: prev,
      result: null,
      notice: null,
      undoStack: undoStack.slice(0, -1),
      hint: null,
      replay: null,
      thinking: false,
      reviewIndex: null,
    });
  },

  resign: () => {
    const { game, thinking } = get();
    if (thinking || TERMINAL.includes(game.status)) return;
    cancelSpeech();
    // The human loses; the AI is the winner. Status is mirrored to a terminal
    // value for the existing game-over gates, while `result.reason` keeps the
    // caption accurate ("认输" instead of "将死").
    const result = terminalResult('checkmate', 'resign', aiSide());
    const finishedGame: GameState = { ...game, status: 'checkmate' };
    recordFinishedMatch(result, finishedGame);
    set({
      game: finishedGame,
      result,
      notice: null,
      thinking: false,
      hint: null,
      replay: analyze(finishedGame.history, finishedGame),
    });
  },

  offerDraw: () => {
    const { game, thinking } = get();
    if (thinking || TERMINAL.includes(game.status)) return;
    if (game.turn !== humanSide()) return;
    // Positive scores are from the AI's perspective. A clear advantage (>= one
    // horse) declines; equal or losing positions accept.
    const aiScore: number = engine.evaluate(game, aiSide());
    if (aiScore >= DRAW_REJECT_SCORE) {
      set({ notice: '电脑局面占优，拒绝提和，请继续对局。' });
      return;
    }
    cancelSpeech();
    const result = terminalResult('draw', 'draw-agreed', null);
    const finishedGame: GameState = { ...game, status: 'draw' };
    recordFinishedMatch(result, finishedGame);
    set({
      game: finishedGame,
      result,
      notice: '对方接受提和，本局和棋。',
      thinking: false,
      hint: null,
      replay: analyze(finishedGame.history, finishedGame),
    });
  },

  clearNotice: () => set({ notice: null }),

  requestHint: () => {
    const { game } = get();
    if (game.turn !== humanSide()) return;
    if (game.status !== 'playing' && game.status !== 'check') return;
    const cfg = defaultConfig(useSettings.getState().difficulty);
    const hint = getHint(game, engine, cfg);
    if (useSettings.getState().tacticsHintEnabled) {
      set({ hint });
      return;
    }
    // 杀法提示关闭：keep the recommended move but replace tactic wording with
    // a plain evaluation-based explanation. Sentinel "no legal move" is passed
    // through unchanged because it cannot be replayed by applyMoveToState.
    if (hint.move.from.col < 0 || hint.move.to.col < 0) {
      set({ hint });
      return;
    }
    const before = engine.evaluate(game, game.turn);
    const after = engine.evaluate(applyMoveToState(game, hint.move), game.turn);
    set({ hint: { ...hint, explanation: renderByDelta(after - before) } });
  },

  requestReplay: () => {
    const { game } = get();
    if (game.history.length === 0) return;
    set({ replay: analyze(game.history, game) });
  },

  clearReplay: () => set({ replay: null }),

  setReviewIndex: (i: number) => {
    set({ reviewIndex: i, hint: null, replay: null });
  },

  exitReview: () => set({ reviewIndex: null }),

  pauseForHome: () => {
    cancelSpeech();
    // thinking 归零后棋盘重新可点；回到对局屏时由 resumeFromHome 重新上闸。
    set({ thinking: false, hint: null, replay: null, reviewIndex: null, notice: null });
  },

  resumeFromHome: () => {
    const { game, thinking } = get();
    if (thinking) return;
    if (TERMINAL.includes(game.status)) return;
    if (game.turn !== aiSide()) return;
    set({ thinking: true });
    const seq = speechSequence;
    startAiSearch(game);
    afterBeat(() => { void get()._aiMove(); }, AI_REPLY_GAP_MS, seq);
  },
  });
});
