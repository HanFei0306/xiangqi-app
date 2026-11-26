/**
 * 八类棋理讲解模板（PRD §5.2 逐字落地，100% 离线纯文本）。
 * 每段均为中文、非空、单段不超过 80 字，无占位符、无外部内容。
 */
import type { MistakeType } from './mistakeTypes';

export type { MistakeType } from './mistakeTypes';

/** 一条模板的三段文案。 */
export interface MistakeTemplate {
  /** 定性Chip文案。 */
  verdict: string;
  /** 棋理"为什么"。 */
  why: string;
  /** 改进建议。 */
  advice: string;
}

export const MISTAKE_TEMPLATES: Readonly<Record<MistakeType, MistakeTemplate>> = {
  T1: {
    verdict: '白送一子',
    why: '这个子走到了对方能吃到的位置，而你没有足够保护。子力是形势的本钱，无代价丢子通常直接改变胜负。',
    advice: '落子前先看：对方下一步能吃我什么？',
  },
  T2: {
    verdict: '错过一步杀',
    why: '当时存在强制将死的着法，你错过了终局机会。杀法要先看将帅周围的入杀点与连续将军。',
    advice: '每步先扫一遍：能否连续将军或直接将死？',
  },
  T3: {
    verdict: '痛失好局',
    why: '对手上一手留下了破绽，你没有惩罚它。优势时更要保持压迫，把优势兑现成子力或杀势。',
    advice: '对手走完先问：他有没有露出破绽？',
  },
  T4: {
    verdict: '开局出子慢',
    why: '开局的核心是尽快出动大子、稳固帅位。反复动一子会浪费先手，让对手先完成布阵。',
    advice: '前 10 手优先出车、马、炮，别反复挪同一个子。',
  },
  T5: {
    verdict: '帅位不安',
    why: '将帅是胜负根本，九宫一破，再多的子也难救。随手动士相常给对手杀棋通道。',
    advice: '动手前检查九宫：我的将帅还有几层保护？',
  },
  T6: {
    verdict: '兑子吃亏',
    why: '兑子要看子力价值和局面需要：优势时兑子简化局面，劣势时兑子反而脱身。',
    advice: '吃子前先算双方价值，再想兑完谁更好。',
  },
  T7: {
    verdict: '应将不当',
    why: '应将先保帅，其次才是反击。只顾解将不看后续，容易被引离或连将致死。',
    advice: '被将时把所有解将着列出来再选。',
  },
  T8: {
    verdict: '缓手，错失先手',
    why: '这手既没改善自己也没限制对手，等于送给对手一手先手。优势要扩大，劣势要制造对抗。',
    advice: '每步问：我的子力位置或威胁是否比上一手更好？',
  },
};

/** 取一类模板的只读引用；未知类型回退到 T8，保证文案永不空白。 */
export function renderMistake(type: MistakeType): MistakeTemplate {
  return MISTAKE_TEMPLATES[type] ?? MISTAKE_TEMPLATES.T8;
}

/** 八类类型的稳定顺序（黄金集与 UI 次要标签共用）。 */
export const MISTAKE_TYPES: readonly MistakeType[] = [
  'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8',
];

/** 类型短名（讲解卡片 Chip 使用）。 */
export const MISTAKE_TYPE_LABELS: Record<MistakeType, string> = {
  T1: '送子',
  T2: '漏杀',
  T3: '痛失好局',
  T4: '出子慢',
  T5: '帅位不安',
  T6: '兑子不利',
  T7: '应将失误',
  T8: '缓手',
};
