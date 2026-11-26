import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  IconButton,
  Tooltip,
  Chip,
} from '@mui/material';
import UndoIcon from '@mui/icons-material/Undo';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import RestartIcon from '@mui/icons-material/RestartAlt';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { useGameStore } from '../store/gameStore';
import { useSettings } from '../store/settings';
import type { Difficulty } from '../ai/types';
import { tierSpecOf } from '../ai/tierSpec';

/**
 * Four tiers, weakest -> strongest (Object.keys drives menu order).
 * v2026.11.19.6 re-benchmarks against 天天象棋:
 *   中级 ≈ 天天高级 · 高级 ≈ 天天精英 · 大师 ≈ 天天大师.
 * 常量本体移到 difficultyLabels.ts 供 AI 契约层复用；这里保留导出兼容既有调用。
 */
import { DIFFICULTY_LABELS } from './difficultyLabels';
export { DIFFICULTY_LABELS } from './difficultyLabels';

/** Control panel: difficulty selection + sound toggle + game actions. */
export function ControlPanel() {
  const newGame = useGameStore((s) => s.newGame);
  const undo = useGameStore((s) => s.undo);
  const requestHint = useGameStore((s) => s.requestHint);
  const requestReplay = useGameStore((s) => s.requestReplay);
  const thinking = useGameStore((s) => s.thinking);
  const canUndo = useGameStore((s) => s.undoStack.length > 0);
  const reviewing = useGameStore((s) => s.reviewIndex !== null);
  const status = useGameStore((s) => s.game.status);

  const difficulty = useSettings((s) => s.difficulty);
  const setDifficulty = useSettings((s) => s.setDifficulty);
  const soundEnabled = useSettings((s) => s.soundEnabled);
  const setSoundEnabled = useSettings((s) => s.setSoundEnabled);

  const gameOver =
    status === 'checkmate' ||
    status === 'stalemate' ||
    status === 'draw' ||
    status === 'perpetual';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <FormControl size="small" fullWidth>
        <InputLabel id="difficulty-label">AI 难度</InputLabel>
        <Select
          labelId="difficulty-label"
          label="AI 难度"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as Difficulty)}
        >
          {(Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => {
            const spec = tierSpecOf(d);
            return (
              <MenuItem key={d} value={d} data-testid={`difficulty-${d}`}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                  <span>{DIFFICULTY_LABELS[d]}</span>
                  <Tooltip title={spec.tooltip}>
                    <Chip size="small" label={spec.badge} sx={{ height: 20, fontSize: 10.5 }} />
                  </Tooltip>
                </Box>
              </MenuItem>
            );
          })}
        </Select>
      </FormControl>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Tooltip title={soundEnabled ? '关闭音效' : '开启音效'}>
          <IconButton
            onClick={() => setSoundEnabled(!soundEnabled)}
            color="primary"
            aria-label="切换音效"
          >
            {soundEnabled ? <VolumeUpIcon /> : <VolumeOffIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="contained" startIcon={<RestartIcon />} onClick={newGame}>
          新对局
        </Button>
        <Button
          variant="outlined"
          startIcon={<UndoIcon />}
          onClick={undo}
          disabled={!canUndo || thinking || reviewing}
        >
          悔棋
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" startIcon={<LightbulbIcon />} onClick={requestHint} disabled={thinking || gameOver || reviewing}>
          提示
        </Button>
        <Button variant="outlined" startIcon={<MenuBookIcon />} onClick={requestReplay} disabled={gameOver || reviewing}>
          复盘
        </Button>
      </Stack>
    </Box>
  );
}
