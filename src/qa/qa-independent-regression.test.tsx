/**
 * QA INDEPENDENT regression verification (author: Yan / QA).
 * This file deliberately does NOT import or reuse any of the engineer's new
 * test helpers. It re-derives every assertion from the PRD/bug description.
 *
 * Covers:
 *  A) narrow-screen no-overflow  -> computeCellFromWidth math sweep + REAL
 *     render of <Board> in jsdom with viewport signals overridden (method 2).
 *  B1) 3-red-rook illegal setup rejected at runtime via store.loadPosition().
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { computeCellFromWidth } from '../ui/Board';
import { Board as BoardView } from '../ui/Board';
import { Board as BoardModel, parseSetup } from '../engine/board';
import { validatePosition, validateSetupString } from '../engine/validate';
import { useGameStore } from '../store/gameStore';
import { INITIAL_SETUP } from '../data/puzzles';

/* ------------------------------------------------------------------ *
 * Viewport override helpers (team-lead's sanctioned "method 2").
 * jsdom has no layout engine so documentElement.scrollWidth is always 0;
 * therefore we measure the ACTUAL geometry the app renders (SVG width attr,
 * frame padding, maxWidth/overflowX styles) against the overridden clientWidth.
 * All overrides are restored after each test so singleFork runs stay clean.
 * ------------------------------------------------------------------ */
interface Saved {
  el: Element;
  name: string;
  desc: PropertyDescriptor | undefined;
}
const saved: Saved[] = [];

function forceViewport(width: number): void {
  const win = window as unknown as Record<string, unknown>;
  const docEl = document.documentElement as unknown as Record<string, unknown>;

  const stash = (obj: object, name: string) => {
    const owner = obj as Record<string, unknown>;
    saved.push({ el: obj as Element, name, desc: Object.getOwnPropertyDescriptor(owner, name) });
  };
  stash(win, 'innerWidth');
  stash(docEl, 'clientWidth');
  stash(win, 'visualViewport');

  Object.defineProperty(win, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(docEl, 'clientWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(win, 'visualViewport', {
    configurable: true,
    writable: true,
    value: { width, height: 844, scale: 1, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
  });
}

afterEach(() => {
  // Restore in reverse order.
  while (saved.length) {
    const { el, name, desc } = saved.pop()!;
    const owner = el as unknown as Record<string, unknown>;
    if (desc) Object.defineProperty(owner, name, desc);
    else delete owner[name];
  }
  cleanup();
});

/* ================================================================== *
 * A) NARROW SCREEN
 * ================================================================== */
describe('A1 — computeCellFromWidth exhaustive geometry sweep', () => {
  it('9*cell + 2*renderedFramePad <= width for every realistic viewport 232..1440', () => {
    let worstSlack = Infinity;
    let worstWidth = -1;
    let minPass = -1;
    let maxFail = -1;
    for (let width = 232; width <= 1440; width++) {
      const cell = computeCellFromWidth(width);
      // Board.tsx renders framePad = cell<=36 ? 8 : 14 (the REAL rendered pad).
      const renderedPad = cell <= 36 ? 8 : 14;
      const total = 9 * cell + 2 * renderedPad;
      const slack = width - total;
      if (slack < worstSlack) { worstSlack = slack; worstWidth = width; }
      if (slack >= 0 && minPass < 0) minPass = width;
      if (slack < 0) maxFail = width;
      expect(total, `width=${width} cell=${cell} total=${total}`).toBeLessThanOrEqual(width);
    }
    console.log(`[QA-A1] minPassingWidth=${minPass} maxFailingWidth=${maxFail} worstSlack=${worstSlack}px @ width=${worstWidth}`);
    // Below ~232px the 24px minimum cell legitimately cannot fit; document it.
    expect(minPass).toBeLessThanOrEqual(240);
  });

  it('cell stays within [24,52] and is finite for all widths', () => {
    for (let width = 1; width <= 2000; width++) {
      const c = computeCellFromWidth(width);
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(24);
      expect(c).toBeLessThanOrEqual(52);
    }
    expect(computeCellFromWidth(Number.NaN)).toBe(52);
    expect(computeCellFromWidth(0)).toBe(52);
    expect(computeCellFromWidth(-100)).toBe(52);
  });
});

describe('A2 — REAL <Board> render at forced narrow viewports (defineProperty method)', () => {
  const board = parseSetup(INITIAL_SETUP);

  for (const width of [360, 390, 414]) {
    it(`rendered SVG + frame pad fits ${width}px and page cannot pan horizontally`, () => {
      forceViewport(width);

      const { container } = render(
        <BoardView board={board} selected={null} legalTargets={[]} lastMove={null} hint={null} />
      );

      // Read the geometry the component ACTUALLY rendered into the DOM.
      const svg = container.querySelector('svg') as SVGSVGElement;
      expect(svg, 'board SVG must exist').not.toBeNull();
      const svgWidthAttr = Number(svg.getAttribute('width')); // = 9 * cell
      const cellRendered = svgWidthAttr / 9;

      // The wooden-frame wrapper is the div carrying padding + fit-content.
      const frame = container.querySelector('div[style*="fit-content"]') as HTMLDivElement;
      expect(frame, 'board frame div must exist').not.toBeNull();
      const renderedPad = parseFloat(frame.style.padding);
      const boardTotal = svgWidthAttr + 2 * renderedPad;

      // Defense in depth: hard clamps must be present in the rendered styles.
      expect(frame.style.maxWidth).toBe('100%');
      expect(frame.style.overflowX).toBe('hidden');
      expect(frame.style.boxSizing).toBe('border-box');
      expect(svg.style.maxWidth).toBe('100%');

      console.log(
        `[QA-A2 width=${width}] innerWidth=${window.innerWidth} ` +
        `clientWidth=${document.documentElement.clientWidth} ` +
        `visualViewport.width=${window.visualViewport!.width} ` +
        `cell=${cellRendered} svgWidth=${svgWidthAttr} framePad=${renderedPad} ` +
        `boardTotal=${boardTotal} scrollWidth<=clientWidth: ${boardTotal <= width}`
      );

      expect(cellRendered).toBe(computeCellFromWidth(width));
      expect(cellRendered).toBeGreaterThanOrEqual(24);
      expect(cellRendered).toBeLessThanOrEqual(52);
      expect(boardTotal).toBeLessThanOrEqual(width); // no horizontal overflow
      expect(boardTotal).toBeLessThanOrEqual(document.documentElement.clientWidth);
    });
  }
});

/* ================================================================== *
 * B1) 3-ROOK ILLEGAL SETUP REJECTED AT RUNTIME (independent string)
 * ================================================================== */
const E = '.,.,.,.,.,.,.,.,.';
const THREE_ROOKS = [
  'R,.,.,K,.,.,.,.,R', // red rooks (0,0) & (8,0), red king (3,0) inside palace
  E, E, E, E, E, E, E,
  '.,R,.,.,.,.,.,.,.', // THIRD red rook (1,8) -> C4 violation
  '.,.,.,.,k,.,.,.,.', // black king (4,9) inside its palace, no facing kings
].join('/');

describe('B1 — independent 3-red-rook runtime rejection', () => {
  it('rejects, reports setupError, and leaves the live board byte-identical', () => {
    useGameStore.getState().newGame();
    const before = useGameStore.getState();
    const beforeSerial = before.game.board.toNotationSetup();
    const beforeRef = before.game.board;

    // Sanity: the string is structurally valid, but the position is illegal.
    expect(validateSetupString(THREE_ROOKS)).toEqual([]);
    const vr = validatePosition(BoardModel.fromNotationSetup(THREE_ROOKS), 'red');
    expect(vr.valid).toBe(false);
    expect(vr.errors.join(' ')).toMatch(/红方车 3 枚，超过上限 2/);

    const ret = useGameStore.getState().loadPosition(THREE_ROOKS);
    const after = useGameStore.getState();

    console.log(`[QA-B1] loadPosition returned ${ret}; setupError="${after.setupError}"; ` +
      `boardUnchanged(ref)=${after.game.board === beforeRef}; ` +
      `boardUnchanged(serial)=${after.game.board.toNotationSetup() === beforeSerial}`);

    expect(ret).toBe(false);
    expect(after.setupError).toBeTruthy();
    expect(after.setupError).toContain('C4');
    expect(after.game.board).toBe(beforeRef);              // same object -> untouched
    expect(after.game.board.toNotationSetup()).toBe(beforeSerial);
  });

  it('loadPuzzle alias also rejects the same illegal setup', () => {
    useGameStore.getState().newGame();
    expect(useGameStore.getState().loadPuzzle(THREE_ROOKS)).toBe(false);
    expect(useGameStore.getState().setupError).toContain('C4');
  });

  it('a legal setup still loads through loadPosition', () => {
    useGameStore.getState().newGame();
    expect(useGameStore.getState().loadPosition(INITIAL_SETUP)).toBe(true);
    expect(useGameStore.getState().setupError).toBeNull();
  });
});
