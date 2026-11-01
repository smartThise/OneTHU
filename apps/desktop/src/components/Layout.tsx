import { startMobileNavigation } from "../state/mobileNavigation.js";
import { FriendInboxButton, FriendInboxMonitor } from "./FriendInvitations.js";
import { allSearchRows } from "../state/searchRows.js";
import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { BrandLogo } from "./BrandLogo.js";
import { useExperienceMode, useIsSimpleLike, useSimpleRoute } from "../state/experienceMode.js";
import { MobileFeatureNavigation } from "./MobileFeatureNavigation.js";
import { SimpleHeader } from "./SimpleExperience.js";
import { IconBtn, IconUser } from "@onethu/gui";
/** Explorer 顶栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关）。
 *  dev-explorer 革命（2026-10-12）：侧边栏、移动抽屉、五格底栏整体退役——
 *  顶栏 = 首页 Logo（恒在）+ 标签条 + 搜索 + 设置齿轮；底栏三入口（标签页 | OH | OneGO）
 *  在 explorer/BottomBar；设置/插件/OH 是高于任何标签页的浮层（state/explorer.ts 的
 *  overlay store 即旧 Entry 状态机，goEntry/useEntry 在此薄重导出保持全库兼容）。 */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useThemes } from "../state/theme.js";
import { useApp } from "../state/context.js";
import { topLevelPage, type LearnNav, type Page } from "../state/app.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import {
  HOME_TAB_ID,
  activeTab,
  closeSettings,
  duplicateTab,
  focusTab,
  openSettings,
  overlaySnapshot,
  subscribeOverlay,
  useExplorerState,
  useOverlayEntry,
  type OverlayEntry,
} from "../state/explorer.js";
import { HarnessMark } from "./HarnessMark.js";
import { NAV_REGISTRY } from "../state/navigation.js";
import { DESENSITIZE_BUILD } from "../lib/privacy.js";
import { IconHome, IconArrowUp, IconChevron, IconCopyTab, IconFolder, IconFolderPlus, IconInfo, IconLearn, IconMore, IconPen, IconPlug, IconRefresh, IconSchedule, IconSettings, IconSidebarRail, IconStar, IconToday, IconXk, IconCard, IconCalendar, FolderIcon, IconExternal, IconThos, IconTrace, IconMail, IconCloud, IconBook, IconGitLab, IconXiaoda } from "./Icons.js";
import { ContextMenuLayer, useContextMenu } from "./ContextMenu.js";
import {
  clearPageChrome, pageChromeSnapshot, readPageChrome, subscribePageChrome, syncPageChrome,
  type PageMenuItem,
} from "../state/pageChrome.js";
import { useFavs } from "../state/favs.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";
import { showToast } from "../state/toast.js";
import { useSegPill } from "../lib/motion.js";
import { ErrorLine } from "./Details.js";
import { CommandPalette } from "./CommandPalette.js";
import { TabStrip } from "./explorer/TabStrip.js";
import { ShellWallpaperLayer } from "./explorer/WallpaperVideo.js";
import { ContextMenuHost } from "./explorer/ContextMenu.js";
import { WorkspaceEditorHost } from "./explorer/WorkspaceEditor.js";
import { FolderIconPickerHost } from "./explorer/FolderIconPicker.js";
import { OneShot } from "./explorer/OneShot.js";
import { OneGoBar } from "./explorer/OneGoBar.js";
import { VaultDropTarget } from "./vault/VaultDropTarget.js";
import { VaultSheetHost } from "./vault/VaultSheet.js";
import { useTabLayoutMode } from "../state/tabLayout.js";

/* ══ OneGUI 适配层 ═════════════════════════════════════════════════════════
 * 下面这七个原语（SectionHead / Card / Empty / ErrorNote / SkeletonRows / Switch）
 * 曾经是"手写 DOM + global.css 的类"，热力覆盖 60/40/31/28/30/8 个文件。
 * 现在实现体整体换成 @onethu/gui 的组件：**名字与 props 一字不动**，
 * 于是 60+ 个调用点在一刻之间全部改由 OneGUI 渲染，页面再逐个迁到直接 import。
 * 迁移完成后这一层会被删除（它不是第二套实现，只是过渡期的转接头）。 */
import {
  Banner as OGBanner,
  Btn as OGBtn,
  Card as OGCard,
  EmptyState as OGEmptyState,
  LoadingBlock as OGLoadingBlock,
  PageHead as OGPageHead,
  Section as OGSection,
  Switch as OGSwitch,
} from "@onethu/gui";
import { useIsPhone } from "../state/phoneSheets.js";
import { BottomBar } from "./explorer/BottomBar.js";
import { TabDrawer } from "./explorer/TabDrawer.js";
import { OneGoSheet } from "./explorer/OneGoSheet.js";
import { SettingsOverlay } from "./explorer/SettingsOverlay.js";
import "../styles/explorer.css";
import "../styles/explorer-ui.css";
import "../styles/explorer-home.css";

/** 开发者面板（仅 dev 构建）：右上角 commit 徽标 + 前端日志/诊断/导出。
 *  正式版里 __ONETHU_DEV__ 折叠为 false → 这句动态 import 被 rollup 删除，
 *  dev 面板整块不进产物（守卫 tools/devtools-test.mjs，构建后再 grep dist 复核）。 */
const DevPanel = __ONETHU_DEV__ ? lazy(() => import("./DevPanel.js")) : null;
/* 检索落点自查（仅 dev）：?searchland=selfcheck 逐行程序化搜+点击，console 打 45 行 hit/fallback 表。 */
const SearchLandingSelfcheck = __ONETHU_DEV__ ? lazy(() => import("./SearchLandingSelfcheck.js")) : null;

/**
 * 一级功能目录（全库导入的数据源，保持原数组不动）：完整目录现渲染在首页
 * 「功能目录」卡（explorer/HomeTab），侧栏已退役但这份数据仍是唯一事实来源。
 */
export const NAV: Array<{ page: Page; label: string; icon: (p: object) => ReactNode; activePages?: Page[] }> = [
  // 「今日」那一格已删（用户 2026-10-15 点名）：它就是首页自己（page id 仍叫 today），
  // 目录里再列一遍等于「首页 → 首页」；而且它是程序坞默认球的第一颗
  //（homeSpheres 的 docked = NAV.slice(0,8)）。删掉后老用户持久化的 "home" 球
  // 会被 sanitize 的 NAV 白名单自动过滤掉，不用写迁移。
  { page: "tasks", get label() { return i18n("components.layout.52fdbbaeda4c"); }, icon: IconPen, activePages: ["tasks", "learn-assignments", "learn-assignment-detail", "learn-ykt-detail"] },
  // R30：这一栏现在同时收纳网络学堂与雨课堂的课程，侧栏用中性的「课程」；
  // 「网络学堂」保留为**来源名**（课程卡/作业行上的来源徽标、今日页等处不改）。
  { page: "learn", get label() { return i18n("components.layout.60db1afb4022"); }, icon: IconLearn },
  { page: "schedule", get label() { return i18n("components.layout.a14f23af7016"); }, icon: IconSchedule },
  { page: "trace", get label() { return i18n("components.layout.60458dfb4c14"); }, icon: IconTrace },
  { page: "contacts", get label() { return i18n("components.layout.06657c279571"); }, icon: IconMail },
  { page: "mail", get label() { return i18n("components.layout.73075237fd0f"); }, icon: IconMail },
  { page: "cloud", get label() { return i18n("components.layout.f75562426e77"); }, icon: IconCloud },
  { page: "gitlab", label: "GitLab", icon: IconGitLab },
  { page: "thubook", label: "THUBook", icon: IconBook },
  /* 清小搭（2026-10-15 用户点名「加入一级功能区程序坞」）：一级页，排在 thubook 之后——
     前八颗（程序坞默认球 = NAV.slice(0,8)）一颗不动，它作为第九颗出现在坞上；
     它是 homeSpheres 白名单（known）的一员，否则 sanitize 会把持久化的这颗球吃掉。 */
  { page: "xiaoda", get label() { return i18n("components.layout.b1abb3dc2271"); }, icon: IconXiaoda },
  { page: "info", get label() { return i18n("components.layout.e7028601e7da"); }, icon: IconInfo },
  { page: "life", get label() { return i18n("components.layout.15d208d1b4c9"); }, icon: IconCard },
  { page: "reserve", get label() { return i18n("components.layout.352cdc807892"); }, icon: IconCalendar },
  { page: "zhjwxk", get label() { return i18n("components.layout.fd17d86dd268"); }, icon: IconXk },
  { page: "thos", get label() { return i18n("components.layout.1760b98532ec"); }, icon: IconThos },
  { page: "otherinfo", get label() { return i18n("components.layout.4ebe692f5dbb"); }, icon: IconExternal },
];

/** 插件动态 tab（useSyncExternalStore 订阅；PageHead 的 navLabel 消歧也用它） */
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

export { BrandLogo } from "./BrandLogo.js";

/** 顶栏：首页 Logo（点击回首页，恒在不变）+ 标签条 + 搜索 + 设置齿轮（恒在不变）。
 *  滚过 8px 浮起阴影（沿用旧顶栏的层次手法）。 */
/** 竖版标签栏：左侧栏（横版时不渲染）；同时给根节点打 tabs-vertical，主内容区据此让出左栏 */
/** 竖版侧栏底部：复制 / 设置 / 宽窄切换（完整 ↔ 窄）。窄模式下竖排 */
function RailActions({ narrow, onToggleNarrow }: { narrow: boolean; onToggleNarrow: () => void }): ReactNode {
  const uiLocale = useUiLocale();

  const { activeId } = useExplorerState();
  const canDup = activeId !== HOME_TAB_ID;
  return (
    <div className="ex-rail-actions">
      <FriendInboxButton />
      <IconBtn label={i18n("components.layout.fb32cf481c29")} icon={<IconCopyTab width={16} height={16} />} onClick={() => duplicateTab(activeId)} disabled={!canDup} />
      <IconBtn label={i18n("components.layout.7f1d9dd04cd1")} icon={<IconUser size="sm" />} onClick={() => openSettings("profile")} />
      <button
        className="icon-btn ex-rail-width"
        onClick={onToggleNarrow}
        aria-pressed={narrow}
        aria-label={narrow ? i18n("components.layout.b5c07fc4f827") : i18n("components.layout.0be1eb29d29d")}
        title={narrow ? i18n("components.layout.76fb5d2b725f") : i18n("components.layout.6ac6519ea0d3")}
      >
        <IconSidebarRail width={16} height={16} />
      </button>
    </div>
  );
}

const RAIL_NARROW_KEY = "ex-rail-narrow";

function TabRail(): ReactNode {
  const uiLocale = useUiLocale();

  /* 手机（dev-explorer 二轮拍板）：竖栏永不出现——html.is-phone 下只允许横标签页；
     即便存过「竖版」默认值，这里也把 tabs-vertical 类一起收回，内容区不让位。 */
  const phone = useIsPhone();
  const mode = useTabLayoutMode();
  const [narrow, setNarrow] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_NARROW_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("tabs-vertical", mode === "v" && !phone);
  }, [mode, phone]);
  useEffect(() => {
    document.documentElement.classList.toggle("rail-narrow", mode === "v" && !phone && narrow);
    try {
      localStorage.setItem(RAIL_NARROW_KEY, narrow ? "1" : "0");
    } catch {
      /* 存不了就只在本次会话生效 */
    }
  }, [mode, narrow, phone]);
  if (mode !== "v" || phone) return null;
  return (
    <aside className="ex-rail" aria-label={i18n("components.layout.a626aad412b7")}>
      <TabStrip />
      <RailActions narrow={narrow} onToggleNarrow={() => setNarrow((v) => !v)} />
    </aside>
  );
}

function TopBar(): ReactNode {
  const uiLocale = useUiLocale();

  const layout = useTabLayoutMode();
  /* 手机（A2/A3，2026-10-16 改口径）：顶栏只留一个圆形首页钮（房子），复制钮不要；
     **标签条彻底退役**——横竖都不渲染，换标签只走底栏「标签页」抽屉。 */
  const phone = useIsPhone();
  const [scrolled, setScrolled] = useState(false);
  const { activeId } = useExplorerState();
  const canDup = activeId !== HOME_TAB_ID;
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // 竖版：顶栏退场，标签与复制/设置都在左侧栏（手机不适用：顶栏恒 minimal）
  if (layout === "v" && !phone) return null;
  return (
    <header className={"explorer-topbar" + (scrolled ? " is-scrolled" : "")}>
      {/* dev-explorer（用户拍板）：OneTHU 品牌标与「首页」标签并成 TabStrip 首位，左上单独的
          Logo 钮退役——复制按钮成为顶栏最左；首页仍恒在（TabStrip 首位不可关） */}
      {/* 竖版：复制 / 设置移到左侧栏底部，顶栏只保留横版标签条 */}
      <MobileFeatureNavigation/>
      {phone ? (
        /* 手机档（2026-10-16 用户口径）：顶部只留一个**圆形房子钮**回首页——
           横竖都不再有标签条（换标签只走底栏「标签页」抽屉）。此前是 OneTHU monogram 玻璃片。 */
        <button className="ex-tb-home-mark" onClick={() => focusTab(HOME_TAB_ID)} aria-label={i18n("components.layout.203c08e0d44a")} title={i18n("components.layout.203c08e0d44a")}>
          <IconHome width={19} height={19} />
        </button>
      ) : layout === "h" ? (
        <IconBtn label={i18n("components.layout.fb32cf481c29")} icon={<IconCopyTab width={16} height={16} />} onClick={() => duplicateTab(activeId)} disabled={!canDup} />
      ) : null}
      {layout === "h" && !phone ? <TabStrip /> : null}
      <span className="tb-spring" aria-hidden="true" />
      {/* 页面级操作「···」：白板等页面经 pageChrome 声明的菜单在此展开（无菜单时不渲染） */}
      <ChromeMore />
      <FriendInboxButton />
      <IconBtn label={i18n("components.layout.7f1d9dd04cd1")} icon={<IconUser size="sm" />} onClick={() => openSettings("profile")} />
    </header>
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
  const uiLocale = useUiLocale();

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
    for (const child of el.children) ro.observe(child);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
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
  const uiLocale = useUiLocale();

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

/** Explorer 外壳：顶栏 + 内容（TabHost）+ 底栏三入口 + 命令面板 + 设置浮层。 */
export function Shell({ children }: { children: ReactNode }) {
  const uiLocale = useUiLocale();

  useEffect(startMobileNavigation, []);
  const mode = useExperienceMode();
  const simple = useIsSimpleLike(); /* 极简与实用共用简洁壳 */
  useEffect(() => { document.documentElement.dataset.experience = mode; return () => { delete document.documentElement.dataset.experience; }; }, [mode]);
  const explorer = useExplorerState();
  const activePageTab = explorer.tabs.find((t) => t.id === explorer.activeId);
  const simpleRoute = useSimpleRoute();
  const scheduleActive = (simple ? simpleRoute.page : activePageTab?.page) === "schedule";
  useEffect(() => { document.documentElement.classList.toggle("is-schedule-page", scheduleActive); return () => document.documentElement.classList.remove("is-schedule-page"); }, [scheduleActive]);
  const contentCanvasClass = explorer.activeId === HOME_TAB_ID
    ? " is-home-canvas"
    : activePageTab?.page === "board"
      ? " is-onepage-canvas"
      : "";
  return (
    <div className={"shell explorer-shell" + (simple ? " is-simple" : "")}>
      {/* 全屏档壁纸（最底层；栏体玻璃透出它）+ 亮度档供栏体文字分支 */}
      <ShellWallpaperLayer />
      {!simple && <FriendInboxMonitor />}
      {/* 长按/右键菜单 Provider + 菜单宿主（PR 55 白板语义并入 explorer shell）：
          Provider 不产生 DOM，布局不变；TopBar 的「···」与页面 useContextMenu 都依赖它 */}
      <ContextMenuLayer>
      {simple ? <SimpleHeader/> : <><TopBar /><TabRail /></>}
      <main
        className={"content explorer-content" + (simple ? "" : contentCanvasClass)}
        data-active-page={simple ? simpleRoute.page : (activePageTab?.page ?? "homepage")}
      >{children}</main>
      </ContextMenuLayer>
      <BottomBar />
      {!simple && <OneGoBar />}
      <OneShot scheduleMode={scheduleActive} />
      {!simple && <><VaultSheetHost />
      {/* 标签页抽屉与 OneGO 抽屉（portal 自管理开合，挂一次即可） */}
      <TabDrawer />
      <OneGoSheet />
      <ContextMenuHost />
      <WorkspaceEditorHost />
      <FolderIconPickerHost />
      <VaultDropTarget /></>}
      {/* 命令面板：⌘/Ctrl+K 或顶栏按钮唤起；挂在 shell 顶层，任何页面都能用 */}
      <CommandPalette />
      {/* 设置浮层（个人设置 / 插件 / OneTHU Harness）：不是标签页，高于任何标签页 */}
      <SettingsOverlay />
      {/* dev 构建「检索落点自查路由」(?searchland=selfcheck)：release 里整块被 rollup 剥离，不进导航 */}
      {SearchLandingSelfcheck ? (
        <Suspense fallback={null}>
          <SearchLandingSelfcheck />
        </Suspense>
      ) : null}
      <HardRefreshButton />
      {DevPanel ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </div>
  );
}

/** 硬刷新悬浮按钮：默认右下角，自动避开右下的其他浮层按钮
 *  （OneShot、日程设置、白板工具栏、暂存箱、回到顶层…），永远落在最靠右下的空位；
 *  按住可拖动（位置按设备记住，存在 onethu.ui.refreshFab.v1）。
 *  生产环境 tauri 资源走自定义协议不进 HTTP 缓存，reload 即全量重载；
 *  移动端没有右键/⌘R，这是页面卡死/白屏后的唯一恢复出口。 */
const REFRESH_POS_KEY = "onethu.ui.refreshFab.v1";
type FabPos = { right: number; bottom: number };
/** Stable scrollbar gutters may shrink the root box without changing clientWidth. */
const fabViewportWidth = (): number => Math.min(window.innerWidth,
  document.documentElement.clientWidth || window.innerWidth,
  document.documentElement.getBoundingClientRect().width || window.innerWidth);
function readFabPos(): FabPos | null {
  try {
    const raw = localStorage.getItem(REFRESH_POS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<FabPos>;
    if (Number.isFinite(v.right) && Number.isFinite(v.bottom)) return { right: Number(v.right), bottom: Number(v.bottom) };
  } catch { /* 坏数据就当没摆过 */ }
  return null;
}
/** 右下角可能出现的浮件：自动找位的避让清单（只认真正压在同一象限里的）。 */
const FAB_OBSTACLES = ".ex-bbar, .oneshot, .schedule-dock, .board-viewport-tools, .free-fab-col, .vault-dock, .vault-anchor, .top-fab, .chat-dock, .dock-panel, .ex-mini";

export function HardRefreshButton() {
  const uiLocale = useUiLocale();

  const [showTop, setShowTop] = useState(false);
  const [stored, setStored] = useState<FabPos | null>(readFabPos);
  const [auto, setAuto] = useState<FabPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean; pointerId: number } | null>(null);
  const skipClick = useRef(false);
  const posRef = useRef<FabPos | null>(null);
  const explorer = useExplorerState();
  const mode = useExperienceMode();
  const simpleRoute = useSimpleRoute();
  const pos = stored ?? auto ?? { right: 18, bottom: 18 };
  posRef.current = pos;

  useEffect(() => {
    const on = (): void => setShowTop(window.scrollY > 240);
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);

  /** 找「最靠右下又谁都不压」的位置：从右下角起步，撞上谁就往上让，实在挤再往左挪。 */
  const compute = useCallback((): FabPos => {
    const btn = fabRef.current;
    const w = btn?.offsetWidth || 40;
    const h = btn?.offsetHeight || 40;
    const vw = fabViewportWidth();
    const vh = window.innerHeight;
    const margin = 14;
    const obstacles = Array.from(document.querySelectorAll<HTMLElement>(FAB_OBSTACLES))
      .filter((el) => el !== btn && !el.contains(btn) && !btn?.contains(el))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 1 && r.height > 1 && r.bottom > vh * 0.5 && r.right > vw * 0.4);
    let right = margin;
    let bottom = margin;
    for (let i = 0; i < 12; i++) {
      const box = { left: vw - right - w, right: vw - right, top: vh - bottom - h, bottom: vh - bottom };
      const hit = obstacles.find((r) => !(r.right <= box.left || r.left >= box.right || r.bottom <= box.top || r.top >= box.bottom));
      if (!hit) break;
      const above = vh - hit.top + 8;
      if (above + h > vh * 0.7) { right += w + 10; bottom = margin; }
      else bottom = above;
      if (right > vw * 0.7) break;
    }
    return { right, bottom };
  }, []);

  /* 没手动摆过就自动找位：首帧、布局稳定后、窗口变化、切换标签页（浮件随之增减）都重找。 */
  useEffect(() => {
    if (stored) return;
    const place = (): void => { if (!dragRef.current) setAuto(compute()); };
    place();
    const timers = [200, 700, 1600].map((ms) => window.setTimeout(place, ms));
    window.addEventListener("resize", place);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", place);
    };
  }, [stored, compute, explorer.activeId, mode, simpleRoute.page, showTop]);

  /* 手动摆过之后，窗口变小/旋转也要留在屏幕里。 */
  useEffect(() => {
    if (!stored) return;
    const clamp = (): void => {
      const btn = fabRef.current;
      const w = btn?.offsetWidth || 40;
      const h = btn?.offsetHeight || 40;
      setStored((p) => {
        if (!p) return p;
        const next = {
          right: Math.max(4, Math.min(p.right, fabViewportWidth() - w - 4)),
          bottom: Math.max(4, Math.min(p.bottom, window.innerHeight - h - 4)),
        };
        if (next.right === p.right && next.bottom === p.bottom) return p;
        try { localStorage.setItem(REFRESH_POS_KEY, JSON.stringify(next)); } catch { /* memory still updates */ }
        return next;
      });
    };
    clamp(); // A position from another window size must be visible on the first mount too.
    const observer = new ResizeObserver(clamp);
    if (fabRef.current) observer.observe(fabRef.current);
    observer.observe(document.documentElement);
    window.addEventListener("resize", clamp);
    return () => { observer.disconnect(); window.removeEventListener("resize", clamp); };
  }, [stored]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    skipClick.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false, pointerId: e.pointerId };
    // Capture keeps fast movements outside this small button attached to it.
    // Until the drag threshold is crossed, leave its position and click alone.
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < (e.pointerType === "touch" ? 12 : 10)) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    }
    const btn = fabRef.current;
    const w = btn?.offsetWidth || 40;
    const h = btn?.offsetHeight || 40;
    const next = {
      right: Math.max(4, Math.min(d.right - dx, fabViewportWidth() - w - 4)),
      bottom: Math.max(4, Math.min(d.bottom - dy, window.innerHeight - h - 4)),
    };
    posRef.current = next;
    setStored(next);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) return;
    skipClick.current = true;
    try { localStorage.setItem(REFRESH_POS_KEY, JSON.stringify(posRef.current ?? pos)); } catch { /* 存不下就只记内存 */ }
  };
  const fabStyle = {
    "--refresh-fab-right": `${pos.right}px`,
    "--refresh-fab-bottom": `${pos.bottom}px`,
  } as CSSProperties;
  const fabH = fabRef.current?.offsetHeight || 40;
  const topStyle = {
    "--refresh-fab-right": `${pos.right}px`,
    "--refresh-fab-bottom": `${pos.bottom + fabH + 8}px`,
  } as CSSProperties;
  return (
    <>
      {showTop ? (
        <button
          className="hard-refresh-fab top-fab"
          style={topStyle}
          title={i18n("components.layout.61156d427af0")}
          aria-label={i18n("components.layout.61156d427af0")}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <IconArrowUp width={18} height={18} />
        </button>
      ) : null}
      <button
        ref={fabRef}
        className={"hard-refresh-fab" + (dragging ? " is-dragging" : "")}
        style={fabStyle}
        title={i18n("components.layout.7a007b29bf56")}
        aria-label={i18n("components.layout.f9e31e1d63d5")}
        onClick={(e) => {
          if (skipClick.current && e.detail !== 0) { skipClick.current = false; return; }
          skipClick.current = false;
          window.location.reload();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <IconRefresh width={18} height={18} />
      </button>
    </>
  );
}

export function PageHead({
  title,
  meta,
  actions,
  menu,
}: {
  /** 页标题；收藏夹重命名等场景可传受控输入（ReactNode） */
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 页面级操作（白板的「添加组件 / 套用模板 / 编辑」等）：手机上收进顶栏「···」菜单。
   *  与 actions 的分工是「页面级操作 vs 工具栏」。 */
  menu?: PageMenuItem[];
}) {
  const uiLocale = useUiLocale();

  /* 把菜单同步给顶栏。**本 PageHead 的稳定 token**：页切换期间可能同时存在两代 PageHead，
     卸载时只允许清掉自己写进去的那份（见 pageChrome.clearPageChrome）。 */
  const chromeToken = useRef<object>({});
  const headRef = useRef<HTMLDivElement | null>(null);
  /* 预览里的「页面」不算页面：添加组件抽屉用真实卡体当预览，像搜索页这类卡体自带 PageHead，
     会把抽屉里的空菜单写进全局 chrome、收起时再清空 → 顶栏「···」消失（霖 2026-10-11 现场）。
     这里把「自己是不是在预览里」记在 ref 上，同步与清理两处都据此跳过。 */
  const inPreviewRef = useRef(false);
  useEffect(() => {
    const el = headRef.current;
    inPreviewRef.current = !!el && !!el.closest(".add-preview-box, .widget-size-box, .add-drawer");
    if (inPreviewRef.current) return;
    syncPageChrome({ back: null, menu: menu ?? [] }, chromeToken.current);
    /* 故意不带依赖数组：每次渲染都同步 live（onSelect 闭包要最新一次渲染的）。 */
  });
  useEffect(() => () => {
    if (inPreviewRef.current) return;
    clearPageChrome(chromeToken.current);
  }, []);
  return (
    <div ref={headRef} className="page-head-host">
      {/* 渲染体走 OneGUI：标题字阶、meta、动作位与其它页面同源（旧 .page-head 的类不再产出） */}
      {title != null || meta != null || actions != null ? <OGPageHead title={title} meta={meta} actions={actions} /> : null}
    </div>
  );
}

/* ══════════ Entry 状态机（薄重导出）：store 本体在 state/explorer.ts 的设置浮层 ══════════
   旧语义映射：entry = "settings"|"plugins"|"oh" 即浮层的三段；goEntry = 打开/切换浮层。
   全库既有调用方（searchRows 落点 / OhSettingsPage / Plugins.tsx）零改动。 */
export type Entry = OverlayEntry;

export function goEntry(next: Entry): void {
  openSettings(next);
}
export function entrySnapshot(): Entry {
  return overlaySnapshot() ?? "plugins";
}
export function subscribeEntry(f: () => void): () => void {
  return subscribeOverlay(f);
}
/** 组件里读当前入口态（只在浮层挂载的页面里用；关闭时兜底 "plugins" 与旧默认一致） */
export function useEntry(): Entry {
  return useOverlayEntry() ?? "plugins";
}

/** 设置浮层内用的关闭（✕ / Esc） */
export { closeSettings };

/** 行级直达用的稳定 id：`row-<slug>`（对设置行）/ `sec-<slug>`（对分节）。 */
export function slugOf(text: string): string {
  const t = text.trim().replace(/\s+/g, "-").replace(/[「」（）()·:：,，.。/]/g, "").slice(0, 24);
  return t || "item";
}

/** Copy explicit source anchors only. Labels can change without changing IDs. */
export function markSettingsRows(): void {
  document.querySelectorAll<HTMLElement>("[id^=row-], [id^=sec-]").forEach(node => {
    if (!node.dataset.setId) node.dataset.setId = node.id;
  });
}

/** Stable row/section IDs first. Legacy title requests remain compatible, but never mint IDs. */
export function focusSettingsTarget(target: string, root: ParentNode = document): boolean {
  const want = target.trim();
  if (!want) return false;
  const row = allSearchRows().find(item => item.id === want || item.title === want || item.breadcrumb?.at(-1) === want);
  const ids = new Set([want, `row-${want}`, `sec-${want}`, `row-${slugOf(want)}`, `sec-${slugOf(want)}`]);
  if (row) ids.add(`row-${row.id}`);
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-set-id], [id]"));
  const rendered = (node: HTMLElement): HTMLElement => getComputedStyle(node).display === "contents"
    ? Array.from(node.querySelectorAll<HTMLElement>("*")).find(child => child.getClientRects().length > 0) ?? node : node;
  const visible = (node: HTMLElement): boolean => !node.closest("[hidden]") && rendered(node).getClientRects().length > 0;
  let hit = nodes.find(node => visible(node) && (ids.has(node.dataset.setId ?? "") || ids.has(node.id)));
  // Older callers can still request a section ID; the theme lives in Appearance.
  if (!hit) {
    const section = want === "主题" ? "外观" : want;
    hit = Array.from(root.querySelectorAll<HTMLElement>("[data-settings-section]"))
      .find(node => visible(node) && node.dataset.settingsSection === section);
  }
  // Compatibility for external plugin actions that have not adopted an explicit anchor.
  if (!hit && !row) {
    hit = Array.from(root.querySelectorAll<HTMLElement>(".setting-row,.section-head,.og-settings-row,.og-section,button"))
      .find(node => visible(node) && !node.classList.contains("plg-danger") && (node.textContent ?? "").trim() === want);
  }
  if (!hit) return false;
  hit = rendered(hit);
  hit.scrollIntoView({ block: "center", behavior: "smooth" });
  hit.classList.add("row-focus");
  const focused = hit;
  window.setTimeout(() => focused.classList.remove("row-focus"), 1800);
  return true;
}

/** 窄栏判定（**容器实际宽度**驱动）：< threshold 就降级，避免文字挤成竖排糊字。
 *  用 ResizeObserver 实测被包裹容器的宽度；无法测量时按"宽"处理（不误伤大屏）。 */
export function useNarrowBox(threshold = 300): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth > 0 && el.clientWidth < threshold));
    ro.observe(el);
    setNarrow(el.clientWidth > 0 && el.clientWidth < threshold);
    return () => ro.disconnect();
  }, [threshold]);
  return [ref, narrow];
}

/** 1.5 级入口框：设置 | 插件 | OneTHU Harness —— 现挂在设置浮层内部做快速换段。
 *  手机与桌面同款（LevelBox 原样保留，goEntry 直接换浮层段）。 */
export function LevelBox(): ReactNode {
  const uiLocale = useUiLocale();

  const entry = useEntry(); // 高亮**唯一来源**
  const [boxRef, narrow] = useNarrowBox(300);
  /* 窄栏：只渲染图标（title/aria-label 承载全名），**禁止文字换行**；宽栏：文字完整不截断 */
  const cells: Array<{ id: Entry; label: string; icon: ReactNode }> = [
    { id: "profile", label: i18n("components.layout.487e926379fe"), icon: <IconUser /> },
    { id: "settings", label: i18n("components.layout.df3d58c7d84b"), icon: <IconSettings /> },
    { id: "plugins", label: i18n("components.layout.e806fbbe8ec6"), icon: <IconPlug /> },
    { id: "oh", label: "OneTHU Harness", icon: <HarnessMark size={13} /> },
  ];
  const cell = (c: { id: Entry; label: string; icon: ReactNode }): ReactNode => (
    <button
      className={"nav-item" + (entry === c.id ? " is-active" : "")}
      title={c.label}
      aria-label={c.label}
      style={{
        flex: narrow ? "1 1 0" : c.id === "oh" ? "1.5 1 0" : "1 1 0",
        minWidth: 0,
        height: 26,
        justifyContent: "center",
        padding: 0,
        fontSize: narrow ? undefined : "var(--text-xs)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "clip",
      }}
      onClick={() => goEntry(c.id)}
    >
      {narrow ? c.icon : c.label}
    </button>
  );
  return (
    <div
      ref={boxRef}
      style={{
        display: "flex", alignItems: "center", gap: 2, padding: 2, marginBottom: 12,
        border: "1px solid var(--border)", borderRadius: "var(--md-sys-shape-corner-large, 12px)",
        background: "var(--md-sys-color-surface-container-lowest)",
      }}
    >
      {cells.map((c) => cell(c))}
    </div>
  );
}

/**
 * 顶栏右上「···」：开当前页声明的页面级操作菜单（复用长按菜单的宿主与展开动画）。
 *
 * **必须渲染在 ContextMenuLayer 内部**：`useContextMenu()` 只对 Provider 的子节点生效，
 * 放在外层会拿到 NOOP——表现就是「点了没反应」。
 */
function ChromeMore() {
  const uiLocale = useUiLocale();

  const ctx = useContextMenu();
  const chrome = useSyncExternalStore(subscribePageChrome, pageChromeSnapshot, pageChromeSnapshot);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  if (!chrome.hasMenu) return null;
  const openMenu = (): void => {
    const r = moreRef.current?.getBoundingClientRect();
    /* dev 追加一条取景框入口（复制一份数组，别改共享的页面菜单）——
       它是除 Cmd+Shift+P 之外的第二条路：不依赖 ONETHU_DEV 徽标 */
    const items = [...readPageChrome().menu];
    if (import.meta.env.DEV) {
      items.push({
        key: "dev-phone-frame",
        label: i18n("components.layout.56043fcf0aa1"),
        onSelect: () => { window.location.href = window.location.pathname + "?phone-frame=1"; },
      });
    }
    ctx.open({ x: r ? r.right - r.width / 2 : window.innerWidth - 24, y: r ? r.bottom : 48, items });
  };
  return (
    <button
      type="button"
      className="topbar-more"
      ref={moreRef}
      onClick={openMenu}
      aria-label={i18n("components.layout.9f07d2ce4115")}
      aria-haspopup="menu"
    >
      <IconMore width={18} height={18} />
    </button>
  );
}

export function SectionHead({
  id,
  title,
  aside,
}: {
  id?: string;
  title: string;
  aside?: ReactNode;
}) {
  const uiLocale = useUiLocale();

  return <OGSection id={id} title={title} aside={aside} />;
}

export function Card({
  className = "",
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const uiLocale = useUiLocale();

  // 旧约定：className 里带 "list" 表示"内容自己贴边"（行自带内边距）→ 贴边卡
  const flush = /(^|\s)(list|stat-click|course-card)(\s|$)/.test(className);
  const rest = className.replace(/(^|\s)list(\s|$)/g, " ").trim();
  const card = (
    <OGCard flush={flush} className={rest || undefined}>
      {children}
    </OGCard>
  );
  // 旧调用点有的用 style 传宽度等几何：包一层（不把 style 泄漏进库组件）
  return style ? <div style={style}>{card}</div> : card;
}


/**
 * 固定视口列表：卡片高度 = 当前页面从卡片顶部到内容区底部的可用高度。
 * 用实测而不是每页抄一组 `100dvh - Npx`：页头、筛选行、banner、标签栏高度
 * 变化时列表仍恰好铺满一屏，页面本身不滚。滚动发生在卡片内部，
 * 长列表不会生成超大合成层，玻璃模糊/圆角/字色在首帧就是最终状态。
 */
export function ListWindow({
  children,
  className = "",
  reserve = 0,
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  /** 列表下方仍需可见的兄弟内容（如待办页脚注）预留高度 */
  reserve?: number;
  /** 由父级 flex/grid 给出确定高度时启用：不再按视口测量，卡片撑满父级并在内部滚动。 */
  fill?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    if (fill) return;
    const host = hostRef.current;
    if (!host) return;
    const update = (): void => {
      // 页头入场是 header 自己的 transform，不影响列表宿主的布局位置；不要为了测量
      // 去改写 header.style.animation——恢复 animation 会让标题入场从头重播。
      const rect = host.getBoundingClientRect();
      // 页面可能带着上一次滚动位置挂载（课程卡在页面下方 → 详情页首帧不在顶部）。
      // 直接用 viewport top 会把「已经滚掉的距离」当成可用高度，列表于是撑到内容全高。
      // 这里把位置换算成滚动容器内的文档偏移，滚动多少都不影响测量。
      let scroller: HTMLElement | null = null;
      for (let p = host.parentElement; p && p !== document.body; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if ((oy === "auto" || oy === "scroll") && p.clientHeight < p.scrollHeight) { scroller = p; break; }
      }
      const scRect = scroller?.getBoundingClientRect();
      const scrollTop = scroller?.scrollTop ?? (window.scrollY || document.documentElement.scrollTop || 0);
      const top = rect.top - (scRect?.top ?? 0) + scrollTop;
      const viewportH = scroller?.clientHeight ?? window.innerHeight;
      const content = host.closest<HTMLElement>(".explorer-content");
      const pad = content ? Number.parseFloat(getComputedStyle(content).paddingBottom) || 0 : 0;
      // 底栏是浮在内容之上的固定层：不能只减 content padding，否则列表最后几行
      // 会压在「学习/预约/生活/信息/课表」快捷按钮下面。取实际底栏高度。
      // 底部快捷按钮是 .oneshot（.ex-bbar 是顶部工作台栏，不能拿来算底部）。
      const bottomLayers = [".oneshot", ".ex-bbar"]
        .map((sel) => document.querySelector<HTMLElement>(sel)?.getBoundingClientRect())
        .filter((r): r is DOMRect => r !== undefined && r.height > 0 && r.bottom > window.innerHeight * 0.5);
      const barInset = bottomLayers.reduce((max, r) => Math.max(max, window.innerHeight - r.top), 0);
      const safe = Math.max(pad, barInset + 12);
      // 卡片 1px 边框 + 宿主滚动条余量；至少留 120px，极端小窗仍可用。
      const next = Math.max(120, Math.round(viewportH - top - safe - reserve - 4));
      setHeight((prev) => (prev === next ? prev : next));
    };
    update();
    const raf = requestAnimationFrame(update);
    // 字体/异步页头/筛选条落定后再量两次；首次挂载若在布局完成前测，会留下过高的列表。
    const timers = [120, 360].map((ms) => window.setTimeout(update, ms));
    const ro = new ResizeObserver(update);
    ro.observe(host);
    if (host.parentElement) ro.observe(host.parentElement);
    void document.fonts?.ready.then(update).catch(() => undefined);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach((timer) => window.clearTimeout(timer));
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [reserve, fill]);

  return (
    <div ref={hostRef} className={`list-window-host ${fill ? "is-fill" : ""} ${className}`.trim()}>
      <Card className="list list-window">
        <div className="list-window-scroll" data-tx="keep" style={!fill && height ? { height } : undefined}>
          {children}
        </div>
      </Card>
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
  const uiLocale = useUiLocale();

  return <OGEmptyState title={text} icon={icon} hint={hint} action={action} />;
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  const uiLocale = useUiLocale();

  return (
    <OGBanner
      tone="error"
      title={<ErrorLine text={text} />}
      action={onRetry ? <OGBtn variant="ghost" tone="error" size="sm" onClick={onRetry}>{i18n("components.layout.b8784c8dd563")}</OGBtn> : null}
    />
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  const uiLocale = useUiLocale();

  return (
    <OGCard pad="none">
      <OGLoadingBlock rows={rows} />
    </OGCard>
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
  const uiLocale = useUiLocale();

  return <OGSwitch checked={on} onChange={() => onChange(!on)} aria-label={label} />;
}

/* 保留未用引用防 tree-shake 误报：这些图标被 NAV 数据表引用 */
void IconFolder; void IconFolderPlus; void IconInfo; void IconLearn; void IconPen; void IconPlug; void IconSchedule; void IconStar; void IconToday; void IconXk; void IconCard; void IconCalendar; void FolderIcon; void IconExternal; void IconThos; void IconTrace; void IconMail; void IconCloud; void IconBook; void topLevelPage; void NAV_REGISTRY; void IconChevron;
