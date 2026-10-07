#!/usr/bin/env node
/**
 * §3.8 降密度护栏（移动端密度层）。
 * 手机档是「比桌面松一档」的独立刻度，最容易在后续批次里被随手改回去——所以把
 * 正文基准、行高、gap 刻度、间距落网格钉住；同时保证删装饰线时别把功能性分隔线一起删掉。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* is-phone 的第一个规则块 = 刻度声明 */
const start = CSS.indexOf("html.is-phone {");
const layer = CSS.slice(start, CSS.indexOf("}", start) + 1);

ok(/--text-base: 15px/.test(layer), "手机正文基准应为 15px（§3.8：14 → 15）");
ok(/--text-sm: 14px/.test(layer), "手机 --text-sm 应为 14px");
for (const [tok, want] of [["--gap-1", "4px"], ["--gap-2", "8px"], ["--gap-3", "12px"], ["--gap-4", "16px"], ["--gap-5", "20px"], ["--gap-6", "24px"]]) {
  ok(layer.includes(tok + ": " + want), "手机 " + tok + " 应为 " + want + "（落在 4pt 网格上）");
}
ok(/html\.is-phone body \{[^}]*line-height: 1\.6/.test(CSS), "手机正文行高应为 1.6");

/* 层内不许再有字面 13px/14px 字号（应走 --text-* 令牌） */
const blocks = [...CSS.matchAll(/html\.is-phone[^{]*\{[^}]*\}/g)].map((m) => m[0]).join("\n");
ok(!/font-size: 1[34]px/.test(blocks), "手机层仍有字面 13px/14px 字号（应走 --text-* 令牌）");

/* 功能性分隔线必须还在（别把「删装饰线」做成「删所有线」） */
function hasDivider(sel, re) {
  const i = CSS.indexOf(sel);
  if (i < 0) return false;
  return re.test(CSS.slice(i, CSS.indexOf("}", i)));
}
for (const sel of [".row {", ".setting-row {", ".mail-row {", ".cloud-row {", ".tl-item {"]) {
  ok(hasDivider(sel, /border-(top|bottom): 1px solid var\(--md-sys-color-outline-variant\)/), sel + " 的功能性分隔线被误删");
}
/* 装饰性分隔线（卡片头/浮层头脚）应已删除——这些容器有自己的底色分层 */
for (const sel of [".dock-head {", ".dock-foot {"]) {
  ok(!hasDivider(sel, /border-(top|bottom): 1px solid/), sel + " 的装饰性分隔线应已删除（已有底色分层）");
}

console.log(
  fails.length
    ? "密度护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "密度护栏：手机正文 15px/行高 1.6 ✓ gap 刻度落 4pt 网格 ✓ 字号走令牌 ✓ 功能性分隔线在、装饰性已删 ✓",
);
process.exit(fails.length ? 1 : 0);
