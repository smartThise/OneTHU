/**
 * 生成 docs/tokens-map.md —— §3.1 要求的「完整新旧变量对照表」。
 *
 * 两张表：
 *   表 1 旧变量 → System 角色 → 当前解析值（Compat 层实况，由 tokens.css 解析而来，不手写）；
 *   表 2 System 角色 → tonal palette 目标值（§3.2 品牌色 / §3.3 暗色双套 的接入清单）。
 *
 * 为什么生成：这张表一旦手写，第一次改令牌就会漂移成谎话。
 * 用法：node tools/gen-tokens-map.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const TOKENS = "packages/ui/src/tokens.css";
const PALETTE = "packages/ui/src/palette.css";
const OUT = "docs/tokens-map.md";

const paletteCss = readFileSync(PALETTE, "utf8"); // Reference 层：System 的 var() 要靠它解析
const tokensCssRaw = readFileSync(TOKENS, "utf8");
/** 剔除暗色套块：同名角色在那里重复声明，不剔除会把"亮色实况"列污染成暗色值 */
const tokensCss = tokensCssRaw.replace(/:root\[data-scheme="dark"\]\s*\{[\s\S]*?\n\}/g, " ");

/* ---- 表 1：解析 Compat 层 ---- */
const decls = new Map();
for (const m of (paletteCss + "\n" + tokensCss).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decls.set(m[1], m[2].trim());
function resolve(name, depth = 0) {
  if (depth > 10) return "?";
  const raw = decls.get(name);
  if (raw === undefined) return "（未定义）";
  const v = raw.match(/var\((--[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)/);
  if (!v) return raw;
  const inner = resolve(v[1], depth + 1);
  return inner === "（未定义）" ? (v[2] ?? "?") : inner;
}
/* Compat 块 = --md- 开头之外的全部声明，且值里含 var(--md- */
const compat = [...decls.entries()].filter(([n, v]) => !n.startsWith("--md-") && v.includes("var(--md-"));

/* ---- 暗色套实况（tokens.css 的 :root[data-scheme="dark"]） ---- */
const darkBlock = (() => {
  const i = tokensCssRaw.indexOf(":root[data-scheme=\"dark\"]");
  if (i < 0) return "";
  return tokensCssRaw.slice(tokensCssRaw.indexOf("{", i), tokensCssRaw.indexOf("\n}", i));
})();
const darkDecls = new Map();
for (const m of darkBlock.matchAll(/(--md-sys-[a-z0-9-]+)\s*:\s*([^;]+);/g)) darkDecls.set(m[1], m[2].trim());
/* ---- 表 2：palette.css 里注释形态的派生 System 角色 ---- */
const pal = readFileSync(PALETTE, "utf8");
const schemes = { light: [], dark: [] };
let cur = null;
for (const line of pal.split("\n")) {
  if (line.includes("亮色 scheme")) cur = "light";
  else if (line.includes("暗色 scheme")) cur = "dark";
  else if (line.trim() === "*/") cur = null;
  else if (cur) {
    const m = line.match(/(--md-sys-color-[a-z0-9-]+):\s*(#[0-9a-f]{6})/i);
    if (m) schemes[cur].push([m[1], m[2].toLowerCase()]);
  }
}

const L = [];
L.push("# 设计令牌对照表（tokens map）");
L.push("");
L.push("本表由 `node tools/gen-tokens-map.mjs` 从 `packages/ui/src/tokens.css` 与 `palette.css` **自动生成**，不要手改。");
L.push("");
L.push("三层结构：**Reference**（`palette.css`，`tools/gen-tokens.mjs` 按「清华紫」种子生成的 tonal palette，零运行时依赖）");
L.push("→ **System**（`--md-sys-color-*` / `--md-sys-shape-*` / `--md-sys-typescale-*` / `--md-sys-elevation-*`）");
L.push("→ **Compat**（`--bg` / `--surface` / `--primary` / `--text-1` … 旧名全量保留）。");
L.push("");
L.push("## 1. Compat 层实况（旧变量 → System 角色 → 当前解析值）");
L.push("");
L.push("| 旧变量 | System 角色 | 亮色（实况） | 暗色（System 暗色套） |");
L.push("|---|---|---|---|");
for (const [name, val] of compat) {
  const role = (val.match(/var\((--[a-z0-9-]+)/) ?? [])[1] ?? "—";
  const darkVal = darkDecls.get(role) ?? (role.startsWith("--md-sys-shape-") ? "同亮色" : "（未覆盖）");
  L.push("| `" + name + "` | `" + role + "` | `" + resolve(name) + "` | `" + darkVal + "` |");
}
L.push("");
L.push("共 " + compat.length + " 个旧变量全部有映射。**重写不改变观感**由 `node tools/token-compat-diff.mjs` 逐条比对证明");
L.push("（拿 git HEAD 版的 tokens.css 与新版解析值比，全部相等才通过）。");
L.push("");
L.push("## 2. System 角色 → tonal palette 目标值（§3.2 品牌色 / §3.3 暗色 接入清单）");
L.push("");
L.push("接入方式：改 System 层一族的初值即可（`--md-sys-color-primary: var(--md-ref-palette-primary-40)`），");
L.push("Compat 层与所有组件自动跟随。建议一族一提交，便于单独回滚。");
L.push("");
L.push("| System 角色 | 亮色（目标） | 暗色（目标） |");
L.push("|---|---|---|");
const darkMap = new Map(schemes.dark);
for (const [role, light] of schemes.light) {
  L.push("| `" + role + "` | `" + light + "` | `" + (darkMap.get(role) ?? "—") + "` |");
}
L.push("");
L.push("## 3. 尚未接入的令牌（有意留白）");
L.push("");
L.push("- `--md-sys-typescale-*` 五档字阶：已定义语义档位，退役 `--text-xxs(11px)` / `--text-sm(13px)` 属 §3.9 字阶 lint + M3 组件批次的活；");
L.push("- `--md-sys-shape-corner-extra-large(16px)`：为 B2 卡片批次预留；");
L.push("- `--elev-1..3`：`--shadow-*` 的新名，新代码用新名；");
L.push("- `--md-sys-color-state-hover/pressed` 现为 6%/10%（基线），§3.9 状态层规范目标 8%/12%；");
L.push("- dark 通道（`prefers-color-scheme` + `state/theme.ts` 手动覆盖）见 §3.3，尚未接入。");
L.push("");

writeFileSync(OUT, L.join("\n"), "utf8");
console.log("已生成 " + OUT + "：Compat " + compat.length + " 条，System 目标 " + schemes.light.length + " 个角色（亮/暗）");
