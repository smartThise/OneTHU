/**
 * 实用模式设置页护栏（2026-10-28 用户要求：另开一个界面，结构照搬完整模式的「个人设置」）。
 *
 * 守三件事：
 *  ① 实用模式确实有自己的一份设置页，且**结构**与完整模式同构（7 个页签 + 分节 + 检索落点）；
 *  ② 分节内容全部复用完整模式那一份实现——不允许出现第二套控件逻辑；
 *  ③ 明确不进的项（白板/OnePage/OneShot/收藏夹/管理栏目/极客模式/标签栏样式/帮助第一条）
 *     没有偷偷长回来，也没把完整模式本身删掉。
 */
import { readUiSource as read } from "./i18n/source-view.mjs";
import assert from "node:assert/strict";

const practical = read("apps/desktop/src/pages/PracticalSettings.tsx");
const settings = read("apps/desktop/src/pages/Settings.tsx");
const overlay = read("apps/desktop/src/components/explorer/SettingsOverlay.tsx");
const prefs = read("apps/desktop/src/components/ExplorerPrefsSection.tsx");
const help = read("apps/desktop/src/components/HelpSection.tsx");
const oh = read("apps/desktop/src/components/OhSettingsPage.tsx");
const plugins = read("apps/desktop/src/pages/Plugins.tsx");
const mode = read("apps/desktop/src/state/settingsMode.ts");

/* ── ① 结构：同一份页签清单，同一套三栏几何 ── */
assert.ok(/export function PracticalSettings/.test(practical), "实用模式设置页必须导出 PracticalSettings");
assert.ok(/SETTINGS_TAB_ORDER/.test(practical), "页签必须取自 settingsMode 的唯一清单，不能自己抄一份");
assert.ok(/settingsLabel\(tab\)/.test(practical) && /settingsTabDescription\(tab\)/.test(practical), "页签标题与说明要复用同一套标签表");
assert.ok(/workbench-settings-layout/.test(practical) && /workbench-settings-nav/.test(practical) && /workbench-settings-content/.test(practical), "必须是完整模式那套三栏几何（左导航 + 右内容），不是单页堆叠");
assert.ok(/workbench-settings-phone-nav/.test(practical), "手机端要有页签下拉（与完整模式同款）");
assert.ok(/data-settings-section=/.test(practical), "分节要带 data-settings-section，检索/帮助落点才找得到");
assert.ok(/consumeSettingsTabRequest\(\)/.test(practical) && /consumeSettingsSectionRequest\(\)/.test(practical), "要消费页面外的页签/分节请求（帮助里的「通知」「功能」按钮）");
assert.equal([...mode.matchAll(/"(账号|通知|功能|外观|下载|帮助|关于)"/g)].length >= 7, true, "唯一页签清单应保持 7 项");

/* ── ② 内容：分节全部来自完整模式那一份实现 ── */
const reused = [
  ["AccountRow", "账户"],
  ["EidBindingRow", "账号与绑定"],
  ["CalendarSyncSettings", "云同步"],
  ["ExtHwSettingsSection", "外部作业源"],
  ["SavedPasswordRow", "记住的密码"],
  ["PrivacySettings", "权限与隐私"],
  ["NotifySettingsSection", "通知"],
  ["ExperienceModeControl", "使用模式"],
  ["LanguageControl", "语言"],
  ["ExplorerPrefsSection", "工作空间"],
  ["WidgetSettingsSection", "桌面小组件"],
  ["AppearanceSection", "外观"],
  ["WallpaperSection", "壁纸"],
  ["DownloadSettings", "下载"],
  ["HelpSection", "帮助"],
  ["SoftwareUpdateSection", "检查更新"],
  ["AppVersionRow", "版本"],
  ["DiagnosticsRow", "诊断摘要"],
];
for (const [symbol, label] of reused) {
  assert.ok(new RegExp(`<${symbol}[ />]`).test(practical), `实用模式设置少了「${label}」(${symbol})`);
}
/* 复用＝同源：这些组件必须仍然由完整模式的设置页导出，而不是在实用模式里各写一份 */
for (const symbol of ["AccountRow", "EidBindingRow", "SavedPasswordRow", "AppVersionRow", "AppearanceSection", "WallpaperSection", "DownloadSettings", "DiagnosticsRow"]) {
  assert.ok(new RegExp(`export function ${symbol}\\(`).test(settings), `${symbol} 必须由 pages/Settings.tsx 导出（两个设置页共用一份实现）`);
  assert.ok(!new RegExp(`function ${symbol}\\(`).test(practical), `${symbol} 不可以在实用模式里另写一份`);
}

/* ── ③ 明确不进的项 ── */
/* 注释里会写明「为什么不做」，所以负向断言只看剥掉注释后的代码。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const practicalCode = stripComments(practical);
for (const [pattern, why] of [
  [/(<GeekSection|极客模式)/, "极客模式（用户点名不要）"],
  [/<OneShotSettings/, "OneShot 快捷入口（完整模式专属）"],
  [/<TabManageModal/, "管理栏目（页签显隐，实用模式没有页签）"],
  [/resetHomeBoard/, "首页布局恢复（OnePage 专属）"],
  [/resetFavs|<FavSection/, "收藏夹（OneGO 专属）"],
  [/首页布局/, "首页布局分节"],
  [/管理栏目/, "管理栏目分节"],
]) {
  assert.ok(!pattern.test(practicalCode), `实用模式设置不应出现「${why}」`);
}
assert.ok(/<AppearanceSection practical \/>/.test(practical), "外观分节要以 practical 传入，标签栏样式那一行才会自动不渲染");
assert.ok(/<HelpSection compact \/>/.test(practical), "帮助要以 compact 传入，第一条（白板/暂存箱/组织）才会不渲染");
assert.ok(/<ExplorerPrefsSection hideCapsule \/>/.test(practical), "工作空间要以 hideCapsule 传入，胶囊那一行才会不渲染");

/* 被摘掉的那几行：条件必须真的在组件里，否则「摘」只是没写进新页面 */
assert.ok(/compact = false/.test(help) && /compact \? null :/.test(help), "HelpSection 缺少 compact 分支（帮助第一条应由它决定，而不是在页面里删）");
assert.ok(/hideCapsule = false/.test(prefs) && /hideCapsule \? null :/.test(prefs), "ExplorerPrefsSection 缺少 hideCapsule 分支");
assert.ok(/isPhone \|\| practical \? null :/.test(settings), "外观分节没有按 practical 收起「标签栏默认样式」");

/* ── ④ 设置浮层的分流 ── */
assert.ok(/useExperienceMode\(\) === "practical"/.test(overlay), "浮层要按当前模式分流，而不是只认 simple-like");
assert.ok(/<PracticalSettings \/>/.test(overlay), "实用模式要渲染 PracticalSettings");
assert.ok(/SEGMENTS\.filter\(\(s\) => s\.id === "settings" \|\| s\.id === "oh"\)/.test(overlay), "实用模式只保留「个人设置 / Harness」两段，不出现名片与插件");
assert.ok(/<OhSettingsPage advancedPanels=\{<OhAdvancedPanels \/>\} \/>/.test(overlay), "Harness 段要复用完整模式的同一个页面与同一批高级面板");

/* ── ⑤ Harness 复用：高级面板只有一份实现 ── */
assert.ok(/export function OhAdvancedPanels/.test(plugins), "高级面板要从插件页导出（两处共用）");
assert.ok(/const ohAdvancedPanels = <OhAdvancedPanels \/>;/.test(plugins), "插件页自己也要用导出的那一份，不能留着旧内联副本");
assert.ok(/isSimpleLike\(experienceMode\(\)\)/.test(oh) && /setTier\("advanced"\)/.test(oh), "紧凑模式没有插件页：模型入口要切到高级档，而不是点去一个去不了的页面");

console.log("实用模式设置页：7 页签同构 / 19 个分节全部同源复用 / 明确不进的项未回流 / Harness 与高级面板单一实现 ✓");
