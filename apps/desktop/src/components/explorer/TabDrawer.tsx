import { vaultCatchWorkspace } from "../../lib/vaultCatch.js";
import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 标签页抽屉（dev-explorer）：当前标签页（按工作区分组）+ 工作区管理。
 * 手机 = 底部抽屉，桌面 = 右下浮层面板（同一 DOM，CSS 媒体查询分流）。
 *
 * v2（用户拍板「工作区像摆设」）：
 * - 「当前标签页」按 workspaceId 分组：组头 = 工作区名 + 实时计数；未归属归「未分组」兜底；
 * - 每个 tab 行可「移入工作区」（⋯ 浮层：列工作区 / 新建工作区… / 移出）；
 * - 行摘要 = tabTitles 的完整路径（小字），标题 = 实体短标签；
 * - WorkspacePanel 每行显示**实时**成员数与 label 预览（按 workspaceId 反查，不是快照数）。
 *
 * 工作区段抽成 WorkspacePanel 导出——OneGoSheet 引同一份，逻辑不许复制两份。
 */
import { setTabLayoutMode, useTabLayoutMode } from "../../state/tabLayout.js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import {
  activeTabId,
  allTabs,
  closeOtherTabs,
  closeTab,
  dissolveWorkspace,
  closeLiveWorkspace,
  duplicateTab,
  createLiveWorkspace,
  explorerSnapshot,
  focusTab,
  HOME_TAB_ID,
  moveTab,
  moveTabsBlock,
  openWorkspace,
  saveWorkspace,
  setTabWorkspace,
  setTabsWorkspace,
  subscribeExplorer,
  useExplorerState,
  type ExplorerTab,
} from "../../state/explorer.js";
import { resolveTabTitle, useTabTitleTick } from "../../state/tabTitles.js";
import { useExitPhase } from "../../lib/useExitPhase.js";
import { useExpanded } from "../../state/usePlatformLayout.js";
import { IconX } from "../Icons.js";
import { confirmOk } from "../../lib/confirm.js";
import { openWorkspaceEditor } from "./WorkspaceEditor.js";
import { isPhoneNow, useIsPhone, useSheetSnap } from "../../state/phoneSheets.js";
import { PhoneSheetGrip, useSheetDrag } from "./PhoneSheet.js";
import { openContextMenu, type MenuItem } from "./ContextMenu.js";
import { WorkspaceCreateDialog } from "./TabStrip.js";
import { t as i18n } from "../../i18n/index.js";


/* ══════════ 抽屉开合 store（palette.ts 同款） ══════════ */

let drawerOpen = false;
const drawerListeners = new Set<() => void>();

function emitDrawer(): void {
  for (const f of drawerListeners) f();
}

export function openTabDrawer(): void {
  if (!drawerOpen) {
    drawerOpen = true;
    emitDrawer();
  }
}

export function closeTabDrawer(): void {
  if (drawerOpen) {
    drawerOpen = false;
    emitDrawer();
  }
}

function subscribeDrawer(f: () => void): () => void {
  drawerListeners.add(f);
  return () => {
    drawerListeners.delete(f);
  };
}

function useDrawerOpen(): boolean {
  return useSyncExternalStore(subscribeDrawer, () => drawerOpen, () => false);
}

/* 抽屉内部读开合用 useDrawerOpen；对外导出 useTabDrawerOpen */
export function useTabDrawerOpen(): boolean {
  return useDrawerOpen();
}

/** store 状态视图类型（explorer.ts 未导出接口本体，借 hook 返回类型） */
type ExplorerStateView = ReturnType<typeof useExplorerState>;


/* ══════════ 行级拖拽（电脑端 B + 手机端 A4）：拖动改序 / 停留合并 / 长按与右键菜单 ══════════
   与顶栏标签条（TabStrip useTabReorder）同一套语义（位移跟随 · 让位 · 600ms 停留灰框 ·
   松手 flushSync 落序）。行结构与「栏」不同——工作区块 = 组头 + 成员行（还不是容器），
   所以单独收敛在这里。鼠标：按下位移 >6px 进入拖拽；触屏（手机）：按住 320ms 武装拖拽，
   按住 500ms 不动 = 菜单；位移超 10px 全部取消（原生竖滚照常可用，armed 后才拦 Picture——
   即旧 BoardPage stopNativeScroll 同款约束（该页已下线，现由 OnePageSurface/FreeBoard 承担），不动 touch-action）。 */

interface TabDrop {
  dragId: string;
  targetId: string;
  targetWsId: string | null;
}

/** 拖拽/位移单元：工作区块（组头+成员）或独立标签行 */
interface RowUnit {
  els: HTMLElement[];
  ids: string[];
  wsId: string | null;
}

const ROW_SHIFT_MS = 160;
const ROW_EASE = "cubic-bezier(.2,.7,.3,1)";
const ROW_TH = 6;
const ROW_EDGE = 0.25;
const ROW_DWELL_MS = 600;
const ROW_ARM_MS = 320;
const ROW_MENU_MS = 500;
const ROW_MOVE_CANCEL_PX = 10;

/** 全部行单元（显示序）：工作区块（组头+成员）合为一个单元；未分组行各自一个；首页钉死 */
function drawerLanes(list: HTMLElement): RowUnit[] {
  const out: RowUnit[] = [];
  for (const child of Array.from(list.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains("ex-group-head")) {
      out.push({ els: [child], ids: [], wsId: child.getAttribute("data-ws-id") });
      continue;
    }
    const tid = child.getAttribute("data-tab-id");
    if (!tid || tid === HOME_TAB_ID) continue; // 首页行钉死、不参与
    const wsId = child.getAttribute("data-ws-id");
    const prev = out[out.length - 1];
    if (wsId != null && prev !== undefined && prev.wsId === wsId) {
      /* 头 lane 的成员跟上来：区块（头+成员行）作为同一个单元整体让位 */
      prev.els.push(child);
      prev.ids.push(tid);
      continue;
    }
    out.push({ els: [child], ids: [tid], wsId: wsId ?? null });
  }
  return out;
}

function drawerUnitRect(unit: RowUnit): { top: number; bottom: number; height: number } {
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const el of unit.els) {
    const r = el.getBoundingClientRect();
    top = Math.min(top, r.top);
    bottom = Math.max(bottom, r.bottom);
  }
  const safeTop = Number.isFinite(top) ? top : 0;
  const safeBottom = Number.isFinite(bottom) ? bottom : 0;
  return { top: safeTop, bottom: safeBottom, height: Math.max(safeBottom - safeTop, 0) };
}

/** 组内成员行单元（接触屏/单行 hover 的子换序）：头不算成员 */
function drawerMembers(list: HTMLElement, wsId: string): RowUnit[] {
  const head = list.querySelector<HTMLElement>(`.ex-group-head[data-ws-id="${wsId}"]`);
  const out: RowUnit[] = [];
  for (const child of Array.from(list.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (head && child === head) continue;
    const tid = child.getAttribute("data-tab-id");
    if (!tid || tid === HOME_TAB_ID) continue;
    if (child.getAttribute("data-ws-id") === wsId) out.push({ els: [child], ids: [tid], wsId });
  }
  return out;
}

export type DrawerRowsApi = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: { preventDefault(): void; clientX: number; clientY: number; target: EventTarget | null }) => void;
  onClickCapture: (e: { stopPropagation(): void; preventDefault(): void }) => void;
};

interface DrawerRowsOpts {
  /** 右键 / 触屏长按：标签行菜单（A4：聚焦 / 复制 / 关闭 / 解散工作区 / 移出工作区） */
  onTabMenu: (x: number, y: number, tab: ExplorerTab) => void;
  /** 右键 / 触屏长按：工作区行菜单 */
  onWsMenu: (x: number, y: number, wsId: string) => void;
  /** 拖上并组的目标解析完成（目标行无工作区 → 调用方弹「新建工作区」卡） */
  onGroupDrop: (d: TabDrop) => void;
}

export function useDrawerRowsReorder(opts: DrawerRowsOpts): DrawerRowsApi {
  const cb = useRef(opts);
  cb.current = opts;
  const suppressClick = useRef(false);

  /** 内核（竖排行版 useTabReorder.startDrag）：
      units = 参与让位的单元集；from = 被拖单元下标；mode = unit（跨单元让位+停留）| member（组内钳位） */
  const startRowDrag = (
    list: HTMLElement,
    units: RowUnit[],
    from: number,
    mode: "unit" | "member",
    ev0: { clientX: number; clientY: number },
  ): void => {
    const dragUnit = units[from];
    if (!dragUnit) return;
    const dragHead = dragUnit.els[0];
    const dragIds = dragUnit.ids;
    if (!dragHead) return;
    const dragSet = new Set(dragIds);
    const dragWsId = mode === "unit" ? allTabs().find((t) => t.id === dragIds[0])?.workspaceId ?? dragUnit.wsId : dragUnit.wsId;
    const order = allTabs().filter((t) => t.kind !== "home").map((t) => t.id);
    const restIds = order.filter((x) => !dragSet.has(x));
    const allRows = Array.from(list.querySelectorAll<HTMLElement>("[data-tab-id]"));

    const tY = (n: number): string => `translateY(${n}px)`;
    const rects = units.map(drawerUnitRect);
    const dragRect = rects[from] ?? { top: 0, bottom: 0, height: 0 };
    let dest = from;
    let moved = false;
    let hoverEl: HTMLElement | null = null;
    let frameEl: HTMLElement | null = null;
    let dwellTimer: number | null = null;
    const y0 = ev0.clientY;

    const clearDwell = (): void => {
      if (dwellTimer !== null) window.clearTimeout(dwellTimer);
      dwellTimer = null;
      frameEl?.removeAttribute("data-ws-frame");
      frameEl = null;
      hoverEl = null;
    };

    const arm = (): void => {
      moved = true;
      units.forEach((u, i) => {
        if (i === from) return;
        u.els.forEach((el) => (el.style.transition = `transform ${ROW_SHIFT_MS}ms ${ROW_EASE}`));
      });
      dragUnit.els.forEach((el) => {
        el.style.transition = "none";
        el.style.position = "relative";
        el.style.zIndex = "6";
        el.classList.add("is-lift-row");
      });
    };

    const cleanupVisual = (): void => {
      units.forEach((u) => u.els.forEach((el) => {
        el.style.transition = "";
        el.style.transform = "";
        el.style.zIndex = "";
        el.style.position = "";
        el.classList.remove("is-lift-row");
      }));
    };

    const othersFlat = (): string[] => {
      const flat: string[] = [];
      for (let j = 0; j < units.length; j++) {
        if (j === from) continue;
        flat.push(...(units[j]?.ids ?? []));
      }
      return flat;
    };

    const onWindowMove = (ev: PointerEvent): void => {
      const dY = ev.clientY - y0;
      if (!moved) {
        if (Math.hypot(ev.clientX - ev0.clientX, dY) < ROW_TH) return;
        arm();
      }
      /* 停留检测（跨单元拖拽才有；组内换序不触发，与栏 member 语义一致） */
      if (mode === "unit") {
        let nextHover: HTMLElement | null = null;
        allRows.forEach((row) => {
          if (dragSet.has(row.getAttribute("data-tab-id") ?? "")) return;
          if (row.getAttribute("data-ws-id") === dragWsId) return; // 自己所在工作区不触发并组意图
          const r = row.getBoundingClientRect();
          const p = ev.clientY;
          if (p > r.top + r.height * ROW_EDGE && p < r.bottom - r.height * ROW_EDGE) nextHover = row;
        });
        if (nextHover !== hoverEl) {
          clearDwell();
          hoverEl = nextHover;
          if (nextHover) {
            const he: HTMLElement = nextHover;
            dwellTimer = window.setTimeout(() => {
              dwellTimer = null;
              frameEl = he;
              he.setAttribute("data-ws-frame", "1");
            }, ROW_DWELL_MS);
          }
        }
        /* 让位：中心夹逼出落点单元 */
        const dr = drawerUnitRect(dragUnit);
        const draggedCenter = dr.top + dragRect.height / 2 + dY;
        let count = 0;
        units.forEach((u, i) => {
          if (i === from) return;
          const r = rects[i];
          if (!r) return;
          if (r.top + r.height / 2 < draggedCenter) count++;
        });
        dest = Math.max(0, Math.min(units.length - 1, count));
        units.forEach((u, i) => {
          if (i === from) return;
          let shift = 0;
          if (from < dest && i > from && i <= dest) shift = -dragRect.height;
          else if (dest < from && i >= dest && i < from) shift = dragRect.height;
          u.els.forEach((el) => (el.style.transform = shift ? tY(shift) : ""));
        });
      }
      let dYc = dY;
      if (mode === "member") {
        /* 组内钳位：头顶到家底 */
        const head = list.querySelector<HTMLElement>(`.ex-group-head[data-ws-id="${CSS.escape(dragWsId ?? "")}"]`);
        const groupTop = head ? head.getBoundingClientRect().top : rects[0]?.top ?? ev0.clientY;
        let groupBottom = groupTop;
        units.forEach((u) => {
          if (u.wsId !== dragWsId) return;
          const r = drawerUnitRect(u);
          groupBottom = Math.max(groupBottom, r.bottom);
        });
        const fr = drawerUnitRect(dragUnit);
        dYc = Math.max(groupTop - fr.top, Math.min(groupBottom - fr.bottom, dY));
      }
      dragUnit.els.forEach((el) => {
        el.style.transition = "none";
        el.style.transform = tY(dYc);
      });
    };

    const finish = (): void => {
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("touchmove", blockNative);
      clearDwell();
      cleanupVisual();
      document.body.classList.remove("ex-row-dragging");
      if (!moved) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      /* 停留框内松手 → 并组（目标有工作区=移入；没有=挂在目标行上，调用方弹命名卡） */
      if (frameEl && mode === "unit") {
        const tgt = frameEl;
        const targetId = tgt.getAttribute("data-tab-id");
        const targetWsId = targetId
          ? allTabs().find((t) => t.id === targetId)?.workspaceId ?? null
          : tgt.getAttribute("data-ws-id");
        const anchorId = targetId ??
          allTabs().find((t) => t.workspaceId === targetWsId)?.id ?? "";
        const at = restIds.indexOf(anchorId) + 1;
        flushSync(() => {
          moveTabsBlock(dragIds, Math.max(0, at));
        });
        cb.current.onGroupDrop({ dragId: dragIds[0] ?? "", targetId: anchorId, targetWsId });
        return;
      }
      if (mode === "member") {
        /* 组内换序：按成员行最终落点算组内下标 */
        const members = units.filter((u) => u.els.indexOf(dragHead) === -1);
        const dr = drawerUnitRect(dragUnit);
        const draggedCenter = dr.top + dr.height / 2;
        let inner = 0;
        members.forEach((u) => {
          const r = drawerUnitRect(u);
          if (r.top + r.height / 2 < draggedCenter) inner++;
        });
        const its = (members[inner]?.ids[0]) ?? "";
        const at = restIds.indexOf(its);
        flushSync(() => {
          moveTabsBlock(dragIds, at >= 0 ? at : restIds.length);
        });
        return;
      }
      /* 让位：滑入后一次性提交真正的顺序 */
      const flat = othersFlat();
      const fall = order.indexOf(dragIds[0] ?? "") >= 0 ? order.indexOf(dragIds[0] ?? "") : 0;
      let k = 0;
      for (let j = 0; j < dest; j++) {
        const idx = j < from ? j : j + 1;
        k += units[idx]?.ids.length ?? 0;
      }
      let at: number;
      if (flat.length === 0) at = fall;
      else if (k < flat.length) at = restIds.indexOf(flat[k] ?? "");
      else at = restIds.indexOf(flat[flat.length - 1] ?? "") + 1;
      flushSync(() => {
        moveTabsBlock(dragIds, at >= 0 ? at : fall);
      });
    };

    const blockNative = (ev: TouchEvent): void => {
      if (moved) ev.preventDefault();
    };

    window.addEventListener("pointermove", onWindowMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("touchmove", blockNative);
  };

  /** 启动入口：解析按下目标 → 鼠标走位移阈值；触屏走武装时限 */
  const beginRows = (row: HTMLElement, list: HTMLElement, ev0: { clientX: number; clientY: number }, touch: boolean): void => {
    const id = row.getAttribute("data-tab-id") ?? "";
    if (!id || id === HOME_TAB_ID) return; // 首页行不可拖
    const myWs = row.getAttribute("data-ws-id");
    const launch = (): void => {
      const units = drawerLanes(list);
      if (myWs != null && myWs !== "") {
        /* 组内成员：member 模式（组内换序）；整组头=band 语义属栏端 */
        const head = list.querySelector<HTMLElement>(`.ex-group-head[data-ws-id="${CSS.escape(myWs)}"]`);
        const members = drawerMembers(list, myWs);
        if (members.length > 1) {
          const fromIdx = members.findIndex((u) => u.ids[0] === id);
          if (fromIdx >= 0) {
            startRowDrag(list, members, fromIdx, "member", ev0);
            return;
          }
          void head;
        }
      }
      const from = units.findIndex((u) => u.els.includes(row));
      if (from < 0) return;
      startRowDrag(list, units, from, "unit", ev0);
    };
    if (!touch) {
      const x0 = ev0.clientX;
      const y0 = ev0.clientY;
      const onStart = (ev: PointerEvent): void => {
        window.removeEventListener("pointermove", onStart);
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < ROW_TH) return;
        launch();
      };
      window.addEventListener("pointermove", onStart);
      window.setTimeout(() => window.removeEventListener("pointermove", onStart), 900);
      return;
    }
    /* 触屏：按住 ROW_ARM_MS 武装；按住 ROW_MENU_MS 不动 = 菜单；中段位移超阈值全取消 */
    let armed = false;
    const x0 = ev0.clientX;
    const y0 = ev0.clientY;
    let dead = false;
    let armTimer: number | undefined;
    let menuTimer: number | undefined;
    armTimer = window.setTimeout(() => {
      armTimer = undefined;
      if (dead) return;
      armed = true;
      if (menuTimer !== undefined) {
        window.clearTimeout(menuTimer);
        menuTimer = undefined;
      }
      launch();
    }, ROW_ARM_MS);
    menuTimer = window.setTimeout(() => {
      menuTimer = undefined;
      if (dead || armed) return;
      dead = true;
      window.clearTimeout(armTimer);
      const tid = row.getAttribute("data-tab-id");
      if (tid && tid !== HOME_TAB_ID) {
        const tab = allTabs().find((t) => t.id === tid);
        if (tab) {
          suppressClick.current = true;
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          cb.current.onTabMenu(x0, y0, tab);
        }
      } else if (row.classList.contains("ex-group-head") || row.getAttribute("data-ws-id") != null) {
        const wsId = row.getAttribute("data-ws-id");
        if (wsId) {
          suppressClick.current = true;
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          cb.current.onWsMenu(x0, y0, wsId);
        }
      }
    }, ROW_MENU_MS);
    const stopArm = (ev: PointerEvent): void => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > ROW_MOVE_CANCEL_PX) {
        dead = true;
        window.clearTimeout(armTimer);
        window.clearTimeout(menuTimer);
        window.removeEventListener("pointermove", stopArm);
        window.removeEventListener("pointerup", stopAll);
      }
    };
    const stopAll = (): void => {
      if (!armed && !dead) {
        dead = true;
        window.clearTimeout(armTimer);
        window.clearTimeout(menuTimer);
      }
      window.removeEventListener("pointermove", stopArm);
      window.removeEventListener("pointerup", stopAll);
    };
    window.addEventListener("pointermove", stopArm);
    window.addEventListener("pointerup", stopAll);
  };

  const onContextMenu = (e: { preventDefault(): void; clientX: number; clientY: number; target: EventTarget | null }): void => {
    const t = e.target instanceof Element ? e.target : null;
    const row = t?.closest<HTMLElement>(".ex-row[data-tab-id], .ex-row[data-ws-id], .ex-group-head[data-ws-id], .ex-row-wrap[data-ws-id]") ?? null;
    if (!row) return; // 只有命中行才接管右键；输入框等仍用原生菜单
    e.preventDefault();
    if (row.getAttribute("data-tab-id") === HOME_TAB_ID) return;
    const wsIdRaw = row.getAttribute("data-ws-id");
    const tid = row.getAttribute("data-tab-id");
    suppressClick.current = false;
    if (row.classList.contains("ex-group-head") && wsIdRaw) {
      cb.current.onWsMenu(e.clientX, e.clientY, wsIdRaw);
      return;
    }
    const tab = tid ? allTabs().find((x) => x.id === tid) ?? null : null;
    if (tab) cb.current.onTabMenu(e.clientX, e.clientY, tab);
    else if (wsIdRaw) cb.current.onWsMenu(e.clientX, e.clientY, wsIdRaw);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    const t = e.target instanceof Element ? e.target : null;
    const row = t?.closest<HTMLElement>(".ex-row[data-tab-id], .ex-row[data-ws-id], .ex-group-head[data-ws-id], .ex-row-wrap[data-ws-id]") ?? null;
    if (!row) return;
    const list = row.closest<HTMLElement>(".ex-row-list");
    const touch = e.pointerType !== "mouse";
    if (!touch) {
      const tid = row.getAttribute("data-tab-id");
      const listEl = list ?? (tid ? row.parentElement : null);
      if (!tid || tid === HOME_TAB_ID || !listEl) return; // 非标签行（工作区面板行）不拖，只菜单
      beginRows(row, listEl, { clientX: e.clientX, clientY: e.clientY }, false);
      return;
    }
    const listEl = list ?? row.parentElement ?? null;
    const tid2 = row.getAttribute("data-tab-id");
    if (tid2 && tid2 !== HOME_TAB_ID && listEl) {
      /* 手机触屏拖拽（按住武装） */
      beginRows(row, listEl, { clientX: e.clientX, clientY: e.clientY }, true);
      return;
    }
    /* 触屏的右键等同长按（组头/工作区面板行） */
    let x0 = e.clientX;
    let y0 = e.clientY;
    let dead = false;
    armedNone(row, x0, y0, () => undefined);
    void dead;
  };

  const armedNone = (row: HTMLElement, x0: number, y0: number, _onDone: () => void): void => {
    const menuTimer = window.setTimeout(() => {
      window.clearTimeout(menuTimer);
      const wsId = row.getAttribute("data-ws-id");
      const tid = row.getAttribute("data-tab-id");
      if (tid && tid !== HOME_TAB_ID) {
        const tab = allTabs().find((t) => t.id === tid);
        if (tab) {
          suppressClick.current = true;
          window.setTimeout(() => {
            suppressClick.current = false;
          }, 0);
          cb.current.onTabMenu(x0, y0, tab);
        }
        return;
      }
      if (wsId) {
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        cb.current.onWsMenu(x0, y0, wsId);
      }
    }, ROW_MENU_MS);
    const stop = (ev: PointerEvent): void => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > ROW_MOVE_CANCEL_PX) {
        window.clearTimeout(menuTimer);
        window.removeEventListener("pointermove", stop);
        window.removeEventListener("pointerup", stop2);
      }
    };
    const stop2 = (): void => {
      window.clearTimeout(menuTimer);
      window.removeEventListener("pointermove", stop);
      window.removeEventListener("pointerup", stop2);
    };
    window.addEventListener("pointermove", stop);
    window.addEventListener("pointerup", stop2);
  };

  const onClickCapture = (e: { stopPropagation(): void; preventDefault(): void }): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  return { onPointerDown, onContextMenu, onClickCapture };
}

/* ══════════ 小工具 ══════════ */

function relTime(ts: number): string {
  if (!ts) return "—";
  const d = Date.now() - ts;
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}小时前`;
  return `${Math.floor(d / 86_400_000)}天前`;
}


/* ══════════ ⑥ 桌面顶置定位：量底栏触发柱，小窗从其下方 6px 弹下（手机保持底部抽屉） ══════════ */

/** 触发钮锚定：open 且桌面态时返回 {top,left}（右缘翻转防越屏），否则 null */
export function useAnchorPos(anchorId: string, open: boolean, expanded: boolean): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !expanded) {
      setPos(null);
      return;
    }
    const measure = (): void => {
      const el = document.getElementById(anchorId);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(470, window.innerWidth * 0.46); // 与 .ex-sheet 宽度口径一致
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width;
      setPos({ top: r.bottom + 6, left: Math.max(left, 8) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, expanded, anchorId]);
  return pos;
}

/* ══════════ 「移入工作区」浮层（复用 .explorer-ctxmenu 视觉） ══════════ */

function MoveMenu({
  tab,
  x,
  y,
  snap,
  onClose,
}: {
  tab: ExplorerTab;
  x: number;
  y: number;
  snap: ExplorerStateView;
  onClose: () => void;
}): ReactNode {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const others = snap.workspaces.filter((w) => w.id !== tab.workspaceId);
  const top = Math.min(y, Math.max(window.innerHeight - 280, 8));
  const left = Math.min(x, Math.max(window.innerWidth - 220, 8));

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation(); // 只关浮层，不连带关抽屉（抽屉侧也查 menuOpen 双保险）
        onClose();
      }
    };
    window.addEventListener("keydown", h, true); // 捕获相位：先于抽屉的冒泡 handler
    return () => window.removeEventListener("keydown", h, true);
  }, [onClose]);

  const createAndMove = (): void => {
    const t = name.trim();
    if (!t) return;
    const wsId = saveWorkspace(t, [tab.id]);
    if (wsId) onClose();
  };

  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 1350 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="explorer-ctxmenu" style={{ left, top, zIndex: 1351 }} role="menu">
        {naming ? (
          <div className="explorer-ctxmenu-naming">
            <Input placeholder={i18n("auto.components.explorer.TabDrawer.1")} value={name} autoFocus onChange={(value) => setName(value)} onKeyDown={(e) => {
                if (e.key === "Enter") createAndMove();
              }} />
            <Btn variant="solid" tone="brand" onClick={createAndMove}>{i18n("auto.components.explorer.TabDrawer.2")}</Btn>
          </div>
        ) : (
          <>
            {others.map((w) => (
              <button key={w.id} className="explorer-ctxmenu-item" role="menuitem" onClick={() => { setTabWorkspace(tab.id, w.id); onClose(); }}>
                {i18n("auto.components.explorer.TabDrawer.3")}{w.name}」
              </button>
            ))}
            <button className="explorer-ctxmenu-item" role="menuitem" onClick={() => setNaming(true)}>
              {i18n("auto.components.explorer.TabDrawer.4")}</button>
            {tab.workspaceId ? (
              <button className="explorer-ctxmenu-item" role="menuitem" onClick={() => { setTabWorkspace(tab.id, null); onClose(); }}>
                {i18n("auto.components.explorer.TabDrawer.5")}</button>
            ) : null}
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

/* ══════════ 工作区面板（TabDrawer 与 OneGoSheet 共用） ══════════ */

/** 实时统计：某工作区当前的成员 tab（按 workspaceId 反查） */
function membersOf(snap: ExplorerStateView, wsId: string): ExplorerTab[] {
  return snap.tabs.filter((t) => t.workspaceId === wsId);
}

export function WorkspacePanel(): ReactNode {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const save = (): void => {
    const id = saveWorkspace(name);
    if (id) {
      setName("");
      setNaming(false);
    }
  };

  return (
    <section className="ex-ws" aria-label={i18n("auto.components.explorer.TabDrawer.6")}>
      <div className="ex-sec-head">
        <b>{i18n("auto.components.explorer.TabDrawer.6")}</b>
        <span className="ex-sec-head-note">{i18n("auto.components.explorer.TabDrawer.7")}</span>
        {snap.tabs.length > 0 ? (
          naming ? (
            <span className="ex-ws-naming">
              <Input placeholder={i18n("auto.components.explorer.TabDrawer.1")} value={name} autoFocus onChange={(value) => setName(value)} onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") setNaming(false);
                }} />
              <Btn variant="solid" tone="brand" onClick={save}>{i18n("auto.components.explorer.TabDrawer.8")}</Btn>
              <Btn variant="ghost" onClick={() => setNaming(false)}>{i18n("auto.components.explorer.TabDrawer.9")}</Btn>
            </span>
          ) : (
            <Btn variant="ghost" onClick={() => setNaming(true)}>{i18n("auto.components.explorer.TabDrawer.10")}{snap.tabs.length}{i18n("auto.components.explorer.TabDrawer.11")}</Btn>
          )
        ) : null}
      </div>
      {snap.workspaces.length === 0 ? (
        <div className="ex-empty-hint">{i18n("auto.components.explorer.TabDrawer.12")}</div>
      ) : (
        <div className="ex-ws-list">
          {snap.workspaces.map((w) => {
            const members = membersOf(snap, w.id);
            // 活工作区：看实时成员；已解散/已保存：看快照（w.tabs），这样解散后仍能看到其中的标签
            const names = w.live
              ? members.map((t) => (t.kind === "home" ? "首页" : resolveTabTitle(t.page, t.params).label))
              : w.tabs.map((t) => t.title);
            const count = names.length;
            const preview = names.slice(0, 4).join("、");
            return (
              /* data-ws-id：拖「标签头」到工作区块上并组的解析锚点（B） */
              <div className="ex-row" key={w.id} data-ws-id={w.id} data-vault-catch={vaultCatchWorkspace({ id: w.id, name: w.name, count })}>
                <div className="ex-row-main">
                  <span className="ex-row-title">{w.name}</span>
                  <span className="ex-row-sub">
                    {count > 0 ? `${count} 个标签：${preview}${count > 4 ? "…" : ""}` : "暂无成员标签"}
                  </span>
                </div>
                <div className="ex-row-actions">
                  <Btn variant="ghost" onClick={() => { openWorkspace(w.id); closeTabDrawer(); }}>{i18n("auto.components.explorer.TabDrawer.13")}</Btn>
                  <Btn variant="ghost" onClick={() => openWorkspaceEditor(w.id)}>{i18n("auto.components.explorer.TabDrawer.14")}</Btn>
                  {w.live ? (
                    <Btn variant="ghost" titleAttr={i18n("auto.components.explorer.TabDrawer.15")} onClick={() => dissolveWorkspace(w.id)}>{i18n("auto.components.explorer.TabDrawer.16")}</Btn>
                  ) : null}
                  <Btn variant="ghost" titleAttr={i18n("auto.components.explorer.TabDrawer.17")} onClick={() =>
                      void confirmOk(`彻底删除工作区「${w.name}」及其中的 ${count} 个标签页？`).then((ok) => {
                        if (ok) closeLiveWorkspace(w.id);
                      })
                    }>{i18n("auto.components.explorer.TabDrawer.18")}</Btn>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ══════════ 标签页行 ══════════ */

function TabRow({
  tab,
  onMove,
}: {
  tab: ExplorerTab;
  onMove: (tab: ExplorerTab, x: number, y: number) => void;
}): ReactNode {
  const isHome = tab.kind === "home";
  const { label, full } = isHome
    ? { label: i18n("auto.components.explorer.TabDrawer.p1"), full: "首页" }
    : resolveTabTitle(tab.page, tab.params);
  const active = tab.id === activeTabId();
  return (
    /* data-tab-id / data-ws-id：行级拖拽与右键/长按菜单的解析锚点（与标签条同源语义） */
    <div className={"ex-row" + (active ? " is-active" : "")} data-tab-id={tab.id} data-ws-id={tab.workspaceId ?? undefined}>
      <button className="ex-row-main ex-row-clickable" onClick={() => { focusTab(tab.id); closeTabDrawer(); }}>
        <span className="ex-row-title">{label}</span>
        <span className="ex-row-sub">
          {isHome ? "首页 · 不可关闭" : `${full} · ${relTime(tab.lastActiveAt)}`}
        </span>
      </button>
      {isHome ? null : (
        <div className="ex-row-actions">
          <button className="ex-mini" title={i18n("auto.components.explorer.TabDrawer.19")} aria-label={`把「${label}」移入工作区`} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onMove(tab, r.left, r.bottom + 4); }}>⋯</button>
          <button className="ex-mini" title={i18n("auto.components.explorer.TabDrawer.20")} aria-label={`上移 ${label}`} onClick={() => moveTab(tab.id, -1)}>↑</button>
          <button className="ex-mini" title={i18n("auto.components.explorer.TabDrawer.21")} aria-label={`下移 ${label}`} onClick={() => moveTab(tab.id, 1)}>↓</button>
          <button className="ex-mini" title={i18n("auto.components.explorer.TabDrawer.22")} aria-label={`关闭 ${label}`} onClick={() => closeTab(tab.id)}>
            <IconX width={11} height={11} />
          </button>
        </div>
      )}
    </div>
  );
}


/* ══════════ ⑦ 小窗内搜索：已打开标签页按 label/full 过滤（大小写不敏感） ══════════ */

function SearchTabResults({ query, onMove }: { query: string; onMove: (tab: ExplorerTab, x: number, y: number) => void }): ReactNode {
  const q = query.trim().toLowerCase();
  const hits = allTabs().filter((t) => {
    const { label, full } = t.kind === "home" ? { label: i18n("auto.components.explorer.TabDrawer.p2"), full: "首页" } : resolveTabTitle(t.page, t.params);
    return label.toLowerCase().includes(q) || full.toLowerCase().includes(q);
  });
  if (hits.length === 0) return <div className="ex-empty-hint">{i18n("auto.components.explorer.TabDrawer.23")}</div>;
  return (
    <div className="ex-row-list">
      {hits.map((t) => (
        <TabRow key={t.id} tab={t} onMove={onMove} />
      ))}
    </div>
  );
}

/* ══════════ 抽屉本体 ══════════ */

function TabDrawerInner(): ReactNode {
  const open = useDrawerOpen();
  const layout = useTabLayoutMode();
  /* 手机端归宿 seeking 抽屉（A4）：GestureRecognizer = PhoneSheet 的把手 + 两档惯吸 */
  const phoneUi = useIsPhone();
  const snapState = useSheetSnap("tabdrawer");
  const sheetRef = useRef<HTMLElement | null>(null);
  const sheet = useSheetDrag(sheetRef, { id: "tabdrawer" });
  const [closing, requestClose] = useExitPhase(closeTabDrawer, open);
  const expanded = useExpanded();
  const anchor = useAnchorPos("ex-bbar-tabs-btn", open, expanded);
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  const tabs = allTabs();
  const pageTabs = snap.tabs;
  const [menuFor, setMenuFor] = useState<{ tab: ExplorerTab; x: number; y: number } | null>(null);
  /** 拖上「没有工作区的标签」停留松手 = 现场建工作区（成员 = 两颗） */
  const [pendingGroup, setPendingGroup] = useState<{ dragId: string; targetId: string } | null>(null);
  const [query, setQuery] = useState("");
  useTabTitleTick();

  /** 标签行菜单（A4 拍板的最小集合）：右键与触屏长按共用 */
  const openTabMenuAt = useCallback((x: number, y: number, t: ExplorerTab): void => {
    const items: MenuItem[] = [
      { label: i18n("auto.components.explorer.TabDrawer.p3"), onSelect: () => { focusTab(t.id); closeTabDrawer(); } },
      { label: i18n("auto.components.explorer.TabDrawer.p4"), onSelect: () => duplicateTab(t.id) },
      { label: i18n("auto.components.explorer.TabDrawer.p5"), onSelect: () => closeTab(t.id), sepBefore: true },
    ];
    if (t.workspaceId) {
      items.push({ label: i18n("auto.components.explorer.TabDrawer.p6"), onSelect: () => setTabWorkspace(t.id, null) });
      const ws = explorerSnapshot().workspaces.find((w) => w.id === t.workspaceId);
      if (ws) items.push({ label: i18n("auto.components.explorer.TabDrawer.p7"), onSelect: () => dissolveWorkspace(ws.id), danger: true, sepBefore: true });
    }
    openContextMenu(x, y, items);
  }, []);

  /** 工作区行菜单（WorkspacePanel 行 + 当前页组头共用） */
  const openWsMenuAt = useCallback((x: number, y: number, wsId: string): void => {
    const ws = explorerSnapshot().workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    const count = explorerSnapshot().tabs.filter((t) => t.workspaceId === wsId).length;
    const items: MenuItem[] = [
      { label: i18n("auto.components.explorer.TabDrawer.p8"), onSelect: () => { openWorkspace(wsId); closeTabDrawer(); } },
      { label: i18n("auto.components.explorer.TabDrawer.p9"), onSelect: () => openWorkspaceEditor(wsId) },
      { label: i18n("auto.components.explorer.TabDrawer.p10"), onSelect: () => dissolveWorkspace(wsId), danger: true, sepBefore: true },
      {
        label: i18n("auto.components.explorer.TabDrawer.p11"),
        onSelect: () =>
          void confirmOk(`彻底删除工作区「${ws.name}」及其中的 ${count} 个标签页？`).then((ok) => {
            if (ok) closeLiveWorkspace(wsId);
          }),
        danger: true,
        sepBefore: true,
      },
    ];
    openContextMenu(x, y, items);
  }, []);

  const rowsCtl = useDrawerRowsReorder({
    onTabMenu: openTabMenuAt,
    onWsMenu: openWsMenuAt,
    onGroupDrop: (d) => {
      if (d.targetWsId) setTabsWorkspace([d.dragId], d.targetWsId);
      else if (d.targetId) setPendingGroup({ dragId: d.dragId, targetId: d.targetId });
    },
  });

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !menuFor) requestClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, menuFor, requestClose]);

  if (!open) return null;

  /* 按工作区分组：未分组兜底在前，其后按工作区列表顺序 */
  const ungrouped = pageTabs.filter((t) => !t.workspaceId);
  const groups = snap.workspaces
    .map((w) => ({ ws: w, members: membersOf(snap, w.id) }))
    .filter((g) => g.members.length > 0);

  const sheetMobClass = phoneUi
    ? sheet.dragging
      ? " is-mob-drag"
      : snapState === "full"
        ? " is-mob-full"
        : " is-mob-half"
    : "";

  return createPortal(
    <>
      <div className={"ex-sheet-mask" + (closing ? " is-closing" : "")} onClick={requestClose} />
      <aside
        ref={phoneUi ? sheetRef : undefined}
        className={"ex-sheet ex-tabdrawer" + (expanded ? " ex-pop" : "") + (closing ? " is-closing" : "") + sheetMobClass}
        role="dialog"
        aria-label={i18n("auto.components.explorer.TabDrawer.24")}
        style={phoneUi
          ? { height: sheet.dragH != null ? `${sheet.dragH}px` : undefined }
          : expanded ? { top: anchor?.top, left: anchor?.left, bottom: "auto", right: "auto", visibility: anchor ? undefined : "hidden" } : undefined}
        onPointerDown={rowsCtl.onPointerDown}
        onContextMenu={rowsCtl.onContextMenu}
        onClickCapture={rowsCtl.onClickCapture}
      >
        {/* 手机端（A4）：seeking 抽屉的拖把手（44px 触目标，惯性吸附 0.6vh ⟷ 0.94vh） */}
        {phoneUi ? <PhoneSheetGrip label={i18n("auto.components.explorer.TabDrawer.25")} gripProps={sheet.gripProps} /> : null}
        <header className="ex-sheet-head">
          <b>{i18n("auto.components.explorer.TabDrawer.24")}</b>
          <span className="ex-sec-head-note">{pageTabs.length} {i18n("auto.components.explorer.TabDrawer.26")}</span>
          <Btn variant="ghost" onClick={requestClose}>{i18n("auto.components.explorer.TabDrawer.27")}</Btn>
        </header>
        {/* A1：手机只有横标签页——横/竖版切换分段在手机不渲染（设置里的默认值行同样收掉） */}
        {phoneUi ? null : (
        <div className="ex-seg-row">
          <div className="segmented ex-seg" role="tablist" aria-label={i18n("auto.components.explorer.TabDrawer.28")}>
            <button className={layout === "h" ? "is-active" : ""} role="tab" aria-selected={layout === "h"} onClick={() => setTabLayoutMode("h")}>{i18n("auto.components.explorer.TabDrawer.29")}</button>
            <button className={layout === "v" ? "is-active" : ""} role="tab" aria-selected={layout === "v"} onClick={() => setTabLayoutMode("v")}>{i18n("auto.components.explorer.TabDrawer.30")}</button>
          </div>
        </div>
        )}
        <div className="ex-sheet-body">
          <div className="ex-sheet-search">
            <Input placeholder={i18n("auto.components.explorer.TabDrawer.31")} value={query} onChange={(value) => setQuery(value)} />
          </div>
          {query.trim() ? (
            <section aria-label={i18n("auto.components.explorer.TabDrawer.32")}>
              <SearchTabResults query={query} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
            </section>
          ) : (
          <section aria-label={i18n("auto.components.explorer.TabDrawer.33")}>
            <div className="ex-sec-head">
              <b>{i18n("auto.components.explorer.TabDrawer.33")}</b>
              {pageTabs.length > 1 ? (
                <Btn variant="ghost" onClick={() => closeOtherTabs(activeTabId())}>{i18n("auto.components.explorer.TabDrawer.34")}</Btn>
              ) : null}
            </div>
            <div className="ex-row-list">
              <TabRow tab={tabs[0]!} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
              {ungrouped.length > 0 ? (
                <>
                  <div className="ex-group-head">
                    <span className="ex-group-name">{i18n("auto.components.explorer.TabDrawer.35")}</span>
                    <span className="ex-group-count">{ungrouped.length}</span>
                  </div>
                  {ungrouped.map((t) => (
                    <TabRow key={t.id} tab={t} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
                  ))}
                </>
              ) : null}
              {groups.map((g) => (
                <div key={g.ws.id}>
                  <div className="ex-group-head">
                    <span className="ex-group-dot" aria-hidden="true" />
                    <span className="ex-group-name">{g.ws.name}</span>
                    <span className="ex-group-count">{g.members.length}</span>
                  </div>
                  {g.members.map((t) => (
                    <TabRow key={t.id} tab={t} onMove={(tab, x, y) => setMenuFor({ tab, x, y })} />
                  ))}
                </div>
              ))}
            </div>
          </section>
          )}
          {query.trim() ? null : <WorkspacePanel />}
        </div>
        <footer className="ex-sheet-foot">
          <Btn variant="ghost" onClick={() => { focusTab(HOME_TAB_ID); closeTabDrawer(); }}>{i18n("auto.components.explorer.TabDrawer.36")}</Btn>
        </footer>
      </aside>
      {menuFor ? <MoveMenu tab={menuFor.tab} x={menuFor.x} y={menuFor.y} snap={snap} onClose={() => setMenuFor(null)} /> : null}
      {pendingGroup ? (
        <WorkspaceCreateDialog
          onCancel={() => setPendingGroup(null)}
          onCreate={(o) => {
            createLiveWorkspace(o, [pendingGroup.dragId, pendingGroup.targetId]);
            setPendingGroup(null);
          }}
        />
      ) : null}
    </>,
    document.body,
  );
}

export function TabDrawer(): ReactNode {
  return <TabDrawerInner />;
}
