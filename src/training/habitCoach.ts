/**
 * 下棋习惯教练（v2026.11.21.2）。
 *
 * 把网上总结的「好习惯方法论」做成可运行的功能：
 *   1. 三步思考：走前引导「目的 / 对手应手 / 我的后续」；
 *   2. 拒绝随手棋：把用户实际着法与最佳着对比，差距过大就标记；
 *   3. 破解杀招：扫描对手下一步的将死/得子威胁，并给出我方的防守解着。
 *
 * 纯 TypeScript，只依赖 engine / ai / data 层；不联网、不改对局状态。
 * 所有搜索都是浅层、限时的，避免卡住 UI。
 */
import type { GameState, Move, Side } from '../engine/types';
import { Board } from '../engine/board';
import { applyMoveToState, generateLegalMoves, isInCheck } from '../engine/rules';
import {
  LESSON_KINDS,
  type LessonKind,
  type LessonRecord,
} from '../data/lesson-storage';
import { SHIQINGYAQU, type AncientPuzzle } from '../data/shiqingyaqu';
import type { MistakeType } from './mistakeTypes';
import { opponent } from '../ai/mate';
import { findMateInOne } from '../ai/mate';
import { evaluateState, material } from '../ai/evaluate';
import { generateNotation } from '../engine/notation';

/** 威胁等级。 */
export type ThreatKind = 'mate' | 'capture' | 'check';

/** 一个被检测到的对手威胁，以及我方破解着法。 */
export interface Threat {
  kind: ThreatKind;
  /** 对手的威胁着法记谱。 */
  move: Move;
  /** 人类可读的威胁描述。 */
  description: string;
  /** 我方破解着法（可能为 null —— 表示无解，情况危急）。 */
  defense: Move | null;
  /** 破解着法的说明。 */
  defenseNote: string;
}

/** 三步思考引导。 */
export interface ThreeStep {
  /** 第 1 步：这步棋的目的（基于着法本身推断）。 */
  purpose: string;
  /** 第 2 步：对手最可能的应手。 */
  reply: string;
  /** 第 3 步：我方后续。 */
  follow: string;
}

/** 随手棋判定结果。 */
export interface MoveQuality {
  /** 实际着法相对最佳着法的分数损失（我方视角，正数越大越差）。 */
  lossCp: number;
  /** 是否为随手棋（lossCp 超过阈值）。 */
  sloppy: boolean;
  best: Move | null;
  comment: string;
}

/** 着法中文标签：优先用已有记谱，缺失时现场生成。 */
function label(move: Move, board: Board, side: Side): string {
  return move.notation || generateNotation(board, move, side) || `${move.piece}移动`;
}

const PIECE_VALUE: Record<string, number> = {
  K: 0, A: 90, B: 90, N: 400, R: 900, C: 450, P: 100,
  k: 0, a: 90, b: 90, n: 400, r: 900, c: 450, p: 100,
};

function capturedValue(move: Move): number {
  return move.captured ? (PIECE_VALUE[move.captured] ?? 0) : 0;
}

/** 从棋子记谱推断着法目的。 */
function describePurpose(move: Move, before: GameState): string {
  const mover = before.turn;
  const afterCheck = isInCheck(applyMoveToState(before, move).board, opponent(mover));
  if (afterCheck) return `将军，压迫对方（${label(move, before.board, mover)}）`;
  if (move.captured) {
    const v = capturedValue(move);
    if (v >= 400) return `吃掉对方${v >= 900 ? '车' : v >= 450 ? '炮/马' : '大子'}，争夺子力优势`;
    return `吃子获利，但要想清楚是否得不偿失`;
  }
  return `${label(move, before.board, mover)}：出子/占位/巩固阵型，明确这步的目的`;
}

/**
 * 扫描对手下一手的威胁，并给出破解着法。
 * 只看当前局面走子方的对手（即假设轮到对手走）。
 * @param state 当前局面（轮到我方走）。
 * @param limit 最多返回多少个威胁。
 */
export function scanThreats(state: GameState, limit = 2): Threat[] {
  const me: Side = state.turn;
  const foe: Side = opponent(me);
  // 构造一个"轮到对手走"的镜像局面。
  const foeState: GameState = { ...state, turn: foe };
  const foeMoves = generateLegalMoves(foeState.board, foe);
  const threats: Threat[] = [];

  for (const fm of foeMoves) {
    const afterFoe = applyMoveToState(foeState, fm);
    let kind: ThreatKind | null = null;
    let description = '';

    // 1) 一步杀：对手走这步直接将死/困毙我方。
    const mate = findMateInOne(afterFoe, me); // 我方还有没有一步杀？这里不用
    if (!mate) {
      // 用我方在 afterFoe 下是否无任何解着来判断是否已被将死。
      const myReplies = generateLegalMoves(afterFoe.board, me);
      if (myReplies.length === 0) {
        kind = 'mate';
        description = `对手「${label(fm, state.board, foe)}」形成杀棋，你无子可动`;
      }
    }
    // 2) 白吃大子：对手这步吃掉我方 >=400 分的子。
    if (kind === null && capturedValue(fm) >= 400) {
      kind = 'capture';
      description = `对手「${label(fm, state.board, foe)}」威胁吃掉你的${fm.captured && PIECE_VALUE[fm.captured] >= 900 ? '车' : '马/炮'}`;
    }
    // 3) 将军。
    if (kind === null && isInCheck(afterFoe.board, me)) {
      kind = 'check';
      description = `对手「${label(fm, state.board, foe)}」将军`;
    }
    if (kind === null) continue;

    // 找破解：我方在当前局面（还没走）的所有应手中，哪一个能化解这个特定威胁。
    const myMoves = generateLegalMoves(state.board, me);
    let defense: Move | null = null;
    let defenseNote = '暂无明显解着，需提前预防';
    // 优先：直接吃掉威胁子 / 挡将 / 反将军。
    const scored = myMoves.map((dm) => {
      const after = applyMoveToState(state, dm);
      // 走完我方这步后，对手还能不能走出 fm 这个威胁？
      const foeAfter = generateLegalMoves(after.board, foe);
      const stillThreat = foeAfter.some((x) =>
        x.from.col === fm.from.col && x.from.row === fm.from.row &&
        x.to.col === fm.to.col && x.to.row === fm.to.row);
      const score = evaluateState(after, me, 'leaf') - capturedValue(dm) * 0;
      return { dm, stillThreat, score };
    });
    const candidates = scored.filter((s) => !s.stillThreat).sort((a, b) => b.score - a.score);
    if (candidates.length > 0) {
      defense = candidates[0].dm;
      const cv = capturedValue(defense);
      defenseNote = cv >= 400
        ? `「${label(defense, state.board, me)}」直接反击，化解威胁`
        : `「${label(defense, state.board, me)}」提前防守，破坏对方计划`;
    } else {
      defenseNote = '这步威胁较难直接化解，建议事先避免让对方走出此着';
    }
    threats.push({ kind, move: fm, description, defense, defenseNote });
    if (threats.length >= limit) break;
  }
  // 按危险程度排序：mate > capture > check。
  const rank = (k: ThreatKind) => k === 'mate' ? 3 : k === 'capture' ? 2 : 1;
  return threats.sort((a, b) => rank(b.kind) - rank(a.kind));
}

/** 生成"三步思考"引导（走前 / 走后皆可用）。 */
export function threeStepPrompt(state: GameState, move: Move | null): ThreeStep {
  const step1 = move
    ? describePurpose(move, state)
    : '先在心里选定一着，再问自己：这步的目的是什么？';
  let reply = '预判对手会怎么应：他有没有将军、吃子、偷袭的手段？';
  let follow = '想好对手应对后，你下一手能否保持优势或安全？';
  if (move) {
    // 我方走完 move 后，轮到对方（applyMoveToState 已切换 turn）。
    const after = applyMoveToState(state, move);
    const me: Side = state.turn;
    const foe: Side = opponent(me);
    const foeMoves = generateLegalMoves(after.board, foe);
    // 找对手最强的应手（简评：吃子 + 局面分）。
    let bestReply: Move | null = null;
    let bestReplyState: GameState | null = null;
    let bestScore = -Infinity;
    for (const fm of foeMoves) {
      const a2 = applyMoveToState(after, fm);
      const s = evaluateState(a2, foe, 'leaf') + capturedValue(fm) * 0.4;
      if (s > bestScore) { bestScore = s; bestReply = fm; bestReplyState = a2; }
    }
    if (bestReply) {
      reply = `对手可能「${label(bestReply, after.board, foe)}」${capturedValue(bestReply) >= 400 ? '（吃子反击）' : ''}`;
      // 对手应手后轮到我方，找最佳后续。
      if (bestReplyState) {
        const followUps = generateLegalMoves(bestReplyState.board, me);
        if (followUps.length > 0) {
          follow = `之后可考虑「${label(followUps[0], bestReplyState.board, me)}」，保持主动`;
        }
      }
    }
  }
  return { purpose: step1, reply, follow };
}

/** 判定一手棋是否"随手"（与最佳着差距过大）。 */
export function judgeMoveQuality(before: GameState, chosen: Move): MoveQuality {
  const me = before.turn;
  const moves = generateLegalMoves(before.board, me);
  if (moves.length === 0) return { lossCp: 0, sloppy: false, best: null, comment: '无着可走' };
  let best: Move | null = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const after = applyMoveToState(before, m);
    const score = evaluateState(after, me, 'leaf') + capturedValue(m) * 0.5;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  const afterChosen = applyMoveToState(before, chosen);
  const chosenScore = evaluateState(afterChosen, me, 'leaf') + capturedValue(chosen) * 0.5;
  const lossCp = Math.max(0, Math.round(bestScore - chosenScore));
  const opening = before.moveCount < 8;
  const sloppy = !opening && lossCp >= 350;
  const comment = opening
    ? '开局阶段以出子为主，先记住：这步的目的是什么'
    : sloppy
    ? `这手损失约 ${lossCp} 分，属于随手棋；可考虑「${best ? label(best, before.board, me) : '其他着法'}」`
    : lossCp >= 100
      ? `略有损失（约 ${lossCp} 分），还有更好的下法`
      : '这手棋不错，保持了局面';
  return { lossCp, sloppy, best, comment };
}

/** 把局面转成坐标集合，供 UI 高亮威胁/破解着。 */
export function moveSquares(move: Move): number[] {
  return [move.from.row * 9 + move.from.col, move.to.row * 9 + move.to.col];
}

/** 计算某方子力（用于统计展示）。 */
export function sideMaterial(board: Board, side: Side): number {
  return material(board, side);
}


/** 读取本地复盘统计，供"拒绝随手棋"卡片展示。 */
export function getLessonSnapshot(): { blunders: number; missedMates: number; good: number } {
  try {
    const raw = localStorage.getItem('xiangqi-trainer:lessons-v1');
    if (!raw) return { blunders: 0, missedMates: 0, good: 0 };
    const arr = JSON.parse(raw) as Array<{ kind: string }>;
    return {
      blunders: arr.filter((x) => x.kind === 'blunder').length,
      missedMates: arr.filter((x) => x.kind === 'missed-mate').length,
      good: arr.filter((x) => x.kind === 'good').length,
    };
  } catch {
    return { blunders: 0, missedMates: 0, good: 0 };
  }
}

/* -------------------------------------------------------------------------- */
/* 习惯档案（好习惯培养 H3，v2026.11.24）                                       */
/* -------------------------------------------------------------------------- */

/** 近 N 局的趋势：下降（改善）/ 持平 / 上升（恶化）。 */
export type HabitTrend = 'down' | 'flat' | 'up';

/** 按 LessonKind 聚类后的习惯档案条目。 */
export interface HabitCluster {
  kind: LessonKind;
  /** 该类型总出现次数。 */
  count: number;
  /** 平均损失分（drop）。 */
  avgDrop: number;
  /** 近 N 局出现次数。 */
  recentCount: number;
  /** 近 N 局之前的出现次数。 */
  earlierCount: number;
  /** 近 N 局每局出现率。 */
  recentRate: number;
  /** 之前每局出现率（无历史时为 0）。 */
  earlierRate: number;
  trend: HabitTrend;
  /** 趋势是否下降（历史样本不足时为 false，不误报改善）。 */
  improving: boolean;
  /** 最近一次出现时间。 */
  lastAt: number;
}

/** 针对性练习：来自玩家自己的失误局面，或古谱题库补充。 */
export interface Drill {
  /** 棋盘初始局面（玩家失误用 fromSetup 格式，古谱用 fromNotationSetup 格式）。 */
  setup: string;
  prompt: string;
  kind: LessonKind;
  source: 'own-mistake' | 'puzzle';
}

const TREND_EPSILON = 0.05;

/** 把失误讲解的 T1-T8 标签映射成 lesson.kind（T5/T7 同属九宫安全）。 */
export function lessonKindFromMistakeType(type: MistakeType): LessonKind {
  switch (type) {
    case 'T1': return 'hang-piece';
    case 'T2': return 'missed-mate';
    case 'T3': return 'missed-win';
    case 'T4': return 'slow-develop';
    case 'T5':
    case 'T7': return 'king-unsafe';
    case 'T6': return 'bad-trade';
    case 'T8': return 'slow-move';
    default: return 'blunder';
  }
}

/** 旧 lesson（未知 kind）不参与细分聚类；白名单内的全部保留。 */
function isKnownKind(kind: unknown): kind is LessonKind {
  return typeof kind === 'string' && (LESSON_KINDS as readonly string[]).includes(kind);
}

/**
 * 按失误类型聚类，统计次数、平均 drop、近 N 局趋势。
 * 旧数据（blunder / missed-mate / good）与新细分类型一视同仁。
 */
export function clusterLessons(
  lessons: readonly LessonRecord[],
  options: { recentGames?: number } = {},
): HabitCluster[] {
  const recentGames: number = Math.max(1, Math.floor(options.recentGames ?? 5));
  const valid: LessonRecord[] = lessons.filter(
    (l) => l && isKnownKind(l.kind) && Number.isFinite(l.game),
  );
  if (valid.length === 0) return [];

  const allGames: number[] = [...new Set(valid.map((l) => l.game))];
  const maxGame: number = Math.max(...allGames);
  const cutoff: number = maxGame - recentGames;
  const recentGamesCount: number = Math.max(1, allGames.filter((g) => g > cutoff).length);
  const earlierGamesCount: number = allGames.filter((g) => g <= cutoff).length;

  const groups = new Map<LessonKind, LessonRecord[]>();
  for (const lesson of valid) {
    const list: LessonRecord[] = groups.get(lesson.kind) ?? [];
    list.push(lesson);
    groups.set(lesson.kind, list);
  }

  const clusters: HabitCluster[] = [];
  for (const [kind, list] of groups) {
    const recent: LessonRecord[] = list.filter((l) => l.game > cutoff);
    const earlier: LessonRecord[] = list.filter((l) => l.game <= cutoff);
    const recentRate: number = recent.length / recentGamesCount;
    const earlierRate: number = earlierGamesCount > 0
      ? earlier.length / earlierGamesCount
      : 0;
    let trend: HabitTrend = 'flat';
    if (earlierGamesCount > 0) {
      if (recentRate + TREND_EPSILON < earlierRate) trend = 'down';
      else if (recentRate > earlierRate + TREND_EPSILON) trend = 'up';
    }
    const avgDrop: number = list.reduce((sum, l) => sum + (Number.isFinite(l.drop) ? l.drop : 0), 0) / list.length;
    clusters.push({
      kind,
      count: list.length,
      avgDrop: Math.round(avgDrop * 10) / 10,
      recentCount: recent.length,
      earlierCount: earlier.length,
      recentRate: Math.round(recentRate * 1000) / 1000,
      earlierRate: Math.round(earlierRate * 1000) / 1000,
      trend,
      improving: trend === 'down',
      lastAt: Math.max(...list.map((l) => (Number.isFinite(l.at) ? l.at : 0))),
    });
  }
  return clusters.sort(
    (a, b) => b.count - a.count || b.avgDrop - a.avgDrop || a.kind.localeCompare(b.kind),
  );
}

/** 局面串是否可被现有棋盘加载器还原（兼容 compact / FEN-like 两种格式）。 */
export function isLoadableSetup(setup: unknown): setup is string {
  if (typeof setup !== 'string' || setup.trim().length === 0) return false;
  try {
    if (!Board.fromSetup(setup).isEmpty()) return true;
  } catch { /* 不是 compact 格式，继续试 rows 格式 */ }
  try {
    return !Board.fromNotationSetup(setup).isEmpty();
  } catch {
    return false;
  }
}

/** 从局面串还原棋盘，供练习页/推演页加载；不可加载时返回 null。 */
export function loadDrillBoard(drill: Drill): Board | null {
  if (!isLoadableSetup(drill.setup)) return null;
  try {
    const compact: Board = Board.fromSetup(drill.setup);
    if (!compact.isEmpty()) return compact;
  } catch { /* rows 格式 */ }
  try {
    const rows: Board = Board.fromNotationSetup(drill.setup);
    return rows.isEmpty() ? null : rows;
  } catch {
    return null;
  }
}

/** 古谱题库按类型匹配的关键词（题库题只作真实失误不足时的补充）。 */
const PUZZLE_KEYWORDS: Readonly<Record<LessonKind, readonly string[]>> = {
  'hang-piece': ['车', '马', '炮', '得子'],
  'missed-mate': ['杀', '胜'],
  'good': ['胜'],
  'slow-develop': ['出', '马', '兵'],
  'king-unsafe': ['将', '帅', '宫'],
  'bad-trade': ['兑', '弃', '换'],
  'slow-move': ['兵', '缓', '守'],
  'missed-win': ['胜', '弃'],
  'blunder': ['败', '胜', '车'],
};

function puzzleForKind(kind: LessonKind, used: ReadonlySet<string>): AncientPuzzle | null {
  const keywords: readonly string[] = PUZZLE_KEYWORDS[kind] ?? [];
  const matched: AncientPuzzle[] = SHIQINGYAQU.filter(
    (p) => !used.has(p.setup)
      && keywords.some((word) => p.title.includes(word) || p.hintText.includes(word)),
  );
  const pool: readonly AncientPuzzle[] = matched.length > 0 ? matched : SHIQINGYAQU;
  // 用类型与已用题数做确定性轮转，避免每次都出同一题。
  const offset: number = (kind.length + used.size * 7) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const puzzle: AncientPuzzle = pool[(offset + i) % pool.length];
    if (!used.has(puzzle.setup)) return puzzle;
  }
  return null;
}

/** 从一条真实失误生成练习题；局面不可加载时返回 null。 */
export function drillFromLesson(lesson: LessonRecord): Drill | null {
  if (!lesson || !isKnownKind(lesson.kind) || !isLoadableSetup(lesson.setup)) return null;
  const notation: string = typeof lesson.notation === 'string' && lesson.notation.length > 0
    ? lesson.notation
    : '那一手';
  const drop: number = Number.isFinite(lesson.drop) ? Math.max(0, Math.round(lesson.drop)) : 0;
  return {
    setup: lesson.setup,
    prompt: `这个局面你当时走了「${notation}」${drop > 0 ? `，损失约 ${drop} 分` : ''}，重新想想该走什么？`,
    kind: lesson.kind,
    source: 'own-mistake',
  };
}

function puzzleDrill(puzzle: AncientPuzzle, kind: LessonKind): Drill {
  return {
    setup: puzzle.setup,
    prompt: `古谱残局「${puzzle.title}」：红先，找出正确着法。${puzzle.hintText}`,
    kind,
    source: 'puzzle',
  };
}

/**
 * 从玩家自己的失误生成 limit 道针对性练习；同类不足时用古谱题库补充。
 * 默认 3 题，最多 12 题；纯数据进出，不触碰 localStorage / React。
 */
export function pickDrills(lessons: readonly LessonRecord[], limit = 3): Drill[] {
  const cap: number = Math.max(0, Math.min(12, Math.floor(limit)));
  if (cap === 0) return [];

  const mistakes: LessonRecord[] = lessons.filter(
    (l) => l && l.kind !== 'good' && isKnownKind(l.kind) && isLoadableSetup(l.setup),
  ).sort((a, b) => b.drop - a.drop || b.at - a.at);
  const drills: Drill[] = [];
  const used: Set<string> = new Set();

  // 高频失误类型优先，每类先出一题，保证覆盖面。
  const rankedKinds: LessonKind[] = clusterLessons(mistakes).map((c) => c.kind);
  for (const kind of rankedKinds) {
    if (drills.length >= cap) break;
    for (const lesson of mistakes) {
      if (lesson.kind !== kind || used.has(lesson.setup)) continue;
      const drill: Drill | null = drillFromLesson(lesson);
      if (!drill) continue;
      drills.push(drill);
      used.add(lesson.setup);
      break;
    }
  }
  // 同类已覆盖但还有空位：继续按损失分从自己的失误里补。
  if (drills.length < cap) {
    for (const lesson of mistakes) {
      if (drills.length >= cap) break;
      if (used.has(lesson.setup)) continue;
      const drill: Drill | null = drillFromLesson(lesson);
      if (!drill) continue;
      drills.push(drill);
      used.add(lesson.setup);
    }
  }
  // 真实失误不足：按待强化类型用古谱题库补题。
  if (drills.length < cap) {
    const needKinds: LessonKind[] = rankedKinds.length > 0
      ? rankedKinds
      : (['hang-piece', 'missed-mate', 'king-unsafe'] as LessonKind[]);
    for (let i = drills.length; i < cap; i++) {
      const kind: LessonKind = needKinds[i % needKinds.length];
      const puzzle: AncientPuzzle | null = puzzleForKind(kind, used);
      if (!puzzle) break;
      drills.push(puzzleDrill(puzzle, kind));
      used.add(puzzle.setup);
    }
  }
  return drills;
}

/** 古谱题的预存正解；自己的失误题返回 null（由引擎判着）。 */
export function solutionForDrill(drill: Drill): Move[] | null {
  if (drill.source !== 'puzzle') return null;
  const puzzle: AncientPuzzle | undefined = SHIQINGYAQU.find((p) => p.setup === drill.setup);
  return puzzle ? puzzle.solution : null;
}
