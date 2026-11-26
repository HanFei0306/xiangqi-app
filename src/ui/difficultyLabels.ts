/**
 * 四档显示名的唯一来源（key 与显示名错位是历史约定）：
 * easy→中级、intermediate→高级。ControlPanel 重新导出本常量，
 * ai/tierSpec 也从这里取 label，避免与 UI 形成循环依赖。
 */
import type { Difficulty } from '../ai/types';

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: '初级',
  easy: '中级',
  intermediate: '高级',
  master: '大师',
};
