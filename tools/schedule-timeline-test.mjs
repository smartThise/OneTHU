#!/usr/bin/env node
/**
 * C9 日程时间轴护栏（霖 2026-10-01 走查）。
 * 口径：默认窗口 06:00–24:00、打开即「尽收眼底」（不用手动滚）、「时段 / 同步到系统日历 /
 * 手动切换学期」三处收进顶栏二级菜单，工具栏只留「时间轴 / 列表」与日期切换。
 * 护栏钉住这四条，防止后续批次把默认窗口改回全天、或把轴高又写死。
 */
import { readFileSync } from "node:fs";

const WIN = readFileSync("apps/desktop/src/state/scheduleWindow.ts", "utf8");
const SCHED = readFileSync("apps/desktop/src/pages/Schedule.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 默认窗口 06:00–24:00 */
ok(/export const DEFAULT_WINDOW: ScheduleWindow = \{ from: 6 \* 60, to: 1440 \}/.test(WIN), "默认窗口不是 06:00–24:00");
const load = WIN.slice(WIN.indexOf("function load()"), WIN.indexOf("let current"));
ok(!/return FULL_DAY/.test(load), "load() 兜底还在用全天（默认窗口会退回 0–24）");
ok(/return DEFAULT_WINDOW/.test(load), "load() 没有兜到 DEFAULT_WINDOW");

/* ② 三处入口在二级菜单里 */
for (const [key, label] of [["window", "显示时段…"], ["syscal", "同步到系统日历"], ["semweek", "跳转学期 / 周…"]]) {
  ok(new RegExp('key: "' + key + '"').test(SCHED), "顶栏二级菜单里没有 " + label + " 这一项");
}
ok(/label: "显示时段…"/.test(SCHED) && /"跳转学期 \/ 周…"/.test(SCHED), "二级菜单两项文案缺失");

/* ③ 工具栏里不再有它们（只留视图切换与日期切换） */
ok(!/时段 \{hhmmWin\(win\.from\)\}–\{hhmmWin\(win\.to\)\}/.test(SCHED), "工具栏还留着「时段」按钮");
const toolbar = SCHED.slice(SCHED.indexOf("{/* 视图与动作"), SCHED.indexOf("{winOpen ? ("));
ok(!/onSystemCal\(\)/.test(toolbar), "工具栏还留着「同步到系统日历」按钮");
ok(!/<select/.test(toolbar), "工具栏里还有下拉（学期/周应已收进二级菜单面板）");
ok(/时间轴"\], \["agenda", "列表"/.test(SCHED), "工具栏的「时间轴 / 列表」切换不见了");
/* 学期/周面板整份只有一处（不会两边各留一份） */
const semSelects = [...SCHED.matchAll(/semesters\.map\(\(sm, i\) =>/g)].length;
ok(semSelects === 1, "学期下拉出现了 " + semSelects + " 处（应只在二级菜单面板里有一处）");

/* ④ 轴高取自可视区，不是写死 */
ok(/let PX_PER_MIN = /.test(SCHED), "PX_PER_MIN 还是 const（写死的轴高会把 06–24 推出屏幕）");
ok(/window\.innerHeight/.test(SCHED) && /axisAvail/.test(SCHED), "轴高没有按视口高现算");
ok(/PX_PER_MIN = Math\.min\(PX_PER_MIN_MAX, Math\.max\(PX_PER_MIN_MIN, axisAvail \/ axisMinutes\)\)/.test(SCHED),
  "轴高没有夹在上下限内按「可用高 ÷ 窗口分钟数」折算");
ok(/const axisFits = canvasH <= axisAvail/.test(SCHED) && /mode !== "timetable" \|\| axisFits/.test(SCHED),
  "整窗放得下时仍在自动滚动（应打开即尽收眼底）");

console.log(
  fails.length
    ? "日程时间轴护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "日程时间轴护栏：默认 06–24 ✓ 三入口进二级菜单 ✓ 工具栏只剩视图/日期切换 ✓ 轴高按视口自适应、放得下不滚 ✓",
);
process.exit(fails.length ? 1 : 0);
