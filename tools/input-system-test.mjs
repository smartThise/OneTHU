/**
 * §3.5 B3a 输入/表单护栏。
 *
 * 输入类与卡片相反：**描边属于输入语言，必须保留**（§3），靠 border-color + 聚焦环表达状态。
 * 本批统一的是三件事：① 高度只有 38 / 40(手机) / 32(紧凑) 三档；② padding 落 4pt 栅格；
 * ③ 圆角/底色/聚焦环全部走令牌（聚焦环 = --md-sys-focus-ring）。
 *
 * 断言：
 *   1) 常规输入（.field input/.field select/.input/.search-box）高度、padding、圆角、底色一致且令牌化；
 *   2) 聚焦规则统一（outline: none + accent 描边 + 令牌聚焦环），无 ad-hoc outline；
 *   3) 紧凑行内控件有明确清单（陪 32/30/24px 各一档，不并入常规输入）；
 *   4) 手机端有 40px 提升档。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");

/* 紧凑行内控件：尺寸天生跟着所在行（筛选条/提醒行/地图控件），不并入常规输入；
   清单必须真实存在，防止腐化。 */
export const COMPACT = [".filter-select", ".hwremind-custom input", ".trace-opt select"];

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
function block(selector) {
  const i = CSS.indexOf(selector);
  if (i < 0) return "";
  const from = CSS.indexOf("{", i);
  let depth = 0;
  for (let j = from; j < CSS.length; j++) {
    if (CSS[j] === "{") depth++;
    else if (CSS[j] === "}") {
      depth--;
      if (!depth) return CSS.slice(i, j + 1);
    }
  }
  return "";
}

/* [1] 常规输入的一致性与令牌化 */
const NORMAL = ["\n.field input {", "\n.field select,\n.input {", "\n.search-box {"];
const seen = [];
for (const sel of NORMAL) {
  const b = block(sel);
  ok(!!b, "找不到规则：" + sel.trim());
  if (!b) continue;
  const h = (b.match(/height:\s*(\d+)px/) || [])[1];
  ok(h === "38" || h === "40", sel.trim() + " 高度应是 38（常规）或 40（搜索框）：实际 " + h);
  const pad = (b.match(/padding:\s*([^;]+);/) || [])[1] || "";
  ok(/^0 12px$/.test(pad.trim()), sel.trim() + " 横向 padding 应为 12px（4pt 栅格）：实际 " + pad.trim());
  ok(b.includes("border-radius: var(--md-sys-shape-corner-medium)"), sel.trim() + " 圆角应走形状令牌");
  ok(/background:\s*var\(--md-sys-color-surface-container\)/.test(b), sel.trim() + " 底色应走 System container 令牌");
  ok(/border:\s*1px solid var\(--border\)/.test(b), sel.trim() + " 输入类必须保留描边（§3 输入语言）");
  seen.push(sel.trim());
}
ok(seen.length === 3, "常规输入类应覆盖 field input / input&select / search-box 三处，实际 " + seen.length);

/* [2] 聚焦规则统一 */
const FOCUS = ["\n.field input:focus {", "\n.search-box:focus-within {", "\n.field select:focus,\n.input:focus {"];
for (const sel of FOCUS) {
  const b = block(sel);
  ok(!!b, "找不到聚焦规则：" + sel.trim());
  if (!b) continue;
  ok(b.includes("outline: none"), sel.trim() + " 应有 outline: none（用聚焦环代替）");
  ok(b.includes("border-color: var(--accent)"), sel.trim() + " 描边应转为强调色");
  ok(b.includes("box-shadow: var(--md-sys-focus-ring)"), sel.trim() + " 应使用令牌聚焦环 --md-sys-focus-ring");
}
ok(!/outline:\s*2px solid var\(--accent\)/.test(CSS), "不应再有 ad-hoc 的 outline: 2px solid var(--accent)");

/* [3][4] 紧凑清单 + 手机档 */
for (const sel of COMPACT) ok(CSS.includes(sel), "紧凑行内清单里的 " + sel + " 已不存在，请更新清单");
ok(/html\.is-phone \.input,[\s\S]{0,80}height:\s*40px/.test(CSS), "手机端应有 40px 提升档");

if (fails.length) {
  console.error("输入/表单护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(
  "输入/表单护栏：3 类常规输入高度/padding/圆角/底色一致且令牌化 ✓ 3 条聚焦规则统一（令牌聚焦环）✓ 保留输入描边 ✓ 紧凑清单 " + COMPACT.length + " 项已登记 ✓ 手机 40px 档 ✓",
);
