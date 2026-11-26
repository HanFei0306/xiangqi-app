/**
 * Settings store (difficulty + theme + sound + music + effects + hint toggle).
 * Backed by localStorage so the player's preference persists across sessions.
 * Every setter persists a FULL snapshot of the current store state merged with
 * its patch, so toggling one control never erases the others.
 */

import { create } from 'zustand';
import {
  loadSettings,
  saveSettings,
  type BoardThemeId,
  type MusicTrackId,
  type SettingsData,
  type SoundEffects,
} from '../data/storage';
import type { Difficulty } from '../ai/types';
import type { Side } from '../engine/types';

interface SettingsStore {
  difficulty: Difficulty;
  soundEnabled: boolean;
  /** Which side the human plays ('red' default; 'black' = AI moves first). */
  playerSide: Side;
  boardTheme: BoardThemeId;
  musicTrack: MusicTrackId;
  musicVolume: number;
  effects: SoundEffects;
  tacticsHintEnabled: boolean;
  setDifficulty: (d: Difficulty) => void;
  setSoundEnabled: (v: boolean) => void;
  setPlayerSide: (s: Side) => void;
  setBoardTheme: (id: BoardThemeId) => void;
  setMusicTrack: (id: MusicTrackId) => void;
  setMusicVolume: (v: number) => void;
  setEffect: (key: keyof SoundEffects, v: boolean) => void;
  setTacticsHintEnabled: (v: boolean) => void;
}

const initialSettings = loadSettings();

/** Builds the complete persisted shape from the live store state. */
function persist(state: SettingsStore, patch: Partial<SettingsData>): void {
  saveSettings({
    difficulty: state.difficulty,
    soundEnabled: state.soundEnabled,
    playerSide: state.playerSide,
    boardTheme: state.boardTheme,
    musicTrack: state.musicTrack,
    musicVolume: state.musicVolume,
    effects: { ...state.effects },
    tacticsHintEnabled: state.tacticsHintEnabled,
    ...patch,
  } satisfies SettingsData);
}

export const useSettings = create<SettingsStore>((set, get) => ({
  difficulty: initialSettings.difficulty,
  soundEnabled: initialSettings.soundEnabled,
  playerSide: initialSettings.playerSide ?? 'red',
  boardTheme: initialSettings.boardTheme,
  musicTrack: initialSettings.musicTrack,
  musicVolume: initialSettings.musicVolume,
  effects: { ...initialSettings.effects },
  tacticsHintEnabled: initialSettings.tacticsHintEnabled,

  setDifficulty: (d: Difficulty) => {
    persist(get(), { difficulty: d });
    set({ difficulty: d });
  },
  setSoundEnabled: (v: boolean) => {
    persist(get(), { soundEnabled: v });
    set({ soundEnabled: v });
  },
  setPlayerSide: (s: Side) => {
    persist(get(), { playerSide: s });
    set({ playerSide: s });
  },
  setBoardTheme: (id: BoardThemeId) => {
    persist(get(), { boardTheme: id });
    set({ boardTheme: id });
  },
  setMusicTrack: (id: MusicTrackId) => {
    persist(get(), { musicTrack: id });
    set({ musicTrack: id });
  },
  setMusicVolume: (v: number) => {
    const volume: number = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    persist(get(), { musicVolume: volume });
    set({ musicVolume: volume });
  },
  setEffect: (key: keyof SoundEffects, v: boolean) => {
    const effects: SoundEffects = { ...get().effects, [key]: v };
    persist(get(), { effects });
    set({ effects });
  },
  setTacticsHintEnabled: (v: boolean) => {
    persist(get(), { tacticsHintEnabled: v });
    set({ tacticsHintEnabled: v });
  },
}));
