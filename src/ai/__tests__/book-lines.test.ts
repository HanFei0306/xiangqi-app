/**
 * Every book line is replayed from the initial position with the REAL engine
 * rules and notation generator. Coordinate sequences and notation strings are
 * kept side-by-side so an illegal or mis-spelled move cannot slip into the
 * book (notably black 砲 vs red 炮).
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { makeMove } from '../../engine/rules';
import { generateNotation } from '../../engine/notation';
import type { Side } from '../../engine/types';
import { BOOK_LINES } from '../openingBook';

type Coord = [number, number, number, number];

const COORDS: Record<string, Coord[]> = {
  '中炮屏风马': [
    [7,2,4,2],[7,9,6,7],[7,0,6,2],[8,9,7,9],[8,0,7,0],[1,9,2,7],
    [2,3,2,4],[6,6,6,5],[7,0,7,6],[7,7,8,7],[7,6,6,6],[8,7,8,8],
    [1,0,2,2],[3,9,4,8],[1,2,0,2],[0,9,1,9],[0,0,1,0],
  ],
  '中炮顺炮': [
    [7,2,4,2],[7,7,4,7],[7,0,6,2],[7,9,6,7],[8,0,7,0],[8,9,8,8],
    [1,0,2,2],[8,8,5,8],[6,3,6,4],[1,9,2,7],[2,3,2,4],[0,9,0,8],
    [2,0,0,2],[2,6,2,5],[7,0,7,5],
  ],
  '飞相局': [
    [6,0,4,2],[7,7,4,7],[7,0,6,2],[7,9,6,7],[8,0,7,0],[8,9,7,9],
    [6,3,6,4],[6,6,6,5],[1,0,2,2],[1,9,2,7],[1,2,1,6],[2,6,2,5],
    [2,3,2,4],[0,9,0,8],[0,0,0,1],[6,7,5,5],
  ],
  '仙人指路': [
    [2,3,2,4],[1,7,2,7],[7,2,4,2],[2,9,4,7],[7,0,6,2],[8,9,8,8],
    [8,0,7,0],[8,8,5,8],[1,0,2,2],[7,9,8,7],[6,3,6,4],[5,8,5,4],
    [2,0,0,2],[2,7,3,7],[7,0,7,6],
  ],
  '过宫炮': [
    [7,2,3,2],[7,9,6,7],[7,0,6,2],[8,9,7,9],[8,0,7,0],[7,7,7,3],
    [6,3,6,4],[6,6,6,5],[1,0,2,2],[1,9,2,7],[2,0,4,2],[2,9,4,7],
    [3,0,4,1],[0,9,1,9],[2,3,2,4],
  ],
  '起马局': [
    [1,0,2,2],[2,6,2,5],[6,3,6,4],[1,9,2,7],[7,0,6,2],[7,7,4,7],
    [2,0,4,2],[8,9,8,8],[8,0,7,0],[6,6,6,5],[2,3,2,4],[7,9,6,7],
    [1,2,1,6],[8,8,5,8],[1,6,3,6],
  ],
};

describe('book lines are legal and notation-exact', () => {
  for (const line of BOOK_LINES) {
    it(`${line.system} — ${line.moves.length} plies`, () => {
      const coords = COORDS[line.system];
      expect(coords, `missing coordinate script for ${line.system}`).toBeDefined();
      expect(coords.length).toBe(line.moves.length);
      let board = new Board();
      let side: Side = 'red';
      for (let i = 0; i < line.moves.length; i++) {
        const [fc, fr, tc, tr] = coords[i];
        const piece = board.getPiece({ col: fc, row: fr });
        expect(piece, `${line.system} ply ${i + 1}: empty origin`).not.toBeNull();
        expect(piece!.side, `${line.system} ply ${i + 1}: wrong side`).toBe(side);
        const move = makeMove(board, { col: fc, row: fr }, { col: tc, row: tr });
        expect(move, `${line.system} ply ${i + 1}: illegal move`).not.toBeNull();
        const notation = generateNotation(board, move!, side);
        expect(notation, `${line.system} ply ${i + 1}: notation mismatch`).toBe(line.moves[i]);
        board = board.clone();
        board.applyMove(move!);
        side = side === 'red' ? 'black' : 'red';
      }
    });
  }
});
