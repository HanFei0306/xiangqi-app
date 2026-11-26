/**
 * 残局推演 · 自摆残局数据模型（v2026.11.23.9）。
 *
 * 需求：用户在一块空棋盘上自己摆棋子做出残局，摆好后交给现有推演沙盘
 * 做人机推演 / 自己模拟下棋。
 *
 * 设计约束：
 *   - 纯 TypeScript，**零 UI 依赖**（可在 Node 里直接单测）；
 *   - 零网络请求（Android WebView file:// 离线打包），持久化只走 localStorage；
 *   - 所有编辑函数都是**不可变**的：返回新盘，绝不原地改传入的 Board；
 *   - 合法性判定完全复用 `engine/validate` + `engine/rules`，不重复实现规则。
 */

import { Board } from '../engine/board';
import { getGameStatus } from '../engine/rules';
import { validatePosition } from '../engine/validate';
import { BOARD_COLS, BOARD_ROWS } from '../engine/types';
import type { GameState, Piece, PieceType, Pos, Side } from '../engine/types';

/**
 * 每一型棋子的上限，与 `src/engine/validate.ts` 的 `PIECE_LIMITS` 严格一致
 * （K1 A2 B2 N2 R2 C2 P5）。托盘据此禁用"已经放满"的棋子。
 */
export const TRAY_LIMITS: Readonly<Record<PieceType, number>> = {
  K: 1,
  A: 2,
  B: 2,
  N: 2,
  R: 2,
  C: 2,
  P: 5,
};

/** 托盘展示顺序：帅/将 → 仕/士 → 相/象 → 马 → 车 → 炮/砲 → 兵/卒。 */
export const TRAY_ORDER: readonly PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];

/** 两个阵营的固定顺序（红在下、黑在上，与托盘两行一致）。 */
export const TRAY_SIDES: readonly Side[] = ['red', 'black'];

/** 本地草稿存储键。版本后缀配合格式变更使用。 */
export const LAB_KEY = 'xiangqi-trainer:endgame-lab-v1';

/** 本地撤销栈上限（摆错一步也不会把内存吃穿）。 */
export const LAB_UNDO_LIMIT = 40;

/** 合法棋子类型全集，用于持久化脏数据的逐格校验。 */
const VALID_TYPES: readonly string[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];

/** 合法阵营全集。 */
const VALID_SIDES: readonly string[] = ['red', 'black'];

/** 已经终局时给用户的人话提示（validatePosition 不会报这一类错）。 */
const TERMINAL_MESSAGE = '该局面已经终局（绝杀/困毙），请调整棋子后再开始推演';

/** `buildLabState` 的结果：成功带 state，失败带中文错误列表。 */
export type LabBuildResult =
  | { ok: true; state: GameState }
  | { ok: false; errors: string[] };

/** 恢复出来的草稿：一盘摆到一半的残局 + 该谁先走。 */
export interface LabDraft {
  board: Board;
  turn: Side;
}

/** 空盘（9x10，全空）。 */
export function emptyLabBoard(): Board {
  return Board.fromNotationSetup('');
}

/** 空的按阵营/棋型计数的容器。 */
function emptyCounts(): Record<PieceType, number> {
  return { K: 0, A: 0, B: 0, N: 0, R: 0, C: 0, P: 0 };
}

/**
 * 在 `pos` 放一枚棋子，返回**新盘**（`board` 本身不被修改）。
 * 目标格已有棋子时直接覆盖（同色同型即等价于不变，异子即"改放"）。
 * `pos` 越界时返回一份内容等价的新盘，不抛异常。
 */
export function placePiece(board: Board, pos: Pos, piece: Piece): Board {
  const next: Board = board.clone();
  next.setPiece(pos, { type: piece.type, side: piece.side });
  return next;
}

/**
 * 擦掉 `pos` 上的棋子，返回**新盘**（`board` 本身不被修改）。
 * 目标格本来就空时返回一份内容等价的新盘，不抛异常。
 */
export function erasePiece(board: Board, pos: Pos): Board {
  const next: Board = board.clone();
  next.setPiece(pos, null);
  return next;
}

/** 统计盘面上双方各型棋子的数量（托盘据此判断"是否已放满"）。 */
export function countOnBoard(board: Board): Record<Side, Record<PieceType, number>> {
  const counts: Record<Side, Record<PieceType, number>> = {
    red: emptyCounts(),
    black: emptyCounts(),
  };
  for (let col = 0; col < BOARD_COLS; col++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const piece: Piece | null = board.getPiece({ col, row });
      if (piece === null) continue;
      counts[piece.side][piece.type] += 1;
    }
  }
  return counts;
}

/** 某一型棋子是否已经放到上限（托盘按钮据此置灰）。 */
export function isTrayExhausted(
  board: Board,
  side: Side,
  type: PieceType,
): boolean {
  return countOnBoard(board)[side][type] >= TRAY_LIMITS[type];
}

/**
 * 把摆好的盘面收成一个可推演的 `GameState`。
 *
 * 顺序很关键：
 *   1. 先跑 `validatePosition`（C1..C6，错误信息已是中文且带条款编号），
 *      不合法就原样返回，让用户看到"到底哪条规则不满足"；
 *   2. 再算 `getGameStatus`——已经绝杀/困毙的局面交给推演页毫无意义，
 *      这里提前拦下并给一句人话；
 *   3. 剩下的才是可推演局面：history 为空、moveCount 为 0（这是起点）。
 */
export function buildLabState(board: Board, turn: Side): LabBuildResult {
  const validation = validatePosition(board, turn);
  if (!validation.valid) {
    const errors: string[] = validation.errors.length > 0
      ? [...validation.errors]
      : ['该局面不符合象棋规则，请调整棋子后再开始推演'];
    return { ok: false, errors };
  }
  const status = getGameStatus(board, turn);
  if (status === 'checkmate' || status === 'stalemate') {
    return { ok: false, errors: [TERMINAL_MESSAGE] };
  }
  return {
    ok: true,
    state: {
      board: board.clone(),
      turn,
      history: [],
      status,
      moveCount: 0,
    },
  };
}

/**
 * 逐格体检：`Board.fromSetup` 会把任意字符串直接当成 `type`/`side` 塞进盘面
 * （只校验坐标），所以脏草稿必须在解析后再扫一遍，否则一个非法棋子会一路
 * 流到走法生成里。
 */
function isBoardSane(board: Board): boolean {
  for (let col = 0; col < BOARD_COLS; col++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const piece: Piece | null = board.getPiece({ col, row });
      if (piece === null) continue;
      if (!VALID_TYPES.includes(piece.type as string)) return false;
      if (!VALID_SIDES.includes(piece.side as string)) return false;
    }
  }
  return true;
}

/**
 * 读取上次摆到一半的残局草稿。
 *
 * 防御式解析（参照 `src/data/ancient-progress.ts`）：坏 JSON / 半写入 /
 * 字段类型不对 / 坐标越界 / 棋子非法 —— 任何一种都整条丢弃返回 null，
 * **绝不抛异常**（残局草稿坏了不该让用户开不了页面）。
 */
export function loadLabDraft(): LabDraft | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw: string | null = localStorage.getItem(LAB_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const data = parsed as Record<string, unknown>;
    if (typeof data.setup !== 'string') return null;
    const turn: Side | null =
      data.turn === 'red' ? 'red' : data.turn === 'black' ? 'black' : null;
    if (turn === null) return null;
    let board: Board;
    try {
      board = Board.fromSetup(data.setup);
    } catch {
      return null;
    }
    if (!isBoardSane(board)) return null;
    return { board, turn };
  } catch {
    return null;
  }
}

/**
 * 保存当前摆的局面（每次编辑后调用）。存储不可用/已满时静默失败：
 * 本次会话内的状态仍由页面自己持有，不影响摆棋。
 */
export function saveLabDraft(board: Board, turn: Side): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      LAB_KEY,
      JSON.stringify({ setup: board.toNotationSetup(), turn }),
    );
  } catch {
    /* 忽略：私密模式 / 配额已满时不影响摆棋。 */
  }
}

/** 丢弃草稿（"清空棋盘"以外的场景由调用方决定是否调用）。 */
export function clearLabDraft(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LAB_KEY);
  } catch {
    /* 忽略：存储不可用时无需清理。 */
  }
}
