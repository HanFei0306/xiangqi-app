import { memo } from 'react';
import type { Piece as PieceModel } from '../engine/types';
import { PIECE_DISPLAY } from '../engine/pieces';
import { CALLIGRAPHY_FONT } from './theme';
import type { PieceSkin } from './theme';

interface PieceProps {
  piece: PieceModel;
  size?: number;
  /** v22.3: 棋子皮肤；缺省用温润新中式的米白象牙色。 */
  skin?: PieceSkin;
}

/**
 * v2026.11.19.7 —— 照参考截图重做「米白立体浮雕棋子」。
 *
 * 参考图特征（高清木质棋盘那张）：象牙白/米白圆面、明显的凸起浮雕感
 * （顶部圆弧高光 + 底部内阴影）、双圈描边（外深灰细边 + 内浅棕圈）、
 * 黑方深蓝黑字 / 红方正红字，字大且笔画清晰。
 *
 * 硬约束（继承 v19.4 的清晰度成果，绝不倒退）：
 *   1. 红黑必须一眼可分——正红 #C62828 / 深蓝黑 #23364A；
 *   2. 全程无 filter / blur——浮雕全部用实色 radial/linear 渐变 + inset
 *      硬阴影表达，缩放后边缘干净不发虚；
 *   3. 每一步只合成 transform，memo 保留，布局盒严格等于 size。
 *
 * v22.3: 保留上述默认字面量（温润皮肤），新增可选 skin 让棋子随棋盘主题
 * 成套变换——只换面色/描边，浮雕结构与红黑字色完全不变。
 */
/** 红方正红 / 黑方深蓝黑——高对比、一眼分清敌我（贴合参考图）。 */
const GLYPH_RED = '#C62828';
const GLYPH_BLACK = '#23364A';

function PieceToken({ piece, size = 44, skin }: PieceProps) {
  const red = piece.side === 'red';
  const color = red ? GLYPH_RED : GLYPH_BLACK;

  // 米白象牙浮雕：顶部偏冷白高光 -> 米白面 -> 底部暖灰阴影，
  // 全部实色渐变，无细纹、无模糊。下列默认字面量即温润皮肤。
  const faceHi = '#FFFFFF';
  const faceMid = '#F4EFE2';
  const faceLow = '#D8CFB8';
  const edge = '#8C7B5E';     // 外圈深棕灰细边
  const rimHi = '#FFFFFF';
  const rimLo = '#B9AC90';    // 底部立体暗唇
  const ring = '#B9A882';     // 内圈浅棕描边

  // v22.3: 有皮肤时覆盖面色/描边（保留红黑字色与浮雕几何不变）。
  const hi = skin?.faceHi ?? faceHi;
  const mid = skin?.faceMid ?? faceMid;
  const low = skin?.faceLow ?? faceLow;
  const rim = skin?.edge ?? edge;
  const lip = skin?.rimLo ?? rimLo;
  const inner = skin?.ring ?? ring;

  const char = PIECE_DISPLAY[piece.side][piece.type];

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        borderRadius: '50%',
        /* v22.5 天天象棋同款厚实木棋子：多层实色阶梯侧壁（4px 厚度）
           + 右下柔和落盘投影。棋盘上每枚棋子像真实木牌凸起于盘面。
           v2026.11.25.2: 落盘投影加深半档（暖黑 0.42->0.50 / 0.30->0.38），
           立体感更强但不改阶梯侧壁几何。 */
        boxShadow: [
          `0 1px 0 ${rim}`,
          `0 2px 0 ${rim}`,
          `0 3px 0 ${lip}`,
          `0 4px 0 ${lip}`,
          '0 5px 7px rgba(38,22,8,0.50)',
          '0 2px 3px rgba(38,22,8,0.38)',
        ].join(', '),
      }}
    >
      {/* 正面：细棕边 + 米白浮雕穹顶；双圈由 border + 内圈 span 实现。 */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          boxSizing: 'border-box',
          background: `radial-gradient(ellipse at 36% 26%, ${hi} 0%, ${mid} 55%, ${low} 100%)`,
          border: `1.5px solid ${rim}`,
          /* inset 顶部白高光 + 底部灰暗影 = 凸起浮雕；全实色、零 blur。 */
          boxShadow: [
            `inset 0 2px 2px ${rimHi}`,
            `inset 0 -3px 3px ${lip}`,
          ].join(', '),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* v22.5 顶部弧形高光：模拟圆木牌受光的立体穹顶（纯白渐变到透明，无 blur）。
            v2026.11.25.2: 顶部受光提亮半档（0.85 -> 0.92）。 */}
        <span
          style={{
            position: 'absolute',
            left: '10%', top: '6%', width: '80%', height: '42%',
            borderRadius: '50%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0) 100%)',
            pointerEvents: 'none',
          }}
        />
        {/* 内圈：细浅棕描边，形成参考图的"双圈"观感，低对比不抢字。
            v2026.11.25.2: 描边细化 0.5px（1px -> 0.5px），更精致。 */}
        <span
          style={{
            position: 'absolute',
            width: size * 0.8,
            height: size * 0.8,
            borderRadius: '50%',
            border: `0.5px solid ${inner}`,
            boxSizing: 'border-box',
            opacity: 0.9,
          }}
        />
        {/* 字：正红/深蓝黑实字，撑满盘面；仅下缘一道淡白高光表达刻印凸起，
            绝不用深色粗描边（那是历史上发糊的根源）。 */}
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            color,
            fontFamily: CALLIGRAPHY_FONT,
            fontWeight: 900,
            fontSize: size * 0.78,
            lineHeight: 1,
            userSelect: 'none',
            // v22.5: 上缘细微刻痕暗影 + 下缘白高光 = 阴刻进木牌的立体感。
            textShadow: '0 -0.5px 0 rgba(60,36,14,0.35), 0 1px 0 rgba(255,255,255,0.92)',
          }}
        >
          {char}
        </span>
      </div>
    </div>
  );
}

/** memo 化导出——相同 props（棋子引用 + size + skin）跳过重渲染。 */
export const Piece = memo(PieceToken);
