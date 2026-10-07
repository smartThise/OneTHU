/**
 * 风格扫描（§3.9）：4pt 间距网格 + 字阶规格。
 *
 * 为什么要有它：这两条规则是「规范感」里最容易滑坡的——单看一处 6px 间距毫无问题，
 * 全项目堆起来就是「哪里都不太对」的那种乱。人眼在 diff 里看不出，必须机器数。
 *
 * 两条规则：
 *   间距：padding / margin / gap（含各方向长写）里的 px 必须是 4 的倍数（4pt 网格）。
 *   字阶：font-size 必须是五档之一（12 / 14 / 16 / 20 / 24）。
 *
 * 基线（ratchet）：历史违规已存在，不可能一天清完，所以按「文件 + 违规值 → 数量」记基线，
 * 只拦**新增**。用计数而不是行号：行号会随任何一次编辑漂移，逐行基线第二天就废。
 * 用它来推进 M3 组件批次：每清理一批就把基线调低（--write-baseline）。
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const BASELINE = "tools/style-scan-baseline.json";
const DIRS = ["packages/ui/src", "apps/desktop/src/styles"];
/* 五档字阶：页标题 / 卡片标题 / 小标题 / 正文 / 辅助 */
const TYPE_STEPS = new Set([12, 14, 16, 20, 24]);
/* 4pt 网格的「标准档位」（用于提示"在网格内但不在档位上"，不判失败） */
const GAP_STEPS = new Set([4, 8, 12, 16, 24, 32]);

const files = [];
for (const dir of DIRS) {
  for (const f of readdirSync(dir)) if (f.endsWith(".css")) files.push(dir + "/" + f);
}

const SPACING_DECL =
  /(?:^|[;{])\s*(padding|margin|gap|row-gap|column-gap|padding-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?|margin-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)\s*:\s*([^;}]+)/g;
const FONT_DECL = /(?:^|[;{])\s*font-size\s*:\s*([^;}]+)/g;

/** 扫描一个文件，返回 { spacing: {值: 次数}, fontsize: {...} } */
function scan(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const spacing = {};
  const fontsize = {};
  const bump = (bag, k) => { bag[k] = (bag[k] ?? 0) + 1; };

  for (const m of css.matchAll(SPACING_DECL)) {
    const value = m[2].trim();
    // var() 是"用了令牌"，calc/% /auto 交给别的机制判断，这里只数 px 字面量
    if (/var\(|calc\(|%|em\b|auto|inherit|unset|initial/.test(value)) continue;
    for (const px of value.matchAll(/(-?\d*\.?\d+)px/g)) {
      const n = Number(px[1]);
      if (!Number.isFinite(n) || n % 4 !== 0) bump(spacing, px[0]);
    }
  }
  for (const m of css.matchAll(FONT_DECL)) {
    const value = m[1].trim();
    if (/var\(|calc\(|%|em\b|rem\b|inherit|unset|initial/.test(value)) continue;
    const px = value.match(/(-?\d*\.?\d+)px/);
    if (!px) continue;
    const n = Number(px[1]);
    if (!TYPE_STEPS.has(n)) bump(fontsize, px[0]);
  }
  return { spacing, fontsize };
}

const current = {};
let spacingTotal = 0;
let fontTotal = 0;
const offGridSteps = {};
for (const f of files) {
  const r = scan(readFileSync(f, "utf8"));
  const nS = Object.values(r.spacing).reduce((a, b) => a + b, 0);
  const nF = Object.values(r.fontsize).reduce((a, b) => a + b, 0);
  spacingTotal += nS;
  fontTotal += nF;
  if (nS || nF) current[f] = r;
  for (const [k, v] of Object.entries(r.fontsize)) offGridSteps[k] = (offGridSteps[k] ?? 0) + v;
}

const write = process.argv.includes("--write-baseline");
if (write) {
  writeFileSync(BASELINE, JSON.stringify(current, null, 2) + "\n");
  console.log("已写入基线 " + BASELINE + "：间距 " + spacingTotal + " 处 / 字阶 " + fontTotal + " 处");
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const added = [];
for (const [file, rules] of Object.entries(current)) {
  for (const rule of ["spacing", "fontsize"]) {
    for (const [value, count] of Object.entries(rules[rule] ?? {})) {
      const base = baseline[file]?.[rule]?.[value] ?? 0;
      if (count > base) {
        added.push(file + "  " + (rule === "spacing" ? "间距" : "字号") + " " + value + "：" + base + " → " + count);
      }
    }
  }
}

/* 明细：按违规总数排前 6 个文件，给 M3 批次当清理清单 */
const detail = Object.entries(current)
  .map(([f, r]) => [
    f,
    Object.values(r.spacing).reduce((a, b) => a + b, 0),
    Object.values(r.fontsize).reduce((a, b) => a + b, 0),
  ])
  .sort((a, b) => b[1] + b[2] - (a[1] + a[2]))
  .slice(0, 6);

const topFont = Object.entries(offGridSteps).sort((a, b) => b[1] - a[1]).slice(0, 6);
const offStep = [];
for (const [file, rules] of Object.entries(current)) {
  for (const [value, count] of Object.entries(rules.spacing)) {
    const n = Number(value.replace("px", ""));
    if (GAP_STEPS.has(n)) offStep.push(file + " " + value + " ×" + count);
  }
}

console.log("风格扫描（§3.9）：4pt 间距网格 + 字阶");
console.log("  间距不在 4pt 网格：" + spacingTotal + " 处（基线 " +
  Object.values(baseline).reduce((a, r) => a + Object.values(r.spacing ?? {}).reduce((x, y) => x + y, 0), 0) + "）");
console.log("  字号规格外：" + fontTotal + " 处（基线 " +
  Object.values(baseline).reduce((a, r) => a + Object.values(r.fontsize ?? {}).reduce((x, y) => x + y, 0), 0) + "）" +
  (topFont.length ? "；其中 " + topFont.map(([k, v]) => k + "×" + v).join(" ") : ""));
console.log("  待清理 Top：" + detail.map(([f, s, t]) => f.split("/").pop() + "(" + s + "/" + t + ")").join(" "));
if (offStep.length) console.log("  在网格内但不在档位（4/8/12/16/24/32，提示）：" + offStep.slice(0, 6).join("，"));

if (added.length) {
  console.error("  ✗ 新增 " + added.length + " 处违规（基线只拦新增，清理后才降基线）：");
  for (const a of added) console.error("    " + a);
  process.exit(1);
}
console.log("  无新增违规 ✓");
