import { t as i18n, useLocale as useUiLocale } from "../../i18n/index.js";
import { Btn } from "@onethu/gui";
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
 * effect）；页内切换回写到标签 params（标签名随栏目变化）。
 *
 * 栏目管理（tabLayout）：栏目可选择隐藏 + ↑↓ 调序，localStorage 持久化；
 * 当前 tab 被隐藏时回落到第一个可见栏目。
 */
import { useEffect, useState } from "react";
import { RootPageStar } from "../../components/Collect.js";
import { Empty, PageHead, SegmentedOverflow } from "../../components/Layout.js";
import { TabManageModal } from "../../components/TabManageModal.js";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../../lib/tabLayout.js";
import { useApp } from "../../state/context.js";
import { CardTab } from "./CardTab.js";
import { ElectricityTab } from "./ElectricityTab.js";
import { WaterTab } from "./WaterTab.js";
import { WasherTab } from "./WasherTab.js";
import { HygieneTab } from "./HygieneTab.js";
import { InvoiceTab } from "./InvoiceTab.js";
import { PayrollTab } from "./PayrollTab.js";
import { GradIncomeTab } from "./GradIncomeTab.js";
import { NetworkTab } from "./NetworkTab.js";
import { useTabDirection } from "../../lib/motion.js";

export type LifeTab =
  | "elec" | "water" | "washer" | "hygiene" | "card"
  | "invoice" | "payroll" | "gradincome" | "network";

export const TABS: Array<{ id: LifeTab; label: string }> = [
  { id: "elec", get label() { return i18n("pages.info.dormtab.ab8cff9a597a"); } },
  { id: "water", get label() { return i18n("pages.info.dormtab.bb8c939d0fcd"); } },
  { id: "washer", get label() { return i18n("pages.info.lifepage.6acfa1db6a62"); } },
  { id: "hygiene", get label() { return i18n("pages.info.lifepage.41d497d6e07e"); } },
  { id: "card", get label() { return i18n("pages.info.lifepage.caf1f095b108"); } },
  { id: "invoice", get label() { return i18n("pages.info.lifepage.92341cf02c56"); } },
  { id: "payroll", get label() { return i18n("pages.info.lifepage.24be2018df29"); } },
  { id: "gradincome", get label() { return i18n("pages.info.lifepage.336dbe5fd82f"); } },
  { id: "network", get label() { return i18n("pages.info.lifepage.dd94488f5269"); } },
];
const TAB_IDS = TABS.map((t) => t.id);
const DEFAULT_LAYOUT: TabLayout = { order: TAB_IDS, hidden: [] };

/** 旧布局里的 "dorm" 迁移为电费 + 定水两个独立页签。 */
function normalizeLifeTab(tab: string | undefined, section?: "ele" | "water"): LifeTab {
  if (tab === "dorm") return section === "water" ? "water" : "elec";
  if (tab && (TAB_IDS as readonly string[]).includes(tab)) return tab as LifeTab;
  return "elec";
}

function migrateLifeLayout(layout: TabLayout): TabLayout {
  const order: string[] = [];
  const hidden = new Set(layout.hidden);
  let dormHidden = false;
  for (const id of layout.order) {
    if (id === "dorm") {
      dormHidden = hidden.has("dorm");
      if (!order.includes("elec")) order.push("elec");
      if (!order.includes("water")) order.push("water");
      continue;
    }
    if ((TAB_IDS as readonly string[]).includes(id) && !order.includes(id)) order.push(id);
  }
  for (const id of TAB_IDS) if (!order.includes(id)) order.push(id);
  const hiddenNext = new Set<string>();
  for (const id of hidden) {
    if (id === "dorm") {
      if (dormHidden) { hiddenNext.add("elec"); hiddenNext.add("water"); }
    } else if ((TAB_IDS as readonly string[]).includes(id)) hiddenNext.add(id);
  }
  return { order, hidden: [...hiddenNext] };
}

export function LifePage() {
  const uiLocale = useUiLocale();

  const { navParams, navigate } = useApp();
  const initialTab = normalizeLifeTab(navParams?.lifeTab, navParams?.dormSection);
  const [tab, setTab] = useState<LifeTab>(initialTab);
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<LifeTab>>(() => new Set([initialTab]));

  /** 栏目布局（显隐 + 顺序；旧版 "dorm" 自动迁移） */
  const [layout, setLayout] = useState<TabLayout>(() => migrateLifeLayout(loadTabLayout("life", TAB_IDS)));
  const [manageOpen, setManageOpen] = useState(false);
  const applyLayout = (l: TabLayout) => {
    setLayout(l);
    saveTabLayout("life", l);
  };
  const labelOf = (id: LifeTab) => TABS.find((t) => t.id === id)?.label ?? id;
  const visibleIds = layout.order.filter((id) => !layout.hidden.includes(id)) as LifeTab[];
  /** 当前 tab 被隐藏 → 回落到第一个可见栏目（全部隐藏则保持 null 走空态） */
  const effTab = visibleIds.includes(tab) ? tab : visibleIds[0];
  // 页签切换方向（决定内容从哪一侧滑入）
  const tabDir = useTabDirection(effTab ?? null, visibleIds);

  useEffect(() => {
    const direct = normalizeLifeTab(navParams?.lifeTab, navParams?.dormSection);
    if (!navParams?.lifeTab) return; // 无参数导航（侧栏点击等）：不改变当前 tab
    setTab((t) => (t === direct ? t : direct));
    setVisited((prev) => (prev.has(direct) ? prev : new Set(prev).add(direct)));
  }, [navParams]);

  const activate = (id: LifeTab) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  /* 子栏目回写到标签 params：标签名（生活·宿舍/洗衣机…）与一星原子才随栏目变化 */
  useEffect(() => {
    if (!effTab || navParams?.lifeTab === effTab) return;
    navigate("life", { lifeTab: effTab });
  }, [effTab, navParams?.lifeTab, navigate]);

  return (
    <>
      <PageHead
        title={i18n("pages.info.lifepage.15d208d1b4c9")}
        actions={
          <>
            <RootPageStar page="life" title={i18n("pages.info.lifepage.15d208d1b4c9")} />
            <Btn variant="outline" onClick={() => setManageOpen(true)} titleAttr={i18n("pages.info.lifepage.fa0124c14866")}>{i18n("pages.info.lifepage.12526376d387")}</Btn>
          </>
        }
      />
      <SegmentedOverflow ariaLabel={i18n("pages.info.lifepage.420754341ee2")} style={{ marginBottom: 14 }}>
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
        <Empty text={i18n("pages.info.lifepage.f221af82663b")} />
      ) : (
        <>
          {/* 模块头由栏目名与各 tab 内部分区标题承担（WasherTab 自带「洗衣机」头） */}
          <div hidden={effTab !== "elec"} className={effTab === "elec" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("elec") ? <ElectricityTab /> : null}</div>
          <div hidden={effTab !== "water"} className={effTab === "water" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("water") ? <WaterTab /> : null}</div>
          <div hidden={effTab !== "washer"} className={effTab === "washer" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("washer") ? <WasherTab deepBuildingId={navParams?.washerBuildingId} deepBuildingName={navParams?.washerBuildingName} deepProvider={navParams?.washerBuildingProvider} deepHlsh={navParams?.washerBuildingHlsh} deepMachine={navParams?.washerMachine} /> : null}</div>
          <div hidden={effTab !== "hygiene"} className={effTab === "hygiene" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("hygiene") ? <HygieneTab /> : null}</div>
          <div hidden={effTab !== "card"} className={effTab === "card" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("card") ? <CardTab /> : null}</div>
          <div hidden={effTab !== "invoice"} className={effTab === "invoice" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("invoice") ? <InvoiceTab /> : null}</div>
          <div hidden={effTab !== "payroll"} className={effTab === "payroll" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("payroll") ? <PayrollTab /> : null}</div>
          <div hidden={effTab !== "gradincome"} className={effTab === "gradincome" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("gradincome") ? <GradIncomeTab /> : null}</div>
          <div hidden={effTab !== "network"} className={effTab === "network" ? "tab-anim" : undefined} data-dir={tabDir}>{visited.has("network") ? <NetworkTab /> : null}</div>
        </>
      )}

      <TabManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title={i18n("pages.info.lifepage.b735bde6b0d7")}
        tabs={TABS}
        layout={layout}
        onApply={applyLayout}
        onReset={() => applyLayout(DEFAULT_LAYOUT)}
      />
    </>
  );
}
