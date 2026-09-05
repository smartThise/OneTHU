/**
 * 其他 Info 应用 —— 信息门户原始「应用导航」的功能化重排：
 * - 静态目录（lib/infoApps.ts，已剔除与 OneTHU 已有功能重复的条目）；
 * - 分类分区 + 本地搜索（名称/分类即打即筛）；
 * - 入口卡片即原子（kind=infoapp，可收藏进收藏夹；AtomPicker 可搜）；
 * - 点击一律系统浏览器打开门户漫游链：实测门户下发 X-Frame-Options，
 *   应用内 iframe 内嵌整页空白（2026-09-04 实证），iframe 方案已废弃。
 */
import { useMemo, useState } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { IconExternal, IconSearch } from "../components/Icons.js";
import { CollectStar } from "../components/Collect.js";
import { INFO_APPS, INFO_APP_CATS, infoAppUrl } from "../lib/infoApps.js";
import { openExternal } from "./info/openExternal.js";

export function OtherInfoPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");

  const q = query.trim().toLowerCase();
  const groups = useMemo(() => {
    const match = (name: string, c: string): boolean =>
      (!q || name.toLowerCase().includes(q) || c.toLowerCase().includes(q)) && (cat === "all" || c === cat);
    return INFO_APP_CATS.map((c) => ({ cat: c, apps: INFO_APPS.filter((a) => a.cat === c && match(a.name, a.cat)) })).filter(
      (g) => g.apps.length > 0,
    );
  }, [q, cat]);
  const total = groups.reduce((n, g) => n + g.apps.length, 0);

  return (
    <>
      <PageHead
        title="其他 Info 应用"
        meta={"信息门户原始应用导航 · " + INFO_APPS.length + " 项（已剔除与既有功能重复）· 点击卡片在系统浏览器打开"}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div className="search-box" style={{ flex: "1 1 auto", minWidth: 0, marginBottom: 0 }}>
          <IconSearch width={15} height={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索应用名 / 分类（如：报销 / 奖学金 / 后勤）"
            aria-label="搜索 Info 应用"
          />
        </div>
      </div>
      <div className="chips" style={{ marginBottom: 14 }}>
        <button type="button" className={"chip " + (cat === "all" ? "chip-blue" : "chip-gray")} onClick={() => setCat("all")}>
          全部（{INFO_APPS.length}）
        </button>
        {INFO_APP_CATS.map((c) => {
          const n = INFO_APPS.filter((a) => a.cat === c).length;
          if (n === 0) return null;
          return (
            <button key={c} type="button" className={"chip " + (cat === c ? "chip-blue" : "chip-gray")} onClick={() => setCat(c)}>
              {c}（{n}）
            </button>
          );
        })}
      </div>

      {total === 0 ? (
        <Card>
          <Empty text="没有匹配的应用——换个关键词，或切回「全部」分类。" />
        </Card>
      ) : (
        groups.map((g) => (
          <div key={g.cat} style={{ marginBottom: 18 }}>
            <div className="fav-nav" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                {g.cat}
                <span style={{ opacity: 0.55, fontWeight: 400, marginLeft: 6 }}>{g.apps.length}</span>
              </span>
            </div>
            <div className="app-grid">
              {g.apps.map((a) => (
                <div
                  key={a.id}
                  className="app-card"
                  role="button"
                  tabIndex={0}
                  title="在系统浏览器打开"
                  onClick={() => void openExternal(infoAppUrl(a.id))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") void openExternal(infoAppUrl(a.id)); }}
                >
                  <span className="app-card-icon"><IconExternal width={16} height={16} /></span>
                  <span className="app-card-name" title={a.name}>{a.name}</span>
                  <CollectStar atom={{ kind: "infoapp", key: [a.cat, a.name, a.id].map((x) => x.replace(/~/g, "-")).join("~") }} title={a.name} />
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
