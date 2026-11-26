/**
 * Public ElephantEye PST values and coordinate mapping (T01/T02).
 */
import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import {
  KING_PAWN_ENDGAME_ATTACKLESS,
  KING_PAWN_ENDGAME_ATTACKING,
  KING_PAWN_MIDGAME_ATTACKING,
  KNIGHT_MIDGAME,
  PHASE_TOTAL,
  PST_ATTACK_DELTA,
  PST_MG,
  computeKey,
  mgTableValue,
  pstIndex,
  phaseOf,
  tapered,
} from '../pst';
import { PIECE_VALUE } from '../../engine/pieces';

function codesOf(board: Board): Int8Array {
  const squares = new Int8Array(90);
  const map = { K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7 } as const;
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece) squares[col * 10 + row] = (piece.side === 'red' ? 1 : -1) * map[piece.type];
    }
  }
  return squares;
}

describe('ElephantEye PST mapping', () => {
  it('maps the red palace centre to EE row 12 / column 7', () => {
    expect(pstIndex(4, 0, true)).toBe(12 * 16 + 7);
    expect(KING_PAWN_MIDGAME_ATTACKING[pstIndex(4, 0, true)]).toBe(15);
    expect(PST_MG[(1 + 7) * 90 + 4 * 10 + 0]).toBe(PIECE_VALUE.K + 15);
  });

  it('mirrors black positions through (8-col, 9-row) and negates', () => {
    expect(pstIndex(4, 9, false)).toBe(pstIndex(4, 0, true));
    expect(PST_MG[(-1 + 7) * 90 + 4 * 10 + 9]).toBe(-PST_MG[(1 + 7) * 90 + 4 * 10 + 0]);
    // Black cannon 砲八平五 on (4,7) equals red cannon on (4,2).
    expect(pstIndex(4, 7, false)).toBe(pstIndex(4, 2, true));
  });

  it('rewards a crossed pawn far more in the attacking endgame table', () => {
    const attacking = KING_PAWN_ENDGAME_ATTACKING[pstIndex(4, 7, true)];
    const attackless = KING_PAWN_ENDGAME_ATTACKLESS[pstIndex(4, 7, true)];
    expect(attacking).toBeGreaterThan(attackless + 30);
  });

  it('uses the published central-knight middlegame peak', () => {
    expect(KNIGHT_MIDGAME[pstIndex(1, 6, true)]).toBe(108);
    expect(mgTableValue(4, 1, 6)).toBe(108);
  });

  it('keeps the attack-delta table only for king/pawn and advisors/bishops', () => {
    expect(PST_ATTACK_DELTA[(1 + 7) * 90 + 0 * 10 + 7]).not.toBe(0); // red king, attacked zone
    expect(PST_ATTACK_DELTA[(7 + 7) * 90 + 0 * 10 + 7]).not.toBe(0); // advanced red pawn
    expect(PST_ATTACK_DELTA[(2 + 7) * 90 + 4 * 10 + 0]).toBe(0); // sparse advisor square
    expect(PST_ATTACK_DELTA[(2 + 7) * 90 + 5 * 10 + 0]).not.toBe(0); // advisor centre
    expect(PST_ATTACK_DELTA[(5 + 7) * 90 + 4 * 10 + 0]).toBe(0); // red rook
  });
});

describe('phase and tapered interpolation', () => {
  it('starts at 66 and drops monotonically as pieces are captured', () => {
    const full = codesOf(new Board());
    expect(phaseOf(full)).toBe(PHASE_TOTAL);
    const oneCaptured = full.slice();
    oneCaptured[0 * 10 + 0] = 0; // red rook
    expect(phaseOf(oneCaptured)).toBe(PHASE_TOTAL - 6);
    oneCaptured[4 * 10 + 3] = 0; // red pawn
    expect(phaseOf(oneCaptured)).toBe(PHASE_TOTAL - 7);
  });

  it('uses pure MG at 66, pure EG at 0 and a linear interpolation between', () => {
    expect(tapered(120, 20, 66)).toBe(120);
    expect(tapered(120, 20, 0)).toBe(20);
    expect(tapered(120, 20, 33)).toBe(70);
  });

  it('keeps the Zobrist key sensitive to side to move and black layout', () => {
    const squares = codesOf(new Board());
    expect(computeKey(squares, 1)).not.toBe(computeKey(squares, -1));
    const moved = squares.slice();
    moved[0] = 0; // remove the red rook at (0,0)
    expect(computeKey(moved, 1)).not.toBe(computeKey(squares, 1));
  });
});
