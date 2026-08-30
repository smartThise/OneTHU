/**
 * 信息中心 —— info 门户核心功能聚合页（thu-info-app 功能移植到桌面端）。
 * 子页：成绩（getReport）/ 考试安排（课表分类「考试」）/ 新闻（getNewsList）/
 *       个人信息（grjbxx）。
 * 校园卡 / 宿舍 / 洗衣机已拆至「生活」页，图书馆拆至「预约」页。
 * 每个 tab 首次激活时拉取并保持挂载，切回不重复请求；各 tab 自带三态与重试。
 *
 * 新闻直达（首页新闻行点击 → navigate("info", { infoNewsId: xxid })）：
 * 带 infoNewsId 参数时初始 tab 落在「新闻」，并把 xxid 下传 NewsTab 打开该条详情；
 * 不带参数时行为与旧版一致（默认成绩 tab，不打开任何详情）——向后兼容。
 */
import { useEffect, useState } from "react";
import { PageHead } from "../../components/Layout.js";
import { useApp } from "../../state/context.js";
import { ExamsTab } from "./ExamsTab.js";
import { NewsTab } from "./NewsTab.js";
import { ProfileTab } from "./ProfileTab.js";
import { ReportTab } from "./ReportTab.js";

export type InfoTab = "report" | "exams" | "news" | "profile";

const TABS: Array<{ id: InfoTab; label: string }> = [
  { id: "report", label: "成绩" },
  { id: "exams", label: "考试" },
  { id: "news", label: "新闻" },
  { id: "profile", label: "个人信息" },
];

export function InfoPage() {
  const { navParams } = useApp();
  /** 首页新闻直达的 xxid（下传 NewsTab 后由其消费置回 null）。
   *  用 navParams 对象身份作 effect 依赖：navigate 每次都新建参数对象，
   *  同一条新闻重复点击也能再次触发打开。 */
  const [newsId, setNewsId] = useState<string | null>(() => navParams?.infoNewsId ?? null);
  const [tab, setTab] = useState<InfoTab>(() => (navParams?.infoNewsId ? "news" : "report"));
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<InfoTab>>(
    () => new Set(navParams?.infoNewsId ? ["report", "news"] : ["report"]),
  );

  useEffect(() => {
    const id = navParams?.infoNewsId;
    if (!id) return; // 无参数导航（侧栏点击等）：不改变当前 tab / 详情态
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
      <PageHead title="信息" meta="信息门户 · 教务" />
      <div className="segmented" role="tablist" aria-label="信息功能" style={{ marginBottom: 14 }}>
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

      <div hidden={tab !== "report"}>{visited.has("report") ? <ReportTab /> : null}</div>
      <div hidden={tab !== "exams"}>{visited.has("exams") ? <ExamsTab /> : null}</div>
      <div hidden={tab !== "news"}>{visited.has("news") ? <NewsTab newsId={newsId} onConsumeNewsId={() => setNewsId(null)} /> : null}</div>
      <div hidden={tab !== "profile"}>{visited.has("profile") ? <ProfileTab /> : null}</div>
    </>
  );
}
