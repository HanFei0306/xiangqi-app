/**
 * Post-game self review (v2026.11.21.1).
 *
 * Looks for the two things a player actually feels: missed mates and moves
 * that threw away a horse or more. Results are stored locally and shown in
 * the settings panel; future versions will use them to prioritise training
 * and weight tuning. It never changes a game already in progress.
 */
import type { GameState, Move, Side } from '../engine/types';
import { createInitialState } from '../engine/board';
import { applyMoveToState, generateLegalMoves } from '../engine/rules';
import { evaluateState } from '../ai/evaluate';
import { findMateInOne } from '../ai/mate';
import {
  appendLessons,
  clearLessons,
  loadLessons,
  type LessonKind,
  type LessonRecord,
} from '../data/lesson-storage';

const MAX_REVIEW_PLY = 48;
const MAX_LESSONS_PER_GAME = 4;
const BLUNDER_CP = 250;
const GOOD_CP = 30;

export interface LessonStats {
  blunders: number;
  missedMates: number;
  good: number;
  recent: LessonRecord[];
}

export interface ReviewResult {
  lessons: LessonRecord[];
  blunders: number;
  missedMates: number;
  good: number;
}

function initialBoard() {
  return createInitialState('red').board;
}

function replayTo(history: readonly Move[], ply: number) {
  let board = initialBoard();
  for (let i = 0; i < ply; i++) {
    board = board.clone();
    board.applyMove({ ...history[i] });
  }
  return board;
}

function stateAt(board: ReturnType<typeof initialBoard>, turn: Side, ply: number): GameState {
  return { board, turn, history: [], status: 'playing', moveCount: ply };
}

function bestAlternative(before: GameState, chosen: Move): { score: number; move: Move | null } {
  const moves = generateLegalMoves(before.board, before.turn);
  let best = -Infinity;
  let bestMove: Move | null = null;
  for (const move of moves) {
    const after = applyMoveToState(before, move);
    const score = evaluateState(after, before.turn, 'full');
    if (score > best) { best = score; bestMove = move; }
  }
  const actualAfter = applyMoveToState(before, chosen);
  const actual = evaluateState(actualAfter, before.turn, 'full');
  return { score: best - actual, move: bestMove };
}

/** Reviews a finished standard game and appends at most four lessons. */
export function analyzeGameForLessons(game: GameState, playerSide: Side): ReviewResult {
  const empty: ReviewResult = { lessons: [], blunders: 0, missedMates: 0, good: 0 };
  if (game.history.length === 0) return empty;

  const gameNo = loadLessons().length + 1;
  const aiSide: Side = playerSide === 'red' ? 'black' : 'red';
  const found: LessonRecord[] = [];
  const limit = Math.min(MAX_REVIEW_PLY, game.history.length);
  for (let ply = 0; ply < limit; ply++) {
    const mover: Side = ply % 2 === 0 ? 'red' : 'black';
    const board = replayTo(game.history, ply);
    const before = stateAt(board, mover, ply);
    const chosen = game.history[ply];
    const setup = board.toNotationSetup();

    const kill = findMateInOne(before, mover);
    if (kill) {
      const after = applyMoveToState(before, chosen);
      const mated = after.status === 'checkmate' || after.status === 'stalemate';
      if (!mated) {
        found.push({
          game: gameNo, ply, side: mover, kind: 'missed-mate',
          notation: chosen.notation, drop: 900, setup, at: Date.now(),
        });
        continue;
      }
    }

    const delta = bestAlternative(before, chosen).score;
    let kind: LessonKind | null = null;
    if (delta > BLUNDER_CP) kind = 'blunder';
    else if (delta < GOOD_CP && evaluateState(applyMoveToState(before, chosen), mover, 'full') > 300) {
      kind = 'good';
    }
    if (kind === null) continue;
    found.push({
      game: gameNo, ply, side: mover, kind,
      notation: chosen.notation, drop: Math.round(delta), setup, at: Date.now(),
    });
  }

  // Keep the most instructive few, deterministic by severity then earliest ply.
  found.sort((a, b) => {
    const rank = (k: LessonKind) => k === 'missed-mate' ? 2 : k === 'blunder' ? 1 : 0;
    const aAi = a.side === aiSide ? 0 : 1;
    const bAi = b.side === aiSide ? 0 : 1;
    return rank(b.kind) - rank(a.kind) || b.drop - a.drop || aAi - bAi || a.ply - b.ply;
  });
  const kept = found.slice(0, MAX_LESSONS_PER_GAME);
  if (kept.length > 0) appendLessons(kept);
  return {
    lessons: kept,
    blunders: kept.filter((l) => l.kind === 'blunder').length,
    missedMates: kept.filter((l) => l.kind === 'missed-mate').length,
    good: kept.filter((l) => l.kind === 'good').length,
  };
}

export function getLessonStats(): LessonStats {
  const all = loadLessons();
  return {
    blunders: all.filter((l) => l.kind === 'blunder').length,
    missedMates: all.filter((l) => l.kind === 'missed-mate').length,
    good: all.filter((l) => l.kind === 'good').length,
    recent: all.slice(0, 3),
  };
}

export function resetLessons(): void { clearLessons(); }
