/**
 * 结算页「失误讲解（N）」列表（v2026.11.23.2，v2026.11.23.6 加一键跳节点）。
 *
 * 与漏杀区保持同一视觉范式：摘要行上直接有【看这一手】按钮，一点就带
 * 失误前局面跳进推演页，无需展开卡片；展开后仍是五段 Accordion 讲解，
 * 最后一段可跳推演页亲手试走或让 AI 演示正解。纯 UI，无网络请求。
 */
import { useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { findMateInOne } from '../ai/mate';
import { applyMoveToState } from '../engine/rules';
import type { GameState, Move } from '../engine/types';
import { legalMovesWithNotation } from '../training/legalNotation';
import { classifyMistake, type RuleContext } from '../training/mistakeRules';
import { renderMistake } from '../training/mistakeTemplates';
import type {
  MistakeEntry, MistakeGrade, MistakeType,
} from '../training/mistakeTypes';
import { MISTAKE_GRADE_LABELS } from '../training/mistakeTypes';
import type { SimHintOptions } from '../store/simulationStore';
import { CALLIGRAPHY_FONT, SKIN } from './theme';

/** 讲解卡片渲染所需的扁平数据。 */
export interface MistakeCardData {
  ply: number;
  playedNotation: string;
  bestNotation: string;
  grade: MistakeGrade;
  type: MistakeType;
  verdict: string;
  why: string;
  advice: string;
  wpl: number;
  wplBest: number;
  beforeState: GameState;
  bestMove?: Move;
}

interface Props {
  /** 检测层产出的原始记录（与 cards 二选一）。 */
  entries?: readonly MistakeEntry[];
  /** 已分类好的卡片数据（优先于 entries）。 */
  cards?: readonly MistakeCardData[];
  /** 完整着法历史，用于棋理分类与拿回所走着对象。 */
  history?: readonly Move[];
  /** 点「演示正解」：携带失误前局面与正解跳推演页。 */
  onReview?: (state: GameState, notation: string, options?: SimHintOptions) => void;
  /** 兼容漏杀区同名的回调。 */
  onReviewMiss?: (state: GameState, notation: string, options?: SimHintOptions) => void;
}

function moveByNotation(before: GameState, notation: string): Move | null {
  return legalMovesWithNotation(before).find((move) => move.notation === notation) ?? null;
}

function safeApply(before: GameState, move: Move): GameState {
  try { return applyMoveToState(before, move); } catch { return before; }
}

/** 把一条检测记录转成可直接渲染的卡片（分类失败安全回退 T8）。 */
export function toMistakeCard(
  entry: MistakeEntry, history?: readonly Move[],
): MistakeCardData {
  const before: GameState = entry.beforeState;
  const fromHistory: Move | undefined = history?.[entry.ply];
  const played: Move = fromHistory ?? moveByNotation(before, entry.playedNotation) ?? {
    from: { col: 0, row: 0 },
    to: { col: 0, row: 0 },
    piece: 'P',
    captured: null,
    notation: entry.playedNotation,
  };
  const after: GameState = safeApply(before, played);
  const mateAvailable: boolean = before.turn === entry.side
    && findMateInOne(before, entry.side) !== null;
  const context: RuleContext = {
    before,
    after,
    played,
    best: entry.bestMove,
    mover: entry.side,
    ply: entry.ply,
    cpPre: entry.cpPre,
    cpPlayed: entry.cpPlayed,
    cpBest: entry.cpBest,
    missedWin: entry.missedWin,
    mateAvailable,
    prevOpponentMove: entry.ply > 0 && history ? history[entry.ply - 1] ?? undefined : undefined,
    history: history ?? [],
  };
  const type: MistakeType = classifyMistake(context);
  const template = renderMistake(type);
  return {
    ply: entry.ply,
    playedNotation: entry.playedNotation,
    bestNotation: entry.bestNotation,
    grade: entry.grade,
    type,
    verdict: template.verdict,
    why: template.why,
    advice: template.advice,
    wpl: entry.wpl,
    wplBest: entry.wplBest,
    beforeState: before,
    bestMove: entry.bestMove ?? undefined,
  };
}

/** 失误讲解列表；空态沿用 PRD §6.2 的原文案。 */
export function MistakeReviewList({
  entries, cards, history, onReview, onReviewMiss,
}: Props) {
  const builtCards: MistakeCardData[] = useMemo(() => {
    if (cards && cards.length > 0) return [...cards];
    if (!entries || entries.length === 0) return [];
    return entries.map((entry) => toMistakeCard(entry, history));
  }, [cards, entries, history]);

  const [expanded, setExpanded] = useState<number | false>(false);
  const openReview = (card: MistakeCardData): void => {
    const handler = onReview ?? onReviewMiss;
    if (handler) handler(card.beforeState, card.bestNotation, {
      mode: 'move', move: card.bestMove ?? null,
    });
  };

  return (
    <Box data-testid="mistake-review" sx={{ mt: 1.5 }}>
      <Typography
        sx={{
          fontFamily: CALLIGRAPHY_FONT, fontWeight: 800, fontSize: 15,
          color: SKIN.gold, mb: 0.7, letterSpacing: '0.04em',
        }}
      >
        失误讲解（{builtCards.length}）
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 11.5, mb: 1, lineHeight: 1.6 }}>
        点【看这一手】直接进入当时的局面查看，对照你走的与建议走法；展开卡片可看五段棋理讲解，点【演示正解】让 AI 演示。
      </Typography>
      {builtCards.length === 0 ? (
        <Typography variant="body2" color="text.secondary">本局没有明显失误，保持得很好。</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
          {builtCards.map((card) => (
            <Accordion
              key={`${card.ply}-${card.type}`}
              data-testid="mistake-card"
              disableGutters
              expanded={expanded === card.ply}
              onChange={(_, isOpen) => setExpanded(isOpen ? card.ply : false)}
              sx={{ border: '0.5px solid', borderColor: 'divider', borderRadius: 2, '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1.2, minHeight: 40 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5 }}>
                    第 {card.ply + 1} 手：你走了「{card.playedNotation}」
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: SKIN.gold }}>
                    建议「{card.bestNotation}」
                  </Typography>
                  <Chip size="small" color="warning" label={MISTAKE_GRADE_LABELS[card.grade] ?? '失误'} sx={{ height: 20, fontSize: 10.5 }} />
                  <Chip size="small" variant="outlined" label={card.verdict} sx={{ height: 20, fontSize: 10.5 }} />
                  {/* 旧 error.main（#C0392B 系）压深绿底仅约 2:1，换 SKIN.danger。 */}
                  <Typography sx={{ fontSize: 12, color: SKIN.danger }}>−{card.wpl.toFixed(1)}%</Typography>
                  {/*
                    摘要行直跳：与漏杀「进入棋盘，重走这一手」同一交互层级。
                    stopPropagation 防止按钮点击连带把 Accordion 展开/收起。
                  */}
                  <Button
                    data-testid="review-this-move"
                    size="small"
                    variant="contained"
                    startIcon={<VisibilityIcon />}
                    aria-label={`看这一手：第 ${card.ply + 1} 手失误前局面`}
                    onClick={(event) => { event.stopPropagation(); openReview(card); }}
                    onKeyDown={(event) => event.stopPropagation()}
                    sx={{
                      ml: 'auto', minWidth: 0, px: 0.9, py: 0.2,
                      fontSize: 11.5, lineHeight: 1.2, whiteSpace: 'nowrap',
                    }}
                  >
                    看这一手
                  </Button>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ px: 1.2, pt: 0, pb: 1.2, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
                <Typography sx={{ fontSize: 12.5 }}>
                  ① 你走了什么：第 {card.ply + 1} 手：你走了「{card.playedNotation}」。
                </Typography>
                <Typography sx={{ fontSize: 12.5 }}>
                  ② 问题定性：{MISTAKE_GRADE_LABELS[card.grade] ?? '失误'} · {card.verdict} · 胜率损失 −{card.wpl.toFixed(1)}%
                </Typography>
                <Typography sx={{ fontSize: 12.5 }}>③ 应该走：这里应该走「{card.bestNotation}」。</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', lineHeight: 1.6 }}>
                  ④ 为什么：{card.why}
                </Typography>
                <Button
                  data-testid="demo-best"
                  size="small"
                  variant="contained"
                  startIcon={<PlayArrowIcon />}
                  onClick={() => openReview(card)}
                  sx={{ alignSelf: 'flex-start', fontSize: 12 }}
                >
                  ⑤ 演示正解
                </Button>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      )}
    </Box>
  );
}
