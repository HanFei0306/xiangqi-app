/**
 * 合法着法 -> 带中文记谱的着法。
 *
 * generateLegalMoves 返回的 Move 只填坐标，notation/captured 要等
 * Board.applyMove 才会写入；讲解卡片与演示按钮都必须拿到可读记谱，
 * 因此这里统一在克隆棋盘上补一次记谱，不改动任何对局状态。
 */
import type { Board } from '../engine/board';
import { generateLegalMoves } from '../engine/rules';
import type { GameState, Move } from '../engine/types';

/** 返回带 notation / captured 的着法副本。 */
export function withMoveNotation(board: Board, move: Move): Move {
  const clone = board.clone();
  const applied = clone.applyMove({ ...move });
  return { ...move, notation: applied.notation, captured: applied.captured };
}

/** 当前局面全部合法着法，均带中文记谱。 */
export function legalMovesWithNotation(state: GameState): Move[] {
  return generateLegalMoves(state.board, state.turn)
    .map((move) => withMoveNotation(state.board, move));
}
