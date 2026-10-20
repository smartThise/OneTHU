#!/usr/bin/env node
/**
 * 白板编辑操作（P1 纯逻辑）护栏。方案：docs/原子收藏-可行性与实现方案.md §6.2 / §6.3 / §6.6。
 *
 * 盯住五件事：
 *   ① 移动：落在**目标格**（不向上补齐）、越界 x 夹回列内、被压到的向下推、**不许残留重叠**；
 *   ② 缩放：夹到该组件的 sizeRange 与列宽内（宽不得越界）；
 *   ③ 删除 / 固定 / 属性：命中才改，未命中原样返回（引用相等，便于 React 判断无变化）；
 *   ④ 新增：去重、未知组件拒绝、找第一处空位；
 *   ⑤ 每次操作后板上都不得有重叠（这是「让位」的最终验收口径）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-edit-test.mjs ｜ 0 通过 / 1 违规
 */
import { readdirSync, readFileSync } from "node:fs";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const E = await import("../apps/desktop/src/state/boardEdit.ts");
const W = await import("../apps/desktop/src/state/widgetMeta.ts");

const item = (id, x, y, w, h) => ({ id, spec: { kind: "custom", id }, cell: { x, y, w, h } });
const docOf = (items) => ({
  v: 1, order: { mode: "auto", edited: false, order: [] }, activeBoardId: "b1",
  boards: [{ id: "b1", name: "板", icon: "today", kind: "system", cells: { portrait: items } }],
});
const itemsOf = (d) => d.boards[0].cells.portrait;
const ORI = "portrait";
const BID = "b1";

/* ① 移动 */
const d1 = docOf([item("a", 0, 0, 2, 1), item("b", 2, 0, 2, 1)]);
const m1 = E.moveItem(d1, BID, ORI, "a", { x: 2, y: 0 });
ok(!E.hasOverlap(itemsOf(m1)), "移动后出现重叠（a 压到 b 时 b 应向下推）");
ok(itemsOf(m1).find((x) => x.id === "a").cell.x === 2, "移动没有落在目标格");
ok(itemsOf(m1).find((x) => x.id === "b").cell.y === 1, "被压到的条目没有向下推");
const m2 = E.moveItem(d1, BID, ORI, "a", { x: 99, y: 51 });
ok(itemsOf(m2).find((x) => x.id === "a").cell.x === 2, "越界 x 没有夹回列内（宽 2 时应为 2）");
ok(itemsOf(m2).find((x) => x.id === "a").cell.y === 51, "y 不该被补齐或压缩（允许空任意多格）");
ok(E.moveItem(d1, BID, ORI, "nope", { x: 0, y: 0 }) === d1, "移动不存在的条目应原样返回");

/* ② 缩放 */
const d2 = docOf([item("a", 3, 0, 1, 1)]);
const r1 = E.resizeItem(d2, BID, ORI, "a", { w: 4, h: 5 }, W.PRESET_WIDGETS);
const sized = itemsOf(r1).find((x) => x.id === "a");
ok(sized.cell.w === 1, "缩放没有受列宽约束（x=3 时最多宽 1）");
/* 用例必须让条目**自己的 spec** 能查到目录（defForSpec 是按 spec 查的，不是按传入的 def 查）。 */
const d3 = docOf([{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 1, h: 1 } }]);
const r2 = E.resizeItem(d3, BID, ORI, "a", { w: 1, h: 9 }, W.PRESET_WIDGETS);
ok(itemsOf(r2).find((x) => x.id === "a").cell.h === 1, "缩放没有按 sizeRange 夹取（分隔线最高 1）");
ok(!E.hasOverlap(itemsOf(r2)), "缩放后出现重叠");

/* ③ 删除 / 固定 / 属性 */
const d4 = docOf([item("a", 0, 0, 2, 1), item("b", 2, 0, 2, 1)]);
ok(itemsOf(E.removeItem(d4, BID, ORI, "a")).length === 1, "删除没有生效");
ok(E.removeItem(d4, BID, ORI, "nope") === d4, "删除不存在的条目应原样返回");
ok(itemsOf(E.togglePin(d4, BID, ORI, "a")).find((x) => x.id === "a").pinned === true, "固定没有写入");
ok(itemsOf(E.togglePin(E.togglePin(d4, BID, ORI, "a"), BID, ORI, "a")).find((x) => x.id === "a").pinned === false, "固定没有可逆");
const textDoc = docOf([{ id: "t", spec: { kind: "text", text: "旧", variant: "label" }, cell: { x: 0, y: 0, w: 2, h: 1 } }]);
const props = E.setItemProps(textDoc, BID, ORI, "t", { text: "新" });
ok(itemsOf(props).find((x) => x.id === "t").spec.text === "新", "属性抽屉改写没有落到 spec（文字组件的内容就取自 spec）");
ok(E.setItemProps(textDoc, BID, ORI, "nope", { text: "x" }) === textDoc, "改属性不存在的条目应原样返回");

/* ④ 新增 */
const d5 = docOf([item("a", 0, 0, 4, 1)]);
const add = E.addItemTo(d5, BID, ORI, { kind: "divider" }, W.PRESET_WIDGETS);
ok(!!add.added && itemsOf(add.doc).length === 2, "新增失败");
ok(!E.hasOverlap(itemsOf(add.doc)), "新增后出现重叠");
ok(add.added.cell.y === 1, "新增没有落到第一处空位");
const dup = E.addItemTo(add.doc, BID, ORI, { kind: "divider" }, W.PRESET_WIDGETS);
ok(dup.added === null && dup.reason === "duplicate", "重复新增应被拒");
const unk = E.addItemTo(d5, BID, ORI, { kind: "custom", id: "no-such" }, W.PRESET_WIDGETS);
ok(unk.added === null && unk.reason === "unknown-widget", "未知组件应被拒");

/* ⑤ 源码层：编辑操作不得 import .tsx（只看 import 行） */
const src = readFileSync("apps/desktop/src/state/boardEdit.ts", "utf8");
const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l)).join("\n");
ok(!/\.tsx/.test(importLines), "编辑操作核心 import 了 .tsx（node 无法剥离 JSX）");

/* ⑥ 四边把手缩放（需求原文：上下左右四个拖拽点） */
const base = { x: 1, y: 1, w: 2, h: 1 };
ok(JSON.stringify(E.cellFromResize(base, "e", 100, 0, 100, 40)) === JSON.stringify({ x: 1, y: 1, w: 3, h: 1 }), "东把手应加宽");
ok(JSON.stringify(E.cellFromResize(base, "s", 0, 80, 100, 40)) === JSON.stringify({ x: 1, y: 1, w: 2, h: 3 }), "南把手应加高");
ok(JSON.stringify(E.cellFromResize(base, "w", -100, 0, 100, 40)) === JSON.stringify({ x: 0, y: 1, w: 3, h: 1 }), "西把手应同时移动原点并加宽");
ok(JSON.stringify(E.cellFromResize(base, "n", 0, -40, 100, 40)) === JSON.stringify({ x: 1, y: 0, w: 2, h: 2 }), "北把手应同时移动原点并加高");
ok(E.cellFromResize(base, "e", -999, 0, 100, 40).w === 1, "向西拖过头时宽不得小于 1");
ok(E.cellFromResize(base, "w", 999, 0, 100, 40).x === 2 && E.cellFromResize(base, "w", 999, 0, 100, 40).w === 1, "西把手拖过头时原点应停在原右边界、宽为 1");
ok(E.cellFromResize({ x: 0, y: 0, w: 2, h: 1 }, "w", -500, 0, 100, 40).x === 0, "西把手不得把组件推到负坐标");
const pdoc = E.placeItem(docOf([item("a", 0, 0, 1, 1), item("b", 0, 1, 2, 1)]), "b1", "portrait", "a", { x: 0, y: 0, w: 4, h: 1 }, W.PRESET_WIDGETS);
ok(!E.hasOverlap(itemsOf(pdoc)), "缩放后出现重叠（被压到的应向下推）");
ok(itemsOf(pdoc).find((x) => x.id === "a").cell.w === 4, "缩放没有生效");
ok(E.placeItem(docOf([item("a", 0, 0, 1, 1)]), "b1", "portrait", "nope", { x: 0, y: 0, w: 2, h: 1 }) .boards[0].cells.portrait.length === 1, "落位不存在的条目应原样返回");
/* ⑦ 四边把手接线（页面是 .tsx → 静态判定） */
const pageR = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8"); // OnePage 面 = 自由画布（2026-10-15 白板页退役）
/* ⑧ 添加组件面板（P2 入口：页面是 .tsx → 静态判定） */
const pageA = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8");
const drawerSrc = readFileSync("apps/desktop/src/components/BoardAddDrawer.tsx", "utf8");
ok(/(?:defs|shownDefs|quickDefs|restDefs)\.map\(/.test(drawerSrc), "抽屉总览没有遍历组件目录（等于自造一份清单）");
ok(/add-detail-desc">\{def\.description\}/.test(drawerSrc), "展开态没有展示组件描述（用户不知道加的是什么）");
ok(/data-widget-option=\{d\.id\}/.test(drawerSrc), "抽屉卡片缺少稳定的测试标记");
/* ⑨ 多收藏夹操作（P2 §7.9） */
const O = await import("../apps/desktop/src/state/boardOps.ts");
const d0 = { v: 1, order: {}, activeBoardId: "b1", boards: [
  { id: "b1", name: "今日", icon: "today", kind: "system", cells: { portrait: [{ id: "a", spec: { kind: "divider" }, cell: { x: 0, y: 0, w: 4, h: 1 } }] } },
  { id: "b2", name: "我的板", icon: "star", kind: "user", cells: { portrait: [] } },
] };
const sums = O.boardSummary(d0);
ok(sums.length === 2 && sums[0].active === true && sums[0].count === 1, "摘要（数量/当前项）不对");
ok(sums[1].active === false && sums[1].count === 0, "空板摘要不对");
const created = O.createBoard(d0, " 学习 ");
ok(created.doc.boards.length === 3 && created.board.name === "学习", "新建收藏夹失败（或没去空白）");
ok(O.createBoard(created.doc, "再来").board.id !== created.board.id, "新建的 id 撞车了");
ok(O.createBoard(d0, "   ").board.name === "新收藏夹", "空名字没有回落默认名");
ok(O.setActiveBoard(d0, "b2").activeBoardId === "b2", "设为今日页失败");
ok(O.setActiveBoard(d0, "nope") === d0, "设为不存在的板应原样返回");
ok(O.moveBoard(d0, "b2", "up").boards[0].id === "b2", "上移失败");
ok(O.moveBoard(d0, "b2", "down") === d0, "已在末尾还下移应原样返回（同一引用）");
ok(O.moveBoard(d0, "b1", "up") === d0, "已在首位还上移应原样返回");
ok(O.deleteBoard(d0, "b1").reason === "system-board", "系统板必须不可删");
ok(O.deleteBoard(d0, "nope").reason === "not-found", "删不存在的板应给出原因");
ok(O.deleteBoard(d0, "b2").doc.boards.length === 1, "删除用户板失败");
const onlyUser = { v: 1, order: {}, activeBoardId: "u1", boards: [{ id: "u1", name: "唯一", icon: "star", kind: "user", cells: { portrait: [] } }] };
ok(O.deleteBoard(onlyUser, "u1").reason === "last-board", "最后一块板不可删（否则用户没有主页了）");
const delActive = O.deleteBoard(O.setActiveBoard(d0, "b2"), "b2");
ok(delActive.doc.activeBoardId === "b1", "删掉当前板后应回落到系统板");
ok(O.renameBoard(d0, "b2", "改名", "icon-x").boards[1].name === "改名", "重命名失败");
ok(O.renameBoard(d0, "b2", "  ").boards[1].name === "我的板", "空名字不该覆盖原名");
/* ⑩ 收藏夹列表页接线（页面是 .tsx → 静态判定） */
const listPage = readFileSync("apps/desktop/src/pages/BoardListPage.tsx", "utf8");
ok(/boardSummary\(doc\)/.test(listPage), "列表页没有用纯逻辑生成摘要（数量/当前项会不可靠）");
/* 文案已走 i18n：按 key + 结构断言（key: "current"/"up"/"down"/"remove" 是稳定契约）。 */
ok(/key: "current", label: i18n\("auto\.pages\.BoardListPage\.p\d+"\)/.test(listPage), "长按菜单缺「设为当前 OnePage」");
ok(/key: "up", label: i18n\(/.test(listPage) && /key: "down", label: i18n\(/.test(listPage), "长按菜单缺上移/下移");
ok(/key: "remove", label: i18n\([^)]*\), danger: true/.test(listPage), "删除项没有走危险色（需求原文要求标红）");
ok(/filter\(\(b\) => b\.kind !== "system"\)/.test(listPage), "系统板没有从 OnePage 列表里排除（会被当成可删白板）");
ok(/moveBoard\(d, id, "up"\)/.test(listPage) && /moveBoard\(d, id, "down"\)/.test(listPage), "上下移没有走纯逻辑");
ok(/createBoard\(d,/.test(listPage), "新建 OnePage 没有走纯逻辑");
ok(/navigate\("board"\)/.test(listPage), "点击收藏夹没有进入白板页");
ok(/所有 OnePage/.test(pageR) && /navigate\("boards"\)/.test(pageR), "白板面没有进入 OnePage 列表的入口");
ok(/"boards"/.test(readFileSync("apps/desktop/src/state/app.tsx", "utf8")), "路由白名单里没有 boards（会静默回落到今日页）");
/* ⑪ 进入即编辑的一次性意图（P2 UX） */
/* 2026-10-15：state/boardIntent.ts 已随旧「今日页」删除（那条一次性意图零生产者）——
   这里不再 import 它（否则 ERR_MODULE_NOT_FOUND）；改为断言它确实已经不在源码里。 */
ok(!readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8").includes("boardIntent"), "自由画布不该再挂着已删除的一次性编辑意图");
/* 2026-10-15：旧「今日页」的「进入即编辑」菜单随页删除 —— 那条一次性意图（boardIntent）
   已零生产者，连 state/boardIntent.ts 一起删了。这里改为断言它**确实不在**（防半吊子复活）：
   新画布本来就是直接可拖可加，不需要"先点编辑再进来"这套。 */
ok(!/requestEditOnOpen|consumeEditOnOpen/.test(pageR + readFileSync("apps/desktop/src/components/explorer/renderPage.tsx", "utf8")), "旧页的一次性编辑意图不该再出现在新首页/新页面上");
/* ⑨ 把手只显示可调维度（霖 2026-10-10 口径）+ 空内容与缺渲染器的文案区分 */
const widgetsSrc = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");
/* 基准瓦片高引入后，高度恢复可调（霖 2026-10-10 定） */
ok(/\maxH: 8 \};/.test(widgetsSrc), "卡片高度上限没有放开（瓦片高已引入，高度应可调；最高卡片约 650px 需要 7 行）");
const coreSrc = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8");
const cssSrc = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const tile = /export const TILE_H = (\d+);/.exec(coreSrc);
ok(!!tile, "缺少基准瓦片高常量 TILE_H");
const hostSrc = readFileSync("apps/desktop/src/components/WidgetHost.tsx", "utf8");
ok(/custom\(item\.spec\.kind === "custom" \? item\.spec\.props : undefined, plan\.size\)/.test(hostSrc) && /\?\? \(/.test(hostSrc) && /暂无内容/.test(hostSrc), "渲染器没有收到 props 与当前档位，或空返回没有走「暂无内容」分支");
/* ⑩ 只在选中项显示把手（霖 2026-10-10 定） */
/* 固定瓦片与 align-items 互斥：加了 start 会按内容溢出轨道（实测 170/459/677 而非 88 倍数） */
/* ⑫ 拟合后的按列重排（消除空行） */
const packIn = [item("a", 0, 0, 3, 5), item("b", 3, 0, 1, 1), item("c", 0, 25, 3, 2), item("d", 3, 9, 1, 1)];
const packed = E.repackItems(packIn);
ok(packed.map((x) => x.id).join(",") === "a,b,c,d", "重排改变了数组顺序（渲染顺序会被打乱）");
ok(packed[0].cell.y === 0 && packed[2].cell.y === 5, "主列没有按 h 紧凑排布（" + packed[2].cell.y + "，应为 5）");
ok(packed[1].cell.y === 0 && packed[3].cell.y === 1, "侧栏没有按 h 紧凑排布");
ok(packed[2].cell.h === 2 && packed[2].cell.x === 0, "重排不该改动 x/w/h");
/* 重排不能挂在拟合条件上：旧数据本来就可能带空行（实测拟合早已完成时重排没跑） */
/* ⑬ 起步模板接线（P2.5）：空板引导 + 菜单里的套用入口 */
ok(/data-template=\{tpl\.id\}/.test(pageR), "空板没有模板按钮（用户面对空白板无从下手）");
ok(/key: "apply-tpl", label: tr\("board\.menu\.templates"\)/.test(pageR), "右上菜单缺「套用模板」入口");
ok(/BOARD_TEMPLATES\.map/.test(pageR) && /tpl\.description/.test(pageR), "模板选择面板没有列出说明（用户不知道选的是什么）");
ok(/templateItems\(tpl\)/.test(pageR) && /rectFromCell\(it\.cell\)/.test(pageR), "套用模板没有走纯逻辑 templateItems + px 映射");
/* ⑭ 白板页必须渲染当前板（写死 systemBoard 会让用户板永远打不开，本轮实测踩过） */
ok(/const board = activeBoard\(doc\);/.test(pageR), "OnePage 面写死了系统板（用户在收藏夹里选的板打不开）");
const boardWrapSrc = readFileSync("apps/desktop/src/state/boardCore.ts", "utf8");
ok(/export function activeBoard/.test(boardWrapSrc) && /doc\.boards\.find\(\(b\) => b\.id === doc\.activeBoardId\)/.test(boardWrapSrc), "缺少「当前板」解析（应优先 activeBoardId，缺了才回落系统板）");
/* ⑫ 霖 2026-10-11 的操作逻辑改版：正常模式不改布局、尺寸入口收进菜单、编辑态列表占位 */
ok(/label: tr\("board\.menu\.resize"\)/.test(pageR) && /isTierControlled\(def\)/.test(pageR) && /label: tr\("board\.menu\.freeResize"\)/.test(pageR), "长按菜单没有按「挡位控制 / 自由控制」分流尺寸入口");
ok(/\.\.\.LIST_WIDGET_IDS|LIST_WIDGET_IDS/.test(widgetsSrc) && /isListWidget/.test(widgetsSrc), "缺少列表型组件清单");
/* ⑮ 霖 2026-10-11 六条现场 bug 的判据（其中三条落在出厂 CSS 与纯函数上） */
const distCss = (() => {
  try {
    const dir = "apps/desktop/dist/assets";
    /* exFAT 卷上 macOS 会给每个文件落 4KB AppleDouble（._xxx），readdir 顺序不定
       ——不跳过它就会选中垃圾文件，出厂 CSS 断言全红（2026-10-12 合流实测）。 */
    const file = readdirSync(dir).find((f) => f.endsWith(".css") && !f.startsWith("._"));
    return file ? readFileSync(dir + "/" + file, "utf8") : "";
  } catch { return ""; }
})();
const wRes = E.cellFromResize({ x: 1, y: 2, w: 3, h: 2 }, "w", 100, 0, 100, 96);
ok(wRes.x === 2 && wRes.w === 2, "拖西把手没有收紧左边（实际 x=" + wRes.x + " w=" + wRes.w + "，应为 x=2 w=2）");
const eRes = E.cellFromResize({ x: 0, y: 2, w: 2, h: 2 }, "e", 100, 0, 100, 96);
ok(eRes.x === 0 && eRes.w === 3, "拖东把手没有放宽右边（实际 x=" + eRes.x + " w=" + eRes.w + "）");
const nRes = E.cellFromResize({ x: 0, y: 4, w: 3, h: 3 }, "n", 0, 96, 100, 96);
ok(nRes.y === 5 && nRes.h === 2, "拖北把手没有收紧上边（实际 y=" + nRes.y + " h=" + nRes.h + "）");
/* ⑯ 西/北把手在边界处的不变式（霖 2026-10-11：拖西把手却东侧收缩） */
const wEdge = E.cellFromResize({ x: 0, y: 0, w: 3, h: 2 }, "w", -100, 0, 100, 96);
ok(wEdge.x === 0 && wEdge.w === 3, "西把手在左边界往左拖把宽度改小了（应保持右边缘不动：x=0 w=3，实际 x=" + wEdge.x + " w=" + wEdge.w + "）");
const wIn = E.cellFromResize({ x: 0, y: 0, w: 3, h: 2 }, "w", 100, 0, 100, 96);
ok(wIn.x === 1 && wIn.w === 2, "西把手在左边界往右拖没有收紧左边（实际 x=" + wIn.x + " w=" + wIn.w + "）");
const nEdge = E.cellFromResize({ x: 0, y: 0, w: 3, h: 3 }, "n", 0, -100, 100, 96);
ok(nEdge.y === 0 && nEdge.h === 3, "北把手在上边界往上拖把高度改小了（应保持下边缘不动）");
const eEdge = E.cellFromResize({ x: 2, y: 0, w: 2, h: 1 }, "e", 100, 0, 100, 96);
ok(eEdge.x + eEdge.w === 4, "东把手在右边界往右拖越过了列数（实际右边缘=" + (eEdge.x + eEdge.w) + "）");
/* ⑱ 第三批现场 bug 的判据 */
/* ㉙ 两种模式布局必须一致 / 拟合不许覆盖用户尺寸 / 底栏指示器跟着当前板（霖 2026-10-11） */
ok(!/const activeBoardId = useMemo/.test(readFileSync("apps/desktop/src/components/Layout.tsx", "utf8")), "底栏的当前板被 useMemo 缓存了（切换白板后指示器不跟着走）");
ok(/manual: true/.test(coreSrc) && /manual\?: boolean/.test(coreSrc), "用户缩放没有打 manual 标记（withRect 必须打上，自动逻辑才不会再改它）");
/* ㉚ 底栏抑制必须带"当前在白板页"；拉大后的内容要自适应铺开（霖 2026-10-11） */
const layoutSrc = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
/* 移植版（dev3-onePage）：dev3 的底栏没有原分支那套「收藏夹槽位」，这里不改底栏抑制，
   改为检查白板两页确实登记进了 Page 联合（页面集是 dev3 的，白板是后加的）。 */
void layoutSrc;
const appPageSrc = readFileSync("apps/desktop/src/state/app.tsx", "utf8");
ok(/\| "boards"/.test(appPageSrc) && /\| "board"/.test(appPageSrc), "白板两页没有登记进 dev3 的 Page 联合");
/* 暂存箱：白板卡片的长按菜单必须有「收进暂存箱」（手机 stack 下卡片不能直接拖时的兜底）。 */
{
  const free = readFileSync("apps/desktop/src/components/FreeBoard.tsx", "utf8");
  ok(/label: tr\("board\.menu\.vault"\)/.test(free) && /addToVault\s*\(/.test(free), "白板卡片长按菜单缺「收进暂存箱」");
}
/* ㉞ 尺寸档位（霖 2026-10-11 定稿）：取消自由控制、改为逐组件的挡位控制
   ① 纯逻辑：挡位吸附 / 自由夹取 / 显式档位落库；
   ② 抽屉：展开态是横向滑动的档位列表，滑到哪档就加哪档；resize 模式复用同一抽屉；
   ③ 白板页：档位组件退出高度拟合、走「改变大小」抽屉、槽位带按尺寸排版的钩子。 */
const T = await import("../apps/desktop/src/state/widgetMeta.ts");
const tierDef = {
  id: "custom:t", spec: { kind: "custom", id: "t" }, title: "示例", description: "示例组件。",
  defaultSize: { w: 2, h: 2 }, sizeRange: { minW: 1, minH: 1, maxW: 8, maxH: 8 },
  sizeControl: "tiers", sizeTiers: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 2, h: 2 }],
};
const tierDoc = docOf([{ id: "a", spec: { kind: "custom", id: "t" }, cell: { x: 0, y: 0, w: 3, h: 5 } }]);
const norm = T.normalizeSize(tierDef, { w: 3, h: 5 });
ok(norm.w === 2 && norm.h === 2, "尺寸归一没有把挡位外的尺寸吸附到最近档位（实际 " + norm.w + "x" + norm.h + "）");
const added = E.addItemTo(docOf([]), BID, ORI, { kind: "custom", id: "t" }, [tierDef], { w: 2, h: 1 });
ok(!!added.added && added.added.cell.w === 2 && added.added.cell.h === 1, "显式档位没有落进新条目");
ok(added.added.manual === true, "用户选的档位没有打 manual 标记（会被后续自动逻辑改写）");
const addedDefault = E.addItemTo(docOf([]), BID, ORI, { kind: "custom", id: "t" }, [tierDef]);
ok(!!addedDefault.added && addedDefault.added.manual !== true, "未指定档位时不该打 manual（应走目录推荐档位）");
const snappedDoc = E.placeItem(tierDoc, BID, ORI, "a", { x: 0, y: 0, w: 4, h: 4 }, [tierDef]);
ok(itemsOf(snappedDoc).find((x) => x.id === "a").cell.w === 2 && itemsOf(snappedDoc).find((x) => x.id === "a").cell.h === 2, "placeItem 没有把挡位外的尺寸吸附回档位");
ok(T.sizeControlOf(tierDef) === "tiers" && T.isTierControlled(tierDef) === true, "tiers 声明没有被识别");
const drawerTier = readFileSync("apps/desktop/src/components/BoardAddDrawer.tsx", "utf8");
const sizesSrc = readFileSync("apps/desktop/src/components/WidgetSizes.tsx", "utf8");
const cssTier = readFileSync("apps/desktop/src/styles/global.css", "utf8");
ok(/WidgetSizeList/.test(drawerTier), "展开态没有用档位卡片流（仍是单张预览）");
ok(/data-size-option=/.test(sizesSrc) && /data-size-index=/.test(sizesSrc) && /data-size-slot=/.test(sizesSrc), "档位卡片缺少稳定的测试标记");
ok(/role="radio"/.test(sizesSrc) && /aria-checked/.test(sizesSrc), "档位不是单选控件语义（无障碍读不出选中项）");
ok(/NEIGHBOURS/.test(sizesSrc) && /const wrap/.test(sizesSrc), "卡片流没有做循环（前后各一张 + 取模回绕）");
ok(/MIN_SCALE/.test(sizesSrc) && /MIN_OPACITY/.test(sizesSrc), "侧卡没有按距离缩小/淡出（看不出哪张是前台）");
ok(/animatePos/.test(sizesSrc) && /easeOutCubic|Math\.pow\(1 - t, 3\)/.test(sizesSrc), "卡片流没有逐帧补间（换档会生硬跳变）");
ok(/.widget-size-carousel/.test(sizesSrc) && /widget-size-dots/.test(sizesSrc) && /data-size-dots=/.test(sizesSrc), "没有卡片流容器或底部点状指示栏");
ok(!/onScroll=/.test(sizesSrc), "档位列表仍在用滚动位置判定选中（滚到底时最后一个档位会被判成倒数第二档）");
ok(/i18n\("auto\.components\.WidgetSizes\.\d+"\)/.test(sizesSrc), "没有「已选哪一档」的文字回读");
ok(/\.widget-size-carousel \{[^}]*position: relative/.test(cssTier) && /\.widget-size-carousel \{[^}]*touch-action: none/.test(cssTier), "卡片流没有相对定位或没吃掉横向手势（会被浏览器当滚动）");
ok(/\.widget-size-item \{[^}]*position: absolute/.test(cssTier) && /\.widget-size-item \{[^}]*border: 1px solid var\(--border\)/.test(cssTier) && /\.widget-size-item \{[^}]*border-radius: 16px/.test(cssTier), "档位卡片不是绝对定位的段落卡片（1px 描边 + 16px 圆角）");
ok(/\.widget-size-item\.is-active \{[^}]*border-color: var\(--accent\)/.test(cssTier), "选中档位没有强调色描边（看不出选中的是哪一档）");
ok(/\.widget-size-item\.is-active \.widget-size-check/.test(cssTier), "选中档位没有对勾标记");
ok(/\.widget-size-dot\.is-cur/.test(cssTier), "指示栏没有当前档位的高亮");
/* 霖 2026-10-11：「聊点什么吧」胶囊正好完全挡住确认按钮——抽屉底部必须为它让位。 */
ok(/--dock-clearance/.test(cssTier) && /--dock-clearance/.test(drawerTier), "抽屉底部没有为 OH 悬浮岛让位（确认按钮会被挡住）");
ok(/dock-island/.test(drawerTier) && /getBoundingClientRect/.test(drawerTier), "没有量出悬浮岛与抽屉底部的重叠高度");
ok(/\.add-drawer\.is-detail/.test(cssTier) && /is-detail/.test(drawerTier), "展开态没有单独的高度档（卡片流放不下）");
/* 霖 2026-10-11 第四轮：圆点被确认按钮挡住。空间不足时被压的必须是**卡片流**，
   标题行与指示栏固定高度（指示栏才不会滑到按钮底下）。 */
ok(/\.widget-size-carousel \{[^}]*min-height: 0/.test(cssTier) && /\.widget-size-picker \{[^}]*overflow: hidden/.test(cssTier), "卡片流不是唯一可伸缩段（空间不足时指示栏会被确认按钮压住）");
/* 霖 2026-10-11 第四轮：中等力度的一挥被收势回弹判成反向。松手速度必须取**时间窗平均**，
   且投射方向与整段手势净位移相反时要丢掉投射。 */
ok(/samples/.test(sizesSrc) && /<= 120/.test(sizesSrc), "松手速度没有取时间窗平均（收势回弹会把中等力度的一挥判成反向）");
ok(/Math\.sign\(fling\) !== Math\.sign\(net\)/.test(sizesSrc), "投射方向没有与整段手势的净位移对账（反向投射会突然退一位）");
/* 霖 2026-10-11 第五轮：两项列表里左划之后又被"最短路径"倒演回去。
   真因是拖动动画**途中**父组件改了档位，旧的 effect 立刻按最短路径重新定目标。
   现在动画途中不抢目标，只在收尾时对账。 */
ok(/animRef/.test(sizesSrc) && /touch\.current \|\| animRef\.current/.test(sizesSrc), "动画途中仍会按父组件档位改目标（两项列表会把前进动作倒演回去）");
/* 圆点下沿被遮住一点：指示栏要有自己的高度与层级。 */
ok(/\.widget-size-dots \{[^}]*min-height: 14px/.test(cssTier) && /\.widget-size-dots \{[^}]*z-index: 1/.test(cssTier), "指示栏没有自己的高度与层级（下沿会被确认按钮压住）");
/* 霖 2026-10-11 §5：组件自带的卡片常比槽位矮，下方露出一条 .wg-card 底色（看着像"只占 7/8"）。
   槽位与预览都要让组件根节点撑满；入口按钮排除在外。 */
const cssFree = readFileSync("apps/desktop/src/styles/explorer-home.css", "utf8");
ok(/\.free-item \.wg-card > \*:not\(\.wg-entry\)/.test(cssFree) && /\.widget-size-inner \.wg-card > \*:not\(\.wg-entry\)/.test(cssTier), "组件卡片没有撑满条目盒与预览（下方会露出一条 .wg-card 底色）");
ok(/\.wg-entry-side \{/.test(cssTier) && /\.wg-entry-hint \{/.test(cssTier), "入口行的说明/箭头没有样式（类名与 CSS 不一致，等于裸跑）");
ok(/tierIndexOf\(d, d\.defaultSize\)/.test(drawerTier), "展开时没有默认选中推荐档位");
ok(/tierIndexOf\(def, \{ w: targetW, h: targetH \}\)/.test(drawerTier), "resize 模式没有自动选中当前档位");
ok(/"修改大小"/.test(drawerTier) && /mode === "resize"/.test(drawerTier), "resize 模式没有「修改大小」按钮");
ok(/data-add-mode=\{mode\}/.test(drawerTier), "抽屉没有暴露 add/resize 模式标记");
/* 霖 2026-10-12：真机点一次「修改大小」没反应、**也没有触感**（第二次才生效）——说明那一次 click
   根本没发生（全局触感委托挂在 click 上）。确认键改为**抬手即生效**（指针路径）+ 一次性闸门，
   并在指针路径补一档与 .btn 相同的触感（click 被 preventDefault 抑制，全局委托不再发声）。 */
ok(/onPointerUp=/.test(drawerTier) && /activate\(true\)/.test(drawerTier) && /firedRef/.test(drawerTier), "确认键仍只在 click 上生效（真机第一次点按会被吞掉）");
ok(/haptic\("tick"\)/.test(drawerTier), "指针路径没有补触感（click 被抑制后全局委托不再发声）");
ok(/\.add-detail-add \{[^}]*z-index: 2/.test(cssTier), "确认键没有画在档位区之上（重叠时会抢走点按）");
/* 霖 2026-10-11 现场：打开「添加组件」时输入法自己弹出来。真因是预览渲染的真实卡体里有 autoFocus 输入框
   （网络学堂搜索页）。预览是缩略图，输入控件必须失去可聚焦性，并留一道「获得焦点即失焦」的兜底。 */
ok(/\.add-preview-box input/.test(drawerTier) && /\.widget-size-box input/.test(drawerTier) && /\.disabled = true/.test(drawerTier), "抽屉预览没有屏蔽输入控件（打开抽屉会弹出输入法）");
/* 霖 2026-10-12 现场：整体卡顿、轻滑即抽搐。真因是预览区挂过 MutationObserver ——
   抽屉里是 51 个真实卡体，卡体数据 hook 持续重渲染，每次 DOM 变动都触发全量重扫。
   现在只做一次批量处理，晚挂载的输入框交给 O(1) 的 focusin 兜底。 */
ok(!/new MutationObserver/.test(drawerTier), "抽屉预览又挂上了 MutationObserver（卡体重渲染会全量重扫 → 全局卡顿）");
ok(/addEventListener\("focusin", onFocusIn, true\)/.test(drawerTier) && /removeEventListener\("focusin", onFocusIn, true\)/.test(drawerTier), "预览区没有「获得焦点即失焦」兜底（同名同 capture 的移除也必须有）");
ok(/\.blur\(\)/.test(drawerTier), "预览区拿到焦点后没有失焦（输入法仍会被拉起）");
ok(/onResize\?\.\(def, chosen\)/.test(drawerTier), "resize 确认没有回传选中的档位");
ok(/data-size=\{plan\.size\.w/.test(pageR), "画布条目没有按档位排版的选择器钩子 data-size（抽屉预览与画布共用同一条 CSS）");
ok(/data-item-id=\{it\.id\}/.test(pageR), "画布条目缺少稳定标记 data-item-id（测量与守栏都要用）");
ok(/setResizeFor\(\{ id: item\.id/.test(pageR) && /setSelected\(item\.id\)/.test(pageR), "尺寸入口没有分「挡位抽屉 / 自由把手」两路");
ok(/mode=\{resizeFor \? "resize" : "add"\}/.test(pageR), "抽屉没有按 resize 模式切换（改大小没有复用添加抽屉）");
ok(/ops\.resize\(resizeFor\.id,/.test(pageR) && /x: cur\.x, y: cur\.y/.test(pageR), "改大小没有落库到该条目（尺寸会丢）");
const widgetsTier = readFileSync("apps/desktop/src/state/widgets.ts", "utf8");
ok(/SIZE_PLANS/.test(widgetsTier), "缺少挡位提案表（挡位控制组件无从登记档位）");
ok(/freeSizeWidgetIds/.test(widgetsTier), "缺少自由控制组件清单（分割线/标题/入口按钮/列表）");
ok(/sizeControl: free \? "free" : "tiers"/.test(widgetsTier), "卡片没有按自由/挡位分流");
ok(/sizeTiers: free \? undefined : plan\.tiers/.test(widgetsTier), "挡位控制卡片没有登记档位清单");
ok(/LIST_WIDGET_IDS/.test(widgetsTier) && /kind === "entry"/.test(widgetsTier), "自由控制分流没有覆盖入口按钮与列表");
/* 霖 2026-10-12：抽屉预览不许"现爬数据"。做法是把示例写进数据层缓存（远未来时间戳 → SWR 永不刷新），
   预览子树挂载时 seed、卸载时还原；组件与各 hook 一行不用改。 */
const previewSrc = readFileSync("apps/desktop/src/components/PreviewData.tsx", "utf8");
const cacheSrc = readFileSync("apps/desktop/src/state/cache.ts", "utf8");
const dataSrc2 = readFileSync("apps/desktop/src/state/data.ts", "utf8");
ok(/PreviewDataProvider/.test(drawerTier), "抽屉预览没有包在预览数据层里（挑组件会顺带把数据爬一遍）");
ok(/const restore = seedPreviewData\(\)/.test(previewSrc) && /restore\(\)/.test(previewSrc), "预览数据层没有在挂载时写入示例、卸载时还原");
ok(/cacheSeedPreview/.test(cacheSrc) && /PREVIEW_AT = Number\.MAX_SAFE_INTEGER/.test(cacheSrc), "示例数据没有取远未来时间戳（会被判过期从而发起真实请求）");
ok(/let prev|const prev = mem\.get\(key\)/.test(cacheSrc) && /if \(prev\) mem\.set\(key, prev\)/.test(cacheSrc), "示例数据没有做快照还原（会污染真实缓存）");
ok(/cacheSeedPreview\(REPORT_KEY/.test(dataSrc2) && /cacheSeedPreview\("card:1"/.test(dataSrc2), "示例数据没有覆盖成绩与校园卡（这两类预览仍会现爬）");
ok(/setPreviewMode\(true\)/.test(previewSrc) && /isPreviewMode/.test(cacheSrc), "缺少预览模式开关（挂载即拉的 hook 仍会现爬）");
ok(/!isPreviewMode\(\)/.test(dataSrc2), "网络学堂的加载没有在预览期跳过（它挂载即拉，seed 拦不住）");
ok(/cacheSeedPreview\(CAMPUS_KEY/.test(dataSrc2) && /cacheSeedPreview\(DEADLINES_KEY/.test(dataSrc2) && /cache = \{ key: "current"/.test(dataSrc2), "示例数据没有覆盖校内数据 / 倒计时 / 网络学堂");
ok(/cacheSeedPreview\(TODAYRESV_KEY/.test(dataSrc2) && /cacheSeedPreview\(TODAYCAL_KEY/.test(dataSrc2), "示例数据没有覆盖今日预约 / 今日校历");
ok(/cacheSeedPreview\(PROFILE_KEY/.test(dataSrc2) && /cacheSeedPreview\(EXAMS_KEY/.test(dataSrc2) && /cacheSeedPreview\(CAL_KEY/.test(dataSrc2), "示例数据没有覆盖个人信息 / 考试安排 / 校历");
/* 外部作业与忽略集合：前者是模块级快照（整个应用启动只拉一次，不随预览挂载现爬）、
   后者是本地存储集合，都不需要种子——但要有注释说明，避免后来者以为漏了。 */
ok(/外部作业与忽略集合|快照|本地存储/.test(dataSrc2) || /useExternalHomework/.test(dataSrc2), "外部作业/忽略集合的处理没有交代");
/* 键里带参数的 hook（分页新闻、订阅新闻）种子盖不全，必须在预览期直接返回示例并跳过加载 */
ok(/const preview = isPreviewMode\(\)/.test(dataSrc2) && /previewNewsItems/.test(dataSrc2), "带参数的新闻 hook 没有预览分支（拉取会照发）");
ok(/if \(status !== "ready" \|\| preview\) return;/.test(dataSrc2), "带参数 hook 的加载判据没有把预览算进去");
/* 关键顺序：先 seed 再挂子节点。子节点首次渲染就会读缓存，父的普通 effect 晚于子 effect → 必须在 layout 阶段 seed 并门住 children。 */
ok(/useLayoutEffect/.test(previewSrc) && /if \(!ready\) return null;/.test(previewSrc), "预览数据层没有先 seed 再挂载子节点（子节点首屏会读到旧缓存并照发请求）");
if (fails.length) {
  console.error("白板编辑护栏（P1）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("白板编辑护栏（P1）：移动（落目标格/夹列/向下推/无重叠）✓ ｜ 缩放夹取 ✓ ｜ 删除/固定/属性可逆且未命中不改 ✓ ｜ 新增去重与空位 ✓ ｜ 不依赖视图 ✓");
