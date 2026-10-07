import { readFileSync } from "node:fs";

/* 护栏：tab 类条目的"激活态"不得改变影响尺寸的属性（font-weight/font-size/padding/border-width），
   否则切换 tab 时字宽变化会把整条推走——表现为"tab 条随切换方向轻微左右移位"。
   约定（见 .segmented）：字重/内距恒定，激活只改颜色、底色、投影、下划线。 */
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

function block(selector) {
  const i = CSS.indexOf(selector);
  if (i < 0) return null;
  const j = CSS.indexOf("}", i);
  return CSS.slice(i, j);
}

for (const [name, base, active] of [
  [".tabstrip", ".tabstrip > button,", ".tabstrip > button.is-active,"],
  [".plg-tab", ".plg-tab {", ".plg-tab.is-on {"],
  [".segmented", ".segmented button {", ".segmented button.is-active {"],
]) {
  const b = block(base);
  ok(b !== null, name + " 基态规则未找到");
  if (b) ok(/font-weight:\s*\d+/.test(b), name + " 基态未显式声明 font-weight（激活态一加粗就把整条推走）");
  const a = block(active);
  ok(a !== null, name + " 激活态规则未找到");
  if (a) ok(!/font-weight/.test(a), name + " 激活态改了 font-weight → 切换 tab 会左右移位");
}

if (fails.length) {
  console.error("tab 条布局稳定性护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("tab 条布局稳定性护栏：激活态不改字重/内距，切换不产生左右移位 ✓");
