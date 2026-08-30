/**
 * 今日（首页）—— 版式参考 thu-info-app 首页信息结构（公告→预约→日程→功能，
 * 只取语义；UI 仍用 OneTHU 设计系统）：
 *   左栏：待办（今日日程 + 未交作业截止，各取前 5 按时间排序）→ 未提交作业；
 *   右栏：快捷入口（校园卡余额）→ 今日预约（座位+研讨间，无预约整卡不显示）
 *         → 今日课程 → 最近通知。
 * 全部行容器 maxWidth:100% + min-width:0 + 文本 ellipsis（窄窗口不横向溢出）。
 * 用 useApp().navigate(page, params) 轻路由；数据未加载的入口保持不可点并降透明度。
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconCard, IconChevron, IconIn, IconPen, IconRefresh } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useCampusData, useCard, useTodayReservations } from "../state/data.js";
import { parseLearnTime, type Homework, type ScheduleEntry } from "@onethu/core";

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
  icon: ReactNode;
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

/** 待办条目（日程事件 / 作业截止的统一视图） */
interface TodoItem {
  key: string;
  kind: "event" | "homework";
  at: Date;
  timeText: string;
  title: string;
  sub: string;
  chip: { text: string; cls: string };
  go: () => void;
}

export function TodayPage() {
  const { navigate } = useApp();
  const { data, state, error, reload } = useCampusData();
  // 校园卡余额（快捷入口展示用）：未加载完成前入口置灰不可点
  const card = useCard(1);
  // 今日预约（座位 + 研讨间）：加载中/无预约都不渲染整卡
  const resv = useTodayReservations();
  const now = new Date();

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

  /** 待办卡：日程事件前 5 + 未提交未过期作业前 5，合并按时间排序 */
  const todoItems = useMemo<TodoItem[]>(() => {
    const events: TodoItem[] = todayEvents.slice(0, 5).map((s, i) => {
      const t = s.startTime ?? SECTION_OF[s.startSection ?? 1] ?? "";
      const [hh, mm] = t.split(":").map(Number);
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh || 8, mm || 0);
      const category = s.category && s.category !== "课程" ? s.category : "课程";
      return {
        key: `ev-${i}-${s.courseName}-${t}`,
        kind: "event",
        at,
        timeText: t || "—",
        title: s.courseName,
        sub: [s.location, s.teacher].filter(Boolean).join(" · "),
        chip: { text: category, cls: "chip-blue" },
        go: () => navigate("schedule"),
      };
    });
    const homework: TodoItem[] = unsubmitted
      .map((h) => ({ h, d: parseLearnTime(h.deadline) }))
      .filter((x): x is { h: Homework; d: Date } => !!x.d && x.d.getTime() >= now.getTime())
      .sort((a, b) => a.d.getTime() - b.d.getTime())
      .slice(0, 5)
      .map(({ h, d }) => ({
        key: `hw-${h.courseId}-${h.id}`,
        kind: "homework" as const,
        at: d,
        timeText: hm(d),
        title: h.title,
        sub: data?.courses.find((c) => c.id === h.courseId)?.name ?? "课程",
        chip: deadlineChip(h),
        go: () => navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from: "today" }),
      }));
    return [...events, ...homework].sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [todayEvents, unsubmitted, data]);

  /** 三日内截止（今明后三天内、且尚未过期） */
  const dueSoon = useMemo(
    () =>
      unsubmitted.filter((h) => {
        const d = parseLearnTime(h.deadline);
        return d && d.getTime() >= now.getTime() && calDaysUntil(d) <= 2;
      }).length,
    [unsubmitted],
  );

  const dataReady = !(state === "loading" && !data);
  const courseName = (courseId: string) => data?.courses.find((c) => c.id === courseId)?.name ?? "课程";

  return (
    <>
      <PageHead
        title="今日"
        meta={`${now.getMonth() + 1}月${now.getDate()}日 星期${WEEKDAYS[now.getDay()]}${data?.user ? ` · ${data.user.name}` : ""}`}
        actions={
          <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
            <IconRefresh width={14} height={14} />
            刷新
          </button>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <div className="stats">
        <EntryCard
          icon={<span className="stat-icon"><IconPen width={17} height={17} /></span>}
          num={dataReady ? unsubmitted.length : "–"}
          label="未交作业"
          dimLabel={dataReady ? "未交作业 · 查看全部" : "未交作业"}
          disabled={!dataReady}
          onClick={() => navigate("learn-assignments")}
        />
        <EntryCard
          icon={<span className="stat-icon amber"><IconBell width={17} height={17} /></span>}
          num={dataReady ? dueSoon : "–"}
          label="三日内截止"
          dimLabel={dataReady ? "三日内截止 · 查看全部" : "三日内截止"}
          disabled={!dataReady}
          onClick={() => navigate("learn-assignments")}
        />
        <EntryCard
          icon={<span className="stat-icon green"><IconIn width={17} height={17} /></span>}
          num={dataReady ? todayEvents.length : "–"}
          label="今日课程"
          dimLabel={dataReady ? "今日课程 · 查看课表" : "今日课程"}
          disabled={!dataReady}
          onClick={() => navigate("schedule")}
        />
      </div>

      <div className="today-grid" style={{ marginTop: 14 }}>
        <div>
          {/* 待办：info app 首页「日程预览」语义 —— 今天/近期日程 + 作业截止 */}
          <SectionHead title="待办" aside="今日日程 + 作业截止 · 点击查看" />
          {state === "loading" && !data ? (
            <SkeletonRows rows={4} />
          ) : (
            <Card className="list">
              {todoItems.length === 0 ? (
                <Empty text="今天没有日程或作业待办。" />
              ) : (
                todoItems.map((t, i) => (
                  <RowClick key={t.key} style={{ animationDelay: `${i * 35}ms` }} onClick={t.go}>
                    <div className="tl-time">{t.timeText}</div>
                    <div className="tl-bar" style={t.kind === "homework" ? { background: "var(--amber)" } : undefined} />
                    <div className="tl-main">
                      <div className="tl-title">{t.title}</div>
                      <div className="tl-sub">{t.sub}</div>
                    </div>
                    <span className={`chip ${t.chip.cls}`}>
                      <span className="dot" />
                      {t.chip.text}
                    </span>
                    <IconChevron className="row-caret" width={14} height={14} />
                  </RowClick>
                ))
              )}
            </Card>
          )}

          {/* 作业区：只显示未提交（已提交的不出现在首页） */}
          <SectionHead title="未提交作业" aside={`${unsubmitted.length} 条 · 点击查看详情`} />
          {state === "loading" && !data ? (
            <SkeletonRows rows={4} />
          ) : unsubmitted.length === 0 ? (
            <Card>
              <Empty text="没有未提交的作业，享受今天吧。" />
            </Card>
          ) : (
            <Card className="list">
              {unsubmitted.slice(0, 8).map((h, i) => {
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
                      <div className="row-sub">
                        {courseName(h.courseId)}
                      </div>
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
          )}
        </div>

        <div className="today-rail">
          {/* 快捷入口：只保留校园卡余额 */}
          <SectionHead title="快捷入口" />
          <div className="stats" style={{ marginTop: 0 }}>
            <EntryCard
              icon={<span className="stat-icon amber"><IconCard width={17} height={17} /></span>}
              num={card.data ? `¥${card.data.info.balance.toFixed(2)}` : "–"}
              label={card.data ? "校园卡余额" : "校园卡"}
              dimLabel={card.data ? "校园卡余额 · 生活页" : "校园卡（加载中）"}
              disabled={!card.data}
              onClick={() => navigate("life")}
            />
          </div>

          {/* 今日预约：座位 + 研讨间，按今天聚合；加载中/无预约整卡不渲染 */}
          {resv.state === "ready" && (resv.list?.length ?? 0) > 0 ? (
            <>
              <SectionHead title="今日预约" aside="座位 · 研讨间 · 点击管理" />
              <Card className="list">
                {(resv.list ?? []).map((r, i) => (
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
            </>
          ) : null}

          <SectionHead title="今日课程" aside="点击打开课表" />
          <Card className="list">
            {todayEvents.length === 0 ? (
              <Empty text="今天没有课。" />
            ) : (
              todayEvents.map((s, i) => (
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

          <SectionHead title="最近通知" aside="点击查看详情" />
          <Card className="list">
            {(data?.notifications.length ?? 0) === 0 ? (
              <Empty text="暂无通知。" />
            ) : (
              data!.notifications.slice(0, 3).map((n, i) => (
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
        </div>
      </div>
    </>
  );
}
