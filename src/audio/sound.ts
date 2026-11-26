/**
 * Board sound effects — synthesized mahjong-tile clacks, no asset files.
 *
 * v2026.11.19.8 — three DISTINCT landing timbres while keeping the one-strike
 * red line intact. All three are still one mahjong tile hitting the table:
 *   - 'move'    : standard bright clack (reference spectrum, 5.6k -> 2.8k)
 *   - 'capture' : heavier, lower "crack" (4.3k -> 2.0k, mid partials stressed)
 *   - 'check'   : brighter, ringing "ting" (7.2k -> 4.2k, long high partials)
 * The profiles differ in noise band, Q, partial frequencies and decay, so the
 * three events are distinguishable by ear without adding a gong, a second
 * strike or any delayed layer.
 *
 * HARD RULE (unchanged): every completed move produces EXACTLY ONE sound.
 * `mahjongClack` starts exactly 5 nodes (1 noise transient + 4 high partials),
 * all at the very same instant t (identical `when`, no delayed layer). This is
 * the CDP red-line contract: 1 buffer + 4 oscillators, whenSpread = 0.
 * 'slide' remains a silent no-op so the flight start never adds a second hit.
 *
 * v2026.11.19.9: `playAt()` creates all five nodes inside the user gesture and
 * starts them later via Web Audio's own clock. This is the Android WebView-safe
 * path for delayed landing sounds — a node created inside a later setTimeout
 * can be dropped by the WebView even when the context is running.
 *
 * No fetch / decode / binary assets: works from `file://` in Android WebView.
 */

import type { PieceType } from '../engine/types';

export type SoundType = 'slide' | 'move' | 'capture' | 'check' | 'win' | 'lose';

let muted = false;
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** Lazily creates (and caches) the AudioContext, or null when unavailable. */
function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** One reusable white-noise buffer for the clack's impact transient. */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.35);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noise = buf;
  return buf;
}

/** Per-piece resonance: heavy pieces land a touch lower, light pieces higher. */
function voice(piece: PieceType | undefined): { weight: number } {
  switch (piece) {
    case 'R': return { weight: 1.06 }; // 车 — dense
    case 'C': return { weight: 1.04 }; // 炮/砲
    case 'K': return { weight: 1.05 }; // 帅/将
    case 'N': return { weight: 1 };    // 马
    case 'B': return { weight: 0.98 }; // 相/象
    case 'A': return { weight: 0.96 }; // 仕/士
    default:  return { weight: 0.94 }; // 兵/卒
  }
}

/** [frequency, relative level, decay seconds] for one high partial. */
type Partial = readonly [number, number, number];

interface ClackProfile {
  /** Band-pass sweep of the impact transient: start -> end, Hz. */
  band: readonly [number, number];
  /** Band-pass Q. Higher = more focused "crack". */
  q: number;
  /** Exactly four inharmonic high partials (the 4 oscillator nodes). */
  partials: readonly [Partial, Partial, Partial, Partial];
}

/**
 * The three audible landing identities. Every number stays above 1.7kHz:
 * the old muffled 520Hz body is gone for good.
 */
const PROFILES: Readonly<Record<'move' | 'capture' | 'check', ClackProfile>> = {
  move: {
    band: [5600, 2800],
    q: 0.9,
    partials: [
      [2180, 0.62, 0.026],
      [3380 * 1.006, 0.46, 0.030],
      [4720 * 0.995, 0.30, 0.022],
      [6280 * 1.010, 0.20, 0.014],
    ],
  },
  capture: {
    // A heavier "crack": lower sweep, tighter filter, two stressed mid partials
    // and shorter ring — unmistakably a capture, still a single tile strike.
    band: [4300, 2050],
    q: 1.6,
    partials: [
      [1720, 0.72, 0.034],
      [2560 * 1.008, 0.58, 0.026],
      [3980 * 0.992, 0.24, 0.018],
      [5420 * 1.004, 0.14, 0.012],
    ],
  },
  check: {
    // A brighter "ting": the band and all four partials move up ~1.3x and the
    // ring is longer. Distinct from capture by pitch direction, not loudness.
    band: [7200, 4200],
    q: 0.7,
    partials: [
      [2900, 0.58, 0.038],
      [4350 * 1.006, 0.50, 0.034],
      [5800 * 0.995, 0.40, 0.028],
      [7250 * 1.010, 0.28, 0.020],
    ],
  },
};

interface ClackOptions {
  /** Overall peak gain. Default 0.48. */
  peak?: number;
  /** Small pitch multiplier so pieces differ without becoming another sound. */
  pitch?: number;
  /** Which of the three one-strike timbres to use. */
  profile?: 'move' | 'capture' | 'check';
  /**
   * Web Audio scheduling offset in seconds. The nodes are CREATED now (inside
   * the user gesture) but START at currentTime + at — critical on Android
   * WebView, which drops nodes created later by a setTimeout callback.
   */
  at?: number;
  /** Collects created source nodes so the caller can cancel a pending strike. */
  onNode?: (node: AudioScheduledSourceNode) => void;
}

/**
 * 一声清脆麻将落牌：1 个带通噪声瞬态 + 4 个非谐高频正弦泛音，
 * 5 个节点全部在同一时刻 t 起振，全部 <45ms 结束。没有延迟层。
 */
function mahjongClack(c: AudioContext, o: ClackOptions = {}): void {
  const t = c.currentTime + (o.at ?? 0);
  const peak = o.peak ?? 0.48;
  const pitch = o.pitch ?? 1;
  const p: ClackProfile = PROFILES[o.profile ?? 'move'];
  const detune = pitch;

  // Layer 1: the impact "啪".
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(p.band[0] * detune, t);
  band.frequency.exponentialRampToValueAtTime(p.band[1] * detune, t + 0.014);
  band.Q.value = p.q;
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(peak, t + 0.0006);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.013);
  src.connect(band);
  band.connect(ng);
  ng.connect(c.destination);
  o.onNode?.(src);
  src.start(t);
  src.stop(t + 0.02);

  // Layers 2..5: four high, inharmonic partials — the crisp "叮" edge.
  for (const [baseFreq, level, dur] of p.partials) {
    const freq: number = baseFreq * detune;
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.985, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * level, t + 0.0009);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(c.destination);
    o.onNode?.(osc);
    osc.start(t);
    osc.stop(t + dur + 0.004);
  }
}

export function setMuted(value: boolean): void { muted = value; }
export function isMuted(): boolean { return muted; }

/** Resumes a suspended AudioContext; must be called from a user gesture. */
export function resume(): void {
  const c = getCtx();
  if (c && c.state === 'suspended') {
    c.resume().catch(() => { /* ignore */ });
  }
}

/**
 * Plays one sound effect; silent no-op when muted or unsupported.
 * 一次调用最多一组节点（一声）——见模块头 HARD RULE。
 */
function schedule(
  type: SoundType,
  piece: PieceType | undefined,
  at: number,
  onNode?: (node: AudioScheduledSourceNode) => void,
): void {
  const c = getCtx();
  if (!c) return;
  const pitch = voice(piece).weight;
  switch (type) {
    case 'slide':
      // 飞行起始静音，保证一步只响一次。
      break;
    case 'move':
      mahjongClack(c, { peak: 0.48, pitch, profile: 'move', at, onNode });
      break;
    case 'capture':
      mahjongClack(c, { peak: 0.54, pitch, profile: 'capture', at, onNode });
      break;
    case 'check':
      mahjongClack(c, {
        peak: 0.55, pitch: pitch * 1.04, profile: 'check', at, onNode,
      });
      break;
    case 'win':
      mahjongClack(c, {
        peak: 0.56, pitch: pitch * 1.1, profile: 'check', at, onNode,
      });
      break;
    case 'lose':
      mahjongClack(c, {
        peak: 0.52, pitch: pitch * 0.94, profile: 'capture', at, onNode,
      });
      break;
  }
}

export function play(type: SoundType, piece?: PieceType): void {
  if (muted) return;
  schedule(type, piece, 0);
}

/**
 * v2026.11.19.9 — schedules a landing clack INSIDE the current user gesture
 * but starts it `delaySec` later using Web Audio's own clock. Android WebView
 * discards AudioNodes created by a later setTimeout callback; this keeps the
 * exact same sound as the normal game while remaining cancellable.
 *
 * Returns a cancel function for pending strikes (reset / undo / new puzzle).
 */
export function playAt(
  type: SoundType,
  piece: PieceType | undefined,
  delaySec: number,
): () => void {
  if (muted) return () => { /* nothing scheduled */ };
  const nodes: AudioScheduledSourceNode[] = [];
  schedule(type, piece, Math.max(0, delaySec), (node) => nodes.push(node));
  let cancelled = false;
  return () => {
    if (cancelled) return;
    cancelled = true;
    for (const node of nodes) {
      try { node.stop(); } catch { /* already stopped */ }
    }
  };
}
