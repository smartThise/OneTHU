#!/usr/bin/env node
/**
 * UI 文案纪律检查（CI 用）。
 *
 * 由来（2026-09-20 与晓梦的方案讨论）：我们的前端由 AI 大量生成，AI 会把内部实现
 * 直接渲给用户看——设置页出现过 `onethu.home.layout / onethu.home.defaults` 这种
 * 本地键名，也大量出现「漫游 / 缓存 / token / SWR」这类工程词，以及一屏一百多字的
 * 说明书式说明。人靠记性守不住，交给 CI 守。
 *
 * 规则（只查用户可见文案，不查代码注释与标识符）：
 *   R1 禁用词：内部键名 / 工程术语 / 品牌无关的技术名词
 *      （b26 补「超时」：用户侧只剩「暂时没成功 / 稍后重试」这类可操作口径，
 *        真实网络诊断的原文（如 `网络超时：请确认校园网 / WebVPN 可达。`）不在扫描面
 *        （`lib/transport.ts`）内，逐条按文件豁免；见 tools/ui-copy-allow.json）
 *   R2 设置项说明过长：> MAX_DESC 字的说明句
 *   R3 文案里出现裸变量名样式（onethu.xxx.yyy、foo_bar、camelCase 出现在中文句里）
 *   R4 语气：完整句的「失败/异常」必须带行动词（重试/刷新/重新登录…）。
 *      以「：」结尾的是「前缀 + 详情」，详情由代码拼接，不算违规；
 *      状态标签等确实给不出行动词的，行尾写 `// ui-copy-lint-ok: 理由` 豁免。
 *
 * 扫描面（b25 补强，2026-10-05）：
 *   旧实现只按行抓 `"…"` / `'…'` / `>…<` 三类片段（`\`…\`` 含插值整串跳过），漏掉
 *   两处**用户可见**面：
 *     ① 带插值的模板串——`notify("yuketang", \`登录状态已失效（${x}）\`)` 这类真文案，
 *        旧实现在 `s.includes("${")` 处整串放行，一条都查不到；
 *     ② 独占一行的 JSX 文本——`<div>\n  登录状态已失效：…\n</div>` 两端没有 `>`/`<`，
 *        旧正则抓不到。
 *   补强后：状态机把注释去掉、把字符串与**模板串的字面段**（插值表达式剔除）取出来，
 *   再从「去注释去字面量」的代码文本里抽含中文的 **JSX 文本**段。
 *
 *   规则适用范围（刻意分层，避免把存量样式问题一次性拉成几百条）：老扫描面
 *   （引号字符串 + 同行 `>…<` 文本）继续跑 R1/R2/R4（与补强前逐条一致，无回归）；
 *   新扫描面（模板串字面段 + 独占行 JSX 文本）只跑 R1 禁用词——本轮的验收目标就是
 *   「用户可见文案里的「会话 / 凭据」必须被拦住」，R2/R4 的存量口径不动。
 *   明显的代码团（CSS / HTML 模板串，含 `{ } ; < >`）整串跳过，不当文案。
 *
 * 豁免：行尾写 `// ui-copy-lint-ok`（须写明理由），或整文件在 ALLOW_FILES 里，
 *       或 `tools/ui-copy-allow.json`（只给插件作者向字段 / 内部识别正则用）。
 *
 * 跑法：node tools/ui-copy-lint.mjs [--fix-report]
 * 退出码：有违规则 1（可直接接进 CI），无违规 0。
 *
 * 本文件的 `extractUserStrings()` / `lintSource()` 同时被 `tools/relogin-test.mjs`
 * 的 ㉓ 组导入做确定性断言（扫描面必须覆盖模板串与 JSX 文本），所以逻辑必须可导入——
 * CLI 部分只在直接执行时运行。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAX_DESC = 42; // 单条设置说明的字数上限（超过就该收进「?」或删）
const SCAN_DIRS = ["apps/desktop/src/pages", "apps/desktop/src/components"];
/** 明确豁免的文件（第三方/调试面板等） */
const ALLOW_FILES = new Set([]);

/** R1 禁用词（用户可见文案里出现即违规；注释里出现不算）。 */
export const BANNED = [
  [/\bonethu\.[a-z0-9.]+/i, "内部存储键名（onethu.*）"],
  [/\blocalStorage\b|\bsessionStorage\b/i, "内部存储 API 名"],
  [/\bSWR\b|\bIPC\b|\bJSON\b|\bRust\b|\bTauri\b|\bWebView\b/i, "框架/实现术语"],
  [/webvpn|wengine|XSRF|csrf|CAS|SM2|manifest|插件宿主/i, "校内网关/协议/工程术语"],
  [/原子/, "内部名词（用户侧应说「收藏项」）"],
  [/会话/, "内部名词（用户侧应说「登录状态」）"],
  [/超时/, "内部表述（用户侧应说「暂时没成功 / 稍后重试」这类可操作口径）"],
  [/凭据|凭证/, "内部名词（用户侧应说「绑定」）"],
  [/接口/, "工程术语（用户侧应说「数据」「来源」）"],
  [/\btoken\b|Token|Cookie|cookie/, "令牌术语（用户只需知道「登录状态」）"],
  [/漫游|会话桶|预取|埋点|幂等|降级|回退链/, "工程黑话"],
  [/缓存(?!已清除)/, "「缓存」对用户无意义"],
  [/变量|字段|参数|返回值|null|undefined|NaN/, "编程概念"],
  [/网堂|学堂首页(?!的)/, "机构简称（须用全称「网络学堂」）"],
];

/** R4：语气。完整句里出现失败类字眼却不说下一步做什么，就算违规。 */
const TONE_WORDS = /失败|异常|出错|错误|不可用|无法使用|超时|未授权|未成功/;
const ACTION_WORDS = /重试|再试|稍后|刷新|重新|检查|查看|确认|联系|网络|请|建议|打开|切换|设置|登录|下拉|手动|完成|详情|窗口/;
export function r4Hit(s) {
  if (!TONE_WORDS.test(s)) return null;
  if (/[：:]\s*$/.test(s)) return null;
  if (ACTION_WORDS.test(s)) return null;
  return s;
}

/** 只有当字符串"看起来是给用户看的"才检查：含中文，且不像代码片段。 */
export function looksUserFacing(text) {
  if (!/[\u4e00-\u9fa5]/.test(text)) return false;
  // JSX 文本里常混进表达式片段（`).filter((t) => ...`）：含这些符号的按代码跳过
  if (/[(){};]|=>|&&|\|\||\.filter\(|\.map\(/.test(text)) return false;
  return true;
}

/** 老扫描面（R1/R2/R4 全跑）：同行引号字符串 + `>…<` 之间的 JSX 文本。 */
const LEGACY_RE = /"([^"\\]{2,})"|'([^'\\]{2,})'|>([^<>{}]{2,})</g;
function legacyStrings(line) {
  const out = [];
  for (const m of line.matchAll(LEGACY_RE)) {
    const s = m[1] ?? m[2] ?? m[3] ?? "";
    if (looksUserFacing(s)) out.push(s);
  }
  return out;
}

/**
 * 从源码里抽「用户可见字符串/文本」。返回 `[{ line, text, surface }]`：
 *   surface = "legacy"（引号串 / 同行 `>…<`）→ R1 + R2 + R4；
 *           = "template"（模板串字面段）/ "jsx"（独占行 JSX 文本）→ 只 R1。
 */
export function extractUserStrings(src) {
  const found = new Map(); // key = line|text，老扫描面优先
  const add = (line, text, surface) => {
    const key = `${line}|${text}`;
    const prev = found.get(key);
    if (prev && prev.surface === "legacy") return;
    found.set(key, { line, text, surface });
  };

  // 状态机：去注释 + 抹掉字面量内容 → 剩下的中文段就是 JSX 文本
  const chars = src.split("");
  const nc = src.split(""); // 只抹注释、保留字符串（老扫描面要在无注释文本上跑）
  const n = src.length;
  let i = 0;
  let line = 1;
  let buf = "";
  let bufLine = 1;
  let tplSegs = [];
  let tplRaw = "";
  const flushTpl = () => {
    const codeBlob = /[{};<>]/.test(tplRaw);
    if (!codeBlob) for (const seg of tplSegs) if (looksUserFacing(seg.text)) add(seg.line, seg.text, "template");
    tplSegs = [];
    tplRaw = "";
  };
  const blank = (k) => {
    if (chars[k] !== "\n") chars[k] = " ";
  };
  const blankNC = (k) => {
    if (nc[k] !== "\n") nc[k] = " ";
  };
  const blankBoth = (k) => {
    blank(k);
    blankNC(k);
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") {
        blankBoth(i);
        i += 1;
      }
      continue;
    }
    if (c === "/" && c2 === "*") {
      blankBoth(i);
      blankBoth(i + 1);
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line += 1;
        blankBoth(i);
        i += 1;
      }
      if (i < n) {
        blankBoth(i);
        blankBoth(i + 1);
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      blank(i);
      i += 1;
      while (i < n && src[i] !== q && src[i] !== "\n") {
        if (src[i] === "\\") {
          blank(i);
          i += 1;
          if (i < n) {
            blank(i);
            i += 1;
          }
          continue;
        }
        blank(i);
        i += 1;
      }
      if (src[i] === q) {
        blank(i);
        i += 1;
      }
      continue;
    }
    if (c === "`") {
      blank(i);
      i += 1;
      buf = "";
      bufLine = line;
      let depth = 0;
      while (i < n) {
        const d = src[i];
        if (d === "\\") {
          blank(i);
          i += 1;
          if (i < n) {
            blank(i);
            i += 1;
          }
          continue;
        }
        if (depth === 0 && d === "`") {
          if (buf) tplSegs.push({ line: bufLine, text: buf });
          buf = "";
          blank(i);
          i += 1;
          break;
        }
        if (depth === 0 && d === "$" && src[i + 1] === "{") {
          if (buf) tplSegs.push({ line: bufLine, text: buf });
          buf = "";
          blank(i);
          blank(i + 1);
          i += 2;
          depth = 1;
          while (i < n && depth > 0) {
            const e = src[i];
            if (e === "\\") {
              blank(i);
              i += 1;
              if (i < n) {
                blank(i);
                i += 1;
              }
              continue;
            }
            if (e === "{") depth += 1;
            else if (e === "}") depth -= 1;
            if (e === "\n") line += 1;
            blank(i);
            i += 1;
          }
          bufLine = line;
          continue;
        }
        if (d === "\n") {
          if (buf) tplSegs.push({ line: bufLine, text: buf });
          buf = "";
          line += 1;
          bufLine = line;
          blank(i);
          i += 1;
          continue;
        }
        buf += d;
        tplRaw += d;
        blank(i);
        i += 1;
      }
      if (buf) tplSegs.push({ line: bufLine, text: buf });
      buf = "";
      flushTpl();
      continue;
    }
    i += 1;
  }
  if (buf) tplSegs.push({ line: bufLine, text: buf });
  if (tplSegs.length) flushTpl();

  // 老扫描面：在「只去注释、保留字符串」的文本上按行抓引号串与同行 `>…<`
  nc.join("")
    .split("\n")
    .forEach((l, idx) => {
      for (const s of legacyStrings(l)) add(idx + 1, s, "legacy");
    });

  // 去注释 / 去字面量后的代码文本里，含中文的段 = JSX 文本（含独占一行的多行文本）
  chars
    .join("")
    .split("\n")
    .forEach((l, idx) => {
      for (const m of l.matchAll(/[^\s<>{}=;()[\],.:!?&|+*"'`/\\]+/g)) {
        const s = m[0];
        if (looksUserFacing(s)) add(idx + 1, s, "jsx");
      }
    });

  return [...found.values()].sort((a, b) => a.line - b.line);
}

/** 对单份源码跑规则，返回违规列表（供护栏直接导入断言）。 */
export function lintSource(src, rel = "<source>") {
  const violations = [];
  const allow = ALLOW[rel] ?? [];
  const lines = src.split("\n");
  for (const { line, text, surface } of extractUserStrings(src)) {
    const raw = lines[line - 1] ?? "";
    if (raw.includes("ui-copy-lint-ok")) continue;
    if (allow.some((e) => text.includes(e.text))) continue;
    let reported = false;
    for (const [re, why] of BANNED) {
      const hit = re.exec(text);
      if (hit) {
        violations.push({ file: rel, line, rule: "R1", why, text: text.trim().slice(0, 60), hit: hit[0] });
        reported = true;
        break;
      }
    }
    if (reported || surface !== "legacy") continue; // 新扫描面只跑 R1（见文件头「规则适用范围」）
    if (r4Hit(text)) {
      violations.push({ file: rel, line, rule: "R4", why: "失败/异常类文案没有告诉用户下一步做什么", text: text.trim().slice(0, 60), hit: "" });
    }
    if (text.length > MAX_DESC) {
      violations.push({ file: rel, line, rule: "R2", why: `说明超过 ${MAX_DESC} 字`, text: text.trim().slice(0, 70) });
    }
  }
  return violations;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 显式豁免清单（tools/ui-copy-allow.json）：按「文件 + 文案片段」豁免并写明理由。
 *  只用于**面向插件作者**的字段与**内部识别正则**——用户可见文案一律不得豁免。 */
let ALLOW = {};
try {
  ALLOW = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/ui-copy-allow.json"), "utf8"));
} catch {
  /* 无清单 */
}

function main() {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file);
      if (ALLOW_FILES.has(rel)) continue;
      violations.push(...lintSource(fs.readFileSync(file, "utf8"), rel));
    }
  }

  const byRule = violations.reduce((a, v) => ((a[v.rule] = (a[v.rule] ?? 0) + 1), a), {});
  if (!violations.length) {
    console.log("✓ UI 文案纪律检查通过");
    process.exit(0);
  }
  console.log(`✗ UI 文案违规 ${violations.length} 处（R1 术语 ${byRule.R1 ?? 0} / R2 超长 ${byRule.R2 ?? 0} / R4 语气 ${byRule.R4 ?? 0}）\n`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  [${v.rule}] ${v.why}`);
    console.log(`      ${v.text}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
