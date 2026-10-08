/**
 * 当前页的「顶栏 chrome」（G1）：页面声明的返回目标 + 页面级操作菜单。
 *
 * 为什么是一份 module 级小 store 而不是 props/Context 值：
 *   顶栏（`Layout` 里 `.mobile-topbar`）与页面（`{children}`）是兄弟，页面级操作却由页面
 *   自己声明（`PageHead` 是唯一声明点，页内返回键的 `to`/`label` 也从它的 back 槽上取）。
 *   用「订阅 + 实时读」两段式，避开两个坑：
 *   · 快照（`pageChromeSnapshot`）只在「有没有返回键 / 有没有菜单」变化时换引用，
 *     `useSyncExternalStore` 不会因为每次渲染传新数组而打转；
 *   · 菜单项（含 onSelect 闭包）每次渲染都写进 live，点「···」时读的是**最新一次渲染**
 *     的闭包，不会点到上一帧的旧状态。
 */
import type { BackTarget } from "./app.js";
import type { CtxItem } from "../components/ContextMenu.js";

/** 页面级操作项：与长按菜单同一份结构（点「···」时直接喂给 ContextMenu.open） */
export type PageMenuItem = CtxItem;

interface Chrome {
  back: BackTarget | null;
  menu: PageMenuItem[];
}

interface ChromeSnapshot {
  hasBack: boolean;
  hasMenu: boolean;
}

const EMPTY: Chrome = { back: null, menu: [] };
let live: Chrome = EMPTY;
let snapshot: ChromeSnapshot = { hasBack: false, hasMenu: false };
const listeners = new Set<() => void>();

/** PageHead 每次渲染都同步一次；只有可见性（有无返回键/菜单）变化才通知顶栏重渲染 */
export function syncPageChrome(next: Chrome): void {
  live = next;
  const hasBack = !!next.back;
  const hasMenu = next.menu.length > 0;
  if (hasBack === snapshot.hasBack && hasMenu === snapshot.hasMenu) return;
  snapshot = { hasBack, hasMenu };
  for (const fn of listeners) fn();
}

/** 页面卸载时清空：否则上一页的菜单会残留到下一页（返回键也会变成假可返回） */
export function clearPageChrome(): void {
  syncPageChrome(EMPTY);
}

export function subscribePageChrome(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pageChromeSnapshot(): ChromeSnapshot {
  return snapshot;
}

/** 顶栏「···」被点开时读实时 chrome（菜单项与返回目标都要最新一次渲染的） */
export function readPageChrome(): Chrome {
  return live;
}
