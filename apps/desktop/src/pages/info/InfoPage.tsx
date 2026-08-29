/**
 * 信息中心 —— info 门户核心功能聚合页（thu-info-app 功能移植到桌面端）。
 * 子页：成绩（getReport）/ 考试安排（课表分类「考试」）/ 新闻（getNewsList）/
 *       个人信息（grjbxx）。
 * 校园卡 / 宿舍 / 洗衣机已拆至「生活」页，图书馆拆至「预约」页。
 * 每个 tab 首次激活时拉取并保持挂载，切回不重复请求；各 tab 自带三态与重试。
 */
import { useState } from "react";
import { PageHead } from "../../components/Layout.js";
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
  const [tab, setTab] = useState<InfoTab>("report");
  /** 已激活过的 tab 保持挂载：切回即显（数据在 hook 里，无需重复请求） */
  const [visited, setVisited] = useState<ReadonlySet<InfoTab>>(() => new Set(["report"]));

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
      <div hidden={tab !== "news"}>{visited.has("news") ? <NewsTab /> : null}</div>
      <div hidden={tab !== "profile"}>{visited.has("profile") ? <ProfileTab /> : null}</div>
    </>
  );
}
