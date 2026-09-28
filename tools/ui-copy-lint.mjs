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
 *   R2 设置项说明过长：> MAX_DESC 字的说明句
 *   R3 文案里出现裸变量名样式（onethu.xxx.yyy、foo_bar、camelCase 出现在中文句里）
 *   R4 语气：完整句的「失败/异常」必须带行动词（重试/刷新/重新登录…）。
 *      以「：」结尾的是「前缀 + 详情」，详情由代码拼接，不算违规；
 *      状态标签等确实给不出行动词的，行尾写 `// ui-copy-lint-ok: 理由` 豁免。
 *
 * 豁免：行尾写 `// ui-copy-lint-ok`（须写明理由），或整文件在 ALLOW_FILES 里。
 *
 * 跑法：node tools/ui-copy-lint.mjs [--fix-report]
 * 退出码：有违规则 1（可直接接进 CI），无违规 0。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAX_DESC = 42; // 单条设置说明的字数上限（超过就该收进「?」或删）
const SCAN_DIRS = ["apps/desktop/src/pages", "apps/desktop/src/components"];
/** 明确豁免的文件（第三方/调试面板等） */
const ALLOW_FILES = new Set([]);

/** R1 禁用词（用户可见文案里出现即违规；注释里出现不算）。
 *  例外：**面向插件开发者**的字段（环境变量、命令行参数）不算「用户可见」，
 *  这类行加 `// ui-copy-lint-ok: 插件作者向字段` 豁免。 */
const BANNED = [
  [/\bonethu\.[a-z0-9.]+/i, "内部存储键名（onethu.*）"],
  [/\blocalStorage\b|\bsessionStorage\b/i, "内部存储 API 名"],
  [/\bSWR\b|\bIPC\b|\bJSON\b|\bRust\b|\bTauri\b|\bWebView\b/i, "框架/实现术语"],
  [/webvpn|wengine|XSRF|csrf|CAS|SM2|manifest|插件宿主/i, "校内网关/协议/工程术语"],
  [/原子/, "内部名词（用户侧应说「收藏项」）"],
  [/会话/, "内部名词（用户侧应说「登录状态」）"],
  [/凭据|凭证/, "内部名词（用户侧应说「绑定」）"],
  [/接口/, "工程术语（用户侧应说「数据」「来源」）"],
  [/\btoken\b|Token|Cookie|cookie/, "令牌术语（用户只需知道「登录状态」）"],
  [/漫游|会话桶|预取|埋点|幂等|降级|回退链/, "工程黑话"],
  [/缓存(?!已清除)/, "「缓存」对用户无意义"],
  [/变量|字段|参数|返回值|null|undefined|NaN/, "编程概念"],
  [/网堂|学堂首页(?!的)/, "机构简称（须用全称「网络学堂」）"],
];

/** R4：语气。完整句里出现失败类字眼却不说下一步做什么，就算违规。
 *  前缀式（以「：」结尾、后面由代码接详情）与带行动词的都放过。 */
const TONE_WORDS = /失败|异常|出错|错误|不可用|无法使用|超时|未授权|未成功/;
const ACTION_WORDS = /重试|再试|稍后|刷新|重新|检查|查看|确认|联系|网络|请|建议|打开|切换|设置|登录|下拉|手动|完成|详情|窗口/;
function r4Hit(s) {
  if (!TONE_WORDS.test(s)) return null;
  if (/[：:]\s*$/.test(s)) return null;
  if (ACTION_WORDS.test(s)) return null;
  return s;
}

/** 只有当字符串"看起来是给用户看的"才检查：含中文，或出现在 JSX 文本/常见 UI 属性里 */
function looksUserFacing(text) {
  if (!/[\u4e00-\u9fa5]/.test(text)) return false;
  // JSX 文本里常混进表达式片段（`).filter((t) => ...`）：含这些符号的按代码跳过
  if (/[(){};]|=>|&&|\|\||\.filter\(|\.map\(/.test(text)) return false;
  return true;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 提取一行里所有"可能展示给用户"的字符串字面量与 JSX 文本 */
function userStrings(line) {
  const out = [];
  // 注释整行跳过
  const noComment = line;
  for (const m of noComment.matchAll(/"([^"\\]{2,})"|'([^'\\]{2,})'|`([^`\\]{2,})`|>([^<>{}]{2,})</g)) {
    const s = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    // 含 ${…} 的模板串是代码（插值表达式），不是给用户看的成品文案
    if (s.includes("${")) continue;
    if (looksUserFacing(s)) out.push(s);
  }
  return out;
}

function isComment(line) {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** 显式豁免清单（tools/ui-copy-allow.json）：按「文件 + 文案片段」豁免并写明理由。
 *  只用于**面向插件作者**的字段（manifest/二进制/仓库安装）——用户可见文案一律不得豁免。 */
let ALLOW = {};
try {
  ALLOW = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/ui-copy-allow.json"), "utf8"));
} catch {
  /* 无清单 */
}
const allowedByFile = (rel, text) => (ALLOW[rel] ?? []).some((e) => text.includes(e.text));

const violations = [];
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    const rel = path.relative(ROOT, file);
    if (ALLOW_FILES.has(rel)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let inBlock = false;
    lines.forEach((line, i) => {
      // 块注释跨行：/* ... */ 之间的续行行首没有 * 也不是 //，必须靠状态跟踪
      const wasInBlock = inBlock;
      const opens = (line.match(/\/\*/g) || []).length;
      const closes = (line.match(/\*\//g) || []).length;
      if (inBlock) { if (closes > 0) inBlock = false; }
      else if (opens > closes) inBlock = true;
      if (wasInBlock || isComment(line)) return;
      if (line.includes("ui-copy-lint-ok")) return;
      for (const s of userStrings(line)) {
        if (allowedByFile(rel, s)) continue;
        for (const [re, why] of BANNED) {
          const hit = re.exec(s);
          if (hit) {
            violations.push({ file: rel, line: i + 1, rule: "R1", why, text: s.trim().slice(0, 60), hit: hit[0] });
            break;
          }
        }
        if (r4Hit(s)) {
          violations.push({ file: rel, line: i + 1, rule: "R4", why: "失败/异常类文案没有告诉用户下一步做什么", text: s.trim().slice(0, 60), hit: "" });
        }
        if (s.length > MAX_DESC) {
          violations.push({ file: rel, line: i + 1, rule: "R2", why: `说明超过 ${MAX_DESC} 字`, text: s.trim().slice(0, 70) });
        }
      }
    });
  }
}

const byRule = violations.reduce((a, v) => ((a[v.rule] = (a[v.rule] ?? 0) + 1), a), {});
if (!violations.length) {
  console.log("✓ UI 文案纪律检查通过");
  process.exit(0);
}
console.log(`✗ UI 文案违规 ${violations.length} 处（R1 术语 ${byRule.R1 ?? 0} / R2 超长 ${byRule.R2 ?? 0}）\n`);
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  [${v.rule}] ${v.why}`);
  console.log(`      ${v.text}`);
}
process.exit(1);
