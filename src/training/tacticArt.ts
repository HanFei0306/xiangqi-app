/**
 * 杀法识别（v2026.11.21.7）：将死时判断属于哪种经典杀法，供屏幕中央艺术字展示。
 * 参考天天象棋的吃/绝杀特效与常见杀法定式。纯局面分析，不改对局。
 */
import type { Move, Pos } from '../engine/types';
import type { Board } from '../engine/board';

export type TacticName =
  | '重炮杀' | '铁门栓' | '马后炮' | '卧槽马' | '闷宫杀' | '绝杀';

export interface TacticResult {
  name: TacticName;
  note: string;
}

function hasPieceNear(board: Board, type: string, lowerHalf: boolean): boolean {
  for (let c = 0; c < 9; c++) {
    for (let r = 0; r < 10; r++) {
      const p = board.getPiece({ col: c, row: r });
      if (!p || p.type !== type) continue;
      if (lowerHalf ? r >= 6 : r <= 3) return true;
    }
  }
  return false;
}

function countPieceInCol(board: Board, type: string, col: number): number {
  let n = 0;
  for (let r = 0; r < 10; r++) {
    const p = board.getPiece({ col, row: r });
    if (p && p.type === type) n++;
  }
  return n;
}

function pieceAt(board: Board, c: number, r: number): boolean {
  return board.getPiece({ col: c, row: r }) !== null;
}

/** 依据最后一着与将死后的棋盘，猜测杀法类型；无法归入定式时返回「绝杀」。 */
export function classifyTactic(board: Board, lastMove: Move | null): TacticResult {
  if (!lastMove) return { name: '绝杀', note: '将死对方将帅' };
  const mover = lastMove.piece;
  const to: Pos = lastMove.to;

  if (mover === 'C') {
    const twoCannonsSameCol = countPieceInCol(board, 'C', to.col) >= 2;
    if (twoCannonsSameCol) return { name: '重炮杀', note: '两炮重叠同一路，前炮照将后炮催杀，对方无从化解' };
    const horseNear = hasPieceNear(board, 'N', to.row >= 5);
    if (horseNear) return { name: '马后炮', note: '马控将门、炮在后照将，是经典的马炮配合杀法' };
    if (to.row >= 7) return { name: '闷宫杀', note: '炮封宫门，将帅被自家士象堵住无法逃脱' };
  }

  if ((mover === 'R' || mover === 'C') && (to.row === 0 || to.row === 9)) {
    const centerControl = pieceAt(board, 4, to.row === 9 ? 6 : 3);
    if (centerControl) return { name: '铁门栓', note: '车/炮封住底线，另一子锁住中路，将帅动弹不得' };
  }

  if (mover === 'N' && (to.row === 7 || to.row === 8 || to.row === 1 || to.row === 2)) {
    return { name: '卧槽马', note: '马跳卧槽控制将门，配合车炮形成杀棋' };
  }

  return { name: '绝杀', note: '连续强制手段将死对方，行棋严谨无解' };
}
