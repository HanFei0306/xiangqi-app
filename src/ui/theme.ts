/**
 * MUI theme + shared color constants. v2026.11.25.1「墨玉鎏金」：
 * 引入 SKIN 语义色板——全部页面从此取色，深底/浅底两套对比组合都经过
 * WCAG 实测（tools/palette-check.mjs），杜绝"棋盘外的字看不清"。
 * 浅豆绿竹席棋盘 + 青绿雕花框 + 四角金回纹，两个九宫是淡金/暖琥珀独立色块；
 * 网格线为深墨绿、清晰但不刺眼。纹理一律宽周期、低对比的 CSS 渐变，
 * 杜绝窄屏小格下的摩尔纹与发灰，第一目标是「棋子与字一眼看清」。
 *
 * 纹理全部是 CSS 渐变 / 内联 SVG——无二进制图片、无外部字体、无网络请求，
 * 在 file:// / Android WebView 下渲染一致。
 *
 * 注：本文件只调整默认绿毡/竹席这套外观的色值与绘制；棋盘主题方案常量表
 * （getBoardTheme / BoardThemeId 等）由设置线维护，互不覆盖。
 */

import { createTheme } from '@mui/material/styles';
import type { BoardThemeId } from '../data/storage';

/** 红方棋子色（深红） */
export const RED_COLOR = '#C0392B';
/** 黑方棋子色（深蓝灰） */
export const BLACK_COLOR = '#2C3E50';
/** 棋盘木质桌面底色（v2026.11.21.5 往天天象棋靠：更质朴的暖原木黄褐） */
export const BOARD_BG = '#E3C89A';
/** 河界文字色（木质桌面上的深胡桃书法字） */
export const RIVER_COLOR = '#6E4A24';

/**
 * 温润新中式细腻木纹（v2026.11.21.4）：
 * 三档宽周期低对比木纹（竖向 + 极轻斜向）叠加柔和受光与暗角，
 * 比旧版更细腻、更有天然木质的流动感，同时杜绝摩尔纹与发灰。
 * 周期 >= 5px、透明度 <= 0.09，WebView 缩放下始终锐利。
 * 历史名 BOARD_WOOD 保留，调用点不变。Pure CSS — safe under file://.
 */
export const BOARD_WOOD: string = [
  // v22.2 提亮中心暖光、减轻边缘压暗，贴近参考图明亮通透的实木。
  'radial-gradient(ellipse at 24% 10%, rgba(255,253,242,0.48) 0%, rgba(255,253,242,0) 54%)',
  'radial-gradient(ellipse at 82% 90%, rgba(88,54,22,0.16) 0%, rgba(88,54,22,0) 62%)',
  // 主年轮：宽周期(32px)多档错落纹，宽窄不一、深浅有层次，天然实木感。
  'repeating-linear-gradient(90deg, rgba(138,92,44,0.10) 0px, rgba(138,92,44,0.10) 4px, rgba(255,248,224,0.08) 4px, rgba(255,248,224,0.08) 6px, rgba(146,100,52,0.05) 6px, rgba(146,100,52,0.05) 8px, rgba(255,246,220,0.04) 8px, rgba(255,246,220,0.04) 20px)',
  // 副年轮：错相的斜向宽纹，制造天然不规则流动。
  'repeating-linear-gradient(86deg, rgba(96,58,24,0.04) 0px, rgba(96,58,24,0.04) 25px, rgba(255,246,214,0.03) 25px, rgba(255,246,214,0.03) 49px)',
  // 细木射线：极淡横向断续纹，增加细节而不产生摩尔纹。
  'repeating-linear-gradient(2deg, rgba(120,84,44,0.025) 0px, rgba(120,84,44,0.025) 2px, rgba(255,250,230,0.018) 2px, rgba(255,250,230,0.018) 11px)',
  'linear-gradient(155deg, #F7E8BE 0%, #ECD29C 46%, #CFAE74 100%)',
].join(', ');

/**
 * 深胡桃木外框（v2026.11.21.4）：深色木纹 + 一道内嵌金属细线。
 * 金属细线的锐利部分在 Board.tsx 的 inset box-shadow 里；此处负责木框底色
 * 与细密年轮刻纹，无 1px 机械高亮。
 */
export const BOARD_FRAME: string = [
  // 胡桃木年轮 + 两档错相刻纹，雕花实木的层次感。
  'repeating-linear-gradient(91deg, rgba(28,13,5,0.34) 0px, rgba(28,13,5,0.34) 5px, rgba(222,178,108,0.09) 5px, rgba(222,178,108,0.09) 14px)',
  'repeating-linear-gradient(87deg, rgba(18,8,3,0.24) 0px, rgba(18,8,3,0.24) 9px, rgba(244,212,152,0.06) 9px, rgba(244,212,152,0.06) 23px)',
  'linear-gradient(135deg, #8A5A32 0%, #57331B 46%, #2E1708 100%)',
].join(', ');

/** 棋盘网格线色（深胡桃棕，木质桌面上清晰而不刺眼） */
export const BOARD_LINE = '#7E5A34';
/** 外框线色（更深，突出边框） */
export const BOARD_BORDER_LINE = '#4A2C14';

/**
 * v2026.11.21.4 九宫底色：淡琥珀金（新中式），比暖蜜木底更沉稳的琥珀色块，
 * SVG 渐变以 >= 0.5 不透明度叠在木桌面片上，一眼可辨"将/帅活动区"。
 * g > b 保证偏暖金而非偏冷，且明显暗于木底。
 */
export const PALACE_FILL = '#D2B27A';
/** 九宫边框：深胡桃线，明确圈出"将/帅的活动区域"。 */
export const PALACE_BORDER = '#6E4A24';
/** 九宫边框外实环：纯实色描边，边缘锐利。 */
export const PALACE_GLOW = 'rgba(123,86,40,0.48)';
/** 九宫斜线：深胡桃，比普通网格线更粗更实。 */
export const PALACE_DIAGONAL = '#6B4824';

/**
 * 设置页（人机对战配置页）暖色木纹背景：v2026.11.25.1 降噪重制。
 * 旧版编织纹太密太碎，显得"沙"且抢字；新版放宽纹理周期、减弱对比，
 * 加一道顶部受光与底部压暗，只做氛围不做花样。
 */
export const SETUP_WOOD_BG: string = [
  'repeating-linear-gradient(91deg, rgba(88,52,18,0.07) 0px, rgba(88,52,18,0.07) 3px, rgba(255,232,190,0.045) 3px, rgba(255,232,190,0.045) 9px)',
  'repeating-linear-gradient(1deg, rgba(70,42,14,0.045) 0px, rgba(70,42,14,0.045) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 26px)',
  'radial-gradient(circle at 20% 8%, rgba(255,240,205,0.22) 0%, rgba(0,0,0,0) 44%)',
  'radial-gradient(ellipse at 50% 118%, rgba(88,52,18,0.30) 0%, rgba(0,0,0,0) 52%)',
  'linear-gradient(180deg, #D2A468 0%, #C29154 46%, #A97C46 100%)',
].join(', ');

/** 设置页木纹底的代表色：木纹上的文字对比度以此为准（tools/palette-check.mjs 校验）。 */
export const SETUP_SOLID = '#C29154';

/**
 * 对局页「墨玉鎏金」深松绿背景（v2026.11.25.1）：
 * 旧版是单层平板绿 + 细竹影，略显沉闷；新版加顶部暖金氛围光、两处松绿光斑
 * 与底部压暗，层次更像"灯下的棋室"。竹影条纹保留但更细更淡。
 */
export const MATCH_BG: string = [
  'radial-gradient(ellipse at 50% -8%, rgba(216,190,130,0.11) 0%, rgba(0,0,0,0) 46%)',
  'radial-gradient(circle at 12% 88%, rgba(52,104,74,0.20) 0%, rgba(0,0,0,0) 42%)',
  'radial-gradient(circle at 88% 18%, rgba(44,88,60,0.16) 0%, rgba(0,0,0,0) 40%)',
  'repeating-linear-gradient(92deg, rgba(226,244,226,0.020) 0px, rgba(226,244,226,0.020) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) 10px, rgba(6,18,10,0.05) 10px, rgba(6,18,10,0.05) 13px)',
  'radial-gradient(ellipse at 50% 42%, #234431 0%, #17311F 54%, #0B1D12 100%)',
].join(', ');

/**
 * 深绿竹林背景的最终底色（MATCH_BG 最底层渐变色）。
 * 供对比度计算与测试使用：所有压在 MATCH_BG 上的文字必须与此色对比 >= 4.5:1。
 */
export const MATCH_BG_SOLID = '#17311F';
/** 深绿对局背景上的正文浅米色（对 MATCH_BG_SOLID 约 11.7:1）。 */
export const MATCH_TEXT = '#F4EAD2';
/** 深绿对局背景上的次要金色文字 / 强调色（对 MATCH_BG_SOLID 约 8.5:1）。 */
export const MATCH_GOLD = '#E7C57E';
/** 深绿背景上卡片的金色描边（只做装饰，不承担正文对比）。 */
export const MATCH_GOLD_BORDER = 'rgba(231,197,126,0.30)';
/** 深绿背景上的半透明深色卡片底，保证浅字始终压在暗面上。 */
export const MATCH_PANEL_BG = 'rgba(9,24,15,0.66)';

/* -------------------------------------------------------------------------- *
 * v2026.11.25.1 — SKIN 语义色板（单一取色出口）。
 * 深底（对局/练习/推演/残局实验室）与浅底（设置页木纹、米色面板）两组
 * 组合都经过 tools/palette-check.mjs 实测：正文 ≥7:1、次要 ≥4.5:1、
 * 禁用态 ≥3:1。页面代码**只允许**从这里取色，不许散落新 hex。
 * -------------------------------------------------------------------------- */

/** 语义色板。注释里的对比度均由 tools/palette-check.mjs 实测得出。 */
export const SKIN = {
  /* ---- 深底组合（pageSolid = #17311F / pageDeep = #0B1D12）---- */
  /** 深底页面背景（多层渐变，代表色 pageSolid）。 */
  pageBg: MATCH_BG,
  /** 深底代表色：对比度基准。 */
  pageSolid: MATCH_BG_SOLID,
  /** 深底渐变最深处（页面边缘/底部压暗）。 */
  pageDeep: '#0B1D12',
  /** 深底主文字（11.7:1）。 */
  text: MATCH_TEXT,
  /** 深底次要文字（8.7:1）。 */
  textSecondary: '#D9CBA8',
  /** 深底弱化文字/说明小字（6.6:1）。 */
  textMuted: '#BDB18F',
  /** 金色强调：选中态、数值高亮、装饰线（8.5:1）。 */
  gold: MATCH_GOLD,
  /** 深金强调：金底按钮上的深字、次级强调（6.3:1）。 */
  goldDeep: '#D0A75C',
  /** 深底上的警示/红方强调。旧 #C0392B 对深绿只有约 2:1，禁止再用于文字。 */
  danger: '#F2A48C',
  /** 禁用但可辨认的文字/图标（5.1:1）。 */
  disabled: '#8FA08E',
  /** 深底卡片底。 */
  surface: MATCH_PANEL_BG,
  /** 深底卡片底（更实，用于弹层/抽屉）。 */
  surfaceStrong: 'rgba(7,20,12,0.85)',
  /** 深底卡片描边（装饰）。 */
  border: MATCH_GOLD_BORDER,
  /* ---- 浅底组合（lightSolid = #F6ECD6 / setupSolid = #C29154）---- */
  /** 浅色面板底。 */
  lightPanel: '#F6ECD6',
  /** 浅色面板描边。 */
  lightBorder: 'rgba(122,84,40,0.35)',
  /** 浅面板主文字（11.4:1）。 */
  ink: '#402B10',
  /** 浅面板次要文字（6.2:1）。 */
  ink2: '#6E5222',
  /** 浅面板弱化文字（5.2:1）。 */
  ink3: '#7A5E30',
  /** 浅面板强调（4.9:1）。 */
  accentOnLight: '#8F5A14',
} as const;

/** 页面统一圆角/间距基准（v2026.11.25.1 视觉一致性）。 */
export const SKIN_RADIUS = 14;

/** 设置页嵌套面板米色 */
export const PANEL_CREAM = '#F7ECD5';
/** 金色主按钮渐变（开始挑战） */
export const GOLD_BUTTON_BG = 'linear-gradient(180deg, #F9DF8B 0%, #F2C25E 55%, #E8A93E 100%)';
/** 书法字体栈：棋子与河界共用 */
export const CALLIGRAPHY_FONT = '"KaiTi", "STKaiti", "Kaiti SC", "Songti SC", serif';

/* -------------------------------------------------------------------------- *
 * v2026.11.19.3 — switchable board palettes (ADDITIVE ONLY).
 * The original green-felt constants above are intentionally reused verbatim by
 * the 'classic' entry: the art line owns their final tuning. Every other theme
 * is a pure CSS-color/gradient descriptor, so it works under file:// WebView
 * with no images, fonts, workers or network requests.
 * -------------------------------------------------------------------------- */

/** One complete board palette. Board/Piece integration reads this via getBoardTheme. */
export interface BoardTheme {
  id: BoardThemeId;
  /** Chinese label shown in the settings panel. */
  label: string;
  /** Base felt (playfield) color. */
  felt: string;
  /** Multi-layer CSS gradient painted over the felt base. */
  feltTexture: string;
  /** Ornamental outer wooden frame background. */
  frame: string;
  /** Grid line color. */
  line: string;
  /** Outer frame line color. */
  borderLine: string;
  /** Palace (九宫) fill color. */
  palaceFill: string;
  /** Palace border color. */
  palaceBorder: string;
  /** Palace diagonal line color. */
  palaceDiagonal: string;
  /** River text color. */
  river: string;
  /** Small preview dot color in the settings panel. */
  swatch: string;
  /** v21.11: 整套视觉环境皮肤——换主题时棋盘外的页面/面板/按钮一起变。 */
  env: ThemeEnv;
  /** v22.3: 棋子皮肤——棋子面色/描边/字色随棋盘主题成套变换。 */
  piece: PieceSkin;
}

/** v22.3 棋子皮肤：保持立体浮雕结构，只换配色以贴合棋盘整体风格。 */
export interface PieceSkin {
  /** 面色高光（顶部）。 */
  faceHi: string;
  /** 面色中间调。 */
  faceMid: string;
  /** 面色暗部（底部）。 */
  faceLow: string;
  /** 外圈描边。 */
  edge: string;
  /** 内圈浅描边。 */
  ring: string;
  /** 底部暗唇。 */
  rimLo: string;
}

/**
 * v21.11 全局环境皮肤：主题不只是棋盘格子，而是"你能看到的一切"。
 * 每套棋盘配一套协调的页面背景 / 面板 / 按钮 / 强调色，保证风格统一成套。
 */
export interface ThemeEnv {
  /** 对局页与推演页的大背景（CSS background 值，可多层渐变）。 */
  matchBg: string;
  /** 首页（设置页）大背景。 */
  setupBg: string;
  /** 嵌套面板底色。 */
  panel: string;
  /** 主按钮（开始挑战等）渐变。 */
  button: string;
  /** 强调色（选中态、数值高亮）。 */
  accent: string;
  /**
   * 面板内次要文字色。注意：ink 只用于 setupBg / panel 这类浅色（米色）面板，
   * **绝不可**直接压在 matchBg 深绿背景上——深绿背景统一用 MATCH_TEXT / MATCH_GOLD。
   */
  ink: string;
}

export const BOARD_THEMES: Readonly<Record<BoardThemeId, BoardTheme>> = {
  classic: {
    id: 'classic',
    label: '温润新中式',
    felt: BOARD_BG,
    feltTexture: BOARD_WOOD,
    frame: BOARD_FRAME,
    line: BOARD_LINE,
    borderLine: BOARD_BORDER_LINE,
    palaceFill: PALACE_FILL,
    palaceBorder: PALACE_BORDER,
    palaceDiagonal: PALACE_DIAGONAL,
    river: RIVER_COLOR,
    swatch: BOARD_BG,
    env: {
      matchBg: MATCH_BG,
      setupBg: SETUP_WOOD_BG,
      panel: '#F6ECD6',
      button: 'linear-gradient(180deg, #F9DF8B 0%, #F2C25E 55%, #E8A93E 100%)',
      accent: '#8F5A14',
      ink: '#6E5222',
    },
    piece: { faceHi: '#FFF8E8', faceMid: '#F0DCB2', faceLow: '#CFA56E', edge: '#7A4E22', ring: '#D9B77E', rimLo: '#9A6C38' },
  },
  wood: {
    id: 'wood',
    label: '素雅原木',
    felt: '#DCC397',
    feltTexture: [
      'radial-gradient(ellipse at 18% 10%, rgba(255,250,230,0.24) 0%, rgba(255,250,230,0) 52%)',
      'repeating-linear-gradient(90deg, rgba(122,84,44,0.09) 0px, rgba(122,84,44,0.09) 4px, rgba(255,244,214,0.07) 4px, rgba(255,244,214,0.07) 7px, rgba(140,100,56,0.05) 7px, rgba(140,100,56,0.05) 20px)',
      'linear-gradient(140deg, #EAD3A8 0%, #DCC397 48%, #C7A977 100%)',
    ].join(', '),
    frame: [
      'repeating-linear-gradient(88deg, rgba(66,40,16,0.16) 0px, rgba(66,40,16,0.16) 3px, rgba(244,214,166,0.06) 3px, rgba(244,214,166,0.06) 9px)',
      'linear-gradient(135deg, #A07A4C 0%, #7A5632 48%, #56391C 100%)',
    ].join(', '),
    line: '#5A3B1E',
    borderLine: '#3A2410',
    palaceFill: '#CBA265',
    palaceBorder: '#FFF2D6',
    palaceDiagonal: '#4A2C12',
    river: '#6A4524',
    swatch: '#DCC397',
    env: {
      matchBg: [
        'repeating-linear-gradient(90deg, rgba(255,240,205,0.03) 0px, rgba(255,240,205,0.03) 4px, rgba(0,0,0,0) 4px, rgba(0,0,0,0) 30px)',
        'radial-gradient(circle at 16% 10%, rgba(255,242,210,0.16) 0%, rgba(0,0,0,0) 40%)',
        'linear-gradient(160deg, #7A5C3C 0%, #54402A 55%, #36291A 100%)',
      ].join(', '),
      setupBg: [
        'repeating-linear-gradient(92deg, rgba(74,44,16,0.08) 0px, rgba(74,44,16,0.08) 3px, rgba(255,224,170,0.04) 3px, rgba(255,224,170,0.04) 8px)',
        'linear-gradient(180deg, #DEC29A 0%, #CDB08A 48%, #B59670 100%)',
      ].join(', '),
      panel: '#F7ECDD',
      button: 'linear-gradient(180deg, #F0DCB8 0%, #D8BA8C 55%, #BE9C6A 100%)',
      accent: '#8A6534',
      ink: '#5E4526',
    },
    piece: { faceHi: '#FFFAEE', faceMid: '#F2E3C4', faceLow: '#D7BC90', edge: '#8A6338', ring: '#D2B586', rimLo: '#AC8650' },
  },
  jade: {
    id: 'jade',
    label: '翡翠青玉',
    felt: '#DCEBDC',
    feltTexture: [
      'radial-gradient(ellipse at 24% 12%, rgba(250,255,250,0.48) 0%, rgba(250,255,250,0) 52%)',
      'repeating-linear-gradient(90deg, rgba(60,120,90,0.06) 0px, rgba(60,120,90,0.06) 4px, rgba(240,255,245,0.05) 4px, rgba(240,255,245,0.05) 7px, rgba(80,140,105,0.035) 7px, rgba(80,140,105,0.035) 20px)',
      'linear-gradient(150deg, #EAF4E8 0%, #D4E6D2 46%, #B6D0B8 100%)',
    ].join(', '),
    frame: [
      'repeating-linear-gradient(91deg, rgba(20,60,42,0.26) 0px, rgba(20,60,42,0.26) 5px, rgba(190,230,200,0.07) 5px, rgba(190,230,200,0.07) 13px)',
      'linear-gradient(135deg, #4A7C5E 0%, #2C5640 48%, #163126 100%)',
    ].join(', '),
    line: '#2E5C42',
    borderLine: '#1A3E2C',
    palaceFill: '#A9CFAF',
    palaceBorder: '#F0F9EF',
    palaceDiagonal: '#2A6A48',
    river: '#1E4A36',
    swatch: '#CFE6D0',
    env: {
      matchBg: [
        'radial-gradient(circle at 16% 10%, rgba(190,245,210,0.18) 0%, rgba(0,0,0,0) 40%)',
        'linear-gradient(160deg, #2F6749 0%, #1D4530 55%, #112B1E 100%)',
      ].join(', '),
      setupBg: [
        'radial-gradient(circle at 20% 10%, rgba(225,250,230,0.42) 0%, rgba(0,0,0,0) 42%)',
        'linear-gradient(160deg, #E1EFE1 0%, #CCE2CD 52%, #AECFB1 100%)',
      ].join(', '),
      panel: '#EDF5EA',
      button: 'linear-gradient(180deg, #C6E4C4 0%, #8FC29A 55%, #5C9B70 100%)',
      accent: '#3E7A54',
      ink: '#28523A',
    },
    piece: { faceHi: '#F4FFF6', faceMid: '#DCEFE0', faceLow: '#A8CDB4', edge: '#4E7A60', ring: '#B6D8BC', rimLo: '#7FA98C' },
  },
  ink: {
    id: 'ink',
    label: '墨韵水墨',
    felt: '#F2EAD8',
    feltTexture: [
      'radial-gradient(ellipse at 22% 10%, rgba(255,255,248,0.52) 0%, rgba(255,255,248,0) 50%)',
      'repeating-linear-gradient(90deg, rgba(90,80,64,0.04) 0px, rgba(90,80,64,0.04) 4px, rgba(255,255,250,0.035) 4px, rgba(255,255,250,0.035) 7px, rgba(100,90,72,0.028) 7px, rgba(100,90,72,0.028) 20px)',
      'linear-gradient(150deg, #FBF6E8 0%, #F0E6D2 48%, #DFD2B8 100%)',
    ].join(', '),
    frame: [
      'repeating-linear-gradient(91deg, rgba(38,32,26,0.24) 0px, rgba(38,32,26,0.24) 5px, rgba(220,206,180,0.06) 5px, rgba(220,206,180,0.06) 13px)',
      'linear-gradient(135deg, #6B6152 0%, #443B30 48%, #28231C 100%)',
    ].join(', '),
    line: '#4A4034',
    borderLine: '#2E281F',
    palaceFill: '#C4876E',
    palaceBorder: '#F6E8D4',
    palaceDiagonal: '#8A3B2C',
    river: '#3A3228',
    swatch: '#EFE4CF',
    env: {
      matchBg: [
        'radial-gradient(circle at 18% 10%, rgba(250,248,240,0.12) 0%, rgba(0,0,0,0) 40%)',
        'linear-gradient(160deg, #534C40 0%, #373028 55%, #211D17 100%)',
      ].join(', '),
      setupBg: [
        'radial-gradient(circle at 20% 10%, rgba(255,255,250,0.38) 0%, rgba(0,0,0,0) 42%)',
        'linear-gradient(160deg, #EDE4D2 0%, #DCD1BB 52%, #C4B69E 100%)',
      ].join(', '),
      panel: '#F6F0E4',
      button: 'linear-gradient(180deg, #ECE3CF 0%, #CFC2A6 55%, #AC9C7C 100%)',
      accent: '#6B5E48',
      ink: '#4A4034',
    },
    piece: { faceHi: '#FFFCF4', faceMid: '#F2EADB', faceLow: '#D3C6AF', edge: '#7A6B54', ring: '#CDBFA6', rimLo: '#A99A80' },
  },
};

/** Display order of the shipped palette choices in the settings panel. */
export const BOARD_THEME_ORDER: readonly BoardThemeId[] = ['classic', 'wood', 'jade', 'ink'];

/** Returns the palette for an id; unknown/legacy ids fall back to classic. */
export function getBoardTheme(id: BoardThemeId | undefined | null): BoardTheme {
  return (id && BOARD_THEMES[id]) || BOARD_THEMES.classic;
}

/** v21.11: 取整套环境皮肤；换主题时棋盘外的页面/面板/按钮一起变。 */
export function getEnv(id: BoardThemeId | undefined | null): ThemeEnv {
  return getBoardTheme(id).env;
}

export const theme = createTheme({
  palette: {
    primary: { main: RED_COLOR },
    secondary: { main: BLACK_COLOR },
    /**
     * v2026.11.25.1 系统性修复「棋盘外的字看不清」：
     * 应用主体是深底（墨绿/木纹压暗），MUI 默认黑字（rgba(0,0,0,0.87)）
     * 压上去对比只有 1.3:1。把默认文字/禁用/分割线全部对齐到 SKIN 深底组合，
     * 让所有未显式设色的 Typography/禁用按钮天然可读。
     * 注意：任何压在**浅色面板**上的文字必须显式用 SKIN.ink/ink2/ink3，
     * 不得依赖 MUI 默认色。
     */
    background: { default: SKIN.pageDeep },
    text: {
      primary: SKIN.text,
      secondary: SKIN.textSecondary,
      disabled: SKIN.disabled,
    },
    divider: SKIN.border,
    action: {
      disabled: SKIN.disabled,
      disabledOpacity: 0.62,
    },
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
});
