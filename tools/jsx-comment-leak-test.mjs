#!/usr/bin/env node
/**
 * 护栏：JSX children 位置里的 `/* token-ok *\/` 不是注释，会被当正文渲染给用户。
 *
 * 为什么要有它：JSX 的元素/表达式**后面**写 `/* … *\/`，那个位置是 children，
 * 于是整串注释变成文本节点原样出现在界面上——2026-10-05 霖在「忽略这条作业」弹窗里
 * 看到正文印着 `/* token-ok: 同上（玻璃层上的墨色） *\/`（`lib/confirm.tsx`），
 * 全仓同一模式共 7 处。它在代码里看起来与注释一模一样，人眼 review 抓不住，必须机器判。
 *
 * 规则（只扫 .tsx）：
 *   `token-ok` 处于 **code 位置**（不在字符串 / 模板串 / 行注释里）时，若它前面的
 *   同一行代码以 JSX 标签或 JSX 表达式容器收尾，即判定为 children 位置 → 红。
 * 判据 = 「是否处于 JSX children 位置」，所以这些合法形态不受影响：
 *   · 对象字面量成员行尾（`color: "#fff",  /* token-ok: … *\/`）；
 *   · 行注释（`// token-ok: …`，含写在 `//` 之后的块注释）；
 *   · 模板串内部（srcdoc / CSS 文本，例如 MailPage 的样式表）。
 *
 * 修法：把注释放进 JS 表达式（对象字面量 / 参数）里，或移到上一行写成 `//`。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

/** 扫描范围：应用前端 + 共享 UI 包 + 插件前端（都是 .tsx 可能写 JSX children 的地方） */
const SRC_DIRS = ["apps/desktop/src", "packages/ui/src", "plugins"];
const MARK = "token-ok";

function walk(dir, out = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (name === "node_modules" || name === "dist" || name === "target") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (extname(name) === ".tsx") out.push(p);
  }
  return out;
}

/**
 * 逐字符状态机，找出所有**处于 code 位置**的块注释起点。
 * 字符串 / 模板串 / 行注释 / 块注释里的 `token-ok` 一律不算（那些位置的
 * `/* … *\/` 是文本或本身就是注释内容，不会渲染）。模板串的 `${` 会切回 code。
 */
function codePositions(text) {
  const hits = [];
  const stack = ["code"];
  let i = 0;
  while (i < text.length) {
    const mode = stack[stack.length - 1];
    const c = text[i];
    const c2 = text[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "*") {
        const end = text.indexOf("*/", i + 2);
        const body = text.slice(i + 2, end === -1 ? text.length : end);
        if (body.includes(MARK)) {
          const lineStart = text.lastIndexOf("\n", i - 1) + 1;
          hits.push({
            line: text.slice(0, i).split("\n").length,
            before: text.slice(lineStart, i),
          });
        }
        stack.push("block");
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "/") { stack.push("line"); i += 2; continue; }
      if (c === '"') { stack.push("dq"); i += 1; continue; }
      if (c === "'") { stack.push("sq"); i += 1; continue; }
      if (c === "`") { stack.push("tpl"); i += 1; continue; }
      if (c === "}" && stack.length > 1 && stack[stack.length - 2] === "tpl-expr") {
        stack.pop();
        stack.pop();
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (mode === "tpl") {
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { stack.pop(); i += 1; continue; }
      if (c === "$" && c2 === "{") { stack.push("tpl-expr"); stack.push("code"); i += 2; continue; }
      i += 1;
      continue;
    }
    if (mode === "line") { if (c === "\n") stack.pop(); i += 1; continue; }
    if (mode === "block") { if (c === "*" && c2 === "/") { stack.pop(); i += 2; continue; } i += 1; continue; }
    // dq / sq
    if (c === "\\") { i += 2; continue; }
    if ((mode === "dq" && c === '"') || (mode === "sq" && c === "'")) stack.pop();
    i += 1;
  }
  return hits;
}

/** children 位置判据：注释前面同一行代码以 JSX 标签或 JSX 表达式容器收尾 */
function isJsxChildren(before) {
  const t = before.replace(/\s+$/, "");
  if (!t) return false;
  if (/<\/[A-Za-z][^<>]*>$/.test(t)) return true;          // …</div>
  if (/\/>$/.test(t)) return true;                          // <Icon />
  if (/<[A-Za-z][^<>]*>$/.test(t) && /\{\{|\{/.test(t)) return true; // <div style={{…}}>
  if (/\}$/.test(t) && /<\/[A-Za-z]/.test(t)) return true;  // {cond ? <div>…</div> : null}
  return false;
}

const files = SRC_DIRS.flatMap((d) => walk(d));
const bad = [];
let total = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const h of codePositions(text)) {
    total += 1;
    if (isJsxChildren(h.before)) {
      bad.push(relative(".", file).split("\\").join("/") + ":" + h.line + "  " + h.before.trim().slice(-52));
    }
  }
}

console.log("JSX 注释泄漏护栏（A6）：token-ok 不许出现在 JSX children 位置");
console.log("  code 位置 token-ok 注释：" + total + " 处 / 扫描 " + files.length + " 个 .tsx");
if (bad.length) {
  console.error("  ✗ " + bad.length + " 处会被当正文渲染（把注释放进 JS 表达式，或改用上一行 //）：");
  for (const b of bad) console.error("    " + b);
  process.exit(1);
}
console.log("  无 children 位置泄漏 ✓");
