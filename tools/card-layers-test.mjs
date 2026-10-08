/**
 * §3.5 B2/B2b 卡片与列表分层护栏。
 *
 * 防的是"三重表达"：卡片同时上底色 + 描边 + 阴影，层级反而说不清（手册 §3：
 * 同一个元素只用一种手段；描边仅用于输入类；阴影克制、浮层才用 --elev-3）。
 *
 * 断言：
 *   1) 页面底比卡片低一级（body = container-low，卡片 = container-lowest）；
 *   2) 已迁移卡片/列表：色块 + 圆角令牌，无可见描边、无阴影；
 *   3) hover 走 §5 状态层（共享 .btn::after 体系），不再改描边/底色；
 *   4) 未迁移清单写在这里（各有理由），避免"以为全迁完了"。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const BASE = readFileSync("packages/ui/src/base.css", "utf8");

/* 尚未迁移（各有理由，别误判为漏做）：
   · 输入/表单类（.input/.field/.search-box/.mail-compose/.trace-opt/[select]）—— 描边属于输入语言，§3 明确保留
   · 浮层（.home-modal/.plg-sheet/.dock-panel/.hwremind-pop/.trace-card 地图浮卡）—— 需要描边 + 阴影与页面分离
   · 模态内卡片（.wb-kind/.wb-row）—— 已随 B3b 弹层一起迁移（白底弹层上用灰阶分层）
   · 表格（.rich table/.dock-md table）—— 表格线是网格语义，不适用卡片规则
   · 收藏磁贴（.fav-tile*）—— 收藏是红线区，不动 */
export const PENDING = [
  ".trace-card",
  ".trace-opt",
  ".mail-compose",
  ".fav-tile-btn",
];

/* C18（霖 2026-10-01 走查）：余额速览是 shellFree 的整条卡，曾经自带一条外描边——今日页其它
   卡片（.card）都没有描边，只有它突兀。这里钉两件事：它不再有描边；它在默认顺序里已后移
   （「降低优先级」而不是删除，电费入口仍在）。 */
const TODAY = readFileSync("apps/desktop/src/pages/Today.tsx", "utf8");
const CARDS = readFileSync("apps/desktop/src/lib/homeCards.ts", "utf8");
const strip = CSS.slice(CSS.indexOf(".balance-strip {"), CSS.indexOf("}", CSS.indexOf(".balance-strip {")));
if (/border: 1px solid/.test(strip)) fails.push("余额速览又有了外描边（今日页只有它一处突兀）");
if (/border:\s*0/.test(strip) === false) fails.push("余额速览没有显式声明 border: 0");
const order = /id: "balance-strip"[^}]*defaultOrder: ([\d.]+)/.exec(CARDS);
if (!order) fails.push("找不到 balance-strip 的 defaultOrder");
else if (Number(order[1]) < 4) fails.push("余额速览的默认顺序没有后移（现在 " + order[1] + "，应在猜你喜欢之后）");
if (!/dormSection: "ele"/.test(TODAY) || !/宿舍电费/.test(TODAY)) fails.push("电费入口被删了（只能降优先级，不能做功能减法）");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
function block(src, selector) {
  const i = src.indexOf(selector);
  if (i < 0) return "";
  const from = src.indexOf("{", i);
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (!depth) return src.slice(i, j + 1);
    }
  }
  return "";
}

const CARD_BG = "var(--md-sys-color-surface-container-lowest)";
const SHAPE = /border-radius:\s*var\(--md-sys-shape-corner-(large|medium)\)/;

/* [1] 页面底低一级：卡片才是"亮"的 */
const body = block(BASE, "body {");
ok(body.includes("var(--md-sys-color-surface-container-low)"), "页面底应为 container-low（卡片才亮得出来）");
ok(!/background:\s*var\(--bg\)/.test(body), "页面底不该再和卡片同色（--bg = surface = 白）");

/* [2] 已迁移家族（B2 卡片 + B2b 列表/面板） */
const FAMILY = [
  [".card {", "通用卡"],
  [".home-card {", "今日卡"],
  [".plg-stat {", "插件统计卡"],
  [".plg-card {", "插件模块卡"],
  [".app-card {", "更多 info 应用卡"],
  [".week-course {", "课表课程块"],
  [".plg-install {", "插件安装面板"],
  [".mail-list {", "邮件列表面板"],
  [".mail-detail {", "邮件详情面板"],
];
for (const [sel, label] of FAMILY) {
  const b = block(CSS, sel);
  ok(!!b, "找不到规则：" + sel + "（" + label + "）");
  if (!b) continue;
  ok(b.includes(CARD_BG), label + " 底色应为 container-lowest 色块");
  ok(SHAPE.test(b), label + " 圆角应走形状令牌");
  ok(
    !/border:\s*1px solid var\(--border(-strong)?\)/.test(b) || /border:\s*1px solid transparent/.test(b),
    label + " 不该有可见描边（要留位就用 transparent）",
  );
  ok(!/box-shadow/.test(b), label + " 不该上阴影（§3 同一元素只用一种手段）");
  ok(!/--elev-3/.test(b), label + " 不该借用浮层专属的 --elev-3");
}

/* [3] hover 走共享状态层，不再改描边/底色 */
const layerBase = block(CSS, ".btn::after,");
for (const sel of [".app-card::after", ".mail-row::after"]) {
  ok(layerBase.includes(sel), "共享状态层应包含 " + sel);
}
const sharedHover = block(CSS, ".btn:hover::after,");
ok(sharedHover.includes(".app-card:hover::after") && sharedHover.includes(".mail-row:hover::after"), "共享 hover 层应包含 app-card/mail-row");
ok(!/\.app-card:hover\s*\{[^}]*border-color/.test(CSS), "app-card hover 不该再改描边");
ok(!/\.app-card:hover\s*\{[^}]*background/.test(CSS), "app-card hover 不该再改底色");
ok(!/\.mail-row:hover\s*\{[^}]*background/.test(CSS), "mail-row hover 不该再改底色");

/* [4] 未迁移清单必须真实存在（防止清单腐化成空话） */
for (const sel of PENDING) {
  ok(CSS.includes(sel), "未迁移清单里的 " + sel + " 在 CSS 里已经不存在了，请更新清单");
}

if (fails.length) {
  console.error("卡片分层护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
const migrated = (CSS.match(/background: var\(--md-sys-color-surface-container-lowest\)/g) || []).length;
console.log(
  "卡片分层护栏：页面底低一级 ✓ " + FAMILY.length + " 类卡片/列表色块化（全库 " + migrated + " 处）✓ 无描边/无阴影 ✓ hover 状态层 ✓ 未迁移 " + PENDING.length + " 类已登记",
);
