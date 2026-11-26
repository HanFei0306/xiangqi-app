/**
 * Mapping between the setup page's 1-25 difficulty slider and the AI tiers.
 *
 *   1-8   -> easy          (中级)
 *   9-17  -> intermediate  (高级)
 *   18-25 -> master        (大师)
 *
 * The legacy 'beginner' tier stays valid (loaded from old saved settings) and
 * is displayed at slider position 1; moving the slider selects one of the
 * three tiers above. Pure functions so the mapping is unit-testable.
 */

import type { Difficulty } from '../ai/types';

/** Slider range shown on the setup page. */
export const SLIDER_MIN = 1;
export const SLIDER_MAX = 25;

/** Maps a slider position (clamped to [1, 25]) to its AI difficulty tier. */
export function tierFromSlider(value: number): Difficulty {
  const v = Math.round(value);
  if (v <= 8) return 'easy';
  if (v <= 17) return 'intermediate';
  return 'master';
}

/**
 * Maps a difficulty tier to a representative slider position. 'beginner' has
 * no slider band of its own; it renders at the minimum (1).
 */
export function sliderForTier(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'beginner': return 1;
    case 'easy': return 8;
    case 'intermediate': return 17;
    case 'master': return 25;
  }
}
