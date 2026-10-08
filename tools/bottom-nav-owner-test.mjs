#!/usr/bin/env node
/**
 * E6 护栏：每个可达页面都能查到唯一的底栏归属（不允许「底栏没有任何一项高亮」）。
 *
 * 由来（docs/ui-ux-polish-detailed.md §6 E6）：底栏原先靠每项自己的 activePages 数组
 * 匹配，`mail` 不在任何一项里 → 底栏出现「无选中」。修法是反查式归属表 + 类型穷尽：
 *
 *   1. state/navOwner.ts 用 Record<Exclude<Page, `plugin:${string}`>, BottomNavPage>
 *      声明——新增路由不补归属编译不过；
 *   2. 本护栏再把 Page 联合类型解析一遍，逐页对照归属表（编译期之外的第二道闸，
 *      也能挡住「把页面塞进白名单当逃生口」）；
 *   3. 归属值必须落在底栏五项里；
 *   4. 底栏高亮只能走 isBottomNavActive 这一个判据，不许回到每项 activePages；
 *   5. 白名单页面不许同时又在归属表里（两边都写=口径打架）。
 *
 * 跑法：node tools/bottom-nav-owner-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const APP = "apps/desktop/src/state/app.tsx";
const OWNER = "apps/desktop/src/state/navOwner.ts";
const LAYOUT = "apps/desktop/src/components/Layout.tsx";

const maskComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

const app = readFileSync(APP, "utf8");
const raw = readFileSync(OWNER, "utf8");
const owner = maskComments(raw);
const layout = maskComments(readFileSync(LAYOUT, "utf8"));

/* ① 归属表声明为穷尽 Record ------------------------------------------------ */
ok(/export type BottomNavPage =/.test(owner), "navOwner.ts 没有 BottomNavPage 类型");
ok(
  /export const PAGE_OWNER: Record<Exclude<Page, `plugin:\$\{string\}`>, BottomNavPage> = \{/.test(raw),
  "PAGE_OWNER 不是穷尽 Record（新增页面漏补归属就编译不过，这条必须保持）",
);

/* ② 解析 Page 联合类型，逐页对照 ------------------------------------------ */
const block = /export type Page =([\s\S]*?);\n/.exec(maskComments(app));
ok(!!block, "解析不到 app.tsx 的 Page 联合类型");
const pageMembers = block
  ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((x) => !x.includes("${"))
  : [];
ok(pageMembers.length > 25, `Page 联合类型解析出的页面太少（${pageMembers.length}），解析规则可能失效`);
ok(pageMembers.includes("learn-ykt-detail") && pageMembers.includes("tasks"), "Page 解析结果不含已知页面（解析规则失效）");
ok(/`plugin:\$\{string\}`/.test(block?.[1] ?? ""), "Page 联合类型里没有插件动态 tab 分支");

const ownerKeys = new Set([...owner.matchAll(/^\s{2}(?:"([^"]+)"|([A-Za-z][\w-]*)):\s*"(\w+)"/gm)].map((m) => m[1] ?? m[2]));
for (const p of pageMembers) {
  ok(ownerKeys.has(p), `页面 ${p} 没有底栏归属（会出现「没有任何一项高亮」）`);
}
for (const k of ownerKeys) {
  ok(pageMembers.includes(k), `归属表里有未知页面 ${k}（Page 联合类型里没有）`);
}

/* ③ 归属值必须落在底栏五项里 ---------------------------------------------- */
const navPages = [...(/export const BOTTOM_NAV_PAGES: readonly BottomNavPage\[\] = \[([^\]]+)\]/.exec(owner)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
ok(navPages.length === 5, `底栏项数不是 5（实得 ${navPages.length}）`);
const ownerValues = [...owner.matchAll(/^\s{2}(?:"[^"]+"|[A-Za-z][\w-]*):\s*"(\w+)"/gm)].map((m) => m[1]);
for (const v of new Set(ownerValues)) {
  ok(navPages.includes(v), `归属值 ${v} 不是底栏五项之一`);
}

/* ④ 白名单与归属表不许重叠 ------------------------------------------------ */
const wl = [...(/export const NO_BOTTOM_NAV: readonly Page\[\] = \[([^\]]*)\]/.exec(owner)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
for (const w of wl) {
  ok(!ownerKeys.has(w), `页面 ${w} 同时在白名单与归属表里（口径打架）`);
}

/* ⑤ 底栏高亮只走一个判据 -------------------------------------------------- */
ok(/function isBottomNavActive\(item: BottomNavPage, page: Page\): boolean/.test(owner), "navOwner.ts 缺 isBottomNavActive");
ok(/export function navOwner\(page: Page\): BottomNavPage/.test(owner), "navOwner.ts 缺 navOwner");
ok(/if \(page\.startsWith\("plugin:"\)\) return "mine";/.test(owner), "插件动态 tab 没有归属兜底");
ok(/isBottomNavActive\(item\.page, page\)/.test(layout), "BottomNav 没有走 isBottomNavActive（E6 的唯一判据）");
/* 只看 BottomNav 函数体：桌面侧栏的 NAV 行仍有自己的 activePages（那是侧栏口径，不在 E6 范围） */
const bottomNavFn = /function BottomNav\([\s\S]*?\n\}/.exec(layout)?.[0] ?? "";
ok(!!bottomNavFn, "解析不到 BottomNav 函数体");
ok(!/activePages/.test(bottomNavFn), "底栏高亮又回到每项自己的 activePages（会出现「无选中」）");

/* ⑥ 覆盖面自检：邮箱/设置必须归属「我的」（霖举的例子 + E3 底栏换项） ------- */
ok(/(?:"mail"|mail):\s*"mine"/.test(owner), "mail 的归属不是「我的」（霖举的反例页面）");
ok(/(?:"settings"|settings):\s*"mine"/.test(owner), "设置页的归属不是「我的」（E3 起设置是「我的」页里的入口）");

if (fails.length) {
  console.error("底栏归属护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`底栏归属护栏：归属表穷尽 ${pageMembers.length} 个页面 + 五项归属值合法 + 白名单无重叠 + 唯一判据 + 插件 tab 兜底 ✓`);
