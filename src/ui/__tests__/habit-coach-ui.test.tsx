/**
 * 好习惯 UI 集成验证：习惯档案与出题。
 * 三思关拦截弹窗、对局页预警雷达（红圈+静态提示文字）均已按用户要求删除——
 * 用户实测"走一步就在下面解释、界面一直跳、根本没法玩"。危险局面落子必须立即生效。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MatchPage } from '../MatchPage';
import { HabitCoachPage } from '../HabitCoachPage';
import { Board, createInitialState } from '../../engine/board';
import type { GameState } from '../../engine/types';
import { checkStatus } from '../../engine/rules';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { saveLessons, type LessonRecord } from '../../data/lesson-storage';

function stateOf(placements: Array<[number, number, string]>): GameState {
  const rows = Array.from({ length: 10 }, () => '.,.,.,.,.,.,.,.,.'.split(','));
  for (const [col, row, ch] of placements) rows[row][col] = ch;
  const board = Board.fromNotationSetup(rows.map((row) => row.join(',')).join('/'));
  return { board, turn: 'red', history: [], status: checkStatus(board, 'red'), moveCount: 0 };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  useSettings.setState({
    playerSide: 'red',
    soundEnabled: false,
    difficulty: 'beginner',
  });
  useGameStore.getState().newGame();
});

afterEach(() => {
  cleanup();
  act(() => { useGameStore.getState().newGame(); });
  vi.useRealTimers();
});

describe('对局页无打扰回归（雷达提示/三思弹窗已删）', () => {
  it('真实威胁局面也不再出现红圈与"会被吃掉"提示条', () => {
    const danger = stateOf([[4, 0, 'K'], [4, 4, 'R'], [4, 6, 'r'], [4, 9, 'k']]);
    act(() => { useGameStore.setState({ game: danger, thinking: false }); });

    render(<MatchPage onOpenSetup={() => {}} onOpenPractice={() => {}} onSimulate={() => {}} />);

    expect(screen.queryByTestId('threat-ring')).not.toBeInTheDocument();
    expect(screen.queryByTestId('threat-radar-cue')).not.toBeInTheDocument();
  });

  it('危险局面落子立即生效，没有任何三思弹窗拦截', () => {
    const danger = stateOf([[4, 0, 'K'], [4, 4, 'R'], [4, 6, 'r'], [4, 9, 'k']]);
    act(() => { useGameStore.setState({ game: danger, thinking: false }); });

    let accepted = false;
    act(() => {
      accepted = useGameStore.getState().playerMove({ col: 4, row: 4 }, { col: 4, row: 5 });
    });

    expect(accepted).toBe(true);
    expect(useGameStore.getState().game.history).toHaveLength(1);
    expect(useGameStore.getState().game.history[0].to).toEqual({ col: 4, row: 5 });

    render(<MatchPage onOpenSetup={() => {}} onOpenPractice={() => {}} onSimulate={() => {}} />);
    expect(screen.queryByTestId('habit-prompt-dialog')).not.toBeInTheDocument();
  });
});

describe('H3 习惯档案页', () => {
  it('无失误记录时给空态，并用题库补足三道练习', () => {
    render(<HabitCoachPage onBack={() => {}} />);
    expect(screen.getByTestId('habit-archive-empty')).toHaveTextContent('先下几局');
    expect(screen.getAllByTestId('habit-drill-item')).toHaveLength(3);

    fireEvent.click(screen.getAllByTestId('habit-drill-item')[0]);
    expect(screen.getByTestId('habit-drill-session')).toBeInTheDocument();
    expect(useGameStore.getState().setupError).toBeNull();

    fireEvent.click(screen.getByText('看看正解'));
    expect(screen.getByTestId('habit-drill-solution')).toBeInTheDocument();
  });

  it('有失误记录时按类型渲染档案表，并从真实 setup 出题', () => {
    const lesson: LessonRecord = {
      game: 1,
      ply: 3,
      side: 'red',
      kind: 'hang-piece',
      notation: '车八进一',
      drop: 450,
      setup: createInitialState('red').board.toNotationSetup(),
      at: 1,
    };
    saveLessons([lesson]);

    render(<HabitCoachPage onBack={() => {}} />);
    const row = screen.getAllByTestId('habit-cluster-row')[0];
    expect(row).toHaveTextContent('送子');
    expect(row).toHaveTextContent('1 次');
    expect(row).toHaveTextContent('均损 450');

    const ownDrill = screen.getAllByTestId('habit-drill-item').find((el) => el.textContent?.includes('你的对局'));
    expect(ownDrill).toBeDefined();
    if (ownDrill) {
      fireEvent.click(ownDrill);
      expect(screen.getByTestId('habit-drill-session')).toBeInTheDocument();
    }
  });
});
