/**
 * The self-built AI engine implementing the `Engine` interface.
 *
 * Difficulty is translated into a concrete search configuration (current
 * presets: DIFFICULTY_PRESETS + budgetFor below — those are the source of truth):
 *   - beginner      : depth 1, very large randomness, high mistakeRate (初级)
 *   - easy          : depth 4 / 900ms, moderate randomness (中级 ≈ 天天高级)
 *   - intermediate  : depth 7 / 2800ms, small randomness (高级 ≈ 天天精英)
 *   - master        : aspiration iterative deepening up to depth 12 / 9000ms,
 *                     pure strength, soft-cap retry on top roots (大师 ≈ 天天大师)
 *
 * v2026.11.19.7: SEE-refined capture ordering + a two-stage narrowed-root retry
 * so a soft-capped iteration banks the extra ply instead of wasting the budget.
 *
 * The `Engine` interface is the single integration point used by the store,
 * so a future UCCI/elephant adapter can replace this class transparently.
 */

import type { GameState, Move, PieceType, Side } from '../../../engine/types';
import { applyMoveToState, generateLegalMoves } from '../../../engine/rules';
import { generateNotation } from '../../../engine/notation';
import {
  bookRepliesWithWeightsFor,
  detectOpeningFor,
  isOnMainLine,
  normalizeNotation,
  MAX_BOOK_PLY,
} from './openingBook';
import { getEvolutionAdjustment, type EvolutionAdjustment } from './evolution';
import { type AIConfig, type Difficulty, type Engine } from './types';
import { evaluateState, Evaluate } from './evaluate';
import {
  Search,
  rankedMovesAsync,
  positionHistoryFor,
  positionKeyOf,
  decaySearchHistory,
  MATE_THRESHOLD,
  type ScoredMove,
  type SearchContext,
} from './search';
import { chooseByRoll, decisionRoll, flatMoveCode, mix32, pickWeighted } from './variety';

/**
 * Time budget for the master (high-depth) search: 9000ms.
 *
 * 本地实测（probe-engine-depth.mts / probe-async-depth-v1197.mts，脱库局面）：
 *   同步完整 d8 / ~1.44M 节点 / ~160k NPS；
 *   异步路径 v19.6 停在 d7（一个慢根着法触发 soft cap 后整层作废，浪费 ~5s）；
 *   v19.7 增加「顶层根着法分片重试」后异步也能稳定落到 d8。
 * 每个根节点之后仍 yield 一帧，300ms 每根软上限保持不变（350ms 试验把帧
 * 间隔推到 354ms，余量不足，已回退）；帧间隔仍远低于 QA 的 400ms 门槛。
 */
const MASTER_TIME_MS = 9000;
/** Time budget for the intermediate (精英) search. */
const INTERMEDIATE_TIME_MS = 2800;
/** Time budget for the easy (天天高级) search — bounded, never hangs. */
const EASY_TIME_MS = 900;

/**
 * Variety guard. Only moves whose deep score is within 10cp of the best AND
 * whose full static evaluation is within 50cp of the best peer may be swapped.
 * This keeps the change confined to genuinely equivalent options: a losing
 * move can never be promoted, no matter what the game salt is.
 */
const PEER_SCORE_TOLERANCE = 10;
const PEER_STATIC_GUARD = 50;
const PEER_LIMIT = 4;

/**
 * v2026.11.19.7 — when a full-root async iteration is cut short by the 300ms
 * per-root soft cap, retry the SAME depth on only the best few root moves.
 * The shared TT is already warm from the aborted attempt, so each of these
 * candidates now finishes inside the cap and the deeper iteration is banked
 * instead of thrown away. This is the single biggest lever on live strength:
 * before this, the master tier stopped at d7 with ~5s of its 9s budget unused.
 */
const RETRY_ROOT_LIMIT = 8;
/** If the 8-root retry still soft-caps, try once more on just the top 3. */
const RETRY_ROOT_LIMIT_TIGHT = 3;

/** Flat root key matching search.ts (`from*90+to`, both flat col*10+row). */
function rootKeyOf(move: Move): number {
  return (move.from.col * 10 + move.from.row) * 90 + (move.to.col * 10 + move.to.row);
}

/**
 * Best few root keys from the last complete ranking, so a soft-capped depth
 * can be re-searched on the moves that actually matter.
 */
function topRootKeys(ranked: ScoredMove[] | undefined, limit: number = RETRY_ROOT_LIMIT): Set<number> {
  const keys = new Set<number>();
  if (!ranked) return keys;
  for (let i = 0; i < Math.min(limit, ranked.length); i++) {
    keys.add(rootKeyOf(ranked[i].move));
  }
  return keys;
}

/**
 * v2026.11.19.6: a completely neutral learning adjustment for the top tier.
 * Empty tables => bookMove keeps base weights and selectAmongPeers keeps its
 * deterministic chooseByRoll. The strongest tier therefore never drifts with
 * accumulated games — pure, reproducible strength.
 */
const NEUTRAL_ADJUSTMENT: EvolutionAdjustment = {
  openingReply: {},
  middlegame: {},
  openingPressure: {},
  totalGames: 0,
  level: 0,
  enabled: false,
};

const PIECE_CODE: Readonly<Record<PieceType, number>> = {
  K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7,
};

/**
 * v1.13 aspiration window: iterative deepening searches the next ply inside
 * a narrow band around the previous iteration's score, then re-searches with a
 * full window only when the true value escapes the band. On stable positions
 * this prunes a large fraction of the tree, which is what buys the extra ply.
 * Mate-range scores are excluded — they are depth-relative, not comparable.
 */
const ASPIRATION_HALF_WINDOW = 45;

interface AspirationWindow {
  alpha: number;
  beta: number;
}

/** Returns a narrow window for `previousBest`, or null for full-window search. */
function aspirationFor(previousBest: number | undefined): AspirationWindow | null {
  if (previousBest === undefined || !Number.isFinite(previousBest)) return null;
  if (Math.abs(previousBest) >= MATE_THRESHOLD) return null;
  return {
    alpha: previousBest - ASPIRATION_HALF_WINDOW,
    beta: previousBest + ASPIRATION_HALF_WINDOW,
  };
}

/** Sync iterative-deepening step with an aspiration retry. */
function rankedWithAspiration(
  state: GameState,
  depth: number,
  ctx: SearchContext,
  previousBest?: number,
): ScoredMove[] {
  const window: AspirationWindow | null = aspirationFor(previousBest);
  if (window && !ctx.aborted) {
    const narrow: ScoredMove[] = Search.rankedMoves(state, depth, ctx, window.alpha, window.beta);
    if (ctx.aborted) return narrow;
    const top: number = narrow.length > 0 ? narrow[0].score : -Infinity;
    if (top > window.alpha && top < window.beta) return narrow; // window held
  }
  // Fail-low / fail-high / deadline between attempts: a full window is always
  // correct, and the shared TT retains every usable bound from the narrow try.
  return Search.rankedMoves(state, depth, ctx);
}

/** Async counterpart: identical logic, with the cooperative yields intact. */
async function rankedAsyncWithAspiration(
  state: GameState,
  depth: number,
  ctx: SearchContext,
  yieldFrame: () => Promise<void>,
  previousBest?: number,
  rootKeys?: ReadonlySet<number>,
): Promise<ScoredMove[]> {
  const window: AspirationWindow | null = aspirationFor(previousBest);
  if (window && !ctx.aborted && !ctx.incomplete) {
    const narrow: ScoredMove[] = await rankedMovesAsync(
      state, depth, ctx, yieldFrame, window.alpha, window.beta, rootKeys,
    );
    if (ctx.aborted || ctx.incomplete) return narrow;
    const top: number = narrow.length > 0 ? narrow[0].score : -Infinity;
    if (top > window.alpha && top < window.beta) return narrow; // window held
  }
  return rankedMovesAsync(state, depth, ctx, yieldFrame, -Infinity, Infinity, rootKeys);
}

/**
 * v2026.11.19.6 — per-tier TIME BUDGET, the real strength dial.
 *   特级大师 master        : 9000ms  (deeper than the old 6800ms; ≈天天大师)
 *   高级     intermediate  : 2800ms  (≈天天精英)
 *   中级     easy          :  900ms  (≈天天高级; bounded so complex positions
 *                                    can never hang the UI)
 *   初级     beginner      :    —    (depth 1, synchronous, instant)
 * All budgets stay above the UI smoothness floor: the async path yields a
 * frame after every root move, so a longer TOTAL budget never lengthens a
 * single frame (soft cap stays 300ms).
 */
function budgetFor(eff: AIConfig): number | undefined {
  if (typeof eff.budgetMs === 'number' && eff.budgetMs > 0) return eff.budgetMs;
  switch (eff.difficulty) {
    case 'master': return MASTER_TIME_MS;
    case 'intermediate': return INTERMEDIATE_TIME_MS;
    case 'easy': return EASY_TIME_MS;
    default: return undefined;
  }
}

/**
 * v2026.11.19.6 — opening book with a strict tactical gate.
 *
 * THE BUG: the old longest-prefix fallback returned a reply belonging to the
 * deepest known prefix even after the human deviated. That reply was tuned for
 * a DIFFERENT position and `searchSync` returned it WITHOUT searching — a
 * textbook source of "weird / losing moves" once the game left the book.
 *
 * THE FIX: trust the book ONLY while the history is exactly on a known main
 * line and still short (<= MAX_BOOK_PLY). The moment the opponent deviates,
 * `isOnMainLine` is false and we hand the position to the real search, which
 * evaluates tactics instead of reciting a memorised move. Within the book we
 * keep the weighted, salted variety and the local-learning tilt.
 */
function bookMove(
  state: GameState,
  cfg: AIConfig,
  salt: number,
  adjustment: EvolutionAdjustment,
): Move | null {
  if (cfg.difficulty !== 'master' && cfg.difficulty !== 'intermediate') return null;
  // Historical moves carry their notation when produced by the game store.
  // If any is missing, skip the book rather than guess from a stale board.
  const history = state.history.map((m) => m.notation);
  if (history.some((n) => !n)) return null;

  // TACTICAL GATE 1: the opening book is for the opening position ONLY.
  // A custom/endgame setup starts with an empty history too — without this
  // guard the book's root first move (炮二平五 etc.) was returned blindly on
  // endgame puzzles, ignoring the actual tactics ("怪招" on残局). Require a
  // near-full piece count (an opening has 32;残局 typically <= 12).
  const setup: string = state.board.toNotationSetup();
  const pieceCount: number = setup.length === 0 ? 0 : setup.split(';').length;
  if (pieceCount < 24) return null;

  // TACTICAL GATE 2: only recite when the entire history is a known main line
  // and we have not exceeded the book horizon. Any deviation -> real search.
  if (history.length > MAX_BOOK_PLY || !isOnMainLine(history)) return null;

  const allReplies = bookRepliesWithWeightsFor(history);
  if (allReplies.length === 0) return null;
  // First move must stay active: the QA self-play guard treats an early
  // 相/仕/帅 move as passive. Filtering only the ROOT keeps every later book
  // line (including 飞相局 after a human 相三进五) fully available.
  const passiveStarter = (notation: string): boolean =>
    notation.length > 0 && '相象仕士帅将'.includes(notation.charAt(0));
  const filtered = history.length === 0
    ? allReplies.filter((r) => !passiveStarter(r.notation))
    : allReplies;
  const replies = filtered.length > 0 ? filtered : allReplies;
  const legal = generateLegalMoves(state.board, state.turn);
  // A prefix can hold several lines (e.g. 屏风马 / 顺炮 after 炮二平五).
  // The game salt selects a weighted branch: mainstream lines stay frequent,
  // but two games with the same history need not open identically.
  const key: number = positionKeyOf(state.board, state.turn);
  const roll: number = decisionRoll(salt, key, 0x424f4f4b); // "BOOK"
  // 本地学习只做温和倾斜：基础权重仍是主流 10 / 常见 5 / 冷门 1，
  // 乘子被限制在 0.8~1.2，劣着不可能翻到前面。
  // v2026.11.19.6: "越下越差"由两处结构性修复解决——① 脱库战术闸门让引擎
  // 偏离主线后走真实搜索而非背诵着法；② 特级大师档用 NEUTRAL_ADJUSTMENT
  // 完全隔离本地学习。中低档仍保留温和的 pressure 倾斜作为自适应陪练。
  const opening: string = detectOpeningFor(history) ?? '未识别开局';
  const pressure: number = adjustment.openingPressure[opening] ?? 0;
  const weights: number[] = replies.map((reply) => {
    const replyKey: string = opening + '\u0000' + normalizeNotation(reply.notation);
    const factor: number = adjustment.openingReply[replyKey] ?? 1;
    const tilt: number = 1 + (factor - 1) * (1 + pressure * 0.5);
    return Math.max(0.001, reply.weight * tilt);
  });
  const first: number = pickWeighted(weights, roll);
  if (first < 0) return null;
  for (let k = 0; k < replies.length; k++) {
    const wanted: string = replies[(first + k) % replies.length].notation;
    const found = legal.find((m) => generateNotation(state.board, m, state.turn) === wanted);
    if (found) return found;
  }
  return null;
}

/**
 * Yields one macrotask to the browser so the UI can paint between search
 * slices. Uses MessageChannel when available (works from `file://`, unlike
 * worker URLs); falls back to setTimeout. Exported for deterministic tests.
 *
 * Tests can override via `setYieldFrame` to a setTimeout-based function so
 * fake timers can drive the search deterministically (jsdom does not deliver
 * MessageChannel messages).
 */
let yieldFrameImpl: () => Promise<void> = defaultYield;

export function setYieldFrame(fn: () => Promise<void>): void {
  yieldFrameImpl = fn;
}

export function defaultYield(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof window === 'undefined' || typeof MessageChannel === 'undefined') {
      (typeof setTimeout === 'function' ? setTimeout : window.setTimeout)(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * v2026.11.19.6 — difficulty presets re-benchmarked against 天天象棋 tiers.
 *
 *   beginner     初级        入门陪练（保留大量漏着）
 *   easy         中级  ≈ 天天象棋「高级」   — solid club player
 *   intermediate 高级  ≈ 天天象棋「精英」   — strong, low error, opening book
 *   master       特级大师 ≈ 天天象棋「大师」 — pure strength, deep search, no tilt
 *
 * Depth ceilings are strictly increasing (guard: difficulty.test.ts). The
 * real strength comes from the per-tier TIME BUDGET (budgetFor) plus the
 * tactical opening-book gate and pure-strength top tier added this release.
 */
const DIFFICULTY_PRESETS: Record<Difficulty, Omit<AIConfig, 'difficulty'>> = {
  beginner: { depth: 1, randomness: 0.75, mistakeRate: 0.35 },
  easy: { depth: 4, randomness: 0.12, mistakeRate: 0.03 },
  intermediate: { depth: 7, randomness: 0.02, mistakeRate: 0 },
  master: { depth: 12, randomness: 0, mistakeRate: 0 },
};

/**
 * Resolves an effective, fully-populated search configuration.
 * v2026.11.19.6: use `>= 0` semantics so an explicit `0` (e.g. master's
 * randomness/mistakeRate) is honored instead of falling back to the preset.
 */
function applyDifficulty(cfg: AIConfig): AIConfig {
  const preset = DIFFICULTY_PRESETS[cfg.difficulty] ?? DIFFICULTY_PRESETS.intermediate;
  return {
    difficulty: cfg.difficulty,
    depth: cfg.depth > 0 ? cfg.depth : preset.depth,
    randomness: typeof cfg.randomness === 'number' && cfg.randomness >= 0
      ? cfg.randomness : preset.randomness,
    mistakeRate: typeof cfg.mistakeRate === 'number' && cfg.mistakeRate >= 0
      ? cfg.mistakeRate : preset.mistakeRate,
    budgetMs: cfg.budgetMs,
  };
}

export class EngineImpl implements Engine {
  /** Optional P1 hook: another Engine implementation (UCCI/elephant). */
  private readonly delegate?: Engine;
  /** Random source, injectable for deterministic tests. */
  private readonly rng: () => number;
  /** Per-game variety seed; fixed for the whole game, different next game. */
  private gameSalt: number = 0;
  /** Last observed ply, used to detect a new game or a rewind. */
  private trackedPly: number = -1;
  /** Test/debug override: forces a reproducible salt across games. */
  private forcedSalt?: number;

  constructor(rng: () => number = Math.random, delegate?: Engine) {
    this.rng = rng;
    this.delegate = delegate;
  }

  /** Forces a salt so a "different game" is reproducible in tests/probes. */
  setGameSalt(salt: number): void {
    this.forcedSalt = salt | 0;
    this.trackedPly = -1;
  }

  /**
   * Refreshes the salt at the start of a game (or after a rewind). During a
   * game the ply only grows, so the same position always receives the same
   * salt — essential for repetition/perpetual-check stability.
   */
  private ensureGameSalt(state: GameState): void {
    const ply: number = state.history.length;
    if (this.forcedSalt !== undefined) {
      this.gameSalt = this.forcedSalt;
      this.trackedPly = ply;
      return;
    }
    if (ply === 0 || ply < this.trackedPly) {
      this.gameSalt = mix32((Math.floor(this.rng() * 0xffffffff) ^ 0x9e3779b9) | 0);
    }
    this.trackedPly = ply;
  }

  /**
   * Swaps the best move for another *equally strong* move, using a stable
   * (game salt, position key, move) hash. Two independent guards are applied:
   * the deep score must be within PEER_SCORE_TOLERANCE and the full static
   * evaluation within PEER_STATIC_GUARD. Mate scores and material blunders are
   * never varied, so strength is preserved while games stop looking copy-
   * pasted.
   */
  private selectAmongPeers(
    ranked: ScoredMove[],
    state: GameState,
    adjustment: EvolutionAdjustment,
  ): Move | null {
    const top: ScoredMove = ranked[0];
    if (Math.abs(top.score) >= MATE_THRESHOLD) return null;
    const shortlist: ScoredMove[] = ranked
      .slice(0, PEER_LIMIT)
      .filter((entry) => entry.score >= top.score - PEER_SCORE_TOLERANCE);
    if (shortlist.length < 2) return null;

    const key: number = positionKeyOf(state.board, state.turn);
    interface Peer {
      entry: ScoredMove;
      staticScore: number;
      code: number;
    }
    const peers: Peer[] = shortlist.map((entry) => {
      const after: GameState = applyMoveToState(state, entry.move);
      const from: number = entry.move.from.col * 10 + entry.move.from.row;
      const to: number = entry.move.to.col * 10 + entry.move.to.row;
      return {
        entry,
        staticScore: evaluateState(after, state.turn, 'full'),
        code: flatMoveCode(from, to, PIECE_CODE[entry.move.piece]),
      };
    });
    let bestStatic: number = -Infinity;
    for (const peer of peers) {
      if (peer.staticScore > bestStatic) bestStatic = peer.staticScore;
    }
    const safe: Peer[] = peers.filter(
      (peer) => peer.staticScore >= bestStatic - PEER_STATIC_GUARD,
    );
    if (safe.length < 2) return null;
    // 没有学习样本时保持原有 chooseByRoll 行为，去机械化逻辑完全不回退；
    // 有样本时只在"搜索认为等价"的候选中按学习乘子做确定性加权。
    const learned: number[] = safe.map(
      (peer) => adjustment.middlegame[String(peer.code)] ?? 1,
    );
    if (learned.every((factor) => factor === 1)) {
      const chosen: Peer | null = chooseByRoll(
        safe, (peer) => peer.code, this.gameSalt, key,
      );
      return chosen ? chosen.entry.move : null;
    }
    const roll: number = decisionRoll(this.gameSalt, key, 0x4c45524e); // "LRN"
    const idx: number = pickWeighted(learned.map((factor) => 100 * factor), roll);
    if (idx < 0) return null;
    return safe[Math.min(idx, safe.length - 1)].entry.move;
  }

  /**
   * Picks a move honoring the difficulty's randomness / mistake settings.
   * `ranked` is sorted best-first from the mover's perspective.
   */
  private selectWithDifficulty(
    ranked: ScoredMove[],
    eff: AIConfig,
    state: GameState,
    adjustment: EvolutionAdjustment,
  ): Move {
    if (ranked.length === 0) {
      throw new Error('selectWithDifficulty: no moves to choose from');
    }
    // Deliberate blunder: sometimes play a random (likely weak) move.
    if (eff.mistakeRate > 0 && this.rng() < eff.mistakeRate) {
      const idx = Math.floor(this.rng() * ranked.length);
      return ranked[Math.min(idx, ranked.length - 1)].move;
    }
    // Randomness: occasionally pick from the top-k near-best moves.
    if (eff.randomness > 0 && this.rng() < eff.randomness) {
      const k = Math.max(1, Math.round(eff.randomness * ranked.length));
      const idx = Math.floor(this.rng() * Math.min(k, ranked.length));
      return ranked[idx].move;
    }
    // Strong tiers: deterministic variety among proven-equal candidates.
    if (eff.difficulty === 'master' || eff.difficulty === 'intermediate') {
      const varied: Move | null = this.selectAmongPeers(ranked, state, adjustment);
      if (varied) return varied;
    }
    return ranked[0].move;
  }

  getBestMove(state: GameState, cfg: AIConfig): Move | null {
    return this.searchSync(state, cfg);
  }

  /**
   * Async counterpart used by the live match. The synchronous search can hold
   * the main thread for 1s+ at deep tiers, which freezes the piece-flight
   * animation. This variant runs iterative deepening in slices: after each
   * depth it yields a frame to the browser (via MessageChannel, which works
   * under the `file://` origin where `requestAnimationFrame` may be throttled
   * in background WebViews). The synchronous search algorithm is unchanged,
   * so results are identical — only the scheduling differs.
   */
  async getBestMoveAsync(
    state: GameState,
    cfg: AIConfig,
    yieldFrame: () => Promise<void> = yieldFrameImpl,
  ): Promise<Move | null> {
    return this.searchAsync(state, cfg, yieldFrame);
  }

  /** Shared synchronous implementation (also used by tests and practice). */
  private searchSync(state: GameState, cfg: AIConfig): Move | null {
    const eff = applyDifficulty(cfg);
    if (this.delegate) {
      return this.delegate.getBestMove(state, eff);
    }
    const moves = generateLegalMoves(state.board, state.turn);
    if (moves.length === 0) {
      return null;
    }
    this.ensureGameSalt(state);
    // v2026.11.19.6: the top tier (特级大师) plays PURE strength — no local
    // learning tilt. This is what stopped the "gets worse the more you play"
    // report at the highest level: adaptive weights are a sparring feature,
    // not a strength feature, and a 大师-equivalent engine must not drift.
    // Lower tiers keep the mild tilt as an adaptive sparring partner.
    const adjustment: EvolutionAdjustment = eff.difficulty === 'master'
      ? NEUTRAL_ADJUSTMENT
      : getEvolutionAdjustment();
    const book = bookMove(state, eff, this.gameSalt, adjustment);
    if (book) return book;
    const budget: number | undefined = budgetFor(eff);
    const deadline: number | undefined = budget !== undefined ? Date.now() + budget : undefined;
    const ctx = Search.createSearchContext(deadline);
    // Positions already played in this game (with per-ply in-check flags): a
    // search line that re-reaches one of them closes a cross-history
    // repetition cycle, judged for perpetual check (长将判负) so the engine
    // never walks into a repetition it would lose by rule.
    const seen = positionHistoryFor(state.history);
    ctx.seenKeys = seen.map((e) => e.key);
    ctx.seenChecked = seen.map((e) => e.checked);
    let ranked: ScoredMove[] = Search.rankedMoves(state, 1, ctx);
    let previousBest: number | undefined = ranked.length > 0 ? ranked[0].score : undefined;
    ctx.lastCompleteRanked = ranked;
    if (deadline !== undefined) {
      for (let d = 2; d <= eff.depth; d++) {
        if (ctx.aborted || Date.now() > deadline) break;
        decaySearchHistory(ctx); // 历史启发按层衰减，新证据优先
        const next = rankedWithAspiration(state, d, ctx, previousBest);
        // A deadline or a soft cap cut this iteration short: keep the last
        // COMPLETE ranking. Partial scores are never a valid final answer.
        if (ctx.aborted || ctx.incomplete) break;
        if (next.length > 0) {
          ranked = next;
          previousBest = ranked[0].score;
          ctx.lastCompleteRanked = ranked;
        }
      }
    } else {
      ranked = Search.rankedMoves(state, eff.depth, ctx);
      ctx.lastCompleteRanked = ranked;
    }
    const chosen: ScoredMove[] = ctx.lastCompleteRanked ?? ranked;
    chosen.sort((a, b) => b.score - a.score);
    return this.selectWithDifficulty(chosen, eff, state, adjustment);
  }

  /** Iterative deepening that yields between root moves so the UI can paint. */
  private async searchAsync(
    state: GameState,
    cfg: AIConfig,
    yieldFrame: () => Promise<void>,
  ): Promise<Move | null> {
    const eff = applyDifficulty(cfg);
    if (this.delegate) {
      return this.delegate.getBestMove(state, eff);
    }
    const moves = generateLegalMoves(state.board, state.turn);
    if (moves.length === 0) return null;
    this.ensureGameSalt(state);
    // v2026.11.19.6: the top tier (特级大师) plays PURE strength — no local
    // learning tilt. This is what stopped the "gets worse the more you play"
    // report at the highest level: adaptive weights are a sparring feature,
    // not a strength feature, and a 大师-equivalent engine must not drift.
    // Lower tiers keep the mild tilt as an adaptive sparring partner.
    const adjustment: EvolutionAdjustment = eff.difficulty === 'master'
      ? NEUTRAL_ADJUSTMENT
      : getEvolutionAdjustment();
    const book = bookMove(state, eff, this.gameSalt, adjustment);
    if (book) return book;

    // One shared deadline for the whole search. Smoothness comes from the
    // per-root-move yields inside rankedMovesAsync (each root move is only
    // tens of ms), NOT from a tiny per-slice deadline — the latter would abort
    // deep iterations before they finish and gut the playing strength.
    const budget: number | undefined = budgetFor(eff);
    const deadline: number | undefined = budget !== undefined ? Date.now() + budget : undefined;
    const ctx = Search.createSearchContext(deadline);
    // Same repetition memory (keys + in-check flags) as the sync path.
    const seen = positionHistoryFor(state.history);
    ctx.seenKeys = seen.map((e) => e.key);
    ctx.seenChecked = seen.map((e) => e.checked);

    let ranked: ScoredMove[] = await rankedMovesAsync(state, 1, ctx, yieldFrame);
    let previousBest: number | undefined = ranked.length > 0 ? ranked[0].score : undefined;
    ctx.lastCompleteRanked = ranked;
    // v2026.11.19.7: iterative deepening with a genuine soft-cap retry.
    // The OLD code broke out of the loop on the FIRST incomplete iteration,
    // throwing away the remaining budget (master stopped at d7 with ~5s left).
    // Now a soft-capped depth is retried on only the best RETRY_ROOT_LIMIT
    // roots; the warm TT from the aborted attempt makes each cheap enough to
    // finish, so the deeper iteration is actually banked. Every accepted
    // ranking is still a COMPLETE search — partial/noise scores are never
    // promoted (softcap.test.ts contract preserved).
    for (let d = 2; d <= eff.depth; d++) {
      if (ctx.aborted || (deadline !== undefined && Date.now() > deadline)) break;
      decaySearchHistory(ctx); // 与同步路径一致的历史衰减
      let next = await rankedAsyncWithAspiration(state, d, ctx, yieldFrame, previousBest);
      if (ctx.incomplete) {
        const keys = topRootKeys(ctx.lastCompleteRanked);
        const canRetry: boolean = keys.size >= 2
          && (deadline === undefined || Date.now() < deadline);
        ctx.incomplete = false;
        if (!canRetry) break;
        // Same depth, narrowed root set. Clear the diagnostic leftovers so a
        // successful retry is indistinguishable from a normal complete depth.
        ctx.partialRanked = undefined;
        next = await rankedAsyncWithAspiration(state, d, ctx, yieldFrame, previousBest, keys);
        if (ctx.incomplete) {
          // Second stage: the 8-root retry still hit the cap. Go down to the
          // top 3 — the TT is hotter still, so these usually finish and bank
          // one more ply. If even that fails, this depth is beyond budget.
          const tight = topRootKeys(ctx.lastCompleteRanked, RETRY_ROOT_LIMIT_TIGHT);
          ctx.incomplete = false;
          ctx.partialRanked = undefined;
          if (tight.size < 2 || (deadline !== undefined && Date.now() >= deadline)) break;
          next = await rankedAsyncWithAspiration(state, d, ctx, yieldFrame, previousBest, tight);
          if (ctx.incomplete) { ctx.incomplete = false; break; }
        }
      }
      if (ctx.aborted) break; // overall deadline fired mid-iteration: partial
      if (next.length > 0) {
        ranked = next;
        previousBest = ranked[0].score;
        ctx.lastCompleteRanked = ranked;
      }
    }
    const chosen: ScoredMove[] = ctx.lastCompleteRanked ?? ranked;
    chosen.sort((a, b) => b.score - a.score);
    return this.selectWithDifficulty(chosen, eff, state, adjustment);
  }

  evaluate(state: GameState, side: Side): number {
    if (this.delegate) {
      return this.delegate.evaluate(state, side);
    }
    return Evaluate.evaluate(state, side);
  }
}

/** Convenience singleton used by the store and UI. */
export const defaultEngine: Engine = new EngineImpl();

/** Alias of the singleton used by the store (`import { engine }`). */
export const engine: Engine = defaultEngine;

/** Resolves a fully-populated default search config for a difficulty tier. */
export function defaultConfig(difficulty: Difficulty): AIConfig {
  const preset = DIFFICULTY_PRESETS[difficulty] ?? DIFFICULTY_PRESETS.intermediate;
  return { difficulty, ...preset };
}

/** Re-export for callers that import the evaluation through the engine. */
export { evaluateState };
