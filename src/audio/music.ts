/**
 * Background music controller (v2026.11.19.3).
 *
 * file:// / Android WebView rule: the ONLY reliable way to play a local media
 * file is an HTMLMediaElement with a RELATIVE src. No fetch / decodeAudioData
 * (file:// fetch is blocked by CORS), no ES-module imports at runtime, no CDN.
 * The shipped files live in `public/music/`, Vite copies them verbatim to
 * `dist/music/`, and the packaging script places them in `android_asset/music/`
 * — i.e. next to index.html, so `music/xxx` resolves identically in dev,
 * static file:// and the APK.
 *
 * Robustness: `canplay` marks a loaded track ready; `error` marks the current
 * source as failed so we never retry/rethrow on a bad or missing asset. Music
 * is cosmetic — any failure must leave chess, sound effects and voice intact.
 *
 * Autoplay policy: a play() rejected before the first user gesture is not an
 * error for the player — we silently re-attempt once on the next pointerdown.
 */

import type { MusicTrackId } from '../data/storage';

/** Selectable tracks (the 'off' choice is handled separately in the panel). */
export interface MusicTrack {
  id: Exclude<MusicTrackId, 'off'>;
  /** Chinese label shown in the settings panel. */
  label: string;
  /** Relative media path, valid under file:// and http:// dev server. */
  src: string;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { id: 'moonlight', label: '德彪西《月光》', src: 'music/moonlight.m4a' },
  { id: 'canon', label: '帕赫贝尔《卡农》', src: 'music/canon.ogg' },
  { id: 'yangguan', label: '古琴《阳关三叠》', src: 'music/yangguan.ogg' },
];

/** Latest music source requested by the settings panel. */
let wanted: MusicTrackId = 'off';
/** One reusable element; switching src is cheaper and avoids overlapping music. */
let audio: HTMLAudioElement | null = null;
let unlockArmed = false;
/** Source that failed to load; prevents an error -> retry -> error loop. */
let failedSrc = '';

/**
 * jsdom exposes Audio but its play/pause are "Not implemented" stubs that log
 * to stderr. Real browsers/WebViews (including Android) always pass this gate.
 */
function mediaPlaybackAvailable(): boolean {
  if (typeof navigator === 'undefined' || typeof Audio === 'undefined') return false;
  return !/jsdom|node/i.test(navigator.userAgent);
}

function sourceFor(track: MusicTrackId): string {
  const found = MUSIC_TRACKS.find((t) => t.id === track);
  return found ? found.src : '';
}

function ensureAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!audio) {
    try {
      audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      // Both listeners are pure state updates: no play(), no throwing, no
      // recursion. They work even when a WebView refuses to start playback.
      audio.addEventListener('canplay', () => {
        if (failedSrc === sourceFor(wanted)) failedSrc = '';
      });
      audio.addEventListener('error', () => {
        failedSrc = sourceFor(wanted);
      });
    } catch {
      return null;
    }
  }
  return audio;
}

function onFirstGesture(): void {
  unlockArmed = false;
  if (wanted === 'off') return;
  const el = ensureAudio();
  if (el) start(el);
}

/** Arms a one-shot retry for WebViews that block play() before a gesture. */
function armUnlock(): void {
  if (unlockArmed || wanted === 'off' || typeof document === 'undefined') return;
  unlockArmed = true;
  document.addEventListener('pointerdown', onFirstGesture, { once: true });
}

function start(el: HTMLAudioElement): void {
  const src = sourceFor(wanted);
  if (!src || src === failedSrc) return;
  if (el.src !== src && !el.src.endsWith(src)) {
    try {
      el.src = src;
    } catch {
      failedSrc = src;
      return;
    }
  }
  try {
    const promise: Promise<void> | undefined = el.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        // A decode/format failure surfaces as an `error` event, which marks
        // failedSrc and stops future retries; autoplay blocks just retry once.
        if (sourceFor(wanted) !== failedSrc) armUnlock();
      });
    }
  } catch {
    if (sourceFor(wanted) !== failedSrc) armUnlock();
  }
}

/**
 * Selects a track and starts its loop. 'off' stops everything.
 * Volume is clamped to 0..1 and applied before playback starts.
 */
export function playMusic(track: MusicTrackId, volume: number): void {
  wanted = track;
  setMusicVolume(volume);
  if (track === 'off') {
    stopMusic();
    return;
  }
  if (!mediaPlaybackAvailable()) return;
  try {
    const el = ensureAudio();
    if (el) start(el);
  } catch {
    /* audio is a non-critical enhancement */
  }
}

/** Pauses and unloads the current track, keeping the reusable element. */
export function stopMusic(): void {
  wanted = 'off';
  if (!audio) return;
  if (mediaPlaybackAvailable()) {
    try {
      audio.pause();
    } catch {
      /* media elements may be unavailable in odd WebViews */
    }
  }
  try {
    audio.src = '';
  } catch {
    /* ignore */
  }
}

/** Changes volume on the live element without restarting a playing track. */
export function setMusicVolume(volume: number): void {
  const v: number = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
  if (audio) audio.volume = v;
}

/** Applies persisted settings on app mount; also arms the gesture retry. */
export function applyMusicSettings(track: MusicTrackId, volume: number): void {
  if (track === 'off') {
    wanted = 'off';
    setMusicVolume(volume);
    stopMusic();
    return;
  }
  playMusic(track, volume);
}

/** Test/debug introspection — the currently requested track id. */
export function currentMusicTrack(): MusicTrackId {
  return wanted;
}
