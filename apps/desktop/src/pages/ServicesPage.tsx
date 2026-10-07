/**
 * 服务分组目录页（UI/UX 改造方案 §2.2/§2.3-5，M1 beta）。
 * - 唯一数据源 state/navigation.ts（NAV_REGISTRY）：分组目录、搜索、推荐、绑定引导
 *   全部消费同一份注册表，本页不维护第二份功能清单；
 * - 移动端「服务」tab 直达；PC（≥840px）侧栏直达各功能，本页仍可访问（后续 §2.8.2
 *   会重定向到分组首个功能，beta 先保留）；
 * - 图标与副标题尽量取自 PAGE_ATOMS 同名原子（id 沿用既有 key），点击走
 *   resolveAtom 的 open（自动记使用统计，「最近使用/猜你喜欢」随之受益）；
 *   注册表里没有对应原子的条目（聚合型如雨课堂/OJ 作业）直接 navigate；
 * - buried 条目默认隐藏，「显示全部」展开；advanced（插件/开发者面板）永不出现（§4.4）。
 */
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { IconSearch } from "../components/Icons.js";
import { pageAtomRef, resolveAtom, type AtomHit } from "../state/atoms.js";
import { NAV_CATEGORIES, byCategory, type NavEntry } from "../state/navigation.js";
import { searchAll } from "../state/searchAll.js";
import { useApp } from "../state/context.js";
import { pluginTabsSnapshot, subscribePluginTabs } from "../plugins/tabs.js";
import { ohAsk } from "../plugins/ChatDock.js";

/** 搜索结果里的原子行（页面/实体/门户应用/在线服务），点击走原子 open（自动记使用统计） */
function AtomResultRow({ hit }: { hit: AtomHit }): ReactNode {
  const { navigate } = useApp();
  const view = resolveAtom({ kind: hit.kind, key: hit.key });
  if (!view) return null;
  const icon = view.icon;
  return (
    <button className="svc-row" onClick={() => view.open(navigate)}>
      <span className="svc-row-icon">{icon({})}</span>
      <span className="svc-row-main">
        <span className="svc-row-name">{view.title}</span>
        <span className="svc-row-sub">{(hit.group ? hit.group + " · " : "") + (view.sub ?? "")}</span>
      </span>
    </button>
  );
}

/** 目录行：优先复用同名页面原子的图标/副标题/使用统计链路 */
function ServiceRow({ entry }: { entry: NavEntry }): ReactNode {
  const { navigate } = useApp();
  const view = (() => {
    const ref = pageAtomRef(entry.id);
    return ref ? resolveAtom(ref) : null;
  })();
  const icon = view?.icon ?? undefined;
  const sub = entry.note ?? view?.sub;
  const open = () => {
    if (view) view.open(navigate);
    else navigate(entry.page, entry.params);
  };
  return (
    <button className="svc-row" onClick={open}>
      {icon ? <span className="svc-row-icon">{icon({})}</span> : null}
      <span className="svc-row-main">
        <span className="svc-row-name">{entry.name}</span>
        {sub ? <span className="svc-row-sub">{sub}</span> : null}
      </span>
    </button>
  );
}

export function ServicesPage(): ReactNode {
  const { navigate } = useApp();
  const [q, setQ] = useState("");
  // 插件功能页：抽屉退役后的移动端插件入口（与侧栏同一数据源）
  const pluginTabs = useSyncExternalStore(subscribePluginTabs, pluginTabsSnapshot, pluginTabsSnapshot);
  const [showAll, setShowAll] = useState(false);
  const query = q.trim();
  // 搜索走 state/searchAll.ts：与 PC 命令面板同一份组合（注册表 + 原子 + 设置页签），
  // 避免两处各写一套导致「面板搜得到、服务页搜不到」。
  const hits = useMemo(() => searchAll(query).entries, [query]);
  const atomHits = useMemo(() => searchAll(query).atoms, [query]);

  const groups = NAV_CATEGORIES.map((cat) => ({
    cat,
    entries: byCategory(cat).filter((e) => showAll || e.visibility !== "buried"),
  })).filter((g) => g.entries.length > 0);

  return (
    <>
      <PageHead title="服务" meta="按事情找功能 · 搜索全量兜底" />
      <div className="svc-search">
        <IconSearch width={15} height={15} />
        <input
          placeholder="搜功能，如：电费 / 洗衣机 / 成绩 / 雨课堂"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="搜索功能"
        />
      </div>
      {query ? (
        hits.length || atomHits.length ? (
          <>
            {/* OH 兜底置顶（§2.7）：搜不到/搜到了都给一条「直接问 OH」 */}
            <Card className="svc-card">
              <button className="svc-row svc-row-oh" onClick={() => ohAsk(query)}>
                <span className="svc-row-main">
                  <span className="svc-row-name">问小 OH：「{query}」</span>
                  <span className="svc-row-sub">智能助手直接回答，或帮你打开对应功能</span>
                </span>
              </button>
            </Card>
            {hits.length ? (
              <Card className="svc-card">
                {hits.map((e) => (
                  <ServiceRow key={e.id} entry={e} />
                ))}
              </Card>
            ) : null}
            {atomHits.length ? (
              <section>
                <div className="svc-label">相关内容</div>
                <Card className="svc-card">
                  {atomHits.map((h) => (
                    <AtomResultRow key={h.kind + "|" + h.key} hit={h} />
                  ))}
                </Card>
              </section>
            ) : null}
          </>
        ) : (
          <Card>
            <Empty text="没找到相关功能。可以换个说法，或到「全部」里翻一翻。" />
          </Card>
        )
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.cat}>
              <div className="svc-label">{g.cat}</div>
              <Card className="svc-card">
                {g.entries.map((e) => (
                  <ServiceRow key={e.id} entry={e} />
                ))}
              </Card>
            </section>
          ))}
          {pluginTabs.length ? (
            <section>
              <div className="svc-label">插件功能页</div>
              <Card className="svc-card">
                {pluginTabs.map((t) => (
                  <button key={t.pageKey} className="svc-row" onClick={() => navigate(t.pageKey as never)}>
                    <span className="svc-row-main">
                      <span className="svc-row-name">{t.title}</span>
                      <span className="svc-row-sub">来自插件</span>
                    </span>
                  </button>
                ))}
              </Card>
            </section>
          ) : null}
          <button className="svc-all-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "收起低频功能" : "显示全部功能（含低频）"}
          </button>
        </>
      )}
    </>
  );
}
