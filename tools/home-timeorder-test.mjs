#!/usr/bin/env node
/**
 * E4 今日页「时段推荐」护栏（霖口径：docs/ui-ux-polish-detailed.md §6 E4）。
 *
 * 钉住四件事，防止后续批次把规则表改回去或把「优先」做成「过滤」：
 *   [1] 时段表连续覆盖 24 小时、无空档（17–18、20–21 并入后不许再有 18:00 / 20:00 切点）；
 *   [2] 休息日判定取自课表（当天无课），不是按星期几；
 *   [3] 晚课动态延长：晚课没结束时「课表优先」跨过 21:00 继续生效，课表结束后才让位；
 *   [4] 开关与自动关闭（默认开；动过排序/显隐任一项即关）+ 排序不改集合只改顺序。
 *
 * 「优先 = 排序不是过滤」是本条的判据：这里直接加载纯模块 `state/homeOrder.ts` 跑行为
 * （时段覆盖/分组/重排都是断言出来的，不是 grep 源码猜的）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* localStorage 桩：开关持久化的读写路径要走真实代码 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const H = await import("../apps/desktop/src/state/homeOrder.ts");
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/** 2026-10-05（周一）的某个时刻——引擎只看分钟数，不看星期几 */
const at = (h, m) => new Date(2026, 9, 5, h, m);
const ev = (a, b) => ({ startMin: a, endMin: b });
const AM = [ev(8 * 60, 8 * 60 + 45)]; // 上午有课
const PM = [ev(13 * 60 + 30, 15 * 60 + 20)]; // 下午有课
const EVE = [ev(19 * 60 + 20, 21 * 60 + 20)]; // 晚课到 21:20（跨 21:00）

/* ---------- [1] 时段表：连续覆盖 24 小时、无空档 ---------- */
{
  const segs = H.HOME_SEGMENTS;
  assert.deepEqual(
    segs.map((s) => s.from),
    [300, 660, 780, 1020, 1260],
    "时段切点必须是 05:00 / 11:00 / 13:00 / 17:00 / 21:00——17–18 与 20–21 已并入相邻段，不许再有 18:00(1080) / 20:00(1200) 切点",
  );
  for (let i = 1; i < segs.length; i++) {
    assert.equal(segs[i].from, segs[i - 1].to, `时段表在第 ${i} 段前有空档/重叠`);
  }
  assert.equal(segs[segs.length - 1].to, 1740, "末段必须跨零点到次日 05:00（+1440）");
  assert.equal(segs[segs.length - 1].to - segs[0].from, 24 * 60, "时段表总长必须正好 24 小时");

  // 逐分钟落段：0–05:00 与 21:00–24:00 都算 night，24 小时无空档
  const counts = new Map();
  for (let m = 0; m < 24 * 60; m++) {
    const k = H.homeSegmentAt(new Date(2026, 9, 5, Math.floor(m / 60), m % 60));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.deepEqual(
    [...counts.entries()].sort(),
    [["afternoon", 240], ["evening", 240], ["morning", 360], ["night", 480], ["noon", 120]].sort(),
    "逐分钟落段的段长不对（17–21 应为 4h、21–05 应为 8h）",
  );
}

/* ---------- [2] 休息日判定取自课表（当天无课），不是星期几 ---------- */
{
  const home = read("apps/desktop/src/state/homeOrder.ts");
  assert.ok(!/getDay\(/.test(home), "休息日不许按星期几判定——必须取自当天课表（上四休三这类自定义课表）");
  assert.ok(/if \(events\.length === 0\)/.test(home), "休息日判据必须是「当天课表无课」");

  const holiday = H.homePriorityGroups({ now: at(9, 0), events: [] });
  assert.deepEqual(holiday, [["homework", "library", "reserve"]], "休息日优先序 = 未交作业 + 各类预约入口");
  assert.ok(!holiday.flat().includes("class"), "休息日不许把课表提前（有课才走工作日规则）");
  // 同一时刻，有课即工作日规则
  assert.deepEqual(
    H.homePriorityGroups({ now: at(9, 0), events: AM }),
    [["class"], ["notices"]],
    "上午有课必须走工作日「课表 → 最近通知」",
  );
  // 饭点（11–13 / 17–20）余额最前
  assert.equal(H.homePriorityGroups({ now: at(12, 0), events: [] })[0][0], "balance", "休息日 11–13 饭点余额必须最前");
  assert.equal(H.homePriorityGroups({ now: at(18, 0), events: [] })[0][0], "balance", "休息日 17–20 饭点余额必须最前");
  assert.notEqual(H.homePriorityGroups({ now: at(15, 0), events: [] })[0][0], "balance", "休息日非饭点不该把余额提前");
}

/* ---------- [3] 五个时段逐段对照规则表 ---------- */
{
  const g = (now, events) => H.homePriorityGroups({ now, events });
  // 05:00–11:00
  assert.deepEqual(g(at(7, 0), AM), [["class"], ["notices"]], "05–11 上午有课 → 课表优先，随后最近通知");
  assert.deepEqual(g(at(7, 0), PM), [["homework"], ["library"], ["notices"]], "05–11 上午无课 → 未交作业 → 图书馆 → 最近通知");
  // 11:00–13:00
  assert.deepEqual(g(at(12, 0), PM), [["balance"]], "11–13 下午有课 → 只把余额提前");
  assert.deepEqual(g(at(12, 0), AM), [["balance"], ["library"]], "11–13 下午无课 → 余额，随后图书馆预约入口");
  // 13:00–17:00
  assert.deepEqual(g(at(15, 0), PM), [["class"]], "13–17 下午有课 → 课表优先");
  assert.deepEqual(g(at(15, 0), AM), [["homework"], ["library"], ["notices"]], "13–17 下午无课 → 未交作业 → 图书馆 → 最近通知");
  // 17:00–21:00（17–18、20–21 并入）
  assert.deepEqual(g(at(18, 0), EVE), [["balance"], ["class"]], "17–21 有晚课 → 余额，随后课表");
  assert.deepEqual(g(at(20, 30), EVE), [["balance"], ["class"]], "20:30 晚课到 21:20 → 仍走课表优先");
  assert.deepEqual(g(at(18, 0), AM), [["balance"], ["homework", "notices"]], "17–21 无晚课 → 余额，随后未交作业 + 最近通知");
  // 21:00–05:00
  assert.deepEqual(g(at(21, 10), EVE), [["balance"], ["class"], ["homework", "notices"]], "21:10 晚课未结束 → 课表继续排在前（动态延长）");
  assert.deepEqual(g(at(22, 0), EVE), [["homework", "notices"]], "晚课结束后才让位给未交作业 + 最近通知");
  assert.deepEqual(g(at(2, 0), EVE), [["homework", "notices"]], "凌晨 02:00 不许把已结束的晚课当成还在上");
}

/* ---------- [4] 晚课延长不硬切 21:00 ---------- */
{
  const before = H.homePriorityGroups({ now: at(20, 59), events: EVE }).flat();
  const after = H.homePriorityGroups({ now: at(21, 1), events: EVE }).flat();
  const idx = (arr, r) => arr.indexOf(r);
  assert.ok(idx(after, "class") >= 0, "21:00 一到就把课表切掉了（晚课到 21:20 时必须继续课表优先）");
  assert.ok(
    idx(after, "class") < idx(after, "homework"),
    "晚课未结束时段，课表必须排在未交作业之前（不许在 21:00 硬切）",
  );
  assert.ok(idx(before, "class") >= 0 && idx(before, "balance") < idx(before, "class"), "20:59 的「余额 → 课表」被破坏");
}

/* ---------- [5] 排序不改变集合，只改顺序 ---------- */
{
  const user = ["for-you", "notices", "balance-strip", "classes", "homework", "reserve-lib", "next-class"];
  const items = user.map((id) => ({ id }));
  const sorted = H.applyHomeTimeOrder(items, { now: at(7, 0), events: AM });
  assert.deepEqual(
    [...sorted.map((x) => x.id)].sort(),
    [...user].sort(),
    "时段推荐把卡片集合改了（优先必须是排序，不是过滤/隐藏）",
  );
  assert.deepEqual(
    sorted.map((x) => x.id),
    ["classes", "notices", "for-you", "balance-strip", "homework", "reserve-lib", "next-class"],
    "优先项没有提前，或未点名卡片没有保持用户相对顺序",
  );
  // 排序稳定：同优先级（余额两张卡）保持用户相对顺序
  const two = ["cardEntry", "balance-strip", "for-you"].map((id) => ({ id }));
  assert.deepEqual(
    H.applyHomeTimeOrder(two, { now: at(12, 0), events: AM }).map((x) => x.id),
    ["cardEntry", "balance-strip", "for-you"],
    "同优先级的卡片应保持用户相对顺序（不是固定顺序）",
  );
  // 开关关闭/已手动编辑 → 一律用户顺序
  assert.deepEqual(H.applyHomeTimeOrder(items, null).map((x) => x.id), user, "推荐关闭时必须原样用用户顺序");
}

/* ---------- [6] 开关与自动关闭 ---------- */
{
  assert.equal(H.HOME_ORDER_KEY, "onethu.home.timeorder.v1", "开关持久化键被改动了（真机取证要按这个键看）");
  assert.deepEqual(H.loadHomeOrder(), { mode: "auto", edited: false, order: [] }, "「时段推荐」默认必须是开");
  assert.ok(H.isTimeOrderActive(H.loadHomeOrder()), "默认状态应按时段推荐排序");

  // 用户动过排序或显隐任一项 → 自动关闭
  const edited = H.markHomeManualEdit(H.loadHomeOrder());
  assert.equal(edited.mode, "manual", "手动编辑后开关必须自动关闭");
  assert.equal(edited.edited, true, "必须记住「用户手动编辑过」");
  assert.ok(!H.isTimeOrderActive(edited), "手动编辑后必须一律用用户顺序");

  // 拨开关能重新打开（不是死键）：明确打开 = 重新按时段排
  const again = H.setHomeTimeOrder(edited, true);
  assert.ok(H.isTimeOrderActive(again), "手动拨开开关后必须能重新按时段推荐排序");
  assert.ok(!H.isTimeOrderActive(H.setHomeTimeOrder(again, false)), "关掉开关后必须回到用户顺序");

  // 持久化 + 坏数据兜底
  H.saveHomeOrder({ mode: "manual", edited: true, order: ["classes", "homework"] });
  assert.deepEqual(H.loadHomeOrder(), { mode: "manual", edited: true, order: ["classes", "homework"] }, "开关/用户顺序没有落盘");
  assert.deepEqual(H.parseHomeOrder("{坏数据"), H.DEFAULT_HOME_ORDER, "损坏存储必须退回默认（开），不得抛错");
  assert.deepEqual(
    H.parseHomeOrder(JSON.stringify({ mode: "什么", edited: "yes", order: [1, "classes", null] })),
    { mode: "auto", edited: false, order: ["classes"] },
    "非法字段必须被过滤，合法部分保留",
  );
}

/* ---------- [7] 页面接线（编辑界面开关 / now 参数 / tick / 自动关闭三处） ---------- */
{
  const today = read("apps/desktop/src/pages/Today.tsx");
  const i = today.indexOf('data-order-switch="time"');
  assert.ok(i > 0, "编辑界面没有「时段推荐」开关");
  assert.ok(today.slice(Math.max(0, i - 220), i).includes("{editing ?"), "开关必须只在编辑界面出现");
  assert.ok(/<Switch/.test(today) && /时段推荐/.test(today), "开关必须用既有 Switch 组件并带「时段推荐」标签");
  assert.ok(
    /useState<HomeOrderState>\(\(\) => loadHomeOrder\(\)\)/.test(today),
    "开关初始值没有走 loadHomeOrder（默认开）",
  );
  assert.ok(/now: orderNow/.test(today), "排序没有把 now 参数传进去（真机 mock / 单测要靠它）");
  assert.ok(/window\.setInterval\(tick, 60_000\)/.test(today), "没有每分钟 tick——跨时段边界不会实时重排");
  const manual = [...today.matchAll(/setOrderState\(markHomeManualEdit\)/g)].length;
  assert.equal(manual, 3, "动排序/显隐三处（列内移动、隐藏、加回）都必须自动关闭时段推荐");
  assert.ok(/sortPlacedByTimeOrder\(/.test(today), "今日页没有走 sortPlacedByTimeOrder（推荐只能改展示序）");
  assert.ok(!/__onethuHomeMock/.test(read("apps/desktop/src/state/homeOrder.ts")), "mock 钩子不许写进状态模块（只走页面 globalThis）");
  assert.ok(/__onethuHomeMock/.test(today), "真机 DoD 的 mock 钩子不见了（now / events 要靠它注入）");
}

console.log(
  "home-timeorder-test: 全部断言通过（24h 无空档覆盖 + 休息日取自课表 + 五时段规则表 + 晚课延长跨 21:00 + 开关自动关闭 + 排序不改集合）",
);
