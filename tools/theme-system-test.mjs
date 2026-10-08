/**
 * 主题 × System 层护栏：防"主题只改了 Compat、System 组件看不到"。
 *
 * 背景（真回归）：§3.5 B1 把按钮从 Compat 名（--surface/--border/--primary）迁到 System 角色
 * （--md-sys-color-*），而 7 个内置主题的覆盖值一直写在 Compat 层——Compat 是单向别名，
 * 覆盖它不回流 System，于是"换主题按钮不变色"。
 * 修法是注入时镜像（见 state/theme.ts 的 COMPAT_TO_SYSTEM），这里逐条钉死：
 *   1) 镜像表 == tokens.css Compat 层的逆映射（双向，任何漂移直接红）；
 *   2) 每个主题的每个覆盖键都必须能镜像（新主题写了没人认识的键 → 红）；
 *   3) 行为：逐个主题应用后，注入 CSS 里 Compat 行与 System 行成对出现且同值；
 *      按钮读的角色（surface-container-lowest / outline-variant / on-surface / primary）确实被改到。
 */
import { dom } from "./dom-stub.mjs";
import assert from "node:assert/strict";
import { readFileSync, readlinkSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.window.__TAURI_INTERNALS__ = { invoke: async () => null };
const T = await import("../apps/desktop/src/state/theme.ts");
const { COMPAT_TO_SYSTEM } = T;

/* [1] 与 tokens.css 的 Compat 层逐条一致 */
const tokens = readFileSync("packages/ui/src/tokens.css", "utf8");
const expected = new Map();
for (const line of tokens.split("\n")) {
  const m = /^\s*(--(?!md-sys-)[\w-]+):\s*var\((--md-sys-[\w-]+)\);\s*$/.exec(line);
  if (m) expected.set(m[1], m[2]);
}
assert.ok(expected.size >= 30, "Compat 层解析异常，只解析到 " + expected.size + " 条");
assert.deepEqual(
  Object.keys(COMPAT_TO_SYSTEM).sort(),
  [...expected.keys()].sort(),
  "镜像表与 tokens.css Compat 层的键不一致",
);
for (const [k, v] of expected) {
  assert.equal(COMPAT_TO_SYSTEM[k], v, "映射错位：" + k + " → " + COMPAT_TO_SYSTEM[k] + "，tokens.css 里是 " + v);
}

/* [2] 主题覆盖键全部可镜像 */
const themes = T.listThemes();
const unmapped = new Set();
for (const t of themes) for (const k of Object.keys(t.vars ?? {})) if (!COMPAT_TO_SYSTEM[k]) unmapped.add(k);
assert.deepEqual([...unmapped], [], "有主题覆盖键映射不到 System 角色（主题改了 Compat、System 组件看不到）");

/* [2b] 页面底与卡片底色要成对给：页面底现在读 container-low（= --bg-soft 的镜像），
   只给 --bg 会让页面停在默认灰、只有卡片变色（§3.5 B2 之后新增主题最容易踩的坑） */
for (const t of themes) {
  const vars = t.vars ?? {};
  if (!Object.keys(vars).length) continue; // 基础令牌（ivory）本来就没有覆盖
  assert.ok(
    vars["--bg"] && vars["--bg-soft"],
    t.id + "：页面底与卡片底色必须成对给（--bg + --bg-soft），否则页面不跟随主题",
  );
}

/* [3] 行为：逐主题应用，Compat 行与 System 行成对同值 */
const BUTTON_COMPAT = ["--surface", "--border", "--text-1", "--text-2", "--primary", "--hover", "--ring"];
const themeStyle = () => {
  const el = [...dom.styles.values()].find((s) => String(s.id).includes("theme"));
  return el ? String(el.textContent) : "";
};
const decls = (css) => {
  const out = new Map();
  for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
};
let checkedPairs = 0;
for (const t of themes) {
  T.activateTheme(t.id);
  const css = themeStyle();
  assert.ok(css.includes(':root[data-theme="' + t.id + '"]'), t.id + "：注入的选择器不对");
  const got = decls(css);
  for (const [k, v] of Object.entries(t.vars ?? {})) {
    assert.equal(got.get(k), v, t.id + "：" + k + " 的 Compat 行没写进去");
    const sys = COMPAT_TO_SYSTEM[k];
    assert.equal(got.get(sys), v, t.id + "：" + k + " 没有镜像到 " + sys + "（System 组件将不跟随主题）");
    checkedPairs++;
  }
  // 按钮真正读的角色必须被改到（主题覆盖了对应 Compat 键时）
  const overridden = new Set(Object.keys(t.vars ?? {}));
  for (const k of BUTTON_COMPAT) {
    if (!overridden.has(k)) continue;
    const sys = COMPAT_TO_SYSTEM[k];
    assert.ok(got.has(sys), t.id + "：按钮读的 " + sys + " 没被主题改到");
  }
}
T.deactivateTheme();
assert.equal(themeStyle(), "", "回到基础令牌时必须清空注入样式");

console.log(
  "主题×System 护栏：镜像表 " +
    Object.keys(COMPAT_TO_SYSTEM).length +
    " 条与 tokens.css 一致 / " +
    themes.length +
    " 个主题 " +
    checkedPairs +
    " 对 Compat→System 同值 ✓ / 按钮读的角色确实被主题改到 ✓",
);

/* ---------- [4] b40：系统暗色原生信号（老机型「跟随系统」）护栏 ----------
 * 背景：WebView 96（老机型）不把系统暗色透传到 `prefers-color-scheme`——改前实测
 * `mNightMode=2`、应用 Configuration 已 night，但 matchMedia 恒 false（含冷启四次），
 * 「跟随系统」永远停在亮色档。修法：原生读 Configuration 的**实际 night 位**送给前端，
 * dark/light 以原生为准；unknown（PC / 旧路径 / 读取失败）回落 matchMedia，现代引擎
 * 两者一致、行为不变；系统档切换由插件 onConfigurationChanged 推事件（无轮询）。
 * 本段钉死五条：
 *   ① 原生接线在位（前端确实请求并采用它 + 订阅变更事件）；
 *   ② unknown 不许当 light 硬覆盖，仍回落 matchMedia（现代引擎不回归）；
 *   ③ 原生判据读 Configuration 的 night 位、auto 档按实际值（不许只看 getNightMode()）；
 *   ④ 原生信号路径没有轮询/定时器；
 *   ⑤ 无新依赖、仓库外生成工程未动。 */

const readSrc = (p) => readFileSync(p, "utf8");
const themeSrc = readSrc("apps/desktop/src/state/theme.ts");
const ktSrc = readSrc(
  "apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt",
);
const cmdSrc = readSrc("apps/desktop/src-tauri/plugins/onethu-mobile/src/commands.rs");
const libSrc = readSrc("apps/desktop/src-tauri/plugins/onethu-mobile/src/lib.rs");
const buildSrc = readSrc("apps/desktop/src-tauri/plugins/onethu-mobile/build.rs");
const permSrc = readSrc("apps/desktop/src-tauri/plugins/onethu-mobile/permissions/default.toml");
const cargoSrc = readSrc("apps/desktop/src-tauri/plugins/onethu-mobile/Cargo.toml");

/* [4.1] 原生接线在位：前端请求 + 采用 + 订阅事件；后端命令与权限齐备 */
assert.ok(
  /invoke<string \| null>\("plugin:onethu-mobile\|system_night_mode"\)/.test(themeSrc),
  "theme.ts 没有请求原生 night 信号（plugin:onethu-mobile|system_night_mode）",
);
assert.ok(
  themeSrc.includes("addPluginListener") && themeSrc.includes('"system-night-mode"'),
  "theme.ts 没有订阅原生 night 变更事件（onethu-mobile / system-night-mode）",
);
assert.ok(
  /\.then\(\(mode\) => applyNativeNightMode\(mode\)\)/.test(themeSrc),
  "theme.ts 启动读到的原生值没有被采用（没有送进 applyNativeNightMode）",
);
assert.ok(
  /applyNativeNightMode\(p && typeof p === "object" \? p\.mode : null\)/.test(themeSrc),
  "theme.ts 的事件回调没有把原生值送进 applyNativeNightMode",
);
assert.ok(
  /pub async fn system_night_mode/.test(cmdSrc) &&
    cmdSrc.includes('run_mobile_plugin("systemNightMode"') &&
    /Ok\("unknown"\.to_string\(\)\)/.test(cmdSrc),
  "commands.rs 的 system_night_mode 缺失或非 Android 没有回 unknown",
);
assert.ok(libSrc.includes("commands::system_night_mode"), "lib.rs 没有注册 system_night_mode");
assert.ok(
  permSrc.includes("allow-system-night-mode") && permSrc.includes("allow-register-listener"),
  "插件 ACL 没有放行 system_night_mode / register_listener",
);
assert.ok(
  buildSrc.includes("system_night_mode") && buildSrc.includes("register_listener"),
  "build.rs 命令表没有 system_night_mode / register_listener",
);
assert.ok(
  ktSrc.includes("fun systemNightMode(") && /trigger\(NIGHT_MODE_EVENT/.test(ktSrc),
  "Kotlin 侧缺少 systemNightMode 命令或 night 变更事件",
);

/* [4.2] 原生为准：dark/light 确实落到夜/日档；unknown 回落 matchMedia（不许硬当 light） */
T.setDayNightTheme("onethu.theme.ivory", "onethu.theme.night");
T.setFollowSystem(true);
T.applyNativeNightMode("light");
assert.equal(T.themeSchedule().systemDark, false, "原生 light 没有生效");
assert.equal(dom.documentElement.dataset.theme, "onethu.theme.ivory", "原生 light 没有落到日档");
T.applyNativeNightMode("dark");
assert.equal(T.themeSchedule().systemDark, true, "原生 dark 没有生效（老机型仍停在亮色档）");
assert.equal(dom.documentElement.dataset.theme, "onethu.theme.night", "原生 dark 没有落到夜档");
T.applyNativeNightMode("unknown");
assert.equal(T.themeSchedule().systemDark, false, "unknown 没有回落 matchMedia（被当成了 light 或留住了旧值）");
T.setFollowSystem(false);

/* [4.2b] 子进程对照：matchMedia 报 dark 时，unknown 必须回落到 dark（不是硬编码 light）。
 * 主进程的 dom-stub 把 matchMedia 钉成 false，无法区分「回落」与「硬当 light」，
 * 故另起一个受控 matchMedia 的进程直接跑真实 theme.ts。 */
const probeDir = mkdtempSync(join(tmpdir(), "onethu-b40-"));
const probeFile = join(probeDir, "probe.mjs");
writeFileSync(
  probeFile,
  [
    'await import(' + JSON.stringify(join(process.cwd(), "tools/dom-stub.mjs")) + ");",
    "globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });",
    "globalThis.window.__TAURI_INTERNALS__ = { invoke: async () => null };",
    "const T = await import(" + JSON.stringify(join(process.cwd(), "apps/desktop/src/state/theme.ts")) + ");",
    'T.setDayNightTheme("onethu.theme.ivory", "onethu.theme.night");',
    "T.setFollowSystem(true);",
    'T.applyNativeNightMode("unknown");',
    "const unknownFirst = T.themeSchedule().systemDark;",
    'T.applyNativeNightMode("light");',
    "const nativeLight = T.themeSchedule().systemDark;",
    'T.applyNativeNightMode("unknown");',
    "const unknownBack = T.themeSchedule().systemDark;",
    "console.log(JSON.stringify({ unknownFirst, nativeLight, unknownBack }));",
  ].join("\n"),
);
const probeOut = execFileSync(process.execPath, ["--import", "./tools/ts-resolve-register.mjs", probeFile], {
  cwd: process.cwd(),
  encoding: "utf8",
});
const probe = JSON.parse(probeOut.trim().split("\n").pop());
assert.deepEqual(
  probe,
  { unknownFirst: true, nativeLight: false, unknownBack: true },
  "原生 unknown 没有回落 matchMedia（现代引擎回归：matchMedia=dark 时被覆盖成亮色）",
);

/* [4.2c] 子进程：模拟 Android 宿主 + 命令回裸串 "dark" → 启动读一次必须真的采用
 * （2026-10-05 真机冷启实测踩过：Rust 命令回裸串、前端按 {mode} 解 → 启动那次读空转，
 *  只有事件路径生效。这条子进程钉死返回值形状与采用链路。） */
const bootProbeFile = join(probeDir, "boot.mjs");
writeFileSync(
  bootProbeFile,
  [
    'await import(' + JSON.stringify(join(process.cwd(), "tools/dom-stub.mjs")) + ");",
    "globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });",
    'Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Linux; Android 14)", platform: "Linux aarch64", userAgentData: { platform: "Android" }, maxTouchPoints: 5 }, configurable: true, writable: true });',
    "globalThis.window.__TAURI_INTERNALS__ = {",
    "  transformCallback: () => 1,",
    "  invoke: async (cmd) => (String(cmd).includes('system_night_mode') ? 'dark' : null),",
    "};",
    "const T = await import(" + JSON.stringify(join(process.cwd(), "apps/desktop/src/state/theme.ts")) + ");",
    'T.setDayNightTheme("onethu.theme.ivory", "onethu.theme.night");',
    "T.setFollowSystem(true);",
    "await new Promise((r) => setTimeout(r, 80));",
    "console.log(JSON.stringify({ systemDark: T.themeSchedule().systemDark, theme: document.documentElement.dataset.theme ?? null }));",
  ].join("\n"),
);
const bootOut = execFileSync(process.execPath, ["--import", "./tools/ts-resolve-register.mjs", bootProbeFile], {
  cwd: process.cwd(),
  encoding: "utf8",
});
const boot = JSON.parse(bootOut.trim().split("\n").pop());
assert.deepEqual(
  boot,
  { systemDark: true, theme: "onethu.theme.night" },
  "启动读到的原生值没有被采用（老机型冷启仍停在亮色档）",
);

/* [4.3] 原生判据 = Configuration 的实际 night 位（auto 档已由系统折算，不看 getNightMode 的 auto） */
assert.ok(
  /config\.uiMode and Configuration\.UI_MODE_NIGHT_MASK/.test(ktSrc),
  "原生判据没有读 Configuration 的 UI_MODE_NIGHT_MASK（auto 档会判错）",
);
assert.ok(
  /Configuration\.UI_MODE_NIGHT_YES -> "dark"/.test(ktSrc) && /Configuration\.UI_MODE_NIGHT_NO -> "light"/.test(ktSrc),
  "night 位到 dark/light 的映射缺失",
);
// 去掉注释行再查「有没有真的去读 getNightMode()」（本文件注释里会提到它，按代码查）
const ktCode = ktSrc
  .split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");
assert.ok(!/getNightMode\s*\(/.test(ktCode), "原生判据读了 getNightMode() 的 auto 值（应看实际 night 位）");
assert.ok(
  /override fun onConfigurationChanged\(newConfig: Configuration\)/.test(ktSrc),
  "缺少 onConfigurationChanged 钩子（系统档切换不会通知前端）",
);
assert.ok(
  /if \(mode == "unknown" \|\| mode == lastNightMode\) return/.test(ktSrc),
  "onConfigurationChanged 没有把 unknown / 未变化挡在事件之外",
);

/* [4.4] 原生信号路径不许有轮询/定时器 */
const nativeBlock = themeSrc.slice(
  themeSrc.indexOf("系统暗色原生信号"),
  themeSrc.indexOf("/* ---------- 公开 API ---------- */"),
);
assert.ok(nativeBlock.length > 200, "没定位到 theme.ts 的原生信号代码块");
assert.ok(!/setInterval|setTimeout/.test(nativeBlock), "原生信号路径出现轮询/定时器");
assert.ok(!/setInterval/.test(ktSrc), "Kotlin 侧出现 setInterval（不许轮询）");

/* [4.5] 无新依赖、仓库外生成工程未动 */
const depNames = [];
for (const line of (cargoSrc.split("[dependencies]")[1] ?? "").split("\n")) {
  if (/^\s*\[/.test(line)) break; // 下一个 section
  const m = /^([A-Za-z0-9_-]+)\s*=/.exec(line);
  if (m) depNames.push(m[1]);
}
depNames.sort();
assert.deepEqual(depNames, ["log", "serde", "serde_json", "tauri"], "插件新增了依赖（b40 不许加依赖）");
const trackedLink = execFileSync("git", ["show", "HEAD:apps/desktop/src-tauri/gen/android"], { encoding: "utf8" });
assert.equal(
  readlinkSync("apps/desktop/src-tauri/gen/android"),
  trackedLink,
  "gen/android 软链与入库值不一致（仓库外生成工程被改动/未复位）",
);

console.log(
  "b40 原生 night 信号护栏：前端请求+采用+事件订阅 ✓ / 原生 dark→夜档 ✓ / unknown 回落 matchMedia" +
    "（含 matchMedia=dark 子进程对照）✓ / 判据为 Configuration night 位 ✓ / 无轮询 ✓ / 无新依赖、软链未动 ✓",
);
