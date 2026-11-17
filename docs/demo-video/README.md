# OneTHU 宣传片 · 自动化演示流程（Demo Flow）

> 归档说明：本文记录宣传片自动化演示脚本（Demo Flow）的分镜设计与实拍流程；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

> 最后更新：2026-11-18 01:30

本文是一份**可直接照着执行**的拍摄剧本，涵盖分镜设计、节奏参数、环境准备、录制命令与后期剪辑衔接。自动化驱动脚本位于 `tools/demo-flow/`（`flow.mjs` 分镜驱动 + `cdp.mjs` 连接层）。

---

## 0. 设计原则（为什么这么做）

| 原则 | 落地方式 |
|---|---|
| **呼吸感节奏** | 每次转场或新页加载后停留 **1.5–2.0s**；同页动作之间采用 **220–420ms** 随机微抖动延迟，模拟自然的真人操作节奏。参数集中在 `flow.mjs` 的 `PACE` 中，修改一处即可整体调节快慢。 |
| **聚焦核心亮点** | 开场直入「今日概览」，第二镜即展示 **OH 一句话直达**（自然语言提问 → 结构化结果卡片），随后依次串联作业、成绩、校园卡与寻迹。 |
| **顺畅滑动轨迹** | 滚动与翻页采用**多段小步推进 + 末段平滑减速**（`scrollSteps/scrollMs`），过渡自然柔和，录屏帧率更稳定。 |
| **画面干净纯粹** | `--prep` 一键准备录制环境：开启勿扰、固定亮度、屏幕常亮、竖屏锁定、状态栏演示模式（时间 09:41 / 满电 / 满信号 / 隐藏通知），并冷启动回到首页。 |

**驱动方式**：基于 WebView **DevTools 协议**（CDP），通过 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 建立调试连接。相比依赖固定屏幕坐标或 `uiautomator` 无障碍树的方式，CDP 可直接读取渲染进程中的真实 DOM（文本、元素坐标与滚动偏移），并通过 `Input.dispatchMouseEvent` 派发可信点击事件，更换测试机型或调整系统字号后依然稳定可靠。

---

## 1. 分镜表

| # | 分镜 | 观众看到什么 | 主要动作 | 建议时长 |
|---|---|---|---|---|
| 1 | **开场：今日概览** | 课表、未交作业、近三日截止同屏；卡片排布与留白 | 首帧静置 → 下滚 380px → 静置 → 回滚 | 8–10s |
| 2 | **亮点：OH 一句话直达** | 灵动岛展开 → 逐字输入「明天图书馆哪有空座？」→ 结构化结果卡片出现 | 点胶囊 → 输入 → 回车 → 结果静置 2.6s | 12–14s |
| 3 | **作业：一屏管全部** | 网络学堂/雨课堂/OJ 合并后的状态分组；行内「忽略/提醒」 | 进入全部作业 → 下滚 560px → 静置 → 回滚 → 返回 | 12–14s |
| 4 | **信息页：成绩与考试** | 图表与统计（信息聚合的可视化美感） | 进入信息 → 成绩 → 下滚 → 静置 → 返回 | 10–12s |
| 5 | **生活页：校园卡余额与流水** | 余额大数字、近 30 天消费、逐笔流水（与桌面小组件同源） | 进入生活 → 校园卡 → 静置 2.1s → 下滚 → 返回 | 12–14s |
| 6 | **寻迹：日程在地图上串起来** | 带地点的今日日程 + 地图，「去哪、多久」 | 进入寻迹 → 静置 → 下滚 → 返回 | 10–12s |
| 7 | **收尾：桌面小组件** | 回到桌面，今日日程 / 校园卡小组件在应用之外继续工作 | 按 HOME → 静置 | 6–8s |

> 分镜 3–6 的入口文案（「全部作业」「信息」「成绩」「生活」「校园卡」「寻迹」）均设为 `optional`：不同布局或字号下入口位置可能变化，脚本按界面**文字**动态查找，未匹配到时自动跳过当前分镜并继续后续流程。补拍个别镜头时可用 `--scene=N` 单独重录，省去全片重拍的时间。

---

## 2. 环境准备（录制前执行一次）

```bash
node tools/demo-flow/flow.mjs --prep
```

该命令会自动完成以下初始化（部分定制 ROM 未支持的设置项会自动跳过）：

```bash
adb shell settings put global sysui_demo_allowed 1          # 允许状态栏演示模式
adb shell am broadcast -a com.android.systemui.demo -e command enter \
  -e time 0941 -e battery 100 -e battery_charging true \
  -e network wifi -e wifi show -e mobile hide -e notifications hide
adb shell settings put global zen_mode 1                    # 勿扰：挡掉通知横幅
adb shell settings put system screen_brightness 180         # 亮度固定，避免录制中跳动
adb shell settings put system accelerometer_rotation 0      # 竖屏锁定
adb shell svc power stayon true                             # 常亮
adb shell am force-stop app.onethu.demo && adb shell monkey -p app.onethu.demo -c android.intent.category.LAUNCHER 1
```

**开拍前人工复核（适配不同 ROM）**：确认画面无系统悬浮球、录屏悬浮窗、输入法候选条或系统更新弹窗；若状态栏仍显示真实时间或通知图标，可在该 ROM 上改用**沉浸式模式**隐藏状态栏：

```bash
adb shell settings put global policy_control immersive.status=app.onethu.demo   # 只藏状态栏
# 收尾：adb shell settings put global policy_control null
```

> 应用侧已通过插件 `applyContentInsets` 按**系统栏 inset** 动态垫好顶部内边距，无论状态栏处于常驻显示、隐藏还是沉浸式模式，页面顶栏都能保持整齐对齐。

---

## 2.5 设备改动的范围说明

- **常规运行保持现场**：`--all` 与 `--scene=N` 执行完毕后直接停留在当前页面，保持系统设置原样；如需回到桌面收尾，可显式加上 `--end-home`（分镜 7 自身已包含回桌面动作）。
- **`--prep` 专用于开录前初始化**：集中设置勿扰、固定亮度、常亮与竖屏锁，并通过 `force-stop` 冷启动应用回到首页；在正式开拍前执行一次即可，日常调试时无需调用，以免打断手机上正在前台使用的页面。
- **`--cleanup` 一键恢复日常设置**：退出演示模式、关闭勿扰并恢复屏幕自动旋转。
- **温和拉起应用**：若目标应用尚未启动，连接层会自动将其拉起；若已在运行则直接复用现有进程。

## 3. 录制

**首选 scrcpy**（画面实时可见、可随时结束，录制结果与预览完全一致）：

```bash
scrcpy --no-audio --max-size=1920 --max-fps=60 --bit-rate=24M \
       --stay-awake --window-title="OneTHU Demo" \
       --record=OneTHU-demo-$(date +%m%d-%H%M).mp4
```

- `--no-audio`：录制纯净画面，背景音乐与音效在后期剪辑中统一配入。
- `--max-size=1920 --max-fps=60`：将手机 1264×2800 画面等比缩放至 1080p 竖屏规格，并以 60fps 呈现丝滑滚动。
- `--stay-awake`：与 `svc power stayon` 配合保持屏幕常亮。

**备选方案**（未安装 scrcpy 时）：

```bash
adb shell screenrecord --size 1264x2800 --bit-rate 24M --time-limit 180 /sdcard/demo.mp4
adb pull /sdcard/demo.mp4 .
```

**推荐执行顺序**：

```bash
node tools/demo-flow/flow.mjs --prep          # 1. 环境初始化
scrcpy ... --record=demo.mp4 &                # 2. 开始录制
sleep 3                                       # 3. 预留 3 秒首页静置余量方便后期剪辑
node tools/demo-flow/flow.mjs --all           # 4. 自动运行全部分镜
# 5. 停止录制（Ctrl-C 结束 scrcpy）
node tools/demo-flow/flow.mjs --cleanup       # 6. 恢复手机日常设置
```

**剪辑节拍表**：每一步操作都会自动记录到 `/tmp/onethu-demo-beats.jsonl`（包含 `{t, scene, action, text, x, y}`），后期剪辑时可直接按时间戳精准对齐每一次点击与静置停顿：

```bash
# 把节拍表转成「分镜 → 起始秒」清单，直接当剪辑标记
node -e 'const l=require("fs").readFileSync("/tmp/onethu-demo-beats.jsonl","utf8").trim().split("\n").map(JSON.parse);
const t0=l[0].t; let cur="";
for(const r of l){ if(r.action==="分镜开始"){cur=r.title; console.log(((r.t-t0)/1000).toFixed(1)+"s  ▶ "+r.title);} }'
```

---

## 4. 剪辑建议

- **转场卡点**：每个分镜的「静置聚焦」段落都是自然的呼吸停顿点，建议将转场切点放在静置区间，让滑动过程保持连贯完整。
- **适度加速**：联网加载等待段（如 OH 生成结果、成绩页刷新）可在后期做 1.5× 加速，同时保留加载前后各 0.4s 原速过渡，观感更自然。
- **常用 ffmpeg 命令**：

```bash
# 裁掉开头预留余量
ffmpeg -ss 3 -i demo.mp4 -c copy demo-trim.mp4
# 竖向 1080×1920 规范化（保留整屏画面，两侧加黑边居中）
ffmpeg -i demo-trim.mp4 -vf "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -c:a none out.mp4
# 首尾 0.4s 淡入淡出
ffmpeg -i out.mp4 -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=29.6:d=0.4" -c:a none final.mp4
```

---

## 5. 数据与身份

- 推荐使用 **demo 包**（`app.onethu.demo`）进行录制：包内已内置脱敏处理（成绩、姓名、学号自动按演示口径替换），并且支持与正式版应用**同机并存**，与日常使用互不干扰。
- 开拍前请先登录一次 demo 包，依次打开首页、作业、成绩、校园卡等页面预热缓存，使正式录制全程呈现饱满的**热数据**画面，省去骨架屏等待。
- 多次补录时无需清除应用数据：`--prep` 仅执行进程冷启动，完整的登录态与本地缓存都会保留下来。

---

## 6. 已知问题与对应

| 现象 | 处理 |
|---|---|
| demo 版顶栏被状态栏压住 | 已修复：系统栏 inset 由插件自动注入为内容边距（`applyContentInsets`），各生成工程均已对齐 |
| 预览在 Windows 上白屏 | Windows 端文件内嵌预览暂未启用，界面直接提供「下载 / 另存为」操作入口 |
| ColorOS 上小组件放不上桌面 | 放置流程已统一为「先放置空白卡片、点击卡片完成配置」，ColorOS 桌面兼容性仍在持续适配 |
| 录到的页面是上次停留页 | 开录前运行 `--prep` 会执行 `force-stop` 并冷启动回到首页，确保分镜 1 从首页开始 |

---

## 7. 手动录制速查（纯人工操作备选）

> **测试机（Honor PPG-AN00，1264×2800 @560dpi）实测画面参数**：
> 状态栏高度 **135px**（`InsetsSource type=statusBars frame=[0,0][1264,135]`），
> 底部手势条 **78px**；纯净内容区尺寸为 **1264 × 2587 @ (0,135)**
> （与 CDP 实测 WebView 视口 `739dp × 3.5 = 2586.5px` 完全吻合）。

### 7.1 隐藏状态栏：三种方式（按稳妥程度排序）

**① scrcpy 裁剪录制（推荐，零系统设置改动）**

```bash
scrcpy --no-audio --max-size=1920 --max-fps=60 --bit-rate=24M --stay-awake \
       --crop=1264:2587:0:135 \
       --record=OneTHU-demo-$(date +%m%d-%H%M).mp4
```

`--crop=宽:高:x:y` 直接在录制流中裁去顶部 135px 状态栏与底部 78px 手势条，让成片画面只保留纯净的应用内容区，兼容所有机型与定制 ROM。

**② 沉浸式隐藏（修改系统设置，视 ROM 支持情况生效）**

```bash
adb shell settings put global policy_control immersive.status=app.onethu.demo
# 若无效试：immersive.full=app.onethu.demo
# 收尾：adb shell settings put global policy_control null
```

**③ 后期裁剪**

```bash
ffmpeg -i raw.mp4 -vf "crop=1264:2587:0:135" -c:a none cropped.mp4
```

### 7.2 一次性环境准备（手动录制前推荐执行）

```bash
# 状态栏演示模式：固定 09:41、满电、满信号、隐藏通知（保留状态栏时的整洁展示方案）
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter \
  -e time 0941 -e battery 100 -e battery_charging true \
  -e network wifi -e wifi show -e mobile hide -e notifications hide
adb shell settings put global zen_mode 1                    # 勿扰，挡通知横幅
adb shell settings put system screen_brightness_mode 0
adb shell settings put system screen_brightness 180         # 亮度固定
adb shell settings put system accelerometer_rotation 0 && adb shell settings put system user_rotation 0
adb shell svc power stayon true                             # 常亮
```

**收尾复位**：

```bash
adb shell am broadcast -a com.android.systemui.demo -e command exit
adb shell settings put global sysui_demo_allowed 0
adb shell settings put global zen_mode 0
adb shell settings put system accelerometer_rotation 1
adb shell svc power stayon false
```

### 7.3 手动操作节奏参考

| 分镜 | 手动动作 | 停留 |
|---|---|---|
| 1 今日概览 | 冷启动进首页 → 慢速下滚一屏 → 回滚 | 首屏 **3s**，每次滚动后 **2.5s** |
| 2 OH 直达 | 点底部胶囊 → 先在外部复制好问题文本，在应用内直接粘贴并回车（免去弹出键盘遮挡画面）→ 等待结果出现 | 展开后 1.5s，结果出现后 **2.5s** |
| 3 作业 | 首页点「未交作业」→ 滚一屏 → 返回 | 每屏 2s |
| 4 成绩 | 打开导航菜单 → 信息 → 成绩 → 滚一屏 | 2s |
| 5 校园卡 | 导航 → 生活 → 校园卡 → 滚一屏 | 余额卡停留 **2.5s** |
| 6 寻迹 | 导航 → 寻迹 → 滚一屏 | 2s |
| 7 收尾 | 回桌面（展示小组件） | 2.5s |

> **保持画面免受软键盘遮挡的小技巧**：① 使用 scrcpy 裁剪录制时，弹出软键盘仍会遮挡下半屏内容，建议尽量减少现场逐字输入；② 更省心的方式是提前在系统备忘录写好提问并复制，录制时在应用内长按输入框粘贴后直接回车。（自动化脚本通过 CDP 直接注入文本，全程保持无键盘纯净画面。）
