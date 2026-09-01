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
      <div className="seg-indi" ref={indiRef} aria-hidden>
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
