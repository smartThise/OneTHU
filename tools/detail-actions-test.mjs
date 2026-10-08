#!/usr/bin/env node
/**
 * A2 护栏：文件详情页的「预览 / 下载」必须是一级动作（在页面主体），不许只藏在页头「…」菜单里。
 *
 * 为什么要有它：霖 2026-10-05 指出「作业文件页面，下载/预览都是要放到一级菜单的高频功能，
 * 为什么到了二级菜单里？」——此前两个动作都挂在 PageHead 的 menu（二级）。
 * 这条最容易反复的滑坡是**改回去**或**改成两处都有**（菜单留一份、主体再加一份，状态还会不一致），
 * 所以同时钉住「主体有一级动作行」与「菜单里不再有这两个动作」。
 */
import { readFileSync } from "node:fs";

const PAGE = "apps/desktop/src/pages/learn/FileDetailPage.tsx";
const CSS = "apps/desktop/src/styles/global.css";
const page = readFileSync(PAGE, "utf8");
const css = readFileSync(CSS, "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/* 早返回（!f 的"未找到"分支）之后才是正常渲染——一级动作行必须落在正常分支里 */
const early = page.indexOf("if (!f) {");
const mainBody = early >= 0 ? page.slice(page.indexOf("return (", early)) : "";

/* [1] 页头菜单里不许再出现预览 / 下载（否则就是重复入口） */
const menuIdx = mainBody.indexOf("menu={[");
ok(menuIdx >= 0, "FileDetailPage 找不到 PageHead 的 menu 属性（判据漂移，需人工确认）");
const menuRegion = menuIdx >= 0 ? mainBody.slice(menuIdx, mainBody.indexOf("]}", menuIdx) + 2) : "";
ok(!/预览/.test(menuRegion), "页头菜单里仍有「预览」——A2：预览要回到主体，不能菜单里再留一份");
ok(!/下载/.test(menuRegion), "页头菜单里仍有「下载」——A2：下载要回到主体，不能菜单里再留一份");

/* [2] 主体必须有一级动作行，且两个动作都在里面 */
const rowIdx = mainBody.indexOf('className="detail-actions"');
ok(rowIdx >= 0, "主体缺少 .detail-actions 一级动作行（预览/下载没有回到主体）");
{
  const row = rowIdx >= 0 ? mainBody.slice(rowIdx, mainBody.indexOf("</div>", rowIdx)) : "";
  ok(/预览/.test(row), ".detail-actions 里没有「预览」");
  ok(/下载/.test(row), ".detail-actions 里没有「下载」");
  ok(/btn-primary/.test(row), ".detail-actions 里没有主按钮（「页头下方主按钮组」至少有一个 .btn-primary）");
  ok(!/collect|收藏/.test(row), ".detail-actions 里混进了收藏——收藏是低频项，按 A4 应留在 ctx / 「…」菜单");
}

/* [3] 预览入口全页唯一（防"主体加了、菜单没删"这一类半途改动） */
/* 只数"按钮文案那一种"形态（整行就是「预览」）——注释里提到这个词不算入口 */
const previewLabels = page.split("\n").filter((l) => l.trim() === "预览").length;
ok(previewLabels === 1, "FileDetailPage 里作为按钮文案的「预览」有 " + previewLabels + " 处（应恰好一处，避免重复入口）");

/* [4] 收藏仍留在页头菜单（低频项不搬到主体） */
ok(/collect\.item/.test(menuRegion), "页头菜单里没有收藏项（低频项应留在菜单）");

/* [5] CSS：动作行等分、走令牌间距 */
const rule = /\.detail-actions\s*\{([^}]*)\}/.exec(css);
ok(!!rule, "global.css 缺少 .detail-actions 规则");
if (rule) {
  ok(/display:\s*flex/.test(rule[1]), ".detail-actions 应是 flex 行");
  ok(/gap:\s*var\(--gap-\d\)/.test(rule[1]), ".detail-actions 的间距应走令牌");
}
const kidRule = /\.detail-actions\s*>\s*\.btn\s*\{([^}]*)\}/.exec(css);
ok(!!kidRule, "global.css 缺少 .detail-actions > .btn 规则（两个按钮应等分宽度）");
if (kidRule) ok(/flex:\s*1 1 0/.test(kidRule[1]), ".detail-actions 的按钮应等分宽度（flex: 1 1 0）");

if (fails.length) {
  console.error("文件详情页一级动作护栏（A2）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("文件详情页一级动作护栏（A2）：预览/下载回到主体 .detail-actions ✓ 菜单只留收藏 ✓ 预览入口唯一 ✓ 按钮等分走令牌 ✓");
