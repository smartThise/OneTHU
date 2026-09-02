/** 通知只读详情（learnX NoticeDetail）：标题/发布者/正文富文本 + 附件下载 */
import { useEffect, useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconDownload } from "../../components/Icons.js";
import { learn, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, RichContent, fmtDateTime } from "./shared.js";
import { openExternal } from "../info/openExternal.js";
import type { LearnAttachment } from "@onethu/core";

export function NoticeDetailPage() {
  const { navParams, status } = useApp();
  const { data, state, error, reload } = useLearnData();
  const [att, setAtt] = useState<LearnAttachment | null>(null);
  const [attState, setAttState] = useState<"idle" | "loading" | "ok" | "error" | "skip">("idle");
  const [attErr, setAttErr] = useState("");
  const [dlHint, setDlHint] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const courseId = navParams?.courseId ?? "";
  const itemId = navParams?.itemId ?? "";

  const n = useMemo(
    () => data?.notifications.find((x) => x.courseId === courseId && x.id === itemId) ?? null,
    [data, courseId, itemId],
  );
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [data, courseId]);

  // 附件地址懒加载：fjmc 只有文件名，下载地址在详情 HTML 页（thu-learn-lib parseNotificationDetail）
  useEffect(() => {
    if (!n || !n.attachmentName || attState !== "idle") return;
    if (status === "demo") {
      setAttState("skip"); // 演示模式不打真实接口
      return;
    }
    setAttState("loading");
    learn
      .getNotificationPageDetail(courseId, n.id)
      .then((d) => {
        setAtt(d.attachment ?? null);
        setAttState("ok");
      })
      .catch((err) => {
        setAttErr(explainNetworkError(err));
        setAttState("error");
      });
  }, [n, attState, courseId, status]);

  const doDownload = async (a: LearnAttachment) => {
    setDownloading(true);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(a.downloadUrl, a.name || `learn-attachment-${a.id}`);
      setDlHint(`已下载到：${path}`);
    } catch (err) {
      setDlHint("下载失败：" + explainNetworkError(err));
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
        <PageHead title="通知详情" actions={<BackButton to={navParams?.from ?? "learn-notices"} courseId={navParams?.courseId} courseTab="notices" />} />
        {state === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state === "error" ? (
          <ErrorNote text={error ?? ""} onRetry={() => void reload()} />
        ) : (
          <Card><Empty text="未找到该通知，可能数据已刷新，请返回列表重试。" /></Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHead
        title={n.title}
        meta={`${course?.name ?? "课程"} · ${n.publisher} 发布于 ${fmtDateTime(n.publishTime)}`}
        actions={
          <>
            <BackButton to={navParams?.from ?? "learn-notices"} courseId={navParams?.courseId} courseTab="notices" />
            <button className="btn" onClick={() => void openExternal(n.url)} title="在系统浏览器打开">
              网页端打开
            </button>
          </>
        }
      />

      <Card className="detail-head">
        <div className="chips">
          {n.important ? (
            <span className="chip chip-red"><span className="dot" />重要</span>
          ) : null}
          {n.hasRead === false ? (
            <span className="chip chip-blue"><span className="dot" />未读</span>
          ) : null}
        </div>
        {n.expireTime ? (
          <div className="detail-meta">过期时间 {fmtDateTime(n.expireTime)}</div>
        ) : null}
      </Card>

      {n.attachmentName ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">附件</div>
          {attState === "loading" ? <div className="detail-meta">正在解析附件…</div> : null}
          {attState === "error" ? (
            <div className="kv kv-wide">
              <span>附件</span>
              <span className="t-red">{attErr}</span>
              <button className="btn btn-ghost" onClick={retryAtt}>重试</button>
            </div>
          ) : null}
          {attState === "ok" || attState === "skip" ? (
            att ? (
              <div className="kv kv-wide">
                <span>{att.name || n.attachmentName}{att.size ? `（${att.size}）` : ""}</span>
                <button
                  className="btn btn-ghost"
                  onClick={() => openFilePreview({ name: att.name || n.attachmentName || "通知附件", url: att.downloadUrl })}
                >
                  预览
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={downloading}
                  onClick={() => void doDownload(att)}
                >
                  <IconDownload width={14} height={14} />
                  {downloading ? "下载中…" : "下载"}
                </button>
              </div>
            ) : (
              <div className="kv kv-wide">
                <span>{n.attachmentName}</span>
                <span className="chip chip-gray">{attState === "skip" ? "演示数据（网页端下载）" : "网页端下载"}</span>
              </div>
            )
          ) : null}
        </Card>
      ) : null}

      {dlHint ? (
        <div className="error-note" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{dlHint}</span>
        </div>
      ) : null}

      <Card className="detail-sec">
        <div className="detail-sec-head">正文</div>
        <RichContent html={n.content} fallback="暂无通知正文。" />
      </Card>
    </>
  );
}
