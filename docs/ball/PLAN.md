# Ball 分支作战计划（OH 全面改造）


> 归档说明：本文记录 `Ball` 分支（基于 `dev3` `7ce6cbe`）推进 OH 悬浮岛与全局悬浮球改造时的多智能体协作计划；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。历史 KWS 实验分支已归档至标签 `archive/dev-kws-20261010`（`2884240`）。

## 0. 协作约定

1. **按职责边界修改文件**（见 §4 写域表），其余模块保持只读。
2. **版本提交由 Lead 统一处理**：协作成员可自由使用只读的 `git log/diff/show/status/grep` 查阅上下文，将 `commit`、`checkout`、`reset`、`stash`、`push` 等写操作留给 Lead 集中执行。
3. **共享工作区按需执行类型检查**：日常自检请直接运行只读的 `tsc --noEmit`；全仓构建（`pnpm build`、`tauri android build`、`gradle assemble*`、`cargo build`）统一由 Lead 串联执行，避免并发写入构建产物互相干扰。
4. **复用现有依赖环境**：基于仓库当前已安装的依赖开发，如需新增 `pnpm`、`cargo` 依赖或下载 SDK 组件请先与 Lead 对齐。
5. 新增文件同样需通过 `tsc` 类型检查，交付前请先运行 §5 的自检命令。
6. 若排查时发现其他写域内的缺陷，请在交付报告中记录现象与定位线索，交由对应模块负责人或 Lead 跟进。
7. **并发上限控制在全团队最多 Lead + 2 名协作成员同时运行**（2026-10-10 实测表明，并发过高容易触发模型配额 429 限流并中断任务）。排队顺序依次为：`ball-ui(task-1)` → `ball-tts(task-2)` → `ball-overlay-android(task-3)` → `ball-overlay-desktop(task-4)` → `ball-attach(task-5)` → `ball-action(task-6)`。前序任务交付后由 Lead 通过 `send_message` 唤醒下一位成员，未收到唤醒通知前请保持待命状态。
8. 任务均由协作成员与 Lead 直接完成，避免在当前会话内额外派生子 agent（subagent）占用并发配额。

## 1. 目标（2026-10-10 需求要点，共 8 条）

1. **应用内 OH 悬浮岛长按体验升级**：长按时悬浮岛**自然横向延展**，内部呈现**随音量起伏的点阵波纹**，上方覆盖**半透明雾化层**并实时显示**当前识别出的文字**。
2. **长按松手即发送**：长按结束后，识别出的完整文本**直接作为一条新消息发送给 OH**，省去先填入输入框再手动发送的步骤。
3. **单击悬浮岛交互调整**：将单击入口统一为一个操作按钮，显示文案「**点击输入，长按说话**」。
4. **语音合成（TTS）全链路与设置**：补齐底层链路与前端控件，支持切换**静音 / 自动播报**，并在**设置页**新增音色、音效与语速调节。
5. **全局悬浮球**（Android + 桌面）：可悬浮在**其他应用窗口上层**；桌面端支持自由拖拽定位，手机端松手后自动贴边吸附。单击悬浮球时，面板**流畅滑至屏幕底部**并展开**雾化**对话面板（最底部为「点击输入，长按说话」输入栏，上方约**半屏高度**展示可上下滚动、边缘渐入渐出的主对话流）；长按悬浮球时，球体延展滑入底部切换为**语音输入条**。**后台静默原则**：当 OneTHU 主窗口处于后台时，除校园卡充值、付款、体育场馆不可抗力确认及特定在线服务等确需用户本人操作的流程外，预约确认与常规交互全程在悬浮面板内闭环完成，保持主应用在后台静默运行。单击展开的雾化面板提供**本次关闭悬浮球**入口，关闭后如需再次启用可回到主应用 OH 对话界面重新开启。
6. **OH 直接提交附件**：在**悬浮球展开面板**内提供拍照 / 相册 / 上传文件三个入口（可参考已落地的 IM Bot 附件实现）。
7. **附件快捷动作**：选定附件后可直接执行**转存云盘 / 交作业（雨课堂 + 网络学堂）/ 发讨论区**等动作。
8. **内置轻量图像修复滤镜**：提供几款简洁实用的文档与手写照片增强滤镜，方便上传手写作业照片后快速优化清晰度。

## 2. 代码现状梳理

- 应用内「OH 悬浮岛」位于 `apps/desktop/src/plugins/ChatDock.tsx`（1028 行，`ChatDock` 组件，由 **ball-ui** 负责维护）。关联模块包括：`state/island.ts`（岛文案 `ISLAND_DEFAULT_TEXT` / `computeIslandText`）、`lib/speech.ts`（Android 端语音识别 `speechAvailable/Start/Poll/Stop`）、`plugins/ChatDock.tsx:46` 的 `ohAsk(text)`（打开面板并直接发送消息，可直接承载需求 2），以及 `styles/global.css` 中「OH 悬浮岛带」的布局留白（第 5514、5607 行附近）。
- `ChatDock` 现有语音状态机已定义 `voice: "off" | "arming" | "listening" | "sending"`、`voiceText`、`voiceFail`、`VOICE_HOLD_MS = 450` 与 `VOICE_FINAL_GRACE_MS = 320`；启动路径位于第 769 行附近（`speechAvailable()` → `speechStart()`）。
- **TTS 为新建能力**（当前 `dev3` 分支尚无 TTS 实现）。设计时可查阅归档标签中的参考思路（请独立实现，避免直接复制历史 KWS 资产）：`git show archive/dev-kws-20261010:apps/desktop/src-tauri/plugins/onethu-voice/...`，其中包含 `SystemTts.kt`（系统 `TextToSpeech`，支持音高、音色与语速调节）、`TtsEngine.kt`（sherpa 神经语音档）与 `VoiceTts.kt`（双后端统一门面）。
- Tauri 插件结构可参考 `apps/desktop/src-tauri/plugins/onethu-speech`（Rust 命令壳 + Kotlin 原生实现 + `permissions/*.toml`）。**插件全局注册（`Cargo.toml`、`src-tauri/src/lib.rs`、`capabilities`、`gen` 权限文件）统一由 Lead 集成**，各模块负责人专注编写各自插件目录内的实现。
- Android 侧现有 `plugins/onethu-mobile`（含 `QrKeepAliveService`、`OnethuNotify`、`OnethuWidget`、`RomInfo`），系统级悬浮窗与 `WindowManager` 交互（需求 5 Android 侧）将在新建插件中从零构建。
- 设置页位于 `apps/desktop/src/pages/Settings.tsx`（1851 行，采用 `NotifySettingsSection` / `WidgetSettingsSection` / `ImSettingsSection` + `SectionHead` 分区组件模式）。**`Settings.tsx` 与 `App.tsx` 由 Lead 统一挂载**，模块负责人只需新建 `components/VoiceSettingsSection.tsx` 等独立组件文件。

## 3. 架构契约（跨模块接口约定，如需调整请先联系 Lead）

### 3.1 全局悬浮球（需求 5）—— 统一前端面 + 两套原生后端

- `apps/desktop/src/lib/overlay.ts`（**Lead 维护**）定义统一接口面：
  ```ts
  export type OverlayMode = "hidden" | "ball" | "bar" | "panel";
  export function overlaySupported(): Promise<boolean>;
  export function overlayShow(): Promise<void>;      // 显示球
  export function overlayHide(): Promise<void>;      // 本次关闭（需求 5 的「本次关闭悬浮球」）
  export function overlaySetMode(m: OverlayMode): Promise<void>;
  export function onOverlayEvent(cb: (e: { type: "tap" | "hold" | "release" | "drag" | "closed" }) => void): Promise<() => void>;
  ```
- 平台适配器：`lib/overlayAndroid.ts`（**ball-overlay-android** 负责）与 `lib/overlayDesktop.ts`（**ball-overlay-desktop** 负责）分别实现上述同名函数，`overlay.ts` 负责按运行平台分发。
- 前端浮层 UI（雾化面板、语音条、悬浮球本体）由 **Lead** 在 `components/GlobalOrb.tsx` 中统一实现并跨双端复用；原生侧专注负责创建与销毁透明窗口或系统悬浮窗、同步窗口尺寸与位置模式，以及回传触摸手势事件（`tap` / `hold` / `drag` / `release`）。
- **后台静默实现方式**：悬浮窗内的对话走 `askOh()`（`im/oh.ts`）等纯前端通道，全程保持主窗口隐藏状态，避免调用拉起主窗口的 API（如 `WebviewWindow.show()`、`set_focus()`、`app.show()` 或跳转 Android 主 `Activity`）。

### 3.2 TTS（需求 4）

- Rust 命令面（Tauri 命令，前端由 `lib/tts.ts` 封装）：`tts_supported`、`tts_prepare`、`tts_speak`（`{text, speed, pitch, voice}`）、`tts_stop`、`tts_status`（`{ready, backend, state}`）、`tts_voices`、`tts_set_backend`；完成事件为 `onethu-tts://done {reason}`。
- 偏好存储：`state/voicePrefs.ts`（使用 `localStorage`，延续仓库既有偏好存储风格）：`{ autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: "system" | "neural" }`。**默认 `autoSpeak=false`（静音）**，方便用户按需开启自动播报。
- `ChatDock` 侧接入由 **ball-ui** 负责：`import { speakReply } from "../lib/tts.js"`（由 **ball-tts** 导出）。

### 3.3 附件（需求 6-8，wave 2）

- `lib/attach.ts`：`pickCamera()/pickGallery()/pickFile(): Promise<AttachFile | null>`，`AttachFile = { path: string; name: string; mime: string; size: number; previewUrl?: string }`；`sendToOh(files: AttachFile[], text?: string): Promise<void>`。
- `lib/attachActions.ts`：`saveToCloud(f)`、`submitHomework(f, ctx)`（`ctx.platform: "learn" | "ykt"`）、`postDiscussion(f, ctx)`。wave 2 由 **ball-attach** 实现，Lead 提供初始骨架。

## 4. 写域划分表（如需跨表协作请先联系 Lead）

| 路径 | 归属 |
|---|---|
| `apps/desktop/src/plugins/ChatDock.tsx`、`state/island.ts`、`lib/speech.ts`、`styles/global.css` | **ball-ui** |
| `src-tauri/plugins/onethu-tts/**`、`src/lib/tts.ts`、`src/state/voicePrefs.ts`、`src/components/VoiceSettingsSection.tsx` | **ball-tts** |
| `src-tauri/plugins/onethu-overlay/**`（Android Kotlin + Rust 壳）、`src/lib/overlayAndroid.ts` | **ball-overlay-android** |
| `src-tauri/src/overlay_win.rs`（新文件）、`src/lib/overlayDesktop.ts` | **ball-overlay-desktop** |
| `src/pages/Settings.tsx`、`src/App.tsx`、`src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`、`capabilities/*`、`gen/*`、`docs/ball/**` | **Lead** |
| `lib/overlay.ts`、`components/GlobalOrb.tsx` | **Lead** |
| `lib/attach.ts`、`lib/imageFilters.ts`、`components/AttachTray.tsx`、`components/ImageFilterSheet.tsx` | **ball-attach**（已交付） |
| `lib/attachActions.ts`、`components/AttachActionsSheet.tsx` | **ball-action**（已交付） |
| `docs/im-cloud/**`、`docs/memory-cloud/**`、`plugins/OneTHU-Harness/**` | 其他并行分支维护（保持只读） |

## 5. 自检命令（交付前必跑，只读）

```bash
cd /Volumes/PortableSSD/Projects/thuapp/OneTHU
./node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.json
```

Kotlin 与 Rust 代码在共享工作区暂不单独执行构建：编写完成后请**逐行复核**语法与 API 签名，并在报告中列出需要 Lead 运行 Gradle 或 Cargo 验证的检查点。

## 6. 常见环境与平台注意事项

- **exFAT AppleDouble 伴生文件**：仓库挂载于 exFAT 分区时，新建或修改文件会生成 `._同名` 隐藏文件，Tauri 的 `build.rs` 扫描 `capabilities` 或 `permissions` 时读到该文件会报错（`stream did not contain valid UTF-8`）。新建目录或文件后请执行 `find <你的目录> -name '._*' -delete` 清理。
- **exFAT 文件写入方式**：部分工具的原子重命名或硬链接在 exFAT 分区会返回 `ENOTSUP`，创建新文件时可使用 bash heredoc 写入。
- **Tauri Android 参数读取**：Kotlin 侧读取可选字符串参数请使用 `invoke.getArgs().optString(key, default)`；自定义参数类需添加 `@InvokeArg` 注解，确保 Release 模式下经 R8 混淆后仍能正常反序列化（避免 `no Creators` 报错）。
- **AudioRecord 采集细节**：`acceptWaveform` 接收 `FloatArray`（`-1..1`）；静音状态下阻塞式 `read()` 可能挂起线程，需做好非阻塞或超时处理；荣耀与华为机型采用「仅前台麦克风」策略，切入后台或锁屏会被系统静音，回到前台时需主动重建录音流。
- **前台服务类型配额**：Android 14+ 对每种 FGS 类型设有运行额度限制（此前曾因 `dataSync` 超限触发崩溃），声明服务类型时需按实际用途精确匹配。
- **荣耀真机调试**：存在双连接通道时需显式指定 `adb -s 192.168.31.31:34751`；若常规 `adb logcat` 被系统过滤，可通过 `dumpsys usagestats`、`cmd appops get <pkg> RECORD_AUDIO` 与 `dumpsys notification --noredact` 采集运行状态。

## 7. 报告格式（每个 agent 交付时用）

```
## 状态：完成 / 部分完成 / 阻塞
## 改动文件：<path>（+/- 行数）
## 实现了什么（需求条目编号对应）
## 自检：tsc 结果（贴关键输出）/ 其他
## 需要 Lead 做的：注册/构建/决策点
## 风险与未做：明确列出
```
