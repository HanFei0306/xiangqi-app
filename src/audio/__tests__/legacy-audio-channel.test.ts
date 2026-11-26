/**
 * v2026.11.25 架构护栏：生产代码里只允许存在**一条**音效通道。
 *
 * 历史包袱 `moveCue.playMoveCue()` 是第二条音效通道（它自己 play('slide') +
 * play(cue) + 原生 playCue('land')）。任何页面误调它，就会与统一出口
 * `unifiedCue.cueFromMove()` 叠成"一步响两次"。该函数已删除，这里用源码扫描
 * 把它钉死：谁也別想再加回来。
 *
 * 同时锁死 `moveCue.ts` 只剩纯判定函数——不许再引入任何真正发声的调用。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SRC_ROOT = resolve(process.cwd(), 'src');

/** 递归收集 src 下的生产源码（跳过单测与 test setup）。 */
function productionSources(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...productionSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry)) continue;
    if (entry === 'setup.ts') continue;
    out.push(full);
  }
  return out;
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** 抹掉注释再扫描：文档里提到这些名字不算违规，只有真正的代码调用才算。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('唯一音效通道', () => {
  it('生产代码没有任何 playMoveCue 的引用（该函数已删除）', () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      if (stripComments(read(file)).includes('playMoveCue')) {
        offenders.push(relative(SRC_ROOT, file).split(sep).join('/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('直接调用 sound.play() 的生产文件只有白名单（新增通道必须显式登记）', () => {
    // 白名单依据（每一条都有明确用途，且都不与统一出口叠发）：
    //  - audio/unifiedCue.ts        统一出口自己（Web 回退）
    //  - audio/sound.ts             定义处
    //  - audio/selfTest.ts          设置页"音效自检"，用户点按试听
    //  - audio/prime.ts             首次手势静音 wav，激活 WebView 音频栈
    //  - audio/music.ts             背景音乐，与走子无关
    //  - audio/voice.ts             语音模块自身（HTMLAudioElement.play）
    //  - store/gameStore.ts         主对局 announceTurn（原生 MediaPlayer + 语音，
    //                               是非复盘对局的唯一发声点，页面侧不再重复派发）
    //  - ui/AncientPracticePage.tsx 仅"音效试听"按钮，不是走子派发路径
    const allowed: readonly string[] = [
      'audio/unifiedCue.ts',
      'audio/sound.ts',
      'audio/selfTest.ts',
      'audio/prime.ts',
      'audio/music.ts',
      'audio/voice.ts',
      'store/gameStore.ts',
      'ui/AncientPracticePage.tsx',
    ];
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const rel = relative(SRC_ROOT, file).split(sep).join('/');
      if (allowed.includes(rel)) continue;
      const text = stripComments(read(file));
      if (/\bplay\(/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('moveCue.ts 只剩纯判定：不得用值导入引入任何发声模块', () => {
    const text = stripComments(read(join(SRC_ROOT, 'audio', 'moveCue.ts')));
    // `import type { SoundType } from './sound'` 只是类型，不产生任何发声副作用，
    // 允许；但值导入（play / playAt / announceEvent / playNativeCue ...）一律禁止。
    const valueImports = text
      .split('\n')
      .filter((line) => /^\s*import\s+(?!type\b)/.test(line))
      .filter((line) => /'\.\/(sound|voice|nativeCue)'/.test(line));
    expect(valueImports).toEqual([]);
    expect(text).not.toMatch(/\bplay\(/);
    expect(text).not.toContain('export function playMoveCue');
    expect(text).toContain('export function cueForMove');
  });

  it('unifiedCue.ts 是唯一把 cue 交给原生桥接的地方', () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const rel = relative(SRC_ROOT, file).split(sep).join('/');
      if (rel === 'audio/unifiedCue.ts' || rel === 'audio/nativeCue.ts' || rel === 'audio/selfTest.ts') continue;
      if (stripComments(read(file)).includes('playUnified')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
