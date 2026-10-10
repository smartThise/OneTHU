/**
 * 内嵌 HLS/MP4 播放器（R27）：雨课堂视频是 HLS（m3u8），Chromium 内核不原生支持，
 * 因此按需动态加载 hls.js（仅视频内容才加载，不影响首屏体积）；mp4 直接交给 <video>。
 *
 * 不打开官方页、不在应用内 WebView 里播——真正的内嵌 <video>。
 * 失败态明确：错误文案 + 「复制直链」（用户仍可自行处置），不静默白屏。
 */
import { useEffect, useRef, useState } from "react";
import type HlsType from "hls.js";

export function YktVideoPlayer({ src, title }: { src: string; title?: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"loading" | "hls" | "direct" | "failed">("loading");

  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    let hls: HlsType | null = null;
    let cancelled = false;
    const isHls = /\.m3u8(?:[?#]|$)/i.test(src);
    const nativeHls = video.canPlayType("application/vnd.apple.mpegurl") !== "";

    if (isHls && !nativeHls) {
      void import("hls.js")
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setErr("当前环境不支持 HLS 播放，可复制直链用其它播放器打开。");
            setMode("failed");
            return;
          }
          hls = new Hls({ enableWorker: true, lowLatencyMode: false });
          hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            setErr(
              data.type === Hls.ErrorTypes.NETWORK_ERROR
                ? "视频分片加载失败（可能是地址已过期），请刷新后重试。"
                : "视频播放失败，请刷新后重试。",
            );
            setMode("failed");
            hls?.destroy();
          });
          hls.loadSource(src);
          hls.attachMedia(video);
          setMode("hls");
        })
        .catch(() => {
          setErr("播放组件加载失败，请重试。");
          setMode("failed");
        });
    } else {
      video.src = src;
      setMode("direct");
    }
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  const copy = () => {
    void navigator.clipboard?.writeText(src).catch(() => undefined);
  };

  return (
    <div className="ykt-video">
      {err ? (
        <div className="ykt-ans-empty">
          {err}
          <button className="btn btn-ghost" onClick={copy}>
            复制直链
          </button>
        </div>
      ) : null}
      {/* 失败时保留控件条以便用户重试；成功路径由 hls.js 或浏览器直接驱动 */}
      <video
        ref={ref}
        className="ykt-video-el"
        controls
        playsInline
        preload="metadata"
        title={title}
        style={mode === "failed" ? { display: "none" } : undefined}
      />
    </div>
  );
}
