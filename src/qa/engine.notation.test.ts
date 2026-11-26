/**
 * QA acceptance tests — Chinese notation (engine/notation).
 *
 * `fileNumber` is pure and must PASS.
 * `generateNotation` calls `PIECE_CHAR[side][type]`, a symbol that
 * `pieces.ts` does NOT export — so the generateNotation assertions
 * below currently FAIL. They document the required (correct) output.
 * Root cause: missing `PIECE_CHAR` export in pieces.ts (see QA report).
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../engine/board';
import { initialBoardGrid } from '../engine/pieces';
import { generateNotation, fileNumber } from '../engine/notation';
import type { Move, Pos } from '../engine/types';

function pos(col: number, row: number): Pos {
  return { col, row };
}

function move(from: Pos, to: Pos, piece: Move['piece']): Move {
  return { from, to, piece, captured: null, notation: '' };
}

function initBoard(): Board {
  return new Board(initialBoardGrid());
}

describe('fileNumber', () => {
  it('counts from the player\'s right hand', () => {
    expect(fileNumber('red', 7)).toBe(2); // red right cannon
    expect(fileNumber('red', 0)).toBe(9);
    expect(fileNumber('black', 0)).toBe(1);
    expect(fileNumber('black', 8)).toBe(9);
  });
});

describe('generateNotation (requires PIECE_CHAR — currently broken)', () => {
  it('炮二平五 (cannon file 2 -> file 5, horizontal)', () => {
    const m = move(pos(7, 4), pos(4, 4), 'C');
    expect(generateNotation(initBoard(), m, 'red')).toBe('炮二平五');
  });

  it('马八进七 (horse forward file 8 -> file 7)', () => {
    const m = move(pos(1, 4), pos(2, 6), 'N');
    expect(generateNotation(initBoard(), m, 'red')).toBe('马八进七');
  });

  it('车二进三 (rook forward 3 steps from file 2)', () => {
    const m = move(pos(7, 4), pos(7, 7), 'R');
    expect(generateNotation(initBoard(), m, 'red')).toBe('车二进三');
  });

  it('兵五进一 (red pawn forward one step)', () => {
    const m = move(pos(4, 3), pos(4, 4), 'P');
    expect(generateNotation(initBoard(), m, 'red')).toBe('兵五进一');
  });

  it('黑马二进三 (black horse downward counts as 进)', () => {
    const m = move(pos(1, 5), pos(2, 3), 'N');
    expect(generateNotation(initBoard(), m, 'black')).toBe('马二进三');
  });

  it('马八退七 (red horse retreating changes file number)', () => {
    const m = move(pos(1, 6), pos(2, 4), 'N');
    expect(generateNotation(initBoard(), m, 'red')).toBe('马八退七');
  });
});
