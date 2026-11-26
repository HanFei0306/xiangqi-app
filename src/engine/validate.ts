/**
 * Standalone position-validation layer for Xiangqi.
 *
 * This module is pure TypeScript with ZERO UI dependencies. It is meant to be
 * called at puzzle/import entry points (never inside the AI search loop): a
 * position produced by legal moves from a legal position is legal by
 * construction, while a hand-authored setup may violate the rules.
 *
 * Clause numbers (C1..C6) match `docs/xiangqi-rules-checklist.md` §C.
 */

import type { Board } from './board';
import type { PieceType, Pos, Side } from './types';
import { BOARD_COLS, BOARD_ROWS, inBounds, opponent } from './types';
import { CHAR_TO_PIECE } from './pieces';
import { isInCheck } from './rules';

/** Validation result. `valid` is true iff `errors` is empty. */
export interface PositionValidation {
  /** Whether the position satisfies every P0 constraint. */
  valid: boolean;
  /** Chinese error messages, each tagged with its clause number (C1..C6). */
  errors: string[];
}

/** Standard per-side piece limits (§A.1 of the checklist). */
const PIECE_LIMITS: Record<PieceType, number> = {
  K: 1,
  A: 2,
  B: 2,
  N: 2,
  R: 2,
  C: 2,
  P: 5,
};

/** All legal piece type codes, used for runtime sanity checks (C1). */
const VALID_TYPES: PieceType[] = ['K', 'A', 'B', 'N', 'R', 'C', 'P'];

/** Human-readable side names for error messages. */
const SIDE_NAME: Record<Side, string> = { red: '红方', black: '黑方' };

/** Human-readable piece names for error messages. */
const PIECE_NAME: Record<Side, Record<PieceType, string>> = {
  red: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  black: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '砲', P: '卒' },
};

/** Empty per-side piece counters. */
function emptyCounts(): Record<PieceType, number> {
  return { K: 0, A: 0, B: 0, N: 0, R: 0, C: 0, P: 0 };
}

/**
 * Structural pre-check of a raw setup string (C1, C11).
 *
 * `Board.fromNotationSetup` deliberately tolerates malformed tokens by
 * skipping them, so a puzzle must be pre-checked before parsing; otherwise a
 * misspelled piece or a short row silently becomes an empty square.
 *
 * Format: exactly 10 rows separated by '/', each row exactly 9
 * comma-separated cells, each cell either '.' or a key of `CHAR_TO_PIECE`.
 */
export function validateSetupString(setup: string): string[] {
  const errors: string[] = [];
  const rows: string[] = setup.split('/');
  if (rows.length !== BOARD_ROWS) {
    errors.push(
      `C1 setup 应有 ${BOARD_ROWS} 段（行），实际 ${rows.length} 段：${JSON.stringify(setup)}`,
    );
  }
  for (let row = 0; row < Math.min(rows.length, BOARD_ROWS); row++) {
    const cells: string[] = rows[row].split(',');
    if (cells.length !== BOARD_COLS) {
      errors.push(
        `C1 setup 第 ${row} 段（row=${row}）应有 ${BOARD_COLS} 格，实际 ${cells.length} 格：${JSON.stringify(rows[row])}`,
      );
    }
    for (let col = 0; col < Math.min(cells.length, BOARD_COLS); col++) {
      const token = cells[col].trim();
      if (token === '') {
        errors.push(`C1 setup 第 ${row} 段第 ${col} 格（col=${col},row=${row}）为空 token`);
      } else if (token !== '.' && !(token in CHAR_TO_PIECE)) {
        errors.push(
          `C1 setup 第 ${row} 段第 ${col} 格（col=${col},row=${row}）未知棋子 token ${JSON.stringify(token)}`,
        );
      }
    }
  }
  return errors;
}

/**
 * Validates a parsed board for one side to move (checklist §C).
 *
 * @param board Position to inspect. It is never mutated.
 * @param turn Side whose turn it is; the OPPONENT must not be in check (C6).
 */
export function validatePosition(board: Board, turn: Side): PositionValidation {
  const errors: string[] = [];
  const counts: Record<Side, Record<PieceType, number>> = {
    red: emptyCounts(),
    black: emptyCounts(),
  };
  const kings: Record<Side, Pos[]> = { red: [], black: [] };

  // C1 — board structure: every occupied cell must be a known piece on a
  // known side and inside the 9x10 grid. (Grid overlap is impossible in
  // Board; raw-string overlap/shape issues are caught by validateSetupString.)
  for (let col = 0; col < BOARD_COLS; col++) {
    for (let row = 0; row < BOARD_ROWS; row++) {
      const piece = board.getPiece({ col, row });
      if (piece === null) continue;
      if (!inBounds(col, row)) {
        errors.push(`C1 棋子位于棋盘外 (${col},${row})`);
        continue;
      }
      const side = piece.side as string;
      const type = piece.type as string;
      if (side !== 'red' && side !== 'black') {
        errors.push(`C1 (${col},${row}) 的棋子阵营非法：${JSON.stringify(side)}`);
        continue;
      }
      if (!(VALID_TYPES as string[]).includes(type)) {
        errors.push(`C1 (${col},${row}) 的棋子类型非法：${JSON.stringify(type)}`);
        continue;
      }
      const pieceType = piece.type;
      counts[piece.side][pieceType] += 1;
      if (pieceType === 'K') {
        kings[piece.side].push({ col, row });
      }
    }
  }

  // C2 — each side has EXACTLY one king. Do NOT rely on isInCheck(), which
  // returns false when a king is missing and would silently pass this case.
  for (const side of ['red', 'black'] as Side[]) {
    const n: number = counts[side].K;
    if (n === 0) {
      errors.push(`C2 ${SIDE_NAME[side]}缺少将/帅（K 数量 0，应为 1）`);
    } else if (n > 1) {
      errors.push(`C2 ${SIDE_NAME[side]}有 ${n} 枚将/帅（应为恰好 1 枚）`);
    }
  }

  // C3 — every king must sit inside its own palace.
  for (const pos of kings.red) {
    if (!(pos.col >= 3 && pos.col <= 5 && pos.row >= 0 && pos.row <= 2)) {
      errors.push(
        `C3 红帅位于 (${pos.col},${pos.row})，不在红方九宫（col 3..5, row 0..2）`,
      );
    }
  }
  for (const pos of kings.black) {
    if (!(pos.col >= 3 && pos.col <= 5 && pos.row >= 7 && pos.row <= 9)) {
      errors.push(
        `C3 黑将位于 (${pos.col},${pos.row})，不在黑方九宫（col 3..5, row 7..9）`,
      );
    }
  }

  // C4 — per-side piece-type limits (this rejects e.g. three red rooks).
  for (const side of ['red', 'black'] as Side[]) {
    for (const type of VALID_TYPES) {
      const n: number = counts[side][type];
      const limit: number = PIECE_LIMITS[type];
      if (n > limit) {
        errors.push(
          `C4 ${SIDE_NAME[side]}${PIECE_NAME[side][type]} ${n} 枚，超过上限 ${limit}`,
        );
      }
    }
  }

  // C5 — the two kings may not face each other on an open file.
  if (kings.red.length === 1 && kings.black.length === 1) {
    const redKing: Pos = kings.red[0];
    const blackKing: Pos = kings.black[0];
    if (redKing.col === blackKing.col) {
      const lo: number = Math.min(redKing.row, blackKing.row) + 1;
      const hi: number = Math.max(redKing.row, blackKing.row);
      let blocked = false;
      for (let row = lo; row < hi; row++) {
        if (board.getPiece({ col: redKing.col, row }) !== null) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        errors.push(
          `C5 红帅 (${redKing.col},${redKing.row}) 与黑将 (${blackKing.col},${blackKing.row}) 同列且中间无子，形成照面`,
        );
      }
    }
  }

  // C6 — the NON-moving side must not already be in check. When turn=red we
  // test black: a black king under attack means black left itself in check,
  // which cannot happen through a legal move. Do not swap this direction.
  if (kings.red.length === 1 && kings.black.length === 1) {
    const nonMover: Side = opponent(turn);
    if (isInCheck(board, nonMover)) {
      errors.push(
        `C6 轮到${SIDE_NAME[turn]}走子，但非走子方${SIDE_NAME[nonMover]}正被将军，该局面不可能由合法着法产生`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
