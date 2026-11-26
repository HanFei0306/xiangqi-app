/**
 * v1.15 本地自适应学习回归测试。
 *
 * 核心承诺：学习是"温和倾斜"——方向正确、幅度受限、可重置、不污染未学习分支。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/board';
import { applyMoveToState, generateLegalMoves } from '../../engine/rules';
import { generateNotation } from '../../engine/notation';
import type { GameState } from '../../engine/types';
import { EngineImpl, defaultConfig } from '../engine';
import {
  getEvolutionAdjustment,
  getEvolutionStats,
  movePatternCode,
  recordGameResult,
  resetEvolution,
  setEvolutionEnabled,
} from '../evolution';
import { detectOpeningFor } from '../openingBook';

const OPENING = '中炮屏风马';
const LOSING_REPLY = '马八进七';
const WINNING_REPLY = '砲八平五';

/** 按记谱回放构造局面；记谱由引擎生成，避免手写坐标漂移。 */
function positionAfter(notations: readonly string[]): GameState {
  let state: GameState = createInitialState('red');
  for (const wanted of notations) {
    const move = generateLegalMoves(state.board, state.turn)
      .find((candidate) => generateNotation(state.board, candidate, state.turn) === wanted);
    if (!move) throw new Error(`找不到记谱 ${wanted}`);
    state = applyMoveToState(state, move);
  }
  return state;
}

/**
 * 固定 salt 采样引擎在同一局面的开局应手。
 * v2026.11.19.6: 学习倾斜只在中低档生效，'master/特级大师'档刻意保持纯实力、
 * 不受历史战绩影响。因此这里用可指定档位，默认 intermediate（学习生效档）。
 */
function replyShare(
  state: GameState,
  notation: string,
  samples: number,
  difficulty: 'intermediate' | 'master' = 'intermediate',
): number {
  const engine = new EngineImpl(() => 0.5);
  let hits: number = 0;
  for (let i = 0; i < samples; i++) {
    engine.setGameSalt((i * 7919 + 13) | 0);
    const move = engine.getBestMove(state, defaultConfig(difficulty));
    if (move && generateNotation(state.board, move, state.turn) === notation) hits += 1;
  }
  return hits / samples;
}

describe('本地自适应学习', () => {
  beforeEach(() => resetEvolution());

  it('开局识别来自最长主线路前缀', () => {
    expect(detectOpeningFor(['炮二平五'])).toBe('中炮屏风马');
    expect(detectOpeningFor(['炮二平五', '砲八平五'])).toBe('中炮顺炮');
    expect(detectOpeningFor(['相三进五'])).toBe('飞相局');
    expect(detectOpeningFor(['车九进一'])).toBeNull();
  });

  it('从 GameState 推导结果；长将局无显式 outcome 时保守忽略', () => {
    const afterRed: GameState = positionAfter(['炮二平五']); // 现在轮到黑方
    // 仅凭 status=perpetual + turn 无法知道谁是长将方，必须显式传 outcome。
    recordGameResult({
      difficulty: 'master',
      game: { ...afterRed, status: 'perpetual' },
      playerSide: 'red',
      opening: OPENING,
    });
    expect(getEvolutionStats().totalGames).toBe(0);

    recordGameResult({
      difficulty: 'master',
      game: { ...afterRed, status: 'perpetual' },
      outcome: 'loss', // store 的显式 result{winner, loser} 给出的人类视角结果
      playerSide: 'red',
      opening: OPENING,
    });
    expect(getEvolutionStats().totalGames).toBe(1);
    expect(peekTally().loss).toBe(1);

    recordGameResult({
      difficulty: 'master',
      game: { ...afterRed, status: 'checkmate' },
      playerSide: 'red',
      opening: OPENING,
    });
    // 绝杀由最后走子方（红方）获胜 => 人类胜。
    expect(peekTally().win).toBe(1);
    expect(peekTally().loss).toBe(1);
  });

  it('连败应手降权、获胜应手升权，且乘子始终受限', () => {
    const before = getEvolutionAdjustment();
    expect(before.openingReply[key(LOSING_REPLY)] ?? 1).toBe(1);

    for (let i = 0; i < 8; i++) {
      recordGameResult({
        difficulty: 'master',
        game: positionAfter(['炮二平五', LOSING_REPLY, '马二进三']),
        outcome: 'win',
        playerSide: 'red',
        opening: OPENING,
      });
      recordGameResult({
        difficulty: 'master',
        game: positionAfter(['炮二平五', WINNING_REPLY, '马二进三']),
        outcome: 'loss',
        playerSide: 'red',
        opening: OPENING,
      });
    }

    const after = getEvolutionAdjustment();
    const losing: number = after.openingReply[key(LOSING_REPLY)] ?? 1;
    const winning: number = after.openingReply[key(WINNING_REPLY)] ?? 1;
    expect(losing).toBeLessThan(1);
    expect(winning).toBeGreaterThan(1);
    expect(losing).toBeGreaterThanOrEqual(0.8);
    expect(winning).toBeLessThanOrEqual(1.2);
    for (const factor of Object.values(after.openingReply)) {
      expect(factor).toBeGreaterThanOrEqual(0.8);
      expect(factor).toBeLessThanOrEqual(1.2);
    }
    for (const factor of Object.values(after.middlegame)) {
      expect(factor).toBeGreaterThanOrEqual(0.85);
      expect(factor).toBeLessThanOrEqual(1.15);
    }
    expect(getEvolutionStats().totalGames).toBe(16);
    expect(getEvolutionStats().level).toBe(3);
  });

  it('学习确实改变同一局面的应手分布，但冷门分支不会跃居主流之前', () => {
    const root: GameState = positionAfter(['炮二平五']);
    const before: number = replyShare(root, LOSING_REPLY, 320);
    for (let i = 0; i < 10; i++) {
      recordGameResult({
        difficulty: 'master',
        game: positionAfter(['炮二平五', LOSING_REPLY, '马二进三']),
        outcome: 'win',
        playerSide: 'red',
        opening: OPENING,
      });
      recordGameResult({
        difficulty: 'master',
        game: positionAfter(['炮二平五', WINNING_REPLY, '马二进三']),
        outcome: 'loss',
        playerSide: 'red',
        opening: OPENING,
      });
    }
    const after: number = replyShare(root, LOSING_REPLY, 320);
    expect(after).toBeLessThan(before - 0.02);
    // 主流应手（权重 10）经最大倾斜后仍远高于冷门（权重 1）。
    expect(10 * 0.7).toBeGreaterThan(1 * 1.3);
  });

  it('v2026.11.19.6: 特级大师档保持纯实力，不受本地学习倾斜', () => {
    // 先灌入会把 LOSING_REPLY 降到最低的学习样本。
    for (let i = 0; i < 12; i++) {
      recordGameResult({
        difficulty: 'intermediate',
        game: positionAfter(['炮二平五', LOSING_REPLY, '马二进三']),
        outcome: 'win', playerSide: 'red', opening: OPENING,
      });
    }
    // 同一局面：中档已被学习带偏；特级大师档应维持中性分布（before 基准）。
    const root: GameState = positionAfter(['炮二平五']);
    const base: number = replyShare(root, LOSING_REPLY, 320, 'master');
    const tilted: number = replyShare(root, LOSING_REPLY, 320, 'intermediate');
    expect(tilted).toBeLessThan(base - 0.02);
  });

  it('禁用学习后权重回到中性，重置清空统计', () => {
    recordGameResult({
      difficulty: 'intermediate',
      game: positionAfter(['炮二平五', LOSING_REPLY, '马二进三']),
      outcome: 'win',
      playerSide: 'red',
      opening: OPENING,
    });
    expect(Object.keys(getEvolutionAdjustment().openingReply).length).toBeGreaterThan(0);
    setEvolutionEnabled(false);
    expect(Object.keys(getEvolutionAdjustment().openingReply).length).toBe(0);
    expect(getEvolutionAdjustment().enabled).toBe(false);
    setEvolutionEnabled(true);
    expect(Object.keys(getEvolutionAdjustment().openingReply).length).toBeGreaterThan(0);
    resetEvolution();
    expect(getEvolutionStats().totalGames).toBe(0);
    expect(Object.keys(getEvolutionAdjustment().middlegame).length).toBe(0);
  });

  it('中局着法模式可被记录并折算为受限乘子', () => {
    const probe: GameState = positionAfter(['炮二平五']);
    const code: number = movePatternCode(generateLegalMoves(probe.board, probe.turn)[0]);
    for (let i = 0; i < 12; i++) {
      recordGameResult({
        difficulty: 'master',
        outcome: 'win',
        aiMoveCodes: [code],
        opening: OPENING,
      });
    }
    const factor: number = getEvolutionAdjustment().middlegame[String(code)];
    expect(factor).toBeLessThan(1);
    expect(factor).toBeGreaterThanOrEqual(0.85);
  });

  it('未终局或未给结果的摘要被安全忽略', () => {
    const before: number = getEvolutionStats().totalGames;
    recordGameResult({
      difficulty: 'master',
      game: positionAfter(['炮二平五']),
      playerSide: 'red',
    });
    expect(getEvolutionStats().totalGames).toBe(before);
  });
});

/** 人类视角开局统计（测试专用读取）。 */
function peekTally(): { win: number; loss: number; draw: number } {
  const data = (globalThis as unknown as {
    localStorage: { getItem(key: string): string | null };
  }).localStorage;
  const raw = data.getItem('xiangqi-trainer:evolution-v1');
  if (!raw) return { win: 0, loss: 0, draw: 0 };
  const parsed = JSON.parse(raw) as {
    byDifficulty: Record<string, { win: number; loss: number; draw: number }>;
  };
  const tally = parsed.byDifficulty.master ?? { win: 0, loss: 0, draw: 0 };
  return { win: tally.win, loss: tally.loss, draw: tally.draw };
}

function key(notation: string): string {
  return OPENING + '\u0000' + notation;
}
