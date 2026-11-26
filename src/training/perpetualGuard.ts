/**
 * 长将骚扰防护（v2026.11.21.9）。
 *
 * 背景：judgeRepetition 要求"同一局面三次重复"才判长将，但实战中劣势方
 * 用单车反复将军时，红方应将的位置会变化，局面 key 未必精确重复三次，
 * 导致长将漏判、最终劣势方反而将死获胜。用户实测到的就是这个漏洞。
 *
 * 补充规则：若最近若干步里某一方**每一步都在将军**、而对方从未将军，
 * 则判该方长将判负（象棋"长将"的实战判法：连续将军不变）。
 * 这是判定层的兜底，不依赖引擎，也不依赖精确局面重复。
 */
import type { Move, Side } from '../engine/types';
import { createInitialState } from '../engine/board';
import { applyMoveToState, isInCheck } from '../engine/rules';

export type HarassmentVerdict = 'red-loses' | 'black-loses' | null;

/**
 * 从标准开局（或给定起始局面）重放 history，统计最后 `window` 步里各方
 * 的"将军步 / 总步"。某一方连续 >= minChecks 步且步步将军、对方从未将军 → 判负。
 */
export function detectPerpetualHarassment(
  history: ReadonlyArray<Move>,
  startBoard = createInitialState('red'),
  window = 8,
  minChecks = 3,
): HarassmentVerdict {
  if (history.length < window) return null;
  const from = history.length - window;
  let state = startBoard;
  // 先重放到窗口起点。
  for (let i = 0; i < from; i++) state = applyMoveToState(state, history[i]);

  let redChecks = 0, redMoves = 0, blackChecks = 0, blackMoves = 0;
  let redStreak = 0, blackStreak = 0, redMaxStreak = 0, blackMaxStreak = 0;
  for (let i = from; i < history.length; i++) {
    const mover: Side = state.turn;
    state = applyMoveToState(state, history[i]);
    const gaveCheck = isInCheck(state.board, state.turn);
    if (mover === 'red') {
      redMoves++; if (gaveCheck) { redChecks++; redStreak++; blackStreak = 0; }
      else redStreak = 0;
      redMaxStreak = Math.max(redMaxStreak, redStreak);
    } else {
      blackMoves++; if (gaveCheck) { blackChecks++; blackStreak++; redStreak = 0; }
      else blackStreak = 0;
      blackMaxStreak = Math.max(blackMaxStreak, blackStreak);
    }
  }
  // 条件：某一方在窗口内将军达阈值次、连续将军达阈值、且对方从未将军。
  // 不要求"窗口内每一步都将"——布局过渡步可能混在窗口里。
  const redPerp = redChecks >= minChecks && redMaxStreak >= minChecks && blackChecks === 0;
  const blackPerp = blackChecks >= minChecks && blackMaxStreak >= minChecks && redChecks === 0;
  if (redPerp) return 'red-loses';
  if (blackPerp) return 'black-loses';
  return null;
}
