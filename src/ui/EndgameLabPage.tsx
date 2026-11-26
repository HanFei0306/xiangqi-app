/**
 * 残局推演 · 自摆残局页面（v2026.11.23.9）。
 *
 * 用户原话拆成的四条硬需求：
 *   1. 棋子放在**棋盘下方**的托盘里：点一次棋子（选中高亮）→ 再点棋盘上的
 *      位置，该子落在此格；
 *   2. 放错了能删掉重摆：托盘末尾的「橡皮」进入擦除模式，再点棋盘上的棋子
 *      即删除；放错位置也可以直接覆盖（同色同型或别的子都能盖）；
 *   3. 摆好后点「完毕」进入推演——推演逻辑（自己下 / 让 AI 推演）全部由现有
 *      推演页负责，本页只交出起始 `GameState`；
 *   4. 顶部有主页按钮（复用 `HomeButton`），回主页不结束任何进程。
 *
 * 视觉硬约束（v2026.11.25.1 墨玉鎏金统一）：取色全部收敛到 `SKIN` 语义色板——
 *   深底文字 SKIN.text/textSecondary/textMuted、金色强调 SKIN.gold/goldDeep、
 *   卡片 SKIN.surface/surfaceStrong + 1px SKIN.border + SKIN_RADIUS；
 *   米色托盘面板上的深色字只用 SKIN.ink/ink2/ink3。
 *
 * 离线约束：零网络请求，无远程字体、无远程图片。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Alert, Box, Button, Chip, Typography } from '@mui/material';
import type { GameState, Piece as PieceModel, PieceType, Pos, Side } from '../engine/types';
import type { Board as BoardModel } from '../engine/board';
import { PIECE_DISPLAY } from '../engine/pieces';
import { useSettings } from '../store/settings';
import {
  LAB_UNDO_LIMIT,
  TRAY_LIMITS,
  TRAY_ORDER,
  TRAY_SIDES,
  buildLabState,
  countOnBoard,
  emptyLabBoard,
  erasePiece,
  loadLabDraft,
  placePiece,
  saveLabDraft,
} from '../endgame/labModel';
import { Board } from './Board';
import { HomeButton } from './HomeButton';
import { Piece } from './Piece';
import {
  CALLIGRAPHY_FONT,
  GOLD_BUTTON_BG,
  SKIN,
  SKIN_RADIUS,
  getBoardTheme,
  getEnv,
} from './theme';

export interface EndgameLabPageProps {
  /** 回主页 */
  onHome: () => void;
  /** 点「完毕」且局面合法后，把起始局面交给推演页 */
  onStartSimulation: (state: GameState) => void;
}

/** 棋盘永远不显示选中圈 / 可走点 / 上一步 / 提示（摆棋阶段没有这些概念）。 */
const NO_TARGETS: Pos[] = [];
/** 托盘棋子的边长（390px 宽下一行 7 枚仍有余量）。 */
const TRAY_PIECE_SIZE = 34;

/**
 * 自摆残局页。
 *
 * 单一真源是页面自身的 `board` + `turn`：每次编辑都同步写 localStorage，
 * 挂载时恢复上一次摆的局面（"进程可搁置"的一部分）。
 */
export function EndgameLabPage({ onHome, onStartSimulation }: EndgameLabPageProps): JSX.Element {
  const boardThemeId = useSettings((s) => s.boardTheme);
  // env 永不缺字段，这里的兜底只为防御未来主题表被改坏。
  const env = getEnv(boardThemeId);
  const pageBg: string = env?.matchBg ? env.matchBg : SKIN.pageBg;
  const skin = getBoardTheme(boardThemeId).piece;

  const [board, setBoard] = useState(() => emptyLabBoard());
  const [turn, setTurn] = useState<Side>('red');
  /** 托盘里被选中的棋子；null = 没有选中。 */
  const [selected, setSelected] = useState<PieceModel | null>(null);
  /** 擦除模式：点棋盘上的棋子即删除。 */
  const [erasing, setErasing] = useState<boolean>(false);
  /** 校验失败的中文错误（MUI Alert 列出，不弹窗打断）。 */
  const [errors, setErrors] = useState<string[]>([]);
  /** 一次性提示（清空 / 撤销 / 已放满等轻反馈）。 */
  const [notice, setNotice] = useState<string>('');
  /** 撤销栈（存盘面快照），栈深单独用 state 驱动按钮可用态。 */
  const undoStack = useRef<BoardModel[]>([]);
  const [undoDepth, setUndoDepth] = useState<number>(0);

  // 挂载时恢复上次摆的局面。只在这里读一次，之后的写入都在编辑动作里。
  useEffect(() => {
    const draft = loadLabDraft();
    if (draft) {
      setBoard(draft.board);
      setTurn(draft.turn);
    }
  }, []);

  const counts = useMemo(() => countOnBoard(board), [board]);

  /** 把一份盘面快照压进撤销栈（超过上限丢最旧的）。 */
  const pushUndo = useCallback((snapshot: BoardModel) => {
    const stack = undoStack.current;
    stack.push(snapshot.clone());
    if (stack.length > LAB_UNDO_LIMIT) stack.shift();
    setUndoDepth(stack.length);
  }, []);

  /** 提交盘面：更新视图 + 落盘 + 清掉上一次的校验错误。 */
  const commit = useCallback((next: BoardModel, nextTurn: Side) => {
    setBoard(next);
    saveLabDraft(next, nextTurn);
    setErrors([]);
  }, []);

  const handleTraySelect = useCallback(
    (side: Side, type: PieceType) => {
      if (counts[side][type] >= TRAY_LIMITS[type]) {
        setNotice(`${PIECE_DISPLAY[side][type]} 已放满 ${TRAY_LIMITS[type]} 枚`);
        return;
      }
      setErasing(false);
      setNotice('');
      setSelected((prev: PieceModel | null) =>
        prev && prev.side === side && prev.type === type ? null : { side, type });
    },
    [counts],
  );

  const handleEraseToggle = useCallback(() => {
    setSelected(null);
    setNotice('');
    setErasing((prev: boolean) => !prev);
  }, []);

  const handleSquareClick = useCallback(
    (col: number, row: number) => {
      const pos: Pos = { col, row };
      const existing: PieceModel | null = board.getPiece(pos);

      // ① 擦除模式：点空格的哑操作不记撤销栈，避免"撤销"空转。
      if (erasing) {
        if (!existing) return;
        pushUndo(board);
        commit(erasePiece(board, pos), turn);
        setNotice(`已擦除 (${col + 1},${row + 1}) 的棋子`);
        return;
      }

      // ② 没选棋子时点棋盘不产生任何编辑（摆棋阶段不做选子走子）。
      if (!selected) return;

      // ③ 点在同一枚同色同型的棋子上是哑操作。
      if (existing && existing.side === selected.side && existing.type === selected.type) {
        return;
      }

      const used: number = counts[selected.side][selected.type];
      if (used >= TRAY_LIMITS[selected.type]) {
        setNotice(`${PIECE_DISPLAY[selected.side][selected.type]} 已放满 ${TRAY_LIMITS[selected.type]} 枚`);
        setSelected(null);
        return;
      }

      pushUndo(board);
      commit(placePiece(board, pos, selected), turn);
      setNotice(`( ${col + 1},${row + 1} ) 落 ${PIECE_DISPLAY[selected.side][selected.type]}`);
      // 该型放满后自动收起选中态，避免用户点了没反应。
      if (used + 1 >= TRAY_LIMITS[selected.type]) setSelected(null);
    },
    [board, commit, counts, erasing, pushUndo, selected, turn],
  );

  const handleTurn = useCallback((side: Side) => {
    setTurn(side);
    saveLabDraft(board, side);
    setErrors([]);
  }, [board]);

  const handleUndo = useCallback(() => {
    const stack = undoStack.current;
    const previous: BoardModel | undefined = stack.pop();
    setUndoDepth(stack.length);
    if (!previous) return;
    setBoard(previous);
    saveLabDraft(previous, turn);
    setErrors([]);
    setNotice('已撤销一步');
  }, [turn]);

  const handleClear = useCallback(() => {
    if (board.isEmpty()) {
      setNotice('棋盘已经是空的');
      return;
    }
    pushUndo(board);
    const next: BoardModel = emptyLabBoard();
    setBoard(next);
    saveLabDraft(next, turn);
    setErrors([]);
    setSelected(null);
    setNotice('已清空棋盘，点「撤销一步」可以恢复');
  }, [board, pushUndo, turn]);

  const handleFinish = useCallback(() => {
    const result = buildLabState(board, turn);
    if (!result.ok) {
      setErrors(result.errors);
      setNotice('');
      return;
    }
    setErrors([]);
    setNotice('');
    onStartSimulation(result.state);
  }, [board, onStartSimulation, turn]);

  const trayRow = (side: Side): JSX.Element => (
    <Box
      key={side}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        width: '100%',
        minWidth: 0,
        mt: side === 'red' ? 0.6 : 0.8,
      }}
    >
      {TRAY_ORDER.map((type: PieceType) => {
        const used: number = counts[side][type];
        const limit: number = TRAY_LIMITS[type];
        const exhausted: boolean = used >= limit;
        const picked: boolean = !!selected && selected.side === side && selected.type === type;
        const name: string = PIECE_DISPLAY[side][type];
        return (
          <Button
            key={`${side}-${type}`}
            data-testid={`lab-tray-${side}-${type}`}
            aria-label={`${side === 'red' ? '红' : '黑'}${name} 已放 ${used} / ${limit}`}
            aria-disabled={exhausted ? 'true' : 'false'}
            aria-pressed={picked ? 'true' : 'false'}
            disableRipple
            disableElevation
            onClick={() => handleTraySelect(side, type)}
            sx={{
              flex: '1 1 0',
              minWidth: 0,
              p: 0.25,
              m: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0,
              textTransform: 'none',
              background: picked ? 'rgba(231,197,126,0.22)' : 'transparent',
              borderRadius: SKIN_RADIUS,
              border: picked ? `2px solid ${SKIN.gold}` : '2px solid transparent',
              boxShadow: picked ? '0 0 0 2px rgba(231,197,126,0.35)' : 'none',
              opacity: exhausted ? 0.34 : 1,
              cursor: exhausted ? 'not-allowed' : 'pointer',
              '&:hover': { background: exhausted ? 'transparent' : 'rgba(231,197,126,0.14)' },
            }}
          >
            <Piece piece={{ side, type }} size={TRAY_PIECE_SIZE} skin={skin} />
            <Box
              component="span"
              sx={{
                mt: '3px',
                fontSize: 11,
                lineHeight: 1.2,
                fontWeight: 700,
                color: SKIN.ink2,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {used}/{limit}
            </Box>
          </Button>
        );
      })}
    </Box>
  );

  const actionButtonSx = {
    minWidth: 0,
    px: 1.1,
    py: 0.35,
    borderRadius: '999px',
    fontSize: 12.5,
    fontWeight: 800,
    fontFamily: CALLIGRAPHY_FONT,
    letterSpacing: '0.04em',
    textTransform: 'none' as const,
    color: SKIN.text,
    background: SKIN.surface,
    border: `1px solid ${SKIN.border}`,
    boxShadow: 'inset 0 1px 0 rgba(255,246,220,0.18), 0 2px 5px rgba(0,0,0,0.35)',
    '&:hover': { background: 'rgba(231,197,126,0.22)' },
    '&:disabled': { color: SKIN.disabled, background: SKIN.pageDeep, borderColor: SKIN.border },
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        background: pageBg,
        color: SKIN.text,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        px: 1,
        py: 1,
        gap: 1,
      }}
    >
      {/* 顶部：主页出口 + 标题（深绿底一律浅色字） */}
      <Box
        sx={{
          width: '100%',
          maxWidth: 560,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          boxSizing: 'border-box',
        }}
      >
        <HomeButton onClick={onHome} tone="dark" size="sm" testId="lab-home" />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            noWrap
            sx={{
              fontFamily: CALLIGRAPHY_FONT,
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: '0.08em',
              color: SKIN.gold,
              lineHeight: 1.25,
            }}
          >
            残局推演 · 自摆残局
          </Typography>
          <Typography noWrap sx={{ fontSize: 11, color: SKIN.textSecondary }}>
            点托盘棋子 → 点棋盘落子
          </Typography>
        </Box>
      </Box>

      {/* 棋盘（红在下，flipped=false；摆棋阶段不画选中圈/走点） */}
      <Box
        sx={{
          width: '100%',
          maxWidth: 560,
          minWidth: 0,
          display: 'flex',
          justifyContent: 'center',
          boxSizing: 'border-box',
        }}
      >
        <Board
          board={board}
          selected={null}
          legalTargets={NO_TARGETS}
          lastMove={null}
          hint={null}
          boardThemeId={boardThemeId}
          interactive
          flipped={false}
          onSquareClick={handleSquareClick}
        />
      </Box>

      {/* 托盘：红一行、黑一行，米色面板上才允许用 ink 深色字 */}
      <Box
        sx={{
          width: '100%',
          maxWidth: 560,
          minWidth: 0,
          boxSizing: 'border-box',
          px: 1,
          py: 0.8,
          borderRadius: SKIN_RADIUS,
          background: env.panel,
          border: `1px solid ${SKIN.lightBorder}`,
          boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
          <Typography
            sx={{
              fontFamily: CALLIGRAPHY_FONT,
              fontSize: 12,
              fontWeight: 800,
              color: SKIN.ink,
              letterSpacing: '0.04em',
            }}
          >
            棋子托盘
          </Typography>
          <Typography sx={{ fontSize: 11, color: SKIN.ink3 }}>
            {erasing ? '擦除模式：点棋盘上的棋子即可删除' : '灰色表示该型已放满'}
          </Typography>
        </Box>
        {TRAY_SIDES.map((side: Side) => trayRow(side))}
      </Box>

      {/* 校验失败：列出全部条款错误，不弹窗打断 */}
      {errors.length > 0 && (
        <Alert
          severity="warning"
          data-testid="lab-validation"
          sx={{
            width: '100%',
            maxWidth: 560,
            boxSizing: 'border-box',
            py: 0.4,
            px: 1,
            alignItems: 'flex-start',
            fontSize: 12,
            lineHeight: 1.6,
            background: SKIN.surfaceStrong,
            color: SKIN.textSecondary,
            border: `1px solid ${SKIN.border}`,
            '& .MuiAlert-icon': { color: SKIN.gold, fontSize: 18, mt: '2px' },
            '& .MuiAlert-message': { minWidth: 0, py: 0.2 },
          }}
        >
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {errors.map((message: string, index: number) => (
              <li key={`${index}-${message}`}>{message}</li>
            ))}
          </Box>
        </Alert>
      )}

      {/* 轻反馈（清空 / 撤销 / 已放满） */}
      {notice !== '' && errors.length === 0 && (
        <Typography
          data-testid="lab-notice"
          sx={{
            width: '100%',
            maxWidth: 560,
            boxSizing: 'border-box',
            px: 0.5,
            fontSize: 11.5,
            color: SKIN.gold,
            fontFamily: CALLIGRAPHY_FONT,
          }}
        >
          {notice}
        </Typography>
      )}

      {/* 操作条：橡皮 / 撤销 / 清空 / 先手 / 完毕 */}
      <Box
        sx={{
          width: '100%',
          maxWidth: 560,
          minWidth: 0,
          boxSizing: 'border-box',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 0.7,
        }}
      >
        <Button
          data-testid="lab-erase"
          aria-pressed={erasing ? 'true' : 'false'}
          disableRipple
          disableElevation
          onClick={handleEraseToggle}
          sx={{
            ...actionButtonSx,
            color: erasing ? SKIN.ink : SKIN.text,
            background: erasing ? GOLD_BUTTON_BG : SKIN.surface,
            border: erasing ? `1px solid ${SKIN.goldDeep}` : SKIN.border,
            '&:hover': { background: erasing ? GOLD_BUTTON_BG : 'rgba(231,197,126,0.22)' },
          }}
        >
          橡皮
        </Button>
        <Button
          data-testid="lab-undo"
          disableRipple
          disableElevation
          disabled={undoDepth === 0}
          onClick={handleUndo}
          sx={actionButtonSx}
        >
          撤销一步
        </Button>
        <Button
          data-testid="lab-clear"
          disableRipple
          disableElevation
          onClick={handleClear}
          sx={actionButtonSx}
        >
          清空
        </Button>

        <Chip
          data-testid="lab-turn-red"
          label="红先"
          size="small"
          onClick={() => handleTurn('red')}
          aria-pressed={turn === 'red' ? 'true' : 'false'}
          sx={{
            height: 26,
            fontFamily: CALLIGRAPHY_FONT,
            fontSize: 12,
            fontWeight: 800,
            color: turn === 'red' ? SKIN.ink : SKIN.text,
            background: turn === 'red' ? GOLD_BUTTON_BG : SKIN.surface,
            border: `1px solid ${turn === 'red' ? SKIN.goldDeep : SKIN.border}`,
            '& .MuiChip-label': { px: 1.1 },
          }}
        />
        <Chip
          data-testid="lab-turn-black"
          label="黑先"
          size="small"
          onClick={() => handleTurn('black')}
          aria-pressed={turn === 'black' ? 'true' : 'false'}
          sx={{
            height: 26,
            fontFamily: CALLIGRAPHY_FONT,
            fontSize: 12,
            fontWeight: 800,
            color: turn === 'black' ? SKIN.ink : SKIN.text,
            background: turn === 'black' ? GOLD_BUTTON_BG : SKIN.surface,
            border: `1px solid ${turn === 'black' ? SKIN.goldDeep : SKIN.border}`,
            '& .MuiChip-label': { px: 1.1 },
          }}
        />

        <Box sx={{ flex: 1, minWidth: 0 }} />

        <Button
          data-testid="lab-finish"
          disableRipple
          disableElevation
          onClick={handleFinish}
          sx={{
            minWidth: 96,
            px: 2,
            py: 0.5,
            borderRadius: '999px',
            background: GOLD_BUTTON_BG,
            color: SKIN.ink,
            fontSize: 14,
            fontWeight: 900,
            fontFamily: CALLIGRAPHY_FONT,
            letterSpacing: '0.12em',
            textTransform: 'none',
            border: `1px solid ${SKIN.goldDeep}`,
            boxShadow: '0 3px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.7)',
            '&:hover': { background: GOLD_BUTTON_BG, filter: 'brightness(1.05)' },
          }}
        >
          完毕
        </Button>
      </Box>

      <Typography
        sx={{
          width: '100%',
          maxWidth: 560,
          boxSizing: 'border-box',
          fontSize: 11,
          lineHeight: 1.7,
          color: SKIN.textMuted,
          fontFamily: CALLIGRAPHY_FONT,
        }}
      >
        摆好残局点「完毕」进入推演：可以自己接着下，也可以让 AI 推演。
      </Typography>
    </Box>
  );
}
