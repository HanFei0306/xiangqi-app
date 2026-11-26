import { describe, it, expect } from 'vitest';
import { Board, createInitialState } from '../../engine/board';
import type { GameState, Side } from '../../engine/types';
import { checkStatus } from '../../engine/rules';
import { detectThreats, type ThreatSignal } from '../threatRadar';

type Placement = [col: number, row: number, ch: string];

function boardOf(placements: readonly Placement[]): Board {
  const rows = Array.from({ length: 10 }, () => '.,.,.,.,.,.,.,.,.'.split(','));
  for (const [col, row, ch] of placements) rows[row][col] = ch;
  return Board.fromNotationSetup(rows.map((row) => row.join(',')).join('/'));
}

function stateOf(placements: readonly Placement[], turn: Side = 'red'): GameState {
  const board = boardOf(placements);
  return {
    board,
    turn,
    history: [],
    status: checkStatus(board, turn),
    moveCount: 0,
  };
}

function has(signals: readonly ThreatSignal[], kind: ThreatSignal['kind']): boolean {
  return signals.some((signal) => signal.kind === kind);
}

describe('预警雷达 detectThreats', () => {
  it('开局正常局面零误报', () => {
    const state = createInitialState('red');
    expect(detectThreats(state, 'red')).toEqual([]);
    expect(detectThreats({ ...state, turn: 'black' }, 'black')).toEqual([]);
  });

  it('送子：己方车被对方车瞄准时报 hang，且标在被吃格', () => {
    // 红车(4,4)与黑车(4,6)同线，中间无子；红方先走但车已经挂着。
    const state = stateOf([
      [4, 0, 'K'], [4, 4, 'R'], [4, 6, 'r'], [4, 9, 'k'],
    ]);
    const signals = detectThreats(state, 'red');
    const hang = signals.find((s) => s.kind === 'hang');
    expect(hang).toBeDefined();
    expect(hang?.square).toEqual({ col: 4, row: 4 });
    expect(hang?.side).toBe('red');
    expect(hang?.text).toContain('车');
  });

  it('将军抽子：将军后白抽一车报 skewer', () => {
    // 黑车(4,3)吃中兵(4,2)将军；红应将后黑车可沿横线吃(0,2)的红车。
    const state = stateOf([
      [4, 0, 'K'], [0, 2, 'R'], [4, 2, 'P'], [4, 3, 'r'], [4, 9, 'k'],
    ]);
    const signals = detectThreats(state, 'red');
    expect(has(signals, 'skewer')).toBe(true);
  });

  it('一步杀：对方下一手成杀时报 mate，标在己方将帅', () => {
    // 红方尚有 2 个合法着，但黑方存在一步杀（规则层证明）。
    const state = stateOf([
      [4, 0, 'K'], [4, 9, 'k'], [4, 6, 'p'],
      [2, 2, 'r'], [3, 2, 'r'], [7, 4, 'n'], [5, 5, 'c'], [0, 4, 'p'], [4, 4, 'p'],
    ]);
    const signals = detectThreats(state, 'red');
    const mate = signals.find((s) => s.kind === 'mate');
    expect(mate).toBeDefined();
    expect(mate?.square).toEqual({ col: 4, row: 0 });
    expect(mate?.text).toContain('一步成杀');
  });

  it('王区危险：多子压境时报 king-zone', () => {
    const state = stateOf([
      [4, 0, 'K'], [4, 1, 'P'], [3, 2, 'r'], [5, 2, 'r'],
      [4, 3, 'r'], [3, 3, 'c'], [4, 4, 'c'], [4, 9, 'k'],
    ]);
    const signals = detectThreats(state, 'red');
    expect(has(signals, 'king-zone') || has(signals, 'mate') || has(signals, 'skewer')).toBe(true);
    // 单测聚焦 zoneScoreOf 的调用口径：无杀棋时仍应给出王区提示。
    if (!has(signals, 'mate') && !has(signals, 'skewer')) {
      expect(has(signals, 'king-zone')).toBe(true);
    }
  });

  it('黑方视角对称可用：信号 side 始终为玩家方', () => {
    const state = stateOf([
      [4, 0, 'K'], [4, 4, 'r'], [4, 6, 'R'], [4, 9, 'k'],
    ]);
    const signals = detectThreats(state, 'black');
    const hang = signals.find((s) => s.kind === 'hang');
    expect(hang).toBeDefined();
    expect(hang?.side).toBe('black');
    expect(hang?.square).toEqual({ col: 4, row: 4 });
  });

  it('性能有界：常规局面单次检测 < 100ms', () => {
    const state = createInitialState('red');
    detectThreats(state, 'red'); // 预热，排除首次 JIT 干扰
    const started: number = performance.now();
    detectThreats(state, 'red');
    const elapsed: number = performance.now() - started;
    expect(elapsed).toBeLessThan(100);
  });

  it('终局局面不报警', () => {
    const state = createInitialState('red');
    expect(detectThreats({ ...state, status: 'checkmate' }, 'red')).toEqual([]);
    expect(detectThreats({ ...state, status: 'draw' }, 'red')).toEqual([]);
  });
});
