import { useState } from 'react';
import { Box, Paper, Stack, Typography, Button } from '@mui/material';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import { useGameStore, boardAt } from '../store/gameStore';
import { useSettings } from '../store/settings';
import { generateLegalMoves } from '../engine/rules';
import type { Pos } from '../engine/types';
import { samePos } from '../engine/types';
import type { Move } from '../engine/types';
import { Board } from './Board';
import { ControlPanel } from './ControlPanel';
import { MoveList } from './MoveList';
import { HintBox } from './HintBox';
import { ReplayView } from './ReplayView';

function statusText(status: string, turn: string): string {
  if (status === 'checkmate') return turn === 'red' ? '黑方胜（将死红方）' : '红方胜（将死黑方）';
  if (status === 'stalemate') return turn === 'red' ? '黑方胜（困毙红方）' : '红方胜（困毙黑方）';
  if (status === 'perpetual') return turn === 'red' ? '红方胜（对方长将判负）' : '黑方胜（对方长将判负）';
  if (status === 'draw') return '和棋';
  if (status === 'check') return turn === 'red' ? '红方被将军！' : '黑方被将军！';
  return turn === 'red' ? '轮到你（红方）走棋' : '黑方思考中…';
}

/** Builds a plain-text Chinese notation score sheet, e.g. "1. 炮二平五 马8进7". */
function buildNotationText(history: Move[]): string {
  const lines: string[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const red = history[i]?.notation ?? '';
    const black = history[i + 1]?.notation ?? '';
    lines.push(`${i / 2 + 1}. ${red}${black ? ' ' + black : ''}`);
  }
  return lines.join('\n');
}

/** Downloads (or copies) the current game's notation as a .txt file. */
function exportNotation(history: Move[]): void {
  const text = buildNotationText(history);
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '棋谱.txt';
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    // Fallback: copy to clipboard where downloads are unavailable.
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
  }
}

/** Main play page: board + control panel + move list + hint + replay. */
export function GamePage() {
  const boardTheme = useSettings((s) => s.boardTheme);
  const effects = useSettings((s) => s.effects);
  const game = useGameStore((s) => s.game);
  const thinking = useGameStore((s) => s.thinking);
  const hint = useGameStore((s) => s.hint);
  const replay = useGameStore((s) => s.replay);
  const reviewIndex = useGameStore((s) => s.reviewIndex);
  const setReviewIndex = useGameStore((s) => s.setReviewIndex);
  const exitReview = useGameStore((s) => s.exitReview);
  const playerMove = useGameStore((s) => s.playerMove);
  const clearReplay = useGameStore((s) => s.clearReplay);

  const [selected, setSelected] = useState<Pos | null>(null);
  const [legalTargets, setLegalTargets] = useState<Pos[]>([]);

  const isReviewing = reviewIndex !== null;
  const displayState = isReviewing ? boardAt(game.history, reviewIndex) : game;
  const liveLastMove = game.history.length
    ? { from: game.history[game.history.length - 1].from, to: game.history[game.history.length - 1].to }
    : null;
  const reviewLastMove = isReviewing
    ? { from: game.history[reviewIndex].from, to: game.history[reviewIndex].to }
    : null;
  const lastMove = isReviewing ? reviewLastMove : liveLastMove;

  const canInteract =
    !isReviewing && !thinking && game.turn === 'red' && (game.status === 'playing' || game.status === 'check');

  const onSquareClick = (col: number, row: number) => {
    if (!canInteract) return;
    const pos: Pos = { col, row };
    const piece = game.board.getPiece(pos);

    if (selected) {
      if (legalTargets.some((t) => t.col === col && t.row === row)) {
        playerMove(selected, pos);
        setSelected(null);
        setLegalTargets([]);
        return;
      }
      if (piece && piece.side === 'red') {
        setSelected(pos);
        setLegalTargets(
          generateLegalMoves(game.board, 'red')
            .filter((m) => samePos(m.from, pos))
            .map((m) => m.to),
        );
      } else {
        setSelected(null);
        setLegalTargets([]);
      }
      return;
    }

    if (piece && piece.side === 'red') {
      setSelected(pos);
      setLegalTargets(
        generateLegalMoves(game.board, 'red')
          .filter((m) => samePos(m.from, pos))
          .map((m) => m.to),
      );
    }
  };

  const gameOver =
    game.status === 'checkmate' ||
    game.status === 'stalemate' ||
    game.status === 'draw' ||
    game.status === 'perpetual';
  const total = game.history.length;
  const cur = reviewIndex ?? total - 1;

  const reviewControls = total > 0 && (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
      <Button size="small" variant="text" onClick={() => setReviewIndex(0)} disabled={cur <= 0}>
        ⏮ 起点
      </Button>
      <Button size="small" variant="text" onClick={() => setReviewIndex(Math.max(0, cur - 1))} disabled={cur <= 0}>
        ‹ 上一步
      </Button>
      <Typography variant="body2" sx={{ minWidth: 64, textAlign: 'center' }}>
        {isReviewing ? `第 ${cur + 1}/${total} 步` : `最新 ${total} 步`}
      </Typography>
      <Button size="small" variant="text" onClick={() => setReviewIndex(Math.min(total - 1, cur + 1))} disabled={cur >= total - 1}>
        下一步 ›
      </Button>
      <Button size="small" variant="text" onClick={() => setReviewIndex(total - 1)} disabled={cur >= total - 1}>
        终点 ⏭
      </Button>
      {isReviewing && (
        <Button size="small" variant="contained" color="warning" onClick={exitReview}>
          退出回放
        </Button>
      )}
    </Stack>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: { xs: 1.5, md: 3 }, alignItems: { xs: 'center', md: 'flex-start' }, justifyContent: 'center', width: '100%' }}>
      <Box sx={{ width: { xs: '100%', md: 'auto' }, maxWidth: '100%' }}>
        <Board
          board={displayState.board}
          selected={isReviewing ? null : selected}
          legalTargets={isReviewing ? [] : legalTargets}
          lastMove={lastMove}
          hint={isReviewing ? null : hint?.move ?? null}
          boardThemeId={boardTheme}
          effects={effects}
          interactive={canInteract}
          onSquareClick={onSquareClick}
        />
        <Typography variant="subtitle1" sx={{ mt: 1, textAlign: 'center', fontWeight: 700 }}>
          {statusText(displayState.status, displayState.turn)}
        </Typography>
        {reviewControls}
      </Box>

      <Stack spacing={2} sx={{ width: { xs: '100%', md: 300 } }}>
        <ControlPanel />
        <HintBox hint={hint} />
        <Paper elevation={1} sx={{ p: 1.5, maxHeight: 300, overflow: 'auto' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              着法记录
            </Typography>
            <Button
              size="small"
              startIcon={<FileDownloadIcon />}
              onClick={() => exportNotation(game.history)}
              disabled={total === 0}
            >
              导出棋谱
            </Button>
          </Box>
          <MoveList history={game.history} reviewIndex={reviewIndex} onMoveClick={setReviewIndex} />
        </Paper>
      </Stack>

      {gameOver && replay && <ReplayView annotations={replay} history={game.history} onClose={clearReplay} />}
    </Box>
  );
}
