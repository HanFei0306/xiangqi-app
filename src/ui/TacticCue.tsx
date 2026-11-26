/**
 * 震撼杀法特效（v2026.11.21.10）：吃 / 将军 / 绝杀 / 各类杀法。
 * 多层光环扩散 + 冲击波 + 书法艺术字回弹 + 副标题，参考天天象棋的绝杀演出。
 * 纯 CSS transform/opacity/text-shadow，无 filter/blur，不触碰清晰度护栏。
 */
import type { JSX } from 'react';
import type { CueDisplay } from '../store/cueDisplayStore';

const THEME: Record<CueDisplay['kind'], { main: string; glow: string; ring: string; sub: string }> = {
  move: { main: '#FFF3D0', glow: '#8A6A3A', ring: 'rgba(180,150,90,0.6)', sub: '#FFD9B0' },
  capture: { main: '#FFF3D0', glow: '#C0392B', ring: 'rgba(210,60,40,0.75)', sub: '#FFD9B0' },
  check: { main: '#FFF0BC', glow: '#E07A20', ring: 'rgba(240,150,40,0.8)', sub: '#FFE0A0' },
  mate: { main: '#FFF6DC', glow: '#B01020', ring: 'rgba(220,40,40,0.85)', sub: '#FFE9B0' },
};

export function TacticCue({ cue }: { cue: CueDisplay | null }): JSX.Element | null {
  if (!cue) return null;
  const th = THEME[cue.kind];
  const big = cue.kind === 'mate';
  const fontSize = big ? 76 : 62;

  return (
    <div className="xq-cue-root" key={cue.id} aria-live="assertive">
      {/* 三层冲击光环 */}
      <span className="xq-cue-ring xq-cue-ring-1" style={{ borderColor: th.ring }} />
      <span className="xq-cue-ring xq-cue-ring-2" style={{ borderColor: th.ring }} />
      <span className="xq-cue-ring xq-cue-ring-3" style={{ borderColor: th.ring }} />
      {/* 放射光刃 */}
      <span className="xq-cue-burst" style={{ background: th.ring }} />
      {/* 主体艺术字 */}
      <div className="xq-cue-textwrap">
        <div className="xq-cue-text" style={{
          fontSize, color: th.main,
          textShadow: `0 0 4px ${th.glow}, 2px 3px 0 ${th.glow}, -2px -2px 0 ${th.glow}, 0 0 26px ${th.glow}`,
        }}>
          {cue.text}
        </div>
        {cue.note && big && (
          <div className="xq-cue-note" style={{ color: th.sub }}>{cue.note}</div>
        )}
      </div>
    </div>
  );
}
