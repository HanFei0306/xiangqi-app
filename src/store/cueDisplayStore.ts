/**
 * 统一特效派发（v2026.11.21.10）。
 * 所有模式（对局/适情雅趣/推演/记谱/复盘）走子时调用 showCue()，
 * 各页面的 <TacticCue /> 订阅同一状态显示艺术字——保证任意模式特效一致。
 */
import { create } from 'zustand';
import type { Move, GameStatus } from '../engine/types';
import type { Board } from '../engine/board';
import { planCue, type CueKind } from '../audio/unifiedCue';
import { classifyTactic } from '../training/tacticArt';

export interface CueDisplay {
  id: number;
  kind: CueKind;
  text: string;
  note?: string;
}

interface CueStore {
  cue: CueDisplay | null;
  showCue: (move: Move, afterStatus: GameStatus, boardBefore?: Board, afterBoard?: Board) => void;
  clearCue: () => void;
}

let seq = 0;
/**
 * v22.2 去重：同一着法 120ms 内只弹一次特效，杜绝双 effect 重复触发。
 *
 * v2026.11.25：key 只保留坐标（去掉 kind）。两条派发来源哪怕对同一着的
 * 分类判断不一致（例如一处传 check、另一处传 capture），也必须被判定成
 * "同一着"而只弹一次——否则去重会因 key 不同而失效，表现为特效闪两次。
 * 窗口仍保持 120ms：真正的双响已由"一步一出口"根治，加宽窗口只会
 * 误吞长将循环里 300ms 内的真实重复着。
 */
const recentShow = new Map<string, number>();
const DEDUPE_WINDOW_MS = 120;

/** 清空特效去重锁（换局 / 单测隔离用）。 */
export function resetCueDedupe(): void {
  recentShow.clear();
}

export const useCueDisplay = create<CueStore>((set) => ({
  cue: null,
  showCue: (move, afterStatus, boardBefore, afterBoard) => {
    const plan = planCue(move, afterStatus, boardBefore);
    if (plan.kind === 'move') return; // 普通走子不弹字
    const key = `${move.from.col},${move.from.row}-${move.to.col},${move.to.row}`;
    const now = Date.now();
    const last = recentShow.get(key) ?? -Infinity;
    if (now - last < DEDUPE_WINDOW_MS) return;
    recentShow.set(key, now);
    if (recentShow.size > 48) {
      for (const [k, t] of recentShow) if (now - t > 1000) recentShow.delete(k);
    }
    let text: string;
    let note: string | undefined;
    if (plan.kind === 'mate') {
      const t = afterBoard ? classifyTactic(afterBoard, move) : { name: '绝杀' as const, note: undefined };
      text = t.name; note = t.note;
    } else if (plan.kind === 'check') {
      text = '将军';
    } else {
      text = '吃';
    }
    set({ cue: { id: ++seq, kind: plan.kind, text, note } });
  },
  clearCue: () => set({ cue: null }),
}));
