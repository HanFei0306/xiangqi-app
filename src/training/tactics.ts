/**
 * Tactic matching for the training layer.
 *
 * `match(state, move)` inspects a single move and classifies it as one of:
 *   - 'check'    : the move gives check
 *   - 'fork'     : the moved piece attacks two or more enemy pieces
 *   - 'sacrifice': the move gives check while leaving the piece hanging
 *                 (a deliberate 弃子引离 / 弃子攻杀)
 *   - 'blunder'  : a valuable piece is left hanging with no compensation
 *
 * All detection is geometric + evaluation based, so it is pure and fast.
 */

import type { Board } from '../engine/board';
import type { GameState, Move, Pos, Side } from '../engine/types';
import { opponent } from '../engine/types';
import { generateAllMoves, generatePieceMoves } from '../engine/movegen';
import { isInCheck, applyMoveToState } from '../engine/rules';
import { PIECE_VALUE } from '../engine/pieces';
import { evaluateState } from '../ai/evaluate';
import type { TacticKind, TacticMatch } from './types';

/** Returns true if `by` attacks the square `pos`. */
function isSquareAttacked(board: Board, pos: Pos, by: Side): boolean {
  const moves = generateAllMoves(board, by);
  return moves.some((m) => m.to.col === pos.col && m.to.row === pos.row);
}

/** Counts how many enemy pieces the piece on `pos` currently attacks. */
function enemyTargetsAttacked(board: Board, pos: Pos, by: Side): number {
  const moves = generatePieceMoves(board, pos);
  let count = 0;
  for (const m of moves) {
    const target = board.getPiece(m.to);
    if (target && target.side !== by) {
      count += 1;
    }
  }
  return count;
}

/**
 * Matches a tactic for the given move in the given state.
 * Returns null when the move is an ordinary (non-tactical) move.
 */
export function match(state: GameState, move: Move): TacticMatch | null {
  let after: GameState;
  try {
    after = applyMoveToState(state, move);
  } catch {
    return null; // illegal move cannot be a tactic
  }
  const mover = state.turn;
  const opp = opponent(mover);

  const givesCheck = isInCheck(after.board, opp);
  const movedPos = move.to;
  const attackedByEnemy = isSquareAttacked(after.board, movedPos, opp);
  const defendedByFriend = isSquareAttacked(after.board, movedPos, mover);
  const targets = enemyTargetsAttacked(after.board, movedPos, mover);
  const moved = after.board.getPiece(movedPos);
  const movedValue = moved ? PIECE_VALUE[moved.type] : 0;

  // Deliberate sacrifice: gives check while leaving the piece hanging.
  if (givesCheck && attackedByEnemy) {
    return { kind: 'sacrifice', squares: [move.from, move.to] };
  }
  // Fork: one piece attacks two or more enemy pieces.
  if (targets >= 2) {
    return { kind: 'fork', squares: [move.from, move.to] };
  }
  // Plain check.
  if (givesCheck) {
    return { kind: 'check', squares: [move.from, move.to] };
  }
  // Blunder: a valuable piece is thrown away (hanging, undefended).
  if (attackedByEnemy && !defendedByFriend && movedValue >= 200) {
    return { kind: 'blunder', squares: [movedPos] };
  }
  // Fallback: a clearly losing material swing (used by replay).
  const beforeEval = evaluateState(state, mover);
  const afterEval = evaluateState(after, mover);
  if (afterEval - beforeEval <= -200) {
    return { kind: 'blunder', squares: [movedPos] };
  }
  return null;
}

/** Re-export the kind list for convenience. */
export const TACTIC_KINDS: TacticKind[] = ['sacrifice', 'fork', 'check', 'blunder'];
