/** 侧栏 + 内容骨架 + 基础 UI 件（卡片 / 徽标 / 骨架屏 / 开关） */
import type { CSSProperties, ReactNode } from "react";
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

export function Shell({ children }: { children: ReactNode }) {
  const { status, page: rawPage, navigate } = useApp();
  const page = topLevelPage(rawPage);
  const demo = status === "demo";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>一</span>
          <span className="brand-name">OneTHU</span>
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
          <button
            className="hard-refresh"
            title="硬刷新（整页重载，页面卡死/白屏时用）"
            aria-label="硬刷新"
            onClick={() => {
              // 生产环境 tauri 资源走自定义协议不进 HTTP 缓存，reload 即全量重载；
              // 开发环境 HMR 失联后 ⌘R 不可得（移动端无右键/快捷键），这是唯一出口。
              window.location.reload();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
            <span>硬刷新</span>
          </button>
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
      <main className="content">{children}</main>
    </div>
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
