/**
 * QA regression: the built-in 残局/开局 puzzle loading path has been removed.
 *
 * This file used to inject an illegal 3-rook puzzle through `vi.mock` of
 * `data/puzzles` and assert the PracticePage refused to load it. With the
 * built-in puzzle library gone, that path no longer exists — the practice
 * screen opens directly into 《适情雅趣》. The test now guards that removal.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PracticePage } from '../ui/PracticePage';

afterEach(() => cleanup());

describe('PracticePage 内置题路径已移除', () => {
  it('直接进入适情雅趣，不再有残局/开局 Tab 与内置题', () => {
    render(<PracticePage />);

    expect(screen.queryByRole('tab', { name: /^残局 \(/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^开局 \(/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '适情雅趣 (548)' })).toBeInTheDocument();

    // Former built-in puzzle titles must never reappear.
    expect(screen.queryByText('双车锁王·红方闷杀')).not.toBeInTheDocument();
    expect(screen.queryByText('中炮开局·炮二平五')).not.toBeInTheDocument();

    // The 548-puzzle collection is loaded immediately, no tab click needed.
    expect(screen.getByText('适情雅趣 · 共 548 局')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '第1局 · 气吞关右' })).toBeInTheDocument();
  });
});
