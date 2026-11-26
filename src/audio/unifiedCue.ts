/**
 * 统一走子音效派发（v2026.11.21.10 / v2026.11.25 双响根治）。
 *
 * 背景：此前适情雅趣/主对局/推演/记谱各自一套音效实现，导致"红吃有声黑吃无声"
 * 等不一致；根因是延迟应手用 setTimeout + Web Audio，被 Android WebView 丢弃。
 *
 * 本模块是唯一入口：所有模式的每一步走子都调用 cueMove()，它把"落子声 +
 * 吃/将军/绝杀语音"打包交给原生 playUnified(cue, delayMs)，原生侧用
 * Handler.postDelayed 精确预约，完全不依赖 Web Audio 手势栈。
 * 无原生桥接（桌面/CDP）时回退到 Web Audio + Web 语音。
 *
 * ─── v2026.11.25 双响根治（不改去重窗口，只消灭第二条派发来源） ───
 * 症状：适情雅趣里"一步棋"会听到两次落子声、看到两次艺术字。
 * 根因：`clackLater()` 用原生 Handler.postDelayed 预约了黑应手，悔棋/重置/
 * 连续点提示时 `cancelAutoReply()` 只 clear 了页面的 setTimeout，原生那边
 * 早已 postDelayed 且**没有取消 API**；紧接着提示演示又对同一着立刻派发一次，
 * 于是同一着在 ~300ms 内被派发两遍（音效 + 特效成对重复）。
 *
 * 修法：**延迟派发的所有权收回到 JS**。原生 playUnified 的 delayMs 只会让声音
 * 晚到、却无法撤销；改成"JS 定时器到点后调用 playUnified(kind, 0)"——
 * 声音仍由 Java MediaPlayer 发出（不碰 Web Audio 手势栈，Android 静音问题不复发），
 * 但取消器可以真正 clearTimeout，做到"撤销的应手一声不响、一字不弹"。
 *
 * 另一处双响隐患：原生桥接若返回非 true（旧桥接返回 void / 抛错），旧代码会判
 * nativeOk=false 再走一次 Web —— 原生已响 + Web 又响。现在只有原生**显式**
 * 返回 false（资源缺失）才回退，undefined/void 一律视为已处理。
 */
import type { Move, GameStatus } from '../engine/types';
import type { Board } from '../engine/board';
import { play, playAt, resume } from './sound';
import { announceEvent, type VoiceEvent } from './voice';

export type CueKind = 'move' | 'capture' | 'check' | 'mate';

/**
 * CueKind -> Web Audio 落子音色。普通走子必须是 'move'（清脆麻将声），
 * 绝不是静音的 'slide'。抽成纯函数以便回归测试锁死这个映射。
 */
export function webSoundFor(kind: CueKind): 'move' | 'capture' | 'check' {
  return kind === 'move' ? 'move' : kind === 'capture' ? 'capture' : 'check';
}

interface NativeUnifiedBridge {
  /** Returns true when the native cue was actually dispatched. */
  playUnified?: (cue: CueKind, delayMs: number) => boolean;
}

export interface CuePlan {
  kind: CueKind;
  voice: VoiceEvent | null;
}

/** 依据一步棋与走后局面判定唯一的声音方案（所有模式共用）。 */
export function planCue(
  move: Move, afterStatus: GameStatus, boardBefore?: Board,
): CuePlan {
  const captured = !!move.captured || (() => {
    if (!boardBefore) return false;
    const t = boardBefore.getPiece(move.to);
    return !!t; // 目标格有子即为吃子
  })();
  if (afterStatus === 'checkmate' || afterStatus === 'stalemate' || afterStatus === 'perpetual') {
    return { kind: 'mate', voice: 'checkmate' };
  }
  if (afterStatus === 'check') return { kind: 'check', voice: 'check' };
  if (captured) return { kind: 'capture', voice: 'capture' };
  return { kind: 'move', voice: null };
}

/** 无副作用的空取消器（原生已同步派发时用）。 */
const NOOP_CANCEL = (): void => { /* nothing scheduled */ };

/** Reads the host app's unified cue bridge, or null when absent. */
function nativeBridge(): NativeUnifiedBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { XiangqiNative?: NativeUnifiedBridge }).XiangqiNative;
  return api && typeof api.playUnified === 'function' ? api : null;
}

/**
 * Dispatches one cue through the native layer.
 *
 * 返回 true 表示"这一着已由原生负责"，调用方绝不能再走 Web，否则双响。
 * 只有原生**显式**返回 false（land.wav 资源缺失）才算失败；返回 undefined 的
 * 旧版桥接视为已处理——旧代码用 `=== true` 判定，会把 void 桥接判成失败，
 * 造成"原生响一次 + Web 再响一次"。
 */
function dispatchNative(
  native: NativeUnifiedBridge, kind: CueKind, delayMs: number,
): boolean {
  try {
    return native.playUnified!(kind, delayMs) !== false;
  } catch {
    // 桥接抛错：无法确认它是否已发声，按"未处理"回退 Web（宁可无声，不可双声）。
    return false;
  }
}

/**
 * Web 回退派发：一次调用最多一组落子声 + 一条语音。
 * 返回的取消器可撤掉尚未起振的落子声与尚未播报的语音。
 */
function webCue(plan: CuePlan, piece: Move['piece'], delaySec = 0): () => void {
  const sound: import('./sound').SoundType = webSoundFor(plan.kind);
  resume();
  let cancelSound: () => void = NOOP_CANCEL;
  let voiceTimer: number | null = null;
  if (delaySec > 0) {
    cancelSound = playAt(sound, piece, delaySec);
    if (plan.voice) {
      const voice = plan.voice;
      voiceTimer = window.setTimeout(() => announceEvent(voice), delaySec * 1000);
    }
  } else {
    play(sound, piece);
    if (plan.voice) announceEvent(plan.voice);
  }
  return () => {
    cancelSound();
    if (voiceTimer !== null) {
      window.clearTimeout(voiceTimer);
      voiceTimer = null;
    }
  };
}

/**
 * 原生延迟派发 —— 定时器所有权在 JS，因此可以被真正撤销。
 *
 * 为什么不用 playUnified(kind, delayMs) 让原生 postDelayed：原生预约没有取消
 * API，悔棋/重置/换局后那条预约照样在 +300ms 响一声（幽灵应手），与紧接着的
 * 提示演示形成"同一着响两次"。这里改成 JS 定时器 + 原生 delayMs=0：
 * 声音依旧由 Java MediaPlayer 发出（不依赖 Web Audio 手势栈），延迟精度足够
 * （页面可见时毫秒级），并且 cancel() 能让它一声不响。
 */
function scheduleNativeCue(
  native: NativeUnifiedBridge, plan: CuePlan, piece: Move['piece'], delayMs: number,
): () => void {
  let cancelled = false;
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    cancelled = true;
    if (dispatchNative(native, plan.kind, 0)) return;
    // 到点发现原生不可用（资源缺失）：退回 Web，保证这一着仍有一次声音。
    webCue(plan, piece);
  }, delayMs);
  return () => {
    if (cancelled) return;
    cancelled = true;
    window.clearTimeout(timer);
  };
}

/**
 * 播放一步棋的完整音效。delaySec>0 用于对手应手的预约。
 *
 * 返回的取消器保证"撤销之后一声不响"：无论是原生路径还是 Web 路径，
 * 延迟派发的定时器都在 JS 手上（见 scheduleNativeCue / webCue）。
 */
export function cueMove(
  plan: CuePlan, piece: Move['piece'], delaySec = 0, soundEnabled = true,
): () => void {
  if (!soundEnabled) return NOOP_CANCEL;
  const native = nativeBridge();
  const delayMs = Math.max(0, Math.round(delaySec * 1000));

  if (native) {
    if (delayMs <= 0) {
      if (dispatchNative(native, plan.kind, 0)) return NOOP_CANCEL;
      // 原生显式失败 -> 落到下面的 Web 回退，绝不再发第二次原生调用。
    } else {
      return scheduleNativeCue(native, plan, piece, delayMs);
    }
  }
  // Web 回退（桌面/CDP，或原生派发失败）：手势内预约节点，语音按时刻播。
  // v21.11 BUGFIX: 普通走子必须映射 'move'（清脆麻将声），此前误映射为静音的 'slide'，
  // 导致推演/记谱自动对弈里普通落子完全没有落地声。
  return webCue(plan, piece, delaySec);
}

/**
 * 去重锁（v22.2）：同一着法在极短时间窗内只发一次音效。
 * 复盘曾因"播放 effect + 特效 effect"两处分别调用导致音效/特效各响两次；
 * 现在虽有唯一出口，这里再加一道护栏，杜绝任何重复来源。
 * lock key 只含坐标/棋子（不含 delay），预约类应手用 delaySec 区分时不锁。
 *
 * v2026.11.25：窗口刻意保持 120ms —— 双响已由"一步一出口 + 延迟派发可撤销"
 * 根治，加宽窗口只会误吞真实的连走着法（例如长将循环里 300ms 内的真实重复着）。
 */
const recentCues = new Map<string, number>();
const DEDUPE_WINDOW_MS = 120;

function dedupeKey(move: Move, afterStatus: GameStatus): string {
  return `${move.from.col},${move.from.row}-${move.to.col},${move.to.row}-${move.piece}-${afterStatus}`;
}

/** 清空去重锁（换局 / 单测隔离用）。 */
export function resetCueDedupe(): void {
  recentCues.clear();
}

/** 便捷：从 move + 状态直接播放。 */
export function cueFromMove(
  move: Move, afterStatus: GameStatus, boardBefore?: Board,
  delaySec = 0, soundEnabled = true,
): () => void {
  if (delaySec <= 0 && typeof window !== 'undefined') {
    const key = dedupeKey(move, afterStatus);
    const now = Date.now();
    const last = recentCues.get(key) ?? -Infinity;
    if (now - last < DEDUPE_WINDOW_MS) return NOOP_CANCEL; // 窗口内重复调用直接吞掉
    recentCues.set(key, now);
    if (recentCues.size > 64) {
      for (const [k, t] of recentCues) if (now - t > 1000) recentCues.delete(k);
    }
  }
  return cueMove(planCue(move, afterStatus, boardBefore), move.piece, delaySec, soundEnabled);
}
