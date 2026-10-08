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

// ① 映射表双向一致
const groupsBody = settings.match(/const SETTINGS_GROUPS[^=]*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? "";
const sections = [...groupsBody.matchAll(/sections: \[([^\]]+)\]/g)]
  .flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/"/g, "")))
  .filter(Boolean);
const tabOfBody = settings.match(/const SETTINGS_TAB_OF[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? "";
const keys = [...tabOfBody.matchAll(/([^\s:,{}]+):\s*"/g)].map((m) => m[1]);
for (const s of sections) {
  assert.ok(keys.includes(s), `分节「${s}」不在 SETTINGS_TAB_OF 里：它匹配不到页签，会出现在每个页签下面`);
}
for (const k of keys) {
  assert.ok(sections.includes(k), `SETTINGS_TAB_OF 里的「${k}」没有对应分节（改了标题忘改表？）`);
}

// ② 标准模式 ≤7 项
const order = mode.match(/SETTINGS_TAB_ORDER = \[([^\]]+)\]/)?.[1] ?? "";
const tabOrder = order.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
const advNames = (mode.match(/ADVANCED_SETTINGS_TABS = \[([^\]]+)\]/)?.[1] ?? "")
  .split(",")
  .map((s) => s.trim().replace(/"/g, ""))
  .filter(Boolean);
const stdTabs = tabOrder.filter((t) => !advNames.includes(t));
assert.ok(
  stdTabs.length <= 7,
  "标准模式页签必须 ≤7 项（高级页签不计），现在 " + stdTabs.length + " 项：" + stdTabs.join("/"),
);

// ③ 高级页签 + 过滤 + 回退
const advTabs = mode.match(/ADVANCED_SETTINGS_TABS = \[([^\]]+)\]/)?.[1] ?? "";
const advList = advTabs.split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
assert.ok(advList.length >= 1, "ADVANCED_SETTINGS_TABS 不能为空（插件系统是进阶项）");
assert.ok(/advanced \|\| !ADVANCED_SETTINGS_TABS\.includes\(t\)/.test(settings), "页签条必须按模式过滤高级页签");
assert.ok(
  /if \(!advanced && ADVANCED_SETTINGS_TABS\.includes\(tab\)\) setTab\(/.test(settings),
  "切回标准模式时当前页签若被收起，必须退回可见页签（否则那一节会全露出来）",
);

// ④ 模式存储
assert.ok(/localStorage\.getItem\(KEY\) === "1"/.test(mode), "模式必须落盘，且默认（读不到）为关");
assert.ok(/localStorage\.setItem\(KEY/.test(mode), "模式必须能写盘");
assert.ok(/export function useAdvancedMode/.test(mode), "必须提供 useAdvancedMode");
assert.ok(/useSyncExternalStore/.test(mode), "订阅要用 useSyncExternalStore（跨组件同步收放）");

// ⑤ 开关摆在设置里，且说法讲人话
assert.ok(/setAdvancedMode, useAdvancedMode/.test(settings), "设置页要接模式存储");
assert.ok(/className="setting-title">高级模式</.test(settings), "设置里要有「高级模式」这一行");
assert.ok(/<Switch on=\{advanced\} onChange=\{setAdvancedMode\} label="高级模式" \/>/.test(settings), "高级模式开关形态不对");
assert.ok(/打开后显示扩展功能、开发者工具等进阶设置/.test(settings), "开关要有说明，别只丢一个开关");

// ⑥ §4.4b：插件并进设置页
assert.ok(/<PluginsPage embedded \/>/.test(settings), "插件管理界面要嵌在设置页的插件分节里");
assert.ok(/export function PluginsPage\(\{ embedded = false \}/.test(plugins), "PluginsPage 要支持 embedded");
assert.ok(
  /const viewSwitch = \(/.test(plugins) && /actions=\{viewSwitch\}/.test(plugins),
  "嵌入时必须保留「我的插件 / 插件市场」切换器，只去掉页面级大标题",
);
assert.ok(!/navRow\("plugins"/.test(layout), "侧栏不该再有单独的插件入口（已并进设置）");
assert.ok(
  /requestSettingsTab\("插件"\)/.test(layout) && /navigate\("settings"\)/.test(layout),
  "旧 plugins 路由要落到「设置 → 插件」，不能停在设置页第一栏",
);
assert.ok(
  /export function consumeSettingsTabRequest/.test(mode) && /consumeSettingsTabRequest\(\)/.test(settings),
  "设置页要消费页签请求（外部跳转直接落在插件那一栏）",
);

/* C19（霖 2026-10-01 走查）：寻迹页的高德 Key 不再把开发者路径甩给用户——
   横幅只留人话 + 「去设置填写」，设置里必须有对应入口，且 Key 只走本机存储。 */
const traceRaw = readFileSync("apps/desktop/src/pages/Trace.tsx", "utf8");
/* 注释里可以提这段历史，甩给用户的**可见文案**里不许再出现 */
const trace = traceRaw.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
assert.ok(!/\.env\.example|TRACE_AMAP_KEY/.test(trace), "Trace.tsx 的可见文案里又出现开发者路径（.env.example / TRACE_AMAP_KEY）");
assert.ok(/requestSettingsTab\("数据与同步"\)/.test(trace), "Trace 的「去设置填写」没有跳到设置对应栏目");
assert.ok(/去设置填写/.test(trace), "Trace 的引导按钮文案丢了");
assert.ok(/<SectionHead title="寻迹地图" \/>/.test(settings), "设置里没有「寻迹地图」这一节");
assert.ok(/高德 Web 服务 Key/.test(settings), "设置里没有高德 Key 输入入口");
assert.ok(/寻迹地图: "数据与同步"/.test(settings), "「寻迹地图」没登记进 SETTINGS_TAB_OF（会出现在每个页签下）");
const traceLib = readFileSync("apps/desktop/src/lib/trace.ts", "utf8");
assert.ok(/export function saveStoredTraceKey/.test(traceLib) && /onethu\.trace\.amapKey/.test(traceLib),
  "Key 没有本机存储通道（只存 localStorage，不写死进包）");
assert.ok(!/amapKey\s*=\s*"[0-9a-f]{32}"/.test(traceLib), "trace.ts 里写死了 Key");

console.log(
  "设置分层与插件归位：分节↔页签映射 " + sections.length + " 项双向一致 / 标准模式 " + tabOrder.length +
  " 项（≤7） / 高级页签 " + advList.join("、") + " / 开关与订阅 ✓ / 插件嵌进设置页 ✓ / 旧路由落回设置 ✓",
);
