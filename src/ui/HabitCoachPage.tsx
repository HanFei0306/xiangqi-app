/**
 * 学棋 · 好习惯页面（v2026.11.25.1 墨玉鎏金统一版）。
 *
 * 把网上总结的"高手习惯"做成可操作的几张卡：
 *   1. 走棋三问 —— 落子前停 3 秒，问目的 / 对手应手 / 我的后续；
 *   2. 拒绝随手棋 —— 复盘统计 + 为什么会输；
 *   3. 破解杀招 —— 真实残局演练，识别对手威胁并学破解；
 *   4. 习惯档案 —— 失误聚类统计（预警雷达）；
 *   5. 今日针对性练习 —— 只练你犯过的错。
 *
 * 视觉（v2026.11.25.1）：与其他页统一为「墨玉鎏金」深底皮肤——
 * 取色全部收敛到 `SKIN` 语义色板：卡片 = SKIN.surface + 1px SKIN.border
 * 金描边 + SKIN_RADIUS 圆角，层级用 SKIN.surfaceStrong 区分；
 * 警示文字用 SKIN.danger（旧 #A8322A 对深底对比不足，禁止再用）。
 *
 * 离线约束：零网络请求，无远程字体、无远程图片。
 */
import { useMemo, useState } from 'react';
import { Box, Button, Chip, Paper, Typography } from '@mui/material';
import type { GameState, Move, Pos } from '../engine/types';
import { samePos } from '../engine/types';
import { Board as BoardModel } from '../engine/board';
import { makeMove, generateLegalMoves } from '../engine/rules';
import { PIECE_SETUP_CHAR } from '../engine/pieces';
import { SHIQINGYAQU } from '../data/shiqingyaqu';
import { loadLessons, type LessonKind, type LessonRecord } from '../data/lesson-storage';
import { HomeButton } from './HomeButton';
import {
  threeStepPrompt,
  judgeMoveQuality,
  getLessonSnapshot,
  scanThreats,
  clusterLessons,
  pickDrills,
  loadDrillBoard,
  solutionForDrill,
  type MoveQuality,
  type Drill,
} from '../training/habitCoach';
import { useGameStore } from '../store/gameStore';
import { Board as BoardView } from './Board';
import { CALLIGRAPHY_FONT, GOLD_BUTTON_BG, SKIN, SKIN_RADIUS } from './theme';

/** 卡片统一外观：表面底 + 金描边 + 统一圆角。 */
const cardSx = {
  p: 2,
  borderRadius: SKIN_RADIUS,
  background: SKIN.surface,
  border: `1px solid ${SKIN.border}`,
  boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
} as const;

/** 卡内标题统一：书法字 + 金色。 */
function CardTitle({ children }: { children: string }) {
  return (
    <Typography sx={{ fontFamily: CALLIGRAPHY_FONT, fontSize: 18, fontWeight: 800, color: SKIN.gold }}>
      {children}
    </Typography>
  );
}

/** 卡内次级块统一：更实的表面底 + 金描边左缘。 */
const innerBoxSx = {
  p: 1,
  bgcolor: SKIN.surfaceStrong,
  borderRadius: 1,
  border: `1px solid ${SKIN.border}`,
  borderLeft: `3px solid ${SKIN.goldDeep}`,
} as const;

interface Props {
  onBack: () => void;
}

/** 三问引导：给当前局面，玩家切换"想走的着法"看三步推演。 */
function ThreeQuestionCard() {
  const demo: GameState = useMemo(() => {
    const board = BoardModel.fromNotationSetup(SHIQINGYAQU[0].setup);
    return { board, turn: 'red', history: [], status: 'playing', moveCount: 0 };
  }, []);
  const choices = useMemo(() => {
    const moves = generateLegalMoves(demo.board, 'red');
    // 取前 6 个作为示例着法（真实对局里玩家是自己选）。
    return moves.slice(0, 6);
  }, [demo]);
  const [idx, setIdx] = useState(0);
  const move: Move | null = choices[idx] ?? null;
  const steps = threeStepPrompt(demo, move);
  const quality: MoveQuality | null = move ? judgeMoveQuality(demo, move) : null;

  return (
    <Paper elevation={0} sx={cardSx}>
      <CardTitle>一、走棋三问 · 落子前停三秒</CardTitle>
      <Typography sx={{ fontSize: 12.5, color: SKIN.textSecondary, mt: 0.6, lineHeight: 1.7 }}>
        高手每步都先算清楚：这步的目的是什么？对手会怎么应？应对后我下一手怎么办？
        先在心里想好，再落子。下面用《适情雅趣》第一局做示范，点选不同着法看推演。
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', mt: 1.2 }}>
        {choices.map((m, i) => (
          <Chip
            key={i}
            label={m.notation || `${m.piece}${m.to.col + 1}`}
            size="small"
            onClick={() => setIdx(i)}
            sx={{
              fontFamily: CALLIGRAPHY_FONT,
              color: i === idx ? SKIN.ink : SKIN.textSecondary,
              background: i === idx ? GOLD_BUTTON_BG : SKIN.surfaceStrong,
              border: `1px solid ${i === idx ? SKIN.goldDeep : SKIN.border}`,
            }}
          />
        ))}
      </Box>
      <Box sx={{ mt: 1.2, display: 'flex', flexDirection: 'column', gap: 0.8 }}>
        <Typography sx={{ fontSize: 13, color: SKIN.text }}>① 目的：{steps.purpose}</Typography>
        <Typography sx={{ fontSize: 13, color: SKIN.text }}>② 对手应手：{steps.reply}</Typography>
        <Typography sx={{ fontSize: 13, color: SKIN.text }}>③ 我的后续：{steps.follow}</Typography>
      </Box>
      {quality && (
        <Typography sx={{ fontSize: 12, color: quality.sloppy ? SKIN.danger : SKIN.gold, mt: 1 }}>
          着法体检：{quality.comment}
        </Typography>
      )}
    </Paper>
  );
}

/** 拒绝随手棋：说明 + 本地统计。 */
function SloppyCard() {
  const snapshot = getLessonSnapshot();
  return (
    <Paper elevation={0} sx={cardSx}>
      <CardTitle>二、拒绝随手棋 · 复盘找漏招</CardTitle>
      <Typography sx={{ fontSize: 12.5, color: SKIN.textSecondary, mt: 0.6, lineHeight: 1.7 }}>
        业 5 以下的失利，八成来自不假思索的随手棋。看到能吃就吃，只看眼前一步，
        不算对手反击。每盘结束复盘，重点标注"没多想就走"的棋，想想换一种走法会怎样。
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.2, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label={`已记录臭招 ${snapshot.blunders} 手`}
          sx={{ bgcolor: SKIN.surfaceStrong, color: SKIN.danger, border: `1px solid ${SKIN.border}` }}
        />
        <Chip
          size="small"
          label={`漏杀 ${snapshot.missedMates} 次`}
          sx={{ bgcolor: SKIN.surfaceStrong, color: SKIN.textSecondary, border: `1px solid ${SKIN.border}` }}
        />
        <Chip
          size="small"
          label={`好棋 ${snapshot.good} 手`}
          sx={{ bgcolor: SKIN.surfaceStrong, color: SKIN.gold, border: `1px solid ${SKIN.border}` }}
        />
      </Box>
      <Typography sx={{ fontSize: 11.5, color: SKIN.textMuted, mt: 1 }}>
        这些数字来自你每局结束后的自动复盘，在对局中正常下棋即可积累。
      </Typography>
    </Paper>
  );
}

/** 破解杀招：用真实残局识别对手威胁并给出破解。 */
function ThreatCard() {
  const puzzle = SHIQINGYAQU[0];
  const state: GameState = useMemo(() => ({
    board: BoardModel.fromNotationSetup(puzzle.setup),
    turn: 'red', history: [], status: 'playing', moveCount: 0,
  }), [puzzle]);
  const threats = useMemo(() => {
    // 动态导入逻辑：这里直接用已实现的扫描函数。
    return scanThreats(state);
  }, [state]);
  const [revealed, setRevealed] = useState(false);

  return (
    <Paper elevation={0} sx={cardSx}>
      <CardTitle>三、破解杀招 · 看懂对手想干什么</CardTitle>
      <Typography sx={{ fontSize: 12.5, color: SKIN.textSecondary, mt: 0.6, lineHeight: 1.7 }}>
        对手走一步前先问：如果他不管，下一步能干嘛？看阵型 → 找威胁 → 反推目的。
        下面这局，轮到你走，AI 已扫出对手的威胁。先自己想想怎么破，再点开答案。
      </Typography>
      <Typography sx={{ fontSize: 12, color: SKIN.textMuted, mt: 1, fontStyle: 'italic' }}>
        局面：《适情雅趣》第一局「{puzzle.title}」· 红先
      </Typography>
      <Button
        variant="contained"
        size="small"
        onClick={() => setRevealed((v) => !v)}
        disableElevation
        sx={{
          mt: 1,
          background: GOLD_BUTTON_BG,
          color: SKIN.ink,
          fontWeight: 800,
          border: `1px solid ${SKIN.goldDeep}`,
          '&:hover': { background: GOLD_BUTTON_BG, filter: 'brightness(1.05)' },
        }}
      >
        {revealed ? '收起答案' : '显示威胁与破解'}
      </Button>
      {revealed && (
        <Box sx={{ mt: 1.2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {threats.length === 0 && (
            <Typography sx={{ fontSize: 13, color: SKIN.text }}>这个局面暂无 immediate 杀招，可放心出子。</Typography>
          )}
          {threats.map((t, i) => (
            <Box key={i} sx={innerBoxSx}>
              <Typography sx={{ fontSize: 13, color: SKIN.text, fontWeight: 600 }}>
                威胁 {i + 1}（{t.kind === 'mate' ? '杀棋' : t.kind === 'capture' ? '吃子' : '将军'}）：{t.description}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: SKIN.gold, mt: 0.4 }}>
                破解：{t.defenseNote}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

/** lesson.kind 的中文名（档案表展示用）。 */
const LESSON_LABELS: Readonly<Record<LessonKind, string>> = {
  'blunder': '大漏',
  'missed-mate': '漏杀',
  'good': '好棋',
  'hang-piece': '送子',
  'slow-develop': '出子慢',
  'king-unsafe': '帅位不安',
  'bad-trade': '兑子不利',
  'slow-move': '缓手',
  'missed-win': '痛失好局',
};

/** 把任意可加载局面转成 loadPuzzle 期望的 rows 格式，复用现有校验/加载链路。 */
function toRowsSetup(board: BoardModel): string {
  const rows: string[] = [];
  for (let row = 0; row < 10; row++) {
    const cells: string[] = [];
    for (let col = 0; col < 9; col++) {
      const piece = board.getPiece({ col, row });
      cells.push(piece ? PIECE_SETUP_CHAR[piece.side][piece.type] : '.');
    }
    rows.push(cells.join(','));
  }
  return rows.join('/');
}

/** 习惯档案：按失误类型聚类，显示次数 / 平均 drop / 近 N 局趋势。 */
function ArchiveCard() {
  const lessons: LessonRecord[] = useMemo(() => loadLessons(), []);
  const clusters = useMemo(() => clusterLessons(lessons), [lessons]);

  return (
    <Paper elevation={0} sx={cardSx}>
      <CardTitle>四、习惯档案 · 反复犯错的地方</CardTitle>
      {clusters.length === 0 ? (
        <Typography data-testid="habit-archive-empty" sx={{ fontSize: 12.5, color: SKIN.textMuted, mt: 1 }}>
          先下几局，档案会自动记录你的失误，并按类型给出统计。
        </Typography>
      ) : (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
          {clusters.map((cluster) => (
            <Box
              key={cluster.kind}
              data-testid="habit-cluster-row"
              sx={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 0.6fr 0.8fr 1fr',
                gap: 0.4,
                alignItems: 'center',
                p: 0.7,
                borderRadius: 1,
                bgcolor: SKIN.surfaceStrong,
                border: `1px solid ${SKIN.border}`,
                borderLeft: `3px solid ${cluster.improving ? SKIN.goldDeep : SKIN.danger}`,
              }}
            >
              <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: SKIN.text }}>
                {LESSON_LABELS[cluster.kind]}
              </Typography>
              <Typography sx={{ fontSize: 12, color: SKIN.textSecondary }}>{cluster.count} 次</Typography>
              <Typography sx={{ fontSize: 12, color: SKIN.textSecondary }}>均损 {Math.round(cluster.avgDrop)}</Typography>
              <Typography
                sx={{
                  fontSize: 12,
                  color: cluster.trend === 'down' ? SKIN.gold : cluster.trend === 'up' ? SKIN.danger : SKIN.textMuted,
                }}
              >
                {cluster.trend === 'down' ? `↓ 改善中（近${cluster.recentCount}次）`
                  : cluster.trend === 'up' ? `↑ 需加强（近${cluster.recentCount}次）`
                    : '— 持平'}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}

/** 单题练习：局面来自自己的失误或题库，走法即时可试，古谱题可看正解。 */
function DrillSession({ drill, onExit }: { drill: Drill; onExit: () => void }) {
  const initial = useMemo(() => loadDrillBoard(drill), [drill]);
  const [board, setBoard] = useState<BoardModel | null>(initial);
  const [selected, setSelected] = useState<Pos | null>(null);
  const [legalTargets, setLegalTargets] = useState<Pos[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Pos; to: Pos } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const solution = useMemo(() => solutionForDrill(drill), [drill]);

  if (!board) {
    return (
      <Typography data-testid="habit-drill-invalid" sx={{ fontSize: 12, color: SKIN.danger, mt: 1 }}>
        这个题目的局面无法加载，请换一题。
      </Typography>
    );
  }

  const onSquareClick = (col: number, row: number): void => {
    if (!board) return;
    const pos: Pos = { col, row };
    if (selected && legalTargets.some((t) => samePos(t, pos))) {
      const move = makeMove(board, selected, pos);
      if (move) {
        const next = board.clone();
        next.applyMove({ ...move });
        setBoard(next);
        setLastMove({ from: selected, to: pos });
      }
      setSelected(null);
      setLegalTargets([]);
      return;
    }
    const piece = board.getPiece(pos);
    if (piece && piece.side === 'red') {
      setSelected(pos);
      setLegalTargets(generateLegalMoves(board, 'red').filter((m) => samePos(m.from, pos)).map((m) => m.to));
    } else {
      setSelected(null);
      setLegalTargets([]);
    }
  };

  return (
    <Box data-testid="habit-drill-session" sx={{ mt: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.8 }}>
      <Typography sx={{ fontSize: 12, color: SKIN.textSecondary, textAlign: 'center' }}>
        {drill.prompt}（红先，可直接点子试走）
      </Typography>
      <Box sx={{ width: '100%', maxWidth: 320 }}>
        <BoardView
          board={board}
          selected={selected}
          legalTargets={legalTargets}
          lastMove={lastMove}
          hint={null}
          status="playing"
          interactive
          onSquareClick={onSquareClick}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Button size="small" onClick={() => setRevealed((v) => !v)} sx={{ color: SKIN.gold }}>
          {revealed ? '收起正解' : '看看正解'}
        </Button>
        <Button size="small" onClick={onExit} sx={{ color: SKIN.textSecondary }}>
          返回题目列表
        </Button>
      </Box>
      {revealed && (
        <Typography data-testid="habit-drill-solution" sx={{ fontSize: 12, color: SKIN.gold, textAlign: 'center' }}>
          {solution && solution.length > 0
            ? `正解首着：${solution[0].notation || '按棋盘试走'}`
            : '这是你自己的失误局面，可在复盘/提示里验证最佳应手。'}
        </Typography>
      )}
    </Box>
  );
}

/** 今日针对性练习：优先自己的失误局面，不足时由古谱题库补足。 */
function DrillCard() {
  const lessons: LessonRecord[] = useMemo(() => loadLessons(), []);
  const drills: Drill[] = useMemo(() => pickDrills(lessons, 3), [lessons]);
  const [active, setActive] = useState<Drill | null>(null);

  const start = (drill: Drill): void => {
    const board = loadDrillBoard(drill);
    if (!board) return;
    // 与现有对局链路保持一致：把局面载入 gameStore（rows 格式可通过校验）。
    useGameStore.getState().loadPuzzle(toRowsSetup(board), 'red');
    setActive(drill);
  };

  return (
    <Paper elevation={0} sx={cardSx}>
      <CardTitle>五、今日针对性练习 · 只练你犯过的错</CardTitle>
      {active ? (
        <DrillSession drill={active} onExit={() => setActive(null)} />
      ) : (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.7 }}>
          {drills.map((drill, index) => (
            <Button
              key={`${drill.source}-${index}-${drill.setup.slice(0, 12)}`}
              data-testid="habit-drill-item"
              onClick={() => start(drill)}
              sx={{
                justifyContent: 'flex-start',
                textAlign: 'left',
                bgcolor: SKIN.surfaceStrong,
                color: SKIN.text,
                border: `1px solid ${SKIN.border}`,
                borderLeft: `3px solid ${SKIN.goldDeep}`,
                borderRadius: SKIN_RADIUS,
                px: 1.2,
                py: 1,
              }}
            >
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
                  第 {index + 1} 题 · {LESSON_LABELS[drill.kind]} · {drill.source === 'own-mistake' ? '你的对局' : '适情雅趣'}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: SKIN.textMuted, mt: 0.3 }}>
                  {drill.prompt}
                </Typography>
              </Box>
            </Button>
          ))}
        </Box>
      )}
    </Paper>
  );
}

export function HabitCoachPage({ onBack }: Props) {
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: SKIN.pageSolid, pb: 4 }}>
      {/* 顶栏：深底金字，与全局「墨玉鎏金」一致 */}
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        px: 1.5, py: 1.2,
        background: `linear-gradient(180deg, ${SKIN.pageSolid} 0%, ${SKIN.pageDeep} 100%)`,
        borderBottom: `2px solid ${SKIN.goldDeep}`,
      }}>
        {/* v2026.11.23.8：全局统一主页入口，不再用「‹ 返回」——用户在更多页面能看到同一个「主页」按钮。 */}
        <HomeButton onClick={onBack} tone="dark" size="sm" testId="habit-home" />
        <Typography sx={{ color: SKIN.gold, fontWeight: 800, fontFamily: CALLIGRAPHY_FONT, letterSpacing: '0.12em', fontSize: 17 }}>
          学棋 · 好习惯
        </Typography>
        <Box sx={{ width: 48 }} />
      </Box>
      <Box sx={{ px: 1.5, pt: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, maxWidth: 560, mx: 'auto' }}>
        <ThreeQuestionCard />
        <SloppyCard />
        <ThreatCard />
        <ArchiveCard />
        <DrillCard />
        <Typography sx={{ fontSize: 11, color: SKIN.textMuted, textAlign: 'center', mt: 0.5 }}>
          方法参考天天象棋「智能复盘」与主流象棋教学：多想三步、拒绝随手、看懂对手意图。
        </Typography>
      </Box>
    </Box>
  );
}
