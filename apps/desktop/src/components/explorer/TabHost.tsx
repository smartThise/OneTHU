import { useExperienceMode, useIsSimpleLike, experienceMode, isSimpleLike } from "../../state/experienceMode.js";
import { SimpleHost } from "../SimpleExperience.js";
/**
 * Explorer 标签页宿主（dev-explorer 革命核心）：所有标签页常驻挂载、display 切换。
 *
 * - **每个标签页有独立的路由上下文**（TabScope：Ctx.Provider 覆盖 page/navParams/
 *   navigate）——两个网络学堂 tab 各点各的课程互不串台（用户实测抓到的核心 bug）；
 *   面板内 navigate = 该 tab 内导航；首页面板内 navigate = 打开目标（已存在则复用）；
 * - 首页（home）恒在、恒挂载，正文 = HomeTab；
 * - 页标签页首次聚焦时才挂载（懒挂载，避免启动恢复 N 个标签页时的抓取风暴），
 *   挂过之后终身保留（display:none），工作上下文不丢；
 * - 页内导航：容器内 key=page 的 .page-anim 层重挂 → 保留原转场语义；
 * - **右键（桌面）/长按（手机）任意页面空白处** → 「在新标签页打开此页」（forceNew
 *   复制当前所在的一/二/三级页，新 tab 仍是一级面板形态）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Ctx, useApp } from "../../state/context.js";
import type { AppState, LearnNav, Page } from "../../state/app.js";
import {
  HOME_TAB_ID,
  allTabs,
  closeTab,
  duplicateTab,
  navigateInTab,
  openSettings,
  openTab,
  useExplorerState,
} from "../../state/explorer.js";
import type { ExplorerTab } from "../../state/explorer.js";
import { isSubPage, renderPage } from "./renderPage.js";
import { HomeTab } from "./HomeTab.js";
import {
  BUILTIN_WALLPAPERS,
  setGlobalWallpaper,
  wallpaperSnapshot,
} from "../../state/wallpaper.js";
import { WallpaperLibrary } from "./WallpaperLibrary.js";
import { useNavDirection } from "../../lib/motion.js";
import { t as i18n } from "../../i18n/index.js";


/* ══════════ tab 局部路由上下文 ══════════ */

/** 每个标签页一个 Provider：页面里 useApp() 读到的是**该 tab 自己**的 page/params，
 *  navigate 只动这一个 tab。外壳（TopBar/齿轮等）在 Shell 层，不受覆盖影响。 */
function TabScope({ tab, children }: { tab: ExplorerTab; children: ReactNode }): ReactNode {
  const outer = useApp();
  const navigate = useCallback(
    (p: Page, params?: LearnNav) => {
      if (p === "settings" || p === "plugins") {
        openSettings(p === "settings" ? "settings" : "plugins");
        return;
      }
      if (tab.kind === "home") {
        openTab(p, params); // 入口级：已存在同实例 → 复用聚焦（openTab 默认行为）
        return;
      }
      navigateInTab(tab.id, p, params);
    },
    [tab.id, tab.kind],
  );
  const value = useMemo<AppState>(
    () => ({ ...outer, page: tab.page, navParams: tab.params, navigate }),
    [outer, tab.page, tab.params, navigate],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ══════════ 懒挂载集合 ══════════ */

/** 本会话内已挂载过的标签页 id 集（懒挂载标记；不持久化——恢复的标签页首次聚焦再挂） */
function useMountedTabs(activeId: string, tabs: ExplorerTab[]): Set<string> {
  const [mounted, setMounted] = useState<Set<string>>(() => new Set([HOME_TAB_ID, activeId]));
  useEffect(() => {
    setMounted((prev) => {
      if (prev.has(activeId)) return prev;
      const next = new Set(prev);
      next.add(activeId);
      return next;
    });
  }, [activeId]);
  /* 已关闭的标签页从集合里清掉（防集合无界增长；id 不复用） */
  useEffect(() => {
    setMounted((prev) => {
      const live = new Set([HOME_TAB_ID, ...tabs.map((t) => t.id)]);
      let changed = false;
      const next = new Set([...prev].filter((id) => {
        if (live.has(id)) return true;
        changed = true;
        return false;
      }));
      return changed ? next : prev;
    });
  }, [tabs]);
  return mounted;
}

/* ══════════ 右键 / 长按 → 「在新标签页打开此页」 ══════════ */

/** 命中交互元素时放行（按钮/链接上的长按是页面自己的语义，不抢） */
function onInteractive(el: EventTarget | null): boolean {
  return !!(el instanceof HTMLElement && el.closest("button, a, input, textarea, select, [role='button'], [contenteditable], .seg-track, .plg-tab-root"));
}

interface MenuPos { x: number; y: number; tabId: string }

function TabContextMenu({
  pos,
  onClose,
  onPick,
}: {
  pos: MenuPos;
  onClose: () => void;
  /** 打开壁纸库选择器（菜单关、选择器接着开，同一坐标）：壁纸只有全屏一档 */
  onPick: () => void;
}): ReactNode {
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ left: pos.x, top: pos.y });
  useLayoutEffect(() => {
    const place = (): void => {
      const rect = menuRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPlacement({
        left: Math.max(8, Math.min(pos.x, window.innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(pos.y, window.innerHeight - rect.height - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [pos.x, pos.y]);
  const isHome = pos.tabId === HOME_TAB_ID;
  /* 壁纸入口：换壁纸走壁纸库选择器（上传/内置渐变/删除都在库里）；清除则回落无壁纸。
     「画布化定案」：壁纸只有全屏一档——右键菜单的「本页」三件套已删（2026-10-14）。 */
  const hasGlobal = !!wallpaperSnapshot().global;
  const items: Array<{ label: string; danger?: boolean; act: () => void }> = [
    { label: i18n("auto.components.explorer.TabHost.p1"), act: () => duplicateTab(pos.tabId) },
    { label: i18n("auto.components.explorer.TabHost.p2"), act: () => onPick() },
    ...BUILTIN_WALLPAPERS.slice(0, 4).map((b) => ({
      label: "全屏壁纸 · " + b.label,
      act: () => setGlobalWallpaper("builtin:" + b.id),
    })),
    ...(hasGlobal ? [{ label: i18n("auto.components.explorer.TabHost.p3"), danger: true, act: () => setGlobalWallpaper(null) }] : []),
    ...(isHome ? [] : [{ label: i18n("auto.components.explorer.TabHost.p4"), danger: true, act: () => closeTab(pos.tabId) }]),
  ];
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 1200 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div ref={menuRef} className="explorer-ctxmenu" style={placement} role="menu">
        {items.map((it) => (
          <button
            key={it.label}
            className={"explorer-ctxmenu-item" + (it.danger ? " is-danger" : "")}
            role="menuitem"
            onClick={() => { it.act(); onClose(); }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}

/* ══════════ 壁纸库选择卡（2026-10-13 接线）：菜单项「换壁纸 · 从库选」打开 ══════════
   浮动卡片 = menu tier 玻璃壳（样式见 explorer.css 的 .wall-lib-picker-card），
   位置取菜单坐标并夹取在视口内；Escape / 点卡片外（遮罩）关闭；
   内部是 WallpaperLibrary picker：点图=设为全屏，上传也在库里。 */
function WallPickerCard({
  left,
  top,
  onClose,
}: {
  left: number;
  top: number;
  onClose: () => void;
}): ReactNode {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return createPortal(
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 1200 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div className="wall-lib-picker-card" style={{ left, top }}>
        <WallpaperLibrary variant="picker" onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}

/* ══════════ 宿主 ══════════ */

export function TabHost(): ReactNode {
  const simple = useIsSimpleLike(); /* 极简与实用都走简洁壳（无标签页） */
  const st = useExplorerState();
  const activeId = st.activeId;
  const mounted = useMountedTabs(activeId, st.tabs);
  const activePage = st.tabs.find((t) => t.id === activeId)?.page ?? "";
  const navDir = useNavDirection(activePage, isSubPage);
  // Flowing pages share the window scroller, but each tab keeps its own place.
  const scrollPositions = useRef(new Map<string, { x: number; y: number }>());
  const scrollingTab = useRef(activeId);
  useEffect(() => {
    const save = (): void => {
      if(isSimpleLike(experienceMode()))return; /* 简洁壳不记标签滚动位 */
      scrollPositions.current.set(scrollingTab.current, { x: window.scrollX, y: window.scrollY });
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useLayoutEffect(() => {
    scrollingTab.current = activeId;
    if(simple)return;
    const pos = scrollPositions.current.get(activeId);
    const restore = (): void => window.scrollTo({ left: pos?.x ?? 0, top: pos?.y ?? 0, behavior: "instant" });
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [activeId, simple]);

  const [menu, setMenu] = useState<MenuPos | null>(null);
  /* 壁纸库选择卡（右键菜单「换壁纸 · 从库选」）：菜单关、选择卡接着开——坐标沿用发起菜单的 pos */
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const openPicker = useCallback((p: MenuPos) => {
    setMenu(null); // pick 的动作语义：先关菜单，选择卡随后弹出（同一坐标）
    setPicker({ x: p.x, y: p.y });
  }, []);
  /* 长按计时（触屏）：550ms 原地按住 → 菜单；鼠标用右键 */
  const press = useRef<{ x: number; y: number; id: string; timer: number } | null>(null);
  const clearPress = useCallback(() => {
    if (press.current) {
      window.clearTimeout(press.current.timer);
      press.current = null;
    }
  }, []);
  useEffect(() => clearPress, [clearPress]);

  const all = useMemo(() => {
    const home: ExplorerTab = { id: HOME_TAB_ID, kind: "home", page: "homepage", params: null, title: i18n("auto.components.explorer.TabHost.p5"), workspaceId: null, createdAt: 0, lastActiveAt: 0 };
    return [home, ...st.tabs];
  }, [st.tabs]);

  const onHomeFree = (target: EventTarget | null): boolean =>
    !!(target instanceof Element && target.closest(".home-free"));

  /* 长按（触屏）统一口径与右键一致：首页白板区域的菜单归白板自己，长按不再弹宿主菜单 */
  const panelPointerDown = useCallback((e: React.PointerEvent, tabId: string) => {
    if (e.pointerType === "mouse") return; // 鼠标走 contextmenu
    if (onInteractive(e.target) || (tabId === HOME_TAB_ID && onHomeFree(e.target))) return;
    clearPress();
    const { clientX, clientY } = e;
    const timer = window.setTimeout(() => {
      press.current = null;
      setMenu({ x: clientX, y: clientY, tabId });
    }, 550);
    press.current = { x: clientX, y: clientY, id: tabId, timer };
  }, [clearPress]);
  const panelPointerMove = useCallback((e: React.PointerEvent) => {
    const p = press.current;
    if (p && (Math.abs(e.clientX - p.x) > 10 || Math.abs(e.clientY - p.y) > 10)) clearPress();
  }, [clearPress]);

  /* 「画布化定案」：面板与内容层永远透明，全屏壁纸由壳层（ShellWallpaperLayer）绘制并
     透过玻璃栏体显形——这里不再有任何 per-tab 壁纸分支与亮度档挂点（2026-10-14 删）。 */
  return (
    <>
      {all.map((t) => {
        const active = !simple && t.id === activeId;
        return (
          <div
            key={t.id}
            /* 面板的画布类：home 走 is-home-canvas；**board（一块 OnePage）必须走 is-onepage-canvas** ——
              2026-10-15 用户报「其他白板下半部分截断」，真因就是这里只写了 home 那一支：面板拿不到类，
              于是吃到基线 `.explorer-panel { overflow: hidden }`，比面板高的画布被直接裁掉（真 app 探针实测：
              panel[h=529 sh=2456 oy=hidden]）。口径与 Layout 的 contentCanvasClass 保持一致。 */
            className={"explorer-panel" + (t.page === "homepage" ? " is-home-canvas" : t.page === "board" ? " is-onepage-canvas" : "")}
            data-tab-id={t.id}
            data-tab-page={t.page}
            style={active ? undefined : { display: "none" }}
            onContextMenu={(e) => {
              if (onInteractive(e.target)) return;
              /* 首页右键统一（用户点名：不要一右键弹两个菜单）——首页自由白板区域
                 的右键/长按是白板自己的「添加组件/便笺」就地菜单（FreeBoard 在
                 空白画布与组件上都自己处理并 preventDefault），宿主面板菜单退出；
                 壁纸入口仍在 设置→壁纸（全窗共用一档）。 */
              if (e.target instanceof Element && t.kind === "home" && e.target.closest(".home-free")) return;
              e.preventDefault();
              clearPress();
              setMenu({ x: e.clientX, y: e.clientY, tabId: t.id });
            }}
            onPointerDown={(e) => panelPointerDown(e, t.id)}
            onPointerMove={panelPointerMove}
            onPointerUp={clearPress}
            onPointerCancel={clearPress}
          >
            {/* 页内导航时重挂这一层（保留 .page-anim 转场）；切标签页不动这一层 */}
            <div className="page-anim" key={t.page} data-page={t.page} data-dir={active ? navDir : undefined} data-level={isSubPage(t.page) ? "sub" : undefined}>
              <TabScope tab={t}>
                {t.kind === "home" ? (
                  <HomeTab />
                ) : mounted.has(t.id) ? (
                  renderPage(t.page)
                ) : (
                  <div className="page-body" aria-hidden="true" />
                )}
              </TabScope>
            </div>
          </div>
        );
      })}
      {simple ? <SimpleHost/> : null}
      {!simple && menu ? <TabContextMenu pos={menu} onClose={() => setMenu(null)} onPick={() => openPicker(menu)} /> : null}
      {picker
        ? <WallPickerCard
            /* 夹取视口内：卡片宽约 360（窄屏用 vw 收窄），高按 320 起步；Math.max 防极小窗口 */
            left={Math.max(8, Math.min(picker.x, window.innerWidth - 380))}
            top={Math.max(8, Math.min(picker.y, window.innerHeight - 340))}
            onClose={() => setPicker(null)}
          />
        : null}
    </>
  );
}
