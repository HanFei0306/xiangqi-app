/**
 * Data-layer types.
 *
 * The built-in puzzle library types were removed together with the 残局/开局
 * puzzle set; the practice screen now uses data/shiqingyaqu.ts.
 */

/** A persisted progress record for a puzzle. */
export interface PuzzleProgress {
  puzzleId: string;
  solved: boolean;
  attempts: number;
  bestLine: string;
}
