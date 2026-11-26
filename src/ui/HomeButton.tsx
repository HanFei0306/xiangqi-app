/**
 * 全局「主页」按钮（v2026.11.25.1 墨玉鎏金统一版）。
 *
 * 需求：任何界面都必须有一个能从容回到主页的出口，而且**回到主页不等于
 * 结束当前进程**——对局被挂起，下次从主页进入可以继续。
 *
 * 这里只负责"长得像一个明确的回家出口"，不负责业务：
 * 点击后做什么由调用方的 onClick 决定（先挂起再跳转）。所有页面共用同一
 * 组件，避免各页自己画一个 `‹ 返回` 导致行为不一致。
 *
 * 视觉：取色全部来自 `SKIN` 语义色板——dark = 深底上的金描边浅字，
 * light = 浅色面板上的深字；阴影统一暖黑 rgba(0,0,0,0.35)。
 */
import HomeIcon from '@mui/icons-material/Home';
import { Button } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import { CALLIGRAPHY_FONT, SKIN } from './theme';

export interface HomeButtonProps {
  onClick: () => void;
  /** dark = 深绿/深木色底上金描边浅字；light = 米色面板上深棕字。 */
  tone?: 'dark' | 'light';
  /** 按钮文案，默认「主页」。 */
  label?: string;
  /** 细长条形场景（页面顶栏）用 sm，棋盘工具条用 md。 */
  size?: 'sm' | 'md';
  /** 供 QA/CDP 定位。 */
  testId?: string;
  sx?: SxProps<Theme>;
}

/** 注：rgba 高亮层是 SKIN.gold（#E7C57E）的透明度变体，纯装饰不承担正文对比。 */
const TONE = {
  dark: {
    color: SKIN.text,
    background: SKIN.surface,
    border: `1px solid ${SKIN.goldDeep}`,
    shadow: 'inset 0 1px 0 rgba(255,246,220,0.35), 0 2px 5px rgba(0,0,0,0.35)',
    hover: 'rgba(231,197,126,0.24)',
    icon: SKIN.gold,
  },
  light: {
    color: SKIN.ink,
    background: SKIN.lightPanel,
    border: `1px solid ${SKIN.lightBorder}`,
    shadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 4px rgba(0,0,0,0.35)',
    hover: 'rgba(255,255,255,0.55)',
    icon: SKIN.accentOnLight,
  },
} as const;

export function HomeButton({
  onClick,
  tone = 'dark',
  label = '主页',
  size = 'md',
  testId = 'home-button',
  sx,
}: HomeButtonProps) {
  const t = TONE[tone];
  const compact = size === 'sm';
  return (
    <Button
      onClick={onClick}
      data-testid={testId}
      aria-label={label}
      disableRipple
      startIcon={<HomeIcon sx={{ fontSize: compact ? 16 : 19, color: t.icon }} />}
      sx={{
        minWidth: 0,
        flexShrink: 0,
        px: compact ? 1 : 1.5,
        py: compact ? 0.25 : 0.55,
        borderRadius: '999px',
        color: t.color,
        background: t.background,
        border: t.border,
        boxShadow: t.shadow,
        fontSize: compact ? 12 : 14,
        fontWeight: 800,
        letterSpacing: '0.06em',
        fontFamily: CALLIGRAPHY_FONT,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        transition: 'background-color 120ms ease, transform 120ms ease',
        '&:hover': { background: t.hover },
        '&:active': { transform: 'translateY(1px)' },
        '& .MuiButton-startIcon': { mr: compact ? 0.4 : 0.6, ml: 0 },
        ...sx,
      }}
    >
      {label}
    </Button>
  );
}
