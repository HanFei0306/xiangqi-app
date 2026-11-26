/**
 * Acceptance tests for the standalone position validator (checklist §E).
 *
 * Every negative case asserts the specific clause number (C1..C6), and the
 * N6/P2 pair deliberately shares one setup with a different `turn` to lock
 * down the C6 direction.
 */

import { describe, it, expect } from 'vitest';
import { Board } from '../board';
import type { PieceType, Side } from '../types';
import {
  validatePosition,
  validateSetupString,
  type PositionValidation,
} from '../validate';
import { INITIAL_SETUP } from '../../data/puzzles';

const EMPTY_ROW = '.,.,.,.,.,.,.,.,.';

/** Builds a 10-row setup from sparse row overrides. */
function setup(rows: Record<number, string>): string {
  return Array.from({ length: 10 }, (_, row) => rows[row] ?? EMPTY_ROW).join('/');
}

/** Returns error messages starting with the given clause tag. */
function clauseErrors(result: PositionValidation, clause: string): string[] {
  return result.errors.filter((error) => error.startsWith(clause));
}

describe('validatePosition — negative cases (checklist §E.1)', () => {
  it('N1: three red rooks violate C4', () => {
    const result = validatePosition(
      Board.fromNotationSetup(
        setup({
          0: 'R,.,.,K,.,.,.,.,R',
          8: '.,R,.,.,.,.,.,.,.',
          9: '.,.,.,.,k,.,.,.,.',
        }),
      ),
      'red',
    );
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C4')).toHaveLength(1);
    expect(result.errors.join(' ')).toContain('红方车 3 枚，超过上限 2');
  });

  it('N2: red king outside its palace violates C3 (not C2)', () => {
    const result = validatePosition(
      Board.fromNotationSetup(
        setup({ 0: 'K,.,.,.,.,.,.,.,.', 9: '.,.,.,.,k,.,.,.,.' }),
      ),
      'red',
    );
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C3')).toHaveLength(1);
    expect(clauseErrors(result, 'C2')).toHaveLength(0);
  });

  it('N3: missing red king violates C2', () => {
    const result = validatePosition(
      Board.fromNotationSetup(setup({ 9: '.,.,.,.,k,.,.,.,.' })),
      'red',
    );
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C2')).toHaveLength(1);
  });

  it('N4: two red kings violate C2', () => {
    const result = validatePosition(
      Board.fromNotationSetup(
        setup({ 0: '.,.,.,K,.,K,.,.,.', 9: '.,.,.,.,k,.,.,.,.' }),
      ),
      'red',
    );
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C2')).toHaveLength(1);
  });

  it('N5: kings facing on an open file violates C5', () => {
    const result = validatePosition(
      Board.fromNotationSetup(
        setup({ 0: '.,.,.,.,K,.,.,.,.', 9: '.,.,.,.,k,.,.,.,.' }),
      ),
      'red',
    );
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C5')).toHaveLength(1);
  });

  it('N6: black in check with RED to move violates C6', () => {
    const shared = setup({
      0: '.,.,.,K,.,.,.,.,.',
      8: '.,.,.,.,R,.,.,.,.',
      9: '.,.,.,.,k,.,.,.,.',
    });
    const result = validatePosition(Board.fromNotationSetup(shared), 'red');
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C6')).toHaveLength(1);
  });

  it('C1: a piece with an unknown runtime type is rejected', () => {
    const board = new Board(new Array(9).fill(null).map(() => new Array(10).fill(null)));
    board.setPiece({ col: 3, row: 0 }, { type: 'K', side: 'red' });
    board.setPiece({ col: 4, row: 9 }, { type: 'K', side: 'black' });
    board.setPiece({ col: 0, row: 5 }, { type: 'X' as PieceType, side: 'red' });
    const result = validatePosition(board, 'red');
    expect(result.valid).toBe(false);
    expect(clauseErrors(result, 'C1')).toHaveLength(1);
  });
});

describe('validatePosition — positive cases (checklist §E.2)', () => {
  it('P1: the standard initial position is legal', () => {
    const result = validatePosition(Board.fromNotationSetup(INITIAL_SETUP), 'red');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('P2: SAME setup as N6 but BLACK to move is legal (C6 direction lock)', () => {
    const shared = setup({
      0: '.,.,.,K,.,.,.,.,.',
      8: '.,.,.,.,R,.,.,.,.',
      9: '.,.,.,.,k,.,.,.,.',
    });
    const redTurn: Side = 'red';
    const blackTurn: Side = 'black';
    expect(validatePosition(Board.fromNotationSetup(shared), redTurn).valid).toBe(false);
    const result = validatePosition(Board.fromNotationSetup(shared), blackTurn);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('P3: a red pawn inside the black palace is not illegal', () => {
    const result = validatePosition(
      Board.fromNotationSetup(
        setup({
          0: '.,.,.,K,.,.,.,.,.',
          7: '.,.,.,.,P,.,.,.,.',
          9: '.,.,.,.,.,k,.,.,.',
        }),
      ),
      'red',
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('P4: kings on one file with a blocking pawn are legal', () => {
    const result = validatePosition(
      Board.fromNotationSetup(
        setup({
          0: '.,.,.,.,K,.,.,.,.',
          5: '.,.,.,.,P,.,.,.,.',
          9: '.,.,.,.,k,.,.,.,.',
        }),
      ),
      'red',
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('validateSetupString — strict parsing (C1 / C11)', () => {
  it('accepts the standard initial setup', () => {
    expect(validateSetupString(INITIAL_SETUP)).toEqual([]);
  });

  it('rejects a row with 10 cells, naming row and cell index', () => {
    const bad = setup({ 3: 'P,.,P,.,P,.,P,.,P,P' });
    const errors = validateSetupString(bad);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('C1');
    expect(errors[0]).toContain('row=3');
  });

  it('rejects an unknown piece token instead of silently dropping it', () => {
    const bad = setup({ 0: '.,.,.,K,.,.,X,.,.' });
    const errors = validateSetupString(bad);
    expect(errors.some((e) => e.includes('C1') && e.includes('col=6'))).toBe(true);
  });

  it('rejects the wrong number of rows and empty cells', () => {
    expect(validateSetupString('.,.,.,.,.,.,.,.,.').some((e) => e.includes('C1'))).toBe(true);
    expect(
      validateSetupString(setup({ 2: '.,.,.,,.,.,.,.,.' })).some((e) => e.includes('col=3')),
    ).toBe(true);
  });
});
