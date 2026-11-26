/**
 * v19.7 baseline stub: the version-match harness always runs the top tier,
 * which used a neutral adjustment in v19.7 as well. Keeping this independent
 * of localStorage makes the baseline reproducible in Node and in Vitest.
 */
import type { GameState, Move, Side } from '../../../engine/types';

export interface EvolutionAdjustment {
  openingReply: Record<string, number>;
  middlegame: Record<string, number>;
  openingPressure: Record<string, number>;
  totalGames: number;
  level: number;
  enabled: boolean;
}

export const NEUTRAL_ADJUSTMENT: EvolutionAdjustment = {
  openingReply: {},
  middlegame: {},
  openingPressure: {},
  totalGames: 0,
  level: 0,
  enabled: false,
};

export function getEvolutionAdjustment(): EvolutionAdjustment {
  return NEUTRAL_ADJUSTMENT;
}

export function recordGameResult(
  _moves: readonly Move[],
  _outcome: 'win' | 'loss' | 'draw',
  _state?: GameState,
  _side?: Side,
): void { /* baseline: no learning */ }
