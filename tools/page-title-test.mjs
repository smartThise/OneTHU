#!/usr/bin/env node
/**
 * M1 · C6 护栏：标题唯一映射 + 页内大标题在移动端隐藏 + 顶栏字号。
 *
 * 退化长什么样：某次新增路由忘了补标题，那个页面顶栏就悄悄退回默认字样
 * （`settings` 就是这么显示的 OneTHU）；或者有人图省事把页内大标题的隐藏写成
 * 「标题与导航名相同时才隐藏」，于是名字稍有不同的页面又开始重复两行标题。
 * 所以这里断言的是**单一事实来源**，不是某一次的具体文案：
 *
 *   1. PAGE_TITLES 全仓只定义一次，且在 state/navigation.ts；
 *   2. Page 联合类型里每个静态路由都有标题（plugin: 动态 tab 除外，名字由插件注册表给）；
 *   3. Layout 的顶栏标题取自 pageTitle()，不再就地拼三元表达式；
 *   4. PageHead 不再自算「顶栏是否同名」（隐藏交给 CSS）；
 *   5. 移动端媒体块内 `.page-head h1 { display: none }`，且该规则只出现在移动端块里；
 *   6. `.topbar-title` 字号 ≥ 18px（C6 要求比改前大）。
 *
 * 跑法：node tools/page-title-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NAV = readFileSync("apps/desktop/src/state/navigation.ts", "utf8");
const APP = readFileSync("apps/desktop/src/state/app.tsx", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 1) 映射表唯一 */
const holders = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && /PAGE_TITLES\s*[:=]/.test(readFileSync(p, "utf8"))) holders.push(p);
  }
})("apps/desktop/src");
ok(holders.length === 1 && holders[0].endsWith("state/navigation.ts"),
  `PAGE_TITLES 应只在 state/navigation.ts 定义一处，实际：${holders.join(", ") || "无"}`);

/* 2) 每个静态路由都有标题（从 Page 联合类型里取，不是从表里取——否则互相印证没意义） */
const pageUnion = APP.slice(APP.indexOf("export type Page ="), APP.indexOf(";", APP.indexOf("export type Page =")));
const routes = [...pageUnion.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]).filter((r) => r !== "");
const tableBody = NAV.slice(NAV.indexOf("export const PAGE_TITLES"), NAV.indexOf("/** 顶栏/页内标题的唯一取值口"));
const tableKeys = [...tableBody.matchAll(/^\s{2}"?([a-z][a-z0-9-]*)"?:\s*"/gm)].map((m) => m[1]);
ok(routes.length > 20, `Page 联合类型解析异常（只取到 ${routes.length} 个路由）`);
for (const r of routes) ok(tableKeys.includes(r), `路由 "${r}" 没有标题映射（Page 联合类型里有它）`);
ok(tableKeys.includes("settings"), "settings 缺标题映射——顶栏会退回默认字样（C6 的原始 bug）");
ok(tableKeys.length === routes.length, `映射表 ${tableKeys.length} 项、静态路由 ${routes.length} 个，数量不一致`);

/* 3) 顶栏标题取自唯一取值口 */
ok(/import \{[^}]*pageTitle[^}]*\} from "\.\.\/state\/navigation\.js"/.test(LAYOUT), "Layout 未从 navigation.ts 引入 pageTitle");
ok(/pageTitle\(page\)/.test(LAYOUT), "Layout 的顶栏标题未走 pageTitle(page)");
ok(!/page === "services"|page === "plugins" \? "插件"|: "OneTHU"/.test(LAYOUT), "Layout 仍在就地拼标题三元表达式");

/* 4) PageHead 不再自算同名 */
ok(!/dupOnTopbar|navLabel/.test(LAYOUT), "PageHead 仍在自算「顶栏是否同名标题」（应改判 pageTitle(page)）");
ok(/entityTitle/.test(LAYOUT) && /page-head-title-entity/.test(LAYOUT), "PageHead 缺实体标题保留分支（课程名/作业名会被连坐隐藏）");
ok(/\.page-head h1\.page-head-title-entity\s*\{[^}]*display:\s*block/.test(CSS), "移动端缺实体标题的显示回补规则");

/* 5) 移动端隐藏页内大标题 */
ok(/@media\s*\(max-width:\s*839\.98px\)[\s\S]*?\.page-head h1\s*\{\s*display:\s*none/.test(CSS),
  "移动端媒体块内缺 `.page-head h1 { display: none }`");
const h1Rule = /^[^\n]*\.page-head h1\s*\{[^}]*display:\s*none/gm;
let m, topLevel = null;
while ((m = h1Rule.exec(CSS))) {
  const before = CSS.slice(0, m.index);
  const open = (before.match(/@media[^{]*\{/g) || []).length, close = (before.match(/\}/g) || []).length;
  if (open === 0) topLevel = m[0];
}
ok(!topLevel, "隐藏页内大标题的规则出现在非移动端（PC 会一起被隐藏）");
ok(/\.section-head h2|\.section-head\s*\{/.test(CSS), "区段小标题样式不见了（C6 要求区段小标题保留）");

/* 6) 顶栏字号 */
const titleBlock = /\.topbar-title\s*\{[^}]*\}/.exec(CSS)?.[0] ?? "";
const px = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(titleBlock);
const varLg = /font-size:\s*var\(--text-lg/.test(titleBlock);
ok(varLg || (px && Number(px[1]) >= 18), `顶栏字号未上调（当前：${px ? px[1] + "px" : varLg ? "var(--text-lg)" : "未解析到"}）`);

if (fails.length) {
  console.error("标题护栏（C6）：");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`标题护栏：映射表唯一（${tableKeys.length} 个静态路由全覆盖，含 settings）✓`);
console.log("  顶栏走 pageTitle() ✓｜PageHead 不自算同名 ✓｜移动端藏页内大标题（PC 保留）✓｜顶栏字号已上调 ✓");
