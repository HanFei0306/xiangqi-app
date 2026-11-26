/**
 * v2026.11.23.8 主页「继续还是新开」验收。
 *
 * 需求原话：退到主页后原进程可以先搁置不退出，再进入原有界面可以接着进行；
 * 并且要"作出提示 继续对局或者新的对局"。
 *
 * 这里直接渲染真实的 <SetupPage>（不走 App，避免依赖 lead 的接线进度），
 * 用 spy 断言「开始挑战」在有/无挂起对局时的两种行为，以及常驻 pill 与
 * 四个功能入口（含新增的残局推演）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SetupPage } from '../SetupPage';
import { useSettings } from '../../store/settings';

type SetupPageProps = Parameters<typeof SetupPage>[0];

function makeProps(overrides: Partial<SetupPageProps> = {}): SetupPageProps {
  return {
    onStart: vi.fn(),
    onPractice: vi.fn(),
    onHabit: vi.fn(),
    onSimulation: vi.fn(),
    onEndgameLab: vi.fn(),
    hasUnfinished: false,
    onContinue: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ difficulty: 'beginner', playerSide: 'red', soundEnabled: false });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('SetupPage 未完成对局的「继续 / 新的」', () => {
  it('没有挂起对局时，「开始挑战」直接开新局，不弹窗', () => {
    const props = makeProps({ hasUnfinished: false });
    render(<SetupPage {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));

    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
    // 没有未完成对局就不该出现这个弹窗，也不该有常驻 pill。
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
    expect(screen.queryByTestId('resume-match-pill')).toBeNull();
  });

  it('有挂起对局时，「开始挑战」先弹窗；「继续对局」只继续、不开新局', () => {
    const props = makeProps({ hasUnfinished: true });
    render(<SetupPage {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));

    // 弹窗出现，且还没有任何跳转发生。
    expect(screen.getByTestId('resume-dialog')).toBeInTheDocument();
    expect(screen.getByText('发现一局没下完的棋')).toBeInTheDocument();
    expect(props.onStart).not.toHaveBeenCalled();
    expect(props.onContinue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('resume-continue'));

    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('有挂起对局时，弹窗里选「新的对局」才开新局', () => {
    const props = makeProps({ hasUnfinished: true });
    render(<SetupPage {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    expect(screen.getByTestId('resume-dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('resume-new'));

    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it('弹窗里选「取消」只关弹窗，什么都不跳转', () => {
    const props = makeProps({ hasUnfinished: true });
    render(<SetupPage {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '开始挑战' }));
    fireEvent.click(screen.getByTestId('resume-cancel'));

    expect(props.onStart).not.toHaveBeenCalled();
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it('常驻 pill 直接继续那局（不经过弹窗）', () => {
    const props = makeProps({ hasUnfinished: true });
    render(<SetupPage {...props} />);

    const pill = screen.getByTestId('resume-match-pill');
    expect(pill).toBeInTheDocument();
    expect(screen.getByText('有未下完的对局 · 点此继续')).toBeInTheDocument();

    fireEvent.click(pill);

    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(props.onStart).not.toHaveBeenCalled();
    // 直接继续不应该顺手把弹窗也打开。
    expect(screen.queryByTestId('resume-dialog')).toBeNull();
  });
});

describe('SetupPage 功能入口网格（v2026.11.23.8 四个入口）', () => {
  it('四个入口都在，残局推演点了会回调 onEndgameLab', () => {
    const props = makeProps();
    render(<SetupPage {...props} />);

    for (const label of ['适情雅趣', '残局推演', '学棋', '记谱']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId('entry-endgame-lab'));

    expect(props.onEndgameLab).toHaveBeenCalledTimes(1);
    // 不能误触其它入口。
    expect(props.onPractice).not.toHaveBeenCalled();
    expect(props.onSimulation).not.toHaveBeenCalled();
    expect(props.onHabit).not.toHaveBeenCalled();
  });

  it('版本号升到 v2026.11.25.2', () => {
    render(<SetupPage {...makeProps()} />);
    expect(screen.getByText('v2026.11.25.2')).toBeInTheDocument();
  });
});
