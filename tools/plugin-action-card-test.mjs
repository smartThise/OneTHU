#!/usr/bin/env node
/**
 * 白板「插件交互卡片」数据层护栏。
 *
 * 盯住：保留 id 命名空间的解析、入参校验（坏 id 必须拒绝，不能写坏板文档）、
 * spec ↔ config 往返、同 id 更新而不重复长卡、只删自己的卡片、落位夹取。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/plugin-action-card-test.mjs
 */
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const P = await import("../apps/desktop/src/state/pluginAction.ts");

const PID = "onethu.woodenfish";

/* ① id 编解码 */
ok(P.pluginActionItemId(PID, "main") === "plugin-action:onethu.woodenfish:main", "itemId 格式");
ok(JSON.stringify(P.parsePluginActionItemId("plugin-action:onethu.woodenfish:main")) === JSON.stringify({ pluginId: PID, cardId: "main" }), "parse 正常");
ok(P.parsePluginActionItemId("usergen:x") === null, "非本命名空间返回 null");
ok(P.parsePluginActionItemId("plugin-action:") === null, "空串拒绝");
ok(P.parsePluginActionItemId("plugin-action:noCard") === null, "缺 cardId 拒绝");
ok(P.parsePluginActionItemId("plugin-action:bad id:card") === null, "空格拒绝");

/* ② 入参校验与归一化 */
const cfg = P.normalizePluginActionConfig(PID, {
  cardId: "main",
  title: "  电子木鱼  ",
  tapCmdId: "tap",
  statusCmdId: "status",
  icon: "🐟",
  input: "n=1",
});
ok(cfg.title === "电子木鱼", "title 去空白");
ok(cfg.icon === "🐟", "icon 保留");
ok(cfg.pluginId === PID, "pluginId 来自上下文");

const throws = (fn, label) => { try { fn(); ok(false, label + " 应抛错"); } catch { /* expected */ } };
throws(() => P.normalizePluginActionConfig(PID, { cardId: "bad id", title: "t", tapCmdId: "tap" }), "非法 cardId");
throws(() => P.normalizePluginActionConfig(PID, { cardId: "main", title: "  ", tapCmdId: "tap" }), "空 title");
throws(() => P.normalizePluginActionConfig(PID, { cardId: "main", title: "t", tapCmdId: "" }), "空 tapCmdId");
throws(() => P.normalizePluginActionConfig("bad plugin id", { cardId: "main", title: "t", tapCmdId: "tap" }), "非法 pluginId");

const long = P.normalizePluginActionConfig(PID, { cardId: "main", title: "x".repeat(200), tapCmdId: "tap", input: "y".repeat(500) });
ok(long.title.length === 60, "title 截断到 60");
ok(long.input.length === 200, "input 截断到 200");

/* ③ spec ↔ config 往返 */
const spec = P.pluginActionSpec(cfg);
ok(spec.kind === "custom" && spec.id === "plugin-action:onethu.woodenfish:main", "spec kind/id");
ok(spec.props.title === "电子木鱼" && spec.props.tapCmdId === "tap", "spec props");
const back = P.readPluginActionConfig(spec);
ok(back && back.pluginId === PID && back.cardId === "main" && back.tapCmdId === "tap", "config 往返");
ok(P.readPluginActionConfig({ kind: "custom", id: "usergen:x" }) === null, "非交互卡片 → null");
ok(P.readPluginActionConfig({ kind: "text", text: "x" }) === null, "text 组件 → null");
const fallback = P.readPluginActionConfig({ kind: "custom", id: "plugin-action:onethu.woodenfish:x" });
ok(fallback && fallback.title === "插件卡片" && fallback.tapCmdId === "", "缺 props 时安全降级");

/* ④ 落位夹取 */
const rect = P.pluginActionRect({ x: -5, y: 4, w: 99, h: 0 });
ok(rect.x === 0 && rect.y === 4 && rect.w === 12 && rect.h === 1, "rect 夹取");
const drect = P.pluginActionRect(null);
ok(drect.w === P.PLUGIN_ACTION_DEFAULT_W && drect.h === P.PLUGIN_ACTION_DEFAULT_H, "rect 默认");

/* ⑤ 添加 / 更新不重复 / 只删自己的 */
const base = [{ id: "it.0", spec: { kind: "text", text: "hi", variant: "label" }, cell: { x: 0, y: 0, w: 2, h: 1 } }];
const add1 = P.withPluginActionItem(base, cfg, { x: 1, y: 2, w: 3, h: 3 }, "it.1");
ok(add1.reused === false && add1.items.length === 2, "首次添加");
ok(add1.items[1].cell.x === 1 && add1.items[1].cell.w === 3, "落位写入");

const cfg2 = { ...cfg, title: "木鱼 v2" };
const add2 = P.withPluginActionItem(add1.items, cfg2, { x: 5, y: 5, w: 2, h: 2 }, "it.2");
ok(add2.reused === true && add2.items.length === 2, "同 id 更新不重复");
ok(add2.items[1].spec.props.title === "木鱼 v2" && add2.items[1].cell.x === 5, "更新标题与位置");

const other = P.withPluginActionItem(add2.items, P.normalizePluginActionConfig(PID, { cardId: "other", title: "二卡", tapCmdId: "tap" }), rect, "it.3");
ok(other.items.length === 3, "不同 cardId 是新卡");

const removed = P.withoutPluginActionItem(other.items, PID, "other");
ok(removed.removed && removed.items.length === 2, "只移除指定卡");
ok(removed.items.some((it) => it.spec.kind === "text"), "不误删其它组件");
const removedMiss = P.withoutPluginActionItem(removed.items, PID, "missing");
ok(!removedMiss.removed && removedMiss.items.length === 2, "不存在时 no-op");

/* ⑥ 保留前缀常量 */
ok(P.PLUGIN_ACTION_PREFIX === "plugin-action:", "前缀常量");

if (fails.length) {
  console.error("plugin-action-card-test: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("plugin-action-card-test: 全部通过");
