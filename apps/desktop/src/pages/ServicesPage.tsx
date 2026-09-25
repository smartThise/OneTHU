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
import { useMemo, useState, type ReactNode } from "react";
import { Card, Empty, PageHead } from "../components/Layout.js";
import { IconSearch } from "../components/Icons.js";
import { pageAtomRef, resolveAtom } from "../state/atoms.js";
import { NAV_CATEGORIES, byCategory, matchNavQuery, type NavEntry } from "../state/navigation.js";
import { useApp } from "../state/context.js";

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
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const query = q.trim();
  const hits = useMemo(() => matchNavQuery(query), [query]);

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
        hits.length ? (
          <Card className="svc-card">
            {hits.map((e) => (
              <ServiceRow key={e.id} entry={e} />
            ))}
          </Card>
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
          <button className="svc-all-toggle" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "收起低频功能" : "显示全部功能（含低频）"}
          </button>
        </>
      )}
    </>
  );
}
