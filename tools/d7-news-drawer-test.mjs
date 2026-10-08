#!/usr/bin/env node
/**
 * D7 护栏（霖 2026-10-02）：待办页点新闻项 → 本页弹详情。
 *
 * 由来（docs/ui-ux-polish-detailed.md §5 D7）：待办页生活 tab 的新闻行原来写死
 * `navigate("info", { infoNewsId })`，一点就跳走；新闻详情本身又写死在 NewsTab 里、
 * 是「顶天立地」的右侧栏（94vw + borderRight:none，手机 400px 宽直接变整屏）。
 *
 * 这条链全是「一改就悄悄退化」的东西：把 onOpen 去掉会变回跳页、把手机分支改回右侧栏
 * 只有真机才看得出来、少了 useOverlayBack 返回键就直接退页。所以源码级钉死：
 *   ① 待办页点新闻不再触发 navigate("info", { infoNewsId … })（走 onOpen 本页弹）；
 *   ② 抽屉抽成了组件，NewsTab 与 TasksPage 共用（NewsTab 里不许再有内联抽屉）；
 *   ③ PC 面板有 16–24px 页边距常量（且 CSS 与常量一致）；
 *   ④ 手机（max-width: 839.98px）是底部抽屉、不是右侧栏；
 *   ⑤ 返回键 closer 接线存在（E1 的 useOverlayBack 浮层帧）；
 *   ⑥ 「全部新闻 →」仍然切页（只有新闻行不跳页）；
 *   ⑦ 分层：抽屉遮罩 z-index 必须低于底栏（手机底栏要一直看得见）。
 */
import { readFileSync } from "node:fs";

const TASKS = readFileSync("apps/desktop/src/pages/TasksPage.tsx", "utf8");
const NEWSTAB = readFileSync("apps/desktop/src/pages/info/NewsTab.tsx", "utf8");
const DRAWER = readFileSync("apps/desktop/src/components/NewsDetailDrawer.tsx", "utf8");
const ROWS = readFileSync("apps/desktop/src/components/HomeWidgets.tsx", "utf8");
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const NAVSTACK = readFileSync("apps/desktop/src/state/navStack.ts", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 待办页不再跳页 */
ok(!/infoNewsId/.test(TASKS), "待办页还残留 infoNewsId（点新闻仍会跳页）");
ok(/<NewsRows[^>]*onOpen=\{openNewsDetail\}/.test(TASKS), "待办页没给 NewsRows 传 onOpen（点新闻不会本页弹详情）");
ok(/NewsDetailDrawer[\s\S]{0,200}detail=\{newsDetail\}/.test(TASKS), "待办页没有渲染详情抽屉");

/* ② 组件共用：NewsRows 保留 navigate 兜底，NewsTab 不再内联 */
ok(/onOpen \? onOpen\(n\) : navigate\("info", \{ infoNewsId: n\.xxid \}\)/.test(ROWS),
  "NewsRows 的 onOpen 兜底没了（今日页等调用方会被连带改行为）");
for (const [file, name] of [[NEWSTAB, "NewsTab"], [TASKS, "TasksPage"]]) {
  ok(/from "[./]*components\/NewsDetailDrawer\.js"/.test(file) || /NewsDetailDrawer\.js"/.test(file),
    `${name} 没有引用 NewsDetailDrawer（详情会有两份实现）`);
}
ok(!/drawerMaskStyle|drawerPanelStyle/.test(NEWSTAB), "NewsTab 里还有内联抽屉样式（没抽干净）");
ok(/<NewsDetailDrawer/.test(NEWSTAB), "NewsTab 没有用共用抽屉组件");
ok(/createPortal\(/.test(DRAWER), "抽屉组件没有 createPortal 到 body（会被滚动容器裁掉）");
/* 附件下载等功能不许在抽取时丢：抽屉里必须有下载链路 */
for (const [re, msg] of [[/downloadLearnUrl/, "附件下载"], [/openFilePreview/, "附件预览"], [/DownloadOpenButtons/, "打开文件/目录"]]) {
  ok(re.test(DRAWER), `抽屉组件丢了${msg}（抽组件时把功能搬没了）`);
  ok(!re.test(NEWSTAB), `NewsTab 里还留着${msg}的实现（应只在抽屉组件里）`);
}

/* ③ PC 页边距常量 16–24px，且 CSS 与常量一致 */
const m = /NEWS_DRAWER_MARGIN\s*=\s*(\d+)/.exec(DRAWER);
ok(!!m, "抽屉组件没有 NEWS_DRAWER_MARGIN 常量（PC 页边距）");
if (m) {
  const px = Number(m[1]);
  ok(px >= 16 && px <= 24, `PC 页边距 ${px}px 不在 16–24px 内`);
  const mask = /\.news-drawer-mask\s*\{([^}]*)\}/.exec(CSS);
  ok(!!mask, "global.css 里没有 .news-drawer-mask 规则");
  if (mask) ok(new RegExp(`padding:\\s*${px}px`).test(mask[1]), `.news-drawer-mask 的 padding 与常量 ${px}px 不一致`);
}

/* ④ 手机是底部抽屉 */
const mobile = /@media \(max-width: 839\.98px\) \{([\s\S]*?)\n\}\n/.exec(CSS.slice(CSS.indexOf(".news-drawer-mask")));
ok(!!mobile, "找不到抽屉的窄屏（手机）媒体块");
if (mobile) {
  const body = mobile[1];
  ok(/\.news-drawer-mask\s*\{[^}]*align-items:\s*flex-end/.test(body), "手机遮罩没有贴底（不是底部抽屉）");
  ok(/\.news-drawer-panel\s*\{[^}]*border-radius:\s*18px 18px 0 0/.test(body), "手机面板没有顶部圆角（不是底部抽屉）");
  ok(/animation-name:\s*news-drawer-up/.test(body), "手机面板没有上滑进场（右侧栏动画没对齐）");
  ok(/\.news-drawer-grip\s*\{[^}]*display:\s*flex/.test(body), "手机没有下拉把手（不能下拉关闭）");
}
ok(/justify-content:\s*flex-end/.test(/\.news-drawer-mask\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ""), "PC 遮罩没有右对齐（不是右侧面板）");
ok(/DRAG_CLOSE_PX\s*=\s*\d+/.test(DRAWER), "抽屉没有下拉关闭阈值常量");

/* ⑤ 返回键 closer（E1 浮层帧） */
ok(/useOverlayBack\(NEWS_DETAIL_OVERLAY_ID, detail !== null, onClose\)/.test(DRAWER),
  "抽屉没有接 E1 的 useOverlayBack（返回键会直接退页）");
ok(/NEWS_DETAIL_OVERLAY_ID\s*=\s*"news-detail"/.test(DRAWER), "抽屉没有浮层帧 id");
ok(/export function useOverlayBack/.test(NAVSTACK), "E1 的 useOverlayBack 不见了");

/* ⑥ 「全部新闻 →」仍然切页 */
ok(/task-sec-more"[^>]*onClick=\{\(\) => navigate\("info", \{ infoTab: "news" \}\)\}/.test(TASKS),
  "「全部新闻 →」不再切页（应保持切页，只有新闻行不跳页）");

/* ⑦ 分层：遮罩在底栏之下 */
const maskZ = /\.news-drawer-mask\s*\{[^}]*z-index:\s*(\d+)/.exec(CSS);
const navZ = /\.bottom-nav\s*\{[^}]*z-index:\s*(\d+)/.exec(CSS);
ok(!!maskZ, "抽屉遮罩没有 z-index（分层不可控）");
ok(!!navZ, "底栏没有 z-index");
if (maskZ && navZ) {
  ok(Number(maskZ[1]) < Number(navZ[1]),
    `抽屉遮罩 z-index ${maskZ[1]} 不低于底栏 ${navZ[1]}（手机上会盖住底栏）`);
}

console.log(
  fails.length
    ? "D7 新闻抽屉护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "D7 新闻抽屉护栏：待办页点新闻本页弹（不跳页）+ 抽屉两端共用 + PC 20px 页边距 + 手机底部抽屉 + 返回键先关 + 底栏压在遮罩之上 ✓",
);
process.exit(fails.length ? 1 : 0);
