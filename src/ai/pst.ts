/**
 * Shared piece-square-table infrastructure for the v2026.11.19.1 engine.
 *
 * 数值出处 / Attribution
 * ----------------------
 * PST 原始数值取自 ElephantEye（象眼）3.3 的公开评估表：
 *   https://github.com/QiuleiWang/eleeye  ->  eleeye/preeval.cpp
 * 项目授权：LGPL-2.1。此处只抄录公开数值事实（12 张 256 项表 + 威胁表 +
 * 阶段权重），不复制其 C++ 控制流；阶段插值采用 Fairy-Stockfish 的 tapered
 * mg/eg 结构（https://github.com/fairy-stockfish/Fairy-Stockfish，仅架构参考，
 * 未复制其源码或权重）。
 *
 * 坐标约定：本项目 col 0..8（左→右）、row 0..9（0=红底线），内部 sq=col*10+row。
 * 象眼 16x16 补边棋盘有效区为行 3..12、列 3..11：
 *   eeRow = 12 - row;  eeCol = col + 3;  eeSq = eeRow * 16 + eeCol
 * 黑子先归一化到红视角 (8-col, 9-row) 再查表，查表值按棋子符号取负，
 * 从构造上保证评估严格反对称。
 *
 * 阶段：PHASE_TOTAL = 66（初始满子），权重 {A:1,B:1,N:3,C:3,R:6,P:1,K:0}。
 * PST_MG/PST_EG 已把 PIECE_VALUE 与位置分烘焙进同一张 Int16 表，索引为
 * `(code + 7) * 90 + sq`（code -7..7；0 位保留不用）。
 */

import type { PieceType } from '../engine/types';
import { PIECE_VALUE } from '../engine/pieces';

/** 阶段权重，按 |code| 索引（1=K .. 7=P）。 */
export const PHASE_WEIGHT = new Int8Array([0, 0, 1, 1, 3, 6, 3, 1]);
/** 按棋子类型索引的阶段权重（供测试/文档使用）。 */
export const PHASE_WEIGHT_BY_TYPE: Readonly<Record<PieceType, number>> = {
  K: 0, A: 1, B: 1, N: 3, R: 6, C: 3, P: 1,
};
/** 初始满子阶段和：4R*6 + 4N*3 + 4C*3 + 4A + 4B + 10P = 66。 */
export const PHASE_TOTAL = 66;

/** 把 10 行（象眼行 3..12）× 16 列原始数值展开成 256 项表。 */
function expand(rows: ReadonlyArray<ReadonlyArray<number>>): Uint8Array {
  const out = new Uint8Array(256);
  for (let r = 0; r < 10; r++) {
    const src = rows[r];
    for (let c = 0; c < 16; c++) out[(r + 3) * 16 + c] = src[c] ?? 0;
  }
  return out;
}

const ROW = (
  a: number, b: number, c: number,
  d: number, e: number, f: number, g: number, h: number, i: number,
  j: number, k: number, l: number,
): readonly number[] => [a, b, c, d, e, f, g, h, i, j, k, l, 0, 0, 0, 0];

// ---- 12 张象眼公开位置表（EE 行 3..12） ------------------------------------

/** 帅/兵 中局·攻击态（作为 MG 基础表）。 */
export const KING_PAWN_MIDGAME_ATTACKING: Uint8Array = expand([
  ROW(0, 0, 0, 9, 9, 9, 11, 13, 11, 9, 9, 9),
  ROW(0, 0, 0, 39, 49, 69, 84, 89, 84, 69, 49, 39),
  ROW(0, 0, 0, 39, 49, 64, 74, 74, 74, 64, 49, 39),
  ROW(0, 0, 0, 39, 46, 54, 59, 61, 59, 54, 46, 39),
  ROW(0, 0, 0, 29, 37, 41, 54, 59, 54, 41, 37, 29),
  ROW(0, 0, 0, 7, 0, 13, 0, 16, 0, 13, 0, 7),
  ROW(0, 0, 0, 7, 0, 7, 0, 15, 0, 7, 0, 7),
  ROW(0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0),
  ROW(0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0),
  ROW(0, 0, 0, 0, 0, 0, 11, 15, 11, 0, 0, 0),
]);

/** 帅/兵 中局·无威胁态。 */
export const KING_PAWN_MIDGAME_ATTACKLESS: Uint8Array = expand([
  ROW(0, 0, 0, 9, 9, 9, 11, 13, 11, 9, 9, 9),
  ROW(0, 0, 0, 19, 24, 34, 42, 44, 42, 34, 24, 19),
  ROW(0, 0, 0, 19, 24, 32, 37, 37, 37, 32, 24, 19),
  ROW(0, 0, 0, 19, 23, 27, 29, 30, 29, 27, 23, 19),
  ROW(0, 0, 0, 14, 18, 20, 27, 29, 27, 20, 18, 14),
  ROW(0, 0, 0, 7, 0, 13, 0, 16, 0, 13, 0, 7),
  ROW(0, 0, 0, 7, 0, 7, 0, 15, 0, 7, 0, 7),
  ROW(0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0),
  ROW(0, 0, 0, 0, 0, 0, 2, 2, 2, 0, 0, 0),
  ROW(0, 0, 0, 0, 0, 0, 11, 15, 11, 0, 0, 0),
]);

/** 帅/兵 残局·攻击态（作为 EG 基础表）。 */
export const KING_PAWN_ENDGAME_ATTACKING: Uint8Array = expand([
  ROW(0, 0, 0, 10, 10, 10, 15, 15, 15, 10, 10, 10),
  ROW(0, 0, 0, 50, 55, 60, 85, 100, 85, 60, 55, 50),
  ROW(0, 0, 0, 65, 70, 70, 75, 75, 75, 70, 70, 65),
  ROW(0, 0, 0, 75, 80, 80, 80, 80, 80, 80, 80, 75),
  ROW(0, 0, 0, 70, 70, 65, 70, 70, 70, 65, 70, 70),
  ROW(0, 0, 0, 45, 0, 40, 45, 45, 45, 40, 0, 45),
  ROW(0, 0, 0, 40, 0, 35, 40, 40, 40, 35, 0, 40),
  ROW(0, 0, 0, 0, 0, 5, 5, 15, 5, 5, 0, 0),
  ROW(0, 0, 0, 0, 0, 3, 3, 13, 3, 3, 0, 0),
  ROW(0, 0, 0, 0, 0, 1, 1, 11, 1, 1, 0, 0),
]);

/** 帅/兵 残局·无威胁态。 */
export const KING_PAWN_ENDGAME_ATTACKLESS: Uint8Array = expand([
  ROW(0, 0, 0, 10, 10, 10, 15, 15, 15, 10, 10, 10),
  ROW(0, 0, 0, 10, 15, 20, 45, 60, 45, 20, 15, 10),
  ROW(0, 0, 0, 25, 30, 30, 35, 35, 35, 30, 30, 25),
  ROW(0, 0, 0, 35, 40, 40, 45, 45, 45, 40, 40, 35),
  ROW(0, 0, 0, 25, 30, 30, 35, 35, 35, 30, 30, 25),
  ROW(0, 0, 0, 25, 0, 25, 25, 25, 25, 25, 0, 25),
  ROW(0, 0, 0, 20, 0, 20, 20, 20, 20, 20, 0, 20),
  ROW(0, 0, 0, 0, 0, 5, 5, 13, 5, 5, 0, 0),
  ROW(0, 0, 0, 0, 0, 3, 3, 12, 3, 3, 0, 0),
  ROW(0, 0, 0, 0, 0, 1, 1, 11, 1, 1, 0, 0),
]);

/** 马中局表。 */
export const KNIGHT_MIDGAME: Uint8Array = expand([
  ROW(0, 0, 0, 90, 90, 90, 96, 90, 96, 90, 90, 90),
  ROW(0, 0, 0, 90, 96, 103, 97, 94, 97, 103, 96, 90),
  ROW(0, 0, 0, 92, 98, 99, 103, 99, 103, 99, 98, 92),
  ROW(0, 0, 0, 93, 108, 100, 107, 100, 107, 100, 108, 93),
  ROW(0, 0, 0, 90, 100, 99, 103, 104, 103, 99, 100, 90),
  ROW(0, 0, 0, 90, 98, 101, 102, 103, 102, 101, 98, 90),
  ROW(0, 0, 0, 92, 94, 98, 95, 98, 95, 98, 94, 92),
  ROW(0, 0, 0, 93, 92, 94, 95, 92, 95, 94, 92, 93),
  ROW(0, 0, 0, 85, 90, 92, 93, 78, 93, 92, 90, 85),
  ROW(0, 0, 0, 88, 85, 90, 88, 90, 88, 90, 85, 88),
]);

/** 马残局表。 */
export const KNIGHT_ENDGAME: Uint8Array = expand([
  ROW(0, 0, 0, 92, 94, 96, 96, 96, 96, 96, 94, 92),
  ROW(0, 0, 0, 94, 96, 98, 98, 98, 98, 98, 96, 94),
  ROW(0, 0, 0, 96, 98, 100, 100, 100, 100, 100, 98, 96),
  ROW(0, 0, 0, 96, 98, 100, 100, 100, 100, 100, 98, 96),
  ROW(0, 0, 0, 96, 98, 100, 100, 100, 100, 100, 98, 96),
  ROW(0, 0, 0, 94, 96, 98, 98, 98, 98, 98, 96, 94),
  ROW(0, 0, 0, 94, 96, 98, 98, 98, 98, 98, 96, 94),
  ROW(0, 0, 0, 92, 94, 96, 96, 96, 96, 96, 94, 92),
  ROW(0, 0, 0, 90, 92, 94, 92, 92, 92, 94, 92, 90),
  ROW(0, 0, 0, 88, 90, 92, 90, 90, 90, 92, 90, 88),
]);

/** 车中局表。 */
export const ROOK_MIDGAME: Uint8Array = expand([
  ROW(0, 0, 0, 206, 208, 207, 213, 214, 213, 207, 208, 206),
  ROW(0, 0, 0, 206, 212, 209, 216, 233, 216, 209, 212, 206),
  ROW(0, 0, 0, 206, 208, 207, 214, 216, 214, 207, 208, 206),
  ROW(0, 0, 0, 206, 213, 213, 216, 216, 216, 213, 213, 206),
  ROW(0, 0, 0, 208, 211, 211, 214, 215, 214, 211, 211, 208),
  ROW(0, 0, 0, 208, 212, 212, 214, 215, 214, 212, 212, 208),
  ROW(0, 0, 0, 204, 209, 204, 212, 214, 212, 204, 209, 204),
  ROW(0, 0, 0, 198, 208, 204, 212, 212, 212, 204, 208, 198),
  ROW(0, 0, 0, 200, 208, 206, 212, 200, 212, 206, 208, 200),
  ROW(0, 0, 0, 194, 206, 204, 212, 200, 212, 204, 206, 194),
]);

/** 车残局表。 */
export const ROOK_ENDGAME: Uint8Array = expand([
  ROW(0, 0, 0, 182, 182, 182, 184, 186, 184, 182, 182, 182),
  ROW(0, 0, 0, 184, 184, 184, 186, 190, 186, 184, 184, 184),
  ROW(0, 0, 0, 182, 182, 182, 184, 186, 184, 182, 182, 182),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
  ROW(0, 0, 0, 180, 180, 180, 182, 184, 182, 180, 180, 180),
]);

/** 炮中局表。 */
export const CANNON_MIDGAME: Uint8Array = expand([
  ROW(0, 0, 0, 100, 100, 96, 91, 90, 91, 96, 100, 100),
  ROW(0, 0, 0, 98, 98, 96, 92, 89, 92, 96, 98, 98),
  ROW(0, 0, 0, 97, 97, 96, 91, 92, 91, 96, 97, 97),
  ROW(0, 0, 0, 96, 99, 99, 98, 100, 98, 99, 99, 96),
  ROW(0, 0, 0, 96, 96, 96, 96, 100, 96, 96, 96, 96),
  ROW(0, 0, 0, 95, 96, 99, 96, 100, 96, 99, 96, 95),
  ROW(0, 0, 0, 96, 96, 96, 96, 96, 96, 96, 96, 96),
  ROW(0, 0, 0, 97, 96, 100, 99, 101, 99, 100, 96, 97),
  ROW(0, 0, 0, 96, 97, 98, 98, 98, 98, 98, 97, 96),
  ROW(0, 0, 0, 96, 96, 97, 99, 99, 99, 97, 96, 96),
]);

/** 炮残局表。 */
export const CANNON_ENDGAME: Uint8Array = expand([
  ROW(0, 0, 0, 100, 100, 100, 100, 100, 100, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 100, 100, 100, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 100, 100, 100, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 102, 104, 102, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 102, 104, 102, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 102, 104, 102, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 102, 104, 102, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 102, 104, 102, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 104, 106, 104, 100, 100, 100),
  ROW(0, 0, 0, 100, 100, 100, 104, 106, 104, 100, 100, 100),
]);

/** 从 (eeSq, value) 列表构造稀疏的仕/相表。 */
function sparse(values: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const out = new Uint8Array(256);
  for (const [sq, v] of values) out[sq] = v;
  return out;
}

const ADVISOR_SQUARES: ReadonlyArray<readonly [number, number]> = [
  [8 * 16 + 5, 20], [8 * 16 + 9, 20],
  [10 * 16 + 3, 18], [10 * 16 + 6, 20], [10 * 16 + 7, 23],
  [10 * 16 + 8, 20], [10 * 16 + 11, 18],
  [11 * 16 + 7, 23],
  [12 * 16 + 5, 20], [12 * 16 + 6, 20], [12 * 16 + 8, 20], [12 * 16 + 9, 20],
];

/** 仕/相 无威胁表（MG 基础）。 */
export const ADVISOR_BISHOP_THREATLESS: Uint8Array = sparse(ADVISOR_SQUARES);

/** 仕/相 升变无威胁表（辅助威胁插值）。 */
export const ADVISOR_BISHOP_PROMOTION_THREATLESS: Uint8Array = sparse([
  [8 * 16 + 5, 30], [8 * 16 + 9, 30],
  [10 * 16 + 3, 28], [10 * 16 + 6, 30], [10 * 16 + 7, 33],
  [10 * 16 + 8, 30], [10 * 16 + 11, 28],
  [11 * 16 + 7, 33],
  [12 * 16 + 5, 30], [12 * 16 + 6, 30], [12 * 16 + 8, 30], [12 * 16 + 9, 30],
]);

/** 仕/相 受威胁表（EG 基础；attacks 高时进一步靠近）。 */
export const ADVISOR_BISHOP_THREATENED: Uint8Array = sparse([
  [8 * 16 + 5, 40], [8 * 16 + 9, 40],
  [10 * 16 + 3, 38], [10 * 16 + 6, 40], [10 * 16 + 7, 43],
  [10 * 16 + 8, 40], [10 * 16 + 11, 38],
  [11 * 16 + 7, 43],
  [12 * 16 + 5, 40], [12 * 16 + 6, 40], [12 * 16 + 8, 40], [12 * 16 + 9, 40],
]);

/** 空心炮威胁分，按象眼列 0..15 索引。 */
export const CVL_HOLLOW_THREAT: ReadonlyArray<number> = [
  0, 0, 0, 0, 0, 0, 60, 65, 70, 75, 80, 80, 80, 0, 0, 0,
];
/** 中路威胁分，按象眼列 0..15 索引。 */
export const CVL_CENTRAL_THREAT: ReadonlyArray<number> = [
  0, 0, 0, 0, 0, 0, 50, 45, 40, 35, 30, 30, 30, 0, 0, 0,
];
/** 底线威胁分，按象眼列 0..15 索引。 */
export const CVL_BOTTOM_THREAT: ReadonlyArray<number> = [
  0, 0, 0, 40, 30, 0, 0, 0, 0, 0, 30, 40, 0, 0, 0, 0,
];

/**
 * 象眼 16x16 棋盘下标。黑子先归一化到红视角（左右、上下同时镜像）。
 * 返回值始终落在有效区 3..12 行、3..11 列。
 */
export function pstIndex(col: number, row: number, isRed: boolean): number {
  const rc: number = isRed ? col : 8 - col;
  const rr: number = isRed ? row : 9 - row;
  return (12 - rr) * 16 + (rc + 3);
}

/** 该格在扁平 PST 中的索引：`(code+7)*90 + (col*10+row)`。 */
function flatIndex(code: number, col: number, row: number): number {
  return (code + 7) * 90 + col * 10 + row;
}

/** 中局表查值（不含子力分，按红视角；调用方按 code 符号取负）。 */
export function mgTableValue(code: number, col: number, row: number): number {
  const sq = pstIndex(col, row, code > 0);
  const abs: number = Math.abs(code);
  if (abs === 1 || abs === 7) return KING_PAWN_MIDGAME_ATTACKING[sq];
  if (abs === 2 || abs === 3) return ADVISOR_BISHOP_THREATLESS[sq];
  if (abs === 4) return KNIGHT_MIDGAME[sq];
  if (abs === 5) return ROOK_MIDGAME[sq];
  if (abs === 6) return CANNON_MIDGAME[sq];
  return 0;
}

/** 残局表查值（不含子力分，按红视角；调用方按 code 符号取负）。 */
export function egTableValue(code: number, col: number, row: number): number {
  const sq = pstIndex(col, row, code > 0);
  const abs: number = Math.abs(code);
  if (abs === 1 || abs === 7) return KING_PAWN_ENDGAME_ATTACKLESS[sq];
  if (abs === 2 || abs === 3) return ADVISOR_BISHOP_THREATENED[sq];
  if (abs === 4) return KNIGHT_ENDGAME[sq];
  if (abs === 5) return ROOK_ENDGAME[sq];
  if (abs === 6) return CANNON_ENDGAME[sq];
  return 0;
}

/** 烘焙后的中局子力+位置表（红为正、黑为负）。 */
export const PST_MG: Int16Array = new Int16Array(15 * 90);
/** 烘焙后的残局子力+位置表（红为正、黑为负）。 */
export const PST_EG: Int16Array = new Int16Array(15 * 90);
/**
 * 攻击态与无威胁态的差值表：帅/兵用 Attacking−Attackless，
 * 仕/相用 Threatened−Threatless。evalTerms 用动态 attacks 因子二次插值，
 * 让 12 张公开表都有落点，且不改变 PST_MG/PST_EG 的 O(1) 增量主路径。
 */
export const PST_ATTACK_DELTA: Int16Array = new Int16Array(15 * 90);

(function bakePst(): void {
  for (let code = -7; code <= 7; code++) {
    if (code === 0) continue;
    const type: PieceType = (['K', 'A', 'B', 'N', 'R', 'C', 'P'] as const)[Math.abs(code) - 1];
    const sign: number = code > 0 ? 1 : -1;
    for (let col = 0; col < 9; col++) {
      for (let row = 0; row < 10; row++) {
        const idx = flatIndex(code, col, row);
        const sq = pstIndex(col, row, code > 0);
        const abs: number = Math.abs(code);
        let mgPos: number = 0;
        let egPos: number = 0;
        let delta: number = 0;
        if (abs === 1 || abs === 7) {
          mgPos = KING_PAWN_MIDGAME_ATTACKING[sq];
          egPos = KING_PAWN_ENDGAME_ATTACKLESS[sq];
          delta = KING_PAWN_MIDGAME_ATTACKING[sq] - KING_PAWN_MIDGAME_ATTACKLESS[sq];
        } else if (abs === 2 || abs === 3) {
          mgPos = ADVISOR_BISHOP_THREATLESS[sq];
          egPos = ADVISOR_BISHOP_THREATENED[sq];
          delta = ADVISOR_BISHOP_THREATENED[sq] - ADVISOR_BISHOP_THREATLESS[sq];
        } else if (abs === 4) {
          mgPos = KNIGHT_MIDGAME[sq];
          egPos = KNIGHT_ENDGAME[sq];
        } else if (abs === 5) {
          mgPos = ROOK_MIDGAME[sq];
          egPos = ROOK_ENDGAME[sq];
        } else if (abs === 6) {
          mgPos = CANNON_MIDGAME[sq];
          egPos = CANNON_ENDGAME[sq];
        }
        // Development / premature-attack surrogates are baked into the MIDDLE
        // GAME table once at module init. The search leaf therefore pays zero
        // for them: it already reads PST_MG in O(1). Black squares are
        // normalised to red's view first, so antisymmetry is preserved.
        const nr: number = code > 0 ? row : 9 - row;
        let development: number = 0;
        if (abs === 7 && nr === 4) development += 8; // healthy pawn advance
        else if (abs === 4 && nr === 0) development -= 14; // undeveloped horse
        else if (abs === 6 && nr >= 5) {
          development -= Math.min(80, 55 + (nr - 5) * 5); // premature deep cannon
        }
        mgPos += development;
        PST_MG[idx] = sign * (PIECE_VALUE[type] + mgPos);
        PST_EG[idx] = sign * (PIECE_VALUE[type] + egPos);
        PST_ATTACK_DELTA[idx] = sign * delta;
      }
    }
  }
})();

/** 计算当前局面的阶段和（双方合计，单调下降到 0）。 */
export function phaseOf(squares: Int8Array): number {
  let phase: number = 0;
  for (let i = 0; i < 90; i++) {
    const code = squares[i];
    if (code !== 0) phase += PHASE_WEIGHT[Math.abs(code)];
  }
  return phase > PHASE_TOTAL ? PHASE_TOTAL : phase;
}

/** Tapered 插值：phase=66 用纯 MG，phase=0 用纯 EG。 */
export function tapered(mg: number, eg: number, phase: number): number {
  return Math.round((mg * phase + eg * (PHASE_TOTAL - phase)) / PHASE_TOTAL);
}

// --- Zobrist 键（与 FastState 增量维护共用） --------------------------------

const ZOB1 = new Uint32Array(16 * 91);
const ZOB2 = new Uint32Array(16 * 91);
const ZOB_TURN1 = new Uint32Array(2);
const ZOB_TURN2 = new Uint32Array(2);

(function initZobrist(): void {
  let s: number = 0x9e3779b9;
  const next = (): number => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  for (let i = 0; i < ZOB1.length; i++) {
    ZOB1[i] = next();
    ZOB2[i] = next();
  }
  for (let i = 0; i < 2; i++) {
    ZOB_TURN1[i] = next();
    ZOB_TURN2[i] = next();
  }
})();

/** 棋子 Zobrist 下标，沿用 `(code+7)*91+sq`（+7 偏移修复过黑子负数索引）。 */
export function zobristPieceIndex(code: number, sq: number): number {
  return (code + 7) * 91 + sq;
}

/** XOR 一枚棋子的两半哈希到提供的值上（用于增量 key 更新）。 */
export function xorPiece(
  h1: number,
  h2: number,
  code: number,
  sq: number,
): readonly [number, number] {
  const idx = zobristPieceIndex(code, sq);
  return [(h1 ^ ZOB1[idx]) >>> 0, (h2 ^ ZOB2[idx]) >>> 0];
}

/** XOR 轮走方哈希。 */
export function xorTurn(
  h1: number,
  h2: number,
  turnSign: number,
): readonly [number, number] {
  const t = turnSign > 0 ? 1 : 0;
  return [(h1 ^ ZOB_TURN1[t]) >>> 0, (h2 ^ ZOB_TURN2[t]) >>> 0];
}

/** 由两半 32 位哈希打包成安全整数（TT key）。 */
export function packKey(h1: number, h2: number): number {
  return h1 * 2097152 + (h2 >>> 11);
}

/** 全量计算 Zobrist 的两半 32 位哈希（FastState 初始化用）。 */
export function computeKeyHalves(
  squares: Int8Array,
  turnSign: number,
): readonly [number, number] {
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < 90; i++) {
    const code = squares[i];
    if (code !== 0) {
      const next = xorPiece(h1, h2, code, i);
      h1 = next[0];
      h2 = next[1];
    }
  }
  const turned = xorTurn(h1, h2, turnSign);
  return [turned[0], turned[1]];
}

/** 全量计算 Zobrist key（测试/初始化用；搜索热路径读 FastState.key）。 */
export function computeKey(squares: Int8Array, turnSign: number): number {
  const halves = computeKeyHalves(squares, turnSign);
  return packKey(halves[0], halves[1]);
}
