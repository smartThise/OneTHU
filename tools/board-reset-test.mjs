#!/usr/bin/env node
/**
 * 「恢复默认布局」护栏（2026-10-19）。
 *
 * 为什么有这条：设置页这个按钮曾经只清 `lib/homeCards` 的网格布局键，而首页画布
 * 只读板文档 `onethu.board.v1` 里的 px 条目 —— 点了完全没反应（用户实测）。
 * 这里用真模块 + 真 localStorage 钉住三件事：
 *   ① 系统板两个朝向都换回 `homeStarterItems()`，旧卡片清空；
 *   ② 用户自建的 OnePage 板原样保留（复位不能顺手清别人的板）；
 *   ③ 复位后画布快照立刻是新布局（不需要重启/重进页面）。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/board-reset-test.mjs ｜ 0 通过 / 1 违规
 */
import "./board-test-env.mjs";

const KEY = "onethu.board.v1";
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const item = (id, x, y, w, h, spec) => ({ id, spec, cell: { x, y, w, h }, rect: { x, y, w, h } });
const stale = item("stale.clock", 0, 0, 200, 100, { kind: "custom", id: "clock" });
const mine = item("mine.note", 900, 900, 300, 200, { kind: "custom", id: "note" });

globalThis.localStorage.setItem(KEY, JSON.stringify({
  v: 1,
  homeLayoutVersion: 2,
  order: {},
  activeBoardId: "board.today",
  boards: [
    { id: "board.today", name: "首页", icon: "today", kind: "system", cells: { portrait: [stale], landscape: [stale] } },
    { id: "user.1", name: "我的板", icon: "today", kind: "user", cells: { portrait: [mine] } },
  ],
}));

const F = await import("../apps/desktop/src/state/freeBoard.ts");
const B = await import("../apps/desktop/src/state/boardCore.ts");

const seed = B.homeStarterItems();
const count = F.resetHomeBoard();
ok(count === seed.length, "恢复默认没有返回条目数（设置页反馈会失真）");

const doc = JSON.parse(globalThis.localStorage.getItem(KEY));
const sys = doc.boards.find((b) => b.id === "board.today");
const ids = (o) => (sys.cells[o] ?? []).map((it) => it.id).join(",");
ok(ids("portrait") === seed.map((it) => it.id).join(","), "竖屏没有换回默认版式");
ok(ids("landscape") === seed.map((it) => it.id).join(","), "横屏没有换回默认版式");
ok(!sys.cells.portrait.some((it) => it.id === "stale.clock"), "旧卡片没有被清掉（点了没反应的老毛病）");

const user = doc.boards.find((b) => b.id === "user.1");
ok(user && user.cells.portrait.length === 1 && user.cells.portrait[0].id === "mine.note", "用户自建板被顺手改了");

/* 画布快照必须立刻跟上（否则从设置返回首页还是旧布局） */
const snap = F.freeBoardSnapshot("board.today", "portrait");
ok(snap.items.length === seed.length, "画布快照没有刷新：回来还是旧布局（" + snap.items.length + " 项）");

/* 再点一次也要稳定（幂等），不能长双份 */
const again = F.resetHomeBoard();
const doc2 = JSON.parse(globalThis.localStorage.getItem(KEY));
ok(again === seed.length && doc2.boards.find((b) => b.id === "board.today").cells.portrait.length === seed.length, "重复恢复不稳定（会长双份）");

if (fails.length) {
  for (const f of fails) console.error("✗ " + f);
  process.exit(1);
}
console.log("board reset: all assertions passed");
