/**
 * Chinese move announcement using BUILT-IN audio clips — no system TTS needed.
 *
 * A Windows/macOS-generated Tingting (zh-CN) female voice was rendered offline
 * into per-character AAC clips inlined as base64 data URIs (see voiceData.ts).
 * Each announcement is played by chaining an <audio> element per character;
 * event cues (将军 / 绝杀 / 吃) use whole-phrase clips for natural prosody.
 *
 * Why not speechSynthesis: many Android WebViews have no Chinese TTS voice,
 * so the browser API silently produces nothing. Built-in audio always works
 * under file:// with zero network, zero external files, zero permissions.
 */

import { VOICE_CLIPS } from './voiceData';

export type VoiceEvent = 'move' | 'capture' | 'check' | 'checkmate' | 'win' | 'lose' | 'draw';

/** Reports whether built-in voice data is present. */
export function voiceAvailable(): boolean {
  return Object.keys(VOICE_CLIPS).length > 0;
}

let lastKey = '';
let lastAt = 0;
/** Keeps only characters we actually have audio for; maps Arabic digits to Chinese. */
const DIGIT_TO_CN: Record<string, string> = {
  '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
  '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
};

export function normalize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text) {
    const ch = DIGIT_TO_CN[raw] ?? raw;
    if (/\s/.test(ch)) continue;
    // Skip punctuation that has no clip.
    if ('进退出入平前后吃将军绝杀，。、'.includes(ch) && !VOICE_CLIPS[ch]) continue;
    if (VOICE_CLIPS[ch]) out.push(ch);
  }
  return out;
}

let activeAudio: HTMLAudioElement | null = null;
/** Generation token: lets a newer announcement invalidate older callbacks. */
let playGeneration = 0;

/** Plays a sequence of clip keys back-to-back, then fires onDone. */
function playSequence(keys: string[], onDone?: () => void): void {
  const generation = ++playGeneration;
  if (keys.length === 0) {
    onDone?.();
    return;
  }
  // Stop any announcement already in progress so rapid moves don't overlap.
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.src = '';
    activeAudio = null;
  }
  let i = 0;
  const next = () => {
    if (generation !== playGeneration) return; // superseded by a newer call
    if (i >= keys.length) {
      onDone?.();
      return;
    }
    const uri = VOICE_CLIPS[keys[i++]];
    if (!uri) {
      next();
      return;
    }
    const audio = new Audio(uri);
    activeAudio = audio;
    audio.onended = () => { if (activeAudio === audio && generation === playGeneration) next(); };
    // If decode/play fails on an odd WebView, skip to the next clip.
    audio.onerror = () => { if (activeAudio === audio && generation === playGeneration) next(); };
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { if (activeAudio === audio && generation === playGeneration) next(); });
    }
  };
  next();
}

/** Speaks a sequence of clip keys (public for tests / advanced callers). */
export function speakKeys(keys: string[]): void {
  playSequence(keys.filter((k) => !!VOICE_CLIPS[k]));
}

/**
 * Announces a completed move in the natural order: read the notation FIRST,
 * then the event cue (吃 / 将军 / 绝杀) AFTER it. Calls `onDone` once every clip
 * has finished — the game store uses this to let the opponent reply only after
 * the player's move has been spoken.
 *
 * The event cue is never duplicated inside the notation stream, so a capture
 * sounds like "炮二平五，吃" rather than reading "吃" mid-move.
 */
export function announceMove(
  event: VoiceEvent,
  notation: string,
  onDone?: () => void,
): void {
  if (!voiceAvailable()) {
    onDone?.();
    return;
  }
  const clean = notation.replace(/\s+/g, '');
  const parts = normalize(clean);
  const eventKey: Partial<Record<VoiceEvent, string>> = {
    capture: '@吃',
    check: '@将军',
    checkmate: '@绝杀',
  };
  // Mate/check are more urgent: read the move, then the strong callout.
  const keys = [...parts];
  const cue = eventKey[event];
  if (cue) keys.push(cue);
  const key = keys.join('|');
  const now = Date.now();
  if (key === lastKey && now - lastAt < 400) {
    onDone?.();
    return;
  }
  lastKey = key;
  lastAt = now;
  playSequence(keys, onDone);
}

/**
 * Event-only callout (no move notation). Used by the live match: ordinary
 * moves are silent, but 吃 / 将军 / 绝杀 / 胜 / 和棋 are spoken on impact.
 * Fire-and-forget by design so voice never gates the AI's reply.
 */
export function announceEvent(event: VoiceEvent): void {
  if (!voiceAvailable()) return;
  const key: Partial<Record<VoiceEvent, string>> = {
    capture: '@吃',
    check: '@将军',
    checkmate: '@绝杀',
    win: '@胜',
    lose: '@胜',
    draw: '@和棋',
  };
  const clip = key[event];
  if (!clip) return;
  playSequence([clip]);
}

/**
 * Legacy announce API (fire-and-forget). Kept for callers/tests that don't
 * need sequencing; delegates to announceMove.
 */
export function speakEvent(event: VoiceEvent, notation: string): void {
  announceMove(event, notation);
}

/** Stops any in-progress announcement (e.g. on new game / undo). */
export function stopVoice(): void {
  playGeneration += 1;
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.src = '';
    activeAudio = null;
  }
}
