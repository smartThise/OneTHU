#!/usr/bin/env node
/**
 * 文档文案纪律检查（CI 用）。
 *
 * 由来：docs/ 下的正文多次混入聊天体写法（口号式引号短语、比喻动词、第二人称、建议式
 * 祈使），读者（项目作者）两次指出同一问题，且每次都是「改完这一批，下一批新写的又
 * 带进来」。人工检查难以长期保持，因此该规则由工具校验——与 tools/ui-copy-lint.mjs
 * 同一思路，只是对象从「用户可见文案」换成「文档正文」。
 *
 * 规则：
 *   D1 比喻与口语动词（串味、裸奔、直塞、吃掉、黑箱、白烧、搞定、顺手…）
 *   D2 第一人称与第二人称（我们、咱们、你）
 *   D3 元话语（其实、说白了、一句话、简单说）
 *   D4 建议式祈使与劝告（不要…、别…、千万…）
 *   D5 成语与口号式短语（丢三落四、一眼假、宁可不跳…）
 *
 * 不检查（这些是证据，必须逐字保留）：``` 代码块、`行内代码`、以 `>` 开头的引用块
 * （用户报障原句、报错原文、日志行）。
 *
 * 豁免：行尾写 `<!-- docs-prose-lint-ok: 理由 -->`，或把片段写进
 * tools/docs-prose-allow.json（按文件 + 片段 + 理由，用于 UI 文案样例等）。
 *
 * 跑法：node tools/docs-prose-lint.mjs
 * 退出码：有违规则 1（可直接接进 CI），无违规 0。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");
const ALLOW_FILE = path.join(ROOT, "tools", "docs-prose-allow.json");

/** 命中即违规的词。注释里写明「为什么这个词不能出现在正文」。 */
const BANNED = [
  // D1 比喻与口语动词
  ["串味", "比喻（不同场景的文案混在一起）"],
  ["裸奔", "比喻"],
  ["直塞", "比喻（直接写入）"],
  ["吃掉", "比喻（占用 / 消耗）"],
  ["吃到", "比喻"],
  ["一坨", "量词化的贬义口语"],
  ["黑箱", "比喻（不可观测）"],
  ["白烧", "比喻（无谓消耗）"],
  ["翻车", "比喻"],
  ["打脸", "比喻"],
  ["拍脑袋", "比喻（凭经验设定）"],
  ["硬扛", "口语（勉强承受）"],
  ["拉倒", "口语"],
  ["土办法", "口语"],
  ["搞定", "口语"],
  ["弄一下", "口语"],
  ["弄好", "口语"],
  ["顺手", "口语（连带做）"],
  ["顺带", "口语（连带做）"],
  ["干脆", "口语"],
  ["好使", "口语"],
  ["靠谱", "口语"],
  ["别扭", "口语"],
  ["难受", "口语"],
  ["够呛", "口语"],
  ["才行", "口语（建议式）"],
  ["就够了", "口语（建议式）"],
  ["铆上", "比喻"],
  ["锚死", "比喻"],
  // D2 人称
  ["我们", "第一人称（改「本项目」「本应用」或删去主语）"],
  ["咱们", "第一人称"],
  ["你们", "第二人称"],
  ["你自己", "第二人称"],
  ["你不要", "第二人称 + 祈使"],
  ["请不要", "第二人称 + 祈使"],
  // D3 元话语
  ["其实", "元话语"],
  ["说白了", "元话语"],
  ["简单说", "元话语"],
  ["一句话", "元话语（作功能名「一句话直达」时用 allowlist 豁免）"],
  // D4 建议式祈使
  ["不要自己", "建议式祈使"],
  ["别把", "建议式祈使"],
  ["千万别", "建议式祈使"],
  ["别忘了", "建议式祈使"],
  // D5 成语与口号
  ["丢三落四", "成语"],
  ["一眼假", "口号式口语"],
  ["白登入", "口号式口语"],
  ["白下载", "口号式口语"],
  ["宁可不", "口号式短语"],
];

const ALLOW = fs.existsSync(ALLOW_FILE)
  ? JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"))
  : {};

function allowFor(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  return ALLOW[rel] ?? [];
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    // 跳过 exFAT / macOS 副产物：`._*` 旁文件会被当成 Markdown，且内容为二进制元数据
    else if (e.name.endsWith(".md") && !e.name.startsWith("._")) out.push(p);
  }
  return out;
}

/** 去掉行内代码（`…`）与链接地址：这些是技术字面量，不是正文措辞 */
function proseOf(line) {
  return line
    .replace(/`[^`]*`/g, " ")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function main() {
  const files = walk(DOCS_DIR);
  const violations = [];
  for (const file of files) {
    const allow = allowFor(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    let inFence = false;
    lines.forEach((line, i) => {
      if (line.trim().startsWith("```")) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      if (line.trimStart().startsWith(">")) return; // 引用块：证据
      if (line.includes("docs-prose-lint-ok")) return; // 行内豁免
      const prose = proseOf(line);
      for (const [word, why] of BANNED) {
        if (!prose.includes(word)) continue;
        if (allow.some((a) => line.includes(a.text))) continue;
        violations.push({
          file: path.relative(ROOT, file).split(path.sep).join("/"),
          line: i + 1,
          word,
          why,
          text: line.trim(),
        });
      }
    });
  }

  if (violations.length === 0) {
    console.log(`文档文案纪律：${files.length} 份文档，0 处违规。`);
    return 0;
  }

  console.error(`文档文案纪律：${violations.length} 处违规。\n`);
  let last = "";
  for (const v of violations) {
    if (v.file !== last) {
      console.error(v.file);
      last = v.file;
    }
    console.error(`  ${v.line}: 「${v.word}」——${v.why}`);
    console.error(`      ${v.text.slice(0, 100)}`);
  }
  console.error(
    "\n改写为陈述式技术说明；确属证据（用户原话、报错原文、UI 文案样例）时，" +
      "在行尾加 `<!-- docs-prose-lint-ok: 理由 -->`，或写入 tools/docs-prose-allow.json。",
  );
  return 1;
}

process.exit(main());
