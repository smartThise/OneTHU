#!/usr/bin/env node
/**
 * 分段控件一致性护栏（B3 / B4，霖 2026-10-02）。
 *
 * 背景：设置页 / 通知页 / 课程详情页用的是全局分段控件 `SegmentedOverflow`（`.segmented` +
 * 滑动胶囊 `.seg-pill` + `is-active`，溢出时带位置指示条）。而「更多 info 应用」的分类标签是
 * 自建的一套 chip（`chip-blue` / `chip-gray` 当选中态），「插件」页的「全部 / 主题 / 通用」
 * 与市场排序又用了 `.seg-track` + `.seg-item`（滚动条样式，R23 已经因为「全宽拉伸 + 抓手光标 +
 * 11px 小字」返工过一次）。B3 / B4 就是把这三处收敛到同一个控件上。
 *
 * 钉住：
 *   ① 两处页面必须用 `SegmentedOverflow`；
 *   ② 页面里不许再出现 `.seg-item` / `.seg-track` 手写切换器（`SegmentedOverflow` 内部用的是
 *      `segmented seg-track`，所以只在**页面源码**里查，不查组件本身）；
 *   ③ 「更多 info 应用」不许再用 chip 当分类选中态（`chip-blue` / `chip-gray`）；
 *   ④ 分段控件的三件套（容器 `.segmented`、胶囊 `.seg-pill`、选中 `is-active`）都在组件里齐全。
 */
import { readFileSync } from "node:fs";

/* 先剥注释：B3/B4 的说明注释里就写着 chip-blue / seg-item 这些被取代的类名 */
const strip = (t) => t.replace(/\{[\s\S]*?\}/g, (m) => (m.includes("/*") ? " " : m)).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const OTHER = strip(readFileSync("apps/desktop/src/pages/OtherInfoPage.tsx", "utf8"));
const PLUGINS = strip(readFileSync("apps/desktop/src/pages/Plugins.tsx", "utf8"));
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 两处页面必须用统一分段控件 */
ok(/SegmentedOverflow/.test(OTHER), "B3：「更多 info 应用」的分类标签没有用统一分段控件 SegmentedOverflow");
ok(/ariaLabel="Info 应用分类"/.test(OTHER), "B3：分段控件没有无障碍名（Info 应用分类）");
ok(/SegmentedOverflow/.test(PLUGINS), "B4：「插件」页没有用统一分段控件 SegmentedOverflow");
ok((PLUGINS.match(/<SegmentedOverflow/g) ?? []).length >= 2, "B4：「插件」页的分区与市场排序都该换成统一分段控件");

/* ② 页面里不许再手写 seg-track / seg-item 切换器 */
ok(!/className="seg-item/.test(PLUGINS), "B4：插件页还在手写 .seg-item 切换器");
ok(!/<div className="seg-track">/.test(PLUGINS), "B4：插件页还在手写 .seg-track 容器");
ok(!/className="seg-track"/.test(OTHER), "B3：Info 页还在手写 .seg-track 容器");

/* ③ chip 不许当分类选中态（选中态只走分段控件的 is-active） */
ok(!/chip-blue|chip-gray/.test(OTHER), "B3：Info 页仍用 chip-blue/chip-gray 当选中态（自建 tab 容器）");
ok(!/className="chips"/.test(OTHER), "B3：Info 页仍有自建的 .chips 分类容器");

/* ④ 统一控件本身的三件套 */
ok(/className="segmented seg-track"/.test(LAYOUT), "分段控件的容器类名变了（不再是 segmented seg-track）");
ok(/className="seg-pill"/.test(LAYOUT), "分段控件丢了滑动胶囊 .seg-pill");
ok(/useSegPill/.test(LAYOUT), "分段控件没有量胶囊位置的 useSegPill");
ok(/role="tablist"/.test(LAYOUT), "分段控件丢了 tablist 语义");

console.log(
  fails.length
    ? "分段控件一致性护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "分段控件一致性护栏：Info 分类 + 插件分区/排序都收敛到 SegmentedOverflow（胶囊 + is-active）✓",
);
process.exit(fails.length ? 1 : 0);
