#!/usr/bin/env node
/**
 * A5 护栏：四张统计卡只允许 1×4 / 2×2 / 4×1 三种排布。
 *
 * 为什么要有它：霖 2026-10-05 反馈网络学堂四张卡"换行没解决"——真机实测（K30 / 393px）
 * 是 **3 列 + 第 4 张另起一行**，且第 4 张卡的数字被裁切。病根是列数由
 * `auto-fit + minmax(150px,1fr)` 自己算（中等宽度必然算出 3 列），手机档另有一条
 * `!important` 三列覆盖。列数是**设计决定**，不能交给浏览器算，所以这里把
 * 「三档显式断点 + 无 3 列分支」钉死，并在宽度轴上模拟一遍实际落到的列数。
 *
 * 判据：`.stats-quad`（4 卡页挂这个类）在任意宽度下只可能落 1 / 2 / 4 列；
 * 通用 `.stats` 只给单列安全默认；3 卡页（`.stats-overview`）与 hero 页
 * （`.stats-hero`）各自持有显式预设，不受本护栏影响。
 */
import { readFileSync } from "node:fs";

const CSS = "apps/desktop/src/styles/global.css";
const SRC = readFileSync(CSS, "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/** 去注释（等长遮蔽、保留换行），再按大括号配对摊平成 {selector, body, ats, line} */
function parseCss(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules = [];
  const stack = [];
  let buf = "", line = 1, bufLine = 1, i = 0;
  while (i < clean.length) {
    const c = clean[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "{") {
      stack.push({ prelude: buf.trim(), bodyStart: i + 1, line: bufLine });
      buf = "";
      i++;
      bufLine = line;
      continue;
    }
    if (c === "}") {
      const top = stack.pop();
      if (top) {
        const body = clean.slice(top.bodyStart, i);
        if (!top.prelude.startsWith("@")) {
          rules.push({ selector: top.prelude, body, ats: stack.map((s) => s.prelude), line: top.line });
        }
      }
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  return rules;
}

const rules = parseCss(SRC);
const declOf = (r, prop) => {
  const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)").exec(r.body);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
};
/** 取该规则命中的宽度窗口（本仓只用 max-width / min-width 两档） */
function windowOf(r) {
  let max = Infinity, min = 0;
  for (const at of r.ats) {
    const mx = /max-width:\s*([\d.]+)px/.exec(at);
    const mn = /min-width:\s*([\d.]+)px/.exec(at);
    if (mx) max = Math.min(max, Number(mx[1]));
    if (mn) min = Math.max(min, Number(mn[1]));
  }
  return { min, max };
}
function colsOf(value) {
  const rep = /repeat\(\s*(\d+)\s*,/.exec(value || "");
  if (rep) return Number(rep[1]);
  if (/minmax\(0,\s*1fr\)|^1fr$/.test((value || "").trim())) return 1;
  return null;
}

/* [1] 通用 .stats：安全默认单列，且不得再用 auto-fit 自己算列数 */
const base = rules.filter((r) => /^\.stats\s*$/.test(r.selector.trim()));
ok(base.length === 1, "global.css 应恰有一处顶层 .stats 基座规则（实为 " + base.length + "）");
if (base.length) {
  const v = declOf(base[0], "grid-template-columns") ?? "";
  ok(!/auto-fit|auto-fill/.test(v), ".stats 基座不得用 auto-fit / auto-fill（列数是设计决定）");
  ok(colsOf(v) === 1, ".stats 基座应是单列安全默认（4 卡页挂 .stats-quad），实为 " + v);
}

/* [2] .stats-quad 三档：列数只许 {4,2,1}，且不许 !important、不许 px 定宽、不许依赖 :has() */
const quad = rules.filter((r) => /\.stats-quad\b/.test(r.selector));
ok(quad.length === 3, ".stats-quad 应恰有三条规则（4 / 2 / 1 三档），实为 " + quad.length);
const seen = new Set();
for (const r of quad) {
  const v = declOf(r, "grid-template-columns") ?? "";
  const n = colsOf(v);
  seen.add(n);
  ok(n === 1 || n === 2 || n === 4, ".stats-quad 出现非法列数 " + n + "（" + v + "）——3 列是明令禁止的排布");
  ok(!/!important/.test(r.body), ".stats-quad 不得用 !important（" + r.selector + "）");
  ok(!/\d+px/.test(v), ".stats-quad 不得写死 px 卡宽（" + v + "）");
  ok(/minmax\(0,\s*1fr\)/.test(v), ".stats-quad 轨道应是 minmax(0,1fr)（" + v + "）");
  ok(!/:has\(/.test(r.selector), ".stats-quad 不得依赖 :has()——WebView 96 不支持，K30 上会静默失效");
}
ok([...seen].sort().join(",") === "1,2,4", ".stats-quad 三档应覆盖 1/2/4 列，实为 " + [...seen].join("/"));

/* [3] 宽度轴模拟：任意宽度只落 1/2/4 列，393 落 2 列（真机口径）、840 落 4 列 */
function colsAt(w) {
  let cur = null;
  for (const r of quad) {
    const { min, max } = windowOf(r);
    if (w >= min && w <= max) cur = colsOf(declOf(r, "grid-template-columns"));
  }
  return cur;
}
const probes = [240, 320, 359, 360, 393, 480, 600, 768, 839, 840, 841, 1000, 1440];
const map = probes.map((w) => [w, colsAt(w)]);
for (const [w, c] of map) ok(c === 1 || c === 2 || c === 4, "宽度 " + w + "px 落到 " + c + " 列（只允许 1/2/4）");
ok(colsAt(393) === 2, "393px（K30 真机口径）应落 2 列，实为 " + colsAt(393));
ok(colsAt(359) === 1, "359px 应落 4×1，实为 " + colsAt(359));
ok(colsAt(360) === 2, "360px 应落 2 列，实为 " + colsAt(360));
ok(colsAt(840) === 4, "840px 应落 1×4，实为 " + colsAt(840));
ok(colsAt(839) === 2, "839px（4 列临界下方）应落 2 列，实为 " + colsAt(839));
ok(!map.some(([, c]) => c === 3), "存在落到 3 列的宽度（3+1 复发）");

/* [4] 手机档那条 !important 三列覆盖必须已删除（3+1 的直接成因） */
ok(!/html\.is-phone \.stats[^{]*\{[^}]*repeat\(\s*3/.test(SRC), "手机档还在给通用 .stats 强制三列（3+1 复发）");

/* [5] 卡子项必须可收缩（min-width: 0），否则 minmax(0,1fr) 也压不住内容 */
const card = rules.find((r) => /^\.stat-card\s*$/.test(r.selector.trim()));
ok(!!card && /min-width:\s*0/.test(card.body), ".stat-card 需要 min-width: 0（轨道可收缩的前提）");

/* [6] 3 卡页与 hero 页各自持有显式预设，且不被 .stats-quad 选中 */
for (const [sel, want, why] of [
  [".stats-overview", 3, "3 卡页（今日/首页概览）显式三列预设"],
  [".stats-hero", 2, "hero 页（校园卡）显式两列预设"],
]) {
  const r = rules.find((x) => x.selector.includes(sel) && declOf(x, "grid-template-columns"));
  ok(!!r, "缺少 " + sel + " 的显式列预设（" + why + "）");
  if (r) ok(colsOf(declOf(r, "grid-template-columns")) === want, sel + " 应为 " + want + " 列（" + why + "）");
  ok(!/\.stats-quad\b/.test(r ? r.selector : ""), sel + " 不该挂 .stats-quad");
}

/* [7] 4 卡调用点必须显式挂类：漏挂会退回单列（可见，不会静默变 3+1） */
for (const f of ["apps/desktop/src/pages/Learn.tsx", "apps/desktop/src/pages/info/ReportTab.tsx"]) {
  const t = readFileSync(f, "utf8");
  ok(/className="stats stats-quad"/.test(t), f + " 的四卡网格未挂 .stats-quad");
}

if (fails.length) {
  console.error("统计卡网格护栏（A5）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("统计卡网格护栏（A5）：1×4 / 2×2 / 4×1 三档显式 ✓ 无 3 列分支（393→2 / 840→4）✓ 无 auto-fit ✓ 3 卡页独立预设 ✓");
