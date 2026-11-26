/**
 * Match statistics persisted in localStorage, per difficulty tier.
 *
 * The setup page reads these for the 资源行 (对局数 / 连胜 / 最佳连胜) and the
 * 战绩卡 (胜率 / 胜和负 计数); the game store writes one record whenever a
 * standard match reaches a terminal status. All access is try/catch-guarded
 * so the module is safe in Node / test environments.
 */

import type { Difficulty } from '../ai/types';

/** Outcome of a finished standard match, from the HUMAN player's perspective. */
export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchStats {
  wins: number;
  losses: number;
  draws: number;
  /** Current consecutive-win streak (reset on loss/draw). */
  streak: number;
  /** Longest consecutive-win streak ever reached on this tier. */
  bestStreak: number;
  /** Total finished games on this tier (wins + losses + draws). */
  total: number;
}

const KEY = 'xiangqi-trainer:match-stats';

function loadAll(): Partial<Record<Difficulty, MatchStats>> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<Difficulty, MatchStats>>) : {};
  } catch {
    return {};
  }
}

function saveAll(all: Partial<Record<Difficulty, MatchStats>>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* ignore quota / serialization errors */
  }
}

function sanitize(s: Partial<MatchStats> | undefined): MatchStats {
  return {
    wins: Number(s?.wins) || 0,
    losses: Number(s?.losses) || 0,
    draws: Number(s?.draws) || 0,
    streak: Number(s?.streak) || 0,
    bestStreak: Number(s?.bestStreak) || 0,
    total: Number(s?.total) || 0,
  };
}

/** Returns the accumulated match stats for one difficulty tier. */
export function loadMatchStats(difficulty: Difficulty): MatchStats {
  return sanitize(loadAll()[difficulty]);
}

/** Aggregated stats across ALL tiers (used by the setup page's 资源行). */
export function totalMatchStats(): MatchStats {
  const all = loadAll();
  const sum = sanitize(undefined);
  for (const tier of Object.keys(all) as Difficulty[]) {
    const s = sanitize(all[tier]);
    sum.wins += s.wins;
    sum.losses += s.losses;
    sum.draws += s.draws;
    sum.total += s.total;
    sum.bestStreak = Math.max(sum.bestStreak, s.bestStreak);
  }
  return sum;
}

/**
 * Records one finished match on the given tier and returns the updated stats.
 * A win extends the streak; a loss or draw resets it.
 */
export function recordMatchOutcome(difficulty: Difficulty, outcome: MatchOutcome): MatchStats {
  const all = loadAll();
  const s = sanitize(all[difficulty]);
  s.total += 1;
  if (outcome === 'win') {
    s.wins += 1;
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
  } else if (outcome === 'loss') {
    s.losses += 1;
    s.streak = 0;
  } else {
    s.draws += 1;
    s.streak = 0;
  }
  all[difficulty] = s;
  saveAll(all);
  return s;
}
