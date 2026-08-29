/**
 * 网络学堂入口（learnX Courses）：课程卡片列表 + 全部作业/通知/文件/搜索/学期快捷入口。
 * 原四页签列表功能移入 pages/learn/ 专属页面（Assignments/Notices/Files）。
 */
import { useMemo } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconCalendar, IconChevron, IconFile, IconPen, IconRefresh, IconSearch } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { useLearnData } from "../state/data.js";
import { semesterText } from "./learn/shared.js";

export function LearnPage() {
  const { navigate } = useApp();
  const { data, state, error, reload } = useLearnData();

  const stats = useMemo(() => {
    const hw = data?.homework ?? [];
    return {
      unfinished: hw.filter((h) => !h.submitted).length,
      notifications: (data?.notifications ?? []).length,
      files: (data?.files ?? []).length,
    };
  }, [data]);

  const courseStats = useMemo(() => {
    const m = new Map<string, { hw: number; notices: number; files: number }>();
    for (const h of data?.homework ?? []) {
      if (h.submitted) continue;
      const s = m.get(h.courseId) ?? { hw: 0, notices: 0, files: 0 };
      s.hw += 1;
      m.set(h.courseId, s);
    }
    for (const n of data?.notifications ?? []) {
      const s = m.get(n.courseId) ?? { hw: 0, notices: 0, files: 0 };
      s.notices += 1;
      m.set(n.courseId, s);
    }
    for (const f of data?.files ?? []) {
      const s = m.get(f.courseId) ?? { hw: 0, notices: 0, files: 0 };
      s.files += 1;
      m.set(f.courseId, s);
    }
    return m;
  }, [data]);

  return (
    <>
      <PageHead
        title="网络学堂"
        meta={data ? `${semesterText(data.semester.id)} · ${data.courses.length} 门课程` : "加载中…"}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => navigate("learn-search")}>
              <IconSearch width={14} height={14} />
              搜索
            </button>
            <button className="btn btn-ghost" onClick={() => navigate("learn-semester")}>
              <IconCalendar width={14} height={14} />
              学期
            </button>
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <div className="stats">
        <Card className="stat-card stat-click" >
          <button className="stat-link" onClick={() => navigate("learn-assignments")} aria-label="查看全部作业">
            <span className="stat-icon red">
              <IconPen width={17} height={17} />
            </span>
            <span className="stat-text">
              <span className="stat-num">{state === "loading" && !data ? "–" : stats.unfinished}</span>
              <span className="stat-label">未交作业</span>
            </span>
          </button>
        </Card>
        <Card className="stat-card stat-click">
          <button className="stat-link" onClick={() => navigate("learn-notices")} aria-label="查看全部通知">
            <span className="stat-icon amber">
              <IconBell width={17} height={17} />
            </span>
            <span className="stat-text">
              <span className="stat-num">{state === "loading" && !data ? "–" : stats.notifications}</span>
              <span className="stat-label">课程通知</span>
            </span>
          </button>
        </Card>
        <Card className="stat-card stat-click">
          <button className="stat-link" onClick={() => navigate("learn-files")} aria-label="查看全部文件">
            <span className="stat-icon green">
              <IconFile width={17} height={17} />
            </span>
            <span className="stat-text">
              <span className="stat-num">{state === "loading" && !data ? "–" : stats.files}</span>
              <span className="stat-label">课程文件</span>
            </span>
          </button>
        </Card>
      </div>

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : (data?.courses.length ?? 0) === 0 ? (
        state === "error" ? null : (
          <Card><Empty text="本学期暂无课程。" /></Card>
        )
      ) : (
        <div className="course-grid">
          {(data?.courses ?? []).map((c, i) => {
            const s = courseStats.get(c.id);
            return (
              <Card
                key={c.id}
                className="course-card"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <button
                  className="course-card-btn"
                  onClick={() => navigate("learn-course", { courseId: c.id })}
                  aria-label={`打开课程 ${c.name}`}
                >
                  <div className="course-card-head">
                    <b>{c.name}</b>
                    <IconChevron width={15} height={15} className="row-caret" />
                  </div>
                  <div className="course-card-sub">
                    {c.teacherName} · {c.courseNumber}
                    {c.courseIndex ? `-${c.courseIndex}` : ""}
                  </div>
                  {c.timeAndLocation.length > 0 ? (
                    <div className="course-card-time">{c.timeAndLocation.join(" · ")}</div>
                  ) : null}
                  <div className="course-card-chips">
                    {s && s.hw > 0 ? <span className="chip chip-red"><span className="dot" />未交 {s.hw}</span> : null}
                    {s && s.notices > 0 ? <span className="chip chip-gray">通知 {s.notices}</span> : null}
                    {s && s.files > 0 ? <span className="chip chip-gray">文件 {s.files}</span> : null}
                    {!s || (s.hw === 0 && s.notices === 0 && s.files === 0) ? (
                      <span className="chip chip-gray">暂无动态</span>
                    ) : null}
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
