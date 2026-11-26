import { describe, it, expect } from 'vitest';
import { Board } from '../../engine/board';
import { applyMoveToState, checkStatus, generateLegalMoves } from '../../engine/rules';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import { ancientAiReply } from '../ancientReply';
import { findMateInOne } from '../mate';

function wrongFirstMove(order: number): { board: Board; wrongNotation: string } {
  const puzzle = SHIQINGYAQU.find((p) => p.order === order)!;
  const board = Board.fromNotationSetup(puzzle.setup);
  const intended = puzzle.solution[0];
  const wrong = generateLegalMoves(board, 'red').find(
    (m) => m.from.col !== intended.from.col || m.from.row !== intended.from.row
      || m.to.col !== intended.to.col || m.to.row !== intended.to.row,
  )!;
  const notation = wrong.notation;
  board.applyMove({ ...wrong });
  return { board, wrongNotation: notation };
}

describe('适情雅趣残局 AI', () => {
  it('在真实错着局面里精准走出一步杀（不会放过杀点）', () => {
    const { board } = wrongFirstMove(2); // 马蹀阏氏
    const state = {
      board, turn: 'black' as const, history: [], status: checkStatus(board, 'black'), moveCount: 0,
    };
    expect(findMateInOne(state, 'black')).not.toBeNull();

    const started = Date.now();
    const chosen = ancientAiReply(board, 'black', { maxDepth: 4, timeMs: 180 });
    expect(chosen).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    const after = applyMoveToState(state, chosen!);
    expect(['checkmate', 'stalemate']).toContain(after.status);
  });

  it('在普通残局里返回合法着法，并有硬时限', () => {
    const puzzle = SHIQINGYAQU.find((p) => p.order === 1)!;
    const board = Board.fromNotationSetup(puzzle.setup);
    const started = Date.now();
    const chosen = ancientAiReply(board, 'red', { maxDepth: 4, timeMs: 180 });
    expect(chosen).not.toBeNull();
    expect(Date.now() - started).toBeLessThan(1200);
    expect(generateLegalMoves(board, 'red').some(
      (m) => m.from.col === chosen!.from.col && m.from.row === chosen!.from.row
        && m.to.col === chosen!.to.col && m.to.row === chosen!.to.row,
    )).toBe(true);
  });
});
