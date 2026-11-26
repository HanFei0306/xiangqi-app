/**
 * Pikafish native engine adapter (pikafish-nc non-commercial builds only).
 *
 * v2026.11.23.1: selected automatically whenever nativeEngineAvailable() is
 * true (i.e. the real libpikafish_nc.so was loaded and the NNUE network
 * initialised). This is the strongest engine and is now the live decision
 * maker on nc builds; the TypeScript engine remains the fallback when the
 * native bridge is absent. The adapter translates between our Board/Move
 * model and the UCI-style JS bridge exposed by MainActivity. Search runs
 * asynchronously on the native side so deep thinking never freezes the UI.
 */

import type { Board } from '../engine/board';
import type { GameState, Move, PieceType, Side } from '../engine/types';
import { generateLegalMoves } from '../engine/rules';
import type { AIConfig, Difficulty, Engine } from './types';
import { Evaluate } from './evaluate';

interface NativeBridge {
  pikafish?: (request: string) => string;
  pikafishAsync?: (request: string, callbackId: string) => void;
  status?: () => string;
}

/** JS-side registry for in-flight async native searches (v2026.11.23.1). */
type ResolveFn = (raw: string) => void;
const pendingSearches = new Map<string, { resolve: ResolveFn; timer: ReturnType<typeof setTimeout> }>();
let searchSeq = 0;

/** Installed once when a native async search starts; called back from Java. */
function ensureResolveHook(api: NativeBridge): void {
  const w = window as unknown as { __pikafishResolve?: (id: string, raw: string) => void };
  if (typeof w.__pikafishResolve === 'function') return;
  w.__pikafishResolve = (id: string, raw: string) => {
    const entry = pendingSearches.get(id);
    if (!entry) return;
    pendingSearches.delete(id);
    clearTimeout(entry.timer);
    entry.resolve(raw);
  };
  void api;
}

/** Parse a "bestmove xxxx" reply into a legal Move for the current position. */
function parseBestMove(raw: string, state: GameState): Move | null {
  const match = /(?:^|\n)bestmove\s+([a-i][0-9][a-i][0-9]|\(none\))/.exec(raw);
  if (!match || match[1] === '(none)') return null;
  const from = uciToCoord(match[1].slice(0, 2));
  const to = uciToCoord(match[1].slice(2, 4));
  if (!from || !to) return null;
  return generateLegalMoves(state.board, state.turn).find(
    (m) => m.from.col === from.col && m.from.row === from.row
      && m.to.col === to.col && m.to.row === to.row,
  ) ?? null;
}

function bridge(): NativeBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { XiangqiNative?: NativeBridge }).XiangqiNative ?? null;
}

export function nativeEngineAvailable(): boolean {
  const api = bridge();
  if (!api || (typeof api.pikafish !== 'function' && typeof api.pikafishAsync !== 'function')) return false;
  // A pikafish-nc build reports this status after loading the NNUE network.
  // The self build only has the skeleton bridge and never reports it.
  const status = typeof api.status === 'function' ? api.status() : '';
  return status.includes('PIKAFISH_NC_READY');
}

const FEN_CHAR: Readonly<Record<Side, Readonly<Record<PieceType, string>>>> = {
  red: { K: 'K', A: 'A', B: 'B', N: 'N', R: 'R', C: 'C', P: 'P' },
  black: { K: 'k', A: 'a', B: 'b', N: 'n', R: 'r', C: 'c', P: 'p' },
};

/** 9-column, 10-row board -> 9-rank UCI FEN (black rank 9 first). */
export function boardToFen(board: Board, turn: Side, halfmove = 0, fullmove = 1): string {
  const ranks: string[] = [];
  for (let row = 9; row >= 0; row--) {
    let rank = '';
    let empty = 0;
    for (let col = 0; col < 9; col++) {
      const piece = board.getPiece({ col, row });
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) { rank += String(empty); empty = 0; }
      rank += FEN_CHAR[piece.side][piece.type];
    }
    if (empty > 0) rank += String(empty);
    ranks.push(rank);
  }
  return `${ranks.join('/')} ${turn === 'red' ? 'w' : 'b'} - - ${halfmove} ${fullmove}`;
}

function square(col: number, row: number): string {
  return `${String.fromCharCode(97 + col)}${row}`;
}

export function moveToUci(move: Move): string {
  return square(move.from.col, move.from.row) + square(move.to.col, move.to.row);
}

function uciToCoord(s: string): { col: number; row: number } | null {
  if (s.length !== 2) return null;
  const col = s.charCodeAt(0) - 97;
  const row = s.charCodeAt(1) - 48;
  if (col < 0 || col > 8 || row < 0 || row > 9) return null;
  return { col, row };
}

function searchPlan(cfg: AIConfig): { depth: number; movetime: number } {
  // v2026.11.21.2 — depth cap was starving the movetime budget. UCI stops on
  // whichever limit is hit FIRST: the old depth20 ceiling ended a 6000ms
  // search at ~2.4s (depth 20), wasting >half the budget. Measured on a single
  // thread (~phone speed): depth20 = 2.4s, but movetime6000/depth30 = depth25
  // at 6.8s. Raising ONLY the depth ceiling keeps the wait time ~unchanged
  // while letting the engine actually spend its budget (20 -> 25 plies).
  // movetime remains the real wall-clock guard so a weak phone never freezes.
  // v21.7: 推演/记谱自动走子用短预算（<=1.2s/步），档位越高给稍多时间，
  // 避免特级大师 9 秒单步在连续推演时卡死。正式对局完全不受影响。
  if (cfg.fastMode) {
    switch (cfg.difficulty) {
      case 'beginner': return { depth: 6, movetime: 200 };
      case 'easy': return { depth: 12, movetime: 500 };
      case 'intermediate': return { depth: 18, movetime: 800 };
      case 'master': return { depth: 22, movetime: 1200 };
      default: return { depth: 12, movetime: 600 };
    }
  }
  switch (cfg.difficulty) {
    case 'beginner': return { depth: 4, movetime: 120 };
    case 'easy': return { depth: 18, movetime: 800 };
    // intermediate: depth16 used ~1.3s of its 3000ms; depth26 reaches ~24 plies.
    // v21.6: 时间预算上调——诊断证实更多时间=更深搜索=更强（8s≈25层 vs 6s≈22层）。
    // v22.8: 高级档 5s→6.5s——用户默认档，加深搜索减少输给业余棋手。
    case 'intermediate': return { depth: 34, movetime: 6500 };
    // v2026.11.23.5: 大师档 14s→4s（用户明确要求 6 秒内响应）。
    // 深度上限 44→36：仍高于高级档 34（保持深度单调契约）；4 秒内桌面
    // Pikafish 实测约到 d22-24，36 只是不绑定的余量，不是承诺达到的深度。
    case 'master': return { depth: 36, movetime: 4000 };
    default: return { depth: 10, movetime: 1200 };
  }
}

/**
 * 档位契约只读入口：返回正式对局（非 fastMode）的权威搜索计划。
 * 只暴露既有 searchPlan 的结果，不复制第二份参数、不改变任何搜索行为。
 */
export function searchPlanForDifficulty(difficulty: Difficulty): { depth: number; movetime: number } {
  return searchPlan({ difficulty, depth: 0, randomness: 0, mistakeRate: 0 });
}

/** 异步原生搜索的兜底超时公式（保留 wall-clock 上限，防止 WebView 卡死）。 */
export function nativeTimeoutMs(budgetMs?: number): number {
  const planBudgetMs: number = typeof budgetMs === 'number' && budgetMs > 0 ? budgetMs : 16000;
  return Math.max(planBudgetMs + 6000, 8000);
}

export class PikafishEngine implements Engine {
  /** Build the UCI request for the CURRENT position (never replay history). */
  private requestFor(state: GameState, cfg: AIConfig): string {
    const fen = boardToFen(state.board, state.turn);
    const plan = searchPlan(cfg);
    return `depth ${plan.depth}\nmovetime ${plan.movetime}\nfen ${fen}\nmoves`;
  }

  /**
   * Synchronous fallback. Kept for the Engine interface and unit tests; live
   * UI code must use getBestMoveAsync so master-depth search cannot freeze the
   * WebView thread.
   */
  getBestMove(state: GameState, cfg: AIConfig): Move | null {
    const api = bridge()?.pikafish;
    if (!api) return null;
    return parseBestMove(api(this.requestFor(state, cfg)), state);
  }

  /**
   * v2026.11.23.1 — TRUE async native search. The Java bridge runs the JNI
   * search on a background thread and calls back window.__pikafishResolve;
   * meanwhile this promise stays pending WITHOUT blocking the UI thread, so
   * the board, thinking indicator and buttons keep rendering during deep search.
   * A per-difficulty timeout is the last-resort guard: if the bridge never
   * calls back (old APK / torn-down WebView), resolve to null and let the caller
   * fall back instead of hanging forever.
   */
  async getBestMoveAsync(state: GameState, cfg: AIConfig): Promise<Move | null> {
    const api = bridge();
    if (!api || typeof api.pikafishAsync !== 'function') {
      // Old bridge without the async method: synchronous fallback.
      return this.getBestMove(state, cfg);
    }
    ensureResolveHook(api);
    const callbackId = `pikafish-${Date.now()}-${++searchSeq}`;
    const timeoutMs = nativeTimeoutMs(cfg.budgetMs);
    const request = this.requestFor(state, cfg);
    const raw = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        pendingSearches.delete(callbackId);
        resolve('bestmove (none)');
      }, timeoutMs);
      pendingSearches.set(callbackId, { resolve, timer });
      try {
        api.pikafishAsync!(request, callbackId);
      } catch {
        pendingSearches.delete(callbackId);
        clearTimeout(timer);
        resolve('bestmove (none)');
      }
    });
    return parseBestMove(raw, state);
  }

  evaluate(state: GameState, side: Side): number {
    return Evaluate.evaluate(state, side);
  }
}
