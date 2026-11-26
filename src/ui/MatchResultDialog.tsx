/**
 * 对局结算页（v2026.11.23.5 仪式感重设计）。
 *
 * 终局后直接进入深绿竹林 + 金色的结算画面，而不是朴素白色弹窗：
 * 顶部「棋局已终」+ 胜负大字，中部可滚动的统计卡 / 失误讲解 / 漏杀 / 棋谱保存
 * （失误与漏杀相邻靠前，点条目即可跳对应节点；保存棋谱移到两者之后），
 * 底部固定四个大操作按钮：再来一局 / 新的一局 / 复盘分析 / 分享。
 * 深绿背景上的所有文字统一使用浅米色 / 浅金（MATCH_TEXT / MATCH_GOLD）；
 * 米色面板的深字规则不受影响。纯离线，无新依赖、无网络请求。
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box, Button, Dialog, Snackbar, TextField, ThemeProvider, Typography,
} from '@mui/material';
import { createTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import SaveIcon from '@mui/icons-material/Save';
import SettingsIcon from '@mui/icons-material/Settings';
import ShareIcon from '@mui/icons-material/Share';
import type { GameState, Move, Side } from '../engine/types';
import type { SimHintOptions } from '../store/simulationStore';
import type { ReplayAnnotation } from '../training/types';
import { buildMatchSummary } from '../training/matchStats';
import { analyzeMistakes } from '../training/mistakeDetection';
import type { AnalysisResult } from '../training/mistakeTypes';
import { saveNotation } from '../data/notation-storage';
import {
  CALLIGRAPHY_FONT, GOLD_BUTTON_BG, MATCH_BG, MATCH_GOLD,
  MATCH_GOLD_BORDER, MATCH_PANEL_BG, MATCH_TEXT, SKIN,
} from './theme';
import { MistakeReviewList } from './MistakeReviewList';

/** 模块级缓存：同一局弹窗反复开关/点按钮都不重算分析结果。 */
const MISTAKE_CACHE = new Map<string, AnalysisResult>();
const EMPTY_ANALYSIS: AnalysisResult = {
  mistakes: [], analyzedPlies: 0, skippedPlies: 0, elapsedMs: 0,
};

/**
 * 结算页局部主题：让内部复用组件（MistakeReviewList 的 Accordion / Chip /
 * TextField 等）在深绿底色上自动取浅字，而不是 MUI 默认的黑字。
 * 只作用于结算 Dialog，不改全局主题，避免影响米色面板的既有对比度。
 */
const RESULT_THEME = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: MATCH_GOLD, contrastText: '#1A2E1E' },
    secondary: { main: MATCH_TEXT },
    background: { paper: SKIN.pageSolid, default: SKIN.pageDeep },
    text: {
      primary: MATCH_TEXT,
      secondary: SKIN.textSecondary,
      disabled: SKIN.disabled,
    },
    divider: MATCH_GOLD_BORDER,
  },
  shape: { borderRadius: 10 },
});

function cacheKeyOf(
  history: readonly Move[], playerSide: Side, excluded: ReadonlySet<number>,
): string {
  const moves: string = history.map((move) => move?.notation ?? '?').join('|');
  const plies: string = [...excluded].sort((a, b) => a - b).join(',');
  return `${playerSide}::${moves}::${plies}`;
}

interface Props {
  open: boolean;
  history: Move[];
  annotations: ReplayAnnotation[];
  playerSide: Side;
  elapsedSec: number;
  resultLabel: string;
  onClose: () => void;
  onNewGame: () => void;
  onReview: () => void;          // 点复盘分析：进入可手动/自动播放的复盘
  onReviewMiss: (state: GameState, killer: string, options?: SimHintOptions) => void;
  /** 新的一局：回设置页重选难度/执色/皮肤。缺省时退化为 onClose，保持向后兼容。 */
  onNewSetup?: () => void;
}

/** 显式让帧回调：Android WebView 用 rAF，测试环境回退到 setTimeout。 */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function defaultName(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `对局 ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{
        fontFamily: CALLIGRAPHY_FONT, fontWeight: 800, fontSize: 15,
        color: MATCH_GOLD, mb: 0.7, letterSpacing: '0.04em',
      }}
    >
      {children}
    </Typography>
  );
}

interface ActionButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
  primary?: boolean;
}

/** 底部四宫格大按钮：深绿玻璃底 + 金边，主操作用金色渐变强调。 */
function ActionButton({
  label, icon, onClick, testId, disabled = false, primary = false,
}: ActionButtonProps) {
  return (
    <Button
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      sx={{
        minHeight: 58,
        flexDirection: 'column',
        gap: 0.35,
        px: 0.3,
        py: 0.7,
        borderRadius: 2,
        fontFamily: CALLIGRAPHY_FONT,
        fontSize: 13.5,
        fontWeight: 800,
        lineHeight: 1.15,
        color: primary ? '#2A1B08' : MATCH_TEXT,
        background: primary ? GOLD_BUTTON_BG : MATCH_PANEL_BG,
        border: '1px solid',
        borderColor: primary ? 'rgba(255,236,180,0.85)' : MATCH_GOLD_BORDER,
        boxShadow: primary ? '0 2px 8px rgba(0,0,0,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.06)',
        '&:hover': {
          background: primary
            ? 'linear-gradient(180deg, #FFE9A4 0%, #F7D075 55%, #EEB64C 100%)'
            : 'rgba(46,88,62,0.88)',
        },
        '&.Mui-disabled': {
          color: SKIN.disabled,
          background: 'rgba(10,26,16,0.5)',
        },
      }}
    >
      {icon}
      {label}
    </Button>
  );
}

export function MatchResultDialog({
  open, history, annotations, playerSide, elapsedSec, resultLabel,
  onClose, onNewGame, onReview, onReviewMiss, onNewSetup,
}: Props) {
  const data = useMemo(
    () => buildMatchSummary(history, annotations, playerSide),
    [history, annotations, playerSide],
  );
  // 结算后单次分析：漏杀 ply 剔除，useMemo 生成缓存键 + 模块级 Map，
  // 异步结果只在首次进入该局时计算一次，弹窗内点按钮不会重算。
  const excludedPlies = useMemo(
    () => new Set<number>(data.missedMates.map((mm) => mm.ply)),
    [data.missedMates],
  );
  const cacheKey = useMemo(
    () => cacheKeyOf(history, playerSide, excludedPlies),
    [history, playerSide, excludedPlies],
  );
  const [analysis, setAnalysis] = useState<AnalysisResult>(
    () => MISTAKE_CACHE.get(cacheKey) ?? EMPTY_ANALYSIS,
  );
  useEffect(() => {
    if (!open || history.length === 0) { setAnalysis(EMPTY_ANALYSIS); return; }
    const cached = MISTAKE_CACHE.get(cacheKey);
    if (cached) { setAnalysis(cached); return; }
    let cancelled = false;
    void analyzeMistakes(history, { playerSide, excludePlies: excludedPlies }, yieldFrame)
      .then((result) => {
        if (cancelled) return;
        MISTAKE_CACHE.set(cacheKey, result);
        // 会话内最多缓存最近 20 局，避免长期使用时内存无限增长。
        if (MISTAKE_CACHE.size > 20) {
          const oldest = MISTAKE_CACHE.keys().next().value as string | undefined;
          if (oldest !== undefined) MISTAKE_CACHE.delete(oldest);
        }
        setAnalysis(result);
      })
      .catch(() => { if (!cancelled) setAnalysis(EMPTY_ANALYSIS); });
    return () => { cancelled = true; };
  }, [open, history, playerSide, cacheKey, excludedPlies]);
  const mistakes = analysis.mistakes;
  const mins = Math.floor(elapsedSec / 60);
  const secs = Math.round(elapsedSec % 60);
  const [name, setName] = useState(defaultName);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { if (open) { setName(defaultName()); setSaved(false); } }, [open]);

  const doSave = () => {
    if (history.length === 0 || saved) return;
    saveNotation({ name: name.trim() || defaultName(), setup: '', moves: history });
    setSaved(true);
    setToast('已保存到记谱本');
  };

  const doShare = async () => {
    const text = `象棋对局 · ${resultLabel}\n${data.plies} 步 · ${mins}分${secs}秒\n\n${history.map((m, i) => `${Math.floor(i / 2) + 1}${i % 2 ? '..' : '.'} ${m.notation}`).join('  ')}`;
    try {
      if (navigator.share) await navigator.share({ title: '象棋对局', text });
      else if (navigator.clipboard) { await navigator.clipboard.writeText(text); setToast('棋谱已复制到剪贴板'); }
      else setToast('当前环境不支持分享');
    } catch { /* 用户取消分享 */ }
  };

  const openNewSetup = onNewSetup ?? onClose;

  return (
    <>
      <ThemeProvider theme={RESULT_THEME}>
        <Dialog
          data-testid="match-result-dialog"
          open={open}
          onClose={onClose}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              overflow: 'hidden',
              background: MATCH_BG,
              border: `1px solid ${MATCH_GOLD_BORDER}`,
              borderRadius: '18px',
              boxShadow: '0 12px 48px rgba(0,0,0,0.65)',
            },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              // 内容少时画面紧凑不空旷；内容多时锁 92dvh，中部滚动、底部四键常驻。
              maxHeight: '92dvh',
              minHeight: { xs: 420, sm: 460 },
              background: MATCH_BG,
              color: MATCH_TEXT,
            }}
          >
            {/* 顶部金线 + 书法抬头：结算画面的仪式感 */}
            <Box sx={{ height: 3, flexShrink: 0, background: GOLD_BUTTON_BG }} />
            <Box
              component="header"
              sx={{
                position: 'relative',
                flexShrink: 0,
                px: 2,
                pt: 1.4,
                pb: 1.2,
                textAlign: 'center',
                borderBottom: `1px solid ${MATCH_GOLD_BORDER}`,
              }}
            >
              <Button
                data-testid="result-close"
                size="small"
                onClick={onClose}
                sx={{
                  position: 'absolute', right: 6, top: 5, minWidth: 0, px: 0.8,
                  fontSize: 12, color: MATCH_GOLD,
                }}
              >
                关闭
              </Button>
              <Typography
                sx={{
                  fontFamily: CALLIGRAPHY_FONT, fontSize: 12, letterSpacing: '0.5em',
                  color: MATCH_GOLD, textIndent: '0.5em',
                }}
              >
                棋 局 已 终
              </Typography>
              <Typography
                data-testid="result-heading"
                sx={{
                  fontFamily: CALLIGRAPHY_FONT,
                  fontSize: { xs: 26, sm: 32 },
                  fontWeight: 900,
                  lineHeight: 1.25,
                  mt: 0.4,
                  color: MATCH_TEXT,
                  textShadow: '0 2px 6px rgba(0,0,0,0.6)',
                }}
              >
                {resultLabel}
              </Typography>
              <Box sx={{ width: 72, height: 2, mx: 'auto', mt: 0.9, background: GOLD_BUTTON_BG }} />
            </Box>

            {/* 中部内容：统计 / 失误讲解 / 漏杀 / 棋谱保存，统一浅字深底 */}
            <Box
              data-testid="result-content"
              sx={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                px: 2,
                pt: 1.4,
                pb: 1.6,
              }}
            >
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 1.8 }}>
                <Stat label="总步数" value={`${data.plies}`} />
                <Stat label="用时" value={`${mins}分${secs}秒`} />
                <Stat label="失误" value={`${data.blunders}`} />
              </Box>

              {/*
                失误区前移到漏杀区之前：两者相邻靠前，摘要行【看这一手】一点
                就进推演页对应节点；保存棋谱这类低优先操作挪到两者之后。
              */}
              <MistakeReviewList
                entries={mistakes}
                history={history}
                onReview={(state, notation, options) => onReviewMiss(state, notation, options)}
              />

              <Box data-testid="missed-mates-review">
                <SectionTitle>漏杀分析（{data.missedMates.length}）</SectionTitle>
                <Typography
                  sx={{
                  fontSize: 11.5, mb: 1, lineHeight: 1.6,
                  color: SKIN.textSecondary,
                  }}
                >
                  点击漏杀项进入棋盘，自己重走这一步；进入后也可点【让 AI 演示最优解】学习正确杀着。
                </Typography>
                {data.missedMates.length === 0 ? (
                  <Typography sx={{ fontSize: 12.5, color: SKIN.textSecondary, mb: 1.6 }}>
                    本局没有漏掉一步杀的好机会，很好。
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.6 }}>
                    {data.missedMates.map((mm) => (
                      <Box
                        key={mm.ply}
                        sx={{
                          p: 1.2,
                          borderRadius: 2,
                          background: MATCH_PANEL_BG,
                          border: `1px solid ${MATCH_GOLD_BORDER}`,
                        }}
                      >
                        <Typography sx={{ fontSize: 13, color: MATCH_TEXT }}>
                          第 {mm.ply + 1} 手：当时走了「{mm.played}」，错过一步杀
                        </Typography>
                        <Typography sx={{ fontSize: 12, color: SKIN.textSecondary, mt: 0.4, lineHeight: 1.55 }}>
                          正确杀着是「{mm.killer}」。点击下方按钮跳到该局面自己重走，再点【让 AI 演示最优解】对照学习。
                        </Typography>
                        <Button
                          size="small"
                          variant="contained"
                          sx={{ mt: 1, fontFamily: CALLIGRAPHY_FONT, fontWeight: 700 }}
                          onClick={() => onReviewMiss(mm.state, mm.killer)}
                        >
                          进入棋盘，重走这一手
                        </Button>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>

              <SectionTitle>保存这盘棋谱</SectionTitle>
              <Box
                sx={{
                  p: 1.2,
                  mb: 1.8,
                  borderRadius: 2,
                  background: MATCH_PANEL_BG,
                  border: `1px solid ${MATCH_GOLD_BORDER}`,
                }}
              >
                <TextField
                  fullWidth
                  size="small"
                  label="棋谱名称（日期时间已自动填入）"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={saved}
                />
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={<SaveIcon />}
                  onClick={doSave}
                  disabled={saved || data.plies === 0}
                  sx={{ mt: 1, fontFamily: CALLIGRAPHY_FONT, fontWeight: 700 }}
                >
                  {saved ? '已保存到记谱本' : '保存棋谱'}
                </Button>
              </Box>
            </Box>

            {/* 底部固定四按钮：唯一主操作区，不随内容滚动 */}
            <Box
              component="footer"
              data-testid="result-actions"
              sx={{
                flexShrink: 0,
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 0.6,
                px: 1.2,
                py: 1,
                background: 'rgba(8,24,16,0.92)',
                borderTop: `1px solid ${MATCH_GOLD_BORDER}`,
              }}
            >
              <ActionButton
                testId="result-action-replay"
                label="再来一局"
                icon={<ReplayIcon sx={{ fontSize: 22 }} />}
                onClick={onNewGame}
                primary
              />
              <ActionButton
                testId="result-action-new-setup"
                label="新的一局"
                icon={<SettingsIcon sx={{ fontSize: 22 }} />}
                onClick={openNewSetup}
              />
              <ActionButton
                testId="result-action-review"
                label="复盘分析"
                icon={<PlayArrowIcon sx={{ fontSize: 22 }} />}
                onClick={onReview}
                disabled={data.plies === 0}
              />
              <ActionButton
                testId="result-action-share"
                label="分享"
                icon={<ShareIcon sx={{ fontSize: 22 }} />}
                onClick={() => { void doShare(); }}
              />
            </Box>
          </Box>
        </Dialog>
      </ThemeProvider>
      <Snackbar
        open={toast !== null}
        autoHideDuration={2200}
        onClose={() => setToast(null)}
        message={toast ?? ''}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box
      sx={{
        p: 1.1,
        textAlign: 'center',
        borderRadius: 2,
        background: MATCH_PANEL_BG,
        border: `1px solid ${MATCH_GOLD_BORDER}`,
      }}
    >
      <Typography sx={{ fontSize: 11.5, color: MATCH_GOLD, letterSpacing: '0.06em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: MATCH_TEXT, mt: 0.2 }}>
        {value}
      </Typography>
    </Box>
  );
}
