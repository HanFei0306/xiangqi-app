import { CALLIGRAPHY_FONT, SKIN } from './theme';

interface PlayerBarProps {
  side: 'red' | 'black';
  name: string;
  detail?: string;
  active: boolean;
  capturedText?: string;
  /** Current half-move count, shown as an「N步」pill (v1.11 player bar). */
  stepCount?: number;
}

/**
 * v1.11 nested-card player strip (天天象棋 style): a dark outer slot wrapping
 * an inner green panel, a square gold-framed avatar and a live activity dot.
 */
export function PlayerBar({ side, name, detail, active, capturedText, stepCount }: PlayerBarProps) {
  const red = side === 'red';
  const avatarChar = red ? '帅' : '将';
  const avatarBg = red
    ? 'radial-gradient(circle at 34% 26%, #F5B7A8 0%, #D98878 55%, #A8442E 100%)'
    : 'radial-gradient(circle at 34% 26%, #8FA3B0 0%, #5A7183 55%, #2C3E50 100%)';

  return (
    <div
      style={{
        width: '100%',
        padding: 3,
        boxSizing: 'border-box',
        borderRadius: 14,
        /* Outer dark slot (嵌套外层凹槽). */
        background: SKIN.surface,
        border: `1px solid ${SKIN.border}`,
        boxShadow: active
          ? '0 0 12px rgba(110,231,168,0.25), inset 0 1px 2px rgba(0,0,0,0.5)'
          : '0 2px 6px rgba(0,0,0,0.35), inset 0 1px 2px rgba(0,0,0,0.5)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '4px 9px',
          boxSizing: 'border-box',
          borderRadius: 11,
          /* Inner panel (嵌套内层面板). */
          background: active
            ? 'linear-gradient(180deg, rgba(86,140,102,0.55) 0%, rgba(46,88,62,0.55) 100%)'
            : 'linear-gradient(180deg, rgba(52,84,64,0.4) 0%, rgba(30,56,40,0.4) 100%)',
          border: `1px solid ${SKIN.border}`,
          color: SKIN.text,
          fontFamily: CALLIGRAPHY_FONT,
          transition: 'background 180ms ease, border-color 180ms ease',
        }}
      >
        {/* Square avatar with a gold inner frame. */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            flexShrink: 0,
            background: avatarBg,
            border: '2px solid #D9B26A',
            boxShadow: '0 2px 5px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(46,26,8,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 19,
            fontWeight: 900,
            color: '#FFF2E2',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {avatarChar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2, letterSpacing: '0.04em' }}>
            {name}
          </div>
          {detail && <div style={{ fontSize: 12, color: SKIN.textSecondary, marginTop: 2 }}>{detail}</div>}
        </div>
        {capturedText && capturedText.length > 0 && (
          <div style={{ fontSize: 12, color: SKIN.gold, maxWidth: 110, textAlign: 'right' }}>
            已吃：{capturedText}
          </div>
        )}
        {typeof stepCount === 'number' && (
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 999,
              background: SKIN.surfaceStrong,
              border: `1px solid ${SKIN.border}`,
              color: SKIN.text,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {stepCount}步
          </div>
        )}
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            flexShrink: 0,
            background: active ? '#6EE7A8' : 'rgba(255,255,255,0.25)',
            boxShadow: active ? '0 0 8px #6EE7A8' : 'none',
          }}
        />
      </div>
    </div>
  );
}
