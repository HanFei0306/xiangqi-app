/**
 * AI layer types: difficulty presets and the Engine interface.
 *
 * The Engine interface is the single integration point used by the store.
 * P1 can swap the self-built EngineImpl for a UCCI/elephant adapter without
 * touching the store.
 */

import type { GameState, Move, Side } from '../../../engine/types';

/** Difficulty tiers for the training opponent (weakest -> strongest). */
export type Difficulty = 'beginner' | 'easy' | 'intermediate' | 'master';

/** All difficulty tiers in canonical order (UI and validation share this). */
export const DIFFICULTIES: readonly Difficulty[] = [
  'beginner',
  'easy',
  'intermediate',
  'master',
];

/** Type guard: whether `value` is one of the supported difficulty tiers. */
export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

/** Configuration for a single AI search. */
export interface AIConfig {
  /** Which tier this config represents. */
  difficulty: Difficulty;
  /** Search depth (ply). */
  depth: number;
  /** Random perturbation magnitude applied when picking the best move (0..1). */
  randomness: number;
  /** Probability (0..1) of deliberately playing a weaker move. */
  mistakeRate: number;
  budgetMs?: number;
}

/**
 * Evaluator detail level. `leaf` is the cheap score used by every search leaf;
 * `full` adds pins, king-zone threats, coordination and space and is used by
 * public evaluation / analysis only. Both levels share the same source of
 * truth (`evalTerms.ts`) so the two evaluation paths can never drift apart.
 */
export type EvalDetail = 'leaf' | 'full';

/**
 * Incremental flat-board state shared by search and evaluation.
 * `mg`/`eg` are red-perspective tapered terms, `phase` is the 0..66 stage
 * counter, `key` is the Zobrist TT key, `kingSq[0/1]` caches the red/black
 * king square, and `pieceList`/`pieceIndex` keep ~32 active pieces hot.
 */
export interface FastState {
  /** Flat squares: 0 empty, +1..+7 red, -1..-7 black; sq = col*10+row. */
  squares: Int8Array;
  /** Incremental red-perspective middlegame PST score. */
  mg: number;
  /** Incremental red-perspective endgame PST score. */
  eg: number;
  /** Phase sum (66 at the initial position). */
  phase: number;
  /** Zobrist key including side to move. */
  key: number;
  /** The two 32-bit halves behind `key`, kept for O(1) incremental xor. */
  keyH1: number;
  keyH2: number;
  /** Cached king squares: index 0 = red, 1 = black; -1 when absent. */
  kingSq: Int8Array;
  /** Active piece codes (length 32; free slots hold 0). */
  pieceList: Int8Array;
  /** pieceIndex[sq] = slot in pieceList, or -1 when the square is empty. */
  pieceIndex: Int8Array;
  /** pieceSq[slot] = current square of that active piece (inverse map). */
  pieceSq: Int8Array;}

/** The unified engine interface consumed by the store. */
export interface Engine {
  /** Returns the best move for the side to move, or null if none. */
  getBestMove(state: GameState, cfg: AIConfig): Move | null;
  /**
   * Frame-yielding variant for the live match. Optional so simple test stubs
   * and alternate engines only need to implement the synchronous method.
   */
  getBestMoveAsync?(state: GameState, cfg: AIConfig, yieldFrame?: () => Promise<void>): Promise<Move | null>;
  /** Evaluates the position from `side`'s perspective (positive = good). */
  evaluate(state: GameState, side: Side): number;
}
