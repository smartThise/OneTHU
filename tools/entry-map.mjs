/**
 * 生成 docs/入口映射表.md —— 发 beta 用的「功能搬家图」（UI/UX 改造 §6 验收项）。
 *
 * 数据源唯一：apps/desktop/src/state/navigation.ts 的 NAV_REGISTRY。
 * 改造后 IA、搜索、常用推荐、AI 意图都消费这一份注册表，所以入口映射也必须从它生成，
 * 不能手写——手写的表一定会随注册表漂移。
 *
 * 用法：node tools/entry-map.mjs   （输出到 docs/入口映射表.md）
 */
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "apps/desktop/src/state/navigation.ts";
const OUT = "docs/入口映射表.md";

/** 从一行对象字面量里取 `key: "..."` 的值（不引正则，省得转义踩坑） */
function pick(line, key) {
  const i = line.indexOf(key + ": \"");
  if (i < 0) return "";
  const from = i + key.length + 3;
  const to = line.indexOf("\"", from);
  return to < 0 ? "" : line.slice(from, to);
}

const text = readFileSync(SRC, "utf8");
const entries = text
  .split("\n")
  .filter((l) => l.includes("visibility:") && l.includes("id:"))
  .map((l) => ({
    id: pick(l, "id"),
    name: pick(l, "name"),
    category: pick(l, "category"),
    visibility: pick(l, "visibility"),
    page: pick(l, "page"),
    infoTab: pick(l, "infoTab"),
    needBind: pick(l, "needBind"),
  }));

if (entries.length < 30) throw new Error("注册表解析异常，只拿到 " + entries.length + " 条");
const VIS = {
  core: "core（核心直达）",
  group: "group（分组内）",
  buried: "buried（藏起来）",
  advanced: "advanced（高级）",
};
const ROUTE = {
  core: "底栏 5 Tab / PC 侧栏直达",
  group: "手机：服务目录页分组内 / PC：侧栏分区小标题下",
  buried: "搜索兜底 · 二级页内 · 设置内",
  advanced: "设置页「高级」区 · 开发者面板",
};
const CATS = ["学习", "日程", "生活", "预约", "行政", "其他"];

const lines = [];
lines.push("# 入口映射表（功能搬家图）");
lines.push("");
lines.push("本表由 `tools/entry-map.mjs` 从 `apps/desktop/src/state/navigation.ts` 的 `NAV_REGISTRY` **自动生成**，不要手改。");
lines.push("改造后各入口共用这一份注册表，改注册表后重新跑一次：`node tools/entry-map.mjs`。");
lines.push("");
lines.push("## 1. 功能级映射（注册表逐条）");
lines.push("");
lines.push("可见性口径：`core` 核心（底栏/侧栏直达）· `group` 分组内（服务目录页 / 侧栏分区）· `buried` 藏起来（搜索与二级页兜底）· `advanced` 高级（设置页高级区，默认不显眼）。");
lines.push("");
lines.push("| 功能 | 注册表 id | 分类 | 可见性 | 新入口路径 | 备注 |");
lines.push("|---|---|---|---|---|---|");
for (const cat of CATS) {
  for (const e of entries.filter((x) => x.category === cat)) {
    const note = [];
    if (e.needBind) note.push("需绑定 " + e.needBind + " 后显示");
    if (e.infoTab) note.push("落信息页「" + e.infoTab + "」栏目");
    if (e.page && e.page !== e.id) note.push("挂载在 " + e.page + " 页");
    lines.push(
      "| " + e.name + " | `" + e.id + "` | " + e.category + " | " + (VIS[e.visibility] || e.visibility) +
        " | " + (ROUTE[e.visibility] || "—") + " | " + (note.join("；") || "—") + " |",
    );
  }
}
const missing = entries.filter((x) => CATS.indexOf(x.category) < 0);
if (missing.length) {
  lines.push("");
  lines.push("> 未归入已知分类的条目：" + missing.map((m) => m.name + "(" + m.category + ")").join("、"));
}
lines.push("");
lines.push("## 2. 结构级变化（旧 → 新）");
lines.push("");
lines.push("| 维度 | 改造前 | 改造后 | 备注 |");
lines.push("|---|---|---|---|");
const STRUCT = [
  ["手机壳", "抽屉（页头胶囊 → 左滑）+ 无底栏", "底部 5 Tab：今日 / 待办 / 服务 / 收藏 / 我的；长尾仍走抽屉", "§2.2"],
  ["PC 壳", "固定侧边栏（13 项平铺）", "侧边栏按注册表 category 分区（总览/学习/日程/生活/预约/行政），可折叠 224↔72px", "§2.8.1"],
  ["桌面找待办", "侧栏无待办入口", "侧栏「待办」单项（覆盖作业族高亮），不必再进网络学堂翻", "本次新增"],
  ["断点", "860 / 861 / 1080 三套并存，组件各自 matchMedia", "单源 600/840（compact/medium/expanded）+ 唯一读取点 usePlatformLayout", "§2.8.1"],
  ["待办页（手机）", "单列学习/生活 tab 切换", "单列 + 底部 5 Tab 直达；卡片流弹性填充、按 OH 岛预留", "§2.2/§2.8.2"],
  ["待办页（PC）", "不存在（无宽屏形态）", "左学习/右生活；点卡片右栏换作业详情（可展开全屏），滚轮/拖拽换卡右栏跟随", "§2.8.2"],
  ["课表默认视图", "全端默认周网格", "手机/平板竖屏默认列表，PC 默认周网格；手动切过即听用户", "§2.8.2"],
  ["今日（PC）", "问候语占页面顶部大块", "问候语缩进顶栏；右栏常驻「下一节课」卡", "§2.8.2"],
  ["邮件（PC）", "已经是左列表右阅读双栏", "保持（本次核对确认无需改造）", "§2.8.2"],
  ["信息/生活（PC）", "通栏 1160px", "单列限宽 720 居中；含表格的栏目保完整宽度", "§2.8.2"],
  ["设置（PC）", "二级为居中弹窗", "二级改右侧推入面板；页面单列限宽 720", "§2.8.2"],
  ["文件预览（PC）", "居中卡片（偏小）", "居中大窗（≤1120px / 86vh）；侧边附件信息栏待 B3 批次", "§2.8.2 部分"],
];
for (const [a, b, c, d] of STRUCT) lines.push("| " + a + " | " + b + " | " + c + " | " + d + " |");
lines.push("");
lines.push("## 3. 核对清单（发 beta 前逐条走查）");
lines.push("");
const CHECKS = [
  "注册表每一条都能在对应入口点到（core → 底栏/侧栏；group → 服务目录页或侧栏分区；buried → 搜索）",
  "手机：底栏 5 Tab 各自可达，抽屉里长尾功能齐全",
  "PC：侧栏 6 个分区 + 收藏夹段落，折叠态图标仍可点",
  "搜索兜底：随机抽 5 个 buried 功能，搜索关键词能命中",
  "收藏、长按收藏、桌面小组件绑定行为与改造前一致（专项回归，本次未改动收藏相关文件）",
  "外部作业源（雨课堂/OJ）绑定状态下的入口显示与未绑定提示",
];
for (const c of CHECKS) lines.push("- [ ] " + c);
lines.push("");

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log("入口映射表已生成：" + OUT + "（注册表 " + entries.length + " 条）");
