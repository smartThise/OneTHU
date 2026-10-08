/** 侧栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关） */
import { Children, Suspense, lazy, type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BOTTOM_NAV_PAGES, isBottomNavActive, navOwner, type BottomNavPage } from "../state/navOwner.js";
import { useOverlayBack } from "../state/navStack.js";
import { useThemes } from "../state/theme.js";
import { useApp } from "../state/context.js";
import { backTargetOf, topLevelPage, type BackTarget, type LearnNav, type Page } from "../state/app.js";
import {
  clearPageChrome,
  pageChromeSnapshot,
  readPageChrome,
  subscribePageChrome,
  syncPageChrome,
  type PageMenuItem,
} from "../state/pageChrome.js";
import { useSidebarCollapsed } from "../state/uiPrefs.js";
import { requestSettingsTab } from "../state/settingsMode.js";
import { NAV_REGISTRY, pageTitle, sidebarMore, sidebarPinned, type NavEntry } from "../state/navigation.js";
import { useXkSeason } from "../state/xkSeason.js";
import { prefersReducedMotion } from "../lib/motion.js";
import { loadSidebarPrefs, prefsAfterInsert, resolveSidebar, saveSidebarPrefs, type SidebarPrefs } from "../state/sidebarPrefs.js";
import { useNavDrag } from "./useNavDrag.js";
import { DESENSITIZE_BUILD } from "../lib/privacy.js";
import { IconArrowUp, IconChevron, IconFolder, IconFolderPlus, IconInfo, IconLearn, IconMenu, IconPen, IconPlug, IconRefresh, IconReserve, IconSchedule, IconSettings, IconStar, IconToday, IconUser, IconXk, IconBack, IconCard, IconCalendar, IconMore, FolderIcon, IconExternal, IconThos, IconTrace, IconMail, IconCloud, IconSearch, IconBook } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";
import { showToast } from "../state/toast.js";
import { checkUpdateSilently } from "../lib/update.js";
import { useBottomNavPill, useNavIndicator, useSegPill } from "../lib/motion.js";
import { haptic, installGlobalHaptics } from "../lib/haptics.js";
import { ErrorLine } from "./Details.js";
import { CommandPalette, shortcutLabel } from "./CommandPalette.js";
import { ContextMenuLayer, hasTextSelection, TRIGGER_ATTR, useContextMenu } from "./ContextMenu.js";
import { openPalette } from "../state/palette.js";

/* ── C1：滚动容器 ──
   移动端（≤840）滚动收敛到内容区 `.content` 自身，顶栏与底栏是它的**兄弟节点**
   （`main.content` 不再是 `{children}` 的父级以外的东西：页面包 `.page-anim` 仍是
   `.content` 的直接子节点，`:has(> .page-anim[...])` 那组既有选择器不受影响）。
   于是上拉/下拉时两栏矩形不可能被整页 overscroll 带动。PC 仍由 window 滚动，两处读法都要认。 */
const contentEl = (): HTMLElement | null => document.querySelector<HTMLElement>(".content");
const readScrollTop = (): number => Math.max(window.scrollY || 0, contentEl()?.scrollTop ?? 0);
const scrollAppTop = (): void => {
  contentEl()?.scrollTo({ top: 0, behavior: "smooth" });
  window.scrollTo({ top: 0, behavior: "smooth" });
};

/** D3 末端反馈：只在内容区回弹，顶/底栏绝不参与。
 *  为什么自己做：整页拉伸已关（`overscroll-behavior: none`），而 Chromium 的原生
 *  拉伸/发光只作用于**根**滚动器——真机实测把子滚动器设成 `contain` 也没有任何反馈
 *  （越界拖拽中的截图与静止帧逐字节相同）。故按施工图「用内容区自身的轻微反馈」：
 *  越界时按**橡皮筋**位移（渐进抵抗、渐近上限，没有硬墙），松手与惯性撞到末端
 *  都由**临界阻尼弹簧**收尾——初速度同时决定「冲多远」与「回多快」，没有固定的
 *  幅度或时长（微信/iOS 同一套手感）。不 preventDefault，纵向滚动照常（监听全 passive）。
 *  霖 2026-10-02 #8 按 gesture-rubber-band.md 重做：橡皮筋改用参考里的
 *  `limit + excess·c/(1+excess·c/limit)`（保留一个 8px 的直接跟手带），
 *  收尾从欠阻尼（ζ=0.42，会来回震）改成临界阻尼（ζ=1）——一次平滑收回。 */
const EDGE_FREE = 8;
/** 渐进抵抗的参考长度（px）：超出 EDGE_FREE 的部分按它折算，位移渐近 FREE+MAX */
const EDGE_MAX = 60;
/** 橡皮筋系数（参考里的 coefficient）：越大越软 */
const EDGE_COEF = 0.4;
/** 弹簧角频率（rad/s）：临界阻尼下约 170ms 冲到最远、再约 200ms 收回 */
const EDGE_OMEGA = 18;
/** 阻尼比 ζ：1 = 临界阻尼（不反弹、不来回震）。霖 2026-10-02 #8 */
const EDGE_ZETA = 1;
/** 惯性下限（px/ms）：手指抬起后页面靠惯性撞到末端，速度超过它才回弹 */
const FLING_MIN = 0.45;
/** scrollHeight 取整会让 room 比真实最大 scrollTop 大一点（实测差 1px），判定留余量 */
const EDGE_SNAP = 2;
/** 轴向锁定阈值（px）：超过它才判定这次手势是横还是纵，避免横向滑动时整页先抖一下 */
const AXIS_MIN = 6;
function attachEdgeFeedback(el: HTMLElement): () => void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  let edge: "top" | "bottom" | "both" | null = null;
  let startY = 0;
  let startX = 0;
  let axis: "x" | "y" | null = null;
  let overBase = 0;
  let raf = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  /* 虚拟越界量（px，不设上限）与其速度（px/s）。渲染值由 rubber() 映射，所以
     「拖多远 / 冲多快」可以继续加大虚拟量，而位移永远渐近 EDGE_MAX。 */
  let over = 0;
  let vel = 0;
  let springRaf = 0;
  let springAt = 0;
  /* 手指速度（px/ms，EMA）：松手瞬间的它就是弹簧初速度 */
  let dragV = 0;
  let dragY = 0;
  let dragAt = 0;
  /* 惯性峰值速度（滚动中滑动 300ms 窗口的最大值）：撞到末端的那一帧早已在减速
     （实测末帧只剩 0.4px/ms，而这段惯性开头有 1.6~2.5），只看末帧必然时灵时不灵。 */
  let peak = 0;
  let peakAt = 0;
  /* 橡皮筋（霖 2026-10-02 #8，参考 gesture-rubber-band.md 的公式）：
     limit 以内 1:1 跟手，超出部分按 `excess·c/(1+excess·c/limit)` 渐进抵抗，位移渐近
     EDGE_FREE + EDGE_MAX、永远撞不到硬墙。取 FREE=8 / MAX=60 / c=0.4：
     拖 44px→19.6、100px→30.8、300px→47.6，与改造前（22 / 31 / 38）几乎一致。 */
  const rubber = (x: number): number => {
    const a = Math.abs(x);
    if (a <= EDGE_FREE) return x;
    const excess = a - EDGE_FREE;
    const damped = EDGE_FREE + (excess * EDGE_COEF) / (1 + (excess * EDGE_COEF) / EDGE_MAX);
    return (x < 0 ? -1 : 1) * damped;
  };
  const applyOver = (): void => {
    el.style.transform = over === 0 ? "" : `translateY(${rubber(over).toFixed(2)}px)`;
  };
  const stopSpring = (): void => {
    if (springRaf) cancelAnimationFrame(springRaf);
    springRaf = 0;
  };
  /** 收尾弹簧：x'' = -ω²x - 2ζωx'（半隐式欧拉、分 4 小步）。
   *  初速度大 → 冲得更远、收得也更快；初速度 0 → 单调收回。没有写死的时长与幅度。
   *  ζ = 1（临界阻尼）→ 一次平滑收回，**不再有来回震**（霖 2026-10-02 #8：
   *  以前 ζ=0.42 会过冲一次再震荡；参考实现里是 `withAnimation(.smooth)` 的语义）。 */
  const springTo0 = (v0: number): void => {
    stopSpring();
    vel = v0;
    /* 越界方向：底端越界是负值，收边界要按方向判，不能一律 `over < 0 → 0` */
    const dir = over !== 0 ? (over < 0 ? -1 : 1) : v0 < 0 ? -1 : 1;
    el.style.transition = "none";
    springAt = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(0.032, (now - springAt) / 1000);
      springAt = now;
      const h = dt / 4;
      for (let i = 0; i < 4 && h > 0; i++) {
        vel += (-EDGE_OMEGA * EDGE_OMEGA * over - 2 * EDGE_ZETA * EDGE_OMEGA * vel) * h;
        over += vel * h;
        /* 临界阻尼不会反向穿零；数值误差让它微微越界时就地夹住，不做另一侧的越界 */
        if (over * dir < 0) {
          over = 0;
          vel = 0;
        }
      }
      applyOver();
      if (Math.abs(over) > 0.1 || Math.abs(vel) > 20) springRaf = requestAnimationFrame(step);
      else {
        springRaf = 0;
        over = 0;
        applyOver();
      }
    };
    springRaf = requestAnimationFrame(step);
  };
  /** 收尾：清状态 + 弹簧归零。重复调用无害（touchend / pointerup / 保险丝 都可能触发）。 */
  const release = (): void => {
    if (!edge) return;
    edge = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (settle) clearTimeout(settle);
    settle = undefined;
    springTo0(dragV * 1000); /* 初速度 = 松手瞬间的手指速度 */
  };
  /** 保险丝：收尾事件仍可能整条丢失（见下方监听说明），宁可轻微提前回弹，
   *  也不允许内容区永久停在错位状态。手指继续动会立刻重新跟手。 */
  const arm = (): void => {
    if (settle) clearTimeout(settle);
    settle = setTimeout(release, 900);
  };
  /** 末端归属判定：手指底下若还有**内层**可滚容器，就完全不接管（那是它的事，
   *  整页跟着动会让人以为整页在滚——真机在待办页卡片流上验证过）。 */
  const ownsEdge = (t: EventTarget | null): boolean => {
    let n: Element | null = t instanceof Element ? t : null;
    while (n && n !== el) {
      const cs = getComputedStyle(n);
      const oy = cs.overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight - n.clientHeight > 1) return false;
      /* 子组件自己接管手势（`touch-action` 不含纵向 pan）：待办页卡片流就是
         `overflow: hidden` + JS 驱动的滚筒，只查 overflow 认不出来，会被整页接管
         （霖报的 bug：滑卡片时整页过冲）。滑块/横向分段器同理。 */
      const ta = cs.touchAction || "auto";
      if (!(ta === "auto" || ta === "manipulation" || /pan-(y|up|down)/.test(ta))) return false;
      n = n.parentElement;
    }
    return true;
  };
  const onStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!t || !(e.target instanceof Node) || !el.contains(e.target)) return;
    if (settle) clearTimeout(settle);
    settle = undefined;
    stopSpring(); /* 打断回弹：从当前位置继续跟手，不跳 */
    edge = null;
    peak = 0;
    peakAt = 0;
    if (!ownsEdge(e.target)) {
      if (over) springTo0(0);
      return;
    }
    const room = el.scrollHeight - el.clientHeight;
    /* 本来就不滚的页面（内容比一屏矮）：上下都是末端，两个方向都给反馈 */
    if (room <= 1) edge = "both";
    else if (el.scrollTop <= 0) edge = "top";
    else if (el.scrollTop >= room - 1) edge = "bottom";
    if (!edge) {
      if (over) springTo0(0); /* 页面中部：残余位移就地收回，不跟手 */
      return;
    }
    overBase = over;
    startY = t.clientY;
    startX = t.clientX;
    axis = null;
    dragY = t.clientY;
    dragAt = performance.now();
    dragV = 0;
    el.style.transition = "none";
  };
  const onMove = (e: TouchEvent): void => {
    if (!edge) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    /* 先定轴再动手：横向手势（卡片流滚筒、横向分段器）整页完全不参与，
       否则横向滑一下整页会跟着抖/过冲。定轴前不动，避免闪烁。 */
    if (!axis) {
      if (Math.abs(dx) < AXIS_MIN && Math.abs(dy) < AXIS_MIN) return;
      axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis === "x") {
        edge = null;
        if (settle) clearTimeout(settle);
        settle = undefined;
        if (over) springTo0(0);
        return;
      }
    }
    if (axis !== "y") return;
    if (edge === "top" && dy <= 0) return; /* 往回滑：交给正常滚动，不跟手 */
    if (edge === "bottom" && dy >= 0) return;
    const now = performance.now();
    const dt = now - dragAt;
    if (dt > 0 && dt < 120) dragV = dragV * 0.6 + ((t.clientY - dragY) / dt) * 0.4;
    dragY = t.clientY;
    dragAt = now;
    over = overBase + dy; /* 虚拟量 = 手指位移（渲染时过橡皮筋）：拖多快、多远都如实进物理量 */
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(applyOver);
    arm();
  };
  const onEnd = (): void => release();
  const onScroll = (): void => {
    const now = performance.now();
    const top = el.scrollTop;
    const v = (top - lastTop) / Math.max(1, now - lastT); /* px/ms，正 = 向下滚 */
    const room = el.scrollHeight - el.clientHeight;
    if (now - peakAt > 300) peak = v;
    else if (Math.abs(v) > Math.abs(peak)) peak = v;
    peakAt = now;
    /* 拖拽中（edge 非空）与回弹中都不重复触发 */
    if (!edge && !springRaf && room > 1) {
      /* 符号：`over` 是「内容往下为正」的视觉量，而 peak 是 scrollTop 的速度。
         滚到顶时 scrollTop 在减小（peak<0）→ 视觉上要把内容往下推 → 取 -peak。
         底端同理（peak>0 → 内容往上）→ 两处都是 -peak。 */
      if (top <= EDGE_SNAP && lastTop > EDGE_SNAP && peak < -FLING_MIN) springTo0(-peak * 1000);
      else if (top >= room - EDGE_SNAP && lastTop < room - EDGE_SNAP && peak > FLING_MIN) springTo0(-peak * 1000);
    }
    lastTop = top;
    lastT = now;
  };
  let lastTop = el.scrollTop;
  let lastT = performance.now();
  el.addEventListener("scroll", onScroll, { passive: true });
  /* 监听挂在 window 的**捕获**阶段：内层组件 stopPropagation、或 touchend 落到刚被
     重渲染掉的卡片上（真机复现：待办页卡片流拖拽后 transform 永久停在 44px，
     inline 值就是 translateY(44px)），元素自身的冒泡监听都会收不到收尾。 */
  const opts = { passive: true, capture: true } as const;
  window.addEventListener("touchstart", onStart, opts);
  window.addEventListener("touchmove", onMove, opts);
  window.addEventListener("touchend", onEnd, opts);
  window.addEventListener("touchcancel", onEnd, opts);
  /* pointerup 是真实收尾；**pointercancel 不能当收尾**——浏览器一接管滚动就发它，
     收到就归零的话回弹刚起来就被清掉（实测位移只剩 2px）。 */
  window.addEventListener("pointerup", onEnd, opts);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    stopSpring();
    if (settle) clearTimeout(settle);
    el.removeEventListener("scroll", onScroll);
    window.removeEventListener("touchstart", onStart, opts);
    window.removeEventListener("touchmove", onMove, opts);
    window.removeEventListener("touchend", onEnd, opts);
    window.removeEventListener("touchcancel", onEnd, opts);
    window.removeEventListener("pointerup", onEnd, opts);
    el.style.transform = "";
  };
}

/** 开发者面板（仅 dev 构建）：右上角 commit 徽标 + 前端日志/诊断/导出。
 *  正式版里 __ONETHU_DEV__ 折叠为 false → 这句动态 import 被 rollup 删除，
 *  dev 面板整块不进产物（守卫 tools/devtools-test.mjs，构建后再 grep dist 复核）。 */
const DevPanel = __ONETHU_DEV__ ? lazy(() => import("./DevPanel.js")) : null;

/**
 * 默认一级入口（万物原子化定案）：钉死不可删隐，仅可在侧栏折叠进
 * 「已折叠收藏夹（N）」组；一切功能原子锚定在这些原位页面，用户收藏夹
 * 只是原子的跳转入口层。今日 = 首页恒在最上；设置 = 钉底。
 */
/** 插件动态 tab（useSyncExternalStore 订阅；渲染在固定 NAV 之后） */
function usePluginNavEntries(): Array<{ page: Page; label: string; icon: (p: object) => ReactNode }> {
  const tabs = useSyncExternalStore(subscribePluginTabs, pluginTabsSnapshot, pluginTabsSnapshot);
  return tabs.map((t) => ({
    page: t.pageKey as Page,
    label: t.title,
    icon: ({ width = 16, height = 16 }: { width?: number; height?: number }) => (
      <span
        className="plg-svg-icon"
        style={{ width, height, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
        dangerouslySetInnerHTML={{ __html: t.iconSvg ?? '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 2.5 4.2 6l-2.4 4.5L6 13.5l3-2 3 2 2.2-3-2.4-4.5L10 2.5l-4 0z"/></svg>' }}
      />
    ),
  }));
}

/** 侧边栏分区顺序（§2.8.1）；分组名与 navigation.ts 的 category 同名，新 IA 另加「总览」 */
const NAV_GROUP_ORDER = ["总览", "学习", "日程", "生活", "预约", "行政"] as const;

/** 「更多」里可能出现的全部分类（按分区顺序）：拖拽时用来把**当前为空**的分类标签也摆出来（反馈 3） */
const MORE_CATS: readonly string[] = NAV_GROUP_ORDER.filter((c) =>
  NAV_REGISTRY.some((e) => e.sidebar === "more" && (e.category as string) === c),
);

/** 把 id 移到 index 处（被拖行先摘掉再插入） */
function insertInto(list: readonly string[], id: string, index: number): string[] {
  const rest = list.filter((x) => x !== id);
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** 把「某个子集的新次序」写回收藏仓：先算**全局**目标次序（子集槽位不变，把新次序依次填回），
 *  再用 moveRoot(id, ±1) 逐格实现。子集感知是必须的——未展开与已折叠是两个列表，各自排序。 */
function applyRootOrder(
  full: readonly string[],
  subsetCur: readonly string[],
  subsetNext: readonly string[],
  moveRoot: (id: string, dir: -1 | 1) => void,
): void {
  const target = [...full];
  let filled = 0;
  for (let i = 0; i < target.length; i++) {
    if (subsetCur.includes(target[i]!)) target[i] = subsetNext[filled++] ?? target[i]!;
  }
  const work = [...full];
  for (let i = 0; i < target.length; i++) {
    if (work[i] === target[i]) continue;
    const from = work.indexOf(target[i]!);
    if (from < 0) continue;
    const dir: -1 | 1 = from > i ? -1 : 1;
    for (let k = from; k !== i; k += dir) moveRoot(target[i]!, dir);
    work.splice(from, 1);
    work.splice(i, 0, target[i]!);
  }
}

/** 页面 → 侧栏分区：**只取自导航注册表**（E2：今日/待办等主 IA 已入表，不再特判） */
function navCategoryOf(page: Page): string {
  return NAV_REGISTRY.find((e) => e.page === page)?.category ?? "行政";
}

/**
 * 底部 5 Tab（UI/UX 改造方案 §2.2，M1 beta）：移动端（≤840px，§2.8.1 统一断点）固定底栏。
 * 服务/收藏两个直达页
 * 是本批次新增（pages/ServicesPage、pages/FavsHomePage）；「待办」暂指
 * learn-assignments（全部作业），§2.3-4 升级为独立 tab 页后再换实现。
 * 长尾功能仍走抽屉/服务目录页，底栏只承担 §1.2 的 core 直达。
 */
const BOTTOM_NAV: Array<{ page: BottomNavPage; label: string; icon: (p: object) => ReactNode }> = [
  { page: "today", label: "今日", icon: IconToday },
  { page: "tasks", label: "待办", icon: IconPen },
  { page: "services", label: "服务", icon: IconInfo },
  { page: "favs", label: "收藏", icon: IconStar },
  { page: "mine", label: "我的", icon: IconUser },
];

/** 移动端底部导航条（CSS 侧 ≤840px 显示；桌面恒隐藏） */
function BottomNav({ page, navigate }: { page: Page; navigate: (p: Page, params?: LearnNav) => void }): ReactNode {
  /* 蓝色胶囊是单个滑动元素：切换时按共享的导航运动（平滑 + 惯性回弹）水平移动，
     不再是每一项各自的 ::before 就地淡入。当前项由钩子自己在 DOM 里找（无激活项即隐藏）。 */
  const [navRef, pillRef] = useBottomNavPill();
  return (
    <nav className="bottom-nav" aria-label="底部导航" ref={navRef}>
      <span className="bottom-nav-pill" ref={pillRef} aria-hidden="true" />
      {BOTTOM_NAV.map((item) => {
        /* E6：唯一判据 state/navOwner.ts——任何页面都恰好高亮一项 */
        const active = isBottomNavActive(item.page, page);
        const Icon = item.icon;
        return (
          <button
            key={item.page}
            className={"bottom-nav-item" + (active ? " is-active" : "")}
            onClick={() => {
              haptic("click"); /* 与胶囊弹性同步的短促脆感（A2） */
              navigate(item.page);
            }}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ══════════ 侧栏一级入口（E2：条目 / 分组 / 文案全部来自注册表，此处不再手写清单）══════════ */

/** id → 图标（视图层）。IA 由 state/navigation.ts 的注册表决定，这里只负责图标与高亮扩展。 */
const NAV_ICONS: Record<string, (p: object) => ReactNode> = {
  today: IconToday,
  tasks: IconPen,
  learn: IconLearn,
  schedule: IconSchedule,
  trace: IconTrace,
  mail: IconMail,
  cloud: IconCloud,
  thubook: IconBook,
  info: IconInfo,
  life: IconCard,
  reserve: IconReserve,
  zhjwxk: IconXk,
  thos: IconThos,
  otherinfo: IconExternal,
  settings: IconSettings,
};

/** 高亮扩展（视图层，不是 IA）：待办在「全部作业」等下钻页也保持高亮 */
const ACTIVE_EXTRA: Partial<Record<string, Page[]>> = {
  tasks: ["learn-assignments", "learn-assignment-detail", "learn-ykt-detail"],
};

export interface NavItemView {
  id: string;
  page: Page;
  label: string;
  icon: (p: object) => ReactNode;
  activePages?: Page[];
}

export function toNavItem(e: NavEntry): NavItemView {
  return { id: e.id, page: e.page, label: e.name, icon: NAV_ICONS[e.id] ?? IconInfo, activePages: ACTIVE_EXTRA[e.id] };
}

/** 一级入口（**注册表派生**；E2 起不再手写）。设置是钉底固定项，不在此列。 */
export const NAV: NavItemView[] = [...sidebarPinned(false), ...sidebarMore(false)]
  .filter((e) => e.id !== "settings")
  .map(toNavItem);

/** 「更多」折叠区展开态（§9.3：持久化；默认收起——C15 的目的就是首屏精简） */
const MORE_KEY = "onethu.sidebar.moreOpen";
function useMoreOpen(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MORE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const set = useCallback(
    (v: boolean): void => {
      setOpen(v);
      try {
        localStorage.setItem(MORE_KEY, v ? "1" : "0");
      } catch {
        /* 隐私模式：本次会话内仍然可用 */
      }
    },
    [],
  );
  return [open, set];
}

/** (One / THU) 品牌标识：五列网格，括号代码体，One 衬线紧凑撑满与 THU 逐列对齐。
 *  主题插件可整体替换（theme.logo 提供 inline SVG 时优先渲染）。
 *  2026-10-06：C13 曾改成单色 SVG 字标，霖走查认为与原来差异明显，已恢复为原写法。 */
export function BrandLogo({ size = 14 }: { size?: number }) {
  const themed = useThemes().logoSvg;
  if (themed) {
    return (
      <span
        className="brand-logo brand-logo-themed"
        style={{ fontSize: size, display: "inline-flex", alignItems: "center" }}
        aria-label="OneTHU"
        /* 主题受信代码，同插件边界 */
        dangerouslySetInnerHTML={{ __html: themed }}
      />
    );
  }
  return (
    <span className="brand-logo" style={{ fontSize: size }} aria-label="OneTHU">
      <span className="p">(</span>
      <span className="word"><i>O</i><i>n</i><i>e</i></span>
      <span />
      <span className="p"> </span>
      <span className="u">T</span>
      <span className="u">H</span>
      <span className="u">U</span>
      <span className="p">)</span>
    </span>
  );
}

/**
 * SegmentedOverflow（滑动 + 位置指示条）：
 * - 分段条放不下时整条横向滑动（触摸直接滑；鼠标按住拖动，拖动期间抑制误触点击）；
 * - 可滑时条下方显示一个位置指示条（非滚动条）：按 scrollLeft 比例移动的圆角滑块，
 *   宽度下限 104px——比单个胶囊更宽，避免被误读为「当前 tab 下划线」；
 * - 整条放得下时指示条不出现；左右箭头方案已废弃。
 */
export function SegmentedOverflow({
  ariaLabel,
  style,
  children,
}: {
  ariaLabel?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [rowRef, pillRef] = useSegPill();
  const indiRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; sl: number } | null>(null);
  const dragThumb = useRef<{ x: number; sl: number } | null>(null);
  const moved = useRef(false);

  const update = useCallback(() => {
    const el = rowRef.current;
    const thumb = thumbRef.current;
    const indi = indiRef.current;
    if (!el || !indi || !thumb) return;
    const overflow = el.scrollWidth - el.clientWidth;
    const scrollable = overflow > 2 && el.clientWidth >= 60;
    indi.style.display = scrollable ? "block" : "none";
    if (!scrollable) return;
    const frac = Math.min(Math.max(el.scrollLeft / overflow, 0), 1);
    const trackW = indi.clientWidth;
    const w = el.clientWidth / el.scrollWidth * trackW;
    const thumbW = Math.max(32, Math.min(w, 72)); // 滑块短一点：按比例但封顶 72px
    thumb.style.width = `${thumbW}px`;
    thumb.style.left = `${frac * (trackW - thumbW)}px`;
  }, []);

  const seekTo = useCallback((clientX: number) => {
    const el = rowRef.current;
    const indi = indiRef.current;
    const thumb = thumbRef.current;
    if (!el || !indi || !thumb) return;
    const overflow = el.scrollWidth - el.clientWidth;
    if (overflow <= 0) return;
    const rect = indi.getBoundingClientRect();
    const thumbW = thumb.getBoundingClientRect().width;
    const frac = Math.min(Math.max((clientX - rect.left - thumbW / 2) / Math.max(rect.width - thumbW, 1), 0), 1);
    el.scrollLeft = frac * overflow;
  }, []);

  useLayoutEffect(() => {
    update();
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update]);

  return (
    <div className="seg-ov" style={style}>
      <div
        className="segmented seg-track"
        role="tablist"
        aria-label={ariaLabel}
        ref={rowRef}
        onPointerDown={(e) => {
          // 关键：down 时不捕获——立即 setPointerCapture 会把后续 click 重定向到容器，
          // 胶囊按钮收不到点击。捕获推迟到移动超阈值（确认是拖动）那一刻。
          if (e.pointerType !== "mouse") return;
          drag.current = { x: e.clientX, sl: e.currentTarget.scrollLeft };
          moved.current = false;
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const el = e.currentTarget;
          const dx = e.clientX - d.x;
          if (!moved.current && Math.abs(dx) > 5) {
            moved.current = true;
            el.setPointerCapture(e.pointerId); // 此时才接管，拖动期间滑出条外也不丢
          }
          if (moved.current) el.scrollLeft = d.sl - dx;
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onClickCapture={(e) => {
          if (moved.current) {
            e.stopPropagation();
            e.preventDefault();
            moved.current = false;
          }
        }}
      >
        {/* 滑动块：位置/宽度由 useSegPill 量出后写入内联样式，量不到时不显形 */}
        <span className="seg-pill" ref={pillRef} aria-hidden="true" />
        {children}
      </div>
      {/* 真滚动条：滑块可抓取拖动，点槽任意处跳转（拇指中心对齐点击点） */}
      <div
        className="seg-indi"
        ref={indiRef}
        onPointerDown={(e) => {
          const el = rowRef.current;
          if (!el) return;
          e.preventDefault(); // 防选中/焦点
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX);
          dragThumb.current = { x: e.clientX, sl: el.scrollLeft };
        }}
        onPointerMove={(e) => {
          const d = dragThumb.current;
          if (!d) return;
          const el = rowRef.current;
          const indi = indiRef.current;
          const thumb = thumbRef.current;
          if (!el || !indi || !thumb) return;
          const overflow = el.scrollWidth - el.clientWidth;
          if (overflow <= 0) return;
          const trackW = indi.clientWidth;
          const thumbW = thumb.getBoundingClientRect().width;
          el.scrollLeft = d.sl + (e.clientX - d.x) * (overflow / Math.max(trackW - thumbW, 1));
        }}
        onPointerUp={() => { dragThumb.current = null; }}
        onPointerCancel={() => { dragThumb.current = null; }}
      >
        <i ref={thumbRef} />
      </div>
    </div>
  );
}

/** Slogan：One 衬线 · THUer 现代黑体 · 其余等宽 · 句尾 OneTHU 用完整品牌标识 */
export function Slogan({ size = 13 }: { size?: number }) {
  return (
    <span className="slogan" style={{ fontSize: size }}>
      <span className="s-one">One</span>
      <span className="s-thuer">THUer</span>
      <span className="s-mono">should have</span>
      <BrandLogo size={Math.round(size * 1.25)} />
      <span className="s-mono">.</span>
    </span>
  );
}

/** 侧栏 / 抽屉共用的导航容器：内含当前项指示条（.nav-indicator，拉伸平移由 useNavIndicator 驱动） */
function NavBody({ label, children }: { label: string; children: ReactNode }) {
  const [rowRef, barRef] = useNavIndicator();
  return (
    <nav className="nav" aria-label={label} ref={rowRef}>
      <span className="nav-indicator" ref={barRef} aria-hidden="true" />
      {children}
    </nav>
  );
}

/** 顶栏换场的交叉时长（与 CSS 里那两条 var(--dur-2) 动画对齐） */
const TOPBAR_SWAP_MS = 220;

/** 值变化时把「上一份」多留一小会儿，好让新旧两份交叉播放进出场（霖 2026-10-02 #7）。
 *  只在真的换了值的那次渲染里返回 swapping——首屏不会平白播一次入场动画。
 *  退出的一份只用来画动画：绝对定位、`pointer-events: none`，不参与布局也不接事件。 */
function useSwap<T>(value: T): { cur: T; prev: T | null; swapping: boolean } {
  const [prev, setPrev] = useState<T | null>(null);
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    setPrev(last.current);
    last.current = value;
    const t = setTimeout(() => setPrev(null), TOPBAR_SWAP_MS);
    return () => clearTimeout(t);
  }, [value]);
  const swapping = prev !== null && prev !== value;
  return { cur: value, prev: swapping ? prev : null, swapping };
}

/**
 * 手机顶栏（G1）：根页显示 OneTHU logo，其它页显示「<」返回键；右上「···」开当前页的
 * 页面级操作菜单（收藏 / 刷新 / 整页主操作），复用长按菜单的宿主与展开动画。
 *
 * **必须渲染在 ContextMenuLayer 内部**：`useContextMenu()` 只对 Provider 的子节点生效，
 * 放在外面会拿到 NOOP——真机实测就是「点了没反应」（首版踩过）。
 */
function MobileTopbar({
  innerRef,
  scrolled,
  title,
  onOpenNav,
}: {
  innerRef: RefObject<HTMLElement | null>;
  scrolled: boolean;
  title: string;
  onOpenNav: () => void;
}) {
  const { page: rawPage, navigate, back } = useApp();
  const ctx = useContextMenu();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const chrome = useSyncExternalStore(subscribePageChrome, pageChromeSnapshot, pageChromeSnapshot);
  /* 根页 = 底栏那五项（无上级）；其它页一律有返回键：优先页面声明的父页，
     没声明就回落到归属 tab（深链冷启动也能一步回到有底栏的页）。 */
  const isRootPage = BOTTOM_NAV_PAGES.includes(rawPage as BottomNavPage);
  const owner = navOwner(rawPage);
  const target: BackTarget | null = isRootPage ? null : (readPageChrome().back ?? { to: owner, label: pageTitle(owner) });
  const onBack = (): void => {
    if (!target) return;
    /* E1 口径：先退会话内导航栈，栈空（深链冷启动）才回落到声明父页 */
    back(() => navigate(target.to, target.params, { replace: true }));
  };
  /* 以按钮矩形为锚开菜单：ContextMenu 内部按触发点算液团位移/缩放，展开特效与长按同源。
     霖 2026-10-02 #6：这里是**切换**——菜单已经开着就关掉，不再每次按下都重开一遍
     （以前长按菜单开着时点「···」会在原地重播一次展开动画）。 */
  const openMenu = useCallback(() => {
    if (ctx.isOpen()) {
      ctx.close();
      return;
    }
    const items = readPageChrome().menu;
    if (!items.length) return;
    const r = moreRef.current?.getBoundingClientRect();
    ctx.open({ x: r ? r.right - r.width / 2 : window.innerWidth - 24, y: r ? r.bottom : 48, items });
  }, [ctx]);
  /* 霖 2026-10-02 #7：logo↔返回键、标题变化都做交叉换场（方向见 CSS） */
  const lead = target ? "back" : "logo";
  const leadSwap = useSwap<"logo" | "back">(lead);
  const titleSwap = useSwap(title);
  /* C5：顶栏里的「回到顶层」——与原来那枚浮层同一个阈值（滚过 240px 才出现） */
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const on = (): void => setShowTop(readScrollTop() > 240);
    window.addEventListener("scroll", on, { passive: true, capture: true });
    on();
    return () => window.removeEventListener("scroll", on, { capture: true });
  }, []);
  return (
    <header className={"mobile-topbar" + (scrolled ? " is-scrolled" : "")} ref={innerRef}>
      <button className="topbar-menu" onClick={onOpenNav} aria-label="打开导航菜单">
        <IconMenu width={18} height={18} />
      </button>
      <div className="topbar-brand">
        {/* 进场的一份排在前：`.topbar-back` / `.topbar-title` 的 querySelector 拿到的
            始终是当前那一份，退场的那份只用来画动画（绝对定位、不接事件）。 */}
        <span className="topbar-lead">
          {leadSwap.cur === "back" ? (
            <button
              type="button"
              className={"topbar-back" + (leadSwap.swapping ? " is-in" : "")}
              onClick={onBack}
              aria-label={"返回" + (target?.label ? "：" + target.label : "")}
            >
              <IconBack width={18} height={18} />
            </button>
          ) : (
            <span className={"topbar-logo" + (leadSwap.swapping ? " is-in" : "")}>
              <BrandLogo size={11} />
            </span>
          )}
          {leadSwap.swapping && leadSwap.prev ? (
            <span className="topbar-lead-out is-out" aria-hidden="true">
              {leadSwap.prev === "back" ? (
                <span className="topbar-back is-out">
                  <IconBack width={18} height={18} />
                </span>
              ) : (
                <span className="topbar-logo is-out">
                  <BrandLogo size={11} />
                </span>
              )}
            </span>
          ) : null}
        </span>
        {/* 霖 2026-10-02 第四批 #6：标题只做「新文字从右渐入」——旧文字直接消失，不留退场那份。
            `key={title}` 让换标题时元素重挂一次，进场动画才会重播（同元素改 class 只会补播）。 */}
        <span className="topbar-title-wrap">
          <span className={"topbar-title" + (titleSwap.swapping ? " is-in" : "")} key={title}>
            {title}
          </span>
        </span>
      </div>
      {/* C5（霖 2026-10-01 走查）：硬刷新原来浮在右下角——占着最舒适的操作区却很少用，
          手机上挪进顶栏右侧（和标题同排）；2026-10-02 复看后又与「···」交换，刷新退到左边。
          「回到顶层」原来是同一枚浮层的另一半，一并搬过来：滚过 240px 才出现，
          这样手机上不会丢掉这个功能（PC 侧两枚浮层照旧，本批不动 PC）。 */}
      {showTop ? (
        <button type="button" className="topbar-top" onClick={() => scrollAppTop()} title="回到顶层" aria-label="回到顶层">
          <IconArrowUp width={16} height={16} />
        </button>
      ) : null}
      <button
        type="button"
        className="topbar-refresh"
        title="硬刷新（整页重载）"
        aria-label="硬刷新"
        onClick={() => window.location.reload()}
      >
        <IconRefresh width={16} height={16} />
      </button>
      {/* 霖 2026-10-02 复看：「···」放到最右侧（与刷新键交换）——最右上角是最好按的位置，
          它是最常用的入口，刷新退到它的左边；「回到顶层」仍在刷新左边（滚过 240px 才出现）。 */}
      {chrome.hasMenu ? (
        <button
          type="button"
          className="topbar-more"
          ref={moreRef}
          onClick={openMenu}
          aria-label="更多操作"
          aria-haspopup="menu"
          {...{ [TRIGGER_ATTR]: "" }}
        >
          <IconMore width={18} height={18} />
        </button>
      ) : null}
    </header>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { page: rawPage, navigate, navParams } = useApp();

  const favs = useFavs();
  const [sbCollapsed, setSbCollapsed] = useSidebarCollapsed(); // PC 侧栏折叠（§2.8.1）
  const pluginNav = usePluginNavEntries();
  const xkSeason = useXkSeason(); // §9.2 选课季：选课升常驻 / 收进「更多」
  const [sbPrefs, setSbPrefs] = useState<SidebarPrefs>(loadSidebarPrefs); // 拖拽排位的本地偏好（§9.3）
  /* 收起/展开**不需要 JS 相位**（霖 2026-10-07 逐帧分析后的重做）：两侧差异全部走可动画属性
     （opacity / color / max-height / max-width / transform），文字由侧栏的 overflow 随宽度裁开
     ——遮罩式揭示天然与宽度同步，不会中途弹字，也不再需要猜时间或监听 transitionend。 */
  const toggleSidebar = useCallback((): void => setSbCollapsed(!sbCollapsed), [sbCollapsed, setSbCollapsed]);
  const [moreOpen, setMoreOpen] = useMoreOpen();
  const navAll = [...NAV, ...pluginNav];
  /* 侧栏两档 = 注册表默认 + 用户拖拽偏好（§9.3「本地偏好表达」）。设置是钉底固定项，不参与两档。
     拖拽期间**不改任何状态**：让位空隙由 useNavDrag 用 transform 表达（React 一动不动，
     因此被拖行的节点不会被重建、特效与跟手都不丢），松手才落库并 FLIP 就位。 */
  const filteredRegistry = useMemo(() => NAV_REGISTRY.filter((e) => e.id !== "settings"), []);
  const baseEntries = useMemo(
    () => resolveSidebar(filteredRegistry, sbPrefs, xkSeason),
    [filteredRegistry, sbPrefs, xkSeason],
  );
  const baseFlatIds = useMemo(
    () => [...baseEntries.pinned.map((e) => e.id), ...baseEntries.more.map((e) => e.id)],
    [baseEntries],
  );
  const unfoldRoots = favs.data.order.filter((id) => !favs.data.foldedRoots.includes(id));
  const drag = useNavDrag({
    onDrop: useCallback(
      (id: string, index: number, scope: string, tier: "pin" | "more"): void => {
        if (scope === "nav") {
          /* 落档由 hook 按「边界归属」给出（反馈 1：此前用常驻条数猜，往下拖会判成 pin 而弹回） */
          const next = prefsAfterInsert(baseFlatIds, id, index, sbPrefs, tier);
          saveSidebarPrefs(next);
          setSbPrefs(next);
        } else {
          /* 收藏夹只在**展开列表**内排序（霖 2026-10-06：已折叠组内部不需要拖拽） */
          applyRootOrder(favs.data.order, unfoldRoots, insertInto(unfoldRoots, id, index), favs.moveRoot);
        }
      },
      [baseFlatIds, sbPrefs, unfoldRoots, favs],
    ),
    onCancel: useCallback((): void => {
      /* 取消：让位与拖拽位移已由 hook 撤回，无需状态变更 */
    }, []),
    onFoldDrop: useCallback(
      (id: string): void => {
        favs.foldSidebar(id, false); // 拖到「已折叠收藏夹」上即折叠（霖 2026-10-05 定）
      },
      [favs],
    ),
  });
  /* 落位重排后跑一次 FLIP：hook 在落位时已按**视觉位置**记好基准 */
  useLayoutEffect(() => {
    drag.playFlip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sbPrefs, favs.data.order, favs.data.foldedRoots, favs.data.foldedDefaults]);
  const page = topLevelPage(rawPage);
  const [navOpen, setNavOpen] = useState(false);
  useOverlayBack("nav-drawer", navOpen, () => setNavOpen(false));
  const [navClosing, setNavClosing] = useState(false);
  /** 顶栏滚动浮起（local/anim-delight）：滚过 8px 后加阴影，做出"页面在顶栏下滚动"的层次 */
  const [topbarScrolled, setTopbarScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setTopbarScrolled(readScrollTop() > 8);
    /* capture：移动端滚动发生在 .content 上（不冒泡），PC 仍发生在 window 上 */
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);
  /* C1 配套：换页（含进详情）时回到顶部。滚动收敛进容器后，旧的偏移会跟着新页保留下来，
     出现过「从长页切到新页，落地在页面中段」；这里显式归零，恢复「新页从第一屏开始」。
     （E1 做导航栈时再换成按历史记录恢复位置，那时删掉这一段。） */
  useEffect(() => {
    contentEl()?.scrollTo({ top: 0 });
    window.scrollTo(0, 0);
  }, [rawPage]);
  /* D3：末端反馈挂在内容区自身（顶/底栏在它外面，天然不参与） */
  const contentRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = contentRef.current;
    return el ? attachEdgeFeedback(el) : undefined;
  }, []);
  /* A2：开关 / tab / 普通按钮三族在 DOM 里数量太大，统一在捕获阶段发触感
     （底栏自己发 CLICK，见 BottomNav）。PC 端 installGlobalHaptics 内部静默跳过。 */
  useEffect(() => installGlobalHaptics(), []);
  /* A3：全站禁浏览器右键（移动端的长按菜单自己出，见 ContextMenu.tsx）。
     唯一的放行口是**选中了可选文本**——否则公告/通知正文没法复制。
     PC 的真右键菜单已接入（P 批霖 2026-10-05）：由 ContextMenu 的 zone 与全局 atom 层
     各自监听 contextmenu 打开**同一套**菜单；这里只负责禁掉浏览器默认菜单。 */
  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      if (hasTextSelection()) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onCtx);
    return () => document.removeEventListener("contextmenu", onCtx);
  }, []);
  /* 顶栏高度写进 --topbar-h：顶栏的毛玻璃要靠「内容从它底下滚过」，于是滚动容器上沿
     用负 margin 提到顶栏底下、内容区再按栏高让开首行。栏高不写死像素（安全区、字号、
     密度档变了都自动跟上），由 ResizeObserver 实测。 */
  const topbarRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = topbarRef.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = (): void => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty("--topbar-h", `${h}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--topbar-h");
    };
  }, []);
  /** 「已折叠收藏夹（N）」组展开态（会话态，不持久化） */
  const [foldedOpen, setFoldedOpen] = useState(false);
  /* §4.4b：插件已并进设置页。旧链接/历史记录里的 plugins 路由统一落到「设置 → 插件」，
     侧栏不再保留单独入口（标准/高级都一样，高级只决定设置里那一栏显示与否）。 */
  useEffect(() => {
    if (page !== "plugins") return;
    requestSettingsTab("插件");
    navigate("settings");
  }, [page, navigate]);

  const closeNav = useCallback(() => {
    setNavClosing(true);
    window.setTimeout(() => {
      setNavOpen(false);
      setNavClosing(false);
    }, 240);
  }, []);

  /* 启动：GitHub Releases 静默检查新版本（一次；失败静默，不打扰） */
  useEffect(() => {
    void checkUpdateSilently(showToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isFolderActive = (id: string) => page === "folder" && navParams?.folderId === id;

  /** 侧栏一条导航项：主按钮 + 行尾折叠钮（hover 浮现；已折叠项的行尾钮是展开钮） */
  const navRow = (key: string, opts: { active: boolean; label: string; icon: ReactNode; onClick: () => void; folded?: boolean; onFold?: () => void; drag?: Record<string, unknown>; extraClass?: string; moreGroup?: boolean }) => (
    <div className={"nav-row" + (opts.drag ? " is-draggable" : "") + (opts.extraClass ?? "")} key={key} {...(opts.moreGroup ? { "data-more": "1" } : {})} {...(opts.drag ?? {})}>
      <button className={"nav-item" + (opts.active ? " is-active" : "")} onClick={opts.onClick}>
        {opts.icon}
        <span>{opts.label}</span>
      </button>
      {opts.onFold ? (
        <button
          className={"nav-fold" + (opts.folded ? " is-folded" : "")}
          title={opts.folded ? "从折叠组展开" : "折叠进「已折叠收藏夹」"}
          aria-label={(opts.folded ? "展开" : "折叠") + opts.label}
          onClick={(e) => {
            e.stopPropagation();
            opts.onFold!();
          }}
        >
          {opts.folded ? "»" : "«"}
        </button>
      ) : null}
    </div>
  );

  /** 侧栏/抽屉共用导航内容 */
  const navContent = (onAfter?: () => void) => {
    /* 常驻（§9.1）：注册表 pin 档派生。设置是钉底固定项，不在此列。 */
    const pinned = baseEntries.pinned.map(toNavItem);
    const unfoldedDefaults = pinned.filter((it) => !favs.data.foldedDefaults.includes(it.page));
    /* 「更多」（§9.1）：注册表 more 档，**保留原分组标签**与类内顺序；分区取自注册表 category。
       选课季时 zhjwxk 已升入常驻，这里自然不再出现。 */
    const moreGrouped: Array<{ kind: "label"; text: string; empty: boolean } | { kind: "item"; item: NavItemView }> = (() => {
      const groups = new Map<string, NavItemView[]>();
      /* 反馈 3：拖拽进行中，把「更多」的**全部**分类标签都摆出来（哪怕当前为空）——
         "只含一项的分类"被拖空之后，用户仍然看得到该往哪儿放。不拖的时候空的照旧不显示。 */
      /* 反馈 3：全部分类标签都渲染（当前为空的标 is-empty，由 CSS 决定是否显示） */
      for (const cat of MORE_CATS) groups.set(cat, []);
      for (const it of baseEntries.more.map(toNavItem)) {
        const cat = navCategoryOf(it.page);
        const list = groups.get(cat);
        if (list) list.push(it);
        else groups.set(cat, [it]);
      }
      const out: Array<{ kind: "label"; text: string; empty: boolean } | { kind: "item"; item: NavItemView }> = [];
      for (const cat of NAV_GROUP_ORDER) {
        const list = groups.get(cat);
        if (!list) continue;
        out.push({ kind: "label", text: cat, empty: list.length === 0 });
        for (const it of list) out.push({ kind: "item", item: it });
      }
      return out;
    })();
    const foldedDefaults = pinned.filter((it) => favs.data.foldedDefaults.includes(it.page));
    const unfoldedUser = favs.data.order.filter((id) => !favs.data.foldedRoots.includes(id));
    const foldedUser = favs.data.order.filter((id) => favs.data.foldedRoots.includes(id));
    const foldedCount = foldedDefaults.length + foldedUser.length;
    return (
      <>
        {/* 常驻一级入口（§9.1）：首屏扁平呈现，不插分区小标题；今日恒在最上（不可折叠） */}
        {unfoldedDefaults.map((it) => {
          const Icon = it.icon;
          return navRow("nav-" + it.id, {
            drag: drag.rowProps(it.id, "nav", { anchor: it.page === "today", cat: navCategoryOf(it.page) }),
            active: page === it.page || it.activePages?.includes(page) === true,
            label: it.label,
            icon: <Icon />,
            onClick: () => {
              onAfter?.();
              navigate(it.page);
            },
            folded: false,
            onFold: it.page === "today" ? undefined : () => favs.foldSidebar(it.page, true),
          });
        })}
        {/* 插件功能页分组：与内置入口视觉分离 */}
        {pluginNav.length ? (
          <>
            <div className="nav-label">插件功能页</div>
            {pluginNav.map(({ page: p, label, icon: Icon }) =>
              navRow("pl-" + p, {
                active: page === p,
                label,
                icon: <Icon />,
                onClick: () => {
                  onAfter?.();
                  navigate(p);
                },
                folded: false,
              }),
            )}
          </>
        ) : null}
        {/* 「更多」折叠区（§9.1 / C15）：一级精简后的次级入口，**保留原分组标签**；
            展开态持久化（§9.3 ④），默认收起。复用折叠夹那套视觉（nav-folded-toggle/body），
            折叠侧栏时同样隐藏。 */}
        <button
          className={"nav-item nav-folded-toggle nav-more-toggle" + (moreOpen ? " is-open" : "")}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <IconMore />
          <span>更多</span>
          <IconChevron width={13} height={13} className="row-caret" />
        </button>
        {/* 「更多」区（§9.1 / C15）：**平铺成 .nav 的直接子元素**，不套容器——
            套容器时让位区间一旦跨容器边界就会漏出一条缝（容器自身不在让位序列里、
            子元素在），出现"多一条大缝 + 一对元素重叠"。平铺后让位就是同一父容器内的
            连续区间位移。收起态逐个隐藏（display:none），展开态持久化见 MORE_KEY。 */}
        {moreGrouped.map((row) => {
          if (row.kind === "label") {
            return (
              <div
                className={"nav-label" + (row.empty ? " is-empty" : "") + (moreOpen ? "" : " is-hidden")}
                data-more="1"
                data-nav-cat={row.text}
                key={"mg-" + row.text}
              >
                {row.text}
              </div>
            );
          }
          const Icon = row.item.icon;
          return navRow("nav-" + row.item.id, {
            drag: drag.rowProps(row.item.id, "nav", { cat: navCategoryOf(row.item.page) }),
            active: page === row.item.page,
            label: row.item.label,
            icon: <Icon />,
            onClick: () => {
              onAfter?.();
              navigate(row.item.page);
            },
            folded: false,
            moreGroup: true,
            extraClass: moreOpen ? "" : " is-hidden",
          });
        })}
        {/* 收藏夹分组（霖 2026-10-06：整体顺序改为「固定 → 更多 → 收藏夹」，本段在「更多」之后） */}
        <div className="nav-label">收藏夹</div>
        {/* 用户收藏夹（根层）：跳转入口层；段内限高滚动——收藏夹再多也不把
            「新建收藏夹 / 已折叠收藏夹」推到滚动边缘挤成半截 */}
        <div className="nav-folders-scroll">
          {unfoldRoots.map((id) =>
            navRow("u-" + id, {
              drag: drag.rowProps(id, "favs"),
              active: isFolderActive(id),
              label: favs.data.folders[id]?.title ?? "收藏夹",
              icon: <FolderIcon name={favs.data.folders[id]?.icon} />,
              onClick: () => {
                onAfter?.();
                navigate("folder", { folderId: id });
              },
              folded: false,
              onFold: () => favs.foldSidebar(id, false),
            }),
          )}
        </div>
        <button
          className="nav-item nav-new"
          onClick={() => {
            const id = favs.create("新建收藏夹", null);
            if (id) {
              onAfter?.();
              navigate("folder", { folderId: id });
            }
          }}
        >
          <IconFolderPlus />
          <span>新建收藏夹</span>
        </button>
        {/* 折叠组：默认入口与用户收藏夹都收这里，点一下展开 */}
        {foldedCount > 0 ? (
          <>
            <button
              className={"nav-item nav-folded-toggle" + (foldedOpen ? " is-open" : "")}
              data-fold-drop="1"
              aria-expanded={foldedOpen}
              onClick={() => setFoldedOpen((o) => !o)}
            >
              <IconFolder />
              <span>已折叠收藏夹（{foldedCount}）</span>
              <IconChevron width={13} height={13} className="row-caret" />
            </button>
            {foldedOpen ? (
              <div className="nav-folded-body">
                {foldedDefaults.map(({ page: p, label, icon: Icon }) =>
                  navRow("fd-" + p, {
                    active: page === p,
                    label,
                    icon: <Icon />,
                    onClick: () => {
                      onAfter?.();
                      navigate(p);
                    },
                    folded: true,
                    onFold: () => favs.foldSidebar(p, true),
                  }),
                )}
                {foldedUser.map((id) =>
                  navRow("fu-" + id, {
                    active: isFolderActive(id),
                    label: favs.data.folders[id]?.title ?? "收藏夹",
                    icon: <FolderIcon name={favs.data.folders[id]?.icon} />,
                    onClick: () => {
                      onAfter?.();
                      navigate("folder", { folderId: id });
                    },
                    folded: true,
                    onFold: () => favs.foldSidebar(id, false),
                  }),
                )}
              </div>
            ) : null}
          </>
        ) : null}
        {/* 钉底固定项：插件 + 设置——不进收藏夹体系，不可折叠不可改序 */}
        <div className="nav-sep" aria-hidden />
        {navRow("settings", {
          active: page === "settings",
          label: "设置",
          icon: <IconSettings />,
          onClick: () => {
            onAfter?.();
            navigate("settings");
          },
        })}
      </>
    );
  };

  /** 移动端顶栏标题（C6）：静态路由走唯一映射表 pageTitle()，插件 tab 取注册表名字，
   *  收藏夹页取用户数据里的收藏夹名。不再就地拼三元表达式（settings 曾因此显示成 OneTHU）。 */
  const topbarTitle =
    page === "folder" && navParams?.folderId
      ? favs.data.folders[navParams.folderId]?.title ?? pageTitle("folder")
      : navAll.find((n) => n.page === page)?.label ?? pageTitle(page);

  return (
    <div className="shell">
      <aside className={"sidebar" + (sbCollapsed ? " is-collapsed" : "")} aria-label="主导航">
        <div className="brand">
          <BrandLogo size={16} />
        </div>
        {/* 命令面板入口（§2.8.4）：不逼人记快捷键，旁边顺手写出当前平台的键位 */}
        <button className="sb-search" onClick={openPalette} title={"搜索功能（" + shortcutLabel() + "）"}>
          <IconSearch width={14} height={14} />
          <span className="sb-search-label">搜索功能</span>
          <kbd className="sb-kbd">{shortcutLabel()}</kbd>
        </button>
        <NavBody label="主导航">{navContent()}</NavBody>
        <div className="sidebar-foot">
          <button
            className="sidebar-collapse"
            onClick={toggleSidebar}
            title={sbCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            aria-label={sbCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            aria-expanded={!sbCollapsed}
          >
            <IconChevron width={16} height={16} style={{ transform: "rotate(180deg)" }} />
          </button>
          <HardRefreshButton variant="foot" />
          {/* 状态徽标 只在脱敏演示版渲染（2026-10-07） */}
          {DESENSITIZE_BUILD ? (
            <span className="foot-badge">
              <span className="dot" style={{ background: "var(--amber)" }} />
              {"脱敏演示版"}
            </span>
          ) : null}
        </div>
      </aside>
      {/* 移动端：左滑抽屉（≤860px 由 CSS 显示；入口是页头标题胶囊） */}
      {navOpen ? (
        <>
          <div className={"drawer-mask" + (navClosing ? " drawer-mask-closing" : "")} onClick={() => { if (!navClosing) closeNav(); }} />
          <aside className={"drawer" + (navClosing ? " drawer-closing" : "")} aria-label="导航抽屉">
            <div className="drawer-brand">
              <BrandLogo size={15} />
            </div>
            <NavBody label="抽屉导航">{navContent(() => closeNav())}</NavBody>
            <div className="drawer-foot">
              {DESENSITIZE_BUILD ? (
                <span className="foot-badge">
                  <span className="dot" style={{ background: "var(--amber)" }} />
                  {"脱敏演示版"}
                </span>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
      {/* 移动端顶栏：汉堡菜单 + 品牌标识，桌面隐藏（桌面走侧栏）。
          **必须是 .content 的兄弟而不是子节点**：C1 起 .content 自己就是滚动容器，
          两栏留在它外面才不会被整页 overscroll 带动；同时 .page-anim 保持 .content
          的直接子节点，既有 `:has(> .page-anim[...])` 高度/宽度链选择器才不被切断。 */}
      {/* A3：长按菜单的 Provider + 菜单宿主。Provider 不产生 DOM 节点，布局不变；
          页面都在里面，所以任何页面的长按都能开菜单（菜单 portal 到 body）。
          G1：顶栏也挂进这一层——「···」要复用同一个菜单宿主（在 Provider 外拿不到 api）。 */}
      <ContextMenuLayer>
        {/* 移动端顶栏：汉堡 + 品牌/返回 + 页面级操作；仍是 .content 的兄弟（Provider 不产生 DOM） */}
        <MobileTopbar innerRef={topbarRef} scrolled={topbarScrolled} title={topbarTitle} onOpenNav={() => setNavOpen(true)} />
        <main className="content" ref={contentRef}>
          {children}
        </main>
      </ContextMenuLayer>
      {/* M1 beta：移动端底部 5 Tab（CSS ≤860px 显示） */}
      <BottomNav page={rawPage} navigate={navigate} />
      {/* 命令面板：⌘/Ctrl+K 或侧栏按钮唤起；挂在 shell 顶层，任何页面都能用 */}
      <CommandPalette />
      <HardRefreshButton />
      {DevPanel ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </div>
  );
}

/** 硬刷新悬浮按钮：固定右下角，所有页面可见（含登录/双因素页）。
 *  生产环境 tauri 资源走自定义协议不进 HTTP 缓存，reload 即全量重载；
 *  移动端没有右键/⌘R，这是页面卡死/白屏后的唯一恢复出口。 */
export function HardRefreshButton({ variant = "fab" }: { variant?: "fab" | "foot" } = {}) {
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const on = () => setShowTop(readScrollTop() > 240);
    window.addEventListener("scroll", on, { passive: true, capture: true });
    on();
    return () => window.removeEventListener("scroll", on, { capture: true });
  }, []);
  /* C5（PC 跟随，霖 2026-10-06）：移动端把这两枚浮层收进顶栏、右下角清空；PC 的对应 chrome
     是侧栏底部——同一口径：PC 不再有右下角浮层，两枚入口收进 .sidebar-foot。 */
  if (variant === "foot") {
    /* 仅保留硬刷新（霖 2026-10-07：去掉「回到顶层」） */
    return (
      <button className="sb-foot-btn" title="硬刷新（整页重载）" aria-label="硬刷新" onClick={() => window.location.reload()}>
        <IconRefresh width={14} height={14} />
      </button>
    );
  }
  return (
    <>
      {showTop ? (
        <button
          className="hard-refresh-fab top-fab"
          title="回到顶层"
          aria-label="回到顶层"
          onClick={() => scrollAppTop()}
        >
          <IconArrowUp width={18} height={18} />
        </button>
      ) : null}
      <button
      className="hard-refresh-fab"
      title="硬刷新（整页重载）"
      aria-label="硬刷新"
      onClick={() => window.location.reload()}
    >
      <IconRefresh width={18} height={18} />
    </button>
    </>
  );
}

export function PageHead({
  title,
  meta,
  back,
  actions,
  menu,
}: {
  /** 页标题；收藏夹重命名等场景可传受控输入（ReactNode） */
  title: ReactNode;
  meta?: ReactNode;
  /** E9：返回/上级入口固定在左上角（结构固化，页面不再把它塞进右上 actions） */
  back?: ReactNode;
  /** 工具栏类内容（收藏夹编辑、设置页栏目管理、寻迹的选项…）：PC/手机都留在页内 */
  actions?: ReactNode;
  /** G1 页面级操作（收藏 / 刷新 / 整页主操作）：PC 渲染成右上按钮，手机上收进顶栏「···」菜单。
   *  与 actions 的分工是「页面级操作 vs 工具栏」，不是二选一——有的页面两者都有。 */
  menu?: PageMenuItem[];
}) {
  const { page } = useApp();
  /* G1：把返回目标与菜单项同步给顶栏。返回目标从 back 槽的 BackButton 上取——那是
     页面唯一声明处，顶栏不再让每个页面写第二遍（护栏断言 back 槽只放 BackButton）。 */
  const backEl = back as ReactElement<{ to?: Page; label?: string; courseId?: string; courseTab?: string }> | undefined;
  const backProps = backEl?.props;
  const backTo = backProps?.to;
  const menuSig = (menu ?? []).map((m) => m.key + ":" + m.label + (m.danger ? ":!" : "")).join(",");
  const backSig = backTo ? backTo + "|" + (backProps?.label ?? "") + "|" + (backProps?.courseId ?? "") : "";
  useEffect(() => {
    syncPageChrome({
      back: backTo ? backTargetOf(backTo, backProps?.label, backProps?.courseId, backProps?.courseTab) : null,
      menu: menu ?? [],
    });
    /* 每次渲染都同步 live（onSelect 闭包要最新），所以这个 effect 故意不带依赖数组 */
  });
  useEffect(() => clearPageChrome, []);
  /* C6：页内大标题默认在移动端隐藏（与顶栏重复，见 CSS 的 `.page-head h1{display:none}`）；
     但**实体标题**（课程名 / 作业名 / 话题名…）不是重复信息，用类名显式保留。
     判据只有一处：与唯一映射表 pageTitle(page) 同名才算重复；非字符串标题
     （如收藏夹重命名的受控输入）一律保留——那是可操作控件，藏了就没法改名。 */
  const entityTitle = typeof title !== "string" || title !== pageTitle(page);
  return (
    <header className="page-head">
      {/* E9 头部布局类：back 在左上、主体居中、主操作在右上——顺序即位置 */}
      <div className="page-head-main">
        {back ? <div className="page-head-back">{back}</div> : null}
        <div className="page-head-text">
          <h1 className={entityTitle ? "page-head-title-entity" : undefined}>{title}</h1>
          {meta ? <div className="page-head-meta">{meta}</div> : null}
        </div>
      </div>
      {menu?.length || actions ? (
        <div className="page-head-actions">
          {/* G1 页面级操作：手机上由顶栏「···」菜单承载，这里只留给 PC */}
          {menu?.length ? (
            <span className="page-head-page-actions">
              {menu.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={"btn" + (m.danger ? " btn-danger" : "")}
                  aria-label={m.label}
                  title={m.label}
                  disabled={m.disabled}
                  onClick={m.onSelect}
                >
                  {m.icon}
                  <span className="btn-label">{m.label}</span>
                </button>
              ))}
            </span>
          ) : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function SectionHead({
  title,
  aside,
}: {
  title: string;
  aside?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {aside ? <span className="section-aside">{aside}</span> : null}
    </div>
  );
}

export function Card({
  className = "",
  style,
  children,
  ...rest
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  /* `...rest` 只为透传 `data-*`（A3 长按菜单靠它把宿主数据的键带到 DOM 上）；
     类名与内联样式仍由这里合并，调用方改不动卡片的层级规则（§3.5 B2）。 */
  return (
    <div className={`card ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

/* 空状态：text 必填，icon/hint/action 可选（B5b）。
   旧调用 <Empty text="..." /> 一字不改仍然成立；需要更完整的空状态时再加图标与副文案。 */
export function Empty({
  text,
  icon,
  hint,
  action,
}: {
  text: string;
  icon?: ReactNode;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon" aria-hidden="true">{icon}</div> : null}
      <div className="empty-title">{text}</div>
      {hint ? <div className="empty-hint">{hint}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  /** b31（RC1）：用户点重试 → 先清冷却再重载；按钮期间置忙，避免连点抢跑。 */
  const [retrying, setRetrying] = useState(false);
  const onRetryClick = useCallback(() => {
    if (retrying) return;
    setRetrying(true);
    // 顺序是关键：必须先 await 清零静默重登的 streak 与冷却，再触发重载，
    // 否则新请求会落回冷却窗（`skipped/cooldown`）→ 再弹一次（霖「点完一次又弹」）。
    // 动态 import 失败也继续重试，绝不把按钮卡死。
    void import("../lib/clients.js")
      .then((m) => m.clearLibSoftBackoff())
      .catch(() => undefined)
      .finally(() => {
        onRetry?.();
        setRetrying(false);
      });
  }, [retrying, onRetry]);
  return (
    <div className="error-note">
      <ErrorLine text={text} />
      {onRetry ? (
        <button className="btn btn-ghost" disabled={retrying} onClick={onRetryClick}>
          {retrying ? "重试中…" : "重试"}
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      {Array.from({ length: rows }, (_, i) => (
        <div className="row" key={i} style={{ animation: "none" }}>
          <div className="skeleton" style={{ width: 64, height: 32 }} />
          <div className="row-main">
            <div className="skeleton" style={{ width: "55%", height: 13 }} />
            <div className="skeleton" style={{ width: "30%", height: 10, marginTop: 7 }} />
          </div>
        </div>
      ))}
    </Card>
  );
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={"switch" + (on ? " on" : "")}
      onClick={() => onChange(!on)}
    />
  );
}
