/**
 * 旁听作业单列护栏（R23，霖需求）。
 *
 * 语义：旁听课堂（雨课堂 role=6）的作业**仍属「未完成」**，但：
 *  · 不计入「未交作业」总数与各分组计数（首页概览、三日内截止、作业页页签计数）；
 *  · 不与正式课程混排——在「全部作业」当前分组下方单列「旁听作业」一节；
 *  · 首页作业区（正式课程区）不混入旁听。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* [1] 数据来源：旁听标记来自雨课堂 role=6，且类型上透出到 learn Homework */
const ykt = read("packages/core/src/exthw/yuketang.ts");
assert.ok(/roleByClassroom\.get\(classroomId\) === 6/.test(ykt), "雨课堂 role=6 必须判为旁听课堂");
assert.ok(/audited: audited \|\| undefined/.test(ykt), "旁听标记必须透出到外部作业条目");

const types = read("packages/core/src/learn/types.ts");
assert.ok(/audited\?: boolean/.test(types), "learn Homework 必须带 audited 字段");

/* [2] 作业页：旁听不进分组计数，另起「旁听作业」一节 */
const page = read("apps/desktop/src/pages/learn/AssignmentsPage.tsx");
assert.ok(/!ignored\.has\(h\.id\) && !h\.audited/.test(page),
  "正式分组必须排除旁听（不计入页签计数与「全部」）");
assert.ok(/const auditAll = useMemo/.test(page) && /const auditList = useMemo/.test(page),
  "必须有旁听作业全集与按当前分组口径的旁听列表");
assert.ok(/<SectionHead title="旁听作业" \/>/.test(page), "旁听作业必须单列一节（SectionHead「旁听作业」）");
assert.ok(/filter === "unfinished"\) return auditAll\.filter\(\(h\) => !h\.submitted && !isOverdue\(h\)\)/.test(page),
  "「进行中」分组下的旁听节必须同样按未交未逾期筛选（旁听仍列为未完成）");
assert.ok(/if \(filter === "ignored"\) return \[\];/.test(page), "「已忽略」分组不重复列旁听");

/* [3] 首页：未交作业总数与作业区都不含旁听 */
const home = read("apps/desktop/src/components/HomeWidgets.tsx");
assert.ok(/!ignored\.has\(h\.id\) && !h\.audited\)\.length/.test(home),
  "首页「未交作业」计数必须排除旁听");
// 三处：概览「未交作业」计数、概览未交列表（三日内截止来源）、作业区行列表
const filtered = home.match(/\.filter\(\(h\) => !h\.submitted && !ignored\.has\(h\.id\) && !h\.audited\)/g) || [];
assert.equal(filtered.length, 3, "首页三处未交口径（计数 + 概览列表 + 作业区行）都必须排除旁听");

/* [4] 所有「正式课程」聚合点都要排除旁听（与 R21c 忽略同一张清单） */
const AGGREGATORS = [
  ["apps/desktop/src/pages/Learn.tsx", /!ignored\.has\(h\.id\) && !h\.audited/, "网络学堂首页未交总数"],
  ["apps/desktop/src/pages/Learn.tsx", /ignored\.has\(h\.id\) \|\| h\.audited\) continue/, "课程卡片未交计数"],
  ["apps/desktop/src/pages/learn/AssignmentsPage.tsx", /!ignored\.has\(h\.id\) && !h\.audited/, "全部作业分组"],
  ["apps/desktop/src/pages/learn/CourseDetailPage.tsx", /!ignored\.has\(h\.id\) && !h\.audited/, "课程页作业栏"],
  ["apps/desktop/src/pages/learn/CourseDetailPage.tsx", /assignments: homework\.filter\(\(h\) => !ignored\.has\(h\.id\) && !h\.audited\)\.length/, "课程页作业计数"],
  ["apps/desktop/src/components/HomeWidgets.tsx", /!ignored\.has\(h\.id\) && !h\.audited/, "首页小组件未交"],
  ["apps/desktop/src/state/notifyInputs.ts", /filter\(\(h\) => !h\.audited\)/, "提醒计划"],
  ["apps/desktop/src/pages/Schedule.tsx", /!ignoredIds\.has\(h\.id\) && !h\.audited/, "日程 DDL 入格"],
];
for (const [path, re, label] of AGGREGATORS) {
  assert.ok(re.test(read(path)), `聚合点「${label}」必须排除旁听（${path}）`);
}

console.log("旁听作业护栏：全部断言通过（role=6 透出 + 不计入总数 + 单列一节 + 首页不混排）");
