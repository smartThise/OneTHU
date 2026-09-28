#!/usr/bin/env node
/**
 * CSS 结构护栏。
 * 来由：2026-02 降密度批次的脚本切片写错（text[j+1:] 多吃一个括号），把
 * html.is-phone .list .row-click 的收尾 } 删了——于是它之后的所有规则都被嵌进这条规则里而失效，
 * 表现是「按钮全变浏览器默认样式、浮动按钮消失、页面错乱」。当时 27 项护栏一条都没拦住。
 * 这里只做最基本也最致命的检查：每个 CSS 文件的括号必须配平、注释必须闭合。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/desktop/src/styles", "packages/ui/src"];
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

/* 逐行扫描：既查括号配平，也查「规则被嵌进非 @ 规则」——后者正是少写一个 } 的典型后果，
   即使括号总数凑巧配平（一处删、一处多）也能抓出来。 */
function scan(file) {
  const raw = readFileSync(file, "utf8").split("\n");
  let depth = 0;
  let inComment = false;
  let openLine = 0;
  let cur = "";
  const stack = [];
  for (let n = 0; n < raw.length; n++) {
    const line = raw[n];
    for (let i = 0; i < line.length; i++) {
      const two = line.slice(i, i + 2);
      if (!inComment && two === "/*") { inComment = true; i++; continue; }
      if (inComment && two === "*/") { inComment = false; i++; continue; }
      if (inComment) continue;
      if (line[i] === "{") {
        const sel = cur.trim().split(/\s+/).slice(-6).join(" ");
        if (depth > 0) {
          const parent = stack[stack.length - 1] || "";
          if (!parent.startsWith("@")) {
            return { bad: "规则被嵌进了非 @ 规则「" + parent + "」里（多半是上面少了 }）", line: n + 1, depth };
          }
        } else openLine = n + 1;
        stack.push(cur.trim());
        depth++;
        cur = "";
      } else if (line[i] === "}") {
        depth--;
        stack.pop();
        if (depth < 0) return { bad: "多了一个 }", line: n + 1, depth };
        cur = "";
      } else {
        cur += line[i];
      }
    }
    cur += " ";
  }
  if (inComment) return { bad: "注释没有闭合 /*", line: raw.length, depth };
  if (depth !== 0) return { bad: "有 " + depth + " 个规则块没有闭合", line: openLine, depth };
  return null;
}

let checked = 0;
for (const root of roots) {
  for (const file of files(root)) {
    checked++;
    const r = scan(file);
    ok(!r, file + "：CSS 结构坏了——" + (r ? r.bad + "（第 " + r.line + " 行起）" : ""));
  }
}

console.log(
  fails.length
    ? "CSS 结构护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "CSS 结构护栏：" + checked + " 个样式文件括号配平、注释闭合 ✓",
);
process.exit(fails.length ? 1 : 0);
