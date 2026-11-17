# 语音 Agent 技术报告 × OneTHU 现状 · Phase 0 审计

> 归档说明：本文记录 2026-10-09 针对 OneTHU `dev2`（`43b8d27`，v0.10.0 线）与《技术开发报告：Tauri 2 跨平台语音 Agent》（下称“报告”）所做的现状盘点与技术选型方案；文中模型与 SDK 外部数据采集于 2026-10-09。

---

## 0. 核心结论一览

1. **报告从零起步规划的功能中，OneTHU 已完成 Phase 1 全部内容与 Phase 2 主体。**
   报告 Phase 1 规划的文本 Agent 闭环，已在 0.10.0 作为 OneTHU Harness（OH）正式上线，具备流式输出、中途打断、工具调用、多会话、token 预算、MCP 接入与插件联动能力。报告 Phase 2 规划的 STT 复用与手动语音入口，也已在 ChatDock 灵动岛落地长按语音交互，完成了 macOS 全链路验证，并将 Android 端 `onethu-speech` 插件并入正式 APK。
2. **核心架构对齐：OneTHU 的 Agent Core 已由成熟的 Rust 骨干承担。**
   核心实现位于 `plugins/OneTHU-Harness/core`（涵盖 agent、llm、session、tools、mcp、usage），桌面端以 stdio sidecar 运行，Android 端通过 `harness_embed.rs` 直接编译进 App 进程；因此可直接在现有架构上扩展语音编排，省去报告 §7 规划的 `src/core/*.ts` 新建工作。
3. **LLM 接入已全面就绪**：内置清华 MadModel 免费通道（校园网免登录调用 DeepSeek-V4-Flash，校外自动走 webvpn 通道）与任意 OpenAI 兼容自费 API，支持在插件设置页下拉切换；日常分发只需持续遵循“安装包内零固化 API Key”的规范。
4. **真正需要从零建设的增量集中在三块**：本地 TTS、自定义唤醒词，以及常驻监听前台服务（其中前台服务可参考 `onethu-mobile` 中 `QrKeepAliveService` 的 `DATA_SYNC` 服务实现）。
5. **唤醒词选型调整**：Porcupine 已确认支持普通话自定义唤醒词（可在 Console 自助训练 `.ppn`），但其运行依赖 AccessKey 且采用专有商业许可，难以契合 OneTHU 开源、面向全校免费分发的定位。建议采用 **sherpa-onnx KWS 作为主路线**（Apache-2.0 许可，开放词表修改 `keywords.txt` 即可零训练换词，且与本地 TTS 共用同一套底层库，一次集成即可兼顾两项能力），将 Porcupine 留作离线准确率评测对照。
6. **报告数据核校**（详见 §7）：报告提到的 aishell3“约 29 MB”对应轻量级 icefall 变体（tarball 实测 30.1 MB、8 kHz 采样率）；完整版 `vits-zh-aishell3` 模型体积为 116 MB（tarball 140.1 MB）；Kokoro int8 实测为 140.2 MB。
7. **编译环境核验**：2026-10-08 已整体迁移至 `/Volumes/OneTHUBuild` 编译盘（`oh-build.sparsebundle`）。本次盘点已重新挂载并确认 cargo/rustc 1.99.0、NDK 27.1.12297006 与全套 Android SDK 均工作正常，同时修正了 `~/onethu-android/local.properties` 中遗留的旧 `sdk.dir` 路径。**当前暂无 adb 设备在线**，开展真机验证前连接 Honor 测试机即可。

---

## 1. 报告假设 vs OneTHU 实际（逐条对照）

| # | 报告的假设/要求 | OneTHU 实际 | 处置 |
|---|---|---|---|
| 1 | 新建 `my-agent` 项目，从零搭 Tauri 2 | 成熟 monorepo（packages/core、info-lib、ui + apps/desktop），Tauri 2 + Vite + React + pnpm，三端发布中 | 直接在现有仓库增量演进 |
| 2 | TypeScript Agent Core（agent.ts/llm-client.ts/…） | Rust 骨干 OH（独立子模块仓库），桌面 sidecar / Android 内嵌双形态；前端 ChatDock 负责宿主桥接（JSON-RPC run） | 复用现有 Rust 核心；语音编排放在 TS 侧新增的 voice 模块或经 OH host 通道扩展 |
| 3 | LLM 通过可配置 API 访问（待实现） | MadModel 免费档 + 自费 OpenAI 兼容双通道已上线，含校外 webvpn、价格预算熔断 | 已上线，持续保持安装包零内置固定 Key 规范 |
| 4 | 复用已有 STT 模块（待定位） | `src/lib/speech.ts` + `onethu-speech` Kotlin 插件（Android 系统 SpeechRecognizer，zh-CN 会话式 start/poll/stop）+ macOS `speech.m`（SFSpeechRecognizer），链路已接入 ChatDock | 已具备；将 Android 真机端到端验证列为 Phase 1 首项 |
| 5 | 手动语音入口备用 | 灵动岛长按 450ms 语音（遮罩实时转写、松手填入输入框待确认发送）已承担此入口 | 已上线 |
| 6 | 自定义唤醒词（Porcupine 优先评估） | 尚待新建 | 排入 Phase 3；优先采用 sherpa-onnx KWS（§3.2） |
| 7 | 本地 TTS（sherpa-onnx 优先） | 尚待新建（仓库内暂无 TTS/朗读代码） | 排入 Phase 2；直接内嵌至移动插件（§3.3） |
| 8 | MCP / Skills 分阶段、不阻塞闭环 | MCP 已上线（`core/src/mcp.rs`，stdio 冷启动）；插件联动、UI 通道与结构化结果均已就绪 | 报告 Phase 6 的 MCP 任务可直接结项 |
| 9 | §7 建议目录结构 `plugins/voice-android/` | OneTHU 已有统一的 Tauri 移动插件规范：`apps/desktop/src-tauri/plugins/<name>/{android,src,guest-js…}`，具备 onethu-speech / onethu-mobile / onethu-calendar 三个样板 | 沿用现有规范，新插件命名为 `onethu-voice` |
| 10 | Phase 1 文本 Agent 闭环 | 0.10.0 已随 OH 正式发布 | 已完成；Phase 1 聚焦“Android 真机文本+语音闭环验证” |
| 11 | 独立于系统助手运行、异常时平滑回退 | 应用内独立运行，与系统默认助理互不干扰 | 保持现有定位 |
| 12 | SQLite 本地持久化 | 现有 localStorage + 插件 settings + Rust 侧会话存储运行稳定，无额外 SQLite 依赖 | 首期沿用现有存储方案，保持轻量依赖 |

---

## 2. 已有资产盘点

### 2.1 STT（对应报告 §4.3 的现有模块）

- **统一契约**（四条命令跨平台一致）：`speech_supported` / `speech_start` / `speech_poll`（获取部分转写）/ `speech_stop`（收取最终文本）。命令按平台路由：Android 走 `plugin:onethu-speech|*`，桌面端走 app crate。
- **Android 实现** `plugins/onethu-speech/.../OnethuSpeechPlugin.kt`（165 行）：
  调用系统 `SpeechRecognizer`，配置 `zh-CN` 与 `EXTRA_PARTIAL_RESULTS` 并在主线程运行；当识别器静音超时而用户仍按住说话时，会自动重启新一轮识别以支持自然停顿换气；权限被拒时返回带明确原因的错误。`RECORD_AUDIO` 已在插件 manifest 中声明。
  当前实现绑定在 Activity 生命周期内，在 WebView 活跃期间提供语音转写；后台常驻监听则由后续新增的唤醒词前台服务承接。
- **macOS 实现** `src-tauri/native/speech.m`：基于 `SFSpeechRecognizer` + `AVAudioEngine`，已完成全链路验证（包含“识别任务须先于首帧音频创建”等实测经验归档）。
- **前端链路** `ChatDock.tsx`：长按 450ms → `speechStart` → 每 180ms 轮询 → 松手后留出 320ms 宽限期读取最终文本 → 创建 `newSession` 并填入输入框 → 用户确认回车后通过 `callRust(id, "run", …)` 交由 OH 执行。
- **待验证点**：Android 系统 `SpeechRecognizer` 的可用性及云端/本地识别模式取决于具体 ROM 的语音识别服务（尤其无 GMS 的 Honor/Huawei 机型），将其列为 Phase 1 首要真机验证项。

### 2.2 Agent Core（OH）

- `plugins/OneTHU-Harness`（git 子模块，对应独立仓库 `smartThise/OneTHU-Harness`）：`core/src/` 包含 `agent.rs`（主控循环）、`llm.rs`（ureq HTTP）、`session.rs`、`tools.rs`（校园工具、插件联动及 `mcp_*` 前缀分发）、`mcp.rs`、`madmodel.rs` 与 `usage.rs`（用量预算）。采用宿主解耦设计，可灵活编译进移动端进程或作为桌面端 sidecar 运行。
- Android 集成形态：`src-tauri/src/harness_embed.rs` 提供 `harness_start/call/notify/rpc_reply/stop` 命令桥、独立 agent 线程与前端门面桥（发出 `onethu.call` 事件交由 WebView 执行后回写结果）。
- 前端统一调用层 `plugins/rust.ts`：桌面端拉起独立二进制，移动端调用 `startHarnessEmbedded`，上层统一通过 `callRust` 通信。
- 权限门禁：manifest 定义了 26 项细粒度权限（涵盖 `user:read`、`llm`、`plugins:call`、邮箱与云盘读写等），所有工具调用均经过 `gate()` 校验，写入类操作执行两段式确认，全面覆盖报告 §6 的工具执行权限要求。

### 2.3 LLM 接入（基于 2026-09-19 实测归档）

- 免费通道：`https://madmodel.cs.tsinghua.edu.cn/v1`，调用模型 `DeepSeek-V4-Flash-0731`（150k 上下文），校园网环境下免登录签发 6 小时 JWT（由前端 `src/state/madmodel.ts` 自动维护，Rust 侧每次 `run` 实时读取配置）；校外访问收到 307 时自动切换至 SSO + webvpn 通道，且免费档计价为 0，免除预算熔断限制。
- 自费通道：支持配置任意 OpenAI 兼容的 `base`、`key` 与 `model`。
- 小结：报告 §6 提出的 LLM 接入需求均已上线，且现有打包管线已严格保持 APK 内零固化密钥。

### 2.4 UI 与语音交互（ChatDock 灵动岛）

底部中央常驻胶囊（动态展示临近日程、作业提醒或默认提示文案），点击展开 `50vh` 对话面板，长按即可触发语音输入。面板已支持多会话切换、上下文导出、token 用量展示、思考链与工具调用折叠回看、超时看门狗及过期事件过滤（R10），交互完备度已超出报告 §10 的基础要求。**TTS 朗读开关将作为该面板首个语音播报功能接入。**

### 2.5 Android 工程与构建管线

- `gen/android` 软链接至 `~/onethu-android`（位于内置 APFS 分区，规避外置 exFAT 分区的 AppleDouble 隐藏文件干扰）；`minSdk 24`、`target/compileSdk 36`，正式包名 `app.onethu.desktop`。
- `apps/desktop/scripts/build-release-apk.sh`：串联发布线不变量检查、`rootDirRel` 绝对路径转换、符号链接就位、NDK 交叉编译（环境变量已对齐新 SDK 路径）、Gradle 打包及 `zipalign`/`apksigner` 签名。
- 签名密钥：存放于 `/Volumes/PortableSSD/Projects/thuapp/OneTHU-signing/`。
- 安装包体积：arm64 主包约 12 MB，universal 包约 39 MB。
- 关键构建规范均已沉淀：手动运行 `cargo` 时须附带 `--features tauri/custom-protocol`（吸取 0.7.2 线上经验），构建产物统一输出至 APFS 编译盘的 `CARGO_TARGET_DIR`。

### 2.6 前台服务先例

`onethu-mobile/.../QrKeepAliveService.kt` 已实现通知渠道初始化、幂等 `onStartCommand` 与 `startForeground(FOREGROUND_SERVICE_TYPE_DATA_SYNC)`。**唤醒词常驻监听服务可直接沿用该服务骨架**，只需将服务类型切换为 `microphone` 并在应用 manifest 中补充 `FOREGROUND_SERVICE_MICROPHONE` 权限声明（见 §3.4）。

---

## 3. 外部技术核实（对应报告 §12 任务 3/4，2026-10-09 采集）

### 3.1 Porcupine（报告初始推荐方案）

- **普通话自定义唤醒词：已确认支持。** 官方仓库 README 的“Language Support”明确列出 English、Chinese (Mandarin)、French 等九种语言，支持在 Picovoice Console 自助训练生成 `.ppn` 唤醒词文件。
- Android SDK：Maven Central 提供 `ai.picovoice:porcupine-android` v4.0.0（2025-12-11 发布）。官方示例覆盖完整，包含 **Service demo（常驻前台服务唤醒）** 与 **STT demo（唤醒后衔接语音识别）**，与报告 §4.1 设计的交接流程高度吻合，适合作为工程实现参考。
- **许可限制**：SDK 初始化强制校验 AccessKey；免费额度仅限个人开发与内部评估，面向全校学生公开分发 APK 需采购商业授权。由于 OneTHU 采用附带非商用限制的 MIT 开源许可并免费分发，主发布链路需选用纯开源方案。
- 定位：将 Porcupine 作为**离线准确率对照组**（使用个人评估 AccessKey 在测试机上对比唤醒表现），正式发布包采用开源方案。

### 3.2 推荐主路线：sherpa-onnx KWS

- **开放词表零训练换词**：唤醒词直接配置在 `keywords.txt` 文本文件中（通过 `sherpa-onnx-cli text2token --tokens-type ppinyin` 将“你好小欧”转换为拼音 token 序列），更换唤醒词无需重新训练模型，且每个词条均可独立调节 boosting score 与 trigger threshold 以平衡唤醒灵敏度与误报率。
- 候选开源模型（均采用 Apache-2.0 许可）：
  - `sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`（纯中文，基于 WenetSpeech 1 万小时语料）：int8 量化版总计约 5 MB（encoder 4.6M + decoder 177K + joiner 64K）；
  - `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`（中英双语，2025-12 发布）：int8 encoder 4.4 MB，流式 chunk-8 延迟 160ms / chunk-16 延迟 320ms。
- 官方提供现成的 Android KWS 演示 APK 可直接装机体验，且与本地 TTS 共用同一套 `sherpa-onnx` JNI 运行库，**集成一次即可同时支撑关键词唤醒与本地语音合成**。
- 实测重点：轻量开放词表模型的误唤醒率需在目标真机上开展定量测试，按报告 §10“唤醒准确率与误触发”表格记录不同阈值下的表现。
- 麦克风交接方案：KWS 接收 `AudioRecord` PCM 音频流（16k/mono/16bit），而系统 `SpeechRecognizer` 自行接管录音；唤醒后的交接只需先暂停 KWS 的 `AudioRecord`，拉起 `SpeechRecognizer` 完成识别后再恢复 KWS 监听，与报告 §4.1 的状态流转自然对应。

### 3.3 TTS 候选模型核实（基于官方文档与 Release API 实测 tarball 体积）

| 模型 | 语言/说话人 | 采样率 | 实测体积 | 备注 |
|---|---|---|---|---|
| vits-icefall-zh-aishell3 | 中 / 174 spk | 8 kHz | **30.1 MB** | 对应报告中“约 29MB”的数据；采样率较低，仅作打通管线的轻量冒烟测试档 |
| vits-zh-aishell3（完整版） | 中 / 174 spk | 8 kHz | 140.1 MB | aishell3 完整权重版本，同为 8 kHz 采样率 |
| **vits-melo-tts-zh_en** | 中英 / 1 spk | 44.1 kHz | **159.3 MB** | 社区生态成熟，内置 date/number fst 数字与日期归一化；树莓派 4 四线程 RTF 2.5，手机端 SoC 推理更快 |
| kokoro-multi-lang-v1_1 **int8** | 中英等 / 103 spk（含 8 个中文音色 zf_/zm_） | 24 kHz | **140.2 MB** | 音色丰富、自然度出色；优先选用 int8 量化版（fp32 版为 347.9 MB），内存峰值待真机实测 |
| vits-zh-hf-fanchen-C 等 HF 系 | 中 / 187 spk | 16 kHz | ≈116 MB | 备选中文模型 |

- **真机试听建议：重点对比 melo（综合首选）与 kokoro-int8（多音色档）**，将 `icefall-aishell3` 用于早期管线冒烟验证。针对播报作业截止时间等高频数字/日期场景，melo 与 kokoro 均自带 fst 文本归一化支持。
- **集成路径：直接内嵌至应用移动插件**（对应报告方案二）。一方面，仓库已有三个成熟的 Tauri 移动插件样板，复用 `onethu-speech` 骨架即可快速落地；另一方面，内嵌方案便于在应用内统一管理生命周期、模型下载进度与播放状态回调，免去用户前往系统设置手动切换全局 TTS 引擎的步骤。落地前先在真机安装官方 TTS APK 试听音质并记录性能指标，再选定默认模型。

### 3.4 Android 系统约束（targetSdk 36 规范）

- 前台服务类型声明（API 34+）：唤醒监听服务需同时配置 `android:foregroundServiceType="microphone"`、`FOREGROUND_SERVICE` 与 `FOREGROUND_SERVICE_MICROPHONE`；应用现有 manifest 已包含 `DATA_SYNC`（供 `QrKeepAliveService` 使用），在此基础上增量补充麦克风服务声明即可。
- 麦克风前台服务的 `while-in-use` 要求：Android 规定麦克风类前台服务须由用户在前台界面主动开启，与报告“用户主动开启唤醒监听”的交互设计一致。锁屏或熄屏状态下的持续监听受各手机厂商省电与隐私策略制约，首期聚焦前台及常规驻留场景，并在界面与文档中清晰说明后台表现。
- `SpeechRecognizer` 与 KWS 的录音设备交接：采用“暂停 KWS → 启动语音识别 → 识别结束恢复 KWS”的串行交接协议（详见 §3.2）。
- 与系统级语音助手（如小艺）的共存表现：安排在真机阶段实测并归档（对应报告 §8.2）。

---

## 4. 环境核验清单（Phase 0 交付）

| 项 | 状态 | 说明 |
|---|---|---|
| Node 22.22.1 / pnpm 10.33.0 | ✅ | |
| JDK 17.0.18 | ✅ | Gradle 固定使用 openjdk@17 |
| Rust cargo/rustc 1.99.0 | ✅ | 位于编译盘 `cargo-home`（本次已挂载核验） |
| Android SDK（build-tools 36/平台/模拟器） | ✅ | `/Volumes/OneTHUBuild/oh-android-sdk` |
| NDK 27.1.12297006 | ✅ | 与现有正式版签名构建管线一致 |
| gradle 工程 `~/onethu-android` | ✅ | `local.properties` 的 `sdk.dir` 已修正指向编译盘 |
| adb 设备 | ⚠️ **无设备在线** | 真机测试前连接目标 Honor 手机即可 |
| exFAT 构建防护 | ✅ 已制度化 | 统一使用 `build-release-apk.sh`，编译产物输出至 APFS 编译盘 |

**2026-10-08 编译盘迁移说明**：移动端构建工具链已整体迁入 APFS 稀疏磁盘映像 `oh-build.sparsebundle`（挂载点 `/Volumes/OneTHUBuild`），其中 SDK/NDK 位于 `oh-android-sdk`、Gradle 缓存位于 `gradle-home`、Rust 工具链位于 `cargo-home` 与 `rustup-home`；`~/.zshenv` 环境变量已全部配妥，`dev-launch.sh` 也内置了自动挂载逻辑。**日常编译前只需确保外置 SSD 已连接并完成挂载。** 本次核验已通过以下命令挂载验证：
`hdiutil attach /Volumes/PortableSSD/oh-build.sparsebundle -mountpoint /Volumes/OneTHUBuild -nobrowse`。

---

## 5. 风险清单（按影响程度排序）

1. **目标 Honor 真机的系统 STT 表现待实测**：需在无 GMS 的 ROM 上实测系统 `SpeechRecognizer` 的服务提供方（HMS 或厂商自研）、云端/本地识别模式及弱网表现（列为 Phase 1 首要验证项）；若目标机型缺少系统识别服务，可同库扩展接入 `sherpa-onnx` 流式 ASR 模型承接。
2. **KWS 误唤醒率需真机定量标定**：3M zipformer 轻量模型配合开放词表，需按报告 §10 完成多场景测试记录，并通过阈值与 boosting 参数调优控制误触发。
3. **TTS 运行时内存峰值**：kokoro int8（140 MB）与 melo（159 MB）加载进 `onnxruntime` 后的常驻内存占用对中低端机型存在压力，首版需完整测量冷启动耗时、内存峰值与合成延迟（填入报告 §10 性能表）。
4. **麦克风互斥与回声规避**：除 KWS（`AudioRecord`）与 `SpeechRecognizer` 串行交接外，TTS 播报期间也须暂停 KWS 监听，防止扬声器声音被麦克风拾取造成自唤醒。
5. **锁屏驻留受厂商策略限制**：首期聚焦应用活跃与常规后台场景，并在设置页与文档中清晰提示锁屏状态下的回退表现。
6. **Porcupine 商业授权约束**：已通过采用 Apache-2.0 许可的 `sherpa-onnx` KWS 主路线妥善规避。
7. **外置编译盘挂载依赖**：构建任务依赖 `/Volumes/OneTHUBuild` 在线，已由 `dev-launch.sh` 自动挂载脚本与环境自检流程保障。

---

## 6. 调整后的分阶段实施计划

### Phase 1（对应原报告 Phase 1+2 收尾）——Android 真机文本+语音闭环验证 ⏱ 0.5~1 天

1. 通过 `adb` 连接 Honor 真机，安装最新 0.10.0 APK（取自 `~/Desktop/OneTHU-builds` 或现场构建）。
2. 在 OH 中配置自费 API Key 或使用校园网 MadModel 免费通道，验证文本对话全流程：流式输出、中途打断与工具调用（如查询课表）。
3. 长按灵动岛验证 `onethu-speech`：检查 `isRecognitionAvailable` 返回值、长按实时转写刷新、松手最终文本落框及麦克风权限拒绝提示；同时通过飞行模式对照确认识别服务走云端还是本地。
4. 输出真机实测记录（涵盖机型、ROM 版本、Android 版本与各项实测表现），归档至报告 §10 性能表。

**阶段验收：在真机跑通“说话 → 转写 → 发送 → 流式回答”完整链路，明确 Android 系统 STT 可用性结论。**
（本阶段聚焦真机实测；若目标机型系统 STT 无法满足需求，现场启动 `sherpa-onnx` 流式 ASR 备选方案评估。）

### Phase 2——本地 TTS（对应原报告 Phase 3）⏱ 3~5 天

1. 在真机安装官方 `sherpa-onnx` TTS 演示 APK，对比试听 melo 与 kokoro-int8 中文样音，敲定默认内嵌模型。
2. 新建移动插件 `apps/desktop/src-tauri/plugins/onethu-voice/`（沿用 `onethu-speech` 目录结构）：
   - Kotlin 层：接入官方预编译 `sherpa-onnx` Android JNI 库，配合 `AudioTrack` 输出音频；
   - 命令接口：`tts_init/tts_speak/tts_stop/tts_status`（对齐报告 §5.3 接口定义），支持语速与 `speakerId` 参数；
   - 模型管理：按需下载至应用私有目录（`filesDir/models/tts/`），执行 sha256 完整性校验，并提供断点重试与损坏清理恢复能力。
3. ChatDock 联动：提供语音播报开关（默认关闭），回答生成完毕后自动朗读，支持随时中断播报，并与语音输入状态互斥。
4. 完成飞行模式离线验证、连续 20 次合成与中断的资源稳定性压测，记录冷启动、内存峰值、合成耗时与模型体积数据。

### Phase 3——自定义唤醒词（对应原报告 Phase 4，采用 KWS 主路线）⏱ 3~5 天

1. 在 `onethu-voice` 插件内扩展 KWS 能力：集成 `sherpa-onnx` keyword spotter 与 `keywords.txt`（首版唤醒词设为“你好小欧”，经 `text2token` 生成拼音序列，并在真机验证零训练动态换词）。
2. 实现 `WakeService`（沿用 `QrKeepAliveService` 骨架，配置 `microphone` 前台服务类型及配套权限），通过 `AudioRecord` 采集 16k 单声道音频流输入 KWS，检测到唤醒后经 Tauri event 通知前端。
3. 建立状态机：`IDLE → LISTENING(KWS) → RECOGNIZING(SpeechRecognizer) → SPEAKING(TTS，期间暂停 KWS) → 恢复 LISTENING`；针对权限被拒、后台服务回收或模型未下载等情况提供清晰的状态提示与一键恢复入口。
4. 开展多阈值误唤醒率定量测试，实测锁屏、切后台、省电模式及与系统语音助手共存时的表现。
5. （可选）使用 Porcupine 个人评估 AccessKey 开展同环境唤醒率对比测试，留存基准数据供调优参考。

### Phase 4——设置项与体验打磨（对应原报告 Phase 5）

上线语速调节滑块、发音人选择（kokoro 8 种中文音色 / melo 单音色）、离线模型管理（下载、切换与空间清理）以及唤醒监听开关持久化，确保每一项界面配置均实时驱动底层音频参数（落实报告 §5.4 要求）。

---

## 7. 报告原文数据核校表

| 位置 | 原文 | 核实结果 |
|---|---|---|
| §5.2 候选 A | AISHELL3 VITS"约 29 MB" | 轻量级 icefall 变体 tarball 为 30.1 MB（8 kHz）；完整版 `vits-zh-aishell3` 模型为 116 MB（tarball 140.1 MB）。8 kHz 采样率仅适合早期管线冒烟测试，正式产品宜选用更高采样率模型 |
| §5.2 候选 B | Kokoro"需要核实实际大小" | 已核实：`v1_1` int8 量化版为 140.2 MB、fp32 版为 347.9 MB；24 kHz 采样率，支持 103 位说话人（含 8 种中文音色），采用 Apache-2.0 许可 |
| §3 技术栈 | TypeScript Agent Core 待建 | OneTHU 已上线 Rust 骨干（OH），TS 侧专注于前端宿主桥接与界面交互 |
| §7 目录结构 | `plugins/voice-android`、`src/core/*.ts` | 沿用 OneTHU 移动插件规范 `apps/desktop/src-tauri/plugins/onethu-voice`，直接复用现有 Rust core |
| §9 Phase 1/2 | 待实现 | 0.10.0 已上线并通过 macOS 全链路验证，补充 Android 真机收尾验证即可 |
| §9 Phase 6 | MCP 待扩展 | MCP 已通过 stdio 冷启动机制上线运行 |
| §4.1 | Porcupine 可用性未确认 | 已确认支持普通话自定义唤醒词；综合开源免费分发要求，主路线调整为 Apache-2.0 许可的 `sherpa-onnx` KWS |


---

## 8. KWS 落地实施方案（定稿，2026-10-09）

> 前置条件核实：`sherpa-onnx` 官方仓库已提供现成的 `KeywordSpotter.kt` Kotlin API 及 `SherpaOnnxKws` Android 示例工程（另有 `SherpaOnnxAar` 打包参考与 `SherpaOnnxTts`/`SherpaOnnxTtsEngine` 示例），以下方案可直接对接编码落地。

### 8.0 共享底层底座（同时支撑 TTS 与 KWS）

- **插件目录**：新建 `apps/desktop/src-tauri/plugins/onethu-voice/`（复用 `onethu-speech` 工程骨架：Rust 命令转发 `run_mobile_plugin`、Kotlin 插件主类及 permissions toml 配置）。
- **JNI 接入**：引入官方提供的少量 Kotlin 封装源码（`KeywordSpotter.kt`、`FeatureConfig.kt`、`OnlineStream.kt` 等），并从官方 Release 获取预编译的 `libsherpa-onnx-jni.so` 与 `libonnxruntime.so` 放入 `jniLibs/arm64-v8a`（与现有 arm64 构建主线对齐，固定版本号并将 sha256 校验码记录入库），直接复用官方预编译产物，省去本地 NDK 源码编译步骤。
- **唤醒模型**：首版将 `kws-zipformer-wenetspeech-3.3M int8`（encoder/decoder/joiner 合计约 5 MB + `tokens.txt`）内置于 assets，构建阶段通过 `text2token ppinyin` 预生成默认词“你好小欧”的 `keywords.txt`；同时准备 `kws-zipformer-zh-en-3M-2025-12-20`（chunk-8 延迟 160ms）在 M0 阶段做双模型实测对比。
- Phase 2 的本地 TTS 后续直接挂载在同一插件的 `tts_*` 命令下，共用这套 JNI 与 `onnxruntime` 底座。

### 8.1 TS 命令契约（对齐报告 §4.2 WakeEngine）

```
wake_supported() -> boolean
wake_start() / wake_stop()
wake_status() -> { state: "idle"|"listening"|"handoff", keyword, threshold }
事件：onethu-voice://wake  { keyword, timestamp }
     onethu-voice://state { from, to }
```

TS 侧新增 `src/lib/wake.ts`（采用与 `speech.ts` 相同的命令路由前缀 `plugin:onethu-voice|*`），专注于命令下发与状态事件订阅，所有持续音频监听均在原生层完成（落实报告 §4.2 架构分层）。

### 8.2 前台服务与麦克风仲裁

- `WakeWordService`：沿用 `QrKeepAliveService` 骨架，配置 `foregroundServiceType="microphone"` 并在 manifest 中声明 `FOREGROUND_SERVICE_MICROPHONE`，通过 `AudioRecord`（16k/mono/16bit）向 `KeywordSpotter` 输送音频流。
- 常驻通知：展示“唤醒监听中”状态通知并提供快捷“停止”操作按钮；遵循 Android `while-in-use` 规范，由用户在前台界面手动开启，保持按需启动。
- **统一状态机（由 Kotlin 侧集中仲裁，TS 侧订阅 `state` 事件同步界面）**：

```
IDLE → LISTENING → [唤醒] HANDOFF(停KWS→起SpeechRecognizer)
     → RECOGNIZING → [final] PROCESSING(OH run，KWS 保持停)
     → [有TTS] SPEAKING → [播完] LISTENING；[无TTS] → LISTENING
```

- 仲裁细则：`SPEAKING` 播报期间保持 KWS 暂停以避免扬声器回声自触发；用户手动长按灵动岛语音时优先响应手动输入（若处于 `LISTENING` 则先暂停 KWS）；待 `SpeechRecognizer` 识别流程完全结束后再恢复监听。

### 8.3 里程碑排期（预计约 1 周）

| # | 内容 | 产出/闸门 |
|---|---|---|
| M0 | 真机 PoC（0.5 天，独立于主仓库测试）：安装官方 `SherpaOnnxKws` APK（支持界面直接改词），在 Honor 真机实测“你好小欧”双模型 × 多阈值表现 | **准入指标**：唤醒率 ≥95%、安静环境误报 ≤1 次/天量级；若未达预期则尝试叠词（如“小欧小欧”）、切换模型或调整阈值方案 |
| M1 | 插件骨架 + KWS 引擎（1 天）：接入 `jniLibs`、打通 `wake_*` 命令，在应用前台界面通过手动开关验证唤醒事件回传至 TS | 唤醒事件在真机 ChatDock 实时可见 |
| M2 | `WakeWordService`（1 天）：落地 microphone 前台服务、常驻通知、权限引导与服务回收后的重进恢复 | 后台持续稳定监听 ≥1 小时 |
| M3 | 交接状态机 + ChatDock 联动（1-2 天）：打通“唤醒 → STT → OH”全链路、防回声自触发与灵动岛状态反馈 | 完成报告 §10 语音交互体验验收项 |
| M4 | 稳定性与设置项（1-2 天）：产出锁屏/省电/系统助手共存实测表；上线灵敏度阈值调节与预设唤醒词列表（复用官方示例的 Kotlin 拼音转换逻辑） | 完成报告 §10 后台运行与性能验收项 |

### 8.4 备选预案与工程细节

- M0 准确率调优路径：① 切换 `zh-en-3M-2025-12-20` 模型并细调阈值与 boosting 参数；② 改用辨识度更高的叠词唤醒词；③ 使用 Porcupine 个人评估 AccessKey 采集同场对照数据辅助分析。
- Honor 真机若缺少可用的系统 `SpeechRecognizer`（由 Phase 1 实测确认）：可在唤醒后直接衔接 `sherpa-onnx` 流式 ASR（`OnlineRecognizer`，复用同一套 JNI 底座），并在 M0 阶段一并安装官方 `SherpaOnnx` ASR 演示包提前摸底。
- 仓库与编译盘分工：插件源码、约 5~10 MB 量级的 `jniLibs` `.so` 动态库及轻量模型 assets 正常随 Git 仓库版本化管理，编译中间产物继续输出至外置 APFS 编译盘。
