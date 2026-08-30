/**
 * 今日（首页）：待办/课表/通知全部接到真实页面 —— 用 useApp().navigate(page, params) 轻路由。
 * 数据未加载的入口保持不可点并降透明度（不让"看起来可点"的摆设误导）。
 */
import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconCalendar, IconCard, IconChevron, IconIn, IconPen, IconRefresh, IconSchedule } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useCampusData, useCard } from "../state/data.js";
import { parseLearnTime, type Homework } from "@onethu/core";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function daysUntil(deadline: string): number {
  const d = parseLearnTime(deadline);
  if (!d) return 9999;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function deadlineChip(h: Homework) {
  const days = daysUntil(h.deadline);
  if (h.graded) return { text: "已批改", cls: "chip-blue" };
  if (h.submitted) return { text: "已提交", cls: "chip-green" };
  if (days <= 0) return { text: days === 0 ? "今天截止" : `逾期 ${-days} 天`, cls: "chip-red" };
  if (days === 1) return { text: "明天截止", cls: "chip-amber" };
  if (days <= 3) return { text: `${days} 天后`, cls: "chip-amber" };
  return { text: `${days} 天后`, cls: "chip-gray" };
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

export function TodayPage() {
  const { navigate } = useApp();
  const { data, state, error, reload } = useCampusData();
  // 校园卡余额（快捷入口展示用）：未加载完成前入口置灰不可点
  const card = useCard(1);
  const now = new Date();

  const pending = useMemo(
    () =>
      (data?.homework ?? [])
        .filter((h) => !h.submitted || !h.graded)
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data],
  );

  const todayCourses = useMemo(() => {
    const wd = now.getDay() === 0 ? 7 : now.getDay();
    return (data?.schedule ?? [])
      .filter((s) => s.dayOfWeek === wd)
      .sort((a, b) => (a.startSection ?? 9) - (b.startSection ?? 9));
  }, [data, now]);

  const overdue = pending.filter((h) => !h.submitted && daysUntil(h.deadline) <= 0).length;
  const dueSoon = pending.filter((h) => !h.submitted && daysUntil(h.deadline) > 0 && daysUntil(h.deadline) <= 3).length;

  const dataReady = !(state === "loading" && !data);
  const goAssignment = (h: Homework) => navigate("learn-assignment-detail", { courseId: h.courseId, itemId: h.id, from: "today" });
  const goNotice = (courseId: string, itemId: string) => navigate("learn-notice-detail", { courseId, itemId, from: "today" });

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
          num={dataReady ? pending.filter((h) => !h.submitted).length : "–"}
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
          num={dataReady ? todayCourses.length : "–"}
          label="今日课程"
          dimLabel={dataReady ? "今日课程 · 查看课表" : "今日课程"}
          disabled={!dataReady}
          onClick={() => navigate("schedule")}
        />
      </div>

      <div className="today-grid" style={{ marginTop: 14 }}>
        <div>
          <SectionHead title="即将截止" aside="点击查看作业详情" />
          {state === "loading" && !data ? (
            <SkeletonRows rows={4} />
          ) : pending.length === 0 ? (
            <Card>
              <Empty text="没有待办作业，享受今天吧。" />
            </Card>
          ) : (
            <Card className="list">
              {pending.slice(0, 8).map((h, i) => {
                const chip = deadlineChip(h);
                const course = data?.courses.find((c) => c.id === h.courseId);
                return (
                  <RowClick key={`${h.courseId}-${h.id}`} style={{ animationDelay: `${i * 35}ms` }} onClick={() => goAssignment(h)}>
                    <div className="row-when">
                      <b>{h.deadline.slice(5, 10)}</b>
                      <span>{h.deadline.slice(11, 16)} 截止</span>
                    </div>
                    <div className="row-main">
                      <div className="row-title">{h.title}</div>
                      <div className="row-sub">
                        {course?.name ?? "课程"}
                        {course?.teacherName ? ` · ${course.teacherName}` : ""}
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
          <SectionHead title="快捷入口" />
          <div className="stats" style={{ marginTop: 0 }}>
            <EntryCard
              icon={<span className="stat-icon"><IconSchedule width={17} height={17} /></span>}
              num="课表"
              label="周课表"
              onClick={() => navigate("schedule")}
            />
            <EntryCard
              icon={<span className="stat-icon amber"><IconCard width={17} height={17} /></span>}
              num={card.data ? `¥${card.data.info.balance.toFixed(2)}` : "–"}
              label={card.data ? "校园卡余额" : "校园卡"}
              dimLabel={card.data ? "校园卡余额 · 生活页" : "校园卡（加载中）"}
              disabled={!card.data}
              onClick={() => navigate("life")}
            />
            <EntryCard
              icon={<span className="stat-icon green"><IconCalendar width={17} height={17} /></span>}
              num="图书馆"
              label="座位预约"
              onClick={() => navigate("reserve")}
            />
            <EntryCard
              icon={<span className="stat-icon"><IconIn width={17} height={17} /></span>}
              num="电费"
              label="宿舍服务"
              onClick={() => navigate("life")}
            />
          </div>

          <SectionHead title="今日课程" aside="点击打开课表" />
          <Card className="list">
            {todayCourses.length === 0 ? (
              <Empty text="今天没有课。" />
            ) : (
              todayCourses.map((s, i) => (
                <RowClick key={i} style={{ animationDelay: `${i * 35}ms` }} onClick={() => navigate("schedule")}>
                  <div className="tl-time">{SECTION_OF[s.startSection ?? 1] ?? "—"}</div>
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
                <RowClick key={i} onClick={() => goNotice(n.courseId, n.id)}>
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
