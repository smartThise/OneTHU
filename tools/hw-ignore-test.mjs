/**
 * 作业「忽略」护栏（R21c 用户定案）。
 *
 * 语义：忽略后**不再在作业区与日程提醒中显示/提醒**（首页作业区、全部作业常规分组、
 * 提醒计划、小组件计数都不含它），并可在「全部作业 → 已忽略」中找回与恢复；
 * 忽略前必须二次确认（弹窗写明后果）。
 *
 * [1] 记忆模块行为：忽略/恢复/幂等/上限/坏数据
 * [2] 三处过滤齐全：提醒输入、首页作业区、全部作业分组
 * [3] 入口与文案：行内忽略/恢复按钮 + 后果确认弹窗；已忽略可见标记
 * [4] 用户可见提示不再带调试「现场」（只进日志）
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ---------- [1] 记忆模块行为 ---------- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};
const mod = await import("../apps/desktop/src/state/hwIgnore.ts");
assert.equal(mod.isHwIgnored("hw1"), false, "初始不应忽略任何作业");
mod.ignoreHw("hw1", "第一次作业");
assert.equal(mod.isHwIgnored("hw1"), true, "忽略后必须记住");
assert.equal(mod.isHwIgnored("hw2"), false, "不得波及其他作业");
mod.ignoreHw("hw1", "第一次作业");
const key = [...store.keys()].find((k) => k.includes("hw.ignored"));
const raw = JSON.parse(store.get(key));
assert.equal(raw.filter((e) => e.id === "hw1").length, 1, "重复忽略必须幂等");
assert.equal(raw[0].title, "第一次作业", "必须留标题（已忽略分组要显示）");
mod.unignoreHw("hw1");
assert.equal(mod.isHwIgnored("hw1"), false, "恢复后必须立即生效");
mod.unignoreHw("hw1"); // 幂等，不抛

for (let i = 0; i < 560; i++) mod.ignoreHw(`x${i}`, `t${i}`);
assert.equal(JSON.parse(store.get(key)).length, 500, "上限 500 条（超出丢最旧）");
assert.equal(mod.isHwIgnored("x0"), false, "最旧的被挤出");
assert.equal(mod.isHwIgnored("x559"), true, "最新的保留");

mod.resetHwIgnoreCache(); // 模块对 localStorage 只读一次（内存缓存），坏数据路径要显式重读
store.set(key, "{坏数据");
assert.equal(mod.isHwIgnored("x559"), false, "损坏存储按空处理，不得抛错");
mod.resetHwIgnoreCache();
store.set(key, JSON.stringify([{ nope: 1 }, "str", { id: "ok1", title: "t", at: 1 }]));
assert.equal(mod.isHwIgnored("x559"), false, "非法条目被过滤，不得崩");
assert.equal(mod.isHwIgnored("ok1"), true, "合法条目仍要读到（过滤而非整体丢弃）");

/* ---------- [2] 三处过滤齐全 ---------- */
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const inputs = read("apps/desktop/src/state/notifyInputs.ts");
assert.ok(inputs.includes("ignoredHwList()") && /\.filter\(\(h\) => !ignoredIds\.has\(h\.id\)\)/.test(inputs),
  "提醒计划必须剔除已忽略作业（不再推送任何截止提醒）");

// 提醒与小组件同源：notifySources 把 collectNotifyInputs 同时喂给通知运行时与小组件运行时，
// 所以在同一处过滤即可覆盖「不推送提醒」与「小组件计数不含已忽略」
const sources = read("apps/desktop/src/state/notifySources.ts");
assert.ok(/collect: collectNotifyInputs/.test(sources) && sources.split("collect: collectNotifyInputs").length - 1 >= 2,
  "通知与小组件必须共用 collectNotifyInputs（过滤才能同时覆盖两者）");

const today = read("apps/desktop/src/pages/Today.tsx");
assert.ok(/!h\.submitted && !ignored\.has\(h\.id\)/.test(today), "首页作业区必须剔除已忽略");

const assigns = read("apps/desktop/src/pages/learn/AssignmentsPage.tsx");
assert.ok(/\{ key: "ignored", label: "已忽略" \}/.test(assigns), "「全部作业」必须有已忽略分组");
assert.ok(/const live = hw\.filter\(\(h\) => !ignored\.has\(h\.id\) && !h\.audited\)/.test(assigns), "常规分组必须剔除已忽略（R23 起同时剔除旁听）");
assert.ok(/ignored: hw\.filter\(\(h\) => ignored\.has\(h\.id\)\)/.test(assigns), "已忽略分组要能找回来");

/* ---------- [2b] 所有「面向用户的作业聚合点」都要接忽略过滤 ----------
 * 教训（用户实录）：第一版只过滤了「全部作业/首页作业区/提醒」，网络学堂首页的
 * 「未交作业」大数字与每门课卡片的「未交 N」、首页小组件的未交统计、日程里的作业
 * DDL 全都还在算已忽略的作业。聚合点必须逐个点名，不能靠记得。 */
const HW_AGGREGATORS = [
  "apps/desktop/src/pages/Learn.tsx",                  // 网络学堂首页：未交总数 + 每课未交数
  "apps/desktop/src/pages/Today.tsx",                  // 今日页作业区
  "apps/desktop/src/pages/learn/AssignmentsPage.tsx",  // 全部作业分组
  "apps/desktop/src/pages/learn/CourseDetailPage.tsx", // 各学科作业栏 + 计数
  "apps/desktop/src/components/HomeWidgets.tsx",       // 首页小组件：未交卡片与 DDL 行
  "apps/desktop/src/pages/Schedule.tsx",               // 日程：作业 DDL 入格
  "apps/desktop/src/state/notifyInputs.ts",            // 提醒计划（通知 + 小组件快照同源）
];
for (const f of HW_AGGREGATORS) {
  const src = read(f);
  assert.ok(/hwIgnore\.js/.test(src), `${f} 未接忽略过滤（聚合点必须逐个点名）`);
  assert.ok(/ignored/.test(src), `${f} 未使用忽略状态`);
}
// 反向护栏：除详情页（单条）与搜索页（用户显式检索，保留并标「已忽略」）外，
// 任何在本目录树里聚合 data?.homework 的文件都必须接忽略过滤
const { readdirSync, statSync } = await import("node:fs");
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const fp = `${dir}/${e}`;
    if (statSync(fp).isDirectory()) walk(fp, out);
    else if (/\.tsx?$/.test(e)) out.push(fp);
  }
  return out;
};
const root = new URL("../apps/desktop/src", import.meta.url).pathname;
const EXEMPT = [/AssignmentDetailPage\.tsx$/, /SearchPage\.tsx$/, /widgetRuntime\.ts$/, /hwIgnore\.ts$/];
for (const fp of walk(root)) {
  if (EXEMPT.some((re) => re.test(fp))) continue;
  const src = readFileSync(fp, "utf8");
  if (!/data\?\.homework/.test(src)) continue;
  assert.ok(/hwIgnore\.js/.test(src), `${fp.replace(root, "src")} 聚合了作业却没接忽略过滤`);
}

/* ---------- [3] 入口与文案 ---------- */
const shared = read("apps/desktop/src/pages/learn/shared.tsx");
const row = shared.slice(shared.indexOf("export function HomeworkRow("), shared.indexOf("\nexport function ", shared.indexOf("export function HomeworkRow(") + 10));
assert.ok(row.includes("useHwIgnored(h.id)"), "行组件必须订阅忽略状态（全部列表共用）");
assert.ok(row.includes("confirmDanger("), "忽略必须先经危险确认弹窗");
assert.ok(/确定要忽略《\$\{h\.title\}》吗？/.test(row), "确认弹窗要指名作业");
assert.ok(row.includes("错过截止的后果"), "确认弹窗必须写明后果（用户口径：后果自负）");
assert.ok(row.includes("ignoreHw(") && row.includes("unignoreHw("), "必须有忽略与恢复两个动作");
assert.ok(row.includes("已忽略") && row.includes("恢复"), "已忽略标记与恢复入口都要有");
assert.ok(/e\.stopPropagation\(\)/.test(row), "行内按钮不得触发行点击导航");
// 忽略与作业状态无关：入口常驻，不得挂在 remind 开关上（未交/已交/已批都要能忽略）
assert.ok(!/\{remind \|\| isIgnored \?/.test(row), "忽略入口必须常驻（不随 remind 条件渲染）");
// 弹窗措辞不得照抄退选场景（用户实录：「确认退选是什么鬼东西」）——见下方预设断言
const confirmLib = read("apps/desktop/src/lib/confirm.tsx");
// 措辞属于场景、不属于组件：组件只提供通用兜底，且标题/按钮都必须取自请求
assert.ok(/export function confirmDanger\(\s*msg: string,\s*opts: \{ title\?: string; confirmText\?: string \} = \{\},\s*\)/.test(confirmLib),
  "confirmDanger 必须接受 { title, confirmText }");
assert.ok(/cur\.title \?\? "此操作不可撤销，请确认"/.test(confirmLib), "标题取自请求，兜底为通用措辞");
assert.ok(/cur\.confirmText \?\? "确认执行"/.test(confirmLib), "确认按钮文案同样取自请求（此前写死「确认退选」）");
assert.ok(!/确认退选<\/button>/.test(confirmLib), "组件内不得再写死「确认退选」");
assert.ok(/export const CONFIRM_DROP_COURSE = \{ title: "即将退选，请确认！", confirmText: "确认退选" \} as const;/.test(confirmLib),
  "退选措辞必须集中成场景预设");
assert.ok(/export const CONFIRM_IGNORE_HW = \{ title: "忽略这条作业，请确认！", confirmText: "确认忽略" \} as const;/.test(confirmLib),
  "忽略措辞必须集中成场景预设");

// 每个危险调用方都要声明自己的场景措辞（退选 3 处 / 忽略 1 处）
const dropCallers = ["apps/desktop/src/pages/zhjwxk/Courses.tsx", "apps/desktop/src/state/data.ts"];
for (const f of dropCallers) {
  const src = read(f);
  const calls = src.split("confirmDanger(").length - 1;
  const tagged = src.split(/CONFIRM_DROP_COURSE|DROP_CONFIRM/).length - 1;
  assert.ok(tagged >= calls, `${f}：${calls} 处危险确认必须都带上退选场景措辞`);
}
assert.ok(row.includes("CONFIRM_IGNORE_HW"), "忽略场景必须用忽略措辞预设（不得再传裸字符串标题）");

// 插件 API 必须透传标题与按钮文案（可控制 UI 的接口同样不能写死场景措辞）
const facade = read("apps/desktop/src/plugins/facade.ts");
assert.ok(/opts\?: \{ danger\?: boolean; title\?: string; confirmText\?: string \}/.test(facade),
  "插件 ui.confirm 必须支持 { title, confirmText }");
assert.ok(/confirmDanger\(String\(msg \?\? ""\), \{/.test(facade), "插件危险确认必须透传两个文案字段");
const ptypes = read("apps/desktop/src/plugins/types.ts");
assert.ok(/opts\?: \{ danger\?: boolean; title\?: string; confirmText\?: string \}/.test(ptypes),
  "插件类型声明必须同步（插件作者可见的 API 面）");
const devdoc = read("docs/plugin-development.md");
const apidoc = read("docs/api-reference.md");
assert.ok(devdoc.includes("confirmText") && apidoc.includes("confirmText"), "插件文档必须写明 title/confirmText");

/* ---------- [3b] 课程页：忽略优先级最高 + 自带忽略栏 ---------- */
const course = read("apps/desktop/src/pages/learn/CourseDetailPage.tsx");
assert.ok(/\{ key: "ignored", label: "已忽略" \}/.test(course), "每门课必须有自己的「已忽略」栏");
assert.ok(/const live = homework\.filter\(\(h\) => !ignored\.has\(h\.id\) && !h\.audited\)/.test(course),
  "课程页常规栏必须剔除已忽略（R23 起同时剔除旁听）");
assert.ok(/ignored: homework\.filter\(\(h\) => ignored\.has\(h\.id\)\)/.test(course), "课程页忽略栏要能列出来");
assert.ok(/assignments: homework\.filter\(\(h\) => !ignored\.has\(h\.id\) && !h\.audited\)\.length/.test(course),
  "课程页作业计数也不得含已忽略/旁听");

/* ---------- [4] 调试现场只进日志 ---------- */
const detail = read("apps/desktop/src/pages/learn/AssignmentDetailPage.tsx");
assert.ok(!/setSubMsg\(msg \+ "｜现场："/.test(detail), "用户可见提示不得再拼调试现场");
assert.ok(/LEARN-OPFAIL/.test(detail), "现场必须改记进日志（保留可诊断性）");
const visible = ["apps/desktop/src/pages/learn/AssignmentDetailPage.tsx", "apps/desktop/src/pages/learn/shared.tsx"];
for (const f of visible) {
  const src = read(f).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(!src.includes("｜现场："), `${f} 仍有用户可见的调试现场拼接`);
}

console.log("hw-ignore-test: 全部断言通过（记忆行为 + 三处过滤 + 入口确认 + 现场不再外露）");
