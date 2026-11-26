/**
 * Move hint generation for the training layer.
 *
 * `getHint` asks the engine for the best move, then explains it: if the move
 * matches a known tactic it uses the tactic template, otherwise it explains
 * based on the evaluation delta (gain/loss) from the mover's perspective.
 */

import type { GameState, Move } from '../engine/types';
import type { AIConfig, Engine } from '../ai/types';
import { applyMoveToState } from '../engine/rules';
import { match } from './tactics';
import { renderTactic, renderByDelta } from './templates';
import type { HintResult } from './types';

/** A sentinel move used when no legal move exists. */
function noMove(): Move {
  return {
    from: { col: -1, row: -1 },
    to: { col: -1, row: -1 },
    piece: 'P',
    captured: null,
    notation: '',
  };
}

/**
 * Returns a recommended move plus a short Chinese explanation (<= 30 chars).
 * Fills `move.notation` via a throwaway clone so the UI can display it.
 */
export function getHint(state: GameState, engine: Engine, cfg: AIConfig): HintResult {
  const best = engine.getBestMove(state, cfg);
  if (!best) {
    return { move: noMove(), explanation: '当前无合法着法' };
  }
  const move: Move = { ...best };
  // Fill notation without mutating the real board.
  state.board.clone().applyMove(move);

  const tactic = match(state, move);
  let explanation: string;
  if (tactic) {
    explanation = renderTactic(tactic.kind, move);
  } else {
    const before = engine.evaluate(state, state.turn);
    const after = engine.evaluate(applyMoveToState(state, move), state.turn);
    explanation = renderByDelta(after - before);
  }
  return { move, explanation };
}

/** Hint provider namespace mirroring the class diagram `Hint`. */
export const Hint = { getHint };
