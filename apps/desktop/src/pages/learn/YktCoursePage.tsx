/**
 * 雨课堂课程内容页（R25，learn-ykt-course）：把一门雨课堂课发布过的**全部内容**
 * 按类型列出来 —— 不止作业与试卷，还有课件、投票，以及接口将来新增的类型
 * （未知类型归「其他（类型 N）」，不会被丢掉）。
 *
 * 行点击分流：
 *  - 作业 / 试卷：沿用作业行（openHomeworkRow 唯一通道）→ 站内原生详情页；
 *    列表里没匹配到作业条目时（例如超出作业同步的 N 天窗口）退化为「打开网页」。
 *  - 其他类型（课件 / 投票 / 其他）：只读列出，点行或按钮都走官方网页
 *    （桌面系统浏览器 / 移动应用内 WebView，与外部作业出口同一分流）。
 *
 * 数据：state/exthw.ts 的 contents（全部内容）+ items（作业，带提交状态）。
 * 两者与「全部作业」同一轮刷新落地，本页**不额外打接口**。
 */
import { Fragment, useCallback, useMemo, useState } from "react";
import type { ExternalContent, Homework, YkLeafDetail, YkNoticeDetail } from "@onethu/core";
import { Card, Empty, ErrorNote, PageHead, SegmentedOverflow, SkeletonRows } from "../../components/Layout.js";
import { IconChevron, IconRefresh } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import {
  fetchYktLeafDetail,
  fetchYktNoticeDetail,
  getYktCookie,
  toExternalNotice,
  toHomework,
  useExternalHomework,
} from "../../state/exthw.js";
import { useIgnoredHw } from "../../state/hwIgnore.js";
import { getYktCourse } from "../../state/yktCourse.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { YktContentBody } from "../../components/exthw/YktContentBody.js";
import { BackButton, HomeworkRow, fmtWhenParts } from "./shared.js";

/** 已确认类型的展示顺序（未知类型排在其后，按类型名排序） */
const KNOWN_TAB_ORDER = ["作业", "试卷", "课件", "投票"];

export function YktCoursePage() {
  const { navigate, navParams } = useApp();
  const ext = useExternalHomework();
  const ignored = useIgnoredHw();
  const [tab, setTab] = useState<string>("all");
  /** 内联展开的内容（点行展开，正文就在行下方渲染——不打开官方页、不新开窗口） */
  const [open, setOpen] = useState<{
    id: string;
    title: string;
    state: "loading" | "ready" | "error";
    detail?: YkLeafDetail | YkNoticeDetail;
    error?: string;
  } | null>(null);

  // 课程标识：navParams 优先（深链 / 收藏），缺省回落「最近打开的课程」
  // （详情页返回不带参数，见 state/yktCourse.ts 的说明）
  const remembered = getYktCourse();
  const courseId = navParams?.extCourseId ?? remembered?.id ?? "";
  const fallbackName = navParams?.extCourseName ?? remembered?.name ?? "";
  const course = ext.courses.find((c) => c.source === "yuketang" && c.id === courseId);
  const courseName = course?.name || fallbackName || "雨课堂课程";
  /** 标题用课程本名（与官方卡片大标题一致），课堂全名放进 meta 副标题 */
  const courseTitle = course?.title ?? courseName;
  const courseSub = course?.title && course.name !== course.title ? course.name : "";

  /** 本课全部内容（含作业/试卷，与作业列表同源、同一轮刷新） */
  const contents = useMemo(
    () => ext.contents.filter((c) => c.source === "yuketang" && c.courseId === courseId),
    [ext.contents, courseId],
  );
  /** 本课作业（带提交状态/分数；点开走站内原生详情） */
  const homework = useMemo(
    () => ext.items.filter((i) => i.source === "yuketang" && i.classroomId === courseId).map(toHomework),
    [ext.items, courseId],
  );
  /** leaf_type_id → 作业条目（内容条目与作业条目对齐用） */
  const hwByLeaf = useMemo(() => {
    const m = new Map<string, Homework>();
    for (const h of homework) {
      if (h.externalLeafTypeId) m.set(h.externalLeafTypeId, h);
    }
    return m;
  }, [homework]);

  /** 按类型分栏（用 kindText 作键：未知类型各自成栏而不合并） */
  const groups = useMemo(() => {
    const m = new Map<string, ExternalContent[]>();
    for (const c of contents) {
      const list = m.get(c.kindText) ?? [];
      list.push(c);
      m.set(c.kindText, list);
    }
    const texts = [...m.keys()].sort((a, b) => {
      const ia = KNOWN_TAB_ORDER.indexOf(a);
      const ib = KNOWN_TAB_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return { map: m, texts };
  }, [contents]);

  /**
   * R32：本课公告的「站内通知详情页」id（= 全部通知页里那条公告的 id）。
   * 公告单独走通知详情页（与网络学堂通知同一套 UI），其余内容仍在行下方内嵌预览。
   */
  const noticeNavIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of contents) {
      if (c.kind === "announcement") m.set(c.id, toExternalNotice(c).id);
    }
    return m;
  }, [contents]);

  const shown = useMemo(() => {
    const list = tab === "all" ? contents : (groups.map.get(tab) ?? []);
    // 有时间的按时间倒序（新内容在前），无时间的保持原顺序排在后面
    return [...list].sort((a, b) => (b.deadline ?? "").localeCompare(a.deadline ?? ""));
  }, [contents, groups, tab]);

  const unfinished = homework.filter((h) => !h.submitted && !h.audited && !ignored.has(h.id)).length;
  const loading = ext.state !== "ready" && contents.length === 0;

  /**
   * 内容行点击（R27 内嵌渲染）：点行在**行下方**就地展开正文，不打开官方页、不新开窗口。
   *  ① 公告 → 拉公告详情（正文 HTML / 图片）；
   *  ② 课件·资料·视频 → 拉 leaf_info：文档直链直接走内置文件预览，其余（视频/图文）内联渲染。
   * 失败在面板内如实显示并可重试，不静默。
   */
  const openContent = useCallback(
    async (c: ExternalContent) => {
      if (open?.id === c.id) {
        setOpen(null); // 再点一次收起
        return;
      }
      setOpen({ id: c.id, title: c.title, state: "loading" });
      try {
        if (c.kind === "announcement") {
          // 正文若已随学习日志内联返回，直接用（省一次请求）
          if (c.inlineBodyHtml) {
            setOpen({
              id: c.id,
              title: c.title,
              state: "ready",
              detail: { bodyHtml: c.inlineBodyHtml, shape: ["inline"] },
            });
            return;
          }
          // 公告 id 字段名不固定：优先用候选列表（与通知页同一口径）
          const ids = c.noticeIdCandidates?.length
            ? c.noticeIdCandidates
            : c.noticeId
              ? [c.noticeId]
              : [];
          if (ids.length === 0) {
            setOpen({ id: c.id, title: c.title, state: "error", error: "这条公告没有取到可用的内容标识。" });
            return;
          }
          const d = await fetchYktNoticeDetail(c.courseId, ids);
          if (!d.bodyHtml && !d.images?.length) {
            setOpen({ id: c.id, title: c.title, state: "error", error: "没取到这条公告的正文，请稍后重试。" });
            return;
          }
          setOpen({ id: c.id, title: c.title, state: "ready", detail: d });
          return;
        }
        if (c.leafId) {
          const d = await fetchYktLeafDetail(c.courseId, c.leafId);
          // 文档类直接交给内置文件预览（本身就是应用内覆盖层，可翻页/缩放/另存）
          if (d.fileUrl) {
            openFilePreview({ name: d.title ?? c.title, url: d.fileUrl });
            setOpen(null);
            return;
          }
          setOpen({ id: c.id, title: c.title, state: "ready", detail: d });
          return;
        }
        setOpen({
          id: c.id,
          title: c.title,
          state: "error",
          error: "这条内容没有可内嵌渲染的正文。",
        });
      } catch (e) {
        setOpen({
          id: c.id,
          title: c.title,
          state: "error",
          error: e instanceof Error ? e.message : "加载失败，请重试。",
        });
      }
    },
    [open],
  );

  return (
    <>
      <PageHead
        title={courseTitle}
        meta={`雨课堂${courseSub ? ` · ${courseSub}` : ""}${course?.teacher ? ` · ${course.teacher}` : ""} · ${contents.length} 项内容${
          unfinished > 0 ? ` · 未交 ${unfinished}` : ""
        }`}
        actions={
          <>
            <BackButton to="learn" label="课程列表" />
            <button
              className="btn btn-ghost"
              onClick={() => navigate("learn-assignments", { extCourseId: courseId, extCourseName: courseName })}
            >
              只看作业
            </button>
            <button className="btn" onClick={() => ext.reload()} disabled={ext.state === "loading"}>
              <IconRefresh width={14} height={14} />
              刷新
            </button>
          </>
        }
      />

      <div className="row-sub" style={{ margin: "0 0 10px" }}>
        这里列出这门课的全部内容：作业与试卷点开是站内详情，课件、视频、资料直接在应用内预览。
      </div>

      {ext.errors.yuketang ? <ErrorNote text={ext.errors.yuketang} onRetry={() => ext.reload()} /> : null}

      {contents.length > 0 ? (
        <SegmentedOverflow>
          <button role="tab" aria-selected={tab === "all"} className={tab === "all" ? "is-active" : ""} onClick={() => setTab("all")}>
            全部
            <span className="tab-count">{contents.length}</span>
          </button>
          {groups.texts.map((text) => (
            <button
              key={text}
              role="tab"
              aria-selected={tab === text}
              className={tab === text ? "is-active" : ""}
              onClick={() => setTab(text)}
            >
              {text}
              <span className="tab-count">{groups.map.get(text)?.length ?? 0}</span>
            </button>
          ))}
        </SegmentedOverflow>
      ) : null}

      {loading ? (
        <SkeletonRows rows={5} />
      ) : shown.length === 0 ? (
        <Card>
          <Empty
            text={
              contents.length === 0
                ? "这门课暂时没有取到内容，或数据还没就绪。"
                : "该类型暂无内容。"
            }
          />
        </Card>
      ) : (
        <Card className="list">
          {shown.map((c, i) => {
            const hw = c.leafTypeId ? hwByLeaf.get(c.leafTypeId) : undefined;
            if (hw) {
              return (
                <HomeworkRow
                  key={c.id}
                  h={hw}
                  courseName={courseName}
                  from="learn-ykt-course"
                  style={{ animationDelay: `${i * 20}ms` }}
                />
              );
            }
            const when = fmtWhenParts(c.deadline);
            const noticeNavId = noticeNavIds.get(c.id);
            // 公告：进与网络学堂通知同一个站内详情页（R32）；其余内容：行下方内嵌预览
            const toggle = () =>
              noticeNavId
                ? navigate("learn-notice-detail", { courseId: c.courseId, itemId: noticeNavId, from: "learn-ykt-course" })
                : void openContent(c);
            const isOpen = open?.id === c.id;
            const detail =
              isOpen && open?.state === "ready"
                ? (open.detail as Partial<YkLeafDetail & YkNoticeDetail> | undefined)
                : undefined;
            return (
              <Fragment key={c.id}>
              <div
                className="row row-click"
                style={{ animationDelay: `${i * 20}ms` }}
                role="button"
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(e) => e.key === "Enter" && toggle()}
              >
                <div className="row-when">
                  <b>{when.date || "—"}</b>
                  <span>{when.time}</span>
                </div>
                <div className="row-main">
                  <div className="row-title">{c.title}</div>
                  <div className="row-sub">
                    {c.courseName} ·{" "}
                    {noticeNavId
                      ? "点击查看公告"
                      : isOpen && open?.state === "loading"
                        ? "正在加载…"
                        : isOpen
                          ? "点击收起"
                          : "点击内嵌预览"}
                  </div>
                </div>
                <span className="chip chip-gray">{c.kindText}</span>
                <IconChevron className="row-caret" width={14} height={14} />
              </div>
              {isOpen ? (
                <div className="ykt-content-panel">
                  {open?.state === "loading" ? (
                    <div className="row-sub">正在加载内容…</div>
                  ) : open?.state === "error" ? (
                    <div className="row-sub">{open.error}</div>
                  ) : (
                    <YktContentBody
                      title={detail?.title ?? c.title}
                      mediaUrl={detail?.mediaUrl}
                      fileUrl={detail?.fileUrl}
                      images={detail?.images}
                      bodyHtml={detail?.bodyHtml}
                      cookies={getYktCookie()}
                      fallbackUrl={c.url}
                    />
                  )}
                </div>
              ) : null}
              </Fragment>
            );
          })}
        </Card>
      )}
    </>
  );
}
