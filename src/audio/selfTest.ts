/**
 * 音效自检（v2026.11.21.11）。
 *
 * 用户在真机上反馈"记谱自动推演没有清脆落地声"。此模块给出可点按的
 * 自检入口：逐一播放落子/吃/将军/绝杀，并回报当前音效通道，
 * 让用户（和 CDP）能确认每一类音效到底走没走、走的是原生还是 Web。
 */
import type { PieceType } from '../engine/types';
import { cueMove, type CueKind } from './unifiedCue';

export interface AudioChannelInfo {
  /** 原生统一桥接是否可用。 */
  nativeBridge: boolean;
  /** 旧版原生 cue 桥接是否可用。 */
  legacyBridge: boolean;
  /** Web Audio 是否可用。 */
  webAudio: boolean;
  /** 人类可读通道说明。 */
  label: string;
}

/** 探测当前运行环境的音效通道。 */
export function inspectAudioChannel(): AudioChannelInfo {
  if (typeof window === 'undefined') {
    return { nativeBridge: false, legacyBridge: false, webAudio: false, label: '无窗口环境' };
  }
  const api = (window as unknown as {
    XiangqiNative?: { playUnified?: unknown; playCue?: unknown };
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  }).XiangqiNative;
  const nativeBridge = !!(api && typeof api.playUnified === 'function');
  const legacyBridge = !!(api && typeof api.playCue === 'function');
  const webAudio = typeof window.AudioContext !== 'undefined'
    || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined';
  const label = nativeBridge ? '原生音效（MediaPlayer）'
    : legacyBridge ? '原生音效（旧桥接）'
    : webAudio ? 'Web 音效（AudioContext）' : '无可用音效';
  return { nativeBridge, legacyBridge, webAudio, label };
}

const KIND_LABEL: Record<CueKind, string> = {
  move: '落子',
  capture: '吃子',
  check: '将军',
  mate: '绝杀',
};

/** 试听一类音效；返回是否发起了播放。 */
export function selfTestCue(kind: CueKind, soundEnabled = true): boolean {
  if (!soundEnabled) return false;
  try {
    cueMove({ kind, voice: kind === 'move' ? null : kind === 'capture' ? 'capture' : kind === 'check' ? 'check' : 'checkmate' },
      'R' as PieceType, 0, true);
    return true;
  } catch {
    return false;
  }
}

export const SELF_TEST_KINDS: ReadonlyArray<CueKind> = ['move', 'capture', 'check', 'mate'];
export { KIND_LABEL };
