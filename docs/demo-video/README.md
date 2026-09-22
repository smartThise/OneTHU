# OneTHU 宣传片 · 自动化演示流程（Demo Flow）

> 最后更新：2026-09-22 22:59

本文是**可直接照着执行**的拍摄剧本：分镜、节奏参数、环境准备、录制命令、剪辑衔接。
执行体在 `tools/demo-flow/`（`flow.mjs` 分镜驱动 + `cdp.mjs` 连接层）。

---

## 0. 设计原则（为什么这么做）

| 原则 | 落地方式 |
|---|---|
| **呼吸感节奏** | 每次转场/新页加载后停 **1.5–2.0s**；同页动作之间 **220–420ms** 抖动延迟（不是固定值，避免机械感）。参数集中在 `flow.mjs` 的 `PACE`，改一处即可整体调快慢。 |
| **聚焦爽点** | 不从注册/授权/设置切入：开场即「今日概览」，第二镜就是 **OH 一句话直达**（自然语言 → 结构化结果卡片），随后作业、成绩、校园卡、寻迹。 |
| **顺畅轨迹** | 滚动/翻页用**多段小步 + 末段减速**（`scrollSteps/scrollMs`），避免骤停骤起，录屏帧率更稳。 |
| **画面纯净** | `--prep` 统一环境：勿扰、固定亮度、常亮、竖屏锁、状态栏演示模式（时间 09:41 / 满电 / 满信号 / 隐藏通知）、冷启动回首页。 |

**驱动方式**：WebView **DevTools 协议**（CDP）。原因：本应用 WebView 不向 uiautomator 暴露
可访问性节点（dump 出来只有一个空 WebView），而硬编码坐标换设备/换字号必崩。CDP 直接读渲染
进程里的真实 DOM（文字、坐标、滚动），点击走 `Input.dispatchMouseEvent`（可信事件）。
连接靠 `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`。

---

## 1. 分镜表

| # | 分镜 | 观众看到什么 | 主要动作 | 建议时长 |
|---|---|---|---|---|
| 1 | **开场：今日概览** | 课表、未交作业、近三日截止同屏；卡片排布与留白 | 首帧静置 → 下滚 380px → 静置 → 回滚 | 8–10s |
| 2 | **爽点：OH 一句话直达** | 灵动岛展开 → 逐字输入「明天图书馆哪有空座？」→ 结构化结果卡片出现 | 点胶囊 → 输入 → 回车 → 结果静置 2.6s | 12–14s |
| 3 | **作业：一屏管全部** | 网络学堂/雨课堂/OJ 合并后的状态分组；行内「忽略/提醒」 | 进入全部作业 → 下滚 560px → 静置 → 回滚 → 返回 | 12–14s |
| 4 | **信息页：成绩与考试** | 图表与统计（信息聚合的可视化美感） | 进入信息 → 成绩 → 下滚 → 静置 → 返回 | 10–12s |
| 5 | **生活页：校园卡余额与流水** | 余额大数字、近 30 天消费、逐笔流水（与桌面小组件同源） | 进入生活 → 校园卡 → 静置 2.1s → 下滚 → 返回 | 12–14s |
| 6 | **寻迹：日程在地图上串起来** | 带地点的今日日程 + 地图，「去哪、多久」 | 进入寻迹 → 静置 → 下滚 → 返回 | 10–12s |
| 7 | **收尾：桌面小组件** | 回到桌面，今日日程 / 校园卡小组件在应用之外继续工作 | 按 HOME → 静置 | 6–8s |

> 分镜 3–6 的入口文案（「全部作业」「信息」「成绩」「生活」「校园卡」「寻迹」）都写成
> `optional`：找不到就跳过而不是中断——不同布局/字号下入口位置会变，脚本按**文字**找。
> 开录前用 `--scene=N` 逐镜补录，比全片重录省时间。

---

## 2. 环境准备（录制前，一次）

```bash
node tools/demo-flow/flow.mjs --prep
```

它做这些事（个别 ROM 不支持会静默跳过）：

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

**手动确认（各 ROM 差异）**：没有悬浮球/录屏图标、没有输入法候选条、没有系统更新弹窗；
若状态栏仍显示真实时间或通知，说明该 ROM 不支持演示模式 → 退而求其次用**沉浸式**隐藏：

```bash
adb shell settings put global policy_control immersive.status=app.onethu.demo   # 只藏状态栏
# 收尾：adb shell settings put global policy_control null
```

> 应用侧已经按**系统栏 inset** 垫好内容 padding（插件 `applyContentInsets`），所以无论状态栏
> 显示、隐藏还是沉浸式，顶栏都不会被压住——这也是 demo 版此前被压住的那个 bug 的修复。

---

## 2.5 动设备的边界（重要）

- **默认什么都不动**：`--all` / `--scene=N` 跑完停在当前页面，不按 HOME、不改设置。
  需要回桌面收尾时才加 `--end-home`（分镜 7 自己会按 HOME）。
- **只有 `--prep` 会动系统**：改勿扰/亮度/常亮/方向锁 + `force-stop` 应用冷启动。
  录制前跑一次即可，日常别随手跑（正在用手机的人会觉得「应用被划走了」）。
- **`--cleanup` 复位**：退出演示模式、关勿扰、恢复自动旋转。
- 连接层在应用没起来时会**拉起**它（不会杀它）。

## 3. 录制

**首选 scrcpy**（实时可见、可直接停、录制与画面一致）：

```bash
scrcpy --no-audio --max-size=1920 --max-fps=60 --bit-rate=24M \
       --stay-awake --window-title="OneTHU Demo" \
       --record=OneTHU-demo-$(date +%m%d-%H%M).mp4
```

- `--no-audio`：应用演示不需要设备音频，BGM/音效在剪辑里加。
- `--max-size=1920 --max-fps=60`：手机 1264×2800 缩到 1080p 竖向，60fps 保证滑动顺滑。
- `--stay-awake`：与 `svc power stayon` 双保险。

**备选**（无 scrcpy 时）：

```bash
adb shell screenrecord --size 1264x2800 --bit-rate 24M --time-limit 180 /sdcard/demo.mp4
adb pull /sdcard/demo.mp4 .
```

**执行顺序**：

```bash
node tools/demo-flow/flow.mjs --prep          # 1. 环境
scrcpy ... --record=demo.mp4 &                # 2. 开始录
sleep 3                                       # 3. 留 3 秒黑场/首页静置给剪辑余量
node tools/demo-flow/flow.mjs --all           # 4. 跑分镜（脚本自己控制节奏）
# 5. 停止录制（Ctrl-C scrcpy）
node tools/demo-flow/flow.mjs --cleanup       # 6. 环境复位
```

**剪辑节拍表**：每次动作都写进 `/tmp/onethu-demo-beats.jsonl`（`{t, scene, action, text, x, y}`），
剪辑时按时间戳对齐——哪一秒点了什么、哪一秒开始静置，一目了然：

```bash
# 把节拍表转成「分镜 → 起始秒」清单，直接当剪辑标记
node -e 'const l=require("fs").readFileSync("/tmp/onethu-demo-beats.jsonl","utf8").trim().split("\n").map(JSON.parse);
const t0=l[0].t; let cur="";
for(const r of l){ if(r.action==="分镜开始"){cur=r.title; console.log(((r.t-t0)/1000).toFixed(1)+"s  ▶ "+r.title);} }'
```

---

## 4. 剪辑建议

- **卡点**：每个分镜的「静置聚焦」段就是天然停顿点，转场放在那里，别在滑动中间切。
- **加速**：联网加载段（OH 结果、成绩页）可以在剪辑里 1.5×，但要保留前后各 0.4s 原速。
- **常用 ffmpeg**：

```bash
# 裁掉开头黑场
ffmpeg -ss 3 -i demo.mp4 -c copy demo-trim.mp4
# 竖向 1080×1920 规范化（保留整屏，两侧不裁）
ffmpeg -i demo-trim.mp4 -vf "scale=1080:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -c:a none out.mp4
# 首尾 0.4s 淡入淡出
ffmpeg -i out.mp4 -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=29.6:d=0.4" -c:a none final.mp4
```

---

## 5. 数据与身份

- 用 **demo 包**（`app.onethu.demo`）录制：数据已脱敏（成绩/姓名/学号按口径替换），
  且与正式版**可同机共存**，不影响日常使用。
- 录制前登一次 demo 包并让它把数据拉全（首页、作业、成绩、校园卡各页各进一次），
  这样开录时是**热数据**，不会拍到骨架屏。
- 反复补录时不必清数据：`--prep` 只做冷启动，登录态与缓存都保留（清数据会导致未登录）。

---

## 6. 已知问题与对应

| 现象 | 处理 |
|---|---|
| demo 版顶栏被状态栏压住 | 已修：系统栏 inset 由插件垫成内容 padding（`applyContentInsets`），任何生成工程都对齐 |
| 预览在 Windows 上白屏 | 已知问题：Windows 文件预览暂不可用，界面直接给「下载 / 另存为」（不尝试渲染） |
| ColorOS 上小组件放不上桌面 | 已知问题：放置路径已统一为「先落空白卡片、点它再配置」，但 ColorOS 仍未通过 |
| 录到的页面是上次停留页 | `--prep` 会 `force-stop` 后冷启动；分镜 1 假设当前在首页 |


---

## 7. 手动录制速查（不想用自动脚本时）

> **这台测试机（Honor PPG-AN00，1264×2800 @560dpi）的实测数值**：
> 状态栏高 **135px**（`InsetsSource type=statusBars frame=[0,0][1264,135]`），
> 手势条 **78px**；内容区 = **1264 × 2587 @ (0,135)**。
> （与 CDP 量到的 WebView 视口 739dp × 3.5 = 2586.5px 互相印证。）

### 7.1 隐藏状态栏：三条路，按可靠性排序

**① scrcpy 裁剪录制（最稳，不改系统设置）**

```bash
scrcpy --no-audio --max-size=1920 --max-fps=60 --bit-rate=24M --stay-awake \
       --crop=1264:2587:0:135 \
       --record=OneTHU-demo-$(date +%m%d-%H%M).mp4
```

`--crop=宽:高:x:y`：裁掉顶部 135px 状态栏与底部 78px 手势条 → **成片里根本没有状态栏**，
不需要改任何系统设置，也不怕 ROM 不配合。

**② 沉浸式隐藏（改设置，部分 ROM 有效）**

```bash
adb shell settings put global policy_control immersive.status=app.onethu.demo
# 若无效试：immersive.full=app.onethu.demo
# 收尾：adb shell settings put global policy_control null
```

**③ 后期裁掉**

```bash
ffmpeg -i raw.mp4 -vf "crop=1264:2587:0:135" -c:a none cropped.mp4
```

### 7.2 一次性环境（手动，建议跑一遍）

```bash
# 状态栏演示模式：固定 09:41、满电、满信号、隐藏通知（不隐藏状态栏时的"体面版"）
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

### 7.3 手动操作时的节奏清单

| 分镜 | 手动动作 | 停留 |
|---|---|---|
| 1 今日概览 | 冷启动进首页 → 慢速下滚一屏 → 回滚 | 首屏 **3s**，每次滚动后 **2.5s** |
| 2 OH 直达 | 点底部胶囊 → **不点输入框**（避免键盘入镜）→ 直接用系统「粘贴」或先在外面写好再粘 → 回车 → 等结果出现 | 展开后 1.5s，结果出现后 **2.5s** |
| 3 作业 | 首页点「未交作业」→ 滚一屏 → 返回 | 每屏 2s |
| 4 成绩 | 打开导航菜单 → 信息 → 成绩 → 滚一屏 | 2s |
| 5 校园卡 | 导航 → 生活 → 校园卡 → 滚一屏 | 余额卡停留 **2.5s** |
| 6 寻迹 | 导航 → 寻迹 → 滚一屏 | 2s |
| 7 收尾 | 回桌面（展示小组件） | 2.5s |

> **避免键盘入镜的两条路**：① 用 scrcpy 裁剪时手动点输入框打字也没关系——键盘在**底部**，
> 但会挡住内容；② 更省事：先在备忘录里写好问题 → 复制 → 在应用里长按输入框粘贴 → 回车。
> （自动脚本走的是「不聚焦注入文字」，所以它从不弹键盘。）
