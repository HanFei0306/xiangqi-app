/**
 * 记谱本（v2026.11.21.6）。把推演/对局中的精彩棋谱保存到本地，随时查看回放。
 * 纯 localStorage，无网络、无外部依赖，file:// WebView 下可用。
 */
import type { Move } from '../engine/types';

/**
 * v22.6 变招树（扁平表示）：每个元素是一步棋，`parent` 是父节点在
 * `variations` 数组中的下标；`parent = -1` 表示从根局面走出的第一着。
 * 用扁平数组而非嵌套树，读写/序列化最简单，也天然支持"同一局面多分支"。
 */
export interface VariationMove {
  /** 父节点下标；-1 = 根局面。 */
  parent: number;
  /** 从父局面走出的这一着。 */
  move: Move;
}

/** v22.6: 从推演 store 导出变招所需的最小节点形状（避免数据层依赖 store）。 */
export interface VariationSourceNode {
  move: Move | null;
  children: number[];
}

export interface SavedNotation {
  id: string;
  name: string;
  /** 起始局面的记谱摆放串（Board.toNotationSetup），空串=标准开局。 */
  setup: string;
  /** 主线着法序列（保持向后兼容：老棋谱只有这个字段）。 */
  moves: Move[];
  /** v22.6 可选：完整变化树；缺省时回放主线，老棋谱照常可用。 */
  variations?: VariationMove[];
  createdAt: number;
}

/**
 * v22.6: 把推推演变化树导出为扁平变招数组。
 * `mainLineIds` 是从根到当前节点的节点 id 序列；这些节点在每个父节点下
 * 排在最前，保证 `variations` 的第一条链与 `moves` 主线完全一致。
 */
export function exportVariations(
  nodes: Readonly<Record<number, VariationSourceNode>>,
  rootId: number,
  mainLineIds: ReadonlyArray<number> = [],
): VariationMove[] {
  const mainSet = new Set<number>(mainLineIds);
  const out: VariationMove[] = [];
  const visit = (id: number, parentIndex: number): void => {
    const node = nodes[id];
    if (!node) return;
    // 主线子节点优先；其余分支按 store 中的原始顺序跟随其后。
    const ordered = [...node.children].sort(
      (a: number, b: number) => Number(mainSet.has(b)) - Number(mainSet.has(a)),
    );
    for (const childId of ordered) {
      const child = nodes[childId];
      if (!child || !child.move) continue;
      const index: number = out.length;
      out.push({ parent: parentIndex, move: child.move });
      visit(childId, index);
    }
  };
  visit(rootId, -1);
  return out;
}

/** v22.6: 返回某节点下的所有子招在 variations 中的下标。 */
export function variationChildren(
  variations: ReadonlyArray<VariationMove> | null | undefined,
  parentIndex: number,
): number[] {
  if (!variations) return [];
  const out: number[] = [];
  for (let i = 0; i < variations.length; i++) {
    if (variations[i].parent === parentIndex) out.push(i);
  }
  return out;
}

/** v22.6: 两个 Move 是否指向同一着（忽略记谱文案差异）。 */
function sameMove(a: Move, b: Move): boolean {
  return a.from.col === b.from.col && a.from.row === b.from.row
    && a.to.col === b.to.col && a.to.row === b.to.row && a.piece === b.piece;
}

/**
 * v22.6: 找出主线 `moves` 在 variations 中对应的下标序列。
 * 老棋谱（无 variations 或着法不匹配）返回空数组，UI 因此不显示变招按钮。
 */
export function mainVariationPath(
  variations: ReadonlyArray<VariationMove> | null | undefined,
  moves: ReadonlyArray<Move>,
): number[] {
  const path: number[] = [];
  if (!variations) return path;
  let parent: number = -1;
  for (const move of moves) {
    const found: number | undefined = variationChildren(variations, parent)
      .find((i: number) => sameMove(variations[i].move, move));
    if (found === undefined) return [];
    path.push(found);
    parent = found;
  }
  return path;
}

/** v22.6: 从某个变招节点出发，沿每个节点的第一子招走到叶子的完整着法序列。 */
export function variationLineFrom(
  variations: ReadonlyArray<VariationMove> | null | undefined,
  index: number,
): Move[] {
  const out: Move[] = [];
  if (!variations || index < 0 || index >= variations.length) return out;
  const seen = new Set<number>();
  let cursor: number = index;
  while (cursor >= 0 && cursor < variations.length && !seen.has(cursor)) {
    seen.add(cursor);
    out.push(variations[cursor].move);
    const children: number[] = variationChildren(variations, cursor);
    if (children.length === 0) break;
    cursor = children[0];
  }
  return out;
}

const KEY = 'xiangqi-trainer:notations-v1';
const MAX = 100;

/**
 * v2026.11.23.1 (QA-002): validate each element, not just the top-level array.
 * A "valid JSON but incomplete element" (e.g. old/migrated/half-written data
 * missing `moves`) previously reached the list renderer, where `n.moves.length`
 * threw and left the whole notation page blank. Filter out any malformed entry
 * so a single bad record can never take down the page.
 */
function isValidNotation(n: unknown): n is SavedNotation {
  if (n === null || typeof n !== 'object') return false;
  const o = n as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string'
    && Array.isArray(o.moves) && typeof o.createdAt === 'number';
}

export function loadNotations(): SavedNotation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as unknown[]).filter(isValidNotation) : [];
  } catch {
    return [];
  }
}

function persist(list: SavedNotation[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* 存储满时静默 */ }
}

export function saveNotation(entry: Omit<SavedNotation, 'id' | 'createdAt'>): SavedNotation[] {
  const item: SavedNotation = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const list = [item, ...loadNotations()];
  persist(list);
  return list;
}

export function deleteNotation(id: string): SavedNotation[] {
  const list = loadNotations().filter((n) => n.id !== id);
  persist(list);
  return list;
}

export function renameNotation(id: string, name: string): SavedNotation[] {
  const list = loadNotations().map((n) => (n.id === id ? { ...n, name } : n));
  persist(list);
  return list;
}
