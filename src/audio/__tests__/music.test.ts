/**
 * 音乐资源接线回归（v2026.11.19.3）。
 *
 * file:// / Android WebView 下只有「相对路径 + 真实存在的本地文件」能播。
 * 这里同时守住三件事：src 形状、Third track 的公有领域替换、老存档迁移。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MUSIC_TRACKS } from '../music';
import { loadSettings, MUSIC_TRACK_IDS } from '../../data/storage';

const KEY = 'xiangqi-trainer:settings';

beforeEach(() => {
  localStorage.clear();
});

describe('MUSIC_TRACKS — 三条曲目的相对路径与格式', () => {
  it('id / label / src 全部指向已交付的真实文件', () => {
    expect(MUSIC_TRACKS).toHaveLength(3);
    expect(MUSIC_TRACKS.map((t) => t.id)).toEqual(['moonlight', 'canon', 'yangguan']);

    const expected: Record<string, { src: string; label: string }> = {
      moonlight: { src: 'music/moonlight.m4a', label: '德彪西《月光》' },
      canon: { src: 'music/canon.ogg', label: '帕赫贝尔《卡农》' },
      yangguan: { src: 'music/yangguan.ogg', label: '古琴《阳关三叠》' },
    };
    for (const track of MUSIC_TRACKS) {
      expect(track.src, `${track.id} 的 src`).toBe(expected[track.id].src);
      expect(track.label, `${track.id} 的 label`).toBe(expected[track.id].label);
    }
  });

  it('路径对 file:// 安全：相对、无前导斜杠、无协议、无残留 assets/music', () => {
    for (const track of MUSIC_TRACKS) {
      expect(track.src.startsWith('music/')).toBe(true);
      expect(track.src.startsWith('/')).toBe(false);
      expect(track.src).not.toMatch(/^[a-z]+:\/\//i);
      expect(track.src).not.toContain('assets/music');
      expect(track.src).toMatch(/^music\/[a-z]+\.(mp3|ogg|m4a)$/);
    }
    expect(MUSIC_TRACKS.some((t) => t.label.includes('松窗棋罢'))).toBe(false);
  });

  it('每条 src 对应的文件确实随包发布在 public/music（构建后落到 dist/music）', () => {
    for (const track of MUSIC_TRACKS) {
      const file: string = resolve(process.cwd(), 'public', track.src);
      expect(existsSync(file), `${track.src} 必须真实存在`).toBe(true);
    }
  });
});

describe('老存档迁移：songchuang → yangguan', () => {
  it('MusicTrackId 与 MUSIC_TRACK_IDS 不再暴露版权曲 id', () => {
    expect(MUSIC_TRACK_IDS).toEqual(['off', 'moonlight', 'canon', 'yangguan']);
    expect(MUSIC_TRACK_IDS).not.toContain('songchuang');
  });

  it('旧存档里的 songchuang 被映射为 yangguan，而不是丢弃偏好', () => {
    localStorage.setItem(KEY, JSON.stringify({ musicTrack: 'songchuang' }));
    expect(loadSettings().musicTrack).toBe('yangguan');
  });

  it('新 id / 未知 id / 缺省值各自正常', () => {
    localStorage.setItem(KEY, JSON.stringify({ musicTrack: 'yangguan' }));
    expect(loadSettings().musicTrack).toBe('yangguan');

    localStorage.setItem(KEY, JSON.stringify({ musicTrack: 'mp3' }));
    expect(loadSettings().musicTrack).toBe('off');

    localStorage.setItem(KEY, JSON.stringify({}));
    expect(loadSettings().musicTrack).toBe('off');
  });
});
