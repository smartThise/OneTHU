/** 通知只读详情（learnX NoticeDetail）：标题/发布者/正文富文本 + 附件下载 */
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
import { BackButton, RichContent, fmtDateTime } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { openExternal } from "../info/openExternal.js";
import { DownloadOpenButtons } from "../../components/DownloadOpenButtons.js";
import { markNoticeReadLocally, noticeHasRead, useNoticeReadVersion } from "../../lib/noticeRead.js";
import type { LearnAttachment } from "@onethu/core";

export function NoticeDetailPage() {
  useLearnNavSemester();
  const { navParams } = useApp();

  const { data, state, error, reload } = useLearnData();
  const [att, setAtt] = useState<LearnAttachment | null>(null);
  const [attState, setAttState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [attErr, setAttErr] = useState("");
  const [dlHint, setDlHint] = useState<{ text: string; path?: string } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const courseId = navParams?.courseId ?? "";
  const itemId = navParams?.itemId ?? "";

  const n = useMemo(
    () => data?.notifications.find((x) => x.courseId === courseId && x.id === itemId) ?? null,
    [data, courseId, itemId],
  );
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [data, courseId]);

  // R23：打开通知即置读（本地覆盖立即生效；服务端 sfyd 要等下次拉列表，且此前只有
  // 「有附件」的通知才会请求详情页 → 无附件的通知永远置不了读，表现为「点开还是未读」）
  useNoticeReadVersion(); // 订阅本地已读集合：置读后立即刷新「未读」chip（值本身不需要）
  useEffect(() => {
    if (n) markNoticeReadLocally(n.courseId, n.id);
  }, [n?.courseId, n?.id]);

  // 附件地址懒加载 + 置读：**总是**请求详情 HTML 页（thu-learn-lib parseNotificationDetail）。
  // 服务端在 beforeViewXs 上置读，这里不再以「有附件」为前置条件；无附件声明的通知抓取
  // 失败不打扰用户（静默当无附件）。
  useEffect(() => {
    if (!n || attState !== "idle") return;
    setAttState("loading");
    learn
      .getNotificationPageDetail(courseId, n.id)
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
  }, [n, attState, courseId]);

  const doDownload = async (a: LearnAttachment) => {
    setDownloading(true);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(a.downloadUrl, a.name || `learn-attachment-${a.id}`);
      setDlHint({ text: `已下载到：${path}`, path });
    } catch (err) {
      setDlHint({ text: "下载失败：" + explainNetworkError(err) });
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
            <CollectStar
              atom={{ kind: "notice", key: enc(n.courseId, n.id, n.title, course?.name ?? "", data?.semester.id ?? "") }}
              title={n.title}
            />
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
          {!noticeHasRead(n.hasRead, n.courseId, n.id) ? (
            <span className="chip chip-blue"><span className="dot" />未读</span>
          ) : null}
        </div>
        {n.expireTime ? (
          <div className="detail-meta">过期时间 {fmtDateTime(n.expireTime)}</div>
        ) : null}
      </Card>

      {n.attachmentName || att ? (
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
          {attState === "ok" ? (
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
                <span className="chip chip-gray">网页端下载</span>
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
        <div className="detail-sec-head">正文</div>
        <RichContent html={n.content} fallback="暂无通知正文。" />
      </Card>
    </>
  );
}
