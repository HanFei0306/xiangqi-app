import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../engine/board';
import { Board } from '../../engine/board';
import { generateLegalMoves } from '../../engine/rules';
import { SHIQINGYAQU } from '../../data/shiqingyaqu';
import type { GameState } from '../../engine/types';
import {
  scanThreats,
  threeStepPrompt,
  judgeMoveQuality,
  getLessonSnapshot,
  clusterLessons,
  pickDrills,
  loadDrillBoard,
  isLoadableSetup,
  solutionForDrill,
  lessonKindFromMistakeType,
} from '../habitCoach';
import { sanitizeLessons, type LessonRecord } from '../../data/lesson-storage';

describe('下棋习惯教练', () => {
  it('三步思考：未选着法给出三问模板', () => {
    const s = createInitialState('red');
    const steps = threeStepPrompt(s, null);
    expect(steps.purpose).toContain('目的');
    expect(steps.reply).toContain('对手');
    expect(steps.follow).toContain('下一手');
  });

  it('三步思考：选着后给出具体推演', () => {
    const s = createInitialState('red');
    const move = generateLegalMoves(s.board, 'red')[0];
    const steps = threeStepPrompt(s, move);
    expect(steps.purpose.length).toBeGreaterThan(4);
    expect(steps.reply).toContain('对手可能');
    expect(steps.follow.length).toBeGreaterThan(4);
  });

  it('开局不做随手棋误判', () => {
    const s = createInitialState('red');
    const move = generateLegalMoves(s.board, 'red')[0];
    const q = judgeMoveQuality(s, move);
    expect(q.sloppy).toBe(false);
    expect(q.comment).toContain('开局');
  });

  it('杀招扫描：真实残局能识别对手将军威胁并给出破解', () => {
    const puzzle = SHIQINGYAQU[0];
    const state: GameState = {
      board: Board.fromNotationSetup(puzzle.setup),
      turn: 'red', history: [], status: 'playing', moveCount: 0,
    };
    const threats = scanThreats(state, 3);
    expect(threats.length).toBeGreaterThan(0);
    expect(threats.some((t) => t.kind === 'check' || t.kind === 'mate')).toBe(true);
    for (const t of threats) {
      expect(t.description.length).toBeGreaterThan(4);
      expect(t.defenseNote.length).toBeGreaterThan(4);
    }
  });

  it('静态统计读取不抛错', () => {
    const snap = getLessonSnapshot();
    expect(snap).toHaveProperty('blunders');
    expect(snap).toHaveProperty('missedMates');
    expect(snap).toHaveProperty('good');
  });
});

describe('习惯档案（聚类 + 针对性出题）', () => {
  const setup = createInitialState('red').board.toNotationSetup();

  it('旧 lesson kind 仍可 sanitize，新细分 kind 追加接受', () => {
    const raw = [
      { game: 1, ply: 3, side: 'red', kind: 'blunder', notation: '前车进一', drop: 300, setup, at: 1 },
      { game: 2, ply: 4, side: 'black', kind: 'missed-mate', notation: '车进一', drop: 900, setup, at: 2 },
      { game: 3, ply: 5, side: 'red', kind: 'hang-piece', notation: '马进七', drop: 420, setup, at: 3 },
      { game: 4, ply: 6, side: 'red', kind: 'unknown-kind', notation: '乱走', drop: 100, setup, at: 4 },
    ];
    const clean = sanitizeLessons(raw);
    expect(clean.map((l) => l.kind)).toEqual(['blunder', 'missed-mate', 'hang-piece']);
  });

  it('按 kind 聚类，统计次数/平均 drop/近 N 局趋势', () => {
    const lessons: LessonRecord[] = [
      { game: 1, ply: 2, side: 'red', kind: 'hang-piece', notation: 'A', drop: 400, setup, at: 10 },
      { game: 2, ply: 3, side: 'red', kind: 'hang-piece', notation: 'B', drop: 500, setup, at: 20 },
      { game: 3, ply: 4, side: 'red', kind: 'hang-piece', notation: 'C', drop: 600, setup, at: 30 },
      { game: 8, ply: 2, side: 'red', kind: 'missed-mate', notation: 'D', drop: 900, setup, at: 80 },
    ];
    const clusters = clusterLessons(lessons, { recentGames: 3 });
    const hang = clusters.find((c) => c.kind === 'hang-piece');
    expect(hang).toBeDefined();
    expect(hang?.count).toBe(3);
    expect(hang?.avgDrop).toBe(500);
    expect(hang?.recentCount).toBe(0);
    expect(hang?.trend).toBe('down');
    expect(hang?.improving).toBe(true);
    expect(clusters.find((c) => c.kind === 'missed-mate')?.count).toBe(1);
  });

  it('从真实失误 setup 出题，且局面可加载', () => {
    const lesson: LessonRecord = {
      game: 1, ply: 5, side: 'red', kind: 'hang-piece',
      notation: '车八进一', drop: 450, setup, at: 100,
    };
    const drills = pickDrills([lesson], 3);
    expect(drills.length).toBeGreaterThanOrEqual(1);
    expect(drills[0].source).toBe('own-mistake');
    expect(drills[0].setup).toBe(setup);
    expect(drills[0].prompt).toContain('车八进一');
    const restored = loadDrillBoard(drills[0]);
    expect(restored).not.toBeNull();
    expect(restored?.toNotationSetup()).toBe(setup);
  });

  it('真实失误不足时用适情雅趣题库补题，且保留预存正解', () => {
    const drills = pickDrills([], 3);
    expect(drills).toHaveLength(3);
    expect(drills.every((d) => d.source === 'puzzle')).toBe(true);
    for (const drill of drills) {
      expect(isLoadableSetup(drill.setup)).toBe(true);
      expect((solutionForDrill(drill)?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('T1-T8 类型到 lesson.kind 的映射稳定', () => {
    expect(lessonKindFromMistakeType('T1')).toBe('hang-piece');
    expect(lessonKindFromMistakeType('T2')).toBe('missed-mate');
    expect(lessonKindFromMistakeType('T3')).toBe('missed-win');
    expect(lessonKindFromMistakeType('T4')).toBe('slow-develop');
    expect(lessonKindFromMistakeType('T5')).toBe('king-unsafe');
    expect(lessonKindFromMistakeType('T6')).toBe('bad-trade');
    expect(lessonKindFromMistakeType('T7')).toBe('king-unsafe');
    expect(lessonKindFromMistakeType('T8')).toBe('slow-move');
  });
});
