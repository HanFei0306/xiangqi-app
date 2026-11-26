/**
 * Static Exchange Evaluation (SEE) — v2026.11.19.7.
 *
 * Answers: "after this capture, if both sides always recapture with their
 * cheapest attacker, how much material does the mover net?" A negative SEE
 * means the capture loses material even before positional factors — the exact
 * signature of the "送子 / 怪招" (gifted piece / weird move) reports.
 *
 * Pure functions over a flat `Int8Array` board (code layout: sign * typeCode,
 * typeCode K=1 A=2 B=3 N=4 R=5 C=6 P=7, index = col * 10 + row). The caller
 * supplies a scratch board so the hot path allocates nothing.
 */

import { PIECE_VALUE } from '../../../engine/pieces';

/** Flat value by signed piece code (code 0 -> 0), indexed code + 7. */
export const SEE_VALUE: Int32Array = (() => {
  const table = new Int32Array(15);
  const byCode: Readonly<Record<number, number>> = {
    1: PIECE_VALUE.K, 2: PIECE_VALUE.A, 3: PIECE_VALUE.B, 4: PIECE_VALUE.N,
    5: PIECE_VALUE.R, 6: PIECE_VALUE.C, 7: PIECE_VALUE.P,
  };
  for (let code = -7; code <= 7; code++) {
    table[code + 7] = code === 0 ? 0 : byCode[Math.abs(code)];
  }
  return table;
})();

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const KNIGHT: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
  [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
];
const DIAG: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function idx(col: number, row: number): number {
  return col * 10 + row;
}
function onBoard(col: number, row: number): boolean {
  return col >= 0 && col < 9 && row >= 0 && row < 10;
}

/**
 * Cheapest attacker of `target` belonging to `bySign`, as {code, from}.
 * Mirrors the search's attack geometry (pawn / horse / rook+king ray, cannon
 * screen, advisor+elephant) so SEE agrees with legal capture generation.
 * The king is excluded: capturing a king is never a legal material gain.
 */
export interface Attacker {
  code: number;
  from: number;
}

export function cheapestAttacker(
  squares: Int8Array,
  target: number,
  bySign: number,
): Attacker | null {
  const col: number = (target / 10) | 0;
  const row: number = target % 10;
  let best: Attacker | null = null;
  let bestValue: number = Infinity;

  const offer = (code: number, from: number): void => {
    // A king cannot be a material attacker (its capture ends the game).
    if (Math.abs(code) === 1) return;
    const value: number = SEE_VALUE[code + 7];
    if (value < bestValue) {
      bestValue = value;
      best = { code, from };
    }
  };

  // Pawn: one step toward the target; sideways after crossing the river.
  const forward: number = bySign === 1 ? 1 : -1;
  const pawnRow: number = row - forward;
  if (onBoard(col, pawnRow)) {
    const code: number = squares[idx(col, pawnRow)];
    if (code !== 0 && Math.abs(code) === 7 && (code > 0) === (bySign > 0)) {
      offer(code, idx(col, pawnRow));
    }
  }
  const crossed: boolean = bySign === 1 ? row >= 5 : row <= 4;
  if (crossed) {
    for (const dc of [-1, 1]) {
      if (!onBoard(col + dc, row)) continue;
      const from: number = idx(col + dc, row);
      const code: number = squares[from];
      if (code !== 0 && Math.abs(code) === 7 && (code > 0) === (bySign > 0)) {
        offer(code, from);
      }
    }
  }

  // Horse: eight origins with the leg square empty.
  for (const [dc, dr, legDc, legDr] of KNIGHT) {
    const oc: number = col + dc;
    const orow: number = row + dr;
    if (!onBoard(oc, orow)) continue;
    const lc: number = oc + legDc;
    const lrow: number = orow + legDr;
    if (onBoard(lc, lrow) && squares[idx(lc, lrow)] !== 0) continue;
    const from: number = idx(oc, orow);
    const code: number = squares[from];
    if (code !== 0 && Math.abs(code) === 4 && (code > 0) === (bySign > 0)) {
      offer(code, from);
    }
  }

  // Advisor (diagonal, inside own palace) and elephant (two-step, own half).
  for (const [dc, dr] of DIAG) {
    const oc: number = col + dc;
    const orow: number = row + dr;
    if (!onBoard(oc, orow)) continue;
    const ac: number = oc;
    const arow: number = orow;
    if (ac >= 3 && ac <= 5) {
      const inOwnPalace: boolean = bySign === 1 ? arow >= 0 && arow <= 2 : arow >= 7 && arow <= 9;
      if (inOwnPalace) {
        const from: number = idx(ac, arow);
        const code: number = squares[from];
        if (code !== 0 && Math.abs(code) === 2 && (code > 0) === (bySign > 0)) offer(code, from);
      }
    }
    const midC: number = col + dc;
    const midR: number = row + dr;
    const ec: number = col + 2 * dc;
    const erow: number = row + 2 * dr;
    if (onBoard(ec, erow) && onBoard(midC, midR) && squares[idx(midC, midR)] === 0) {
      const ownHalf: boolean = bySign === 1 ? erow < 5 : erow >= 5;
      if (ownHalf) {
        const from: number = idx(ec, erow);
        const code: number = squares[from];
        if (code !== 0 && Math.abs(code) === 3 && (code > 0) === (bySign > 0)) offer(code, from);
      }
    }
  }

  // Rook (first piece on ray) and cannon (second piece after one screen).
  for (const [dc, dr] of ORTHO) {
    let c: number = col + dc;
    let r: number = row + dr;
    let screen: boolean = false;
    while (onBoard(c, r)) {
      const from: number = idx(c, r);
      const code: number = squares[from];
      if (code !== 0) {
        const enemy: boolean = (code > 0) === (bySign > 0);
        if (!screen) {
          if (enemy && Math.abs(code) === 5) offer(code, from);
          screen = true;
        } else {
          if (enemy && Math.abs(code) === 6) offer(code, from);
          break;
        }
      }
      c += dc;
      r += dr;
    }
  }

  return best;
}

/** Max swap plies — bounds the recursion in dense positions. */
const SEE_MAX_PLY = 8;

function recaptureValue(
  scratch: Int8Array,
  target: number,
  side: number,
  ply: number,
): number {
  if (ply >= SEE_MAX_PLY) return 0;
  const attacker: Attacker | null = cheapestAttacker(scratch, target, side);
  if (attacker === null) return 0;
  const victim: number = scratch[target];
  scratch[attacker.from] = 0;
  scratch[target] = attacker.code;
  const reply: number = recaptureValue(scratch, target, -side, ply + 1);
  scratch[attacker.from] = attacker.code;
  scratch[target] = victim;
  const net: number = SEE_VALUE[victim + 7] - reply;
  return net > 0 ? net : 0;
}

/**
 * Net material of a capture from the mover's perspective.
 * `scratch` must be an Int8Array of length >= 90; it is overwritten.
 */
export function staticExchange(
  squares: Int8Array,
  from: number,
  to: number,
  piece: number,
  captured: number,
  scratch: Int8Array,
): number {
  scratch.set(squares);
  scratch[from] = 0;
  scratch[to] = piece;
  const firstGain: number = SEE_VALUE[captured + 7];
  const reply: number = recaptureValue(scratch, to, -Math.sign(piece), 1);
  return firstGain - reply;
}
