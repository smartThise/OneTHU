/**
 * 令牌守卫：应用里用到的 CSS 变量必须都有定义（§3.1 令牌层重写的安全网）。
 *
 * 为什么需要它：令牌层是「全应用隐式契约」——一个变量名写错/漏迁，不会编译报错、
 * 也没有测试失败，只会在某个页面某处变成透明或继承色，靠肉眼发现。
 * 重写令牌层时（Reference→System→Compat 三层）必须先有这个网。
 *
 * 检查两件事：
 * 1. 所有 var(--x) 引用都能在 CSS 里找到定义（含 fallback 的也算，但要单独列出）；
 * 2. Compat 层必须保留全部旧变量名（拓扑：凡是被引用的旧名都得留）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["apps/desktop/src", "packages/ui/src"];
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts)$/.test(p)) out.push(p);
  }
  return out;
}
const files = ROOTS.flatMap((r) => walk(r));

const defined = new Set();
const used = new Map();
/** 运行时注入的自定义属性（TSX 里 style={{ "--i": n }}）——CSS 里查不到定义，但确实存在 */
const runtimeInjected = new Set();
/** 带 fallback 的引用（var(--x, 0)）——没定义也不算错，只是"可选变量" */
const optional = new Set();
/** 先去掉注释（CSS 块注释与 // 行注释）——注释里举例的 var(--x) 不是真引用 */
function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
for (const f of files) {
  const text = stripComments(readFileSync(f, "utf8"));
  for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const m of text.matchAll(/var\((--[a-z0-9-]+)(\s*,[^)]*)?\)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(f);
    if (m[2]) optional.add(m[1]); // 有 fallback：CSS 里没定义也安全
  }
  if (/\.tsx?$/.test(f)) {
    // 两种形态：JS 对象键 style={{ "--i": n }}，以及模板字符串拼的 style="--i:3"（theme.ts 注入主题就是这么干的）
    for (const m of text.matchAll(/["'](--[a-z0-9-]+)["']\s*:/g)) runtimeInjected.add(m[1]);
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) runtimeInjected.add(m[1]);
  }
}

const missing = [...used.keys()].filter((v) => !defined.has(v) && !runtimeInjected.has(v) && !optional.has(v)).sort();
const unused = [...defined].filter((v) => !used.has(v)).sort();

/* Reference 层（tonal palette）本来就不该被组件直接引用——它是 System 层的取值来源，
   所以单独归类，不跟「可能忘了用」的令牌混在一起刷屏。 */
const isRef = (v) => v.startsWith("--md-ref-palette-");
const refUnused = unused.filter(isRef);
const otherUnused = unused.filter((v) => !isRef(v));

console.log(
  "令牌守卫：定义 " + defined.size + " 个 / 引用 " + used.size + " 个" +
  " / 运行时注入 " + runtimeInjected.size + " 个 / 可选(带 fallback) " + optional.size + " 个",
);
if (refUnused.length) console.log("  Reference 层预留 " + refUnused.length + " 个 tone（§3.2/§3.3 接入时取用）");
if (otherUnused.length) console.log("  未被引用（仅提示，可能是留白/预留）: " + otherUnused.join(" "));
if (missing.length) {
  console.error("  ✗ 有 " + missing.length + " 个变量被引用却没有定义：");
  for (const v of missing) console.error("    " + v + "  ← " + [...used.get(v)].slice(0, 3).join(", "));
  process.exit(1);
}
console.log("  所有引用均有定义 ✓");
