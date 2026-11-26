/**
 * Regressions for "无将军时误报将军" / 双真值源.
 *
 * classifyEvent used to re-run isInCheck(board, turnAfter) to decide the 将军
 * voice cue, while the UI read game.status (computed by checkStatus). The two
 * could disagree. The cue must now come from the SAME status the UI renders.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Board } from '../../engine/board';
import type { Move, Piece, Pos } from '../../engine/types';
import { classifyEvent } from '../gameStore';
import { useSettings } from '../settings';

function pos(col: number, row: number): Pos {
  return { col, row };
}

function boardWith(pieces: Array<{ pos: Pos; piece: Piece }>): Board {
  const board = new Board(
    Array.from({ length: 9 }, () => new Array<Piece | null>(10).fill(null)),
  );
  for (const { pos: p, piece } of pieces) board.setPiece(p, piece);
  return board;
}

const quietMove: Move = {
  from: pos(0, 3),
  to: pos(0, 4),
  piece: 'P',
  captured: null,
  notation: '',
};

describe('classifyEvent 将军判定（单一真值源 = status）', () => {
  beforeEach(() => {
    useSettings.setState({ playerSide: 'red' });
  });

  it('status=playing 且局面无将军时，不产出 check 事件', () => {
    const board = boardWith([
      { pos: pos(3, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(5, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const result = classifyEvent(quietMove, board, 'black', 'playing', null);
    expect(result.event).not.toBe('check');
    expect(result).toEqual({ cue: 'move', event: 'move' });
  });

  it('status=playing 但棋盘真有将军时，仍以 status 为准（不再二次计算）', () => {
    // Simulates the old inconsistency: a real rook check on the board, yet
    // game.status is 'playing'. Voice must stay in sync with the UI and stay
    // silent on 将军 — no independent isInCheck re-computation.
    const board = boardWith([
      { pos: pos(4, 0), piece: { type: 'K', side: 'red' } },
      { pos: pos(4, 5), piece: { type: 'R', side: 'black' } },
      { pos: pos(3, 9), piece: { type: 'K', side: 'black' } },
    ]);
    const result = classifyEvent(quietMove, board, 'red', 'playing', null);
    expect(result.event).not.toBe('check');
    expect(result).toEqual({ cue: 'move', event: 'move' });
  });

  it('status=check 时产出且只产出一声 check', () => {
    const board = new Board(); // no attack needed: status is the sole input
    const result = classifyEvent(quietMove, board, 'red', 'check', null);
    expect(result).toEqual({ cue: 'check', event: 'check' });
  });

  it('status=checkmate 且有胜负结果时，行为不变：checkmate 事件 + 胜/负木鱼声', () => {
    const board = new Board();
    const result = classifyEvent(quietMove, board, 'red', 'checkmate', {
      status: 'checkmate',
      reason: 'checkmate',
      winner: 'red',
      loser: 'black',
    });
    expect(result).toEqual({ cue: 'win', event: 'checkmate' });
  });

  it('无将军且 status=playing 时，吃子仍报 capture', () => {
    const board = new Board();
    const capture: Move = { ...quietMove, captured: 'R' };
    const result = classifyEvent(capture, board, 'black', 'playing', null);
    expect(result).toEqual({ cue: 'capture', event: 'capture' });
  });
});
