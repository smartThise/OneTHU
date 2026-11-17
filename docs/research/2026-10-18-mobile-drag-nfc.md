# 手机 UI / 拖放识别 / 动画 / NFC 调研（2026-10-18）


> 归档说明：本文记录当时的技术调研与方案评估；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 本次只读调研基于 `ca2fadea`（调研期间同步提交了 Phase 1 暂存箱地基 `35cef40f`），结论用于计划文档 §7.5/§7.6 的手机基础层设计。

## 1. 现有交互骨架

- **手机形态判定**：统一由 `state/platform.ts:46-53` 根据视口短边 `<600` 判定，`main.tsx:27-31` 负责同步 `html.is-phone` 类名，开发调试时可通过 `?phone=1` 强制开启。
- **贴底抽屉**：由 `PhoneSheet` 与 `useSheetDrag` 配合实现，内置速度低通滤波、`0.6/0.94vh` 两档吸附、档位记忆与安全区适配，目前已在 TabDrawer、OneGo、OnePage 之间复用。
- **底部安全区与层级**：样式定义在 `explorer-ui.css:780-786`；固定层 `z-index` 自下而上依次为底栏 `80`、sheet `1290/1300/1310`、OH 面板 `9992` 与背景雾化层 `9993`。
- **触感反馈**：集中在 `lib/haptics.ts`，提供 5 档震动与老机型白名单，长按交互可直接调用 `haptic("longPress")`。
- **320/390 视口回归**：由 `layout-browser-test.mjs`、`usability-browser-test.mjs`、`phone-audit.mjs`、`phone-regression.mjs` 四套脚本覆盖。

## 2. 拖拽现状：四套独立 Pointer 实现

| 面 | 阈值/机制 | 证据 |
|---|---|---|
| 白板卡片 | pointer capture、4px、500ms 长按菜单；手机 stack 模式只点选不拖 | `FreeBoard.tsx:82,652,666-680,738-744,888-890` |
| 标签条 | 6px/160ms 让位/600ms 并组；手机 300ms 武装、500ms 菜单、8px 判滚 | `TabStrip.tsx:244-248,388,800-930` |
| 标签抽屉 | 6px 阈值、transform 让位、跨组并组 | `TabDrawer.tsx:116,189-400` |
| 抽屉把手 | 速度低通、0.4px/ms 甩动、两档吸附 | `PhoneSheet.tsx:23-29,37-102` |
| 其它 | 作业轮播纵拖、组件尺寸轮播、白板画笔、图标取色、图片查看器、悬浮网窗口 | `HomeworkCarousel.tsx:236-288`、`WidgetSizes.tsx:277-365` 等 |

盘点结论：**仓库内尚未引入 HTML5 DnD，缺少通用的「可拖元素 → 对象引用」提取层与边缘自动滚动能力**，且同时存在 300ms、450ms、500ms 三套长按时间阈值。

## 3. 逐类可拖性摘要

- **已有拖拽但需手势仲裁**：白板卡片（桌面端走世界坐标，手机端 stack 模式禁用拖动）、标签条与标签抽屉（已带长按武装逻辑）。
- **仅需补齐标记属性**：搜索结果、邮件、新闻、课程/作业/通知/文件、体育/图书馆/研讨间等列表项均已挂载 `CollectStar` 原子组件，本轮已在 `CollectStar` 上统一接入 `data-vault-catch`。
- **需新增对象类型与稳定 key**：日程事件（目前尚无事件级 atom）、设置行（`routeId`）、主题、壁纸、选课、插件、OnePage 以及邀请/名片。
- **尚待建设系统入口**：桌面系统文件拖入（尚未监听 `onDragDropEvent`）、剪贴板文件读取、Android `ACTION_SEND` 系统分享接收，以及文件哈希与上传通道。
- **现成基础设施可复用**：`ContextMenu.tsx` 预留了全局 `data-ctx-atom` 兜底识别层，可直接启用并接入「长按 → 收进暂存箱」菜单动作。

## 4. 手势竞技场设计建议

手势响应优先级由高到低依次为：系统返回/悬浮球 > 弹层/抽屉把手 > 已注册的强语义拖拽（白板/标签/轮播）> 通用长按拖动 > 页面滚动/普通点击。

- **长按武装与触发**：通用长按阈值设为 380–420ms，移动容差 8–10px；进入武装态时触发 `haptic("longPress")` 并将目标放大至 `scale 1.04`；武装后一旦发生位移即转入拖拽态，同时取消上下文菜单定时器。
- **滚动与事件隔离**：未进入武装态前保持原生顺畅滚动；武装后在 `document` 层以 `passive:false` 监听 `touchmove` 并调用 `preventDefault`，保持常规元素的 `touch-action` 原样不动。
- **底栏防误触**：拖拽期间为 `<html>` 挂载 `is-catch-dragging` 类名，将底栏设为 `pointer-events:none`（防止误触 OH 胶囊的 450ms 长按或点击），仅对暂存箱落点自身开启 `pointer-events:auto`。
- **边缘自动滚动**：指尖进入最近可滚动祖先容器上下 60px 区域时启动 `rAF`，按每帧 4→14px 渐进滚动。
- **返回键取消**：拖拽开始时压入 `openOverlayFrame("vault-drag", cancel)`，确保在 Android 上按系统返回键会优先取消当前手势。
- **应用边界与分享协同**：受限于 WebView 容器边界，拖拽交互聚焦应用内部流转；跨应用传递后续通过系统分享面板（`ACTION_SEND`）承接，首版暂缓纳入。

## 5. 暂存箱落点挂载建议

- **避开底栏三槽**：`.ex-bbar` 中槽已放置胶囊组件，320px 窄屏下空间紧凑，暂存箱落点宜独立于底栏之外。
- **独立浮动层**：采用独立的 `fixed` 定位层，常驻态收起为右下角小徽标，拖拽激活时展开为底部胶囊或环形落点，纵向锚点与 FAB 及 OnePage 抽屉对齐（`bottom: calc(var(--explorer-bar-h) + safe-area + gap + 8px)`）。
- **层级与显隐**：置于底栏（`80`）之上、sheet（`1290`）之下；当 OH 面板或设置浮层打开时自动隐藏或设为 `pointer-events:none`。
- **吸附与触感**：距离 `<120px` 时高亮提示，`<64px` 时触发吸附并播放 `haptic("tick/click")`，中途取消则播放 `haptic("reject")`。

## 6. 动效基础

- **设计令牌**：集中在 `styles/motion.css`（包含 MD3 时长/缓动曲线，以及兼容变量 `--dur-1..4`、`--ease-*`、`--rise-*`、`--stagger`），配套说明见 `docs/动效设计规范.md`。
- **状态机与关键帧**：已有 `useExitPhase`、`useExitHold`、`useSheetDrag`、`useNavIndicator` 等状态钩子，以及 `m-pop/m-spring-in/m-sheet-up/down/m-expand-in/m-breathe` 等关键帧动画。
- **减弱动态效果适配**：CSS 层已支持全量降级，JS 层提供 `prefersReducedMotion()` 检测并配合触感白名单。
- **待修护栏问题**：`tools/motion-test.mjs` 当前报错——四档时长切换为引用 MD3 变量后，测试脚本仍只按字面 `ms` 匹配，外加 CardTab 等规则存在漂移。新增动画前需先把这道护栏修绿，确保新动效有自动化把关。
- **性能约束**：动画仅操作 `transform` 与 `opacity`；拖拽浮影（ghost）使用轻量卡片渲染，避免深克隆 DOM 子树或叠加毛玻璃滤镜；超过 80–100 项的长列表后续需引入虚拟滚动（仓库目前尚无虚拟列表）。

## 7. NFC 可行性评估

- **代码现状**：仓库内尚无 NFC 相关代码与权限配置（`grep nfc` 为 0 命中）。Android 插件当前 `minSdk=24`，满足 HCE 与 ReaderMode 所需的 API 19+ 要求。
- **插件底座就绪**：Kotlin `@Command` 注解、主 crate 的 `run_mobile_plugin` 封装以及桌面端 `#[cfg(desktop)]` 降级模板均已打通，Plugin 生命周期也已支持 `onNewIntent/onResume/onPause`。
- **平台能力选择**：Android Beam（P2P）自 Android 10 起弃用并在 Android 14 中移除，因此双机「碰一碰」需采用 **一端 HCE 模拟 NDEF 标签 + 另一端开启 ReaderMode 读取** 的方案，并辅以 NFC 贴纸或二维码兜底。
- **实现清单**：
  1. 在插件清单中声明 `NFC` 权限及 `uses-feature required=false`。
  2. 接收端（Reader）：调用 `enableReaderMode`（覆盖 A/B/F/V 类标签），随 `onResume` 开启、`onPause` 关闭，读取 NDEF 后回调给 JS 层。
  3. 发送端（HCE）：实现 `HostApduService` 并配置 `apduservice.xml`（注册标准 NDEF AID `D2760000850101`），按协议返回 NDEF 长度、载荷与状态码 `9000`。
  4. 前端封装：在 `lib/nfc.ts` 中探测 Android 原生能力；遇到设备无硬件、NFC 未开启或握手失败时平滑切换至二维码、口令或剪贴板分享；桌面端仅提示「手机端可用」。
  5. 安全校验：NDEF 解析器仅接收带校验和的 `ONV1.` 口令前缀，拦截任意外部 URL 的自动打开；分享内容较大时仅通过 NDEF 传递短 token/口令，具体数据走云端拉取。
- **潜在风险**：需关注系统对后台 HCE 的限制、双机贴靠 1–3 秒内的握手超时处理、无 NFC 硬件机型降级以及读屏无障碍提示。

## 8. 手机 UI 改造前需优先处理的 P0 项

1. 修复 `tools/motion-test.mjs` 护栏报错，恢复动效回归把关。
2. 收敛移动端三套长按阈值，引入统一手势竞技场消除长按与滚动冲突。
3. 补齐 Android 根级返回命令 `plugin:onethu-mobile|mobile_exit`，解决 `navStack.ts:149-165` 在真机根页面无法退出的问题。
4. 统一横竖屏布局判定口径：当前 `is-phone` 看短边 `<600`，而 `useExpanded` 看宽度 `≥840`，导致 `844×390` 手机横屏时误入桌面布局。
5. 补上拖拽边缘自动滚动，并为跨应用分享场景提供清晰的系统分享降级路径。
6. 将大文件哈希计算与上传移至 Worker 或分片异步处理，避免阻塞主线程。
7. 为每个可拖拽元素同步提供「收进暂存箱」上下文菜单项，保障读屏与键盘用户可达。

## 9. 下一步实施计划（Phase 2+）

1. 先修通 motion 护栏与手机根返回命令，对齐 `is-phone` 与 `useExpanded` 判定逻辑。
2. 搭建 `lib/catch/` 模块：包含 `types`、`extract`（统一识别 `data-vault-catch`、`data-ctx-atom`、`data-set-id`、`data-item-id`、文本选区与文件）、`gesture`（400ms/8px 竞技场、边缘滚动、取消回弹）与 `registry`。
3. 分批接入 6 个高频交互面：首页卡片、OH 搜索结果、邮件、网络学堂列表行、设置行与文件列表，同步上线上下文菜单兜底入口。
4. 暂存箱 dock/sheet（复用 `useSheetDrag`）以及名片/NFC 交互动效安排在 P2/P3 阶段推进。

## 进展记录（2026-10-18 深夜）

- ✅ 动效护栏 `motion-test` 已修复转绿（142 项断言通过）；TabHost 恢复 `useNavDirection`/`data-dir`，页面切换转场方向回归正常。
- ✅ 手势统一完成首阶段落地：新增 `lib/gestureArena.ts`（统一 400ms/8px/6px 阈值与单所有者互斥锁），暂存箱拖拽已率先接入。
- ✅ NFC 接收端 ReaderMode 与发送端 HCE 代码均已落地，后续待补双真机贴靠实测。
- ⏳ `mobile_exit` 命令尚待补齐；白板、标签条与底部胶囊等既有手势面仍待分批迁入 `gestureArena`。
