#!/usr/bin/env node
/**
 * B1 护栏：写死颜色清零（颜色字面量只许走令牌）。
 *
 * 为什么要有它：主题三档（亮 / 暗 / 动态取色）全靠令牌层切换。任何一处写死的 `#hex`
 * 或 `rgb()/rgba()` 都会在某档主题下变成瞎色——单看一处没问题，全项目堆起来就是
 * 「暗色下选中态什么都看不见」这类 bug（B6 的同源病灶）。
 *
 * 规则：
 *   1. `apps/desktop/src/**\/*.tsx|ts` 与 `apps/desktop/src/styles/*.css` 里的颜色字面量
 *      逐文件计数，只拦新增（ratchet，同 style-scan 的做法）；
 *   2. `state/theme.ts` 是令牌定义处，整文件豁免；
 *   3. 单行确需例外时写 `/* token-ok: 原因 *\/`（TSX 里 `// token-ok: 原因` 亦可）。
 *
 * 用 `--write-baseline` 把当前存量写进基线；每清一批就把基线降下来。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";

const BASELINE = "tools/token-leak-baseline.json";
const SRC = "apps/desktop/src";
const CSS_DIR = "apps/desktop/src/styles";
/** 令牌定义处：颜色就该写在这里（theme.ts 生成 :root[data-theme] 变量） */
const EXEMPT_FILES = new Set(["state/theme.ts"]);
const OK_MARK = "token-ok";
/** 颜色字面量：hex / rgb() / rgba() / hsl() / hsla()
 *  · 函数式要求首参是数字，跳过 hsl(${…}) 这类动态值；
 *  · hex 前不能是 & ——`&#160;` 是 HTML 实体，不是颜色。 */
const LITERAL = /(?<!&)#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[\d.][^)]*\)|\bhsla?\(\s*[\d.][^)]*\)/g;

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.has(extname(name))) out.push(p);
  }
  return out;
}

/** 去注释：块注释等长遮蔽**且保留换行**（行号必须与原文一一对应，否则 token-ok 会豁免错行）；
 *  ts/tsx 另去行注释（保留 http:// 这类 URL） */
function stripComments(text, isTs) {
  let s = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  if (isTs) s = s.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
  return s;
}

const files = [
  ...walk(SRC, new Set([".tsx", ".ts"])),
  ...walk(CSS_DIR, new Set([".css"])),
];

const current = {};
let total = 0;
for (const file of files) {
  const rel = relative(".", file).split("\\").join("/");
  const short = relative(SRC, file).split("\\").join("/");
  if (EXEMPT_FILES.has(short)) continue;
  const isTs = /\.(tsx|ts)$/.test(file);
  const raw = readFileSync(file, "utf8");
  const rawLines = raw.split("\n");
  const lines = stripComments(raw, isTs).split("\n");
  const bag = {};
  lines.forEach((line, i) => {
    /* token-ok 写在注释里，遮蔽后就看不见了——所以要在原始行上判豁免 */
    if (rawLines[i]?.includes(OK_MARK)) return;
    for (const m of line.matchAll(LITERAL)) {
      const lit = m[0].replace(/\s+/g, "").toLowerCase();
      bag[lit] = (bag[lit] ?? 0) + 1;
      total += 1;
    }
  });
  if (Object.keys(bag).length) current[rel] = bag;
}

const write = process.argv.includes("--write-baseline");
if (write) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log("已写入基线 " + BASELINE + "：颜色字面量 " + total + " 处 / " + Object.keys(current).length + " 个文件");
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const baseTotal = Object.values(baseline).reduce(
  (a, bag) => a + Object.values(bag).reduce((x, y) => x + y, 0),
  0,
);

const added = [];
for (const [file, bag] of Object.entries(current)) {
  for (const [lit, count] of Object.entries(bag)) {
    const base = baseline[file]?.[lit] ?? 0;
    if (count > base) added.push(file + "  " + lit + "：" + base + " → " + count);
  }
}

const top = Object.entries(current)
  .map(([f, bag]) => [f, Object.values(bag).reduce((a, b) => a + b, 0)])
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6);

console.log("颜色令牌护栏（B1）：写死颜色只许减不许增");
console.log("  颜色字面量：" + total + " 处 / " + Object.keys(current).length + " 个文件（基线 " + baseTotal + " 处）");
console.log("  待清理 Top：" + top.map(([f, n]) => f.split("/").pop() + "(" + n + ")").join(" "));

if (added.length) {
  console.error("  ✗ 新增 " + added.length + " 处写死颜色（用令牌，或行内写 " + OK_MARK + ": 原因）：");
  for (const a of added.slice(0, 20)) console.error("    " + a);
  process.exit(1);
}
console.log("  无新增写死颜色 ✓");
