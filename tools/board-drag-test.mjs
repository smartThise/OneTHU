#!/usr/bin/env node
/**
 * 自由画布交互护栏（px 层，2026-10-15 重写）。
 *
 * 前身是「白板拖拽几何（P1）」：那套几何（指针→格、落点虚影、吸附去抖、边缘滚动、四边把手）
 * 是 4/8 列网格 BoardPage 的东西，随之退役 —— `state/boardDrag.ts` 已删。
 * 现在白板只有一种交互面：**自由画布**（components/FreeBoard.tsx，px 绝对定位、允许重叠、
 * 常态直接拖），所以本文件盯三件事：
 *   ① px 拖动/缩放的**数据结果**（纯函数在 boardCore，node 直接驱动）；
 *   ② 画布接线的静态判据（阈值 / 长按出菜单 / 落库 / 取消 / 监听器卫生 / CSS 不能吃掉手势）；
 *   ③ 网格契约还在的那条线（boardReflow 让位 + boardEdit 落库——插件/OH 的 ext.onePage
 *      与「收藏到首页/OnePage」都走它，px 层写 rect 时同步派生 cell 就是为了它）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-drag-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const B = await import("../apps/desktop/src/state/boardCore.ts");
const R = await import("../apps/desktop/src/state/boardReflow.ts");
const E = await import("../apps/desktop/src/state/boardEdit.ts");
const page = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8");
const cssFree = readFileSync("apps/desktop/src/styles/explorer-home.css", "utf8");
const css = readFileSync("apps/desktop/src/styles/global.css", "utf8");

const item = (id, x, y, w, h) => ({ id, spec: { kind: "custom", id }, cell: { x, y, w, h } });
const docOf = (items) => ({
  v: 1, order: {}, activeBoardId: "b1",
  boards: [{ id: "b1", name: "板", icon: "today", kind: "system", cells: { portrait: items } }],
});
const px = (id, x, y, w, h) => Object.assign(item(id, 0, 0, 1, 1), { rect: { x, y, w, h } });

/* ① px 拖动：落在指针处、越界夹正、原地不动不写盘（返回 null） */
const list = [px("a", 30, 40, 200, 120), px("b", 300, 40, 200, 120)];
const moved = B.movePx(list, "a", 111.4, -20);
ok(!!moved && moved[0].rect.x === 111 && moved[0].rect.y === 0, "movePx 没有取整落点 / 没把负坐标夹到 0（实际 " + JSON.stringify(moved && moved[0].rect) + "）");
ok(!!moved && JSON.stringify(moved[0].cell) === JSON.stringify(B.cellFromRect(moved[0].rect)), "movePx 没有同步派生 cell（插件/OH 契约会与画布不同源）");
ok(B.movePx(list, "a", 30, 40) === null, "movePx 对「原地不动」应返回 null（否则每帧写盘）");
ok(B.movePx(list, "nope", 1, 1) === null, "movePx 对不存在的条目应返回 null");
ok(list[0].rect.x === 30, "movePx 改动了入参（应不可变）");
/* 拖动不许把组件放到画布外：x/y 夹正这一条是「东西不见了」的挡板（Lead 复核点） */
ok(B.withRect(item("c", 0, 0, 1, 1), { x: -50, y: -30, w: 10, h: 10 }).rect.x === 0, "withRect 没夹住负 x（条目会落在画布外看不见）");
ok(B.withRect(item("c", 0, 0, 1, 1), { x: -50, y: -30, w: 10, h: 10 }).rect.y === 0, "withRect 没夹住负 y");

/* ② px 缩放：宽高夹到 120×64，位置夹正 */
const resized = B.resizePx(list, "b", { x: 300, y: 40, w: 1, h: 1 });
ok(!!resized && resized[1].rect.w === B.RECT_MIN_W && resized[1].rect.h === B.RECT_MIN_H, "resizePx 没有夹到缩放下限（1px 条目会拖不回来）");
ok(B.resizePx(list, "b", { x: 300, y: 40, w: 200, h: 120 }) === null, "resizePx 对「尺寸没变」应返回 null");

/* ③ 长按 / 右键出菜单（两路必须同一个菜单，否则手机上没入口） */
ok(/LONG_PRESS_MS = 500/.test(page), "长按阈值与全站口径不一致（ContextMenu 是 500）");
/* 2026-10-18：长按回调里先让位给暂存箱拖拽（gestureOwner === "vault-drag" 直接返回），
   但「长按 → 同一个 openItemMenu」这条不变量不变。 */
ok(/window\.setTimeout\(\(\) => \{[\s\S]{0,160}longFired = true;[\s\S]{0,80}openItemMenu\(it, sx, sy\);/.test(page), "长按没有出快捷菜单");
ok(/if \(longFired\) menu\.close\(\);/.test(page), "位移超过阈值后没有收回长按菜单（会边拖边挂着菜单）");
ok(/onContextMenu=\{\(e\) => \{[\s\S]{0,400}openItemMenu\(it, e\.clientX, e\.clientY\)/.test(page), "右键没有走同一个条目菜单");

/* ④ 落库与取消：松手才写、取消也要收尾（手势被打断不能卡在拖拽态） */
ok(/const r = clampRect\(cur\.rect\);/.test(page), "松手落库前没有夹取（视觉与落库会不一致）");
ok(/if \(mode === "move"\) ops\.move\(id, r\.x, r\.y\);/.test(page), "松手没有落库移动结果（位置会丢）");
ok(/else ops\.resize\(id, r\);/.test(page), "缩放松手没有落库（尺寸会丢）");
ok(/window\.addEventListener\("pointercancel", onUp\)/.test(page) && /window\.removeEventListener\("pointercancel", onUp\)/.test(page), "缺少指针取消处理（来电/手势打断后会卡在拖拽态）");
ok(/const orig: Rect = \{ x: it\.x, y: it\.y, w: it\.w, h: it\.h \}/.test(page), "拖动基线没有取按下那一刻的矩形（跟手会漂）");
ok(/if \(it\.pinned && mode === "move"\)/.test(page), "固定的组件仍能拖动（位置锁定失效）");

/* ④b Alt = 临时关闭吸附（2026-10-19）：按住时既不吸、也不画参考线 */
ok(/const free = ev\.altKey;/.test(page), "Alt 键没有接进拖动管线（按住 Alt 仍会被吸住）");
ok(/free \? \{ rect: raw, guides: \[\] as SnapGuide\[\] \} : snapMove/.test(page), "移动时 Alt 没有走「不吸附」分支");
ok(/free\s*\? \{ rect: box, guides: \[\] as SnapGuide\[\] \}\s*: snapResize/.test(page), "缩放时 Alt 没有走「不吸附」分支");

/* ⑤ 监听器卫生：注册了就必须按**同名同 capture** 移除（写错会永久泄漏、接管全应用指针事件） */
const adds = [...page.matchAll(/addEventListener\("(\w+)", (\w+)(, true)?\)/g)].map((m) => m[2] + "|" + String(!!m[3]));
const removes = [...page.matchAll(/removeEventListener\("(\w+)", (\w+)(, true)?\)/g)].map((m) => m[2] + "|" + String(!!m[3]));
const leak = adds.filter((a) => !removes.includes(a));
ok(leak.length === 0, "有全局监听注册了却没按同样 capture 移除（会泄漏并接管全应用事件）：" + leak.join(", "));

/* ⑥ CSS 不能吃掉手势：条目必须是 touch-action: none（否则拖动被浏览器当滚动接管） */
ok(/\.free-item \{[\s\S]{0,400}touch-action: none/.test(cssFree), "自由条目没有 touch-action: none——垂直拖动会被浏览器当滚动");
ok(/\.free-handle \{[\s\S]{0,200}position: absolute/.test(cssFree), "缩放把手没有绝对定位样式");
ok(/\.free-item\.is-live \.free-handle \{ opacity: 1; \}/.test(cssFree), "拖动中把手不显形（抓不到缩放点）");
ok(/\.freeboard \{[\s\S]{0,200}position: absolute/.test(cssFree), "首页自由画布不是满幅绝对层（固定层与画布的 z 序会乱）");
ok(/\.freeboard\.is-page \{[\s\S]{0,120}position: relative/.test(cssFree), "OnePage 形态的画布没有脱离满幅层（页面里会盖住页头）");
ok(/\.freeboard \{\s*background: transparent/.test(css.replace(/\n/g, "\n").replace(/[\r]/g, "")) || /\.freeboard \{[\s\S]{0,120}background: transparent/.test(css), "自由画布被画上了框/底色（用户点名：画布无框）");

/* ⑦ 网格契约仍在的那条线：让位与落库同源、重叠不变量、基准列空间 */
const tall = [item("tall", 0, 4, 4, 8), item("up1", 0, 0, 4, 2), item("up2", 0, 2, 4, 2), item("down1", 0, 12, 4, 1)];
const r1 = R.reflowForMove(tall, "tall", { x: 0, y: 3 });
ok(r1.find((x) => x.id === "tall").cell.y === 3, "让位后被移项没有落在目标格");
ok(r1.find((x) => x.id === "down1").cell.y === 12, "落点下方的条目被波及（让位不该动无关项）");
const overlaps = (arr) => arr.some((a, i) => arr.some((b, j) => i !== j && a.cell.x < b.cell.x + b.cell.w && b.cell.x < a.cell.x + a.cell.w && a.cell.y < b.cell.y + b.cell.h && b.cell.y < a.cell.y + a.cell.h));
/* 让位本身**允许**留下瞬时重叠（位移模型只平移、不重排）；真正的不变量在写入口。
   注意这段自此往下驱动的是**生产路径**（boardCore.saveBoard / loadBoard —— 应用侧
   state/board.ts 的 saveBoard 就是它的包装，插件/OH 的 ext.onePage* 直写 cell 也落在它上面）。
   上一版守栏在这里给自己背书：只证明了 ensureNoOverlap「能拆」，没证明生产里有人**调**
   （oh-wire 反例①）。所以这里必须走真漏斗、断言落库结果。 */
ok(overlaps(r1), "fixture 前提变了：reflowForMove 现在不留重叠？（那这组用例的前提要重写）");
const mem = new Map();
const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, v); } };
const deps = { knownIds: [], loadLayoutItems: () => null, resolveLayout: () => [], loadOrder: () => ({}), saveOrder: () => {}, storage };
const overlapDoc = docOf([item("tall", 0, 3, 4, 8), item("up2", 0, 2, 4, 2)]);
ok(overlaps(overlapDoc.boards[0].cells.portrait), "写入口用例的输入本身必须是有重叠的（否则是空转断言）");
B.saveBoard(overlapDoc, deps);
const persisted = B.parseBoard(mem.get(B.BOARD_KEY));
ok(!!persisted && !overlaps(persisted.boards[0].cells.portrait), "重叠文档经**写入口**落库后仍然重叠（不变量没接上生产路径）");
/* 载入即修复一次：历史/手写脏数据不能永远叠着（策略见 boardCore 的注释） */
mem.set(B.BOARD_KEY, JSON.stringify(overlapDoc));
const loaded = B.loadBoard(deps);
ok(!overlaps(loaded.boards[0].cells.portrait), "载入带重叠的文档没有修复");
ok(!overlaps(B.parseBoard(mem.get(B.BOARD_KEY)).boards[0].cells.portrait), "载入修复没有落盘（下次进来又叠着）");
/* 自由画布的重叠是特性：不变量只拆 cell，绝不碰 rect（否则画布摆位会被"拆格子"挪走） */
const pxDoc = docOf([
  Object.assign(item("a", 0, 0, 4, 4), { rect: { x: 10, y: 10, w: 300, h: 300 } }),
  Object.assign(item("b", 0, 0, 4, 4), { rect: { x: 40, y: 40, w: 300, h: 300 } }),
]);
B.saveBoard(pxDoc, deps);
const keptPx = B.parseBoard(mem.get(B.BOARD_KEY)).boards[0].cells.portrait;
ok(keptPx[0].rect.x === 10 && keptPx[1].rect.x === 40 && keptPx[0].rect.y === 10, "写入口动了 rect —— 自由画布的摆位/重叠是特性，只能拆 cell");
/* 重构报警：漏斗必须在持久化那两个函数里（挪走就会红） */
const coreSrc = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8");
/* 漏斗必须在持久化那两个函数里（挪走就会红）。允许包一层前处理：2026-10-15 起
   两个出口都写成 `repairOverlaps(purgeGridResidue(…))` —— 先清网格残留再拆 cell 重叠。 */
ok(
  /export function repairOverlaps/.test(coreSrc) &&
    /const safe = repairOverlaps\(purgeGridResidue\(doc\)\)/.test(coreSrc) &&
    /const safe = repairOverlaps\(migrateHomeCanvas\(purgeGridResidue\(parsed\)\)\)/.test(coreSrc),
  "写入口（saveBoard / loadBoard）没有再接重叠不变量（期望 repairOverlaps(purgeGridResidue(…))）",
);
const docM = E.moveItem(docOf(tall), "b1", "portrait", "tall", { x: 0, y: 3 });
const cellsM = docM.boards[0].cells.portrait.map((c) => c.id + "@" + c.cell.x + "," + c.cell.y).sort().join("|");
const prevM = r1.map((c) => c.id + "@" + c.cell.x + "," + c.cell.y).sort().join("|");
ok(cellsM === prevM, "落库与让位预览不一致：\n  落库 " + cellsM + "\n  预览 " + prevM);
const messy = [item("a", 0, 0, 4, 4), item("b", 0, 2, 4, 4), item("c", 0, 6, 4, 4)];
const fixed = R.ensureNoOverlap(messy);
ok(!overlaps(fixed) && fixed[0].cell.y === 0, "ensureNoOverlap 没有拆开重叠（或动了最上面的项）");
ok(R.ensureNoOverlap(messy)[0].cell.y === 0 && messy[1].cell.y === 2, "ensureNoOverlap 不该改动入参（应为不可变）");
ok(/previewResize/.test(readFileSync("apps/desktop/src/state/boardReflow.ts", "utf8")), "缩放预览没有与落库共用同一套夹取");
ok(B.colsForWidth(400) === 4 && B.colsForWidth(1200) === 8 && B.colsForWidth(840) === 8, "colsForWidth 断点不对（840 起应为 8 列）");
ok(B.BOARD_COLS === 4 && B.BOARD_COLS_WIDE === 8, "列数常量不对（窄 4 / 宽 8）");
/* cell 是**契约空间**（基准 4 列）：BoardPage 退役后它只服务插件/OH，不随视口变 */
ok(B.cellFromRect({ x: 0, y: 0, w: 9999, h: 88 }).w === B.BOARD_COLS, "px→格 没有�� 4 列基准夹取（契约空间会随窗口漂）");

/* ⑧ 画布接线（渲染层）：data-item-id 稳定标记 + rect 优先 + OnePage 面 = 自由画布 */
ok(/data-item-id=\{it\.id\}/.test(page), "画布条目缺少稳定标记 data-item-id（测量与守栏都要用）");
ok(/rectOf\(item\)/.test(readFileSync("apps/desktop/src/state/boardCore.ts", "utf8")), "缺少「rect 优先、缺省由格迁移」的解析（用户摆位会被格覆盖）");
ok(/export function OnePageSurface/.test(page) && /<FreeBoard boardId=\{board\.id\}/.test(page), "OnePage 面没有渲染自由画布（页面壳与画布不是同一条线）");
ok(/activeBoard\(doc\)/.test(page), "OnePage 面没有取「当前板」（用户在列表里选的板打不开）");

if (fails.length) {
  console.error("自由画布交互护栏（px）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("自由画布交互护栏（px）：拖动落点/夹正/派生 cell ✓ ｜ 缩放下限 ✓ ｜ 长按与右键同菜单 ✓ ｜ 松手落库与取消 ✓ ｜ 监听器卫生 ✓ ｜ 手势 CSS ✓ ｜ 网格契约（让位/重叠/基准列）✓");
