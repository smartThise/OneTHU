/** 侧栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关） */
import { Children, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, useSyncExternalStore } from "react";
import { useThemes } from "../state/theme.js";
import { useApp } from "../state/context.js";
import { topLevelPage, type LearnNav, type Page } from "../state/app.js";
import { useExpanded } from "../state/usePlatformLayout.js";
import { useSidebarCollapsed } from "../state/uiPrefs.js";
import { NAV_REGISTRY } from "../state/navigation.js";
import { DESENSITIZE_BUILD } from "../lib/privacy.js";
import { IconChevron, IconFolder, IconFolderPlus, IconInfo, IconLearn, IconPen, IconPlug, IconSchedule, IconSettings, IconStar, IconToday, IconXk, IconCard, IconCalendar, FolderIcon, IconExternal, IconThos, IconTrace, IconMail, IconCloud, IconBook } from "./Icons.js";
import { useFavs } from "../state/favs.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";
import { showToast } from "../state/toast.js";
import { checkUpdateSilently } from "../lib/update.js";
import { useBottomNavPill, useNavIndicator, useSegPill } from "../lib/motion.js";

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

/** 页面 → 侧栏分区：取自导航注册表；今日/待办是 M1 新 IA，不在注册表里 */
function navCategoryOf(page: Page): string {
  if (page === "today" || page === "tasks") return "总览";
  return NAV_REGISTRY.find((e) => e.page === page)?.category ?? "行政";
}

/**
 * 底部 5 Tab（UI/UX 改造方案 §2.2，M1 beta）：移动端（≤840px，§2.8.1 统一断点）固定底栏。
 * 服务/收藏两个直达页
 * 是本批次新增（pages/ServicesPage、pages/FavsHomePage）；「待办」暂指
 * learn-assignments（全部作业），§2.3-4 升级为独立 tab 页后再换实现。
 * 长尾功能仍走抽屉/服务目录页，底栏只承担 §1.2 的 core 直达。
 */
const BOTTOM_NAV: Array<{ page: Page; label: string; icon: (p: object) => ReactNode; activePages?: Page[] }> = [
  { page: "today", label: "今日", icon: IconToday },
  { page: "tasks", label: "待办", icon: IconPen, activePages: ["tasks", "learn-assignments", "learn-assignment-detail", "learn-ykt-detail"] },
  { page: "services", label: "服务", icon: IconInfo },
  { page: "favs", label: "收藏", icon: IconStar, activePages: ["favs", "folder"] },
  { page: "settings", label: "我的", icon: IconSettings },
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
        const active = item.page === page || item.activePages?.includes(page) === true;
        const Icon = item.icon;
        return (
          <button
            key={item.page}
            className={"bottom-nav-item" + (active ? " is-active" : "")}
            onClick={() => navigate(item.page)}
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

export const NAV: Array<{ page: Page; label: string; icon: (p: object) => ReactNode; activePages?: Page[] }> = [
  { page: "today", label: "今日", icon: IconToday },
  /* 与移动端底栏的桥：底栏那五项不整体搬进侧边栏（太臃肿），只补一个「待办」——
     桌面端此前完全没有待办入口。其余四项侧边栏本来就各有对应（服务→信息/在线服务、
     收藏→收藏夹分组、我的→设置），因此只差这一个。 */
  { page: "tasks", label: "待办", icon: IconPen, activePages: ["tasks", "learn-assignments", "learn-assignment-detail", "learn-ykt-detail"] },
  { page: "learn", label: "网络学堂", icon: IconLearn },
  { page: "schedule", label: "日程", icon: IconSchedule },
  { page: "trace", label: "寻迹", icon: IconTrace },
  { page: "mail", label: "邮箱", icon: IconMail },
  { page: "cloud", label: "云盘", icon: IconCloud },
  { page: "thubook", label: "THUbook", icon: IconBook },
  { page: "info", label: "信息", icon: IconInfo },
  { page: "life", label: "生活", icon: IconCard },
  { page: "reserve", label: "预约", icon: IconCalendar },
  { page: "zhjwxk", label: "选课", icon: IconXk },
  { page: "thos", label: "在线服务", icon: IconThos },
  { page: "otherinfo", label: "其他 Info 应用", icon: IconExternal },
];

/** (One / THU) 品牌标识：五列网格，括号代码体，One 衬线紧凑撑满与 THU 逐列对齐。
 *  主题插件可整体替换（theme.logo 提供 inline SVG 时优先渲染）。 */
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

export function Shell({ children }: { children: ReactNode }) {
  const { page: rawPage, navigate, navParams } = useApp();

  const favs = useFavs();
  const [sbCollapsed, setSbCollapsed] = useSidebarCollapsed(); // PC 侧栏折叠（§2.8.1）
  const pluginNav = usePluginNavEntries();
  const navAll = [...NAV, ...pluginNav];
  const page = topLevelPage(rawPage);
  const [navOpen, setNavOpen] = useState(false);
  const [navClosing, setNavClosing] = useState(false);
  /** 顶栏滚动浮起（local/anim-delight）：滚过 8px 后加阴影，做出"页面在顶栏下滚动"的层次 */
  const [topbarScrolled, setTopbarScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setTopbarScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  /** 「已折叠收藏夹（N）」组展开态（会话态，不持久化） */
  const [foldedOpen, setFoldedOpen] = useState(false);
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
  const navRow = (key: string, opts: { active: boolean; label: string; icon: ReactNode; onClick: () => void; folded?: boolean; onFold?: () => void }) => (
    <div className="nav-row" key={key}>
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
    const unfoldedDefaults = NAV.filter(({ page: p }) => !favs.data.foldedDefaults.includes(p));
    // 分区小标题（§2.8.1）：分组取自导航注册表的 category，新 IA 的今日/待办归「总览」。
    // 只插小标题、不重排类内顺序；未注册的页面兜底进「行政」。
    const navGrouped: Array<
      | { kind: "label"; text: string }
      | { kind: "item"; page: Page; label: string; icon: (p: object) => ReactNode; activePages?: Page[] }
    > = (() => {
      const groups = new Map<string, Array<{ page: Page; label: string; icon: (p: object) => ReactNode; activePages?: Page[] }>>();
      for (const it of unfoldedDefaults) {
        const cat = navCategoryOf(it.page);
        const list = groups.get(cat);
        if (list) list.push(it);
        else groups.set(cat, [it]);
      }
      const out: typeof navGrouped = [];
      for (const cat of NAV_GROUP_ORDER) {
        const list = groups.get(cat);
        if (!list) continue;
        out.push({ kind: "label", text: cat });
        for (const it of list) out.push({ kind: "item", ...it });
      }
      return out;
    })();
    const foldedDefaults = NAV.filter(({ page: p }) => favs.data.foldedDefaults.includes(p));
    const unfoldedUser = favs.data.order.filter((id) => !favs.data.foldedRoots.includes(id));
    const foldedUser = favs.data.order.filter((id) => favs.data.foldedRoots.includes(id));
    const foldedCount = foldedDefaults.length + foldedUser.length;
    return (
      <>
        {/* 默认一级入口（内置）：今日恒在最上（不可折叠），其余可折叠 */}
        {navGrouped.map((row) => {
          if (row.kind === "label") return <div className="nav-label" key={"g-" + row.text}>{row.text}</div>;
          const Icon = row.icon;
          return navRow("d-" + row.page, {
            active: page === row.page || row.activePages?.includes(page) === true,
            label: row.label,
            icon: <Icon />,
            onClick: () => {
              onAfter?.();
              navigate(row.page);
            },
            folded: false,
            onFold: row.page === "today" ? undefined : () => favs.foldSidebar(row.page, true),
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
        {/* 收藏夹分组 */}
        <div className="nav-label">收藏夹</div>
        {/* 用户收藏夹（根层）：跳转入口层；段内限高滚动——收藏夹再多也不把
            「新建收藏夹 / 已折叠收藏夹」推到滚动边缘挤成半截 */}
        <div className="nav-folders-scroll">
          {unfoldedUser.map((id) =>
            navRow("u-" + id, {
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
        {navRow("plugins", {
          active: page === "plugins",
          label: "插件",
          icon: <IconPlug />,
          onClick: () => {
            onAfter?.();
            navigate("plugins");
          },
        })}
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

  /** 移动端顶栏标题：收藏夹页显示收藏夹名 */
  const topbarTitle =
    page === "folder" && navParams?.folderId
      ? favs.data.folders[navParams.folderId]?.title ?? "收藏夹"
      : navAll.find((n) => n.page === page)?.label ?? (page === "plugins" ? "插件" : page === "services" ? "服务" : page === "favs" ? "收藏" : "OneTHU");

  return (
    <div className="shell">
      <aside className={"sidebar" + (sbCollapsed ? " is-collapsed" : "")} aria-label="主导航">
        <div className="brand">
          <BrandLogo size={16} />
        </div>
        <NavBody label="主导航">{navContent()}</NavBody>
        <div className="sidebar-foot">
          <button
            className="sidebar-collapse"
            onClick={() => setSbCollapsed(!sbCollapsed)}
            title={sbCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            aria-label={sbCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            aria-expanded={!sbCollapsed}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 4l-4 4 4 4" />
            </svg>
          </button>
          <span className="foot-badge">
            <span className="dot" style={{ background: DESENSITIZE_BUILD ? "var(--amber)" : "var(--green)" }} />
            {DESENSITIZE_BUILD ? "脱敏演示版" : "就绪"}
          </span>
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
              <span className="foot-badge">
                <span className="dot" style={{ background: DESENSITIZE_BUILD ? "var(--amber)" : "var(--green)" }} />
                {DESENSITIZE_BUILD ? "脱敏演示版" : "就绪"}
              </span>
            </div>
          </aside>
        </>
      ) : null}
      <main className="content">
        {/* 移动端顶栏：汉堡菜单 + 品牌标识，桌面隐藏（桌面走侧栏） */}
        <header className={"mobile-topbar" + (topbarScrolled ? " is-scrolled" : "")}>
          <button className="topbar-menu" onClick={() => setNavOpen(true)} aria-label="打开导航菜单">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="topbar-brand">
            <BrandLogo size={11} />
            <span className="topbar-title">{topbarTitle}</span>
          </div>
        </header>
        {children}
      </main>
      {/* M1 beta：移动端底部 5 Tab（CSS ≤860px 显示） */}
      <BottomNav page={rawPage} navigate={navigate} />
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
export function HardRefreshButton() {
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    const on = () => setShowTop(window.scrollY > 240);
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <>
      {showTop ? (
        <button
          className="hard-refresh-fab top-fab"
          title="回到顶层"
          aria-label="回到顶层"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      ) : null}
      <button
      className="hard-refresh-fab"
      title="硬刷新（整页重载）"
      aria-label="硬刷新"
      onClick={() => window.location.reload()}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
    </>
  );
}

export function PageHead({
  title,
  meta,
  actions,
}: {
  /** 页标题；收藏夹重命名等场景可传受控输入（ReactNode） */
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  const { page } = useApp();
  const pluginNav = usePluginNavEntries();
  // 窄屏顶栏已展示当前页名：与导航名相同的标题不再重复渲染（详情页等子标题不受影响）
  const navLabel = [...NAV, ...pluginNav].find((n) => n.page === page)?.label ?? (page === "plugins" ? "插件" : undefined);
  // 统一断点读取（§2.8.1）：此前各组件自写 matchMedia，改断点必漏
  const expanded = useExpanded();
  const dupOnTopbar = !expanded && typeof title === "string" && title === navLabel;
  return (
    <header className="page-head">
      <div>
        {dupOnTopbar ? null : <h1>{title}</h1>}
        {meta ? <div className="page-head-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-head-actions">{actions}</div> : null}
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
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={`card ${className}`} style={style}>
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
  return (
    <div className="error-note">
      <span>{text}</span>
      {onRetry ? (
        <button className="btn btn-ghost" onClick={onRetry}>
          重试
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
