/**
 * Types for the training / analysis layer: hints, replay annotations and
 * tactic detection. The layer is pure TypeScript and depends only on the
 * engine and AI layers.
 */

import type { GameState, Move, Pos } from '../engine/types';

/** A recommended move plus a short (<= 30 chars) Chinese explanation. */
export interface HintResult {
  move: Move;
  explanation: string;
}

/** Kinds of tactic the matcher can recognise. */
export type TacticKind = 'sacrifice' | 'fork' | 'check' | 'blunder';

/** A detected tactic, with the relevant squares. */
export interface TacticMatch {
  kind: TacticKind;
  squares: Pos[];
}

/** Tags used in replay annotations. */
export type ReplayTag =
  | 'checkmate'
  | 'sacrifice'
  | 'fork'
  | 'check'
  | 'blunder'
  | 'normal';

/** A single annotated step in an auto-generated replay. */
export interface ReplayAnnotation {
  /** Index into the move history (0-based). */
  moveIndex: number;
  /** Short tag classifying the move. */
  tag: ReplayTag;
  /** Chinese explanation of the gain/loss. */
  comment: string;
}

/** A hint provider: given a state and engine, returns a hint. */
export interface HintProvider {
  getHint(state: GameState, engine: import('../ai/types').Engine, cfg: import('../ai/types').AIConfig): HintResult;
}

/** A replay analyzer. */
export interface ReplayAnalyzer {
  analyze(history: Move[], finalState: GameState): ReplayAnnotation[];
}
