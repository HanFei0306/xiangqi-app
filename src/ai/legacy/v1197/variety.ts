/**
 * Deterministic variety helpers (v2026.11.20).
 *
 * The engine must avoid playing the same sequence in every game, yet it must
 * stay reproducible within one game: a repeated position has to receive the
 * same move, otherwise repetition/perpetual-check judgement becomes unstable.
 * Every helper here is a PURE integer function of (game salt, position key,
 * move code). No global state, no Math.random, no floating point in the hot
 * path, so results are identical on every WebView and in every test run.
 */

/** Avalanche mixer (finalizer of MurmurHash3). Returns a signed 32-bit int. */
export function mix32(value: number): number {
  let h: number = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) | 0;
}

/**
 * Uniform unsigned roll for one decision. Mixing the salt FIRST and the move
 * code LAST makes the choice change across games but stay fixed for a given
 * (salt, position, move) triple inside a game.
 */
export function decisionRoll(salt: number, key: number, moveCode: number): number {
  return mix32(mix32((salt ^ key) | 0) ^ mix32(moveCode)) >>> 0;
}

/** Compact, collision-safe integer code for a flat move (90 squares). */
export function flatMoveCode(from: number, to: number, piece: number): number {
  return (((from * 90 + to) * 8 + (Math.abs(piece) - 1)) | 0);
}

/**
 * Weighted pick from a probability catalogue. `roll` is any unsigned integer;
 * a weight of 10 is chosen twice as often as a weight of 5.
 * Returns -1 only when the catalogue has no positive weight.
 */
export function pickWeighted(weights: readonly number[], roll: number): number {
  let total: number = 0;
  for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]);
  if (total <= 0) return -1;
  let cursor: number = roll % total;
  for (let i = 0; i < weights.length; i++) {
    cursor -= Math.max(0, weights[i]);
    if (cursor < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Chooses one item deterministically by hashing each item's code and taking
 * the smallest roll. Ties fall back to the original order, so the result is
 * always one of the supplied items and never depends on sort stability.
 */
export function chooseByRoll<T>(
  items: readonly T[],
  codeOf: (item: T) => number,
  salt: number,
  key: number,
): T | null {
  if (items.length === 0) return null;
  let best: T = items[0];
  let bestRoll: number = decisionRoll(salt, key, codeOf(best));
  for (let i = 1; i < items.length; i++) {
    const roll: number = decisionRoll(salt, key, codeOf(items[i]));
    if (roll < bestRoll) {
      best = items[i];
      bestRoll = roll;
    }
  }
  return best;
}
