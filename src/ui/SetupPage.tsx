import { useMemo, useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Slider, Typography } from '@mui/material';
import ExtensionIcon from '@mui/icons-material/Extension';
import SchoolIcon from '@mui/icons-material/School';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import GridOnIcon from '@mui/icons-material/GridOn';
import { useSettings } from '../store/settings';
import { loadMatchStats, totalMatchStats } from '../store/matchStats';
import { tierFromSlider, sliderForTier, SLIDER_MIN, SLIDER_MAX } from './setupTiers';
import { CALLIGRAPHY_FONT, getEnv, SKIN, SKIN_RADIUS } from './theme';

interface SetupPageProps {
  /** 开始挑战: begin a fresh standard match and open the match screen. */
  onStart: () => void;
  /** Entry into the practice (练习) mode. */
  onPractice: () => void;
  /** Entry into the 学棋 · 好习惯 (habit coach) page. */
  onHabit: () => void;
  /** Entry into the 推演 · 变化图 (simulation) page. */
  onSimulation: () => void;
  /** v2026.11.23.8: 残局推演（自摆残局）入口。 */
  onEndgameLab: () => void;
  /**
   * v2026.11.23.8: 是否有一局下到中途、被「主页」挂起的对局。
   * 为 true 时「开始挑战」不直接开局，而是先问「继续 / 新的」。
   */
  hasUnfinished: boolean;
  /** v2026.11.23.8: 继续那局被挂起的对局（不重开）。 */
  onContinue: () => void;
}

/** Nested inner-panel wrapper: dark outer slot + light cream panel. */
function NestedCard({ children, sx, panelColor = '#F7ECD5' }: { children: React.ReactNode; sx?: object; panelColor?: string }) {
  return (
    <Box
      sx={{
        borderRadius: '16px',
        p: '3px',
        background: 'rgba(58,32,10,0.35)',
        border: '1px solid rgba(58,32,10,0.45)',
        boxShadow: 'inset 0 1px 3px rgba(40,20,4,0.45)',
        ...sx,
      }}
    >
      <Box
        sx={{
          borderRadius: '13px',
          background: panelColor,
          border: '1px solid rgba(255,250,235,0.8)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -2px 5px rgba(150,110,60,0.18)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * v1.13 landing screen —「人机对战」setup page in the 天天象棋 nested-card
 * style: warm procedural wood background, wooden banner, resource pills, the
 * difficulty master card (slider 1-25 + side picker) and the stats card.
 *
 * v2026.11.23.8: 主页面此刻是「门口」而不是「清场」的地方 —— 若有一局被挂起，
 * 「开始挑战」会先问一句「继续对局 / 新的对局」，绝不在用户不知情时把棋丢掉。
 */
export function SetupPage({
  onStart,
  onPractice,
  onHabit,
  onSimulation,
  onEndgameLab,
  hasUnfinished,
  onContinue,
}: SetupPageProps) {
  const boardTheme = useSettings((s) => s.boardTheme);
  const env = getEnv(boardTheme);
  const difficulty = useSettings((s) => s.difficulty);
  const setDifficulty = useSettings((s) => s.setDifficulty);
  const playerSide = useSettings((s) => s.playerSide);
  const setPlayerSide = useSettings((s) => s.setPlayerSide);

  /** 「发现一局没下完的棋」弹窗开关（只在 hasUnfinished 时有意义）。 */
  const [resumeOpen, setResumeOpen] = useState(false);

  const stats = useMemo(() => loadMatchStats(difficulty), [difficulty]);
  const overall = useMemo(() => totalMatchStats(), []);
  const games = stats.wins + stats.losses + stats.draws;
  const winRate = games > 0 ? Math.round((stats.wins * 100) / games) : 0;
  const overallRate =
    overall.total > 0 ? Math.round((overall.wins * 100) / (overall.wins + overall.losses + overall.draws)) : 0;

  /**
   * 「开始挑战」：没挂起的对局就直接开新局；有挂起的对局就先问一句，
   * 让用户从容选择「接着下」还是「另开一局」。
   */
  const handleStart = () => {
    if (hasUnfinished) {
      setResumeOpen(true);
      return;
    }
    onStart();
  };

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        background: env.setupBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 1.2,
        pt: 1.5,
        pb: 2.5,
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 1.2, minWidth: 0 }}>
        {/* ---- 顶部木质横幅条：外深内浅两层描边（主页即首页，无返回按钮） ---- */}
        <Box
          sx={{
            borderRadius: '14px',
            p: '3px',
            background: 'linear-gradient(180deg, #6E4520 0%, #4A2C12 100%)',
            border: '1px solid #2E1A08',
            boxShadow: 'inset 0 1px 1px rgba(240,206,130,0.5), inset 0 -2px 4px rgba(24,12,2,0.6), 0 3px 8px rgba(40,20,4,0.35)',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              borderRadius: '11px',
              px: 1,
              py: 0.8,
              background: 'linear-gradient(180deg, rgba(255,236,196,0.16) 0%, rgba(90,54,24,0.25) 100%)',
              border: '1px solid rgba(255,230,180,0.35)',
            }}
          >
            <Typography
              sx={{
                flex: 1,
                textAlign: 'center',
                color: '#F7ECD5',
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: '0.28em',
                textIndent: '0.28em',
                fontFamily: CALLIGRAPHY_FONT,
                textShadow: '0 2px 3px rgba(30,14,2,0.6)',
              }}
            >
              人机对战
            </Typography>
          </Box>
        </Box>

        {/* ---- 资源行：横排嵌套药丸（真实 localStorage 对局统计） ---- */}
        <Box sx={{ display: 'flex', gap: 0.8 }}>
          {[
            { label: '对局', value: overall.total },
            { label: '连胜', value: stats.streak },
            { label: `胜率 ${overallRate}%`, value: `最佳 ${overall.bestStreak}` },
          ].map((item) => (
            <Box key={item.label} sx={{ flex: 1, borderRadius: `${SKIN_RADIUS}px`, p: '3px', background: 'rgba(252,244,224,0.9)', border: `1px solid ${SKIN.lightBorder}`, boxShadow: '0 2px 6px rgba(60,34,10,0.18)' }}>
              <Box
                sx={{
                  borderRadius: `${SKIN_RADIUS - 2}px`,
                  py: 0.55,
                  textAlign: 'center',
                  background: 'rgba(255,251,240,0.55)',
                  border: '1px solid rgba(255,252,242,0.8)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)',
                }}
              >
                <Typography component="span" sx={{ fontSize: 15, fontWeight: 800, color: SKIN.ink, fontFamily: CALLIGRAPHY_FONT }}>
                  {item.label}
                </Typography>
                <Typography component="span" sx={{ fontSize: 15, fontWeight: 700, color: SKIN.ink2, ml: 0.8, fontVariantNumeric: 'tabular-nums' }}>
                  {item.value}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        {/* ---- v2026.11.23.8 未完成对局常驻提示：一眼看见，一点即续 ---- */}
        {hasUnfinished && (
          <Box
            component="button"
            type="button"
            data-testid="resume-match-pill"
            onClick={onContinue}
            aria-label="继续未下完的对局"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.7,
              width: '100%',
              py: 0.75,
              px: 1,
              borderRadius: '999px',
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'center',
              background: 'linear-gradient(180deg, rgba(255,246,214,0.96) 0%, rgba(238,206,140,0.95) 100%)',
              border: '1px solid rgba(138,90,24,0.7)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 5px rgba(40,20,4,0.28)',
              color: SKIN.ink,
              transition: 'filter 120ms ease, transform 120ms ease',
              '&:hover': { filter: 'brightness(1.03)' },
              '&:active': { transform: 'translateY(1px)' },
            }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#B0512B', boxShadow: '0 0 0 3px rgba(176,81,43,0.18)' }}
            />
            <Typography
              component="span"
              sx={{ fontSize: 12.5, fontWeight: 800, fontFamily: CALLIGRAPHY_FONT, letterSpacing: '0.02em', lineHeight: 1.2 }}
            >
              有未下完的对局 · 点此继续
            </Typography>
          </Box>
        )}

        {/* ---- 难度主卡 ---- */}
        <NestedCard panelColor={env.panel}>
          <Box sx={{ px: 1.6, py: 1.2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {/* 行1：档位大字 + 分隔线 + 过关率 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ minWidth: 96 }}>
                <Typography sx={{ fontSize: 26, fontWeight: 900, lineHeight: 1.1, color: SKIN.ink, fontFamily: CALLIGRAPHY_FONT, letterSpacing: '0.06em' }}>
                  {difficulty === 'beginner' ? '新手' : difficulty === 'easy' ? '中级' : difficulty === 'intermediate' ? '高级' : '大师'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: SKIN.ink3, mt: 0.3 }}>AI难度</Typography>
              </Box>
              <Box sx={{ width: 1, alignSelf: 'stretch', bgcolor: SKIN.lightBorder }} />
              <Box sx={{ flex: 1, textAlign: 'right' }}>
                <Typography sx={{ fontSize: 22, fontWeight: 800, color: SKIN.accentOnLight, fontVariantNumeric: 'tabular-nums' }}>
                  {winRate}%
                </Typography>
                <Typography sx={{ fontSize: 12, color: SKIN.ink3 }}>过关率</Typography>
              </Box>
            </Box>

            {/* 行2：难度设定 + 金色滑杆（1-25，米白数值气泡） */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, py: 0.4 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: SKIN.ink, whiteSpace: 'nowrap' }}>
                难度设定
              </Typography>
              <Slider
                min={SLIDER_MIN}
                max={SLIDER_MAX}
                step={1}
                value={sliderForTier(difficulty)}
                onChange={(_, v) => setDifficulty(tierFromSlider(v as number))}
                valueLabelDisplay="auto"
                aria-label="难度设定"
                sx={{
                  mx: 1,
                  '& .MuiSlider-rail': { height: 8, borderRadius: 4, backgroundColor: 'rgba(231,197,126,0.45)', opacity: 1 },
                  '& .MuiSlider-track': { height: 8, borderRadius: 4, backgroundColor: SKIN.gold },
                  '& .MuiSlider-thumb': {
                    width: 24,
                    height: 24,
                    backgroundColor: '#F9DF8B',
                    border: '3px solid #8A5A18',
                    background: 'linear-gradient(180deg, #F9DF8B 0%, #E8A93E 100%)',
                    boxShadow: '0 1px 4px rgba(40,20,4,0.35)',
                    '&:focus, &:hover, &.Mui-active, &.Mui-focusVisible': { boxShadow: '0 0 0 6px rgba(232,169,62,0.22)' },
                  },
                  '& .MuiSlider-valueLabel': {
                    backgroundColor: '#FFF9EA',
                    color: SKIN.ink,
                    fontWeight: 800,
                    borderRadius: '999px',
                    fontSize: 13,
                    fontFamily: 'sans-serif',
                    border: `1px solid ${SKIN.lightBorder}`,
                    boxShadow: '0 2px 6px rgba(40,20,4,0.28)',
                  },
                }}
              />
            </Box>

            {/* 行3：我执红/黑（红先黑后） */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
              <Box>
                <Typography sx={{ fontSize: 14, fontWeight: 700, color: SKIN.ink, lineHeight: 1.1 }}>我执</Typography>
                <Typography sx={{ fontSize: 11, color: SKIN.ink3, lineHeight: 1.1 }}>红先黑后</Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              {(['red', 'black'] as const).map((side) => {
                const selected = playerSide === side;
                const red = side === 'red';
                return (
                  <Box
                    key={side}
                    data-testid={`player-side-${side}`}
                    onClick={() => setPlayerSide(side)}
                    sx={{
                      px: 1.6,
                      py: 0.45,
                      borderRadius: '999px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      fontSize: 13.5,
                      fontWeight: 800,
                      fontFamily: CALLIGRAPHY_FONT,
                      color: selected ? '#FFF6E4' : SKIN.ink2,
                      background: selected
                        ? red
                          ? 'linear-gradient(180deg, #D4564A 0%, #B03226 100%)'
                          : 'linear-gradient(180deg, #3E5870 0%, #2C3E50 100%)'
                        : 'rgba(217,195,154,0.4)',
                      border: selected ? '1px solid rgba(46,26,8,0.5)' : `1px solid ${SKIN.lightBorder}`,
                      boxShadow: selected ? '0 1px 3px rgba(40,20,4,0.35)' : 'inset 0 1px 0 rgba(255,255,255,0.7)',
                    }}
                  >
                    {red ? '红方（先）' : '黑方（后）'}
                  </Box>
                );
              })}
            </Box>
          </Box>
        </NestedCard>

        {/* ---- 战绩卡 ---- */}
        <NestedCard panelColor={env.panel}>
          <Box sx={{ px: 1.6, py: 1.1 }}>
            <Typography sx={{ fontSize: 12, color: SKIN.ink2, mb: 0.6 }}>
              与{difficulty === 'beginner' ? '新手' : difficulty === 'easy' ? '中级' : difficulty === 'intermediate' ? '高级' : '大师'}的标准对局战绩
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', py: 0.4, borderTop: `1px solid ${SKIN.lightBorder}` }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: SKIN.ink, py: 0.4 }}>
                胜率 {winRate}%
                <Typography component="span" sx={{ fontSize: 13, fontWeight: 600, color: SKIN.ink2, ml: 0.5 }}>
                  (胜{stats.wins}和{stats.draws}负{stats.losses})
                </Typography>
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.4, borderTop: `1px solid ${SKIN.lightBorder}` }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: SKIN.ink }}>排名</Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: SKIN.accentOnLight }}>
                未上榜 ›
              </Typography>
            </Box>
          </Box>
        </NestedCard>

        {/* ---- 底部金色大按钮：开始挑战 ---- */}
        <Button
          onClick={handleStart}
          sx={{
            mt: 0.6,
            py: 1.5,
            borderRadius: '999px',
            background: env.button,
            border: '2px solid #8A5A18',
            boxShadow: '0 4px 0 #8A5A18, 0 8px 16px rgba(40,20,4,0.35)',
            color: '#5E2E0C',
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: '0.24em',
            textIndent: '0.24em',
            fontFamily: CALLIGRAPHY_FONT,
            textShadow: '0 1px 0 rgba(255,240,200,0.6)',
            '&:active': {
              transform: 'translateY(1px)',
              boxShadow: '0 3px 0 #8A5A18, 0 6px 12px rgba(40,20,4,0.35)',
              filter: 'brightness(0.96)',
            },
            '&:hover': { background: env.button, filter: 'brightness(1.03)' },
          }}
        >
          开始挑战
        </Button>

        {/* ---- 四个功能入口：统一木质卡片网格（适情雅趣 / 残局推演 / 学棋 / 记谱） ---- */}
        <Box sx={{
          display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 0.6,
          width: '100%', mt: 0.4,
        }}>
          {[
            { icon: <ExtensionIcon sx={{ fontSize: 24 }} />, label: '适情雅趣', sub: '残局练习', onClick: onPractice },
            { icon: <GridOnIcon sx={{ fontSize: 24 }} />, label: '残局推演', sub: '自摆残局', onClick: onEndgameLab, testId: 'entry-endgame-lab' },
            { icon: <SchoolIcon sx={{ fontSize: 24 }} />, label: '学棋', sub: '好习惯', onClick: onHabit },
            { icon: <MenuBookIcon sx={{ fontSize: 24 }} />, label: '记谱', sub: '棋谱本', onClick: onSimulation },
          ].map((item) => (
            <Button
              key={item.label}
              data-testid={item.testId}
              onClick={item.onClick}
              sx={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.3,
                py: 1.2, px: 0.3, borderRadius: `${SKIN_RADIUS}px`, minWidth: 0,
                color: SKIN.ink,
                background: 'rgba(252,244,224,0.92)',
                border: `1px solid ${SKIN.lightBorder}`,
                boxShadow: '0 2px 6px rgba(60,34,10,0.18), inset 0 1px 0 rgba(255,255,255,0.8)',
                transition: 'transform 120ms ease, box-shadow 120ms ease',
                '&:active': { transform: 'translateY(1px)', boxShadow: '0 1px 2px rgba(60,34,10,0.18), inset 0 1px 0 rgba(255,255,255,0.8)' },
              }}
            >
              {item.icon}
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, fontFamily: CALLIGRAPHY_FONT, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{item.label}</Typography>
              <Typography sx={{ fontSize: 11, color: SKIN.ink2, lineHeight: 1, whiteSpace: 'nowrap' }}>{item.sub}</Typography>
            </Button>
          ))}
        </Box>
        {/* v2026.11.25.2：ink2 对木纹底只有约 2.6:1，版本号改 ink（对中调 4.76:1）。 */}
        <Typography sx={{ alignSelf: 'center', fontSize: 11, color: SKIN.ink, fontWeight: 600 }}>
          v2026.11.25.2
        </Typography>
      </Box>

      {/* ---- v2026.11.23.8「发现一局没下完的棋」：继续 / 新的 / 取消 ---- */}
      <Dialog
        data-testid="resume-dialog"
        open={resumeOpen}
        onClose={() => setResumeOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: '16px',
            p: '3px',
            background: 'linear-gradient(180deg, #6E4520 0%, #4A2C12 100%)',
            border: '1px solid #2E1A08',
            boxShadow: 'inset 0 1px 1px rgba(240,206,130,0.5), 0 10px 30px rgba(20,10,2,0.6)',
          },
        }}
      >
        <Box
          sx={{
            borderRadius: '13px',
            background: 'linear-gradient(180deg, rgba(255,236,196,0.14) 0%, rgba(90,54,24,0.25) 100%)',
            border: '1px solid rgba(255,230,180,0.35)',
          }}
        >
          <DialogTitle
            sx={{
              fontFamily: CALLIGRAPHY_FONT,
              fontWeight: 900,
              fontSize: 19,
              color: '#F7ECD5',
              letterSpacing: '0.06em',
              textAlign: 'center',
              textShadow: '0 2px 3px rgba(30,14,2,0.6)',
            }}
          >
            发现一局没下完的棋
          </DialogTitle>
          <DialogContent sx={{ pt: 0.5 }}>
            <Typography sx={{ fontSize: 13.5, lineHeight: 1.65, color: 'rgba(247,236,213,0.88)', textAlign: 'center' }}>
              这局棋还停在中途 —— 可以接着上次的局面继续下，也可以另开一局重新开始。
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 1.6, pb: 1.4, pt: 0.6, gap: 0.6, flexWrap: 'wrap' }}>
            <Button
              data-testid="resume-cancel"
              onClick={() => setResumeOpen(false)}
              sx={{ color: 'rgba(247,236,213,0.72)', fontSize: 13.5, fontWeight: 700, minWidth: 0, px: 1 }}
            >
              取消
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button
              data-testid="resume-new"
              variant="outlined"
              onClick={() => {
                setResumeOpen(false);
                onStart();
              }}
              sx={{
                color: '#F6DDA8',
                borderColor: 'rgba(240,206,130,0.6)',
                fontSize: 13.5,
                fontWeight: 800,
                borderRadius: '999px',
                px: 1.8,
                '&:hover': { borderColor: '#F6DDA8', background: 'rgba(240,206,130,0.12)' },
              }}
            >
              新的对局
            </Button>
            <Button
              data-testid="resume-continue"
              variant="contained"
              onClick={() => {
                setResumeOpen(false);
                onContinue();
              }}
              sx={{
                background: env.button,
                color: '#5E2E0C',
                border: '2px solid #8A5A18',
                fontSize: 14,
                fontWeight: 900,
                fontFamily: CALLIGRAPHY_FONT,
                borderRadius: '999px',
                px: 2.2,
                boxShadow: '0 3px 0 #8A5A18, 0 6px 12px rgba(40,20,4,0.35)',
                textShadow: '0 1px 0 rgba(255,240,200,0.6)',
                '&:hover': { background: env.button, filter: 'brightness(1.04)' },
              }}
            >
              继续对局
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
