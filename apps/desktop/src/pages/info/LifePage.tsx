/**
 * 生活聚合页 —— 宿舍（家园网电费 + 清华水站订水）/ 洗衣机 / 校园卡。
 * 三块自「信息」页拆出，tab 组件原样复用（各自自带三态与重试）。
 * 页内分栏（segmented）：与 InfoPage 同款交互，每个 tab 首次激活时挂载并
 * 保持挂载（visited + hidden），切回不重复请求，切页返回才重新拉取。
 *
 * 子栏直达（首页入口化）：navigate("life", { lifeTab }) 指定初始 tab（缺省宿舍），
 * 与 InfoPage 的 infoNewsId 同款消费模式（挂载初值 + navParams 身份触发的
 * effect）；页内切换不回写参数。
 */
import { useEffect, useState } from "react";
import { PageHead } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { CardTab } from "./CardTab.js";
import { DormTab } from "./DormTab.js";
import { WasherTab } from "./WasherTab.js";

export type LifeTab = "dorm" | "washer" | "card";

const TABS: Array<{ id: LifeTab; label: string }> = [
  { id: "dorm", label: "宿舍" },
  { id: "washer", label: "洗衣机" },
  { id: "card", label: "校园卡" },
];

export function LifePage() {
  const { navParams } = useApp();
  const [tab, setTab] = useState<LifeTab>(() => navParams?.lifeTab ?? "dorm");
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<LifeTab>>(() => new Set([navParams?.lifeTab ?? "dorm"]));

  useEffect(() => {
    const direct = navParams?.lifeTab;
    if (!direct) return; // 无参数导航（侧栏点击等）：不改变当前 tab
    setTab((t) => (t === direct ? t : direct));
    setVisited((prev) => (prev.has(direct) ? prev : new Set(prev).add(direct)));
  }, [navParams]);

  const activate = (id: LifeTab) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <>
      <PageHead title="生活" meta="宿舍 · 洗衣机 · 校园卡" />
      <div className="segmented" role="tablist" aria-label="生活功能" style={{ marginBottom: 14 }}>
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

      {/* 模块头由栏目名与各 tab 内部分区标题承担（WasherTab 自带「洗衣机」头） */}
      <div hidden={tab !== "dorm"}>{visited.has("dorm") ? <DormTab /> : null}</div>
      <div hidden={tab !== "washer"}>{visited.has("washer") ? <WasherTab /> : null}</div>
      <div hidden={tab !== "card"}>{visited.has("card") ? <CardTab /> : null}</div>
    </>
  );
}
