/**
 * 本地自适应学习的独立持久化层。
 *
 * 与 `src/data/storage.ts` 完全隔离：这里只保存 AI 复盘统计，设置/关卡进度
 * 仍由原模块负责，避免任何一方的数据结构变化影响对方。所有 localStorage
 * 访问都有 try/catch 兜底，Node / 测试环境没有 localStorage 时也能安全导入。
 */

/** 从"人类玩家"视角统计的三类结果。 */
export interface OutcomeTally {
  /** 人类胜（AI 负）。 */
  win: number;
  /** 人类负（AI 胜）。 */
  loss: number;
  /** 和棋。 */
  draw: number;
}

/** 落盘的完整学习数据。 */
export interface EvolutionData {
  /** 结构版本；不兼容的旧数据直接丢弃而不是猜测。 */
  version: 1;
  /** 累计完成的对局数。 */
  totalGames: number;
  /** 学习是否启用。 */
  enabled: boolean;
  /** 按难度分组的结果统计。 */
  byDifficulty: Record<string, OutcomeTally>;
  /** 按开局名分组的结果统计（人类视角）。 */
  openings: Record<string, OutcomeTally>;
  /** key = `开局名\u0000应手记谱` 的开局应手统计（人类视角）。 */
  replies: Record<string, OutcomeTally>;
  /** key = flatMoveCode 字符串的中局着法模式统计（人类视角）。 */
  patterns: Record<string, OutcomeTally>;
}

/** 独立 key，不与进度/设置/战绩共用。 */
export const EVOLUTION_STORAGE_KEY = 'xiangqi-trainer:evolution-v1';

/** 每张统计表最多保留的键数，防止 Android WebView 的 localStorage 膨胀。 */
export const MAX_ENTRIES = 384;
/** 单个计数字段的上限（防御损坏数据导致权重失控）。 */
const MAX_COUNT = 1_000_000;

/** 生成一份空白学习数据（调用方独占，可安全修改）。 */
export function emptyEvolutionData(): EvolutionData {
  return {
    version: 1,
    totalGames: 0,
    enabled: true,
    byDifficulty: {},
    openings: {},
    replies: {},
    patterns: {},
  };
}

function safeCount(value: unknown): number {
  const n: number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(MAX_COUNT, Math.floor(n)));
}

function sanitizeTally(value: unknown): OutcomeTally {
  const raw = (value ?? {}) as Partial<OutcomeTally>;
  return {
    win: safeCount(raw.win),
    loss: safeCount(raw.loss),
    draw: safeCount(raw.draw),
  };
}

function tallyGames(t: OutcomeTally): number {
  return t.win + t.loss + t.draw;
}

/** 只保留样本最多的 MAX_ENTRIES 项，保证落盘体积有硬上限。 */
export function pruneTallyTable(table: Record<string, OutcomeTally>): Record<string, OutcomeTally> {
  const keys: string[] = Object.keys(table);
  if (keys.length <= MAX_ENTRIES) return table;
  keys.sort((a, b) => tallyGames(table[b]) - tallyGames(table[a]) || a.localeCompare(b));
  const kept: Record<string, OutcomeTally> = {};
  for (let i = 0; i < MAX_ENTRIES; i++) kept[keys[i]] = table[keys[i]];
  return kept;
}

function sanitizeTable(value: unknown): Record<string, OutcomeTally> {
  const raw = (value ?? {}) as Record<string, unknown>;
  const out: Record<string, OutcomeTally> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const key of Object.keys(raw)) {
    if (key.length === 0 || key.length > 128) continue;
    out[key] = sanitizeTally(raw[key]);
  }
  return pruneTallyTable(out);
}

/** 校验并归一化从 localStorage 读出的学习数据。 */
export function sanitizeEvolutionData(value: unknown): EvolutionData {
  const raw = (value ?? {}) as Partial<EvolutionData>;
  const out: EvolutionData = emptyEvolutionData();
  out.enabled = raw.enabled !== false;
  out.byDifficulty = sanitizeTable(raw.byDifficulty);
  out.openings = sanitizeTable(raw.openings);
  out.replies = sanitizeTable(raw.replies);
  out.patterns = sanitizeTable(raw.patterns);
  let summed: number = 0;
  for (const key of Object.keys(out.byDifficulty)) summed += tallyGames(out.byDifficulty[key]);
  out.totalGames = Math.max(safeCount(raw.totalGames), summed);
  return out;
}

/** 读取学习数据；任何损坏或未初始化的情况都返回空白数据。 */
export function loadEvolutionData(): EvolutionData {
  try {
    if (typeof localStorage === 'undefined') return emptyEvolutionData();
    const raw: string | null = localStorage.getItem(EVOLUTION_STORAGE_KEY);
    return raw ? sanitizeEvolutionData(JSON.parse(raw) as unknown) : emptyEvolutionData();
  } catch {
    return emptyEvolutionData();
  }
}

/** 写入学习数据；配额/序列化失败时静默降级为"本次会话内有效"。 */
export function saveEvolutionData(data: EvolutionData): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(EVOLUTION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* 存储不可用时保持内存态，不影响对局。 */
  }
}

/** 彻底清除学习数据（设置面板的"重置学习"入口）。 */
export function clearEvolutionData(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(EVOLUTION_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}
