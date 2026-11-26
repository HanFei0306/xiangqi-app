/**
 * v22.6 子力不足和棋判定：只剩将帅士象 → true；任一车马炮兵 → false。
 */
import { describe, expect, it } from 'vitest';
import { Board, createInitialState } from '../board';
import { insufficientMaterial } from '../rules';
import type { PieceType } from '../types';

function bareBoard(attacker?: PieceType): Board {
  const board = Board.fromSetup('');
  board.setPiece({ col: 4, row: 0 }, { type: 'K', side: 'red' });
  board.setPiece({ col: 4, row: 9 }, { type: 'K', side: 'black' });
  board.setPiece({ col: 3, row: 0 }, { type: 'A', side: 'red' });
  board.setPiece({ col: 5, row: 9 }, { type: 'B', side: 'black' });
  if (attacker) board.setPiece({ col: 0, row: 5 }, { type: attacker, side: 'red' });
  return board;
}

describe('v22.6 insufficientMaterial', () => {
  it('只剩将帅 + 士象时判子力不足', () => {
    expect(insufficientMaterial(bareBoard())).toBe(true);
  });

  it.each(['R', 'N', 'C', 'P'] as PieceType[])('任一攻击子力 %s 都不判和', (type) => {
    expect(insufficientMaterial(bareBoard(type))).toBe(false);
  });

  it('黑方有攻击子力同样不判和', () => {
    const board = bareBoard();
    board.setPiece({ col: 8, row: 5 }, { type: 'C', side: 'black' });
    expect(insufficientMaterial(board)).toBe(false);
  });

  it('标准开局不判和', () => {
    expect(insufficientMaterial(createInitialState('red').board)).toBe(false);
  });
});
