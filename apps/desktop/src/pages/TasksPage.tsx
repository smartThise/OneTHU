/**
 * 待办聚合页（UI/UX 改造方案 §2.2 M1 beta，底栏「待办」直达）。
 * - 定位：全 campus「今天该管的事」——作业只是其中一节，另聚合今日预约、
 *   近期考试、余额提醒、最新课程通知；与今日页（用户自定义卡）分工互补；
 * - 空节整节隐藏（不留「作业（0）」这类空节）；全部为空给行动出口空态；
 * - 数据全部复用既有 hook（campus 包 / 外部作业源 / 忽略逻辑同今日页口径），
 *   本页零新取数层；点击去向 = 各功能原位页。
 */
import { useMemo, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { IconChevron } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useCampusData, useCard, useExams, useTodayReservations } from "../state/data.js";
import { toHomework, useExternalHomework } from "../state/exthw.js";
import { useIgnoredHw } from "../state/hwIgnore.js";
import { ymd } from "../components/HomeWidgets.js";

/** 节头：名称 + 计数徽标 + 可选「更多」入口 */
function SectionHead({ title, count, moreLabel, onMore }: { title: string; count: number; moreLabel?: string; onMore?: () => void }): ReactNode {
  return (
    <div className="task-sec-head">
      <span className="task-sec-title">{title}</span>
      {count > 0 ? <span className="task-sec-count">{count}</span> : null}
      {onMore ? (
        <button className="task-sec-more" onClick={onMore}>
          {moreLabel ?? "更多"}
          <IconChevron width={12} height={12} />
        </button>
      ) : null}
    </div>
  );
}

export function TasksPage(): ReactNode {
  const { navigate } = useApp();
  const { data, state } = useCampusData();
  const card = useCard(1);
  const resv = useTodayReservations();
  const exams = useExams();
  const ext = useExternalHomework();
  const ignored = useIgnoredHw();

  const extHw = useMemo(() => ext.items.map(toHomework), [ext.items]);
  const unsubmitted = useMemo(
    () =>
      [...(data?.homework ?? []), ...extHw]
        .filter((h) => !h.submitted && !ignored.has(h.id))
        .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data, extHw, ignored],
  );

  const today = ymd(new Date());
  const soon = useMemo(() => {
    const t = new Date(); t.setDate(t.getDate() + 14);
    const limit = ymd(t);
    return (exams.data ?? [])
      .filter((e) => e.date >= today && e.date <= limit)
      .sort((a, b) => (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? "")));
  }, [exams.data, today]);

  const cardLow = (card.data?.info.balance ?? null) != null && (card.data?.info.balance ?? 0) < 20;
  const notices = (data?.notifications ?? []).slice(0, 3);
  const resvList = resv.state === "ready" ? resv.list ?? [] : [];

  const empty =
    state === "ready" &&
    unsubmitted.length === 0 && resvList.length === 0 && soon.length === 0 && !cardLow && notices.length === 0;

  const courseName = (courseId: string): string => data?.courses.find((c) => c.id === courseId)?.name ?? "课程";

  const fmtDeadline = (d: string): string => {
    const dt = d.replace("T", " ");
    return dt.length > 16 ? dt.slice(5, 16) : dt;
  };

  return (
    <>
      <PageHead title="待办" meta="今天该管的事，一处看完" />
      {state === "loading" && unsubmitted.length === 0 ? (
        <Card>
          <Empty text="正在汇总今天的事…" />
        </Card>
      ) : empty ? (
        <Card>
          <Empty text="今天没有要紧事。去看看课表，或到服务页逛逛。" />
          <div className="svc-actions">
            <button className="btn btn-primary" onClick={() => navigate("today")}>回今日</button>
          </div>
        </Card>
      ) : (
          <div className="task-grid">
            <section className="task-sec">{/* —— 作业 —— */}
              <SectionHead title="作业" count={unsubmitted.length} moreLabel="全部作业" onMore={() => navigate("learn-assignments")} />
              {unsubmitted.length > 0 ? (
                <Card className="task-card">
                  {unsubmitted.slice(0, 5).map((h) => (
                    <button key={h.id} className="task-row" onClick={() => navigate("learn-assignments")}>
                      <span className="task-row-main">
                        <span className="task-row-name">{h.title}</span>
                        <span className="task-row-sub">{courseName(h.courseId)}</span>
                      </span>
                      <span className="task-row-meta">{fmtDeadline(h.deadline)}</span>
                    </button>
                  ))}
                </Card>
      ) : (
                <Card><Empty text="作业都交完了。" /></Card>
      )}
            </section>
      {resvList.length > 0 ? (
            <section className="task-sec">{/* —— 今日预约 —— */}
              <SectionHead title="今日预约" count={resvList.length} onMore={() => navigate("reserve")} />
              <Card className="task-card">
                {resvList.slice(0, 4).map((r) => (
                  <button key={r.key} className="task-row" onClick={() => navigate("reserve")}>
                      <span className="task-row-main">
                        <span className="task-row-name">{r.venue}{r.place ? " · " + r.place : ""}</span>
                        <span className="task-row-sub">{r.kind === "seat" ? "图书馆座位" : "研讨间"}{r.note ? " · " + r.note : ""}</span>
                      </span>
                      <span className="task-row-meta">{r.start.getHours() + ":" + String(r.start.getMinutes()).padStart(2, "0")}</span>
                  </button>
                ))}
                </Card>
            </section>
      ) : null}
      {soon.length > 0 ? (
            <section className="task-sec">{/* —— 近期考试 —— */}
              <SectionHead title="近期考试" count={soon.length} onMore={() => navigate("info", { infoTab: "exams" })} />
              <Card className="task-card">
                {soon.slice(0, 4).map((e, i) => (
                  <button key={i} className="task-row" onClick={() => navigate("info", { infoTab: "exams" })}>
                      <span className="task-row-main">
                        <span className="task-row-name">{e.courseName}</span>
                        <span className="task-row-sub">{[e.date, e.startTime, e.location].filter(Boolean).join(" · ")}</span>
                      </span>
                  </button>
                ))}
                </Card>
            </section>
      ) : null}
      {cardLow || notices.length > 0 ? (
            <section className="task-sec">{/* —— 财务 / 消息 —— */}
              {cardLow ? (
                <Card className="task-card">
                  <button className="task-row" onClick={() => navigate("life", { lifeTab: "card" })}>
                    <span className="task-row-main">
                      <span className="task-row-name">校园卡余额不足</span>
                      <span className="task-row-sub">当前 ¥{card.data?.info.balance}，建议充值</span>
                    </span>
                    <span className="task-row-meta">去充值</span>
                  </button>
                </Card>
      ) : null}
                {notices.length > 0 ? (
                  <Card className="task-card">
                    {notices.map((n, i) => (
                      <button key={i} className="task-row" onClick={() => navigate("learn")}>
                        <span className="task-row-main">
                          <span className="task-row-name">{n.title}</span>
                          <span className="task-row-sub">课程通知</span>
                        </span>
                      </button>
                    ))}
                  </Card>
      ) : null}
            </section>
      ) : null}
          </div>
      )}
    </>
  );
}
