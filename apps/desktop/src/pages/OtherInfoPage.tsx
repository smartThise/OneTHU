/**
 * 其他 Info 应用 —— 信息门户原始「应用导航」的功能化重排：
 * - 静态目录（lib/infoApps.ts，已剔除与 OneTHU 已有功能重复的条目）；
 * - 分类分区 + 本地搜索（名称/分类即打即筛）；
 * - 入口卡片即原子（kind=infoapp，可收藏进收藏夹；AtomPicker 可搜）；
 * - 点击先试应用内 iframe 内嵌（门户漫游链），内嵌不成再走系统浏览器
 *   （卡头常驻「浏览器打开」兜底；iframe 被门户 X-Frame-Options 拒时整页留白即可见）。
 */
import { useEffect, useMemo, useState } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { IconExternal, IconSearch } from "../components/Icons.js";
import { CollectStar } from "../components/Collect.js";
import { useApp } from "../state/context.js";
import { INFO_APPS, INFO_APP_CATS, infoAppUrl } from "../lib/infoApps.js";
import { openExternal } from "./info/openExternal.js";

interface EmbedTarget {
  name: string;
  url: string;
}

export function OtherInfoPage() {
  const { navParams } = useApp();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [embed, setEmbed] = useState<EmbedTarget | null>(null);
  /** 深链消费：infoapp 原子打开时自动内嵌对应应用（仅一次） */
  const deepApplied = useMemo(() => ({ done: false }), []);

  useEffect(() => {
    const id = navParams?.infoAppId;
    if (deepApplied.done || !id) return;
    const app = INFO_APPS.find((a) => a.id === id);
    if (!app) return;
    deepApplied.done = true;
    setEmbed({ name: app.name, url: infoAppUrl(app.id) });
  }, [navParams, deepApplied]);

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
        meta={"信息门户原始应用导航 · " + INFO_APPS.length + " 项（已剔除与既有功能重复）"}
        actions={
          embed ? (
            <button className="btn" onClick={() => setEmbed(null)}>收起内嵌</button>
          ) : undefined
        }
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

      {embed ? (
        <Card style={{ marginBottom: 16, padding: "12px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {embed.name} · 内嵌尝试
            </div>
            <div style={{ display: "inline-flex", gap: 6, flex: "0 0 auto" }}>
              <button className="btn" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={() => void openExternal(embed.url)}>
                浏览器打开
              </button>
              <button className="btn" style={{ height: 26, padding: "0 10px", fontSize: 12 }} onClick={() => setEmbed(null)}>
                收起
              </button>
            </div>
          </div>
          <iframe
            title={embed.name}
            src={embed.url}
            style={{ width: "100%", height: "70vh", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}
          />
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
            若此区域空白/报拒绝连接，说明门户不允许内嵌——点右上「浏览器打开」即走系统浏览器（同一 SSO，登录一次即可）。
          </div>
        </Card>
      ) : null}

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
              {g.apps.map((a) => {
                const active = embed?.url === infoAppUrl(a.id);
                return (
                  <div key={a.id} className={"app-card" + (active ? " is-active" : "")} role="button" tabIndex={0} onClick={() => setEmbed({ name: a.name, url: infoAppUrl(a.id) })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setEmbed({ name: a.name, url: infoAppUrl(a.id) }); }}>
                    <span className="app-card-icon"><IconExternal width={16} height={16} /></span>
                    <span className="app-card-name" title={a.name}>{a.name}</span>
                    <CollectStar atom={{ kind: "infoapp", key: [a.cat, a.name, a.id].map((x) => x.replace(/~/g, "-")).join("~") }} title={a.name} />
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
