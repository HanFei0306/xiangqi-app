/**
 * Local persistence (progress + settings) via localStorage. All access is wrapped
 * in try/catch so the module is safe to import in Node / test environments where
 * `localStorage` may be unavailable.
 *
 * v2026.11.19.3: settings gained board/music/effects/hint fields. Both loading
 * and saving normalize every field, so a blob written by an older build (which
 * only had difficulty/soundEnabled/playerSide) keeps working: missing fields
 * simply receive their defaults. `saveSettings` accepts a PARTIAL patch and
 * merges it with the stored blob, keeping legacy call sites source-compatible.
 */

import { isDifficulty, type Difficulty } from '../ai/types';
import type { Side } from '../engine/types';

const PREFIX = 'xiangqi-trainer:';

function loadJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore quota / serialization errors */
  }
}

/** Identifiers of the shipped board color schemes. */
export type BoardThemeId = 'classic' | 'wood' | 'jade' | 'ink';
/**
 * Music selection: 'off' plus the three shipped tracks. `songchuang` is a
 * legacy id kept only so an older save does not crash; it normalizes to the
 * public-domain replacement `yangguan`.
 */
export type MusicTrackId = 'off' | 'moonlight' | 'canon' | 'yangguan';

/** Independent visual effect switches consumed by the board renderer. */
export interface SoundEffects {
  capture: boolean;
  check: boolean;
  mate: boolean;
}

export const BOARD_THEME_IDS: readonly BoardThemeId[] = ['classic', 'wood', 'jade', 'ink'];
export const MUSIC_TRACK_IDS: readonly MusicTrackId[] = ['off', 'moonlight', 'canon', 'yangguan'];

export interface SettingsData {
  difficulty: Difficulty;
  /** Whether move / capture / check sound effects are enabled. */
  soundEnabled: boolean;
  /**
   * Which side the HUMAN plays. Red = player moves first (classic behaviour);
   * Black = the AI opens the game. Optional for backward compatibility with
   * settings blobs saved by older builds.
   */
  playerSide?: Side;
  /** Persistent board skin selection (the palette table lives in ui/theme.ts). */
  boardTheme: BoardThemeId;
  /** Background music track, or 'off'. */
  musicTrack: MusicTrackId;
  /** Background music volume, normalized to 0..1. */
  musicVolume: number;
  /** Visual effect toggles. */
  effects: SoundEffects;
  /** When true the hint system may name a tactic; otherwise plain move advice. */
  tacticsHintEnabled: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = {
  difficulty: 'intermediate',
  soundEnabled: true,
  playerSide: 'red',
  boardTheme: 'classic',
  musicTrack: 'off',
  musicVolume: 0.45,
  effects: { capture: true, check: true, mate: true },
  tacticsHintEnabled: true,
};

function isBoardThemeId(value: unknown): value is BoardThemeId {
  return typeof value === 'string' && (BOARD_THEME_IDS as readonly string[]).includes(value);
}

function isMusicTrackId(value: unknown): value is MusicTrackId {
  return typeof value === 'string' && (MUSIC_TRACK_IDS as readonly string[]).includes(value);
}

function clampVolume(value: unknown): number {
  const n: number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.musicVolume;
  return Math.min(1, Math.max(0, n));
}

/** Fills every missing/unknown field with its default. Never throws. */
function normalize(raw: Partial<SettingsData>): SettingsData {
  const storedEffects: Partial<SoundEffects> | undefined =
    raw.effects && typeof raw.effects === 'object' ? raw.effects : undefined;
  return {
    difficulty: isDifficulty(raw.difficulty) ? raw.difficulty : DEFAULT_SETTINGS.difficulty,
    soundEnabled:
      typeof raw.soundEnabled === 'boolean' ? raw.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    playerSide: raw.playerSide === 'black' ? 'black' : 'red',
    boardTheme: isBoardThemeId(raw.boardTheme) ? raw.boardTheme : DEFAULT_SETTINGS.boardTheme,
    // Old builds shipped a copyrighted track id; silently migrate to its
    // public-domain replacement instead of dropping the player's preference.
    // Cast through unknown because the legacy id is no longer in MusicTrackId.
    musicTrack:
      (raw.musicTrack as unknown) === 'songchuang'
        ? 'yangguan'
        : isMusicTrackId(raw.musicTrack)
        ? raw.musicTrack
        : DEFAULT_SETTINGS.musicTrack,
    musicVolume: clampVolume(raw.musicVolume),
    effects: {
      capture:
        typeof storedEffects?.capture === 'boolean'
          ? storedEffects.capture
          : DEFAULT_SETTINGS.effects.capture,
      check:
        typeof storedEffects?.check === 'boolean'
          ? storedEffects.check
          : DEFAULT_SETTINGS.effects.check,
      mate:
        typeof storedEffects?.mate === 'boolean'
          ? storedEffects.mate
          : DEFAULT_SETTINGS.effects.mate,
    },
    tacticsHintEnabled:
      typeof raw.tacticsHintEnabled === 'boolean'
        ? raw.tacticsHintEnabled
        : DEFAULT_SETTINGS.tacticsHintEnabled,
  };
}

/** Returns a fully-populated settings object, tolerating any legacy blob. */
export function loadSettings(): SettingsData {
  const raw = loadJSON<Partial<SettingsData>>('settings', {});
  return normalize(raw ?? {});
}

/**
 * Persists a partial patch. Existing fields (including ones written by older
 * builds) are preserved and the complete normalized blob is written back.
 */
export function saveSettings(patch: Partial<SettingsData>): void {
  const raw = loadJSON<Partial<SettingsData>>('settings', {});
  saveJSON('settings', normalize({ ...(raw ?? {}), ...patch }));
}

export interface ProgressData {
  /** Ids of puzzles the player has solved. */
  solved: string[];
  /** Number of attempts per puzzle id. */
  attempts: Record<string, number>;
}

const EMPTY_PROGRESS: ProgressData = { solved: [], attempts: {} };

export function loadProgress(): ProgressData {
  return loadJSON<ProgressData>('progress', EMPTY_PROGRESS);
}

export function saveProgress(progress: ProgressData): void {
  saveJSON('progress', progress);
}

/** Marks a puzzle as solved and records an attempt. */
export function recordAttempt(puzzleId: string, solved: boolean): ProgressData {
  const progress = loadProgress();
  progress.attempts[puzzleId] = (progress.attempts[puzzleId] ?? 0) + 1;
  if (solved && !progress.solved.includes(puzzleId)) {
    progress.solved.push(puzzleId);
  }
  saveProgress(progress);
  return progress;
}
