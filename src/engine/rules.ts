/**
 * Rule enforcement for Xiangqi: check detection, move legality, and game
 * status (check / checkmate / stalemate / draw).
 *
 * Legality of a move = pseudo-legal geometry AND the mover's own king is not
 * left in check afterwards (this also enforces the "flying generals" rule,
 * because a position with the two kings facing each other counts as the side
 * to move being in check by the enemy king).
 *
 * Performance note: `isInCheck` uses a direct attack scan of the king square
 * instead of generating every enemy pseudo-move. This is semantically
 * identical but ~an order of magnitude cheaper, which matters because the AI
 * search calls it at every node (via `generateLegalMoves`).
 */

import type { Board } from './board';
import type { GameState, GameStatus, Move, Pos, Side } from './types';
import { inBounds, samePos } from './types';
import { generatePieceMoves, findKing } from './movegen';

/**
 * Whether `by` attacks `target` with a single pseudo-legal move. Advisors and
 * elephants are intentionally omitted: the two palaces never overlap, so they
 * can never attack the opposing king. King-in-palace adjacency and the flying
 * general are covered by the straight-ray scan below.
 */
function squareAttackedBy(board: Board, target: Pos, by: Side): boolean {
  const col: number = target.col;
  const row: number = target.row;
  const forward: number = by === 'red' ? 1 : -1;

  // Pawn attacking straight ahead from the SAME file: a red pawn one row
  // below the target (row-1), a black pawn one row above (row+1). Pawns never
  // move diagonally, so only the same column can attack forward. (A sideways
  // attack after crossing the river is handled separately below.)
  const pawnFrontRow = row - forward;
  if (inBounds(col, pawnFrontRow)) {
    const behind: Pos = { col, row: pawnFrontRow };
    const piece = board.getPiece(behind);
    if (piece && piece.side === by && piece.type === 'P') {
      return true;
    }
  }

  // Pawns attacking sideways, but only after crossing the river.
  const bySideCrossed: boolean = by === 'red' ? row >= 5 : row <= 4;
  if (bySideCrossed) {
    for (const dc of [-1, 1]) {
      const beside: Pos = { col: col + dc, row };
      const piece = board.getPiece(beside);
      if (piece && piece.side === by && piece.type === 'P') {
        return true;
      }
    }
  }

  // Knights: for each of the eight origins, the orthogonal "leg" must be free.
  const knightOrigins: ReadonlyArray<readonly [number, number, number, number]> = [
    [col + 1, row + 2, col + 1, row + 1],
    [col - 1, row + 2, col - 1, row + 1],
    [col + 1, row - 2, col + 1, row - 1],
    [col - 1, row - 2, col - 1, row - 1],
    [col + 2, row + 1, col + 1, row + 1],
    [col + 2, row - 1, col + 1, row - 1],
    [col - 2, row + 1, col - 1, row + 1],
    [col - 2, row - 1, col - 1, row - 1],
  ];
  for (const [oc, orow, lc, lrow] of knightOrigins) {
    if (!inBounds(oc, orow) || !inBounds(lc, lrow)) {
      continue;
    }
    if (board.getPiece({ col: lc, row: lrow }) !== null) {
      continue; // 蹩马腿
    }
    const piece = board.getPiece({ col: oc, row: orow });
    if (piece && piece.side === by && piece.type === 'N') {
      return true;
    }
  }

  // Rooks / cannons / adjacent king along the four orthogonal rays.
  const directions: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dc, dr] of directions) {
    let c: number = col + dc;
    let r: number = row + dr;
    let screenFound: boolean = false;
    while (inBounds(c, r)) {
      const piece = board.getPiece({ col: c, row: r });
      if (piece !== null) {
        if (!screenFound) {
          // First piece on the ray: rook or king captures it directly.
          if (piece.side === by && (piece.type === 'R' || piece.type === 'K')) {
            return true;
          }
          screenFound = true; // this piece becomes the cannon screen
        } else {
          // First piece past the screen: a cannon of `by` can capture it.
          if (piece.side === by && piece.type === 'C') {
            return true;
          }
          break;
        }
      }
      c += dc;
      r += dr;
    }
  }
  return false;
}

/**
 * Returns true if `side`'s king is currently under attack.
 * Includes the flying-generals rule (enemy king on an open shared file): the
 * orthogonal ray scan in `squareAttackedBy` already treats the enemy K as a
 * direct attacker, so an open shared file is detected here without a separate
 * fallback. (A previous `return kingsFacing(board)` fallback ignored `side`
 * and could report check for both kings in arbitrary custom positions.)
 */
export function isInCheck(board: Board, side: Side): boolean {
  const kingPos: Pos | null = findKing(board, side);
  if (!kingPos) {
    return false; // no king: treat as not in check (game already over)
  }
  const enemy: Side = side === 'red' ? 'black' : 'red';
  return squareAttackedBy(board, kingPos, enemy);
}

/**
 * Generates all pseudo-legal moves for a side (re-exported to avoid a direct
 * import cycle in callers that only need rules.ts).
 */
function generateAllMovesForSide(board: Board, side: Side): Move[] {
  const moves: Move[] = [];
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (piece && piece.side === side) {
        moves.push(...generatePieceMoves(board, { col, row }));
      }
    }
  }
  return moves;
}

/**
 * Returns true if `move` is fully legal in the context of `board`:
 * geometrically valid for the piece and does not leave the mover's king in
 * check (flying generals included).
 */
export function isLegalMove(board: Board, move: Move): boolean {
  const piece = board.getPiece(move.from);
  if (!piece) {
    return false;
  }
  // Geometry check against pseudo-legal moves.
  const pseudo = generatePieceMoves(board, move.from);
  const matches = pseudo.some(
    (m) => samePos(m.to, move.to) && m.piece === move.piece,
  );
  if (!matches) {
    return false;
  }
  // Self-check check.
  const clone = board.clone();
  clone.applyMove({ ...move });
  return !isInCheck(clone, piece.side);
}

/** All fully-legal moves for a side. */
export function generateLegalMoves(board: Board, side: Side): Move[] {
  const pseudo = generateAllMovesForSide(board, side);
  return pseudo.filter((m) => {
    const clone = board.clone();
    clone.applyMove({ ...m });
    return !isInCheck(clone, side);
  });
}

/**
 * Computes the game status for the side to move (`turn`).
 * - 'checkmate' : in check and no legal moves.
 * - 'stalemate' : not in check but no legal moves (困毙, a loss in Xiangqi).
 * - 'check'     : in check but has legal moves.
 * - 'playing'   : otherwise.
 * Draw handling (e.g. repetition) is out of scope for this trainer.
 */
export function checkStatus(board: Board, turn: Side): GameStatus {
  const inCheck = isInCheck(board, turn);
  const hasMove = generateLegalMoves(board, turn).length > 0;
  if (!hasMove) {
    return inCheck ? 'checkmate' : 'stalemate';
  }
  return inCheck ? 'check' : 'playing';
}

/**
 * Applies a legal move to a state, returning a NEW GameState (the input is
 * not mutated). Fills the move's notation via Board.applyMove. Throws if the
 * move is illegal.
 */
export function applyMoveToState(state: GameState, move: Move): GameState {
  if (!isLegalMove(state.board, move)) {
    throw new Error(
      `applyMoveToState: illegal move ${move.notation || JSON.stringify(move)}`,
    );
  }
  const board = state.board.clone();
  const applied = { ...move };
  board.applyMove(applied);
  const nextTurn: Side = turn_opponent(state.turn);
  const status = checkStatus(board, nextTurn);
  return {
    board,
    turn: nextTurn,
    history: [...state.history, applied],
    status,
    moveCount: state.moveCount + 1,
  };
}

/** Returns the opponent side (local helper to avoid extra import noise). */
function turn_opponent(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

/**
 * Finds the legal move (if any) that moves the piece at `from` to `to`.
 * Returns the fully-populated Move, or `null` when no legal move matches.
 */
export function makeMove(board: Board, from: Pos, to: Pos): Move | null {
  const pseudo = generatePieceMoves(board, from);
  const found = pseudo.find((m) => samePos(m.to, to));
  if (!found) {
    return null;
  }
  const move: Move = { ...found };
  if (!isLegalMove(board, move)) {
    return null;
  }
  return move;
}

/** Computes the game status for the side to move on `board`. */
export function getGameStatus(board: Board, turn: Side): GameStatus {
  return checkStatus(board, turn);
}

/**
 * v22.6 子力不足和棋：双方都没有车(R)/马(N)/炮(C)/兵(P)等进攻子力，
 * 只剩将帅(K)、士(A)、象(B)时，谁也无法将死对方，推演/对局局面应立即判和。
 * 只扫描棋子类型，不影响任何走法生成与胜负判定逻辑。
 */
export function insufficientMaterial(board: Board): boolean {
  for (let col = 0; col < 9; col++) {
    for (let row = 0; row < 10; row++) {
      const piece = board.getPiece({ col, row });
      if (!piece) continue;
      if (piece.type === 'R' || piece.type === 'N'
        || piece.type === 'C' || piece.type === 'P') {
        return false;
      }
    }
  }
  return true;
}

/**
 * Returns the legal move from `from` to `to` for `side`, or `null` when the
 * move is illegal or impossible. Intended for puzzle validation, where the
 * caller supplies the side to move alongside the candidate move.
 */
export function legalMoveAt(
  board: Board,
  from: Pos,
  to: Pos,
  _side: Side,
): Move | null {
  const pseudo = generatePieceMoves(board, from);
  const found = pseudo.find((m) => samePos(m.to, to));
  if (!found) {
    return null;
  }
  const move: Move = { ...found };
  if (!isLegalMove(board, move)) {
    return null;
  }
  return move;
}
