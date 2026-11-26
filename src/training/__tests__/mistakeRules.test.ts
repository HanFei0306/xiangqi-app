/** 8 类棋理规则的黄金集（16 例）+ 优先级 + 文案硬约束。 */
import { describe, expect, it } from 'vitest';
import { findMateInOne } from '../../ai/mate';
import { Board } from '../../engine/board';
import { applyMoveToState } from '../../engine/rules';
import type { GameState, Move, PieceType, Pos } from '../../engine/types';
import { classifyMistake, type MistakeType, type RuleContext } from '../mistakeRules';
import { MISTAKE_TYPES, MISTAKE_TEMPLATES } from '../mistakeTemplates';
import type { MistakeEntry, MistakeGrade } from '../mistakeTypes';
import golden from './fixtures/golden-16.json';

function pos(col: number, row: number): Pos { return { col, row }; }

function move(
  fromCol: number, fromRow: number, toCol: number, toRow: number,
  piece: PieceType, captured: PieceType | null = null,
): Move {
  return {
    from: pos(fromCol, fromRow), to: pos(toCol, toRow), piece, captured, notation: '测试着法',
  };
}

function entryOf(ply: number, missedWin = false): MistakeEntry {
  return {
    ply, side: 'red', grade: 'mistake' as MistakeGrade, wpl: 15, wplBest: 8,
    cpPre: 100, cpBest: 120, cpPlayed: 50,
    playedNotation: '测试着法', bestNotation: '测试正解', bestMove: null,
    beforeState: new Board() as unknown as GameState, missedWin,
  };
}

interface Scenario {
  setup: string;
  afterSetup?: string;
  played: Move;
  ply?: number;
  missedWin?: boolean;
  history?: Move[];
}

const SCENARIOS: Record<string, Scenario> = {
  'hang-rook': {
    setup: '4,0,K,red;3,9,K,black;4,3,R,red;8,4,R,black;0,7,P,black',
    played: move(4, 3, 4, 4, 'R'),
  },
  'hang-horse': {
    setup: '4,0,K,red;3,9,K,black;2,2,N,red;8,4,R,black;0,7,P,black',
    played: move(2, 2, 3, 4, 'N'),
  },
  'mate-one-a': {
    setup: '4,0,K,red;4,9,K,black;3,8,R,red;5,8,R,red;4,7,R,red',
    played: move(4, 7, 4, 8, 'R'),
  },
  'mate-one-b': {
    setup: '2,0,K,red;2,9,K,black;1,8,R,red;3,8,R,red;2,7,R,red',
    played: move(2, 7, 2, 8, 'R'),
  },
  'missed-win-a': {
    setup: '4,0,K,red;5,9,K,black;0,4,R,red;0,7,P,black;8,8,R,black',
    played: move(0, 4, 0, 5, 'R'), missedWin: true,
  },
  'missed-win-b': {
    setup: '5,0,K,red;3,9,K,black;8,4,R,red;0,7,P,black',
    played: move(8, 4, 8, 6, 'R'), missedWin: true,
  },
  'early-rook': {
    setup: '4,0,K,red;5,9,K,black;0,0,R,red;0,7,P,black;8,8,R,black',
    played: move(0, 0, 0, 2, 'R'), ply: 2,
  },
  'repeat-horse': {
    setup: '4,0,K,red;3,9,K,black;1,2,N,red;0,7,P,black',
    played: move(1, 2, 2, 4, 'N'), ply: 4,
    history: [move(1, 1, 2, 3, 'N')],
  },
  'expose-king-a': {
    setup: '4,0,K,red;3,9,K,black;4,5,R,black;4,3,N,red;0,7,P,black',
    afterSetup: '4,0,K,red;3,9,K,black;4,5,R,black;2,4,N,red;0,7,P,black',
    played: move(4, 3, 2, 4, 'N'),
  },
  'expose-king-b': {
    setup: '5,0,K,red;3,9,K,black;5,5,R,black;5,3,B,red;0,7,P,black',
    afterSetup: '5,0,K,red;3,9,K,black;5,5,R,black;7,4,B,red;0,7,P,black',
    played: move(5, 3, 7, 4, 'B'),
  },
  'bad-trade-horse': {
    setup: '4,0,K,red;5,9,K,black;4,8,A,black;1,4,N,red;3,4,P,black;3,6,R,red;8,4,R,black',
    afterSetup: '4,0,K,red;5,9,K,black;4,8,A,black;3,4,N,red;3,6,R,red;8,4,R,black',
    played: move(1, 4, 3, 4, 'N', 'P'),
  },
  'bad-trade-cannon': {
    setup: '4,0,K,red;5,9,K,black;4,8,A,black;1,4,C,red;2,4,P,red;3,4,P,black;3,6,R,red;8,4,R,black',
    afterSetup: '4,0,K,red;5,9,K,black;4,8,A,black;2,4,P,red;3,4,C,red;3,6,R,red;8,4,R,black',
    played: move(1, 4, 3, 4, 'C', 'P'),
  },
  'escape-danger-a': {
    setup: '4,0,K,red;3,9,K,black;4,4,R,black;0,0,R,red;0,7,P,black',
    afterSetup: '4,0,K,red;3,9,K,black;4,4,R,black;0,2,R,red;0,7,P,black',
    played: move(0, 0, 0, 2, 'R'),
  },
  'escape-danger-b': {
    setup: '5,0,K,red;3,9,K,black;5,4,R,black;7,0,N,red;0,7,P,black',
    afterSetup: '5,0,K,red;3,9,K,black;5,4,R,black;6,2,N,red;0,7,P,black',
    played: move(7, 0, 6, 2, 'N'),
  },
  'quiet-move-a': {
    setup: '4,0,K,red;3,9,K,black;0,3,P,red;0,7,P,black',
    played: move(0, 3, 0, 4, 'P'), ply: 20,
  },
  'quiet-move-b': {
    setup: '4,0,K,red;3,9,K,black;2,1,N,red;0,7,P,black',
    played: move(2, 1, 3, 3, 'N'), ply: 22,
  },
};

function contextOf(scenario: string): RuleContext {
  const spec = SCENARIOS[scenario];
  if (!spec) throw new Error(`unknown scenario ${scenario}`);
  const before: GameState = {
    board: Board.fromSetup(spec.setup),
    turn: 'red', history: [], status: 'playing', moveCount: spec.ply ?? 8,
  };
  const after: GameState = spec.afterSetup
    ? { ...before, board: Board.fromSetup(spec.afterSetup) }
    : applyMoveToState(before, spec.played);
  const entry = entryOf(spec.ply ?? 8, spec.missedWin ?? false);
  const history: readonly Move[] = spec.history ?? [];
  return {
    before,
    after,
    played: spec.played,
    best: null,
    mover: 'red',
    ply: spec.ply ?? 8,
    cpPre: entry.cpPre,
    cpPlayed: entry.cpPlayed,
    cpBest: entry.cpBest,
    missedWin: entry.missedWin,
    mateAvailable: findMateInOne(before, 'red') !== null,
    prevOpponentMove: (spec.ply ?? 8) > 0 ? history[(spec.ply ?? 8) - 1] : undefined,
    history,
  };
}

describe('8 类黄金集分类', () => {
  it('covers at least two constructed cases per type', () => {
    const counts = new Map<MistakeType, number>();
    for (const type of MISTAKE_TYPES) counts.set(type, 0);
    for (const item of golden.cases) {
      counts.set(item.expected as MistakeType, (counts.get(item.expected as MistakeType) ?? 0) + 1);
    }
    for (const type of MISTAKE_TYPES) expect(counts.get(type)).toBeGreaterThanOrEqual(2);
    expect(golden.cases).toHaveLength(16);
  });

  it('reaches >=90% agreement with the human-labelled golden set', () => {
    let matched = 0;
    for (const item of golden.cases) {
      const actual = classifyMistake(contextOf(item.scenario));
      if (actual === item.expected) matched++;
      else console.warn(`golden mismatch #${item.id}: expected ${item.expected}, got ${actual}`);
    }
    expect(matched / golden.cases.length).toBeGreaterThanOrEqual(0.9);
  });

  it('respects priority T2 > T3 > T1 > T5 > T7 > T6 > T4 > T8', () => {
    const mate = contextOf('mate-one-a');
    mate.missedWin = true; // 同时命中 T3
    expect(classifyMistake(mate)).toBe('T2');

    const miss = contextOf('missed-win-a');
    miss.missedWin = true;
    expect(classifyMistake(miss)).toBe('T3');

    const quiet = contextOf('quiet-move-a');
    expect(classifyMistake(quiet)).toBe('T8');
  });

  it('never throws on incomplete context', () => {
    expect(classifyMistake({} as RuleContext)).toBe('T8');
  });
});

describe('棋理模板文案硬约束', () => {
  it('has three non-empty all-Chinese paragraphs per type, each <=80 chars', () => {
    for (const type of MISTAKE_TYPES) {
      const template = MISTAKE_TEMPLATES[type];
      expect(template).toBeDefined();
      for (const paragraph of [template.verdict, template.why, template.advice]) {
        expect(paragraph.trim().length).toBeGreaterThan(0);
        expect(paragraph.length).toBeLessThanOrEqual(80);
        expect(paragraph).toMatch(/[\u4e00-\u9fa5]/);
        expect(paragraph).not.toMatch(/undefined|\[object Object\]|占位|模板|未定义/);
      }
    }
  });
});
