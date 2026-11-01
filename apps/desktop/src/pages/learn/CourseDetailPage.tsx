import { courseDisplayName } from "../../lib/learnLanguage.js";
import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn, Tabs } from "@onethu/gui";
/** 课程详情（learnX CourseDetail）：头部课程信息 + 通知/作业/文件/分组/讨论区 tab 列表。
 *  作业 tab 带状态筛选 chips（未提交/已提交/已批改/全部，AssignmentsPage 同款 segmented），
 *  已批改条目直接显示成绩（HomeworkRow showGrade，thu-app learnHome「已批改 (分数)」语义）。 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LearnGroup } from "@onethu/core";
import { SegmentedOverflow, Card, Empty, ErrorNote, ListWindow, PageHead, SkeletonRows } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { learn } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { BackButton, FileRow, HomeworkRow, NoticeRow, semesterText } from "./shared.js";
import { useIgnoredHw } from "../../state/hwIgnore.js";
import { useLearnNavSemester } from "./shared.js";
import { BbsPanel } from "./Forum.js";
import { toExternalNotice, toHomework, useExternalHomework } from "../../state/exthw.js";
import { mergeCoursesByName, yktKindToCourseTab } from "./courseMerge.js";
import { YktContentList } from "../../components/exthw/YktContentList.js";

type Tab = "notices" | "assignments" | "files" | "groups" | "forum";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "notices", get label() { return i18n("pages.learn.coursedetailpage.4b6ded8a7f18"); } },
  { key: "assignments", get label() { return i18n("pages.learn.coursedetailpage.b0dff016ff17"); } },
  { key: "files", get label() { return i18n("pages.learn.coursedetailpage.39932f24fe11"); } },
  { key: "groups", get label() { return i18n("pages.learn.coursedetailpage.399ee6934772"); } },
  { key: "forum", get label() { return i18n("pages.learn.coursedetailpage.9c92c9d08b05"); } },
];

/** 课程页各级 tab 的唯一渲染器：统一用 OneGUI Tabs 的 segmented 变体（整行等分、
 * 滑动指示器、tablist/键盘语义），不再在页面里拼裸 button。 */
interface CourseTabItem { key: string; label: ReactNode; count?: number }

function CourseTabRow({ items, value, onChange, ariaLabel }: {
  items: CourseTabItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
}) {
  return (
    <Tabs
      variant="segmented"
      block
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      items={items.map(({ key, label, count }) => ({ id: key, label, badge: count }))}
    />
  );
}

/** 作业状态筛选（AssignmentsPage 同款口径：未提交 / 已提交未批改 / 已批改 / 全部） */
type HwFilter = "unfinished" | "submitted" | "graded" | "ignored" | "all";

const HW_FILTERS: Array<{ key: HwFilter; label: string }> = [
  { key: "unfinished", get label() { return i18n("pages.learn.coursedetailpage.8032af4a590f"); } },
  { key: "submitted", get label() { return i18n("pages.learn.coursedetailpage.bc37a6110a07"); } },
  { key: "graded", get label() { return i18n("pages.learn.coursedetailpage.d42baf1647c8"); } },
  // R21c：忽略优先级最高——本课程的忽略作业只出现在这一栏，其余栏一律不含
  { key: "ignored", get label() { return i18n("pages.learn.coursedetailpage.c9bb70bcaaa3"); } },
  { key: "all", get label() { return i18n("pages.learn.coursedetailpage.5c55a67935af"); } },
];

/** 分组数据模块级缓存（单条目 + 5min TTL，useLearnData 同思路）：
 *  tab 来回切换 / 重进详情页不重复打会话接口；手动重试时清空。 */
let groupsCache: { courseId: string; at: number; data: LearnGroup[] } | null = null;
const GROUPS_CACHE_TTL = 5 * 60 * 1000;

export function CourseDetailPage() {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
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
  useEffect(() => {
    const t = navParams?.courseTab;
    setTab(t === "assignments" || t === "files" || t === "groups" || t === "forum" ? t : "notices");
  }, [courseId, navParams?.courseTab]);
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [uiLocale, data, courseId]);

  const notices = useMemo(
    () => (data?.notifications ?? []).filter((n) => n.courseId === courseId)
      .sort((a, b) => b.publishTime.localeCompare(a.publishTime)),
    [uiLocale, data, courseId],
  );
  const homework = useMemo(
    () => (data?.homework ?? []).filter((h) => h.courseId === courseId)
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
    [uiLocale, data, courseId],
  );

  /* ── R29：同名雨课堂课程的作业/资料/公告并进本页对应栏位 ──
   * 匹配沿用「同名课程」口径（courseMerge 的归一化精确匹配）；
   * 雨课堂侧映射：作业+试卷→作业栏；公告→通知栏；资料/课件/视频/其他→文件栏。 */
  const ext = useExternalHomework();
  const yktCourse = useMemo(() => {
    if (!course) return undefined;
    const yktCourses = ext.courses.filter((c) => c.source === "yuketang");
    return mergeCoursesByName([course], yktCourses).byLearnId.get(course.id);
  }, [uiLocale, course, ext.courses]);
  const yktHw = useMemo(
    () =>
      yktCourse
        ? ext.items.filter((i) => i.source === "yuketang" && i.classroomId === yktCourse.id).map(toHomework)
        : [],
    [uiLocale, ext.items, yktCourse],
  );
  const yktContents = useMemo(
    () => (yktCourse ? ext.contents.filter((c) => c.source === "yuketang" && c.courseId === yktCourse.id) : []),
    [uiLocale, ext.contents, yktCourse],
  );
  /** 公告 → 通知栏 */
  const yktNotices = useMemo(() => yktContents.filter((c) => yktKindToCourseTab(c.kind) === "notices"), [uiLocale, yktContents]);
  /** 其余内容（资料/课件/视频/投票/未知）→ 文件栏（雨课堂没有独立"资料库"页签时最自然的落点） */
  const yktFiles = useMemo(() => yktContents.filter((c) => yktKindToCourseTab(c.kind) === "files"), [uiLocale, yktContents]);
  /** 课程通知/文件里的双来源用子 tab 切换（用户 2026-11-01）：两侧都有内容才出 tab。 */
  type Source = "learn" | "ykt";
  const [noticeSource, setNoticeSource] = useState<Source>("learn");
  const [fileSource, setFileSource] = useState<Source>("learn");
  useEffect(() => {
    setNoticeSource("learn");
    setFileSource("learn");
  }, [courseId]);
  /** 本课程作业全集（网络学堂 + 雨课堂），筛选/计数都基于它 */
  const hwAll = useMemo(() => [...homework, ...yktHw], [uiLocale, homework, yktHw]);
  const ignored = useIgnoredHw(); // R21c：忽略状态（课程页也要过滤 + 自己的忽略栏）

  // 作业筛选（默认「全部」：进入页面行为与旧版一致），各组计数供 chip 展示
  const [hwFilter, setHwFilter] = useState<HwFilter>("all");
  const hwGroups = useMemo(() => {
    // R21c：忽略的作业从本课程所有常规栏移出，只在「已忽略」栏里（可恢复）
    // R23：旁听作业不属于正式课程作业栏（在「全部作业」页单列）
    const live = hwAll.filter((h) => !ignored.has(h.id) && !h.audited);
    return {
      unfinished: live.filter((h) => !h.submitted),
      submitted: live.filter((h) => h.submitted && !h.graded),
      graded: live.filter((h) => h.graded),
      ignored: hwAll.filter((h) => ignored.has(h.id)),
      all: live,
    };
  }, [uiLocale, hwAll, ignored]);
  const hwList = hwGroups[hwFilter];
  const files = useMemo(
    () => (data?.files ?? []).filter((f) => f.courseId === courseId)
      .sort((a, b) => b.uploadTime.localeCompare(a.uploadTime)),
    [uiLocale, data, courseId],
  );
  const effectiveNoticeSource: Source = notices.length === 0 ? "ykt" : yktNotices.length === 0 ? "learn" : noticeSource;
  const effectiveFileSource: Source = files.length === 0 ? "ykt" : yktFiles.length === 0 ? "learn" : fileSource;

  useEffect(() => {
    if (tab !== "groups" || !courseId) return;
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
    notices: notices.length + yktNotices.length,
    // R21c：计数只算参与中的作业（忽略的不计入，避免「3 条」点进去只剩 2 条）
    assignments: hwAll.filter((h) => !ignored.has(h.id) && !h.audited).length,
    files: files.length + yktFiles.length,
    groups: groups?.length,
  };

  return (
    <>
      <PageHead
        title={courseDisplayName(course) ?? (state === "loading" && !data ? i18n("pages.learn.coursedetailpage.4927a53bcc88") : i18n("pages.learn.coursedetailpage.60db1afb4022"))}
        meta={
          course
            ? `${course.courseNumber}-${course.courseIndex} · ${course.teacherName}${data ? ` · ${semesterText(data.semester.id)}` : ""}`
            : i18n("pages.learn.coursedetailpage.22519a88484f")
        }
        actions={
          <>
            <BackButton to="learn" label={i18n("pages.learn.coursedetailpage.e5da2c107242")} />
            <CollectStar
              atom={{ kind: "course", key: enc(course?.id ?? navParams?.courseId ?? "", course?.name ?? "", course?.teacherName ?? "", data?.semester.id ?? "") }}
              title={courseDisplayName(course)}
            />
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.learn.coursedetailpage.aee887434131")}</Btn>
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

      <CourseTabRow
        value={tab}
        onChange={(key) => setTab(key as Tab)}
        items={TABS.map(({ key, label }) => ({ key, label, count: counts[key] }))}
      />

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : state === "error" && !data ? null : tab === "notices" ? (
        notices.length === 0 && yktNotices.length === 0 ? (
          <Card><Empty text={i18n("pages.learn.coursedetailpage.b3731a435fb0")} /></Card>
        ) : (
          <>
            {notices.length > 0 && yktNotices.length > 0 ? (
              <CourseTabRow
                value={effectiveNoticeSource}
                onChange={(key) => setNoticeSource(key as Source)}
                items={[
                  { key: "learn", label: i18n("enum.label.aa39cac2b409"), count: notices.length },
                  { key: "ykt", label: i18n("components.attachactionssheet.38b9eabcae1b"), count: yktNotices.length },
                ]}
              />
            ) : null}
            {effectiveNoticeSource === "ykt" && yktNotices.length > 0 ? (
              <ListWindow>
                {yktNotices.map((c, i) => (
                  <NoticeRow
                    key={c.id}
                    n={toExternalNotice(c)}
                    sem={data?.semester.id}
                    from="learn-course"
                    navCourseId={courseId}
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  />
                ))}
              </ListWindow>
            ) : notices.length > 0 ? (
              <ListWindow>
                {notices.map((n, i) => (
                  <NoticeRow key={n.id} n={n} sem={data?.semester.id} from="learn-course" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
                ))}
              </ListWindow>
            ) : (
              <Card><Empty text={i18n("pages.learn.coursedetailpage.b3731a435fb0")} /></Card>
            )}
          </>
        )
      ) : tab === "assignments" ? (
        hwAll.length === 0 ? (
          <Card><Empty text={i18n("pages.learn.coursedetailpage.bdf5dcb60763")} /></Card>
        ) : (
          <>
            {/* 状态筛选 chips：AssignmentsPage 同款 segmented（含各组计数） */}
            <CourseTabRow
              ariaLabel={i18n("pages.learn.coursedetailpage.5d2c51e297aa")}
              value={hwFilter}
              onChange={(key) => setHwFilter(key as HwFilter)}
              items={HW_FILTERS.map(({ key, label }) => ({ key, label, count: hwGroups[key].length }))}
            />
            {hwList.length === 0 ? (
              <Card><Empty text={hwFilter === "ignored" ? i18n("pages.learn.coursedetailpage.052544849717") : i18n("pages.learn.coursedetailpage.4fc6f287e4e5")} /></Card>
            ) : (
              <ListWindow>
                {hwList.map((h, i) => (
                  <HomeworkRow
                    key={h.id}
                    h={h}
                    courseName={courseDisplayName(course)}
                    identityCourseName={course?.name}
                    sem={data?.semester.id}
                    from="learn-course"
                    // R29：雨课堂作业行返回时带回本课程 id（否则课程页缺参渲染空页）
                    {...(h.source ? { fromCourseId: courseId } : {})}
                    showGrade
                    remind
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  />
                ))}
              </ListWindow>
            )}
          </>
        )
      ) : tab === "files" ? (
        files.length === 0 && yktFiles.length === 0 ? (
          <Card><Empty text={i18n("pages.learn.coursedetailpage.dc9cd1730d43")} /></Card>
        ) : (
          <>
            {files.length > 0 && yktFiles.length > 0 ? (
              <CourseTabRow
                value={effectiveFileSource}
                onChange={(key) => setFileSource(key as Source)}
                items={[
                  { key: "learn", label: i18n("enum.label.aa39cac2b409"), count: files.length },
                  { key: "ykt", label: i18n("components.attachactionssheet.38b9eabcae1b"), count: yktFiles.length },
                ]}
              />
            ) : null}
            {effectiveFileSource === "ykt" && yktFiles.length > 0 ? (
              <YktContentList items={yktFiles} />
            ) : files.length > 0 ? (
              <ListWindow>
                {files.map((f, i) => (
                  <FileRow key={f.id} f={f} sem={data?.semester.id} from="learn-course" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }} />
                ))}
              </ListWindow>
            ) : (
              <Card><Empty text={i18n("pages.learn.coursedetailpage.dc9cd1730d43")} /></Card>
            )}
          </>
        )
      ) : tab === "groups" ? (
        groupsState === "loading" || groupsState === "idle" ? (
          <SkeletonRows rows={2} />
        ) : groupsState === "error" ? (
          <ErrorNote
            text={groupsError || i18n("pages.learn.coursedetailpage.f25c0dd68e3b")}
            onRetry={() => {
              groupsCache = null; // 强制绕过缓存重试
              setGroupsNonce((n) => n + 1);
            }}
          />
        ) : !groups || groups.length === 0 ? (
          <Card>
            <Empty text={i18n("pages.learn.coursedetailpage.7fe1716b6c26")} />
          </Card>
        ) : (
          <ListWindow>
            {groups.map((g, i) => {
              const meta = [
                g.members.length > 0 ? i18n("pages.learn.coursedetailpage.2012dba9a5c5", { length: String(g.members.length) }) : "",
                g.creator ? i18n("pages.learn.coursedetailpage.5351f3751c35", { creator: String(g.creator) }) : "",
                g.createTime,
                g.topicCount !== undefined ? i18n("pages.learn.coursedetailpage.d41346cbeb96", { topicCount: String(g.topicCount) }) : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div className="row" key={`${g.id}-${i}`} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
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
          </ListWindow>
        )
      ) : (
        <BbsPanel
          courseId={courseId}
          initialBoard={navParams?.bbsBoard}
          courseName={courseDisplayName(course)}
          sem={data?.semester.id}
        />
      )}
    </>
  );
}
