import { vaultCatchTab } from "../../lib/vaultCatch.js";
import { Input, Text } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/**
 * 顶栏标签条（dev-explorer 工作空间革命）：首页恒在第一（不可关闭、不可多开），
 * 其后是打开的工作标签页（同页同实例复用，「复制」才多开），行尾「+」= 回首页。
 *
 * v2（用户拍板「tab 上只写『通知』是偷懒」）：标题走 state/tabTitles.ts 的
 * resolveTabTitle —— tab 上显示实体级短标签（label），完整路径（full）挂 title
 * 属性 hover 可见；数据快照就绪后由 useTabTitleTick 的 15s 节拍升级为实体名。
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { useT } from "../../i18n/index.js";
import {
  activeTab,
  allTabs,
  closeTab,
  duplicateTab,
  explorerSnapshot,
  focusTab,
  HOME_TAB_ID,
  openSettings,
  closeLiveWorkspace,
  createLiveWorkspace,
  patchLiveWorkspace,
  moveTabsBlock,
  setTabsWorkspace,
  setTabWorkspace,
  dissolveWorkspace,
  WORKSPACE_COLORS,
  WORKSPACE_ICONS,
  subscribeExplorer,
  type ExplorerWorkspace,
  type ExplorerTab,
  openTab,
} from "../../state/explorer.js";
import { resolveTabTitle, useTabTitleTick } from "../../state/tabTitles.js";
import { enc, PAGE_ATOMS, tabAtomKey } from "../../state/atoms.js";
import { getLearnSnapshot } from "../../state/data.js";
import { atomKeyOf, type AtomRef } from "../../state/favorites.js";
import { createOnePageForAtom, onePagesWithAtom, openOnePage, removeOnePage } from "../../state/onePage.js";
import type { Board } from "../../state/boardCore.js";
import { useFavs } from "../../state/favs.js";
import { topLevelPage, type LearnNav, type Page } from "../../state/app.js";
import { activeBoard, loadBoard } from "../../state/board.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../../plugins/tabs.js";
import {
  FOLDER_ICONS, IconBook, IconCalendar, IconCard, IconCloud, IconExternal, IconFlag, IconFolder,
  IconGitLab, IconHome, IconIn, IconInfo, IconLearn, IconMail, IconOrb, IconPen, IconPin, IconPlus,
  IconSchedule, IconSettings, IconSpark, IconStar, IconTabsCards, IconThos, IconTrace, IconX,
  IconXiaoda, IconXk,
} from "../Icons.js";
import { confirmOk } from "../../lib/confirm.js";
import { useTabLayoutMode } from "../../state/tabLayout.js";
import { useIsPhone } from "../../state/phoneSheets.js";
import { haptic } from "../../lib/haptics.js";
import { openContextMenu, type MenuItem } from "./ContextMenu.js";
import { openWorkspaceEditor } from "./WorkspaceEditor.js";
import { t as i18n } from "../../i18n/index.js";


/** 订阅 explorer store 的共享小钩子（TabDrawer/BottomBar 复用，别各自再写一遍） */
export function useExplorerTabs(): { tabs: ExplorerTab[]; activeId: string } {
  const snap = useSyncExternalStore(subscribeExplorer, explorerSnapshot, explorerSnapshot);
  return { tabs: allTabs(), activeId: snap.activeId };
}

/** 首页图标：小房子（内联 SVG，不引库） */



/* ══════════ ⑧ 悬停小窗（鼠标专属；touch/pen 不启用） ══════════ */

type TipState = { kind: "copy" | "tab" | "gear"; tabId?: string; rect: DOMRect };

const HOVER_TIP_MS = 150; /* 用户实测原生 title 出得慢——自绘接管后 150ms 即现 */

function TabstripTip({ tip }: { tip: TipState }): ReactNode {
  useTabTitleTick();
  const { tabs } = useExplorerTabs();
  const tab = tip.tabId ? tabs.find((t) => t.id === tip.tabId) ?? null : null;
  const isHome = tab?.kind === "home";
  const full = tab ? (isHome ? "首页" : resolveTabTitle(tab.page, tab.params).full) : "";
  const text = tip.kind === "copy" ? ("复制当前页面 · " + resolveTabTitle(activeTab().page, activeTab().params).full) : tip.kind === "gear" ? "设置" : (isHome ? "首页 · 不可关闭" : full);
  /* 小标识（用户定案）：只要悬停出现的小行卡，不带动作与宽卡 */
  const strip = document.querySelector(".ex-tabstrip")?.getBoundingClientRect();
  const top = (strip?.bottom ?? tip.rect.bottom) + 4;
  const anchor = tip.rect.left + tip.rect.width / 2;
  const boxRef = useRef<HTMLDivElement>(null);
  /* 实测宽度后钳位：居中对准被悬停的标签，贴边时只在视口内左右让位 */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(anchor - w / 2, 8), Math.max(window.innerWidth - w - 8, 8));
    el.style.left = `${left}px`;
  });
  return createPortal(
    <div ref={boxRef} className="ex-tip" role="tooltip" style={{ top }} onClick={(e) => e.stopPropagation()}>
      {text}
    </div>,
    document.body,
  );
}


/** 标签页 → AtomRef（用户定案：每个非首页标签都能一星收藏成独立 OnePage）。
 *  优先匹配既有 PAGE_ATOMS（参数完全一致才命中，保持既有收藏引用不断）；
 *  实体页或无对应原子的页面统一落到通用 "tab" 原子（page + params 即身份）。 */
export function atomRefOfTab(tab: ExplorerTab): AtomRef | null {
  if (tab.kind !== "page") return null;
  const params = (tab.params ?? {}) as LearnNav;
  const generic: AtomRef = { kind: "tab", key: tabAtomKey(tab.page, tab.params ?? undefined) };
  let entity: AtomRef | null = null;
  switch (tab.page) {
    case "learn-course": {
      const c = getLearnSnapshot()?.courses.find((x) => x.id === params.courseId);
      entity = c ? { kind: "course", key: enc(c.id, c.name, c.teacherName) } : null;
      break;
    }
    case "learn-assignment-detail": {
      const hw = getLearnSnapshot()?.homework.find((h) => h.id === params.itemId);
      entity = hw ? { kind: "assignment", key: enc(hw.courseId, hw.id, hw.title) } : null;
      break;
    }
    case "learn-notice-detail": {
      const n = getLearnSnapshot()?.notifications.find((x) => x.id === params.itemId);
      entity = n ? { kind: "notice", key: enc(n.courseId, n.id, n.title) } : null;
      break;
    }
    case "learn-file-detail": {
      const f = getLearnSnapshot()?.files.find((x) => x.id === params.itemId);
      entity = f ? { kind: "file", key: enc(f.courseId, f.id, f.title) } : null;
      break;
    }
    default: {
      const keys = Object.keys(tab.params ?? {}).filter((k) => (tab.params as Record<string, unknown>)[k] !== undefined);
      const hit = PAGE_ATOMS.find((a) => {
        if (a.page !== (tab.page as Page)) return false;
        const ap = (a.params ?? {}) as Record<string, unknown>;
        const apKeys = Object.keys(ap);
        if (apKeys.length !== keys.length) return false;
        return apKeys.every((k) => ap[k] === (tab.params as Record<string, unknown> | null)?.[k]);
      });
      entity = hit ? { kind: "page", key: hit.key } : null;
    }
  }
  return entity ?? generic;
}

/** 星形图标：未收藏描边灰，收藏点亮起（fill 随 .is-lit 的 svg path 通配） */
export function StarGlyph(): ReactNode {
  return <IconStar width={13} height={13} />;
}

/** 连续同工作区标签成组（底板）；无工作区的标签各自为组 */
interface TabGroup {
  key: string;
  ws: ExplorerWorkspace | null;
  tabs: ExplorerTab[];
}
function groupTabs(tabs: ExplorerTab[]): TabGroup[] {
  const wsMap = new Map(explorerSnapshot().workspaces.map((w) => [w.id, w] as const));
  const out: TabGroup[] = [];
  for (const t of tabs) {
    const ws = t.workspaceId ? wsMap.get(t.workspaceId) ?? null : null;
    const last = out[out.length - 1];
    if (ws && last && last.ws?.id === ws.id) {
      last.tabs.push(t);
    } else {
      out.push({ key: ws ? "ws-" + ws.id + "-" + t.id : t.id, ws, tabs: [t] });
    }
  }
  return out;
}

/** 工作区底板头：logo + 名字 + 折叠 + 大关闭按钮（关闭=关掉成员标签并移除工作区） */
function WsHeader({ ws, count }: { ws: ExplorerWorkspace; count: number }): ReactNode {
  const tr = useT();
  const Glyph = WS_ICON_GLYPH[ws.icon ?? "folder"] ?? IconFolder;
  return (
    <div
      className="ex-ws-head"
      onContextMenu={(e) => {
        e.preventDefault();
        const items: MenuItem[] = [
          { label: i18n("auto.components.explorer.TabStrip.p1"), onSelect: () => openWorkspaceEditor(ws.id) },
          { label: i18n("auto.components.explorer.TabStrip.p2"), onSelect: () => dissolveWorkspace(ws.id), sepBefore: true },
          {
            label: i18n("auto.components.explorer.TabStrip.p3"),
            danger: true,
            sepBefore: true,
            onSelect: () =>
              void confirmOk(`彻底删除工作区「${ws.name}」及其中的 ${count} 个标签页？`).then((ok) => {
                if (ok) closeLiveWorkspace(ws.id);
              }),
          },
        ];
        openContextMenu(e.clientX, e.clientY, items);
      }}
    >
      <button
        type="button"
        className="ex-ws-fold"
        aria-expanded={!ws.collapsed}
        title={ws.collapsed ? tr("shell.expandWs") : tr("shell.collapseWs")}
        onClick={() => patchLiveWorkspace(ws.id, { collapsed: !ws.collapsed })}
      >
        <Glyph width={12} height={12} />
        <span className="ex-ws-name">{ws.name}</span>
        <span className="ex-ws-count">{count}</span>
      </button>
      <button
        type="button"
        className="ex-ws-close"
        aria-label={"关闭工作区 " + ws.name}
        title={tr("shell.closeWs")}
        onClick={() =>
          void confirmOk(`关闭工作区「${ws.name}」及其中的 ${count} 个标签页？`).then((ok) => {
            if (ok) closeLiveWorkspace(ws.id);
          })
        }
      >
        <IconX width={11} height={11} />
      </button>
    </div>
  );
}

export const WS_ICON_GLYPH: Record<string, (p: { width?: number; height?: number }) => ReactNode> = {
  folder: IconFolder,
  star: IconStar,
  pin: IconPin,
  book: IconBook,
  flag: IconFlag,
  orb: IconOrb,
  learn: IconLearn,
  info: IconInfo,
};

/**
 * 标签拖动改顺序（鼠标，浏览器式）：
 * - 按下位移 >6px 进入拖拽；被拖标签直接跟随指针（只改 transform，不动 store，无重渲染）；
 * - 其余标签按目标位置整体平移让出空位（CSS transition，160ms）；
 * - 松手：被拖标签滑到目标槽位，随后 flushSync 提交真正的顺序并清掉临时 transform，无跳变；
 * - 首页钉死（不可拖、不参与位移，reorderTab 再夹一次下标）；拖拽后吞掉随后的 click。
 */
const DRAG_THRESHOLD = 6;
const SHIFT_MS = 160;
const EASE = "cubic-bezier(.2,.7,.3,1)";
/** 停留多久出现灰框（组合意图） */
const DWELL_MS = 600;
/** 目标标签两端各 25% 为让位区，中间 50% 为停留区 */
const EDGE = 0.25;
/** 工作区内标签垂直（竖版为水平）拖出超过该距离 = 脱离工作区 */
const OUT_PX = 40;

/** 停留框内松手的组合意图 */
export interface GroupDrop {
  dragId: string;
  targetId: string;
  targetWsId: string | null;
}

/** 拖拽单元：独立标签（ids=[id]）、工作区（ids=整组成员）、首页（ids=[]，不可移动） */
interface Lane {
  el: HTMLElement;
  ids: string[];
}

/** 标签条的一层单元：工作区底板整体算一个单元，独立标签各自一个单元 */
function stripLanes(strip: HTMLElement): Lane[] {
  const out: Lane[] = [];
  for (const child of Array.from(strip.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.classList.contains("ex-ws-band")) {
      const wsId = child.getAttribute("data-ws-id");
      const ids = allTabs().filter((t) => t.workspaceId === wsId).map((t) => t.id);
      out.push({ el: child, ids });
    } else if (child.classList.contains("ex-tab")) {
      const id = child.getAttribute("data-tab-id") ?? "";
      out.push({ el: child, ids: child.classList.contains("is-home") ? [] : [id] });
    }
  }
  return out;
}

/** 工作区内部的标签单元（只在组内换序） */
function bandLanes(band: HTMLElement): Lane[] {
  return Array.from(band.querySelectorAll<HTMLElement>(".ex-tab")).map((el) => ({
    el,
    ids: [el.getAttribute("data-tab-id") ?? ""],
  }));
}

function useTabReorder(stripRef: { current: HTMLDivElement | null }, vertical: boolean, onGroupDrop: (d: GroupDrop) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const dropRef = useRef(onGroupDrop);
  dropRef.current = onGroupDrop;

  /** 通用拖拽：mode = tab（独立标签，可组合）｜band（整个工作区）｜member（工作区内标签） */
  const startDrag = (
    strip: HTMLDivElement,
    mode: "tab" | "band" | "member",
    dragEl: HTMLElement,
    lane: Lane[],
    dragIds: string[],
    ev0: { clientX: number; clientY: number },
  ): void => {
    const along = (ev: { clientX: number; clientY: number }): number => (vertical ? ev.clientY : ev.clientX);
    const cross = (ev: { clientX: number; clientY: number }): number => (vertical ? ev.clientX : ev.clientY);
    const aStart = (r: DOMRect): number => (vertical ? r.top : r.left);
    const aEnd = (r: DOMRect): number => (vertical ? r.bottom : r.right);
    const aSize = (r: DOMRect): number => (vertical ? r.height : r.width);
    const tAlong = (n: number): string => (vertical ? `translateY(${n}px)` : `translateX(${n}px)`);
    const tCross = (n: number): string => (vertical ? `translateX(${n}px)` : `translateY(${n}px)`);

    const els = lane.map((l) => l.el);
    const from = els.indexOf(dragEl);
    if (from < 0) return; // 触屏武装延迟期间若发生重渲染，被押元素可能已不在条上：静默放弃
    const dragSet = new Set(dragIds);
    const order = allTabs().filter((t) => t.kind !== "home").map((t) => t.id);
    const restIds = order.filter((x) => !dragSet.has(x));
    const dragWsId = mode === "tab" ? allTabs().find((t) => t.id === dragIds[0])?.workspaceId ?? null : null;
    const a0 = along(ev0);
    const c0 = cross(ev0);
    let active = false;
    let rects: DOMRect[] = [];
    let dest = from;
    let lastDA = 0;
    let lastOut = false;
    let dragSize = 0;
    let dwellEl: HTMLElement | null = null;
    let frameEl: HTMLElement | null = null;
    let dwellTimer: number | null = null;

    const clearDwell = (): void => {
      if (dwellTimer !== null) window.clearTimeout(dwellTimer);
      dwellTimer = null;
      frameEl?.removeAttribute("data-ws-frame");
      frameEl = null;
      dwellEl = null;
    };

    const begin = (): void => {
      rects = els.map((x) => x.getBoundingClientRect());
      dragSize = aSize(rects[from]!);
      dest = from;
      els.forEach((x, i) => {
        if (i !== from) x.style.transition = `transform ${SHIFT_MS}ms ${EASE}`;
      });
      if (mode === "band") dragEl.setAttribute("data-ws-dragging", "1");
      else setDragId(dragIds[0] ?? null);
    };

    const move = (ev: PointerEvent): void => {
      if (!active) {
        if (Math.hypot(ev.clientX - ev0.clientX, ev.clientY - ev0.clientY) < DRAG_THRESHOLD) return;
        active = true;
        begin();
      }
      const fr = rects[from];
      if (!fr) return;
      let dA = along(ev) - a0;
      if (mode === "member") {
        // 工作区内只能在组内换序：沿轴钳在组的两端之间
        const minD = aStart(rects[0]!) - aStart(fr);
        const maxD = aEnd(rects[rects.length - 1]!) - aEnd(fr);
        dA = Math.max(minD, Math.min(maxD, dA));
      }
      const dC = cross(ev) - c0;
      const out = mode === "member" && Math.abs(dC) > OUT_PX;

      // 停留检测（独立标签之间的组合意图；工作区整体与组内拖拽不触发）
      let hoverEl: HTMLElement | null = null;
      if (mode === "tab" && !out) {
        strip.querySelectorAll<HTMLElement>(".ex-tab").forEach((x) => {
          if (x === dragEl || x.classList.contains("is-home")) return;
          const wsOther = allTabs().find((t) => t.id === x.getAttribute("data-tab-id"))?.workspaceId ?? null;
          if (wsOther !== null && wsOther === dragWsId) return;
          const r = x.getBoundingClientRect();
          const p = along(ev);
          if (p > aStart(r) + aSize(r) * EDGE && p < aEnd(r) - aSize(r) * EDGE) hoverEl = x;
        });
      }
      if (hoverEl !== dwellEl) {
        clearDwell();
        const he = hoverEl as HTMLElement | null;
        if (he) {
          dwellEl = he;
          dwellTimer = window.setTimeout(() => {
            dwellTimer = null;
            frameEl = he;
            he.setAttribute("data-ws-frame", "1");
          }, DWELL_MS);
        }
      }

      if (!hoverEl) {
        // 让位：中心点落在被拖单元中心之前的其余单元个数即为最终下标
        const center = aStart(fr) + dragSize / 2 + dA;
        let count = 0;
        els.forEach((x, i) => {
          if (i === from) return;
          const r = rects[i]!;
          if (aStart(r) + aSize(r) / 2 < center) count++;
        });
        dest = Math.max(0, Math.min(els.length - 1, count));
        els.forEach((x, i) => {
          if (i === from) return;
          let shift = 0;
          if (from < dest && i > from && i <= dest) shift = -dragSize;
          else if (dest < from && i >= dest && i < from) shift = dragSize;
          x.style.transform = shift ? tAlong(shift) : "";
        });
      }
      lastDA = dA;
      lastOut = out;
      const dragEl2 = els[from]!;
      dragEl2.style.transition = "none";
      dragEl2.style.transform = out ? `${tAlong(dA)} ${tCross(dC)}` : tAlong(dA);
      dragEl2.style.zIndex = "6";
      dragEl2.style.position = "relative";
    };

    const cleanupVisual = (): void => {
      els.forEach((x) => {
        x.style.transition = "";
        x.style.transform = "";
        x.style.zIndex = "";
        x.style.position = "";
      });
      dragEl.removeAttribute("data-ws-dragging");
    };

    /** 其余单元按 lane 顺序展开为标签 id，供换算成 state.tabs 的下标 */
    const othersFlat = (): string[] => {
      const out: string[] = [];
      for (let j = 0; j < els.length; j++) {
        if (j === from) continue;
        out.push(...lane[j]!.ids);
      }
      return out;
    };

    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!active) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      const fr = rects[from];
      if (!fr) {
        clearDwell();
        setDragId(null);
        return;
      }
      const flat = othersFlat();
      // 其余单元里位于 dest 之前的标签数 k（单元整体计数，不会切开工作区）
      let k = 0;
      for (let j = 0; j < dest; j++) {
        const idx = j < from ? j : j + 1;
        k += lane[idx]?.ids.length ?? 0;
      }
      const fallback = order.indexOf(dragIds[0] ?? "");

      // 组合意图：停留框内松手 → 挨到目标之后，再归并
      if (frameEl && !lastOut && mode === "tab") {
        const tgt = frameEl as HTMLElement;
        const targetId = tgt.getAttribute("data-tab-id");
        const targetWsId = allTabs().find((t) => t.id === targetId)?.workspaceId ?? null;
        clearDwell();
        if (targetId) {
          const at = restIds.indexOf(targetId) + 1;
          flushSync(() => {
            moveTabsBlock(dragIds, at);
            setDragId(null);
          });
          cleanupVisual();
          dropRef.current({ dragId: dragIds[0] ?? "", targetId, targetWsId });
          return;
        }
      }
      clearDwell();

      if (lastOut) {
        // 脱离工作区：放到工作区的前或后，不切开工作区
        let at: number;
        if (flat.length === 0) at = fallback;
        else if (k * 2 <= flat.length) at = restIds.indexOf(flat[0]!);
        else at = restIds.indexOf(flat[flat.length - 1]!) + 1;
        flushSync(() => {
          setTabsWorkspace(dragIds, null);
          moveTabsBlock(dragIds, at);
          setDragId(null);
        });
        cleanupVisual();
        return;
      }

      // 普通让位：滑入落点后同步提交顺序（组外与组内共用）
      let at: number;
      if (flat.length === 0) at = fallback;
      else if (k < flat.length) at = restIds.indexOf(flat[k]!);
      else at = restIds.indexOf(flat[flat.length - 1]!) + 1;

      const slot = dest > from ? aEnd(rects[dest]!) - dragSize : dest < from ? aStart(rects[dest]!) : aStart(fr);
      const dragEl2 = els[from]!;
      dragEl2.style.transition = `transform ${SHIFT_MS}ms ${EASE}`;
      dragEl2.style.transform = tAlong(slot - aStart(fr));
      window.setTimeout(() => {
        flushSync(() => {
          moveTabsBlock(dragIds, at);
          setDragId(null);
        });
        cleanupVisual();
      }, SHIFT_MS);
      void lastDA;
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /** 按下的目标解析成拖拽单元（鼠标与触屏共用一份，语义与栏一致）：
      band = 按住工作区名字整组拖；member = 组内标签（组内换序）；tab = 独立标签 */
  const resolveUnit = (
    strip: HTMLDivElement,
    target: Element | null,
  ): { mode: "tab" | "band" | "member"; el: HTMLElement; ids: string[] } | null => {
    if (!target) return null;
    if (target.closest(".ex-tab-close, .ex-ws-close")) return null;
    const band = target.closest(".ex-ws-band") as HTMLElement | null;
    // ① 按住工作区名字 → 整组拖动
    if (band && target.closest(".ex-ws-fold")) {
      const wsId = band.getAttribute("data-ws-id");
      const ids = allTabs().filter((t) => t.workspaceId === wsId).map((t) => t.id);
      if (!wsId || ids.length === 0) return null;
      return { mode: "band", el: band, ids };
    }
    const tab = target.closest(".ex-tab") as HTMLElement | null;
    if (!tab || tab.classList.contains("is-home")) return null;
    const id = tab.getAttribute("data-tab-id");
    if (!id) return null;
    // ② 工作区内的标签：只在组内换序，拖出超过阈值才脱离
    if (band) return { mode: "member", el: tab, ids: [id] };
    // ③ 独立标签：可拖到别的位置，或停留合并
    return { mode: "tab", el: tab, ids: [id] };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.pointerType !== "mouse") return;
    const strip = stripRef.current;
    if (!strip) return;
    const unit = resolveUnit(strip, e.target instanceof Element ? e.target : null);
    if (!unit) return;
    const lanes = unit.mode === "member"
      ? bandLanes(unit.el.closest(".ex-ws-band") as HTMLElement)
      : stripLanes(strip);
    startDrag(strip, unit.mode, unit.el, lanes, unit.ids, e);
  };
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  return { dragId, onPointerDown, onClickCapture, begin: startDrag, resolveUnit };
}

/** 现场建工作区：颜色 / 名字 / logo（松手即建，成员 = 被拖标签 + 停留标签）。导出给 TabDrawer 手机端复用 */
export function WorkspaceCreateDialog({ onCreate, onCancel }: { onCreate: (o: { name: string; color: string; icon: string }) => void; onCancel: () => void }): ReactNode {
  const [name, setName] = useState("工作区");
  const [color, setColor] = useState<string>(WORKSPACE_COLORS[0]);
  const [icon, setIcon] = useState<string>(WORKSPACE_ICONS[0]);
  /* portal 到 body：拖拽系统会给 tabstrip 祖先/标签残留内联 transform——
     fixed 在有 transform 的祖先里被劫持成相对该祖先定位，命名窗就被挤进标签栏
     （2026-10-13 用户实测）。portal 到 body 后任何祖先都劫持不了。 */
  return createPortal(
    <div
      className="ws-create-mask"
      style={{ position: "fixed", inset: 0, zIndex: "var(--og-z-modal)", background: "var(--og-scrim)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-label={i18n("auto.components.explorer.TabStrip.1")}
        style={{ background: "var(--og-surface-overlay)", color: "var(--og-content-1)", borderRadius: "var(--og-radius-xl)", padding: 18, width: 320, boxShadow: "var(--og-elev-menu)" }}
      >
        <Text as="div" weight="semibold">{i18n("auto.components.explorer.TabStrip.1")}</Text>
        <div style={{ width: "100%", marginBottom: 12 }}>{<Input autoFocus value={name} onChange={(value) => setName(value)} placeholder={i18n("auto.components.explorer.TabStrip.2")} />}</div>
        <div style={{ marginBottom: 6 }}><Text slot="label" tone="faint">{i18n("auto.components.explorer.TabStrip.3")}</Text></div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {WORKSPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={"颜色 " + c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ width: 22, height: 22, borderRadius: "50%", border: color === c ? "2px solid var(--og-content-1)" : "1px solid transparent", background: c, cursor: "pointer" }}
            />
          ))}
        </div>
        <div style={{ marginBottom: 6 }}><Text slot="label" tone="faint">logo</Text></div>
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {WORKSPACE_ICONS.map((k) => {
            const G = WS_ICON_GLYPH[k] ?? IconFolder;
            return (
              <button
                key={k}
                type="button"
                aria-label={"logo " + k}
                aria-pressed={icon === k}
                onClick={() => setIcon(k)}
                style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: icon === k ? `2px solid ${color}` : "1px solid var(--og-line-2)", background: "transparent", cursor: "pointer", color: "inherit" }}
              >
                <G width={14} height={14} />
              </button>
          );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Btn variant="outline" onClick={onCancel}>{i18n("auto.components.explorer.TabStrip.4")}</Btn>
          <Btn variant="outline" onClick={() => onCreate({ name, color, icon })}>{i18n("auto.components.explorer.TabStrip.5")}</Btn>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 页面类型 → 标签图标：与一级功能区（NAV）同一套图标；OnePage 另用板自己的 icon。 */
function pageGlyph(page: Page): (p: { width?: number; height?: number }) => ReactNode {
  switch (topLevelPage(page)) {
    case "tasks": return IconPen;
    case "learn": return IconLearn;
    case "schedule": return IconSchedule;
    case "trace": return IconTrace;
    case "mail": return IconMail;
    case "cloud": return IconCloud;
    case "gitlab": return IconGitLab;
    case "thubook": return IconBook;
    case "xiaoda": return IconXiaoda;
    case "info": return IconInfo;
    case "life": return IconCard;
    case "reserve": return IconCalendar;
    case "zhjwxk": return IconXk;
    case "thos": return IconThos;
    case "otherinfo": return IconExternal;
    case "folder":
    case "favs": return IconPin;
    case "services": return IconSpark;
    case "boards": return IconTabsCards;
    case "settings": return IconSettings;
    case "contacts": return IconIn;
    case "vault": return IconIn;
    default: return IconFolder;
  }
}

/** 标签前的 logo：OnePage 用板自己的 icon，插件页用自己的 iconSvg，其余用一级功能区图标。 */
function TabGlyph({ page, star, boardIcon, pluginIcon }: {
  page: Page;
  star?: { icon?: string } | undefined;
  boardIcon?: string | undefined;
  pluginIcon?: string | undefined;
}): ReactNode {
  if (pluginIcon) {
    return <span className="ex-tab-glyph ex-tab-plugin-glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: pluginIcon }} />;
  }
  const key = star ? (star.icon ?? "fist") : "";
  const G = key
    ? (FOLDER_ICONS[key] ?? IconStar)
    : page === "board"
      ? (FOLDER_ICONS[boardIcon ?? ""] ?? IconFolder)
      : pageGlyph(page);
  return <span className={"ex-tab-glyph" + (key === "fist" ? " is-fist" : "")} aria-hidden="true"><G width={14} height={14} /></span>;
}

export function TabStrip(): ReactNode {
  const tr = useT();
  useTabTitleTick(); // 15s 节拍：数据快照晚于开 tab 时，实体名自动升级
  const { tabs, activeId } = useExplorerTabs();
  /* 插件页图标由插件注册时提供；OnePage 标签用当前打开的板自己的 icon。 */
  const pluginTabs = useSyncExternalStore(subscribePluginTabs, pluginTabsSnapshot, pluginTabsSnapshot);
  const pluginIcons = useMemo(() => new Map(pluginTabs.map((t) => [t.pageKey, t.iconSvg ?? ""] as const)), [pluginTabs]);
  /* OnePage 改名/换图标只发 boards.changed，不动 explorer store——不订阅的话标签标题与图标
     会停在旧值（改完 icon 在标签栏看不见）。 */
  const [boardsTick, setBoardsTick] = useState(0);
  useEffect(() => {
    const on = (): void => setBoardsTick((t) => t + 1);
    window.addEventListener("onethu.boards.changed", on);
    return () => window.removeEventListener("onethu.boards.changed", on);
  }, []);
  const boardIcon = useMemo(() => {
    if (!tabs.some((t) => t.page === "board")) return undefined;
    try {
      return activeBoard(loadBoard())?.icon;
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, boardsTick]);
  /* ① 横向滚动进度条（Layout 旧 SegmentedOverflow 的 indi/thumb 同款）：
     放不下（scrollWidth > clientWidth）才渲染，scrollLeft 比例驱动 thumb 宽/位；
     resize（ResizeObserver）+ scroll 双监听，开关标签后 tabs.length 变化再补一拍。 */
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const update = useCallback((): void => {
    const el = stripRef.current;
    if (!el) return;
    /* 判定与样式更新拆开：scrollable 翻转触发 Indi 挂载（thumbRef 之后才有效）；
       初版 update 头部 `if (!thumb) return` 造成死锁——首次不溢出 Indi 不渲染，之后
       溢出永远不更新（用户实测进度条压根不出现） */
    const overflow = el.scrollWidth - el.clientWidth;
    const can = overflow > 2 && el.clientWidth >= 60;
    setScrollable(can);
    const thumb = thumbRef.current;
    if (!can || !thumb) return;
    const frac = Math.min(Math.max(el.scrollLeft / overflow, 0), 1);
    const trackW = el.clientWidth;
    const w = (el.clientWidth / el.scrollWidth) * trackW;
    const thumbW = Math.max(24, Math.min(w, 88));
    thumb.style.width = `${thumbW}px`;
    thumb.style.left = `${frac * (trackW - thumbW)}px`;
  }, []);
  useLayoutEffect(() => {
    update();
    const el = stripRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update, scrollable]); /* scrollable 翻转 → Indi 挂载 → 补一拍 thumb 定位 */
  useEffect(() => {
    update();
  }, [tabs.length, update]);

  /* 滑动：竖向滚轮 → 横向滚动（条是横向的，鼠标滚轮默认滚不动）；
     进度条：拖滑块 / 点轨道跳转。 */
  const indiRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const dragRef = useRef<{ x0: number; s0: number; ratio: number } | null>(null);
  const onTrackDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = stripRef.current;
    const track = indiRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb || e.button !== 0) return;
    const overflow = el.scrollWidth - el.clientWidth;
    const trackW = el.clientWidth;
    const thumbW = thumb.offsetWidth;
    const range = Math.max(trackW - thumbW, 1);
    const x0 = e.clientX - track.getBoundingClientRect().left;
    const onThumb = x0 >= thumb.offsetLeft && x0 <= thumb.offsetLeft + thumbW;
    if (!onThumb) {
      const target = Math.min(Math.max(x0 - thumbW / 2, 0), range);
      el.scrollLeft = (target / range) * overflow;
    }
    dragRef.current = { x0: e.clientX, s0: el.scrollLeft, ratio: overflow / range };
    track.setPointerCapture(e.pointerId);
  };
  const onTrackMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    const el = stripRef.current;
    if (!d || !el) return;
    el.scrollLeft = d.s0 + (e.clientX - d.x0) * d.ratio;
  };
  const onTrackUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    indiRef.current?.releasePointerCapture(e.pointerId);
  };

  /* ⑧ 悬停小窗：pointerenter 计 600ms、leave/滚动清除；事件委托在顶栏上
     （复制钮/齿轮是 Layout 的 DOM，不改它的文件）；只认 pointerType === "mouse"。 */
  const favs = useFavs();
  const vertical = useTabLayoutMode() === "v";
  const [pendingGroup, setPendingGroup] = useState<GroupDrop | null>(null);
  const phoneUi = useIsPhone();
  const drag = useTabReorder(stripRef, vertical, (d) => {
    if (d.targetWsId) setTabsWorkspace([d.dragId], d.targetWsId);
    else setPendingGroup(d);
  });

  /* ═══ 触屏手势层（手机 only；touch-action: none 由 CSS 给 .ex-tabstrip）═══
     短触 = 原生点击（聚焦）；横移 = 手动横滚（条不能滚会没法翻标签）；
     按住 300ms = 武装拖拽（与栏同语义：独立标签 / 工作区整组 / 组内成员）；
     按住 500ms 不动 = 右键菜单（A4：聚焦 / 复制 / 关闭 / 解散工作区）。 */
  const ARM_MS = 300;
  const MENU_MS = 500;
  const PAN_PX = 8;
  type TouchCtl = {
    x0: number; y0: number; sl0: number; moved: boolean; armed: boolean;
    unit: ReturnType<typeof drag.resolveUnit>; hold: number | null; menu: number | null;
  };
  const touchCtl = useRef<TouchCtl | null>(null);
  /** 长按/横滚之后的 click 吞掉：那次手势不该再聚焦/切换标签 */
  const swallowClickRef = useRef(false);

  const clearTouchTimers = (t: TouchCtl): void => {
    if (t.hold !== null) window.clearTimeout(t.hold);
    if (t.menu !== null) window.clearTimeout(t.menu);
    t.hold = null;
    t.menu = null;
  };

  const onStripPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerType === "mouse" || e.button !== 0) return;
    const strip = stripRef.current;
    if (!strip) return;
    const unit = drag.resolveUnit(strip, e.target instanceof Element ? e.target : null);
    const t: TouchCtl = { x0: e.clientX, y0: e.clientY, sl0: strip.scrollLeft, moved: false, armed: false, unit, hold: null, menu: null };
    touchCtl.current = t;
    if (!unit) return; // 首页/关闭钮/加号：交给原生点击
    const x0 = e.clientX;
    const y0 = e.clientY;
    t.hold = window.setTimeout(() => {
      const cur = touchCtl.current;
      if (!cur || cur.moved) return;
      cur.armed = true;
      cur.hold = null;
      if (cur.menu !== null) {
        window.clearTimeout(cur.menu);
        cur.menu = null;
      }
      haptic("tick");
      const strip2 = stripRef.current;
      const u = cur.unit;
      if (!strip2 || !u) return;
      const lanes = u.mode === "member" ? bandLanes(u.el.closest(".ex-ws-band") as HTMLElement) : stripLanes(strip2);
      drag.begin(strip2, u.mode, u.el, lanes, u.ids, { clientX: x0, clientY: y0 });
    }, ARM_MS);
    t.menu = window.setTimeout(() => {
      const cur = touchCtl.current;
      clearTouchTimers(cur ?? t);
      touchCtl.current = null;
      if (!cur || cur.moved || cur.armed) return;
      swipeArmMenu(cur, x0, y0);
    }, MENU_MS);
  };

  /** 长按菜单：tab 走标签操作；band 走工作区操作（与工作区头右键同一份） */
  const swipeArmMenu = (t: TouchCtl, x0: number, y0: number): void => {
    if (!t.unit) return;
    haptic("longPress");
    swallowClickRef.current = true;
    if (t.unit.mode === "band") {
      const band = t.unit.el;
      const wsId = band.getAttribute("data-ws-id") ?? "";
      const wss = explorerSnapshot().workspaces;
      const ws = wss.find((w) => w.id === wsId);
      if (!ws) return;
      const count = allTabs().filter((x) => x.workspaceId === wsId).length;
      const items: MenuItem[] = [
        { label: i18n("auto.components.explorer.TabStrip.p4"), onSelect: () => openWorkspaceEditor(ws.id) },
        { label: i18n("auto.components.explorer.TabStrip.p5"), onSelect: () => dissolveWorkspace(ws.id), sepBefore: true, danger: true },
        {
          label: i18n("auto.components.explorer.TabStrip.p6"),
          onSelect: () =>
            void confirmOk(`彻底删除工作区「${ws.name}」及其中的 ${count} 个标签页？`).then((ok) => {
              if (ok) closeLiveWorkspace(ws.id);
            }),
          sepBefore: true,
          danger: true,
        },
      ];
      openContextMenu(x0, y0, items);
      return;
    }
    if (t.unit.mode === "member" || t.unit.mode === "tab") {
      const id = t.unit.ids[0] ?? "";
      const tab = allTabs().find((x) => x.id === id);
      if (tab) openTabMenuAt(x0, y0, tab);
    }
  };

  const onStripPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const t = touchCtl.current;
    if (!t) return;
    const dx = e.clientX - t.x0;
    const dy = e.clientY - t.y0;
    if (!t.moved && !t.armed && Math.hypot(dx, dy) > PAN_PX) {
      t.moved = true;
      clearTouchTimers(t);
    }
    /* 横滚：只在未武装时生效（武装后由拖拽引擎接管，滚条逻辑无关） */
    if (!t.armed && t.moved) {
      const strip = stripRef.current;
      if (strip) strip.scrollLeft = t.sl0 - dx;
    }
  };

  const onStripPointerUp = (): void => {
    const t = touchCtl.current;
    touchCtl.current = null;
    if (!t) return;
    clearTouchTimers(t);
    if (t.moved) swallowClickRef.current = true;
  };

  const onStripClickCapture = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (swallowClickRef.current) {
      swallowClickRef.current = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    drag.onClickCapture(e);
  };

  /** 标签所属的 OnePage（2026-10-13 起 OnePage 的本体 = 一块白板，收的内容是 atom-link 入口）；无则 undefined */
  const starredOnePage = (t: ExplorerTab): Board | undefined => {
    const ref = atomRefOfTab(t);
    if (!ref) return undefined;
    const k = atomKeyOf(ref);
    return onePagesWithAtom(k)[0];
  };
  const isStarred = (t: ExplorerTab): boolean => starredOnePage(t) !== undefined;
  /** 标签图标来源：旧文件夹页 tab（历史遗留）直接用它自己的图标；否则看所属 OnePage 板的图标 */
  const glyphOf = (t: ExplorerTab): { icon?: string } | undefined => {
    if (t.kind === "page" && t.page === "folder") {
      const fid = (t.params as { folderId?: string } | null)?.folderId;
      const legacy = fid ? favs.data.folders[fid] : undefined;
      return legacy ? { icon: legacy.icon } : undefined;
    }
    return starredOnePage(t);
  };
  /* 一星 / 取消一星（= 删除该独立 OnePage 本体，需确认）。
     2026-10-13 起 OnePage = 白板：一星建一块含该原子入口的板，并直接打开它——
     收完就见到白板本体（旧口径建 folder 书签列表，用户看不到任何白板操作，已废）。 */
  const toggleOnePage = (t: ExplorerTab): void => {
    const ref = atomRefOfTab(t);
    if (!ref) return;
    const key = atomKeyOf(ref);
    const name = resolveTabTitle(t.page, t.params);
    const existing = onePagesWithAtom(key)[0];
    if (!existing) {
      const id = createOnePageForAtom(name.label, key);
      if (id) {
        openOnePage(id);
        openTab("board", null, { title: name.label });
      }
      return;
    }
    void confirmOk(`确定删除 OnePage「${existing.name}」（${name.full}）？\n这块白板和其中的内容都会永久消失！`).then((ok) => {
      if (ok) removeOnePage(existing.id);
    });
  };
  /** 标签操作菜单（鼠标右键与触屏长按共用一份坐标形态） */
  const openTabMenuAt = (x: number, y: number, t: ExplorerTab): void => {
    const items: MenuItem[] = [
      { label: i18n("auto.components.explorer.TabStrip.p7"), onSelect: () => focusTab(t.id) },
      { label: i18n("auto.components.explorer.TabStrip.p8"), onSelect: () => duplicateTab(t.id) },
      { label: i18n("auto.components.explorer.TabStrip.p9"), onSelect: () => closeTab(t.id), sepBefore: true },
      { label: isStarred(t) ? "移出 OnePage（取消一星）" : "加入 OnePage（一星）", onSelect: () => toggleOnePage(t) },
    ];
    if (t.workspaceId) {
      items.push({ label: i18n("auto.components.explorer.TabStrip.p10"), onSelect: () => setTabWorkspace(t.id, null), sepBefore: true });
      const ws = explorerSnapshot().workspaces.find((w) => w.id === t.workspaceId);
      if (ws) items.push({ label: i18n("auto.components.explorer.TabStrip.p11"), onSelect: () => dissolveWorkspace(ws.id), danger: true });
    }
    openContextMenu(x, y, items);
  };
  const openTabMenu = (e: ReactMouseEvent, t: ExplorerTab): void => {
    e.preventDefault();
    openTabMenuAt(e.clientX, e.clientY, t);
  };

  const [tip, setTip] = useState<TipState | null>(null);
  const tipTimer = useRef<number | null>(null);
  const tipKey = useRef<string>("");
  const clearTip = useCallback((): void => {
    if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    tipTimer.current = null;
    tipKey.current = "";
    setTip(null);
  }, []);
  useLayoutEffect(() => {
    const resolve = (el: Element): TipState | null => {
      const tabEl = el.closest(".ex-tab");
      if (tabEl) {
        const id = tabEl.getAttribute("data-tab-id") ?? undefined;
        return { kind: "tab", tabId: id, rect: tabEl.getBoundingClientRect() };
      }
      const icon = el.closest(".tb-icon");
      if (icon) {
        const label = icon.getAttribute("aria-label") ?? icon.getAttribute("title") ?? "";
        if (label.includes("复制")) return { kind: "copy", rect: icon.getBoundingClientRect() };
        if (label.includes("设置")) return { kind: "gear", rect: icon.getBoundingClientRect() };
      }
      return null;
    };
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      const target = e.target instanceof Element ? e.target : null;
      const topbar = target?.closest?.(".explorer-topbar");
      if (!topbar) return;
      const next = resolve(target!);
      const key = next ? `${next.kind}:${next.tabId ?? ""}` : "";
      if (!next || key === tipKey.current) return;
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
      tipKey.current = key;
      tipTimer.current = window.setTimeout(() => setTip(next), HOVER_TIP_MS);
    };
    const onOut = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      const to = e.relatedTarget instanceof Element ? e.relatedTarget : null;
      if (!to || !to.closest(".explorer-topbar")) clearTip(); // 真正离开顶栏才清；钮内移动交给 onOver 重置
    };
    const topbar = stripRef.current?.closest(".explorer-topbar") ?? null;
    topbar?.addEventListener("pointerover", onOver as EventListener);
    topbar?.addEventListener("pointerout", onOut as EventListener);
    window.addEventListener("scroll", clearTip, { passive: true, capture: true });
    window.addEventListener("resize", clearTip);
    return () => {
      topbar?.removeEventListener("pointerover", onOver as EventListener);
      topbar?.removeEventListener("pointerout", onOut as EventListener);
      window.removeEventListener("scroll", clearTip, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", clearTip);
      if (tipTimer.current !== null) window.clearTimeout(tipTimer.current);
    };
  }, [clearTip]);
  /* 激活标签（新开 / 复用聚焦都会改 activeId）自动滚入视野 */
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const el = Array.from(strip.querySelectorAll<HTMLElement>(".ex-tab")).find((x) => x.getAttribute("data-tab-id") === activeId);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeId]);

  return (
    <div className="ex-tabstrip-wrap"> {/* 定位基准层：Indi 必须在 overflow 容器外，否则随滚动跑出视口 */}
      <div
        className={"ex-tabstrip" + (vertical ? " is-vertical" : "")}
        role="tablist"
        aria-label={tr("shell.tabs")}
        ref={stripRef}
        onPointerDown={phoneUi ? onStripPointerDown : drag.onPointerDown}
        onPointerMove={phoneUi ? onStripPointerMove : undefined}
        onPointerUp={phoneUi ? onStripPointerUp : undefined}
        onPointerCancel={phoneUi ? onStripPointerUp : undefined}
        onClickCapture={onStripClickCapture}
      >
      {groupTabs(tabs).map((g) => {
        const inner = (g.ws?.collapsed ? [] : g.tabs).map((t) => {
        const active = t.id === activeId;
        const isHome = t.kind === "home";
        const label = isHome ? tr("shell.home") : resolveTabTitle(t.page, t.params).label;
        const full = isHome ? tr("shell.home") : resolveTabTitle(t.page, t.params).full;
        return (
          <div
            key={t.id}
            data-tab-id={t.id}
            data-vault-catch={isHome ? undefined : vaultCatchTab({ title: label, page: t.page, params: t.params as Record<string, unknown> | null })}
            className={"ex-tab" + (active ? " is-active" : "") + (isHome ? " is-home" : "") + (drag.dragId === t.id ? " is-dragging" : "")}
            role="tab"
            aria-selected={active}
            onContextMenu={isHome ? undefined : (e) => openTabMenu(e, t)}
          >
            <button className="ex-tab-main" onClick={() => focusTab(t.id)}>
              {isHome ? <span className="ex-tab-glyph" aria-hidden="true"><IconHome width={14} height={14} /></span> : <TabGlyph page={t.page} star={glyphOf(t)} boardIcon={boardIcon} pluginIcon={pluginIcons.get(t.page)} />}
              <span className="ex-tab-title">{label}</span>
            </button>
            {isHome ? null : (
              <button
                className="ex-tab-close"
                aria-label={tr("shell.closeTab", { name: label })}
                title={tr("shell.closeTabFull", { full })}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                <IconX width={11} height={11} />
              </button>
            )}
          </div>
        );
        });
        if (!g.ws) return <Fragment key={g.key}>{inner}</Fragment>;
        return (
          <div key={g.key} className="ex-ws-band" style={{ "--ws-color": g.ws.color } as CSSProperties} data-ws-id={g.ws.id}>
            <WsHeader ws={g.ws} count={g.tabs.length} />
            {inner}
          </div>
        );
      })}
      <button
        className="ex-tab-add"
        title={tr("shell.newTab")}
        aria-label={i18n("auto.components.explorer.TabStrip.6")}
        onClick={() => openTab("homepage", null, { forceNew: true })}
      >
        <IconPlus width={14} height={14} />
      </button>

      {tip ? <TabstripTip tip={tip} /> : null}
      {pendingGroup ? (
        <WorkspaceCreateDialog
          onCancel={() => setPendingGroup(null)}
          onCreate={(o) => {
            createLiveWorkspace(o, [pendingGroup.dragId, pendingGroup.targetId]);
            setPendingGroup(null);
          }}
        />
      ) : null}
      </div>
      {scrollable ? (
        <div
          className="ex-tabstrip-indi"
          ref={indiRef}
          aria-hidden="true"
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
          onPointerCancel={onTrackUp}
        >
          <i ref={thumbRef} />
        </div>
      ) : null}
    </div>
  );
}
