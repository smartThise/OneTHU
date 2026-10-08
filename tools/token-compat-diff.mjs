/**
 * 「令牌重写不改变观感」证明。
 *
 * 令牌层重写最大的风险不是报错，而是**静默变色**：某个旧变量映射错一个角色，页面某处就悄悄换了颜色，
 * 编译/测试全绿，只有肉眼看得出来（方案 §3.1 风险表第一条：Compat 映射不全致色彩错乱）。
 *
 * 做法：把重写前的 tokens.css（git HEAD 版本）里的每个变量值，与重写后（含 palette.css，解析 var() 链）
 * 的**实际解析值**逐条比对——全部相等才算「零观感变化」。
 *
 * 用法：node tools/token-compat-diff.mjs [旧版本 ref，默认 HEAD]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REF = process.argv[2] ?? "HEAD";
const OLD_PATH = "packages/ui/src/tokens.css";
const NEW_FILES = ["packages/ui/src/palette.css", "packages/ui/src/tokens.css"];

/** 剔除暗色套块（同名角色在 [data-scheme=dark] 里重复声明，混进 map 会污染亮色值——
    这个坑也真踩过：collect 只认最后一个声明，于是"亮色值"被暗色值覆盖，全是假报警） */
function stripSchemeBlocks(css) {
  return css.replace(/:root\[data-scheme="dark"\]\s*\{[\s\S]*?\n\}/g, " ");
}

/** 收集 --name: value; 声明（后出现的覆盖先出现的） */
function collect(css) {
  const map = new Map();
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css))) map.set(m[1], m[2].trim());
  return map;
}
/** 解析 var() 链（带 fallback 时若主变量存在则忽略 fallback） */
function resolve(name, map, depth = 0) {
  if (depth > 10) return null;
  const raw = map.get(name);
  if (raw === undefined) return null;
  const v = raw.match(/var\((--[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)/);
  if (!v) return raw;
  const inner = resolve(v[1], map, depth + 1);
  return inner !== null ? inner : (v[2] ?? null);
}
/** 归一化：去空白、统一小写、rgba 空格写法统一 */
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim().toLowerCase();

const oldCss = execFileSync("git", ["show", REF + ":" + OLD_PATH], { encoding: "utf8" });
/* 旧版也要能解析 var() 链：重写提交本身可能已经进 HEAD，那时旧值里就带 var() 了
   （拿「原始值」比「解析值」会全是假报警——这个 bug 真出现过）。 */
let oldPalette = "";
try {
  oldPalette = execFileSync("git", ["show", REF + ":packages/ui/src/palette.css"], { encoding: "utf8" });
} catch {
  oldPalette = ""; // 重写前没有 palette.css，正常
}
const newCss = NEW_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
const oldMap = collect(stripSchemeBlocks(oldPalette + "\n" + oldCss));
const newMap = collect(stripSchemeBlocks(newCss));

/* 本批次**有意**变化（§3.2 品牌色）：不算失败，但要显式列出来，避免"预期变化"和"意外变色"混在一起。 */
const INTENTIONAL = new Map([
  ["--primary", "默认主题回黑白配；清华紫改由内置主题 onethu.theme.tsinghua 承载"],
  ["--primary-hover", "同上（悬停回 #43454a）"],
  ["--hover", "§3.5 B1：状态层对齐 MD3（hover 6% → 8%）"],
  ["--active", "§3.5 B1：状态层对齐 MD3（pressed 10% → 12%）"],
  ["--font-ui", "老机型适配（霖 2026-10-04）：厂牌 CJK 前置（MiSans / miui / HarmonyOS Sans），旧引擎 600 不再合成加粗；雅黑仍排在 sans-serif 之前，Windows 命中链不变；刻意不加 system-ui（会把用户自装系统字体漏进现代机型）"],
]);
const fails = [];
const changed = [];
let checked = 0;
for (const [name, oldVal] of oldMap) {
  if (name.startsWith("--md-")) continue; // 新层自有的，不在旧文件里
  checked++;
  const want = resolve(name, oldMap) ?? oldVal;
  const got = resolve(name, newMap);
  if (got === null) { fails.push(name + "：新版没有定义（Compat 层漏迁）"); continue; }
  if (norm(got) !== norm(want)) {
    if (INTENTIONAL.has(name)) changed.push(name + "：" + want + " → " + got + "（" + INTENTIONAL.get(name) + "）");
    else fails.push(name + "：旧 " + want + " → 新 " + got);
  }
}

console.log("令牌兼容比对（旧 " + REF + " vs 新版）：检查 " + checked + " 个旧变量");
if (changed.length) {
  console.log("  预期变化 " + changed.length + " 项：");
  for (const c of changed) console.log("    · " + c);
}
if (fails.length) {
  console.error("  ✗ " + fails.length + " 个变量观感会变：");
  for (const f of fails) console.error("    " + f);
  process.exit(1);
}
console.log("  其余变量解析值一致 —— 除上列预期变化外无意外变色 ✓");
