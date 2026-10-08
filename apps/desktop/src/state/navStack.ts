/**
 * E1：会话内导航栈（唯一事实来源）。
 *
 * 为什么要自建栈（docs/ui-ux-polish-detailed.md §6 E1）：全仓原先 0 处导航栈——
 * 不是「返回跳错页」，而是**根本没有栈**；各页返回按钮各自硬编码父页，于是
 * 「待办 → 全部作业 → 某作业」返回时掉回待办。
 *
 * 真机查证结论（2026-10-01，K90 Pro Max / Android 16 / API 36；先前仅凭 wry 源码
 * 的推断被实测推翻，以本节为准）：
 * 1. Tauri 生成的 `TauriActivity` 把 wry 的返回处理**关掉了**——
 *    `tauri-2.11.5/mobile/android-codegen/TauriActivity.kt` 里
 *    `override val handleBackNavigation: Boolean = false`；wry WryActivity 里那段
 *    `if (mWebView.canGoBack()) goBack() else onBackPressed()` **不执行**。
 * 2. 实际生效的是 Tauri 的 AppPlugin：`hasListener("back-button")` 为假时用
 *    `webView.canGoBack()` 兜底（本机对同文档/pushState 历史恒 false → 直接退出应用，
 *    实测手势与三键返回都把应用退掉）；只有**插件的监听表**里有监听时才改发
 *    `back-button` 事件，由前端决定去留。
 * 3. 插件的监听表要用插件的 `register_listener`（Channel）注册，官方 JS 入口是
 *    `@tauri-apps/api/app` 的 `onBackButtonPress`；用 `@tauri-apps/api/event` 的
 *    `listen("back-button")` 注册的是事件插件，两边不是同一个注册表（实测：listen()
 *    注册成功、按返回键仍无事件、应用照旧退出）。命令名必须是下划线
 *    `register_listener`：ACL 放行的是 `core:app:allow-register-listener`
 *    （commands.allow = ["register_listener"]），驼峰会被拒。
 * 4. `plugin:app|exit` 与 `plugin:window|close` 在这套 ACL 下都不可用（实测均被拒：
 *    core:app 权限集里根本没有 exit），所以**根节点的退出由前端自己收口**——调自有插件
 *    的 `plugin:onethu-mobile|mobile_exit`（Kotlin `exitApp` → `activity.finish()`，
 *    与 Tauri 自身 AppPlugin.exit 语义相同）。
 *    为什么不「回到根就 unregister，让 AppPlugin 原生兜底」：真机走查发现
 *    摘不掉——`remove_listener` 调用成功（无异常）后 Kotlin 插件监听表里**仍留着条目**，
 *    根节点于是只发事件不退应用。返回键监听因此改为**整个 JS 会话只注册一次**。
 * 5. 因此**返回键的主通道是 back-button 事件**，不是 WebView 历史；URL 只承载
 *    一级页（刷新/深链落回入口），用 replaceState 同步，不再 pushState——既不必猜
 *    canGoBack() 口径，也不会出现「历史条目数 ≠ 栈帧数」的错位（实测详情页那次
 *    跳转后 history.length 比帧数多 1，按历史退栈会错位）。
 *
 * 浮层优先级：二级菜单 / 收藏弹层 / 抽屉 / 命令面板 / 主题弹层 / 文件预览注册成
 * overlay 帧，返回时**先关最上层浮层**，再退页帧，回到根交还原生退出。
 *
 * 本文件是唯一允许碰 history 与返回键监听的地方（tools/nav-stack-test.mjs 断言）。
 */
import { useEffect, useRef } from "react";
import { isAndroidNavigator } from "../lib/androidHost.js";
import type { LearnNav, Page } from "./app.js";

/** 页帧：一跳页面 + 它自己的参数（返回时按原样恢复，含 courseTab 这类「各回各家」参数） */
export interface NavPageFrame {
  kind: "page";
  page: Page;
  params: LearnNav | null;
  url: string;
}

/** 浮层帧：只记身份与关闭回调 */
export interface NavOverlayFrame {
  kind: "overlay";
  id: string;
  close: () => void;
}

export type NavFrame = NavPageFrame | NavOverlayFrame;

/** 栈上限：防内存（霖已定口径 ~50） */
export const MAX_FRAMES = 50;

let frames: NavFrame[] = [];
const listeners = new Set<() => void>();

/**
 * 返回键通道的自检快照：dev 面板「导航栈」行读它（正式版不加载 DevPanel）。
 * 真机排查用——栈深多少、返回键监听有没有在册、注册/退出有没有抛错，一眼可见。
 */
export interface NavDebugState {
  depth: number;
  canGoBack: boolean;
  listening: boolean;
  error: string | null;
}

let debugSnapshot: NavDebugState = { depth: 0, canGoBack: false, listening: false, error: null };

/** 只在状态真变时重建快照：useSyncExternalStore 的 getSnapshot 每次返回新对象会死循环（React #185） */
function refreshDebugSnapshot(): void {
  debugSnapshot = { depth: frames.length, canGoBack: canGoBack(), listening: backListener !== null, error: backError };
}

export function navDebugState(): NavDebugState {
  return debugSnapshot;
}

const notify = (): void => {
  /* 首帧也确保返回键监听在册（只注册一次，之后不再摘除） */
  void installBackListener();
  refreshDebugSnapshot();
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      /* 订阅者异常不拖垮栈 */
    }
  }
};

/** 订阅栈变化（React 用 useSyncExternalStore 接） */
export function subscribeNav(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function navFrames(): readonly NavFrame[] {
  return frames;
}

/** 栈顶帧（渲染据此决定显示哪一页 / 是否有关闭中的浮层） */
export function topFrame(): NavFrame | undefined {
  return frames[frames.length - 1];
}

/** 栈里最后一个页帧（浮层打开时也在，用于渲染当前页） */
export function topPageFrame(): NavPageFrame | undefined {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f?.kind === "page") return f;
  }
  return undefined;
}

export function stackDepth(): number {
  return frames.length;
}

/** 有可退的历史（页帧 >1 或栈顶是浮层）——返回键是否被本栈消费 */
export function canGoBack(): boolean {
  return frames.length > 1 || topFrame()?.kind === "overlay";
}

/* ── Android 返回键监听（按需注册） ───────────────────────────────── */

let backListener: { unregister: () => Promise<void> } | null = null;
let backError: string | null = null;
let exiting = false;

function isAndroidHost(): boolean {
  return isAndroidNavigator(typeof navigator !== "undefined" ? navigator : undefined);
}

/**
 * 根节点退出：Android 调自有插件命令 finish 当前 Activity。
 *
 * 不用 Tauri 的 `plugin:app|exit`：该命令在本项目 ACL 下被拒（core:app 权限集无 exit），
 * 真机实测报 "Command plugin:app|exit not allowed by ACL"。
 */
async function exitApp(): Promise<void> {
  if (exiting) return;
  exiting = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("plugin:onethu-mobile|mobile_exit");
  } catch (e) {
    backError = String(e instanceof Error ? e.message : e);
    refreshDebugSnapshot();
  } finally {
    exiting = false;
  }
}

/**
 * 注册返回键监听（官方 API：内部走 plugin:app|register_listener + Channel）。
 *
 * 只注册、不摘除：真机走查发现摘除后 Kotlin 插件监听表里仍有残留条目（AppPlugin 的
 * `hasListener` 因此恒为真，原生兜底退出永远不触发），所以根节点的退出由 exitApp 收口，
 * 不依赖「摘掉监听让原生接管」这条链路。
 */
async function installBackListener(): Promise<void> {
  if (backListener !== null || !isAndroidHost()) return;
  try {
    const { onBackButtonPress } = await import("@tauri-apps/api/app");
    backListener = await onBackButtonPress(() => {
      /* 栈里有内容就退一格（含先关浮层）；已在根上则退出应用 */
      if (!back()) void exitApp();
    });
    backError = null;
  } catch (e) {
    /* 注册失败会让返回键完全落到原生兜底（深页直接退出应用），必须留痕给 dev 面板 */
    backError = String(e instanceof Error ? e.message : e);
  }
  refreshDebugSnapshot();
}

/* ── 栈操作 ──────────────────────────────────────────────────────── */

/** 把 URL 同步成栈顶页帧（replaceState：不进 WebView 历史，只保证刷新/深链落点正确） */
function syncUrl(): void {
  const top = topPageFrame();
  if (!top) return;
  if ((location.hash || "#/today") === top.url) return;
  history.replaceState({ dshNav: frames.indexOf(top) }, "", top.url);
}

function trim(): void {
  while (frames.length > MAX_FRAMES) {
    /* 超出上限丢最老的页帧 */
    const idx = frames.findIndex((f) => f.kind === "page");
    if (idx < 0 || frames.length <= MAX_FRAMES) break;
    frames.splice(idx, 1);
  }
}

function sameRoute(a: NavPageFrame, b: Omit<NavPageFrame, "kind">): boolean {
  return a.page === b.page && JSON.stringify(a.params ?? null) === JSON.stringify(b.params ?? null);
}

/**
 * 退一步。返回 true 表示本栈消费了这次返回（浮层已关或页帧已退）；
 * false 表示已在根上（此时监听应当已摘除，返回键由原生退出应用）。
 */
export function back(): boolean {
  const top = topFrame();
  if (top?.kind === "overlay") {
    frames.pop();
    try {
      top.close();
    } catch {
      /* 关闭回调抛错也要让栈继续一致 */
    }
    syncUrl();
    notify();
    return true;
  }
  if (frames.length > 1) {
    frames.pop();
    syncUrl();
    notify();
    return true;
  }
  return false;
}

/** 冷启动 / 刷新后建根帧 */
export function initNavStack(frame: Omit<NavPageFrame, "kind">): void {
  frames = [{ kind: "page", ...frame }];
  history.replaceState({ dshNav: 0 }, "", frame.url);
  notify();
}

/** 正常跳转：入栈；与栈顶同路由则退化为替换（防同一跳转重复入栈） */
export function pushNav(frame: Omit<NavPageFrame, "kind">): NavPageFrame {
  const top = frames[frames.length - 1];
  const next: NavPageFrame = { kind: "page", ...frame };
  if (top?.kind === "page" && sameRoute(top, frame)) {
    frames[frames.length - 1] = next;
  } else {
    frames.push(next);
    trim();
  }
  history.replaceState({ dshNav: frames.length - 1 }, "", frame.url);
  notify();
  return next;
}

/** 参数/页签变化（登录归位、hash 外部改动对账）：替换最近一个页帧，不入栈 */
export function replaceNav(frame: Omit<NavPageFrame, "kind">): NavPageFrame {
  const next: NavPageFrame = { kind: "page", ...frame };
  if (!frames.length) {
    initNavStack(frame);
    return next;
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f?.kind === "page") {
      frames[i] = next;
      break;
    }
  }
  history.replaceState({ dshNav: frames.length - 1 }, "", frame.url);
  notify();
  return next;
}

/** 浮层入帧（返回键先关它） */
export function openOverlayFrame(id: string, close: () => void): void {
  if (frames.some((f) => f.kind === "overlay" && f.id === id)) return;
  const top = frames[frames.length - 1];
  if (top?.kind === "page" || frames.length === 0) {
    frames.push({ kind: "overlay", id, close });
    trim();
    notify();
  }
}

/** 浮层自行关闭（点 ✕ / 遮罩）时调用：把帧摘掉即可（没有历史条目要退） */
export function closeOverlayFrame(id: string): void {
  const i = frames.findIndex((f) => f.kind === "overlay" && f.id === id);
  if (i < 0) return;
  frames.splice(i, 1);
  notify();
}

/**
 * 浮层登记（A3 二级菜单 / 抽屉 / 各类弹层调用）：
 * 打开时入一帧，关闭时摘掉——于是返回键**先关最上层浮层**，再退页帧，
 * 回到根才交还原生退出。关闭回调走 ref，避免父组件每次渲染换函数导致重入帧。
 */
export function useOverlayBack(id: string, open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    openOverlayFrame(id, () => closeRef.current());
    return () => closeOverlayFrame(id);
  }, [id, open]);
}
