#!/usr/bin/env node
/**
 * C3 窄屏换行护栏（霖 2026-10-01 走查）。
 * 真机取证：400px 宽下在线服务页被 auto-fill 挤出两列 174px 的卡，卡里两个动作按钮又吃掉
 * 46px，服务名只剩 46px——「亲友来访人员报备」被折成三行。这一条把两处口径钉住：
 *   ① 窄屏服务卡改上下布局（单列 + 文本占满整行 + 动作落下一行），卡面只留「收藏」一项动作；
 *   ② 网络学堂四宫格用**固定列数**（宽屏 4 / 手机 2），不许再用 auto-fill（那就会排出 3+1）。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const THOS = readFileSync("apps/desktop/src/pages/info/ThosPage.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ---------- ① 服务卡：窄屏上下布局 ---------- */
const gridStart = CSS.indexOf(".thos-grid {");
ok(gridStart >= 0, "找不到 .thos-grid 规则");
const gridBlock = CSS.slice(gridStart, CSS.indexOf("}", gridStart) + 1);
/* 宽屏基础列数保持原值（auto-fill 260px）——C3 只改窄屏，别顺手动 PC */
ok(/minmax\(260px, 1fr\)/.test(gridBlock), ".thos-grid 宽屏基础列数被动过（C3 只应改窄屏）");

const narrowStart = CSS.indexOf("@media (max-width: 839.98px) {\n  .content .thos-grid {");
ok(narrowStart >= 0, "缺少窄屏 .thos-grid 媒体块（手机要单列）");
if (narrowStart >= 0) {
  const narrow = CSS.slice(narrowStart, CSS.indexOf("\n}\n", narrowStart));
  /* 霖 2026-10-02 复看：文件中间那条 `.content [class*="grid"]` 窄屏兜底带 !important，
     普通声明（含普通内联）都压不过它——单列必须同特异性 + !important + 位置更后，三者缺一不可 */
  ok(/\.content \.thos-grid \{ grid-template-columns: minmax\(0, 1fr\) !important; \}/.test(narrow),
    "窄屏 .thos-grid 不是单列（或没带 !important/没走 .content 前缀——都会被 158px 兜底规则改写）");
  ok(/\.thos-service-card \.row \{[^}]*flex-direction: column/.test(narrow), "窄屏服务卡没改成上下布局（标题在上、动作在下）");
  ok(
    /\.content \.thos-service-open \{[^}]*width: 100%;[^}]*flex-direction: column;[^}]*flex-wrap: nowrap;/.test(narrow),
    "窄屏服务卡文本块没占满整行，或没锁成「列方向 + nowrap」——列方向配 wrap 会把名称/部门/标签折成并排多列",
  );
  /* 霖 2026-10-02：类型标签（表单/集成/指南）要小胶囊，不许被 stretch 拉成通栏长条 */
  ok(
    /\.content \.thos-service-open \{[^}]*align-items: flex-start;/.test(narrow),
    "窄屏服务卡没有把子元素对齐改成 flex-start（类型标签会被拉满整行）",
  );
  ok(
    /\.content \.thos-service-open \.chip \{ align-self: flex-start; \}/.test(narrow),
    "类型标签没有退回内容宽度（小胶囊）",
  );
  /* 这块必须排在 .thos-service-card .row / .thos-service-actions 之后，否则同特异性下被覆盖 */
  ok(narrowStart > CSS.indexOf(".thos-service-actions {"), "窄屏服务卡媒体块排在了基础规则之前（同特异性会被覆盖，等于没改）");
  ok(!/white-space: nowrap/.test(narrow), "窄屏服务卡媒体块里出现强制 nowrap（又会把标题压成一行两个字）");
}

/* ---------- ① 卡面只留一项动作 ---------- */
const actions = /<span className="thos-service-actions">([\s\S]*?)<\/span>/.exec(THOS);
ok(!!actions, "找不到服务卡的 .thos-service-actions");
if (actions) {
  ok(/<CollectStar/.test(actions[1]), "服务卡面丢了「收藏」星标（最必要的一项动作要留着）");
  ok(!/<button/.test(actions[1]), "服务卡面又摆回了第二个动作按钮（固定/取消固定归长按菜单）");
}
ok(/key: "pin"/.test(THOS) && /label: on \? "取消固定" : "固定"/.test(THOS), "长按菜单里没有「固定/取消固定」（卡面撤掉后它就没了入口）");

/* ---------- ② 四宫格固定列数 ---------- */
const courseStart = CSS.indexOf(".course-grid {");
ok(courseStart >= 0, "找不到 .course-grid 规则");
const courseBlock = CSS.slice(courseStart, CSS.indexOf("}", courseStart) + 1);
ok(/grid-template-columns: repeat\(4, 1fr\)/.test(courseBlock), "网络学堂四宫格宽屏不是固定 4 列（auto-fill 会排成 3+1）");
/* 四宫格手机档同样要压过那条 158px 兜底，所以和 .thos-grid 一起放在文件末尾的 C3 块里 */
const courseNarrow = /\.content \.course-grid \{ grid-template-columns: repeat\(2, 1fr\) !important; \}/.exec(CSS);
ok(!!courseNarrow, "网络学堂四宫格手机档不是固定 2 列（或没带 !important，会被窄屏兜底改成 auto-fill）");
const courseNarrowPos = CSS.indexOf(".content .course-grid { grid-template-columns: repeat(2, 1fr) !important; }");
ok(courseNarrowPos > CSS.indexOf('.content [class*="grid"]'), "四宫格窄屏规则排在了窄屏兜底之前（同特异性 + 都 !important 时靠后者胜）");
ok(!/@media \(max-width: 700px\) \{\s*\.course-grid/.test(CSS), "还留着旧的 700px 单列覆盖（会把手机档的 2 列又压成 1 列）");
/* 窄屏单列与四宫格两条都必须排在 `.content [class*="grid"]`（带 !important 的兜底）之后 */
ok(narrowStart > CSS.indexOf('.content [class*="grid"]'), "窄屏服务卡单列规则排在了窄屏兜底之前（会被它改写回 158px 两列）");

console.log(
  fails.length
    ? "窄屏换行护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "窄屏换行护栏：服务卡窄屏单列 + 上下布局 + 动作只留收藏 ✓ 四宫格固定 4/2 列 ✓",
);
process.exit(fails.length ? 1 : 0);
