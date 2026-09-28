/**
 * 帮助体系护栏（§4.6）：任务式帮助 + 首页 ≤3 处一次性引导。
 *
 * 守的是两件容易走样的事：
 *  ① 帮助不许变成第二份功能清单——条目只能引用注册表 id，路由由注册表给，
 *     并且每个 id 都必须在 NAV_REGISTRY 里真实存在（写错一个就红）；
 *  ② 首页引导不许变成甩不掉的狗皮膏药——≤3 条、有"不再提示"、看过就落盘不再弹，
 *     目标找不到（卡片被隐藏或内容为空）要自动跳过，而不是指着一个不存在的地方。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const help = readFileSync("apps/desktop/src/components/HelpSection.tsx", "utf8");
const coach = readFileSync("apps/desktop/src/components/HomeCoachMarks.tsx", "utf8");
const today = readFileSync("apps/desktop/src/pages/Today.tsx", "utf8");
const settings = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const nav = readFileSync("apps/desktop/src/state/navigation.ts", "utf8");

// ① 帮助：引注册表、不硬编码路由，且引用的 id 真实存在
assert.ok(/NAV_REGISTRY/.test(help), "帮助必须从功能注册表取数据，不能自己写一份清单");
const registryIds = new Set([...nav.matchAll(/\{ id: "([^"]+)", name:/g)].map((m) => m[1]));
assert.ok(registryIds.size >= 30, "注册表条目太少（" + registryIds.size + "），解析可能失效");
const helpIds = [...help.matchAll(/"(info-[a-z]+|learn[a-z-]*|yuketang-homework|oj-homework|life-[a-z]+|reserve-[a-z]+|schedule|mail|cloud)"(?=,|\])/g)].map((m) => m[1]);
assert.ok(helpIds.length >= 12, "帮助里的功能入口太少（" + helpIds.length + " 条），任务式索引不该这么薄");
const missing = helpIds.filter((id) => !registryIds.has(id));
assert.deepEqual(missing, [], "帮助引用了注册表里不存在的 id：" + missing.join("/"));
assert.ok(/navigate\(e\.page, e\.params\)|navigate\(entry\.page/.test(help), "帮助的跳转目标必须取自注册表，而不是写死的页面 id");
assert.ok(!/navigate\("(?!settings)/.test(help.replace(/requestSettingsTab/g, "")), "帮助里不该出现写死的页面跳转");

// ② 帮助栏真的进了设置页，且栏目清单两处一致（分节 ↔ 页签）
assert.ok(/const SETTINGS_TAB_ORDER = \[[^\]]*"帮助"[^\]]*\]/.test(settings), "设置页签少了「帮助」");
assert.ok(/\{ label: "帮助", sections: \["帮助"\] \}/.test(settings), "SETTINGS_GROUPS 少了「帮助」分组");
assert.ok(/<SectionHead title="帮助" \/>[\s\S]{0,120}<HelpSection \/>/.test(settings), "「帮助」分节没有渲染 HelpSection");
assert.ok(/import \{ HelpSection \}/.test(settings), "设置页没导入 HelpSection");

// ③ 首页引导：≤3 条、可关、看过落盘、目标找不到就跳过
const tips = coach.match(/const TIPS: Array<[^>]*> = \[([\s\S]*?)\n\];/)?.[1] ?? "";
const tipCount = (tips.match(/\{ target:/g) ?? []).length;
assert.ok(tipCount >= 1 && tipCount <= 3, "首页一次性引导必须 1–3 条，现在 " + tipCount + " 条");
assert.ok(/const KEY = "onethu\.home\.coach\.v1"/.test(coach), "引导要有一次性的落盘键");
assert.ok(/localStorage\.setItem\(KEY, "done"\)/.test(coach), "看过/关掉必须落盘，不能每次进来都弹");
assert.ok(/不再提示/.test(coach), "引导必须能一次关掉");
assert.ok(/if \(!el\) \{[\s\S]{0,80}setIdx/.test(coach), "目标不存在时要跳过这条，而不是指错地方");
assert.ok(/data-coach="home-edit"/.test(today), "首页「编辑」按钮上没有引导锚点");
assert.ok(/data-coach="home-collapse"/.test(today), "卡片折叠控件上没有引导锚点");
assert.ok(/data-card=\{def\.id\}/.test(today), "卡片外壳没暴露 id，引导指不到具体卡片");
assert.ok(/<HomeCoachMarks \/>/.test(today), "首页没有挂上引导组件");

console.log(
  "帮助与引导护栏：帮助 " + helpIds.length + " 个入口全部命中注册表（" + registryIds.size + " 条）✓ / " +
  "跳转取自注册表 ✓ / 设置「帮助」栏两处一致 ✓ / 首页引导 " + tipCount + " 条、可关、可跳过 ✓",
);
