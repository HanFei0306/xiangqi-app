import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { play, playAt, setMuted, resume, type SoundType } from '../sound';

/** Every oscillator/bufferSource `start()` call is recorded here. */
let started: number[] = [];
/** Every `stop()` call, used to prove a pending scheduled clack can be cancelled. */
let stopped: number[] = [];
/** Initial `frequency.setValueAtTime` values: band + 4 partials per clack. */
let frequencies: number[] = [];

class FakeParam {
  value = 0;
  constructor(private readonly sink?: number[]) {}
  setValueAtTime(value: number): this {
    this.sink?.push(value);
    return this;
  }
  linearRampToValueAtTime(): this {
    return this;
  }
  exponentialRampToValueAtTime(): this {
    return this;
  }
}
class FakeNode {
  frequency = new FakeParam(frequencies);
  gain = new FakeParam();
  Q = new FakeParam();
  connect = vi.fn(() => this);
  start = vi.fn((when?: number) => {
    started.push(typeof when === 'number' ? when : 0);
  });
  stop = vi.fn((when?: number) => {
    stopped.push(typeof when === 'number' ? when : 0);
  });
}
class FakeBuffer {
  getChannelData(): Float32Array {
    return new Float32Array(16);
  }
}
class FakeCtx {
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  createOscillator() {
    return new FakeNode();
  }
  createGain() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createBuffer(): FakeBuffer {
    return new FakeBuffer();
  }
  resume() {
    return Promise.resolve();
  }
}

type Win = { window?: { AudioContext: typeof FakeCtx } };

let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  started = [];
  stopped = [];
  frequencies = [];
  setMuted(false);
  (globalThis as unknown as Win).window = { AudioContext: FakeCtx };
  spy = vi.spyOn(FakeCtx.prototype, 'createOscillator');
});

afterEach(() => {
  delete (globalThis as unknown as Win).window;
  spy.mockRestore();
});

describe('sound', () => {
  it('plays oscillators when AudioContext is available and not muted', () => {
    setMuted(false);
    play('move');
    expect(spy).toHaveBeenCalled();
  });

  it('does not play anything when muted', () => {
    setMuted(true);
    play('move');
    expect(spy).not.toHaveBeenCalled();
    expect(started).toHaveLength(0);
    setMuted(false);
  });

  it('never throws when AudioContext is unavailable (Node)', () => {
    delete (globalThis as unknown as Win).window;
    expect(() => {
      play('move');
      resume();
      setMuted(true);
      play('move');
    }).not.toThrow();
  });
});

/**
 * v2026.11.19.2 red line: ONE crisp mahjong clack per completed move.
 * The muffled 520Hz triangle body is GONE — that fourth node slot is now a
 * bright high partial, so `mahjongClack` still starts exactly five nodes
 * (one noise transient + four inharmonic HIGH partials), all at t=0. The node
 * count and simultaneous start are unchanged on purpose: the CDP red-line
 * probe asserts 5 nodes (1 buffer + 4 oscillator) per move with whenSpread=0.
 * Any second clack, a bronze gong (delayed partials) or a plucked ending
 * would change either the count or the start times.
 */
describe('一步一响：固定单次麻将落牌声', () => {
  const LANDING_CUES: readonly SoundType[] = ['move', 'capture', 'check', 'win', 'lose'];

  for (const cue of LANDING_CUES) {
    it(`${cue}: exactly one 5-node clack, all layers simultaneous`, () => {
      started = [];
      play(cue);
      expect(started, `${cue} must start exactly five clack nodes`).toHaveLength(5);
      // All layers of one strike start together — a delayed layer would be a
      // distinct second sound (this is what the old bronze gong did).
      expect(started.every((t) => t === 0), `${cue} has a delayed layer`).toBe(true);
    });
  }

  it('slide is silent so the flight start can never double the sound', () => {
    started = [];
    play('slide');
    expect(started).toHaveLength(0);
  });

  it('a move followed by a check cue produces two separate single clacks', () => {
    started = [];
    play('move');
    play('check');
    // Two moves == two clacks, never four (no double strike inside either).
    expect(started).toHaveLength(10);
  });
});

/**
 * v2026.11.19.8: check and capture must be identifiable by ear, not just by
 * a 2% volume tweak. The spectrum is compared here; the one-strike node
 * contract above is unchanged.
 */
describe('将军 / 吃子独立音色', () => {
  const spectrum = (cue: SoundType): number[] => {
    frequencies = [];
    started = [];
    play(cue);
    expect(started, `${cue} must remain one 5-node clack`).toHaveLength(5);
    expect(started.every((v) => v === 0)).toBe(true);
    expect(frequencies, `${cue} must set band + 4 partials`).toHaveLength(5);
    return frequencies;
  };

  it('move / capture / check have three distinct starting spectra', () => {
    const move = spectrum('move');
    const capture = spectrum('capture');
    const check = spectrum('check');
    expect(move).not.toEqual(capture);
    expect(move).not.toEqual(check);
    expect(capture).not.toEqual(check);
  });

  it('capture is lower and check is brighter than a normal move', () => {
    const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const move = avg(spectrum('move'));
    const capture = avg(spectrum('capture'));
    const check = avg(spectrum('check'));
    expect(capture).toBeLessThan(move - 500);
    expect(check).toBeGreaterThan(move + 500);
  });

  it('no clack contains a low-frequency body node any more', () => {
    for (const cue of ['move', 'capture', 'check'] as const) {
      expect(Math.min(...spectrum(cue))).toBeGreaterThan(1500);
    }
  });
});

/**
 * v2026.11.19.9: the practice page schedules the landing strike inside the
 * click gesture and starts it later with Web Audio's clock. This is the only
 * reliable path on Android WebView (a setTimeout-created node is dropped).
 */
describe('手势内预约落地音（Android WebView 修复）', () => {
  it('playAt schedules all five nodes at the same future instant', () => {
    started = [];
    stopped = [];
    playAt('check', undefined, 0.2);
    expect(started).toHaveLength(5);
    expect(started.every((t) => Math.abs(t - 0.2) < 1e-9)).toBe(true);
  });

  it('the returned cancel stops every pending node exactly once', () => {
    started = [];
    stopped = [];
    const cancel = playAt('capture', undefined, 0.2);
    // Scheduled stop() calls carry a future time; the cancel path calls stop()
    // with no argument, which the fake records as 0.
    const immediate = (): number => stopped.filter((t) => t === 0).length;
    cancel();
    expect(immediate()).toBe(5);
    cancel();
    expect(immediate()).toBe(5); // idempotent
  });

  it('playAt is silent when muted', () => {
    setMuted(true);
    started = [];
    playAt('check', undefined, 0.2);
    expect(started).toHaveLength(0);
    setMuted(false);
  });
});
