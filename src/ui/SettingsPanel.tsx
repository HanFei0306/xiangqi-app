/**
 * In-match settings panel (v2026.11.19.3).
 *
 * A self-contained modal with all persisted preferences: board skin, move
 * effects, move sound, background music (track + volume) and the tactic-name
 * hint toggle. Every control reads/writes the zustand settings store, which in
 * turn persists a backwards-compatible blob to localStorage.
 *
 * file:// rule: only CSS colors/gradients and a relative <audio> src are used;
 * no fetch, no workers, no CDN.
 */

import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Slider,
  Switch,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import { useSettings } from '../store/settings';
import type { BoardThemeId, MusicTrackId, SoundEffects } from '../data/storage';
import { BOARD_THEME_ORDER, getBoardTheme, SKIN } from './theme';
import { applyMusicSettings, MUSIC_TRACKS } from '../audio/music';
import {
  getEvolutionStats,
  resetEvolution,
  setEvolutionEnabled,
  type EvolutionStats,
} from '../ai/evolution';
import { getLessonStats, resetLessons, type LessonStats } from '../training/selfReview';
import { inspectAudioChannel, selfTestCue, KIND_LABEL, SELF_TEST_KINDS } from '../audio/selfTest';
import type { CueKind } from '../audio/unifiedCue';

/** CC BY-SA attribution lines — plain text only (no file/network access). */
const MUSIC_CREDITS: readonly string[] = [
  '《月光》— Debussy 作曲 / 美国空军乐团演奏（公有领域）',
  '《卡农》— Pachelbel 作曲 / CC BY-SA 3.0',
  '《阳关三叠》— 古琴 CharlieHuang 演奏 / CC BY-SA 3.0',
  '注：《松窗棋罢》为现代版权歌曲，已用公有领域古曲《阳关三叠》替代。',
];

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface ToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  ariaLabel: string;
  onChange: (value: boolean) => void;
}

/** One labeled switch row, consistent spacing on narrow screens. */
function ToggleRow({ label, description, checked, ariaLabel, onChange }: ToggleRowProps) {
  return (
    <FormControlLabel
      sx={{ mx: 0, width: '100%', justifyContent: 'space-between' }}
      label={
        <Box sx={{ minWidth: 0 }}>
          {/* 浅米底上的文字必须显式取 SKIN.ink 组，不能依赖 MUI 默认浅字。 */}
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: SKIN.ink }}>{label}</Typography>
          {description ? (
            <Typography sx={{ fontSize: 11, color: SKIN.ink3, lineHeight: 1.35 }}>{description}</Typography>
          ) : null}
        </Box>
      }
      control={
        <Switch
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          inputProps={{ 'aria-label': ariaLabel }}
          color="primary"
        />
      }
    />
  );
}

/** Section heading with a thin separator, matching the warm setup-card look. */
function SectionTitle({ children }: { children: string }) {
  return (
    <Box sx={{ mt: 0.7, mb: 0.6 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 800, color: SKIN.ink, letterSpacing: '0.04em' }}>
        {children}
      </Typography>
      <Divider sx={{ mt: 0.5, borderColor: SKIN.lightBorder }} />
    </Box>
  );
}

/** Choice chip used by both the board-theme and music pickers. */
function ChoiceButton({
  label,
  selected,
  onClick,
  swatch,
  envAccent,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  swatch?: string;
  envAccent?: string;
}) {
  return (
    <Button
      onClick={onClick}
      aria-pressed={selected}
      sx={{
        minWidth: 0,
        justifyContent: 'flex-start',
        px: 1,
        py: 0.7,
        borderRadius: '10px',
        fontSize: 12.5,
        fontWeight: 700,
        textTransform: 'none',
        color: selected ? '#FFF6E4' : SKIN.ink2,
        background: selected
          ? 'linear-gradient(180deg, #A9763C 0%, #825524 100%)'
          : 'rgba(217,195,154,0.42)',
        border: selected ? '1px solid #6E4520' : '1px solid #D9C39A',
        boxShadow: selected ? 'inset 0 1px 2px rgba(40,20,4,0.35)' : 'none',
        '&:hover': { filter: 'brightness(1.05)' },
      }}
    >
      {swatch ? (
        <Box
          component="span"
          sx={{
            display: 'inline-block',
            width: 12,
            height: 12,
            mr: 0.8,
            flexShrink: 0,
            borderRadius: '50%',
            background: swatch,
            border: envAccent ? '2px solid ' + envAccent : '1px solid rgba(30,16,6,0.45)',
            boxShadow: envAccent ? '0 0 0 1px rgba(30,16,6,0.35)' : 'none',
          }}
        />
      ) : null}
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </Box>
    </Button>
  );
}

/**
 * Modal settings panel. Render it from MatchPage with `open` bound to local
 * state; selection changes apply immediately and survive app restarts.
 */
export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const boardTheme = useSettings((s) => s.boardTheme);
  const setBoardTheme = useSettings((s) => s.setBoardTheme);
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const setSoundEnabled = useSettings((s) => s.setSoundEnabled);
  const [audioInfo, setAudioInfo] = useState(() => inspectAudioChannel());
  const musicTrack = useSettings((s) => s.musicTrack);
  const setMusicTrack = useSettings((s) => s.setMusicTrack);
  const musicVolume = useSettings((s) => s.musicVolume);
  const setMusicVolume = useSettings((s) => s.setMusicVolume);
  const effects = useSettings((s) => s.effects);
  const setEffect = useSettings((s) => s.setEffect);
  const tacticsHintEnabled = useSettings((s) => s.tacticsHintEnabled);
  const setTacticsHintEnabled = useSettings((s) => s.setTacticsHintEnabled);

  // AI local evolution: read on each open so stats written by finished matches
  // are visible without a page reload. Writes are synchronous localStorage I/O.
  const [evolution, setEvolution] = useState<EvolutionStats>(() => getEvolutionStats());
  const [lessons, setLessons] = useState<LessonStats>(() => getLessonStats());
  useEffect(() => {
    if (open) {
      setEvolution(getEvolutionStats());
      setLessons(getLessonStats());
    }
  }, [open]);

  const toggleEvolution = (value: boolean): void => {
    setEvolutionEnabled(value);
    setEvolution(getEvolutionStats());
  };

  const resetEvolutionData = (): void => {
    resetEvolution();
    resetLessons();
    setEvolution(getEvolutionStats());
    setLessons(getLessonStats());
  };

  const chooseTrack = (id: MusicTrackId): void => {
    setMusicTrack(id);
    applyMusicSettings(id, musicVolume);
  };

  const chooseVolume = (value: number): void => {
    const volume: number = Math.min(1, Math.max(0, value));
    setMusicVolume(volume);
    applyMusicSettings(musicTrack, volume);
  };

  const changeEffect = (key: keyof SoundEffects, value: boolean): void => {
    setEffect(key, value);
  };

  const musicChoices: Array<{ id: MusicTrackId; label: string }> = [
    { id: 'off', label: '关闭' },
    ...MUSIC_TRACKS.map((t) => ({ id: t.id, label: t.label })),
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      aria-label="设置面板"
      PaperProps={{
        sx: {
          maxHeight: '86dvh',
          borderRadius: '16px',
          background: 'linear-gradient(180deg, #FBEFD8 0%, #F2E0BE 100%)',
          border: '1px solid #B98A4E',
          overflowX: 'hidden',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 1,
          px: 1.6,
          color: SKIN.ink,
          fontWeight: 900,
          letterSpacing: '0.12em',
        }}
      >
        设置
        <IconButton onClick={onClose} aria-label="关闭设置" size="small" sx={{ color: SKIN.ink2 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 1.6, pb: 1.4, overflowX: 'hidden' }}>
        <SectionTitle>整体风格皮肤（棋盘 + 界面 + 背景）</SectionTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.6 }}>
          {BOARD_THEME_ORDER.map((id: BoardThemeId) => {
            const palette = getBoardTheme(id);
            return (
              <ChoiceButton
                key={id}
                label={palette.label}
                swatch={palette.swatch}
                envAccent={palette.env.accent}
                selected={boardTheme === id}
                onClick={() => setBoardTheme(id)}
              />
            );
          })}
        </Box>

        <SectionTitle>下棋音效</SectionTitle>
        <ToggleRow
          label="下棋音效"
          description="落子、吃子、将军的清脆麻将声"
          checked={soundEnabled}
          ariaLabel="下棋音效"
          onChange={setSoundEnabled}
        />
        {/* 音效自检：点按钮逐一试听，立即确认四类音效在当前设备是否发声 */}
        <Box sx={{ mt: 0.6, p: 1, borderRadius: '10px', background: 'rgba(90,120,70,0.10)', border: '1px solid rgba(90,120,70,0.25)' }}>
          <Typography sx={{ fontSize: 11.5, color: SKIN.ink2, mb: 0.6 }}>
            音效自检 · 当前通道：<Box component="span" data-testid="audio-channel" sx={{ fontWeight: 800, color: SKIN.accentOnLight }}>{audioInfo.label}</Box>
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 0.5 }}>
            {SELF_TEST_KINDS.map((kind: CueKind) => (
              <Button
                key={kind}
                data-testid={`selftest-${kind}`}
                onClick={() => {
                  setAudioInfo(inspectAudioChannel());
                  selfTestCue(kind, soundEnabled);
                }}
                sx={{ fontSize: 12, py: 0.5, minWidth: 0, color: SKIN.ink, background: 'rgba(255,248,224,0.9)', border: '1px solid rgba(120,80,36,0.4)' }}
              >
                {KIND_LABEL[kind]}
              </Button>
            ))}
          </Box>
          <Typography sx={{ fontSize: 10.5, color: SKIN.ink3, mt: 0.5 }}>
            逐个点击试听；若无声音，请先确认手机未静音，并把「下棋音效」开关打开。
          </Typography>
        </Box>

        <SectionTitle>背景音乐</SectionTitle>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.6 }}>
          {musicChoices.map((choice) => (
            <ChoiceButton
              key={choice.id}
              label={choice.label}
              selected={musicTrack === choice.id}
              onClick={() => chooseTrack(choice.id)}
            />
          ))}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.8 }}>
          <MusicNoteIcon sx={{ fontSize: 18, color: SKIN.accentOnLight }} />
          <Typography sx={{ fontSize: 12, color: SKIN.ink2, whiteSpace: 'nowrap' }}>音量</Typography>
          <Slider
            min={0}
            max={100}
            step={1}
            value={Math.round(musicVolume * 100)}
            onChange={(_, v) => chooseVolume((Array.isArray(v) ? v[0] : v) / 100)}
            aria-label="背景音乐音量"
            size="small"
            sx={{ flex: 1, mx: 1, color: SKIN.accentOnLight }}
          />
          <Typography sx={{ fontSize: 12, color: SKIN.ink2, fontVariantNumeric: 'tabular-nums', minWidth: 32 }}>
            {Math.round(musicVolume * 100)}%
          </Typography>
        </Box>

        <SectionTitle>特效</SectionTitle>
        <ToggleRow
          label="吃子特效"
          checked={effects.capture}
          ariaLabel="吃子特效"
          onChange={(v) => changeEffect('capture', v)}
        />
        <ToggleRow
          label="将军特效"
          checked={effects.check}
          ariaLabel="将军特效"
          onChange={(v) => changeEffect('check', v)}
        />
        <ToggleRow
          label="绝杀特效"
          checked={effects.mate}
          ariaLabel="绝杀特效"
          onChange={(v) => changeEffect('mate', v)}
        />

        <SectionTitle>提示</SectionTitle>
        <ToggleRow
          label="杀法提示"
          description="开启后提示可给出铁门栓 / 重炮杀 / 拔簧马 / 马后炮等杀法名"
          checked={tacticsHintEnabled}
          ariaLabel="杀法提示"
          onChange={setTacticsHintEnabled}
        />

        <SectionTitle>AI 学习（本地）</SectionTitle>
        <ToggleRow
          label={`学习开关 · 已学 ${evolution.totalGames} 局 / Lv.${evolution.level}`}
          description="仅在本机记录开局与中局倾向，权重幅度受限；关闭后历史保留"
          checked={evolution.enabled}
          ariaLabel="AI 学习"
          onChange={toggleEvolution}
        />
        {evolution.openings.length > 0 ? (
          <Typography sx={{ fontSize: 10.5, color: SKIN.ink3, lineHeight: 1.5, mb: 0.4 }}>
            最常见开局：{evolution.openings[0].name} · {evolution.openings[0].games} 局 · AI 胜率{' '}
            {Math.round(evolution.openings[0].aiWinRate * 100)}%
          </Typography>
        ) : null}
        <Typography sx={{ fontSize: 10.5, color: SKIN.ink3, lineHeight: 1.5, mb: 0.4 }}>
          赛后复盘：漏杀 {lessons.missedMates} · 臭招 {lessons.blunders} · 好棋 {lessons.good}
          {lessons.recent.length > 0 ? ` · 最近：${lessons.recent[0].notation || '记谱缺失'}` : ''}
        </Typography>
        <Button
          onClick={resetEvolutionData}
          size="small"
          sx={{ alignSelf: 'flex-start', fontSize: 11, color: SKIN.accentOnLight, px: 1, minWidth: 0 }}
        >
          重置学习记录
        </Button>

        {/* CC BY-SA 署名（授权要求，纯文本展示，不读取外部文件） */}
        <Box sx={{ mt: 1.2, pt: 0.8, borderTop: `1px dashed ${SKIN.lightBorder}` }}>
          <Typography sx={{ fontSize: 11, fontWeight: 800, color: SKIN.ink2 }}>
            背景音乐来源
          </Typography>
          {MUSIC_CREDITS.map((line) => (
            <Typography key={line} sx={{ fontSize: 10.5, color: SKIN.ink3, lineHeight: 1.55 }}>
              {line}
            </Typography>
          ))}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 1.6, pb: 1.2, pt: 0.2 }}>
        <Button
          onClick={onClose}
          aria-label="完成设置"
          variant="contained"
          sx={{
            borderRadius: '999px',
            px: 3,
            background: 'linear-gradient(180deg, #F9DF8B 0%, #F2C25E 55%, #E8A93E 100%)',
            color: SKIN.ink,
            fontWeight: 800,
            '&:hover': { filter: 'brightness(1.04)' },
          }}
        >
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}
