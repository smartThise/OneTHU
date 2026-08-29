/**
 * 校内新闻页 —— getNews 列表 + getNewsDetail 站内预览（thu-info-lib news.ts 同源）。
 * 点击条目先在应用内看正文（NEWS_DETAIL?xxid=…&_csrf= → object.xxDto），
 * 再由用户选择「在系统浏览器打开」原链接。
 */
import { useState } from "react";
import type { NewsDetail, NewsItem } from "@onethu/core";
import { Card, Empty, ErrorNote, SectionHead, SkeletonRows } from "../../components/Layout.js";
import { IconExternal } from "../../components/Icons.js";
import { useNews } from "../../state/data.js";
import { info } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { RichContent } from "../learn/shared.js";
import { openExternal } from "./openExternal.js";

const PAGE_SIZE = 20;

interface DetailState {
  item: NewsItem;
  state: "loading" | "ok" | "error";
  data?: NewsDetail;
  err?: string;
}

function openHint(item: NewsItem): string {
  if (!item.url) return "无详情链接";
  return "在系统浏览器打开";
}

export function NewsTab() {
  const [page, setPage] = useState(1);
  const { data, state, error, reload } = useNews(page, PAGE_SIZE);
  const [detail, setDetail] = useState<DetailState | null>(null);

  const openDetail = (item: NewsItem) => {
    if (!item.xxid) {
      if (item.url) void openExternal(item.url);
      return;
    }
    setDetail({ item, state: "loading" });
    info
      .getNewsDetail(item.xxid)
      .then((d) => setDetail({ item, state: "ok", data: d }))
      .catch((err: unknown) =>
        setDetail({ item, state: "error", err: explainNetworkError(err) }),
      );
  };

  const canPrev = page > 1;
  const fullPage = (data?.length ?? 0) >= PAGE_SIZE;

  return (
    <>
      <SectionHead
        title="校内新闻"
        aside="信息门户发布 · 点击在系统浏览器打开"
        /* 分页控制放右侧 */
        key={`head-${page}`}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 10 }}>
        <button className="btn" disabled={!canPrev || state === "loading"} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          上一页
        </button>
        <span className="page-indicator">第 {page} 页</span>
        <button className="btn" disabled={!fullPage || state === "loading"} onClick={() => setPage((p) => p + 1)}>
          下一页
        </button>
        <button className="btn" onClick={() => void reload()} disabled={state === "loading"}>
          刷新
        </button>
      </div>

      {state === "error" ? <ErrorNote text={error ?? ""} onRetry={() => void reload()} /> : null}

      {state === "loading" && !data ? (
        <SkeletonRows rows={8} />
      ) : (data?.length ?? 0) === 0 ? (
        <Card>
          <Empty text={page > 1 ? "本页没有更多新闻了。" : "暂无新闻。"} />
        </Card>
      ) : (
        <Card className="list">
          {data!.map((n, i) => (
            <button
              className="row row-link"
              key={n.xxid || i}
              style={{ animationDelay: `${Math.min(i, 12) * 25}ms`, textAlign: "left", width: "100%" }}
              onClick={() => openDetail(n)}
              title="点击查看详情"
            >
              <div className="row-when">
                <b>{n.date ? n.date.slice(5, 10).replace("-", "/") : "--"}</b>
                <span>{n.source || "校内"}</span>
              </div>
              <div className="row-main">
                <div className="row-title" style={{ whiteSpace: "normal" }}>
                  {n.topped ? <span className="chip chip-blue" style={{ marginRight: 8 }}>置顶</span> : null}
                  {n.name}
                </div>
              </div>
              {n.url ? <IconExternal width={14} height={14} /> : null}
            </button>
          ))}
        </Card>
      )}

      {detail ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            justifyContent: "flex-end",
            zIndex: 60,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            style={{
              width: "min(720px, 94vw)",
              background: "var(--surface)",
              overflowY: "auto",
              padding: "20px 26px 28px",
              borderRadius: "16px 0 0 16px",
              border: "1px solid var(--border)",
              borderRight: "none",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.45 }}>{detail.item.name}</h2>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {detail.item.url ? (
                  <button className="btn" onClick={() => void openExternal(detail.item.url!)}>
                    <IconExternal width={14} height={14} />
                    在浏览器打开
                  </button>
                ) : null}
                <button className="btn btn-ghost" onClick={() => setDetail(null)}>关闭</button>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
              {[detail.item.source, detail.item.date].filter(Boolean).join(" · ")}
            </div>
            {detail.state === "loading" ? (
              <SkeletonRows rows={6} />
            ) : detail.state === "error" ? (
              <ErrorNote text={detail.err ?? ""} onRetry={() => openDetail(detail.item)} />
            ) : (
              <>
                {detail.data && detail.data.files.length > 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 10 }}>
                    附件：{detail.data.files.join("、")}
                  </div>
                ) : null}
                <RichContent html={detail.data?.html} fallback="正文为空。" />
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
