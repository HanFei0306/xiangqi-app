# 原生 Pikafish 引擎路线（非商用验证版）

## 用户确认的决策

1. 引擎路线：原生 Pikafish JNI。
2. 当前 App **不商用**，后续完善后再考虑商用。
3. v20.2 只搭 JNI 骨架、不切换走棋；v20.3 起提供 `pikafish-nc` 非商用验证包。
4. v20.2 默认自研；v20.3 的 `pikafish-nc` 包在 SPRT 8:0 通过后默认切原生引擎；`self` 包无 native bridge，始终自研。

## v2026.11.20.3 实际内容

- NDK 27.2.12479018 已安装。
- Pikafish 官方源码已拉取到 `tools/pikafish-src/`，并复制到 `tools/manual-apk/jni/pikafish/` 供 NDK 编译。
- 已对本地源码副本的 `uci.h` 增加 4 个 JNI 专用公开钩子（set_position / go / wait / clear / setoption），不改 UCI 行为。
- 真 JNI 库：`lib/arm64-v8a/libpikafish_nc.so`（1.7MB）。
- NNUE 权重：`assets/public/engine/pikafish.nnue`（50,308,806 字节，官方 master-net）。
- 随包许可：`assets/public/licenses/NNUE_LICENSE.txt`、`PIKAFISH_GPLv3.txt`。
- TS 适配层：`src/ai/nativeEngine.ts`（Board→FEN、Move→UCI、bestmove→Move）；`src/ai/activeEngine.ts` 根据 URL 参数选引擎。
- 调用入口：`gameStore` 改用 `activeEngine`，默认仍是自研引擎。

## 实证结果

- 主机版 Pikafish 加载 NNUE 成功，输出：`NNUE evaluation using pikafish.nnue (61MiB, (62083, 1024, 32, 32, 1))`。
- 初始局面 depth6 输出 `bestmove h2e2 ponder b9c7`。
- `npm run sprt:pikafish`：Pikafish vs 自研引擎，双方同 depth6、无开局库/无变着，8 局 **8:0**，scoreRate 1.0，LLR 3.347 > 2.996，**通过**。
- 曾发现并修复两个驱动 bug：① `quit` 紧跟 `go` 会提前停止搜索；② 当前局面 FEN 不能再叠加历史着法。修复后结果才可信。

## 产物区分

| 产物 | 权重 | 默认引擎 | 用途 |
|---|---|---|---|
| `xiangqi-v2026.11.20.2.apk` | 无 | 自研 | 安全稳定包 |
| `xiangqi-v2026.11.20.3.apk` | Pikafish NNUE（非商用） | 自研；`?engine=pikafish` 切 Pikafish | 非商用验证包，禁止商用分发 |

## 商用前置条件

1. 取得 Pikafish NNUE 商用授权；或
2. 用自对弈数据训练自有 NNUE 权重并替换；
3. 删除/替换 `pikafish.nnue` 后重新过 `release-check`；
4. GPLv3 源码义务继续履行。

## v2026.11.20.4 增量

- 原生引擎搜索参数升级：默认中级从 depth6/1 线程改为 **depth16 / movetime3000ms / 2 线程**；特级大师 depth20 / 6000ms；高级 depth10 / 800ms。
- 升级实证 `npm run sprt:pikafish-upgrade`：新配置 vs 上一版配置 10 局 **9 胜 1 和 0 负**，phat 0.95，LLR **3.608 > 2.996**，通过。
- 对局页底部新增“引擎：Pikafish NNUE / 自研引擎”标识，用户可直接确认当前生效引擎。
- 适情雅趣新增“音效试听：走棋 / 吃子 / 将军”按钮；点击手势内直接发声。
- 新增首次手势音频预热（静音 WAV + `resume()`），解决部分 Android WebView 对 Web Audio 的挂起策略。
- CDP 真机式验证：落子两组各 5 节点，试听按钮点击后立即 5 节点，`AudioContext=running`。

## 已知边界

- 只编译了 `arm64-v8a`；Pikafish 需要 128 位 Bitboard，当前源码在 32 位 ABI 下不可编译。
- Native 路径是同步调用，在手机上可能阻塞 UI，仅用于验证；默认包不受影响。
- 适情雅趣仍使用专用残局引擎与杀棋证明，不直接交给 Pikafish。
