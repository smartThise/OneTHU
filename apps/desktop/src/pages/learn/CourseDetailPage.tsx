/** 课程详情（learnX CourseDetail）：头部课程信息 + 通知/作业/文件/分组/讨论区 tab 列表。
 *  作业 tab 带状态筛选 chips（未提交/已提交/已批改/全部，AssignmentsPage 同款 segmented），
 *  已批改条目直接显示成绩（HomeworkRow showGrade，thu-app learnHome「已批改 (分数)」语义）。 */
import { useEffect, useMemo, useState } from "react";
import type { LearnGroup } from "@onethu/core";
import { SegmentedOverflow, Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { learn } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { BackButton, FileRow, HomeworkRow, NoticeRow, semesterText } from "./shared.js";
import { BbsPanel } from "./Forum.js";

type Tab = "notices" | "assignments" | "files" | "groups" | "forum";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "notices", label: "通知" },
  { key: "assignments", label: "作业" },
  { key: "files", label: "文件" },
  { key: "groups", label: "分组" },
  { key: "forum", label: "讨论区" },
];

/** 作业状态筛选（AssignmentsPage 同款口径：未提交 / 已提交未批改 / 已批改 / 全部） */
type HwFilter = "unfinished" | "submitted" | "graded" | "all";

const HW_FILTERS: Array<{ key: HwFilter; label: string }> = [
  { key: "unfinished", label: "未提交" },
  { key: "submitted", label: "已提交" },
  { key: "graded", label: "已批改" },
  { key: "all", label: "全部" },
];

/** 分组数据模块级缓存（单条目 + 5min TTL，useLearnData 同思路）：
 *  tab 来回切换 / 重进详情页不重复打会话接口；手动重试时清空。 */
let groupsCache: { courseId: string; at: number; data: LearnGroup[] } | null = null;
const GROUPS_CACHE_TTL = 5 * 60 * 1000;

export function CourseDetailPage() {
  const { navParams, status } = useApp();
  const { data, state, error, reload } = useLearnData();
  // 「各回各家」：从作业/帖子/通知等三级页返回时落到对应 tab，而不是恒第一个
  const [tab, setTab] = useState<Tab>(() => {
    const t = navParams?.courseTab;
    return t === "assignments" || t === "files" || t === "groups" || t === "forum" ? t : "notices";
  });

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

  // 作业筛选（默认「全部」：进入页面行为与旧版一致），各组计数供 chip 展示
  const [hwFilter, setHwFilter] = useState<HwFilter>("all");
  const hwGroups = useMemo(
    () => ({
      unfinished: homework.filter((h) => !h.submitted),
      submitted: homework.filter((h) => h.submitted && !h.graded),
      graded: homework.filter((h) => h.graded),
      all: homework,
    }),
    [homework],
  );
  const hwList = hwGroups[hwFilter];
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
            <CollectStar
              atom={{ kind: "course", key: enc(course?.id ?? navParams?.courseId ?? "", course?.name ?? "", course?.teacherName ?? "", data?.semester.id ?? "") }}
              title={course?.name}
            />
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

      <SegmentedOverflow>
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
      </SegmentedOverflow>

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : state === "error" && !data ? null : tab === "notices" ? (
        notices.length === 0 ? (
          <Card><Empty text="本课程暂无通知。" /></Card>
        ) : (
          <Card className="list">
            {notices.map((n, i) => (
              <NoticeRow key={n.id} n={n} sem={data?.semester.id} from="learn-course" style={{ animationDelay: `${i * 25}ms` }} />
            ))}
          </Card>
        )
      ) : tab === "assignments" ? (
        homework.length === 0 ? (
          <Card><Empty text="本课程暂无作业。" /></Card>
        ) : (
          <>
            {/* 状态筛选 chips：AssignmentsPage 同款 segmented（含各组计数） */}
            <SegmentedOverflow ariaLabel="作业状态筛选">
              {HW_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={hwFilter === key}
                  className={hwFilter === key ? "is-active" : ""}
                  onClick={() => setHwFilter(key)}
                >
                  {label}
                  <span className="tab-count">{hwGroups[key].length}</span>
                </button>
              ))}
            </SegmentedOverflow>
            {hwList.length === 0 ? (
              <Card><Empty text="该状态下暂无作业。" /></Card>
            ) : (
              <Card className="list">
                {hwList.map((h, i) => (
                  <HomeworkRow
                    key={h.id}
                    h={h}
                    courseName={course?.name}
                    sem={data?.semester.id}
                    from="learn-course"
                    showGrade
                    style={{ animationDelay: `${i * 25}ms` }}
                  />
                ))}
              </Card>
            )}
          </>
        )
      ) : tab === "files" ? (
        files.length === 0 ? (
          <Card><Empty text="本课程暂无文件。" /></Card>
        ) : (
          <Card className="list">
            {files.map((f, i) => (
              <FileRow key={f.id} f={f} sem={data?.semester.id} from="learn-course" style={{ animationDelay: `${i * 25}ms` }} />
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
        <BbsPanel
          courseId={courseId}
          initialBoard={navParams?.bbsBoard}
          courseName={course?.name}
          sem={data?.semester.id}
        />
      )}
    </>
  );
}
