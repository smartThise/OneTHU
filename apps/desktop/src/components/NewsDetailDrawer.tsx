/**
 * 新闻详情抽屉（M5 · D7，霖 2026-10-02）。
 *
 * 由来：新闻详情原本写死在 `pages/info/NewsTab.tsx` 里，是「顶天立地」的右侧栏
 * （`width: min(720px, 94vw)` + `borderRight: none`）。D7 要求：待办页点新闻项**不跳页**，
 * 在当前页弹同一个详情；PC 的右侧面板留 16–24px 页边距；手机改**底部抽屉**、可下拉关闭，
 * 且底栏保持可见；新闻页与待办页共用同一套进出场。
 *
 * 所以把它抽成本组件（正文取数、附件下载、错误重试、返回键关闭全在这里，调用方只喂
 * 一条 `detail` 与 `onClose`）。**不要再退回内联实现**——两份实现必然分叉。
 *
 * 分层（`styles/global.css` 的 `.news-drawer-*`）：
 *   PC：遮罩 `.news-drawer-mask` 用 flex 右对齐 + 20px 内边距 → 面板四周留边；
 *   手机（`@media (max-width: 839.98px)`）：改底部抽屉（顶部圆角 + 下拉把手），
 *   遮罩 `z-index: 50` **低于底栏的 60**，所以底栏不会被盖住；面板底部再垫一段
 *   `--news-drawer-lift`，避免内容被底栏压住。
 *
 * 返回键：`useOverlayBack`（E1 的浮层帧）——返回键先关它，再退页帧。
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NewsDetail, NewsItem } from "@onethu/core";
import { ErrorNote, SkeletonRows } from "./Layout.js";
import { DownloadOpenButtons } from "./DownloadOpenButtons.js";
import { RichContent } from "../pages/learn/shared.js";
import { openFilePreview } from "./FilePreview.js";
import { downloadLearnUrl } from "../lib/clients.js";
import { explainNetworkError } from "../lib/transport.js";
import { useOverlayBack } from "../state/navStack.js";
import { IconDownload, IconExternal } from "./Icons.js";
import { openExternal } from "../pages/info/openExternal.js";

/** 详情状态：调用方负责取数，本组件只负责渲染 */
export interface NewsDetailState {
  item: NewsItem;
  state: "loading" | "ok" | "error";
  data?: NewsDetail;
  err?: string;
}

/** 抽屉的浮层帧 id（E1）：同一个 id 只登记一帧，NewsTab 与待办页不会互相顶掉 */
export const NEWS_DETAIL_OVERLAY_ID = "news-detail";

/** PC 面板页边距（D7：16–24px，这里取 20px；护栏断言这个常量） */
export const NEWS_DRAWER_MARGIN = 20;

/** 下拉关闭的触发距离（手机） */
const DRAG_CLOSE_PX = 88;

export function NewsDetailDrawer({
  detail,
  onClose,
  onRetry,
}: {
  detail: NewsDetailState | null;
  onClose: () => void;
  /** 取数失败时的重试：调用方手里有 item（NewsTab 的 openDetail） */
  onRetry: (item: NewsItem) => void;
}) {
  /* 附件下载：状态跟着抽屉走（换一条新闻就重置，避免上一条的下载提示串台） */
  const [dlAtt, setDlAtt] = useState<string | null>(null);
  const [dlHint, setDlHint] = useState<{ text: string; path?: string } | null>(null);
  const xxid = detail?.item.xxid ?? "";
  useEffect(() => {
    setDlAtt(null);
    setDlHint(null);
  }, [xxid]);

  /* E1：返回键先关抽屉（浮层帧）。open 用 !!detail，关闭途中不留帧 */
  useOverlayBack(NEWS_DETAIL_OVERLAY_ID, detail !== null, onClose);

  /* 手机下拉关闭：把手拖过阈值就关（PC 没有把手，这段不会触发） */
  const dragFrom = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(false), [xxid]);

  const doDownloadAtt = async (url: string, name: string): Promise<void> => {
    if (dlAtt) return;
    setDlAtt(url);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(url, name || "news-attachment");
      setDlHint({ text: `已下载到：${path}`, path });
    } catch (err: unknown) {
      setDlHint({ text: "下载失败：" + explainNetworkError(err) });
    } finally {
      setDlAtt(null);
    }
  };

  if (!detail) return null;
  return createPortal(
    <div className="news-drawer-mask" onClick={onClose}>
      <div
        className={"news-drawer-panel" + (settled ? " is-settled" : "")}
        data-news-drawer=""
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={() => setSettled(true)}
      >
        {/* 手机下拉把手（PC 隐藏）：按住往下拖过 88px 关闭 */}
        <div
          className="news-drawer-grip"
          aria-hidden="true"
          onPointerDown={(e) => {
            dragFrom.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragFrom.current === null) return;
            setDragY(Math.max(0, e.clientY - dragFrom.current));
          }}
          onPointerUp={() => {
            const dy = dragY;
            dragFrom.current = null;
            setDragY(0);
            if (dy > DRAG_CLOSE_PX) onClose();
          }}
          onPointerCancel={() => {
            dragFrom.current = null;
            setDragY(0);
          }}
        >
          <span className="news-drawer-grip-bar" />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.45 }}>
            {detail.item.name || detail.data?.title || "新闻详情"}
          </h2>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {detail.item.url ? (
              <button className="btn" onClick={() => void openExternal(detail.item.url!)}>
                <IconExternal width={14} height={14} />
                在浏览器打开
              </button>
            ) : null}
            <button className="btn btn-ghost" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
          {[detail.item.source, detail.item.date].filter(Boolean).join(" · ")}
        </div>
        {detail.state === "loading" ? (
          <SkeletonRows rows={6} />
        ) : detail.state === "error" ? (
          <ErrorNote text={detail.err ?? ""} onRetry={() => onRetry(detail.item)} />
        ) : (
          <>
            <RichContent html={detail.data?.html} fallback="正文为空。" />
            {detail.data && detail.data.attachments.length > 0 ? (
              <div
                style={{
                  marginTop: 14,
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                  附件（{detail.data.attachments.length}）
                </div>
                {detail.data.attachments.map((a, i) => (
                  <div key={`${i}-${a.url}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flexShrink: 0 }}>📄</span>
                    <span style={{ flex: 1, fontSize: 13, overflowWrap: "anywhere" }} title={a.name}>
                      {a.name}
                    </span>
                    <button
                      className="btn btn-ghost"
                      onClick={() => openFilePreview({ name: a.name, url: a.url })}
                    >
                      预览
                    </button>
                    <button
                      className="btn btn-ghost"
                      disabled={dlAtt === a.url}
                      onClick={() => void doDownloadAtt(a.url, a.name)}
                    >
                      <IconDownload width={14} height={14} />
                      {dlAtt === a.url ? "下载中…" : "下载"}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {dlHint ? (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "var(--accent)",
                  overflowWrap: "anywhere",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <span>{dlHint.text}</span>
                {dlHint.path ? <DownloadOpenButtons path={dlHint.path} /> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
