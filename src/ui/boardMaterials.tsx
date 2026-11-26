import type { JSX } from 'react';
import { PALACE_FILL } from './theme';

/**
 * Inline SVG defs for the v2026.11.19.7 warm-wood board (参考截图: 木质棋盘).
 * Everything is a procedural gradient / pattern generated at runtime — no
 * image, no font file, no network request — so it renders identically under
 * `file://` / WebView.
 *
 * Clarity-first:
 *   - wide-period vertical wood-grain <pattern> (no feTurbulence noise), which
 *     stays crisp and never aliases into moire at 360/390/414px widths;
 *   - the palace wash is a pale green, solid-enough (>=0.5) so the 将/帅 zone
 *     reads as a distinct block on the warm wood;
 *   - no blur filters anywhere: grid strokes stay razor sharp.
 */
export interface BoardMaterialsProps {
  palaceFill?: string;
}

export function BoardMaterials({ palaceFill = PALACE_FILL }: BoardMaterialsProps = {}): JSX.Element {
  return (
    <defs>
      {/* v22.2 天然实木竖纹：宽周期(32px)多档年轮，宽窄不一、深浅错落，
          低对比且全程实色矩形——360/390/414px 下都锐利、绝不产生摩尔纹。
          6 条不等宽纹路模拟真实木材的年轮疏密，比旧版等宽 4px 双条自然得多。 */}
      <pattern id="xq-bamboo-strip" patternUnits="userSpaceOnUse" width="32" height="32">
        <rect x="0" y="0" width="32" height="32" fill="rgba(0,0,0,0)" />
        {/* 深年轮（宽）+ 相邻亮纹，形成一条实木纹理带。
            v2026.11.25.2 主年轮对比整体再降 ~12%：木更沉稳，不抢棋子。 */}
        <rect x="2" y="0" width="3" height="32" fill="rgba(146,100,52,0.074)" />
        <rect x="5" y="0" width="2" height="32" fill="rgba(255,246,220,0.062)" />
        {/* 细密次生纹 */}
        <rect x="11" y="0" width="1.5" height="32" fill="rgba(150,106,58,0.044)" />
        {/* 主年轮（最宽最深）配高光唇，立体木纹的核心 */}
        <rect x="16" y="0" width="4" height="32" fill="rgba(138,92,44,0.088)" />
        <rect x="20" y="0" width="1.5" height="32" fill="rgba(255,248,224,0.07)" />
        {/* 收尾细纹 */}
        <rect x="26" y="0" width="2" height="32" fill="rgba(152,110,62,0.053)" />
        <rect x="29" y="0" width="1" height="32" fill="rgba(255,245,214,0.044)" />
      </pattern>

      {/* v22.2 参考图那种明亮暖黄实木：左上受光更亮、右下略沉，温润通透。 */}
      <linearGradient id="xq-board-base" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#F7E8BE" />
        <stop offset="42%" stopColor="#ECD29C" />
        <stop offset="100%" stopColor="#D3AC70" />
      </linearGradient>

      {/* 淡琥珀金九宫 wash（新中式）：>=0.5 不透明度，边界锐利、无 blur。 */}
      <linearGradient id="xq-palace-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={palaceFill} stopOpacity="0.66" />
        <stop offset="50%" stopColor={palaceFill} stopOpacity="0.62" />
        <stop offset="100%" stopColor={palaceFill} stopOpacity="0.64" />
      </linearGradient>

      {/* 柔和暖光 + 暗角：纯 stop 色，无 blur，刻线始终锐利。
          v2026.11.25.2 中心受光保持，边缘压暗略增强（0.11 -> 0.16 一档），
          营造"灯下棋室"氛围——灯下中心亮、四周自然沉下去。 */}
      <radialGradient id="xq-board-vignette" cx="46%" cy="36%" r="78%">
        <stop offset="0%" stopColor="#FFFDF2" stopOpacity="0.20" />
        <stop offset="52%" stopColor="#FFFFFF" stopOpacity="0.02" />
        <stop offset="82%" stopColor="#8A6334" stopOpacity="0.05" />
        <stop offset="100%" stopColor="#4A2A12" stopOpacity="0.16" />
      </radialGradient>

      {/* v2026.11.25.2 非 classic 主题专用暗角：只压边缘、不提亮中心
          （各主题 feltTexture 已自带中心受光，再叠会过曝）。
          暗部用中性的暖深棕低透明度，四套主题都能自然融合。 */}
      <radialGradient id="xq-board-vignette-soft" cx="46%" cy="36%" r="78%">
        <stop offset="0%" stopColor="#4A2A12" stopOpacity="0" />
        <stop offset="70%" stopColor="#4A2A12" stopOpacity="0.04" />
        <stop offset="100%" stopColor="#2E1A0A" stopOpacity="0.15" />
      </radialGradient>
    </defs>
  );
}
