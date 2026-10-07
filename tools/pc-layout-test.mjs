#!/usr/bin/env node
/**
 * §2.8.2 逐页分端护栏（PC expanded）。
 * 这张表最容易退化成「文档写了、代码没做」——所以每行都钉一条，
 * 免得以后有人照着旧文字返工（邮件双栏就曾被误判成“没做”而差点重做一遍）。
 * 双端布局改到哪一行，就把哪一行的断言改掉，别只改文档。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const read = (p) => readFileSync(p, "utf8");
const TODAY = read("apps/desktop/src/pages/Today.tsx");
const TASKS = read("apps/desktop/src/pages/TasksPage.tsx");
const SCHED = read("apps/desktop/src/pages/Schedule.tsx");
const SVC = read("apps/desktop/src/pages/ServicesPage.tsx");
const FP = read("apps/desktop/src/components/FilePreview.tsx");

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 1 今日：expanded 分端 + 右栏卡 + 问候语缩进顶栏 */
ok(TODAY.includes("useExpanded"), "今日页未按 expanded 分端");
ok(CSS.includes(".next-class") && CSS.includes(".today-hero.is-slim"), "今日页缺右栏下一节课 / 缩顶栏样式");

/* 2 待办：列表-详情双栏 */
ok(/const wide = useExpanded\(\)/.test(TASKS), "待办页未按 expanded 分端");
ok(CSS.includes(".tasks-body.is-wide"), "待办页缺双栏样式");

/* 3 课表：compact 默认列表、PC 默认周视图 */
ok(/tier === "expanded" \? "timetable" : "agenda"/.test(SCHED), "课表默认模式未按 tier 分流");

/* 4 服务：PC 访问重定向到分组首个功能 */
ok(/重定向到分组首个功能/.test(SVC), "服务页缺 PC 重定向");

/* 6 成绩/信息类 tab：限宽 720 居中 + 表格放开全宽 */
ok(/:has\(> \.page-anim\[data-page="info"\]\)/.test(CSS), "信息类 tab 缺 PC 限宽");
ok(/:has\(table\)/.test(CSS), "信息类 tab 缺表格全宽放开");

/* 7 设置：限宽 720（二级是页签形态，见计划单 §2.8.2 该行注记） */
ok(/:has\(> \.page-anim\[data-page="settings"\]\)/.test(CSS), "设置页缺 PC 限宽");

/* 8 邮件：PC 双栏 + 窄屏收单列 */
ok(/grid-template-columns: 340px minmax\(0, 1fr\)/.test(CSS), "邮件页缺 PC 双栏");
ok(/\.mail-layout \{ grid-template-columns: minmax\(0, 1fr\)/.test(CSS), "邮件页窄屏未收成单列");

/* 9 文件预览：PC 居中大窗 + 附件信息栏（窄屏不渲染） */
ok(FP.includes("panelStyleWide"), "文件预览缺 PC 大窗");
ok(FP.includes('className="fp-info"') && FP.includes("expanded ? ("), "文件预览缺附件信息栏");
ok(/\.fp-info \{/.test(CSS) && CSS.includes("border-left"), "附件信息栏缺样式");

console.log(
  fails.length
    ? "分端护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "分端护栏：今日右栏 ✓ 待办双栏 ✓ 课表默认模式 ✓ 服务重定向 ✓ 信息/设置限宽 ✓ 邮件双栏 ✓ 文件预览信息栏 ✓",
);
process.exit(fails.length ? 1 : 0);
