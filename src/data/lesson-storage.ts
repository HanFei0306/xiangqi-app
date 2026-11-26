/** Local post-game lesson log for the self-evolution loop. */

/**
 * 失误细分类型。前 3 种是历史数据（向后兼容），后 6 种对齐失误讲解的
 * T1/T3/T4/T5+T7/T6/T8 八类棋理标签；新增类型只追加，不替换旧白名单。
 */
export type LessonKind =
  | 'blunder'
  | 'missed-mate'
  | 'good'
  | 'hang-piece'
  | 'slow-develop'
  | 'king-unsafe'
  | 'bad-trade'
  | 'slow-move'
  | 'missed-win';

/** sanitize 的唯一白名单：旧 kind 与新 kind 同时有效。 */
export const LESSON_KINDS: readonly LessonKind[] = [
  'blunder', 'missed-mate', 'good',
  'hang-piece', 'slow-develop', 'king-unsafe',
  'bad-trade', 'slow-move', 'missed-win',
];

export interface LessonRecord {
  game: number;
  ply: number;
  side: 'red' | 'black';
  kind: LessonKind;
  notation: string;
  /** Centipawns lost versus the best legal alternative. */
  drop: number;
  /** Board setup BEFORE the move, for replay/training. */
  setup: string;
  at: number;
}

const KEY = 'xiangqi-trainer:lessons-v1';
const MAX_LESSONS = 96;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

export function emptyLessons(): LessonRecord[] { return []; }

export function sanitizeLessons(value: unknown): LessonRecord[] {
  if (!Array.isArray(value)) return emptyLessons();
  const out: LessonRecord[] = [];
  for (const raw of value) {
    const item = raw as Partial<LessonRecord>;
    if (item.side !== 'red' && item.side !== 'black') continue;
    const kind: LessonKind | undefined = item.kind;
    if (kind === undefined || !LESSON_KINDS.includes(kind)) continue;
    if (typeof item.setup !== 'string' || item.setup.length === 0) continue;
    out.push({
      game: safeNumber(item.game),
      ply: safeNumber(item.ply),
      side: item.side,
      kind,
      notation: typeof item.notation === 'string' ? item.notation.slice(0, 40) : '',
      drop: safeNumber(item.drop),
      setup: item.setup.slice(0, 4000),
      at: safeNumber(item.at),
    });
    if (out.length >= MAX_LESSONS) break;
  }
  return out;
}

export function loadLessons(): LessonRecord[] {
  try {
    if (typeof localStorage === 'undefined') return emptyLessons();
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeLessons(JSON.parse(raw) as unknown) : emptyLessons();
  } catch {
    return emptyLessons();
  }
}

export function saveLessons(lessons: readonly LessonRecord[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify(sanitizeLessons(lessons)));
  } catch { /* session-only fallback */ }
}

export function appendLessons(next: readonly LessonRecord[]): LessonRecord[] {
  const merged = [...next, ...loadLessons()].slice(0, MAX_LESSONS);
  saveLessons(merged);
  return merged;
}

export function clearLessons(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
