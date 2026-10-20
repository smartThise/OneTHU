/**
 * 轻量 i18n（零第三方依赖）—— **语言自动注册**。
 *
 * 新增语言：在 `i18n/locales/` 下新建 `<code>.ts`，默认导出 `{ label, messages }`
 * 即可（例如 `ja-JP.ts`）—— Vite 会在构建期用 `import.meta.glob` 扫描整个目录，
 * 设置页的语言下拉、持久化校验、缺键回落全部自动跟上，**不需要改这个文件**。
 *
 * 约定：
 *   · 文案只写进 locales/*.ts；组件用 `useT()` 取 `t()`，不要写中文字面量；
 *   · 所有语言的键集合必须与 `zh-CN` 一致（`tools/i18n-test.mjs` 逐语言守）；
 *   · `t(key, params)` 支持 `{name}` 占位符；缺键先回落默认语言，再回落键名；
 *   · 语言选择存 `onethu.locale`；存了已下线的语言码会自动回落到默认语言。
 *
 * node 护栏里没有 `import.meta.glob`，这里用内置两种语言做**静态种子**兜底；
 * 新增语言的目录结构/键一致性由护栏直接扫 `locales/` 目录校验。
 */
import { useSyncExternalStore } from "react";
import type { LocaleDef } from "./types.js";
import zhSeed from "./locales/zh-CN.js";
import enSeed from "./locales/en-US.js";

export type { LocaleDef } from "./types.js";

export const DEFAULT_LOCALE = "zh-CN";
const STORE_KEY = "onethu.locale";

/* Vite：按目录自动注册（`import.meta.glob(` 必须是**字面量调用**，Vite 才会在编译期展开；
   取成变量再调用会静默失效）。node 环境没有 import.meta.env，走下面的静态种子。 */
const IN_VITE = typeof import.meta.env !== "undefined";
const modules: Record<string, unknown> = IN_VITE
  ? import.meta.glob("./locales/*.ts", { eager: true })
  : {};

const registry: Record<string, LocaleDef> = {};
for (const [path, mod] of Object.entries(modules)) {
  /* 文件名就是语言码：locales/ja-JP.ts → "ja-JP" */
  const code = path.replace(/^.*\//, "").replace(/\.ts$/, "");
  const def = (mod as { default?: LocaleDef }).default ?? (mod as LocaleDef);
  if (def && typeof def === "object" && def.messages && typeof def.messages === "object") {
    registry[code] = def;
  }
}
if (!registry[DEFAULT_LOCALE]) registry[DEFAULT_LOCALE] = zhSeed;
if (!registry["en-US"]) registry["en-US"] = enSeed;

/** 已注册语言码：默认语言恒在首位，其余按码排序（新增语言无需登记）。 */
export const LOCALES: readonly string[] = [
  ...(registry[DEFAULT_LOCALE] ? [DEFAULT_LOCALE] : []),
  ...Object.keys(registry).filter((c) => c !== DEFAULT_LOCALE).sort(),
];

/** 语言码 → 选择器显示名（取各文件自己的 label）。 */
export const LOCALE_LABELS: Record<string, string> = Object.fromEntries(
  LOCALES.map((code) => [code, registry[code]?.label?.trim() || code]),
);

function readLocale(): string {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    return raw && registry[raw] ? raw : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

let current: string = readLocale();
const listeners = new Set<() => void>();

export function getLocale(): string {
  return current;
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 切到已注册的语言；未知语言码直接忽略（不再静默改写成中文）。 */
export function setLocale(next: string): void {
  if (!registry[next] || next === current) return;
  current = next;
  try {
    globalThis.localStorage?.setItem(STORE_KEY, next);
  } catch {
    /* 隐私模式：本次会话生效即可 */
  }
  listeners.forEach((f) => f());
}

export type TParams = Record<string, string | number>;

/** 取文案：当前语言 → 默认语言 → 键名；缺参数保留 `{name}` 原样，便于发现漏传。 */
export function t(key: string, params?: TParams): string {
  const raw = registry[current]?.messages[key] ?? registry[DEFAULT_LOCALE]?.messages[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_all, name: string) =>
    params[name] === undefined || params[name] === null ? "{" + name + "}" : String(params[name]));
}

/**
 * 有译文用译文，没有就用调用方给的兜底。
 * 专给「数据表里已经存了中文原值」的场景（NAV_REGISTRY 等）：表不用改结构，
 * 翻译只加键，缺翻译时显示原值而不是键名。
 */
export function tOr(key: string, fallback: string, params?: TParams): string {
  const raw = registry[current]?.messages[key] ?? registry[DEFAULT_LOCALE]?.messages[key];
  if (raw === undefined) return fallback;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_all, name: string) =>
    params[name] === undefined || params[name] === null ? "{" + name + "}" : String(params[name]));
}

/** 组件里用这个：订阅语言变化，切换后立即重渲染。 */
export function useT(): typeof t {
  useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return t;
}

export function useLocale(): string {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** 护栏 / 调试用：拿某个语言的整张表（未注册 → 空表）。 */
export function localeTable(locale: string): Readonly<Record<string, string>> {
  return registry[locale]?.messages ?? {};
}

/** 护栏 / 调试用：已注册语言码（含自定义语言）。 */
export function localeCodes(): readonly string[] {
  return LOCALES;
}
