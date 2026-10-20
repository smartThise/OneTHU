import { BrandLogo } from "./BrandLogo.js";
import { t } from "../i18n/index.js";
import { useExperienceMode, useIsSimpleLike, useSimpleRoute } from "../state/experienceMode.js";
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
import { checkUpdateSilently } from "../lib/update.js";
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
import { VaultDropTarget, VaultButton } from "./vault/VaultDropTarget.js";
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
import { t as i18n } from "../i18n/index.js";


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
export const NAV: Array<{ page: Page; label: string; labelKey?: string; icon: (p: object) => ReactNode; activePages?: Page[] }> = [
  // 「今日」那一格已删（用户 2026-10-15 点名）：它就是首页自己（page id 仍叫 today），
  // 目录里再列一遍等于「首页 → 首页」；而且它是程序坞默认球的第一颗
  //（homeSpheres 的 docked = NAV.slice(0,8)）。删掉后老用户持久化的 "home" 球
  // 会被 sanitize 的 NAV 白名单自动过滤掉，不用写迁移。
  { page: "tasks", label: "待办", labelKey: "nav.tasks", icon: IconPen, activePages: ["tasks", "learn-assignments", "learn-assignment-detail", "learn-ykt-detail"] },
  // R30：这一栏现在同时收纳网络学堂与雨课堂的课程，侧栏用中性的「课程」；
  // 「网络学堂」保留为**来源名**（课程卡/作业行上的来源徽标、今日页等处不改）。
  { page: "learn", label: "课程", labelKey: "nav.learn", icon: IconLearn },
  { page: "schedule", label: "日程", labelKey: "nav.schedule", icon: IconSchedule },
  { page: "trace", label: "寻迹", labelKey: "nav.trace", icon: IconTrace },
  { page: "contacts", label: "通讯录", labelKey: "nav.contacts", icon: IconMail },
  { page: "mail", label: "邮箱", labelKey: "nav.mail", icon: IconMail },
  { page: "cloud", label: "云盘", labelKey: "nav.cloud", icon: IconCloud },
  { page: "gitlab", label: "GitLab", labelKey: "nav.gitlab", icon: IconGitLab },
  { page: "thubook", label: "THUBook", labelKey: "nav.thubook", icon: IconBook },
  /* 清小搭（2026-10-15 用户点名「加入一级功能区程序坞」）：一级页，排在 thubook 之后——
     前八颗（程序坞默认球 = NAV.slice(0,8)）一颗不动，它作为第九颗出现在坞上；
     它是 homeSpheres 白名单（known）的一员，否则 sanitize 会把持久化的这颗球吃掉。 */
  { page: "xiaoda", label: "清小搭", labelKey: "nav.xiaoda", icon: IconXiaoda },
  { page: "info", label: "信息", labelKey: "nav.info", icon: IconInfo },
  { page: "life", label: "生活", labelKey: "nav.life", icon: IconCard },
  { page: "reserve", label: "预约", labelKey: "nav.reserve", icon: IconCalendar },
  { page: "zhjwxk", label: "选课", labelKey: "nav.zhjwxk", icon: IconXk },
  { page: "thos", label: "在线服务", labelKey: "nav.thos", icon: IconThos },
  { page: "otherinfo", label: "其他 Info 应用", labelKey: "nav.otherinfo", icon: IconExternal },
];

/**
 * 一级功能区的显示名：带 `labelKey` 的条目走 i18n，插件等运行时条目直接用现成 label。
 * 调用方在渲染期调用，并订阅 `useT()`，切换语言即可原地刷新。
 */
export function navLabel(entry: { label: string; labelKey?: string }): string {
  return entry.labelKey ? t(entry.labelKey) : entry.label;
}

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
  const { activeId } = useExplorerState();
  const canDup = activeId !== HOME_TAB_ID;
  return (
    <div className="ex-rail-actions">
      <IconBtn label={i18n("auto.components.Layout.1")} icon={<IconCopyTab width={16} height={16} />} onClick={() => duplicateTab(activeId)} disabled={!canDup} />
      <IconBtn label={i18n("auto.components.Layout.2")} icon={<IconUser size="sm" />} onClick={() => openSettings("profile")} />
      <button
        className="icon-btn ex-rail-width"
        onClick={onToggleNarrow}
        aria-pressed={narrow}
        aria-label={narrow ? "侧栏：窄（悬停展开）→ 切换为完整" : "侧栏：完整 → 切换为窄（悬停展开）"}
        title={narrow ? "切换为完整显示" : "切换为窄模式（缩略图，悬停展开）"}
      >
        <IconSidebarRail width={16} height={16} />
      </button>
    </div>
  );
}

const RAIL_NARROW_KEY = "ex-rail-narrow";

function TabRail(): ReactNode {
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
    <aside className="ex-rail" aria-label={i18n("auto.components.Layout.3")}>
      <TabStrip />
      <RailActions narrow={narrow} onToggleNarrow={() => setNarrow((v) => !v)} />
    </aside>
  );
}

function TopBar(): ReactNode {
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
      {phone ? (
        /* 手机档（2026-10-16 用户口径）：顶部只留一个**圆形房子钮**回首页——
           横竖都不再有标签条（换标签只走底栏「标签页」抽屉）。此前是 OneTHU monogram 玻璃片。 */
        <button className="ex-tb-home-mark" onClick={() => focusTab(HOME_TAB_ID)} aria-label={i18n("auto.components.Layout.4")} title={i18n("auto.components.Layout.4")}>
          <IconHome width={19} height={19} />
        </button>
      ) : layout === "h" ? (
        <IconBtn label={i18n("auto.components.Layout.1")} icon={<IconCopyTab width={16} height={16} />} onClick={() => duplicateTab(activeId)} disabled={!canDup} />
      ) : null}
      {phone ? <VaultButton /> : null}
      {layout === "h" && !phone ? <TabStrip /> : null}
      <span className="tb-spring" aria-hidden="true" />
      {/* 页面级操作「···」：白板等页面经 pageChrome 声明的菜单在此展开（无菜单时不渲染） */}
      <ChromeMore />
      <IconBtn label={i18n("auto.components.Layout.2")} icon={<IconUser size="sm" />} onClick={() => openSettings("profile")} />
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
  /* 启动：GitHub Releases 静默检查新版本（一次；失败静默，不打扰） */
  useEffect(() => {
    void checkUpdateSilently(showToast);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={"shell explorer-shell" + (simple ? " is-simple" : "")}>
      {/* 全屏档壁纸（最底层；栏体玻璃透出它）+ 亮度档供栏体文字分支 */}
      <ShellWallpaperLayer />
      {/* 长按/右键菜单 Provider + 菜单宿主（PR 55 白板语义并入 explorer shell）：
          Provider 不产生 DOM，布局不变；TopBar 的「···」与页面 useContextMenu 都依赖它 */}
      <ContextMenuLayer>
      {simple ? <SimpleHeader/> : <><TopBar /><TabRail /></>}
      <main className={"content explorer-content" + (simple ? "" : contentCanvasClass)}>{children}</main>
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
      {!simple && <HardRefreshButton />}
      {DevPanel ? (
        <Suspense fallback={null}>
          <DevPanel />
        </Suspense>
      ) : null}
    </div>
  );
}

/** 硬刷新悬浮按钮：一直贴右下角，但**自动避开右下的其他浮层按钮**
 *  （OneShot、日程设置、白板工具栏、暂存箱、回到顶层…），永远落在最靠右下的空位；
 *  按住可拖动（位置按设备记住，存在 onethu.ui.refreshFab.v1）。
 *  生产环境 tauri 资源走自定义协议不进 HTTP 缓存，reload 即全量重载；
 *  移动端没有右键/⌘R，这是页面卡死/白屏后的唯一恢复出口。 */
const REFRESH_POS_KEY = "onethu.ui.refreshFab.v1";
type FabPos = { right: number; bottom: number };
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
  const [showTop, setShowTop] = useState(false);
  const [stored, setStored] = useState<FabPos | null>(readFabPos);
  const [auto, setAuto] = useState<FabPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const fabRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const posRef = useRef<FabPos | null>(null);
  const explorer = useExplorerState();
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
    const vw = window.innerWidth;
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
    const place = (): void => setAuto(compute());
    place();
    const timers = [200, 700, 1600].map((ms) => window.setTimeout(place, ms));
    window.addEventListener("resize", place);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("resize", place);
    };
  }, [stored, compute, explorer.activeId, showTop]);

  /* 手动摆过之后，窗口变小/旋转也要留在屏幕里。 */
  useEffect(() => {
    if (!stored) return;
    const clamp = (): void => {
      const btn = fabRef.current;
      const w = btn?.offsetWidth || 40;
      const h = btn?.offsetHeight || 40;
      setStored((p) => p && (p.right > window.innerWidth - w - 4 || p.bottom > window.innerHeight - h - 4)
        ? { right: Math.max(4, Math.min(p.right, window.innerWidth - w - 4)), bottom: Math.max(4, Math.min(p.bottom, window.innerHeight - h - 4)) }
        : p);
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [stored]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    dragRef.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom, moved: false };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    const btn = fabRef.current;
    const w = btn?.offsetWidth || 40;
    const h = btn?.offsetHeight || 40;
    setStored({
      right: Math.max(4, Math.min(d.right - dx, window.innerWidth - w - 4)),
      bottom: Math.max(4, Math.min(d.bottom - dy, window.innerHeight - h - 4)),
    });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    const d = dragRef.current;
    if (!d) return;
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
          title={i18n("auto.components.Layout.5")}
          aria-label={i18n("auto.components.Layout.5")}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <IconArrowUp width={18} height={18} />
        </button>
      ) : null}
      <button
        ref={fabRef}
        className={"hard-refresh-fab" + (dragging ? " is-dragging" : "")}
        style={fabStyle}
        title={i18n("auto.components.Layout.6")}
        aria-label={i18n("auto.components.Layout.7")}
        onClick={() => {
          if (skipClick.current) { skipClick.current = false; return; }
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
    <div ref={headRef}>
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

/** 给当前 DOM 里的设置行/分节打 id（幂等；路由变化时重跑）。
 *  设置行文字 = 标题 + 说明（搜索按这两个字段匹配，所以 id 也从标题出）。 */
export function markSettingsRows(): void {
  // 两族一起认：OneGUI 渲染 .og-section，未迁移页面还写着 .section-head
  const heads = Array.from(document.querySelectorAll<HTMLElement>(".section-head, .og-section > .og-section-titles, .og-section"));
  heads.forEach((h) => {
    const t = (h.textContent ?? "").trim();
    if (t && !h.dataset.setId) h.dataset.setId = "sec-" + slugOf(t);
  });
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".setting-row, .og-settings-row"));
  rows.forEach((r) => {
    if (r.dataset.setId) return;
    const title = (r.querySelector(".setting-title, .og-settings-row-title")?.textContent ?? "").trim();
    if (title) r.dataset.setId = "row-" + slugOf(title);
  });
}

/** 滚动并高亮某个设置行 / 分节（复用既有请求机制；`.sec-focus` 的分节版已在 Settings.tsx）。
 *  解析顺序 = 行/分节的稳定 id → 行文本 → **动作按钮文本**。 */
export function focusSettingsTarget(target: string): boolean {
  const want = target.trim();
  const slug = slugOf(want);
  const byId = document.querySelector<HTMLElement>(
    `[data-set-id="row-${slug}"],[data-set-id="sec-${slug}"],[id="row-${slug}"],[id="sec-${slug}"]`,
  );
  let hit = byId ?? Array.from(document.querySelectorAll<HTMLElement>(".setting-row,.section-head,.og-settings-row,.og-section"))
    .find((el) => (el.textContent ?? "").includes(want));
  if (!hit) {
    const btn = Array.from(document.querySelectorAll<HTMLElement>(".explorer-settings-body .btn, .explorer-settings-body button"))
      .find((el) => {
        const t = (el.textContent ?? "").trim();
        if (!t || !el.offsetParent || el.classList.contains("plg-danger")) return false;
        return t === want || t.replace(/\s+/g, "") === want.replace(/\s+/g, "");
      });
    if (btn) hit = btn;
  }
  if (!hit) return false;
  hit.scrollIntoView({ block: "center", behavior: "smooth" });
  hit.classList.add("row-focus");
  window.setTimeout(() => hit?.classList.remove("row-focus"), 1800);
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
  const entry = useEntry(); // 高亮**唯一来源**
  const [boxRef, narrow] = useNarrowBox(300);
  /* 窄栏：只渲染图标（title/aria-label 承载全名），**禁止文字换行**；宽栏：文字完整不截断 */
  const cells: Array<{ id: Entry; label: string; icon: ReactNode }> = [
    { id: "profile", label: i18n("auto.components.Layout.p1"), icon: <IconUser /> },
    { id: "settings", label: i18n("auto.components.Layout.p2"), icon: <IconSettings /> },
    { id: "plugins", label: i18n("auto.components.Layout.p3"), icon: <IconPlug /> },
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
        label: i18n("auto.components.Layout.p4"),
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
      aria-label={i18n("auto.components.Layout.8")}
      aria-haspopup="menu"
    >
      <IconMore width={18} height={18} />
    </button>
  );
}

export function SectionHead({
  title,
  aside,
  group,
}: {
  title: string;
  aside?: ReactNode;
  /**
   * 稳定的分节归属（= 设置页签 key）。设置页按它显隐分节，**不能按标题文字匹配**：
   * 标题一旦走 i18n，切到英文就再也对不上页签，整页分节会失灵。
   */
  group?: string;
}) {
  return <OGSection title={title} aside={aside} scope={group ? "settings-group:" + group : undefined} />;
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
  return <OGEmptyState title={text} icon={icon} hint={hint} action={action} />;
}

export function ErrorNote({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <OGBanner
      tone="error"
      title={<ErrorLine text={text} />}
      action={onRetry ? <OGBtn variant="ghost" tone="error" size="sm" onClick={onRetry}>{i18n("auto.components.Layout.9")}</OGBtn> : null}
    />
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
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
  return <OGSwitch checked={on} onChange={() => onChange(!on)} aria-label={label} />;
}

/* 保留未用引用防 tree-shake 误报：这些图标被 NAV 数据表引用 */
void IconFolder; void IconFolderPlus; void IconInfo; void IconLearn; void IconPen; void IconPlug; void IconSchedule; void IconStar; void IconToday; void IconXk; void IconCard; void IconCalendar; void FolderIcon; void IconExternal; void IconThos; void IconTrace; void IconMail; void IconCloud; void IconBook; void topLevelPage; void NAV_REGISTRY; void IconChevron;
