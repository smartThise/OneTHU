#!/usr/bin/env node
/**
 * 数字递增护栏（D4，霖 2026-10-02）。
 *
 * 口径（文档 D4）：rAF 从 0 爬到目标、默认 600ms、**每次进入页面只播一次**（本挂载周期用 ref
 * 记住，数据刷新不重播；离开再进来重播）、`prefers-reduced-motion` 直接显示终值、数字容器
 * `font-variant-numeric: tabular-nums` 防抖。
 *
 * **反例**（文档 D4）：用 CSS 动画从 0 到目标——DOM 里始终是终值，读屏与复制会拿到错数字。
 * 所以这里额外钉住：不许出现 CSS 计数方案（`@property` 配合 `counter()` / `counter-reset`），
 * 也不许页面各自再写一份私有实现（上一版就是这样，`Mine.tsx` 里藏着 720ms 的私有 hook）。
 */
import { readFileSync, readdirSync } from "node:fs";

const COUNTUP = readFileSync("apps/desktop/src/components/CountUp.tsx", "utf8");
const MINE = readFileSync("apps/desktop/src/pages/Mine.tsx", "utf8");
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 共享实现：rAF + 默认时长常量 + 只播一次 + reduced-motion + 收尾写终值 */
ok(/export const COUNTUP_MS = 600;/.test(COUNTUP), "缺 COUNTUP_MS = 600（文档默认 600ms）");
ok(/requestAnimationFrame/.test(COUNTUP) && /cancelAnimationFrame/.test(COUNTUP), "不是 rAF 插值（或没在卸载时取消）");
ok(/const played = useRef\(false\)/.test(COUNTUP) && /played\.current/.test(COUNTUP), "没有「每个挂载周期只播一次」的 ref 记忆");
ok(/prefersReducedMotion\(\) \|\| played\.current/.test(COUNTUP), "缺 reduced-motion 降级（应与「已播过」走同一条直接置值分支）");
ok(/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/.test(COUNTUP), "reduced-motion 没有真读 matchMedia");
ok(/setText\(fmtRef\.current\(target\)\)/.test(COUNTUP), "收尾没有写终值（浮点插值末帧未必等于目标）");
ok(/fmtRef\.current = fmt/.test(COUNTUP), "格式化函数没有走 ref（每次渲染新箭头会导致动画重播/闭包过期）");
ok(/return "—"/.test(COUNTUP) || /"—"/.test(COUNTUP), "目标为 null 时没有占位符");

/* ② 页面不许再各写一份：私有 useCountUp / 直接 rAF 数数 */
ok(!/function useCountUp/.test(MINE), "Mine.tsx 还留着私有的 useCountUp（应统一用 components/CountUp.tsx）");
ok(/import \{ useCountUp \} from "\.\.\/components\/CountUp\.js";/.test(MINE), "Mine.tsx 没有从共享组件导入 useCountUp");
const uses = (MINE.match(/useCountUp\(/g) ?? []).length;
ok(uses >= 3, `Mine.tsx 只用到了 ${uses} 次 useCountUp（余额/学分/GPA 三处都该用）`);

/* 其它页面若也要展示型递增，必须用共享 hook，不许自己 rAF */
const pages = readdirSync("apps/desktop/src/pages", { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? [] : [e.name]))
  .filter((f) => /\.tsx$/.test(f) && f !== "Mine.tsx");
for (const f of pages) {
  const src = readFileSync("apps/desktop/src/pages/" + f, "utf8");
  if (/requestAnimationFrame/.test(src) && /countUp|CountUp/i.test(src)) {
    fails.push(`${f} 自己实现了数字递增（应用 components/CountUp.tsx 的 useCountUp）`);
  }
}

/* ③ 容器等宽字：递增时位宽变化不许让数字左右抖 */
const numRule = /\.mine-stat-num\s*\{([^}]*)\}/.exec(CSS);
ok(!!numRule && /font-variant-numeric:\s*tabular-nums/.test(numRule[1]), ".mine-stat-num 缺 font-variant-numeric: tabular-nums");

/* ③b 名字消歧：全应用只许有 components/CountUp.tsx 一份 useCountUp 定义
     （lib/motion.ts 里的数值滚动版已改名 useNumberRoll——两个同名不同语义是隐患） */
{
  const defs = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = d + "/" + e.name;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && /export function useCountUp\b/.test(readFileSync(p, "utf8"))) defs.push(p);
    }
  };
  walk("apps/desktop/src");
  ok(defs.length === 1 && defs[0].endsWith("components/CountUp.tsx"), "useCountUp 有多份定义（应只有 components/CountUp.tsx）：" + defs.join(" / "));
}

/* ③.5 真机 b13 实测：rAF 时间戳早于 t0 时首帧出现 ¥-0.08（负值闪一下）→ p 必须两侧夹紧 */
ok(/const p = Math\.min\(1, Math\.max\(0, \(t - t0\) \/ ms\)\)/.test(COUNTUP), "useCountUp 的 p 没有夹紧下界（首帧会闪负值）");

/* ④ 反例：CSS 计数方案（DOM 里是终值，读屏/复制会拿到错数字） */
ok(!/@property\s+--[^;]*syntax:\s*"<integer>"/.test(CSS), "CSS 里出现了 @property integer 计数方案（D4 反例）");
ok(!/counter-reset:\s*\w*count/i.test(CSS), "CSS 里出现了 counter-reset 计数方案（D4 反例）");

console.log(
  fails.length
    ? "数字递增护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "数字递增护栏：共享 useCountUp（rAF + 600ms + 只播一次 + reduced-motion）+ 三等宽字 ✓ 无 CSS 计数反例 ✓",
);
process.exit(fails.length ? 1 : 0);
