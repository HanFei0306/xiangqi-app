/**
 * Chinese explanation templates for hints and replay comments.
 * Every returned string is kept <= 30 characters as required by the spec.
 */

import type { Move } from '../engine/types';
import type { TacticKind } from './types';

/** Template text for each tactic kind. */
const TACTIC_TEMPLATE: Record<TacticKind, string> = {
  sacrifice: '弃子引离，抢先夺势',
  fork: '一子双吃，得子占优',
  check: '将军！迫使对方应对',
  blunder: '贸然送子，损失不小',
};

/** Renders the explanation for a detected tactic. */
export function renderTactic(kind: TacticKind, _move?: Move): string {
  return TACTIC_TEMPLATE[kind];
}

/**
 * Renders an explanation from an evaluation delta (used for ordinary moves).
 * Positive delta = good for the mover.
 */
export function renderByDelta(delta: number): string {
  if (delta >= 200) {
    return '局面占优，继续扩大先手';
  }
  if (delta <= -200) {
    return '局势被动，需谨慎应对';
  }
  return '平稳过渡，寻机进取';
}

/** Generic comment for a normal (non-tactical) step in a replay. */
export function renderNormal(): string {
  return '平稳的一手，未见明显得失';
}
