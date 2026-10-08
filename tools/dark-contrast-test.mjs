#!/usr/bin/env node
/**
 * 暗色对比度护栏（B6，霖 2026-10-02）。
 *
 * 现状证据（B6）：`.plg-pin.is-oh` 一带曾把底色写死 `#fff`、文字写死 `#000`（B1 的同源病灶）；
 * 在线服务页的选中按钮曾是「亮底 + 白字」→ 暗色主题下选中后什么都看不见。
 *
 * 本护栏做**源码级**判定（真机对比度由 DoD 的探针另外给数）：
 *   ① 任何「选中态」规则里，**不许同时写死底色与文字色**（成对令牌才行；确需例外写 `token-ok`）；
 *   ② `.plg-pin.is-oh` 与在线服务页选中态必须走令牌（`var(...)`），且底/字都成对用令牌；
 *   ③ 输出所有选中态规则的清单（含算出的颜色对），供人工在暗色下逐条核对 ≥ 4.5:1。
 *
 * 说明（与文档的差异，已报霖）：文档写的成对令牌名是 `--md-sys-color-primary-container` /
 * `--md-sys-color-on-primary-container`，本仓主题系统提供的是 MD3 的 primary 对
 * （`--primary` / `--on-primary`，由 `state/theme.ts` + 动态取色下发）。原则一致（成对令牌），
 * 故按仓库实际令牌名判定。
 */
import { readFileSync, readdirSync } from "node:fs";

const CSS_DIR = "apps/desktop/src/styles";
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ");
const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
const fails = [];
const checked = [];

/** 写死的颜色：十六进制 / rgb(a) / 具名（只挑会踩坑的浅色与白色） */
const HARD_BG = /background(?:-color)?\s*:\s*(#(?:fff|ffffff|fafafa|f5f5f5|eee|eeeeee)\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i;
const HARD_INK = /(?:^|[;\s])color\s*:\s*(#(?:fff|ffffff)\b|white\b|rgba?\(\s*255\s*,\s*255\s*,\s*255)/i;
const SELECTED_SEL = /(is-active|is-selected|is-cur|is-on|aria-selected|:checked|is-oh)/;

for (const f of files) {
  const raw = readFileSync(`${CSS_DIR}/${f}`, "utf8");
  /* 逐行判 token-ok 豁免，但规则体要跨行取，所以按「规则 + 其起始行」一起走 */
  const lines = raw.split("\n");
  const ruleRe = /([^{}\n][^{}]*)\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(raw)) !== null) {
    const sel = m[1].trim().split("\n").pop().trim();
    const body = m[2];
    if (!SELECTED_SEL.test(sel)) continue;
    const startLine = raw.slice(0, m.index).split("\n").length;
    const lineRaw = lines[startLine - 1] ?? "";
    const exempt = /token-ok/.test(lineRaw) || /token-ok/.test(body);
    checked.push({ file: f, sel, body, exempt, pair: /background/.test(body) && /(?:^|[;\s])color\s*:/.test(body) });
    if (exempt) continue;
    if (HARD_BG.test(body) && HARD_INK.test(body)) {
      fails.push(`${f} 的选中态同时写死了亮底与白字（暗色下看不见）：${sel}`);
    }
  }
}

/* ② 两个点名病灶必须走成对令牌 */
const global = strip(readFileSync(`${CSS_DIR}/global.css`, "utf8"));
const pin = /\.plg-pin\.is-oh\s*\{([^}]*)\}/.exec(global);
if (!pin) fails.push("找不到 .plg-pin.is-oh 规则");
else {
  if (/#[0-9a-f]{3,6}|rgba?\(/i.test(pin[1]) || /\b(white|black)\b/i.test(pin[1])) {
    fails.push(".plg-pin.is-oh 又写死了颜色（应走令牌）：" + pin[1].trim().slice(0, 80));
  }
}
const thos = /\.thos-tabs button\.is-active\s*\{([^}]*)\}/.exec(global);
if (!thos) fails.push("找不到 .thos-tabs button.is-active 规则");
else {
  const b = thos[1];
  if (!/background\s*:\s*var\(/.test(b)) fails.push("在线服务选中态的底色没走令牌");
  if (!/(?:^|[;\s])color\s*:\s*var\(/.test(b)) fails.push("在线服务选中态的文字色没走令牌");
  if (/(?:^|[;\s])color\s*:\s*var\(--on-primary\)/.test(b) && !/background\s*:\s*var\(--primary\)/.test(b)) {
    fails.push("在线服务选中态用了成对令牌的一半（只有 on-primary，没有 primary）");
  }
}

console.log(
  fails.length
    ? "暗色对比度护栏不通过：\n" + fails.map((x) => "  ✗ " + x).join("\n")
    : `暗色对比度护栏：${checked.length} 条选中态规则里没有「写死亮底 + 写死白字」✓ plg-pin.is-oh / thos-tabs 选中态都走成对令牌 ✓`,
);
if (process.env.DARK_CONTRAST_LIST === "1") {
  console.log("需人工在暗色下核对的选中态规则：");
  for (const c of checked) console.log(`  ${c.exempt ? "(豁免) " : ""}${c.file} ${c.sel}${c.pair ? "" : "（无底/字成对）"}`);
}
process.exit(fails.length ? 1 : 0);
