/** 文件详情（learnX FileDetail）：类型/大小/说明 + 下载占位按钮 */
import { useMemo, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { IconDownload } from "../../components/Icons.js";
import { useApp } from "../../state/context.js";
import { useLearnData } from "../../state/data.js";
import { BackButton, InfoRow, fmtDateTime, learnFileName } from "./shared.js";
import { downloadLearnFile } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { LEARN_FILE_DOWNLOAD } from "@onethu/core";

export function FileDetailPage() {
  const { navParams } = useApp();
  const { data, state, error, reload } = useLearnData();
  const [hint, setHint] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const courseId = navParams?.courseId ?? "";
  const itemId = navParams?.itemId ?? "";

  const f = useMemo(
    () => data?.files.find((x) => x.courseId === courseId && x.id === itemId) ?? null,
    [data, courseId, itemId],
  );
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [data, courseId]);

  const doDownload = async () => {
    if (!f) return;
    setDownloading(true);
    setHint(null);
    try {
      // 落盘名 = title + "." + fileType（title 已带该后缀则不重复；mobile fs.downloadFile 同构）
      const path = await downloadLearnFile(f.id, learnFileName(f.title || `learn-file-${f.id}`, f.fileType));
      setHint(`已下载到：${path}`);
    } catch (err) {
      setHint("下载失败：" + explainNetworkError(err));
    } finally {
      setDownloading(false);
    }
  };

  if (!f) {
    return (
      <>
        <PageHead title="文件详情" actions={<><BackButton to={navParams?.from ?? "learn-files"} courseId={navParams?.courseId} courseTab="files" /></>} />
        {state === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state === "error" ? (
          <ErrorNote text={error ?? ""} onRetry={() => void reload()} />
        ) : (
          <Card><Empty text="未找到该文件，可能数据已刷新，请返回列表重试。" /></Card>
        )}
      </>
    );
  }

  return (
    <>
      <PageHead
        title={f.title}
        meta={`${course?.name ?? "课程"}${course?.teacherName ? ` · ${course.teacherName}` : ""} · 上传于 ${fmtDateTime(f.uploadTime)}`}
        actions={
          <>
            <BackButton to={navParams?.from ?? "learn-files"} courseId={navParams?.courseId} courseTab="files" />
            <CollectStar
              atom={{ kind: "file", key: enc(f.courseId, f.id, f.title, course?.name ?? "") }}
              title={f.title}
            />
            <button
              className="btn"
              onClick={() => openFilePreview({ name: learnFileName(f.title || `课件 ${f.id}`, f.fileType), url: LEARN_FILE_DOWNLOAD(f.id) })}
            >
              预览
            </button>
            <button
              className="btn btn-primary"
              disabled={downloading}
              onClick={() => void doDownload()}
            >
              <IconDownload width={14} height={14} />
              {downloading ? "下载中…" : "下载"}
            </button>
          </>
        }
      />

      {hint ? (
        <div className="error-note" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{hint}</span>
        </div>
      ) : null}

      <Card className="list">
        <InfoRow label="文件类型" value={f.fileType ? f.fileType.toUpperCase() : "未知"} />
        <InfoRow label="文件大小" value={f.size ?? "暂无信息"} />
        <InfoRow label="所属课程" value={course?.name ?? "课程"} />
        <InfoRow label="上传时间" value={fmtDateTime(f.uploadTime)} />
        <InfoRow label="说明" value={f.description ?? "暂无说明"} />
      </Card>
    </>
  );
}
