/**
 * Android WebView audio activation bridge (v2026.11.20.4).
 *
 * Some WebViews keep Web Audio suspended even after resume() unless a real
 * media element is played inside the FIRST user gesture. Playing a tiny silent
 * WAV there marks the tab as "user-gesture activated" in Chromium, so the
 * later scheduled mahjong clacks in 适情雅趣 are not dropped.
 *
 * Runs once, never auto-plays, no network and no asset file.
 */
import { resume } from './sound';

const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

let installed = false;

export function primeAudioOnFirstGesture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const activate = (): void => {
    window.removeEventListener('pointerdown', activate, true);
    try {
      const audio = new Audio(SILENT_WAV);
      audio.volume = 0.01;
      void audio.play().catch(() => { /* still try Web Audio below */ });
    } catch { /* ignore: Web Audio resume is the primary path */ }
    resume();
  };
  window.addEventListener('pointerdown', activate, { capture: true, once: true });
}
