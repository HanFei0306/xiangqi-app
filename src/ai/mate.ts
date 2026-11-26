/**
 * Forced-mate solver (v2026.11.19.8).
 *
 * The ordinary alpha-beta search scores a quiet mating move the same as any
 * other quiet move at the horizon, so it can walk past a one-move kill. This
 * module runs an explicit PROOF search: a line only counts as a mate when EVERY
 * legal defence has been refuted. That is the difference between "looks good"
 * and "is forced" — exactly what 残局杀棋判断 requires.
 *
 * Uses the public rules layer (legal move generation + checkStatus) so the
 * proof agrees with the game's own rule source. Bounded by plies and a
 * deadline; no external engine / Worker / WASM (file:// WebView constraint).
 */
import type { GameState, Move, Side } from '../engine/types';
import { opponent } from '../engine/types';
import { applyMoveToState, generateLegalMoves } from '../engine/rules';

/** A verified forced mate: `move` is the first move, `plies` its forced length. */
export interface MateResult {
  move: Move;
  /** 1 = mate in 1 (immediate), 3 = mate in 2, 5 = mate in 3. */
  plies: number;
}

/** Defender is lost when checkmated OR stalemated (困毙判负 in Xiangqi). */
function defenderLost(state: GameState): boolean {
  return state.status === 'checkmate' || state.status === 'stalemate';
}

/** Cheap ordering: captures, then moves that give check, then the rest. */
function orderCandidates(state: GameState, moves: Move[]): Move[] {
  const scored: Array<{ move: Move; score: number }> = moves.map((move) => {
    const after = applyMoveToState(state, move);
    let score = 0;
    if (defenderLost(after)) score = 1000;
    else if (after.status === 'check') score = 500;
    if (move.captured) score += 100;
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((e) => e.move);
}

/**
 * Proof search: can `side` force the defence to be lost within `pliesLeft`
 * own-moves? Returns the forced length in plies, or null if not proven.
 */
function proveMate(
  state: GameState,
  side: Side,
  pliesLeft: number,
  deadline: number | undefined,
  nodes: { value: number },
): number | null {
  if (pliesLeft <= 0) return null;
  if (deadline !== undefined && (nodes.value++ & 255) === 0 && Date.now() > deadline) return null;

  const moves: Move[] = generateLegalMoves(state.board, state.turn);
  if (moves.length === 0) return null;
  const ordered: Move[] = orderCandidates(state, moves);

  let best: number | null = null;
  for (const move of ordered) {
    const after = applyMoveToState(state, move);
    if (deadline !== undefined && Date.now() > deadline) break;

    // Immediate mate / stalemate: shortest possible proof.
    if (defenderLost(after)) {
      if (best === null || 1 < best) best = 1;
      // A mate-in-1 is optimal — no need to look at slower lines.
      return 1;
    }
    if (pliesLeft < 2) continue;

    // Every defence must fail; one escape refutes this candidate.
    const defences: Move[] = generateLegalMoves(after.board, after.turn);
    if (defences.length === 0) {
      // Defender has no move (stalemate) — should already be caught above,
      // but guard the rule source's edge cases defensively.
      if (best === null || 1 < best) best = 1;
      continue;
    }
    let worstReply: number = 0;
    let allRefuted: boolean = true;
    for (const defence of defences) {
      const afterDefence = applyMoveToState(after, defence);
      if (deadline !== undefined && Date.now() > deadline) {
        allRefuted = false;
        break;
      }
      const sub: number | null = proveMate(
        afterDefence, side, pliesLeft - 1, deadline, nodes,
      );
      if (sub === null) {
        allRefuted = false;
        break;
      }
      if (sub + 1 > worstReply) worstReply = sub + 1;
    }
    if (allRefuted) {
      const total: number = 1 + worstReply;
      if (best === null || total < best) best = total;
    }
  }
  return best;
}

/**
 * Finds the shortest verified forced mate for `side`, trying mate-in-1 first,
 * then mate-in-2, then (optionally) mate-in-3.
 *
 * IMPORTANT: `state.turn` must equal `side` (it is the side to move).
 */
export function findForcedMate(
  state: GameState,
  side: Side,
  options: { maxOwnMoves?: number; timeMs?: number } = {},
): MateResult | null {
  if (state.turn !== side) return null;
  const maxOwnMoves: number = Math.max(1, Math.min(3, options.maxOwnMoves ?? 2));
  const deadline: number | undefined = options.timeMs
    ? Date.now() + Math.max(1, options.timeMs)
    : undefined;
  const nodes = { value: 0 };

  for (let ownMoves = 1; ownMoves <= maxOwnMoves; ownMoves++) {
    const moves: Move[] = generateLegalMoves(state.board, state.turn);
    const ordered: Move[] = orderCandidates(state, moves);
    for (const move of ordered) {
      if (deadline !== undefined && Date.now() > deadline) return null;
      const after = applyMoveToState(state, move);
      if (defenderLost(after)) return { move, plies: 1 };
      if (ownMoves === 1) continue;

      const defences: Move[] = generateLegalMoves(after.board, after.turn);
      if (defences.length === 0) return { move, plies: 1 };
      let allRefuted: boolean = true;
      let worst: number = 0;
      for (const defence of defences) {
        const afterDefence = applyMoveToState(after, defence);
        const sub: number | null = proveMate(
          afterDefence, side, ownMoves - 1, deadline, nodes,
        );
        if (sub === null) { allRefuted = false; break; }
        if (sub + 1 > worst) worst = sub + 1;
      }
      if (allRefuted) return { move, plies: 1 + worst };
    }
  }
  return null;
}

/**
 * Quick "is there an immediate mate?" check — mate-in-1 only. Cheap enough to
 * run at the root of every search, and the highest-value guard against
 * "放弃杀点" (abandoning a kill).
 */
export function findMateInOne(state: GameState, side: Side): Move | null {
  if (state.turn !== side) return null;
  for (const move of generateLegalMoves(state.board, state.turn)) {
    const after = applyMoveToState(state, move);
    if (defenderLost(after)) return move;
  }
  return null;
}

/** True when `side` is to move and the opponent is already mated/stalemated. */
export function sideToMoveIsLost(state: GameState): boolean {
  return defenderLost(state);
}

export { opponent };
