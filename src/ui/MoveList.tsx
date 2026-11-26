import type { Move } from '../engine/types';
import { SKIN } from './theme';

interface MoveListProps {
  history: Move[];
  /** Currently reviewed half-move index (null = live / latest). */
  reviewIndex?: number | null;
  /** Called when a move row is clicked to enter review at that step. */
  onMoveClick?: (index: number) => void;
}

/** Renders the move history as paired red/black Chinese notations.
 *  Each move is clickable to jump the board into that position (棋谱回放). */
export function MoveList({ history, reviewIndex = null, onMoveClick }: MoveListProps) {
  const rows: Array<{ n: number; red?: { i: number; text: string }; black?: { i: number; text: string } }> = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      n: i / 2 + 1,
      red: history[i] ? { i, text: history[i].notation } : undefined,
      black: history[i + 1] ? { i: i + 1, text: history[i + 1].notation } : undefined,
    });
  }

  if (rows.length === 0) {
    return <div style={{ color: SKIN.textMuted, padding: 12 }}>暂无着法，开始对局吧。</div>;
  }

  const cell = (entry: { i: number; text: string } | undefined, color: string) => {
    if (!entry) return <span style={{ width: 80 }}>&nbsp;</span>;
    const active = reviewIndex === entry.i;
    return (
      <span
        onClick={onMoveClick ? () => onMoveClick(entry.i) : undefined}
        style={{
          width: 80,
          fontWeight: 600,
          color,
          cursor: onMoveClick ? 'pointer' : 'default',
          padding: '1px 4px',
          borderRadius: 4,
          background: active ? 'rgba(192,57,43,0.18)' : 'transparent',
          outline: active ? '1px solid rgba(192,57,43,0.5)' : 'none',
        }}
      >
        {entry.text}
      </span>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((row) => (
        <div key={row.n} style={{ display: 'flex', gap: 12, fontVariantNumeric: 'tabular-nums' }}>
          <span style={{ width: 28, color: SKIN.textMuted }}>{row.n}.</span>
          {/* v2026.11.25.1：深底上红/黑棋谱文字——旧 #C0392B 对深绿仅约 2:1，
              红方用 SKIN.danger、黑方用 SKIN.textSecondary，两色保留语义区分。 */}
          {cell(row.red, SKIN.danger)}
          {cell(row.black, SKIN.textSecondary)}
        </div>
      ))}
    </div>
  );
}
