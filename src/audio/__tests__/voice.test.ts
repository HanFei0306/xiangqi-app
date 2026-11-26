import { describe, it, expect } from 'vitest';
import { VOICE_CLIPS } from '../voiceData';
import { normalize, voiceAvailable, speakEvent, announceEvent } from '../voice';

describe('built-in Chinese voice', () => {
  it('ships audio clips and reports available', () => {
    expect(voiceAvailable()).toBe(true);
    expect(Object.keys(VOICE_CLIPS).length).toBeGreaterThan(20);
    for (const uri of Object.values(VOICE_CLIPS)) {
      expect(uri.startsWith('data:audio/')).toBe(true);
      expect(uri.length).toBeGreaterThan(100);
    }
  });

  it('has every character needed for notation and all event phrases', () => {
    for (const ch of ['一', '二', '三', '四', '五', '六', '七', '八', '九', '炮', '马', '车', '进', '退', '平']) {
      expect(VOICE_CLIPS[ch], `missing clip for ${ch}`).toBeTruthy();
    }
    for (const phrase of ['@将军', '@绝杀', '@吃']) {
      expect(VOICE_CLIPS[phrase]).toBeTruthy();
    }
  });

  it('splits Chinese notation into speakable characters', () => {
    expect(normalize('炮二平五')).toEqual(['炮', '二', '平', '五']);
    expect(normalize('马8进7')).toEqual(['马', '八', '进', '七']);
    expect(normalize('车九退一')).toEqual(['车', '九', '退', '一']);
  });

  it('never throws when speaking (no Audio in Node)', () => {
    expect(() => {
      speakEvent('move', '炮二平五');
      speakEvent('capture', '马8进7');
      speakEvent('check', '车九进一');
      speakEvent('checkmate', '炮二平五');
    }).not.toThrow();
  });

  it('event-only callouts never throw and stay silent for plain moves', () => {
    expect(() => {
      announceEvent('move');       // silent by design
      announceEvent('capture');
      announceEvent('check');
      announceEvent('checkmate');
      announceEvent('win');
      announceEvent('draw');
    }).not.toThrow();
    expect(VOICE_CLIPS['@胜']).toBeTruthy();
    expect(VOICE_CLIPS['@和棋']).toBeTruthy();
  });
});
