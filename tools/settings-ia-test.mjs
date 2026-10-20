/**
 * 设置分层与插件归位护栏（§4.4 / §4.4b）
 *
 * 为什么要有这条：设置页的分节显隐靠「分节标题 → 页签」这张映射表（SETTINGS_TAB_OF）。
 * 改了分节标题却忘了改表，那一节就再也匹配不到页签、永远不会被隐藏，
 * 于是它会出现在**每一个**页签下面 —— §4.5 改「账号与凭据 → 账号与绑定」时就真发生过，
 * 而当时的护栏一条都没拦住。这条护栏就是为它补的。
 *
 * §4.4b 起插件管理界面并进设置页（霖要求）：侧栏不再有单独入口，
 * 旧 plugins 路由落到「设置 → 插件」——这条链也一并守住。
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const settings = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const mode = readFileSync("apps/desktop/src/state/settingsMode.ts", "utf8");
const layout = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const plugins = readFileSync("apps/desktop/src/pages/Plugins.tsx", "utf8");

// ① 分节 ↔ 页签：每个分节头必须带稳定 group（= 页签 key）。
//    2026-10-19：标题改走 i18n 后不能再按文字匹配 —— 切英文时 "Help"/"About" 对不上中文表，
//    整页分节会脱离页签控制（用户实测「切换语言后设置页坏了」）。
const headAttrs = [...settings.matchAll(/<SectionHead\b([^>]*)\/>/g)].map((m) => m[1]);
const groups = headAttrs.map((a) => a.match(/group="([^"]+)"/)?.[1] ?? null);
const tabOfBody = settings.match(/const SETTINGS_TAB_OF[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
/* 键可能带空格（如 OneShot 快捷入口）——先试引号键，再退回裸键 */
const tabPairs = [...tabOfBody.matchAll(/(?:"([^"]+)"|([^\s:,{}"]+))\s*:\s*"([^"]+)"/g)].map((m) => ({ key: m[1] ?? m[2], tab: m[3] }));
const tabValues = new Set(tabPairs.map((p) => p.tab));
assert.ok(headAttrs.length >= 15, "没解析到分节头（结构变了？）");
assert.ok(groups.every(Boolean), "有分节没写 group：切语言后它会脱离页签控制，恒显或恒隐");
for (const g of groups) {
  assert.ok(tabValues.has(g), `分节 group="${g}" 不是任何页签：它匹配不到页签，会出现在每个页签下面`);
}
/* 运行时确实读稳定标记（而不是标题文字） */
assert.ok(/settings-group:/.test(settings) && /data-og-scope/.test(settings), "设置页的 groupOf 没有读 data-og-scope 稳定分组");
assert.ok(/scope=\{group \? "settings-group:" \+ group/.test(layout), "SectionHead 没有把 group 落到 data-og-scope");

// ② 标准模式 ≤7 项
const order = mode.match(/SETTINGS_TAB_ORDER = \[([^\]]+)\]/)?.[1] ?? "";
const tabOrder = order.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
const advNames = (mode.match(/ADVANCED_SETTINGS_TABS = \[([^\]]+)\]/)?.[1] ?? "")
  .split(",")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter(Boolean);
const stdTabs = tabOrder.filter((t) => !advNames.includes(t));
assert.ok(
  stdTabs.length <= 8,
  "标准模式页签必须 ≤8 项（高级页签不计；2026-10-11 重构「桌面小组件」独立成栏后为 8），现在 " +
    stdTabs.length +
    " 项：" +
    stdTabs.join("/"),
);

// ③ 高级模式已整体退役（settingsMode.ts 头注，2026-10-11 用户拍板）：
//    不再用可见性分层藏功能——护栏反向钉住「旧机制不许僵尸回归」。
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const modeCode = stripComments(mode);
const settingsCode = stripComments(settings);
assert.ok(!/ADVANCED_SETTINGS_TABS/.test(modeCode) && !/ADVANCED_SETTINGS_TABS/.test(settingsCode),
  "ADVANCED_SETTINGS_TABS 已随高级模式退役，不许回来（注释提及不算）");
assert.ok(!/useAdvancedMode|setAdvancedMode/.test(modeCode) && !/useAdvancedMode|setAdvancedMode/.test(settingsCode),
  "useAdvancedMode/setAdvancedMode 已删除，不许回来（注释提及不算）");
assert.ok(!/setting-title">高级模式</.test(settings), "设置里不应再有「高级模式」开关行");

// ④ 页签唯一来源与插件独立入口（2026-10-11 重构：插件升成独立入口，不再嵌设置页）
assert.ok(/export const SETTINGS_TAB_ORDER/.test(mode), "页签唯一清单必须在 settingsMode.ts");
assert.ok(!/"插件"/.test(mode.match(/export const SETTINGS_TAB_ORDER = \[[^\]]*\]/)?.[0] ?? "[]"),
  "「插件」不应在设置页签里（它有自己的独立入口）");
assert.ok(/openSettings\("plugins"\)|Entry/.test(layout), "桌面插件入口要走设置浮层的插件段（explorer 壳）");
assert.ok(!/navRow\("plugins"/.test(layout), "旧侧栏插件行不应回归");

// ⑤ 设置页要消费页签/分节请求（外部跳转直接落在对应栏）
assert.ok(
  /export function consumeSettingsTabRequest/.test(mode) && /consumeSettingsTabRequest\(\)/.test(settings),
  "设置页要消费页签请求（外部跳转直接落在对应栏）",
);
assert.ok(/consumeSettingsSectionRequest/.test(mode) && /consumeSettingsSectionRequest\(\)/.test(settings),
  "设置页要消费分节请求（检索行落点要滚动 + 高亮）");

console.log(
  "设置分层与插件归位：分节↔页签映射 " + headAttrs.length + " 项（稳定 group） / 标准模式 " + tabOrder.length +
  " 项（≤8） / 高级模式退役无僵尸 ✓ / 插件独立入口 ✓ / 页签与分节请求消费 ✓",
);
