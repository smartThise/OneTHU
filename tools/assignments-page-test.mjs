#!/usr/bin/env node
/**
 * E8 全部作业页护栏（霖 2026-10-04 口径，docs/ui-ux-polish-detailed.md §6 E8）。
 *
 * 三条断言（施工图原文 + b29 升级）：
 *   [1] tab 栏不再含「已忽略」（已逾期也不再是独立 tab）；
 *   [2] 顶部垃圾桶图标入口存在，点开走 A3 既有弹层展示忽略列表且**可恢复**；
 *       b29（霖 2026-10-04 裁定）：**一步展开**——点垃圾桶直接进忽略列表，不经过单项菜单；
 *   [3] 「已逾期」归入「进行中」但单独一栏，并且**计入**「进行中」的计数。
 *
 * 反例（必须被拦住）：把「已忽略」彻底删掉（看不到也恢复不了）。所以这里同时断言
 * 忽略数据层（state/hwIgnore.ts）仍在链上、恢复动作仍走 unignoreHw。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("apps/desktop/src/pages/learn/AssignmentsPage.tsx");
const css = read("apps/desktop/src/styles/global.css");
const icons = read("apps/desktop/src/components/Icons.tsx");

/* ---------- [1] tab 栏不再含「已忽略」，也不再单列「已逾期」 ---------- */
{
  const from = page.indexOf("const FILTERS");
  const filters = page.slice(from, page.indexOf("];", from));
  assert.ok(!/已忽略/.test(filters), "tab 栏里还有「已忽略」——应移到顶部垃圾桶入口");
  assert.ok(!/已逾期/.test(filters) && !/overdue/.test(filters), "「已逾期」不该再是独立 tab——应并入「进行中」单列一栏");
  for (const label of ["进行中", "已交", "已批", "全部"]) {
    assert.ok(filters.includes(label), `tab 栏缺「${label}」`);
  }
  assert.ok(!/type Filter = [^;]*"ignored"/.test(page), "Filter 联合类型里还留着 ignored");
  assert.ok(!/type Filter = [^;]*"overdue"/.test(page), "Filter 联合类型里还留着 overdue");
  assert.ok(!/filter === "ignored"/.test(page), "页面里还残留「已忽略」分组渲染分支");
  assert.ok(!/filter === "overdue"/.test(page), "页面里还残留「已逾期」分组渲染分支");
}

/* ---------- [2] 顶部垃圾桶入口 + A3 弹层（一步展开，可恢复） ---------- */
{
  assert.ok(/export const IconTrash/.test(icons), "没有垃圾桶图标 IconTrash（反例：入口被整个删掉）");
  assert.ok(/<IconTrash/.test(page), "顶部没有垃圾桶图标入口");
  assert.ok(/className="icon-btn asg-trash"/.test(page), "垃圾桶入口没挂 .asg-trash（真机取证按这个类名找）");
  assert.ok(/useContextMenu\(\)/.test(page), "垃圾桶入口没走 A3 的 useContextMenu（必须复用既有弹层）");
  assert.ok(/data-ctx-trigger/.test(page), "垃圾桶入口缺 data-ctx-trigger（按第二下应先关而不是重开）");
  /* b29（霖 2026-10-04 裁定）：一步展开——点 .asg-trash **直接**进忽略列表，不经过单项菜单。
     所以入口必须走 ctx.openPanel()，而且不许再留单项菜单的 items 数组 / 单项文案。 */
  const entry = page.slice(page.indexOf("function IgnoredHwEntry"), page.indexOf("export function AssignmentsPage"));
  assert.ok(/ctx\.openPanel\(\{/.test(entry), "垃圾桶入口没有走 ctx.openPanel：点开仍会先出「已忽略的作业」单项菜单（霖要求一步展开）");
  assert.ok(
    !/items:\s*\[/.test(entry) && !/label:\s*"已忽略的作业"/.test(entry),
    "垃圾桶入口还留着单项菜单的 items/label（一步展开后是死代码）",
  );
  assert.ok(/panel: \(\) => <IgnoredHwPanel \/>/.test(entry), "A3 弹层里没有忽略列表（panel 未接列表体）");
  assert.ok(/ctx\.isOpen\(\)/.test(entry) && /ctx\.close\(\)/.test(entry), "垃圾桶入口的「按第二下关闭」切换被改坏了");
  const menu = read("apps/desktop/src/components/ContextMenu.tsx");
  assert.ok(
    /openPanel: \(r: CtxPanelRequest\) => void;/.test(menu) && /initial\?: string;/.test(menu),
    "A3 没有「直接打开 panel」的能力（openPanel / initial）",
  );
  assert.ok(
    /useState<string \| null>\(req\.initial \?\? null\)/.test(menu),
    "A3 没有把 initial 落到 panelKey：一步展开不生效",
  );
  const body = page.slice(page.indexOf("function IgnoredHwPanel"), page.indexOf("function IgnoredHwEntry"));
  assert.ok(/useIgnoredHw\(\)/.test(body), "忽略列表没订阅忽略状态（恢复后不会实时减少）");
  assert.ok(/unignoreHw\(e\.id\)/.test(body), "忽略列表没有恢复动作（反例：看得到但恢复不了）");
  assert.ok(/ignored\.size/.test(page), "垃圾桶入口没有带忽略条数");
  assert.ok(/\.asg-trash-count/.test(css), "垃圾桶徽标样式缺失");
  assert.ok(/\.asg-ignored-row/.test(css) && /\.asg-ignored-title/.test(css), "忽略列表行样式缺失");
  assert.ok(
    /from "\.\.\/\.\.\/state\/hwIgnore\.js"/.test(page) && /unignoreHw/.test(page),
    "忽略数据层被摘掉了（语义：忽略只是移出列表，仍可在垃圾桶里找回并恢复）",
  );
}

/* ---------- [3] 「已逾期」单独一栏且计入「进行中」计数 ---------- */
{
  assert.ok(
    /unfinished: live\.filter\(\(h\) => !h\.submitted\)/.test(page),
    "「进行中」口径必须含已逾期（不能写成 !h.submitted && !isOverdue(h)，那样计数就把逾期漏了）",
  );
  assert.ok(/overdue: live\.filter\(isOverdue\)/.test(page), "缺少「已逾期」分组（栏内单列要用）");
  assert.ok(/<SectionHead title="已逾期" \/>/.test(page), "「已逾期」必须单独一栏（SectionHead，仿旁听作业分栏）");
  assert.ok(
    /const overdueList = filter === "unfinished" \? groups\.overdue : \[\]/.test(page),
    "已逾期栏只应出现在「进行中」下",
  );
  assert.ok(
    /const onTimeList = filter === "unfinished" \? list\.filter\(\(h\) => !isOverdue\(h\)\) : list/.test(page),
    "进行中栏内的未到期列表没排除逾期（会重复显示）",
  );
  assert.ok(
    /<span className="tab-count">\{groups\[key\]\.length\}<\/span>/.test(page),
    "tab 计数来源变了——「进行中」的计数必须把已逾期算进去",
  );
  // 旁听分栏仍在（E8 不动 R23 口径），且按同一口径筛选
  assert.ok(/<SectionHead title="旁听作业" \/>/.test(page), "旁听作业分栏被 E8 改坏了");
}

console.log(
  "assignments-page-test: 全部断言通过（tab 栏无已忽略/已逾期 + 垃圾桶一步展开进 A3 面板且可恢复 + 已逾期单列且计入进行中计数）",
);
