/**
 * O(1) incremental king-zone threat layer (v2026.11.19.8).
 *
 * Why this exists
 * ---------------
 * Before v19.8 every search leaf was `tapered(mg, eg, phase)` only. That is
 * extremely fast (~190k NPS) but blind: a rook two files from our general and
 * a rook on the opposite edge scored identically as long as neither had moved.
 * The expensive `full` layer had king safety, but search never called it.
 *
 * This module adds a *position-only* threat potential that can be maintained
 * in O(1) per move:
 *
 *   zone[side] = Σ over enemy pieces of ZONE_WEIGHT[type][|dc|][|dr|]
 *
 * `dc/dr` are the piece's column/row distance from that side's general. Only
 * the piece square and the king square are involved — no occupancy, no ray
 * scan, no attack legality. That is deliberate: it makes the term exactly
 * reversible, so `doMoveFast`/`undoMoveFast` cannot drift from a full rebuild
 * (locked by incremental-eval.test.ts). A king move (rare) triggers a full
 * 32-piece recomputation.
 *
 * The value is tapered the same way as PST: strong in the middlegame, muted
 * in bare endgames where the general must instead take an active role.
 *
 * Everything remains antisymmetric under board mirroring because only
 * absolute coordinate differences are used.
 */

import { PHASE_TOTAL } from './pst';
import type { FastState } from './types';

/** piece type index: 1=K 2=A 3=B 4=N 5=R 6=C 7=P. */
const TYPE_STRENGTH: ReadonlyArray<number> = [0, 0, 0, 0, 9, 15, 12, 7];

/**
 * Base falloff by Manhattan distance from the defended king (index 0..18).
 * Closer is more dangerous; beyond ~5 squares a piece no longer threatens
 * the palace directly.
 */
const DIST_FALLOFF: ReadonlyArray<number> = [
  0, 1, 0.85, 0.65, 0.45, 0.28, 0.14, 0.06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Same-file / same-rank alignment bonus for the two long-range pieces. */
const ALIGN_BONUS: ReadonlyArray<number> = [0, 0, 0, 0, 0, 6, 5, 0];

/** index = type * 19 + (|dc| + |dr|). */
const ZONE_WEIGHT = new Float32Array(8 * 19);
for (let type = 1; type <= 7; type++) {
  for (let dist = 0; dist < 19; dist++) {
    ZONE_WEIGHT[type * 19 + dist] = Math.round(TYPE_STRENGTH[type] * DIST_FALLOFF[dist]);
  }
}

function sideIndex(sign: number): number {
  return sign > 0 ? 0 : 1;
}

/**
 * How much `code` pressures the king on `kingSq` (0 when either is missing).
 * Pure function of two squares — the reason the running total is reversible.
 */
export function zoneContribution(code: number, sq: number, kingSq: number): number {
  if (code === 0 || kingSq < 0 || sq < 0) return 0;
  const type: number = Math.abs(code);
  if (type <= 3 || type === 1) return 0; // advisors/elephants/general: no direct threat
  const dc: number = ((sq / 10) | 0) - ((kingSq / 10) | 0);
  const dr: number = (sq % 10) - (kingSq % 10);
  const dcAbs: number = dc < 0 ? -dc : dc;
  const drAbs: number = dr < 0 ? -dr : dr;
  const dist: number = dcAbs + drAbs;
  if (dist > 18) return 0;
  let value: number = ZONE_WEIGHT[type * 19 + dist];
  if (value === 0) return 0;
  if ((dcAbs === 0 || drAbs === 0) && (type === 5 || type === 6)) {
    value += ALIGN_BONUS[type];
  }
  // A pawn only matters once it has crossed into the enemy half; the distance
  // check above already covers most cases, but an unmoved own-half pawn must
  // not be treated as a palace threat even when the king is unusually close.
  if (type === 7) {
    const sign: number = code > 0 ? 1 : -1;
    const row: number = sq % 10;
    const crossed: boolean = sign > 0 ? row >= 5 : row <= 4;
    if (!crossed) return 0;
  }
  return value;
}

/** Recomputes both zone counters from scratch (construction + king moves). */
export function recomputeZone(st: FastState): void {
  let red = 0;
  let black = 0;
  const redKing: number = st.kingSq[0];
  const blackKing: number = st.kingSq[1];
  for (let i = 0; i < 32; i++) {
    const code: number = st.pieceList[i];
    if (code === 0) continue;
    const sq: number = st.pieceSq[i];
    if (code > 0) black += zoneContribution(code, sq, blackKing);
    else red += zoneContribution(code, sq, redKing);
  }
  st.zone[0] = Math.round(red);
  st.zone[1] = Math.round(black);
}

/**
 * Red-perspective zone score. Positive means the BLACK king is under more
 * pressure than the RED king. Kept as integer centipawns for TT stability.
 */
export function zoneScoreOf(st: FastState): number {
  const phase: number = st.phase < 0 ? 0 : st.phase > PHASE_TOTAL ? PHASE_TOTAL : st.phase;
  // 65%..100% taper: bare-king endgames still value a safe king, but a
  // attacking rook near the palace is worth less when there is little left
  // to defend and the king itself must usually join the fight.
  const scale: number = 0.65 + 0.35 * (phase / PHASE_TOTAL);
  return Math.round((st.zone[1] - st.zone[0]) * scale);
}

/** Side index helper re-exported for the incremental move hooks. */
export { sideIndex };
