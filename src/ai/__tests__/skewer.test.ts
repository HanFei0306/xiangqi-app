import { describe, it, expect } from 'vitest';
import { Board, createInitialState } from '../../engine/board';
import type { GameState } from '../../engine/types';
import { findCheckSkewer } from '../skewer';

function emptyState(): GameState {
  return { board: Board.fromNotationSetup(''), turn: 'red', history: [], status: 'playing', moveCount: 0 };
}
function setupState(rows: string[]): GameState {
  return { ...emptyState(), board: Board.fromNotationSetup(rows.join('/')) };
}

describe('将军抽子战术检测', () => {
  it('空盘不报抽子', () => {
    expect(findCheckSkewer(emptyState())).toBeNull();
  });
  it('标准开局不误报', () => {
    expect(findCheckSkewer(createInitialState('red'), 4)).toBeNull();
  });
  it('将军后应将方无大子可抽 → 不报', () => {
    const rows = Array.from({ length: 10 }, () => '.,.,.,.,.,.,.,.,.');
    const put = (c: number, r: number, ch: string) => { const a = rows[r].split(','); a[c] = ch; rows[r] = a.join(','); };
    put(3, 9, 'K'); put(4, 4, 'R'); put(4, 0, 'k'); put(3, 0, 'a'); put(5, 0, 'a');
    expect(findCheckSkewer(setupState(rows), 4)).toBeNull();
  });
});
