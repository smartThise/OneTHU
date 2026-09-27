/**
 * §3.5 B2 卡片分层护栏（本批范围：「今日」卡流 + 通用卡 + 插件卡）。
 *
 * 防的是"三重表达"：卡片同时上底色 + 描边 + 阴影，层级反而说不清（手册 §3：
 * 同一个元素只用一种手段；描边仅用于输入类；阴影克制、浮层才用 --elev-3）。
 *
 * 断言：
 *   1) 页面底比卡片低一级（body = container-low，卡片 = container-lowest）；
 *   2) 已迁移卡片：色块 + 圆角令牌，无可见描边、无阴影；
 *   3) 卡片 hover 走状态层，不再改描边/叠阴影；
 *   4) 未迁移清单写在这里（B2b/B3 接着做），避免"以为全迁完了"。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const BASE = readFileSync("packages/ui/src/base.css", "utf8");

/* 尚未迁移（各有理由，别误判为漏做）：
   · 输入/表单类（.input/.field/.search-box/.mail-compose-fields）—— 描边属于输入语言，§3 明确保留
   · 浮层（.home-modal/.dock-panel/.plg-sheet/.hwremind-pop）—— 需要描边 + 阴影与页面分离
   · 列表容器（.mail-list/.mail-detail/.trace-card/.week-course/.app-card/.fav-tile）—— B2b 批量 |
   · 表格（.rich table/.dock-md table）—— 表格线是网格语义，不适用卡片规则 */
export const PENDING = [
  ".app-card",
  ".week-course",
  ".trace-card",
  ".mail-list",
  ".mail-detail",
];

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

/* [1] 页面底低一级：卡片才是"亮"的 */
const body = block(BASE, "body {");
ok(body.includes("var(--md-sys-color-surface-container-low)"), "页面底应为 container-low（卡片才亮得出来）");
ok(!/background:\s*var\(--bg\)/.test(body), "页面底不该再和卡片同色（--bg = surface = 白）");

/* [2] 已迁移的四类卡片 */
const FAMILY = [
  [".card {", "通用卡"],
  [".home-card {", "今日卡"],
  [".plg-stat {", "插件统计卡"],
  [".plg-card {", "插件模块卡"],
];
for (const [sel, label] of FAMILY) {
  const b = block(CSS, sel);
  ok(!!b, "找不到规则：" + sel + "（" + label + "）");
  if (!b) continue;
  ok(b.includes(CARD_BG), label + " 底色应为 container-lowest 色块");
  ok(/border-radius:\s*var\(--md-sys-shape-corner-(large|medium)\)/.test(b), label + " 圆角应走形状令牌");
  ok(
    !/border:\s*1px solid var\(--border(-strong)?\)/.test(b) || /border:\s*1px solid transparent/.test(b),
    label + " 不该有可见描边（要留位就用 transparent）",
  );
  ok(!/box-shadow/.test(b), label + " 不该上阴影（§3 同一元素只用一种手段）");
  ok(!/--elev-3/.test(b), label + " 不该借用浮层专属的 --elev-3");
}

/* [3] 卡片 hover 走状态层 */
ok(block(CSS, ".plg-card::after").includes("var(--md-sys-color-state-hover)"), "插件卡 hover 应走状态层");
ok(!/\.plg-card:hover\s*\{[^}]*border-color/.test(CSS), "插件卡 hover 不该再改描边");
ok(!/\.plg-card:hover\s*\{[^}]*box-shadow/.test(CSS), "插件卡 hover 不该再叠阴影");

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
  "卡片分层护栏：页面底下沉一级 ✓ " + FAMILY.length + " 类卡片色块化（全库 " + migrated + " 处）✓ 无描边/无阴影 ✓ hover 状态层 ✓ 未迁移 " + PENDING.length + " 类已登记",
);
