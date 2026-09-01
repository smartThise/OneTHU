/**
 * 今日（首页）—— 全量卡片化：
 * - 卡片注册表（lib/homeCards.ts）：bespoke 特殊展示卡 + entry 一键入口大卡；
 * - 布局持久化：localStorage onethu.home.layout（列位 main/rail/off + 列内顺序 +
 *   折叠）与 onethu.home.defaults（各卡折叠偏好，重加/恢复默认时回填）；
 * - 统一 CardShell：标题行（标题+说明 + 右侧折叠箭头；编辑模式追加 ↑↓←→/✕），
 *   折叠 = 卡体收起只留标题行（chevron 旋转），展开/收起即时持久化；
 * - 编辑模式：PageHead「编辑」→ shell 显示列内上下移 / 跨栏左右移 / 隐藏（✕；
 *   入口卡与固有 bespoke 卡一视同仁）；「添加卡片」弹层（createPortal+遮罩居中，
 *   NewsTab 订阅弹层同款）把被隐藏的卡片加回所选列末尾；「完成」退出；
 * - 数据 hook 仍集中在 TodayPage（照旧单次取数），bespoke 卡体是纯展示闭包，
 *   原有 JSX 原样搬进注册表 render。
 * 版式参考 thu-info-app 首页信息结构（只取语义；UI 仍用 OneTHU 设计系统）。
 * 两栏 minmax(0,1fr)+312px 沿用；行容器 maxWidth:100% + min-width:0（窄窗口不横向溢出）。
 * 用 useApp().navigate(page, params) 轻路由；信息/生活/预约入口按 LearnNav 子栏
 * 参数契约（infoTab/lifeTab/reserveTab）直达对应分栏。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconCard, IconChevron, IconIn, IconPen, IconRefresh } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import type { LearnNav, Page } from "../state/app.js";
import { useCampusData, useCard, useTodayCalendar, useTodayDeadlines, useTodayNewsFeed, useTodayReservations } from "../state/data.js";
import {
  buildHomeRegistry, loadCollapsedDefaults, loadLayout, resolveLayout,
  saveCollapsedDefaults, saveLayout, type HomeOrientation,
  HOME_CARD_META,
  type HomeCardDef, type HomeCardId, type HomeCol, type HomeLayoutItem,
} from "../lib/homeCards.js";
import { readSubs } from "./info/newsSearch.js";
import { openExternal } from "./info/openExternal.js";
import { parseLearnTime, type Homework, type ScheduleEntry } from "@onethu/core";

/** 轻路由签名（与 AppState.navigate 一致） */
type Nav = (page: Page, params?: LearnNav) => void;

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 本地日期 "YYYY-MM-DD"（与 core getSchedule 的 nq 同口径） */
function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** "HH:mm" */
function hm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 日历天数差（d 的日期 - 今天；0=今天 1=明天），与时刻无关 */
function calDaysUntil(d: Date): number {
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((that - today) / 86400000);
}

/** 截止徽标：按日历天算（当天 23:59 截止显示「今天截止」而非「1 天后」） */
function deadlineChip(h: Homework): { text: string; cls: string } {
  const d = parseLearnTime(h.deadline);
  if (!d) return { text: "未知截止", cls: "chip-gray" };
  if (h.graded) return { text: "已批改", cls: "chip-blue" };
  if (h.submitted) return { text: "已提交", cls: "chip-green" };
  const days = calDaysUntil(d);
  if (d.getTime() < Date.now()) return { text: days === 0 ? "今天已截止" : `逾期 ${-days} 天`, cls: "chip-red" };
  if (days === 0) return { text: "今天截止", cls: "chip-red" };
  if (days === 1) return { text: "明天截止", cls: "chip-amber" };
  if (days <= 3) return { text: `${days} 天后截止`, cls: "chip-amber" };
  return { text: `${days} 天后截止`, cls: "chip-gray" };
}

/** 清华本科小节开始时间（与 Schedule 页一致） */
const SECTION_OF: Record<number, string> = {
  1: "08:00", 2: "08:55", 3: "09:55", 4: "10:50", 5: "11:45",
  6: "13:30", 7: "14:25", 8: "15:20", 9: "16:15", 10: "17:10",
  11: "18:05", 12: "19:20", 13: "20:15", 14: "21:10",
};

/** 整卡可点入口（LearnPage stat-link 同款结构）；disabled 时降透明度且不可点 */
function EntryCard({
  icon, num, label, onClick, disabled = false, dimLabel,
}: {
  icon?: ReactNode;
  num: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  dimLabel?: string;
}) {
  return (
    <Card className="stat-card stat-click">
      <button
        className="stat-link"
        onClick={onClick}
        disabled={disabled}
        style={disabled ? { opacity: 0.55, cursor: "default" } : undefined}
        aria-label={dimLabel ?? label}
        title={disabled ? "数据加载后可用" : undefined}
      >
        {icon}
        <span className="stat-text">
          <span className="stat-num">{num}</span>
          <span className="stat-label">{dimLabel ?? label}</span>
        </span>
        {!disabled ? <IconChevron width={14} height={14} className="row-caret" /> : null}
      </button>
    </Card>
  );
}

/** 行点击通用包装：数据就绪才可点（keydown Enter 同触发，row-click 同款语义） */
function RowClick({
  onClick, disabled = false, children, style,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const handle = disabled ? undefined : onClick;
  return (
    <div
      className="row row-click"
      style={disabled ? { ...style, opacity: 0.55 } : style}
      role={handle ? "button" : undefined}
      tabIndex={handle ? 0 : undefined}
      onClick={handle}
      onKeyDown={handle ? (e) => e.key === "Enter" && handle() : undefined}
    >
      {children}
    </div>
  );
}

/* ══════════ bespoke 卡体（原 TodayPage JSX 原样搬入；SectionHead 由 CardShell 承担） ══════════ */

type CampusDataT = NonNullable<ReturnType<typeof useCampusData>["data"]>;
type ResvListT = NonNullable<ReturnType<typeof useTodayReservations>["list"]>;
type TodayFeedT = NonNullable<ReturnType<typeof useTodayNewsFeed>["data"]>;

/* ---------- 倒计时提醒（thu-info-app 首页同位组件移植） ----------
 * 学校学期重要事项倒计时（选课/退课/推研/考试报名等），数据源 = info 门户
 * deadline 接口（core getDeadlines，djsbt/djskssj/djsjzsj/djsurl，与 thu-info-lib
 * getCrTimetable 同链）。时间窗与 thu-info home activeEvents 同口径：
 * now < 截止 且 now ≥ 开始-14 天；条目 = 名称 + 起止时间 + 未开始/进行中 + 剩余
 * 天数；点击打开事项通知链接（thu-info Linking.openURL(djsurl) 同语义）。 */

/** 起止毫秒值（"YYYY-MM-DD HH:mm" → epoch ms；解析失败 NaN 由调用方过滤） */
function deadlineMs(s: string | undefined): number {
  if (!s) return NaN;
  const t = new Date(s.includes(" ") ? s.replace(" ", "T") : s).getTime();
  return Number.isNaN(t) ? NaN : t;
}

/** 倒计时徽标：未开始=还有 N 天开始（当天=今天开始）；进行中=剩 N 天（当天=今天结束） */
function countdownChip(beginMs: number, endMs: number, now: Date): { text: string; cls: string } {
  if (now.getTime() < beginMs) {
    const days = calDaysUntil(new Date(beginMs));
    if (days <= 0) return { text: "今天开始", cls: "chip-red" };
    if (days <= 7) return { text: `未开始 · ${days} 天后`, cls: "chip-amber" };
    return { text: `未开始 · 还有 ${days} 天`, cls: "chip-gray" };
  }
  const days = Math.ceil((endMs - now.getTime()) / 86400000);
  if (days <= 1) return { text: "今天结束", cls: "chip-red" };
  return { text: `进行中 · 剩 ${days} 天`, cls: "chip-blue" };
}

/** 日程行：校历节点（开学/学期结束）+ 学校重要事项（deadline 接口）合并成
 *  一条时间线，按日期升序；用户指令：倒计时提醒与最近日程合并为一卡，文字不截断。 */
interface AgendaRow {
  key: string; date: Date; title: string; sub: string;
  chipText: string; chipCls: string; barCls?: string;
  onClick?: () => void;
}

/** 日程与提醒卡体（数据为空/未就绪由 TodayPage 决定整卡隐藏） */
function AgendaRows({ rows }: { rows: AgendaRow[] }) {
  return (
    <Card className="list">
      {rows.map((r, i) => (
        <RowClick key={r.key} style={{ animationDelay: `${i * 35}ms` }} onClick={r.onClick}>
          <div className="tl-time">{ymd(r.date).slice(5)}</div>
          <div className="tl-bar" style={r.barCls ? { background: r.barCls } : undefined} />
          <div className="tl-main">
            <div className="tl-title" style={{ whiteSpace: "normal", overflow: "visible", textOverflow: "unset", display: "block" }}>{r.title}</div>
            <div className="tl-sub" style={{ whiteSpace: "normal" }}>{r.sub}</div>
          </div>
          <span className={`chip ${r.chipCls}`}>
            <span className="dot" />
            {r.chipText}
          </span>
          {r.onClick ? <IconChevron className="row-caret" width={14} height={14} /> : null}
        </RowClick>
      ))}
    </Card>
  );
}

/** 未提交作业卡体（首页作业区唯一口径：submitted===false，含已逾期，按截止升序） */
function HomeworkRows({
  loading, rows, courseName, navigate,
}: {
  loading: boolean;
  rows: Homework[];
  courseName: (courseId: string) => string;
  navigate: Nav;
}) {
  if (loading) return <SkeletonRows rows={4} />;
  if (rows.length === 0) {
    return (
      <Card>
        <Empty text="没有未提交的作业，享受今天吧。" />
      </Card>
    );
  }
  return (
    <Card className="list">
      {rows.slice(0, 8).map((h, i) => {
        const chip = deadlineChip(h);
        return (
          <RowClick
            key={`${h.courseId}-${h.id}`}
            style={{ animationDelay: `${i * 35}ms` }}
            onClick={() => navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from: "today" })}
          >
            <div className="row-when">
              <b>{h.deadline.slice(5, 10)}</b>
              <span>{h.deadline.slice(11, 16)} 截止</span>
            </div>
            <div className="row-main">
              <div className="row-title">{h.title}</div>
              <div className="row-sub">{courseName(h.courseId)}</div>
            </div>
            <span className={`chip ${chip.cls}`}>
              <span className="dot" />
              {chip.text}
            </span>
            <IconChevron className="row-caret" width={14} height={14} />
          </RowClick>
        );
      })}
    </Card>
  );
}

/** 最近通知卡体 */
function NoticeRows({ items, navigate }: { items: CampusDataT["notifications"]; navigate: Nav }) {
  return (
    <Card className="list">
      {items.length === 0 ? (
        <Empty text="暂无通知。" />
      ) : (
        items.slice(0, 3).map((n, i) => (
          <RowClick key={i} onClick={() => navigate("learn-notice-detail", { courseId: n.courseId, itemId: n.id, from: "today" })}>
            <div className="tl-time">{n.publishTime.slice(5, 10)}</div>
            <div className="tl-bar" style={{ background: "var(--border-strong)" }} />
            <div className="tl-main">
              <div className="tl-title" style={{ whiteSpace: "normal" }}>{n.title}</div>
              <div className="tl-sub">{n.publisher}</div>
            </div>
            <IconChevron className="row-caret" width={14} height={14} />
          </RowClick>
        ))
      )}
    </Card>
  );
}

/** 今日预约卡体（座位 + 研讨间，按今天聚合；加载中/无预约整卡不渲染） */
function ResvRows({ list, navigate }: { list: ResvListT; navigate: Nav }) {
  return (
    <Card className="list">
      {list.map((r, i) => (
        <RowClick key={r.key} style={{ animationDelay: `${i * 35}ms` }} onClick={() => navigate("reserve")}>
          <div className="tl-time">{hm(r.start)}</div>
          <div className="tl-bar" style={r.kind === "room" ? { background: "var(--green)" } : undefined} />
          <div className="tl-main">
            <div className="tl-title">{r.kind === "room" ? r.place || r.venue : r.venue}</div>
            <div className="tl-sub">
              {(
                r.kind === "seat"
                  ? [r.place ? `座位 ${r.place}` : "", `${hm(r.start)} 签到`, r.note ?? ""]
                  : [r.start && r.end ? `${hm(r.start)}~${hm(r.end)}` : hm(r.start), r.venue, r.note ?? ""]
              )
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <span className="chip chip-gray">{r.kind === "seat" ? "座位" : "研讨间"}</span>
          <IconChevron className="row-caret" width={14} height={14} />
        </RowClick>
      ))}
    </Card>
  );
}

/** 今日课程卡体 */
function ClassRows({ events, navigate }: { events: ScheduleEntry[]; navigate: Nav }) {
  return (
    <Card className="list">
      {events.length === 0 ? (
        <Empty text="今天没有课。" />
      ) : (
        events.map((s, i) => (
          <RowClick key={`${s.date ?? "d"}-${i}-${s.courseName}`} style={{ animationDelay: `${i * 35}ms` }} onClick={() => navigate("schedule")}>
            <div className="tl-time">{s.startTime ?? SECTION_OF[s.startSection ?? 1] ?? "—"}</div>
            <div className="tl-bar" />
            <div className="tl-main">
              <div className="tl-title">{s.courseName}</div>
              <div className="tl-sub">
                {s.location}
                {s.teacher ? ` · ${s.teacher}` : ""}
              </div>
            </div>
            <IconChevron className="row-caret" width={14} height={14} />
          </RowClick>
        ))
      )}
    </Card>
  );
}

/** 订阅新闻卡体（onethu.news.subs 来源优先，回退最新并注明；点击行经
 *  LearnNav.infoNewsId 直达该条新闻详情；失败/无数据整卡隐藏） */
function NewsRows({ feed, navigate }: { feed: TodayFeedT; navigate: Nav }) {
  return (
    <Card className="list">
      {feed.list.map((n, i) => (
        <RowClick
          key={n.xxid || i}
          style={{ animationDelay: `${i * 35}ms` }}
          onClick={() => navigate("info", { infoNewsId: n.xxid })}
        >
          <div className="tl-time">{n.date ? n.date.slice(5, 10) : "—"}</div>
          <div className="tl-bar" style={{ background: "var(--border-strong)" }} />
          <div className="tl-main">
            <div className="tl-title" style={{ whiteSpace: "normal" }}>{n.name}</div>
            <div className="tl-sub">{n.source || "校内通知"}</div>
          </div>
          <IconChevron className="row-caret" width={14} height={14} />
        </RowClick>
      ))}
    </Card>
  );
}

/** 校园卡余额卡体（快捷入口；未加载完成前置灰不可点） */
function CardBalanceBody({ balance, navigate }: { balance: number | null; navigate: Nav }) {
  return (
    <div className="stats" style={{ margin: 0 }}>
      <EntryCard
        icon={<span className="stat-icon amber"><IconCard width={17} height={17} /></span>}
        num={balance != null ? `¥${balance.toFixed(2)}` : "–"}
        label={balance != null ? "校园卡余额" : "校园卡"}
        dimLabel={balance != null ? "校园卡余额" : "校园卡（加载中）"}
        disabled={balance == null}
        onClick={() => navigate("life", { lifeTab: "card" })}
      />
    </div>
  );
}

/* ══════════ CardShell（统一卡片外壳：标题行 + 折叠 + 编辑工具） ══════════ */

/** 已落位卡片（col 必为 main/rail；off 只存在于持久化表里） */
type PlacedCard = { id: HomeCardId; col: HomeCol; collapsed: boolean };

/** 编辑移动方向：up/down=列内移动；main/rail=跨栏移动 */
type MoveDir = "up" | "down" | "main" | "rail";

/** 卡片外壳：标题行（bespoke=标题+说明可点折叠；entry=入口大卡可点进入）
 *  + 右侧 [编辑工具][折叠箭头]。bespoke 卡体返回 null 时整卡不渲染（原隐藏行为）。 */
function HomeCard({
  def, item, index, count, editing, portrait, onOpen, onToggle, onMove, onRemove,
}: {
  def: HomeCardDef;
  item: PlacedCard;
  index: number;
  count: number;
  editing: boolean;
  portrait: boolean;
  onOpen: () => void;
  onToggle: (id: HomeCardId) => void;
  onMove: (id: HomeCardId, dir: MoveDir) => void;
  onRemove: (id: HomeCardId) => void;
}) {
  const body = def.kind === "bespoke" ? (def.render?.() ?? null) : null;
  if (def.kind === "bespoke" && body === null) return null;
  const collapsed = item.collapsed;
  const cls = `home-card${collapsed ? " is-collapsed" : ""}${editing ? " is-editing" : ""}`;
  const Icon = def.icon;

  /* shellFree（今日概览条）：无标题行/折叠钮，卡体即整卡；编辑时才出现工具行 */
  if (def.shellFree && def.kind === "bespoke") {
    return (
      <section className={cls}>
        {editing ? (
          <div className="home-card-head">
            <span className="home-card-title" style={{ cursor: "default" }}>
              <h2>{def.title}</h2>
              {def.aside ? <span className="home-card-aside">{def.aside}</span> : null}
            </span>
            <div className="home-card-tools">
              <button type="button" className="icon-btn tool-up" disabled={index === 0} title="上移" aria-label={`上移${def.title}`} onClick={() => onMove(def.id, "up")}>
                <IconChevron width={13} height={13} />
              </button>
              <button type="button" className="icon-btn tool-down" disabled={index === count - 1} title="下移" aria-label={`下移${def.title}`} onClick={() => onMove(def.id, "down")}>
                <IconChevron width={13} height={13} />
              </button>
              {!portrait ? (
                <>
                <button type="button" className="icon-btn tool-left" disabled={item.col === "main"} title={item.col === "main" ? "已在主栏" : "移到主栏"} aria-label={`把${def.title}移到主栏`} onClick={() => onMove(def.id, "main")}>
                  <IconChevron width={13} height={13} />
                </button>
                <button type="button" className="icon-btn tool-right" disabled={item.col === "rail"} title={item.col === "rail" ? "已在侧栏" : "移到侧栏"} aria-label={`把${def.title}移到侧栏`} onClick={() => onMove(def.id, "rail")}>
                  <IconChevron width={13} height={13} />
                </button>
                </>
              ) : null}
              <button type="button" className="icon-btn tool-x" title="隐藏此卡片（可经「添加卡片」找回）" aria-label={`隐藏${def.title}`} onClick={() => onRemove(def.id)}>
                ✕
              </button>
            </div>
          </div>
        ) : null}
        <div className="home-card-body">{body}</div>
      </section>
    );
  }

  return (
    <section className={cls}>
      <div className="home-card-head">
        {def.kind === "entry" ? (
          <button
            type="button"
            className="home-entry-btn"
            disabled={editing}
            onClick={onOpen}
            aria-label={def.title}
            title={editing ? undefined : `打开「${def.title}」`}
          >
            <span className="home-entry-icon"><Icon width={20} height={20} /></span>
            <span className="home-entry-text">
              <span className="home-entry-name">{def.title}</span>
              {def.hint ? <span className="home-entry-hint">{def.hint}</span> : null}
            </span>
            {!editing ? <IconChevron width={14} height={14} className="row-caret" /> : null}
          </button>
        ) : (
          <button
            type="button"
            className="home-card-title"
            onClick={() => onToggle(def.id)}
            aria-expanded={!collapsed}
            title={collapsed ? "展开" : "折叠"}
          >
            <h2>{def.title}</h2>
            {def.aside ? <span className="home-card-aside">{def.aside}</span> : null}
          </button>
        )}

        {editing ? (
          <div className="home-card-tools">
            <button type="button" className="icon-btn tool-up" disabled={index === 0} title="上移" aria-label={`上移${def.title}`} onClick={() => onMove(def.id, "up")}>
              <IconChevron width={13} height={13} />
            </button>
            <button type="button" className="icon-btn tool-down" disabled={index === count - 1} title="下移" aria-label={`下移${def.title}`} onClick={() => onMove(def.id, "down")}>
              <IconChevron width={13} height={13} />
            </button>
            {!portrait ? (
              <>
              <button type="button" className="icon-btn tool-left" disabled={item.col === "main"} title={item.col === "main" ? "已在主栏" : "移到主栏"} aria-label={`把${def.title}移到主栏`} onClick={() => onMove(def.id, "main")}>
                <IconChevron width={13} height={13} />
              </button>
              <button type="button" className="icon-btn tool-right" disabled={item.col === "rail"} title={item.col === "rail" ? "已在侧栏" : "移到侧栏"} aria-label={`把${def.title}移到侧栏`} onClick={() => onMove(def.id, "rail")}>
                <IconChevron width={13} height={13} />
              </button>
              </>
            ) : null}
            <button
              type="button"
              className="icon-btn tool-x"
              title={def.kind === "entry" ? "隐藏此入口（可经「添加卡片」找回）" : "隐藏此卡片（可经「添加卡片」找回）"}
              aria-label={`隐藏${def.title}`}
              onClick={() => onRemove(def.id)}
            >
              ✕
            </button>
          </div>
        ) : null}

        <button
          type="button"
          className="icon-btn home-card-fold"
          aria-label={collapsed ? `展开${def.title}` : `折叠${def.title}`}
          aria-expanded={!collapsed}
          title={collapsed ? "展开" : "折叠"}
          onClick={() => onToggle(def.id)}
        >
          <IconChevron width={15} height={15} />
        </button>
      </div>
      {def.kind === "bespoke" && !collapsed ? <div className="home-card-body">{body}</div> : null}
    </section>
  );
}

/** 添加卡片弹层：列出全部被隐藏的卡片（入口卡 + 固有内容卡），点击加入所选列末尾
 *  （createPortal 挂 body + 遮罩 flex 视口居中，NewsTab 订阅弹层同款）。 */
function AddCardsModal({
  hidden, portrait, onAdd, onClose,
}: {
  hidden: HomeCardDef[];
  portrait: boolean;
  onAdd: (id: HomeCardId, col: HomeCol) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="home-modal-mask" onClick={onClose}>
      <div className="home-modal" role="dialog" aria-modal="true" aria-label="添加首页卡片" onClick={(e) => e.stopPropagation()}>
        <div className="home-modal-head">
          <h3>添加卡片</h3>
          <button className="btn btn-ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="home-modal-body">
          <div className="home-modal-hint">
            点选「主栏 / 侧栏」把卡片加到该栏末尾；被隐藏的入口卡与固有内容卡（日程/作业/通知等）都可在这里找回。
          </div>
          {hidden.length === 0 ? (
            <Empty text="没有可添加的卡片——所有入口卡都已显示在首页上。" />
          ) : (
            hidden.map((def) => {
              const Icon = def.icon;
              return (
                <div key={def.id} className="home-modal-row">
                  <span className="home-entry-icon"><Icon width={18} height={18} /></span>
                  <div className="home-modal-text">
                    <div className="home-entry-name">{def.title}</div>
                    {def.hint ? <div className="home-entry-hint">{def.hint}</div> : null}
                  </div>
                  {portrait ? (
                    <button className="btn" onClick={() => onAdd(def.id, "main")}>添加</button>
                  ) : (
                    <>
                      <button className="btn" onClick={() => onAdd(def.id, "main")}>主栏</button>
                      <button className="btn" onClick={() => onAdd(def.id, "rail")}>侧栏</button>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ══════════ 页面 ══════════ */

export function TodayPage() {
  const { navigate } = useApp();
  const { data, state, error, reload } = useCampusData();
  // 校园卡余额（快捷入口展示用）：未加载完成前入口置灰不可点
  const card = useCard(1);
  // 今日预约（座位 + 研讨间）：加载中/无预约都不渲染整卡
  const resv = useTodayReservations();
  // 最近日程（校历节点）：取不到数据时整卡隐藏
  const cal = useTodayCalendar();
  // 学校重要事项倒计时（info 门户 deadline 接口；失败静默，据此整卡隐藏）
  const { list: deadlineList, state: dlState } = useTodayDeadlines();
  // 订阅新闻（onethu.news.subs 来源优先，回退最新）：失败时整卡隐藏。
  // Today 页切走即卸载，回来自动重读 localStorage；storage 事件兜底跨标签同步。
  const [subs, setSubs] = useState<string[]>(() => readSubs());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "onethu.news.subs") setSubs(readSubs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const news = useTodayNewsFeed(subs);
  // 倒计时时间窗的稳定「现在」（useMemo 依赖用；页头日期每次渲染取真实 now）
  const stableNow = useMemo(() => new Date(), []);
  const now = new Date();

  /* ---- 朝向（宽>高=横屏）：竖屏/横屏各存一套布局 ---- */
  const [portrait, setPortrait] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)").matches : true,
  );
  const orientation: HomeOrientation = portrait ? "portrait" : "landscape";
  const oriRef = useRef<HomeOrientation>(orientation);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const on = (): void => setPortrait(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  /* ---- 布局持久化状态：首帧即可由注册表元数据对账出完整布局 ---- */
  const [layout, setLayout] = useState<HomeLayoutItem[]>(() => resolveLayout(HOME_CARD_META, loadLayout(oriRef.current)));
  const [foldDefaults, setFoldDefaults] = useState<Partial<Record<HomeCardId, boolean>>>(() => loadCollapsedDefaults());
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // 布局变动即时持久化到「当前朝向」的桶；朝向刚切换时先载入另一套，本次不保存（防串桶）
  useEffect(() => {
    if (orientation !== oriRef.current) {
      oriRef.current = orientation;
      setLayout(resolveLayout(HOME_CARD_META, loadLayout(orientation)));
      return;
    }
    saveLayout(layout, orientation);
  }, [layout, orientation]);
  // 折叠偏好每次变动即时持久化（含首帧：入口卡以 off 入库，完成「已知卡」登记）
  useEffect(() => {
    saveCollapsedDefaults(foldDefaults);
  }, [foldDefaults]);
  /* ---- 布局编辑操作 ---- */
  const toggleCard = (id: HomeCardId) => {
    const cur = layout.find((it) => it.id === id);
    if (!cur) return;
    const collapsed = !cur.collapsed;
    setLayout(layout.map((it) => (it.id === id ? { ...it, collapsed } : it)));
    // 折叠偏好同步记入 defaults：重加/恢复默认时按用户习惯回填
    setFoldDefaults((d) => ({ ...d, [id]: collapsed }));
  };

  const moveCard = (id: HomeCardId, dir: MoveDir) => {
    if (portrait && (dir === "up" || dir === "down")) {
      // 竖屏：无左右栏概念，按展示顺序（主栏→侧栏串成一条）上下移；
      // 跨过主/侧栏边界时继承邻居的栏位（回到横屏后位置自洽）
      setLayout((prev) => {
        const flat = prev.filter((it) => it.col === "main" || it.col === "rail");
        const k = flat.findIndex((it) => it.id === id);
        const nk = dir === "up" ? k - 1 : k + 1;
        if (k < 0 || nk < 0 || nk >= flat.length) return prev;
        const moving = flat[k];
        const neighbor = flat[nk];
        if (!moving || !neighbor) return prev;
        const rest = prev.filter((it) => it.id !== moving.id);
        const nIdx = rest.findIndex((it) => it.id === neighbor.id);
        rest.splice(nIdx, 0, { ...moving, col: neighbor.col });
        return rest;
      });
      return;
    }
    setLayout((prev) => {
      const moving = prev.find((it) => it.id === id);
      if (!moving || (moving.col !== "main" && moving.col !== "rail")) return prev;
      if (dir === "up" || dir === "down") {
        const col = prev.filter((it) => it.col === moving.col);
        const k = col.findIndex((it) => it.id === id);
        const nk = dir === "up" ? k - 1 : k + 1;
        if (k < 0 || nk < 0 || nk >= col.length) return prev;
        const a = col[k];
        const b = col[nk];
        if (!a || !b) return prev;
        return prev.map((it) => (it.id === a.id ? b : it.id === b.id ? a : it));
      }
      if (moving.col === dir) return prev; // 已在目标栏
      // 跨栏：原列同序位插入目标列（clamp 到目标列长）
      const from = prev.filter((it) => it.col === moving.col);
      const to = prev.filter((it) => it.col === dir);
      const k = from.findIndex((it) => it.id === id);
      from.splice(k, 1);
      to.splice(Math.min(k, to.length), 0, { ...moving, col: dir });
      const off = prev.filter((it) => it.col === "off");
      return [...from, ...to, ...off];
    });
  };

  /** 隐藏卡片（col→off；入口卡与固有 bespoke 卡一视同仁，均可经「添加卡片」找回） */
  const removeCard = (id: HomeCardId) => {
    setLayout((prev) => prev.map((it) => (it.id === id ? { ...it, col: "off" as const } : it)));
  };

  /** 把隐藏的卡片加回所选列末尾；竖屏无栏位概念，落到展示序列最末（继承末卡栏位） */
  const addCard = (id: HomeCardId, col: HomeCol) => {
    if (portrait) {
      setLayout((prev) => {
        const flat = prev.filter((it) => it.col === "main" || it.col === "rail");
        const endCol = flat.length > 0 ? flat[flat.length - 1]!.col : "main";
        const rest = prev.filter((it) => it.id !== id);
        return [...rest, { id, col: endCol, collapsed: foldDefaults[id] ?? false }];
      });
      return;
    }
    setLayout((prev) => {
      const rest = prev.filter((it) => it.id !== id);
      return [...rest, { id, col, collapsed: foldDefaults[id] ?? false }];
    });
  };

  /* ---- 数据派生（与原 Today 页同口径） ---- */

  /** 未提交作业（首页作业区唯一口径：submitted===false，含已逾期，按截止升序） */
  const unsubmitted = useMemo(
    () =>
      (data?.homework ?? [])
        .filter((h) => !h.submitted)
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data],
  );

  /** 今天的日程事件：有 date 按 date 精确匹配（数据窗口跨 3 周不会重复），
   *  无 date（demo）退回 dayOfWeek；按开始时间升序 */
  const todayEvents = useMemo<ScheduleEntry[]>(() => {
    const wd = now.getDay() === 0 ? 7 : now.getDay();
    const today = ymd(now);
    return (data?.schedule ?? [])
      .filter((s) => (s.date ? s.date === today : s.dayOfWeek === wd))
      .sort((a, b) => {
        const ta = a.startTime ?? SECTION_OF[a.startSection ?? 1] ?? "99:99";
        const tb = b.startTime ?? SECTION_OF[b.startSection ?? 1] ?? "99:99";
        return ta.localeCompare(tb);
      });
  }, [data]);

  /** 三日内截止（今明后三天内、且尚未过期） */
  const dueSoon = useMemo(
    () =>
      unsubmitted.filter((h) => {
        const d = parseLearnTime(h.deadline);
        return d && d.getTime() >= now.getTime() && calDaysUntil(d) <= 2;
      }).length,
    [unsubmitted],
  );

  /** 日程与提醒合并时间线（校历节点 + 重要事项，日期升序取前 6） */
  const agendaRows = useMemo<AgendaRow[]>(() => {
    const calRows: AgendaRow[] =
      cal.state !== "ready"
        ? []
        : (cal.nodes ?? []).slice(0, 6).map((n) => ({
            key: n.key,
            date: n.date,
            title: n.name,
            sub: `校历 · 星期${WEEKDAYS[n.date.getDay()]}`,
            chipText: n.daysUntil === 0 ? "今天" : `还有 ${n.daysUntil} 天`,
            chipCls: n.daysUntil <= 1 ? "chip-red" : n.daysUntil <= 7 ? "chip-amber" : "chip-gray",
            barCls: n.key.endsWith("-end") ? "var(--amber)" : undefined,
            onClick: () => navigate("schedule"),
          }));
    const dlRows: AgendaRow[] =
      dlState !== "ready"
        ? []
        : (deadlineList ?? [])
            .map((d) => ({ ...d, beginMs: deadlineMs(d.begin), endMs: deadlineMs(d.end) }))
            .filter((d) => Number.isFinite(d.beginMs) && Number.isFinite(d.endMs))
            .filter((d) => stableNow.getTime() < d.endMs && stableNow.getTime() >= d.beginMs - 14 * 86400000)
            .sort((a, b) => a.beginMs - b.beginMs)
            .map((d) => {
              const chip = countdownChip(d.beginMs, d.endMs, stableNow);
              return {
                key: `dl-${d.title}-${d.begin}`,
                date: new Date(d.beginMs),
                title: d.title,
                sub: `重要事项 · ${(d.begin ?? "").slice(5, 16)} ~ ${(d.end ?? "").slice(5, 16)}`,
                chipText: chip.text,
                chipCls: chip.cls,
                barCls: "var(--border-strong)",
                onClick: d.url ? () => void openExternal(d.url!) : undefined,
              } as AgendaRow;
            });
    return [...calRows, ...dlRows].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 6);
  }, [cal.state, cal.nodes, dlState, deadlineList, stableNow, navigate]);

  const dataReady = !(state === "loading" && !data);
  const courseName = (courseId: string) => data?.courses.find((c) => c.id === courseId)?.name ?? "课程";

  /* ---- 注册表：静态元数据 + bespoke 渲染闭包（数据 hook 全在本组件，单次取数） ---- */
  const registry: HomeCardDef[] = buildHomeRegistry({
    "today-overview": {
      render: () => (
        <div className="stats stats-overview">
          <EntryCard
            num={dataReady ? unsubmitted.length : "–"}
            label="未交作业"
            dimLabel="未交作业"
            disabled={!dataReady}
            onClick={() => navigate("learn-assignments")}
          />
          <EntryCard
            num={dataReady ? dueSoon : "–"}
            label="三日内截止"
            dimLabel="三日内截止"
            disabled={!dataReady}
            onClick={() => navigate("learn-assignments")}
          />
          <EntryCard
            num={dataReady ? todayEvents.length : "–"}
            label="今日课程"
            dimLabel="今日课程"
            disabled={!dataReady}
            onClick={() => navigate("schedule")}
          />
        </div>
      ),
    },
    agenda: {
      // 两路都还没就绪 → 整卡不渲染；就绪但都为空 → 也隐藏（首页不留死卡）
      render: () => (agendaRows.length > 0 ? <AgendaRows rows={agendaRows} /> : null),
    },
    homework: {
      render: () => <HomeworkRows loading={!dataReady} rows={unsubmitted} courseName={courseName} navigate={navigate} />,
      aside: dataReady ? `${unsubmitted.length} 条 · 点击查看详情` : "加载中…",
    },
    notices: {
      render: () => <NoticeRows items={data?.notifications ?? []} navigate={navigate} />,
    },
    cardEntry: {
      render: () => <CardBalanceBody balance={card.data?.info.balance ?? null} navigate={navigate} />,
    },
    resv: {
      render: () => (resv.state === "ready" && (resv.list?.length ?? 0) > 0 ? <ResvRows list={resv.list!} navigate={navigate} /> : null),
    },
    classes: {
      render: () => <ClassRows events={todayEvents} navigate={navigate} />,
    },
    news: {
      render: () => (news.state === "ready" && (news.data?.list.length ?? 0) > 0 ? <NewsRows feed={news.data!} navigate={navigate} /> : null),
      aside:
        news.state === "ready" && news.data
          ? news.data.from === "subs"
            ? `已订阅 ${news.data.subCount} 来源 · 最新 ${news.data.list.length} 条`
            : news.data.subCount > 0
              ? "订阅来源暂无新闻，显示最新"
              : "未订阅来源，显示最新"
          : undefined,
    },
  });
  const defById = useMemo(() => new Map(registry.map((d) => [d.id, d])), [registry]);

  /** 列内渲染序列（数组顺序即列内顺序） */
  const mainItems = useMemo(() => layout.filter((it): it is PlacedCard => it.col === "main"), [layout]);
  const railItems = useMemo(() => layout.filter((it): it is PlacedCard => it.col === "rail"), [layout]);
  const hiddenDefs = useMemo(
    () =>
      layout
        .filter((it) => it.col === "off")
        .map((it) => defById.get(it.id))
        .filter((d): d is HomeCardDef => !!d),
    [layout, defById],
  );

  /** 竖屏展示序列：主栏在前、侧栏在后串成一条（与旧布局竖向堆叠顺序一致） */
  const flatItems = useMemo(() => (portrait ? [...mainItems, ...railItems] : mainItems), [portrait, mainItems, railItems]);

  const renderCard = (it: PlacedCard, index: number, list: PlacedCard[]) => {
    const def = defById.get(it.id);
    if (!def) return null;
    return (
      <HomeCard
        key={it.id}
        def={def}
        item={it}
        index={index}
        count={list.length}
        editing={editing}
        portrait={portrait}
        onOpen={() => {
          if (def.entry) navigate(def.entry.page, def.entry.params);
        }}
        onToggle={toggleCard}
        onMove={moveCard}
        onRemove={removeCard}
      />
    );
  };

  return (
    <>
      <PageHead
        title="今日"
        meta={`${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}${data?.user ? ` · ${data.user.name}` : ""}`}
        actions={
          <>
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
            {editing ? (
              <>
                <button className="btn" onClick={() => setAddOpen(true)}>
                  添加卡片
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setEditing(false);
                    setAddOpen(false);
                  }}
                >
                  完成
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setEditing(true)}>
                编辑
              </button>
            )}
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {/* 顶部三块统计已并入「今日概览」卡（today-overview），随卡片系统移动/隐藏 */}
      {portrait ? (
        /* 竖屏：无左右栏，主栏+侧栏串成一条展示序列 */
        <div className="today-grid today-grid-flat" style={{ marginTop: 14 }}>
          <div className="today-col">{flatItems.map((it, i) => renderCard(it, i, flatItems))}</div>
        </div>
      ) : (
        <div className="today-grid" style={{ marginTop: 14 }}>
          <div className="today-col">{mainItems.map((it, i) => renderCard(it, i, mainItems))}</div>
          <div className="today-rail">{railItems.map((it, i) => renderCard(it, i, railItems))}</div>
        </div>
      )}

      {flatItems.length === 0 ? (
        <Card>
          <Empty text="首页暂无卡片——点右上角「编辑」→「添加卡片」挑几张放上来。" />
        </Card>
      ) : null}

      {addOpen && editing ? (
        <AddCardsModal hidden={hiddenDefs} portrait={portrait} onAdd={addCard} onClose={() => setAddOpen(false)} />
      ) : null}
    </>
  );
}
