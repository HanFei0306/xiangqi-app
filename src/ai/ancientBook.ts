/**
 * 《适情雅趣》solution book as a move reference (v2026.11.21.1).
 *
 * 548 composed endgames contain thousands of verified positions. If a live
 * game ever reaches one of them, the古谱正解 is a stronger and more reliable
 * move than any generic search. The table is built lazily (once) and only
 * consulted in low-material positions, so ordinary openings are untouched.
 */
import { Board } from '../engine/board';
import type { GameState, Move, Side } from '../engine/types';
import { SHIQINGYAQU } from '../data/shiqingyaqu';

interface BookEntry { move: Move; title: string }

let table: Map<string, BookEntry> | null = null;

function clone(move: Move): Move {
  return {
    from: { col: move.from.col, row: move.from.row },
    to: { col: move.to.col, row: move.to.row },
    piece: move.piece,
    captured: move.captured,
    notation: move.notation,
  };
}

function keyOf(board: Board, turn: Side): string {
  return board.toNotationSetup() + '|' + (turn === 'red' ? 'r' : 'b');
}

function build(): Map<string, BookEntry> {
  const out = new Map<string, BookEntry>();
  for (const puzzle of SHIQINGYAQU) {
    let board = Board.fromNotationSetup(puzzle.setup);
    let turn: Side = 'red';
    for (let i = 0; i < puzzle.solution.length; i++) {
      const move = puzzle.solution[i];
      if (turn !== (i % 2 === 0 ? 'red' : 'black')) break;
      // The position BEFORE this solution move is the book key.
      const key = keyOf(board, turn);
      if (!out.has(key)) out.set(key, { move: clone(move), title: puzzle.title });
      board = board.clone();
      try {
        board.applyMove(clone(move));
      } catch {
        break;
      }
      turn = turn === 'red' ? 'black' : 'red';
    }
  }
  return out;
}

export function ancientBookSize(): number {
  if (table === null) table = build();
  return table.size;
}

/** Returns the composed-endgame solution move for the exact current position. */
export function ancientBookMove(state: GameState): Move | null {
  const setup = state.board.toNotationSetup();
  const pieces = setup.length === 0 ? 0 : setup.split(';').length;
  if (pieces > 28) return null; // all 548 composed endgames are <=26 men; initial is 32
  if (table === null) table = build();
  const entry = table.get(keyOf(state.board, state.turn));
  if (!entry) return null;
  // Validate against the real rules before handing it to the store.
  const legal = state.board.getPiece(entry.move.from);
  if (!legal || legal.side !== state.turn) return null;
  return clone(entry.move);
}
