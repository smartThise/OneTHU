/** 侧栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关） */
import { Children, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useApp } from "../state/context.js";
import { topLevelPage, type Page } from "../state/app.js";
import { IconChevron, IconDemo, IconFolder, IconFolderPlus, IconInfo, IconLearn, IconSchedule, IconSettings, IconToday, IconXk, IconCard, IconCalendar, FolderIcon } from "./Icons.js";
import { useFavs } from "../state/favs.js";

/**
 * 默认一级入口（万物原子化定案）：钉死不可删隐，仅可在侧栏折叠进
 * 「已折叠收藏夹（N）」组；一切功能原子锚定在这些原位页面，用户收藏夹
 * 只是原子的跳转入口层。今日 = 首页恒在最上；设置 = 钉底。
 */
const NAV: Array<{ page: Page; label: string; icon: (p: object) => ReactNode }> = [
  { page: "today", label: "今日", icon: IconToday },
  { page: "learn", label: "网络学堂", icon: IconLearn },
  { page: "schedule", label: "课表", icon: IconSchedule },
  { page: "info", label: "信息", icon: IconInfo },
  { page: "life", label: "生活", icon: IconCard },
  { page: "reserve", label: "预约", icon: IconCalendar },
  { page: "zhjwxk", label: "选课", icon: IconXk },
];

/** (One / THU) 品牌标识：五列网格，括号代码体，One 衬线紧凑撑满与 THU 逐列对齐 */
export function BrandLogo({ size = 14 }: { size?: number }) {
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
  const rowRef = useRef<HTMLDivElement>(null);
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

export function Shell({ children }: { children: ReactNode }) {
  const { status, page: rawPage, navigate, navParams } = useApp();
  const favs = useFavs();
  const page = topLevelPage(rawPage);
  const demo = status === "demo";
  const [navOpen, setNavOpen] = useState(false);
  const [navClosing, setNavClosing] = useState(false);
  /** 「已折叠收藏夹（N）」组展开态（会话态，不持久化） */
  const [foldedOpen, setFoldedOpen] = useState(false);
  const closeNav = useCallback(() => {
    setNavClosing(true);
    window.setTimeout(() => {
      setNavOpen(false);
      setNavClosing(false);
    }, 240);
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
    const foldedDefaults = NAV.filter(({ page: p }) => favs.data.foldedDefaults.includes(p));
    const unfoldedUser = favs.data.order.filter((id) => !favs.data.foldedRoots.includes(id));
    const foldedUser = favs.data.order.filter((id) => favs.data.foldedRoots.includes(id));
    const foldedCount = foldedDefaults.length + foldedUser.length;
    return (
      <>
        {/* 默认一级入口：今日恒在最上（不可折叠），其余可折叠 */}
        {unfoldedDefaults.map(({ page: p, label, icon: Icon }) =>
          navRow("d-" + p, {
            active: page === p,
            label,
            icon: <Icon />,
            onClick: () => {
              onAfter?.();
              navigate(p);
            },
            folded: false,
            onFold: p === "today" ? undefined : () => favs.foldSidebar(p, true),
          }),
        )}
        {/* 用户收藏夹（根层）：跳转入口层 */}
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
              <>
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
              </>
            ) : null}
          </>
        ) : null}
        {/* 设置钉底 */}
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

  /** 移动端顶栏标题：收藏夹页显示收藏夹名 */
  const topbarTitle =
    page === "folder" && navParams?.folderId
      ? favs.data.folders[navParams.folderId]?.title ?? "收藏夹"
      : NAV.find((n) => n.page === page)?.label ?? "OneTHU";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo size={16} />
        </div>
        <div className="nav-label">校园</div>
        <nav className="nav" aria-label="主导航">
          {navContent()}
        </nav>
        <div className="sidebar-foot">
          {demo ? (
            <span className="foot-badge foot-badge-demo">
              <IconDemo width={12} height={12} />
              演示模式
            </span>
          ) : (
            <span className="foot-badge">
              <span className="dot" style={{ background: "var(--green)" }} />
              就绪
            </span>
          )}
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
            <nav className="nav" aria-label="抽屉导航">
              {navContent(() => closeNav())}
            </nav>
            <div className="drawer-foot">
              {demo ? (
                <span className="foot-badge foot-badge-demo">
                  <IconDemo width={12} height={12} />
                  演示模式
                </span>
              ) : (
                <span className="foot-badge">
                  <span className="dot" style={{ background: "var(--green)" }} />
                  就绪
                </span>
              )}
            </div>
          </aside>
        </>
      ) : null}
      <main className="content">
        {/* 移动端顶栏：汉堡菜单 + 品牌标识，桌面隐藏（桌面走侧栏） */}
        <header className="mobile-topbar">
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
      <HardRefreshButton />
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
  // 窄屏顶栏已展示当前页名：与导航名相同的标题不再重复渲染（详情页等子标题不受影响）
  const navLabel = NAV.find((n) => n.page === page)?.label;
  const dupOnTopbar =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 860px)").matches &&
    typeof title === "string" &&
    title === navLabel;
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

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
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
