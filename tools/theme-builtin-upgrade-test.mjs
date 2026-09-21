/**
 * 内置主题升级通道回归测试（2026-09-21 霖实测：凝夜下骨架流光仍是较亮白光）
 *
 * 踩坑现场：给内置主题 night 的 vars 补了 `--skeleton-shine`（骨架流光高光令牌），
 * 但**没升版本号**——旧版升级通道只比 `version`，于是 localStorage 里存档的旧副本
 * 永不刷新，新令牌缺失，CSS 走 `var(--skeleton-shine, rgba(255,255,255,.6))` 兜底，
 * 暗底上继续扫白光（"改了但没生效"）。
 *
 * 本测试预置「缺该令牌的 night 1.0.0 旧副本」再加载主题库，断言升级通道把它整体
 * 刷新为新定义（令牌集比较兜底，不依赖作者记得升版本）；并断言插件占用的同名主题
 * 不被内置定义覆盖。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/theme-builtin-upgrade-test.mjs
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
const mkEl = () => ({
  dataset: {}, style: {}, textContent: "",
  appendChild() {}, setAttribute() {}, remove() {},
});
globalThis.document = {
  documentElement: mkEl(), head: mkEl(),
  getElementById: () => null, createElement: mkEl, querySelectorAll: () => [],
};
globalThis.window = globalThis;

let pass = 0, fail = 0;
const ok = (name, cond) => {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${name}`); }
};
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};

const KEY = "onethu.theme.v1";

/* ── ① 旧副本（同/旧版本、缺新令牌、含已废弃令牌）必须被整体刷新 ── */
store.set(KEY, JSON.stringify({
  installed: [{
    id: "onethu.theme.night",
    name: "凝夜",
    version: "1.0.0",
    source: "builtin",
    vars: { "--bg": "#0e1117", "--skeleton": "rgba(255, 255, 255, 0.06)", "--legacy-token": "#000" },
  }],
  activeId: "onethu.theme.night",
  deletedBuiltins: [],
  followSystem: false,
  dayThemeId: null,
  nightThemeId: null,
}));

const { listThemes } = await import("../apps/desktop/src/state/theme.ts");
const night = listThemes().find((t) => t.id === "onethu.theme.night");
ok("旧副本仍在内置清单中", Boolean(night));
eq("升级通道刷新到新版本", night?.version, "1.0.1");
ok("刷新后含 --skeleton-shine（流光高光令牌）", typeof night?.vars?.["--skeleton-shine"] === "string");
ok("刷新后已废弃令牌被整体替换掉", night?.vars?.["--legacy-token"] === undefined);
const persisted = JSON.parse(store.get(KEY));
const persistedNight = persisted.installed.find((t) => t.id === "onethu.theme.night");
ok("刷新结果已落盘（下次启动不再回退旧副本）", typeof persistedNight?.vars?.["--skeleton-shine"] === "string");

/* ── ② 插件占用同名 id：内置定义不得覆盖它（source=plugin 保护） ── */
store.set(KEY, JSON.stringify({
  installed: [{
    id: "onethu.theme.night",
    name: "第三方凝夜改",
    version: "9.9.9",
    source: "plugin",
    owner: "onethu.plugin.demo",
    vars: { "--bg": "#000000" },
  }],
  activeId: null,
  deletedBuiltins: [],
  followSystem: false,
  dayThemeId: null,
  nightThemeId: null,
}));
// 二次加载模块实例（查询串缓存穿透）——bootstrap 用新存档重跑
const second = await import("../apps/desktop/src/state/theme.ts?plugin-guard=1");
const pluginNight = second.listThemes().find((t) => t.id === "onethu.theme.night");
eq("插件同名主题不被内置覆盖", pluginNight?.version, "9.9.9");
eq("插件同名主题变量原样保留", pluginNight?.vars?.["--bg"], "#000000");

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
