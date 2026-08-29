/** 课程详情（learnX CourseDetail）：头部课程信息 + 通知/作业/文件/分组/讨论区 tab 列表 */
import { useEffect, useMemo, useState } from "react";
import type { LearnGroup } from "@onethu/core";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { learn } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { BackButton, FileRow, HomeworkRow, NoticeRow, semesterText } from "./shared.js";

type Tab = "notices" | "assignments" | "files" | "groups" | "forum";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "notices", label: "通知" },
  { key: "assignments", label: "作业" },
  { key: "files", label: "文件" },
  { key: "groups", label: "分组" },
  { key: "forum", label: "讨论区" },
];

/** 分组数据模块级缓存（单条目 + 5min TTL，useLearnData 同思路）：
 *  tab 来回切换 / 重进详情页不重复打会话接口；手动重试时清空。 */
let groupsCache: { courseId: string; at: number; data: LearnGroup[] } | null = null;
const GROUPS_CACHE_TTL = 5 * 60 * 1000;

export function CourseDetailPage() {
  const { navParams, status } = useApp();
  const { data, state, error, reload } = useLearnData();
  const [tab, setTab] = useState<Tab>("notices");

  // 分组懒加载：首次切到「分组」tab 才请求（useState + useEffect）
  const [groups, setGroups] = useState<LearnGroup[] | null>(null);
  const [groupsState, setGroupsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [groupsError, setGroupsError] = useState("");
  const [groupsNonce, setGroupsNonce] = useState(0);

  const courseId = navParams?.courseId ?? "";
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [data, courseId]);

  const notices = useMemo(
    () => (data?.notifications ?? []).filter((n) => n.courseId === courseId)
      .sort((a, b) => b.publishTime.localeCompare(a.publishTime)),
    [data, courseId],
  );
  const homework = useMemo(
    () => (data?.homework ?? []).filter((h) => h.courseId === courseId)
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [data, courseId],
  );
  const files = useMemo(
    () => (data?.files ?? []).filter((f) => f.courseId === courseId)
      .sort((a, b) => b.uploadTime.localeCompare(a.uploadTime)),
    [data, courseId],
  );

  useEffect(() => {
    if (tab !== "groups" || !courseId) return;
    if (status === "demo") {
      setGroups([]);
      setGroupsState("ready");
      return;
    }
    const hit = groupsCache;
    if (hit && hit.courseId === courseId && Date.now() - hit.at < GROUPS_CACHE_TTL) {
      setGroups(hit.data);
      setGroupsState("ready");
      return;
    }
    let cancelled = false;
    setGroupsState("loading");
    setGroupsError("");
    learn.getCourseGroups(courseId).then(
      (g) => {
        if (cancelled) return;
        groupsCache = { courseId, at: Date.now(), data: g };
        setGroups(g);
        setGroupsState("ready");
      },
      (e: unknown) => {
        if (cancelled) return;
        setGroupsError(explainNetworkError(e));
        setGroupsState("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [tab, status, courseId, groupsNonce]);

  const counts: Partial<Record<Tab, number>> = {
    notices: notices.length,
    assignments: homework.length,
    files: files.length,
    groups: groups?.length,
  };

  return (
    <>
      <PageHead
        title={course?.name ?? (state === "loading" && !data ? "加载中…" : "课程")}
        meta={
          course
            ? `${course.courseNumber}-${course.courseIndex} · ${course.teacherName}${data ? ` · ${semesterText(data.semester.id)}` : ""}`
            : "课程详情"
        }
        actions={
          <>
            <BackButton to="learn" label="课程列表" />
            <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      {course && course.timeAndLocation.length > 0 ? (
        <Card className="course-meta">
          {course.timeAndLocation.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </Card>
      ) : null}

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <div className="segmented" role="tablist">
        {TABS.map(({ key, label }) => {
          const n = counts[key];
          return (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={tab === key ? "is-active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
              {n !== undefined ? <span className="tab-count">{n}</span> : null}
            </button>
          );
        })}
      </div>

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : state === "error" && !data ? null : tab === "notices" ? (
        notices.length === 0 ? (
          <Card><Empty text="本课程暂无通知。" /></Card>
        ) : (
          <Card className="list">
            {notices.map((n, i) => (
              <NoticeRow key={n.id} n={n} from="learn-course" style={{ animationDelay: `${i * 25}ms` }} />
            ))}
          </Card>
        )
      ) : tab === "assignments" ? (
        homework.length === 0 ? (
          <Card><Empty text="本课程暂无作业。" /></Card>
        ) : (
          <Card className="list">
            {homework.map((h, i) => (
              <HomeworkRow key={h.id} h={h} from="learn-course" style={{ animationDelay: `${i * 25}ms` }} />
            ))}
          </Card>
        )
      ) : tab === "files" ? (
        files.length === 0 ? (
          <Card><Empty text="本课程暂无文件。" /></Card>
        ) : (
          <Card className="list">
            {files.map((f, i) => (
              <FileRow key={f.id} f={f} from="learn-course" style={{ animationDelay: `${i * 25}ms` }} />
            ))}
          </Card>
        )
      ) : tab === "groups" ? (
        groupsState === "loading" || groupsState === "idle" ? (
          <SkeletonRows rows={2} />
        ) : groupsState === "error" ? (
          <ErrorNote
            text={groupsError || "分组加载失败"}
            onRetry={() => {
              groupsCache = null; // 强制绕过缓存重试
              setGroupsNonce((n) => n + 1);
            }}
          />
        ) : !groups || groups.length === 0 ? (
          <Card>
            <Empty text={status === "demo" ? "演示模式暂无分组数据。" : "本课程暂无分组，或课程未开启分组。"} />
          </Card>
        ) : (
          <Card className="list">
            {groups.map((g, i) => {
              const meta = [
                g.members.length > 0 ? `${g.members.length} 名成员` : "",
                g.creator ? `创建人 ${g.creator}` : "",
                g.createTime,
                g.topicCount !== undefined ? `${g.topicCount} 个话题` : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div className="row" key={`${g.id}-${i}`} style={{ animationDelay: `${i * 25}ms` }}>
                  <div className="row-main">
                    <div className="row-title">{g.name}</div>
                    {g.members.length > 0 ? (
                      <div className="chips" style={{ marginTop: 6 }}>
                        {g.members.map((m, j) => (
                          <span key={`${m.name}-${j}`} className={m.role ? "chip chip-blue" : "chip chip-gray"}>
                            {m.name}
                            {m.role ? ` · ${m.role}` : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {meta ? <div className="row-sub" style={{ marginTop: 6 }}>{meta}</div> : null}
                  </div>
                </div>
              );
            })}
          </Card>
        )
      ) : (
        <Card>
          <Empty text="讨论区对接中，API 整理后开放" />
        </Card>
      )}
    </>
  );
}
