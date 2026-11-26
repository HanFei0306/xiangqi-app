/**
 * v2026.11.19.3 — settings persistence and backward compatibility.
 * Old saves only had difficulty/soundEnabled/playerSide; every new field must
 * fall back to a default without throwing, and partial saves must not wipe it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings } from '../../data/storage';
import { useSettings } from '../settings';
import { getBoardTheme, BOARD_THEMES } from '../../ui/theme';
import { MUSIC_TRACKS } from '../../audio/music';

const KEY = 'xiangqi-trainer:settings';

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({
    difficulty: 'intermediate',
    soundEnabled: true,
    playerSide: 'red',
    boardTheme: 'classic',
    musicTrack: 'off',
    musicVolume: 0.45,
    effects: { capture: true, check: true, mate: true },
    tacticsHintEnabled: true,
  });
});

describe('storage/settings backward compatibility', () => {
  it('fills defaults for every field missing from a legacy blob', () => {
    localStorage.setItem(KEY, JSON.stringify({ difficulty: 'easy', soundEnabled: false }));
    const s = loadSettings();
    expect(s.difficulty).toBe('easy');
    expect(s.soundEnabled).toBe(false);
    expect(s.playerSide).toBe('red');
    expect(s.boardTheme).toBe('classic');
    expect(s.musicTrack).toBe('off');
    expect(s.musicVolume).toBeGreaterThan(0);
    expect(s.effects).toEqual({ capture: true, check: true, mate: true });
    expect(s.tacticsHintEnabled).toBe(true);
  });

  it('rejects unknown new-field values instead of crashing', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ boardTheme: 'purple', musicTrack: 'mp3', musicVolume: 900, effects: { capture: 'yes' } }),
    );
    const s = loadSettings();
    expect(s.boardTheme).toBe('classic');
    expect(s.musicTrack).toBe('off');
    expect(s.musicVolume).toBe(1);
    expect(s.effects.capture).toBe(true);
  });

  it('partial save preserves previously stored fields', () => {
    saveSettings({ boardTheme: 'wood' });
    saveSettings({ musicTrack: 'canon' });
    const s = loadSettings();
    expect(s.boardTheme).toBe('wood');
    expect(s.musicTrack).toBe('canon');
  });

  it('settings store setters persist a full independent snapshot', () => {
    useSettings.getState().setBoardTheme('jade');
    useSettings.getState().setEffect('check', false);
    useSettings.getState().setTacticsHintEnabled(false);
    useSettings.getState().setMusicVolume(0.2);

    const s = loadSettings();
    expect(s.boardTheme).toBe('jade');
    expect(s.effects.check).toBe(false);
    expect(s.effects.capture).toBe(true);
    expect(s.tacticsHintEnabled).toBe(false);
    expect(s.musicVolume).toBeCloseTo(0.2);
  });
});

describe('board palette table', () => {
  it('ships exactly four themes with all palette slots filled', () => {
    for (const id of ['classic', 'wood', 'jade', 'ink'] as const) {
      const t = getBoardTheme(id);
      expect(t.id).toBe(id);
      expect(t.label.length).toBeGreaterThan(0);
      for (const key of ['felt', 'feltTexture', 'frame', 'line', 'borderLine', 'palaceFill', 'palaceBorder', 'palaceDiagonal', 'river', 'swatch'] as const) {
        expect(t[key].length, `${id}.${key}`).toBeGreaterThan(0);
      }
      expect(BOARD_THEMES[id]).toBeDefined();
    }
    // Unknown ids (e.g. a future save opened by this build) never crash.
    expect(getBoardTheme(undefined).id).toBe('classic');
    expect(getBoardTheme('bogus' as 'classic').id).toBe('classic');
  });

  it('classic reuses the shipped green-felt constants verbatim', () => {
    // Concrete values are owned by the art line; only the wiring is asserted.
    expect(getBoardTheme('classic').felt).toBe(BOARD_THEMES.classic.felt);
    expect(getBoardTheme('classic').feltTexture).toBe(BOARD_THEMES.classic.feltTexture);
  });

  it('music tracks use relative file:// safe paths with the shipped formats', () => {
    expect(MUSIC_TRACKS).toHaveLength(3);
    expect(MUSIC_TRACKS.map((t) => t.id)).toEqual(['moonlight', 'canon', 'yangguan']);
    expect(MUSIC_TRACKS.map((t) => t.src)).toEqual([
      'music/moonlight.m4a',
      'music/canon.ogg',
      'music/yangguan.ogg',
    ]);
    for (const t of MUSIC_TRACKS) {
      expect(t.src).toMatch(/^music\/[a-z]+\.(mp3|ogg|m4a)$/);
      expect(t.src.startsWith('/')).toBe(false);
      expect(t.src).not.toContain('http');
    }
    expect(loadSettings().musicTrack).toBe('off');
  });

  it('migrates the legacy songchuang id to the public-domain yangguan track', () => {
    localStorage.setItem(KEY, JSON.stringify({ musicTrack: 'songchuang' }));
    expect(loadSettings().musicTrack).toBe('yangguan');
  });
});
