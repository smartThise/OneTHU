#!/usr/bin/env node
/** 宿舍页电费左右分栏 + OG Input 单边框回归（静态契约，保护 CSS/结构不被改回去）。 */
import { readFile } from "node:fs/promises";
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const [dorm, css, zh, en] = await Promise.all([
  read("apps/desktop/src/pages/info/DormTab.tsx"),
  read("apps/desktop/src/styles/global.css"),
  read("apps/desktop/src/i18n/locales/zh-CN.ts"),
  read("apps/desktop/src/i18n/locales/en-US.ts"),
]);
ok(dorm.includes('className="dorm-elec card-two-col"'), "电费使用左右分栏容器");
ok(dorm.includes('className="elec-hero"') && dorm.includes('className="elec-metrics"'), "左侧突出余额 + 指标");
ok(dorm.includes('className="card-col-side"') && dorm.includes('className="list"'), "右侧充值记录列表");
ok(dorm.includes("recentRecharge"), "近一月充值由流水派生");
ok(dorm.includes('className="dorm-water-card"') && !dorm.includes("<Card style={{ padding: 18 }}>"), "订水卡 padding 加在卡片自身，避免外层 div 缩窄");
ok(css.includes(".dorm-water-card { padding: 18px; }"), "订水卡宽度与电费卡对齐");
ok(css.includes(".elec-hero-value") && css.includes(".elec-metrics"), "电费分栏样式存在");
ok(css.includes(".field input:not(.og-input-el)") && css.includes(".field > input:not(.og-input-el)"), "OG 内部 input 不再套第二层边框");
ok(!/^\.field input \{$/m.test(css), "没有遗留裸 .field input 规则");
ok(zh.includes('"pages.info.dormtab.b55720d8da5e": "近一月充值"') && en.includes("Recharged · 30d"), "指标文案已国际化");
if (fails.length) {
  console.error("dorm-ui-regression: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("dorm-ui-regression: 全部通过");
