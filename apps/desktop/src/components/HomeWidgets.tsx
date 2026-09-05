/**
 * 今日组件库（万物原子化）：今日页 bespoke 卡的「纯展示体」+「自持组件」双形态。
 * - 纯展示体（AgendaRows/HomeworkRows/…）：数据由调用方传入，TodayPage 照旧
 *   页内单次取数后注入（行为零变化）；
 * - 自持组件（*Widget）：内部自取数据（SWR 缓存共享，多挂载不重复打请求），
 *   可挂进任意用户收藏夹瀑布流；数据为空/未就绪时按今日同口径整卡隐藏（返回 null）。
 * 万物原子化定案：这些组件是「组件原子」，收藏夹里点标题跳回原位功能页。
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Card, Empty, SkeletonRows } from "../components/Layout.js";
import { IconCard, IconChevron } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import type { LearnNav, Page } from "../state/app.js";
import { useCampusData, useCard, useTodayCalendar, useTodayDeadlines, useTodayNewsFeed, useTodayReservations } from "../state/data.js";
import { readSubs } from "../pages/info/newsSearch.js";
import { openExternal } from "../pages/info/openExternal.js";
import { parseLearnTime, type Homework, type ScheduleEntry } from "@onethu/core";

/** 轻路由签名（与 AppState.navigate 一致） */
export type Nav = (page: Page, params?: LearnNav) => void;

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** 本地日期 "YYYY-MM-DD"（与 core getSchedule 的 nq 同口径） */
export function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

/** "HH:mm" */
export function hm(d: Date): string {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

/** 日历天数差（d 的日期 - 今天；0=今天 1=明天），与时刻无关 */
export function calDaysUntil(d: Date): number {
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((that - today) / 86400000);
}

/** 截止徽标：按日历天算（当天 23:59 截止显示「今天截止」而非「1 天后」） */
export function deadlineChip(h: Homework): { text: string; cls: string } {
  const d = parseLearnTime(h.deadline);
  if (!d) return { text: "未知截止", cls: "chip-gray" };
  if (h.graded) return { text: "已批改", cls: "chip-blue" };
  if (h.submitted) return { text: "已提交", cls: "chip-green" };
  const days = calDaysUntil(d);
  if (d.getTime() < Date.now()) return { text: days === 0 ? "今天已截止" : "逾期 " + -days + " 天", cls: "chip-red" };
  if (days === 0) return { text: "今天截止", cls: "chip-red" };
  if (days === 1) return { text: "明天截止", cls: "chip-amber" };
  if (days <= 3) return { text: days + " 天后截止", cls: "chip-amber" };
  return { text: days + " 天后截止", cls: "chip-gray" };
}

/** 清华本科小节开始时间（与 Schedule 页一致） */
export const SECTION_OF: Record<number, string> = {
  1: "08:00", 2: "08:55", 3: "09:55", 4: "10:50", 5: "11:45",
  6: "13:30", 7: "14:25", 8: "15:20", 9: "16:15", 10: "17:10",
  11: "18:05", 12: "19:20", 13: "20:15", 14: "21:10",
};

/** 整卡可点入口（LearnPage stat-link 同款结构）；disabled 时降透明度且不可点 */
export function EntryCard({
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
export function RowClick({
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

/* ══════════ 纯展示体（数据入参；TodayPage 注入） ══════════ */

type CampusDataT = NonNullable<ReturnType<typeof useCampusData>["data"]>;
type ResvListT = NonNullable<ReturnType<typeof useTodayReservations>["list"]>;
type TodayFeedT = NonNullable<ReturnType<typeof useTodayNewsFeed>["data"]>;

/** 日程行：校历节点 + 学校重要事项合并时间线（文字不截断） */
export interface AgendaRow {
  key: string; date: Date; title: string; sub: string;
  chipText: string; chipCls: string; barCls?: string;
  onClick?: () => void;
}

export function AgendaRows({ rows }: { rows: AgendaRow[] }) {
  return (
    <Card className="list">
      {rows.map((r, i) => (
        <RowClick key={r.key} style={{ animationDelay: i * 35 + "ms" }} onClick={r.onClick}>
          <div className="tl-time">{ymd(r.date).slice(5)}</div>
          <div className="tl-bar" style={r.barCls ? { background: r.barCls } : undefined} />
          <div className="tl-main">
            <div className="tl-title" style={{ whiteSpace: "normal", overflow: "visible", textOverflow: "unset", display: "block" }}>{r.title}</div>
            <div className="tl-sub" style={{ whiteSpace: "normal" }}>{r.sub}</div>
          </div>
          <span className={"chip " + r.chipCls}>
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
export function HomeworkRows({
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
            key={h.courseId + "-" + h.id}
            style={{ animationDelay: i * 35 + "ms" }}
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
            <span className={"chip " + chip.cls}>
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
export function NoticeRows({ items, navigate }: { items: CampusDataT["notifications"]; navigate: Nav }) {
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

/** 今日预约卡体（座位 + 研讨间，按今天聚合） */
export function ResvRows({ list, navigate }: { list: ResvListT; navigate: Nav }) {
  return (
    <Card className="list">
      {list.map((r, i) => (
        <RowClick key={r.key} style={{ animationDelay: i * 35 + "ms" }} onClick={() => navigate("reserve")}>
          <div className="tl-time">{hm(r.start)}</div>
          <div className="tl-bar" style={r.kind === "room" ? { background: "var(--green)" } : undefined} />
          <div className="tl-main">
            <div className="tl-title">{r.kind === "room" ? r.place || r.venue : r.venue}</div>
            <div className="tl-sub">
              {(
                r.kind === "seat"
                  ? [r.place ? "座位 " + r.place : "", hm(r.start) + " 签到", r.note ?? ""]
                  : [r.start && r.end ? hm(r.start) + "~" + hm(r.end) : hm(r.start), r.venue, r.note ?? ""]
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
export function ClassRows({ events, navigate }: { events: ScheduleEntry[]; navigate: Nav }) {
  return (
    <Card className="list">
      {events.length === 0 ? (
        <Empty text="今天没有课。" />
      ) : (
        events.map((s, i) => (
          <RowClick key={(s.date ?? "d") + "-" + i + "-" + s.courseName} style={{ animationDelay: i * 35 + "ms" }} onClick={() => navigate("schedule")}>
            <div className="tl-time">{s.startTime ?? SECTION_OF[s.startSection ?? 1] ?? "—"}</div>
            <div className="tl-bar" />
            <div className="tl-main">
              <div className="tl-title">{s.courseName}</div>
              <div className="tl-sub">
                {s.location}
                {s.teacher ? " · " + s.teacher : ""}
              </div>
            </div>
            <IconChevron className="row-caret" width={14} height={14} />
          </RowClick>
        ))
      )}
    </Card>
  );
}

/** 订阅新闻卡体（订阅来源优先，回退最新；点击行直达该条新闻详情） */
export function NewsRows({ feed, navigate }: { feed: TodayFeedT; navigate: Nav }) {
  return (
    <Card className="list">
      {feed.list.map((n, i) => (
        <RowClick
          key={n.xxid || i}
          style={{ animationDelay: i * 35 + "ms" }}
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
export function CardBalanceBody({ balance, navigate }: { balance: number | null; navigate: Nav }) {
  return (
    <div className="stats" style={{ margin: 0 }}>
      <EntryCard
        icon={<span className="stat-icon amber"><IconCard width={17} height={17} /></span>}
        num={balance != null ? "¥" + balance.toFixed(2) : "–"}
        label={balance != null ? "校园卡余额" : "校园卡"}
        dimLabel={balance != null ? "校园卡余额" : "校园卡（加载中）"}
        disabled={balance == null}
        onClick={() => navigate("life", { lifeTab: "card" })}
      />
    </div>
  );
}

/* ══════════ 自持组件（内部取数；可挂任意收藏夹） ══════════ */

/** 倒计时提醒时间窗（与今日页同口径：now < 截止 且 now ≥ 开始-14 天） */
export function deadlineMs(s: string | undefined): number {
  if (!s) return NaN;
  const t = new Date(s.includes(" ") ? s.replace(" ", "T") : s).getTime();
  return Number.isNaN(t) ? NaN : t;
}

export function countdownChip(beginMs: number, endMs: number, now: Date): { text: string; cls: string } {
  if (now.getTime() < beginMs) {
    const days = calDaysUntil(new Date(beginMs));
    if (days <= 0) return { text: "今天开始", cls: "chip-red" };
    if (days <= 7) return { text: "未开始 · " + days + " 天后", cls: "chip-amber" };
    return { text: "未开始 · 还有 " + days + " 天", cls: "chip-gray" };
  }
  const days = Math.ceil((endMs - now.getTime()) / 86400000);
  if (days <= 1) return { text: "今天结束", cls: "chip-red" };
  return { text: "进行中 · 剩 " + days + " 天", cls: "chip-blue" };
}

/** 今日概览条（未交作业 / 三日内截止 / 今日课程） */
export function TodayOverviewWidget() {
  const { navigate } = useApp();
  const { data, state } = useCampusData();
  const now = new Date();
  const dataReady = !(state === "loading" && !data);
  const unsubmitted = useMemo(
    () => (data?.homework ?? []).filter((h) => !h.submitted).sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data],
  );
  const dueSoon = useMemo(
    () =>
      unsubmitted.filter((h) => {
        const d = parseLearnTime(h.deadline);
        return d && d.getTime() >= now.getTime() && calDaysUntil(d) <= 2;
      }).length,
    [unsubmitted],
  );
  const wd = now.getDay() === 0 ? 7 : now.getDay();
  const today = ymd(now);
  const todayEvents = useMemo(
    () =>
      (data?.schedule ?? [])
        .filter((s) => (s.date ? s.date === today : s.dayOfWeek === wd))
        .sort((a, b) => {
          const ta = a.startTime ?? SECTION_OF[a.startSection ?? 1] ?? "99:99";
          const tb = b.startTime ?? SECTION_OF[b.startSection ?? 1] ?? "99:99";
          return ta.localeCompare(tb);
        }),
    [data, today, wd],
  );
  return (
    <div className="stats stats-overview">
      <EntryCard num={dataReady ? unsubmitted.length : "–"} label="未交作业" dimLabel="未交作业" disabled={!dataReady} onClick={() => navigate("learn-assignments")} />
      <EntryCard num={dataReady ? dueSoon : "–"} label="三日内截止" dimLabel="三日内截止" disabled={!dataReady} onClick={() => navigate("learn-assignments")} />
      <EntryCard num={dataReady ? todayEvents.length : "–"} label="今日课程" dimLabel="今日课程" disabled={!dataReady} onClick={() => navigate("schedule")} />
    </div>
  );
}

/** 日程与提醒（校历 + 重要事项倒计时；两路都空 → null 整卡隐藏） */
export function AgendaWidget(): ReactNode {
  const { navigate } = useApp();
  const cal = useTodayCalendar();
  const { list: deadlineList, state: dlState } = useTodayDeadlines();
  const stableNow = useMemo(() => new Date(), []);
  const rows = useMemo<AgendaRow[]>(() => {
    const calRows: AgendaRow[] =
      cal.state !== "ready"
        ? []
        : (cal.nodes ?? []).slice(0, 6).map((n) => ({
            key: n.key,
            date: n.date,
            title: n.name,
            sub: "校历 · 星期" + WEEKDAYS[n.date.getDay()],
            chipText: n.daysUntil === 0 ? "今天" : "还有 " + n.daysUntil + " 天",
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
                key: "dl-" + d.title + "-" + d.begin,
                date: new Date(d.beginMs),
                title: d.title,
                sub: "重要事项 · " + (d.begin ?? "").slice(5, 16) + " ~ " + (d.end ?? "").slice(5, 16),
                chipText: chip.text,
                chipCls: chip.cls,
                barCls: "var(--border-strong)",
                onClick: d.url ? () => void openExternal(d.url!) : undefined,
              } as AgendaRow;
            });
    return [...calRows, ...dlRows].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 6);
  }, [cal.state, cal.nodes, dlState, deadlineList, stableNow, navigate]);
  if (rows.length === 0) return null;
  return <AgendaRows rows={rows} />;
}

/** 未提交作业（自持取数版） */
export function HomeworkWidget(): ReactNode {
  const { navigate } = useApp();
  const { data, state } = useCampusData();
  const unsubmitted = useMemo(
    () => (data?.homework ?? []).filter((h) => !h.submitted).sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data],
  );
  const courseName = (courseId: string) => data?.courses.find((c) => c.id === courseId)?.name ?? "课程";
  return <HomeworkRows loading={state === "loading" && !data} rows={unsubmitted} courseName={courseName} navigate={navigate} />;
}

/** 最近通知（自持取数版） */
export function RecentNoticesWidget(): ReactNode {
  const { navigate } = useApp();
  const { data } = useCampusData();
  return <NoticeRows items={data?.notifications ?? []} navigate={navigate} />;
}

/** 校园卡余额（自持取数版） */
export function CardBalanceWidget(): ReactNode {
  const { navigate } = useApp();
  const card = useCard(1);
  return <CardBalanceBody balance={card.data?.info.balance ?? null} navigate={navigate} />;
}

/** 今日预约（自持取数版；空/未就绪 → null） */
export function TodayResvWidget(): ReactNode {
  const { navigate } = useApp();
  const resv = useTodayReservations();
  if (resv.state !== "ready" || !resv.list || resv.list.length === 0) return null;
  return <ResvRows list={resv.list} navigate={navigate} />;
}

/** 今日课程（自持取数版） */
export function TodayClassesWidget(): ReactNode {
  const { navigate } = useApp();
  const { data } = useCampusData();
  const now = new Date();
  const wd = now.getDay() === 0 ? 7 : now.getDay();
  const today = ymd(now);
  const events = useMemo<ScheduleEntry[]>(
    () =>
      (data?.schedule ?? [])
        .filter((s) => (s.date ? s.date === today : s.dayOfWeek === wd))
        .sort((a, b) => {
          const ta = a.startTime ?? SECTION_OF[a.startSection ?? 1] ?? "99:99";
          const tb = b.startTime ?? SECTION_OF[b.startSection ?? 1] ?? "99:99";
          return ta.localeCompare(tb);
        }),
    [data, today, wd],
  );
  return <ClassRows events={events} navigate={navigate} />;
}

/** 订阅新闻（自持取数版；订阅读取 + storage 跨窗同步；空 → null） */
export function SubsNewsWidget(): ReactNode {
  const { navigate } = useApp();
  const [subs, setSubs] = useState<string[]>(() => readSubs());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "onethu.news.subs") setSubs(readSubs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const news = useTodayNewsFeed(subs);
  if (news.state !== "ready" || !news.data || news.data.list.length === 0) return null;
  return <NewsRows feed={news.data} navigate={navigate} />;
}
