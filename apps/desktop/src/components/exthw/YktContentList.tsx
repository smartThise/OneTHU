import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
/**
 * 雨课堂内容行列表（就地展开，R29）：课程详情页把雨课堂的「资料 → 文件」「公告 → 通知」
 * 并进网络学堂对应栏位后，用本组件渲染这些行，行为与雨课堂课程页一致：
 *  行点击 → 取叶详情/公告详情：文档直链走内置文件预览；视频/图片/HTML 正文就地展开；
 *  取不到正文时如实说明并给复制链接（不跳官方网页）。
 */
import { Fragment, useCallback, useState } from "react";
import type { ExternalContent, YkLeafDetail, YkNoticeDetail } from "@onethu/core";
import { ListWindow } from "../Layout.js";
import { IconChevron } from "../Icons.js";
import { fetchYktLeafDetail, fetchYktNoticeDetail, getYktCookie } from "../../state/exthw.js";
import { openExternalHomework } from "../../lib/extHwBrowse.js";
import { openFilePreview } from "../FilePreview.js";
import { YktContentBody } from "./YktContentBody.js";
import { fmtWhenParts } from "../../pages/learn/shared.js";

export function YktContentList({ items }: { items: ExternalContent[] }) {
  const uiLocale = useUiLocale();

  const [open, setOpen] = useState<{
    id: string;
    title: string;
    state: "loading" | "ready" | "error";
    detail?: YkLeafDetail | YkNoticeDetail;
    error?: string;
  } | null>(null);

  const toggle = useCallback(
    async (c: ExternalContent) => {
      if (open?.id === c.id) {
        setOpen(null);
        return;
      }
      // type 4「试卷」没有叶子正文可展开：直接打开雨课堂试卷页（未交→答题页，已交→成绩页）。
      if (c.kind === "quiz") {
        if (c.url) await openExternalHomework(c.url);
        return;
      }
      setOpen({ id: c.id, title: c.title, state: "loading" });
      try {
        if (c.kind === "announcement") {
          if (c.inlineBodyHtml) {
            setOpen({
              id: c.id,
              title: c.title,
              state: "ready",
              detail: { bodyHtml: c.inlineBodyHtml, shape: ["inline"] },
            });
            return;
          }
          const ids = c.noticeIdCandidates?.length ? c.noticeIdCandidates : c.noticeId ? [c.noticeId] : [];
          if (ids.length === 0) {
            setOpen({ id: c.id, title: c.title, state: "error", error: i18n("components.exthw.yktcontentlist.7965aadb4537") });
            return;
          }
          const d = await fetchYktNoticeDetail(c.courseId, ids);
          if (!d.bodyHtml && !d.images?.length) {
            setOpen({ id: c.id, title: c.title, state: "error", error: i18n("components.exthw.yktcontentlist.ddbd641e1d5c") });
            return;
          }
          setOpen({ id: c.id, title: c.title, state: "ready", detail: d });
          return;
        }
        if (c.leafId) {
          const d = await fetchYktLeafDetail(c.courseId, c.leafId);
          if (d.fileUrl) {
            openFilePreview({ name: d.title ?? c.title, url: d.fileUrl });
            setOpen(null);
            return;
          }
          setOpen({ id: c.id, title: c.title, state: "ready", detail: d });
          return;
        }
        setOpen({ id: c.id, title: c.title, state: "error", error: i18n("components.exthw.yktcontentlist.ca6001f90452") });
      } catch (e) {
        setOpen({
          id: c.id,
          title: c.title,
          state: "error",
          error: e instanceof Error ? e.message : i18n("components.exthw.yktcontentlist.dc91444c4449"),
        });
      }
    },
    [open],
  );

  return (
    <ListWindow>
      {items.map((c, i) => {
        const isOpen = open?.id === c.id;
        const detail =
          isOpen && open?.state === "ready"
            ? (open.detail as Partial<YkLeafDetail & YkNoticeDetail> | undefined)
            : undefined;
        const when = fmtWhenParts(c.deadline);
        return (
          <Fragment key={c.id}>
            <div
              className="row row-click"
              style={{ animationDelay: `${i * 25}ms` }}
              role="button"
              tabIndex={0}
              onClick={() => void toggle(c)}
              onKeyDown={(e) => e.key === "Enter" && void toggle(c)}
            >
              <div className="row-when">
                <b>{when.date || "—"}</b>
                <span>{when.time}</span>
              </div>
              <div className="row-main">
                <div className="row-title">{c.title}</div>
                <div className="row-sub">{i18nRich("components.exthw.yktcontentlist.f053f24bd333", { value: isOpen && open?.state === "loading" ? i18n("components.exthw.yktcontentlist.21bd738e0d71") : isOpen ? i18n("components.exthw.yktcontentlist.3afccd0197f6") : i18n("components.exthw.yktcontentlist.f0b19fcb3a58") })}</div>
              </div>
              <span className="chip chip-blue">{c.kindText}</span>
              <IconChevron className="row-caret" width={14} height={14} />
            </div>
            {isOpen ? (
              <div className="ykt-content-panel">
                {open?.state === "loading" ? (
                  <div className="row-sub">{i18n("components.exthw.yktcontentlist.2b1fde913dc6")}</div>
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
    </ListWindow>
  );
}
