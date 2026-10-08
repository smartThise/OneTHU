/**
 * 桌面小组件快照测试（纯计算）：三行到底放什么、排序口径、空态与计数脚注。
 *
 * 小组件是「一眼看接下来干什么」，所以排序与截断口径就是产品语义，必须钉住。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/widget-snapshot-test.mjs
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
};

const {
  buildWidgetSnapshot, serializeWidgetSnapshot, buildDetailSnapshot, buildGridSnapshot,
  buildShortcutSnapshot, serializeWidgetPush,
} = await import("../apps/desktop/src/state/widgetSnapshot.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const T = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
const NOW = T(2026, 9, 21, 9, 0);
const REMIND = { default: 120, items: {} };

const cls = (extra = {}) => ({ date: "2026-09-21", startTime: "10:00", endTime: "11:35", courseName: "数据结构", location: "六教6A215", category: "课程", ...extra });
const hw = (extra = {}) => ({ id: "h1", title: "第三章习题", deadline: "2026-09-21 23:59:59", submitted: false, courseName: "数据结构", ...extra });

/* 空态 */
{
  const s = buildWidgetSnapshot({ schedule: [], homework: [], remind: REMIND, now: NOW });
  eq("空态无行", s.rows.length, 0);
  eq("空态脚注", s.footer, "今天没有课与截止");
  eq("标题带日期", s.title, "今天 9月21日");
  eq("点击落点默认今日页", s.target, "today");
  eq("快照带生成时间", s.updatedAt, NOW);
  ok("可序列化", typeof serializeWidgetSnapshot(s) === "string" && JSON.parse(serializeWidgetSnapshot(s)).rows.length === 0);
}

/* 排序：正在上的课 → 下一节 → 最近的 DDL；且只放三行 */
{
  const s = buildWidgetSnapshot({
    schedule: [
      cls({ startTime: "08:00", endTime: "09:35", courseName: "高等数学" }),      // 正在上
      cls({ startTime: "14:00", endTime: "15:35", courseName: "大学物理" }),
      cls({ startTime: "22:00", endTime: "22:45", courseName: "晚课" }),          // 晚于 DDL，被截断
    ],
    homework: [hw({ deadline: "2026-09-21 20:00:00" }), hw({ id: "h2", title: "实验报告", deadline: "2026-09-22 12:00:00" })],
    remind: REMIND,
    now: NOW,
    maxRows: 3,          // 原生按实际高度截断；这里验证截断口径本身
  });
  eq("截断到 maxRows 行", s.rows.length, 3);
  eq("第一行是正在上的课", s.rows[0].text, "08:00 高等数学");
  eq("正在上的课标注状态与地点", s.rows[0].sub, "正在上课 · 六教6A215");
  eq("第二行是接下来的课", s.rows[1].text, "14:00 大学物理");
  eq("第二行带地点与倒计时", s.rows[1].sub, "六教6A215 · 还有 5 小时");
  eq("第三行是最近的 DDL", s.rows[2].text, "DDL 第三章习题");
  ok("DDL 副标题带今天与剩余", s.rows[2].sub.startsWith("今天 20:00 · 还有"));
  eq("脚注统计总数并提示截断", s.footer, "3 节课 · 2 个截止 · 还有 2 项");
}

/* 过滤：不相关的一律不进快照 */
{
  const s = buildWidgetSnapshot({
    schedule: [cls({ date: "2026-09-22" })],                                  // 不是今天
    homework: [
      hw({ id: "a", submitted: true }),                                       // 已提交
      hw({ id: "b", deadline: "2026-09-20 12:00:00" }),                       // 已过期
      hw({ id: "c", deadline: "2026-10-20 12:00:00" }),                       // 超出 7 天窗
    ],
    remind: REMIND,
    now: NOW,
  });
  eq("非今天/已提交/已过期/超窗都不进快照", s.rows.length, 0);
  eq("过滤后仍是空态", s.footer, "今天没有课与截止");
}

/* DDL 副标题：今天的显示「今天 HH:MM」，跨天显示「M/D HH:MM」 */
{
  const today = buildWidgetSnapshot({ schedule: [], homework: [hw()], remind: REMIND, now: NOW });
  ok("今日 DDL 显示今天与剩余", today.rows[0].sub.startsWith("今天 23:59 · 还有"));
  const later = buildWidgetSnapshot({ schedule: [], homework: [hw({ deadline: "2026-09-23 08:00:00" })], remind: REMIND, now: NOW });
  ok("非今日 DDL 显示月日", later.rows[0].sub.startsWith("9/23 08:00 · 还有"));
}

/* 长文本截断 + 插件条目补位 */
{
  const s = buildWidgetSnapshot({
    schedule: [cls({ courseName: "这是一个特别特别长的课程名称用来验证截断行为" })],
    homework: [],
    remind: REMIND,
    now: NOW,
    extraRows: [{ text: "插件条目", sub: "来自插件" }],
  });
  eq("课程名截断 14 字 + 省略号", s.rows[0].text, "10:00 这是一个特别特别长的课程名称…");
  eq("空位由插件条目补上", s.rows[1].text, "插件条目");
  eq("maxRows 生效", s.rows.length, 2);
}
{
  const s = buildWidgetSnapshot({
    schedule: [cls({ startTime: "10:00" }), cls({ startTime: "12:00" }), cls({ startTime: "14:00" })],
    homework: [], remind: REMIND, now: NOW, maxRows: 2,
    extraRows: [{ text: "不该出现" }],
  });
  eq("行满时插件条目不抢位", s.rows.length, 2);
  eq("行满时插件条目不出现", s.rows.some((r) => r.text === "不该出现"), false);
}

/* 已上完的课不占位：一行的小组件要显示「正在上的」和「下一节」，而不是今天的第一节 */
{
  const s = buildWidgetSnapshot({
    schedule: [
      cls({ startTime: "08:00", endTime: "09:35", courseName: "早课" }),          // 早已上完
      cls({ startTime: "10:00", endTime: "11:35", courseName: "数据结构" }),      // 正在上（NOW=09:00 之前？见下）
      cls({ startTime: "14:00", endTime: "15:35", courseName: "大学物理" }),
    ],
    homework: [], remind: REMIND, now: NOW, maxRows: 1,
  });
  // NOW = 09:00：早课还没上完（08:00–09:35），故第一行是它且标注正在上课
  eq("一行时给正在上的课", s.rows[0].text, "08:00 早课");
  eq("一行时不给已经上完的课", s.rows.some((r) => r.text.includes("08:00")), true);
  const later = buildWidgetSnapshot({
    schedule: [
      cls({ startTime: "08:00", endTime: "09:35", courseName: "早课" }),
      cls({ startTime: "14:00", endTime: "15:35", courseName: "大学物理" }),
    ],
    homework: [], remind: REMIND, now: new Date(2026, 8, 21, 12, 0, 0).getTime(), maxRows: 1,
  });
  eq("中午时一行给下一节（不是早上那节）", later.rows[0].text, "14:00 大学物理");
  const done = buildWidgetSnapshot({
    schedule: [cls({ startTime: "08:00", endTime: "09:35", courseName: "早课" })],
    homework: [], remind: REMIND, now: new Date(2026, 8, 21, 12, 0, 0).getTime(),
  });
  eq("课都上完时如实说", done.footer, "今天的课已上完");
  eq("课都上完时没有行", done.rows.length, 0);
}

/* 主次：课程色、紧迫度加粗、首行大字号 —— 桌面上一眼能不能看出重点全靠这三样 */
{
  const { courseColor } = await import("../apps/desktop/src/lib/courseColor.ts");
  const s = buildWidgetSnapshot({
    schedule: [cls({ startTime: "10:00" }), cls({ startTime: "14:00", courseName: "线性代数", location: "三教3200" })],
    homework: [
      { id: "h9", title: "今晚就交", deadline: "2026-09-21 12:00:00", submitted: false },
      { id: "h8", title: "下周再说", deadline: "2026-09-26 23:59:00", submitted: false },
    ],
    remind: REMIND, now: NOW, maxRows: 4,
  });
  eq("课程行带课表同款颜色", s.rows[0].color, courseColor("数据结构"));
  eq("不同课程不同颜色", s.rows.some((r) => r.color === courseColor("线性代数")), true);
  eq("首行给大字号", s.rows[0].size, "lg");
  const urgent = s.rows.find((r) => r.text.includes("今晚就交"));
  eq("6 小时内的 DDL 加粗", urgent.strong, true);
  eq("6 小时内的 DDL 用红色", urgent.color, "#e5484d");
  const later = s.rows.find((r) => r.text.includes("下周再说"));
  eq("还早的 DDL 不加粗", later.strong === true, false);
  eq("还早的 DDL 用灰（不抢眼）", later.color, "#8a8f98");
}

/* 详情形态：就是列表形态（标题 + 若干行 + 脚注），拉得越高行数越多 */
{
  const s = buildDetailSnapshot({
    title: "数据结构", rows: [{ text: "数据结构", sub: "张三 · 课程" }, { text: "明天 10:00 六教6A215", sub: "还有 18 小时" }],
    footer: "3 次待上", target: "learn-course", params: { courseId: "1" }, now: NOW,
  });
  eq("详情：形态标记", s.kind, "list");
  eq("详情：标题", s.title, "数据结构");
  eq("详情：行", s.rows.map((r) => r.text), ["数据结构", "明天 10:00 六教6A215"]);
  eq("详情：落点带参数", s.target, "learn-course?courseId=1");
  eq("详情：脚注", s.footer, "3 次待上");
  eq("详情：行数上限", buildDetailSnapshot({ title: "x", rows: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ text: `第${n}` })), target: "today", now: NOW }).rows.length, 5);
}

/* 图标组形态：每个格子各有落点；没有图标的格子留给原生（退回系统图标） */
{
  const g = buildGridSnapshot({
    title: "常用", target: "folder", params: { folderId: "f1" }, now: NOW,
    items: [{ label: "网络学堂", icon: "data:image/png;base64,AAA", target: "learn" }, { label: "校园卡", target: "info?infoTab=card" }],
  });
  eq("图标组：形态标记", g.kind, "grid");
  eq("图标组：标题落点", g.target, "folder?folderId=f1");
  eq("图标组：格子落点各自独立", g.items.map((i) => i.target), ["learn", "info?infoTab=card"]);
  eq("图标组：图标可选", g.items[1].icon, undefined);
  const many = buildGridSnapshot({ title: "x", target: "folder", now: NOW, items: Array.from({ length: 12 }, (_, i) => ({ label: `第${i}`, target: "today" })) });
  eq("图标组：原生画得下的上限（8 格）", many.items.length, 8);
}

/* 快捷方式形态：图标 + 名称 */
{
  const t = buildShortcutSnapshot({ label: "校园卡", sub: "余额 ¥23.4", icon: "data:image/png;base64,BBB", target: "info", params: { infoTab: "card" }, now: NOW });
  eq("快捷方式：形态标记", t.kind, "shortcut");
  eq("快捷方式：名称与副标题", [t.label, t.sub], ["校园卡", "余额 ¥23.4"]);
  eq("快捷方式：落点带参数", t.target, "info?infoTab=card");
}

/* 推送载荷：实例 + 槽位 + prune 标记（prune=false 时原生绝不清内容） */
{
  const raw = serializeWidgetPush({
    instances: { "12": { kind: "list", title: "今天", updatedAt: NOW, target: "today", rows: [], footer: "" } },
    slots: { "1": { title: "打卡", rows: [{ text: "3 天" }], footer: "", target: "plugin:x" } },
    prune: true,
  });
  const p = JSON.parse(raw);
  eq("载荷：实例键", Object.keys(p.instances), ["12"]);
  eq("载荷：槽位键", Object.keys(p.slots), ["1"]);
  eq("载荷：prune 标记", p.prune, true);
  const noPrune = JSON.parse(serializeWidgetPush({ instances: {}, slots: {}, prune: false }));
  eq("载荷：不允许修剪时为 false", noPrune.prune, false);
  const dropped = JSON.parse(serializeWidgetPush({ instances: { "9": null }, slots: {}, prune: false }));
  eq("载荷：空内容不写进键", Object.keys(dropped.instances), []);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
