/**
 * Engine selector. v2026.11.23.1: on pikafish-nc builds the real native engine
 * (loaded and NNUE-initialised) is selected automatically — it is much stronger
 * than the self engine (SPRT 8:0). The self engine remains the fallback when no
 * native bridge is present (desktop, tests, self builds).
 */
import type { GameState, Move, Side } from '../engine/types';
import type { AIConfig, Engine } from './types';
import { ancientBookMove } from './ancientBook';
import { engine as selfEngine } from './engine';
import { openingBookReplyForState } from './openingBook';
import { nativeEngineAvailable, PikafishEngine } from './nativeEngine';

function useNative(): boolean {
  if (typeof window === 'undefined') return false;
  return nativeEngineAvailable();
}

export const activeEngine: Engine = useNative() ? new PikafishEngine() : selfEngine;

/** User-visible engine identity, so the player can verify what is actually running. */
export function activeEngineLabel(): string {
  return activeEngine instanceof PikafishEngine ? 'Pikafish NNUE' : '自研引擎';
}

/**
 * 走棋引擎外层：低子力时若命中《适情雅趣》古谱局面，直接走已验证正解；
 * 原生引擎（Pikafish）在开局命中共享开局库时直接走已验证主线着法，跳过
 * 大师档 14 秒深搜；其余局面完全委托给底层引擎（Pikafish 或自研）。
 *
 * v2026.11.23.4 提速：自研引擎内部已有同一份开局库，因此这里**只在底层是
 * 原生引擎时**套用开局捷径，绝不重复套层改变自研路径行为。脱库时底层全力
 * 搜索，d44 / 14000ms 等棋力参数一字未动。
 */
export class AncientBookEngine implements Engine {
  constructor(private readonly base: Engine) {}

  /** Opening shortcut for the native adapter only; self engine already has it. */
  private nativeBookMove(state: GameState): Move | null {
    if (!(this.base instanceof PikafishEngine)) return null;
    // Pure book weights: no local-learning tilt, so a memorised main line is
    // never downgraded by adaptive sparring data. Legal-move checked inside.
    return openingBookReplyForState(state);
  }

  getBestMove(state: GameState, cfg: AIConfig): Move | null {
    return ancientBookMove(state) ?? this.nativeBookMove(state) ?? this.base.getBestMove(state, cfg);
  }

  async getBestMoveAsync(
    state: GameState, cfg: AIConfig, yieldFrame?: () => Promise<void>,
  ): Promise<Move | null> {
    const book = ancientBookMove(state) ?? this.nativeBookMove(state);
    if (book) return book;
    return this.base.getBestMoveAsync
      ? this.base.getBestMoveAsync(state, cfg, yieldFrame)
      : this.base.getBestMove(state, cfg);
  }

  evaluate(state: GameState, side: Side): number {
    return this.base.evaluate(state, side);
  }
}

export const moveEngine: Engine = new AncientBookEngine(activeEngine);
