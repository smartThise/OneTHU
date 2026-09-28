#!/usr/bin/env node
/**
 * 主题入口归属护栏（§4.4 设置分层 / 2026-02 用户反馈）。
 *
 * 背景：主题的**切换**曾经只在「插件页 → 主题区」里，设置页「外观」反而写着
 * "手动换主题在 插件页 → 主题 里操作" —— 用户找不到换肤入口。
 * 定案：切换归 设置 → 外观（唯一入口，避免双头管理）；安装/卸载归 插件页。
 */
import { readFileSync } from "node:fs";

const SETTINGS = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const PLUGINS = readFileSync("apps/desktop/src/pages/Plugins.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 1 设置 → 外观 必须能切主题 */
ok(/activateTheme\(/.test(SETTINGS), "设置 → 外观 缺少切换主题的动作（activateTheme）");
ok(/deactivateTheme\(/.test(SETTINGS), "设置 → 外观 缺少回到默认外观的动作（deactivateTheme）");
ok(!/手动换主题在 插件页/.test(SETTINGS), "设置里还留着把用户支去插件页换主题的提示");
ok(/setting-title">主题</.test(SETTINGS), "设置 → 外观 缺少「主题」小节标题");

/* 2 插件页只管安装/卸载，不再提供切换 */
ok(!/应用主题/.test(PLUGINS), "插件页仍有「应用主题」按钮（切换入口应只在设置里）");
ok(!/已应用「/.test(PLUGINS), "插件页仍在处理「应用主题」的结果");
ok(/removeTheme\(/.test(PLUGINS) && /restoreBuiltins\(/.test(PLUGINS), "插件页应保留主题的删除/恢复内置（安装与卸载）");

console.log(
  fails.length
    ? "主题入口护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "主题入口护栏：设置 → 外观 可切换 ✓ 插件页只留安装/卸载 ✓ 无双头管理 ✓",
);
process.exit(fails.length ? 1 : 0);
