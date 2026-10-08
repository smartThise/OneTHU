#!/usr/bin/env node
/**
 * 组4 护栏（P 批 M 批跟随：C1 / C5 / E9-PC，霖 2026-10-06）。
 *
 * 这三条的共同点：**口径在移动端已经定死，PC 只是跟随**。容易漂的地方：
 *  · C5 在 PC 上悄悄又长回"右下角浮层"（移动端已经收进顶栏，PC 应同样收进侧栏底部）；
 *  · C1 的"滚动条不改变内容宽度"只在手机档写了 scrollbar-gutter，PC 档漏掉；
 *  · E9-PC 的返回/收藏位置靠 JSX 顺序固化（返回槽在前、页面级操作在后），顺序被改写就漂。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/* ── C1：PC 档滚动条出现与否不改变内容宽度 ── */
const pcBlock = (() => {
  /* 按"这段里必须收掉浮层"反查所属媒体块（不要绑死块内排版，块里会有注释与多行规则） */
  const j = CSS.indexOf(".shell .hard-refresh-fab");
  if (j < 0) return "";
  const i = CSS.lastIndexOf("@media", j);
  if (i < 0) return "";
  return CSS.slice(i, CSS.indexOf("}", j) + 1);
})();
ok(pcBlock.length > 0, "PC 档缺少「内容宽度稳定 + 收掉浮层」的那段媒体块");
ok(/scrollbar-gutter:\s*stable/.test(pcBlock), "C1：PC 档没有 scrollbar-gutter: stable");
/* 只有 overflow-y: scroll 才能真正锁宽：stable 对不可滚动的页不占位（长页/短页会差一个滚动条宽） */
ok(/html\s*\{[^}]*overflow-y:\s*scroll/.test(pcBlock), "C1：PC 档 html 没有 overflow-y: scroll（短页会比长页宽一个滚动条）");

/* ── C5：PC 收掉右下角浮层，两枚入口进侧栏底部 ── */
ok(/\.shell \.hard-refresh-fab\s*\{\s*display:\s*none/.test(pcBlock), "C5：PC 档没有收掉右下角浮层（.shell .hard-refresh-fab 仍在）");
ok(/<HardRefreshButton variant="foot" \/>/.test(LAYOUT), "C5：侧栏底部没有挂 foot 变体入口");
ok(/className="sb-foot-btn"/.test(LAYOUT), "C5：侧栏底部的入口没有 sb-foot-btn 类");
ok(/variant\?: "fab" \| "foot"/.test(LAYOUT), "C5：HardRefreshButton 没有 fab/foot 两种变体");
/* 登录页仍要保留浮层（它没有 .shell，不该被上面的规则误伤） */
ok(/<HardRefreshButton \/>/.test(LAYOUT), "登录页/壳层用的 FAB 变体被删了（登录页需要它）");

/* ── E9-PC：返回槽在前、页面级操作在后（结构固化） ── */
const headIdx = LAYOUT.indexOf("export function PageHead(");
const head = headIdx < 0 ? "" : LAYOUT.slice(headIdx, headIdx + 4000);
const backSlot = head.indexOf("{back}");
const actionsSlot = head.indexOf("{actions}");
const menuSlot = head.indexOf("pageHeadMenu");
ok(backSlot >= 0 && actionsSlot > backSlot, "E9-PC：页头里返回槽没有排在操作槽之前（返回要固定在左上）");
ok(menuSlot > backSlot || /page-head-actions[\s\S]{0,400}menu/.test(head), "E9-PC：页面级操作（收藏/刷新）没有渲染在页头右侧那一簇");

if (fails.length) {
  console.error("组4 护栏（C1/C5/E9-PC）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("组4 护栏：C1 PC 内容宽度稳定 ✓ C5 PC 收浮层 + 两枚入口进侧栏底部（登录页保留）✓ E9-PC 返回槽在前、页面级操作在右 ✓");
