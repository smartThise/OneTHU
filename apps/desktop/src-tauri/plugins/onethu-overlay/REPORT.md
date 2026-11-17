# task-11 交付报告（第二轮返工 · 真机四条新反馈）

> 归档说明：前两轮（task-3 骨架与 task-11 第一轮）确定的架构设计、保活策略、事件通道及 `overlay_push_ui` 接口继续沿用；视觉与交互口径以各轮最新记录为准。上一轮确立的三项核心约束（单窗口、默认仅显示悬浮球、悬浮球位于右侧导航栏上方）在代码中持续保持。

## 状态：已完成代码与类型检查（tsc 0 error；待执行 gradle 编译、装机与截图验收）

## 改动文件

| 文件 | 本轮变更 |
|---|---|
| `android/.../overlay/OverlayViews.kt` | **雾面改为纵向 sheet**（`LinearGradient` 自底向上渐隐，`0→1 / 1→0.55→0`，铺满整块面板）；**悬浮球改为实底**（浅/深实底 + 1px 细边 + elevation 轻投影 +「（OH）」）；球窗增加 8dp 投影留白；面板新增**附件三入口**与**面板内语音行**；EditText 关闭长按与文本选择 |
| `android/.../overlay/OverlayWindows.kt` | 输入行手势改为「单击拉起键盘 / 长按说话 / 上划取消」；附件入口派发 `attachRequest` 事件；面板高度由 46% 调至 **50%**；面板内语音保持原窗口；`defaultBallPos` 按球体尺寸计算并补偿窗口留白 |
| `android/.../overlay/OverlayPicker.kt` | **新增**：三类系统选择器的启动方案、回退策略、结果物化（`content://` 落盘至 `cacheDir` 真实文件）与 MIME 推断 |
| `android/src/main/res/xml/onethu_overlay_paths.xml` | **新增**：FileProvider 路径配置（仅开放 `cacheDir`） |
| `android/src/main/AndroidManifest.xml` | 新增 `FileProvider`（authority 为 `${applicationId}.onethu.overlay.fileprovider`） |
| `android/build.gradle.kts` | 新增依赖 `androidx.activity:activity-ktx:1.9.3`（提供 `@ActivityCallback` 所需的 `ActivityResult` 参数类型） |
| `android/.../overlay/OnethuOverlayPlugin.kt` | 新增命令 `overlayPickAttach` 与 `@ActivityCallback onPickAttach`（选择结果通过 `attach` 事件推回 JS） |
| `android/.../overlay/OverlayEvents.kt` | 事件支持 `extra` 字段平铺展开（供 `attach` 携带 `path/name/mime/size`） |
| `src/commands.rs` / `src/lib.rs` / `build.rs` / `permissions/**` | 新增 `overlay_pick_attach` 全链路声明（命令、权限 toml、default 与 reference） |
| `apps/desktop/src/lib/overlayAndroid.ts` | 处理 `attachRequest`（拉起选择器）与 `attach`（调用 `attachFromPath` + `sendToOh`）；状态接口补充 `workW/workH/ballX/ballY/windowKind` 等诊断字段 |

## 四条逐条落地

### ① 雾改成「从底下到半屏铺满并渐变变淡」
- `FogLayout` 由 `RadialGradient` 替换为自底向上的 **`LinearGradient`**，参数设为 `stopPositions=[0,0.58,0.82,1] / stopWeights=[1,1,0.55,0]`：
  **底边至 58% 高度保持 100% 浓度 → 82% 处降至 55% → 顶边过渡至完全透明**，等效于 CSS 的
  `linear-gradient(to top, #000 0%, #000 58%, rgba(0,0,0,.55) 82%, transparent 100%)`。
- 面板高度由 **46% 提升至 50%**，渐变范围按**整块面板**高度计算，使雾面完整覆盖面板全宽。
- 浅色与深色模式均已适配：雾底取 `#FFFFFF`/`#151517`，文字取 `#1C1F24`/`#ECECF1`，`coreAlpha` 设为浅色 0.92 / 深色 0.90。
- 渐隐过渡处理：安卓系统未向第三方应用开放跨窗口实时模糊（此前引起整屏泛白的模糊标志已移除），此处直接用**渐变 alpha 本身**呈现自下而上逐渐化开的观感，画面清爽且无整屏泛白现象。
- 悬浮球改用实底材质（详见 ③）。

### ② 附件三入口（拍照 / 相册 / 上传）→ 走现成发送链
- 面板内新增一行纯文字入口 `拍照 / 相册 / 上传`（12sp、72% alpha，与面板整体视觉保持一致）。
- 调用链路（直接复用既有发送通道）：
  1. 原生点击触发事件 `attachRequest{text:"camera|gallery|file"}` 推送给宿主 JS；
  2. `lib/overlayAndroid.ts` 接收后调用插件命令 **`overlay_pick_attach {kind}`** 拉起系统选择器（Tauri Android 的 Activity Result 统一经「插件命令 + `@ActivityCallback`」通道回传）；
  3. 原生端按类型分发：`camera` 走 `ACTION_IMAGE_CAPTURE` 配合 **FileProvider**（在 `cacheDir` 生成文件并授予 `FLAG_GRANT_WRITE_URI_PERMISSION`）；`gallery` 在 Android 13+ 走 `ACTION_PICK_IMAGES`（Photo Picker），旧版走 `ACTION_PICK`；`file` 走 `ACTION_OPEN_DOCUMENT`；当系统相册选择器不可用时自动回退至文档选择器；
  4. 选择结果落盘物化为 `cacheDir` 下的真实文件（供仅接收本地路径的 `attachFromPath` 读取），随后通过事件 **`attach{path,name,mime,size}`** 推回 JS；
  5. 适配器依次调用 `attachFromPath()` 与 **`sendToOh()`**（复用 `lib/attach.ts` 既有能力），多模态开关在 harness 侧照常生效。
- **权限说明**：三个入口均走系统选择器，无需申请存储权限，也无需声明相机权限——`ACTION_IMAGE_CAPTURE` 在应用未声明 `CAMERA` 权限时直接交由系统相机完成拍摄（真机 `dumpsys package` 已确认包内无 `CAMERA` 权限）。插件 Manifest 中唯一新增的声明是 **FileProvider**（authority 带 `${applicationId}` 前缀）。
- 取消或未选文件时仅回传 `{ok:false,cancelled:true}`，保持界面安静；读取失败时则在对话流内给出一条 OH 文字提示。

### ③ 球：文案「（OH）」+ 实底材质
- 文案固定为 **`（OH）`**（常量 `BALL_TEXT`，全角括号共四个字符）；字号设为 11sp（适配 54dp 球径，留出呼吸空间避免裁切），配置 `includeFontPadding=false`、单行居中、字重 700。
- 材质采用**实底 + 1px 细边框 + 轻投影**（`GradientDrawable.OVAL` 浅/深实底 + `setStroke(1dp)` + `elevation=6dp`），移除了早期的 `RenderEffect` 与径向雾层。
- 球窗尺寸设为球径 54dp 加两侧各 8dp 留白（`BALL_WIN_DP=70dp`），为视图外侧的投影留出绘制空间；默认坐标先按球体尺寸计算 `right 12dp / bottom 128dp`，再补偿 8dp 窗口留白，确保视觉落点准确。

### ④ 输入框长按 = 说话
- 长按判定挂载在 **EditText 的触摸拦截监听**上（`setOnTouchListener`），同时关闭 `isLongClickable` 并调用 `setTextIsSelectable(false)`，让长按手势直接触发语音输入，避免弹出系统选词条或仅移动光标。
- 手势分工：**单击**调用 `showIme()` 聚焦并唤起键盘；**长按 ≥450ms** 在面板内就地展开语音行（包含雾带、波纹点动画与实时转写，全程保持同一面板窗口挂载，确保手指抬起时的 `ACTION_UP` 稳定送达）；**按住上划 >110dp** 时条内提示「松开取消」，松手后确认取消并丢弃整句。
- 正常松手后等待最终识别结果（700ms 超时兜底），随后**整句直接发出**（复用键盘输入的 `submit` 通道）并留在面板展示回复。
- 「发送」按钮（短按发送、长按说话）与悬浮球（长按语音、松手展开面板）均采用一致的交互规则。
- 语音行切换显隐时仅下调输入块透明度，保持输入块处于可见布局中，避免设为 `GONE` 打断正在按压的手势流。

## 核心约束保障机制

| 约束项 | 保障方式 |
|---|---|
| **同一时刻仅挂载一个 overlay 窗口** | 所有形态切换统一收敛至 `switchTo(kind)`：切 `panel` 先执行 `detachOrb()` 再执行 `attachPanel()`；切 `bar`/`ball` 先执行 `detachPanel()` 再执行 `attachOrb()`，全程保持单窗挂载。切换后调用 `enforceSingleWindow()` 做兜底自愈（一旦检测到并存立即摘除面板并记录日志）。`overlay_status` 同步输出 `windowKind`（并存异常会直观显示 `both(BUG)`）与 `orbAttached`/`panelAttached`。单窗模式下，从面板返回悬浮球统一通过面板顶部的「收起」按钮完成。 |
| **默认与恢复态始终为悬浮球** | `overlay_show` 先调用 `OverlayPrefs.setMode("ball")` 再启动 `OverlayService.start(ctx,"ball")`；`ACTION_START` 分支固定执行 `windows.showBallOnly()` 仅挂载球窗，忽略外部参数或历史残留形态；开机广播与自救闹钟同样强制指定 `"ball"`；面板窗采用懒加载，仅在用户点击悬浮球展开时才调用 `ensurePanel()` 初始化。 |
| **悬浮球定位在右侧、导航栏上方** | `screenSize()` 在 API 30+ 优先读取 `currentWindowMetrics.bounds`，遇到小于 320dp 的异常值时回退至 `displayMetrics`，仍异常则采用保守兜底值，从而拦截真机曾出现的 215×215 异常尺寸；默认坐标设为 `right 12dp / bottom 128dp`；读取存档坐标若越界（`x∉[0,w-ball]`），则自动回退至默认位置并同步重写存档。 |
| **键盘仅在点击输入框时弹出** | 面板容器开启 `isFocusableInTouchMode=true`，并在 `attachPanel()` 中执行 `input.clearFocus(); content.requestFocus()`；`panelParams` 添加 `SOFT_INPUT_STATE_ALWAYS_HIDDEN`；仅当用户短按输入行（`ACTION_UP` 且按下时长未达长按阈值）时才调用 `showIme()`。 |

## 自检记录

- `./node_modules/.bin/tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0，无报错输出**。
- Kotlin 代码静态走查：`LinearGradient` 构造签名与色标单调性、`FileProvider.getUriForFile` 与 `@xml` meta-data、`ACTION_PICK_IMAGES`（带 API 33 守卫）/`ACTION_OPEN_DOCUMENT`/`ACTION_IMAGE_CAPTURE`、`OpenableColumns.DISPLAY_NAME` 游标读取、`startActivityForResult(invoke, intent, "onPickAttach")` 与 `@ActivityCallback private fun onPickAttach(invoke: Invoke?, result: ActivityResult)`（对齐 `OnethuMobilePlugin` 中 `onPickDownloadDir` 的签名）、`GradientDrawable.setStroke`、`elevation` 及 `setTextIsSelectable`。
- 走查期间一并修正的细节：输入块由设 `GONE` 改为仅降透明度，保护按压手势流不断开；球窗增加 8dp 投影留白并同步补偿默认坐标；统一 `defaultBallPos` 中球体直径与窗口尺寸的计算口径。
- exFAT 隐藏文件清理：已对改动目录执行 `find <目录> -name '._*' -delete`（清理后残留为 0）。

## 静态核对与真机验收边界

| 条目 | 可静态核对的部分 | 需在真机确认的部分 |
|---|---|---|
| ① 雾面 | 渐变色标参数、高度比例与截图几何层次 | 整体视觉观感、深浅色模式在真实桌面壁纸上的文字可读性、滑入动画流畅度 |
| ② 附件 | 事件链路与代码分支、`tsc` 类型检查 | 三类系统选择器能否正常拉起、拍照回调能否拿到文件、Photo Picker 表现、多模态链路是否成功送图入模 |
| ③ 悬浮球 | 文案、材质配置、尺寸与坐标计算公式 | 真实屏幕上的投影与细边质感、「（OH）」四字在 54dp 内的松紧比例 |
| ④ 长按说话 | 手势状态机与超时流转 | 真机能否顺利采集麦克风并发出整句（受荣耀仅前台麦克风策略影响）、长按判定与输入法手势是否冲突、上划取消手感 |

## 验证命令参考

```bash
# 1) Kotlin 编译（只编本插件模块）
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
# 2) 清单合并（应看到 FileProvider + specialUse|microphone 服务 + 各项权限）
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArmDebugMainManifest
# 3) Rust 侧交叉检查（桌面 cargo check 不编 mobile 分支）
cd apps/desktop/src-tauri && CC_aarch64_linux_android=… AR_…=… CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=… cargo check --target aarch64-linux-android
```

装机后只读核对（设备序列号 `adb -s 'adb-AVAY025528004219-CeQTxu (2)._adb-tls-connect._tcp'`）：

```bash
dumpsys package app.onethu.desktop.dev | grep -A3 "onethu.overlay.fileprovider"   # FileProvider 已合并
dumpsys window windows | grep -A3 "app.onethu.desktop.dev"                        # 只应有 1 个 APPLICATION_OVERLAY 窗
# 球的坐标与窗口种类（原生算出来的值，荣耀 logcat 被滤掉）：
#   在应用内调 overlay_status（设置页/调试入口）看 workW/workH/ballX/ballY/windowKind
```
**验收截图路径**：仅显示悬浮球 → 点击展开半屏渐变雾面板 → 面板内拍照/上传 → 长按输入行说话 → 收起回球 → 进入主应用后悬浮球自动隐藏。

编译核对要点：`LinearGradient` 的 `IntArray/FloatArray` 重载签名、`FileProvider.getUriForFile`（依赖已声明的 `androidx.core`）、`ActivityResult` 导入路径，以及 `currentWindowMetrics` 的 API 30 版本守卫。

## 待关注项与后续安排

- **「（OH）」在 54dp 内的字号**暂定为 11sp，待真机查看实际比例后可按需微调字号或球径。
- **附件选择后直接发送**：选完文件立即交由 OH 处理，面板内显示「附件：文件名」占位；图像滤镜与编辑（需求 8，位于 wave 2 的 `ImageFilterSheet`）本轮暂未接入原生面板。
- **拍照 FileProvider 真机验证**：`${applicationId}.onethu.overlay.fileprovider` 与 `res/xml` 路径需在目标 ROM 上实测授权兼容性，装机后建议优先测试「拍照」入口。
- **语音输入受荣耀「仅前台麦克风」限制**：支持直接语音发送与退回打字的五种场景与上一轮一致，核心依赖 `MODE_FOREGROUND` 配合 `microphone` 类型前台服务放行。
- **跨应用背景效果**：受限于第三方应用权限，继续采用纵向渐变雾面方案（此前引发整屏泛白的 `FLAG_BLUR_BEHIND` 已彻底移除）。
- **TTS 自动朗读暂缓接入**：ball-tts 能力接入点位于 `askNative`，待后续统一合入。


---

# task-11 第三轮返工（真机验收：3 过 3 修 · 2026-10-11 01:0x）

上一轮装机验收结果：**① 雾面形状已通过**（底部铺满并向上渐隐、半屏尺寸 1264×1400、`BOTTOM` 对齐），**③ 悬浮球文案与材质已通过**（实底白圆配「（OH）」），附件三入口、输入行与发送按钮均已在面板就位，**单窗口约束成立**。编译阶段同步补齐了 `OverlayViews.kt` 的 `import android.graphics.drawable.GradientDrawable`，移除了插件自带的 FileProvider 与 paths xml，并将 `OverlayPicker.authority` 统一指向宿主 `${packageName}.fileprovider`，上述调整在本轮完整保留。

## 本轮修复的三项问题

### 1) 悬浮球初始位置修正
- **根因**：本地偏好里残留的旧坐标（`x=0,y=548`，源于早期坐标系）被直接沿用，导致每次启动都固定在左上侧。
- **修复方案（两处联动）**：
  1. **存档记录屏幕尺寸与格式版本号**：`OverlayPrefs.setBall(x,y,screenW,screenH)` 同步写入 `ball_fmt=2` 与 `ball_screen_w/h`。`loadBallPos()` 分三步校验：无存档时取默认坐标；**`fmt` 版本不符或屏幕尺寸发生变化时作废旧值、回退默认并调用 `setBall()` 更新存档**；坐标越界（`x∉[0,w-ballPx]`）时同样回退并更新存档，三条分支均记录日志。由此确保历史残留坐标自动失效，换机或切换分辨率时也能自动归位。
  2. **修正默认坐标的留白补偿符号**：球窗比球体大 `2×inset`（两侧各 8dp 投影留白），球体在窗口内居中，因此水平起点应为 `x = w - 球窗 - 12dp + inset`（加上单侧 `inset` 补偿）。按 1264×2800 / 560dpi 真机参数核算：球窗 245px、球径 189px、inset 28px，得出 **ballX=1005、ballY=2135**，此时球右边缘距屏右恰好 12.0dp、球下边缘距屏底 128.0dp，窗口右下角 `(1250, 2380)` 完整落在屏幕内部。
- **真机核对口径**：调用 `overlay_status` 应返回 `workW=1264 / workH=2800 / ballX=1005 / ballY=2135`；`dumpsys window windows` 中球窗应为 `(1005,2135)(245x245)` 且**仅有 1 个** `APPLICATION_OVERLAY` 窗口。首次启动遇到旧存档时，日志会输出存档作废并回退默认的记录。
- 单位一致性：245px 对应 `70dp × 3.5`（density `560/160`），窗口尺寸与位置全程统一采用物理像素 px 计算。

### 2) 提升文字与控件对比度（解决真机「看不清」反馈）
| 元素 | 改前 | 改后 |
|---|---|---|
| 拍照 / 相册 / 上传 | 12sp / alpha 0.72 | **13sp / alpha 0.95**（主色） |
| 收起 / 本次关闭悬浮球 | 12sp / alpha 0.55 | **13sp / alpha 0.95** |
| 发送 | 13sp / alpha 0.85 | **14sp / alpha 1.0**（主色高亮） |
| 输入行占位「点击输入，长按说话」 | alpha ≈0.38 | **alpha 0.92** |
| 输入行下划线 | alpha 0.15 | alpha 0.28（增强输入区域承托感） |
| 面板雾底部核心 | 浅 0.92 / 深 0.90 | **浅 0.96 / 深 0.94**，且 82% 处权重由 0.55 提至 **0.60**（保证底部文字衬底充足） |
| 语音条雾 | 浅 0.92 / 深 0.88 | 浅 0.96 / 深 0.92 |
消息正文保持主色 + 100%/62% 配置不变。

### 3) 修复输入提示重复渲染两遍
- **根因**：面板同时创建了「空态提示 TextView（文案为『点击输入，长按说话』）」与底部「EditText 的 hint（相同文案）」；消息列表为空时空态视图显现，导致上下重复展示两条提示。
- **修法**：**移除空态 TextView**，仅保留底部 EditText 的 hint；同步清理 `PanelHolder.empty` 字段及两处显隐赋值。空对话状态下消息区自然留白，布局结构保持稳定。

## 已确认的设计取舍
- 「（OH）」字号**保持 11sp**。
- 图像滤镜（wave 2 `ImageFilterSheet`）暂缓接入原生面板。

## 自检记录
- `tsc --noEmit` → **exit 0**；Kotlin 大括号配对校验通过；已执行 `find <目录> -name '._*' -delete`（残留 0 个）。
- 坐标公式已按 1264×2800 / 560dpi 真机参数独立验算（右距 12.0dp、下距 128.0dp，窗口完整处于屏幕内）。

## 验证命令参考
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
cd apps/desktop/src-tauri && cargo check --target aarch64-linux-android   # 若 Rust 侧还没过
```
装机后重点确认以下两项：
1. `overlay_status` 返回 `ballX=1005 / ballY=2135`（悬浮球位于右下方导航栏上方区域）；`dumpsys window windows` 显示球窗 `(1005,2135)(245x245)` 且仅有 1 个 overlay 窗口。
2. 面板内「拍照 / 相册 / 上传 / 发送 / 收起 / 本次关闭」清晰易读，且「点击输入，长按说话」**仅在底部输入行出现一次**。

## 需在真机确认的项目
① 雾面层次观感与深浅色壁纸下的可读性；③「（OH）」在 54dp 球内的视觉松紧度；④ 麦克风采集与整句发送、长按与输入法的协同、上划取消手感；② 三类系统选择器的实际拉起与拍照文件回传。

---

# task-13 交付（真机第 6 轮：品牌字 / markdown / 固定顶栏+可读性 / 液态动效 / 附件即时气泡与进行中态）

状态：**完成**（`tsc` exit 0；Kotlin 逐行走查通过且括号平衡；`._*` 已清零）。

## 0. 字体与对比度核查

### (OH) 逐字符混排 —— 用 Spannable 复刻本体 HarnessMark + global.css:4090-4093

对照宿主源码确认：`components/HarnessMark.tsx` 输出**半角 `(` `O` `H` `)`**，主应用悬浮岛使用 `<HarnessMark size={15} />`。

| 文本范围 | span 列表 | 对应 CSS |
|---|---|---|
| `[0,1)` `(` | `TypefaceSpan("monospace")` + `RelativeSizeSpan(1.06f)` | `.p{font:mono;400;scaleY(1.06)}`（`scaleY` 以等比 1.06 近似） |
| `[1,2)` `O` | `TypefaceSpan(Typeface.create("serif", 500, false))` + `RelativeSizeSpan(1.14f)` | `.o{serif;500;1.14em}` |
| `[2,3)` `H` | `TypefaceSpan(Typeface.create("sans-serif", 700, false))` + `RelativeSizeSpan(1.06f)` | `.h{苹方同族;700;1.06em}` |
| `[3,4)` `)` | 同 `(` | 同上 |

TextView 配置：`textSize = 15sp`、`letterSpacing = 0.05f`（对应 CSS `gap:0.05em`）、`includeFontPadding=false`、`isSingleLine=true`、`gravity=CENTER`；**球径保持 54dp**；在 `API<28` 设备上 `Typeface.create(family,weight,italic)` 自动回退至 `NORMAL/BOLD` 两档。
宽度估算：mono`(` + serif`O`(17.1sp) + sans`H`(15.9sp) + mono`)` 总宽约 45dp，小于 54dp 球径（半角括号宽度明显窄于全角括号，使字号得以放大至 15sp）。

### 两处 alpha 配置

| 位置 | 值 |
|---|---|
| 面板雾：内容区（距底 0→80%） | 权重 1.0 × coreAlpha → **浅 0.96 / 深 0.94**（绝对 alpha） |
| 面板雾：距底 90% 处（内容区上沿） | 权重 0.55 × coreAlpha → **浅 0.53 / 深 0.52**（≥45% 保底） |
| 面板雾：仅最顶 10% 窄带 | 0.53 → 0（顶部边缘柔和羽化至透明） |
| 顶栏「收起 / 本次关闭悬浮球」胶囊 | 浅 `#FFFFFF` **α0.86** / 深 `#000000` **α0.45**，配 1px 细边（浅 `#1F000000` / 深 `#33FFFFFF`） |
| 所有正文/按钮文字 | 主色 100% alpha + `setShadowLayer(6dp, 0, 1dp, #40000000)`（α0.25） |

动效时长：展开 = 滴落 150ms + 晕开 280ms = **430ms**；收起 = 收拢 260ms + 弹回球 200ms = **460ms**（均控制在 380–460ms 区间内）。

## 1. 逐条落地

**① 品牌字与 OH 字号放大** → 如上表所示，`OverlayViews.harnessMark()` 生成混排 Spannable，球体调用 `setText(harnessMark())`、字号 15sp、球径保持 54dp。

**② 雾面、Markdown 渲染、顶栏按钮与液态动效**
- **Markdown 渲染**：新增零外部依赖的 `OverlayMd.kt`（356 行），支持块级 ```` ```代码块``` ````、`- 列表`、`1. 列表`、`> 引用`（左侧竖线）、`---` 分隔线、`# 标题` 与普通段落，以及行内 `**粗**`、`*斜*`、`` `code` `` 与 `[文本](url)`（仅对 `http(s)` 链接支持点击调起系统浏览器）。代码块采用等宽字体 13.5sp 配浅底色；引用块带左侧 3dp 竖线；未闭合标记直接按原字符展示，完整保留正文内容。
- **正文清晰度**：正文统一为主色 100% alpha、15sp、行高 1.62，并为块级文本加上轻投影；内容区雾面绝对 alpha 保底 ≥0.52。
- **固定顶栏**：`收起 / 本次关闭悬浮球` 移出 ScrollView 独立固定在顶部，无论列表滚动到何处均常驻可见；按钮加上**半透明胶囊衬底与 1px 细边**，在纯黑与纯白壁纸下均清晰可辨，并在顶栏下方增设一条细分隔线。
- **开合动效**：展开时，悬浮球在原位**形变收拢为液滴并向下坠落**（150ms，`AccelerateInterpolator`），随后切换至面板窗，**圆角半径由液滴态平滑收敛至 22dp**（`ViewOutlineProvider` + `invalidateOutline` 逐帧驱动），配合 `scaleY 0.80→1`、`translationY 24%→0`（`OvershootInterpolator(0.9)`）以及径向渐变**光晕层 α0.45→0**；收起时反向执行圆角收拢、缩放至 0.72 并下移淡出（260ms，自定义缓动），接着挂回球窗并以 **Overshoot(1.7) 轻弹归位**（200ms）。全程维持**单窗口约束**，待滴落完成后再切换窗口。

**③ 附件即时气泡、进行中提示与后台持续收发**
- 选定文件后**立即**在同一回调线程调用 `OverlayService.echoAttachment()`，面板消息区即刻插入**带缩略图的附件气泡**（本地文件异步降采样解码，最长边 480px，保持界面流畅）并显示「**正在发送…**」；
- 点击缩略图可在**面板内原地放大**（320×面板高 42%，`FIT_CENTER`），再次点击收起，全程保持单窗口结构；
- 发送与等待阶段提供明确状态提示：`attachSending` 显示带波纹动画的「正在发送…」，`busy` 显示「OH 正在思考…」；
- **关闭面板后继续收发**：消息列表由适配器在模块态持有，收起面板后异步请求照常进行；回复到达后通过 `pushUi` 清空 `status` 并追加回复，下次展开面板即可查看完整上下文；发送失败则置 `status:"error"`，原生端显示「发送失败，可再试一次」。
- 图片消息直接在 Markdown 消息区内展示缩略图并支持点击放大。

**图片与状态数据契约**（`overlayAndroid.ts` 的 `pushUi.messages[]`）：
```ts
{ role: "user"|"oh", text: string, images?: string[] /* 本地路径 */, status?: "sending"|"error"|"" }
```
原生端仅读取**本地文件路径**（忽略 data URL，避免大字符串跨桥传递）。

## 2. 静态核对与真机验收边界
| 条目 | 可静态核对的部分 | 需在真机确认的部分 |
|---|---|---|
| ① 品牌字/字号 | span 区间与字号参数（见上表） | 真机 mono/serif/sans 三族混排字形观感、15sp 在 54dp 内的视觉比例 |
| ② Markdown | 语法分支与块级样式定义 | 长回复实际排版、代码块折行、链接点击拉起浏览器 |
| ② 顶栏/对比度 | alpha 与胶囊描边参数 | **纯黑与纯白壁纸下的实际可读性** |
| ② 动效 | 时长与缓动曲线参数 | **开合动画流畅度与液态质感** |
| ③ 附件 | 事件链路与状态流转 | 三类选择器拉起、缩略图解码显示、原地放大/收起手感、关闭面板重开后的消息保留 |
| 共用会话 | 复用 `askOh`/`sendToOh` 同一 harness 会话 | 主应用与悬浮面板历史记录的双向同步待宿主会话打通后联调 |

## 3. 验证命令参考
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
```
装机验收顺序：品牌字与字号 → 固定顶栏 → Markdown 排版 → 开合动效 → 附件即时气泡 → 进行中状态 → 回复渲染。
`overlay_status` 继续输出 `workW/workH/ballX/ballY/windowKind`：球径保持 54dp、**球窗尺寸保持 70dp**（54dp 球体 + 16dp 投影留白），默认坐标与上一轮一致 —— **预期 `workW=1264 / workH=2800 / ballX=1005 / ballY=2135`**（球右边缘距屏右 12dp、下边缘距屏底 128dp）。

## 4. 实现边界说明
- 品牌字混排映射到系统内置的 mono/serif/sans 三族字体（仓库未附带独立 Montserrat 字体文件）；在 API<28 设备上字重 500/700 自动回退为 400/700。
- 代码块超长行在面板内容宽度上限（`maxWidth=屏宽*0.84`）处自动折行。
- 点击图片采用面板内原地放大预览，以维持单窗口约束；若需独立全屏查看器，后续可评估临时双窗方案。
- 液态动效基于参数化曲线（`ViewOutlineProvider` 配合 `Overshoot` 与自定义缓动）实现，最终视觉效果以真机录屏为准。

---

# task-15 交付（悬浮层五项体验优化 + 附件返回主应用修复）

状态：**完成**（`tsc` exit 0；Kotlin 括号平衡；`._*` 为 0）。

| # | 用户反馈 | 做法 |
|---|---|---|
| 1 | 顶栏与内容之间的分隔线突兀 | **移除 `headLine`** 分隔线。顶栏重构为两行四个操作，全部置于 ScrollView 之外常驻固定，并统一配齐**高对比胶囊衬底**：第一行为 `回到 OneTHU` 与 `自动朗读：关/开`；第二行右对齐 `收起` 与 `本次关闭悬浮球` |
| 2 | 增加消息朗读 | 提供面板全局开关与单条消息入口：① 顶栏 `自动朗读：关/开` 派发 `toggleAutoSpeak{on/off}` 事件，由适配器写入 `voicePrefs` 并回推最新状态；② 每条 **OH** 消息下方提供文字入口 `朗读`，触发 `speak{text}` 并调用 `speakReply(text,{force:true})`（手动点击立即播报，忽略静音偏好）；③ 自动档在收到回复时调用 `speakReply()`（按 `autoSpeak` 偏好决定，默认静音）；④ 播报结束监听 `onTtsDone`（`onethu-tts://done`）同步 `speaking` 状态回原生，每次新播报前先调用 `ttsStop()` 中断上一条 |
| 3 | 增加「回到 OneTHU」入口 | 顶栏 `回到 OneTHU` 胶囊调用原生 `OverlayService.openApp()`（`packageManager.getLaunchIntentForPackage` 配合 `NEW_TASK|SINGLE_TOP`），仅在用户主动点击时切回主应用 |
| 4 | 语音输入后列表未滚到底部 | `scrollToBottom()` 改为**连续两次 `post`**（等待新内容完成首轮测量布局后再取真实高度），并在语音 `onFinal`、手动发送、`renderMessages` 及 `pushUi` 状态更新后统一触发 |
| 5 | 边缘吸附收缩为侧边条 | 新增 `side` 形态（`SIDE 22×56dp` 胶囊 + 1px 细边 + 轻投影 + 中心点）：**拖拽贴边后经 1.2s 自动收拢为侧边条**（`EDGE_SHRINK_MS`）；**悬浮球空闲满 10s 同样自动收拢**（`IDLE_COLLAPSE_MS`，任何拖拽、点击、语音或面板活动均重置计时，面板或语音条展开期间暂停计时）；**点击或按压侧边条即平滑展开回球**（按下即展开，继续长按可直接进入语音，短按仅展开回球） |
| 6 | 液态滴落改为「融化→落至屏底→铺开」 | 重写开合轨迹：展开时悬浮球**收窄拉长形变为液滴**，同时**窗口沿屏幕向下坠落至底部**（`FALL_MS=170`，`AccelerateInterpolator(1.5)`，逐帧 `updateViewLayout`），触底后切换为面板窗并**由落点向外晕开**（圆角半径由 40% 收敛至 22dp + 上浮放大 + 光晕淡出，`BLOOM_MS=280`）；收起时反向将面板收拢（260ms），随后在落点挂回球窗并**向上升回原位**（`RISE_MS=200`，同步恢复正圆形态），最后以 `Overshoot` 轻弹收尾。总时长为展开 450ms、收起 460ms |
| 7 | 选择附件后意外跳回 OneTHU 主界面 | **详见下节分析与方案** |

## 第 7 条：选择附件后跳回主界面（根因与方案取舍）

**根因定位**：原有调用链中存在两处会唤醒主应用任务栈的环节——基于 Activity 上下文的 `startActivityForResult`，以及系统回传选择结果时要求调用方 Activity 处于 `resumed` 状态。系统选择器进入主应用 Task 后，顺势将 OneTHU 主界面带到了前台。

**落地方案（按入口机制分路处理）**：
- **拍照**：改为免结果回调模式——使用 `ACTION_IMAGE_CAPTURE` 配合 `EXTRA_OUTPUT`（指向宿主 FileProvider URI），通过 **`activity.applicationContext.startActivity()` + `FLAG_ACTIVITY_NEW_TASK`** 在独立任务栈拉起系统相机，再由后台线程轮询目标文件（每 400ms 检查文件大小，连续两次稳定即判定写入完成，超过 90s 按取消处理）。**全程保持主应用留在后台**，拍摄完成后直接回到原先停留的应用与悬浮层。
- **相册 / 上传**：SAF 与 Photo Picker 均通过 Activity Result 交付 URI（无 `EXTRA_OUTPUT` 等价能力，`ClipData` 仅适用于拖拽场景），系统回调时必然短暂唤醒宿主 Activity。因此在保留结果回调的同时，**在回调首部立即调用 `activity.moveTaskToBack(true)`** 将主应用退回后台（经 `returnFocusIfNeeded()` 判断：仅当拉起选择器前主应用原本在后台时才执行退栈），使焦点迅速回到原应用与悬浮层。该路径在结果交付瞬间会有一次短暂切换，不会停留在 OneTHU 主界面。
- **后续演进方向**：若相册与上传也需要消除交付瞬间的短暂切换，可改为申请 `READ_MEDIA_IMAGES` 权限并基于 `MediaStore` 自绘媒体选择面板；当前阶段优先维持零额外存储权限的轻量方案。

## 静态核对与真机验收边界
| # | 可静态核对的部分 | 需在真机确认的部分 |
|---|---|---|
| 1 | `headLine` 已移除、四个操作均位于 ScrollView 之外 | 两行胶囊在真机雾面上的视觉比例与折行表现 |
| 2 | 事件链路、`force:true` 语义与 `onTtsDone` 状态收口 | **真机语音播报效果**、手动与自动两档切换表现、播报与语音输入的麦克风协调 |
| 3 | 启动命令与 Intent Flag 配置 | 点击后切回主应用的稳定性（不同 ROM 对 Launch Intent 处理存在差异） |
| 4 | 双次 `post` 滚动逻辑 | 长回复场景下列表是否稳定停在最新消息底部 |
| 5 | 计时阈值与几何参数（10s / 1.2s / 22×56dp） | 贴边收拢观感、点击展开流畅度、侧边条边缘防误触表现 |
| 6 | 动画时长与插值曲线（170+280 / 260+200） | **「融化→滴落→铺开」连贯度与真实观感** |
| 7 | 相机走 Application + `NEW_TASK` + 文件轮询；相册/上传走结果回调 + `moveTaskToBack` | **拍照路径零切前台表现**、相册/上传切换时长、各 ROM 对 FileProvider 授权兼容性 |

## 验证命令参考
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
```
编译核对要点：`activity.applicationContext.startActivity(plan.intent)`（相机分支）、`activity.moveTaskToBack(true)` 返回值处理、`OverlayMd`/`OverlayViews` 新增导入项，以及 `Typeface.create(family, weight, italic)` 的 API 28 守卫。

## 实现边界说明
- 相册与上传在系统交付 URI 瞬间存在一次短暂切换（详见第 7 条方案说明）。
- 相机文件轮询采用文件长度稳定判定：若个别系统相机在 `EXTRA_OUTPUT` 之外另存相册副本，插件仅读取 `EXTRA_OUTPUT` 目标路径原图。
- 侧边条当前采用整颗胶囊贴边样式，后续如需半圆隐入屏边的视觉形态可进一步微调。
- 朗读能力依赖 `onethu-tts` 插件；当运行环境未安装或暂不支持 TTS 时，`speakReply` 平滑返回 `false` 并保持界面静默。

---

# task-15 编译修复（2026-10-11 17:0x）

## 编译结果：**BUILD SUCCESSFUL**（本地连续两次编译通过）

```bash
cd apps/desktop/src-tauri/gen/android
./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin --console=plain
# → BUILD SUCCESSFUL in 3~4s
#   22 actionable tasks: 3 executed, 19 up-to-date
#   仅剩 1 条告警：SOFT_INPUT_ADJUST_RESIZE 已弃用（那是我们要用的 flag，故意保留）
```

## 根因与修复内容

**根因 1（`OverlayViews.kt:417/424/467/468` 处 `inputRow / underline / scroll / list / input / action` 引用缺失）**：
上一轮调整两行顶栏时，切片替换范围覆盖了 `// 两个功能性裸文字入口` 至 `// 附件三入口（需求 6）` 之间的消息列表（`scroll` + `list`）、底部输入行（`inputRow` + `input` + `action`）及 `underline` 视图构造代码，导致后续 `inputBlock.addView(inputRow/underline)` 与 `PanelHolder(...)` 出现未解析引用。
现已按原结构完整补回，置于两行顶栏之后、附件入口之前，子视图顺序恢复为：`顶栏(两行) → 消息列表(weight=1) → 拍照/相册/上传 → 语音行(GONE) → 输入块(输入行+下划线)`；`root` 子视图顺序保持 `content → glow`。

**根因 2（`OverlayWindows.kt:600 Unresolved reference: TextView`）**：
`OverlayWindows.kt` 此前均通过 `p.xxx` 字段引用已有控件，未单独导入 `TextView`；新增消息下方朗读入口时直接调用了 `TextView(themed)`。现已补齐 `import android.widget.TextView`。

**朗读按钮显式构造写法保留**：
`say` 朗读按钮保留逐行属性赋值并显式传入 `OverlayViews.shadow(say)`，避免 `TextView(ctx).apply { … shadow(this) }` 嵌套作用域中出现 `this` 指向遮蔽。

**同步清理的编译告警**：
- `FogLayout.build(w,h)` 中未使用的参数 `w` 添加 `@Suppress("UNUSED_PARAMETER")`（纵向渐变仅依赖高度 `h`）；
- 移除 `onOrbTouch` 四个 `when` 分支末尾多余的字面量 `true`（函数末尾已统一 `return true`），重新编译确认无告警。

## 一并复核通过的静态检查项
`PanelHolder` 字段声明顺序与构造实参顺序、`OrbHolder.side` 新增字段、`OverlayVoice.Host` 新增 `onOpenApp` 服务实现、`OverlayService.openApp/echoAttachment/liveDebug`、`OverlayPicker.plan/planFallback/materialize/mimeOf`、`OverlayMd.render/progress/TAG_DIVIDER`，以及全部新增导入（`TextView`/`Spannable`/`RelativeSizeSpan`/`TypefaceSpan`/`Typeface`/`ImageView`/`LinearGradient`）。

## 需在真机确认的项目
1. 顶栏胶囊比例与折行情况；2. **TTS 实际播报效果**（手动与自动两档、播报与语音输入抢麦处理）；3. 点击返回主应用的 ROM 兼容性；4. 长回复自动滚底表现；5. 贴边缩小与展开顺滑度；6. **「融化→滴落→铺开」动效观感**；7. **拍照零切前台表现**、相册/上传切换时长与 FileProvider 授权兼容性。

---

# task-15 追加批次 A–F（用户 17:21 六项悬浮层优化）

状态：**完成 · 编译通过**（`./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin` → **BUILD SUCCESSFUL**；`tsc` exit 0；`._*` 为 0）。

## A. 窗口形态与视觉风格
- **A①** 面板由「全宽 50% 半屏」调整为**悬浮小窗**：左右各留白 **14dp**（`PANEL_MARGIN_DP`）、高度 **44%**（`PANEL_RATIO`）、底部留白 14dp、四角 **24dp 圆角**（`PANEL_RADIUS_DP`，对齐设计 token `--dsw-radius-lg/xl`）；窗口保持 `TRANSLUCENT` 配合显式像素宽高，圆角由雾层 `clipPath` 裁剪成型。
- **A②** 对齐主应用 ChatDock **同一套视觉语言**：圆角、色彩、字号、行高与间距统一取 `OverlayViews` 中的 token 映射值（`#1C1F24`/`#ECECF1`、15sp、行高 1.62、条目间距 14dp），顶栏操作统一为**胶囊衬底 + 1px 细边**。本批消息区暂保持前几轮验收的雾面文字排版，下一批可根据需要切换为独立气泡容器（改动集中于 `buildMessageColumn`）。
- **A③** 顶栏**精简移除「本次关闭悬浮球」**，保留三个高频操作：**回到 OneTHU / 自动朗读 / 收起**。「本次关闭」入口继续由系统通知栏动作与主应用 ChatDock 内的悬浮球开关承载。
- **A④** 液态滴落开合动效完整保留（时长口径同 D③/E）。

## B. 边缘吸附收拢优化
- **B①** 拖拽贴边后，180ms 吸附动画**结束瞬间立即收拢**为侧边条（移除原先 1.2s 的延迟常量 `EDGE_SHRINK_MS`）。
- **B①续** 侧边条**严密贴合屏幕边缘**：胶囊按所在侧对齐窗口外缘（右侧 `Gravity.END`、左侧 `Gravity.START`），配合窗口紧贴屏幕边界（`x=0` 或 `x=屏宽-条宽`），消除原先的 8dp 投影缝隙。
- **B②** 空闲自动缩回阈值由 **10s 缩短至 6s**（`IDLE_COLLAPSE_MS`），响应更紧凑。

## C. 悬浮球挂载稳定性加固
- `showBallOnly()` 调整为**先彻底摘除面板与球窗，再重新挂载球窗**，消除历史挂载状态残留导致的偶发不显示问题；
- 挂载异常时触发**自动自愈**：`forceCleanupWindows()` 强制从 `WindowManager` 清理两扇窗口、重建视图实例并重新挂载；
- `attachOrb()` 内部同样补充异常清理后重试一次的保护逻辑；
- 复核全部恢复入口（`overlay_show`、开机广播、进程自救与前后台切换），统一经 `showBallOnly()` 恢复为单一悬浮球态。

## D. 长按悬浮球的原地横向语音条
- **D①** 长按悬浮球 ≥450ms 时，球体在**当前高度原地横向展开**为语音长条（`VOICE_BAR_W_DP=300`）：窗口尺寸为宽 300dp（窄屏自动适配）× 高 96dp（56dp 语音条 + 40dp 转写带）；语音条**上方**浮现一层**淡雾转写带**（`coreAlpha` 浅色 0.72 / 深色 0.62，仅在收音或产生转写文本时显现）实时展示识别文字；
- 横向展开方向依据悬浮球所在屏幕半区自动判定（右半屏向左展开、左半屏向右展开），竖直方向以球心对齐；
- **D②** 保留上划 110dp 松手取消手势；
- **D③** 松手发送后衔接**液态滴落至屏底并展开为悬浮小窗**（`dropletThenBloom()` 对当前可见的球、语音条或侧边条执行液滴形变）。

## E. 悬浮窗长时等待超时保护
- 新增**原生看门狗**：进入 `busy` 状态满 40s（`BUSY_TIMEOUT_MS`，每 5s 检查一次）后自动**停止加载转圈**，切换为明确提示「**还没收到回复 · 切回本体可查看进度**」；此后若回复经 `overlay_push_ui` 送达，仍会立即切回正常消息展示。
- 职责定位：回复数据依赖主应用 WebView 的 JS 通道回推，看门狗负责在后台等待较久时及时收敛加载动效并给出清晰指引。

## F. 后台保活控制与系统设置引导
- **F① 通知栏新增「退出」动作**（`ACTION_EXIT`）：停止前台服务并摘除悬浮球与面板，结束当次保活会话；该操作保持 `closedByUser` 标记不变且不发送 `closed` 事件，下次进入主应用时悬浮球可照常自动开启（而点击「本次关闭」则会记录用户主动关闭偏好，需回到主应用内手动重开）。
- **F② 系统设置页快捷跳转命令**（供 OH 设置页直接调用）：
  `plugin:onethu-overlay|overlay_open_settings { what }`，其中 `what ∈ battery | startup | app`；TS 侧已导出 `openSystemSettings(what)`（`lib/overlayAndroid.ts`）。
  - `battery` → 跳转 `Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS`（系统电池优化列表页，无需额外权限）；
  - `startup` → 尝试拉起华为/荣耀「应用启动管理」页面（依次匹配 `com.hihonor.systemmanager.*` 与 `com.huawei.systemmanager.*` 下的 `startupmgr`、`appcontrol` Activity；未命中时**自动回退至系统应用详情页**）；
  - `app` → 跳转 `ACTION_APPLICATION_DETAILS_SETTINGS`。
- **F② 配套指引文案（供设置页直接复用）**：
  > **让 OneTHU 常驻后台（华为 / 荣耀）**
  > OneTHU 的悬浮球靠一个前台服务保持在线。系统若把应用「自动管理」，后台活动会被限制，悬浮球可能被回收。
  > 建议按下面两步手动放行（只需设置一次）：
  > 1. **应用启动管理**：设置 → 应用 → 应用启动管理 → 找到 **OneTHU** → 关闭「自动管理」，
  >    打开「允许自启动」「允许关联启动」「允许后台活动」三开关。
  > 2. **电池优化**：设置 → 电池 → 更多电池设置 → 应用耗电管理（或「电池优化」）→ 找到 **OneTHU** →
  >    选择「不允许电池优化」/「允许后台活动」。
  > 另外：通知栏里那条「OneTHU 悬浮球已开启」是保活通知，**不要划掉**；不需要悬浮球时点通知里的
  > 「本次关闭」或「退出」即可。
  > 按钮：`[打开应用启动管理]` → `openSystemSettings("startup")`；`[打开电池优化]` → `openSystemSettings("battery")`。

## 静态核对与真机验收边界（A–F 批次）

| 条目 | 可静态核对的部分 | 需在真机确认的部分 |
|---|---|---|
| A① 小窗 | 尺寸、圆角与边距常量 | 真机小窗比例协调度、圆角裁剪与雾面边缘质感 |
| A② 风格 | 设计 token 映射一致性 | 与主应用并排对照时的视觉统一感 |
| A③ 三动作 | 顶栏精简为三个按钮 | 窄屏下一行三胶囊的排布松紧度 |
| B 吸附 | 动画时长常量与贴边对齐方式 | **贴边收拢速度感与屏幕边缘贴合度** |
| C 显示 | 自愈清理分支与日志记录 | 开关切换、开机、进程恢复与前后台切换场景下的一次挂载成功率 |
| D 语音形态 | 窗口几何尺寸与转写带参数 | **原位横向展开观感**、转写带层次、松手后滴落衔接顺滑度 |
| E 超时状态 | 40s 阈值与提示文案 | 切到外部应用发消息满 40s 后停转圈及提示可读性 |
| F① 通知退出 | `ACTION_EXIT` 分支与偏好标记逻辑 | 通知栏双按钮展示、点击「退出」后摘窗且保留下次自动恢复能力 |
| F② 设置跳转 | Intent 组件候选表与回退链 | 荣耀 MagicOS 上 `startup` 直达「应用启动管理」页的命中情况 |

## 验证命令参考
```bash
cd apps/desktop/src-tauri/gen/android && ./gradlew :tauri-plugin-onethu-overlay:compileDebugKotlin   # 本地已验证：BUILD SUCCESSFUL
cd apps/desktop/src-tauri/gen/android && ./gradlew :app:processArm64DebugMainManifest
cd apps/desktop/src-tauri && cargo check --target aarch64-linux-android   # 本轮新增 Rust 命令 overlay_open_settings
```

---

# task-15 追加：气泡化 + liquid glass（用户 17:5x 拍板）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` 与 `:app:processArm64DebugMainManifest` 均 **BUILD SUCCESSFUL**；仅余 1 条已知 `SOFT_INPUT_ADJUST_RESIZE` deprecated 提示；`tsc` exit 0；`._*` 为 0）。

## 1) 气泡形制
- 新增 `OverlayGlass.kt` 中的 **`GlassBubble`**（自定义 `FrameLayout`，集成玻璃材质自绘与入场动画）。
- **四角基准 20dp，发言方尾角收至 6dp**：`tailFor(isUser)` 为用户侧取 `[20,20,6,20]`（右下收角）、OH 侧取 `[20,6,20,20]`（左下收角）；外轮廓通过 `Path.quadTo` 逐角绘制，并与 `outlineProvider` 同步，使外投影贴合气泡轮廓。
- 对齐与宽度：用户消息右对齐、OH 消息左对齐；气泡最大宽度限制在 **≤84% 屏宽**（内部文本 `maxWidth = 84%屏宽 − 28dp 内边距`）；正文统一为 **15sp / 行高 1.62 / 主色 100% alpha**（`USER_ALPHA` 由 0.62 提升至 1.0，通过左右对齐与尾角区分角色）；消息间距调为 **11dp**（`GAP_DP` 由 14 收至 11，落在 10–12dp 区间内）。
- 单一气泡包裹完整消息内容：`[图片缩略图…][Markdown 内容块…][朗读入口][状态行]`，使附件消息自然共享同一套玻璃气泡材质（缩略图保持 14dp 圆角）。

## 2) Liquid Glass 材质（基于多层自绘模拟通透玻璃感）
| 层 | 实现 |
|---|---|
| 玻璃底 | `LinearGradient` 纵向渐变：浅色 `#FFFFFF` α**0.62→0.48**；深色 `#000000` α**0.42→0.30**（`OverlayViews.glassFill()`） |
| 上沿 1px 内高光 | 先绘制整圈 1px 淡描边，再**裁剪至顶部 2dp 窄带**叠加亮色描边，提亮上沿（对应 CSS `inset 0 1px 0 rgba(255,255,255,.5)`），静态强度设为浅色 **0.5** / 深色 **0.22** |
| 柔和外阴影 | `elevation` 设为浅色 10dp / 深色 12dp，outline 贴合圆角，并将 `list`/`row` 的 `clipChildren` 设为 `false` 保留完整投影区域 |
| 柔和边缘 | 1px 描边取浅色 `#FFFFFF` α0.35 / 深色 `#FFFFFF` α0.22，由半透明渐变底、上沿高光与外阴影三层叠出通透感 |
> 注：安卓系统未开放第三方跨应用实时背景模糊，此处通过渐变底、顶部高光与柔和外阴影三层组合模拟玻璃质感，避免使用曾引发整屏泛白的 `FLAG_BLUR_BEHIND`。

## 3) 最新消息「自然弹出」进场动效
- **仅对最新到达的一条播放**：仅当面板处于展开状态且消息总数增加时将 `animateNewest` 置真（于 `pushUi` 内判定），`renderMessages` 仅对末尾消息传入 `animate=true` 并随即复位，确保展开面板或重建历史记录时列表平稳安静；
- 动画参数：`scale 0.94→1.0` + 上浮 **6dp** + `OvershootInterpolator(1.05)`，时长 **200ms**，同时伴随顶部高光 `α0.35→0` 在 **200ms** 内柔和扫过；
- 本地即时回显（附件气泡、语音整句、键盘发送）同样按新消息触发该进场动效。

## 4) 保持不变的既有规格
悬浮小窗几何规格（左右边距 14dp / 高度 44% / 圆角 24dp）、顶栏三胶囊（回到 OneTHU / 自动朗读 / 收起）、液态滴落开合时长（展开 150+280ms、收起 260+200ms）、40s 超时提示文案，以及附件即时气泡缩略图（14dp 圆角）均保持稳定。

## 同步修复的面板滚动问题
`OverlayMd` 原先为所有块级文本统一挂载了 `LinkMovementMethod`，导致普通文本块拦截垂直滑动手势。现已改为**仅在文本块包含 `](` 链接语法时按需挂载**，恢复气泡区域的顺畅上下滚动。

## 静态核对与真机验收边界（气泡化批次）
| 条目 | 可静态核对的部分 | 需在真机确认的部分 |
|---|---|---|
| 气泡形制 | 圆角、尾角、间距与最大宽度常量 | 真机一屏内气泡视觉比例、6dp 尾角辨识度 |
| Liquid Glass | 渐变、内高光与阴影三层参数 | **压在真实壁纸与外部应用上的通透玻璃质感**、深色模式下高光亮度平衡 |
| 自然弹出 | 时长、缓动曲线与仅最新消息触发逻辑 | **弹出动效自然度**、连续多条消息到达时的衔接节奏 |
| 附件气泡 | 玻璃容器材质与缩略图圆角 | 缩略图在半透明玻璃底上的融合观感 |
| 面板滚动 | 按需挂载 `LinkMovementMethod` | 含超链接的长回复气泡内上下滑动顺畅度 |

---

# task-15 质量红线轮（emoji 清理 / 气泡紧凑度 / 单行顶栏 / (OH) 品牌标）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` → BUILD SUCCESSFUL；`tsc` exit 0；`._*` 为 0）。

## 1) emoji 扫描与清理
扫描范围：`plugins/onethu-overlay/**/*.kt` + `lib/overlayAndroid.ts`，按码点正则 `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]` 逐字符扫描。
**共定位到 2 处源码字符串（均为面板可见文案）**，已完成替换：
| 位置 | 改前 | 改后 |
|---|---|---|
| `OverlayWindows.kt`（附件本地回显） | `"[回形针emoji] $name"` | `"附件：$name"` |
| `overlayAndroid.ts`（附件消息推给原生） | `` `[回形针emoji] ${name}` `` | `` `附件：${name}` `` |
复扫结果：**0 处命中**（注释中的常规箭头或 `─` 分隔线均位于非 UI 代码注释区）。
复现方式：使用 `python3 -c "…emoji 正则扫描…"` 对上述范围执行全量检查。

## 2) 气泡紧凑度参数表（含实测值）
| 项 | 值 | 实测 |
|---|---|---|
| 垂直内边距 | **7dp**（要求 ≤9） | — |
| 水平内边距 | **13dp**（要求 ≤13） | — |
| 字号 / 行高 | **15sp** / `lineSpacingMultiplier = 1.32`（乘以 Android 字体基准行高 1.17em 后约为 **1.55em**，落在 1.55–1.62 低端） | 单行高 = 15×1.17×1.32 ≈ **23.2dp** |
| 单行气泡总高 | 23.2 + 7×2 = **37.2dp**（Android 算法） | 静态桩（按中文字体从严测算）实测为 **39.25dp**，两种口径均控制在 **≤40dp** 以内 |
| min-height | **未设置**（全程随内容自适应，无 `minHeight` 约束） | — |
| 段间距（气泡内） | 缩略图下 6dp；朗读行 0；列表项 3dp；分隔线上下各 3dp → **均 ≤6dp** | — |
| 空行 | Markdown 段落逐行 `trimEnd()`，遇到空行即切分段落，块内保持紧凑无多余空行 | — |
| 气泡最大宽度 | `min(84% 屏宽, 小窗内容宽)` | 361dp 视口宽下约为 303dp |
| 消息间距 | **11dp** | — |
> 注：垂直内边距为 8dp 时静态桩实测高度为 **41.25dp**（略超 40dp 目标值），收紧至 7dp 后达标。

## 3) 顶栏：单行三胶囊布局（含实测值）
| 项 | 值 |
|---|---|
| 结构 | **单行排布**：`回到 OneTHU` / `朗读 开·关` / `收起`（已合并原第二行） |
| 胶囊高 | **32dp**（固定 `LayoutParams` 高度） |
| 水平内边距 | **12dp**；胶囊间距 **8dp**；左右外边距与小窗对齐为 **14dp**（`content` 左右 padding） |
| 单行约束 | `isSingleLine=true`、`maxLines=1`、`ellipsize=null`，保持单行完整展示 |
| 文案精简 | 由「自动朗读：开/关」精简为 **「朗读 开/关」**，适配 360dp 窄屏视口 |
| 实测 | 胶囊行高 **32dp**，三枚胶囊总宽 **233dp**，可用宽度 **333dp**（361dp 屏宽减去两侧 14dp），**单行完整容纳且留有 100dp 余量** |

## 4) (OH) 品牌标：对齐官方 HarnessMark
对照 `components/HarnessMark.tsx` 与 `global.css:4090-4093`（**半角** `(` `O` `H` `)`）：
| 范围 | spans | 与 CSS 对应 |
|---|---|---|
| `[0,1)` `(` | `TypefaceSpan("monospace")` + `RelativeSizeSpan(1.10f)` | `.p` mono 400；等宽括号视觉偏细小，放大至 **1.10×** 保持视觉齐平 |
| `[1,2)` `O` | `TypefaceSpan(serif, 500)` + `RelativeSizeSpan(1.14f)` | `.o` 1.14em |
| `[2,3)` `H` | `TypefaceSpan(sans-serif, 700)` + `RelativeSizeSpan(1.06f)` | `.h` 1.06em / 700 |
| `[3,4)` `)` | 同 `(` | — |
TextView 配置：`textSize=15sp`、`letterSpacing=0.05f`（对应 `gap:0.05em`）、`includeFontPadding=false`、`isSingleLine=true`、`gravity=CENTER`（球内垂直居中），**球径保持 54dp**。
宽度核算：`(` 9.9 + `O` 12.3 + `H` 11.4 + `)` 9.9 + 字距 3 ≈ **46.5dp < 54dp**，留白充裕无裁切。
静态预览图中叠加 54dp 虚线圆框核对，两侧括号与字母等高对齐、边缘完整（见 `preview/mark-ball.png`）。

## 5) 静态渲染预览图
- 输出位置：`apps/desktop/src-tauri/plugins/onethu-overlay/preview/`
  - `mark-ball.png`（悬浮球浅/深色对照，叠加 54dp 虚线参考框）
  - `topbar.png`（顶栏三胶囊浅/深色对照）
  - `bubbles.png`（单行、多行 Markdown 与附件缩略图气泡的浅/深色对照）
  - `measure.png`（在画面上直接标注实测数值：单行 39.25dp、胶囊行高 32dp / 总宽 233dp、尾角 2.6× 放大对照）
- **适用范围说明**：上述预览图基于 HTML/CSS 按同一组几何尺寸、圆角、尾角、透明度与层次参数配合同族 Web 字体栈离线渲染生成，用于直观校验布局比例与材质层次；Android 端 Roboto/PingFang 字体的实际 ascent/descent 度量及 Canvas 自绘路径边缘像素，仍以装机后的真机显示为准。
- 生成方式：通过 `preview/*.html` 配合 Chrome headless（`--headless=new --force-device-scale-factor=2 --screenshot`）导出，其中 `measure.html` 调用 `getBoundingClientRect()` 读取排版尺寸并直接标注在页面上。

## 6) 静态核对与真机验收边界（本轮）
| 条目 | 已静态核对项 | 需在真机确认的部分 |
|---|---|---|
| emoji | 码点全量扫描 **0 命中** | 无需额外真机核对 |
| 气泡紧凑度 | 静态实测 39.25dp / Android 公式 37.2dp | Android 系统字体度量下的实际行高与多条消息阅读节奏 |
| 顶栏单行 | 实测总宽 233dp < 可用宽 333dp | 真机 PingFang/Roboto 字体下是否保持单行、系统主题对胶囊描边的影响 |
| (OH) 标 | span 映射表、宽度核算与 54dp 虚线框对照 | 真机 Droid Sans Mono / Noto Serif 等系统字族混排的实际字形观感 |
| 玻璃材质 | 渐变、高光与阴影分层参数 | 叠在真实壁纸与外部应用之上的玻璃通透感及 overlay 窗口 `elevation` 投影效果 |

---

# emoji 清零验收（命中清单与参数核对）

## 1) 命中清单与替换结果

扫描范围：`plugins/onethu-overlay/**`（涵盖 `android/` 源码、`res/`、`AndroidManifest.xml`、Rust、permissions 与 `REPORT.md`）+ `apps/desktop/src/lib/overlayAndroid.ts`；匹配正则 `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}\u{200D}]`，共覆盖 41 个文件。

| # | 位置 | 改前 | 改后 | 是否 UI 可见 |
|---|---|---|---|---|
| 1 | `OverlayWindows.kt` 附件本地回显（约 750 行） | `"[回形针emoji] $name"` | **`"附件：$name"`** | **是（面板气泡）** |
| 2 | `overlayAndroid.ts:364`（附件消息推给原生） | `` `[回形针emoji] ${name}` `` | **`` `附件：${name ?? "（未命名）"}` ``** | **是（面板气泡）** |
| 3 | `OverlayService.kt:17` 类注释 | `[警告emoji] Android 15+ 移除了…` | `注意：Android 15+ 移除了…` | 否（注释） |
| 4 | `OverlayWindows.kt:486` KDoc | `* [警告emoji] **不能把输入块设成 GONE**` | `* 注意：**不能把输入块设成 GONE**` | 否（注释） |
| 5 | `AndroidManifest.xml:9` XML 注释 | `[星号] 需要 Lead 在 app 模块确认…` | `! 需要 Lead 在 app 模块确认…` | 否（注释） |
| 6 | `REPORT.md`（本文档自身） | 历史段落里的 emoji 记号 | 全部替换成纯文字 | 否（文档） |

**`overlayAndroid.ts:364` 当前代码核对**（可通过 `sed -n '364p'` 查看）：
```ts
const mine: NativeMsg = { role: "user", text: `附件：${name ?? "（未命名）"}`, images: [path], status: "sending" };
```
（早先讨论中引用的 `［回形针］ ${name ?? "附件"}` 为上一轮替换前的历史快照。）

## 2) 复扫结果：**0 命中**

```
扫描 41 个文件（.kt/.xml/.rs/.toml/.json/.md/.html/.kts/.pro + overlayAndroid.ts）
emoji 总命中 = 0
```
复现方式：使用 `python3` 执行上述码点正则扫描，零命中输出即确认通过。

**面板可见文案完整清单**（汇总 Kotlin 侧全部 `text=`/`hint=` 默认值与运行期提示）：
| 文件:行 | 文案 |
|---|---|
| `OverlayViews.kt:299` / `:520` | `在听，请讲…`（语音条与面板语音行） |
| `OverlayViews.kt:427` | `点击输入，长按说话`（输入行占位） |
| `OverlayViews.kt:446` | `发送` |
| `OverlayViews.kt:619` | `•`（侧边条中心点，采用 U+2022 常规印刷圆点，位于全部 emoji 码点区间之外，以 10sp / α0.43 提示可点击；如需纯几何绘制也可改为 Canvas 圆点） |
| `OverlayWindows.kt:711` | `朗读` |
| 其它运行时文案 | `附件：<name>`、`正在发送…`、`OH 正在思考…`、`还没收到回复 · 切回本体可查看进度`、`发送失败，可再试一次`、`回到 OneTHU`、`朗读 开/关`、`收起`、`在听，请讲…`、`松开取消`、`没听清，再说一次`、`此环境取不到麦克风，点开面板用键盘输入`（均为纯文字） |

## 3) 与 ball-ui 对齐的原生侧参数表

| 项 | 原生侧取值 | 备注 |
|---|---|---|
| 气泡内边距 | **7dp 垂直 / 13dp 水平** | 要求 ≤9 / ≤13 |
| 单行气泡总高 | **Android 公式 37.2dp**；静态桩实测 **39.25dp** | 要求 ≤40（8dp 时静态桩为 41.25dp，故收至 7dp） |
| 行高 | `lineSpacingMultiplier=1.32`（约 **1.55em**） | 要求 1.55–1.62 |
| 顶栏 | 胶囊高 **32dp**、水平内边距 12dp、间距 8dp、外边距 14dp；**三胶囊总宽 233dp / 可用 333dp**（余量 100dp） | 单行容纳、无溢出或折行 |
| 球内标 | 半角 `(OH)`：mono 1.10× / serif 1.14× / sans 700 1.06×；15sp；宽度核算约 46.5dp < 54dp | 与官方 HarnessMark 一致 |

---

# 三处旧样式统一 + 整块毛玻璃 + 横屏吸附（用户 2026-10-11 19:5x）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` → BUILD SUCCESSFUL；`tsc` exit 0；`._*` 为 0）。
新增预览图：`preview/glass.png`（展示整块毛玻璃小窗、线描图标以及语音条与转写带的浅/深色效果）。

## ① 旧样式统一改造清单
| # | 位置 | 调整前 | 调整后（与面板主材质统一） |
|---|---|---|---|
| 1 | **面板内长按语音条**（`OverlayViews.buildVoiceBar` 的 `root`） | `coreAlpha 0.90/0.94` + 纵向底浓顶淡渐变 | **整块均匀毛玻璃** `0.78/0.62`、`cornerRadius 18dp`、1px 细边、上沿 1px 高光 |
| 2 | **语音条上方转写带**（同一 builder 的 `sub`） | `0.72/0.62` + 向上渐隐至透明 | **同款毛玻璃材质**（浓度 `0.74/0.58`）、整块均匀无渐隐、14dp 圆角、同款细边与高光 |
| 3 | **拍照 / 相册 / 上传三入口** | 13sp 文字按钮（`拍照` `相册` `上传`） | **线描图标**（新增 `OverlayIcons.kt` 的 `LineIcon`：Canvas 自绘相机/相册/上传，1.5dp 描边、圆头圆角），配置无障碍标题（`contentDescription` + API 26+ `tooltipText`），单行排布 3 个 40×40dp 点击区、间距 10dp、纯图形无 emoji |
| 4 | **悬浮球长按触发的语音条** | 与面板内长按动效衔接存在差异 | 与面板内长按**统一为同一套体验**：悬浮球原位横向展开（`VOICE_BAR_W_DP=300`）→ 上划 110dp 取消 → 松手发送 → 液态滴落 → 铺开为小窗（`dropletThenBloom()` 对当前可见子视图执行液滴形变） |
> 说明：上述组件统一复用同一组材质常量（`backplateFill/backplateBorder` 与 `FogLayout` 的 `cornerRadiusPx/borderColor/topHighlight`），保持单一参数源头，便于后续整体微调。

## ② 毛玻璃背板参数表（整块均匀可见）
| 元素 | 浅色 | 深色 |
|---|---|---|
| 小窗背板 fill | `#FFFFFF` **α0.78**（`backplateFill(true)`=α199） | `#000000` **α0.62**（α158） |
| 背板细边 | `#000000` α0.14（1px） | `#FFFFFF` α0.19（1px） |
| 上沿 1px 内高光 | **α0.50** | **α0.22** |
| 圆角 | 24dp（`PANEL_RADIUS_DP`） | 同左 |
| 轻投影 | elevation 10dp | elevation 12dp |
| 纵向浓度分布 | **上下同浓度**（`stopPositions=[0,1] / weights=[1,1]`，整块均匀显色） | 同左 |
| 语音条 | 同上，圆角 18dp；上方转写带 α0.74 / 圆角 14dp | α0.62 / 转写带 α0.58 |
| 消息气泡（保持与背板同套设计语言） | 玻璃底 α0.62→0.48 + 上沿高光 0.5 + 尾角 6dp | α0.42→0.30 + 高光 0.22 |
> 效果：**整块面板从顶到底呈现均匀完整的磨砂背板**，四角轮廓分明、边界利落，顶部区域文字在各类壁纸上同样清晰可辨。

## ③ 横竖屏切换时的边缘吸附重算
新增 `OverlayWindows.onConfigChanged()`，由 `OverlayService.onConfigurationChanged()` 在每次屏幕配置变更时触发：
1. **记录切换前状态**：保存旧 `cachedW` 及当前贴边方向（`ballX ≤ 8dp` 记为贴左，`ballX + 窗宽 ≥ 旧屏宽 − 8dp` 记为贴右）；
2. **刷新视口工作区**：调用 `refreshScreen()` 重新读取 `currentWindowMetrics.bounds` 获取旋转后的新宽高；
3. **按新视口重新贴边落位**：原贴左则置 `x=0`，原贴右则置 `x=新屏宽 − 窗宽`，其余位置重新执行 `clampX` 与 `clampY`，并将**新坐标与新屏幕宽高**一并写入存档，确保通过存档尺寸校验；
4. **重建并挂载窗口**：调用 `forceCleanupWindows()` 清空旧视图缓存后按原模式恢复（`panel` 重建面板、`bar` 重建语音条、球态重建球或维持原贴边侧边条）；当主应用位于前台（`suspended`）时仅清理旧窗；
5. 随后调用 `onUiModeChanged()` 同步深浅色状态（色系未变时自动跳过）。
**覆盖的几何参数**：球窗与侧边条的贴边 `x`、`clampX/clampY` 上下界、面板宽高（`屏宽 − 2×14dp` 与 `44% × 屏高`）、默认落点 `right 12dp / bottom 128dp` 以及语音条横向展开最大宽度。

## 需在真机确认的项目（本轮）
线描图标在真机屏幕上的辨识度与 40dp 点击手感；整块毛玻璃叠在真实壁纸或外部应用上的通透度（α0.78/0.62 的衬字平衡感）；**横竖屏旋转时悬浮球与侧边条的持续贴边表现及面板重排过渡**；悬浮球长按与面板内长按两处动画的一致性。

---

# 统一风格专项 ①–⑥（用户 2026-10-11 20:30）

状态：**完成 · 编译通过**（`:tauri-plugin-onethu-overlay:compileDebugKotlin` → BUILD SUCCESSFUL，0 error / 0 warning；`tsc` 通过；`._*` 为 0）。
新增预览：`preview/unified.png`（展示与主应用一致的 SVG 图标、双态喇叭、顶部拖拽把手、加厚背板及语音条/转写带的浅深色对照）。

## ① 附件三入口图标：直接复用主应用 SVG Path
对照 `components/Icons.tsx` 中的 `IconCamera / IconImage / IconUpload`（24×24 `viewBox`、`strokeWidth 1.6`、圆头圆角），在 `OverlayIcons.kt` 的 `SPECS` 中原样复用同一串 SVG path，由 `androidx.core.graphics.PathParser` 解析为原生 Canvas 路径：
| 图标 | 主应用 SVG path | 结构说明 |
|---|---|---|
| 相机 | `M4 8.5A1.5 1.5 0 0 1 5.5 7h1.2…` + 镜头圆 `M12 16a3.2 3.2 0 1 0 0-6.4…z` | 机身轮廓、中心镜头与顶部取景器 |
| 图片 | 圆角外框 + 小太阳 + `M4.5 18l5-5 3.2 3.2 2.6-2.6 4.2 4.4` | 相框、远山折线与右上太阳 |
| 上传 | `M12 16V5` / `M7 10l5-5 5 5` / `M5 19h14` | 向上箭头与底部托盘 |
| 喇叭 | `M11.4 5.2 6.9 8.6H4.3a1 1 0 0 0-1 1v4.8…z` + 两道声波 | 详见 ③ |
绘制规格：24 单位画布缩放为 **20dp 视觉尺寸**并居中置于 40dp 点击热区内（缩放比 20/24，等效线宽 1.33dp，与主应用 15px 图标视觉一致）；无障碍语义继续由 `contentDescription` 配合 API 26+ `tooltipText` 提供（纯图标配语义标题，单行固定排布）。

## ② 背板不透明度加厚
| 元素 | 改前 | 改后 |
|---|---|---|
| 小窗背板 | 浅 α0.78 / 深 α0.62 | **浅 α0.90 / 深 α0.80** |
| 语音条本体 | 同上 | **浅 α0.90 / 深 α0.80** |
| 上方转写带 | 浅 α0.74 / 深 α0.58 | **浅 α0.82 / 深 α0.68** |
1px 细边（浅色 `#000000` α0.14 / 深色 `#FFFFFF` α0.19）与上沿 1px 高光（0.50 / 0.22）保持不变，整块背板上下均匀显色。

## ③ 朗读入口：切换双态喇叭图标并消除默认焦点蓝框
- 每条 OH 消息下方的朗读入口由文字切换为 **`LineIcon("speak"/"speakOff")`**（对齐主应用 `IconSpeak`）：**播报中填充喇叭主体**（`filled=true`），静默态保持线描；**播报中再次点击立即停止**（派发 `stopSpeak` 调用适配器 `ttsStop()`），按 `speakingText` 与主应用 ChatDock 保持一致的单条播报状态识别。
- **消除安卓焦点高亮蓝框**：可点击 View 默认会命中系统 `default focus highlight / state_focused`。新增 `OverlayViews.noFocusRing(v)`，统一配置 `defaultFocusHighlightEnabled=false`（API 26+）、`isFocusable=false`、`isFocusableInTouchMode=false` 与 `backgroundTintList=null`，并全面应用于顶栏三胶囊、附件三图标、发送按钮与消息朗读喇叭；配合无状态列表的自定义 `GradientDrawable` 背景，消除点击或焦点切换时的蓝色矩形框（输入框正常保留输入焦点指示）。

## ④ 消除消息重复弹跳闪烁：按稳定消息 id 去重合并
- `PushMsg` 新增**稳定 `id` 字段**：优先采用前端传入的标识（TS 侧为每条消息分配 `m1/m2/...`），未传入时按 `role|text|images` 内容摘要派生；
- 原生端维护 `seenIds` 集合：`renderMessages()` 中通过 `isNew = seenIds.add(id)` 判定，**仅对首次出现且位于列表末尾的新消息播放一次入场动画**；本地即时回显（附件、语音、键盘）采用相同规则生成 `id`，待 JS 权威列表推回时自动识别为同一条消息，避免二次弹跳；
- 本地回显先以 `status=sending` 渲染上屏，权威列表到达后按相同 `id` 原地更新状态与内容，过渡平滑无闪烁；`seenIds` 累积满 400 条时自动轮转清理。

## ⑤ 顶部拖拽把手：上下调节小窗高度
- 面板顶部（顶栏上方）新增 **36×5dp 圆角拖拽把手**（浅深色自适应，按压时透明度由 α0.75 提至 1.0 并伴随轻触感反馈）；
- 竖直拖动实时调节面板高度并**保持底边固定**，逐帧调用 `updateWindowLayout`；松手后将高度占比 `h/屏高` 存入 `OverlayPrefs.panelRatio`，下次展开面板时由 `panelParams()` 读取并限制在 30%–80% 屏高范围内；
- 手势隔离：把手作为独立 View 单独消费拖拽手势，而开合液态动效作用于 `p.root` 的 `scaleY/translationY`，与顶栏点击及窗口高度调节互不干扰。

## ⑥ 既有能力回归核对
| 项 | 状态 |
|---|---|
| 横屏吸附 | `onConfigChanged()` 保持稳定（记录旧贴边侧 → `refreshScreen()` → 按新工作区重落位 → 重挂窗口），已核对 |
| 长按横向展开 | `applyOrbShape("bar")` 几何逻辑不变（原位 300dp，按所在半屏方向展开），已核对 |
| 40s 超时保护 | `busyWatch` 保持不变（`BUSY_TIMEOUT_MS=40s`，超时切换为「还没收到回复 · 切回本体可查看进度」），已核对 |
| 附件即时气泡 | `finishAttach()` → `echoAttachment()` 链路保持不变，同步升级消息 `id` 与加厚背板材质，已核对 |
| 消息 id 向后兼容 | 未传 `id` 时自动按内容派生，兼容旧版前端调用，已核对 |

---

# 把手拖拽方向修正（用户 21:15 真机反馈）

| | 公式 | 交互表现 |
|---|---|---|
| 改前 | `h = clamp(startH + dy, 30%, 80%)`，`dy = 当前rawY − 按下rawY` | 上拖（`dy<0`）变矮、下拖（`dy>0`）变高（方向相反） |
| 改后 | `h = clamp(startH − dy, 30%, 80%)` | **上拖变高、下拖变矮**（符合抽屉直觉） |

数值验算：设初始高度 `startH = 1400px`（50% 屏高），手指由 `rawY=2000` 向上拖至 `rawY=1800`（上移 200px），得 `dy=-200`、`h = 1400 - (-200) = 1600`（面板增高）；反之向下滑 200px 得 `dy=+200`、`h = 1200`（面板变矮），方向完全符合预期。

配套细节复核：
- **底边固定**：每次更新高度同步设置 `lp.y = screenH − 14dp内边距 − h`，使窗口顶边随手指上移自然伸展；位移直接基于屏幕绝对坐标 **`rawY`** 计算，避免窗口顶边移动造成视图内相对坐标 `e.y` 漂移；
- **松手持久化**：松手时记录高度比例 `panelRatio = lp.height / screenH`，下次 `panelParams()` 读取并限制在 30%–80% 区间；
- **面板态专属挂载**：`buildHandle()` 仅在 `buildPanel()` 中创建一次（侧边条、语音条与悬浮球均无把手），并以 5dp 独立视图配 8dp 底距置于顶栏上方、消息列表外部，与内容区滚动互不干扰。

回归验证：`onConfigChanged()`（横屏吸附）与 `applyOrbShape("bar")`（长按原位横向展开）保持原样未改动，`compileDebugKotlin` 编译结果 **BUILD SUCCESSFUL**。

---

# 把手拖拽热区与防抖优化（用户 21:52 反馈）

| 项 | 值 |
|---|---|
| **热区尺寸** | 视觉短条保持 **36×5dp**；**可拖拽热区扩展为全宽 × 36dp 容器**（短条居中，上下各留约 15.5dp 触控余量）。触摸监听挂载在外层**容器**上，按在顶部把手区域任意位置均可顺畅起拖 |
| **启动阈值** | 手指竖直位移 **> 2dp**（`HANDLE_SLOP_DP`）后进入拖拽态，并在**跨过阈值瞬间重设基准点**（`resizeStartH = 当前高`、`resizeDownY = 当前 rawY`），既过滤按压微抖，又消除起步瞬间的高度跳变 |
| **帧内原地更新** | 拖拽过程全程保持同一窗口与同一份 View 实例，仅更新 `lp.height/lp.y` 并调用 `wm.updateViewLayout(root, lp)`；偶发异常直接捕获忽略，保持窗口稳定挂载 |

配套核对：拖拽方向保持「上拖变高」（`h = startH − dy`，`dy = 当前rawY − 按下rawY`），底边固定（`lp.y = 屏高 − 14dp − h`）；跨过阈值进入拖拽态时触发一次轻触感反馈（`CLOCK_TICK`）；松手保存 `panelRatio = h/屏高`；把手容器仅在 `buildPanel()` 内创建，位于顶栏上方、消息 ScrollView 之外，与列表滚动手势完全隔离。
编译验证：`compileDebugKotlin` → **BUILD SUCCESSFUL**（仅 1 条已知 `SOFT_INPUT_ADJUST_RESIZE` deprecated 提示）。
