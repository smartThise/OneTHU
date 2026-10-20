#!/usr/bin/env node
/**
 * 磁贴吸附护栏（2026-10-19）：移动/缩放时「边线共线」的行为。
 *
 * 盯四件事：
 *   ① 移动：左对左 / 上对上 / 右贴左 都能吸，超阈值不动；
 *   ② 缩放：只吸正在拖的那条边，对侧边固定；
 *   ③ 不把磁贴吸到画布外（视觉必须等于落库，withRect 会把负坐标夹回 0）；
 *   ④ 参考线只在真正共线时产出。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-snap-test.mjs ｜ 0 通过 / 1 违规
 */
const S = await import("../apps/desktop/src/state/boardSnap.ts");

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const r = (x, y, w, h) => ({ x, y, w, h });

/* 两块参照磁贴：x 边线 100/300 与 400/560，y 边线 100/220 与 300/380 */
const others = [r(100, 100, 200, 120), r(400, 300, 160, 80)];

/* ① 移动：左上角同时吸到最近磁贴的左上角 */
let res = S.snapMove(r(104, 96, 200, 120), others);
ok(res.rect.x === 100 && res.rect.y === 100, "移动没有把左上边吸到最近磁贴的左上边（实际 " + JSON.stringify(res.rect) + "）");
ok(res.rect.w === 200 && res.rect.h === 120, "移动吸附不该改尺寸");
ok(res.guides.some((g) => g.axis === "x" && g.pos === 100), "吸附后没有产出竖直参考线");
ok(res.guides.some((g) => g.axis === "y" && g.pos === 100), "吸附后没有产出水平参考线");

/* ② 右贴左（贴合摆放）也算同一条直线 */
res = S.snapMove(r(305, 100, 90, 120), others);
ok(res.rect.x === 300, "右边贴到别人的左边没有吸附（应为 x=300，实际 " + res.rect.x + "）");

/* ③ 超出吸附半径：不动、也不画线 */
res = S.snapMove(r(120, 130, 50, 50), others);
ok(res.rect.x === 120 && res.rect.y === 130, "超出吸附半径仍然移动了");
ok(res.guides.length === 0, "没吸附却画了参考线");

/* ④ 吸附不能把磁贴推到画布外（否则落库会被夹回去，视觉与数据不同源） */
res = S.snapMove(r(2, 100, 200, 120), [r(-6, 100, 200, 120)]);
ok(res.rect.x === 2, "吸附把 x 推到了负坐标（落库会被 withRect 夹回 0）");

/* ⑤ 东把手：只改宽，右边吸到别人的右边 */
res = S.snapResize(r(100, 100, 197, 120), others, "e");
ok(res.rect.w === 200, "东边把手没有吸到别人右边（w=" + res.rect.w + "）");
ok(res.rect.x === 100 && res.rect.h === 120, "东边缩放不该动 x/h");

/* ⑥ 西把手：左边吸过去，右边保持不动 */
res = S.snapResize(r(104, 100, 196, 120), others, "w");
ok(res.rect.x === 100 && res.rect.w === 200, "西边把手没有保持右边固定（实际 " + JSON.stringify(res.rect) + "）");

/* ⑦ 南 / 北把手 */
res = S.snapResize(r(100, 300, 200, 76), others, "s");
ok(res.rect.h === 80, "南边把手没有吸到下边（h=" + res.rect.h + "）");
res = S.snapResize(r(100, 304, 200, 76), others, "n");
ok(res.rect.y === 300 && res.rect.h === 80, "北边把手没有保持下边固定（实际 " + JSON.stringify(res.rect) + "）");

/* ⑧ 角把手两条边各自吸；大小下限优先于吸附 */
res = S.snapResize(r(104, 96, 200, 220), others, "nw");
ok(res.rect.x === 100 && res.rect.y === 100, "角把手没有同时吸两条边");
res = S.snapResize(r(100, 100, 197, 120), others, "e", { minW: 240 });
ok(res.rect.w >= 240 && res.rect.x + res.rect.w !== 300, "缩放下限被吸附绕过");

/* ⑨ 空板 / 无参照：原样返回 */
res = S.snapMove(r(10, 20, 30, 40), []);
ok(res.rect.x === 10 && res.rect.y === 20 && res.guides.length === 0, "空板上移动应原样返回");

if (fails.length) {
  for (const f of fails) console.error("✗ " + f);
  process.exit(1);
}
console.log("board snap: 12 assertions passed");
