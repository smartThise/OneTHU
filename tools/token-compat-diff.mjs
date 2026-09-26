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
const newCss = NEW_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
const oldMap = collect(oldCss);
const newMap = collect(newCss);

const fails = [];
let checked = 0;
for (const [name, oldVal] of oldMap) {
  if (name.startsWith("--md-")) continue; // 新层自有的，不在旧文件里
  checked++;
  const got = resolve(name, newMap);
  if (got === null) { fails.push(name + "：新版没有定义（Compat 层漏迁）"); continue; }
  if (norm(got) !== norm(oldVal)) fails.push(name + "：旧 " + oldVal + " → 新 " + got);
}

console.log("令牌兼容比对（旧 " + REF + " vs 新版）：检查 " + checked + " 个旧变量");
if (fails.length) {
  console.error("  ✗ " + fails.length + " 个变量观感会变：");
  for (const f of fails) console.error("    " + f);
  process.exit(1);
}
console.log("  全部变量解析值一致 —— 令牌层重写零观感变化 ✓");
