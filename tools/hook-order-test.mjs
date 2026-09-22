/**
 * Hook 顺序护栏（R24 新增，全仓）：**组件体内「早返回之后的 Hook」一律不许存在**。
 *
 * 教训（用户实录）：`FilePreviewHost` 的 PDF 诊断 `useEffect` 被写在
 * `if (!cur) return null` 之后（上游 98f863d）→ 点开预览时本次渲染比上次多一个 Hook，
 * React 抛「Rendered more hooks than during the previous render」；异常发生在组件自身、
 * 页面内的错误边界兜不住 → **整窗白屏**。这类 bug 在纯类型检查/普通单测里完全看不出来，
 * 但代价是全应用不可用，必须静态钉死。
 *
 * 判定口径（TypeScript AST，避免"跨组件误报"）：
 *  · 只看大写开头的组件函数（含 memo/forwardRef 内层函数）；
 *  · 只看该函数体**顶层**语句：一旦出现过「含 return 的顶层语句」，其后任何顶层语句里
 *    出现 `useXxx(` 调用即判违规；
 *  · 嵌套函数体内的 return/Hook 不计入（回调里写 Hook 是另一类问题，不在本护栏口径）。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const SRC_ROOT = new URL("../apps/desktop/src", import.meta.url).pathname;
const HOOK_RE = /^use[A-Z0-9]/;

/** 收集「非嵌套函数」范围内、顶层语句里的 return / Hook 调用 */
function scanTopLevel(block, sf) {
  let earlyReturnLine = null;
  const offenders = [];
  for (const stmt of block.statements) {
    if (earlyReturnLine !== null) {
      const hit = findHookCall(stmt, sf);
      if (hit) offenders.push({ hookLine: hit.line, returnLine: earlyReturnLine, hook: hit.name });
      continue;
    }
    const ret = findReturn(stmt, sf);
    if (ret) earlyReturnLine = ret;
  }
  return offenders;
}

/** 语句内是否含 return（不下钻嵌套函数） */
function findReturn(node, sf) {
  let found = null;
  const walk = (n) => {
    if (found !== null) return;
    if (ts.isFunctionLike(n)) return; // 函数声明/嵌套函数内部的 return 都不算组件早返回
    if (ts.isReturnStatement(n)) {
      found = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/** 语句内是否含 Hook 调用（不下钻嵌套函数） */
function findHookCall(node, sf) {
  let found = null;
  const walk = (n) => {
    if (found !== null) return;
    if (ts.isFunctionLike(n)) return; // 回调里的 Hook 不算本护栏口径
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK_RE.test(n.expression.text)) {
      found = {
        name: n.expression.text,
        line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      };
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

const problems = [];

function analyzeFunction(node, sf) {
  const name = node.name && ts.isIdentifier(node.name) ? node.name.text : null;
  if (name && /^[A-Z]/.test(name) && node.body && ts.isBlock(node.body)) {
    for (const o of scanTopLevel(node.body, sf)) {
      problems.push(
        `${sf.fileName.replace(SRC_ROOT + "/", "")}:${o.hookLine} 组件 ${name} 在 ${o.returnLine} 行早返回之后调用 ${o.hook}()`,
      );
    }
  }
  ts.forEachChild(node, (child) => visit(child, sf));
}

function visit(node, sf) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
    analyzeFunction(node, sf);
    return;
  }
  ts.forEachChild(node, (child) => visit(child, sf));
}

function walkDir(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      walkDir(full);
      continue;
    }
    if (!/\.tsx?$/.test(ent.name)) continue;
    const sf = ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(sf, sf);
  }
}

walkDir(SRC_ROOT);

assert.deepEqual(problems, [], `组件体内「早返回之后的 Hook」会导致整窗白屏：\n${problems.join("\n")}`);
console.log(`Hook 顺序护栏：${SRC_ROOT.split("/").slice(-2).join("/")} 无「早返回后 Hook」违规 ✓`);
