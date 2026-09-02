/**
 * 信息中心 —— info 门户核心功能聚合页（thu-info-app 功能移植到桌面端）。
 * 子页：成绩（getReport）/ 体测成绩（成绩后）/ 考试安排（课表分类「考试」）/
 *       教学评估（考试后）/ 校历（图片版，新闻前）/ 新闻（getNewsList）/
 *       个人信息（grjbxx）。
 * 校园卡 / 宿舍 / 洗衣机已拆至「生活」页，图书馆拆至「预约」页。
 * 每个 tab 首次激活时拉取并保持挂载，切回不重复请求；各 tab 自带三态与重试。
 *
 * 新闻直达（首页新闻行点击 → navigate("info", { infoNewsId: xxid })）：
 * 带 infoNewsId 参数时初始 tab 落在「新闻」，并把 xxid 下传 NewsTab 打开该条详情；
 * 不带参数时行为与旧版一致（默认成绩 tab，不打开任何详情）——向后兼容。
 *
 * 子栏直达（首页入口化）：navigate("info", { infoTab }) 指定 segmented 初始 tab，
 * 与 infoNewsId 同款消费模式（挂载初值 + navParams 身份触发的 effect）；页内切换
 * 不回写参数，缺省时保持原默认成绩 tab。
 *
 * 栏目管理（tabLayout）：栏目可选择隐藏 + ↑↓ 调序，localStorage 持久化；
 * 当前 tab 被隐藏时回落到第一个可见栏目。
 */
import { useEffect, useState } from "react";
import { Empty, PageHead, SegmentedOverflow } from "../../components/Layout.js";
import { TabManageModal } from "../../components/TabManageModal.js";
import { loadTabLayout, saveTabLayout, type TabLayout } from "../../lib/tabLayout.js";
import { useApp } from "../../state/context.js";
import { ExamsTab } from "./ExamsTab.js";
import { NewsTab } from "./NewsTab.js";
import { ProfileTab } from "./ProfileTab.js";
import { ReportTab } from "./ReportTab.js";
import { FitnessTab } from "./FitnessTab.js";
import { EvaluationTab } from "./EvaluationTab.js";
import { CalendarTab } from "./CalendarTab.js";
import { CourseInfoTab } from "./CourseInfoTab.js";

export type InfoTab = "report" | "fitness" | "exams" | "evaluation" | "calendar" | "news" | "profile" | "courseinfo";

const TABS: Array<{ id: InfoTab; label: string }> = [
  { id: "report", label: "成绩" },
  { id: "fitness", label: "体测成绩" },
  { id: "exams", label: "考试" },
  { id: "evaluation", label: "教学评估" },
  { id: "calendar", label: "校历" },
  { id: "news", label: "新闻" },
  { id: "profile", label: "个人信息" },
  { id: "courseinfo", label: "课程信息" },
];
const TAB_IDS = TABS.map((t) => t.id);
const DEFAULT_LAYOUT: TabLayout = { order: TAB_IDS, hidden: [] };

export function InfoPage() {
  const { navParams } = useApp();
  /** 首页新闻直达的 xxid（下传 NewsTab 后由其消费置回 null）。
   *  用 navParams 对象身份作 effect 依赖：navigate 每次都新建参数对象，
   *  同一条新闻重复点击也能再次触发打开。 */
  const [newsId, setNewsId] = useState<string | null>(() => navParams?.infoNewsId ?? null);
  /** 新闻搜索直达词（选课·外校课卡片「查通知」）：下传 NewsTab 消费后置回 null */
  const [newsQuery, setNewsQuery] = useState<string | null>(() => navParams?.infoNewsQuery ?? null);
  const [tab, setTab] = useState<InfoTab>(() => (navParams?.infoNewsId || navParams?.infoNewsQuery ? "news" : (navParams?.infoTab ?? "report")));
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<InfoTab>>(
    () => new Set(navParams?.infoNewsId || navParams?.infoNewsQuery ? ["report", "news"] : [navParams?.infoTab ?? "report"]),
  );

  /** 栏目布局（显隐 + 顺序） */
  const [layout, setLayout] = useState<TabLayout>(() => loadTabLayout("info", TAB_IDS));
  const [manageOpen, setManageOpen] = useState(false);
  const applyLayout = (l: TabLayout) => {
    setLayout(l);
    saveTabLayout("info", l);
  };
  const labelOf = (id: InfoTab) => TABS.find((t) => t.id === id)?.label ?? id;
  const visibleIds = layout.order.filter((id) => !layout.hidden.includes(id)) as InfoTab[];
  /** 当前 tab 被隐藏 → 回落到第一个可见栏目（全部隐藏则保持 null 走空态） */
  const effTab = visibleIds.includes(tab) ? tab : visibleIds[0];

  useEffect(() => {
    const params = navParams;
    if (!params) return; // 无参数导航（侧栏点击等）：不改变当前 tab / 详情态
    // 子栏直达（首页入口化）：infoTab 仅作落点，切换后不回写（消费即弃）
    const direct = params.infoTab;
    if (direct) {
      setTab((t) => (t === direct ? t : direct));
      setVisited((prev) => (prev.has(direct) ? prev : new Set(prev).add(direct)));
    }
    const q = params.infoNewsQuery;
    if (q) {
      setTab((t) => (t === "news" ? t : "news"));
      setVisited((prev) => (prev.has("news") ? prev : new Set(prev).add("news")));
      setNewsQuery(q);
    }
    const id = params.infoNewsId;
    if (!id) return; // 无新闻直达参数：不动详情态
    setTab((t) => (t === "news" ? t : "news"));
    setVisited((prev) => (prev.has("news") ? prev : new Set(prev).add("news")));
    setNewsId(id);
  }, [navParams]);

  const activate = (id: InfoTab) => {
    setTab(id);
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  return (
    <>
      <PageHead
        title="信息"
        actions={
          <button className="btn" onClick={() => setManageOpen(true)} title="栏目显隐与排序">
            管理栏目
          </button>
        }
      />
      <SegmentedOverflow ariaLabel="信息功能" style={{ marginBottom: 14 }}>
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
          <div hidden={effTab !== "report"}>{visited.has("report") ? <ReportTab /> : null}</div>
          <div hidden={effTab !== "fitness"}>{visited.has("fitness") ? <FitnessTab /> : null}</div>
          <div hidden={effTab !== "exams"}>{visited.has("exams") ? <ExamsTab /> : null}</div>
          <div hidden={effTab !== "evaluation"}>{visited.has("evaluation") ? <EvaluationTab /> : null}</div>
          <div hidden={effTab !== "calendar"}>{visited.has("calendar") ? <CalendarTab /> : null}</div>
          <div hidden={effTab !== "news"}>{visited.has("news") ? <NewsTab newsId={newsId} onConsumeNewsId={() => setNewsId(null)} initialQuery={newsQuery} onConsumeQuery={() => setNewsQuery(null)} /> : null}</div>
          <div hidden={effTab !== "profile"}>{visited.has("profile") ? <ProfileTab /> : null}</div>
          <div hidden={effTab !== "courseinfo"}>{visited.has("courseinfo") ? <CourseInfoTab /> : null}</div>
        </>
      )}

      <TabManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        title="管理信息栏目"
        tabs={TABS}
        layout={layout}
        onApply={applyLayout}
        onReset={() => applyLayout(DEFAULT_LAYOUT)}
      />
    </>
  );
}
