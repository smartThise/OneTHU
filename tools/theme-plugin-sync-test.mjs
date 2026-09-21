/**
 * 主题插件「两处删除不同步」回归测试
 *
 * 用户实锤的 bug：插件页的「主题区」删除与插件卡片的「删除」各管一段状态，删一边
 * 另一边还在（主题区删完插件卡还在 / 插件删完主题还在架上）。
 *
 * 修法是把主题定义的所有权钉住：installTheme 记录 owner 插件 id，插件卸载 / 停用 /
 * 覆盖安装三条路径都回收自己的主题。本测试直接跑主题状态库（state/theme.ts），
 * 覆盖所有权匹配的四种情形与「应用中的主题被删要撤下」。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/theme-plugin-sync-test.mjs
 */

/* ── 宿主环境桩：主题库在模块顶层 bootstrap()，需要 localStorage 与最小 DOM ── */
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

const {
  installTheme, removeTheme, removePluginThemes, activateTheme, activeThemeId,
  setDayNightTheme, themeSchedule, listThemes, activateTheme: _a,
} = await import("../apps/desktop/src/state/theme.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const has = (id) => listThemes().some((t) => t.id === id);

const def = (id, name = id) => ({ id, name, version: "1.0.0", vars: { "--bg": "#fff" } });

/* ① 新版安装记录 owner：删插件 → 主题一并撤架，且应用中的主题要撤下 */
eq("安装后主题在架", (installTheme(def("onethu.theme.barbie", "芭比粉"), "plugin", "onethu.theme.barbie"), has("onethu.theme.barbie")), true);
eq("owner 已记录", listThemes().find((t) => t.id === "onethu.theme.barbie")?.owner, "onethu.theme.barbie");
ok("可应用", activateTheme("onethu.theme.barbie"));
eq("应用后 activeId", activeThemeId(), "onethu.theme.barbie");
eq("按 owner 回收", removePluginThemes("onethu.theme.barbie"), ["onethu.theme.barbie"]);
eq("主题已不在架（插件卡片与主题区一致）", has("onethu.theme.barbie"), false);
eq("应用中的主题被删 → 回到默认", activeThemeId(), null);

/* ② 历史记录没有 owner，但主题 id 与插件 id 同名（文档约定）→ 仍能回收 */
installTheme(def("onethu.theme.legacy", "旧主题"), "plugin");
eq("无 owner 同名主题已安装", has("onethu.theme.legacy"), true);
eq("同名约定可回收", removePluginThemes("onethu.theme.legacy"), ["onethu.theme.legacy"]);

/* ③ 主题 id 与插件 id 不同名且无 owner → 靠插件模块声明的 ids 兜底 */
installTheme(def("onethu.theme.custom-id", "自定 id"), "plugin");
eq("改名主题已安装", has("onethu.theme.custom-id"), true);
eq("不传 ids 时匹配不到（保留，避免误删）", removePluginThemes("onethu.plugin.x"), []);
eq("传 ids 时回收", removePluginThemes("onethu.plugin.x", { ids: ["onethu.theme.custom-id"] }), ["onethu.theme.custom-id"]);

/* ④ 覆盖安装：新版主题保留，旧版残留回收 */
installTheme(def("onethu.theme.v2", "新版"), "plugin", "onethu.plugin.y");
installTheme(def("onethu.theme.v1", "旧版"), "plugin", "onethu.plugin.y");
eq("更新后只留新版", removePluginThemes("onethu.plugin.y", { keep: ["onethu.theme.v2"] }), ["onethu.theme.v1"]);
eq("新版仍在架", has("onethu.theme.v2"), true);

/* ⑤ 不误伤：别人家的主题、内置主题 */
installTheme(def("onethu.theme.other", "别人的"), "plugin", "onethu.plugin.z");
eq("回收他人插件不影响本插件主题", removePluginThemes("onethu.plugin.z2"), []);
eq("本插件主题仍在", has("onethu.theme.other"), true);
removeTheme("onethu.theme.ivory");
eq("内置主题删不掉", has("onethu.theme.ivory"), true);

/* ⑥ 昼夜档位：主题被回收后昼夜槽位一并清空 */
installTheme(def("onethu.theme.nightly", "夜色"), "plugin", "onethu.plugin.n");
setDayNightTheme("onethu.theme.nightly", "onethu.theme.nightly");
eq("昼夜档位已设置", [themeSchedule().dayThemeId, themeSchedule().nightThemeId], ["onethu.theme.nightly", "onethu.theme.nightly"]);
removePluginThemes("onethu.plugin.n");
eq("回收后昼夜档位清空", [themeSchedule().dayThemeId, themeSchedule().nightThemeId], [null, null]);

/* ⑦ 落盘一致性：删除后的状态写回了 localStorage */
const saved = JSON.parse(store.get("onethu.theme.v1"));
eq("持久态不含已删主题", saved.installed.filter((t) => t.id.startsWith("onethu.theme.barbie")).length, 0);
ok("持久态仍在架的主题都有 id", saved.installed.every((t) => typeof t.id === "string"));

/* ⑧ 暗色主题令牌完备性（2026-09-21 霖实测：暗黑模式下骨架流光仍是白色模式）
 * 骨架屏流光高光 --skeleton-shine 亮色是白光扫过；任何 dark 主题都必须覆盖它，
 * 否则暗底上会扫过一道刺眼白带。CSS 侧也必须走令牌（禁止再硬编码 rgba 白）。 */
const { readFileSync } = await import("node:fs");
const darkThemes = listThemes().filter((t) => t.dark === true);
ok("存在内置暗色主题（护栏前置）", darkThemes.length > 0);
for (const t of darkThemes) {
  ok(`暗色主题 ${t.id} 覆盖 --skeleton-shine`, typeof t.vars?.["--skeleton-shine"] === "string");
}
const tokensCss = readFileSync(new URL("../packages/ui/src/tokens.css", import.meta.url), "utf8");
ok("亮色令牌基线定义 --skeleton-shine", /--skeleton-shine\s*:/.test(tokensCss));
const globalCss = readFileSync(new URL("../apps/desktop/src/styles/global.css", import.meta.url), "utf8");
const shimmerRule = globalCss.slice(globalCss.indexOf(".skeleton::after"), globalCss.indexOf("@keyframes shimmer"));
ok("骨架流光高光走令牌", shimmerRule.includes("var(--skeleton-shine"));
// 允许 var() 的兜底值仍是白光（无令牌上下文用），但禁止出现**裸**硬编码色标
const bareWhite = (shimmerRule.match(/rgba\(255,\s*255,\s*255,\s*0\.6\)/g) || []).length;
const fallbackWhite = (shimmerRule.match(/var\(--skeleton-shine,\s*rgba\(255,\s*255,\s*255,\s*0\.6\)\)/g) || []).length;
eq("骨架流光高光无裸硬编码白光（仅 var 兜底）", bareWhite, fallbackWhite);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
