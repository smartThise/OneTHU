/** 侧栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关） */
import { Children, useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useApp } from "../state/context.js";
import { topLevelPage, type Page } from "../state/app.js";
import { IconDemo, IconInfo, IconLearn, IconSchedule, IconSettings, IconToday, IconXk, IconCard, IconCalendar } from "./Icons.js";

const NAV: Array<{ page: Page; label: string; icon: (p: object) => ReactNode }> = [
  { page: "today", label: "今日", icon: IconToday },
  { page: "learn", label: "网络学堂", icon: IconLearn },
  { page: "schedule", label: "课表", icon: IconSchedule },
  { page: "info", label: "信息", icon: IconInfo },
  { page: "life", label: "生活", icon: IconCard },
  { page: "reserve", label: "预约", icon: IconCalendar },
  { page: "zhjwxk", label: "选课", icon: IconXk },
  { page: "settings", label: "设置", icon: IconSettings },
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
 * SegmentedOverflow：分段选择栏的溢出治理。
 * 无论任何宽度都只显示一行；放不下的栏目收进右端「›」箭头的下拉列表小菜单
 * （菜单项与行内按钮同源，选中态/onClick 完全一致）。
 * 测量原理：隐藏 0×0 sizer 里渲染全部子项取自然宽度，行内只渲染放得下的前 N 个。
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
  const items = Children.toArray(children);
  const rowRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<number>(items.length);
  const [menu, setMenu] = useState(false);

  const measure = useCallback(() => {
    const sizer = sizerRef.current;
    const row = rowRef.current;
    if (!sizer || !row) return;
    if (row.clientWidth < 60) return; // 布局未就绪/被隐藏时不动手，防自反馈死循环
    const kids = [...sizer.children] as HTMLElement[];
    if (kids.length === 0) return;
    const last = kids[kids.length - 1]!;
    if (last.offsetLeft + last.offsetWidth <= row.clientWidth) {
      setShown(items.length);
      return;
    }
    const limit = row.clientWidth - 34; // 右端箭头预留
    let n = 0;
    for (const k of kids) {
      if (k.offsetLeft + k.offsetWidth > limit) break;
      n++;
    }
    setShown(Math.max(n, 1));
  }, [items.length]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (rowRef.current) ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const overflowed = shown < items.length;
  return (
    <div className="segmented seg-ov" role="tablist" aria-label={ariaLabel} style={style} ref={rowRef}>
      {items.slice(0, shown)}
      {overflowed ? (
        <button
          className="seg-more"
          aria-label="更多栏目"
          aria-expanded={menu}
          onClick={() => setMenu((m) => !m)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      ) : null}
      {menu && overflowed ? (
        <>
          <div className="seg-menu-backdrop" onClick={() => setMenu(false)} />
          <div className="seg-menu" role="menu">
            {items.slice(shown).map((c, i) => (
              <div className="seg-menu-item" key={i}>{c}</div>
            ))}
          </div>
        </>
      ) : null}
      <div className="seg-sizer" aria-hidden ref={sizerRef}>
        {children}
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
  const { status, page: rawPage, navigate } = useApp();
  const page = topLevelPage(rawPage);
  const demo = status === "demo";
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandLogo size={16} />
        </div>
        <div className="nav-label">校园</div>
        <nav className="nav" aria-label="主导航">
          {NAV.map(({ page: p, label, icon: Icon }) => (
            <button
              key={p}
              className={"nav-item" + (page === p ? " is-active" : "")}
              onClick={() => navigate(p)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
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
      {/* 移动端：左下角导航按钮 + 左滑抽屉（≤860px 由 CSS 显示） */}
      <button
        className="drawer-fab"
        onClick={() => setNavOpen(true)}
        aria-label="打开导航"
      >
        <BrandLogo size={11} />
        <span>导航</span>
      </button>
      {navOpen ? (
        <>
          <div className="drawer-mask" onClick={() => setNavOpen(false)} />
          <aside className="drawer" aria-label="导航抽屉">
            <div className="drawer-brand">
              <BrandLogo size={15} />
            </div>
            <nav className="nav" aria-label="抽屉导航">
              {NAV.map(({ page: p, label, icon: Icon }) => (
                <button
                  key={p}
                  className={"nav-item" + (page === p ? " is-active" : "")}
                  onClick={() => {
                    setNavOpen(false);
                    navigate(p);
                  }}
                >
                  <Icon />
                  <span>{label}</span>
                </button>
              ))}
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
      <main className="content">{children}</main>
      <HardRefreshButton />
    </div>
  );
}

/** 硬刷新悬浮按钮：固定右下角，所有页面可见（含登录/双因素页）。
 *  生产环境 tauri 资源走自定义协议不进 HTTP 缓存，reload 即全量重载；
 *  移动端没有右键/⌘R，这是页面卡死/白屏后的唯一恢复出口。 */
export function HardRefreshButton() {
  return (
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
  );
}

export function PageHead({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
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
