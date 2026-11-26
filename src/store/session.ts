/**
 * 会话挂起（v2026.11.23.8）。
 *
 * 需求：主页按钮「可以先搁置不退出」，再次进入时提示「继续对局 / 新的对局」。
 *
 * 关键设计取舍：
 *   - 对局状态本来就活在 zustand（模块级单例），切换屏幕不会销毁它；
 *     真正会污染的是**后台仍在跑的定时器**（语音预约、AI 应手）。
 *   - 所以"挂起"= 取消所有预约 + 清掉瞬时 UI 状态，棋盘/历史/结果一律保留。
 *   - "继续"= 回到对局屏；若挂起那一刻正好轮到引擎，重新发一次搜索。
 *
 * 本模块只做判定与编排，状态仍然只有一个真源（gameStore）。
 */
import { useGameStore } from './gameStore';
import type { GameState, GameStatus } from '../engine/types';

/** 终局状态：这些局面不算"未完成"，回主页不需要提示继续。 */
const TERMINAL: ReadonlyArray<GameStatus> = ['checkmate', 'stalemate', 'draw', 'perpetual'];

/**
 * 是否存在一局"下到一半"的对局。
 * 只走了一步以上（history 非空）且尚未终局才算，避免新开局空盘误报。
 */
export function isUnfinished(game: GameState): boolean {
  if (game.history.length === 0) return false;
  return !TERMINAL.includes(game.status);
}

/** 订阅版：主页据此决定「开始挑战」是直接开局还是先问一句。 */
export function useHasUnfinishedMatch(): boolean {
  return useGameStore((s) => isUnfinished(s.game));
}

/** 挂起当前对局（可安全重复调用）。 */
export function suspendMatch(): void {
  useGameStore.getState().pauseForHome();
}

/** 继续被挂起的对局：恢复界面；若轮到引擎则重新发起搜索。 */
export function resumeMatch(): void {
  useGameStore.getState().resumeFromHome();
}

/**
 * 统一"回家"动作：先挂起，再由调用方负责屏幕切换。
 * 其它模式（推演/残局/适情雅趣）没有跨屏存活的必要状态，直接切屏即可。
 */
export function goHome(onNavigate: () => void, options: { fromMatch?: boolean } = {}): void {
  if (options.fromMatch) suspendMatch();
  onNavigate();
}
