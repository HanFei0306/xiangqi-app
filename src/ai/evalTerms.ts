/**
 * Single source of truth for position evaluation (v2026.11.19.1).
 *
 * Both the public evaluator (`evaluate.ts`) and search leaves (`search.ts`)
 * call `leafTerms` / `fullTerms` here. There is no second mobility formula,
 * so the old `evaluateFastState` vs `evaluateFast` disagreement is gone.
 *
 * Layered cost:
 *   leaf : incremental tapered PST (one division) + one ~32-piece scan for
 *          R/C/N/P mobility, threat factor and (low-phase only) pawn shape.
 *   full : leaf + king-zone threats (hollow cannon / central file / bottom),
 *          pins, advisors'/elephants'/king's mobility, coordination, space.
 *
 * Every term is computed for red and black and subtracted, so the whole
 * evaluation is exactly antisymmetric under board mirroring.
 */

import type { Board } from '../engine/board';
import type { PieceType } from '../engine/types';
import type { FastState } from './types';
import { recomputeZone, zoneContribution, zoneScoreOf } from './threat';
import {
  CVL_BOTTOM_THREAT,
  CVL_CENTRAL_THREAT,
  CVL_HOLLOW_THREAT,
  PHASE_TOTAL,
  PHASE_WEIGHT,
  PST_ATTACK_DELTA,
  PST_EG,
  PST_MG,
  computeKeyHalves,
  packKey,
  tapered,
  xorPiece,
  xorTurn,
} from './pst';

/** Flat internal move shared by do/undo; `slot` caches the piece-list slot. */
export interface FlatMove {
  from: number;
  to: number;
  piece: number;
  captured: number;
  slot?: number;
  capSlot?: number;
}

/** Per-side cheap scan result reused by all additive terms. */
interface SideScan {
  /** R/C/N/P landing-square count (plus B/A/K in full mode). */
  mobility: number;
  /** Attacking units that entered our half / approached our king (0..8). */
  attacks: number;
  /** Landing squares in the enemy back four ranks (space proxy). */
  space: number;
  /** Heavy-piece net count, used to scale the threat factor. */
  heavy: number;
}

const TYPE_CODE: Readonly<Record<PieceType, number>> = {
  K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7,
};
const CODE_TYPE: ReadonlyArray<PieceType> = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];

const ORTHO_DC = new Int8Array([1, -1, 0, 0]);
const ORTHO_DR = new Int8Array([0, 0, 1, -1]);
const KNIGHT_DC = new Int8Array([1, -1, 1, -1, 2, 2, -2, -2]);
const KNIGHT_DR = new Int8Array([2, 2, -2, -2, 1, -1, 1, -1]);
const KNIGHT_LEG_DC = new Int8Array([0, 0, 0, 0, 1, 1, -1, -1]);
const KNIGHT_LEG_DR = new Int8Array([1, 1, -1, -1, 0, 0, 0, 0]);
const DIAG_DC = new Int8Array([1, 1, -1, -1]);
const DIAG_DR = new Int8Array([1, -1, 1, -1]);
const ELE_DC = new Int8Array([2, 2, -2, -2]);
const ELE_DR = new Int8Array([2, -2, 2, -2]);

/** Mobility weight (difference in landing squares, both sides). */
export const MOBILITY_WEIGHT = 2;
/** Cheap neighbour-openness weight kept for API compatibility. */
export const FAST_MOBILITY_WEIGHT = 1;
/** Retained-defender weight kept for API compatibility (PST now carries it). */
export const KING_SAFETY_WEIGHT = 12;

function sideIndex(sign: number): number {
  return sign > 0 ? 0 : 1;
}
function onBoard(col: number, row: number): boolean {
  return col >= 0 && col < 9 && row >= 0 && row < 10;
}
function ownHalf(sign: number, row: number): boolean {
  return sign > 0 ? row < 5 : row >= 5;
}
function inPalace(col: number, row: number, sign: number): boolean {
  return col >= 3 && col <= 5 && (sign > 0 ? row <= 2 : row >= 7);
}
function crossedRiver(sign: number, row: number): boolean {
  return sign > 0 ? row >= 5 : row <= 4;
}
function inEnemyBackFour(sign: number, row: number): boolean {
  return sign > 0 ? row >= 6 : row <= 3;
}

// --- FastState construction and incremental updates -------------------------

/**
 * O(1) piece-list lookup. `pieceIndex` is maintained in lockstep with
 * `pieceList` by do/undo; the previous linear scan ran on every move and was
 * one of the hottest costs in the search tree.
 */
function findSlot(st: FastState, sq: number): number {
  const slot: number = st.pieceIndex[sq];
  return slot >= 0 && slot < 32 ? slot : -1;
}

function freeSlot(st: FastState): number {
  for (let i = 0; i < 32; i++) {
    if (st.pieceList[i] === 0) return i;
  }
  return 0;
}

/**
 * Builds a fully populated FastState from a flat board and side to move.
 * Every incremental statistic is computed once here (O(90)), then maintained
 * in O(1) by do/undo for the rest of the search.
 */
export function fastStateFromSquares(
  squares: Int8Array,
  turnSign: number,
): FastState {
  const pieceList = new Int8Array(32);
  const pieceIndex = new Int8Array(90).fill(-1);
  const pieceSq = new Int8Array(32).fill(-1);
  const kingSq = new Int8Array([-1, -1]);
  let mg = 0;
  let eg = 0;
  let phase = 0;
  let slot = 0;
  for (let sq = 0; sq < 90; sq++) {
    const code = squares[sq];
    if (code === 0) continue;
    mg += PST_MG[(code + 7) * 90 + sq];
    eg += PST_EG[(code + 7) * 90 + sq];
    phase += PHASE_WEIGHT[Math.abs(code)];
    pieceList[slot] = code;
    pieceIndex[sq] = slot;
    pieceSq[slot] = sq;
    slot += 1;
    if (Math.abs(code) === 1) kingSq[sideIndex(code)] = sq;
  }
  const halves = computeKeyHalves(squares, turnSign);
  const built: FastState = {
    squares,
    mg,
    eg,
    phase: phase > PHASE_TOTAL ? PHASE_TOTAL : phase,
    key: packKey(halves[0], halves[1]),
    keyH1: halves[0],
    keyH2: halves[1],
    kingSq,
    pieceList,
    pieceIndex,
    pieceSq,
    zone: new Int32Array(2),
  };
  recomputeZone(built);
  return built;
}

/** Convenience constructor from the public `Board` object. */
export function fastStateFromBoard(board: Board, turnSign: number): FastState {
  const squares = new Int8Array(90);
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece) squares[col * 10 + row] = (piece.side === 'red' ? 1 : -1) * TYPE_CODE[piece.type];
    }
  }
  return fastStateFromSquares(squares, turnSign);
}

/**
 * Applies a flat move, keeping squares, mg/eg, phase, Zobrist key, king square
 * and piece list in lockstep. Piece-list slots are cached in `move` so undo is
 * O(1) even when a capture reuses the captured piece's slot.
 */
export function doMoveFast(st: FastState, move: FlatMove): void {
  const from: number = move.from;
  const to: number = move.to;
  const piece: number = move.piece;
  const captured: number = move.captured;
  const pieceIdx = (piece + 7) * 90;
  st.mg += PST_MG[pieceIdx + to] - PST_MG[pieceIdx + from];
  st.eg += PST_EG[pieceIdx + to] - PST_EG[pieceIdx + from];
  if (captured !== 0) {
    const captureIdx = (captured + 7) * 90;
    st.mg -= PST_MG[captureIdx + to];
    st.eg -= PST_EG[captureIdx + to];
    st.phase -= PHASE_WEIGHT[Math.abs(captured)];
  }

  let h1 = st.keyH1;
  let h2 = st.keyH2;
  let x = xorPiece(h1, h2, piece, from);
  h1 = x[0]; h2 = x[1];
  if (captured !== 0) {
    x = xorPiece(h1, h2, captured, to);
    h1 = x[0]; h2 = x[1];
  }
  x = xorPiece(h1, h2, piece, to);
  h1 = x[0]; h2 = x[1];
  // Remove the mover's turn hash and add the opponent's: the two tables must
  // both be toggled, otherwise the key keeps a stale turn component.
  x = xorTurn(h1, h2, Math.sign(piece));
  h1 = x[0]; h2 = x[1];
  x = xorTurn(h1, h2, -Math.sign(piece));
  h1 = x[0]; h2 = x[1];
  st.keyH1 = h1;
  st.keyH2 = h2;
  st.key = packKey(h1, h2);

  const slot: number = move.slot ?? findSlot(st, from);
  move.slot = slot;
  if (captured !== 0) {
    const capSlot: number = move.capSlot ?? findSlot(st, to);
    move.capSlot = capSlot;
    st.pieceList[slot] = 0;
    st.pieceSq[slot] = -1;
    st.pieceList[capSlot] = piece;
    st.pieceSq[capSlot] = to;
    st.pieceIndex[to] = capSlot;
  } else {
    st.pieceList[slot] = piece;
    st.pieceSq[slot] = to;
    st.pieceIndex[to] = slot;
  }
  st.pieceIndex[from] = -1;
  st.squares[from] = 0;
  st.squares[to] = piece;

  // v2026.11.19.8 — king-zone threat is fully reversible. The moving piece
  // changes only its own contribution (against the enemy king); a captured
  // piece removes its contribution against the mover's king. General moves
  // shift the reference point for EVERY piece, so they recompute O(32).
  const moverIdx: number = sideIndex(piece);
  const targetIdx: number = 1 - moverIdx; // the king this piece pressures
  const enemyKing: number = st.kingSq[targetIdx];
  st.zone[targetIdx] += zoneContribution(piece, to, enemyKing)
    - zoneContribution(piece, from, enemyKing);
  if (captured !== 0) {
    st.zone[moverIdx] -= zoneContribution(captured, to, st.kingSq[moverIdx]);
  }
  if (Math.abs(piece) === 1) {
    st.kingSq[moverIdx] = to;
    recomputeZone(st);
  }
}

/**
 * Toggles the side-to-move bit of the incremental key in place. Used only by
 * null-move nodes, where the logical turn flips but no piece moves; calling
 * twice restores the original key.
 */
export function toggleTurnInState(st: FastState, logicalTurnSign: number): void {
  const actual: number = -logicalTurnSign;
  const removed = xorTurn(st.keyH1, st.keyH2, actual);
  const added = xorTurn(removed[0], removed[1], logicalTurnSign);
  st.keyH1 = added[0];
  st.keyH2 = added[1];
  st.key = packKey(added[0], added[1]);
}

/** Reverses {@link doMoveFast} exactly, including cached list slots. */
export function undoMoveFast(st: FastState, move: FlatMove): void {
  const from: number = move.from;
  const to: number = move.to;
  const piece: number = move.piece;
  const captured: number = move.captured;
  const pieceIdx = (piece + 7) * 90;
  st.mg += PST_MG[pieceIdx + from] - PST_MG[pieceIdx + to];
  st.eg += PST_EG[pieceIdx + from] - PST_EG[pieceIdx + to];
  if (captured !== 0) {
    const captureIdx = (captured + 7) * 90;
    st.mg += PST_MG[captureIdx + to];
    st.eg += PST_EG[captureIdx + to];
    st.phase += PHASE_WEIGHT[Math.abs(captured)];
  }

  let h1 = st.keyH1;
  let h2 = st.keyH2;
  let x = xorPiece(h1, h2, piece, to);
  h1 = x[0]; h2 = x[1];
  if (captured !== 0) {
    x = xorPiece(h1, h2, captured, to);
    h1 = x[0]; h2 = x[1];
  }
  x = xorPiece(h1, h2, piece, from);
  h1 = x[0]; h2 = x[1];
  x = xorTurn(h1, h2, -Math.sign(piece));
  h1 = x[0]; h2 = x[1];
  x = xorTurn(h1, h2, Math.sign(piece));
  h1 = x[0]; h2 = x[1];
  st.keyH1 = h1;
  st.keyH2 = h2;
  st.key = packKey(h1, h2);

  const slot: number = move.slot ?? findSlot(st, to);
  if (captured !== 0) {
    const capSlot: number = move.capSlot ?? freeSlot(st);
    st.pieceList[slot] = 0;
    st.pieceSq[slot] = -1;
    st.pieceList[capSlot] = captured;
    st.pieceSq[capSlot] = to;
    st.pieceIndex[to] = capSlot;
  } else {
    st.pieceIndex[to] = -1;
  }
  st.pieceList[slot] = piece;
  st.pieceSq[slot] = from;
  st.pieceIndex[from] = slot;
  st.squares[to] = captured;
  st.squares[from] = piece;

  const moverIdx: number = sideIndex(piece);
  if (Math.abs(piece) === 1) {
    st.kingSq[moverIdx] = from;
    recomputeZone(st);
  } else {
    const targetIdx: number = 1 - moverIdx;
    const enemyKing: number = st.kingSq[targetIdx];
    st.zone[targetIdx] += zoneContribution(piece, from, enemyKing)
      - zoneContribution(piece, to, enemyKing);
    if (captured !== 0) {
      st.zone[moverIdx] += zoneContribution(captured, to, st.kingSq[moverIdx]);
    }
  }
}

// --- Leaf scan: mobility, threats, space ------------------------------------

/** Cheap R/C/N/P scan plus heavy-piece threat count for one side. */
function scanSide(st: FastState, sign: number, full: boolean): SideScan {
  const squares = st.squares;
  const king: number = st.kingSq[sideIndex(sign)];
  const kingCol: number = king >= 0 ? king / 10 | 0 : 4;
  const kingRow: number = king >= 0 ? king % 10 : sign > 0 ? 0 : 9;
  let mobility = 0;
  let space = 0;
  let attacks = 0;
  let heavy = 0;
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code === 0) continue;
    if ((code > 0 ? 1 : -1) === sign) {
      // Own piece: count landing squares for mobility/space.
      const sq: number = st.pieceSq[i];
      const col: number = sq / 10 | 0;
      const row: number = sq % 10;
      const type: number = Math.abs(code);
      if (type === 2 || type === 3 || type === 1) {
        if (!full) continue; // leaf only scans R/C/N/P
      }
      const countLanding = (c: number, r: number): void => {
        if (!onBoard(c, r)) return;
        const target = squares[c * 10 + r];
        if (target !== 0 && (target > 0 ? 1 : -1) === sign) return;
        mobility += 1;
        if (inEnemyBackFour(sign, r)) space += 1;
      };
      if (type === 5 || type === 6) {
        for (let d = 0; d < 4; d++) {
          const dc = ORTHO_DC[d];
          const dr = ORTHO_DR[d];
          let c = col + dc;
          let r = row + dr;
          let screen = false;
          while (onBoard(c, r)) {
            const target = squares[c * 10 + r];
            if (!screen) {
              if (target === 0) {
                mobility += 1;
                if (inEnemyBackFour(sign, r)) space += 1;
              } else {
                screen = true;
                if (type === 5 && (target > 0 ? 1 : -1) !== sign) {
                  mobility += 1;
                  if (inEnemyBackFour(sign, r)) space += 1;
                }
              }
            } else if (target !== 0) {
              if ((target > 0 ? 1 : -1) !== sign) {
                mobility += 1;
                if (inEnemyBackFour(sign, r)) space += 1;
              }
              break;
            }
            c += dc;
            r += dr;
          }
        }
      } else if (type === 4) {
        for (let k = 0; k < 8; k++) {
          const lc = col + KNIGHT_LEG_DC[k];
          const lr = row + KNIGHT_LEG_DR[k];
          if (!onBoard(lc, lr) || squares[lc * 10 + lr] !== 0) continue;
          countLanding(col + KNIGHT_DC[k], row + KNIGHT_DR[k]);
        }
      } else if (type === 7) {
        countLanding(col, row + (sign > 0 ? 1 : -1));
        if (crossedRiver(sign, row)) {
          countLanding(col - 1, row);
          countLanding(col + 1, row);
        }
      } else if (type === 2) {
        for (let d = 0; d < 4; d++) {
          const c = col + DIAG_DC[d];
          const r = row + DIAG_DR[d];
          if (inPalace(c, r, sign)) countLanding(c, r);
        }
      } else if (type === 3) {
        for (let d = 0; d < 4; d++) {
          const c = col + ELE_DC[d];
          const r = row + ELE_DR[d];
          const eye = squares[(col + ELE_DC[d] / 2) * 10 + row + ELE_DR[d] / 2];
          if (onBoard(c, r) && ownHalf(sign, r) && eye === 0) countLanding(c, r);
        }
      } else if (type === 1) {
        for (let d = 0; d < 4; d++) {
          const c = col + ORTHO_DC[d];
          const r = row + ORTHO_DR[d];
          if (inPalace(c, r, sign)) countLanding(c, r);
        }
      }
    } else {
      // Enemy piece: contributes to our king danger when it crossed the river
      // or is close to our king. R/N count double, C/P single.
      const sq: number = st.pieceSq[i];
      const col: number = sq / 10 | 0;
      const row: number = sq % 10;
      const type: number = Math.abs(code);
      if (type === 5 || type === 4 || type === 6) heavy += 1;
      const near: boolean = Math.abs(col - kingCol) + Math.abs(row - kingRow) <= 5;
      if (near || (type !== 1 && crossedRiver(-sign, row))) {
        attacks += type === 5 || type === 4 ? 2 : 1;
      }
    }
  }
  // A heavy-material edge makes our threats more credible.
  if (heavy >= 2) attacks += heavy >= 4 ? 2 : 1;
  if (attacks > 8) attacks = 8;
  return { mobility, space, attacks, heavy };
}

/**
 * Diagnostic one-pass scan (NOT used by `leafTerms` any more after the
 * v2026.11.19.1 layering fix). Kept exported only so tooling can inspect the
 * pre-layering terms; the search hot path never calls it.
 */
export function leafScanBoth(st: FastState): SideScan & {
  redMobility: number; blackMobility: number;
  redSpace: number; blackSpace: number;
  redAttacks: number; blackAttacks: number;
  redDev: number; blackDev: number;
} {
  const squares = st.squares;
  const kings = [st.kingSq[0], st.kingSq[1]];
  let redMobility = 0; let blackMobility = 0;
  let redSpace = 0; let blackSpace = 0;
  let redAttacks = 0; let blackAttacks = 0;
  let redHeavy = 0; let blackHeavy = 0;
  let redDev = 0; let blackDev = 0;
  const addLanding = (sign: number, c: number, r: number): void => {
    if (!onBoard(c, r)) return;
    const target = squares[c * 10 + r];
    if (target !== 0 && (target > 0 ? 1 : -1) === sign) return;
    if (sign === 1) {
      redMobility += 1;
      if (inEnemyBackFour(sign, r)) redSpace += 1;
    } else {
      blackMobility += 1;
      if (inEnemyBackFour(sign, r)) blackSpace += 1;
    }
  };
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code === 0) continue;
    const sq: number = st.pieceSq[i];
    const col: number = sq / 10 | 0;
    const row: number = sq % 10;
    const type: number = Math.abs(code);
    if (code > 0) {
      // Red piece: mobility for red, threat to black king when it is enemy.
      const king: number = kings[1];
      const kingCol: number = king >= 0 ? king / 10 | 0 : 4;
      const kingRow: number = king >= 0 ? king % 10 : 9;
      const near: boolean = Math.abs(col - kingCol) + Math.abs(row - kingRow) <= 5;
      if (near || (type !== 1 && crossedRiver(1, row))) blackAttacks += type === 4 || type === 5 ? 2 : 1;
      if (type === 2 || type === 3 || type === 1) continue;
      if (type === 4 || type === 5 || type === 6) redHeavy += 1;
      if (type === 5 || type === 6) {
        for (let d = 0; d < 4; d++) {
          const dc = ORTHO_DC[d]; const dr = ORTHO_DR[d];
          let c = col + dc; let r = row + dr; let screen = false;
          while (onBoard(c, r)) {
            const target = squares[c * 10 + r];
            if (!screen) {
              if (target === 0) addLanding(1, c, r);
              else {
                screen = true;
                if (type === 5 && (target > 0 ? 1 : -1) !== 1) addLanding(1, c, r);
              }
            } else if (target !== 0) {
              if (target < 0) addLanding(1, c, r);
              break;
            }
            c += dc; r += dr;
          }
        }
      } else if (type === 4) {
        for (let k = 0; k < 8; k++) {
          const lc = col + KNIGHT_LEG_DC[k]; const lr = row + KNIGHT_LEG_DR[k];
          if (!onBoard(lc, lr) || squares[lc * 10 + lr] !== 0) continue;
          addLanding(1, col + KNIGHT_DC[k], row + KNIGHT_DR[k]);
        }
      } else if (type === 7) {
        addLanding(1, col, row + 1);
        if (row >= 5) { addLanding(1, col - 1, row); addLanding(1, col + 1, row); }
      }
      if (st.phase > 44) {
        if (type === 6 && row >= 5) redDev -= Math.min(80, 55 + (row - 5) * 5) >> 1;
        else if (type === 7 && row === 4) redDev += 8;
        else if (type === 4 && row === 0) redDev -= 14;
      }
    } else {
      // Black piece: mirrored attack/space/mobility logic.
      const king: number = kings[0];
      const kingCol: number = king >= 0 ? king / 10 | 0 : 4;
      const kingRow: number = king >= 0 ? king % 10 : 0;
      const near: boolean = Math.abs(col - kingCol) + Math.abs(row - kingRow) <= 5;
      if (near || (type !== 1 && crossedRiver(-1, row))) blackAttacks += type === 4 || type === 5 ? 2 : 1;
      if (type === 2 || type === 3 || type === 1) continue;
      if (type === 4 || type === 5 || type === 6) blackHeavy += 1;
      if (type === 5 || type === 6) {
        for (let d = 0; d < 4; d++) {
          const dc = ORTHO_DC[d]; const dr = ORTHO_DR[d];
          let c = col + dc; let r = row + dr; let screen = false;
          while (onBoard(c, r)) {
            const target = squares[c * 10 + r];
            if (!screen) {
              if (target === 0) addLanding(-1, c, r);
              else {
                screen = true;
                if (type === 5 && target > 0) addLanding(-1, c, r);
              }
            } else if (target !== 0) {
              if (target > 0) addLanding(-1, c, r);
              break;
            }
            c += dc; r += dr;
          }
        }
      } else if (type === 4) {
        for (let k = 0; k < 8; k++) {
          const lc = col + KNIGHT_LEG_DC[k]; const lr = row + KNIGHT_LEG_DR[k];
          if (!onBoard(lc, lr) || squares[lc * 10 + lr] !== 0) continue;
          addLanding(-1, col + KNIGHT_DC[k], row + KNIGHT_DR[k]);
        }
      } else if (type === 7) {
        addLanding(-1, col, row - 1);
        if (row <= 4) { addLanding(-1, col - 1, row); addLanding(-1, col + 1, row); }
      }
      if (st.phase > 44) {
        if (type === 6 && row <= 4) blackDev -= Math.min(80, 55 + (4 - row) * 5) >> 1;
        else if (type === 7 && row === 5) blackDev += 8;
        else if (type === 4 && row === 9) blackDev -= 14;
      }
    }
  }
  if (redHeavy >= 2) redAttacks += redHeavy >= 4 ? 2 : 1;
  if (blackHeavy >= 2) blackAttacks += blackHeavy >= 4 ? 2 : 1;
  return {
    mobility: redMobility - blackMobility,
    attacks: redAttacks - blackAttacks,
    space: redSpace - blackSpace,
    heavy: redHeavy - blackHeavy,
    redMobility, blackMobility, redSpace, blackSpace,
    redAttacks: Math.min(8, redAttacks), blackAttacks: Math.min(8, blackAttacks),
    redDev, blackDev,
  };
}

/** Cheap mobility-only scan used by tests that need a single term. */
export function mobilityFor(st: FastState, sign: number): number {
  return scanSide(st, sign, false).mobility * MOBILITY_WEIGHT;
}

/** Dynamic attacks factor (0..8) used by king safety and threat tables. */
export function attacksFor(st: FastState, sign: number): number {
  return scanSide(st, sign, false).attacks;
}

// --- Pawn structure ----------------------------------------------------------

function pawnStructureFor(st: FastState, sign: number): number {
  const pawns: number[] = [];
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code !== sign * TYPE_CODE.P) continue;
    pawns.push(st.pieceSq[i]);
  }
  if (pawns.length === 0) return 0;
  const enemy: number[] = [];
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code !== -sign * TYPE_CODE.P) continue;
    enemy.push(st.pieceSq[i]);
  }
  const ahead = (row: number, other: number): boolean => sign > 0 ? other > row : other < row;
  let score = 0;
  for (const sq of pawns) {
    const col: number = sq / 10 | 0;
    const row: number = sq % 10;
    let passed = true;
    for (const esq of enemy) {
      const ec: number = esq / 10 | 0;
      const er: number = esq % 10;
      if (Math.abs(ec - col) <= 1 && ahead(row, er)) { passed = false; break; }
    }
    let isolated = true;
    let connected = false;
    let supported = false;
    for (const osq of pawns) {
      if (osq === sq) continue;
      const oc: number = osq / 10 | 0;
      const orow: number = osq % 10;
      if (Math.abs(oc - col) !== 1) continue;
      isolated = false;
      if (Math.abs(orow - row) <= 1) connected = true;
      if (crossedRiver(sign, row) && Math.abs(orow - row) <= 2) supported = true;
    }
    const advance: number = sign > 0 ? row : 9 - row;
    if (passed) score += Math.min(60, 25 + Math.max(0, advance - 4) * 7);
    if (isolated) score -= 12;
    if (connected) score += 15;
    if (supported) score += 20;
  }
  return score;
}

// Development / premature-attack surrogates are baked into PST_MG in pst.ts.

/**
 * A horse parked in the palace centre ("窝心马") blocks its own general and
 * has no useful horse-legs. The public PST already has a mild centre value,
 * so the full layer applies the additional strategic penalty. Red's centre
 * is (4,1), black's mirrored centre is (4,8).
 */
export function palaceHorsePenaltyFor(st: FastState, sign: number): number {
  const sq: number = sign > 0 ? 4 * 10 + 1 : 4 * 10 + 8;
  if (st.squares[sq] !== sign * TYPE_CODE.N) return 0;
  return st.phase >= 33 ? -45 : -20;
}

/**
 * Heavy pieces or pawns directly around the enemy palace represent real
 * attacking coordination rather than a lone advanced piece. Chebyshev
 * distance <= 2 keeps this cheap (one 32-piece scan, full layer only).
 */
export function kingZonePressureFor(st: FastState, sign: number): number {
  const king: number = st.kingSq[sideIndex(-sign)];
  if (king < 0) return 0;
  const kc: number = king / 10 | 0;
  const kr: number = king % 10;
  let score: number = 0;
  for (let i = 0; i < 32; i++) {
    const code: number = st.pieceList[i];
    if (code === 0 || (code > 0 ? 1 : -1) !== sign) continue;
    const type: number = Math.abs(code);
    const weight: number = type === 5 ? 12 : type === 6 ? 9 : type === 4 ? 7 : type === 7 ? 5 : 0;
    if (weight === 0) continue;
    const sq: number = st.pieceSq[i];
    const dc: number = Math.abs((sq / 10 | 0) - kc);
    const dr: number = Math.abs((sq % 10) - kr);
    if (dc <= 2 && dr <= 2) score += weight * (dc + dr <= 1 ? 2 : 1);
  }
  return score;
}

// --- King safety / pins / coordination (full detail only) -------------------

function kingSafetyFor(st: FastState, sign: number, attacks: number): number {
  let penalty: number = Math.round((80 * attacks) / 8);
  const king: number = st.kingSq[sideIndex(sign)];
  if (king < 0) return -penalty;
  const col: number = king / 10 | 0;
  const row: number = king % 10;
  const fileIdx: number = (sign > 0 ? col : 8 - col) + 3;
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code === 0 || (code > 0 ? 1 : -1) === sign) continue;
    const abs: number = Math.abs(code);
    if (abs !== 5 && abs !== 6) continue;
    const sq: number = st.pieceSq[i];
    const ec: number = sq / 10 | 0;
    const er: number = sq % 10;
    if (abs === 6 && ec === col) {
      // Hollow cannon: enemy cannon on our file with exactly one screen.
      let screens = 0;
      const step: number = er > row ? -1 : 1;
      for (let r = er + step; r !== row; r += step) {
        if (r < 0 || r > 9) break;
        if (st.squares[col * 10 + r] !== 0) screens += 1;
      }
      if (screens === 1) penalty += CVL_HOLLOW_THREAT[fileIdx] ?? 0;
    }
    if (abs === 5) {
      if (ec === col) {
        let blocked = false;
        const step: number = er > row ? -1 : 1;
        for (let r = er + step; r !== row; r += step) {
          if (r < 0 || r > 9) break;
          if (st.squares[col * 10 + r] !== 0) { blocked = true; break; }
        }
        if (!blocked) penalty += CVL_CENTRAL_THREAT[fileIdx] ?? 0;
      }
      if (er === row && row === (sign > 0 ? 0 : 9)) {
        let blocked = false;
        const step: number = ec > col ? -1 : 1;
        for (let c = ec + step; c !== col; c += step) {
          if (c < 0 || c > 8) break;
          if (st.squares[c * 10 + row] !== 0) { blocked = true; break; }
        }
        if (!blocked) penalty += CVL_BOTTOM_THREAT[fileIdx] ?? 0;
      }
    }
  }
  return -penalty;
}

function pinPenaltyFor(st: FastState, sign: number): number {
  const king: number = st.kingSq[sideIndex(sign)];
  if (king < 0) return 0;
  const kc: number = king / 10 | 0;
  const kr: number = king % 10;
  let penalty = 0;
  for (let d = 0; d < 4; d++) {
    const dc = ORTHO_DC[d];
    const dr = ORTHO_DR[d];
    let candidate = -1;
    let secondOwn = false;
    for (let step = 1; step <= 8; step++) {
      const c = kc + dc * step;
      const r = kr + dr * step;
      if (!onBoard(c, r)) break;
      const code = st.squares[c * 10 + r];
      if (code === 0) continue;
      if ((code > 0 ? 1 : -1) === sign) {
        if (candidate === -1) candidate = c * 10 + r;
        else { secondOwn = true; break; }
        continue;
      }
      if (candidate !== -1 && !secondOwn) {
        const enemyType: number = Math.abs(code);
        if (enemyType === 5 || enemyType === 6) {
          const ownType: number = Math.abs(st.squares[candidate]);
          const w: number = ownType === 5 ? 25 : ownType === 4 || ownType === 6 ? 20 : 15;
          penalty += w;
        }
      }
      break;
    }
  }
  return -penalty;
}

export function coordinationFor(st: FastState, sign: number): number {
  let score = 0;
  const squares = st.squares;
  for (let i = 0; i < 32; i++) {
    const a = st.pieceList[i];
    if (a === 0 || (a > 0 ? 1 : -1) !== sign) continue;
    const asi: number = st.pieceSq[i];
    const ac = asi / 10 | 0;
    const ar = asi % 10;
    const at: number = Math.abs(a);
    for (let j = i + 1; j < 32; j++) {
      const b = st.pieceList[j];
      if (b === 0 || (b > 0 ? 1 : -1) !== sign) continue;
      const bsi: number = st.pieceSq[j];
      const bc = bsi / 10 | 0;
      const br = bsi % 10;
      const bt: number = Math.abs(b);
      const aligned: boolean = ac === bc || ar === br;
      if (at === 5 && bt === 5 && aligned) score += 10;
      if ((at === 5 && bt === 6) || (at === 6 && bt === 5)) {
        if (aligned) score += 18;
      }
      if ((at === 4 && bt === 6) || (at === 6 && bt === 4)) {
        if (Math.abs(ac - bc) + Math.abs(ar - br) <= 2) score += 12;
      }
    }
    if (at === 5) {
      for (let d = 0; d < 4; d++) {
        const c = ac + ORTHO_DC[d];
        const r = ar + ORTHO_DR[d];
        if (!onBoard(c, r)) continue;
        const neighbour = squares[c * 10 + r];
        if (neighbour !== 0 && (neighbour > 0 ? 1 : -1) === sign) { score += 8; break; }
      }
    }
  }
  return score;
}

/** Dynamic threat-table interpolation using the 12th..14th public tables. */
function attackAdjustmentFor(st: FastState, sign: number, attacks: number): number {
  if (attacks <= 0) return 0;
  const factor: number = attacks / 8;
  let delta = 0;
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code === 0 || (code > 0 ? 1 : -1) !== sign) continue;
    delta += PST_ATTACK_DELTA[(code + 7) * 90 + st.pieceSq[i]];
  }
  return Math.round(delta * factor);
}

/**
 * v2026.11.20.1 — composed endgame knowledge. These are the standard
 * fortress / winning-material patterns a pure material+PST evaluator cannot
 * know, e.g. 单车难破士象全 and 马炮胜单士. The 32-piece count only runs in
 * low-phase positions; middlegame leaves pay a single integer comparison.
 * Returns red-perspective centipawns.
 */
export function endgameKnowledgeFor(st: FastState, _sign: number): number {
  if (st.phase > 20) return 0;
  const count = { red: [0, 0, 0, 0, 0, 0, 0], black: [0, 0, 0, 0, 0, 0, 0] };
  for (let i = 0; i < 32; i++) {
    const code = st.pieceList[i];
    if (code === 0) continue;
    const bucket = code > 0 ? count.red : count.black;
    bucket[Math.abs(code) - 1] += 1;
  }
  let score = 0;
  // indexes: 0=K 1=A 2=B 3=N 4=R 5=C 6=P
  for (const [mine, theirs] of [[count.red, count.black], [count.black, count.red]] as const) {
    const sign = mine === count.red ? 1 : -1;
    const loneRook = mine[4] === 1 && mine[3] === 0 && mine[5] === 0 && mine[6] === 0;
    const fullFortress = theirs[1] >= 2 && theirs[2] >= 2
      && theirs[3] === 0 && theirs[4] === 0 && theirs[5] === 0 && theirs[6] === 0;
    // A single rook cannot break 士象全: cancel most of its material value.
    if (loneRook && fullFortress) score -= sign * 700;
    // 马炮对单士 is a known win; a small nudge helps the search prefer it.
    if (mine[3] === 1 && mine[5] === 1 && mine[4] === 0 && mine[6] === 0
      && theirs[1] === 1 && theirs[2] === 0 && theirs[4] === 0 && theirs[5] === 0) {
      score += sign * 180;
    }
  }
  return score;
}

// --- Public evaluation entries ----------------------------------------------

/**
 * Cheap leaf score, from `rootSign`'s perspective. Uses incremental PST
 * values plus one piece-list scan; no allocation, no move generation.
 */
export function leafTerms(st: FastState, rootSign: number): number {
  // Hot path: incremental PST (material + position + baked development) plus
  // the v19.8 O(1) king-zone threat accumulator. Still no piece scan, no move
  // generation and no pin/space work here — those remain in the `full` layer.
  const score: number = tapered(st.mg, st.eg, st.phase)
    + zoneScoreOf(st)
    + endgameKnowledgeFor(st, 1);
  return rootSign === 1 ? score : -score;
}

/**
 * Full score (analysis, public evaluation, quiescence entry): leaf terms plus
 * pins, hollow-cannon / file / bottom threats, coordination and full mobility
 * for advisors, elephants and kings.
 */
export function fullTerms(st: FastState, rootSign: number): number {
  const red = scanSide(st, 1, true);
  const black = scanSide(st, -1, true);
  let score: number = tapered(st.mg, st.eg, st.phase)
    + zoneScoreOf(st)
    + endgameKnowledgeFor(st, 1);
  score += (red.mobility - black.mobility) * MOBILITY_WEIGHT;
  score += Math.round((red.space - black.space) * 1.5);
  score += kingSafetyFor(st, 1, red.attacks) - kingSafetyFor(st, -1, black.attacks);
  score += pinPenaltyFor(st, 1) - pinPenaltyFor(st, -1);
  score += pawnStructureFor(st, 1) - pawnStructureFor(st, -1);
  score += palaceHorsePenaltyFor(st, 1) - palaceHorsePenaltyFor(st, -1);
  score += kingZonePressureFor(st, 1) - kingZonePressureFor(st, -1);
  score += coordinationFor(st, 1) - coordinationFor(st, -1);
  score += attackAdjustmentFor(st, 1, red.attacks)
    - attackAdjustmentFor(st, -1, black.attacks);
  return rootSign === 1 ? score : -score;
}

/** Non-incremental leaf evaluation for regression tests (same formula). */
export function evaluateFastState(st: FastState, rootSign: number): number {
  return leafTerms(st, rootSign);
}

/** Human-readable material value, kept for callers of the old API. */
export function pieceValue(type: PieceType): number {
  return ({ K: 10000, A: 200, B: 200, N: 400, R: 900, C: 400, P: 100 } as const)[type];
}

/** Exported code map for tests that build flat boards by hand. */
export function codeOf(type: PieceType, sign: number): number {
  return sign * TYPE_CODE[type];
}

/** Reverse code map for tests and move conversion. */
export function typeOfCode(code: number): PieceType {
  return CODE_TYPE[Math.abs(code) - 1];
}
