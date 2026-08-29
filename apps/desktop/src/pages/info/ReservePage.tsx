/**
 * 预约页 —— 页内分栏（segmented）：「图书馆座位」（LibraryTab 原样复用，
 * 自带分区标题与三态重试）/「研讨间」（LibRoomTab，cab.lib ic-web）/
 * 「更多场馆」占位（游泳馆、健身房等陆续接入）。
 * 与 InfoPage 同款交互：每个 tab 首次激活时挂载并保持挂载（visited + hidden）。
 */
import { useState } from "react";
import { Card, Empty, PageHead } from "../../components/Layout.js";
import { LibraryTab } from "./LibraryTab.js";
import { LibRoomTab } from "./LibRoomTab.js";

export type ReserveTab = "library" | "libroom" | "more";

const TABS: Array<{ id: ReserveTab; label: string }> = [
  { id: "library", label: "图书馆座位" },
  { id: "libroom", label: "研讨间" },
  { id: "more", label: "更多场馆" },
];

export function ReservePage() {
  const [tab, setTab] = useState<ReserveTab>("library");
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<ReserveTab>>(() => new Set(["library"]));

  const activate = (id: ReserveTab) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <>
      <PageHead title="预约" meta="图书馆座位 · 研讨间 · 更多场馆陆续接入" />
      <div className="segmented" role="tablist" aria-label="预约功能" style={{ marginBottom: 14 }}>
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "is-active" : ""}
            onClick={() => activate(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* LibraryTab 自带「图书馆座位」分区标题，不再叠加模块头 */}
      <div hidden={tab !== "library"}>{visited.has("library") ? <LibraryTab /> : null}</div>
      <div hidden={tab !== "libroom"}>{visited.has("libroom") ? <LibRoomTab /> : null}</div>
      <div hidden={tab !== "more"}>
        {visited.has("more") ? (
          <Card>
            <Empty text="游泳馆、健身房等陆续接入" />
          </Card>
        ) : null}
      </div>
    </>
  );
}
