/**
 * 雨课堂内容的**内嵌正文渲染**（R27）：按内容形态给出可用的内嵌呈现，绝不打开官方页。
 *
 * 渲染优先级（数据来自 core 的 leaf_info / 公告详情，字段名不固定故按形态识别）：
 *  ① 视频直链 → 内嵌 HLS/MP4 播放器（YktVideoPlayer）；
 *  ② 文档直链 → 「用内置预览打开」（FilePreview：PDF/Office/图片，可翻页缩放另存）；
 *  ③ 图片序列 → 内嵌逐页查看（图文/课件常见形态）；
 *  ④ HTML 正文 → 复用题干渲染器 ProblemBody（沙箱 iframe，字体/图片走既有代理）；
 *  ⑤ 都没有 → 如实说明「没有可直接渲染的正文」+ 复制直链，不做静默空白、也不偷偷跳官方页。
 */
import { useState } from "react";
import { ProblemBody } from "./ProblemBody.js";
import { YktVideoPlayer } from "./YktVideoPlayer.js";
import { openFilePreview } from "../FilePreview.js";
import { IconChevron } from "../Icons.js";

export interface YktContentBodyProps {
  /** 内容标题（列表标题优先，详情标题兜底） */
  title: string;
  /** 视频/媒体直链（m3u8 / mp4） */
  mediaUrl?: string;
  /** 文档直链（pdf / office / 压缩包） */
  fileUrl?: string;
  /** 图片序列（图文 / 课件） */
  images?: string[];
  /** HTML 正文（公告 / 图文说明） */
  bodyHtml?: string;
  /** 题干渲染需要的加密字体地址（叶详情里有则用） */
  fontUrl?: string;
  /** 雨课堂会话 Cookie（图片/字体代理用；仅内存传递） */
  cookies: string;
  /** 兜底直链（都没有可渲染内容时展示/复制） */
  fallbackUrl?: string;
}

export function YktContentBody(props: YktContentBodyProps) {
  const { title, mediaUrl, fileUrl, images, bodyHtml, fontUrl, cookies, fallbackUrl } = props;
  const [page, setPage] = useState(0);

  if (mediaUrl) {
    return (
      <div className="ykt-content-body">
        <YktVideoPlayer src={mediaUrl} title={title} />
      </div>
    );
  }

  if (fileUrl) {
    return (
      <div className="ykt-content-body">
        <button className="btn btn-primary" onClick={() => openFilePreview({ name: title, url: fileUrl })}>
          用内置预览打开
        </button>
        <div className="row-sub" style={{ marginTop: 8 }}>
          文档在应用内预览（可翻页 / 缩放 / 另存），不跳转官方网页。
        </div>
      </div>
    );
  }

  if (images && images.length > 0) {
    const idx = Math.min(page, images.length - 1);
    return (
      <div className="ykt-content-body">
        <div className="ykt-slide">
          <img className="ykt-slide-img" src={images[idx]} alt={`${title} 第 ${idx + 1} 页`} />
        </div>
        {images.length > 1 ? (
          <div className="ykt-slide-bar">
            <button className="btn btn-ghost" disabled={idx <= 0} onClick={() => setPage(idx - 1)}>
              <IconChevron width={14} height={14} style={{ transform: "rotate(180deg)" }} />
              上一页
            </button>
            <span className="ykt-slide-count">
              {idx + 1} / {images.length}
            </span>
            <button className="btn btn-ghost" disabled={idx >= images.length - 1} onClick={() => setPage(idx + 1)}>
              下一页
              <IconChevron width={14} height={14} />
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (bodyHtml) {
    return (
      <div className="ykt-content-body">
        <ProblemBody html={bodyHtml} fontUrl={fontUrl} cookies={cookies} title={title} />
      </div>
    );
  }

  return (
    <div className="ykt-content-body">
      <div className="ykt-ans-empty">
        这条内容没有可直接渲染的正文（可能是直播、讨论或需要互动的类型）。
        {fallbackUrl ? (
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard?.writeText(fallbackUrl).catch(() => undefined)}
          >
            复制链接
          </button>
        ) : null}
      </div>
    </div>
  );
}
