#!/usr/bin/env node
/**
 * 白板文档（P0 数据层）护栏。方案：docs/原子收藏-可行性与实现方案.md §3 / §6.1。
 *
 * 盯住四件事：
 *   ① 解析必须严：损坏 / 版本不符 / 单元格非法 / 活动板不存在 → 一律回落 null；
 *   ② 迁移必须**读真实存储的布局**（按朝向各一份），不能拿默认布局顶包，否则抹掉用户自定义；
 *   ③ 迁移幂等：文档已在则原样返回，不重复迁移；
 *   ④ 渲染适配往返：layout → cells → layout 保序保栏位，并把注册表里不在板上的卡补成 off。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-model-test.mjs ｜ 0 通过 / 1 违规
 */
import { readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const src = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8") + readFileSync("apps/desktop/src/state/board.ts", "utf8");
const B = await import("../apps/desktop/src/state/boardCore.ts");

const HOME_IDS = ["homework", "balance-strip", "notices"];
const DEFAULT_ITEMS = HOME_IDS.map((id) => ({ id, col: "off", collapsed: false }));
const PORTRAIT = [
  { id: "homework", col: "main", collapsed: true },
  { id: "balance-strip", col: "rail", collapsed: false },
];

const mem = new Map();
const storage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, v); },
};
let portraitStore = PORTRAIT;
const savedOrders = [];
const deps = {
  knownIds: HOME_IDS,
  loadLayoutItems: (o) => (o === "portrait" ? portraitStore : null),
  resolveLayout: (saved) => (saved && saved.length ? saved : DEFAULT_ITEMS),
  loadOrder: () => ({ mode: "auto", edited: false, order: ["homework"] }),
  saveOrder: (s) => { savedOrders.push(s); },
  storage,
};

/* ① 解析严格性 */
ok(B.parseBoard(null) === null, "parseBoard(null) 必须回落 null");
ok(B.parseBoard("not json") === null, "parseBoard 对非 JSON 必须回落 null");
ok(B.parseBoard(JSON.stringify({ v: 2, boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [] } }], activeBoardId: "b", order: {} })) === null, "版本不符（v=2）必须回落 null");
ok(B.parseBoard(JSON.stringify({ v: 1, boards: [], activeBoardId: "x", order: {} })) === null, "空 boards 必须回落 null");
const badCell = JSON.stringify({ v: 1, boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 0, h: 1 } }] } }], activeBoardId: "b", order: {} });
ok(B.parseBoard(badCell) === null, "单元格 w=0 非法，必须回落 null");
const badActive = JSON.stringify({ v: 1, boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [] } }], activeBoardId: "zzz", order: {} });
ok(B.parseBoard(badActive) === null, "activeBoardId 指向不存在的板，必须回落 null");

/* ② 迁移读真实布局 */
mem.clear();
const doc = B.loadBoard(deps);
const sys = B.systemBoard(doc);
ok(!!sys, "迁移后必须存在一块系统板");
const cells = B.cellsOf(sys, "portrait");
const hw = cells.find((c) => c.spec.kind === "custom" && c.spec.id === "homework");
const bal = cells.find((c) => c.spec.kind === "custom" && c.spec.id === "balance-strip");
ok(!!hw && hw.collapsed === true, "迁移必须保留用户存的折叠态（homework collapsed=true）");
ok(!!hw && hw.cell.x === 0 && hw.cell.w === 3, "main 栏卡应落在基准单位 0..3（宽 3）");
ok(!!bal && bal.cell.x === 3 && bal.cell.w === 1, "rail 栏卡应落在基准单位 3..4（宽 1）");
ok(!!mem.get(B.BOARD_KEY), "迁移结果必须落盘（后续以文档为准）");

/* ③ 幂等 */
portraitStore = [{ id: "notices", col: "main", collapsed: false }];
const again = B.loadBoard(deps);
const againIds = B.cellsOf(B.systemBoard(again), "portrait").filter((c) => c.spec.kind === "custom").map((c) => c.spec.id);
ok(againIds.includes("homework") && !againIds.includes("notices"), "二次 loadBoard 不得重新迁移（文档已在即原样返回）");

/* ④ 往返适配 */
const back = B.cellsToLayout(B.layoutToCells(PORTRAIT), HOME_IDS);
const inMain = back.filter((i) => i.col === "main").map((i) => i.id);
const inRail = back.filter((i) => i.col === "rail").map((i) => i.id);
const off = back.filter((i) => i.col === "off").map((i) => i.id);
ok(inMain.join(",") === "homework" && inRail.join(",") === "balance-strip", "往返后栏位与序必须保持");
ok(off.join(",") === "notices", "注册表里不在板上的卡应补成 off，且不混入板上卡");
ok(back.filter((i) => i.id === "homework")[0].collapsed === true, "往返后折叠态必须保持");

/* ⑤ 跨朝向回落 */
const onlyPortrait = { id: "u", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 1, h: 1 } }] } };
ok(B.cellsOf(onlyPortrait, "landscape").length === 1, "只定义 portrait 的板在 landscape 下必须回落（§6.1）");

/* ⑥ 落盘与排序 */
B.saveBoard(doc, deps);
ok(savedOrders.length > 0, "saveBoard 必须同时把排序模式交回应用侧持久化");

/* ⑦ 源码层 */
for (const kind of ["atom-link", "nav", "card", "text", "divider", "custom"]) {
  ok(new RegExp('kind: "' + kind + '"').test(src), "WidgetSpec 缺少 kind: " + kind);
}
ok(/deps\.resolveLayout\(deps\.loadLayoutItems\(o\)\)/.test(src), "迁移没有读真实布局（loadLayoutItems）——会抹掉用户自定义");

/* ⑧ 首页接线（P0 下半单元）：持久化只走白板文档，不得再直接读写旧的布局/排序存储。
   2026-10-15：旧「今日页」已删，断言改指新首页的两半（自由画布 + 它的 px 层模块）。 */
const fb = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8") + readFileSync("apps/desktop/src/state/freeBoard.ts", "utf8");
ok(/boardItemsOf\(|freeBoardSnapshot\(|cellsOf\(/.test(fb), "新首页没有从白板文档取状态");
ok(/withRect\(|rectOf\(/.test(fb), "新首页布局没有由 px 层/文档派生");
ok(/saveBoard\(|persistFreeBoard\(|withRect\(/.test(fb), "新首页写回没有经过白板文档");
ok(!/saveLayout\(|loadLayout\(/.test(fb), "新首页仍在直接读写旧的布局存储（P0 后应只走白板文档）");
ok(!/saveHomeOrder\(|loadHomeOrder\(/.test(fb), "新首页仍在直接读写旧的排序存储（P0 后应只走白板文档）");

/* ⑨ px 自由图层字段（2026-10-15）：BoardItem 增加**可选** rect —— 一块板一份数据，
   格（cell）保持原样当插件/OH 契约，px（rect）是自由画布的摆放；两者必须能双向迁移。 */
const cellOf = (x, y, w, h) => ({ x, y, w, h });
const CELLS = [
  cellOf(0, 0, 4, 1), cellOf(0, 0, 1, 8), cellOf(3, 0, 1, 1), cellOf(1, 2, 2, 3),
  cellOf(0, 12, 3, 2), cellOf(2, 5, 2, 1),
];
for (const c of CELLS) {
  const r = B.rectFromCell(c);
  const back = B.cellFromRect(r);
  ok(JSON.stringify(back) === JSON.stringify(c), "格→px→格 往返不相等：" + JSON.stringify(c) + " → " + JSON.stringify(r) + " → " + JSON.stringify(back));
  ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0, "迁移出的 px 矩形非法：" + JSON.stringify(r));
  ok(B.isRect(r), "rectFromCell 的结果必须通过 isRect（宽度下限）");
}
/* 迁移基准画布：4 个基准单位 + 两侧内边距正好铺满参考画布宽（多一列就出画布了）。 */
const full = B.rectFromCell(cellOf(0, 0, B.BOARD_COLS, 1));
ok(full.x === B.BOARD_PAD && full.x + full.w === B.CANVAS_REF_W - B.BOARD_PAD, "满宽条目应左右内边距对称铺满参考画布（实际 " + full.x + ".." + (full.x + full.w) + "，参考宽 " + B.CANVAS_REF_W + "）");
ok(B.CANVAS_REF_W === B.BOARD_PAD * 2 + B.TILE_W * B.BOARD_COLS + B.TILE_GAP * (B.BOARD_COLS - 1), "参考画布宽与瓦片宽/间距不自洽（改一边会静默错位）");
/* 网格不重叠 → 迁移出的 px 也不重叠（旧板的观感必须原样搬到自由画布上）。 */
const grid = [cellOf(0, 0, 3, 1), cellOf(3, 0, 1, 1), cellOf(0, 1, 4, 2)];
const rects = grid.map((c) => B.rectFromCell(c));
const hitRect = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
ok(!rects.some((a, i) => rects.some((b, j) => i !== j && hitRect(a, b))), "格不重叠但迁移出的 px 重叠了");
/* px → 格：越界必须夹回列内（宽不得越界），高度不得小于 1。 */
const wideCell = B.cellFromRect({ x: 0, y: 0, w: 9999, h: 9999 });
ok(wideCell.w === B.BOARD_COLS && wideCell.x === 0, "超宽矩形没有夹到列数内（实际 w=" + wideCell.w + " x=" + wideCell.x + "）");
const rightCell = B.cellFromRect({ x: 9999, y: 0, w: 200, h: 88 });
ok(rightCell.x === B.BOARD_COLS - rightCell.w, "右侧越界的矩形没有夹回画布内（实际 x=" + rightCell.x + "）");
ok(B.cellFromRect({ x: -50, y: -50, w: 200, h: 88 }).x === 0 && B.cellFromRect({ x: -50, y: -50, w: 200, h: 88 }).y === 0, "负坐标没有夹到 0");
const tiny = B.cellFromRect({ x: 0, y: 0, w: 1, h: 1 });
ok(tiny.w === 1 && tiny.h === 1, "小于一格的矩形应夹成 1x1（实际 " + tiny.w + "x" + tiny.h + "）");
/* 缺省即迁移：没存过 rect 的条目由格算出 px（只算不写），存过的原样返回。 */
const noRect = { id: "a", spec: { kind: "divider" }, cell: cellOf(0, 0, 2, 1) };
ok(JSON.stringify(B.rectOf(noRect)) === JSON.stringify(B.rectFromCell(noRect.cell)), "rectOf 没有对「没存过」的条目做格→px 迁移");
ok(B.rectOf(noRect) !== noRect.rect && noRect.rect === undefined, "rectOf 不该写回条目（迁移是只读的）");
const stored = { id: "b", spec: { kind: "divider" }, cell: cellOf(0, 0, 2, 1), rect: { x: 40, y: 44, w: 222, h: 96 } };
ok(JSON.stringify(B.rectOf(stored)) === JSON.stringify(stored.rect), "rectOf 应优先用存过的 px 矩形（用户的摆放不能被格覆盖）");
/* 写回：rect 记 px，cell 同步派生，并打 manual（用户自由摆过的条目不再被自动拟合改回去）。 */
const written = B.withRect(noRect, { x: 40.4, y: 44.6, w: 222.2, h: 96.8 }, B.BOARD_COLS);
ok(written.rect.x === 40 && written.rect.y === 45 && written.rect.w === 222 && written.rect.h === 97, "withRect 没有取整写入 px（实际 " + JSON.stringify(written.rect) + "）");
ok(B.isCell(written.cell) && written.cell.w >= 1 && written.cell.h >= 1, "withRect 没有同步派生合法 cell（插件/OH 契约读的是它）");
ok(written.manual === true, "自由摆放没有打 manual 标记");
const shrunk = B.withRect(noRect, { x: 0, y: 0, w: 10, h: 10 });
ok(shrunk.rect.w === B.RECT_MIN_W && shrunk.rect.h === B.RECT_MIN_H, "withRect 没有夹到 px 缩放下限（实际 " + shrunk.rect.w + "x" + shrunk.rect.h + "）");
ok(JSON.stringify(B.cellFromRect(B.rectOf(written))) === JSON.stringify(written.cell), "写回后 cell 与 rect 仍不同源（应互为派生）");
/* 解析容错：坏 rect 只回落成「没存过」，不可牵连整份文档；cell 仍严格。 */
const docRect = (rect) => JSON.stringify({ v: 1, order: {}, activeBoardId: "b", boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 2, h: 1 }, rect }] } }] });
for (const bad of [{ x: 0, y: 0, w: 0, h: 88 }, { x: "3", y: 0, w: 200, h: 88 }, { x: 0, y: 0, w: Number.NaN, h: 88 }, { x: 0, y: 0, w: 200 }, { x: 0, y: 0, w: -200, h: 88 }]) {
  const parsed = B.parseBoard(docRect(bad));
  ok(!!parsed, "坏 rect 让整份文档回落 null（应只丢这个派生字段）：" + JSON.stringify(bad));
  ok(parsed && parsed.boards[0].cells.portrait[0].rect === undefined, "坏 rect 没有被丢掉：" + JSON.stringify(bad));
}
const goodParsed = B.parseBoard(docRect({ x: 8, y: 0, w: 200, h: 88 }));
ok(goodParsed && JSON.stringify(goodParsed.boards[0].cells.portrait[0].rect) === JSON.stringify({ x: 8, y: 0, w: 200, h: 88 }), "合法 rect 必须原样保留（解析不能顺手改用户的摆放）");
ok(goodParsed && goodParsed.boards[0].cells.portrait[0].cell.w === 2, "清理派生字段时动到了 cell");
/* 透明度 / 折叠态：自由层的两个附加字段也要能存读。 */
const extra = B.parseBoard(JSON.stringify({ v: 1, order: {}, activeBoardId: "b", boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 2, h: 1 }, rect: { x: 8, y: 0, w: 200, h: 88 }, folded: true, opacity: 0.5 }] } }] }));
ok(!!extra && extra.boards[0].cells.portrait[0].folded === true && extra.boards[0].cells.portrait[0].opacity === 0.5, "自由层的折叠/透明度字段没有存读");
const clamped = B.parseBoard(JSON.stringify({ v: 1, order: {}, activeBoardId: "b", boards: [{ id: "b", name: "n", icon: "i", kind: "user", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 2, h: 1 }, opacity: 9 }] } }] }));
ok(!!clamped && clamped.boards[0].cells.portrait[0].opacity === 1, "透明度没有夹到 0.25~1（实际 " + (clamped && clamped.boards[0].cells.portrait[0].opacity) + "）");

/* ⑩ 自由层（px）条目操作：拖动/缩放/图层/折叠/透明度都必须是纯函数且「没变就返回 null」，
   视图只负责把手势换算成这些调用（BoardPage 退役后这是唯一的编辑面）。 */
const px = (id, x, y, w, h, extra) => Object.assign({ id, spec: { kind: "custom", id }, cell: { x: 0, y: 0, w: 1, h: 1 }, rect: { x, y, w, h } }, extra ?? {});
const list = [px("a", 10, 20, 200, 100), px("b", 300, 20, 200, 100), px("c", 10, 400, 200, 100)];
const rectsOf = (arr) => arr.map((it) => B.toPxItem(it)).map((p) => p.x + "," + p.y + "," + p.w + "," + p.h).join("|");
/* 移动：写入 px 且同步派生 cell；x/y 为负 → 夹到 0（画布外看不见）；无变化 → null。 */
const moved = B.movePx(list, "a", 44.6, -30);
ok(!!moved && moved[0].rect.x === 45 && moved[0].rect.y === 0, "movePx 没有取整/夹正（实际 " + (moved && JSON.stringify(moved[0].rect)) + "）");
ok(!!moved && moved[0].cell.x >= 0 && moved[0].cell.x + moved[0].cell.w <= B.BOARD_COLS, "movePx 派生出的 cell 越界了");
ok(B.movePx(list, "a", 10, 20) === null, "movePx 对「原地不动」应返回 null（否则每帧都写盘）");
ok(B.movePx(list, "nope", 1, 1) === null, "movePx 对不存在的条目应返回 null");
ok(list[0].rect.x === 10, "movePx 改动了入参（应为不可变）");
/* 缩放：宽高夹到 120×64；只改几何。 */
const resized = B.resizePx(list, "b", { x: 300, y: 20, w: 4, h: 4 });
ok(!!resized && resized[1].rect.w === B.RECT_MIN_W && resized[1].rect.h === B.RECT_MIN_H, "resizePx 没有夹到缩放下限");
ok(B.resizePx(list, "b", { x: 300, y: 20, w: 200, h: 100 }) === null, "resizePx 对「尺寸没变」应返回 null");
/* 折叠 / 透明度：显示态，来回可逆，重复操作返回 null。 */
const folded = B.foldPx(list, "a", true);
ok(!!folded && folded[0].folded === true && B.foldPx(folded, "a", true) === null, "foldPx 没有生效或重复调用不是 null");
const unfolded = B.foldPx(folded, "a", false);
ok(!!unfolded && unfolded[0].folded === undefined && B.foldPx(unfolded, "a", false) === null, "foldPx(false) 没有清掉折叠态（或重复调用不是 null）");
const dim = B.opacityPx(list, "a", 0.5);
ok(!!dim && dim[0].opacity === 0.5 && B.opacityPx(dim, "a", 0.5) === null, "opacityPx 没有生效或不是幂等 null");
ok(!!B.opacityPx(list, "a", 9) && B.opacityPx(list, "a", 9)[0].opacity === 1, "opacityPx 没有夹到 1");
/* 删除 / 置顶 / 智能置顶 */
ok(B.removePx(list, "c").length === 2 && B.removePx(list, "nope") === null, "removePx 的删除/未命中语义不对");
const front = B.bringToFrontPx(list, "a");
ok(!!front && front.map((x) => x.id).join(",") === "b,c,a", "bringToFrontPx 没有挪到最上层（数组序 = 图层序）");
ok(B.bringToFrontPx(list, "c") === null, "已在最上层还置顶应返回 null");
/* 智能置顶：只升到「与自己重叠的那一簇」之上，无关组件序不动（霖 2026-10-13 定案）。 */
const cluster = [px("a", 0, 0, 200, 100), px("far", 900, 900, 200, 100), px("b", 50, 0, 200, 100), px("c", 100, 0, 200, 100)];
const raised = B.raiseAboveOverlappingPx(cluster, "a");
ok(!!raised && raised.map((x) => x.id).join(",") === "far,b,c,a", "智能置顶没有只升到重叠簇之上（实际 " + (raised && raised.map((x) => x.id).join(",")) + "）");
ok(B.raiseAboveOverlappingPx(cluster, "far") === null, "没有重叠时智能置顶不该动（应返回 null）");
/* 追加：rect 与 cell 同源（插件/OH 契约读 cell）。 */
const appended = B.appendPx(list, "z", { kind: "custom", id: "note" }, { x: 60, y: 44, w: 220, h: 160 });
ok(appended.length === 4 && appended[3].id === "z", "appendPx 没有追加到最后（最上层）");
ok(JSON.stringify(appended[3].cell) === JSON.stringify(B.cellFromRect(appended[3].rect)), "appendPx 的 cell 与 rect 不同源");
/* 旧键（onethu.freeboard.home.v1）兼容读：脏数据当没有，坐标一并夹正。 */
ok(B.parseLegacyFreeBoard(null).length === 0 && B.parseLegacyFreeBoard("not json").length === 0, "旧键解析：缺失/脏数据应得空表");
ok(B.parseLegacyFreeBoard(JSON.stringify({ v: 2, items: [{ id: "a", spec: { kind: "divider" }, x: 1, y: 1, w: 200, h: 100 }] })).length === 0, "旧键解析：版本不符应得空表");
const legacyItems = B.parseLegacyFreeBoard(JSON.stringify({ v: 1, items: [
  { id: "f.a", spec: { kind: "custom", id: "note" }, x: -40, y: 24, w: 12, h: 900, folded: true, opacity: 0.3 },
  { id: "f.b", spec: { kind: "divider" }, x: 300, y: 200 },
  { id: "", spec: { kind: "divider" }, x: 0, y: 0 },
  { nope: true },
] }));
ok(legacyItems.length === 2, "旧键解析：应只留下合法条目（实际 " + legacyItems.length + "）");
ok(legacyItems[0].x === 0 && legacyItems[0].y === 24 && legacyItems[0].w === B.RECT_MIN_W && legacyItems[0].h === 900, "旧键解析：负 x 应夹 0、过窄应夹下限（实际 " + JSON.stringify(legacyItems[0]) + "）");
ok(legacyItems[0].folded === true && legacyItems[0].opacity === 0.3, "旧键解析：折叠/透明度应保留");
ok(legacyItems[1].w === 240 && legacyItems[1].h === 120, "旧键解析：缺尺寸应回落历史默认值（240×120）");
/* 并入系统板：旧布局是首页画布的事实来源（放前面），同 spec 的网格条目让位；其余接在后面。 */
const gridDup = { id: "today.homework", spec: { kind: "custom", id: "note" }, cell: { x: 0, y: 0, w: 3, h: 1 } };
const gridStray = { id: "today.classes", spec: { kind: "custom", id: "classes" }, cell: { x: 0, y: 9, w: 3, h: 1 } };
const atomAdded = { id: "it.custom.ab12", spec: { kind: "atom-link", ref: "k" }, cell: { x: 0, y: 5, w: 2, h: 1 } };
const merged = B.mergeLegacyPx(legacyItems, [gridDup, gridStray, atomAdded]);
ok(merged.map((x) => x.id).join(",") === "f.a,f.b,it.custom.ab12", "并入顺序/去重不对（实际 " + merged.map((x) => x.id).join(",") + "）");
ok(!merged.some((x) => x.id.startsWith("today.")), "旧「今日」页的网格陈迹（today.*）不该混进首页画布——用户在自由画布删掉的卡片会复活");
ok(JSON.stringify(merged[0].rect) === JSON.stringify({ x: 0, y: 24, w: B.RECT_MIN_W, h: 900 }), "并入时没有保留旧 px 摆位");
ok(merged.every((it) => B.isItem(it)), "并入后的条目必须仍是合法板条目（cell 仍受严格校验）");
ok(merged.filter((it) => it.rect).every((it) => B.isRect(it.rect) && JSON.stringify(it.cell) === JSON.stringify(B.cellFromRect(it.rect))), "并入时写下的 rect 与派生的 cell 必须同源");
ok(!merged.find((x) => x.id === "it.custom.ab12").rect, "网格条目（收藏到首页落下的原子）不该被硬塞一个 px 矩形——它按格迁移即可");
const collide = B.mergeLegacyPx([{ id: "same", spec: { kind: "divider" }, x: 1, y: 1, w: 200, h: 100 }], [{ id: "same", spec: { kind: "custom", id: "folder" }, cell: { x: 0, y: 0, w: 1, h: 1 } }]);
ok(new Set(collide.map((x) => x.id)).size === collide.length, "并入时 id 撞车没有改名（后一条会被 React/查找逻辑吃掉）");

/* Workbench starter is only for new installations; migration must keep authored rectangles. */
const freshDeps = { ...deps, loadLayoutItems: () => null, resolveLayout: () =>
  Array.from({ length: 9 }, (_, i) => ({ id: "starter." + i, col: "main", collapsed: false })) };
const freshBoard = B.defaultBoardDoc(freshDeps).boards[0];
const freshRects = freshBoard.cells.portrait.map(x => x.rect);
/* 2026-10-19：首屏改成四列瀑布（版心 1104 / 4 列 → 单卡 264 宽），可读下限跟着版式走：
   240×110 仍能挡住「单格 90×88」那种迁移残渣，又不会把四列布局判死。 */
ok(freshRects.every(r => r && r.w >= 240 && r.h >= 110), "新板卡片必须有可读尺寸");
ok(Math.max(...freshRects.map(r => r.x + r.w)) <= 1120, "新首页不得超出版心");
ok(freshRects.every((a, i) => freshRects.every((b, j) => i === j || a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)), "新板初始卡片不重叠");
const preserved = B.defaultBoardDoc({ ...deps, loadLayoutItems: () => PORTRAIT });
ok(preserved.boards[0].cells.portrait.some(x => x.id === "today.homework" && x.collapsed), "旧布局保留原卡片和折叠状态");
ok(preserved.homeLayoutVersion === 2, "旧布局补齐可编辑 chrome 并记录迁移版本");

/* A note saved by the former outer-props path must remain recoverable. */
const brokenSavedNote = { id: "note-legacy", spec: { kind: "custom", id: "note", props: { tone: "yellow", text: "older" } }, props: { text: "saved draft", extra: true }, cell: { x: 0, y: 0, w: 2, h: 2 } };
ok(B.toPxItem(brokenSavedNote).spec.props.text === "saved draft", "旧便笺的外层 props 必须在渲染时恢复，不能丢掉已写内容");
const editedNote = B.propsPx([brokenSavedNote], "note-legacy", { text: "new draft" });
ok(editedNote[0].spec.props.text === "new draft" && editedNote[0].spec.props.tone === "yellow", "便笺更新写入 canonical spec.props 并保留纸色");
ok(B.toPxItem(editedNote[0]).spec.props.text === "new draft", "便笺写回后可立即渲染");
ok(brokenSavedNote.spec.props.text === "older", "便笺更新不得原地改旧数据");

if (fails.length) {
  console.error("白板文档护栏（P0）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("白板文档护栏（P0）：解析严格性 ✓ ｜ 迁移读真实布局并保位次/折叠 ✓ ｜ 幂等 ✓ ｜ 往返含 off ✓ ｜ 跨朝向回落 ✓ ｜ 落盘与排序 ✓ ｜ 规格齐全 ✓ ｜ 格↔px 双向迁移与容错 ✓ ｜ px 自由层操作（移动/缩放/图层/折叠/透明度/迁移并入）✓");
