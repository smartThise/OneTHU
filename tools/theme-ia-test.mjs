#!/usr/bin/env node
/**
 * 主题入口归属护栏（§4.4 设置分层 / 2026-02 用户反馈两轮）。
 *
 * 第一轮：切换入口原本只在「插件页 → 主题区」，设置页只写一行"去插件页换"。
 * 第二轮（用户）：设置里的主题按钮只显示名字、看不到样式。改成单个「更改主题」入口 +
 *   二级菜单：上「已安装」（色卡预览 + 应用/卸载）、下「主题市场」（复用市场搜索、只筛主题）。
 * 定案：主题相关的全部操作（切换/安装/卸载）都收在这一个二级菜单里，插件页不再有主题区。
 */
import { readFileSync } from "node:fs";

const SETTINGS = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const PLUGINS = readFileSync("apps/desktop/src/pages/Plugins.tsx", "utf8");
const PICKER = readFileSync("apps/desktop/src/components/ThemePickerModal.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 1 设置 → 外观：只有一个入口，点开是二级菜单 */
ok(/ThemePickerModal/.test(SETTINGS), "设置 → 外观 没有挂 ThemePickerModal");
ok(/更改主题/.test(SETTINGS), "设置 → 外观 缺少「更改主题」入口");
ok(/setting-title">主题</.test(SETTINGS), "设置 → 外观 缺少「主题」小节标题");
ok(!/手动换主题在 插件页/.test(SETTINGS), "设置里还留着把用户支去插件页换主题的提示");

/* 2 二级菜单：色卡预览 + 上下分区 + 安装/卸载，搜索口径与插件市场一致 */
ok(/ThemeSwatch/.test(PICKER), "二级菜单缺少色卡预览（只显示名字看不出样式）");
ok(/已安装/.test(PICKER) && /主题市场/.test(PICKER), "二级菜单缺少「已安装」/「主题市场」分区");
ok(/activateTheme\(/.test(PICKER), "二级菜单缺少应用主题的动作");
ok(/fetchEntryFromMarket\(/.test(PICKER), "二级菜单缺少安装主题的动作");
ok(/uninstallPlugin\(/.test(PICKER), "二级菜单缺少卸载社区主题的动作");
ok(/includes\("主题"\)/.test(PICKER), "二级菜单没有按「主题」标签筛选市场条目");

/* 3 插件页不再管主题 */
ok(!/应用主题/.test(PLUGINS), "插件页仍有「应用主题」按钮（应只在二级菜单里）");
ok(!/ThemeManagerSection/.test(PLUGINS), "插件页仍渲染主题区（应已收进二级菜单）");
ok(/更改主题/.test(PLUGINS), "插件页的主题页签应指路到 设置 → 外观 →「更改主题」");

console.log(
  fails.length
    ? "主题入口护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "主题入口护栏：设置唯一入口 ✓ 二级菜单（色卡/已安装/主题市场/安装/卸载）✓ 插件页不再管主题 ✓",
);
process.exit(fails.length ? 1 : 0);
