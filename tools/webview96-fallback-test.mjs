#!/usr/bin/env node
/**
 * 老机型（Chromium 96 / WebView 96）兜底护栏（霖 2026-10-04 老机型适配）。
 *
 * 为什么要有它：96 上有三样特性会「静默失效」，而且失效方式各不相同，肉眼很难当场发现，
 * 只在真机上炸：
 *   1. `scale:`（独立属性，Chrome 104+）→ 整条声明解析期丢弃 → 两级按压反馈全消失；
 *   2. `color-mix()`（Chrome 111+）→ 值里**含 var()** 时它作为 pending-substitution 值活到
 *      computed-value 阶段才作废，按 `unset` 处理，**不会**回落到同规则里更早的静态声明
 *      （真机对照实验坐实；所以 b24 的「紧邻前一个声明」只对不含 var() 的值成立）；
 *   3. `:has()`（Chrome 105+）→ 整条规则解析期丢弃（seg 双胶囊的根因）。
 * 于是本护栏做源码级断言：**每一处 `scale:` / `color-mix(` / `:has(` 都要有兜底，或在
 * REGISTRY 里登记为「装饰性可记录不做」并写明理由**——只写注释不算数。
 *
 * 跑法：node tools/webview96-fallback-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const CSS_FILES = [
  "apps/desktop/src/styles/global.css",
  "apps/desktop/src/styles/motion.css",
  "packages/ui/src/base.css",
  "packages/ui/src/tokens.css",
  "packages/ui/src/palette.css",
];
/** color-mix 也散在内联样式里（TSX），一并扫；这些没法用 @supports 兜，只能登记或改静态值 */
const TS_FILES = ["apps/desktop/src/pages/info/VenueSportsTab.tsx", "apps/desktop/src/lib/confirm.tsx"];
const TOKENS = "packages/ui/src/tokens.css";
const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
};

/* ── 极简 CSS 解析：把样式规则摊平成 {file, selector, ats, decls:[{prop,value,line,raw}]} ──
   ats = 外层 at-rule 条件栈（如 `@supports not (color: color-mix(...))`），用来判断某条声明
   是否已经被兜底块接住。够用即可：本仓 CSS 没有嵌套选择器语法。 */
function parseCss(file) {
  const src = readFileSync(file, "utf8");
  const rules = [];
  const stack = []; // {kind:'at'|'rule', prelude, decls, line}
  let i = 0;
  let line = 1;
  let buf = "";
  let bufLine = 1;
  const flush = () => {
    const top = stack[stack.length - 1];
    const text = buf.trim();
    buf = "";
    if (!top || top.kind !== "rule" || !text) return;
    const m = /^([-\w$]+)\s*:\s*([\s\S]+)$/.exec(text);
    if (!m) return;
    top.decls.push({ prop: m[1], value: m[2].replace(/\s+/g, " ").trim(), line: bufLine, raw: text.replace(/\s+/g, " ") });
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      const end = e < 0 ? src.length : e + 2;
      for (let k = i; k < end; k++) if (src[k] === "\n") line++; /* 注释里的换行也要计数，否则行号漂移 */
      i = end;
      continue;
    }
    if (c === "\n") {
      line++;
      buf += c;
      i++;
      continue;
    }
    if (c === "{") {
      const prelude = buf.trim();
      buf = "";
      stack.push({ kind: prelude.startsWith("@") ? "at" : "rule", prelude, decls: [], line });
      i++;
      bufLine = line;
      continue;
    }
    if (c === "}") {
      flush();
      const top = stack.pop();
      if (top && top.kind === "rule") {
        rules.push({
          file,
          selector: top.prelude.replace(/\s+/g, " ").trim(),
          ats: stack.filter((s) => s.kind === "at").map((s) => s.prelude.replace(/\s+/g, " ").trim()),
          decls: top.decls,
        });
      }
      buf = "";
      i++;
      continue;
    }
    if (c === ";") {
      if (stack.length && stack[stack.length - 1].kind === "rule") {
        flush();
        bufLine = line;
      } else {
        buf += c;
      }
      i++;
      continue;
    }
    if (!buf.trim()) bufLine = line;
    buf += c;
    i++;
  }
  return { src, rules };
}

const parsed = {};
for (const f of CSS_FILES) parsed[f] = parseCss(f);
const allRules = Object.values(parsed).flatMap((p) => p.rules);
const isColorMixGate = (s) => /^@supports\b/.test(s) && s.includes("color-mix(") && !/\bnot\b/.test(s);
const isColorMixFallback = (s) => /^@supports\b/.test(s) && s.includes("color-mix(") && /\bnot\b/.test(s);
const isScaleFallback = (s) => /^@supports\b/.test(s) && /scale\s*:\s*1/.test(s) && /\bnot\b/.test(s);
const isHasFallback = (s) => /^@supports\b/.test(s) && s.includes(":has(") && /\bnot\b/.test(s);

/* ── REGISTRY：登记为「装饰性/不可兜」的站点（reason 必须写清为什么可以不做）──────────
   键用「文件 + 声明值里的唯一片段」，这样行号漂移不会误报。新增站点必须显式登记。 */
const REGISTRY = {
  colorMix: [
    // —— 动画/闪烁：掉了只是少一点动效，96 上其它关键帧仍在（透明度/位移） ——
    { file: "apps/desktop/src/styles/global.css", needle: "var(--amber) 26%", reason: "favflash 闪烁高亮的 35% 关键帧（收藏落地闪光），掉了只是没有黄闪，落地位置不变" },
    { file: "apps/desktop/src/styles/global.css", needle: "var(--amber) 45%", reason: "favflash 35% 关键帧的状态环，同上（装饰性闪烁）" },
    { file: "apps/desktop/src/styles/global.css", needle: "var(--accent) 45%", reason: "dock-ripple 涟漪起点（OH 悬浮坞），装饰" },
    { file: "apps/desktop/src/styles/global.css", needle: "0 0 0 24px", reason: "dock-ripple 涟漪扩散，装饰" },
    // —— hover 态：触屏没有 hover，PC 是 WebView2（现代引擎）——
    { file: "apps/desktop/src/styles/global.css", needle: "var(--amber) 14%", reason: "ext-hw-hint 的 .btn-ghost:hover 底色（hover-only）" },
    { file: "apps/desktop/src/styles/motion.css", needle: "var(--accent) 26%, var(--border)", reason: ".card:hover 描边（hover-only，且 .card 基础边框仍在）" },
    // —— 次级状态/底色：状态仍由别的声明表达 ——
    { file: "apps/desktop/src/styles/global.css", needle: "var(--accent) 30%", reason: ".home-card.is-picked 的次级状态环；同规则 border-color: var(--accent) 仍表达选中" },
    { file: "apps/desktop/src/styles/global.css", needle: "var(--text-3) 7%", reason: ".thos-note 注记底（装饰性底色，文字在页底上仍可读）" },
    { file: "apps/desktop/src/styles/global.css", needle: "var(--text-3) 14%", reason: ".thos-note-tag 标签底（装饰性底色）" },
    { file: "apps/desktop/src/styles/global.css", needle: "var(--md-sys-color-scrim) 17%", reason: ".ctx-blur 遮罩着色（backdrop-filter 模糊仍在，只是少一层压暗；静态 rgba 会在暗色主题下跑偏，故不做）" },
    // —— 内联样式（TSX）：无法用 @supports 兜 ——
    { file: "apps/desktop/src/pages/info/VenueSportsTab.tsx", needle: "var(--red) 25%", reason: "红色警示块描边（内联样式；背景 var(--red-soft) 仍在，去掉描边仍是警示块）", ts: true },
    { file: "apps/desktop/src/lib/confirm.tsx", needle: "var(--red) 35%", reason: "危险确认按钮投影（内联样式；投影是装饰）", ts: true },
  ],
  scale: [
    { file: "apps/desktop/src/styles/global.css", needle: "scale: 1", reason: "@keyframes ctx-menu-out 的退场缩放；同一关键帧还有 opacity 1→0，旧引擎退化为纯渐隐（装饰）" },
    { file: "apps/desktop/src/styles/global.css", needle: "scale: 0.94", reason: "@keyframes ctx-menu-out 的退场缩放终点，同上（装饰）" },
    { file: "apps/desktop/src/styles/global.css", needle: "scale: none", reason: "卡片流（.hw-card）显式退出独立 scale：倍率由它自己的内联 transform 消费（K3），96 上本来就有效" },
  ],
  has: [
    { file: "apps/desktop/src/styles/global.css", needle: ":has(.tasks-body)", reason: "待办页高度链：已有 @supports not selector(:has(*)) 兜底块（global.css 两档）" },
    { file: "apps/desktop/src/styles/global.css", needle: ":has(.xk-two-col)", reason: "选课双栏页解除 .content 限宽（装饰：限宽掉了只是窄一点）" },
    { file: "apps/desktop/src/styles/global.css", needle: ":has(> :only-child)", reason: "独卡统计网格列数（装饰：多一列少一列）" },
    { file: "apps/desktop/src/styles/global.css", needle: ":has(.sidebar.is-collapsed)", reason: "侧栏折叠宽度（装饰：折叠钮仍可用，只是宽度变量不回正）" },
    { file: "apps/desktop/src/styles/global.css", needle: ':has(> .page-anim[data-page="info"])', reason: "PC 信息页/生活页/设置页限宽 720（装饰：限宽掉了就是整宽）" },
    { file: "apps/desktop/src/styles/global.css", needle: ':has(> .page-anim[data-page="life"])', reason: "PC 生活页限宽 720（装饰）" },
    { file: "apps/desktop/src/styles/global.css", needle: ':has(> .page-anim[data-page="settings"])', reason: "PC 设置页限宽 720（装饰）" },
    { file: "apps/desktop/src/styles/global.css", needle: '[data-page="info"]', reason: "PC 信息页限宽 720 + 含表格恢复整宽（装饰）" },
    { file: "apps/desktop/src/styles/global.css", needle: '[data-page="life"]', reason: "PC 生活页限宽 720 + 含表格恢复整宽（装饰）" },
    { file: "apps/desktop/src/styles/global.css", needle: '[data-page="settings"]', reason: "PC 设置页限宽 720 + 含表格恢复整宽（装饰）" },
    { file: "apps/desktop/src/styles/motion.css", needle: ":has(.seg-pill.is-ready)", reason: "功能：seg 双胶囊根因，已由 @supports not selector(:has(*)) 兜底块接住" },
  ],
};

/* ── ① color-mix：有 @supports 门、有兜底块、或已登记 ───────────────────────────── */
const cmSites = [];
for (const [file, p] of Object.entries(parsed)) {
  for (const r of p.rules) {
    for (const d of r.decls) {
      if (!d.value.includes("color-mix(")) continue;
      cmSites.push({ file, selector: r.selector, prop: d.prop, line: d.line, ats: r.ats, raw: d.raw, value: d.value });
    }
  }
}
/* TS 内联的 color-mix（没法用 @supports，只能登记） */
for (const f of TS_FILES) {
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");
  lines.forEach((l, idx) => {
    if (l.includes("color-mix(")) cmSites.push({ file: f, selector: "(内联 style)", prop: "-", line: idx + 1, ats: [], raw: l.trim(), value: l.trim(), ts: true });
  });
}
const registered = (kind, site) =>
  REGISTRY[kind].find((e) => e.file === site.file && (site.raw.includes(e.needle) || site.value.includes(e.needle)));
for (const s of cmSites) {
  if (s.ats.some(isColorMixGate)) continue; // 已经用 @supports (…) 门住
  const fixedByBlock = allRules.some(
    (r) =>
      r.file === s.file &&
      r.selector === s.selector &&
      r.decls.some((d) => d.prop === s.prop && !d.value.includes("color-mix(") && r.ats.some(isColorMixFallback)),
  );
  if (fixedByBlock) continue;
  const reg = registered("colorMix", s);
  ok(!!reg, `${s.file}:${s.line} 的 color-mix 既没有兜底块、也没有登记（${s.selector} { ${s.prop}: … }）`);
}
ok(cmSites.length >= 25, `color-mix 扫描数异常（${cmSites.length}）：护栏可能没解析到样式表`);
/* @supports 判据里绝不能出现 var()：96 会把带 var 的条件判成 true，兜底块反而会生效到现代引擎上 */
for (const [file, p] of Object.entries(parsed)) {
  const noComment = p.src.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of noComment.matchAll(/@supports[^{;]*color-mix[^{;]*\{/g)) {
    const cond = m[0];
    ok(!cond.includes("var("), `${file} 的 @supports 判据带了 var()（96 会判成 true）：${cond.trim()}`);
  }
}

/* ── ② scale：通用按压路径必须有 transform 兜底 ─────────────────────────────────── */
const scaleSites = [];
for (const [file, p] of Object.entries(parsed)) {
  for (const r of p.rules) {
    for (const d of r.decls) {
      if (d.prop !== "scale") continue;
      scaleSites.push({ file, selector: r.selector, prop: d.prop, line: d.line, ats: r.ats, raw: d.raw, value: d.value });
    }
  }
}
for (const s of scaleSites) {
  if (s.ats.some(isScaleFallback)) continue; // 兜底块自身
  const fixedByBlock = allRules.some(
    (r) =>
      r.file === s.file &&
      r.selector === s.selector &&
      r.decls.some((d) => d.prop === "transform" && d.value.includes("scale(var(--ctx-press-k))") && r.ats.some(isScaleFallback)),
  );
  if (fixedByBlock) continue;
  ok(!!registered("scale", s), `${s.file}:${s.line} 的 scale 没有 transform 兜底、也没有登记（${s.selector}）`);
}
ok(
  allRules.some(
    (r) =>
      r.file === "apps/desktop/src/styles/global.css" &&
      r.selector.includes("[data-ctx-press]") &&
      r.decls.some((d) => d.prop === "transform" && d.value.includes("scale(var(--ctx-press-k))")) &&
      r.ats.some(isScaleFallback),
  ),
  "通用按压路径缺 @supports not (scale: 1) { … transform: scale(var(--ctx-press-k)) } 兜底",
);
ok(
  allRules.some(
    (r) =>
      r.file === "apps/desktop/src/styles/global.css" &&
      r.selector.includes("[data-ctx-press]") &&
      r.selector.includes(".hw-card") &&
      r.ats.some(isScaleFallback),
  ),
  "按压 transform 兜底没有排除 .hw-card（卡片流把倍率乘进自己的内联 transform，不能重复处理）",
);

/* ── ③ :has()：有兜底块或已登记；seg 双胶囊必须真的有兜底块 ─────────────────────── */
const hasSites = [];
for (const [file, p] of Object.entries(parsed)) {
  for (const r of p.rules) {
    if (r.selector.includes(":has(")) hasSites.push({ file, selector: r.selector, line: r.decls[0]?.line ?? 0, raw: r.selector, value: r.selector });
  }
}
for (const s of hasSites) {
  const reg = registered("has", s);
  if (reg) continue;
  ok(false, `${s.file} 的 :has() 选择器没有兜底块、也没有登记：${s.selector}`);
}
ok(hasSites.length >= 15, `:has() 扫描数异常（${hasSites.length}）`);
/* 功能性那条必须真有兜底：@supports not selector(:has(*)) 下撤掉 seg 激活按钮的静态底 */
ok(
  allRules.some(
    (r) =>
      r.file === "apps/desktop/src/styles/motion.css" &&
      r.selector === ".segmented button.is-active" &&
      r.decls.some((d) => d.prop === "background" && d.value === "transparent") &&
      r.ats.some(isHasFallback),
  ),
  "seg 双胶囊兜底缺失：motion.css 需要 @supports not selector(:has(*)) { .segmented button.is-active { background: transparent } }",
);
ok(
  allRules.some((r) => r.selector === ".segmented:has(.seg-pill.is-ready) button.is-active"),
  "motion.css 里 :has() 那条滑块的现代引擎规则不见了（兜底不该把它删掉）",
);

/* ── ④ 字体栈：厂牌 CJK 前置 + 顺序（现代机型字重观感不变）───────────────────────── */
const tokensSrc = readFileSync(TOKENS, "utf8");
const fontUi = /--font-ui:\s*([\s\S]*?);/.exec(tokensSrc)?.[1]?.replace(/\s+/g, " ") ?? "";
for (const fam of ['"MiSans"', "miui", '"HarmonyOS Sans SC"', '"HarmonyOS Sans"']) {
  ok(fontUi.includes(fam), `--font-ui 缺少 ${fam}（老机型适配：中文粗体不能靠合成加粗）`);
}
const idx = (s) => fontUi.indexOf(s);
ok(
  idx('"MiSans"') >= 0 && idx("miui") > idx('"MiSans"') && idx('"Microsoft YaHei"') > idx('"HarmonyOS Sans"'),
  "--font-ui 顺序不对：应为 MiSans → miui → HarmonyOS Sans（*）→ 苹果/中文兜底 → 雅黑 → sans-serif",
);
ok(idx('"Microsoft YaHei"') < idx("sans-serif"), "--font-ui 里 Microsoft YaHei 必须排在 sans-serif 之前（Windows 桌面命中链不变）");
/* 反例红点（真机踩过）：往这条栈里加 `system-ui`，Android 16 / WebView 143 上用户自装的
   系统字体（该机 TsangerJinKai04 W03）会漏进来 —— 现代机型字体观感被改掉。 */
ok(!/\bsystem-ui\b/.test(fontUi), "--font-ui 里不许出现 system-ui（现代机型的用户自装系统字体会漏进 UI 字体：实测该机由 MiSans VF 变成用户自装字体）");
ok(!/font-synthesis\s*:/.test(tokensSrc), "tokens.css 不许加 font-synthesis（96 不支持，且会改现代引擎的字重观感）");

/* ── ⑤ backdrop-filter：7 处已知站点不许被连累删掉（96 本身支持）────────────────── */
for (const [file, sel] of [
  ["apps/desktop/src/styles/global.css", ".mobile-topbar"],
  ["apps/desktop/src/styles/global.css", ".dock-voice-mask"],
  ["apps/desktop/src/styles/global.css", ".trace-legend"],
  ["apps/desktop/src/styles/global.css", ".plg-form-overlay"],
  ["apps/desktop/src/styles/global.css", ".ctx-blur"],
  ["apps/desktop/src/styles/global.css", ".ctx-menu"],
]) {
  ok(
    allRules.some((r) => r.file === file && r.selector === sel && r.decls.some((d) => d.prop === "backdrop-filter")),
    `${sel} 的 backdrop-filter 不见了（老机型适配不该动它；96 本身支持）`,
  );
}

/* ── ⑥ 老机型顶栏必须是半透明磨砂，不许退回实底（§21.3 ⑦ 残余；霖 2026-10-05 裁定 (b)）──
   96 上含 var() 的 color-mix 整条作废 → 顶栏底变透明；若兜底只写 `background: var(--bg)`
   就成了**不透明实底**，磨砂观感全无（本轮修掉的就是这个）。
   正解：栏自身 `background: transparent` + `::before` 铺 `var(--bg)` 并用 `--topbar-bg-alpha`
   降 opacity —— 颜色仍走 --bg → 主题覆盖 --md-sys-color-surface 时顶栏跟着变；
   **不许硬编码 rgba**（硬编码会在主题下露白，正是 token-leak 的病灶）。 */
const TOPBAR_HINT = "老机型顶栏又变实底了：96 兜底必须是半透明（见 §21.3 ⑦，霖选 b）";
const topbarFallback = allRules.find(
  (r) =>
    r.file === "apps/desktop/src/styles/global.css" &&
    r.selector === ".mobile-topbar" &&
    r.ats.some(isColorMixFallback),
);
ok(!!topbarFallback, `${TOPBAR_HINT}（96 兜底块里找不到 .mobile-topbar 规则）`);
const topbarBgs = topbarFallback?.decls.filter((d) => d.prop === "background") ?? [];
ok(
  topbarBgs.length > 0 && topbarBgs.every((d) => d.value === "transparent"),
  `${TOPBAR_HINT}（兜底块里 .mobile-topbar 的 background 只能是 transparent，实际：${
    topbarBgs.map((d) => d.raw).join(" / ") || "无 background 声明"
  }）`,
);
const topbarVeil = allRules.find(
  (r) =>
    r.file === "apps/desktop/src/styles/global.css" &&
    r.selector === ".mobile-topbar::before" &&
    r.ats.some(isColorMixFallback),
);
ok(!!topbarVeil, `${TOPBAR_HINT}（缺 .mobile-topbar::before 半透明垫层）`);
ok(
  !!topbarVeil?.decls.some((d) => d.prop === "background" && d.value === "var(--bg)"),
  `${TOPBAR_HINT}（::before 垫层必须用 var(--bg) 铺色，否则主题切不动）`,
);
ok(
  !!topbarVeil?.decls.some((d) => d.prop === "opacity" && /var\(--topbar-bg-alpha\b/.test(d.value)),
  `${TOPBAR_HINT}（::before 的 opacity 必须引用 --topbar-bg-alpha 令牌，不许硬编码 rgba）`,
);
const topbarAlpha = /--topbar-bg-alpha\s*:\s*([0-9]*\.?[0-9]+)\s*;/.exec(tokensSrc)?.[1];
ok(
  topbarAlpha !== undefined && Number(topbarAlpha) > 0 && Number(topbarAlpha) < 1,
  `${TOPBAR_HINT}（tokens.css 缺半透明档位 --topbar-bg-alpha，或值不在 (0,1) 开区间：${topbarAlpha ?? "未定义"}）`,
);

/* ── 输出 ──────────────────────────────────────────────────────────────────────── */
if (fail.length) {
  console.error("老机型（WebView 96）兜底护栏 ✗");
  for (const f of fail) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(
  `老机型（WebView 96）兜底护栏 ✓ color-mix ${cmSites.length} 处 / scale ${scaleSites.length} 处 / :has() ${hasSites.length} 处：全部有兜底或已登记为装饰性；字体栈与 backdrop-filter 就位`,
);
