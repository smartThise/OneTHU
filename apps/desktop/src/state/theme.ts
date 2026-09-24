/**
 * OneTHU 主题插件系统 v1（2026-09-13 立项：「神秘的主题插件系统」）
 *
 * 主题就是一种插件：manifest.category === "theme"，模块导出 `theme`（ThemeDef）
 * 而非 default(ctx)。主题只做「令牌覆盖」——改 tokens.css 的 CSS 变量（配色/
 * 字体/圆角/阴影）、换品牌 logo、附加受信 CSS；不触碰组件结构与布局骨架
 * （原子化、左栏右内容、卡片上下左右的排布恒定，这是主题的边界契约）。
 *
 * 内置主题与外部安装的主题同权：都可以停用、删除；删除内置主题会记入
 * 「已删内置」名单（不在下轮启动复活），可一键恢复全部内置。
 */

import { useSyncExternalStore } from "react";

/** 主题定义（插件模块 export const theme: ThemeDef） */
export interface ThemeDef {
  /** 唯一 id（建议 onethu.theme.xxx / 反域名） */
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** 配色核心：tokens.css 变量覆盖（--accent / --accent-soft / --bg / --font-ui …） */
  vars: Record<string, string>;
  /** 字体栈覆盖 */
  fonts?: { ui?: string; mono?: string };
  /** 品牌 logo 替换（inline SVG 字符串，viewBox 24×24 最佳） */
  logo?: string;
  /** 附加 CSS（主题是受信代码，同插件；建议自行用 [data-theme] 限定作用域） */
  css?: string;
  /** 暗色主题声明：true → color-scheme: dark（原生控件/滚动条跟随）+ 昼夜调度可选中 */
  dark?: boolean;
  /** 来源：builtin 内置 | plugin 插件安装（勿手填） */
  source?: "builtin" | "plugin";
  /** 来源插件 id（source=plugin 时由 loader 写入，勿手填）：插件卸载/停用/覆盖安装时
   *  据此回收主题，避免「主题区删了插件卡还在」「插件删了主题还在」两处状态不同步 */
  owner?: string;
}

/** 快照（useSyncExternalStore 消费） */
export interface ThemeSnapshot {
  themes: ThemeDef[];
  activeId: string | null;
  /** 当前主题的 logo SVG（无则 null → 用默认 BrandLogo） */
  logoSvg: string | null;
  /** 被删除的内置 id（恢复按钮可见性依据） */
  deletedBuiltins: string[];
  /** 昼夜调度状态（UI 的外观设置区消费） */
  followSystem: boolean;
  dayThemeId: string | null;
  nightThemeId: string | null;
  /** 系统当前是否暗色（跟随模式下实际生效的是哪一档） */
  systemDark: boolean;
}

/* ---------- 内置主题（令牌覆盖五种气质；全部可删） ---------- */

const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: "onethu.theme.ivory",
    name: "象牙 · 默认",
    version: "1.0.0",
    author: "OneTHU",
    description: "中性蓝灰阶 + 业务蓝强调：tokens.css 原样，无覆盖。",
    vars: {},
    source: "builtin",
  },
  {
    id: "onethu.theme.violet",
    name: "紫水晶",
    version: "1.1.0",
    author: "OneTHU",
    description: "紫罗兰主按钮 + 雾紫晕染的纸面。",
    vars: {
      "--primary": "#6d28d9",
      "--primary-hover": "#5b21b6",
      "--accent": "#7c3aed",
      "--accent-soft": "#f1e7fd",
      "--accent-border": "#d8c2f7",
      "--hover": "rgba(88, 28, 135, 0.07)",
      "--active": "rgba(88, 28, 135, 0.12)",
      "--ring": "0 0 0 3px rgba(109, 40, 217, 0.25)",
      "--bg": "#fbfaff",
      "--bg-soft": "#f6f1fe",
      "--surface": "#fefeff",
      "--surface-2": "#f3ecfc",
      "--surface-3": "#e8dcf7",
      "--border": "rgba(88, 28, 135, 0.13)",
      "--text-1": "#1e1432",
    },
    source: "builtin",
  },
  {
    id: "onethu.theme.celadon",
    name: "青瓷",
    version: "1.1.0",
    author: "OneTHU",
    description: "青绿主按钮 + 瓷面水色的冷调。",
    vars: {
      "--primary": "#0f766e",
      "--primary-hover": "#115e59",
      "--accent": "#0d9488",
      "--accent-soft": "#e0f4f1",
      "--accent-border": "#b8e2db",
      "--hover": "rgba(13, 90, 84, 0.07)",
      "--active": "rgba(13, 90, 84, 0.12)",
      "--ring": "0 0 0 3px rgba(15, 118, 110, 0.25)",
      "--bg": "#f9fcfb",
      "--bg-soft": "#f0f7f5",
      "--surface": "#fdfffe",
      "--surface-2": "#edf5f2",
      "--surface-3": "#dcebe6",
      "--border": "rgba(15, 90, 84, 0.14)",
      "--text-1": "#10251f",
    },
    source: "builtin",
  },
  {
    id: "onethu.theme.warmsand",
    name: "暖沙",
    version: "1.0.0",
    author: "OneTHU",
    description: "沙金强调、暖纸底色，黄昏质感的纸面。",
    vars: {
      "--accent": "#c2740a",
      "--accent-soft": "#fbf1e0",
      "--accent-border": "#ecd9ab",
      "--hover": "rgba(120, 78, 20, 0.07)",
      "--active": "rgba(120, 78, 20, 0.12)",
      "--ring": "0 0 0 3px rgba(194, 116, 10, 0.22)",
      "--bg": "#fffdf9",
      "--bg-soft": "#faf6ee",
      "--surface-2": "#f7f2e8",
    },
    source: "builtin",
  },
  {
    id: "onethu.theme.midnight",
    name: "墨蓝夜航",
    version: "1.1.0",
    author: "OneTHU",
    description: "海军蓝主按钮 + 冷雾蓝灰阶：夜航仪表盘。",
    vars: {
      "--primary": "#1e3a8a",
      "--primary-hover": "#1e40af",
      "--accent": "#2563eb",
      "--accent-soft": "#e3ecfd",
      "--accent-border": "#b9cdf5",
      "--hover": "rgba(30, 58, 138, 0.07)",
      "--active": "rgba(30, 58, 138, 0.12)",
      "--ring": "0 0 0 3px rgba(30, 64, 175, 0.25)",
      "--bg": "#f7f9fd",
      "--bg-soft": "#f1f5fb",
      "--surface": "#fdfeff",
      "--surface-2": "#eef2f9",
      "--surface-3": "#dde5f2",
      "--border": "rgba(30, 58, 138, 0.14)",
      "--text-1": "#101828",
    },
    source: "builtin",
  },
  {
    id: "onethu.theme.night",
    name: "凝夜",
    version: "1.0.1",
    author: "OneTHU",
    dark: true,
    description: "深夜工作台：墨蓝黑纸面 + 亮钢蓝强调，昼夜调度的黑夜档。",
    vars: {
      "--bg": "#0e1117",
      "--bg-soft": "#12161f",
      "--surface": "#151a24",
      "--surface-2": "#1a2030",
      "--surface-3": "#232b3d",
      "--skeleton": "rgba(255, 255, 255, 0.06)",
      "--skeleton-shine": "rgba(255, 255, 255, 0.12)",
      "--border": "rgba(255, 255, 255, 0.1)",
      "--border-soft": "rgba(255, 255, 255, 0.05)",
      "--border-strong": "rgba(255, 255, 255, 0.18)",
      "--text-1": "#e8ebf2",
      "--text-2": "#a3abb8",
      "--text-3": "#7d8494",
      "--text-dim": "#3a4152",
      "--primary": "#e8ebf2",
      "--primary-hover": "#c6ccd8",
      "--on-primary": "#0e1117",
      "--accent": "#6b9bff",
      "--accent-soft": "rgba(107, 155, 255, 0.14)",
      "--accent-border": "rgba(107, 155, 255, 0.35)",
      "--red": "#ff736f",
      "--red-soft": "rgba(229, 72, 77, 0.16)",
      "--amber": "#ffb457",
      "--amber-soft": "rgba(217, 115, 13, 0.16)",
      "--green": "#4ade80",
      "--green-soft": "rgba(34, 197, 94, 0.14)",
      "--hover": "rgba(255, 255, 255, 0.06)",
      "--active": "rgba(255, 255, 255, 0.1)",
      "--shadow-1": "0 2px 4px rgba(0, 0, 0, 0.4)",
      "--shadow-2": "0 2px 8px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.3)",
      "--shadow-3": "0 0 1px rgba(0, 0, 0, 0.6), 0 12px 32px rgba(0, 0, 0, 0.45)",
      "--ring": "0 0 0 3px rgba(107, 155, 255, 0.35)",
    },
    css: `/* 凝夜：硬编码浅色残面的定点修补（global.css 不改动，主题层覆盖） */
:root[data-theme="onethu.theme.night"] .plg-pin.is-oh { background: var(--surface-2); color: var(--text-1); }
:root[data-theme="onethu.theme.night"] .plg-switch i { background: #e8ebf2; }
:root[data-theme="onethu.theme.night"] img { opacity: 0.92; }`,
    source: "builtin",
  },
];

const STORE_KEY = "onethu.theme.v1";
const STYLE_ID = "onethu-theme-style";

interface PersistShape {
  installed: ThemeDef[];
  activeId: string | null;
  deletedBuiltins: string[];
  /** 昼夜调度：跟随系统暗/亮自动切换日/夜两档主题（false=手动单选，向后兼容） */
  followSystem: boolean;
  dayThemeId: string | null;
  nightThemeId: string | null;
}

let state: PersistShape = { installed: [], activeId: null, deletedBuiltins: [], followSystem: false, dayThemeId: null, nightThemeId: null };
let systemDark = false;
let logoSvg: string | null = null;
const listeners = new Set<() => void>();
/** getSnapshot 缓存：useSyncExternalStore 要求引用稳定，每次新建对象
 *  会触发无限重渲染循环（React getSnapshot cache 契约）——白屏实锤 */
let snapCache: ThemeSnapshot | null = null;

function emit(): void {
  snapCache = null;
  for (const fn of listeners) fn();
}

function persist(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    /* 配额/隐私模式：内存态照常工作，仅不落盘 */
  }
}

/** 启动装载：读持久态；首次（或内置缺失且未被删）播种内置主题 */
function bootstrap(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistShape;
      if (Array.isArray(parsed.installed)) {
        state = {
          installed: parsed.installed.filter((t) => t && typeof t.id === "string" && t.vars),
          activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
          deletedBuiltins: Array.isArray(parsed.deletedBuiltins) ? parsed.deletedBuiltins : [],
          followSystem: parsed.followSystem === true,
          dayThemeId: typeof parsed.dayThemeId === "string" ? parsed.dayThemeId : null,
          nightThemeId: typeof parsed.nightThemeId === "string" ? parsed.nightThemeId : null,
        };
      }
    }
  } catch {
    /* 损坏即重置 */
  }
  const deleted = new Set(state.deletedBuiltins);
  const have = new Set(state.installed.map((t) => t.id));
  const seeds = BUILTIN_THEMES.filter((b) => !deleted.has(b.id) && !have.has(b.id));
  if (seeds.length > 0) {
    state.installed = [...seeds, ...state.installed];
    persist();
  }
  // 内置升级通道：已安装的内置主题若与随版本分发的新定义不一致，整体刷新为新定义
  // （用户改不掉内置的"出厂设置"，但删除名单依然生效）。
  // ⚠️ 判据是「版本号 或 令牌集」——只比版本会踩坑：给内置主题补一个令牌却忘了升版本，
  // 存档旧副本将永远缺该令牌（霖实测：night 补 --skeleton-shine 未升版本 → 暗色下骨架
  // 流光仍走 CSS 兜底白光）。令牌集比较兜住这类遗漏；source 为 plugin 的不动（插件
  // 可能占用同名 id，不能拿内置定义覆盖）。
  let upgraded = false;
  const shipped = new Map(BUILTIN_THEMES.map((b) => [b.id, b]));
  const varsDiffer = (a: Record<string, string> = {}, b: Record<string, string> = {}): boolean => {
    const ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return true;
    return ak.some((k) => a[k] !== b[k]);
  };
  state.installed = state.installed.map((t) => {
    const fresh = shipped.get(t.id);
    if (!fresh || t.source === "plugin") return t;
    if (t.version !== fresh.version || varsDiffer(t.vars, fresh.vars)) {
      upgraded = true;
      return fresh;
    }
    return t;
  });
  if (upgraded) persist();
  applyActive();
}

/** 上一次真正应用的主题 id（null=基础亮色）；只用于判断"是不是切换" */
let lastThemeId: string | null = null;
let themeAnimTimer: ReturnType<typeof setTimeout> | null = null;
/** 短暂挂 .theme-anim：颜色类属性走 320ms 过渡（motion.css §14），到点摘掉不留副作用 */
function flashThemeAnim(root: HTMLElement): void {
  // 测试替身/极简宿主可能没有 classList：没有就跳过（动效是锦上添花，绝不能挡住主题切换）
  if (!root.classList) return;
  root.classList.add("theme-anim");
  if (themeAnimTimer) clearTimeout(themeAnimTimer);
  themeAnimTimer = setTimeout(() => {
    root.classList.remove("theme-anim");
    themeAnimTimer = null;
  }, 420);
}

/** 生成并注入主题样式；html[data-theme] 挂钩（清除用 null） */
function applyTheme(def: ThemeDef | null): void {
  const root = document.documentElement;
  // 主题切换动效（local/anim-delight）：换主题时给 <html> 挂 400ms 的 .theme-anim，
  // 让背景/文字/边框颜色平滑过渡而不是"啪"地跳色。启动首次应用不挂（那时不需要）。
  const nextId = def?.id ?? null;
  if (lastThemeId !== null && lastThemeId !== nextId) flashThemeAnim(root);
  lastThemeId = nextId;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!def) {
    delete root.dataset.theme;
    root.style.colorScheme = "light"; // 回归基础令牌 = 亮色（安卓 WebView 强制反色防护恢复）
    if (style) style.textContent = "";
    logoSvg = null;
    return;
  }
  const varLines = Object.entries(def.vars)
    .filter(([k]) => /^--[\w-]+$/.test(k))
    .map(([k, v]) => `${k}: ${v};`);
  if (def.fonts?.ui) varLines.push(`--font-ui: ${def.fonts.ui};`);
  if (def.fonts?.mono) varLines.push(`--font-mono: ${def.fonts.mono};`);
  // :root[data-theme] 特异度 (0,2,0) 稳压 tokens.css 的 :root (0,1,0)——
  // 平级时输赢取决于文档顺序，vite 样式注入顺序不可依赖（用户实锤：应用后无变化）
  let css = `:root[data-theme="${def.id}"] {\n${varLines.join("\n")}\n}`;
  if (def.css && def.css.trim()) css += `\n/* 主题附加 CSS（受信） */\n${def.css}`;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
  document.head.appendChild(style);   // 重新挪到末尾：vite 后注入的样式压不过
  root.dataset.theme = def.id;
  // color-scheme 跟随主题声明：暗色主题让原生控件/滚动条/表单控件同步反色
  // （global.css 的 :root { color-scheme: light } 特异度 (0,1,0) 被这里 (0,2,0) 稳压）
  root.style.colorScheme = def.dark ? "dark" : "light";
  logoSvg = def.logo && def.logo.includes("<svg") ? def.logo : null;
}

/** 应用当前应生效的主题：跟随系统时按系统暗/亮取日夜两档，否则手动单选 */
function applyActive(): void {
  const id = state.followSystem
    ? (systemDark ? state.nightThemeId : state.dayThemeId) ?? state.activeId
    : state.activeId;
  const def = state.installed.find((t) => t.id === id) ?? null;
  applyTheme(def);
}

/** 系统暗色监听：跟随模式下系统切换即时换主题 */
const darkMq = typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia("(prefers-color-scheme: dark)") : null;
if (darkMq) {
  const onSys = (): void => {
    const was = systemDark;
    systemDark = darkMq.matches;
    if (state.followSystem && was !== systemDark) {
      applyActive();
      emit();
    }
  };
  if (darkMq.addEventListener) darkMq.addEventListener("change", onSys);
  else darkMq.addListener?.(onSys); // 旧 WebView 兼容
  systemDark = darkMq.matches;
}

bootstrap();

/* ---------- 公开 API ---------- */

function snapshot(): ThemeSnapshot {
  snapCache ??= {
    themes: [...state.installed],
    activeId: state.activeId,
    logoSvg,
    deletedBuiltins: [...state.deletedBuiltins],
    followSystem: state.followSystem,
    dayThemeId: state.dayThemeId,
    nightThemeId: state.nightThemeId,
    systemDark,
  };
  return snapCache;
}

export function subscribeThemes(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useThemes(): ThemeSnapshot {
  return useSyncExternalStore(subscribeThemes, snapshot);
}

export function activateTheme(id: string): boolean {
  const def = state.installed.find((t) => t.id === id);
  if (!def) return false;
  state.activeId = id;
  applyTheme(def);
  persist();
  emit();
  return true;
}

/** 开关「跟随系统昼夜」：开=按系统暗/亮自动切日夜两档；关=回到手动单选 */
export function setFollowSystem(on: boolean): void {
  state.followSystem = on;
  applyActive();
  persist();
  emit();
}

/** 设置日/夜两档主题 id（跟随模式下系统暗色用 nightThemeId，亮色用 dayThemeId） */
export function setDayNightTheme(dayId: string | null, nightId: string | null): void {
  state.dayThemeId = dayId;
  state.nightThemeId = nightId;
  applyActive();
  persist();
  emit();
}

/** 停用主题：回到基础令牌（不删除） */
export function deactivateTheme(): void {
  state.activeId = null;
  applyTheme(null);
  persist();
  emit();
}

/** 安装/覆盖一个主题（插件路径或 JSON 导入共用） */
export function installTheme(def: ThemeDef, source: "builtin" | "plugin" = "plugin", owner?: string): ThemeDef {
  const clean: ThemeDef = {
    id: String(def.id || "").trim(),
    name: String(def.name || def.id || "未命名主题"),
    version: String(def.version || "1.0.0"),
    author: def.author,
    description: def.description,
    vars: def.vars && typeof def.vars === "object" ? def.vars : {},
    fonts: def.fonts,
    logo: def.logo,
    css: def.css,
    dark: def.dark === true,
    source,
    owner: source === "plugin" ? (owner ?? def.owner) : undefined,
  };
  if (!clean.id) throw new Error("主题 id 不能为空");
  const i = state.installed.findIndex((t) => t.id === clean.id);
  if (i >= 0) state.installed[i] = clean;
  else state.installed.push(clean);
  if (state.activeId === clean.id) applyTheme(clean);
  persist();
  emit();
  return clean;
}

/** 批量移除主题（内部）：清 activeId 与昼夜档位，落盘并通知一次；内置主题不动 */
function dropThemes(ids: Set<string>): string[] {
  if (ids.size === 0) return [];
  const gone = state.installed
    .filter((t) => ids.has(t.id) && t.source !== "builtin")
    .map((t) => t.id);
  if (gone.length === 0) return [];
  const goneSet = new Set(gone);
  state.installed = state.installed.filter((t) => !goneSet.has(t.id));
  if (state.activeId && goneSet.has(state.activeId)) {
    state.activeId = null;
    applyTheme(null);
  }
  if (state.dayThemeId && goneSet.has(state.dayThemeId)) state.dayThemeId = null;
  if (state.nightThemeId && goneSet.has(state.nightThemeId)) state.nightThemeId = null;
  persist();
  emit();
  return gone;
}

/** 删除主题（内置不可删除——用户始终有可用外观；仅插件主题可移除） */
export function removeTheme(id: string): void {
  dropThemes(new Set([id]));
}

/** 回收某插件注册的主题（插件卸载 / 停用 / 覆盖安装时调用），返回被移除的 id。
 *
 *  匹配三种情形，缺一都会留下「孤儿主题」：
 *    ① `owner === pluginId`——新版安装记录；
 *    ② id 与本插件 id 相同——文档约定的同 id 写法，覆盖历史无 owner 的记录；
 *    ③ 显式传入的 `ids`（插件模块本版声明的主题 id）——覆盖「主题 id 与插件 id
 *       不同名」的历史记录。
 *  `keep` 中的 id 保留：覆盖安装时新版主题已注册，不能连带删掉。 */
export function removePluginThemes(pluginId: string, opts?: { ids?: string[]; keep?: string[] }): string[] {
  const keep = new Set(opts?.keep ?? []);
  const declared = new Set(opts?.ids ?? []);
  const ids = new Set(
    state.installed
      .filter((t) => t.source === "plugin" && !keep.has(t.id)
        && (t.owner === pluginId || t.id === pluginId || declared.has(t.id)))
      .map((t) => t.id),
  );
  return dropThemes(ids);
}

/** 恢复全部被删的内置主题 */
export function restoreBuiltins(): number {
  const deleted = new Set(state.deletedBuiltins);
  const have = new Set(state.installed.map((t) => t.id));
  const back = BUILTIN_THEMES.filter((b) => deleted.has(b.id) || !have.has(b.id));
  state.installed = [...back, ...state.installed];
  state.deletedBuiltins = [];
  persist();
  emit();
  return back.length;
}

/** 插件 API facade 用的非 hook 查询（不触发订阅） */
export function listThemes(): ThemeDef[] {
  return [...state.installed];
}
export function activeThemeId(): string | null {
  return state.activeId;
}
export function themeSchedule(): { followSystem: boolean; dayThemeId: string | null; nightThemeId: string | null; systemDark: boolean } {
  return { followSystem: state.followSystem, dayThemeId: state.dayThemeId, nightThemeId: state.nightThemeId, systemDark };
}

/** 插件侧查询：某主题 id 是否已在架上（供 loader 提示覆盖安装） */
export function hasTheme(id: string): boolean {
  return state.installed.some((t) => t.id === id);
}

/** 当前是否深色主题（内嵌 WebView 据此开启算法暗化：官方页自带黑字在深色下会隐形）。
 *  以 documentElement 的 color-scheme 为唯一真源——它是 applyTheme 写下去的同一信号。 */
export function currentThemeIsDark(): boolean {
  try {
    const root = document.documentElement;
    if (root.style.colorScheme === "dark") return true;
    return typeof getComputedStyle === "function" && getComputedStyle(root).colorScheme === "dark";
  } catch {
    return false;
  }
}
