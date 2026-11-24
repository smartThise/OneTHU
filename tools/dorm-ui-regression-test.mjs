#!/usr/bin/env node
/** 宿舍页拆分为电费/定水两个 tab、电费左右分栏、OG Input 单边框回归。 */
import { readFile } from "node:fs/promises";
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");
const [electric, water, life, css, zh, en, onboarding] = await Promise.all([
  read("apps/desktop/src/pages/info/ElectricityTab.tsx"),
  read("apps/desktop/src/pages/info/WaterTab.tsx"),
  read("apps/desktop/src/pages/info/LifePage.tsx"),
  read("apps/desktop/src/styles/global.css"),
  read("apps/desktop/src/i18n/locales/zh-CN.ts"),
  read("apps/desktop/src/i18n/locales/en-US.ts"),
  read("apps/desktop/src/state/onboarding.ts"),
]);
ok(life.includes('{ id: "elec"') && life.includes('{ id: "water"'), "生活页拆出电费/定水两个 tab");
ok(life.includes('<ElectricityTab />') && life.includes('<WaterTab />'), "两个 tab 各自挂载独立组件");
ok(life.includes('normalizeLifeTab') && life.includes('migrateLifeLayout'), "旧 dorm 布局/深链自动迁移");
ok(electric.includes('className="dorm-elec card-two-col"'), "电费使用左右分栏容器");
ok(electric.includes('className="elec-hero"') && electric.includes('className="elec-metrics"'), "左侧突出余额 + 指标");
ok(electric.includes('className="card-col-side"') && electric.includes("ListWindow fill"), "右侧充值记录使用定长 ListWindow");
ok(electric.includes("recentRecharge") && water.includes('className="dorm-water-card"'), "指标与订水独立组件");
ok(css.includes(".elec-hero-value") && css.includes(".elec-metrics"), "电费分栏样式存在");
ok(css.includes(".field input:not(.og-input-el)") && css.includes(".field > input:not(.og-input-el)"), "OG 内部 input 不再套第二层边框");
ok(!/^\.field input \{$/m.test(css), "没有遗留裸 .field input 规则");
ok(zh.includes('"pages.info.dormtab.b55720d8da5e": "近一月充值"') && en.includes("Recharged · 30d"), "指标文案已国际化");
ok(onboarding.includes('"elec", "water"'), "onboarding 栏目清单已迁移");
if (fails.length) {
  console.error("dorm-ui-regression: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("dorm-ui-regression: 全部通过");
