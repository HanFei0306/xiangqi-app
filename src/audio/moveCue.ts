/**
 * 通用着法音效判定（v2026.11.21.7 → v2026.11.25 收口）。
 *
 * ─── v2026.11.25：删掉历史上的第二条音效通道 `playMoveCue()` ───
 * `playMoveCue()` 曾经是适情雅趣/推演/记谱各自直连音频层的产物：它自己
 * `play('slide')` + `play(cue)` + 原生 `playCue('land')`，与
 * `unifiedCue.cueFromMove()` **并行存在**——只要有一处误调，同一着就会
 * 落子声双响。全仓搜索确认它已无任何生产调用方（只有本模块的自测引用），
 * 因此整段函数删除，只保留纯函数 `cueForMove()` 给回归测试锁死
 * "优先级：绝杀 > 将军 > 吃子 > 普通" 这条映射，防止 `planCue()` 漂移。
 *
 * 生产代码的唯一音效出口是 `src/audio/unifiedCue.ts` 的 `cueFromMove()`
 * （音效）与 `src/store/cueDisplayStore.ts` 的 `showCue()`（艺术字），
 * 二者在每一步棋上严格一一配对、各调用一次。
 *
 * 注意：本文件**不得**再引入任何实际发声调用（play / playAt / playNativeCue /
 * announceEvent）。`src/audio/__tests__/legacy-audio-channel.test.ts` 会扫描
 * 生产源码锁死这一约束。
 */
import type { Move, GameStatus } from '../engine/types';
import type { Board } from '../engine/board';
import type { SoundType } from './sound';
import type { VoiceEvent } from './voice';

/** 走子前棋盘实测：这步是否吃子。比 move.captured 更可靠。 */
function actuallyCaptured(boardBefore: Board | undefined, move: Move): boolean {
  if (move.captured) return true;
  if (!boardBefore) return false;
  const target = boardBefore.getPiece(move.to);
  return target !== null && target.side !== (move.piece === move.piece.toUpperCase() ? 'red' : 'black');
}

/**
 * 依据一步棋、走后状态、走前棋盘，判定音效类型。
 * 优先级：绝杀 > 将军 > 吃子 > 普通。
 *
 * @deprecated 仅用于回归测试与历史对照；生产派发请用
 * `unifiedCue.planCue()` + `unifiedCue.cueFromMove()`。
 */
export function cueForMove(
  move: Move, afterStatus: GameStatus, boardBefore?: Board,
): { cue: SoundType; voice: VoiceEvent | null } {
  if (afterStatus === 'checkmate' || afterStatus === 'stalemate') {
    return { cue: 'check', voice: 'checkmate' };
  }
  if (afterStatus === 'check') return { cue: 'check', voice: 'check' };
  if (actuallyCaptured(boardBefore, move)) return { cue: 'capture', voice: 'capture' };
  return { cue: 'move', voice: null };
}
