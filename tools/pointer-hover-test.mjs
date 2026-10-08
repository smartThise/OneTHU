#!/usr/bin/env node
/**
 * A1 护栏：:hover 只作用于有指针的设备。
 *
 * 由来：手机 WebView 上点一下列表行/卡片会留下悬停态，看起来像卡住。修法是把悬停规则
 * 整体包进 `@media (hover: hover) and (pointer: fine)`（motion.css 已有同款先例）。
 * 本护栏做源码级断言，防止新写的悬停规则再漏到触屏上；扫描范围含内联在 tsx 里的样式串
 * （邮件 iframe 的 srcDoc、THubook 正文壳这类取不到全局样式的地方）。
 *
 * 断言：
 *   1. 每一处 :hover 都落在 hover 媒体块内（确需例外时行内写 `pointer-hover-ok: 理由`）；
 *   2. 不出现 any-hover / any-pointer / pointer: coarse（触屏笔记本会被 any-hover 误判）；
 *   3. 每个 hover 媒体块都用规范写法 `@media (hover: hover) and (pointer: fine)`。
 *
 * 扫描范围 = 仓库源码（apps/desktop/src、packages/ui/src）。打包进来的第三方样式表
 * （Quill 富文本工具条、Leaflet 地图控件）不在范围内，它们的悬停规则改不动；真机实测
 * 见 docs/ui-ux-polish-detailed.md A1 的落地记录。
 *
 * 跑法：node tools/pointer-hover-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const ROOTS = ["apps/desktop/src", "packages/ui/src"];
const EXTS = new Set([".css", ".tsx", ".ts"]);
const OK_MARK = "pointer-hover-ok";
const CANONICAL = "@media (hover: hover) and (pointer: fine)";

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

/** 注释按等长空格遮蔽：注释里的花括号会破坏配对，注释里的 :hover 也不算正文 */
const maskComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
const flat = (s) => s.trim().replace(/\s+/g, " ");
const lineOf = (s, pos) => s.slice(0, pos).split("\n").length;

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXTS.has(extname(f))) out.push(p);
  }
  return out;
}

/** 花括号配对找出所有 hover 媒体块（允许嵌套在 prefers-color-scheme 等块内） */
function hoverMediaBlocks(masked) {
  const blocks = []; // { open, close, prelude }
  const loose = []; // hover: hover 但缺 pointer: fine
  const stack = [];
  let preludeStart = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === "{") {
      const prelude = flat(masked.slice(preludeStart, i));
      const mentions = /\(\s*hover\s*:\s*hover\s*\)/.test(prelude);
      const bad = /any-hover|any-pointer|pointer\s*:\s*coarse/.test(prelude);
      const fine = /\(\s*pointer\s*:\s*fine\s*\)/.test(prelude);
      if (mentions && !bad && !fine) loose.push(prelude);
      stack.push({ hover: mentions && fine && !bad, open: i, prelude });
      preludeStart = i + 1;
    } else if (c === "}") {
      const fr = stack.pop();
      if (fr?.hover) blocks.push({ open: fr.open, close: i, prelude: fr.prelude });
      preludeStart = i + 1;
    } else if (c === ";") preludeStart = i + 1;
  }
  return { blocks, loose };
}

let occurrences = 0;
let mediaBlocks = 0;
const scanned = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes(":hover")) continue;
    const masked = maskComments(src);
    const rel = relative(".", file).split("\\").join("/");
    const { blocks, loose } = hoverMediaBlocks(masked);

    for (const p of loose) ok(false, rel + " 的 hover 媒体块缺少 pointer: fine：" + p);
    ok(!/any-hover/.test(masked), rel + " 出现 any-hover（触屏笔记本会被误判成有指针，A1 反例）");
    ok(!/any-pointer|pointer\s*:\s*coarse/.test(masked), rel + " 出现 any-pointer / pointer: coarse（同上）");
    for (const b of blocks) ok(b.prelude === CANONICAL, rel + " 的 hover 媒体块写法不规范：" + b.prelude + "（应为 " + CANONICAL + "）");

    let inside = 0;
    let exempt = 0;
    for (let i = 0; i < masked.length; i++) {
      if (!masked.startsWith(":hover", i)) continue;
      if (blocks.some((b) => i > b.open && i < b.close)) inside++;
      else {
        const ls = masked.lastIndexOf("\n", i) + 1;
        const le = masked.indexOf("\n", i);
        const line = src.slice(ls, le === -1 ? src.length : le);
        if (line.includes(OK_MARK)) exempt++;
        else ok(false, rel + ":" + lineOf(src, i) + " 的 :hover 不在 hover 媒体块内（触屏会残留悬停态）");
      }
      i += 5;
    }
    const total = (masked.match(/:hover/g) || []).length;
    ok(inside + exempt === total, rel + " :hover 计数不自洽（inside " + inside + " + exempt " + exempt + " ≠ " + total + "）");
    occurrences += inside + exempt;
    mediaBlocks += blocks.length;
    scanned.push(rel + "：" + inside + " 处" + (exempt ? "（豁免 " + exempt + "）" : ""));
  }
}

if (fails.length) {
  console.error("悬停护栏：不通过（" + fails.length + " 条）");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(
  "悬停护栏：:hover 全部落在 pointer-fine 媒体块内 ✓ " +
    occurrences +
    " 处 / " +
    mediaBlocks +
    " 个媒体块 / " +
    scanned.length +
    " 个文件 / 无 any-hover、无 pointer: coarse ✓",
);
