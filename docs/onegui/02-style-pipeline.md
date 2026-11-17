# 02 · 样式管线实测图（OneGUI 接管前的基线）


> 归档说明：本文记录 OneGUI 接管前的样式管线实测基线；0.11 当前功能与使用说明请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。


> 勘察范围覆盖 `packages/ui/src/*.css`、`apps/desktop/src/styles/*.css`、`apps/desktop/src/{state,lib,components}` 与 `tools/*.mjs`（排除 `node_modules`、`vendor` 与 `._*`）。
> 文中各项计数均为 2026-10-14 通过 `grep -ro` 与 `node tools/*.mjs` 实测所得。

## 0. 总量与文件清单

| 文件 | 行数 | 规则块 | 备注 |
|---|---:|---:|---|
| `apps/desktop/src/styles/global.css` | 8616 | 1753 | 单体巨石，占全仓 CSS 的 65% |
| `apps/desktop/src/styles/explorer-home.css` | 1003 | 179 | 由 `components/Layout.tsx:53` 引入 |
| `apps/desktop/src/styles/explorer-ui.css` | 941 | 195 | `components/Layout.tsx:52` |
| `apps/desktop/src/styles/motion.css` | 912 | 96 | `main.tsx:55` |
| `apps/desktop/src/styles/explorer.css` | 593 | 97 | `components/Layout.tsx:51` |
| `apps/desktop/src/styles/explorer-oh.css` | 484 | 72 | `plugins/ChatDock.tsx:44` |
| `packages/ui/src/tokens.css` | 263 | — | System + Compat 两层 |
| `packages/ui/src/palette.css` | 221 | — | Reference 层，生成物 |
| `apps/desktop/src/styles/glass-levels.css` | 112 | 6 | 玻璃四档 |
| `packages/ui/src/base.css` | 76 | — | reset + 滚动条 |
| **合计** | **13221** | **2398** | |

第三方 CSS 也进同一张表：`quill.snow.css`（`RichEditor.tsx:2` + `YktSubjectiveEditor.tsx:18`）、`leaflet.css`（`Trace.tsx:14`）。

---

## 1. 令牌层：Reference / System / Compat

### 1.1 三层各自定义了什么

| 层 | 文件 | 前缀 | 定义数 | 谁消费 |
|---|---|---|---:|---|
| Reference | `palette.css:7-158` | `--md-ref-palette-*` | **144**（6 族 × 24 档：primary / secondary / tertiary / neutral / neutral-variant / error，档位 0,4,6,10,12,17,20,22,24,30,40,50,60,70,80,87,90,92,94,95,96,98,99,100） | **0 处**。全仓无一处 `var(--md-ref-palette-*)` 真引用，只有 `tokens.css:13,53,54` 的注释示例。`token-guard` 把这 144 个单独归类输出「Reference 层预留 144 个 tone」 |
| System | `tokens.css:18-101`（亮）+ `:217-263`（暗） | `--md-sys-color-*` / `--md-sys-shape-*` / `--md-sys-typescale-*` / `--md-sys-elevation-*` / `--md-sys-state-opacity-disabled` / `--md-sys-focus-ring` | **79**（亮 45 + 暗 34） | 316 处（见 1.3） |
| Compat | `tokens.css:108-206` | `--bg` `--surface*` `--border*` `--text-*` `--primary*` `--accent*` `--red/amber/green*` `--hover/--active` `--elev-*` `--shadow-*` `--ring` `--font-*` `--text-{xxs,xs,sm,base,md,lg,xl}` `--gap-{1..6}` `--r-*` `--sidebar-w` | **56 个唯一名 / 59 条声明** | 1919 处（见 1.3） |
| 别名 | `tokens.css:112-120` | `--dsw-alias-*` | 9（`bg-base` `bg-layer-1/2` `border-l1/l2` `label-primary/secondary` `brand-primary` `state-error-primary`） | 样式表 34 处 + TSX 43 处（见 §8 风险 7） |

### 1.2 层的纪律（`tokens.css:9-14`）

① 组件样式统一引用 Compat 旧名或 System 名，避免直接写入颜色字面量；② 调整视觉外观修改令牌文件，调整结构修改组件；
③ System 层初始值直接对齐「改造前实测值」基线，确保底层令牌重构前后观感平滑一致。

### 1.3 应用实际消费的令牌层（实测引用数）

| 消费面 | `var()` 总数 | Compat | System(`--md-sys-*`) | Reference | 玻璃令牌(`--glass-*`/`--lg-*`) | 动效令牌(`--dur-*`/`--ease-*`/…) |
|---|---:|---:|---:|---:|---:|---:|
| `apps/desktop/src/styles/*.css` | **3079** | **1919 (62%)** | **316 (10%)** | 0 | **443 (14%)** | 266 |
| `apps/desktop/src/**/*.{ts,tsx}` | **713** | ~560 (79%) | 18 (3%) | 0 | ~30 | ~60 |
| `packages/ui/src/*.css` | 内部互引（`--surface → --glass-card-fill` 等） | — | — | 0 | — | 0 |

**小结：当时样式管线的主力仍是 Compat 层**，System 层先行在已迁移组件（按钮、chip、开关、弹窗、滚动条）中小范围生效。
分文件看迁移梯度：

| 文件 | System 引用 | Compat 引用 | 玻璃引用 | 迁移度 |
|---|---:|---:|---:|---|
| `global.css` | 263 | 1561 | 191 | 新组件走 System，老区块仍 Compat |
| `explorer-ui.css` | 18 | 75 | 57 | 半迁 |
| `explorer.css` | 11 | 41 | 42 | 半迁 |
| `explorer-home.css` | 6 | 169 | 97 | 几乎全 Compat |
| `explorer-oh.css` | 2 | 58 | 52 | 几乎全 Compat |
| `motion.css` | 16 | 15 | 1 | 只引动效 System 名 |

Compat 层最热的名字（`styles/*.css` 内）：`--text-3` 244、`--border` 140、`--accent` 146、`--text-1` 195、
`--r-pill` 67、`--border-soft` 59、`--surface-2` 51、`--r-md` 50、`--surface-3` 49、`--surface` 46、
`--accent-soft` 46、`--red` 46、`--accent-border` 43。
**暂未引用的存量令牌：** `--elev-1/2/3`、`--gap-5`、`--gap-6`、`--primary-hover`、`--r-xs`(1)、`--text-dim`(5)。

### 1.4 已知的令牌层缺陷（OneGUI 必须先修）

| 缺陷 | 位置 | 后果 |
|---|---|---|
| **`--surface` / `--surface-2` / `--surface-3` 在同一个 `:root` 里各声明两次**，后声明覆盖前者 | `tokens.css:126-128` 指向 `--glass-card-fill*`，`tokens.css:130-132` 又指回 `--md-sys-color-surface-container-*` | 2026-10-13 规划的「Compat 表面映射玻璃 tint」被后声明覆盖，实际玻璃效果依赖 `global.css:8196-8199` 将 System 四个 container 名重写为 rgba 来维持 |
| 表面填充同时存在**三个维护源**：`tokens.css`、`global.css:8196-8199`、`glass-levels.css:5-19` | — | `state/theme.ts:270-272` 需要通过 `SURFACE_FAMILY` 黑名单拦截这 5 个名字的主题注入，三处各自改写同一族表面变量 |
| `--md-sys-typescale-*` 只有 5 个**无后缀**名（`display/headline/title/body/label`），消费端却写 `--md-sys-typescale-headline-medium-size` / `-label-medium-size` | 定义 `tokens.css:97-101`；引用 `global.css`（3+2 处） | 全靠 `var(--x, 28px)` 的 fallback 兜住，`token-guard` 归入「可选(带 fallback) 92 个」 |
| `--danger` 未单独定义 | `tokens.css:120` `--dsw-alias-state-error-primary: var(--danger, #e5484d)` | 依赖默认值兜底生效 |
| 本地私有令牌 98 个（`--ctl-*` `--fog-core` `--ws-color` `--home-*` `--explorer-bar-h` `--glass-*`）散落在 `global.css` / `explorer.css:7-13`，游离在三层体系之外 | — | `token-guard` 仅校验变量是否已定义，尚未约束其分层归属 |

---

## 2. 玻璃档位：`styles/glass-levels.css` 全解剖

### 2.1 档位与选择器

档名来自 `lib/glassLevel.ts:10`：`clear | balanced | rich | deep`（中文「清透 / 均衡 / 浓郁 / 极致」）。
**`balanced` 作为默认基座，直接沿用根级默认值而省略属性挂载**（`glassLevel.ts:47-52`：`level === "balanced"` 时 `delete root.dataset.glass`），
所以 `glass-levels.css` 只有 3 个档 × 明暗 2 = **6 个选择器块**：

| 选择器 | 行 | 生效条件 |
|---|---|---|
| `html[data-glass="clear"]` | `:4` | 亮色 |
| `html[data-glass="clear"][data-scheme="dark"]` | `:23` | 暗色 |
| `html[data-glass="rich"]` | `:41` | 亮色 |
| `html[data-glass="rich"][data-scheme="dark"]` | `:59` | 暗色 |
| `html[data-glass="deep"]` | `:76` | 亮色 |
| `html[data-glass="deep"][data-scheme="dark"]` | `:95` | 暗色 |

**双轴**：`data-glass`（程度，由 `lib/glassLevel.ts` 独占写）+ `data-scheme`（明暗，由 `state/theme.ts:488` 与
`lib/dynamicColor.ts:syncScheme()` 写）。`data-wallpaper-lum` 独立于玻璃档位，专门驱动 `explorer.css:295-412`
的栏体文字色分支。

### 2.2 每档定义的全部令牌（共 21 个名字）

`clear` 亮色块定义 16 条：`--surface` `--surface-2` `--surface-3` `--dsw-alias-bg-base` `--glass-{fill,fill-regular,tint,menu-fill,menu-blur,chip-blur,panel-blur,card-fill,card-fill-2,card-fill-3,shadow}`
`--lg-blur-clear`。`rich`/`deep` 亮色块与三档暗色块额外写 4 个 `--md-sys-color-surface-container-*`
（`:53-56` `:89-92` `:35-38` `:71-74` `:108-111`）。

| 令牌 | clear 亮/暗 | rich 亮/暗 | deep 亮/暗 | 语义 |
|---|---|---|---|---|
| `--surface` | .30 / .06 | .60 / .14 | .20 / .20 | 三级面（→ `--glass-card-fill` 家族） |
| `--surface-2` | .30 / .06 | .60 / .14 | **.74** / .20 | 注意 deep 亮色 `.74` 是反向跳档 |
| `--surface-3` | .30 / .06 | .60 / .14 | .74 / .20 | — |
| `--glass-card-fill` | .30 / .06 | .60 / .14 | .74 / .20 | 卡片面 |
| `--glass-card-fill-2` | .30 / .06 | .60 / .14 | **.20** / .20 | 二级卡面（deep 亮色贴底） |
| `--glass-card-fill-3` | .30 / .06 | .60 / .14 | .74 / .20 | **样式表 0 处引用** |
| `--glass-menu-fill` | .30 / .06 | .60 / .14 | .74 / .20 | 菜单/浮层 |
| `--glass-fill` | .30 / .06 | .60 / .14 | .20 / .20 | 通用填充 |
| `--glass-fill-regular` | .30 / .06 | .60 / .14 | .74 / .20 | 常规填充 |
| `--glass-tint` | .26 / .04 | .40 / .08 | .64 / .10 | 叠色 tint |
| `--glass-shadow` | 有 / 有 | **无**（沿用基座）/ **无** | 有 / 有 | 只有 clear/deep 覆盖 |
| `--glass-menu-blur` `--glass-chip-blur` `--glass-panel-blur` | 只在 clear 覆写（22/20/20px） | — | — | 其余档沿用 `global.css:8165,8170,8171` |
| `--lg-blur-clear` | clear 覆写 | — | — | 命名与档位错位（`clear` 名却给 clear 档用） |
| `--md-sys-color-surface-container{,-low,-high,-lowest}` | 暗 .06 | 双档 .60/.14 | 双档 .74/.20 | **档位块直接覆写了 System 名** |

### 2.3 每个令牌的消费者（按文件，`var()` 引用数）

| 令牌 | global.css | explorer-home | explorer-ui | explorer | explorer-oh | motion | 合计 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `--glass-rim-top` | 23 | 11 | 9 | 4 | 6 | — | 53 |
| `--glass-menu-blur` | 24 | 10 | 10 | 8 | — | — | 52 |
| `--glass-chip-blur` | 19 | 12 | 4 | 2 | 8 | — | 45 |
| `--glass-border` | 11 | 9 | 4 | 3 | 8 | — | 35 |
| `--glass-shadow` | 13 | 8 | 6 | 5 | 3 | — | 35 |
| `--glass-panel-blur` | 14 | 2 | — | — | 4 | — | 20 |
| `--glass-menu-fill` | 6 | 5 | 5 | 4 | — | — | 20 |
| `--glass-card-fill-2` | 5 | 2 | — | 5 | — | — | 12 |
| `--lg-blur-clear` | 4 | 4 | — | 2 | — | — | 10 |
| `--glass-fill-regular` | 3 | 2 | 1 | — | 3 | — | 9 |
| `--glass-refract` | 4 | — | — | — | — | — | 4（+ 定义 3 处） |
| `--glass-tint` | 1 | — | 1 | 1 | — | — | 3 |
| `--glass-fill` | — | — | — | — | 1 | — | 1 |
| `--glass-card-fill` | — | — | — | 1 | — | — | 1 |
| `--glass-card-fill-3` | — | — | — | — | — | — | **0** |
| `--surface`（=档位） | 22 | 9 | 7 | 1 | 6 | 1 | 46 |
| `--surface-2` | 49 | 2 | — | — | — | — | 51 |
| `--surface-3` | 39 | 7 | 1 | 2 | — | — | 49 |
| `--md-sys-color-surface-container-lowest` | 65 | — | 5 | — | 1 | — | 71 |
| `--dsw-alias-bg-base` | — | — | — | — | — | — | **0**（仅在档位块内赋值，暂无读取处） |

### 2.4 冲突源

`explorer.css` 另有一个 `:root` 块（`:7`，定义 `--explorer-bar-h: 48px` 等）加 **6 个按 `[data-wallpaper-lum]`
分支的作用域令牌块**（`:295` `:325` `:356` `:375` `:557` `:565`）+ 2 个 `[data-scheme]` 分支（`:574` `:584`），
重新定义 `--glass-tint` `--glass-border` `--glass-rim-*` `--text-*` `--md-sys-color-*` `--border*` `--hover`。
它们作用域挂在 `.explorer-shell` 上，**特异性高于 `html[data-glass]` 与 `:root`**，因此栏体与程序坞区域保持独立数值，
未随玻璃档位联动。`explorer.css:376-378` 的注释记录过一次同类问题：「此前写死 .44 导致程序坞在 clear/rich/deep 档下不跟档」。

---

## 3. 主题管线：`state/theme.ts`（706 行）

### 3.1 形态

主题 = 插件（`manifest.category === "theme"`），模块导出 `ThemeDef`（`theme.ts:17-39`）。
职责边界：**专注于令牌覆盖**，保持结构与布局稳定（`theme.ts:5-7`）。

| 字段 | 作用 |
|---|---|
| `vars` | Compat 令牌覆盖，**允许任意 `--x` 键**（只校验 `/^--[\w-]+$/`，`theme.ts:462`） |
| `fonts.{ui,mono}` | 追加 `--font-ui` / `--font-mono`（`:469-470`） |
| `css` | **受信任意 CSS**，原样拼在注入样式尾部（`:474`） |
| `dark` | 声明暗色：`color-scheme: dark` + `data-scheme="dark"`（`:485-489`） |
| `logo` | 内联 SVG，只存快照给 UI 用（`:490`） |
| `source` / `owner` | `builtin` / `plugin`，插件卸载时按 owner 回收（`removePluginThemes`, `:656-666`） |

### 3.2 注入路径

```
bootstrap()  :350-400  localStorage("onethu.theme.v1") → 播种/升级内置主题 → applyActive()
applyActive():495-501  followSystem ? (systemDark ? night : day) : activeId → applyTheme(def)
applyTheme() :440-492  ① data-dynamic="on" → 直接 return（取色优先）  ② <html> 挂 .theme-anim（420ms）
                       ③ 拼 CSS 文本 → <style id="onethu-theme-style">  ④ head.appendChild(style) ← 每次重挪末尾（:481）
                       ⑤ root.dataset.theme = def.id / root.style.colorScheme
                       ⑥ def.dark ? root.dataset.scheme="dark" : delete root.dataset.scheme
```

**注入选择器：`:root[data-theme="<id>"]`（特异性 0,2,0）**，`theme.ts:471-473` 明确注释：靠特异性稳压
`tokens.css` 的 `:root`（0,1,0），因为「平级时输赢取决于文档顺序，vite 样式注入顺序不可依赖」。

### 3.3 Compat → System 镜像

`COMPAT_TO_SYSTEM`（`theme.ts:274-316`）把每条 Compat 覆盖**同时写两份**（`:465-467`）：`--text-1: X` 与
`--md-sys-color-on-surface: X`。表里 39 条映射，由 `tools/theme-system-test.mjs` 从 `tokens.css` 反解核对，
漂移即红。**但镜像对 `--surface` 家族被禁用**（`SURFACE_FAMILY`, `:270-272`）——表面填充归玻璃档独占。

### 3.4 内置主题 7 个

| id | 名字 | dark | vars 条数 | 附加 css |
|---|---|---|---:|---|
| `onethu.theme.ivory` | 象牙·默认 | – | 0 | – |
| `onethu.theme.violet` | 紫水晶 | – | 15 | – |
| `onethu.theme.tsinghua` | 清华紫 | – | 24 | –（也是取色降级目标，`dynamicColor.ts:26`） |
| `onethu.theme.celadon` | 青瓷 | – | 15 | – |
| `onethu.theme.warmsand` | 暖沙 | – | 8 | – |
| `onethu.theme.midnight` | 墨蓝夜航 | – | 15 | – |
| `onethu.theme.night` | 凝夜 | ✔ | 26 | 3 条定点补丁（`:242-245`） |

内置升级通道（`:382-398`）：版本号**或**令牌集不一致就整体刷新为随包定义。
另有**用户生成主题**走完全不同的路：`state/userext.ts:349-373` 自建 `<style id="onethu.usergen-theme">`，
选择器是裸 `:root`（**没有 `[data-theme]` 加成**），靠 `head.appendChild` 压轴 + `:383` 监听 `data-theme` 变化重挂。

### 3.5 谁决定 `data-scheme`

| 写入方 | 位置 | 条件 |
|---|---|---|
| `state/theme.ts:488-489` | 主题应用时 | `def.dark === true` → `"dark"`，否则删属性 |
| `lib/dynamicColor.ts:syncScheme()` | 取色模式 | 取色开启期间由 `prefers-color-scheme` 驱动（主题已让位） |
| `tokens.css:217` | 消费方 | `:root[data-scheme="dark"]` 提供 34 条 System 暗色基线 |
| `lib/textContrast.ts:386` | 观察方 | `MutationObserver` 监听 `["data-scheme","data-glass","data-wallpaper-lum"]` |
| `state/userext.ts:384` | 观察方 | 监听 `["data-theme","data-scheme"]` |
| `components/exthw/ProblemBody.tsx:252` | 观察方 | 监听 `["data-theme","style","class"]` + `#onethu-theme-style` 的 characterData |

**昼夜调度**（`:494-501` `:504-517` `:568-582`）：`followSystem` 为真时按 `matchMedia("(prefers-color-scheme: dark)")`
在 `dayThemeId`/`nightThemeId` 之间切；这是**主题级**昼夜，与 `data-scheme` 的 System 暗色套是两条并行通道。

---

## 4. 对比度引擎：`lib/textContrast.ts`（390 行）

### 4.1 机制

| 项 | 值 | 位置 |
|---|---|---|
| 壁纸离屏采样 | canvas，8px 网格（`CELL=8`），瓦片亮度缓存 96px（`TILE`） | `:17-18` `:102-115` |
| 单轮新增叶子预算 | 4000（`NODE_BUDGET`） | `:19` |
| 达标线 | 对比率 ≥ 3.0（`MIN_CONTRAST`） | `:20` |
| 候选色 | 白 `rgba(255,255,255,.95)` / 黑 `rgba(20,22,28,.94)` | `:196-197` |
| 触发 | **首次进入视口**（`IntersectionObserver`，`threshold: 0.01`） | `:342-353` |
| 重取 | 仅 wall / theme / glass-level 三类显式环境变更 | `:355-367` `:233-234` |

### 4.2 它改什么 DOM

引擎直接写入内联 `style="color: …"`，并配合 `data-*` 属性记录幂等标记：

| 标记 | 语义 | 位置 |
|---|---|---|
| `el.style.setProperty("color", …)` + `data-tx="lock"` | 文本叶子已定格 | `:228-229` |
| `el.style.setProperty("color", …)` + `data-txi="lock"` | 图标宿主已定格（SVG 继承 `currentColor`） | `:281-282` |
| `[data-tx="keep"]` | 豁免标记：子树保持原色，跳过自动重算 | `:206` `:252` `:297` |
| 重取时 `style.removeProperty("color")` | 摘掉旧内联色再重算 | `:218-221` `:271-275` `:302-309` |

图标单独分流在 `settleIcon()`（`:248-284`）：`:262` 把 `cr>240 || cr<24` 判为「近极端色 = 隐形笔画本身」，
即使对比度达标也强制重算。这是 2026-10-14 用户点名「很多 icon 没有颜色变深导致看不见」的补丁。

### 4.3 环境耦合（最脆弱的部分）

| 硬编码依赖 | 行 | 说明 |
|---|---|---|
| `.explorer-shell` | `:179` `:287` `:321` | 只扫这个根，其他根（portal 到 body 的浮层）拿不到 |
| `.explorer-shell[data-wallpaper-lum]` | `:180-185` | 纱的提白/压黑比例 0.34 / 0.36 写死 |
| `.explorer-content` + 排除 `.explorer-topbar, .ex-rail, .ex-bbar, .ex-mobile-strip, .home-chrome-layer` | `:184` | 页类名单写进引擎 |
| `.wall-video-veil`；沿祖先链最多 40 跳（`hop < 40`） | `:153` `:141` | 视频纱硬编码 `rgba(0,0,0,0.2)`；超深树漏算 |

### 4.4 已知失败模式（注释里写明的历史事故）

| 事故 | 注释位置 |
|---|---|
| 用 `bg < 0.5` 当黑白分界是错的（0.5 是中灰，交叉点 L≈0.179）→ 首页时钟/OneGO! 白字压 L=0.352 底只有 2.33:1 | `:224-226` |
| 旧实现从 `parentElement` 起收集玻璃层 → 漏掉元素自身的玻璃底 → 误判「底很亮」→ 写白字 | `:142-143` |
| 只匹配 `rgba()`，hex 停靠点整片漏掉（gel token 的 tint 渐变里就有） | `:150-151` |
| 首版滚动触发重算 = 「乱闪的根源」，已删 | `:11-12` `:234` |
| 只监听 `style` 属性会自触发死循环 → `attributeFilter` 收窄到 3 个 data 属性 | `:385-386` |

### 4.5 测试工具

仓库中当时尚无 `tools/*contrast*` 专项测试；相近脚本仅有 `dynamic-color-test.mjs`（测 `rolesFromPalette` 映射）、
`theme-scheme-test.mjs`、`theme-vars-test.mjs`、`dynamic-flow-test.mjs`，`textContrast.ts` 本身仍待补充自动化守卫。

---

## 5. 动效层

### 5.1 `styles/motion.css`（912 行，96 规则，25 个 `@keyframes`）

| 区块 | 内容 |
|---|---|
| §1 令牌 | `:16-51`，22 个 |
| §2 reduced-motion | `:56-66`，全局 `*` 强制 `animation-duration: 1ms !important` 等 5 条 `!important` |
| §3 keyframes | `m-grid-in` `m-rise` `m-fade` `m-pop` `m-spring-in` `m-sheet-up/down` `m-slide-right/left` `m-toast-in/out` `m-page-in` `m-check-draw` `m-breathe` `m-stripes` `m-knob` `m-focus-ring` `m-page-in-back` `m-tab-in` `m-tab-in-back` `m-reveal-in` `m-expand-in` `m-fade-out` `m-spring-out` 等 25 个 |
| §4-§16 | 微交互 / hover 悬浮 / stagger / 页面转场 / 弹层 / toast / 骨架 / 数字滚动 / 工具类 / theme-anim / 滚动条 / 预览 / 揭示 |

### 5.2 令牌集

| System（`:20-30`，11 个） | Compat（`:34-51`，11 个） |
|---|---|
| `--md-sys-motion-easing-{emphasized, emphasized-decelerate, emphasized-accelerate, standard, standard-decelerate, standard-accelerate}` | `--ease-out`（→ emphasized-decelerate）、`--ease-in-out`（→ standard）、`--ease-ios`（→ emphasized）、`--ease-spring` = `cubic-bezier(0.34,1.34,0.5,1)`（自定义品牌弹性曲线） |
| `--md-sys-motion-duration-{short-2:100, short-4:200, medium-2:300, medium-4:400, long-2:500}` | `--dur-1: 140ms`（独立设定，确保按压反馈即时响应）、`--dur-2`→short-4、`--dur-3`→medium-2、`--dur-4`→long-2 |
| — | `--rise-1/2/3` = 4/8/14px、`--stagger: 26ms` |

消费数（`styles/*.css` / TSX）：`--dur-2` 83/22、`--ease-out` 75/23、`--dur-3` 37/12、`--dur-1` 28/0、
`--stagger` 15/0、`--ease-spring` 14/1、`--ease-ios` 10/2、`--dur-4` 2/0、`--rise-2` 1/0、
`--rise-1` `--rise-3` **0**（未引用）。

### 5.3 类名词汇（`m-*` 为 `@keyframes` 名称）

| 家族 | 形态 | 实例数 | 用途 |
|---|---|---:|---|
| `m-*` | **`@keyframes` 动画名**（供 `animation` 属性直接调用） | 25 个定义；CSS 侧 22 处 `animation: m-*` 引用，TSX 侧 38 处字符串引用（`m-spring-in` 10、`m-fade` 9、`m-fade-out` 6、`m-pop-out` 4、`m-rise` 3…） | 组件用内联 `style={{animation: "m-pop .2s …"}}` 或类名挂 |
| `anim-*` | utility 类（`.anim-rise` `.anim-fade` `.anim-pop` `.anim-spring` `.anim-slide-right` `.anim-delay-1..4`） | **0 处 TSX 使用** | 未被业务引用的工具类；TSX 仅出现 3 次分支名字符串 `anim-delight` |
| 状态类 | `.is-closing` / `.is-open` / `.is-scrolled` / `.is-ready` | 大量 | 退场相位由 `lib/useExitPhase.ts` 打 `.is-closing` |

### 5.4 reduced-motion 与 JS 侧

- CSS：`motion.css:56-66` 全局 `!important` 降级（1ms + `scroll-behavior: auto`）。
- JS：`lib/motion.ts:9-11` `prefersReducedMotion()`；`:88` `installScrollReveal()` 在 `html` 挂 `has-reveal` 类（`motion.css:678,685` 依赖它），减弱动态时不挂。`components/Ripple.tsx` 同检查。
- `lib/motion.ts` 还持有**导航指示器物理常量**：`NAV_DUR_MIN/MAX/SLOPE`、`NAV_APEX`、`NAV_BOUNCE_MS`、`NAV_EASE`、`useNavIndicator()`（`:297`）、`useBottomNavPill()`（`:457`），底栏胶囊与侧栏蓝条共用；`nav-shell-test.mjs` 钉复用。
- 另有一个**未被 `pnpm guard` 调用的** `tools/motion-test.mjs`。

---

## 6. 样式如何进入应用

### 6.1 import 顺序（唯一的确定性来源是 `main.tsx`）

| 序 | 语句 | 行 |
|---:|---|---|
| 1 | `import "@onethu/ui/tokens.css"` | `main.tsx:39` |
| 2 | `import { initGlassLevel }` → `initGlassLevel()`（写 `data-glass`） | `:48-49` |
| 3 | `import "@onethu/ui/base.css"` | `:50` |
| 4 | `import "./styles/global.css"` | `:51` |
| 5 | `import "./styles/glass-levels.css"` | `:52` |
| 6 | `import "./styles/motion.css"` | `:55`（注释：必须在 global 之后，否则同选择器的 transition 被覆盖） |
| 7 | `installScrollReveal(); installTextContrast(); installRipple();` | `:31-35`（函数在 import 之前就被调用，靠 ESM 提升 + 模块求值序） |
| 8 | `initDynamicColor(); watchDynamicColor();` | `:83-84`（注释：放在 CSS 导入之后，注入 `<style>` 要插在令牌之后） |

**其余 4 个应用样式文件由业务组件按需引入**，因此实际注入次序取决于模块图的求值顺序：

| 文件 | 引入点 |
|---|---|
| `explorer.css` | `components/Layout.tsx:51` |
| `explorer-ui.css` | `components/Layout.tsx:52`（文件头注释自称「本文件在 explorer.css 之后加载」） |
| `explorer-home.css` | `components/Layout.tsx:53` |
| `explorer-oh.css` | `plugins/ChatDock.tsx:44`（注释：悬浮球窗口同 bundle，一处引入两端生效） |
| `quill.snow.css` | `components/RichEditor.tsx:2`、`components/exthw/YktSubjectiveEditor.tsx:18` |
| `leaflet.css` | `pages/Trace.tsx:14` |

`packages/ui/src/tokens.css:16` 是全仓唯一的 CSS `@import`（引 `palette.css`）。

### 6.2 运行时 `<style>` 注入站点

| id | 写入方 | 选择器 / 内容 | 特异性 |
|---|---|---|---|
| `onethu-theme-style` | `state/theme.ts:450-481` | `:root[data-theme="<id>"]{…}` + 主题附加 CSS | (0,2,0) |
| `onethu-dynamic-color` | `lib/dynamicColor.ts:93-101` | `html:root[data-dynamic="on"]{…}` + `[data-scheme="dark"]{…}` | **(0,2,1)** ← 最高 |
| `onethu.usergen-theme` | `state/userext.ts:362-368` | 裸 `:root{…}`，appendChild 压轴 | (0,1,0) 但**文档序最后** |
| （插件 CSS） | `plugins/loader.ts:233-236` | 插件注入的全局样式，停用即移除 | 未限定 |
| `<style>{DOCX_CSS}</style>` | `components/FilePreview.tsx:1435` | 组件内联 | 文档序最末 |
| `<style>{ORB_KEYFRAMES}</style>` | `components/GlobalOrb.tsx:371,431` | 关键帧 | — |
| `<style>{SHEET_CSS}</style>` | `components/AttachActionsSheet.tsx:432` | 弹层 CSS | — |
| `<style>{TRAY_CSS}</style>` | `components/AttachTray.tsx:152` | — | — |
| `<style>{SHEET_CSS}</style>` | `components/ImageFilterSheet.tsx:200` | — | — |
| `<style>{BODY_STYLE}</style>` | `pages/ThubookPage.tsx:223` | — | — |
| `<style>`（srcDoc 内联） | `pages/MailPage.tsx:133` | iframe 内滚动条 + 正文样式（父页样式进不了独立文档） | — |
| `<style>{latexBundle.inlineCss}</style>` | `components/exthw/YktSubjectiveEditor.tsx:391` | — | — |
| `srcdoc` 拼 `<style>` | `lib/yktBody.ts:664` | 作业正文独立文档（`:461` 有净化说明） | — |

`index.html:13-22` 另有一个全局 SVG `#dsh-liquid-refract` 滤镜（`feTurbulence` 位移图），被
`global.css:8164` 的 `--glass-refract: url(#dsh-liquid-refract)` 引用 —— **运行时玻璃折射效果依赖这处定义在 HTML 入口内的滤镜节点。**

---

## 7. 护栏工具逐个体检

14 个**全部**在 `pnpm guard` 里（`guard` 脚本按固定顺序串跑 **49 个** mjs + desktop typecheck）；`pnpm lint:style` 只跑 `style-scan.mjs`。

| 工具 | 锁的不变量 | 找目标的方式 | 在 guard | 组件库化改造难度 |
|---|---|---|---|---|
| `tools/token-guard.mjs`（98 行） | ① 所有 `var(--x)` 引用都有定义；② Compat 旧名不得漏迁；③ **CSS 注释不得嵌套**（曾让 vite 报 Unknown word） | 遍历 `apps/desktop/src` + `packages/ui/src` 的 `.css/.tsx/.ts`，正则扫 `(--x)\s*:` 建定义集、`var(--x[,])` 建引用集；TSX 里 `"--x":` 与模板串 `--x:` 记为「运行时注入」 | ✔ 第 1 位 | **低**。组件库只是把「组件目录」换个位置，正则不变即可继续用 |
| `tools/style-scan.mjs`（127 行） | 4pt 间距网格 + 字阶只准 12/14/16/20/24；按 `文件+违规值→数量` 记 ratchet 基线，只拦新增 | 正则遍历 `packages/ui/src` + `apps/desktop/src/styles` 的 `padding/margin/gap/*-{top,right,…}` 与 `font-size` 声明，跳过 `var()/calc()/%/em` | ✔ 第 4 位（`--write-baseline` 可写基线） | **中**。基线是「按 CSS 文件 + 字面值」，组件库落地会**整体置换文件名**：老基线全失效 → 需要一次性的「基线重播种 + 人工过一遍」 |
| `tools/card-layers-test.mjs`（108 行） | ① `base.css` 的 `body` 必须是 `container-low`、不得等于 `--bg`；② 9 类卡片底色=色块+形状令牌、无可见描边、无阴影、不借 `--elev-3`；③ hover 必须走 `.btn::after` 共享状态层且不得改描边/底色；④ 4 个「未迁移」类必须真实存在 | 纯正则读 `global.css` 与 `base.css` 文本，`block(src, selector)` 用大括号配对切规则体 | ✔ | **高**。9 类卡片全是**页级类名**（`.home-card` `.plg-stat` `.app-card` `.week-course` `.mail-list`…）。组件库会把这些名字换成 `.og-card` 等统一类，届时需同步改写为面向组件 API 的断言 |
| `tools/controls-test.mjs`（84 行） | 胶囊一套几何（`.chip-btn` 高 24px、禁字面 `999px`、禁 Compat 底色）、开关两实现归一（`.switch`/`.plg-switch` 同 36×22、同走 `surface-container-high`+primary on 态）、进度两条配方归一、骨架屏只许一条规则、空状态 4pt 网格 | 正则读 `global.css` | ✔ | **高**。断言直接钉在 `.chip-btn` `.switch` `.plg-switch` `.thos-progress-bar` `.cloud-quota-bar` `.skeleton` `.empty` 这些**业务类名**上 |
| `tools/list-row-test.mjs`（42 行） | 6 类行（`.mail-row` `.cloud-row` `.svc-row` `.task-row` `.wb-row` `.home-modal-row`）不得有字面圆角 / `--border-soft` 分隔线 / 字面色值；5 类交互行必须有 hover/active | 正则读 `global.css` | ✔ | **中**。规则本身通用，只依赖类名清单 |
| `tools/button-variants-test.mjs`（126 行） | 读 **5 个文件**（`global.css` `motion.css` `tokens.css` `Ripple.tsx` `main.tsx`）：状态层 8%/12%/8%/38% 明暗两套、焦点环唯一、禁用单一档、变体不各写 hover 底色、涟漪只动 transform/opacity 且 reduced-motion 不生成、宿主 `position: relative`、FAB 与两个野路子按钮（`.task-stat` `.today-quick-chip`）接入同一模型 | 正则跨文件读文本 + `block()` 切块 | ✔ | **高**。这是最接近「组件契约测试」的一个（已经跨 CSS/TSX），但仍是字符串匹配：组件库化后要改成「读组件源码 + 断言 props/variant 表」 |
| `tools/input-system-test.mjs`（82 行） | 3 类常规输入高度 38/40、padding `0 12px`、圆角 medium、底色 container、**描边必须保留**；3 条聚焦规则统一走 `--md-sys-focus-ring`；3 项紧凑清单须存活；手机 40px 档 | 正则读 `global.css`，选择器含 `\n.field input {` 这类**带换行的字面串** | ✔ | **高**。`NORMAL`/`FOCUS` 数组用带 `\n` 的字面选择器串做 `indexOf`，任何空白/格式变动即失效 |
| `tools/modal-shell-test.mjs`（162 行） | 读 **6 个文件**（`global.css` `tokens.css` `motion.css` 3 个 TSX）：遮罩走 `--md-sys-color-scrim` 明暗两档、桌面弹窗形状+elev-3+保留描边、手机 bottom sheet（贴底/满宽/92dvh/只圆上两角/安全区/把手/上滑）、抽屉内卡片灰阶去描边、退场动画全族存在、`is-closing` 相位、**portal 到 body**、**内联 animation 压掉 class 退场**、JS 延时与 CSS 时长同源（200ms）、`useExitPhase` 全覆盖 | 正则 + `block()` + 逐文件读 TSX 字符串 | ✔ | **高**。它同时钉 CSS、DOM 结构、hook 用法、延时数值——组件库化必须拆成 3~4 个正交测试 |
| `tools/nav-shell-test.mjs`（105 行） | 底栏 5 等分 / 无描边 / 安全区 / 64×32 胶囊 / `secondary-container` / `is-ready` 才点亮；侧栏 ≤240px、整行胶囊、竖条指示器关闭、分区标题令牌化、折叠钮无描边；手机大标题走 `headline-medium-size`；`motion.ts` 的导航常量必须复用 | 读 5 个文件；`pick(selector, feature)` 用**内容特征正则**在多个同名 `.bottom-nav {` 里挑真身 | ✔ | **高**。已在注释里承认「`.bottom-nav` 的第一处是桌面 `display:none`」这种靠特征选真身的脆弱性，且断言里夹着已废弃结构（`bottom-nav-indicator` 必须不存在） |
| `tools/scrollbar-test.mjs`（110 行） | ① 全库不得声明 `scrollbar-width`（除 `none`）/`scrollbar-color`（否则 Chromium ≥121 整体忽略 `::-webkit-scrollbar`）；② `base.css` 的令牌化细滚动条（混色 ≤22%、透明边+content-box、hover/active 逐级加深）；③ 颜色只走令牌；④ 元素级覆盖只许改宽度；⑤ `html` 必须 `scrollbar-gutter: stable` + `overflow-y: scroll`；⑥ 邮件 iframe 的 srcDoc 要自带滚动条样式 | 遍历 `apps/desktop/src` + `packages/ui/src` 全部 `.css`（`walk()`）；TSX 只查 `MailPage.tsx` | ✔ | **低**。几乎全是全局不变量（`*::` 伪元素 + `html`），组件库化后仍然成立且**应该升级为组件库的滚动容器基线** |
| `tools/icon-test.mjs`（76 行） | 基座 18×18 / viewBox 24 / `strokeWidth 1.6` / `currentColor` / `aria-hidden`；16px 档 1.4 且画布只有 1 处；**除白名单外禁止手写 `<svg>`**；禁 `strokeWidth=2` | 遍历 `apps/desktop/src/**/*.tsx`，数 `<svg` 出现次数并与 `ALLOW` 映射比对；断言 `Icons.tsx` 的正则 | ✔ | **低-中**。语义上是「图标组件库」的契约，几乎可以原样搬进 OneGUI，只需把 `SRC` 与白名单路径改成库路径 |
| `tools/density-test.mjs`（47 行） | `html.is-phone` 首个规则块 = 密度刻度：`--text-base: 15px`、`--text-sm: 14px`、`--gap-1..6 = 4/8/12/16/20/24`；`html.is-phone body { line-height: 1.6 }`；手机层不得出现字面 13/14px 字号；5 处功能性分隔线必须在、2 处装饰性必须删 | 正则读 `global.css`，`CSS.indexOf("html.is-phone {")` 定位首个规则块 | ✔ | **中**。密度刻度是 OneGUI 必须接管的「第二套令牌」，但断言靠 `indexOf` 取**第一个** `html.is-phone {` 块，加一条规则即失效 |
| `tools/token-compat-diff.mjs`（93 行） | 「令牌重写零观感变化」：`git show HEAD:packages/ui/src/tokens.css`（+ palette）里每条非 `--md-*` 变量的**解析值**与工作区新值逐条比对；6 条白名单「有意变化」单独列出 | `execFileSync("git", ["show", REF:path])` + 自写 `var()` 链解析（深度 10）+ `stripSchemeBlocks()` 剔暗色块 | ✔ 第 2 位 | **中**。它把「**与 git HEAD 的旧值比对**」当成不变量——OneGUI 一旦真的改了令牌值，这个测试必须同步维护 `INTENTIONAL` 白名单，否则每次提交都红 |
| `tools/css-parse-test.mjs`（82 行） | 每个 CSS 文件括号配平、注释闭合；**且不允许规则被嵌进非 `@` 规则**（少写 `}` 的典型后果；历史事故：27 项护栏一条没拦住，按钮全变默认样式） | 逐字符扫描 + 括号栈，`stack[top]` 不以 `@` 开头即报错 | ✔ 第 3 位 | **低**。纯结构校验，与类名/组件无关，可原样保留 |

> 注：当时尚未建立 `tools/*contrast*-test` 系列脚本；除 `dynamic-flow-test.mjs` 与 `theme-system-test.mjs` 借助 `tools/dom-stub.mjs` 模拟节点外，
> 其余 12 个检查工具均直接对源码做**纯文本正则**扫描。

### 7.1 `tools/style-scan-baseline.json`（108 行）

| 指标 | 值 |
|---|---:|
| 覆盖文件 | 6 |
| 间距违规基线 | **690** |
| 字号违规基线 | **123** |
| 合计 | **813** |
| 当前实测 | 间距 **688**（比基线少 2，已清了一点）、字号 **123**（持平） |

| 文件 | 间距 | 字号 |
|---|---:|---:|
| `apps/desktop/src/styles/global.css` | 590 | 94 |
| `explorer-ui.css` | 57 | 19 |
| `explorer-oh.css` | 29 | 9 |
| `explorer.css` | 8 | 1 |
| `explorer-home.css` | 5 | 0 |
| `motion.css` | 1 | 0 |

Top 间距违规值：`10px` ×189、`6px` ×138、`2px` ×117、`14px` ×62、`1px` ×37、`7px` ×34、`9px` ×33。
Top 字号违规值：`13px` ×34、`11px` ×28、`10px` ×22、`10.5px` ×10、`15px` ×9、`12.5px` ×7。
**813 处「规范债」就是 OneGUI 组件库的隐含需求清单**——组件库给出档位后这些数字才能真的降。

---

## 8. 风险清单：组件库接管样式时最可能反打的地方

| # | 风险 | 证据（grep 计数） | 为什么会反打 |
|---:|---|---|---|
| 1 | **`!important` 军备竞赛** | `styles/*.css` **104** 处（`explorer-ui 24` / `global 36` / `explorer 13` / `motion 6` / `explorer-home 3` / `explorer-oh 1`）；TS/TSX **6** 处 | 组件库若靠「普通特异性」上新样式，会被这 110 处直接压掉。`global.css` 的注释自己写着「`!important` 压过内联样式」（`.xk-panel` 一族） |
| 2 | **内联样式压过 class** | TSX 中 `style={{` **1481** 处，其中含 `color`/`background`/`border` 的 **397** 处；`el.style.setProperty` **11** 处（对比度引擎独占其中 2 处） | 组件库用 class 表达外观，但凡宿主传了 `style={{color}}` 就赢。`modal-shell-test.mjs` 已经踩过同型坑：「内联 `animation` 优先级更高 → 退场永远不生效」 |
| 3 | **每页 `:has()` 选择器** | `:has(` **30** 处（`global.css` 27 + `motion.css` 1 + 其余 2）；其中 `:has(.tasks-body)` **13** 处、`:has(> .page-anim[data-page="…"])` 8 处、`:has(.sidebar.is-collapsed)` 1 处 | 这些是「根据页面内容反推布局」的补丁（待办页没有 body 就换排布）。一旦组件库调整 DOM 层级，这些选择器便不再命中，布局会在无构建报错的情况下发生偏移 |
| 4 | **CSS 与 TSX 的类名耦合是双向的** | `card-layers-test` 绑 9 类页级卡 + 4 类未迁清单；`controls-test` 绑 7 个业务类；`list-row-test` 绑 6 类行；`input-system-test` 用**带换行的字面选择器**做 `indexOf` | 护栏脚本与现有类名强绑定：调整类名时需同步升级护栏断言并保持原有视觉约束。`explorer-ui.css:21` 已记录过「global.css 的 `.tabstrip{flex-wrap:wrap}` 会撞车」这类跨文件类名冲突 |
| 5 | **表面填充的三个维护源**（`tokens.css` 双声明覆盖 + `global.css:8196-8199` 覆写 System 名 + `glass-levels.css` 六块覆盖） | `--surface` + `--surface-2` + `--surface-3` 合计 **146** 处消费；`--md-sys-color-surface-container-*` 合计 **100** 处消费；玻璃令牌 **443** 处 | 组件库接管表面材质前，需先将这 3 个写入源收敛为单一真源；`theme.ts:264-272` 的 `SURFACE_FAMILY` 黑名单只是过渡期拦截手段 |
| 6 | **`html.is-phone` 密度层** | `html.is-phone` 规则 **139** 处（`global 64` / `explorer-ui 29` / `explorer-home 26` / `explorer-oh 12` / `explorer 4`）；首个块重写 13 个令牌（7 字号 + 6 间距） | 这是**第二套令牌体系**（手机正文 15px、`--gap-5/6` 换成 20/24），与桌面档并行。组件库必须内建「密度」维度，否则 139 处手机覆写会全部躲到库外面 |
| 7 | **`--dsw-alias-*` / `--dsw-radius-*` 残留别名令牌** | 样式表引用 `--dsw-*` **34** 处（`--dsw-radius-lg` 8、`--dsw-alias-bg-layer-1` 6、`--dsw-radius-md` 5、`--dsw-radius-xs/sm` 2）；TSX **43** 处；`tokens.css:112-120` 只定义了 9 个，**`--dsw-radius-*` 全部未定义** | `tokens.css:109-111` 的注释记录过一次同类问题：「应用内从未定义 → 深夜模式标签栏/侧栏恒回退 #fff 发白」。组件库化时需一并收口 |
| 8 | **字面值残留** | app CSS 中 hex **139** 处、`rgba()/hsla()` **328** 处、`border-radius: 999px` **17** 处、字面 `font-size: Npx` **232** 处；TSX 侧 `var(--…)` 只有 713 处 | 要落实「组件内部零硬编码颜色」的准则，需先将这 467 处字面色值收口为语义令牌；例如 `explorer.css:303-328` 中 `color: #1c1f28` 仍直接写死文字色 |
| 9 | **选择器特异性天花板已经很高** | `global.css` 1753 条规则、最深选择器带 6 层类限定；`explorer.css` 有 6 个按 `[data-wallpaper-lum]` 分支的作用域令牌块；`html.has-reveal :is(.list,.stats,.today-grid,.market-grid,.icon-grid,.setting-group) > *[data-reveal-in]`（`motion.css:685`）已到 (0,4,0)+ | 组件库想用低特异性 class 覆盖，必须走 `@layer` 或 `:where()`；但现有代码没有 `@layer`，一次性引入会让 2398 条规则的胜出关系**整体重排** |
| 10 | **`<style>` 注入站点 13 处，且包含 HTML 内置节点** | `onethu-theme-style` / `onethu-dynamic-color` / `onethu.usergen-theme` + 插件 loader + 9 处组件内联 `<style>`；`index.html:13` 的 `#dsh-liquid-refract` SVG 滤镜被 `global.css:8164` 引用；`exthw/ProblemBody.tsx:236-252` 用 `MutationObserver` 监听 `#onethu-theme-style` 的 characterData | 运行时样式分布在**五条不同的注入路径**中，其中两条依赖 `head.appendChild` 维持文档末尾优先级；组件库需要复用统一管线，避免再增设独立注入源 |
| 11 | **CSS 导入顺序依赖模块求值次序** | 入口只引 4 个；`explorer*.css` 由 `components/Layout.tsx:51-53`、`plugins/ChatDock.tsx:44` 引入；`quill.snow.css` 引 2 次；`leaflet.css` 1 次 | Vite dev 通过 JS 动态注入 `<style>`，加载顺序随模块求值次序变化；一旦调整组件懒加载或代码分割，级联优先级就会改变。`explorer-ui.css:6` 中「本文件在 explorer.css 之后加载」目前仅靠注释约定，缺少构建期校验保障 |
| 12 | **AppleDouble `._*` 与 exFAT 卷** | 仓库全量 `._*` **3706** 个（其中 `plugins/OneTHU-Harness/target/debug/deps` 2298）；**源码目录内**（`apps`/`packages`/`tools`/`docs`）仍有 **388** 个，`packages/ui/src` 与 `apps/desktop/src/styles` 每个 CSS 都有对应的 `._xxx.css`（4096 字节） | 在外置卷上每新增一个 `packages/ui/src/onegui/*.css` 便会伴生对应的 `._onegui.css`。遍历目录 `*.css` 的护栏脚本（`style-scan`、`scrollbar-test`、`css-parse-test`、`token-guard`）需统一过滤 `._*` 前缀文件（本次勘察全程通过 `grep -v '\._'` 排除） |
| 13 | **对比度引擎缺少自动化护栏** | 尚无 `tools/*contrast*` 测试脚本；`textContrast.ts` 390 行暂无单测覆盖；引擎内部硬编码了 `.explorer-shell` / `.explorer-content` / `.ex-rail` / `.ex-bbar` / `.ex-mobile-strip` / `.home-chrome-layer` / `.wall-video-veil` 7 个类名 | 组件库调整 DOM 结构后，若引擎的 `closest()` 选择器未同步更新，背景纱层提白计算会失效并引发文字可读性回退，需配套补齐回归测试 |
| 14 | **`motion.css` 与 `global.css` 的同选择器争夺** | `motion.css` 96 条规则里大量 `.btn` `.input` `.row-caret` `.switch-knob` `.seg-item` `.nav-item` `.skeleton` `.toast-host` 等业务类；`main.tsx:53-54` 靠注释保证 motion 在 global 之后 | 组件库接管 `.btn` 后，`motion.css` 的微交互规则仍会命中同名选择器，需要明确划分动效规则的归属边界 |

---

## 9. 接管建议的落点（供 03 文档展开）

| 目标 | 现状真源 | OneGUI 应接管为 |
|---|---|---|
| 令牌 | `packages/ui/src/tokens.css`（3 层 + 56 Compat 名，表面变量分散在三处） | 单层语义令牌 + 显式的 `@layer onegui.tokens` |
| 玻璃 | `glass-levels.css`（6 选择器块，`explorer.css` 中另有高特异性局部覆盖） | 玻璃度作为**组件级 prop**，档位只写一处 |
| 主题 | `state/theme.ts`（`<style id>` + `:root[data-theme]` + Compat→System 镜像表 39 条） | CSSOM 变量写入 or 单一 `@layer onegui.theme`，镜像表自动化 |
| 明暗 | `data-scheme`（2 个写入方 + 3 个观察方） | 单一 scheme service，组件只订阅 |
| 对比度 | `lib/textContrast.ts`（390 行，写内联色，7 个硬编码类名，待补测试） | 组件层的 `tone="auto"` 意图，引擎内部化 |
| 动效 | `motion.css`（25 keyframes + 22 令牌）+ `lib/motion.ts`（27 KB，含导航物理常量） | 统一 `og-motion` 服务 + 令牌；reduced-motion 由库保证 |
| 密度 | `html.is-phone` 139 条覆写 + 13 个令牌重写 | 密度维度进令牌层（`data-density`），页级覆写清零 |
| 护栏 | 14 个正则文本测试，绑 50+ 业务类名 | 组件契约测试（按 variant/props 断言）+ 保留 3 个纯结构测试（`css-parse` `token-guard` `scrollbar`） |

*本文为只读勘察基线记录。*
