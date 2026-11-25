#!/usr/bin/env node
/** agentHint 注入链护栏：插件命令说明必须能一路到 Harness 的 list_plugin_cmds，
 *  且本体系统提示词不再硬编码具体插件/PDF 能力。 */
import { readFile } from "node:fs/promises";
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const root = new URL("../", import.meta.url);
const read = (p) => readFile(new URL(p, root), "utf8");

const [types, loader, facade, toolsRs, agentRs, docs] = await Promise.all([
  read("apps/desktop/src/plugins/types.ts"),
  read("apps/desktop/src/plugins/loader.ts"),
  read("apps/desktop/src/plugins/facade.ts"),
  read("plugins/OneTHU-Harness/core/src/tools.rs"),
  read("plugins/OneTHU-Harness/core/src/agent.rs"),
  read("docs/plugin-development.md"),
]);

ok(types.includes("agentHint?: string"), "PluginCommand 暴露 agentHint");
ok(types.includes("inputLabel?: string; agentHint?: string"), "plugins.list 返回 agentHint");
ok(loader.includes('cmd.agentHint') && loader.includes("slice(0, 800)"), "loader 清洗并限制 agentHint");
ok(facade.includes("agentHint: cmd.agentHint"), "facade.plugins.list 透传 agentHint");
ok(toolsRs.includes('c.get("agentHint")') && toolsRs.includes('lines.push(format!("  提示：{hint}"))'), "list_plugin_cmds 输出提示");
ok(agentRs.includes("agentHint") && agentRs.includes("list_plugin_cmds"), "系统提示词指向插件提示");
ok(!agentRs.includes("先用 list_plugin_cmds 找命令、run_plugin_cmd 读正文"), "系统提示词不再硬编码 PDF 插件指引");
ok(docs.includes("agentHint") && docs.includes("v1.26"), "文档记录 agentHint 协议");

if (fails.length) {
  console.error("plugin-agent-hint-test: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("plugin-agent-hint-test: 全部通过");
