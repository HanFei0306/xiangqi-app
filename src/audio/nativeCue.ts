/**
 * Native Android cue playback. The WebView's Web Audio path can be dropped by
 * strict vendors; the host app plays the SAME base64 voice clips through
 * MediaPlayer instead. Returns false on desktop/test so callers can fall back
 * to the built-in Web Audio announcement.
 */
export type NativeCue = 'capture' | 'check' | 'mate' | 'land';

interface NativeBridge {
  playCue?: (cue: NativeCue) => void;
}

export function playNativeCue(cue: NativeCue): boolean {
  if (typeof window === 'undefined') return false;
  const api = (window as unknown as { XiangqiNative?: NativeBridge }).XiangqiNative;
  if (!api || typeof api.playCue !== 'function') return false;
  try {
    api.playCue(cue);
    return true;
  } catch {
    return false;
  }
}
