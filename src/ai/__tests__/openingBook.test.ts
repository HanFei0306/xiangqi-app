import { describe, it, expect } from 'vitest';
import {
  BOOK_LINES,
  MAX_BOOK_PLY,
  bookMoveFor,
  bookRepliesFor,
  inBookPhase,
  normalizeNotation,
} from '../openingBook';

describe('prefix opening book', () => {
  it('suggests a development move after an off-book human move', () => {
    expect(bookMoveFor(['炮二平五', '车九进一'])).not.toBeNull();
    expect(bookMoveFor(['炮二平五', '车九进一'])).toBe('马八进七');
  });

  it('merges same-prefix lines into multiple weighted candidates', () => {
    expect(bookRepliesFor(['炮二平五'])).toEqual(['马八进七', '砲八平五']);
    expect(bookMoveFor(['炮二平五'])).toBe('马八进七');
  });

  it('uses the longest known prefix', () => {
    const line = BOOK_LINES[1];
    expect(bookMoveFor(line.moves.slice(0, 5))).toBe(line.moves[5]);
    // At the end of a line the deepest prefix repeats its last move; the
    // engine rejects it as illegal once that move has actually been played.
    expect(bookMoveFor(line.moves)).toBe(line.moves[line.moves.length - 1]);
    expect(inBookPhase(line.moves.slice(0, 5))).toBe(true);
  });

  it('stops after the book horizon and normalises digits only', () => {
    expect(bookMoveFor(Array(MAX_BOOK_PLY + 2).fill('炮二平五'))).toBeNull();
    expect(normalizeNotation('炮８平５')).toBe('炮八平五');
    expect(normalizeNotation('砲８平５')).toBe('砲八平五');
    expect(normalizeNotation('砲８平５')).not.toBe(normalizeNotation('炮８平５'));
  });

  it('covers six systems of 15+ plies with the black 砲 glyph', () => {
    expect(BOOK_LINES.length).toBeGreaterThanOrEqual(5);
    for (const line of BOOK_LINES) {
      expect(line.moves.length).toBeGreaterThanOrEqual(15);
      expect(line.moves.length).toBeLessThanOrEqual(20);
      expect(line.weight).toBeGreaterThan(0);
      expect(line.moves.some((m) => m.startsWith('砲'))).toBe(true);
    }
  });
});
