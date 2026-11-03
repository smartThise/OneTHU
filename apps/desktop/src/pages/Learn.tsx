import { courseDisplayName } from "../lib/learnLanguage.js";
import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
import { Btn } from "@onethu/gui";
/**
 * 网络学堂入口（learnX Courses）：课程卡片列表 + 全部作业/通知/文件/搜索/学期快捷入口。
 * 原四页签列表功能移入 pages/learn/ 专属页面（Assignments/Notices/Files）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { PageAtomStar } from "..//components/Collect.js";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../components/Layout.js";
import { IconBell, IconCalendar, IconFile, IconPen, IconRefresh, IconSearch } from "../components/Icons.js";
import { useApp } from "../state/context.js";
import { CollectStar } from "../components/Collect.js";
import { enc } from "../state/atoms.js";
import { useLearnData } from "../state/data.js";
import { toHomework, useExternalHomework } from "../state/exthw.js";
import { useIgnoredHw } from "../state/hwIgnore.js";
import { setYktCourse } from "../state/yktCourse.js";
import { mergeCoursesByName } from "./learn/courseMerge.js";
import { LearnCourseCard } from "./learn/LearnCourseCard.js";
import { fmtRemindOffset, setHwDefault, useHwDefault } from "../state/hwRemind.js";
import { HwRemindPop, semesterText } from "./learn/shared.js";

/** 全局作业 DDL 提醒卡（用户拍板：先设所有作业共用的节点，想改单个再在作业行改）。
 *  openSignal：原子深链（learn-hwremind）到达时自动弹开设置层。 */
function HwRemindDefaultCard({ openSignal }: { openSignal?: boolean }) {
  const uiLocale = useUiLocale();

  const def = useHwDefault();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  return (
    <Card className="stat-card stat-click stat-hwremind">
      <button className="stat-link" onClick={() => setOpen((o) => !o)} aria-label={i18n("pages.learn.0cebfcb94425")}>
        <span className="stat-icon">
          <IconBell width={17} height={17} />
        </span>
        <span className="stat-text">
          <span className="stat-num">{fmtRemindOffset(def)}</span>
          <span className="stat-label">{i18n("pages.learn.687d0d801e7a")}</span>
        </span>
      </button>
      {open ? (
        <HwRemindPop
          value={def}
          title={i18n("pages.learn.4005ca86f6e8")}
          foot={i18n("pages.learn.41319c365478")}
          onApply={(m) => {
            if (m != null) {
              setHwDefault(m);
              setOpen(false);
            }
          }}
        />
      ) : null}
    </Card>
  );
}

export function LearnPage() {
  const uiLocale = useUiLocale();

  const { navigate, navParams } = useApp();
  const { data, state, error, reload } = useLearnData();

  // 学期切换显式参数（SemesterSelectionPage 传入）：数据学期与所选学期不一致时
  // 自动重校验一次（缓存竞态/漫游残留旧学期 bundle 的兜底，避免"点进去一片空白/旧学期"）。
  // 只兜底一次（semFixRef 记账），服务端持续返回错学期时不打转。
  const wantedSemester = navParams?.semesterId;
  const semFixRef = useRef<string | null>(null);
  useEffect(() => {
    if (!wantedSemester || !data || data.semester.id === wantedSemester) return;
    if (semFixRef.current === wantedSemester) return;
    semFixRef.current = wantedSemester;
    void reload();
  }, [wantedSemester, data, reload]);

  // 外部作业（雨课堂/TUOJ/Tyche/DSA OJ）与学期无关，全量计入「未交作业」；未配置凭据时 extHw 恒为空（零回归）
  const ext = useExternalHomework();
  const extHw = useMemo(() => ext.items.map(toHomework), [uiLocale, ext.items]);

  // 雨课堂课程：与网络学堂课程并列展示在同一页（外部源一并拉回的课程列表；未登录时为空）
  const yktCourses = useMemo(() => ext.courses.filter((c) => c.source === "yuketang"), [uiLocale, ext.courses]);
  /** R28：按课程名把雨课堂课程并到网络学堂课程卡片上（纯函数，见 pages/learn/courseMerge.ts） */
  const merge = useMemo(
    () => mergeCoursesByName(data?.courses ?? [], yktCourses),
    [uiLocale, data, yktCourses],
  );

  // R21c：忽略优先级最高——所有对用户展示的计数/列表都不含已忽略作业
  const ignored = useIgnoredHw();

  const stats = useMemo(() => {
    // R23：旁听不计入「未交作业」总数（单列在「全部作业 → 旁听作业」）
    const hw = [...(data?.homework ?? []), ...extHw].filter((h) => !h.submitted && !ignored.has(h.id) && !h.audited);
    return {
      unfinished: hw.length,
      notifications: (data?.notifications ?? []).length,
      files: (data?.files ?? []).length,
    };
  }, [uiLocale, data, extHw, ignored]);

  const courseStats = useMemo(() => {
    const m = new Map<string, { hw: number; notices: number; files: number }>();
    for (const h of data?.homework ?? []) {
      if (h.submitted || ignored.has(h.id) || h.audited) continue; // 已忽略/旁听不计入课程卡片计数
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
  }, [uiLocale, data, ignored]);

  /** R31：雨课堂侧逐课计数（与课程详情页口径一致）：
   *  未交 = 未提交且未忽略未旁听；通知 = 公告条数；文件 = 非作业/非公告内容（资料/课件/视频…） */
  const yktCardStats = useMemo(() => {
    const m = new Map<string, { hw: number; notices: number; files: number }>();
    for (const y of yktCourses) {
      const hw = ext.items
        .filter((i) => i.source === "yuketang" && i.classroomId === y.id)
        .map(toHomework)
        .filter((h) => !h.submitted && !h.audited && !ignored.has(h.id)).length;
      const contents = ext.contents.filter((c) => c.source === "yuketang" && c.courseId === y.id);
      const notices = contents.filter((c) => c.kind === "announcement").length;
      const files = contents.filter(
        (c) => c.kind !== "announcement" && c.kind !== "homework" && c.kind !== "exam" && c.kind !== "quiz",
      ).length;
      m.set(y.id, { hw, notices, files });
    }
    return m;
  }, [uiLocale, yktCourses, ext.items, ext.contents, ignored]);

  /** 合并后的卡片计数（网络学堂 + 同名雨课堂），与课程详情页三个栏位的计数同口径 */
  const cardStats = (learnCourseId: string, learnStats?: { hw: number; notices: number; files: number }) => {
    const base = learnStats ?? { hw: 0, notices: 0, files: 0 };
    const ykt = merge.byLearnId.get(learnCourseId);
    const ys = ykt ? yktCardStats.get(ykt.id) : undefined;
    if (!ys) return base;
    return { hw: base.hw + ys.hw, notices: base.notices + ys.notices, files: base.files + ys.files };
  };

  return (
    <div className="learn-page">
      <PageHead
        title={i18n("pages.learn.60db1afb4022")}
        meta={data ? i18n("pages.learn.c58fe880cfb6", { value: String(semesterText(data.semester.id)), value2: String(data.courses.length + merge.unmatchedYkt.length) }) : i18n("pages.learn.4927a53bcc88")}
        actions={
          <>
            <PageAtomStar atomKey="learn" title={i18n("pages.learn.60db1afb4022")} />
            <Btn variant="ghost" onClick={() => navigate("learn-search")}><IconSearch width={14} height={14} />{i18n("pages.learn.44ce7ae909bb")}</Btn>
            <Btn variant="ghost" onClick={() => navigate("learn-semester")}><IconCalendar width={14} height={14} />{i18n("pages.learn.79a4ef019e9c")}</Btn>
            <Btn variant="outline" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.learn.aee887434131")}</Btn>
          </>
        }
      />
      <div className="learn-page-note">{i18n("pages.learn.2079ef6b94d0")}</div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      <div className="stats">
        <Card className="stat-card stat-click" >
          <button className="stat-link" onClick={() => navigate("learn-assignments")} aria-label={i18n("pages.learn.d4b1b25d27b2")}>
            <span className="stat-icon red">
              <IconPen width={17} height={17} />
            </span>
            <span className="stat-text">
              <span className="stat-num">{state === "loading" && !data ? "–" : stats.unfinished}</span>
              <span className="stat-label">{i18n("pages.learn.1236edf41da0")}</span>
            </span>
          </button>
        </Card>
        <Card className="stat-card stat-click">
          <button className="stat-link" onClick={() => navigate("learn-notices")} aria-label={i18n("pages.learn.568090ece667")}>
            <span className="stat-icon amber">
              <IconBell width={17} height={17} />
            </span>
            <span className="stat-text">
              <span className="stat-num">{state === "loading" && !data ? "–" : stats.notifications}</span>
              <span className="stat-label">{i18n("pages.learn.f37a13fc55b3")}</span>
            </span>
          </button>
        </Card>
        <Card className="stat-card stat-click">
          <button className="stat-link" onClick={() => navigate("learn-files")} aria-label={i18n("pages.learn.2a81fbaa67a8")}>
            <span className="stat-icon green">
              <IconFile width={17} height={17} />
            </span>
            <span className="stat-text">
              <span className="stat-num">{state === "loading" && !data ? "–" : stats.files}</span>
              <span className="stat-label">{i18n("pages.learn.2bb745fb2e6f")}</span>
            </span>
          </button>
        </Card>
        <HwRemindDefaultCard openSignal={navParams?.learnOpenHwRemind} />
      </div>

      {state === "loading" && !data ? (
        <SkeletonRows rows={5} />
      ) : !data ? (
        // 无数据且已不在 loading：error 态的 ErrorNote 已在上方给出，否则兜底骨架
        state === "error" ? null : <SkeletonRows rows={5} />
      ) : data.courses.length === 0 && merge.unmatchedYkt.length === 0 ? (
        // 空学期：必须给可自助恢复的出口（此前只是死路的"暂无课程"，
        // 会话半死吐过一次空列表时用户只能硬刷新）
        state === "error" ? null : (
          <Card>
            <Empty text={state === "loading" ? i18n("pages.learn.6ebc2dd26a23") : i18n("pages.learn.6874ac8d6028")} />
            <div className="learn-empty-actions">
              <Btn variant="ghost" onClick={() => void reload()} disabled={state === "loading"}><IconRefresh width={14} height={14} />{i18n("pages.learn.7bdd5ce1e298")}</Btn>
            </div>
          </Card>
        )
      ) : (
        /* R31：网络学堂课程与「网络学堂没有对应课」的雨课堂课程**同处一个网格**（不再分段标题） */
        <div className="learn-course-list">
          {data.courses.map((c) => {
            const ykt = merge.byLearnId.get(c.id);
            const s = cardStats(c.id, courseStats.get(c.id));
            return (
              <LearnCourseCard
                key={c.id}
                courseId={c.id}
                title={courseDisplayName(c)}
                details={[c.teacherName, `${c.courseNumber}${c.courseIndex ? `-${c.courseIndex}` : ""}`].filter(Boolean).join(" · ")}
                schedule={c.timeAndLocation.join(" · ")}
                source="learn"
                stats={s}
                officialUnread={{ notices: c.summary?.unreadNotices, files: c.summary?.unreadFiles }}
                aside={<CollectStar atom={{ kind: "course", key: enc(c.id, c.name, c.teacherName) }} title={courseDisplayName(c)} />}
                onOpen={() => navigate("learn-course", { courseId: c.id })}
                onOpenSection={(courseTab) => navigate("learn-course", { courseId: c.id, courseTab })}
                yktEntry={ykt ? {
                  title: ykt.title ?? ykt.name,
                  onOpen: () => {
                    setYktCourse({ id: ykt.id, name: ykt.name });
                    navigate("learn-ykt-course", { extCourseId: ykt.id, extCourseName: ykt.name });
                  },
                } : undefined}
              />
            );
          })}
          {merge.unmatchedYkt.map((c) => (
            <LearnCourseCard
              key={`ykt-${c.id}`}
              courseId={c.id}
              title={c.title ?? c.name}
              details={[c.teacher, c.title ? c.name : undefined].filter(Boolean).join(" · ")}
              source="yuketang"
              stats={yktCardStats.get(c.id) ?? { hw: 0, notices: 0, files: 0 }}
              audited={c.audited}
              onOpen={() => {
                setYktCourse({ id: c.id, name: c.name });
                navigate("learn-ykt-course", { extCourseId: c.id, extCourseName: c.name });
              }}
              onOpenSection={(courseTab) => {
                setYktCourse({ id: c.id, name: c.name });
                navigate("learn-ykt-course", { extCourseId: c.id, extCourseName: c.name, courseTab });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
