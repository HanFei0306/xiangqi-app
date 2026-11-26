/**
 * Opening book (v2026.11.19.1): prefix Trie + longest-prefix fallback.
 *
 * The old book matched only exact histories, so one sensible human move off
 * the main line ("车九进一") dropped straight into search. Now every ply of
 * every system creates a prefix node with the possible next moves; a history
 * that leaves the main line still receives the best developed continuation
 * for the deepest known prefix. Same-prefix lines merge into MULTIPLE weighted
 * candidates (no more "first matching entry wins" dead code).
 *
 * All moves below were generated with `generateLegalMoves` + `generateNotation`
 * from the initial position (verified by `book-lines.test.ts`). Black cannon
 * glyph is 砲, never 炮 — `normalizeNotation` intentionally does not fold the
 * two glyphs, and the old 炮８平５ silently fell out of the book.
 *
 * v2026.11.23.4: `openingBookReply` at the bottom of this file is the single
 * book DECISION implementation shared by the self engine and the native
 * Pikafish wrapper. Both paths must drift together or the native engine would
 * silently lose its opening shortcut.
 */

import type { Board } from '../engine/board';
import type { GameState, Move, Side } from '../engine/types';
import { generateLegalMoves } from '../engine/rules';
import { generateNotation } from '../engine/notation';
import { positionKeyOf } from './search';
import { decisionRoll, pickWeighted } from './variety';
import type { EvolutionAdjustment } from './evolution';

export type BookSystem =
  | '中炮屏风马'
  | '中炮顺炮'
  | '飞相局'
  | '仙人指路'
  | '过宫炮'
  | '起马局';

export interface BookLine {
  readonly system: BookSystem;
  /** 15~17 plies from the initial position, generated notation verbatim. */
  readonly moves: readonly string[];
  /** Main line 10, common branch 5, rare branch 1. */
  readonly weight: number;
}

export interface BookReply {
  readonly notation: string;
  /** Mutable during Trie construction: duplicate replies keep the max weight. */
  weight: number;
}

export interface BookNode {
  /** Candidate replies for the side to move at this prefix, weight descending. */
  replies: BookReply[];
  children: Map<string, BookNode>;
}

/** Six mainstream systems, 15~17 plies each. */
export const BOOK_LINES: readonly BookLine[] = [
  {
    system: '中炮屏风马', weight: 10,
    moves: [
      '炮二平五', '马八进七', '马二进三', '车九平八', '车一平二', '马二进三',
      '兵七进一', '卒七进一', '车二进六', '砲八平九', '车二平三', '砲九退一',
      '马八进七', '士四进五', '炮八平九', '车一平二', '车九平八',
    ],
  },
  {
    system: '中炮顺炮', weight: 10,
    moves: [
      '炮二平五', '砲八平五', '马二进三', '马八进七', '车一平二', '车九进一',
      '马八进七', '车九平六', '兵三进一', '马二进三', '兵七进一', '车一进一',
      '相七进九', '卒三进一', '车二进五',
    ],
  },
  {
    system: '飞相局', weight: 8,
    moves: [
      '相三进五', '砲八平五', '马二进三', '马八进七', '车一平二', '车九平八',
      '兵三进一', '卒七进一', '马八进七', '马二进三', '炮八进四', '卒三进一',
      '兵七进一', '车一进一', '车九进一', '马七进六',
    ],
  },
  {
    system: '仙人指路', weight: 8,
    moves: [
      '兵七进一', '砲二平三', '炮二平五', '象三进五', '马二进三', '车九进一',
      '车一平二', '车九平六', '马八进七', '马八进九', '兵三进一', '车六进四',
      '相七进九', '砲三平四', '车二进六',
    ],
  },
  {
    system: '过宫炮', weight: 5,
    moves: [
      '炮二平六', '马八进七', '马二进三', '车九平八', '车一平二', '砲八进四',
      '兵三进一', '卒七进一', '马八进七', '马二进三', '相七进五', '象三进五',
      '仕六进五', '车一平二', '兵七进一',
    ],
  },
  {
    system: '起马局', weight: 5,
    moves: [
      '马八进七', '卒三进一', '兵三进一', '马二进三', '马二进三', '砲八平五',
      '相七进五', '车九进一', '车一平二', '卒七进一', '兵七进一', '马八进七',
      '炮八进四', '车九平六', '炮八平六',
    ],
  },
];

/** Longest history the book will consider (AI keeps searching past this). */
export const MAX_BOOK_PLY = 20;
/** Invisible separator: a notation can never contain U+0001, so keys are safe. */
const SEP = '\u0001';

/** Normalises digits only; 炮 / 砲 are deliberately kept distinct. */
export function normalizeNotation(text: string): string {
  const map: Record<string, string> = {
    '0': '零', '1': '一', '2': '二', '3': '三', '4': '四',
    '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
    '０': '零', '１': '一', '２': '二', '３': '三', '４': '四',
    '５': '五', '６': '六', '７': '七', '８': '八', '９': '九',
  };
  return Array.from(text.trim()).map((ch) => map[ch] ?? ch).join('');
}

function makeNode(): BookNode {
  return { replies: [], children: new Map<string, BookNode>() };
}

/** All prefix nodes keyed by the normalised history joined with SEP. */
export const PREFIX: Map<string, BookNode> = new Map<string, BookNode>();

(function buildPrefixTrie(): void {
  for (const line of BOOK_LINES) {
    const moves: string[] = line.moves.map(normalizeNotation);
    for (let i = 0; i < moves.length; i++) {
      const key: string = moves.slice(0, i).join(SEP);
      let node: BookNode | undefined = PREFIX.get(key);
      if (!node) {
        node = makeNode();
        PREFIX.set(key, node);
      }
      const notation: string = moves[i];
      const existing: BookReply | undefined = node.replies.find((r) => r.notation === notation);
      if (existing) {
        if (line.weight > existing.weight) existing.weight = line.weight;
      } else {
        node.replies.push({ notation, weight: line.weight });
      }
      node.replies.sort((a, b) => b.weight - a.weight);
    }
  }
})();

/**
 * v2026.11.19.6: whether the whole history is still on a known main line.
 *
 * The old longest-prefix fallback had a serious flaw: after the human played
 * ONE off-book move, the engine still returned the reply belonging to the
 * *deepest known prefix* — a move crafted for a DIFFERENT position. Applied
 * blindly (bookMove returns it without searching) this produced the "weird
 * / invalid moves" the user reported. We now tell the engine whether a book
 * reply is on-line (trust it) or a fallback (must pass a tactical gate).
 */
export function isOnMainLine(history: readonly string[]): boolean {
  const normal: string[] = history.map(normalizeNotation);
  return PREFIX.has(normal.join(SEP));
}

/**
 * Weighted book replies for a history, longest known prefix first. The caller
 * validates legality and may try the next candidate if the first is illegal.
 * The weight is preserved so the engine can vary its openings without ever
 * promoting a rare branch above a mainstream one.
 */
export function bookRepliesWithWeightsFor(history: readonly string[]): BookReply[] {
  if (history.length > MAX_BOOK_PLY + 1) return [];
  const normal: string[] = history.map(normalizeNotation);
  // Never fall back to the ROOT node once a move has been played: its replies
  // are first moves, which are usually STILL legal and would make the book
  // overwrite any human opener instead of letting the search evaluate it.
  // Prefixes of length >= 1 are genuine development suggestions.
  const minLength: number = normal.length === 0 ? 0 : 1;
  for (let length = Math.min(normal.length, MAX_BOOK_PLY); length >= minLength; length--) {
    const node: BookNode | undefined = PREFIX.get(normal.slice(0, length).join(SEP));
    if (node) return node.replies.slice();
  }
  return [];
}

/**
 * All book replies for a history (notation only) — legacy API kept intact for
 * diagnostics and tests that do not need the weights.
 */
export function bookRepliesFor(history: readonly string[]): string[] {
  return bookRepliesWithWeightsFor(history).map((reply) => reply.notation);
}

/**
 * Identifies the opening system by the longest matching main-line prefix.
 * Shared prefixes (e.g. 炮二平五) are resolved by book weight, so the result
 * is deterministic and never needs a fuzzy string match against Chinese names.
 * Returns null when none of the first moves matches a known line.
 */
export function detectOpeningFor(history: readonly string[]): BookSystem | null {
  const normal: string[] = history.map(normalizeNotation);
  let bestSystem: BookSystem | null = null;
  let bestMatched: number = 0;
  let bestWeight: number = -1;
  for (const line of BOOK_LINES) {
    let matched: number = 0;
    while (
      matched < normal.length
      && matched < line.moves.length
      && normal[matched] === line.moves[matched]
    ) {
      matched += 1;
    }
    if (matched === 0) continue;
    if (matched > bestMatched || (matched === bestMatched && line.weight > bestWeight)) {
      bestSystem = line.system;
      bestMatched = matched;
      bestWeight = line.weight;
    }
  }
  return bestSystem;
}

/** Best book reply for a history, or null when completely out of book. */
export function bookMoveFor(history: readonly string[]): string | null {
  const replies: string[] = bookRepliesFor(history);
  return replies.length > 0 ? replies[0] : null;
}

/** True while the position may still be guided by the book. */
export function inBookPhase(history: readonly string[]): boolean {
  return history.length <= MAX_BOOK_PLY && bookRepliesFor(history).length > 0;
}

/** Optional policy for the shared book decision. Defaults keep pure book weights. */
export interface OpeningBookOptions {
  /** Deterministic per-game branch salt. 0 = fixed main line. */
  readonly salt?: number;
  /** Mild local-learning tilt. Omit for pure (strength-preserving) weights. */
  readonly adjustment?: EvolutionAdjustment | null;
}

/**
 * Shared opening-book DECISION — the one implementation used by BOTH the self
 * engine (`EngineImpl.bookMove`) and the native Pikafish wrapper
 * (`AncientBookEngine`). Keeping a single copy is what prevents the two paths
 * from drifting: the native engine only skips its 14s master search when this
 * function says the position is a known, legal main-line opening.
 *
 * Pure: no storage, no randomness, no side effects. The same history + board
 * + turn + policy always yields the same move (or null).
 *
 * Note on the signature: legality CANNOT be checked from history alone — a
 * custom full-material setup has an empty history too. The board and side to
 * move are therefore explicit inputs, and every returned move is validated
 * with `generateLegalMoves` before it is handed back to the store.
 */
export function openingBookReply(
  history: readonly Move[],
  board: Board,
  turn: Side,
  options: OpeningBookOptions = {},
): Move | null {
  // Gate 1: historical moves carry their notation when produced by the store.
  // A missing one means we cannot know whether the history is a known line.
  const notations: readonly string[] = history.map((move) => move.notation);
  if (notations.some((notation) => !notation)) return null;

  // Gate 2: the book is for the opening position ONLY. A custom/endgame setup
  // also has an empty history; without the near-full material guard its root
  // first move would be recited blindly on a tactical puzzle.
  const setup: string = board.toNotationSetup();
  const pieceCount: number = setup.length === 0 ? 0 : setup.split(';').length;
  if (pieceCount < 24) return null;

  // Gate 3: on a known main line and within the book horizon. Any deviation
  // hands the position to the real search, which evaluates actual tactics.
  if (notations.length > MAX_BOOK_PLY || !isOnMainLine(notations)) return null;

  const allReplies: BookReply[] = bookRepliesWithWeightsFor(notations);
  if (allReplies.length === 0) return null;
  // Keep the first move active: an early 相/仕/帅 reply fails the QA self-play
  // guard. Later book lines (including 飞相局) stay fully available.
  const passiveStarter = (notation: string): boolean =>
    notation.length > 0 && '相象仕士帅将'.includes(notation.charAt(0));
  const filtered: BookReply[] = notations.length === 0
    ? allReplies.filter((reply) => !passiveStarter(reply.notation))
    : allReplies;
  const replies: BookReply[] = filtered.length > 0 ? filtered : allReplies;

  const legal: Move[] = generateLegalMoves(board, turn);
  const salt: number = typeof options.salt === 'number' ? options.salt : 0;
  const key: number = positionKeyOf(board, turn);
  const roll: number = decisionRoll(salt, key, 0x424f4f4b); // "BOOK"
  const adjustment: EvolutionAdjustment | null = options.adjustment ?? null;
  const opening: string = detectOpeningFor(notations) ?? '未识别开局';
  const pressure: number = adjustment ? (adjustment.openingPressure[opening] ?? 0) : 0;
  const weights: number[] = replies.map((reply) => {
    const replyKey: string = opening + '\u0000' + normalizeNotation(reply.notation);
    const factor: number = adjustment ? (adjustment.openingReply[replyKey] ?? 1) : 1;
    // 0.8~1.2 style tilts can never promote a rare branch above a mainstream one.
    const tilt: number = 1 + (factor - 1) * (1 + pressure * 0.5);
    return Math.max(0.001, reply.weight * tilt);
  });
  const first: number = pickWeighted(weights, roll);
  if (first < 0) return null;
  for (let k = 0; k < replies.length; k++) {
    const wanted: string = replies[(first + k) % replies.length].notation;
    const found: Move | undefined = legal.find(
      (move) => generateNotation(board, move, turn) === wanted,
    );
    if (found) return found;
  }
  return null;
}

/** State-based convenience wrapper for callers that already hold a GameState. */
export function openingBookReplyForState(
  state: GameState,
  options: OpeningBookOptions = {},
): Move | null {
  return openingBookReply(state.history, state.board, state.turn, options);
}
