/**
 * 离线棋理规则引擎（v2026.11.23.2）。
 *
 * 只读取局面特征 + WPL 评级，用 8 类规则给出最主要的类型；
 * 零 React、零 fetch、零大模型。优先级严格按 PRD §5.2：
 * T2 > T3 > T1 > T5 > T7 > T6 > T4 > T8。
 */
import { findMateInOne } from '../ai/mate';
import { staticExchange } from '../ai/see';
import type { Board } from '../engine/board';
import { PIECE_VALUE } from '../engine/pieces';
import { generateLegalMoves, isInCheck } from '../engine/rules';
import { opponent, type GameState, type Move, type PieceType, type Pos, type Side } from '../engine/types';
import { gradeOf, type MistakeType } from './mistakeTypes';

export type { MistakeType } from './mistakeTypes';

/** 分类所需的全部上下文，由检测层 + 局面重放构造。 */
export interface RuleContext {
  before: GameState;
  after: GameState;
  played: Move;
  best: Move | null;
  mover: Side;
  ply: number;
  cpPre: number;
  cpPlayed: number;
  cpBest: number;
  missedWin: boolean;
  /** 走子前 findMateInOne(before,mover) 是否有杀，由调用方预计算。 */
  mateAvailable: boolean;
  prevOpponentMove?: Move;
  history: readonly Move[];
}

const TYPE_CODE: Readonly<Record<PieceType, number>> = {
  K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7,
};

function samePos(a: Pos, b: Pos): boolean {
  return a.col === b.col && a.row === b.row;
}

function sameMove(a: Move, b: Move): boolean {
  return samePos(a.from, b.from) && samePos(a.to, b.to) && a.piece === b.piece;
}

function flatSquares(board: Board): Int8Array {
  const squares = new Int8Array(90);
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece) squares[col * 10 + row] = (piece.side === 'red' ? 1 : -1) * TYPE_CODE[piece.type];
    }
  }
  return squares;
}

/** 目标格被 side 攻击 / 保护的着法数量。 */
function attackCount(board: Board, side: Side, target: Pos): number {
  return generateLegalMoves(board, side).filter((move) => samePos(move.to, target)).length;
}

/**
 * 用 SEE 精算这次吃子是否真的净赚（>0 表示不吃亏）。
 * 注意 generateLegalMoves 返回的 captured 恒为 null，必须传入目标格实际棋子类型。
 */
function seeNet(board: Board, move: Move, side: Side, capturedType: PieceType): number {
  const squares = flatSquares(board);
  const scratch = new Int8Array(90);
  return staticExchange(
    squares,
    move.from.col * 10 + move.from.row,
    move.to.col * 10 + move.to.row,
    (side === 'red' ? 1 : -1) * TYPE_CODE[move.piece],
    (side === 'red' ? -1 : 1) * TYPE_CODE[capturedType],
    scratch,
  );
}

function findKing(board: Board, side: Side): Pos | null {
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece && piece.side === side && piece.type === 'K') return { col, row };
    }
  }
  return null;
}

/** 将帅周边（九宫邻接格）受到的威胁数量，用于判断应将后是否更危险。 */
function kingZoneThreats(board: Board, side: Side): number {
  const king = findKing(board, side);
  if (!king) return 0;
  const zone: Pos[] = [];
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const col = king.col + dc;
      const row = king.row + dr;
      if (col >= 0 && col <= 8 && row >= 0 && row <= 9) zone.push({ col, row });
    }
  }
  return generateLegalMoves(board, opponent(side))
    .filter((move) => zone.some((p) => samePos(p, move.to))).length;
}

/** T2：走子前存在一步杀，但所走并非杀着。 */
function isMissedMate(ctx: RuleContext): boolean {
  if (!ctx.mateAvailable || ctx.before.turn !== ctx.mover) return false;
  const killer = findMateInOne(ctx.before, ctx.mover);
  return killer ? !sameMove(killer, ctx.played) : true;
}

/** T3：痛失好局，或对手上一手露出无保护大子而没有吃掉。 */
function isMissedWin(ctx: RuleContext): boolean {
  if (ctx.missedWin) return true;
  if (ctx.ply <= 0) return false;
  const previous = ctx.prevOpponentMove ?? ctx.history[ctx.ply - 1];
  if (!previous) return false;
  const enemy: Side = opponent(ctx.mover);
  const exposed = ctx.before.board.getPiece(previous.to);
  if (!exposed || exposed.side !== enemy || exposed.type === 'K'
    || PIECE_VALUE[exposed.type] < 400) return false;
  if (samePos(ctx.played.to, previous.to)) return false;
  const canCapture = generateLegalMoves(ctx.before.board, ctx.mover)
    .some((move) => samePos(move.to, previous.to));
  const defended = attackCount(ctx.before.board, enemy, previous.to) > 0;
  return canCapture && !defended;
}

/** T1：走后己方大子被对方吃掉且防守数少于攻击数（SEE 净负）。 */
function isHangingPiece(ctx: RuleContext): boolean {
  const enemy: Side = opponent(ctx.mover);
  for (const capture of generateLegalMoves(ctx.after.board, enemy)) {
    const victim = ctx.after.board.getPiece(capture.to);
    if (!victim || victim.side !== ctx.mover || victim.type === 'K') continue;
    if (PIECE_VALUE[victim.type] < 400) continue;
    const attackers = attackCount(ctx.after.board, enemy, capture.to);
    const defenders = attackCount(ctx.after.board, ctx.mover, capture.to);
    if (attackers <= defenders) continue;
    if (seeNet(ctx.after.board, capture, enemy, victim.type) > 0) return true;
  }
  return false;
}

/** T5：走前未被将、走后被将，或随手动士相让九宫出现缺口。 */
function isUnsecurePalace(ctx: RuleContext): boolean {
  const wasChecked = isInCheck(ctx.before.board, ctx.mover);
  const nowChecked = isInCheck(ctx.after.board, ctx.mover);
  if (!wasChecked && nowChecked) return true;
  if (ctx.played.piece !== 'A' && ctx.played.piece !== 'B') return false;
  const grade = gradeOf(ctx.cpPre, ctx.cpPlayed).grade;
  if (grade !== 'mistake' && grade !== 'blunder' && grade !== 'missed-win') return false;
  return kingZoneThreats(ctx.after.board, ctx.mover) > kingZoneThreats(ctx.before.board, ctx.mover);
}

/** T7：被将军时应着让将帅更危险（仍在将中或九宫威胁增加）。 */
function isBadCheckEscape(ctx: RuleContext): boolean {
  if (!isInCheck(ctx.before.board, ctx.mover)) return false;
  if (isInCheck(ctx.after.board, ctx.mover)) return true;
  return kingZoneThreats(ctx.after.board, ctx.mover) > kingZoneThreats(ctx.before.board, ctx.mover);
}

/** T6：主动吃子后对方能用更贵的子吃回，或 SEE 判定净亏。 */
function isBadTrade(ctx: RuleContext): boolean {
  if (!ctx.played.captured) return false;
  const enemy: Side = opponent(ctx.mover);
  const recaptures = generateLegalMoves(ctx.after.board, enemy)
    .filter((move) => samePos(move.to, ctx.played.to));
  const dearerRecapture = recaptures.some((move) =>
    PIECE_VALUE[move.piece] > PIECE_VALUE[ctx.played.piece]);
  const victimType: PieceType = ctx.played.captured
    ?? ctx.before.board.getPiece(ctx.played.to)?.type ?? 'P';
  return dearerRecapture || seeNet(ctx.before.board, ctx.played, ctx.mover, victimType) < 0;
}

/** T4：开局重复动同子 / 士相未动先动车 / 无意义兵。 */
function isSlowDevelopment(ctx: RuleContext): boolean {
  if (ctx.ply >= 16) return false;
  const mine = ctx.history.slice(0, ctx.ply).filter((_, index) =>
    (index % 2 === 0 ? 'red' : 'black') === ctx.mover);
  const samePiece = mine.some((move) =>
    move.piece === ctx.played.piece && move.from.col === ctx.played.from.col);
  if (samePiece) return true;
  const palaceMoved = mine.some((move) => move.piece === 'A' || move.piece === 'B');
  if ((ctx.played.piece === 'R' || ctx.played.piece === 'C') && !palaceMoved) return true;
  if (ctx.played.piece === 'P' && !ctx.played.captured
    && gradeOf(ctx.cpPre, ctx.cpPlayed).wpl >= 10) return true;
  return false;
}

/**
 * 按优先级给出一步失误的主类型。任何缺失字段都安全回退到 T8，
 * 保证结算页不会因单个残缺 annotation 白屏。
 */
export function classifyMistake(ctx: RuleContext): MistakeType {
  if (!ctx || !ctx.before || !ctx.after || !ctx.played || !ctx.history) return 'T8';
  if (isMissedMate(ctx)) return 'T2';
  if (isMissedWin(ctx)) return 'T3';
  if (isHangingPiece(ctx)) return 'T1';
  if (isUnsecurePalace(ctx)) return 'T5';
  if (isBadCheckEscape(ctx)) return 'T7';
  if (isBadTrade(ctx)) return 'T6';
  if (isSlowDevelopment(ctx)) return 'T4';
  return 'T8';
}
