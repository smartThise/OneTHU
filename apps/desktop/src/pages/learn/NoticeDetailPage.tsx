import { courseDisplayName } from "../../lib/learnLanguage.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { vaultCatchAttachment } from "../../lib/vaultCatch.js";
import { Btn } from "@onethu/gui";
/**
 * 通知只读详情（learnX NoticeDetail）：标题/发布者/正文富文本 + 附件下载。
 *
 * R32：雨课堂公告**复用同一个页面、同一套 UI**（用户要求「点击后也显示相同 ui 的界面」），
 * 点击行为与网络学堂通知完全一致；差别只在正文来源（雨课堂 topic 详情）与没有附件区。
 * 仍不开官方页（页头「网页端打开」按钮保留给确有需要时用）。
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { IconDownload } from "../../components/Icons.js";
import { learn, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { withLearnRecovery } from "../../lib/reload.js";
import { BackButton, RichContent, fmtDateTime } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { openExternal } from "../info/openExternal.js";
import { DownloadOpenButtons } from "../../components/DownloadOpenButtons.js";
import { markNoticeReadLocally, noticeHasRead, useNoticeReadVersion } from "../../lib/noticeRead.js";
import {
  fetchYktNoticeDetail,
  getExternalNoticeRef,
  getYktCookie,
  isExternalNoticeId,
  useExternalHomework,
  useExternalNotices,
} from "../../state/exthw.js";
import { YktContentBody } from "../../components/exthw/YktContentBody.js";
import type { LearnAttachment } from "@onethu/core";

export function NoticeDetailPage() {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
  const { navParams, navigate } = useApp();

  const { data, state, error, reload } = useLearnData();
  const [att, setAtt] = useState<LearnAttachment | null>(null);
  const [attState, setAttState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [attErr, setAttErr] = useState("");
  const [dlHint, setDlHint] = useState<{ text: string; path?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const courseId = navParams?.courseId ?? "";
  const itemId = navParams?.itemId ?? "";

  const ext = useExternalHomework();
  /** R32：雨课堂公告并入同一列表后，详情页也要能按 id 找到它（未登录为空数组） */
  const extNotices = useExternalNotices();
  const isExt = isExternalNoticeId(itemId);

  /** 雨课堂公告正文（点开才拉；已随学习日志内联返回时直接用，省一次请求） */
  const [extBody, setExtBody] = useState<{
    id: string;
    state: "loading" | "ready" | "error";
    title?: string;
    bodyHtml?: string;
    images?: string[];
    error?: string;
  } | null>(null);

  const n = useMemo(
    () =>
      isExt
        ? (extNotices.find((x) => x.id === itemId) ?? null)
        : (data?.notifications.find((x) => x.courseId === courseId && x.id === itemId) ?? null),
    [uiLocale, data, extNotices, isExt, courseId, itemId],
  );
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [uiLocale, data, courseId]);
  /* 外部公告的课程名：导航参数可能是网络学堂课程 id（合并课程页进入），也可能是雨课堂课堂 id */
  const extCourseName = useMemo(
    () => ext.courses.find((c) => c.id === courseId)?.name ?? "",
    [uiLocale, ext.courses, courseId],
  );

  // R23：打开通知即置读（本地覆盖立即生效；服务端 sfyd 要等下次拉列表，且此前只有
  // 「有附件」的通知才会请求详情页 → 无附件的通知永远置不了读，表现为「点开还是未读」）
  useNoticeReadVersion(); // 订阅本地已读集合：置读后立即刷新「未读」chip（值本身不需要）
  useEffect(() => {
    if (n) markNoticeReadLocally(n.courseId, n.id);
  }, [n?.courseId, n?.id]);

  /* R32：外部公告正文懒加载（与列表页同一条取正文链路） */
  useEffect(() => {
    if (!isExt || !n) return;
    let cancelled = false;
    const ref = getExternalNoticeRef(n.id);
    if (!ref || (ref.ids.length === 0 && !ref.inlineBodyHtml)) {
      setExtBody({
        id: n.id,
        state: "error",
        error: i18n("pages.learn.noticedetailpage.0b1f80e0a761"),
      });
      return;
    }
    if (ref.inlineBodyHtml) {
      setExtBody({ id: n.id, state: "ready", bodyHtml: ref.inlineBodyHtml });
      return;
    }
    setExtBody({ id: n.id, state: "loading" });
    void fetchYktNoticeDetail(ref.courseId, ref.ids)
      .then((d) => {
        if (cancelled) return;
        if (!d.bodyHtml && !d.images?.length) {
          setExtBody({ id: n.id, state: "error", error: i18n("pages.learn.noticedetailpage.ddbd641e1d5c") });
          return;
        }
        setExtBody({
          id: n.id,
          state: "ready",
          ...(d.title ? { title: d.title } : {}),
          ...(d.bodyHtml ? { bodyHtml: d.bodyHtml } : {}),
          ...(d.images ? { images: d.images } : {}),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setExtBody({
          id: n.id,
          state: "error",
          error: err instanceof Error ? err.message : i18n("pages.learn.noticedetailpage.41c25a38d92f"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isExt, n?.id]);

  // 附件地址懒加载 + 置读：**总是**请求详情 HTML 页（thu-learn-lib parseNotificationDetail）。
  // 服务端在 beforeViewXs 上置读，这里不再以「有附件」为前置条件；无附件声明的通知抓取
  // 失败不打扰用户（静默当无附件）。
  useEffect(() => {
    // 外部公告没有网络学堂附件区（正文走雨课堂链路），不进这条流程
    if (!n || isExt || attState !== "idle") return;
    setAttState("loading");
    withLearnRecovery(() => learn.getNotificationPageDetail(courseId, n.id, n.attachmentName))
      .then((d) => {
        setAtt(d.attachment ?? null);
        setAttState("ok");
      })
      .catch((err) => {
        if (!n.attachmentName) {
          setAttState("ok"); // 只为置读/兜底找附件，失败静默
          return;
        }
        setAttErr(explainNetworkError(err));
        setAttState("error");
      });
  }, [n, isExt, attState, courseId]);

  const doDownload = async (a: LearnAttachment) => {
    setDownloading(true);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(a.downloadUrl, a.name || `learn-attachment-${a.id}`);
      setDlHint({ text: i18n("pages.learn.noticedetailpage.2d2ab24375ce", { path: String(path) }), path });
    } catch (err) {
      setDlHint({ text: i18n("pages.learn.noticedetailpage.90f9253844e7") + explainNetworkError(err) });
    } finally {
      setDownloading(false);
    }
  };

  const retryAtt = () => {
    setAttErr("");
    setAttState("idle");
  };

  if (!n) {
    return (
      <>
        <PageHead title={i18n("pages.learn.noticedetailpage.483fe390159f")} actions={<BackButton to={navParams?.from ?? "learn-notices"} courseId={navParams?.courseId} courseTab="notices" />} />
        {state === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state === "error" ? (
          <ErrorNote text={error ?? ""} onRetry={() => void reload()} />
        ) : (
          <Card><Empty
            text={i18n("pages.learn.noticedetailpage.14d6bc26a4f0")}
            action={<Btn variant="ghost" onClick={() => navigate(navParams?.from ?? "learn-notices")}>{i18n("pages.learn.noticedetailpage.e9d5ca6c1406")}</Btn>}
          /></Card>
        )}
      </>
    );
  }

  /* 元信息一行两来源同构：网络学堂 =「课程 · 发布者 发布于 时间」，
     雨课堂 =「课程 · 雨课堂 发布于 时间」（发布者只有来源名，公告没有发布人字段） */
  const publishedAt = fmtDateTime(n.publishTime);
  const metaText = isExt
    ? i18n("pages.learn.noticedetailpage.7182c4b99b54", { value: String(courseDisplayName(course) ?? extCourseName ?? i18n("pages.learn.noticedetailpage.261255a76c11")), value2: String(publishedAt ? i18n("pages.learn.noticedetailpage.81b4e2f43a29", { publishedAt: String(publishedAt) }) : "") })
    : i18n("pages.learn.noticedetailpage.18bb69cac446", { value: String(courseDisplayName(course) ?? i18n("pages.learn.noticedetailpage.60db1afb4022")), publisher: String(n.publisher), publishedAt: String(publishedAt) });

  return (
    <>
      <PageHead
        title={n.title}
        meta={metaText}
        actions={
          <>
            <BackButton to={navParams?.from ?? "learn-notices"} courseId={navParams?.courseId} courseTab="notices" />
            <CollectStar
              atom={{ kind: "notice", key: enc(n.courseId, n.id, n.title, course?.name ?? "", data?.semester.id ?? "") }}
              title={n.title}
            />
            {/* 外源公告的官方链接可能缺（源侧没给 id），没有链接就不放一个点了没反应的按钮 */}
            {n.url ? (
              <Btn variant="outline" onClick={() => void openExternal(n.url)} titleAttr={i18n("pages.learn.noticedetailpage.81ce4f7cb8ae")}>{i18n("pages.learn.noticedetailpage.16f19a676cae")}</Btn>
            ) : null}
          </>
        }
      />

      <Card className="detail-head">
        <div className="chips">
          {n.important ? (
            <span className="chip chip-red"><span className="dot" />{i18n("pages.learn.noticedetailpage.a8cd9642aa48")}</span>
          ) : null}
          {!noticeHasRead(n.hasRead, n.courseId, n.id) ? (
            <span className="chip chip-blue"><span className="dot" />{i18n("pages.learn.noticedetailpage.4d0680f9efae")}</span>
          ) : null}
        </div>
        {n.expireTime ? (
          <div className="detail-meta">{i18nRich("pages.learn.noticedetailpage.23f691e9bb15", { value: fmtDateTime(n.expireTime) })}</div>
        ) : null}
      </Card>

      {n.attachmentName || att ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">{i18n("pages.learn.noticedetailpage.c7225dbf105e")}</div>
          {attState === "loading" ? <div className="detail-meta">{i18n("pages.learn.noticedetailpage.39d0d9a70496")}</div> : null}
          {attState === "error" ? (
            <div className="kv kv-wide">
              <span>{i18n("pages.learn.noticedetailpage.c7225dbf105e")}</span>
              <span className="t-red">{attErr}</span>
              <Btn variant="ghost" onClick={retryAtt}>{i18n("pages.learn.noticedetailpage.b8784c8dd563")}</Btn>
            </div>
          ) : null}
          {attState === "ok" ? (
            att ? (
              <div className="kv kv-wide" data-vault-catch={vaultCatchAttachment({ kind: "learn", name: att.name || n.attachmentName || i18n("pages.learn.noticedetailpage.5f1b405cf06f"), url: att.downloadUrl, label: i18n("pages.learn.noticedetailpage.5f1b405cf06f") })}>
                <span>{att.name || n.attachmentName}{att.size ? `（${att.size}）` : ""}</span>
                <Btn variant="ghost" onClick={() => openFilePreview({ name: att.name || n.attachmentName || i18n("pages.learn.noticedetailpage.5f1b405cf06f"), url: att.downloadUrl })}>{i18n("pages.learn.noticedetailpage.13d61fea9f17")}</Btn>
                <Btn variant="ghost" disabled={downloading} onClick={() => void doDownload(att)}><IconDownload width={14} height={14} />{downloading ? i18n("pages.learn.noticedetailpage.bcc2333dc631") : i18n("pages.learn.noticedetailpage.4673a2306165")}</Btn>
              </div>
            ) : (
              <div className="kv kv-wide">
                <span>{n.attachmentName}</span>
                <span className="chip chip-gray">{i18n("pages.learn.noticedetailpage.bf44c9de16e4")}</span>
              </div>
            )
          ) : null}
        </Card>
      ) : null}

      {dlHint ? (
        <div className="error-note dl-done-note" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{dlHint.text}</span>
          {/* R23：下载完成就地给「打开文件/打开目录」（霖需求；失败态无 path 不渲染按钮） */}
          {dlHint.path ? <DownloadOpenButtons path={dlHint.path} /> : null}
        </div>
      ) : null}

      <Card className="detail-sec">
        <div className="detail-sec-head">{i18n("pages.learn.noticedetailpage.d661c3d96d53")}</div>
        {isExt ? (
          /* R32：雨课堂公告正文就地渲染（图片/字体走既有代理），不做静默空白 */
          !extBody || extBody.state === "loading" ? (
            <div className="detail-meta">{i18n("pages.learn.noticedetailpage.558ea95af4a2")}</div>
          ) : extBody.state === "error" ? (
            <div className="detail-meta t-red">{extBody.error}</div>
          ) : (
            <YktContentBody
              title={extBody.title ?? n.title}
              images={extBody.images}
              bodyHtml={extBody.bodyHtml}
              cookies={getYktCookie()}
              fallbackUrl={n.url}
            />
          )
        ) : (
          <RichContent html={n.content} fallback={i18n("pages.learn.noticedetailpage.03025a45ae40")} />
        )}
      </Card>
    </>
  );
}
