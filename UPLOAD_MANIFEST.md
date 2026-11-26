# GitHub 上传文件清单（仓库「象棋app」· 私有）

> 版本基线：`v2026.11.25.2` / Android `versionCode 59`（已核对 `AndroidManifest.xml` 与 `src/App.tsx`）。
>
> **路径基准**：下列路径即 GitHub 仓库内的相对路径。
> - `src/**`、`package*.json`、`tsconfig*.json`、`vite.config.ts`、`index.html`、`tailwind.config.js`、`postcss.config.js`、`public/**`、`docs/**` → 从 `/Users/mac/WorkBuddy/2026-07-23-13-23-58/xiangqi-trainer/` 读取。
> - `tools/manual-apk/**` → **注意：该目录不在 `xiangqi-trainer/` 内**，实际位于工作区同级目录 `/Users/mac/WorkBuddy/2026-07-23-13-23-58/tools/manual-apk/`。推送时统一落到仓库的 `tools/manual-apk/` 路径下，否则 `build_final.py` 的相对路径（`/tools/pikafish-net`、`/xiangqi-trainer/dist`）会失效。
>
> **文件总数：361**（现有源码/资源 358 + 本次新增文档 3：`README.md`、`.gitignore`、本清单）。
> 分组计数：src 221 + 根配置 8 + public/music 4 + docs 7 + tools/manual-apk 118 + 新增文档 3 = 361。
>
> 本清单只列文本文件与明确许可的资源文件；**不含任何 `.apk` / `.idsig` / `.nnue` / `.keystore` / `.jks` / 二进制构建中间件**。

---

## 1. 应用源码 `src/`（221 个文件）—— 全部上传

**为什么传**：这是全部业务逻辑与测试，用户查看结构、评估架构、提优化建议的主体。包含单元测试（`__tests__`）与 `src/qa/` 回归用例，它们能反映设计契约与历史 bug 修复意图，对评估价值很高；不参与打包，不影响产物体积。

### 1.1 入口与全局（4）

```
src/App.tsx
src/index.css
src/main.tsx
src/vite-env.d.ts
```

### 1.2 engine 规则层（7 + 6 测试）

**为什么传**：走法生成、规则判定、局面与记谱是棋力正确性的地基。

```
src/engine/board.ts
src/engine/movegen.ts
src/engine/notation.ts
src/engine/pieces.ts
src/engine/rules.ts
src/engine/types.ts
src/engine/validate.ts
src/engine/__tests__/board.test.ts
src/engine/__tests__/insufficientMaterial.test.ts
src/engine/__tests__/movegen.test.ts
src/engine/__tests__/notation.test.ts
src/engine/__tests__/rules.test.ts
src/engine/__tests__/validate.test.ts
```

### 1.3 ai 引擎层（19 + 10 legacy + 29 测试）

**为什么传**：包含 TypeScript 自研搜索引擎、原生 Pikafish JNI 适配器、开局库、评估项、棋力档位与自我进化，是"棋力优化建议"的核心依据。`legacy/v1197/` 是冻结对照版本，保留供 A/B 与回归追溯。

```
src/ai/activeEngine.ts
src/ai/ancientBook.ts
src/ai/ancientReply.ts
src/ai/engine.ts
src/ai/evalTerms.ts
src/ai/evaluate.ts
src/ai/evolution.ts
src/ai/mate.ts
src/ai/nativeEngine.ts
src/ai/openingBook.ts
src/ai/profiles.ts
src/ai/pst.ts
src/ai/search.ts
src/ai/see.ts
src/ai/skewer.ts
src/ai/threat.ts
src/ai/tierSpec.ts
src/ai/types.ts
src/ai/variety.ts
src/ai/legacy/v1197/engine.ts
src/ai/legacy/v1197/evalTerms.ts
src/ai/legacy/v1197/evaluate.ts
src/ai/legacy/v1197/evolution.ts
src/ai/legacy/v1197/openingBook.ts
src/ai/legacy/v1197/pst.ts
src/ai/legacy/v1197/search.ts
src/ai/legacy/v1197/see.ts
src/ai/legacy/v1197/types.ts
src/ai/legacy/v1197/variety.ts
src/ai/__tests__/ancient-book.test.ts
src/ai/__tests__/ancient-reply.test.ts
src/ai/__tests__/aspiration.test.ts
src/ai/__tests__/async-retry.test.ts
src/ai/__tests__/book-lines.test.ts
src/ai/__tests__/complexity.test.ts
src/ai/__tests__/difficulty.test.ts
src/ai/__tests__/endgame-knowledge.test.ts
src/ai/__tests__/evalTerms.test.ts
src/ai/__tests__/evaluate.test.ts
src/ai/__tests__/evolution.test.ts
src/ai/__tests__/hash.test.ts
src/ai/__tests__/incremental-eval.test.ts
src/ai/__tests__/mate.test.ts
src/ai/__tests__/mateScore.test.ts
src/ai/__tests__/native-engine.test.ts
src/ai/__tests__/opening-book-native.test.ts
src/ai/__tests__/openingBook.test.ts
src/ai/__tests__/performance.test.ts
src/ai/__tests__/pst.test.ts
src/ai/__tests__/quiescence.test.ts
src/ai/__tests__/repetition.test.ts
src/ai/__tests__/search.test.ts
src/ai/__tests__/see.test.ts
src/ai/__tests__/skewer.test.ts
src/ai/__tests__/softcap.test.ts
src/ai/__tests__/strength-v1197.test.ts
src/ai/__tests__/threat.test.ts
src/ai/__tests__/variety.test.ts
```

### 1.4 store 状态层（7 + 10 测试）

**为什么传**：人机回合、长将判负归属、复盘/提示/认输和棋、统计与会话恢复的单一入口。

```
src/store/cueDisplayStore.ts
src/store/gameStore.ts
src/store/matchStats.ts
src/store/repetition-judge.ts
src/store/session.ts
src/store/settings.ts
src/store/simulationStore.ts
src/store/__tests__/check-event.test.ts
src/store/__tests__/game-outcome.test.ts
src/store/__tests__/repetition-judge.test.ts
src/store/__tests__/review.test.ts
src/store/__tests__/settings.test.ts
src/store/__tests__/setup.test.ts
src/store/__tests__/simulation-cue-once.test.ts
src/store/__tests__/simulation-hintmode.test.tsx
src/store/__tests__/simulation.test.ts
src/store/__tests__/voice-order.test.ts
```

### 1.5 data 数据层（8 + 5 测试）

**为什么传**：《适情雅趣》548 局题库、棋谱本与变招树、设置持久化、自我进化数据，全部为纯 TS 源码，无外部数据库。

```
src/data/ancient-progress.ts
src/data/evolution-storage.ts
src/data/lesson-storage.ts
src/data/notation-storage.ts
src/data/puzzles.ts
src/data/shiqingyaqu.ts
src/data/storage.ts
src/data/types.ts
src/data/__tests__/ancient-progress.test.ts
src/data/__tests__/notation-roundtrip.test.ts
src/data/__tests__/notation-storage.test.ts
src/data/__tests__/notation-variations.test.ts
src/data/__tests__/shiqingyaqu.test.ts
```

### 1.6 training 训练层（17 + 11 测试）

**为什么传**：复盘分析、失误检测/归类、好习惯教练、威胁雷达、残局推演规则与提示模板。

```
src/training/habitCoach.ts
src/training/hint.ts
src/training/legalNotation.ts
src/training/matchStats.ts
src/training/mistakeDetection.ts
src/training/mistakeRules.ts
src/training/mistakeTemplates.ts
src/training/mistakeTypes.ts
src/training/perpetualGuard.ts
src/training/replay.ts
src/training/selfReview.ts
src/training/simRepetition.ts
src/training/tacticArt.ts
src/training/tactics.ts
src/training/templates.ts
src/training/threatRadar.ts
src/training/types.ts
src/training/__tests__/habitCoach.test.ts
src/training/__tests__/matchStats.test.ts
src/training/__tests__/mistakeDetection-fullgame.test.ts
src/training/__tests__/mistakeDetection.test.ts
src/training/__tests__/mistakeRules.test.ts
src/training/__tests__/perpetualGuard.test.ts
src/training/__tests__/selfReview.test.ts
src/training/__tests__/simRepetition-harass-fallback.test.ts
src/training/__tests__/simRepetition.test.ts
src/training/__tests__/tactics.test.ts
src/training/__tests__/threatRadar.test.ts
```

### 1.7 ui 页面与外观层（26 + 28 测试）

**为什么传**：页面/棋盘/棋子/主题/动效与 UI 回归用例，是评估 UI 与适配优化的依据；全部视觉资源为 CSS 渐变/内联 SVG，无外部图片。

```
src/ui/AncientPracticePage.tsx
src/ui/Board.tsx
src/ui/ControlPanel.tsx
src/ui/EndgameLabPage.tsx
src/ui/GamePage.tsx
src/ui/HabitCoachPage.tsx
src/ui/HintBox.tsx
src/ui/HomeButton.tsx
src/ui/MatchPage.tsx
src/ui/MatchResultDialog.tsx
src/ui/MatchSummaryPanel.tsx
src/ui/MistakeReviewList.tsx
src/ui/MoveList.tsx
src/ui/Piece.tsx
src/ui/PlayerBar.tsx
src/ui/PracticePage.tsx
src/ui/ReplayView.tsx
src/ui/SettingsPanel.tsx
src/ui/SetupPage.tsx
src/ui/SimulationPage.tsx
src/ui/TacticCue.tsx
src/ui/boardDecor.ts
src/ui/boardMaterials.tsx
src/ui/difficultyLabels.ts
src/ui/setupTiers.ts
src/ui/theme.ts
src/ui/__tests__/ancient-cue-once.test.tsx
src/ui/__tests__/ancient-practice.test.tsx
src/ui/__tests__/ancient-simulate.test.tsx
src/ui/__tests__/ancient-sound.test.tsx
src/ui/__tests__/animation-timing.test.ts
src/ui/__tests__/board-clarity.test.ts
src/ui/__tests__/board-decor.test.ts
src/ui/__tests__/board-flip.test.ts
src/ui/__tests__/board-layout.test.ts
src/ui/__tests__/board-theme-effects.test.tsx
src/ui/__tests__/difficulty-labels.test.ts
src/ui/__tests__/endgame-lab.test.tsx
src/ui/__tests__/global-home.test.tsx
src/ui/__tests__/habit-coach-ui.test.tsx
src/ui/__tests__/match-actions.test.tsx
src/ui/__tests__/match-home-button.test.tsx
src/ui/__tests__/match-result-ui.test.tsx
src/ui/__tests__/mistake-review.test.tsx
src/ui/__tests__/notation-flip-variations.test.tsx
src/ui/__tests__/notation-playback-controls.test.tsx
src/ui/__tests__/piece-board-art.test.ts
src/ui/__tests__/practice-simulate-wiring.test.tsx
src/ui/__tests__/review-favorite.test.tsx
src/ui/__tests__/setup-page.test.tsx
src/ui/__tests__/setup-resume.test.tsx
src/ui/__tests__/simulation-repaint.test.tsx
src/ui/__tests__/simulation-reset-root.test.tsx
src/ui/__tests__/thinking-indicator.test.tsx
```

### 1.8 audio 音频层（9 + 7 测试）

**为什么传**：走子音效、原生语音播报、背景音乐控制与首次手势激活逻辑；音乐文件本体见第 3 组。

```
src/audio/moveCue.ts
src/audio/music.ts
src/audio/nativeCue.ts
src/audio/prime.ts
src/audio/selfTest.ts
src/audio/sound.ts
src/audio/unifiedCue.ts
src/audio/voice.ts
src/audio/voiceData.ts
src/audio/__tests__/legacy-audio-channel.test.ts
src/audio/__tests__/moveCue.test.ts
src/audio/__tests__/music.test.ts
src/audio/__tests__/sound.test.ts
src/audio/__tests__/unifiedCue-delay.test.ts
src/audio/__tests__/unifiedCue.test.ts
src/audio/__tests__/voice.test.ts
```

### 1.9 endgame 残局实验室（1 + 1 测试）

```
src/endgame/labModel.ts
src/endgame/__tests__/labModel.test.ts
```

### 1.10 测试基座与 QA 回归（16）

**为什么传**：`src/test/setup.ts` 是 `vitest` 必需；`src/qa/` 是产品级回归用例（非第 5 组那种一次性 CDP 脚本），保留可追溯验收口径。

```
src/test/setup.ts
src/qa/ai-smoke.test.ts
src/qa/ai.test.ts
src/qa/data.test.ts
src/qa/engine.board.test.ts
src/qa/engine.movegen.test.ts
src/qa/engine.notation.test.ts
src/qa/engine.rules.test.ts
src/qa/qa-independent-regression.test.tsx
src/qa/qa-mistake-cache.test.tsx
src/qa/qa-mistake2-independent.test.ts
src/qa/qa-mistake2-sim.test.tsx
src/qa/qa-practicepath-illegal.test.tsx
src/qa/qa-yan-v17-acceptance.test.tsx
src/qa/store.test.ts
src/qa/training.test.ts
```

---

## 2. 根配置（8 个文件）—— 全部上传

**为什么传**：没有它们无法安装依赖、类型检查、构建或跑测试；`vite.config.ts` 还包含 `file://` WebView 专用的 classic-script 插件，是该项目的关键架构约束。

```
package.json
package-lock.json
tsconfig.json
tsconfig.node.json
vite.config.ts
index.html
tailwind.config.js
postcss.config.js
```

---

## 3. 音乐资源 `public/music/`（4 个文件）—— 全部上传

**为什么传**：3 首背景音乐均为可自由授权的 Wikimedia Commons 录音，随 APK 离线内置，必须随源码提供才能复现；`CREDITS.txt` 是署名/许可证明，不可省略。合计约 2–3 MB。

```
public/music/CREDITS.txt
public/music/canon.ogg
public/music/moonlight.m4a
public/music/yangguan.ogg
```

> 备注：`CREDITS.txt` 中首曲写作 `moonlight.mp3`，实际入库文件为转码后的 `moonlight.m4a`；许可主体（美国空军乐队公有领域录音）不变，可在后续提交中顺手校正署名文字。

---

## 4. 架构文档 `docs/`（7 个文件）—— 建议上传

**为什么传**：`system_design.md` 记录了架构约束、诊断与棋力目标/实测回填，`class-diagram.mermaid` 与 `sequence-diagram.mermaid` 可直接渲染，正是"评估架构"最需要的背景材料；其余为棋力标定与规则清单。

**为什么不传同目录的 `tier-calibration-raw*.json`**：它们是探针原始输出（3 份共约 118 KB），属于可再生成的数据快照，结论已汇总进 `档位标定报告.md`。

```
docs/NATIVE_ENGINE_ROADMAP.md
docs/VERSION_MATCH.md
docs/class-diagram.mermaid
docs/sequence-diagram.mermaid
docs/system_design.md
docs/xiangqi-rules-checklist.md
docs/档位标定报告.md
```

---

## 5. APK 复现所需 `tools/manual-apk/`（118 个文件）—— 全部上传

**为什么传**：`build_final.py` + 文本 Manifest + `MainActivity.java` + JNI 桥接层 + Pikafish C++ 源码 + 资源与语音素材，是"从源码重建 APK"的完整输入。Pikafish 源码为 GPLv3，保留源码亦满足许可可追溯性。

**为什么不传该目录的其他内容**：`bin/ obj/ classes/ gen/ stage*/ verify-delivered/` 均为构建中间产物或反编译验证副本；`assets/` 是旧版打包产物；`keystore/debug.jks` 是签名密钥；`_backup/` 是历史快照；`compiled.flata`、`Hello.java` 为编译缓存/调试 stub。这些全部排除。

### 5.1 构建脚本与 Android 工程（4）

```
tools/manual-apk/AndroidManifest.xml
tools/manual-apk/build_final.py
tools/manual-apk/src/com/xiangqi/trainer/MainActivity.java
tools/manual-apk/res/values/strings.xml
```

### 5.2 资源与语音素材（5）

```
tools/manual-apk/res/drawable/ic_launcher.png
tools/manual-apk/voice-assets/capture.m4a
tools/manual-apk/voice-assets/check.m4a
tools/manual-apk/voice-assets/land.wav
tools/manual-apk/voice-assets/mate.m4a
```

### 5.3 JNI 桥接层（4）

```
tools/manual-apk/jni/Android.mk
tools/manual-apk/jni/Application.mk
tools/manual-apk/jni/pikafish_jni.cpp
tools/manual-apk/jni/pikafish_skeleton.cpp
```

### 5.4 Pikafish 原生源码（105）

```
tools/manual-apk/jni/pikafish/Makefile
tools/manual-apk/jni/pikafish/attacks.cpp
tools/manual-apk/jni/pikafish/attacks.h
tools/manual-apk/jni/pikafish/benchmark.cpp
tools/manual-apk/jni/pikafish/benchmark.h
tools/manual-apk/jni/pikafish/bitboard.cpp
tools/manual-apk/jni/pikafish/bitboard.h
tools/manual-apk/jni/pikafish/engine.cpp
tools/manual-apk/jni/pikafish/engine.h
tools/manual-apk/jni/pikafish/evaluate.cpp
tools/manual-apk/jni/pikafish/evaluate.h
tools/manual-apk/jni/pikafish/external/common/allocations.h
tools/manual-apk/jni/pikafish/external/common/bits.h
tools/manual-apk/jni/pikafish/external/common/bitstream.h
tools/manual-apk/jni/pikafish/external/common/bmi2.h
tools/manual-apk/jni/pikafish/external/common/compiler.h
tools/manual-apk/jni/pikafish/external/common/cpu.h
tools/manual-apk/jni/pikafish/external/common/debug.cpp
tools/manual-apk/jni/pikafish/external/common/debug.h
tools/manual-apk/jni/pikafish/external/common/entropy_common.cpp
tools/manual-apk/jni/pikafish/external/common/error_private.cpp
tools/manual-apk/jni/pikafish/external/common/error_private.h
tools/manual-apk/jni/pikafish/external/common/fse.h
tools/manual-apk/jni/pikafish/external/common/fse_decompress.cpp
tools/manual-apk/jni/pikafish/external/common/huf.h
tools/manual-apk/jni/pikafish/external/common/mem.h
tools/manual-apk/jni/pikafish/external/common/pool.cpp
tools/manual-apk/jni/pikafish/external/common/pool.h
tools/manual-apk/jni/pikafish/external/common/portability_macros.h
tools/manual-apk/jni/pikafish/external/common/threading.cpp
tools/manual-apk/jni/pikafish/external/common/threading.h
tools/manual-apk/jni/pikafish/external/common/xxhash.cpp
tools/manual-apk/jni/pikafish/external/common/xxhash.h
tools/manual-apk/jni/pikafish/external/common/zstd_common.cpp
tools/manual-apk/jni/pikafish/external/common/zstd_deps.h
tools/manual-apk/jni/pikafish/external/common/zstd_internal.h
tools/manual-apk/jni/pikafish/external/common/zstd_trace.h
tools/manual-apk/jni/pikafish/external/decompress/huf_decompress.cpp
tools/manual-apk/jni/pikafish/external/decompress/huf_decompress_amd64.S
tools/manual-apk/jni/pikafish/external/decompress/zstd_ddict.cpp
tools/manual-apk/jni/pikafish/external/decompress/zstd_ddict.h
tools/manual-apk/jni/pikafish/external/decompress/zstd_decompress.cpp
tools/manual-apk/jni/pikafish/external/decompress/zstd_decompress_block.cpp
tools/manual-apk/jni/pikafish/external/decompress/zstd_decompress_block.h
tools/manual-apk/jni/pikafish/external/decompress/zstd_decompress_internal.h
tools/manual-apk/jni/pikafish/external/zstd.h
tools/manual-apk/jni/pikafish/external/zstd_errors.h
tools/manual-apk/jni/pikafish/history.h
tools/manual-apk/jni/pikafish/magics.h
tools/manual-apk/jni/pikafish/main.cpp
tools/manual-apk/jni/pikafish/memory.cpp
tools/manual-apk/jni/pikafish/memory.h
tools/manual-apk/jni/pikafish/misc.cpp
tools/manual-apk/jni/pikafish/misc.h
tools/manual-apk/jni/pikafish/movegen.cpp
tools/manual-apk/jni/pikafish/movegen.h
tools/manual-apk/jni/pikafish/movepick.cpp
tools/manual-apk/jni/pikafish/movepick.h
tools/manual-apk/jni/pikafish/nnue/features/full_threats.cpp
tools/manual-apk/jni/pikafish/nnue/features/full_threats.h
tools/manual-apk/jni/pikafish/nnue/features/k6h4.cpp
tools/manual-apk/jni/pikafish/nnue/features/k6h4.h
tools/manual-apk/jni/pikafish/nnue/layers/affine_transform.h
tools/manual-apk/jni/pikafish/nnue/layers/affine_transform_sparse_input.h
tools/manual-apk/jni/pikafish/nnue/layers/clipped_relu.h
tools/manual-apk/jni/pikafish/nnue/layers/sqr_clipped_relu.h
tools/manual-apk/jni/pikafish/nnue/network.cpp
tools/manual-apk/jni/pikafish/nnue/network.h
tools/manual-apk/jni/pikafish/nnue/nnue_accumulator.cpp
tools/manual-apk/jni/pikafish/nnue/nnue_accumulator.h
tools/manual-apk/jni/pikafish/nnue/nnue_architecture.h
tools/manual-apk/jni/pikafish/nnue/nnue_common.h
tools/manual-apk/jni/pikafish/nnue/nnue_feature_transformer.h
tools/manual-apk/jni/pikafish/nnue/nnue_misc.cpp
tools/manual-apk/jni/pikafish/nnue/nnue_misc.h
tools/manual-apk/jni/pikafish/nnue/nnz_helper.h
tools/manual-apk/jni/pikafish/nnue/simd.h
tools/manual-apk/jni/pikafish/numa.h
tools/manual-apk/jni/pikafish/perft.h
tools/manual-apk/jni/pikafish/position.cpp
tools/manual-apk/jni/pikafish/position.h
tools/manual-apk/jni/pikafish/score.cpp
tools/manual-apk/jni/pikafish/score.h
tools/manual-apk/jni/pikafish/search.cpp
tools/manual-apk/jni/pikafish/search.h
tools/manual-apk/jni/pikafish/shm.h
tools/manual-apk/jni/pikafish/shm_unix.h
tools/manual-apk/jni/pikafish/thread.cpp
tools/manual-apk/jni/pikafish/thread.h
tools/manual-apk/jni/pikafish/thread_native.h
tools/manual-apk/jni/pikafish/timeman.cpp
tools/manual-apk/jni/pikafish/timeman.h
tools/manual-apk/jni/pikafish/tt.cpp
tools/manual-apk/jni/pikafish/tt.h
tools/manual-apk/jni/pikafish/tune.cpp
tools/manual-apk/jni/pikafish/tune.h
tools/manual-apk/jni/pikafish/types.h
tools/manual-apk/jni/pikafish/uci.cpp
tools/manual-apk/jni/pikafish/uci.h
tools/manual-apk/jni/pikafish/ucioption.cpp
tools/manual-apk/jni/pikafish/ucioption.h
tools/manual-apk/jni/pikafish/universal/entry_arm64.cpp
tools/manual-apk/jni/pikafish/universal/entry_riscv64.cpp
tools/manual-apk/jni/pikafish/universal/entry_x86.cpp
tools/manual-apk/jni/pikafish/universal/rewrite_asm_sections.awk
```

---

## 6. 本次新增文档（3 个文件）—— 全部上传

**为什么传**：仓库门面、忽略规则与上传审计依据。

```
README.md
.gitignore
UPLOAD_MANIFEST.md
```

---

## 7. 明确排除清单（**禁止推送**）

### 7.1 依赖与构建产物

| 路径 / 模式 | 为什么不传 |
|---|---|
| `node_modules/`（约 300 个包） | 可由 `npm install` + `package-lock.json` 精确重建；体积巨大且含平台二进制。 |
| `dist/`、`dist-new/` | Vite 构建产物，含带内容哈希的 JS/CSS，`npm run build` 可再生成。 |
| `tools/manual-apk/bin/`、`obj/`、`classes/`、`gen/`、`stage/`、`stage2/`、`stage-responsive/`、`stage-tmp/`、`stage-final/`、`verify-delivered/` | 编译中间目录与打包/验证副本（含 `.so`、`.dex`、`resources.arsc`、反编译 HTML），非源码。 |
| `tools/manual-apk/assets/` | 旧版打包资源副本。 |
| `tools/manual-apk/compiled.flata`、`Hello.java`、`*.tsbuildinfo` | 编译缓存与调试 stub。 |
| `docs/tier-calibration-raw*.json` | 探针原始数据快照，可再生成；结论已进入报告。 |

### 7.2 安装包与签名材料（**敏感/大文件**）

| 路径 / 模式 | 为什么不传 |
|---|---|
| `*.apk`（约 50 个，每个 13–65 MB） | 二进制安装包，体积巨大；源码可重建。 |
| `*.apk.idsig`（约 50 个） | 签名块，无源码价值。 |
| `tools/manual-apk/keystore/debug.jks` | **签名密钥，绝不入库**；本地自行生成。 |
| `tools/manual-apk/stage-final/assets/public/engine/pikafish.nnue` | 50 MB 权重副本，许可受限（见下）。 |
| `tools/pikafish-net/pikafish.nnue`（50,308,806 B）、`tools/pikafish-src/src/pikafish.nnue` | **Pikafish NNUE 非商用权重**：`NNUE_LICENSE.txt` 明确"未经许可不得商用"，不可入库，需自行获取。 |
| `tools/manual-apk/_backup/`、`_backup/`、`backups/` | 历史版本快照，含旧版 `.java`/`.py`/源码，容易误当现行实现。 |

### 7.3 外部工具链与第三方源码副本

| 路径 / 模式 | 为什么不传 |
|---|---|
| `tools/android-sdk`、`tools/jdk17`、`tools/npm-cache` | 本机工具链与缓存，体积以 GB 计，与源码无关。 |
| `tools/pikafish-src/` | 上游 Pikafish 源码副本；真正参与编译的源码已在 `tools/manual-apk/jni/pikafish/`，避免重复与版本混淆。 |
| `tools/pikafish-net/`（含 `pikafish.nnue`） | 权重受非商用许可约束；两份许可文本也不随仓库分发，README 指引从上游获取。 |

### 7.4 一次性 QA 脚本与截图

| 路径 / 模式 | 为什么不传 |
|---|---|
| 根目录 `cdp-*.mjs`、`audit-*.mjs`、`probe-*.mts`、`qa-*.mjs` / `qa-*.mts` / `qa-*.harness.*`、`bench.mts`、`fetch-*.mjs`、`verify-*.mjs`、`*-shot*.mjs`、`*-tmp.mjs`、`qayan2-*.mjs`、`sim-shot.mjs`、`palette-check.mjs` | 一次性调试/CDP/性能探针脚本，强依赖本机路径与运行态，非产品代码。 |
| 根目录 `qa-*.png`、`qayan2-*.png`、`visual-*.png`、`icon-preview.png`、`*result.json` | QA 截图与临时结果，单张约 0.6–1.3 MB，无源码价值。 |
| `.DS_Store`、编辑器/系统临时文件 | 平台垃圾文件。 |

> 注意：`src/qa/*.test.ts(x)` 属于正式回归测试，**不在**本节排除范围内，仍按第 1.10 组上传。

---

## 8. 推送顺序建议（供主理人用 GitHub MCP 逐文件推送）

1. 先推 `.gitignore`、`README.md`、`UPLOAD_MANIFEST.md`；
2. 再推根配置 8 个文件（保证依赖可安装）；
3. 推 `src/` 221 个文件（按第 1 节分组顺序）；
4. 推 `public/music/` 4 个文件；
5. 推 `docs/` 7 个文件；
6. 最后推 `tools/manual-apk/` 118 个文件（**源路径在工作区同级的 `tools/manual-apk/`，目标路径为仓库内 `tools/manual-apk/`**）。

推送完成后核对：仓库中不存在任何 `.apk`、`.idsig`、`.nnue`、`.jks`、`.keystore`、`.so`、`.dex`、截图或 QA 一次性脚本。
