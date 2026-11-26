import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Board as BoardModel } from '../engine/board';
import type { Move, Pos, Piece as PieceModel, GameStatus } from '../engine/types';
import type { BoardThemeId, SoundEffects } from '../data/storage';
import { Piece } from './Piece';
import { BoardMaterials } from './boardMaterials';
import { allDecorationSegments, palaceAreas, PALACE_DIAGONALS } from './boardDecor';
import { CALLIGRAPHY_FONT, RED_COLOR, PALACE_GLOW, getBoardTheme } from './theme';

interface BoardProps {
  board: BoardModel;
  selected: Pos | null;
  legalTargets: Pos[];
  lastMove: { from: Pos; to: Pos } | null;
  hint: Move | null;
  /** Live status, used for the check ripple / mate glow on the last move. */
  status?: GameStatus;
  /** Persisted board skin. Omitted (or 'classic') keeps the shipped art exactly. */
  boardThemeId?: BoardThemeId;
  /** Visual effect switches; every omitted field defaults to true. */
  effects?: SoundEffects;
  interactive?: boolean;
  onSquareClick?: (col: number, row: number) => void;
  /** v22.6: 执黑时显示旋转 180°（黑方在下、红方在上），逻辑坐标完全不变。 */
  flipped?: boolean;
  /** 好习惯培养 H4：被预警雷达锁定的己方格，画细红圈；不传则零渲染差异。 */
  threatSquares?: Pos[];
}

interface MoveAnimation {
  from: Pos;
  to: Pos;
  piece: PieceModel;
  captured: PieceModel | null;
  key: string;
}

/** v1.13: 260ms continuous glide — must match index.css `xiangqi-fly`. */
const MOVE_ANIM_MS = 260;
/** Presentation-only defaults; the store owns the persisted values. */
const DEFAULT_EFFECTS: SoundEffects = { capture: true, check: true, mate: true };

/**
 * v2026.11.25.2 坐标数字（棋盘下方 9~1）：取各主题「文字基调」的低透明暖色。
 * 注意是压在深胡桃/深绿木框上的——若用深棕 rgba(78,52,26,0.55) 这类深色，
 * 合成后对比只有 ~1.25:1（tools 实测），数字会彻底看不清；
 * 因此沿用各主题米白/浅暖文字基调、并把不透明度降到 0.62 的克制档，
 * 与"棋盘外的字看得清"的整体目标一致。
 */
const FILE_LABEL_COLOR: Record<BoardThemeId, string> = {
  classic: 'rgba(246,233,205,0.62)',
  wood: 'rgba(240,228,200,0.62)',
  jade: 'rgba(224,240,226,0.62)',
  ink: 'rgba(240,234,220,0.62)',
};

/**
 * Pure square-size calculation. Given a viewport width it returns a cell size
 * such that `9 * cell + 2 * framePad <= width` (with a small extra gutter),
 * clamped to [24, 52]. No `window` access here so it can be unit-tested with
 * any width, including the widths reported by odd Android WebViews.
 *
 * !!! DO NOT RELAX THIS CONSTRAINT !!! A previous build overflowed narrow
 * screens; every frame/decoration addition must live inside `9 * cell`.
 */
export function computeCellFromWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 52;
  const framePad: number = width < 600 ? 8 : 14;
  const gutter: number = width < 600 ? 8 : 24;
  const usable: number = width - gutter * 2 - framePad * 2;
  if (usable <= 0) return 24;
  const cell: number = Math.floor(usable / 9);
  return Math.max(24, Math.min(52, cell));
}

/**
 * Returns the smallest *reasonable* viewport width from all signals the
 * browser/WebView exposes. `innerWidth`, `documentElement.clientWidth` and
 * `visualViewport.width` disagree in some WebViews (and after pinch-zoom);
 * picking the minimum guarantees the board is never wider than what is shown.
 */
function smallestViewportWidth(): number | null {
  if (typeof window === 'undefined') return null;
  const candidates: Array<number | undefined> = [
    window.innerWidth,
    typeof document === 'undefined' ? undefined : document.documentElement.clientWidth,
    window.visualViewport ? window.visualViewport.width : undefined,
  ];
  let min = Number.POSITIVE_INFINITY;
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      min = Math.min(min, value);
    }
  }
  return Number.isFinite(min) ? min : null;
}

/** Computes the square size from every available viewport signal. */
function computeCell(): number {
  const width: number | null = smallestViewportWidth();
  return width === null ? 52 : computeCellFromWidth(width);
}

/** Keeps the board size in sync with resize / orientation / visual-viewport changes. */
function useBoardCell(): number {
  const [cell, setCell] = useState<number>(computeCell);
  useEffect(() => {
    const update = () => setCell(computeCell());
    const viewport: VisualViewport | null = window.visualViewport ?? null;
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    if (viewport) viewport.addEventListener('resize', update);
    // A WebView may report its final width a tick after first paint.
    const timer = window.setTimeout(update, 120);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (viewport) viewport.removeEventListener('resize', update);
      window.clearTimeout(timer);
    };
  }, []);
  return cell;
}

/**
 * v22.6: 逻辑坐标 → 屏幕坐标的 180° 旋转（对合运算，点击映射用同一函数）。
 * 抽成纯函数便于单测锁定"执黑时黑方在下、红方在上"且逻辑坐标不变。
 */
export function flipSquare(col: number, row: number, flipped: boolean): { col: number; row: number } {
  return flipped ? { col: 8 - col, row: 9 - row } : { col, row };
}

/** v22.6: 屏幕格中心；不翻转时与旧版字面完全一致，守住美术护栏。 */
function center(col: number, row: number, cell: number, flipped = false): { x: number; y: number } {
  if (!flipped) return { x: col * cell + cell / 2, y: (9 - row) * cell + cell / 2 };
  return { x: (8 - col) * cell + cell / 2, y: row * cell + cell / 2 };
}

/** v22.6: 暴露给单测的坐标映射（棋子/网格/动画共用同一实现）。 */
export function squareCenter(col: number, row: number, cell: number, flipped = false): { x: number; y: number } {
  return center(col, row, cell, flipped);
}

/** v22.6: 底部 File 数字：红方视角 9→1，黑方视角 1→9。 */
export function fileLabelAt(col: number, flipped = false): number {
  return flipped ? col + 1 : 9 - col;
}

function samePos(a: Pos | null, b: Pos): boolean {
  return !!a && a.col === b.col && a.row === b.row;
}

function moveKey(move: { from: Pos; to: Pos } | null): string {
  if (!move) return '';
  return `${move.from.col},${move.from.row}>${move.to.col},${move.to.row}`;
}

/** Renders the Xiangqi board: wooden frame, carved grid, river, pieces, animations. */
export function Board({
  board,
  selected,
  legalTargets,
  lastMove,
  hint,
  status,
  boardThemeId,
  effects,
  interactive = true,
  onSquareClick,
  flipped = false,
  threatSquares,
}: BoardProps) {
  // `palette` deliberately avoids the name `theme` (MUI's createTheme export).
  // Classic resolves to the exact art-line constants, so the default board is
  // pixel-identical to the delivered bamboo-mat design.
  const palette = getBoardTheme(boardThemeId);
  const fx: SoundEffects = { ...DEFAULT_EFFECTS, ...effects };
  // The opaque bamboo-mat SVG base belongs to classic only. Other skins show
  // their own CSS felt gradient on the div underneath the SVG.
  const isClassicFelt: boolean = !boardThemeId || boardThemeId === 'classic';
  const cell = useBoardCell();
  const framePad = cell <= 36 ? 8 : 14;
  const width = 9 * cell;
  const height = 10 * cell;
  // v2026.11.21.4: 河界书法字放大，成为视觉焦点（天天象棋/ JJ 象棋同款做法）。
  const riverFont = Math.max(15, Math.round(cell * 0.44));
  const labelFont = Math.max(10, Math.round(cell * 0.23));
  const targetDot = Math.max(12, Math.round(cell * 0.34));
  // v2026.11.19.4: 棋子占格从 ~78% 提到 ~92%，贴近天天象棋的饱满棋子，
  // 字面更大更清晰；仍留 3px 让相邻棋子不紧贴、动画坐标不变。
  const pieceSize = cell - 3;
  // v1.13 clarity: carved grid lines are visibly thicker; the integer lip
  // offset keeps the bright engraved edge crisp instead of sub-pixel-blurred.
  const innerLineWidth: number = Math.max(2, cell * 0.05);
  const borderLineWidth: number = Math.max(2.8, cell * 0.07);

  // ---- Travel animation (presentation only; never touches game state) ----
  const [animation, setAnimation] = useState<MoveAnimation | null>(null);
  const processedKey = useRef<string>(moveKey(lastMove));
  const previousBoard = useRef<BoardModel | null>(null);
  const animTimer = useRef<number | null>(null);

  useEffect(() => {
    const key = moveKey(lastMove);
    if (lastMove && key && key !== processedKey.current) {
      processedKey.current = key;
      const mover = board.getPiece(lastMove.to);
      const captured = previousBoard.current ? previousBoard.current.getPiece(lastMove.to) : null;
      if (mover) {
        setAnimation({ from: lastMove.from, to: lastMove.to, piece: mover, captured, key });
        if (animTimer.current !== null) window.clearTimeout(animTimer.current);
        animTimer.current = window.setTimeout(() => setAnimation(null), MOVE_ANIM_MS + 40);
      }
    }
    previousBoard.current = board;
  }, [lastMove, board]);

  useEffect(() => () => {
    if (animTimer.current !== null) window.clearTimeout(animTimer.current);
  }, []);

  // ---- Carved grid: each line has a bright upper-left lip + dark groove ----
  const mainLines: JSX.Element[] = [];
  const pushLine = (
    key: string,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    lineWidth: number,
    strong: boolean,
    opacity = 1,
  ) => {
    // v2026.11.19.4: 单一实线，去掉上一版上方 1px 亮色 lip——那条线与主色线
    // 相位差 1px，在 WebView 缩放下叠成双线重影，是"发虚"的来源之一。
    // 天天象棋的网格就是干净的细实线。
    mainLines.push(
      <line key={`m${key}`} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={strong ? palette.borderLine : palette.line} strokeWidth={lineWidth} opacity={opacity} />,
    );
  };

  for (let r = 0; r < 10; r++) {
    // v22.6: 翻转时横线位置跟着逻辑行走到屏幕另一侧。
    const y = center(0, r, cell, flipped).y;
    const edge = r === 0 || r === 9;
    pushLine(`h${r}`, cell / 2, y, 8.5 * cell, y, edge ? borderLineWidth : innerLineWidth, edge);
  }
  for (let c = 0; c < 9; c++) {
    // v22.6: 纵线同样按逻辑列映射；线段的上下范围不变。
    const x = center(c, 0, cell, flipped).x;
    if (c === 0 || c === 8) {
      pushLine(`v${c}`, x, cell / 2, x, 9.5 * cell, borderLineWidth, true);
    } else {
      pushLine(`v${c}a`, x, cell / 2, x, 4.5 * cell, innerLineWidth, false);
      pushLine(`v${c}b`, x, 5.5 * cell, x, 9.5 * cell, innerLineWidth, false);
    }
  }
  allDecorationSegments(cell).forEach((s, i) => {
    pushLine(`d${i}`, s.x1, s.y1, s.x2, s.y2, Math.max(1.2, cell * 0.032), false, 0.95);
  });

  // v1.13: the palace X diagonals are drawn separately — much thicker, solid
  // deep ink — so the 将/帅 zone reads at a glance. They sit above the grid,
  // below the pieces, and are static SVG — no effect on the flight animation.
  const palaceLines: JSX.Element[] = [];
  for (const [c1, r1, c2, r2] of PALACE_DIAGONALS) {
    const a = center(c1, r1, cell, flipped);
    const b = center(c2, r2, cell, flipped);
    palaceLines.push(
      <line key={`p${c1}${r1}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke={palette.palaceDiagonal} strokeWidth={Math.max(3, cell * 0.085)} opacity={1} />,
    );
  }

  // v2026.11.19.3: 淡金/暖琥珀色块 + 清晰实金边 + 一圈金环。浅豆绿竹席底上
  // 一眼识别"将/帅活动区"；全部是纯色 stroke，零 blur 滤镜。
  const palaceLayer: JSX.Element = (
    <g aria-hidden="true">
      {palaceAreas(cell).map((area, i) => (
        <g key={`palace${i}`}>
          <rect x={area.x} y={area.y} width={area.width} height={area.height}
            fill="url(#xq-palace-fill)" />
          <rect x={area.x} y={area.y} width={area.width} height={area.height}
            fill="none" stroke={PALACE_GLOW} strokeWidth={Math.max(3.5, cell * 0.1)} />
          <rect x={area.x} y={area.y} width={area.width} height={area.height}
            fill="none" stroke={palette.palaceBorder} strokeWidth={Math.max(2.6, cell * 0.07)} />
        </g>
      ))}
    </g>
  );

  // Gold meander corner ornaments (回纹角饰): v1.14 adds a third, narrower
  // highlight stroke offset toward the light, so the L-bracket reads as a
  // carved gold bead (dark groove -> gold body -> bright crest) instead of a
  // flat printed line. All three are static SVG paths — no transform, no blur.
  const ornaments: JSX.Element[] = [];
  {
    // v22.5 天天象棋同款回纹雕花：四角方螺旋 + 四边回纹带。
    // 全部是静态 SVG 实色路径（深槽 + 主色 + 高光三层），无 transform/blur。
    const isJade = boardThemeId === 'jade';
    const isInk = boardThemeId === 'ink';
    const groove = isJade ? '#123B28' : isInk ? '#241E16' : '#3E2410';
    const body = palette.palaceBorder;         // 与各主题协调的亮色回纹
    const crest = isJade ? '#DFF5E2' : isInk ? '#FBF4E4' : '#F6DDA8';
    const step = Math.max(4, cell * 0.28);     // 回纹步长
    const inset = Math.max(4, cell * 0.12);
    const spiral = (x: number, y: number, sx: number, sy: number): string => {
      // 方螺旋：由外向内折 4 段，形成"回"字纹的一半。
      const a = step, b = step * 0.62, c = step * 0.34;
      return `M ${x + sx * a} ${y} L ${x} ${y} L ${x} ${y + sy * a} `
        + `L ${x + sx * b} ${y + sy * a} L ${x + sx * b} ${y + sy * b} `
        + `L ${x + sx * c} ${y + sy * b} L ${x + sx * c} ${y + sy * c}`;
    };
    const corners: Array<[number, number, number, number]> = [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [inset, height - inset, 1, -1],
      [width - inset, height - inset, -1, -1],
    ];
    corners.forEach(([x, y, sx, sy], i) => {
      const d = spiral(x, y, sx, sy);
      ornaments.push(<path key={`groove${i}`} d={d} fill="none" stroke={groove} strokeWidth={Math.max(4, cell * 0.14)} strokeLinejoin="miter" opacity={0.75} />);
      ornaments.push(<path key={`body${i}`} d={d} fill="none" stroke={body} strokeWidth={Math.max(2, cell * 0.075)} strokeLinejoin="miter" />);
      ornaments.push(<path key={`crest${i}`} d={d} fill="none" stroke={crest} strokeWidth={1} strokeLinejoin="miter" opacity={0.8} />);
    });
    // 四边中点的短回纹带（上下左右各一条），呼应天天象棋满框雕花。
    const bandY = inset;
    const bandBottom = height - inset;
    const midX = width / 2;
    const midY = height / 2;
    const bands: string[] = [
      `M ${midX - step * 2} ${bandY} h ${step * 4} M ${midX - step * 2} ${bandY + step * 0.4} h ${step * 4}`,
      `M ${midX - step * 2} ${bandBottom} h ${step * 4} M ${midX - step * 2} ${bandBottom - step * 0.4} h ${step * 4}`,
      `M ${inset} ${midY} v ${step * 2} M ${inset + step * 0.4} ${midY} v ${step * 2}`,
      `M ${width - inset} ${midY} v ${step * 2} M ${width - inset - step * 0.4} ${midY} v ${step * 2}`,
    ];
    bands.forEach((d, i) => {
      ornaments.push(<path key={`bgroove${i}`} d={d} fill="none" stroke={groove} strokeWidth={Math.max(3.5, cell * 0.12)} opacity={0.7} />);
      ornaments.push(<path key={`bbody${i}`} d={d} fill="none" stroke={body} strokeWidth={Math.max(1.8, cell * 0.065)} />);
    });
  }

  const hintFrom = hint ? hint.from : null;
  const hintTo = hint ? hint.to : null;
  // 雷达标注：细红虚线圈叠在棋子外沿，pointerEvents=none 不影响点击/拖子。
  const threatKeys: Set<string> = new Set(
    (threatSquares ?? []).map((p) => `${p.col},${p.row}`),
  );

  // Whether a square is the landing point of the in-flight move (hide its
  // static piece until the flying token lands).
  const isFlightTarget = (c: number, r: number): boolean =>
    !!animation && animation.to.col === c && animation.to.row === r;

  const squares: JSX.Element[] = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const pos: Pos = { col: c, row: r };
      const piece = board.getPiece(pos);
      const isSelected = samePos(selected, pos);
      const isTarget = legalTargets.some((t) => t.col === c && t.row === r);
      const isLast =
        (lastMove && samePos(lastMove.from, pos)) ||
        (lastMove && samePos(lastMove.to, pos));
      const isHint = samePos(hintFrom, pos) || samePos(hintTo, pos);
      const isThreat = threatKeys.has(`${c},${r}`);

      // v22.6: 棋子 div 放到映射后的屏幕格；onClick 仍传逻辑 (c,r)，
      // 因此玩家点下方黑子时，上层拿到的就是正确的黑方逻辑坐标。
      const squareCenterPos = center(c, r, cell, flipped);
      const left = squareCenterPos.x - cell / 2;
      const top = squareCenterPos.y - cell / 2;
      // v1.13: last-move and hint squares get a crisp inset outline on top of
      // the tint so they stay visible even over the brighter palace block.
      const background = isLast
        ? 'rgba(54,132,82,0.30)'
        : isHint
        ? 'rgba(33,130,220,0.32)'
        : 'transparent';
      const squareOutline = isLast
        ? 'inset 0 0 0 2px rgba(34,96,56,0.85)'
        : isHint
        ? 'inset 0 0 0 2px rgba(20,92,168,0.9)'
        : undefined;

      squares.push(
        <div
          key={`s${c}-${r}`}
          data-square={`${c},${r}`}
          onClick={interactive && onSquareClick ? () => onSquareClick(c, r) : undefined}
          style={{
            position: 'absolute',
            left,
            top,
            width: cell,
            height: cell,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: interactive ? 'pointer' : 'default',
            background,
            boxShadow: squareOutline,
            boxSizing: 'border-box',
            borderRadius: 4,
          }}
        >
          {isSelected && (
            <div
              className="xiangqi-selected-ring"
              style={{
                position: 'absolute',
                width: cell - 3,
                height: cell - 3,
                borderRadius: 6,
                border: `3px solid ${RED_COLOR}`,
                boxShadow: [
                  '0 0 0 2px #FFF3D0',
                  '0 0 0 4px rgba(192,57,43,0.88)',
                ].join(', '),
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          )}
          {piece && (
            <div
              className={isSelected ? 'xiangqi-picked-up' : undefined}
              style={{ visibility: isFlightTarget(c, r) ? 'hidden' : 'visible' }}
            >
              <Piece piece={piece} size={pieceSize} skin={palette.piece} />
            </div>
          )}
          {isThreat && (
            <div
              data-testid="threat-ring"
              style={{
                position: 'absolute',
                width: cell - 2,
                height: cell - 2,
                borderRadius: 8,
                border: '1.5px dashed rgba(214,48,49,0.95)',
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          )}
          {isTarget && piece && (
            // v1.14: capturable enemy pieces get a brighter double-lip ring so
            // a capture target is as obvious as an empty landing dot.
            <div
              style={{
                position: 'absolute',
                width: cell - 3,
                height: cell - 3,
                borderRadius: 6,
                border: `2.5px solid rgba(192,57,43,0.98)`,
                boxShadow: [
                  '0 0 0 2px #FFF3D0',
                  '0 0 0 4px rgba(192,57,43,0.82)',
                ].join(', '),
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          )}
          {isTarget && !piece && (
            <div
              className="xiangqi-target-dot"
              style={{
                width: targetDot,
                height: targetDot,
                borderRadius: '50%',
                background: 'rgba(192,57,43,0.98)',
                boxShadow: [
                  '0 0 0 2px #FFF3D0',
                  '0 0 0 4px rgba(192,57,43,0.85)',
                ].join(', '),
              }}
            />
          )}
        </div>,
      );
    }
  }

  // Flying token + captured-piece dissipation (absolute overlay, never affects layout).
  // The three effect switches gate ONLY the extra visual layers; the flight
  // itself, the ordinary landing ripple and ALL audio (store-level) are intact.
  let travelLayer: JSX.Element | null = null;
  if (animation) {
    const from = center(animation.from.col, animation.from.row, cell, flipped);
    const to = center(animation.to.col, animation.to.row, cell, flipped);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const half = pieceSize / 2;
    const distance = Math.hypot(dx, dy) || 1;
    const knockX = Math.round((dx / distance) * cell * 0.5);
    const knockY = Math.round((dy / distance) * cell * 0.5);
    const rippleSize = pieceSize * 2.4;
    const rippleClass =
      status === 'checkmate' || status === 'perpetual'
        ? fx.mate
          ? 'xiangqi-mate-glow'
          : 'xiangqi-land-ripple'
        : status === 'check'
        ? fx.check
          ? 'xiangqi-alert-wave'
          : 'xiangqi-land-ripple'
        : 'xiangqi-land-ripple';
    travelLayer = (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
        {fx.capture && animation.captured && (
          <div
            key={`cap-${animation.key}`}
            className="xiangqi-capture"
            style={{
              position: 'absolute',
              left: to.x - half,
              top: to.y - half,
              ['--cdx' as string]: `${knockX}px`,
              ['--cdy' as string]: `${knockY}px`,
            }}
          >
            <Piece piece={animation.captured} size={pieceSize} skin={palette.piece} />
          </div>
        )}
        <div
          key={`fly-${animation.key}`}
          className="xiangqi-fly"
          style={{
            position: 'absolute',
            left: from.x - half,
            top: from.y - half,
            ['--dx' as string]: `${dx}px`,
            ['--dy' as string]: `${dy}px`,
          }}
        >
          {/* v1.14: the outer layer owns the uninterrupted 260ms glide; this
              inner layer owns only a short touchdown squash/rebound. Keeping
              them separate avoids restarting the travel easing mid-flight. */}
          <div className="xiangqi-land-bounce">
            <Piece piece={animation.piece} size={pieceSize} skin={palette.piece} />
          </div>
        </div>
        <div
          key={`ripple-${animation.key}`}
          className={rippleClass}
          style={{
            position: 'absolute',
            left: to.x - rippleSize / 2,
            top: to.y - rippleSize / 2,
            width: rippleSize,
            height: rippleSize,
            borderRadius: '50%',
          }}
        />
      </div>
    );
  }

  const fileLabels = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
    <span key={`fl${c}`} style={{ width: cell, textAlign: 'center', fontSize: labelFont, color: FILE_LABEL_COLOR[palette.id], fontFamily: CALLIGRAPHY_FONT }}>
      {fileLabelAt(c, flipped)}
    </span>
  ));

  const riverText = (x: number, text: string, key: string) => (
    <g key={key}>
      {/* v19.7: 暖木桌面上的深棕刻字 + 亮唇，无模糊。
          v2026.11.25.2: 字距放宽到 0.22em（印刷棋谱的疏朗感），亮唇微收。 */}
      <text x={x} y={5 * cell + 5} fill="rgba(255,248,222,0.85)" fontSize={riverFont}
        fontFamily={CALLIGRAPHY_FONT} fontWeight={800} letterSpacing="0.22em" textAnchor="middle">
        {text}
      </text>
      <text x={x} y={5 * cell + 6} fill={palette.river} fontSize={riverFont}
        fontFamily={CALLIGRAPHY_FONT} fontWeight={800} letterSpacing="0.22em" textAnchor="middle"
        style={{ paintOrder: 'stroke', stroke: 'rgba(74,42,16,0.5)', strokeWidth: 0.8 }}>
        {text}
      </text>
    </g>
  );

  return (
    <div
      style={{
        position: 'relative',
        padding: framePad,
        background: palette.frame,
        borderRadius: 14,
        /* v2026.11.21.4 温润新中式深胡桃木框：顶部受光暖唇 + 内嵌金属细线
           + 底部阴刻 + 深投影，纯 box-shadow，无图片、无 blur 滤镜影响刻线。 */
        border: '1px solid #3E2412',
        boxShadow: [
          '0 10px 28px rgba(30,16,6,0.6)',
          'inset 0 2px 0 rgba(255,224,168,0.42)',
          'inset 0 1px 1px rgba(232,190,124,0.6)',
          // 内嵌金属细线（香槟金），比旧版更清晰精致。
          'inset 0 0 0 1px rgba(214,178,110,0.62)',
          'inset 0 0 0 2px rgba(90,58,28,0.5)',
          'inset 2px 0 3px rgba(255,230,186,0.12)',
          'inset -2px 0 3px rgba(46,22,8,0.45)',
          'inset 0 -3px 5px rgba(36,16,6,0.65)',
        ].join(', '),
        touchAction: 'manipulation',
        /* Hard clamp: 9*cell + 2*framePad must never exceed the viewport. */
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        margin: '0 auto',
      }}
    >
      <div
        style={{
          position: 'relative',
          width,
          height,
          maxWidth: '100%',
          background: palette.feltTexture,
          borderRadius: 10,
          boxSizing: 'border-box',
          // v22.5 天天象棋同款厚实木板：外层投影让整块棋盘浮起，内层多层
          // inset 造"凸起木框 + 内凹棋面"——顶/左受光亮、底/右背光暗。
          boxShadow: [
            '0 6px 16px rgba(28,16,6,0.5)',
            '0 2px 4px rgba(28,16,6,0.35)',
            'inset 0 0 0 1px rgba(60,34,12,0.55)',
            'inset 0 3px 0 rgba(255,246,220,0.55)',
            'inset 3px 0 0 rgba(255,240,206,0.35)',
            'inset 0 -4px 0 rgba(64,36,14,0.55)',
            'inset -4px 0 0 rgba(64,36,14,0.45)',
            'inset 0 6px 12px rgba(74,42,16,0.22)',
            'inset 0 -6px 12px rgba(40,22,8,0.20)',
          ].join(', '),
        }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', left: 0, top: 0, maxWidth: '100%', pointerEvents: 'none' }}
        >
          <BoardMaterials palaceFill={palette.palaceFill} />
          {isClassicFelt && (
            <>
              {/* 浅豆绿竹席底 + 宽周期竹条 + 柔和暗角：零模糊、零噪声、零摩尔纹。 */}
              <rect x={0} y={0} width={width} height={height} fill="url(#xq-board-base)" />
              <rect x={0} y={0} width={width} height={height} fill="url(#xq-bamboo-strip)" />
              <rect x={0} y={0} width={width} height={height} fill="url(#xq-board-vignette)" />
            </>
          )}
          {!isClassicFelt && (
            // v2026.11.25.2: 非 classic 主题也统一压一道轻暗角（只暗角不提亮），
            // 四套主题共享同一"灯下棋室"氛围，各 feltTexture 常量不动。
            <rect x={0} y={0} width={width} height={height} fill="url(#xq-board-vignette-soft)" />
          )}
          {/* v2026.11.19.3: 淡金九宫色块画在竹席之上、网格之下。 */}
          {palaceLayer}
          {/* v2026.11.19.4: single crisp solid lines, no offset lip layer. */}
          {mainLines}
          {palaceLines}
          {ornaments}
          {riverText(2.5 * cell, '楚 河', 'riverL')}
          {riverText(6.5 * cell, '漢 界', 'riverR')}
        </svg>
        {squares}
        {travelLayer}
      </div>
      <div style={{ display: 'flex', marginTop: 3, width, maxWidth: '100%', overflow: 'hidden' }}>
        {fileLabels}
      </div>
    </div>
  );
}
