/**
 * 其他 Info 应用 —— 信息门户原始「应用导航」的功能化重排：
 * - 静态目录（lib/infoApps.ts，已剔除与 OneTHU 已有功能重复的条目）；
 * - 分类分区 + 本地搜索（名称/分类即打即筛）；
 * - 入口卡片即原子（kind=infoapp，可收藏进收藏夹；AtomPicker 可搜）；
 * - 点击一律系统浏览器打开门户漫游链：实测门户下发 X-Frame-Options，
 *   应用内 iframe 内嵌整页空白（2026-09-04 实证），iframe 方案已废弃。
 *
 * 2026-10-14 OneGUI 换血（用户点名「其他 Info 服务」重灾区）：搜索框/分类胶囊/
 * 入口卡片全部来自 @onethu/gui —— Input·Chip·Section·Card(interactive)·Row·Grid·Stack，
 * 删除 .search-box / .chips / .chip-* / .fav-nav / .app-grid / .app-card 全套独立手写样式
 * （入口卡 = 可点面 Card + Row 槽位，材质与全站唯一来源一致）。
 */
import { useMemo, useState, type ReactNode } from "react";
import { Card, Chip, EmptyState, Grid, IconExternal, IconSearch, Inline, Input, Row, Section, Stack } from "@onethu/gui";
import { CollectStar } from "../components/Collect.js";
import { INFO_APPS, INFO_APP_CATS, infoAppUrl } from "../lib/infoApps.js";
import { openExternal } from "./info/openExternal.js";
import { t as i18n } from "../i18n/index.js";


export function OtherInfoPage(): ReactNode {
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

  const open = (id: string): void => { void openExternal(infoAppUrl(id)); };

  return (
    <Stack gap={5}>
      <Stack gap={3}>
        <Input
          type="search"
          size="md"
          icon={<IconSearch size="sm" />}
          placeholder={i18n("auto.pages.OtherInfoPage.1")}
          aria-label={i18n("auto.pages.OtherInfoPage.2")}
          value={query}
          onChange={setQuery}
        />
        <Inline gap={2} wrap>
          <Chip selected={cat === "all"} onClick={() => setCat("all")}>
            {i18n("auto.pages.OtherInfoPage.3")}{INFO_APPS.length}）
          </Chip>
          {INFO_APP_CATS.map((c) => {
            const n = INFO_APPS.filter((a) => a.cat === c).length;
            if (n === 0) return null;
            return (
              <Chip key={c} selected={cat === c} onClick={() => setCat(c)}>
                {c}（{n}）
              </Chip>
            );
          })}
        </Inline>
      </Stack>

      {total === 0 ? (
        <Card>
          <EmptyState title={i18n("auto.pages.OtherInfoPage.4")} />
        </Card>
      ) : (
        groups.map((g) => (
          <Stack key={g.cat} gap={3}>
            <Section title={g.cat} hint={`${g.apps.length} 项`} />
            <Grid min="sm">
              {g.apps.map((a) => (
                <Card
                  key={a.id}
                  flush
                  interactive
                  role="button"
                  tabIndex={0}
                  aria-label={`${a.name}——在系统浏览器打开`}
                  onClick={() => open(a.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(a.id); }}
                >
                  <Row flush leading={<IconExternal size="sm" />} title={a.name} trailing={<CollectStar atom={{ kind: "infoapp", key: [a.cat, a.name, a.id].map((x) => x.replace(/~/g, "-")).join("~") }} title={a.name} />} />
                </Card>
              ))}
            </Grid>
          </Stack>
        ))
      )}
    </Stack>
  );
}
