/**
 * 生活聚合页 —— 宿舍（家园网电费 + 清华水站订水）/ 洗衣机 / 卫生成绩 / 校园卡 /
 * 财务组（电子发票 · 银行代发 · 研究生收入）/ 校园网。
 * 宿舍/洗衣机/校园卡自「信息」页拆出；卫生成绩排洗衣机后（宿舍相关），
 * 财务组排校园卡后，校园网放最后（上游已瘫痪，仅静态提示）。
 * tab 组件原样复用（各自自带三态与重试）。
 * 页内分栏（segmented）：与 InfoPage 同款交互，每个 tab 首次激活时挂载并
 * 保持挂载（visited + hidden），切回不重复请求，切页返回才重新拉取。
 *
 * 子栏直达（首页入口化）：navigate("life", { lifeTab }) 指定初始 tab（缺省宿舍），
 * 与 InfoPage 的 infoNewsId 同款消费模式（挂载初值 + navParams 身份触发的
 * effect）；页内切换不回写参数。
 *
 * 栏目管理（tabLayout）：栏目可选择隐藏 + ↑↓ 调序，localStorage 持久化；
 * 当前 tab 被隐藏时回落到第一个可见栏目。
 */
import { useEffect, useState } from "react";
import { Empty, PageHead, SegmentedOverflow } from "../../components/Layout.js";
import { TabManageModal } from "../../components/TabManageModal.js";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../../lib/tabLayout.js";
import { useApp } from "../../state/context.js";
import { CardTab } from "./CardTab.js";
import { DormTab } from "./DormTab.js";
import { WasherTab } from "./WasherTab.js";
import { HygieneTab } from "./HygieneTab.js";
import { InvoiceTab } from "./InvoiceTab.js";
import { PayrollTab } from "./PayrollTab.js";
import { GradIncomeTab } from "./GradIncomeTab.js";
import { NetworkTab } from "./NetworkTab.js";

export type LifeTab =
  | "dorm" | "washer" | "hygiene" | "card"
  | "invoice" | "payroll" | "gradincome" | "network";

const TABS: Array<{ id: LifeTab; label: string }> = [
  { id: "dorm", label: "宿舍" },
  { id: "washer", label: "洗衣机" },
  { id: "hygiene", label: "卫生成绩" },
  { id: "card", label: "校园卡" },
  { id: "invoice", label: "电子发票" },
  { id: "payroll", label: "银行代发" },
  { id: "gradincome", label: "研究生收入" },
  { id: "network", label: "校园网" },
];
const TAB_IDS = TABS.map((t) => t.id);
const DEFAULT_LAYOUT: TabLayout = { order: TAB_IDS, hidden: [] };

export function LifePage() {
  const { navParams } = useApp();
  const [tab, setTab] = useState<LifeTab>(() => navParams?.lifeTab ?? "dorm");
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<LifeTab>>(() => new Set([navParams?.lifeTab ?? "dorm"]));

  /** 栏目布局（显隐 + 顺序） */
  const [layout, setLayout] = useState<TabLayout>(() => loadTabLayout("life", TAB_IDS));
  const [manageOpen, setManageOpen] = useState(false);
  const applyLayout = (l: TabLayout) => {
    setLayout(l);
    saveTabLayout("life", l);
  };
  const labelOf = (id: LifeTab) => TABS.find((t) => t.id === id)?.label ?? id;
  const visibleIds = layout.order.filter((id) => !layout.hidden.includes(id)) as LifeTab[];
  /** 当前 tab 被隐藏 → 回落到第一个可见栏目（全部隐藏则保持 null 走空态） */
  const effTab = visibleIds.includes(tab) ? tab : visibleIds[0];

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
      <PageHead
        title="生活"
        actions={
          <button className="btn" onClick={() => setManageOpen(true)} title="栏目显隐与排序">
            管理栏目
          </button>
        }
      />
      <SegmentedOverflow ariaLabel="生活功能" style={{ marginBottom: 14 }}>
        {visibleIds.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={effTab === id}
            className={effTab === id ? "is-active" : ""}
            onClick={() => activate(id)}
          >
            {labelOf(id)}
          </button>
        ))}
      </SegmentedOverflow>

      {effTab === null ? (
        <Empty text="所有栏目已隐藏，点击右上「管理栏目」恢复。" />
      ) : (
        <>
          {/* 模块头由栏目名与各 tab 内部分区标题承担（WasherTab 自带「洗衣机」头） */}
          <div hidden={effTab !== "dorm"}>{visited.has("dorm") ? <DormTab deepSection={navParams?.dormSection} /> : null}</div>
          <div hidden={effTab !== "washer"}>{visited.has("washer") ? <WasherTab deepBuildingId={navParams?.washerBuildingId} deepBuildingName={navParams?.washerBuildingName} deepHlsh={navParams?.washerBuildingHlsh} deepMachine={navParams?.washerMachine} /> : null}</div>
          <div hidden={effTab !== "hygiene"}>{visited.has("hygiene") ? <HygieneTab /> : null}</div>
          <div hidden={effTab !== "card"}>{visited.has("card") ? <CardTab /> : null}</div>
          <div hidden={effTab !== "invoice"}>{visited.has("invoice") ? <InvoiceTab /> : null}</div>
          <div hidden={effTab !== "payroll"}>{visited.has("payroll") ? <PayrollTab /> : null}</div>
          <div hidden={effTab !== "gradincome"}>{visited.has("gradincome") ? <GradIncomeTab /> : null}</div>
          <div hidden={effTab !== "network"}>{visited.has("network") ? <NetworkTab /> : null}</div>
        </>
      )}

      <TabManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="管理生活栏目"
        tabs={TABS}
        layout={layout}
        onApply={applyLayout}
        onReset={() => applyLayout(DEFAULT_LAYOUT)}
      />
    </>
  );
}
