#!/usr/bin/env node
/**
 * 日期文案护栏（工具：lib/dateText.ts）。
 *
 * 由来：2026-02 真机发现 Today 页头显示 "81月28日"。根因不是月份取错，而是裸 + 串接——
 * JS 的 + 从左往右算，第一个操作数是字符串时后面全程变字符串拼接，"" + 8 + 1 === "81"。
 * 所以这里既做**行为断言**（格式化函数本身对不对），也做**源码扫描**（别又有人在外面裸拼月份）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };
const SRC = "apps/desktop/src";

/* 1 行为断言：直接跑格式化函数 */
let behavioral = false;
try {
  const { fmtMonthDayWeek } = await import("../apps/desktop/src/lib/dateText.ts");
  behavioral = true;
  // 2026-09-28 是星期一（真机当时显示的日期）
  ok(fmtMonthDayWeek(new Date(2026, 8, 28)) === "9月28日 星期一", "2026-09-28 应为 9月28日 星期一，实为 " + fmtMonthDayWeek(new Date(2026, 8, 28)));
  ok(fmtMonthDayWeek(new Date(2026, 0, 1)) === "1月1日 星期四", "2026-01-01 应为 1月1日 星期四");
  ok(fmtMonthDayWeek(new Date(2025, 11, 31)) === "12月31日 星期三", "2025-12-31 应为 12月31日 星期三");
  // 全年逐日：月份必须是 1-2 位数字，且绝不能出现 "81月" 这类拼接残留
  let bad = 0;
  for (let m = 0; m < 12; m++) {
    for (let day = 1; day <= 28; day++) {
      const s = fmtMonthDayWeek(new Date(2026, m, day));
      if (!/^\d{1,2}月\d{1,2}日 星期[日一二三四五六]$/.test(s)) bad++;
    }
  }
  ok(bad === 0, "全年逐日格式测试有 " + bad + " 天格式不对");
} catch (e) {
  fails.push("行为断言跑不起来（当前 node 不能直接 import TS？）：" + e.message);
}

/* 2 源码扫描：裸拼月份（形如 某个字符串 + x.getMonth() + 1 + "月"）应当为 0 处 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const naked = [];
for (const f of walk(SRC)) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((ln, i) => {
    const trimmed = ln.trim();
    // 跳过注释行：注释里会写反例
    if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*")) return;
    if (!/月"/.test(ln)) return;
    if (!/getMonth\(\)/.test(ln)) return;
    if (/fmtMonthDayWeek|\$\{/.test(ln)) return;
    naked.push(f.replace(SRC + "/", "") + ":" + (i + 1) + " " + ln.trim().slice(0, 70));
  });
}
ok(naked.length === 0, "有 " + naked.length + " 处仍在裸拼月份（请用 lib/dateText.ts 的 fmtMonthDayWeek）：\n    " + naked.join("\n    "));

/* 3 Today 页头必须走格式化函数（防止有人把 '' + getMonth() 那种写法改回去） */
const today = readFileSync("apps/desktop/src/pages/Today.tsx", "utf8");
ok(/fmtMonthDayWeek\(now\)/.test(today), "Today 页头 meta 应调用 fmtMonthDayWeek(now)");

console.log(
  fails.length
    ? "日期文案护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "日期文案护栏：行为断言" + (behavioral ? "✓（2026-09-28 → 9月28日 星期一，全年逐日 336 天格式检查）" : "跳过") + " 裸拼月份 0 处 ✓ Today 走格式化函数 ✓",
);
process.exit(fails.length ? 1 : 0);
