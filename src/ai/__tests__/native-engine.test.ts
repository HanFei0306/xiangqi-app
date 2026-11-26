import { describe, it, expect, vi, afterEach } from 'vitest';
import { createInitialState } from '../../engine/board';
import { makeMove, applyMoveToState } from '../../engine/rules';
import { boardToFen, moveToUci, nativeEngineAvailable, PikafishEngine } from '../nativeEngine';
import { activeEngine } from '../activeEngine';
import { engine as selfEngine } from '../engine';

const nativeGlobal = window as unknown as {
  XiangqiNative?: {
    pikafish?: (r: string) => string;
    pikafishAsync?: (r: string, id: string) => void;
    status?: () => string;
  };
  __pikafishResolve?: (id: string, raw: string) => void;
};

const START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

describe('native engine adapter (pikafish-nc)', () => {
  it('converts the initial board to Pikafish UCI FEN', () => {
    const state = createInitialState('red');
    expect(boardToFen(state.board, state.turn)).toBe(START_FEN);
  });

  it('converts moves to a-i / 0-9 UCI coordinates', () => {
    const state = createInitialState('red');
    const move = makeMove(state.board, { col: 0, row: 3 }, { col: 0, row: 4 })!;
    expect(moveToUci(move)).toBe('a3a4');
    const after = applyMoveToState(state, move);
    expect(boardToFen(after.board, after.turn)).not.toContain(' w - - ');
  });

  it('defaults to the proven self engine when no native bridge exists', () => {
    expect(nativeEngineAvailable()).toBe(false);
    expect(activeEngine).toBe(selfEngine);
  });

  describe('v2026.11.23.1 true-async native search', () => {
    afterEach(() => {
      delete nativeGlobal.XiangqiNative;
      delete nativeGlobal.__pikafishResolve;
      vi.useRealTimers();
    });

    it('engine becomes available when bridge reports PIKAFISH_NC_READY', () => {
      nativeGlobal.XiangqiNative = {
        status: () => 'PIKAFISH_NC_READY',
        pikafishAsync: () => {},
      };
      expect(nativeEngineAvailable()).toBe(true);
    });

    it('async search resolves the legal move via the native callback', async () => {
      let capturedRequest = '';
      let capturedId = '';
      nativeGlobal.XiangqiNative = {
        status: () => 'PIKAFISH_NC_READY',
        pikafishAsync: (request, id) => {
          capturedRequest = request;
          capturedId = id;
          // Simulate the Java side replying on a later tick (background thread).
          setTimeout(() => nativeGlobal.__pikafishResolve!(id, 'bestmove a3a4'), 0);
        },
      };
      const engine = new PikafishEngine();
      const state = createInitialState('red');
      const move = await engine.getBestMoveAsync(state, { difficulty: 'intermediate' } as never);
      expect(move).not.toBeNull();
      expect(moveToUci(move!)).toBe('a3a4');
      expect(capturedRequest).toContain('fen ');
      expect(capturedId).toMatch(/^pikafish-/);
    });

    it('async search falls back to null on bridge timeout instead of hanging', async () => {
      vi.useFakeTimers();
      nativeGlobal.XiangqiNative = {
        status: () => 'PIKAFISH_NC_READY',
        pikafishAsync: () => { /* never calls back */ },
      };
      const engine = new PikafishEngine();
      const state = createInitialState('red');
      const promise = engine.getBestMoveAsync(state, { difficulty: 'intermediate' } as never);
      await vi.advanceTimersByTimeAsync(30000);
      expect(await promise).toBeNull();
    });
  });
});
