/**
 * 主题变量名守卫。
 *
 * 主题是**数据**：vars 里写错一个变量名（--primry）不会报错、typecheck 也过，
 * 只是这条覆盖静默失效——用户切到该主题会看到「少了一块」的观感，很难归因。
 * 这里把「每个主题声明的变量名必须真实存在于设计令牌/CSS 里」变成硬检查。
 */
import { readFileSync, readdirSync } from "node:fs";

const THEME = "apps/desktop/src/state/theme.ts";
const CSS_DIRS = ["packages/ui/src", "apps/desktop/src/styles"];

/* 收集所有 CSS 里声明过的自定义属性（含 palette.css 的 tonal palette） */
const defined = new Set();
for (const dir of CSS_DIRS) {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".css")) continue;
    const text = readFileSync(dir + "/" + f, "utf8");
    for (const m of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  }
}

/* 解析 theme.ts：按主题分组收集 vars 键 */
const src = readFileSync(THEME, "utf8");
const themes = [];
let cur = null;
/* 只认 vars 块里的键：theme.ts 里还有一张 COMPAT_TO_SYSTEM 镜像表（Compat → System 角色），
   形状与主题 vars 相同但不是主题覆盖——按块识别跳过它；
   其余"长得像主题变量"的行仍然报出来（防止有人把 vars 写到主题定义之外）。 */
let inVars = false;
let inMap = false;
for (const line of src.split("\n")) {
  if (/^export const COMPAT_TO_SYSTEM\b/.test(line)) inMap = true;
  if (inMap) {
    if (/^\};/.test(line)) inMap = false;
    continue;
  }
  const idm = line.match(/id:\s*"(onethu\.theme\.[a-z0-9-]+)"/);
  if (idm) { cur = { id: idm[1], vars: [] }; inVars = false; }
  if (cur && /vars:\s*\{/.test(line)) inVars = true;
  const vm = line.match(/"(--[a-z0-9-]+)"\s*:/);
  if (vm) {
    if (inVars && cur) cur.vars.push(vm[1]);
    else themes.push({ id: "(未识别主题)", vars: [vm[1]] });
  }
  if (cur && /^\s{4}source:/.test(line)) { themes.push(cur); cur = null; inVars = false; }
}

const fails = [];
let total = 0;
for (const t of themes) {
  if (t.id === "(未识别主题)") { fails.push("有 vars 落在任何主题定义之外：" + t.vars.join(" ")); continue; }
  for (const v of t.vars) {
    total++;
    if (!defined.has(v)) fails.push(t.id + " 声明的 " + v + " 在 CSS 里没有定义（该覆盖不会生效）");
  }
}

console.log("主题变量守卫：" + themes.length + " 个主题 / " + total + " 条变量覆盖，对照 " + defined.size + " 个已定义变量");
if (fails.length) {
  console.error("  ✗ " + fails.length + " 处：");
  for (const f of fails) console.error("    " + f);
  process.exit(1);
}
console.log("  主题变量名全部有定义 ✓");
