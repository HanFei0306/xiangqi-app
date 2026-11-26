/**
 * QA acceptance tests — data layer (storage).
 *
 * `storage.ts` is self-contained (wraps localStorage, safe under jsdom)
 * and must PASS today — it proves persistence works.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSettings,
  saveSettings,
  recordAttempt,
  loadProgress,
} from '../data/storage';

beforeEach(() => {
  localStorage.clear();
});

describe('storage — settings (verifiable, must pass)', () => {
  it('round-trips difficulty', () => {
    saveSettings({ difficulty: 'master', soundEnabled: true });
    expect(loadSettings().difficulty).toBe('master');
  });

  it('defaults to intermediate when nothing stored', () => {
    expect(loadSettings().difficulty).toBe('intermediate');
  });

  it('falls back to intermediate for an unknown stored difficulty', () => {
    localStorage.setItem(
      'xiangqi-trainer:settings',
      JSON.stringify({ difficulty: 'grandmaster', soundEnabled: false }),
    );
    const loaded = loadSettings();
    expect(loaded.difficulty).toBe('intermediate');
    expect(loaded.soundEnabled).toBe(false);
  });

  it('round-trips the newly added easy tier', () => {
    saveSettings({ difficulty: 'easy', soundEnabled: true });
    expect(loadSettings().difficulty).toBe('easy');
  });
});

describe('storage — progress (verifiable, must pass)', () => {
  it('records attempts and solved puzzles', () => {
    recordAttempt('qa-entry', false);
    expect(loadProgress().attempts['qa-entry']).toBe(1);
    expect(loadProgress().solved).not.toContain('qa-entry');

    recordAttempt('qa-entry', true);
    const p = loadProgress();
    expect(p.attempts['qa-entry']).toBe(2);
    expect(p.solved).toContain('qa-entry');
  });

  it('records an attempt under a fresh key without losing others', () => {
    recordAttempt('qa-key-a', true);
    recordAttempt('qa-key-b', true);
    const p = loadProgress();
    expect(p.solved).toEqual(expect.arrayContaining(['qa-key-a', 'qa-key-b']));
  });
});
