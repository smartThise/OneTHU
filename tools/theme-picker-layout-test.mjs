#!/usr/bin/env node
/**
 * 「更改主题」二级菜单的版面纪律护栏。
 *
 * 由来（用户两次实锤）：
 *   1) 纵向：菜单内容比面板高，撑破边框 → 正文容器必须 flex:1 + min-height:0 才能在内部滚动。
 *   2) 横向：菜单比面板宽，右侧「应用/卸载」被推出可视区、要手动横滑 → 网格项默认
 *      min-width:auto，卡片里不可断行的长串（裸仓库地址）会把列撑开，整列 min-content
 *      顶宽整个滚动容器。
 * 两条都不是"看着像"的小毛病，靠肉眼守不住，写进 CI。
 */
import { readFileSync } from "node:fs";

const PICKER = readFileSync("apps/desktop/src/components/ThemePickerModal.tsx", "utf8");
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 纵向：面板封顶 + 正文容器内部滚动 */
ok(/maxHeight: "92dvh"/.test(PICKER), "手机端面板没有 92dvh 封顶");
ok(/flex: 1, minHeight: 0/.test(PICKER), "正文容器缺 flex:1 + min-height:0（内容会撑破面板高度）");

/* 横向：网格列钳制 + 网格项可收缩 + 不渲染不可断行的长串 */
const gridHits = (PICKER.match(/gridTemplateColumns: "minmax\(0, 1fr\)"/g) || []).length;
ok(gridHits >= 2, "两个分区网格都要用 minmax(0,1fr) 钳制列宽（当前 " + gridHits + " 处）");
ok(/overflowX: "hidden"/.test(PICKER), "正文容器没有 overflow-x:hidden（会出现横向滚动条）");
ok(/className="market-card" style=\{\{ margin: 0, minWidth: 0/.test(PICKER), "市场卡缺 min-width:0（网格项默认 auto 会被内容撑开）");
ok(/overflowWrap: "anywhere"/.test(PICKER), "市场卡描述缺 overflowWrap:anywhere（长 URL 无法断行）");
ok(!/className="market-repo-link"/.test(PICKER), "菜单里不该渲染裸仓库地址（不可断行的最长串，撑宽主因）");

/* 手机端底部抽屉把手（B3b，纯 CSS） */
const handleIdx = CSS.indexOf(".theme-pick-panel::before");
ok(handleIdx > 0, "缺少手机端抽屉把手的 CSS");
ok(handleIdx > 0 && /width: 32px;[\s\S]{0,80}height: 4px;/.test(CSS.slice(handleIdx, handleIdx + 220)),
  "抽屉把手不是标准形状（32x4 圆角条）");

console.log(
  fails.length
    ? "主题菜单版面护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "主题菜单版面护栏：纵向 92dvh 封顶 + 内部滚动 ✓ 横向列宽钳制/可收缩/长串断行 ✓ 手机抽屉把手 ✓",
);
process.exit(fails.length ? 1 : 0);
