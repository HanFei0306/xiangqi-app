/**
 * Automatic replay analysis for the training layer.
 *
 * `analyze` walks the full move history, reconstructing the position before
 * each move (by undoing moves from the final board), classifies each step, and
 * produces Chinese annotations. The mating move is tagged 'checkmate'.
 */

import type { Board } from '../engine/board';
import type { GameState, Move, Piece, Side } from '../engine/types';
import { opponent } from '../engine/types';
import { applyMoveToState } from '../engine/rules';
import { match } from './tactics';
import { renderTactic, renderNormal } from './templates';
import type { ReplayAnnotation, ReplayTag } from './types';

/** Reverses a single move on the board (used to rebuild earlier positions). */
function undoMove(board: Board, move: Move): Board {
  const next = board.clone();
  const piece = next.getPiece(move.to);
  if (!piece) {
    return next;
  }
  next.setPiece(move.from, piece);
  if (move.captured) {
    const capturedSide: Side = opponent(piece.side);
    next.setPiece(move.to, { type: move.captured, side: capturedSide } as Piece);
  } else {
    next.setPiece(move.to, null);
  }
  return next;
}

/** Rebuilds the board as it was before the first move of the history. */
function reconstructInitial(finalBoard: Board, history: Move[]): Board {
  let board = finalBoard.clone();
  for (let i = history.length - 1; i >= 0; i--) {
    board = undoMove(board, history[i]);
  }
  return board;
}

/**
 * Analyzes a finished game and returns one annotation per move.
 * Tactics, the mating move, and quiet moves are all labelled appropriately.
 */
export function analyze(history: Move[], finalState: GameState): ReplayAnnotation[] {
  const annotations: ReplayAnnotation[] = [];
  if (history.length === 0) {
    return annotations;
  }
  const initialBoard = reconstructInitial(finalState.board, history);
  const len = history.length;
  const initialTurn: Side =
    len % 2 === 0 ? finalState.turn : opponent(finalState.turn);

  let cur: GameState = {
    board: initialBoard,
    turn: initialTurn,
    history: [],
    status: 'playing',
    moveCount: 0,
  };

  for (let i = 0; i < len; i++) {
    const move = history[i];
    const tactic = match(cur, move);
    const next = applyMoveToState(cur, move);

    let tag: ReplayTag = 'normal';
    let comment = renderNormal();
    if (next.status === 'checkmate') {
      tag = 'checkmate';
      comment = '一锤定音，将死对方！';
    } else if (tactic) {
      tag = tactic.kind;
      comment = renderTactic(tactic.kind, move);
    }

    annotations.push({ moveIndex: i, tag, comment });
    cur = next;
  }
  return annotations;
}

/** Replay analyzer namespace mirroring the class diagram `Replay`. */
export const Replay = { analyze };
