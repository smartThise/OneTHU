#!/usr/bin/env node
/**
 * E9 护栏：「返回在左上、主操作在右上」由头部布局类固化，页面不再各自摆位。
 *
 * 由来（docs/ui-ux-polish-detailed.md §6 E9）：返回按钮此前混在右上 actions 里
 * （有的页在右、有的页裸放在正文顶部），位置随页面而变。现在 PageHead 出三段结构：
 * page-head-main（page-head-back + page-head-text）在左、page-head-actions 在右。
 *
 *   1. PageHead 必须有 back 槽，且渲染顺序是 back 先于 title；
 *   2. 全仓不许再有「不在 back 槽里」的 BackButton（也就是不许再塞进 actions）；
 *   3. 抽 6 个页面对照（作业/通知/文件/课程/雨课堂/讨论区）必须都给了 back；
 *   4. CSS 三个类必须在位，返回槽不许被压扁（flex-shrink: 0）。
 *
 * 跑法：node tools/head-layout-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const LAYOUT = "apps/desktop/src/components/Layout.tsx";
const CSS = "apps/desktop/src/styles/global.css";
/** E9 抽样的 6 个页面（霖验收口径：任意页返回都在左上） */
const SAMPLES = [
  "apps/desktop/src/pages/learn/AssignmentDetailPage.tsx",
  "apps/desktop/src/pages/learn/NoticeDetailPage.tsx",
  "apps/desktop/src/pages/learn/FileDetailPage.tsx",
  "apps/desktop/src/pages/learn/CourseDetailPage.tsx",
  "apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx",
  "apps/desktop/src/pages/learn/Forum.tsx",
];

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const maskComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));

const layoutRaw = readFileSync(LAYOUT, "utf8");
const layout = maskComments(layoutRaw);
const css = readFileSync(CSS, "utf8");

/* ① PageHead 的 back 槽与渲染顺序 */
ok(/back\?: ReactNode;/.test(layout), "PageHead 没有 back 槽");
/** 从函数起点按花括号配对取完整函数体（曾用 /\n\}/ 截到形参收尾的大括号，断言全假） */
function fnBody(src, name) {
  const i = src.indexOf(`export function ${name}(`);
  if (i < 0) return "";
  /* 先括号配对跳过形参列表（形参里也有花括号，直接配对花括号会停在形参收尾） */
  let depth = 0;
  let j = src.indexOf("(", i);
  for (; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  /* 再从函数体开括号配对到收尾 */
  depth = 0;
  for (let k = src.indexOf("{", j); k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) return src.slice(i, k + 1);
    }
  }
  return "";
}
const head = fnBody(layout, "PageHead");
ok(!!head, "解析不到 PageHead 函数体");
ok(/className="page-head-main"/.test(head), "PageHead 没有 page-head-main 左段");
ok(/className="page-head-back"/.test(head), "PageHead 没有 page-head-back 返回槽");
const iBack = head.indexOf("page-head-back");
const iText = head.indexOf("page-head-text");
const iActions = head.indexOf("page-head-actions");
ok(iBack > 0 && iText > iBack, "PageHead 里返回槽没有排在标题之前（位置就不在左上了）");
ok(iActions > iText, "PageHead 里主操作没有排在标题之后（位置就不在右上了）");

/* ② 全仓 BackButton 必须都在 back 槽里 */
const { execSync } = await import("node:child_process");
const hits = execSync("grep -rn '<BackButton' apps/desktop/src --include=*.tsx || true", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
ok(hits.length >= 10, `BackButton 用法数异常（${hits.length}）——解析规则可能失效`);
for (const h of hits) {
  ok(/back=\{<BackButton/.test(h), `BackButton 不在 back 槽里（会漂到右上或正文顶部）：${h.split(":")[0]}`);
}

/* ③ 抽样页面都给了 back */
for (const f of SAMPLES) {
  const t = maskComments(readFileSync(f, "utf8"));
  ok(/back=\{/.test(t), `${f} 的头部没有 back 槽（返回位置未统一）`);
  ok(!/actions=\{[^}]*BackButton/.test(t), `${f} 仍把 BackButton 放在 actions 里`);
}

/* ④ CSS 布局类 */
ok(/\.page-head-main \{/.test(css), "缺 .page-head-main 样式");
ok(/\.page-head-back \{[^}]*flex-shrink: 0/.test(css), ".page-head-back 没有 flex-shrink: 0（窄屏会被标题挤扁）");
ok(/\.page-head-text \{[^}]*min-width: 0/.test(css), ".page-head-text 没有 min-width: 0（长标题会把右上操作顶出屏幕）");
ok(/\.page-head-actions \{/.test(css), "缺 .page-head-actions 样式");
/* ⑤ 窄屏换行后仍要贴右：手机端媒体查询按 M1 定稿允许 .page-head 换行，
      长标题（课程详情实测 main 占满 358px）会把 actions 挤到第二行；实测那次
      收藏星落在 left=16。actions 只有带 auto 左外边距才能在换行行里贴右缘。 */
const actionsRule = (/\.page-head-actions \{[^}]*\}/.exec(css) ?? [""])[0];
ok(/margin-left:\s*auto/.test(actionsRule), ".page-head-actions 没有 margin-left: auto（换行后收藏/刷新会掉到左缘）");

if (fails.length) {
  console.error("头部布局护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`头部布局护栏：PageHead 三段结构（back 在左上、actions 在右上）+ ${hits.length} 处 BackButton 全在 back 槽 + ${SAMPLES.length} 个抽样页 + CSS 三类到位 ✓`);
