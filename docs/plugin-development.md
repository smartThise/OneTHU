# 插件开发指南

中文 · [English](en/plugin-development.md)

> 0.11 现行入口：管理页为「我的 → 插件」，完整模式开放插件管理；接口全集以 [生成 API 清单](api-surface.md) 为准（36 个命名空间、255 个方法入口）。下文保留协议、清单与历史版本示例；旧页面名称不代表当前导航，示例需要按现行类型与权限检查。JS 插件与 Rust sidecar 为受信代码，API 门禁不等于代码沙箱；QuickJS 技能运行时是另一条受限执行路径，见 [OH / 清小搭](oh-and-xiaoda.md)。


> 最后更新：2026-10-15 01:33

本文档说明 OneTHU 插件的开发流程：插件模型、清单规范、权限声明、通信协议与调试
方法。`ctx.onethu.*` 接口的逐方法说明见 [api-reference.md](./api-reference.md)。

## 目录

1. [插件能力与形态](#1-插件能力与形态)
2. [最小插件](#2-最小插件)
3. [清单规范](#3-清单规范)
4. [权限模型](#4-权限模型)
5. [通用约定](#5-通用约定)
6. [插件 UI 通道与结构化结果](#6-插件-ui-通道与结构化结果)
7. [接入新的清华服务](#7-接入新的清华服务)
8. [发布插件](#8-发布插件)
9. [Rust sidecar 协议与 OH 扩展](#9-rust-sidecar-协议与-oh-扩展)
10. [对话面板协议](#10-对话面板协议)
11. [Android 内嵌形态](#11-android-内嵌形态)
12. [调试](#12-调试)
13. [版本记录](#13-版本记录)

---

## 1. 插件能力与形态

插件通过 `ctx.onethu.*` 访问宿主提供的全部数据能力（课表、作业、日程、图书馆预约、
邮件、云盘、模型对话等），并可注册命令按钮、渲染常驻对话面板、定义主题。宿主承担
会话维护、超时控制、重试与权限校验，插件只需处理业务语义。

插件为受信代码（JS 插件在应用 webview 同域执行，Rust 插件为本机进程），权限门禁
约束的是 `ctx.onethu.*` 的可见范围，不是代码沙箱。插件不得直接访问应用内部状态或
DOM，全部操作应经公共接口完成。

三种插件形态共用同一套权限门禁与 API 面：

| 形态 | 载体 | 运行位置 | 支持平台 | 安装方式 |
|---|---|---|---|---|
| JS 模块 | ES 模块文本 | 应用 webview | 全部 | 设置 → 插件 → 粘贴代码或选择文件 |
| Rust sidecar | 二进制与 manifest.json | 独立进程（stdio JSON-RPC） | 仅桌面 | 选择 manifest.json，二进制置于同目录 |
| Rust 内嵌 | 编译进应用 | 应用进程内（Tauri 命令桥） | 仅 Android | 随安装包分发，由官方提供 |

## 2. 最小插件

JS 插件为一个 ES 模块，导出 `manifest` 与默认激活函数：

```js
export const manifest = {
  id: "onethu.example",
  name: "示例插件",
  version: "0.1.0",
  description: "查询校园卡余额并跳转至对应页面",
  permissions: ["user:read", "card:read", "nav", "ui"],
};

export default async function activate(ctx) {
  ctx.registerCommand({ id: "balance", title: "查询余额" }, async () => {
    const card = await ctx.onethu.card.info();
    ctx.onethu.ui.toast(`余额 ¥${card.balance.toFixed(2)}`);
    ctx.onethu.nav.go("life", { lifeTab: "card" });
    return `余额 ${card.balance} 元`;
  });
}
```

安装步骤：设置 → 插件 → 粘贴代码 → 安装 → 展开插件卡片 → 点击命令。命令返回的
字符串直接展示在卡片中，异常展示前 200 字符。

完整特性示例见插件市场收录的 [OneTHU-plugin-hello](https://github.com/smartThise/OneTHU-plugin-hello)：
单文件覆盖结构化结果、确认与表单弹窗、剪贴板、自建功能页、全局 CSS、原子化收藏、
桌面小组件（§6.5）、系统通知（§6.6）与 OH 双向联动，可直接作为新插件的模板
（删除不需要的段落即可）。

## 3. 清单规范

### 3.1 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 唯一标识，建议反域名形式（如 `onethu.harness`），允许 `[a-z0-9.-]` |
| `kind` | `"js"` \| `"rust"` | 否 | 插件形态，默认 `js` |
| `bin` | string | Rust 形态必填 | 二进制文件名，与 manifest.json 同目录 |
| `name` | string | 是 | 显示名称 |
| `version` | string | 是 | 版本号 |
| `author` | string | 否 | 作者 |
| `description` | string | 否 | 描述 |
| `permissions` | string[] | 是 | 权限清单，安装时由用户逐项确认 |
| `repo` | string | 否 | 源码仓库地址；插件管理页据此展示「仓库」跳转按钮。经市场或 GitHub 直装安装时，安装来源会自动记录并覆盖此字段 |
| `announce` | boolean | 否 | 公告热通道开关：声明 `announce: true` 后，宿主每次插件启动/打开均会检查**你仓库根目录的 `NOTICE.md`**，内容变化时在插件卡片弹出「📢 公告」框（使用 markdown 文本渲染，用户点「知道了」收起）——运营面/规则/重要更新均可往 `NOTICE.md` 里写，仓库推送即生效 |
| `settings` | SettingField[] | 否 | 设置表单，由应用渲染 |
| `commands` | Command[] | 否 | 命令按钮；Rust 插件也可在激活应答中返回 |

### 3.2 设置项（SettingField）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 设置键，插件通过 `onethu.settings.get()` 读取 |
| `label` | string | 表单标签 |
| `type` | `"text"` \| `"password"` \| `"textarea"` \| `"select"` | 控件类型 |
| `options` | `{ value, label }[]` | `select` 类型的选项 |
| `placeholder` | string | 输入占位符 |
| `default` | string | 默认值 |

### 3.3 命令（Command）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 命令标识，对应 `run` 请求的 `command` 字段 |
| `title` | string | 按钮文案 |
| `inputLabel` / `inputPlaceholder` | string | 输入框标签与占位符；未设置时不渲染输入框 |
| `dock` | boolean | 标记为对话面板命令，见 §10 |
| `agentHint` | string | 给 OH / Agent 的命令说明：什么时候用、如何续读。随 `list_plugin_cmds` 输出；建议 ≤600 字 |

### 3.4 主题插件

主题是一种特殊插件：清单声明 `category: "theme"`，模块导出 `theme` 对象
（`ThemeDef`）而非 `default` 激活函数。宿主在安装与启动时将其注册进主题库，
与其他主题同权：可应用、可停用、可删除（内置主题除外——内置主题不可删除，
保证用户始终有可用外观）。

```js
export const manifest = {
  id: "onethu.theme.example",
  name: "示例主题",
  version: "1.0.0",
  category: "theme",
  permissions: [],
};

export const theme = {
  id: "onethu.theme.example",
  name: "示例主题",
  version: "1.0.0",
  description: "替换强调色与页面底色",
  vars: {
    "--accent": "#0d9488",
    "--accent-soft": "#e0f4f1",
    "--bg": "#f9fcfb",
  },
};
```

完整示例见插件市场的 [OneTHU-theme-barbie](https://github.com/smartThise/OneTHU-theme-barbie)
（芭比粉）：令牌覆盖 + 品牌 logo 替换 + 作用域附加 CSS 三段齐全，并带离线自检
（令牌名合法性、CSS 作用域、文字对比度阈值）。

**ThemeDef 字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 主题唯一标识，建议 `onethu.theme.<名称>`；与清单 id 一致便于管理 |
| `name` / `version` | string | 是 | 展示信息 |
| `author` / `description` | string | 否 | 展示信息 |
| `vars` | `Record<string, string>` | 是 | CSS 变量覆盖，键为设计令牌名（可覆盖清单见下表） |
| `fonts` | `{ ui?, mono? }` | 否 | 字体栈覆盖 |
| `logo` | string | 否 | 品牌 logo 替换，inline SVG 字符串（viewBox 24×24 最佳） |
| `css` | string | 否 | 附加 CSS；必须以 `:root[data-theme="<主题 id>"]` 限定作用域 |
| `dark` | boolean | 否 | 声明为深色主题。激活时应用 `color-scheme: dark`（原生控件与滚动条同步），并可在昼夜调度中作为「黑夜主题」档位 |

**可覆盖的设计令牌**（定义于 `packages/ui/src/tokens.css`）：

| 类别 | 变量 |
|---|---|
| 面 | `--bg`、`--bg-soft`、`--surface`、`--surface-2`、`--surface-3` |
| 骨架屏 | `--skeleton`、`--skeleton-shine`（流光高光；**深色主题必须覆盖**，否则暗底上会扫过一道白色高光） |
| 线 | `--border`、`--border-soft`、`--border-strong` |
| 文字 | `--text-1`、`--text-2`、`--text-3`、`--text-dim` |
| 品牌与强调 | `--primary`、`--primary-hover`、`--on-primary`、`--accent`、`--accent-soft`、`--accent-border` |
| 功能色 | `--red`、`--red-soft`、`--amber`、`--amber-soft`、`--green`、`--green-soft` |
| 交互态 | `--hover`、`--active`、`--ring` |
| 阴影 | `--shadow-1`、`--shadow-2`、`--shadow-3` |
| 字体 | `--font-ui`、`--font-mono` |
| 字号 | `--text-xxs` 至 `--text-xl` |
| 间距与形状 | `--gap-1` 至 `--gap-6`、`--r-sm`、`--r-md`、`--r-lg`、`--r-pill`、`--sidebar-w` |

**内置主题的升级通道**：已安装的内置主题在启动时与随版本分发的新定义比对，**版本号或
令牌集任一不同即整体刷新为新定义**，因此用户对内置主题的修改不会保留（「恢复内置主题」
同理），删除名单依然生效。声明 `source: "plugin"` 的主题不参与该通道——插件可能占用同名
id，内置定义不得覆盖插件主题。补充令牌后即使忘记升版本也会被令牌集判据捕获（护栏
`tools/theme-builtin-upgrade-test.mjs`）。

**实现边界**（边界契约）：主题只做令牌覆盖，不得改变组件结构与布局骨架。深色主题
如需修正应用内硬编码的浅色元素，通过 `css` 字段附加作用域限定的规则，示例：

```js
css: `
:root[data-theme="onethu.theme.example"] .plg-pin.is-oh { background: var(--surface-2); color: var(--text-1); }
`,
```

**与昼夜调度的关系**：`dark: true` 的主题可被用户选为「黑夜主题」档（设置 → 外观），
系统深色模式切换时自动生效。主题插件无激活函数，因此不使用 `settings` 设置项；
需要变体时发布多个主题即可。

**主题与插件是同一份状态**，三处操作互相联动，不存在「删了一边另一边还在」：

| 操作 | 对主题的效果 |
|---|---|
| 删除主题插件（插件卡片） | 其主题一并撤架；若正是当前应用中的主题，外观回落到默认令牌 |
| 停用主题插件 | 主题随之下架；重新启用时按当前版本重新注册 |
| 覆盖安装 / 更新 | 主题定义保留并刷新为新版（应用中的主题不中断）；新版未再声明的旧主题回收 |
| 主题区「删除」 | 该主题有归属插件时按卸载插件处理（提示将一并卸载），无归属的孤儿主题定义单独移除 |

主题区删除内置主题不受影响：内置主题不可删除，仅插件主题可移除。

**关于应用图标**：`ThemeDef.logo` 替换的是应用内的品牌标识（侧栏、对话面板等处），
不影响操作系统层面的应用图标。系统级图标（macOS 程序坞、Windows 任务栏、Android
启动器）由平台机制与安装包配置决定，宿主不提供运行时切换接口，各平台情况如下：

| 平台 | 运行时可切换 | 说明 |
|---|---|---|
| macOS | 是（平台 API） | 可经 `NSApplication` 设置程序坞图标；程序化设置不持久，应用需记录用户选择并在启动时恢复 |
| Windows | 是（平台 API） | 可切换窗口与任务栏图标；可执行文件内嵌图标与快捷方式图标需要修改系统配置 |
| Android | 否 | 启动器图标必须为安装包内预置资源，运行时仅能在编译期预置的多个 `activity-alias` 之间切换 |

该能力属于平台层实现，与业务逻辑无关，且变更系统级应用标识涉及用户系统配置，因此
不作为主题字段或插件接口开放。

**开发者更换应用图标的方式**：应用图标在打包阶段写入，通过 Tauri 的图标工具生成与
配置：

1. 准备源图：1024 × 1024 PNG，建议透明背景、主体居中。Android 自适应图标会裁切
   外圈并施加遮罩，主体应控制在内侧约 66% 的安全区域内。
2. 在 `apps/desktop` 目录执行：

   ```bash
   npx tauri icon path/to/source.png
   ```

   命令按平台生成全部尺寸并覆盖目标位置：

   | 目标 | 产物 |
   |---|---|
   | 桌面三端 | `src-tauri/icons/` 下的 `icon.png`、`icon.icns`（macOS）、`icon.ico`（Windows）及各尺寸 PNG |
   | Android | `src-tauri/gen/android/app/src/main/res/mipmap-*/` 各密度位图，以及 `mipmap-anydpi-v26/ic_launcher.xml` 自适应图标（前景 `ic_launcher_foreground` 与背景色 `ic_launcher_background`） |

   Android 目标目录由 `tauri android init` 生成；若尚未初始化，先生成再执行图标命令。
3. 重新构建分发物。桌面端重新打包；Android 端重新构建安装包（`npx tauri android build`），
   覆盖安装后生效。

当前仓库的图标配置位于 `src-tauri/tauri.conf.json` 的 `bundle.icon` 字段，默认引用
`icons/icon.png`、`icons/icon.icns`、`icons/icon.ico`。

### 3.5 生命周期

- 安装后立即激活；应用启动时自动恢复所有已启用插件。
- 停用：调用 `dispose` 后卸载。删除：停用并清除插件私有存储。
- 激活函数可返回 `{ dispose() }`，用于停用时释放资源。
- 安装记录包含 `builtin`（应用组成部分，不可卸载）与 `embedded`（编译进应用）标记。
- 内置插件的清单与镜像不一致时，启动阶段自动重新注册，用户设置值保留。

## 4. 权限模型

插件在清单中声明 `permissions`，安装时由用户确认。调用未声明权限的方法抛出
`PluginPermissionError`。三种形态使用同一套门禁，无绕过路径。权限与 API 的对应关系
见 [现行 API 与权限门禁](./api-surface.md)。

以下两类能力受平台规则限制，宿主不提供对应接口：

1. **体育场馆预约提交**。宿主仅提供查询、退订与官方页面跳转。依据清华大学体育部
   场馆中心 2025-12-03 公告第七条第 12 款，通过脚本预订场地将被暂停预订权限 6 个月，
   插件不得以任何方式绕过。
2. **资金与凭据写操作**。不提供充值、修改密码等接口。

## 5. 通用约定

### 5.1 网络与超时

- **通道一致性**：CAS 票据的兑换通道决定会话建立通道，该过程由宿主内部处理，
  经 `ctx.onethu.*` 发起的调用无需关心。`net.fetch` 直连清华内网域时需自行处理，
  且校内域名在校外不可达；校内业务应统一使用 `ctx.onethu.*`。
- **会话自愈**：会话失效时宿主自动重建并重试原请求。重建失败抛出
  `AuthRequiredError`，此时应提示用户重新登录，不应重试。
- **超时**：所有请求（含 `net.fetch`）设有 45 秒上限。

### 5.2 错误处理

| 错误 | 判定方式 | 处理建议 |
|---|---|---|
| `PluginPermissionError` | 类名或消息含「未获授权」 | 提示用户重新安装并授予对应权限 |
| `AuthRequiredError` | 消息含「会话未能建立」 | 提示用户重新登录，不应重试 |
| 其他 `Error` | — | 可重试一次，失败后向用户报告 |

### 5.3 数据规约

- 日期格式为 `"YYYY-MM-DD"`，时间格式为 `"HH:MM"`。
- `dateChoice` 为枚举参数（0 表示今天，1 表示明天），不是日期字符串。
- **链式调用的对象传递**：形如 `library.list → floors → sections → seats → book`
  的调用链，后一步的入参必须是前一步返回的元素本体。工具实现中应按标识符查找元素
  后再传入，不应构造对象。

## 6. 插件 UI 通道与结构化结果

插件不止能「执行命令返回一行字」：宿主提供 UI 通道（弹窗/表单/通知）与结构化
结果渲染，插件可以构建完整的交互流。

### 6.1 结构化命令结果

`registerCommand` 的 run 返回值除纯字符串外，可返回 `CommandResult` 对象
（`text` / `markdown` / `items` / `kv` 四类区块，见 [api-reference.md §0](./api-reference.md)），
管理页在命令结果区渲染 Markdown（GFM 表格/代码块）、条目列表与键值对汇总：

```js
ctx.registerCommand({ id: "today", title: "今日概览" }, async () => ({
  text: "共 5 条通知",
  markdown: "| 课程 | 事项 |\n|---|---|\n| 高数 | 作业发布 |",
  items: [
    { title: "图书馆 3F-12", subtitle: "预约成功", meta: "13:00 – 17:00" },
  ],
  kv: [{ k: "今日课程", v: "3 节" }, { k: "电费余额", v: "23.4 元" }],
}));
```

### 6.2 UI 通道（`onethu.ui`）

| 方法 | 权限 | 用途 |
|---|---|---|
| `ui.toast(text)` | `ui` | 底部提示 3 秒 |
| `ui.confirm(msg, {danger?, title?, confirmText?})` | `ui` | 应用内确认弹窗（Promise 化）；危险样式传 `{danger: true}`，**并应显式提供 `title` 与 `confirmText`**——宿主兜底文案为通用措辞，多场景共用同一句会削弱提示的针对性 |
| `ui.form(title, fields)` | `ui` | 通用表单弹窗：text/textarea/password/select 字段，resolve 键值对象（取消为 null） |
| `ui.clipboard.write(text)` | `ui` | 写剪贴板 |
| `ui.clipboard.read()` | `clipboard:read` | 读剪贴板（敏感权限，单列） |

表单典型用法——插件收集参数后再执行写操作：

```js
ctx.registerCommand({ id: "book", title: "预订研讨间" }, async () => {
  const f = await ctx.onethu.ui.form("预订研讨间", [
    { key: "room", label: "研讨间", kind: "select", required: true,
      options: [{ value: "b1", label: "B1-03" }, { value: "b2", label: "B2-07" }] },
    { key: "date", label: "日期（YYYY-MM-DD）", required: true, default: "2026-09-20" },
    { key: "note", label: "备注", kind: "textarea" },
  ]);
  if (!f) return "已取消";
  if (!(await ctx.onethu.ui.confirm(`确认预订 ${f.room}？`, { danger: false }))) return "已取消";
  // …执行预订
});
```

### 6.3 自建功能页（tab）与自由渲染

插件可以注册**自己的功能页**，并在页面容器内**全权渲染 DOM**——任意 HTML 结构、交互逻辑，
配合 `registerCss` 天马行空的样式。页面 id（pageKey）约定为 `plugin:<插件id>:<tabId>`，
它就是一个**正常的应用页**：标签栏可开、可分享深链、能进首页程序坞。

注册后插件页在宿主侧有三个入口（**侧栏不列插件页**——侧栏只列应用自己的一级页）：

1. **服务页**「插件功能页」分组（抽屉退役后的移动端入口，与首页程序坞同一份数据源）；
2. **首页程序坞**：用户在首页「更多功能」里把插件页停靠成一颗球（见 §6.3.1）；
3. **插件自己打开**：`ctx.onethu.nav.go("plugin:onethu.habit:main")`，或 `ctx.onethu.ext.tabOpen`
   （白名单含 `board` / `boards` 等一级页）。

```js
export default function activate(ctx) {
  // ① 注册 tab（pageKey = plugin:<插件id>:<tabId>）
  ctx.registerTab({
    id: "main",
    title: "打卡",
    iconSvg: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><circle cx="8" cy="8" r="6"/></svg>',
  });
  // ② 注入样式（需 css 权限；作用域规约 [data-plg="<插件id>"]）
  ctx.registerCss(`
    [data-plg="onethu.habit"] .streak { color: #e8543f; font-weight: 700; }
  `);
  // ③ 页面容器就绪后渲染（容器常驻：切走再切回，插件内部状态保留）
  ctx.onethu.ui.onTabReady("plugin:onethu.habit:main", (root) => {
    root.innerHTML = `<div class="streak">连续打卡 3 天</div>`;
    root.querySelector(".streak")?.addEventListener("click", () => { /* 任意交互 */ });
  });
}
```

约束与边界：

- 页面容器挂在宿主 React 布局内，容器**之外**的宿主界面不得改动（`registerCss`
  的选择器请遵守作用域规约；越界样式会被审查拒绝收录）；
- tab 图标为 16×16 视口的 inline SVG；
- 容器就绪回调可能多次触发（页面重建），渲染函数应写成幂等（先清空再挂）。

### 6.3.1 首页程序坞（把功能页停靠到首页）

首页时间下面那排球＝**程序坞**，它的成员 = 应用一级页 ∪ 插件功能页（两者同权）。插件可以
自己请求停靠/取消停靠，也可以只读现状（需 `ui` 权限）：

```js
// 只读：坞上有哪些球 + 还能停哪些（都带名字，便于做「要不要停靠」的判断）
const snap = ctx.onethu.ext.homeDock.set();
// { docked: ["tasks", "learn", …], dockable: [...], entries: [{ page, label, plugin }] }

// 停靠 / 取消停靠（pageId 是应用一级页，或本插件自己的 plugin:<id>:<tabId>）
ctx.onethu.ext.homeDock.set("plugin:onethu.habit:main", true);
ctx.onethu.ext.homeDock.set("plugin:onethu.habit:main", false);
```

- `pageId` 必须是「应用一级页」或「**已注册**的插件功能页」（即 NAV ∪ 插件 tab 那两份
  注册表）；认不出会抛错并列出可停靠项，**不会**静默加一颗看不见的球；
- `homeDock` 本身可调用（`ctx.onethu.ext.homeDock(pageId, on)`），与 `.set` 同一实现；
- 停靠状态是**用户偏好**：随首页布局持久化，与「插件是否启用」独立——插件被停用/卸载后，
  那颗球会在下次读取布局时自动被过滤掉，不需要插件自己做清理。

**OneShot / 快速入口**（2026-11 起）：插件功能页也会出现在 **OneShot 的候选清单**里
（`state/quickAccess.ts` 把插件 tab 与一级页并列），用户可在 OneShot 配置 /「更多功能」
里选「电子木鱼」这类插件页当快捷入口；点击等价于 `nav.go("plugin:<插件>:<页>")`。
旧宿主没有这条通道时，仍可把插件页停靠到首页一级功能区（上一节），能力不丢。


### 6.4 原子化收藏（对齐宿主收藏夹体系）

宿主收藏夹基于统一的原子引用体系：课程、作业、通知、场馆等均注册为原子，收藏夹只保存
原子引用。插件可以注册自己的原子种类，使其结果**与课程、通知同级**地收入用户收藏夹，
点击卡片深链回插件的对应页签：

```js
// ① 注册原子种类（key 约定 "<tabId>~<原子key>"，展示元数据由 resolve 提供）
ctx.registerAtom({
  group: "打卡",
  resolve: (key) => state.get(key.slice(key.indexOf("~") + 1))
    ? { title: `打卡记录 ${key.slice(key.indexOf("~") + 1)}`, sub: "打卡" }
    : null, // 返回 null = 原子已失效（收藏夹降级显示）
});
// ② 收藏（folderId 缺省收进第一个根收藏夹；展示元数据走 resolve，不重复传）
ctx.onethu.favorites.add("main~streak:3");
// ③ 查询本插件被收藏情况
const saved = ctx.onethu.favorites.list();
// [{ folderId: "f_x", folderTitle: "我的收藏", key: "main~streak:3" }]
```

**落点（2026-10-15 起）**：收藏一颗「元素」不再只有一种去处——收藏面板会先让用户选落点
（首页 / 已有 OnePage / 最后才是新建）。插件侧同一份能力经 `ext.onePageAddAtom` 拿得到，
它只调数据层的高阶函数（自带查重与落位），插件**不要**自己写格子坐标：

```js
// 落首页（首页画的就是那块系统板；不给 boardId 即首页）
ctx.onethu.ext.onePageAddAtom({ to: "home" }, "course:12345");
// 落某块已有 OnePage（boardId 来自 ext.onePageList / OH 的 ext_onepage_list）
ctx.onethu.ext.onePageAddAtom({ boardId: "board.user.m3k9" }, "course:12345");
// → { ok: true, boardId, added: "it.xxx" }
// → { ok: false, reason: "duplicate" }  板上已经有它，没有重复放
// → { ok: false, reason: "no-board" }   目标板不存在
```


### 6.5 声明式桌面小组件（Android）

插件可以把自己的信息放到 Android 桌面：`ctx.registerWidget` 声明「显示什么」，宿主把声明
解析成原生可画的内容，由系统小组件渲染。

```js
ctx.registerWidget({
  id: "streak",                                  // 插件内唯一；同 id 重复声明为覆盖
  title: "连续打卡 3 天",
  rows: [
    { atom: "main~streak:3" },                    // 引用本插件注册的原子（宿主解析出标题/说明）
    { text: "本周已完成 5/7", sub: "坚持中" },     // 或直接给一行字面文本
  ],
  target: "plugin:onethu.habit:main",             // 点击落点；缺省为该插件第一个功能页
});
```

| 规则 | 说明 |
|---|---|
| 权限 | 需 `widget`。桌面端（macOS / Windows）不做小组件，本 API 只在 Android 生效 |
| 槽位 | 宿主预留 **3 个**槽位（`OneTHU 插件小组件 1/2/3`），插件按声明顺序占位 |
| 尺寸 | 槽位小组件可自由拖动改尺寸；行数按**真实高度**铺满（与宿主共用同一套渲染，最多 20 行），插件无需声明尺寸 |
| 覆盖 | 同 id 重复声明**就地替换**：插件更新自己的小组件不会把槽位让给别的插件 |
| 原子行 | `{ atom }` 走本插件注册的原子解析（key 约定同收藏夹 `"<tabId>~<原子key>"`）；`resolve` 返回 `null` 的行丢弃 |
| 空内容 | 解析后一行不剩的小组件**不占槽位**（避免桌面上出现一张写着插件名、内容全空的卡片） |
| 行数 | 单卡最多声明 3 行；实际渲染行数由桌面占位的**真实高度**决定（能放几行就铺几行，一行一个事件），极矮尺寸下脚注不占位 |
| 落点 | 点击小组件回到 `target` 指定的页面；槽位无内容时点击进插件页，便于用户排查是谁占的槽位 |

**声明式设计的原因**：Android 桌面小组件由 AppWidgetHost 在**独立进程**中渲染，该进程没有
WebView、没有登录会话，也没有插件的 JS 运行时，插件代码无法在其中执行。因此插件只能声明
内容与落点，取值与渲染由宿主完成（宿主在前台计算快照并推送至原生，见
[architecture.md §3](./architecture.md)）。

**固定槽位的原因**：系统不允许应用在运行时注册新的 AppWidgetProvider（provider 必须在清单
中声明）。宿主因此一次性预留若干槽位，用户将「OneTHU 插件小组件 N」放置到桌面即可看到第 N
个插件小组件。当前占用的槽位可通过 `ctx.onethu.widget.list()` 查询。

**宿主小组件的内容**：内容**按块绑定**，桌面上可同时放置多块 OneTHU 小组件，各自显示不同
内容（一块日程与 DDL、一块某门课的详情、一块常用收藏夹的图标组、一块 1×1 快捷方式）。共
四类：

| 内容 | 形态 | 说明 |
|---|---|---|
| 日程与 DDL | 列表 | 今天的课、考试、作业截止，以及勾了「在桌面小组件显示」的自定义日程；未选择内容时的缺省 |
| 一个原子占满 | 列表 | 课程 / 作业 / 洗衣机 / 教室等显示其详情，**高度越大行数越多**（按真实高度铺满，最多 20 行）；教室显示「本节空闲 / 占用 + 今日空闲节次」，洗衣机显示「使用中 · 剩 N 分钟 + 本楼空闲台数」（捷利 / 海乐生活 / 小兰智慧三家数据源）。实时值由应用在计算内容前获取，获取失败时该行不写入 |
| 收藏夹图标组 | 图标网格 | 把收藏夹嵌到桌面：原子图标并列（最多 2 行 × 4 列），每个格子各自可点 |
| 快捷方式 | 图标 + 名称 | 一个功能页或原子的桌面快捷方式（1×1 起，形态与系统快捷方式一致） |

绑定入口有三处：放置到桌面时系统弹出选择层（AppWidget 的 configure 流程）、点击桌面上尚未
选择内容的小组件、或在设置页「桌面小组件」中逐块修改。内容失效（收藏夹已删除、原子无法解析）
时自动回落为「日程与 DDL」，不在桌面上留下空白卡片。

宿主小组件有五种初始形态（1×1 快捷方式 / 2×1 窄条 / 2×2 方块 / 3×2 标准 / 4×1 长条）：
选择器中可选的形态数等于清单中声明的 provider 数，因此每种形态都需声明一个 provider；五者
共用同一套渲染与同一份实例内容，放置后仍可拖动调整尺寸（行数与图标格数按实际占位自适应）。

插件若需提供「一键将本插件内容放置到桌面」类功能，可读写以下配置（需 `widget` 权限）：

```js
const blocks = await ctx.onethu.widget.instances();     // [{ id, shape, binding }]
await ctx.onethu.widget.bind(blocks[0].id, { kind: "detail", atom: { kind: "plugin:…", key: "main~x" } });
await ctx.onethu.widget.bind(blocks[0].id, { kind: "folder", folderId: "f_abc" });
await ctx.onethu.widget.bind(blocks[0].id, null);       // 恢复默认内容
await ctx.onethu.widget.unbind(blocks[0].id);
await ctx.onethu.widget.setFallback({ kind: "today" }); // 新放置且尚未选择内容的小组件所用默认内容
```

目标不存在（收藏夹 id 不存在、原子无法解析）时返回 `false`，且不写入配置。**插件不能添加或
删除小组件**：添加与删除由用户与宿主完成（设置页可请求系统放置，见
[architecture.md §3](./architecture.md)），插件只能修改已存在小组件的内容。

**内容更新方式**：小组件内容由宿主在前台计算快照时解析（原子行每次重新解析，因此收藏夹、
计数等随状态变化的原子会自动更新）。声明中的字段（`title`）以声明时刻为准，修改需
**重新调用 `registerWidget`**（同 id 就地替换）：宿主监听注册表变化，会立即重推快照并重画
桌面，无需等待下一次定时重算。插件停用时其小组件一并撤下，槽位释放给其他插件。

### 6.6 系统通知（三端）

将信息推送至系统通知中心，而不仅在本插件界面内提示：

```js
const { ok, id, reason } = await ctx.onethu.notify.send({
  title: "打卡提醒",
  body: "今天还没打卡",
  afterSeconds: 3600,        // 缺省 60；须为 1 秒以后，避免过去时刻被系统拒绝
  key: "today",              // 同 key 重复发送覆盖同一条（通知 id 稳定）
  page: "plugin:onethu.habit:main",   // 点击通知的落点
});
await ctx.onethu.notify.cancel("today");
const st = await ctx.onethu.notify.status(true);   // 传 true 才会发起授权请求
```

| 规则 | 说明 |
|---|---|
| 权限 | 需 `notify`；`status()` 会回报平台后端（android / macos / windows / none）与授权状态 |
| 归属 | 通知 id 为 `plugin:<插件id>:<key>`，**归插件所有**：宿主重排自己的提醒时不会撤销它 |
| 收回 | 插件停用或卸载时宿主自动收回该插件排下的全部通知 |
| 总开关 | 不受宿主「提醒总开关」约束：该开关控制宿主自身的课程与 DDL 提醒，插件已单独申请 `notify` 权限，是否发送由插件决定 |
| 用户可见 | 设置 → 通知 → 「插件通知」按插件列出待投递条数，可一键撤销（用户可最终决定是否接收插件通知） |
| 平台差异 | Android 使用通知渠道与定时闹钟（进程被终止后仍可送达）；macOS 使用系统通知中心；Windows 使用 toast。三端的点击落点深链在桌面端尚未接入（见 architecture.md） |

### 6.7 白板交互卡片（插件动作卡）

白板的 `custom` 组件原本只有「用户生成 HTML」（静态、无事件）。想要一个**点一下有反应**
的组件（电子木鱼、打卡计数、小游戏入口），用交互卡片：宿主画壳（左上角状态、中央图标、
底部标题），点击时调用插件**自己的命令**，命令返回值成为卡片状态文本。

```js
// 点一下跑 `tap`，挂载时跑 `status` 取初始状态；缺省放首页，同 cardId 重复调用是更新
const { id, boardId, reused } = await ctx.onethu.ext.actionCard({
  cardId: "main",                 // 插件内唯一；同 id 再调 = 就地更新（不重复长卡）
  title: "电子木鱼",
  icon: "🐟",                     // 单行文本（emoji/一个字）；也可用 CSS 覆盖
  tapCmdId: "tap",
  statusCmdId: "status",
  boardId: undefined,             // 缺省 = 首页系统板；也可传 onePageList() 里的 boardId
  x: 0, y: 0, w: 3, h: 3,
});

// 移除（只删本插件的卡）
await ctx.onethu.ext.actionCardRemove("main");
```

| 规则 | 说明 |
|---|---|
| 权限 | `ui`；`actionCardRemove` 同权限 |
| 命令归属 | 只能引用**本插件**已注册的命令；命令不存在时创建即报错 |
| 状态文本 | 命令返回字符串（或 `{ text }`）作为左上角状态；超长截断，纯文本渲染 |
| 连点 | 每次点击立即执行一次命令，不做防抖；只允许较新的结果覆盖显示（乱序保护） |
| 图标与外观 | `icon` 是文本；插件可用 `registerCss` 以 `[data-plugin-action="<插件id>:<cardId>"]` 限定作用域覆盖背景/字号 |
| 停用/卸载 | 卡片保留并显示「插件已停用」，点击不执行；插件可用 `actionCardRemove` 自行清理 |
| 能力边界 | 卡片不渲染插件 HTML/JS；需要完整界面请用插件功能页（§6.3） |

**为什么不做成 iframe/自定义渲染器**：卡片是首页与 OnePage 上的一等条目，要参与拖动、
缩放、样式档、Android 桌面小组件与板文档持久化；开放任意脚本渲染面既破坏这些语义，
也把安全边界从「插件进程」扩大到「每个卡片实例」。命令回调 + 文本状态是能覆盖
计数/打卡/小游戏入口这类需求的最小面。

### 6.8 系统字体读取（PDF 字形轮廓匹配）

少数 LaTeX/pdfTeX 导出的中文 PDF **只嵌入了字体子集、没有 `/ToUnicode`**，字体 cmap
还是符号编码（0xF000+code → GID）。这类 PDF 的正文在阅读器里显示正常，但任何工具都
抽不出 Unicode（pdftotext 同样输出乱码）。唯一可靠的补救是：拿**系统里同款字体**的字形
轮廓与嵌入字形做指纹比对。

```js
// 只读、白名单路径；找不到返回 null（插件应降级，不要报错）
const font = await ctx.onethu.fonts.system("KaiTi"); // 也接受 "楷体" / "STKaiti" / 子集前缀
// font = { family: "kaiti", path: "C:/Windows/Fonts/simkai.ttf", b64: "..." } | null
```

| 规则 | 说明 |
|---|---|
| 权限 | `font:read`；调用前需在 manifest 声明 |
| 白名单 | 只读 Windows/macOS 常见系统字体固定路径（楷体/宋体/黑体/仿宋/雅黑），**不接受任意路径** |
| 只读 | 不写系统目录、不读用户目录；单文件上限 26MB，base64 返回 |
| 失败 | 字体不存在/读取失败返回 `null`；插件须按"无法还原"降级 |
| 用途 | 供需要从无 ToUnicode PDF 的字形轮廓反查 Unicode 的插件使用（解析嵌入字体的符号 cmap，按轮廓指纹匹配系统字体） |

**实现提示**：系统字体 10MB+，不要每次抽取都读；按字体族缓存，且只在检测到"简单
TrueType + 无 ToUnicode + FontFile2"的字体时才请求宿主。

## 7. 接入新的清华服务

宿主已实现为独立命名空间的服务（`info`、`learn`、`library` 等）之外，其他清华校内
系统可经 `onethu.ts` SDK 接入。SDK 复用宿主主会话：登录凭据、设备指纹、webvpn 通道
分流、会话失效后的自动重登与请求重放均由宿主处理，插件只需实现目标系统的业务请求。
接口细节见 [api-reference.md §5](./api-reference.md)。

标准流程：

1. `await ctx.onethu.ts.ensure()`——确认主会话可用；失败时向用户提示重新登录。
2. `const client = ctx.onethu.ts.client()`——创建客户端。缺省 `auto` 分流：校内域名
   自动经 webvpn 包装，登录链域与白名单公网域直连。
3. `await client.fetch("<目标地址>")`——发起业务请求。目标系统若对接统一认证
   （CAS），未认证请求会被重定向并自动完成票据兑换，插件收到最终业务响应。
4. 按目标系统的响应格式解析数据。

**通道模式**：缺省 `auto` 覆盖常见场景。目标系统经实测确认必须直连时（webvpn 包装
会破坏其会话），改用 `ts.client({ mode: "direct" })`，并在插件说明中注明原因。

**CAS 显式漫游**：目标系统的对接流程非标准（需在认证表单中注入额外参数等）时，
参考 `packages/core/src/exthw/tuojCas.ts`。该模块为 TUOJ 接入的生产实现，包含 CAS
登录页判定、ticket 锚点提取与二次认证处理，可作为模板复制到插件内。

**权限声明**：接入自定义服务需声明 `tsinghua:sdk`。该权限允许插件以用户登录态访问
任意清华校内服务，应在插件描述中向用户说明具体访问目标。

## 8. 发布插件

插件完成开发后可通过两种方式分发给其他用户：插件市场收录，或 GitHub 仓库直装。
两者使用同一仓库格式约定，均仅覆盖 JS 插件；Rust 插件含平台二进制，仍经压缩包或
文件夹安装（见 §3 与安装面板）。

**许可**：插件为独立仓库，许可由插件作者自行确定；宿主既不限制也不代管插件的授权方式。
官方示例插件（[hello](https://github.com/smartThise/OneTHU-plugin-hello)、
[barbie](https://github.com/smartThise/OneTHU-theme-barbie)）一律以 **MIT** 开源，可自由使用；
主程序自身的许可与第三方组件约定见主仓库 [LICENSE](../LICENSE) 与
[LICENSES/THIRD-PARTY.md](../LICENSES/THIRD-PARTY.md)（后者的限制针对主程序分发，
不扩张到插件）。建议插件仓库根目录附 `LICENSE` 并在 README 注明。

### 8.1 仓库格式

插件仓库根目录提供 `plugin.js`（或 `index.js`、`main.js`），内容为单文件 ES 模块：
`manifest` 导出 + 默认导出激活函数——与「粘贴安装」格式完全一致。可用子目录组织
文档与示例，入口文件以外的内容不会被拉取。

入口发现顺序：清单显式指定 `entry` 时按指定拉取；否则依次尝试 `plugin.js`、
`index.js`、`main.js`，分支缺省依次尝试 `main`、`master`。

### 8.2 GitHub 仓库直装

用户在 OneTHU 插件页 → 安装插件 → 「GitHub 仓库」输入仓库地址直接安装。地址支持
以下形态：

| 形态 | 示例 |
|---|---|
| 简写 | `user/repo` |
| 指定分支 | `user/repo@dev` |
| 完整 URL | `https://github.com/user/repo`（可带 `.git`） |
| 子目录 | `https://github.com/user/repo/tree/dev/plugins/demo` |

拉取优先经 GitHub contents API、失败降级 `raw.githubusercontent.com`（通道选择与新鲜度
见 §8.4），安装过程复用与粘贴安装相同的清单校验与权限确认管线。

### 8.3 插件市场收录

应用内市场数据源为独立仓库 [OneTHU-Market](https://github.com/smartThise/OneTHU-Market)。
市场仓库**只收录插件元信息与源码仓库地址**，不收录插件代码——插件本体始终存放在
作者自己的 GitHub 仓库，安装时由应用直接拉取。`registry.json` 为收录名单，应用端
拉取展示、按仓库热度排序、搜索，点击安装即从条目 `repo` 拉取入口模块。名单条目
格式：

```json
{
  "id": "onethu.your-plugin",
  "name": "插件名",
  "version": "1.0.0",
  "author": "作者",
  "description": "一句话说明",
  "repo": "user/your-repo",
  "entry": "plugin.js",
  "tags": ["分类"]
}
```

**提交流程**：Fork OneTHU-Market → 在 `registry.json` 追加条目 → 提交 Pull Request。
审查（当前为人工）要点：仓库存在且入口可拉取可解析；`manifest` 与条目信息一致；
权限声明与功能匹配、无超范围权限；无混淆代码、无远程动态拼装代码、无凭据收集
行为。合并即收录，用户端刷新或等缓存过期（5 分钟）后可见。

> **收录 = 上目录，不 = 更新闸门**：市场名单只是目录快照（名称/描述/仓库地址/收录时的版本）。
> 插件发布新版本**不需要**再向 OneTHU-Market 提 PR——用户端以插件本体仓库的最新 manifest 为准
> （见 §8.4），市场条目的 version 仅在「用户未按仓库检查」时作为兜底提示。

### 8.4 更新检查与拉取新鲜度

**插件本体仓库优先**：设置 → 插件 → 已安装卡片（带仓库来源的 JS 插件）自带「检查更新」。
点击后直接从插件本仓库拉取入口模块并解析最新 manifest（**contents API 优先、raw 降级**，
与安装同一管线；raw 的 Fastly 边缘节点会短时吐推送前旧内容，且忽略 query 的 cache-buster）。
仓库版本更新时卡片出现「更新至仓库版 vX」按钮——走与安装完全相同的校验管线，覆盖安装并重新激活。

- 发布新版本 = **只更新自己的仓库**即可，无需向 OneTHU-Market 提交任何改动。
- 市场条目的 `version` 是收录时的快照，**不再作为更新判据**；仅当用户没有对仓库做检查、
  且本地缓存的名单中该 ID 版本更高时，才会显示「可更新 ↑」（跳市场视图）。
- 检查/更新动作是用户主动行为，取数时都会带 cache-buster 并优先 contents API，避免读到旧内容。

补：卡片的「检查更新」仅对 `kind == "js"` 且仓库来源可解析的插件出现；内置（OH）与
rust 插件仍按各自生命周期处理（内置随 App 升级，rust 分发不走 GitHub 单文件机制）。

### 8.4.1 公告热通道（`NOTICE.md` 约定）

插件可在清单声明 `announce: true`，宿主在插件每次启动/打开时后台拉取插件仓库根的
`NOTICE.md`（每插件 10 分钟限频；失败静默不影响插件使用），内容 digest 变化时在插件
卡片弹「📢 公告」框——继承 OneTHU 的显示语义（max-height 有限滚动 + 「知道了」收起），
用户无需手动刷新。插件代码不经手该文本（宿主渲染），便于安全展示。

- `NOTICE.md` 建议保持短文本（≤1600 字符，加 markdown）；重要运营、规则变更、紧急修复
  说明等写这里即可；
- 公告内容直接来自插件作者**自己的仓库**，不经过 OneTHU 市场仓库、不易受编辑干扰。

raw 域名的 Fastly 边缘节点会短时返回推送前的旧内容，且该缓存**忽略 query 参数**
（附加时间戳的 cache-buster 无效），不作为首选通道；contents API 拉取入口模块在
未认证时可降级至 raw，此时可能短暂读到旧内容。

## 9. Rust sidecar 协议与 OH 扩展

### 9.1 通信格式

Rust 插件（sidecar 与内嵌两种形态共用核心）经 stdio 上的行分隔 JSON-RPC 与宿主通信；
本节 §9.3–9.5 为官方 OH 插件对外提供的扩展通道。宿主发往插件：

| 消息 | 说明 |
|---|---|
| `activate`（含 `settings`、`permissions`） | 进程启动后的握手请求，必须应答，`result` 需包含命令清单 `{"commands":[…]}` |
| `run`（含 `command`、`input`） | 执行命令。长任务可先返回进度通知，最后必须应答最终结果 |
| `interrupt` | 打断请求（通知，无 `id`），应立即终止当前执行 |
| `dispose` | 停用或卸载前的退出请求，应答后进程应自行退出 |

插件发往宿主：

| 消息 | 说明 |
|---|---|
| `onethu.call`（含 `ns`、`method`、`args`） | 调用 API，参数按位置传递；宿主以 `result` 或 `error` 回写 |
| `progress` | 进度通知；对话面板场景支持 `kind` 字段，见 §10 |
| `log` | 日志行，展示于轨迹面板 |

### 9.2 实现约束

- **标准输入锁不可重入**：`for line in stdin().lock().lines()` 会在整个循环期间持有
  锁，循环体内再次调用 `stdin().lock()` 读取应答会造成死锁。应全程只加锁一次，
  并在辅助函数中复用同一个 `&mut StdinLock`。完整实现见
  `examples/harness-skel/`（可直接执行 `cargo build`）。
- **应答超时**：`run` 请求的应答超时为 10 分钟，进度通知不重置计时。超时仅使该次
  调用报错，进程继续运行，仍可发送进度与接收打断。
- 不应依赖工作目录；宿主不保证当前目录。
- 退出码非 0 或标准输出关闭时，宿主发出 `exit` 事件并清理进程记录。

### 9.3 OH 收藏工具

OH 对话内可直接把信息收进用户收藏夹，与插件收藏共用同一套原子体系：

| 工具 | 说明 |
|---|---|
| `list_favorite_kinds` | 列出可收藏的原子种类（内置页面与实体、插件注册的种类），返回 kind 与分组 |
| `add_favorite` | 收藏一条信息：`title`（卡片标题，必填）、`key`（稳定引用，必填）、`note`（第二行说明，可选） |

`add_favorite` 的原子 kind 固定为 `plugin:onethu.harness`，`key` 缺 `fav:` 前缀时
自动补全，落点为「对话收藏」分组；同一 key 重复收藏不重复添加。该分组的卡片当前
点击提示来源（OH 尚无自建功能页），OH 提供功能页后可改为深链。

**另一条落点通道**（2026-10-15 起）：应用里「收藏一颗元素」已经有了**先选落点**的语义
（首页 / 已有 OnePage / 最后才是新建），OH 侧对应工具是 `onePage_collect`（不给 `boardId`
即落首页，给了就落那块 OnePage；同板同原子返回 duplicate）。两者不是一件事：
`add_favorite` 进的是「收藏夹」分组（`fav:` 引用），`onePage_collect` 放的是白板上的
atom-link 组件（条目坐标由数据层的查重+落位负责，OH 不自己写坐标）。

**一句话直达**：OH 的 `open_page` 工具经宿主 `nav.searchAtoms` 与 `nav.openAtom` 工作
（见 api-reference §18），因此「打开亲友来访」这类说法无需预先约定路由，检索到的对象即可
打开。检索范围为静态注册表（功能页面 / 今日组件 / 操作原子）与本机缓存（课程、作业、通知、
文件、在线服务、场馆、教学楼、洗衣机楼、图书馆、新闻等）。

两点限制：①`nav.searchAtoms` **不发起任何校园请求**，因此只能返回本机已出现过的实体；
②`nav.openAtom` 无法解析原子时返回 `false`，此时应答应说明需先在对应页面打开一次，不得
表述为应用不具备该能力。

**在线服务无需事先打开**：OH 的 `open_page` 在本机检索为空时会调用一次 `services.search`
作为兜底（宿主门面，检索校园服务大厅目录，声明 `info:read` 权限即可使用）。该接口按匹配
分值决定动作：40 分以上的简称（「亲友预约」对应「亲友来访预约」）直接打开；20~39 分的近似
名称（如「亲友入校报备」）**仅返回候选、不跳转**，由用户确认后再打开。查询失败与「目录中
确无该服务」应分别说明，不得将检索失败表述为学校未提供该服务。命中的目录条目同时写回本机
原子缓存，此后本机检索可离线命中。同一条兜底通道对插件同样可用（api-reference §18）。

外部插件亦可使用同一能力：清单声明 `nav` 权限后调用 `nav.searchAtoms` 与 `nav.openAtom`，
即可实现由插件发起、跳转到应用内任意页面。

**OH 读取本机使用统计**（`nav.usage`，api-reference §21.1）：`query_usage` 工具用于回答
近期使用情况，返回的 `kind` / `key` 可直接传给 `open_page` 打开。今日页的
「最近使用 / 猜你喜欢」两张卡（默认位于侧栏；无数据时整卡不渲染）与其读取同一份数据，
均由 `lib/usage.ts` 与 `lib/suggest.ts` 驱动；统计只记录入口使用次数，**不会改写用户
收藏夹**。


### 9.4 OH 联动插件（MCP 之外的扩展通道）

OH 的工具集除内置校园工具外，还内置两个联动工具，使模型可以调用**其他已启用
插件**的能力：

- `list_plugin_cmds`：列出已启用插件的命令清单，包含每个命令的 `agentHint`（插件自己写的适用场景/续读提示）；
- `run_plugin_cmd`：执行某插件命令（`pluginId` / `cmdId` / `input`）。

调用经宿主 `onethu.plugins.*` 门禁（OH 清单声明 `plugins:call` 权限）。**安全
提示**：插件命令可能包含写操作，模型被指示执行前向用户说明；写型命令应由插件
内部实现两段式确认（参照 OH 的 ConfirmNeeded 机制）。

### 9.4.1 插件主动提示（agentHint v2）

命令的 `agentHint` 只在 `list_plugin_cmds` 被调用时可见；如果希望插件**主动**把提示送进上下文，
用 `registerAgentHint`：

```js
ctx.registerAgentHint({
  id: "pdf-reading",
  text: "读取无 ToUnicode 的课件 PDF 时，先找 read_pdf 命令，按页续读……",
  triggers: [
    { kind: "session-start" },
    { kind: "keyword", keywords: ["PDF", "课件", "讲义"] },
    { kind: "command", commandId: "read_pdf" }
  ],
  priority: 10
});
```

| 触发 | 注入时机 |
|---|---|
| `session-start` | 新会话第一轮，作为系统提示中的插件能力说明 |
| `keyword` | 当前用户输入命中关键词时，进入**当轮**上下文 |
| `command` | 该命令经 `run_plugin_cmd` 执行时，随本次工具结果返回 |

宿主限制：

- 每轮最多 3 条、每条 600 字，按 `priority` 降序截断；
- 只筛选已启用插件；停用/卸载即移除；
- 文本是第三方能力说明，作为不可信数据标注，不授予权限、不覆盖用户指令；
- 插件不能直接修改系统提示词，只能声明触发条件，由宿主筛选。

### 9.5 OH 接入 MCP 服务器

OH 可作为 MCP（Model Context Protocol）客户端调用外部工具。服务器在
「插件 → OneTHU Harness 卡片 → MCP」中逐条管理（添加 / 编辑 / 删除），每条
为一个 stdio server：

| 字段 | 说明 |
|---|---|
| 名称 | 工具前缀（工具全名 `mcp_<名称>_<工具>`） |
| 启动命令 | 如 `npx`、`uvx`、`/usr/bin/node` |
| 参数 | 空格分隔，支持引号包裹含空格的项（如 `-y @modelcontextprotocol/server-filesystem /Users/me/docs`） |
| 环境变量 | `KEY=VALUE` 空格分隔 |

实现为 **stdio 传输 + 冷启动模式**：每次工具调用重新 spawn server 进程
（initialize → tools/list 或 tools/call → kill），无长驻进程，服务崩溃不影响宿主。
MCP 工具与校园工具、联动插件工具同轮混用。当前为最小实现：不支持
resources/prompts 与 OAuth 授权，需要这些能力的 server 暂不适用。

### 9.6 OH 反过来当 MCP 服务器（把 OneTHU 暴露出去）

上面那节是**出方向**（OH 去连别人）；反方向也通了：OH 自己可以在本机当 MCP 服务器，
让本机其它 MCP 客户端（另一个 agent、脚本、编辑器插件）直接调用 OneTHU 的工具。

| 项 | 说明 |
|---|---|
| 开关 | 设置 → 插件 → OneTHU Harness → 高级配置 →「OH MCP 服务器」（**默认关**，本机暴露必须由用户显式打开） |
| 端点 | `http://127.0.0.1:8787/mcp`（Streamable-HTTP，POST JSON-RPC：`initialize` / `tools/list` / `tools/call`）；端口可用环境变量 `OH_MCP_PORT` 改，`0` = 连监听都不起 |
| 暴露范围 | 只暴露**无需交互确认**的工具（`confirm: true` 的写操作不上墙）；仅本机回环，不跨机 |
| 关着时 | 任何连接一律 **403** 并明确回「未开启 + 去哪开」（不是超时、也不是空工具表） |
| 生效时机 | 拨完开关后发一条消息或重开 OH（每轮对话同步一次闸门） |

OH 侧有只读工具 **`mcp_status`** 报这一整套状态（开关、监听是否就位、端点、暴露/扣下的
工具数、开关位置、反向的 `mcpServers` 是另一件事），所以用户问「怎么让别的客户端连上你」
时 OH 答得出实事。注意闸门与监听是两件事：listener 常驻绑定，真正决定接不接受请求的是
设置里那个开关。

## 10. 对话面板协议

Rust 插件在激活应答中将某命令标记 `dock: true`，宿主即为其渲染常驻对话面板：

```json
{ "commands": [
  { "id": "chat", "title": "对话", "inputLabel": "输入指令", "dock": true }
] }
```

面板提交消息等价于 `run { command: "<该命令 id>", input: "<用户输入>" }`。

对话命令的应答为结构化 JSON：

| 字段 | 说明 |
|---|---|
| `answer` | 最终回答文本 |
| `sessionId` | 会话标识 |
| `interrupted` | 是否被用户打断 |
| `confirm` | 非空时面板渲染确认控件，用户确认等价于发送文本「确认」。所有写操作必须经此确认流程 |
| `usage` / `sessionUsage` / `totalUsage` | 本次、会话与累计用量及预算 |

进度通知的 `kind` 取值：`delta`（回答增量）、`think`（思考增量）、`tool`（工具调用
轨迹）、`notice`（状态行）、`usage`（用量刷新）。

会话管理命令的约定命名：`new_session`、`list_sessions`、`switch_session`、
`delete_session`、`export_session`、`import_session`、`usage_report`、`selftest`。

## 11. Android 内嵌形态

Android WebView 环境不允许执行任意路径的二进制文件，sidecar 形态在移动端不可用。
官方 Harness 插件采用同一份 Rust 核心编译进应用进程的方式实现，通信经 Tauri 命令桥
而非 stdio。要点：

- 工程结构：`plugins/OneTHU-Harness` 为 Cargo 工作区，`core/` 为宿主无关库（仅依赖
  `Host` 与 `Emit` 两个 trait），`bin/` 为桌面 stdio 外壳。
- 宿主命令必须为异步。Tauri v2 的同步命令在主线程执行，曾因同步实现的
  `harness_bridge_take` 阻塞主线程 25 秒，导致 Android 端全局操作停顿。
- 调用链：core 的 `Host::call` → 桥线程 → 消息队列 → JS 泵长轮询批量取走 →
  webview 门面（同一套权限门禁）→ 经 Rust 传输层发出请求 → 回写结果。
- loader 在 Android 宿主开机时写入 `onethu.harness` 内置记录
  （`builtin` + `embedded`），不可删除；清单与镜像不一致时自动重新注册，设置保留。

第三方 Rust 插件不提供移动端形态。

## 12. 调试

| 方式 | 说明 |
|---|---|
| `ctx.log(line)` / `log` 通知 / 标准错误输出 | 写入应用调试通道，前缀 `[PLUGIN:<id>]` |
| 桌面端日志文件 | `/tmp/onethu-debug.log` |
| Android 日志 | `adb logcat -s onethu`，或 `adb logcat -d --pid=$(adb shell pidof app.onethu.desktop)` |
| 端到端自测 | OneTHU-Harness 的 `test/sim_host.mjs`：模拟宿主门面与 OpenAI SSE 服务，覆盖握手、工具调用、流式输出、用量统计、会话管理与两段式确认 |

## 13. 版本记录

| 版本 | 变更 |
|---|---|
| v1.27 | 插件主动提示：新增 `ctx.registerAgentHint`，支持会话开始/关键词/命令三种触发；宿主按 priority 每轮最多注入 3 条（每条 ≤600 字），Harness 在会话首轮、当前轮和命令结果中消费 |
| v1.26 | 插件命令新增 `agentHint`：随 `plugins.list` / `list_plugin_cmds` 输出，插件自行说明适用场景与续读方式；OH 系统提示词改为通用“先查插件命令并读提示”，移除 PDF 专属硬编码 |
| v1.25 | 新增 `fonts.system`（`font:read`）：按白名单读系统字体，供插件做字形轮廓匹配；配套 `lib/systemFonts.ts`、`tools/system-font-test.mjs` |
| v1.24 | 插件功能页并入 **OneShot 候选**（`state/quickAccess.ts`）：插件 tab 与一级页并列出现在快速入口/更多功能配置里；配合既有 `ext.homeDock`，插件页可同时进「首页一级功能区」与「OneShot」 |
| v1.23 | 新增 `learn.fileContent`：读取课件/附件**原始字节**（base64，≤64MB），走 learn 专线会话（webvpn 包装域 + 原生 cookie 仓 + `_csrf`），供插件解析 PDF 等二进制；与 `learn.download`（落盘返回路径）互补 |
| v1.22 | 新增白板**插件交互卡片**：`ext.actionCard` / `ext.actionCardRemove`（`ui`）。插件在白板/首页放一张卡片，点击执行自己的命令并把返回文本显示在左上角；同 cardId 就地更新，停用显示「插件已停用」；配套 `state/pluginAction.ts` 纯数据层与渲染壳 `components/PluginActionCard.tsx` |
| v1.21 | 新增 `gitlab` 命名空间与 `gitlab:read` / `gitlab:write` 权限：项目、仓库文件、Issue、合并请求（讨论线程、回复、解决、表情回应、指派、文件变更、新建与合入）、流水线与作业日志，以及条目计数与 ZIP 归档（api-reference §17）；桌面新增 GitLab 页与 `gitlab.ts` 状态层 |
| v1.20 | 插件公告热通道（§3.1 `announce` 字段 + §8.4.1 `NOTICE.md` 约定）：激活/打开时后台拉取仓库公告，digest 判新，卡片弹「📢 公告」；**市场列表版本号实时化**：已装卡片/网页市场卡片的版本号直接从各插件仓库最新 manifest 取，名单快照仅作兜底显示 |
| v1.19 | 插件更新机制：已安装插件卡片自带「检查更新/更新」（本体仓库优先：直接拉仓库最新 manifest 比版本，与安装同管线覆盖更新）；市场名单 version 降级为收录快照，不再要求作者同步维护 |
| v1.18 | 新增 `ws` 命名空间与 `ws:external` 权限（§6.＋api-reference §21）：宿主 WebSocket 桥（长连接生命周期全在宿主 Rust 层，文本/b64 双通道、按插件配额与 TTL 清扫、无跨源限制、可注入握手头；宿主命令缺失时自动回落页面级 WebSocket） |
| v1.17 | 小组件行数改为按桌面占位的**真实高度**铺满（不再按矮/中/高估算并封顶 5 行，布局备 20 条槽位、快照给足候选行）；脚注改为「显示出来的行数 + 还没显示的项数」，两者之和恒等于仍有效条目总数 |
| v1.16 | `ui.confirm` 的 `opts` 新增 `title` 与 `confirmText`：危险样式应显式提供标题与确认按钮文案；宿主兜底为通用措辞，多场景共用同一句时提示缺乏针对性 |
| v1.15 | 服务名匹配改为分档打分（100 / 80+ / 70 / 40+ / 20~35，`SERVICE_CONFIDENT=40`）：40 分及以上直接打开，近似名称仅返回候选由用户确认；`services.search` 返回 `score`；OH 兜底查询失败时如实上报，不再统一回复「没有相近名称」 |
| v1.14 | 插件 API 新增 `services.search` / `services.open`（在线服务目录检索与应用内打开，支持简称匹配）；OH `open_page` 本机未命中时自动检索服务目录（§9.3） |
| v1.13 | 今日页新增「最近使用 / 猜你喜欢」两张按本机使用习惯生成的卡（空则不渲染）；插件 API `nav` 新增 `usage` / `clearUsage`；OH 新增 `query_usage` 工具 |
| v1.12 | 插件 API `nav` 新增 `searchAtoms` / `openAtom`（按名称检索并打开任意原子，检索仅覆盖静态注册表与本机缓存）；OH 新增 `open_page` 工具（直达在线服务 / 课程 / 实体，§9.3）；在线服务目录注册为原子种类 `thos-service`（收藏与 OH 直达共用同一份引用） |
| v1.11 | 小组件内容改为**按块绑定**（日程与 DDL / 一个原子占满 / 收藏夹图标组 / 快捷方式四类），宿主新增 1×1 快捷方式形态（共五种），放置时经 configure 流程直接弹出选择层，原子图标在应用侧栅格化成 PNG 后下发；插件 API 改为 `widget.instances` / `bind` / `unbind` / `getFallback` / `setFallback` |
| v1.10 | 宿主小组件内容可选（今天 / 收藏夹 / 收藏原子，设置页与收藏夹页双入口）、四种初始形态（3×2 / 2×2 / 2×1 / 4×1，行数按占位自适应）、点击落点支持页面参数；插件 API 新增 `widget.getSource` / `widget.setSource` / `widget.folders` |
| v1.9 | 插件小组件与系统通知：§6.5 声明式桌面小组件（`ctx.registerWidget`，3 个预留槽位、原子行解析、点击落点）与 §6.6 系统通知（`onethu.notify.send/cancel/status`，通知 id 归插件）；新增权限 `widget`、`notify` |
| v1.8 | 新增 §8.4 更新检查与拉取新鲜度（contents API 优先、raw 降级、名单版本号人工维护）；OH 收藏工具独立为 §9.3（其余 §9 子节顺延至 9.5）；§8 与 §9 子节编号修正 |
| v1.7 | UI 自由化：§6.3 自建功能页（registerTab + onTabReady 自由渲染 DOM）与 registerCss 全局样式（新权限 css）；§6.4 原子化收藏（registerAtom 注册原子种类，favorites.add/list 收藏进宿主收藏夹并深链回插件 tab） |
| v1.6 | 插件平台化：§6 UI 通道（confirm/form/clipboard）与结构化命令结果（markdown/items/kv）；OH 联动插件（§9.4）与 MCP 客户端（§9.5，stdio 冷启动）；新增权限 clipboard:read、plugins:call |
| v1.5 | 新增 §8 发布插件：插件市场（OneTHU-Market 名单仓库，人工审查收录）与 GitHub 仓库直装 |
| v1.4 | 新增 `ts` 命名空间与 `tsinghua:sdk` 权限（自定义清华服务接入 SDK：会话复用、通道分流、自愈重放）；新增 §7 接入指南 |
| v1.3 | 文档重写为标准格式；新增 `llm`、`theme`、`exthw:read`、`exthw:refresh`、`webview` 权限，新增 `llm`、`theme`、`exthw` 命名空间与 `ui.webModal`；设置项新增 `select` 类型 |
| v1.2 | 新增 `cal` 命名空间与日程云同步（CalDAV） |
| v1.1 | 新增 `learn`、`venue`、`xk`、`kongjian`、`coursex` 命名空间 |
| v1.0 | 首个公开版本 |

## 视觉与身份字段（2026-10-12 市场升级）

以下字段**全部可选、向后兼容**：老插件不写照常显示（列表回落 monogram，详情回落 description）。

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `logo` | string | 作者 logo：http(s) URL **或仓库相对路径**（svg/png 都行） | `"assets/logo.svg"` |
| `thumbnail` | string | 列表缩略图（比 logo 更"图片化"那张）；缺失回落 `logo`，再缺失回落 monogram | `"assets/thumb.png"` |
| `screenshots` | string[] | 详情页简介图，按数组顺序展示；点击可放大 | `["assets/s1.png","https://…/s2.png"]` |
| `readme` | string | 详情正文（**markdown 文本**；支持 GFM 表格/列表/代码块/图片）；缺失回落 `description` | `"# 特性\n- …"` |
| `description` | string | 一句话简介（列表与详情都会用） | `"把课程表接进今日页"` |
| `author` | string | 作者名（列表 meta 行显示） | `"@someone"` |
| `homepage` | string | 主页 / 文档地址（详情页给「主页」按钮） | `"https://example.com"` |
| `license` | string | 许可证标识（详情页 meta 行显示） | `"MIT"` |

**路径规则**：写成仓库相对路径（如 `assets/logo.svg`）时，客户端会解析成
`https://raw.githubusercontent.com/<owner>/<repo>/<branch|main>/<subPath>/资源路径`（见 `lib/market.ts` 的 `resolveAssetUrl`）；
写绝对 URL 则原样使用。解析失败不裂图（回落到 monogram / 不渲染那张图）。

**主题类插件**：`category: "theme"` 的主题插件在市场详情里可直接「启用主题 / 停用主题」（沿用插件卡片的开关语义）。
**主题插件的规范声明（2026-10-12 统一判定）**：`manifest.category === "theme"` **或** 直接带非空 `themes: ThemeDef[]` 数组（**推荐后者**——这样外观与布局的「主题」板会自动收录，插件的分类、计数、市场筛选也都会认它）。
判定实现唯一一份：`apps/desktop/src/lib/market.ts` 的 `isThemeEntry()`（市场筛选、我的插件分类、计数、插件加载器注册主题、外观板可见性全部走它）。
**不用** tags / keywords 兜底：标签是自由文本，"只有 tags 没有 themes/category"的条目**不算**主题插件。
