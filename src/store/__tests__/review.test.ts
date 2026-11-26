import { describe, it, expect } from 'vitest';
import { boardAt } from '../gameStore';
import { createInitialState } from '../../engine/board';
import { makeMove, applyMoveToState } from '../../engine/rules';
import type { Move } from '../../engine/types';

describe('棋谱回放 boardAt', () => {
  it('replays the first cannon move consistently with applyMoveToState', () => {
    let state = createInitialState('red');
    // 炮二平五: cannon on file 2 (col 7) slides to file 5 (col 4) on row 2.
    const m1 = makeMove(state.board, { col: 7, row: 2 }, { col: 4, row: 2 });
    expect(m1).not.toBeNull();
    state = applyMoveToState(state, m1!);

    const history: Move[] = [m1!];
    const at0 = boardAt(history, 0);

    expect(at0.history.length).toBe(1);
    expect(at0.board.getPiece({ col: 4, row: 2 })?.type).toBe('C');
    expect(at0.board.getPiece({ col: 7, row: 2 })).toBeNull();
    // boardAt must not mutate the source history.
    expect(history[0].notation).toBe(m1!.notation);
  });

  it('caps the index at the last available move', () => {
    let state = createInitialState('red');
    const m1 = makeMove(state.board, { col: 7, row: 2 }, { col: 4, row: 2 });
    state = applyMoveToState(state, m1!);
    const history: Move[] = [m1!];
    const atEnd = boardAt(history, 99);
    expect(atEnd.history.length).toBe(1);
  });
});
