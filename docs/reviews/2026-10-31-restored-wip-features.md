# 恢复未提交的 WIP 功能（悬浮球退出、更新下载、雨课堂换票、长列表）

> 最后更新：2026-10-31 21:35。

## 来源与原则

这批功能原先停留在 `feat/updates-multithread-download-fixes` 的未提交工作区：跟踪文件在 `stash@{0}`，未跟踪文件在临时备份目录。本轮在最新 `main`（已含材质/字色结构性修复）之上恢复，而不是切回旧分支：

- 保留最新 main 的更新检查原生会话 epoch 校验；
- 保留本轮新增的「材质只动 transform / 遮罩只动背景 / 首帧定格」规则；
- 将 WIP 中与旧样式表冲突的规则迁到 OneGUI 宿主配方，避免旧样式表行数棘轮回退。

## 恢复的功能

### 1. 悬浮球「退出 OneTHU」

- `GlobalOrb.tsx` 新增退出按钮，调用 `app_exit`；只关 WebView 会留下进程，必须走 `AppHandle::exit`。
- `src-tauri/src/lib.rs` 注册 `app_exit` 命令。
- 中英文案 `components.globalorb.7f2c4a91d0e6` 已随 i18n 文件恢复。
- 回归：`node tools/orb-quit-test.mjs`。

### 2. 多线程更新下载

- Rust `update_download.rs`：Range 探测、分片并发、合并、哈希校验、原子改名、取消清理、1 GiB 上限。
- `downloadPrefs.ts`：线程数归一化与偏好持久化；`SoftwareUpdateSection.tsx`/`updater.ts` 接线。
- 回归：`node tools/update-multithread-test.mjs`（37 项，含 4 个 mock Range 场景）。

### 3. 更新检查双源并行与选源优先级

- GitHub 与清华云盘并行查询；同版本走云盘，只有 GitHub 严格更新才走 GitHub；一侧失败用另一侧。
- 与最新 main 的原生会话 epoch 校验合并：`httpNativeGet(url, headers, hop, requestEpoch, signal)` 同时保留 epoch 断言与 AbortSignal 取消。
- 回归：`node tools/update-check-lifecycle-test.mjs`（24 项，含取消、双挂、冷却后重试、自定义源）。

### 4. 学习会话恢复 / 登录就绪

- `authRecovery.ts`、`devAuth.ts`、`reload.ts`：事件总线、keepalive、错误自动重试、登录后学习会话准备。
- 回归：`auth-recovery-test`、`learn-session-recover-test`、`login-session-readiness-test`。

### 5. 雨课堂免扫码换票与 LaTeX 题面

- 扫码保存 `UserID`/`Auth`；心跳/外部作业刷新发现失效时先走 `/pc/web_login` 换票，撤销才回退扫码。
- 题干内联背景剥离、`nbsp` 实体与公式渲染修复。
- 回归：`ykt-auth-renew-test`、`ykt-body-test`、`ykt-detail-ui-test`、`ykt-qr-test`、`tuoj-cas-test`、`ykt-latex-browser-test`（22 项）。

### 6. 长列表固定视口与揭示配额

- `Layout.tsx` 的 `ListWindow`：滚动收进卡片内部，卡片高度按视口计算，避免上万像素合成层超纹理上限。
- 课程文件 / 全部作业 / 通知 / 搜索 / 任务列表接入。
- `motion.ts` 长列表（>40 行）与超过 12 项的一批直接 `instant`，不再排队逐项动画。
- 回归：`list-window-layout-test`、`assignments-layout-test`、`learn-long-list-render-test`。

### 7. 其他

- DevPanel 的 auth 失效测试入口；设置页、体验模式、TabHost 等 WIP 改动一并恢复。
- 新增 i18n 键与文案。

## 冲突处理

| 冲突 | 处理 |
|---|---|
| `lib/updater.ts` | 同时保留 epoch 与 signal；调用点补 `undefined, signal` |
| `styles/motion.css` | 保留本轮材质稳定规则；只补长列表 `[data-reveal-in="instant"]` 常显规则 |
| `tools/motion-test.mjs` | 保留新规则断言，新增 instant 断言（150 条） |
| `tools/update-check-lifecycle-test.mjs` | 采用双源并行测试，补 `nativeSessionEpoch`/`assertNativeSessionEpoch` 夹具与 epoch 断言 |

## 旧样式表与 OneGUI 护栏

- 将 WIP 加在 `global.css` 的宿主修补（ListWindow、0×0 SVG、深色底墨、行内预览、Quill 编辑器）迁入 `packages/gui/src/recipes/compatibility.css`。
- 深色底墨与搜索框规则和本轮已有规则合并，避免重复来源。
- 学习页固定视口高度改为 `--og-learn-*` 结构令牌（12 个字面尺寸清零）。
- DevPanel 新增说明行改用 `og-dev-auth-title` 类。
- `onegui-guard` 全部通过：旧样式表 9732 行（基线 9753），R1/R2/R9 通过。

## 测试恢复修正

- 恢复的浏览器测试原先引用机器本地 `playwright` 路径，改为包名导入；`CHROME_BIN` 未设置时走 Playwright 默认浏览器。
- `learning-glass-browser-test` 接受共享透镜滤镜 `url(#og-lens-*)`（模糊在 SVG 滤镜内），不再只认 `blur()`。
- `ykt-detail-ui-test` 接受 i18n 键形式的折叠标题（最新 main 已完成文案 i18n 化）。
- `learn-layout-browser-test` 在写雨课堂课程夹具前等待启动刷新落定，避免晚到的空结果覆盖。

## 验证

- `pnpm --filter @onethu/desktop typecheck` 通过。
- 静态/单测：`orb-quit`、`update-multithread` 37、`update-check-lifecycle` 24、`auth-recovery`、`learn-session-recover`、`login-session-readiness` 7、`ykt-auth-renew`、`ykt-body` 188、`ykt-detail-ui` 156、`ykt-qr`、`tuoj-cas` 37、`exthw-status` 350、`motion` 150、`material-motion-guard` 39、`onegui-guard` 全绿。
- 浏览器：`learn-layout` 207、`mail` 36、`material-ink-stability` 12、`list-window`、`assignments-layout`、`learn-long-list-render`、`learning-glass`、`ykt-latex` 22、`glass-surfaces` 60、`glass-optics` 32。
- `pnpm guard` 仍受 6 条既有 UI 文案违规（`VisitTab.tsx`、`libraryErrorText.ts`）拦截，与本轮无关。

## 边界

- 恢复的是原 WIP 的行为与测试，未重新设计这些功能。
- 多线程下载与换票涉及 Rust/网络路径，验证以单测与 mock 为主，未对真实更新源执行下载或安装。
- 机器本地路径未进入提交；恢复测试统一走 `CHROME_BIN` 或 Playwright 默认浏览器。