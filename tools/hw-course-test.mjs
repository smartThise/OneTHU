/**
 * 课程清单聚合护栏（2026-09-25 用户实录：雨课堂作业没有进「课程」清单）。
 *
 * 旧写法从课程表（data.courses）取候选，而外部作业源的 courseId 是合成值 ext:<source>，
 * 不在课程表里 → 整个源被漏掉。这里钉住新口径：
 *   [1] 网络学堂按 courseId 归组，课名取课程表，缺课名兜底「课程」
 *   [2] 雨课堂同源多课按真实课名分开（不能撞成一个 id）
 *   [3] 雨课堂缺 courseName 时兜底为源展示名「雨课堂」
 *   [4] 计数与排序：网络学堂在前、外部源在后
 */
import assert from "node:assert/strict";
import { hwCourseGroups, hwCourseKey, hwCourseLabel } from "../apps/desktop/src/lib/hwCourse.ts";

const HW = (o) => ({ id: "x", courseId: "", title: "", content: "", publishTime: "", deadline: "", submitted: false, graded: false, ...o });
const map = new Map([["c1", "程序设计基础"], ["c2", "迈向通用的人工智能"]]);
/** 生产环境传的是 state/exthw 的 extHwSourceName；测试里给同语义的假实现 */
const srcName = (s) => (s === "yuketang" ? "雨课堂" : s);

/* [1] 网络学堂 */
const learn = [HW({ courseId: "c1" }), HW({ courseId: "c1" }), HW({ courseId: "c9" })];
const g1 = hwCourseGroups(learn, map, srcName);
assert.deepEqual(g1.map((g) => [g.label, g.count, g.source ?? null]), [["程序设计基础", 2, null], ["课程", 1, null]]);
assert.equal(hwCourseKey(learn[0]), "learn::c1");

/* [2] 雨课堂：同 courseId（合成值）多门课必须分开 */
const ykt = [
  HW({ courseId: "ext:yuketang", source: "yuketang", courseName: "数据结构" }),
  HW({ courseId: "ext:yuketang", source: "yuketang", courseName: "大学物理" }),
  HW({ courseId: "ext:yuketang", source: "yuketang", courseName: "数据结构" }),
];
const g2 = hwCourseGroups(ykt, map, srcName);
assert.equal(g2.length, 2, "雨课堂同源不同课不能撞成一个分组");
assert.deepEqual(g2.map((g) => [g.label, g.count, g.source]), [["大学物理", 1, "yuketang"], ["数据结构", 2, "yuketang"]]);
assert.notEqual(hwCourseKey(ykt[0]), hwCourseKey(ykt[1]), "不同课名必须不同 key");
assert.ok(g2.every((g) => g.label.indexOf("yuketang") < 0), "不应把源 id 当课名展示");

/* [3] 缺 courseName → 源展示名兜底 */
const g3 = hwCourseGroups([HW({ courseId: "ext:yuketang", source: "yuketang" })], map, srcName);
assert.equal(g3[0].label, "雨课堂");

/* [4] 混合排序：网络学堂在前 */
const g4 = hwCourseGroups([...ykt, ...learn], map, srcName);
assert.deepEqual(g4.map((g) => g.label), ["程序设计基础", "课程", "大学物理", "数据结构"]);

/* [5] 与课程表解耦：课程表为空也必须能列出雨课堂 */
const g5 = hwCourseGroups([HW({ courseId: "ext:yuketang", source: "yuketang", courseName: "数据结构" })], new Map(), srcName);
assert.deepEqual(g5.map((g) => g.label), ["数据结构"]);
assert.equal(hwCourseLabel(HW({ courseId: "ext:yuketang", source: "yuketang", courseName: "  " }), new Map(), srcName), "雨课堂");

console.log("课程清单聚合：全部通过 ✓（网络学堂按 courseId、雨课堂按真实课名分组；空课程表也能列出外部源）");