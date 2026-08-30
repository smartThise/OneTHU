/**
 * 预约页 —— 页内分栏（segmented）：「图书馆座位」（LibraryTab 原样复用，
 * 自带分区标题与三态重试）/「研讨间」（LibRoomTab，cab.lib ic-web）/
 * 「空教室」（ClassroomTab，教学 Tina 空闲状态只读查询）/
 * 「更多场馆」占位（游泳馆、健身房等陆续接入）。
 * 与 InfoPage 同款交互：每个 tab 首次激活时挂载并保持挂载（visited + hidden）。
 *
 * 子栏直达（首页入口化）：navigate("reserve", { reserveTab }) 指定初始 tab，
 * 契约值 "lib"/"room"/"classroom" 映射页内 library/libroom/classroom 栏（缺省图书馆座位），
 * 与 InfoPage 的 infoNewsId 同款消费模式（挂载初值 + navParams 身份触发的
 * effect）；页内切换不回写参数。
 */
import { useEffect, useState } from "react";
import { Card, Empty, PageHead } from "../../components/Layout.js";
import type { LearnNav } from "../../state/app.js";
import { useApp } from "../../state/context.js";
import { LibraryTab } from "./LibraryTab.js";
import { LibRoomTab } from "./LibRoomTab.js";
import { ClassroomTab } from "./ClassroomTab.js";

export type ReserveTab = "library" | "libroom" | "classroom" | "more";

const TABS: Array<{ id: ReserveTab; label: string }> = [
  { id: "library", label: "图书馆座位" },
  { id: "libroom", label: "研讨间" },
  { id: "classroom", label: "空教室" },
  { id: "more", label: "更多场馆" },
];

/** LearnNav.reserveTab 契约值 → 页内 tab id（"more" 仅页内可达，不作直达参数） */
const PARAM_TO_TAB: Record<NonNullable<LearnNav["reserveTab"]>, ReserveTab> = {
  lib: "library",
  room: "libroom",
  classroom: "classroom",
};

export function ReservePage() {
  const { navParams } = useApp();
  const direct = navParams?.reserveTab ? PARAM_TO_TAB[navParams.reserveTab] : undefined;
  const [tab, setTab] = useState<ReserveTab>(() => direct ?? "library");
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<ReserveTab>>(() => new Set([direct ?? "library"]));

  useEffect(() => {
    const p = navParams?.reserveTab;
    if (!p) return; // 无参数导航（侧栏点击等）：不改变当前 tab
    const t = PARAM_TO_TAB[p];
    setTab((cur) => (cur === t ? cur : t));
    setVisited((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
  }, [navParams]);

  const activate = (id: ReserveTab) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <>
      <PageHead title="预约" meta="图书馆座位 · 研讨间 · 空教室 · 更多场馆陆续接入" />
      <div className="segmented" role="tablist" aria-label="预约功能" style={{ marginBottom: 14, flexWrap: "wrap" }}>
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
      <div hidden={tab !== "classroom"}>{visited.has("classroom") ? <ClassroomTab /> : null}</div>
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
