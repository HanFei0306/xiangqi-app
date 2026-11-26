/**
 * 适情雅趣闯关进度（v2026.11.23.5）。
 *
 * 纯 localStorage、零依赖、file:// WebView 可用。进度以题库数组下标为准
 * （0-based；界面显示的"第 N 关"= 下标 + 1）。读写都经过 sanitize：
 * 坏 JSON / 半写入数据 / 数组里的残缺元素一律不会污染页面状态。
 */
import { SHIQINGYAQU } from './shiqingyaqu';

const KEY = 'xiangqi-trainer:ancient-progress-v1';

/** 「最后打开的局」独立存储键，与闯关进度互不干扰。 */
const LAST_ORDER_KEY = 'xiangqi-trainer:ancient-last-order-v1';

export interface AncientProgress {
  /** 当前应继续的题库下标（0-based）。 */
  current: number;
  /** 已解开的下标，升序且去重。 */
  solved: number[];
  /** 最近一次进度变更的时间戳；无记录时为 0。 */
  updatedAt: number;
}

/** 每次返回全新对象，避免调用方改动共享的空进度常量。 */
export function emptyProgress(): AncientProgress {
  return { current: 0, solved: [], updatedAt: 0 };
}

function isPuzzleIndex(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value < SHIQINGYAQU.length;
}

/** 顶层结构 + 每个数组元素都校验（QA-002 教训：不能只验顶层是数组）。 */
function sanitize(raw: unknown): AncientProgress {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyProgress();
  const data = raw as Record<string, unknown>;
  const current: number = isPuzzleIndex(data.current) ? data.current : 0;
  const solved: number[] = Array.isArray(data.solved)
    ? [...new Set(data.solved.filter(isPuzzleIndex))].sort((a: number, b: number) => a - b)
    : [];
  const updatedAt: number =
    typeof data.updatedAt === 'number' && Number.isFinite(data.updatedAt) && data.updatedAt >= 0
      ? data.updatedAt
      : 0;
  return { current, solved, updatedAt };
}

/** 坏数据一律回退到空进度，不抛异常。 */
export function loadProgress(): AncientProgress {
  try {
    if (typeof localStorage === 'undefined') return emptyProgress();
    const raw: string | null = localStorage.getItem(KEY);
    if (!raw) return emptyProgress();
    return sanitize(JSON.parse(raw) as unknown);
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: AncientProgress): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(sanitize(progress)));
  } catch {
    /* 存储不可用/已满时静默：本次会话内状态仍由调用方持有。 */
  }
}

/**
 * 读取「最后打开的局」的局号（order，1-based）。脏数据一律返回 null：
 * 非数字 / NaN / 负数 / 非整数都不算合法局号；localStorage 不可用或抛异常
 * 时静默降级，与 loadProgress 同一套防御思路。是否命中题库由调用方判断。
 */
export function loadLastOrder(): number | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw: string | null = localStorage.getItem(LAST_ORDER_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw) as unknown;
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  } catch {
    return null;
  }
}

/** 记住「最后打开的局」的局号（order，1-based）。存储不可用时静默。 */
export function saveLastOrder(order: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (typeof order !== 'number' || Number.isNaN(order)) return;
    if (!Number.isInteger(order) || order < 0) return;
    localStorage.setItem(LAST_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* 存储不可用/已满时静默：本次会话内状态仍由调用方持有。 */
  }
}

/**
 * 记录第 index 局完成：并入 solved，current 前进到下一局（末局封顶）。
 * 重复通关同一局是幂等的；越界下标被忽略。
 */
export function markSolved(index: number): AncientProgress {
  if (!isPuzzleIndex(index)) return loadProgress();
  const previous: AncientProgress = loadProgress();
  const solved: number[] = [...new Set([...previous.solved, index])].sort((a: number, b: number) => a - b);
  const next: AncientProgress = {
    current: Math.min(index + 1, SHIQINGYAQU.length - 1),
    solved,
    updatedAt: Date.now(),
  };
  saveProgress(next);
  return next;
}

/** 清空进度并移除存储键，返回新的空进度。「最后打开的局」一并重置：
 * 重置进度意味着回到默认的第 1 局起点，两条持久化记录同步清空。 */
export function resetProgress(): AncientProgress {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(KEY);
      localStorage.removeItem(LAST_ORDER_KEY);
    }
  } catch {
    /* 存储不可用时仍返回内存中的空进度。 */
  }
  return emptyProgress();
}
