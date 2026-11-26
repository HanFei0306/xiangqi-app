/**
 * v2026.11.20.1 — two explicit engine profiles.
 *
 * The normal match engine is balanced (opening book, phase-weighted
 * evaluation, modest mate proof). The 适情雅趣 engine is tactical-first:
 * proof searches run first, the time cap is short so the UI stays smooth,
 * and no opening book / local learning is involved.
 */

export type EngineProfileId = 'match' | 'ancient';

export interface EngineProfile {
  readonly id: EngineProfileId;
  /** Own-move proof search budget for a forced mate-in-2, milliseconds. */
  readonly mateProofMs: number;
  /** Iterative-deepening wall-clock cap, milliseconds (0 = use tier budget). */
  readonly searchMs: number;
  /** Deepest ply the profile is allowed to attempt. */
  readonly maxDepth: number;
  /** Whether a verified mate outranks the opening book and variety. */
  readonly mateFirst: boolean;
}

export const MATCH_PROFILE: EngineProfile = {
  id: 'match',
  mateProofMs: 120,
  searchMs: 0,
  maxDepth: 12,
  mateFirst: true,
};

export const ANCIENT_PROFILE: EngineProfile = {
  id: 'ancient',
  mateProofMs: 60,
  searchMs: 180,
  maxDepth: 4,
  mateFirst: true,
};
