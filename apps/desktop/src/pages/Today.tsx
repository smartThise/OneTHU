import { useMemo } from "react";
import { Card, Empty, ErrorNote, PageHead, SectionHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconIn, IconPen, IconRefresh } from "../components/Icons.js";
import { useCampusData } from "../state/data.js";
import type { Homework } from "@onethu/core";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function daysUntil(deadline: string): number {
  const d = new Date(deadline.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return 9999;
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

export function TodayPage() {
  const { data, state, error, reload } = useCampusData();
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
        <Card className="stat-card">
          <span className="stat-icon">
            <IconPen width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{state === "loading" && !data ? "–" : pending.filter((h) => !h.submitted).length}</div>
            <div className="stat-label">未交作业</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon amber">
            <IconBell width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{dueSoon}</div>
            <div className="stat-label">三日内截止</div>
          </div>
        </Card>
        <Card className="stat-card">
          <span className="stat-icon green">
            <IconIn width={17} height={17} />
          </span>
          <div>
            <div className="stat-num">{todayCourses.length}</div>
            <div className="stat-label">今日课程</div>
          </div>
        </Card>
      </div>

      <div className="today-grid" style={{ marginTop: 14 }}>
        <div>
          <SectionHead title="即将截止" aside="按截止时间排序" />
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
                  <div className="row" key={`${h.courseId}-${h.id}`} style={{ animationDelay: `${i * 35}ms` }}>
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
                  </div>
                );
              })}
            </Card>
          )}
        </div>

        <div className="today-rail">
          <SectionHead title="今日课程" />
          <Card className="list">
            {todayCourses.length === 0 ? (
              <Empty text="今天没有课。" />
            ) : (
              todayCourses.map((s, i) => (
                <div className="tl-item" key={i} style={{ animationDelay: `${i * 35}ms` }}>
                  <div className="tl-time">{SECTION_OF[s.startSection ?? 1] ?? "—"}</div>
                  <div className="tl-bar" />
                  <div className="tl-main">
                    <div className="tl-title">{s.courseName}</div>
                    <div className="tl-sub">
                      {s.location}
                      {s.teacher ? ` · ${s.teacher}` : ""}
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>

          <SectionHead title="最近通知" />
          <Card className="list">
            {(data?.notifications.length ?? 0) === 0 ? (
              <Empty text="暂无通知。" />
            ) : (
              data!.notifications.slice(0, 3).map((n, i) => (
                <div className="tl-item" key={i}>
                  <div className="tl-time">{n.publishTime.slice(5, 10)}</div>
                  <div className="tl-bar" style={{ background: "var(--border-strong)" }} />
                  <div className="tl-main">
                    <div className="tl-title" style={{ whiteSpace: "normal" }}>{n.title}</div>
                    <div className="tl-sub">{n.publisher}</div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
