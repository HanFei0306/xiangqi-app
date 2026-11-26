/**
 * 对局结束技术统计 + 记谱保存弹窗（v2026.11.21.8）。
 * 对局结束自动弹出：步数 / 用时 / 失误 / 漏杀；
 * 日期时间自动填入棋谱名，一键保存本局为棋谱，之后可在「记谱」里回放。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Dialog, DialogContent, DialogTitle, DialogActions,
  TextField, Typography, Chip,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import type { GameState, Move, Side } from '../engine/types';
import type { ReplayAnnotation } from '../training/types';
import { buildMatchSummary, type MatchSummaryData } from '../training/matchStats';
import { saveNotation } from '../data/notation-storage';
import { CALLIGRAPHY_FONT, SKIN, SKIN_RADIUS } from './theme';

interface Props {
  open: boolean;
  history: Move[];
  annotations: ReplayAnnotation[];
  playerSide: Side;
  elapsedSec: number;
  resultLabel?: string;
  onClose: () => void;
  onReviewMiss: (state: GameState, killerNotation: string) => void;
}

function defaultName(): string {
  const d = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `对局 ${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MatchSummaryPanel({
  open, history, annotations, playerSide, elapsedSec, resultLabel, onClose, onReviewMiss,
}: Props) {
  const data: MatchSummaryData = useMemo(
    () => buildMatchSummary(history, annotations, playerSide),
    [history, annotations, playerSide],
  );
  const mins = Math.floor(elapsedSec / 60);
  const secs = Math.round(elapsedSec % 60);
  const [name, setName] = useState(defaultName);
  const [saved, setSaved] = useState(false);

  // 弹窗每次打开重置名称与保存态。
  useEffect(() => { if (open) { setName(defaultName()); setSaved(false); } }, [open]);

  const doSave = () => {
    if (history.length === 0 || saved) return;
    saveNotation({
      name: name.trim() || defaultName(),
      setup: '', // 标准开局
      moves: history,
    });
    setSaved(true);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontFamily: CALLIGRAPHY_FONT, textAlign: 'center' }}>
        对局结束 · 技术统计与记谱
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 1 }}>
          <StatCard label="总步数" value={`${data.plies}`} />
          <StatCard label="用时" value={`${mins}分${secs}秒`} />
          <StatCard label="失误" value={`${data.blunders}`} />
        </Box>
        {resultLabel && (
          <Box sx={{ textAlign: 'center', mb: 1.5 }}>
            <Chip size="small" label={resultLabel} sx={{ color: SKIN.gold, borderColor: SKIN.border }} variant="outlined" />
          </Box>
        )}

        {/* 记谱保存：日期时间已自动填入名称 */}
        <Box sx={{ p: 1.2, borderRadius: 2, border: '0.5px solid', borderColor: 'divider', mb: 2 }}>
          <Typography sx={{ fontFamily: CALLIGRAPHY_FONT, fontWeight: 700, fontSize: 14, mb: 0.8 }}>
            保存这盘棋谱
          </Typography>
          <TextField
            fullWidth size="small" label="棋谱名称（日期时间已自动填入）"
            value={name} onChange={(e) => setName(e.target.value)} disabled={saved}
          />
          <Button
            fullWidth variant="contained" startIcon={<SaveIcon />}
            onClick={doSave} disabled={saved || history.length === 0} sx={{ mt: 1 }}
          >
            {saved ? '已保存到记谱本' : '保存棋谱'}
          </Button>
          <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.8 }}>
            保存后可在首页「记谱 · 棋谱本」里点击回放整局。
          </Typography>
        </Box>

        <Typography sx={{ fontFamily: CALLIGRAPHY_FONT, fontWeight: 700, fontSize: 15, mb: 1 }}>
          漏杀分析（{data.missedMates.length}）
        </Typography>
        {data.missedMates.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            本局没有漏掉一步杀的好机会，很好。
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {data.missedMates.map((mm) => (
              <Box key={mm.ply} sx={{ p: 1.2, border: '0.5px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Typography sx={{ fontSize: 13 }}>
                  第 {mm.ply + 1} 手：当时走了「{mm.played}」，错过了一步杀
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.4 }}>
                  提示：正确杀着是「{mm.killer}」——先观察对方将帅的防线，找连续将军或抽子的强制手段。
                </Typography>
                <Button size="small" variant="contained" sx={{ mt: 1 }}
                  onClick={() => onReviewMiss(mm.state, mm.killer)}>
                  进入推演，重走这一手
                </Button>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>完成</Button></DialogActions>
    </Dialog>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  // v2026.11.25.1：旧 var(--color-background-secondary) 变量并不存在（回退透明），
  // 改用 SKIN.surface 实底 + 金描边，浅字压暗面。
  return (
    <Box
      sx={{
        background: SKIN.surface,
        border: `1px solid ${SKIN.border}`,
        borderRadius: SKIN_RADIUS,
        p: 1.2,
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontSize: 12, color: SKIN.textSecondary }}>{label}</Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 600, color: SKIN.text }}>{value}</Typography>
    </Box>
  );
}
