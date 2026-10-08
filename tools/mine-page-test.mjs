#!/usr/bin/env node
/**
 * G3 护栏：「我的」页（手机端底栏第 5 项）。
 *
 * 由来（docs/ui-ux-polish-detailed.md §12 G3，设计稿原 docs/mine.md）：M3 的 E3 版本是
 * 「三段 SectionHead + 通用列表」，霖走查判定排版混乱，给了新设计稿。本护栏盯死新稿里
 * 那些「静态截图看不出来、但一改就跑偏」的口径：
 *   ① 路由四处接线缺一不可：Page 联合类型 / TOP_PAGES / App 路由 / PAGE_TITLES；
 *   ② 三段**不列标题**（去掉 SectionHead 才是新稿的排布）；
 *   ③ 学生卡：结构齐（姓名/学号/院系/邮箱）、内部无分隔线、阴影照作业卡片、
 *      头像直径 = 卡片高度的一半（同一个变量算出来的比例，不许写死两处像素）；
 *   ④ 渐变过渡带：学生卡与三张数字卡之间**不画分界线**，靠 .mine-grad 的渐隐当隐形
 *      分界线；渐变走主题 token、有流动动画、DOM 顺序在卡片之后三卡之前；
 *   ⑤ 三张数字卡水平等分、不换行；数字有累加动画且降级到静态；
 *   ⑥ 五项服务的顺序与去向：设置 → 邮箱 → 云盘 → 成绩 → 我的收藏；
 *   ⑦ 底栏第 5 项是 mine，且 settings/mail/cloud/info 都归属 mine；
 *   ⑧ 只用既有 hook 出数：本页不许自己发请求 / 自己读缓存 / 自己写 localStorage。
 *
 * 跑法：node tools/mine-page-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const MINE = "apps/desktop/src/pages/Mine.tsx";
const CSS = "apps/desktop/src/styles/global.css";
const APP_TSX = "apps/desktop/src/App.tsx";
const STATE = "apps/desktop/src/state/app.tsx";
const TITLES = "apps/desktop/src/state/navigation.ts";
const OWNER = "apps/desktop/src/state/navOwner.ts";
const LAYOUT = "apps/desktop/src/components/Layout.tsx";

const maskComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
/* 取选择器规则体（花括号配对，够用即可） */
function block(src, sel) {
  const i = src.indexOf(sel);
  if (i < 0) return "";
  const from = src.indexOf("{", i);
  if (from < 0) return "";
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (!depth) return src.slice(from, j + 1);
    }
  }
  return "";
}

const rawMine = readFileSync(MINE, "utf8");
const mine = maskComments(rawMine);
const cssRaw = readFileSync(CSS, "utf8");
const css = maskComments(cssRaw);
const appTsx = maskComments(readFileSync(APP_TSX, "utf8"));
const state = maskComments(readFileSync(STATE, "utf8"));
const titles = maskComments(readFileSync(TITLES, "utf8"));
const owner = maskComments(readFileSync(OWNER, "utf8"));
const layout = maskComments(readFileSync(LAYOUT, "utf8"));

/* ① 路由四处接线 ---------------------------------------------------------- */
ok(/export function MinePage\(\)/.test(mine), "Mine.tsx 没有导出 MinePage");
ok(/"mine"/.test(/export type Page =([\s\S]*?);\n/.exec(state)?.[1] ?? ""), "Page 联合类型里没有 mine（路由进不来）");
ok(/"mine"/.test(/const TOP_PAGES = \[([^\]]+)\]/.exec(state)?.[1] ?? ""), "TOP_PAGES 里没有 mine（会落到 learn 兜底）");
ok(/\{page === "mine" && <MinePage \/>\}/.test(appTsx), "App.tsx 没有 mine 的路由渲染");
ok(/import \{ MinePage \} from "\.\/pages\/Mine\.js";/.test(appTsx), "App.tsx 没有引入 MinePage");
ok(/^\s*mine: "我的",/m.test(titles), "PAGE_TITLES 里 mine 不是「我的」（顶栏会显示错标题）");

/* ② 三段不列标题（新稿的第一条口径） ------------------------------------- */
ok(!/SectionHead/.test(mine), "「我的」页还在用 SectionHead（G3 明确要求三段不列标题）");
ok(!/个人信息<\/h|学习与生活<\/h|我的服务<\/h/.test(mine), "「我的」页又给三段加回了标题文字");

/* ③ 学生卡 ---------------------------------------------------------------- */
const cardBlock = block(css, ".mine-card {");
const avatarBlock = block(css, ".mine-avatar {");
const gradBlock = block(css, ".mine-grad {");
ok(!!cardBlock, "CSS 里找不到 .mine-card");
ok(!!avatarBlock, "CSS 里找不到 .mine-avatar");
ok(cardBlock.includes("var(--md-sys-color-surface-container-lowest)"), "学生卡底色不是 container-lowest（和作业卡片不同族）");
ok(/border-radius:\s*var\(--md-sys-shape-corner-large\)/.test(cardBlock), "学生卡圆角没走形状令牌");
/* 霖 2026-10-02 第四批 #8 覆盖了 §12 G3 的「阴影照作业卡片」：学生卡要更明显 */
ok(/box-shadow:\s*var\(--shadow-2\)/.test(cardBlock), "学生卡阴影不是更明显的那一档 --shadow-2（霖第四批 #8）");
ok(!/border-(top|bottom):/.test(cardBlock), "学生卡内部画了分隔线（设计稿明确「不要横线分隔」）");
ok(!/<hr\b/.test(mine), "「我的」页用了 <hr> 分界线");
const cardVar = /--mine-card-h:\s*(\d+)px/.exec(gradBlock)?.[1];
ok(!!cardVar, ".mine-grad 没有 --mine-card-h（父级取不到 var 会让 mask 整条失效，真机踩过）");
ok(!/--mine-card-h:/.test(cardBlock), "--mine-card-h 又挪回 .mine-card 了（父级 .mine-grad 的渐隐起点会取不到）");
/* 第四批 #8：直径 = 卡片高度的一半 × 3/4，比例仍由同一个变量保证 */
ok(
  new RegExp("width:\\s*calc\\(var\\(--mine-card-h\\)\\s*\\*\\s*3\\s*/\\s*8\\)").test(avatarBlock) &&
    new RegExp("height:\\s*calc\\(var\\(--mine-card-h\\)\\s*\\*\\s*3\\s*/\\s*8\\)").test(avatarBlock),
  "头像直径不是「卡片高度的一半 × 3/4」（应为 calc(var(--mine-card-h) * 3 / 8)，写死像素会和卡片高度脱钩）",
);
ok(
  /height:\s*var\(--mine-card-h\)/.test(cardBlock),
  "卡片高度没和 --mine-card-h 绑死（头像比例会被内容撑歪，实测会掉到 0.45）",
);
for (const [name, re] of [
  ["头像", /className="mine-avatar"/],
  ["姓名", /className="mine-name"/],
  ["学号", /className="mine-sid"/],
  ["院系标题", /<span className="mine-meta-label">院系<\/span>/],
  ["院系内容", /<span className="mine-meta-value">\{user\?\.department/],
  ["邮箱标题", /<span className="mine-meta-label">邮箱<\/span>/],
  ["邮箱内容", /<span className="mine-meta-value">\{email\}<\/span>/],
]) {
  ok(re.test(mine), `学生卡缺少${name}`);
}
/* 第四批 #8：标题与内容要分两栏（label 窄列 + value 占余宽），不能揉成一整句 */
{
  const metaBlock = block(css, ".mine-meta-line {");
  ok(
    /\.mine-meta-label \{[^}]*flex: none;[^}]*width: 32px;/.test(css) && /\.mine-meta-value \{[^}]*flex: 1;/.test(css) && !!metaBlock,
    "院系/邮箱没有分成「标题 + 内容」两栏（label 定宽窄列、value 占余宽）",
  );
}
/* 第四批 #7：三张数字卡与下面的服务列表之间要有间距 */
ok(/\.mine-services \{[^}]*margin-top: (\d+)px;/.test(css) && Number(/\.mine-services \{[^}]*margin-top: (\d+)px;/.exec(css)?.[1] ?? 0) % 4 === 0,
  "三张数字卡与服务列表之间没有间距（霖第四批 #7）");

/* ④ 渐变过渡带（隐形分界线） --------------------------------------------- */
const gradLayer = block(css, ".mine-grad::before {");
ok(!!gradBlock, "CSS 里找不到 .mine-grad（渐变过渡带）");
ok(!!gradLayer, "CSS 里找不到 .mine-grad::before（渐变必须画在独立一层上）");
ok(
  !/mask-image|background-image/.test(gradBlock),
  "渐变/遮罩又画回 .mine-grad 本身了——mask 会把三张数据卡一起淡掉（霖真机走查过）",
);
ok(/mask-image:/.test(gradLayer), "渐变层没有 mask 渐隐——那就成了一条看得见的分界线");
ok(/animation:\s*mine-grad-flow/.test(gradLayer), "渐变没有流动动画");
ok(/background-image:\s*linear-gradient\(/.test(gradLayer), "渐变层没有渐变背景");
/* 霖 2026-10-01 #1：色盘渐变——5 个停点由 Monet 从当前主题色算出来（不再是单色/两色） */
{
  ok(
    (gradLayer.match(/--mine-c[1-5]/g) ?? []).length >= 5,
    "渐变停点不足 5 个（霖 #1：要是主题色色盘，不是单色设计）",
  );
  ok(/color-mix\(in srgb, var\(--mine-c1, var\(--md-sys-color-/.test(gradLayer), "色盘停点没有回落到主题 token（取不到时换主题不会跟着变）");
  ok(
    /paletteGradientStops/.test(mine) && /--md-sys-color-primary/.test(mine) && /"--mine-c1": gradient\[0\]/.test(mine),
    "Mine 页没有把「主题色 → Monet 色盘 → 5 个 --mine-cN」接起来（换主题背景不会变）",
  );
  ok(/import \{ argbFromCssColor, hexFromArgb, paletteGradientStops \} from "\.\.\/lib\/monet\.js"/.test(mine), "Mine 页没有引 Monet 模块（颜色又写死了）");
  ok(
    /const \{ activeId, systemDark \} = useThemes\(\);/.test(mine) && /\}, \[activeId, systemDark\]\);/.test(mine),
    "色盘没有跟着主题快照重算（hook 调了但依赖数组里没有 activeId/systemDark，换主题不会刷新）",
  );
}
ok(/pointer-events:\s*none/.test(gradLayer), "渐变层会挡住点击（数字卡就点不动了）");
ok(/\.mine-grad > \* \{ position: relative; \}/.test(css), "子元素没有抬到渐变层之上（卡片会被半透明层压住）");
ok(!/(^|\n)\s*border(-top)?:/.test(gradBlock), ".mine-grad 上又画了边框（等于分界线）");
ok(/@keyframes mine-grad-flow/.test(css), "缺少 mine-grad-flow 关键帧");
/* DOM 顺序：渐变带（含页头 + 学生卡）→ 数字卡 → 服务列表 */
const atGrad = mine.indexOf('className="mine-grad"');
const atCard = mine.indexOf('className="mine-card"');
const atStats = mine.indexOf('className="mine-stats"');
const atSvc = mine.indexOf('className="mine-services"');
ok(atGrad >= 0 && atCard > atGrad, "学生卡不在渐变带里（渐变要从页面顶端铺起、把个人信息整段盖住）");
ok(atStats > atCard, "数字卡不在学生卡之后");
ok(atSvc > atStats, "服务列表不在渐变带之后（顺序乱了）");
/* 渐隐口径：起点在个人信息卡片下沿（由 topbar-h + 24 + 卡片高度算出），终点是本带底部 */
ok(
  /mask-image:\s*linear-gradient\(to bottom, #000 var\(--mine-fade-start\), transparent 100%\)/.test(gradLayer),
  "渐隐不是「卡片下沿 → 本带底部」的单向渐隐（要么整条带都淡、要么画了分界线）",
);
const mobileGrad = /@media \(max-width: 839\.98px\)[\s\S]*?\n  \.mine-grad \{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? "";
ok(!!mobileGrad, "手机端没有 .mine-grad 的覆盖规则（渐变起不到页面顶端）");
ok(
  /--mine-fade-start:\s*calc\(var\(--topbar-h, 46px\) \+ 24px \+ var\(--mine-card-h\)\)/.test(mobileGrad),
  "手机端渐隐起点没有按「内容上偏移 + 页头 + 卡片高度」精确算（会切在卡片中间）",
);
ok(
  /margin-top:\s*calc\(-1 \* \(var\(--topbar-h, 46px\) \+ 14px\)\)/.test(mobileGrad) &&
    /padding-top:\s*calc\(var\(--topbar-h, 46px\) \+ 14px\)/.test(mobileGrad),
  "手机端渐变带没有提到页面顶端（负 margin + 等量 padding）",
);
ok(/padding-bottom/.test(gradBlock) === false, "渐变带有下内边距（渐隐会在数据卡片下沿之前就结束）");

/* ⑤ 三张数字卡：水平等分 + 累加动画 ------------------------------------- */
const statsBlock = block(css, ".mine-stats {");
ok(!!statsBlock, "CSS 里找不到 .mine-stats");
ok(
  /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(statsBlock),
  "三张数字卡不是三列等分（minmax(0,1fr) 防长数字顶破）",
);
const statOrder = ["校园卡余额", "学分", "GPA"].map((t) => {
  const at = mine.indexOf(">" + t + "</i>");
  ok(at >= 0, `数字卡缺少「${t}」`);
  return at;
});
ok(
  statOrder.every((v, i) => i === 0 || v > statOrder[i - 1]),
  "数字卡的顺序不是 校园卡余额 → 学分 → GPA",
);
/* D4（2026-10-02）后累加实现抽到共享组件，这里只查「本页确实在用」；
   实现本身的断言（rAF / 600ms / 只播一次 / reduced-motion / tabular-nums）在 tools/countup-test.mjs */
const countup = readFileSync("apps/desktop/src/components/CountUp.tsx", "utf8");
ok(/import \{ useCountUp \} from "\.\.\/components\/CountUp\.js";/.test(mine), "数字没有累加动画（没引入 components/CountUp.tsx）");
ok((mine.match(/useCountUp\(/g) ?? []).length >= 3, "余额 / 学分 / GPA 三处没有都用累加动画");
ok(/requestAnimationFrame/.test(countup), "累加动画没有逐帧插值");
ok(
  /prefersReducedMotion\(\) \|\| played\.current/.test(countup) && /"—"/.test(countup),
  "累加动画缺少 prefers-reduced-motion 短路（只剩全局动画降级，数字仍会从 0 爬）",
);
ok(
  /typeof matchMedia === "function" && matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/.test(countup),
  "累加组件的 prefersReducedMotion 没有真读 matchMedia('(prefers-reduced-motion: reduce)')",
);
ok(/<b className="mine-stat-num">/.test(mine), "数字不是 .mine-stat-num（静帧里的层级会跑偏）");
/* 霖 2026-10-02 复看：三张数字卡此前按下去没有任何反馈（.svc-row/.task-row 都有）。
   口径按文档 §2/§3：整卡按压只压暗底色、不改尺寸——所以这里不许出现 transform/scale。 */
{
  const statAt = css.indexOf(".mine-stat:active");
  ok(statAt >= 0, "三张数字卡没有按压反馈（.mine-stat:active）");
  if (statAt >= 0) {
    const act = css.slice(statAt, css.indexOf("}", statAt) + 1);
    ok(/background: var\(--md-sys-color-surface-container-high\)/.test(act), "数字卡按压不是压暗底色");
    ok(!/transform|scale/.test(act), "数字卡按压改了尺寸（文档口径：整卡按压只压暗底色）");
  }
}

/* ⑥ 五项服务的顺序与去向 -------------------------------------------------- */
const services = [
  ["设置", /title="设置"/],
  ["邮箱", /title="邮箱"/],
  ["云盘", /title="云盘"/],
  ["成绩", /title="成绩"/],
  ["我的收藏", /title="我的收藏"/],
];
const svcAt = services.map(([name, re]) => {
  const at = mine.search(re);
  ok(at >= 0, `服务列表缺少「${name}」`);
  return { name, at };
});
ok(
  svcAt.every((s, i) => i === 0 || s.at > svcAt[i - 1].at),
  "五项服务的顺序变了（G3 验收项：设置 → 邮箱 → 云盘 → 成绩 → 我的收藏）",
);
ok((mine.match(/<ServiceRow/g) || []).length === 5, "服务行不是五行");
ok(/className="row row-click"/.test(mine), "服务行没有复用全局列表行（.row row-click：分隔线/行高/进场动画）");
ok(/<Card className="mine-services">/.test(mine), "五项服务没有收在一张卡里（其他列表都这样托底）");
ok(
  /className="row-main"/.test(mine) && /className="row-title"/.test(mine) && /className="row-sub"/.test(mine),
  "服务行没有走 .row-main/.row-title/.row-sub 的结构（名称与说明会挤成一行）",
);
ok(/<IconChevron className="row-caret"/.test(mine), "服务行右侧没有进入图标（.row-caret）");
ok(block(css, ".mine-row-icon {").includes("inline-flex"), "CSS 里缺少 .mine-row-icon（图标槽会塌）");
for (const [name, re] of [
  ["设置", /navigate\("settings"\)/],
  ["邮箱", /navigate\("mail"\)/],
  ["云盘", /navigate\("cloud"\)/],
  ["收藏", /navigate\("favs"\)/],
]) {
  ok(re.test(mine), `「${name}」入口没有跳到对应页面`);
}
ok(/infoTab: "report"/.test(mine), "「成绩」入口没走成绩页");

/* ⑦ 底栏第 5 项与归属 ----------------------------------------------------- */
const bottomNav = /const BOTTOM_NAV:[\s\S]*?\n\];/.exec(layout)?.[0] ?? "";
ok(!!bottomNav, "解析不到 BOTTOM_NAV");
ok(/\{ page: "mine", label: "我的"/.test(bottomNav), "底栏第 5 项不是 mine/我的");
ok(!/page: "settings"/.test(bottomNav), "底栏又出现 settings（E3 起设置只能从「我的」页进）");
const navPages = [...(/export const BOTTOM_NAV_PAGES: readonly BottomNavPage\[\] = \[([^\]]+)\]/.exec(owner)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
ok(navPages.includes("mine") && !navPages.includes("settings"), "BOTTOM_NAV_PAGES 没有把 settings 换成 mine");
ok(/export type BottomNavPage = "today" \| "tasks" \| "services" \| "favs" \| "mine";/.test(owner), "BottomNavPage 联合类型没换成 mine");
for (const p of ["mine", "settings", "mail", "cloud", "info", "plugins"]) {
  ok(new RegExp('(?:^|\\n)\\s*"?\'?' + p + '"?\'?:\\s*"mine"').test(owner), `页面 ${p} 的归属不是 mine`);
}

/* ⑧ 只用既有 hook 出数：不许自建请求 / 自读缓存 --------------------------- */
for (const hook of ["useProfile", "useCard", "useReport", "useMailCounts", "useFavs"]) {
  ok(new RegExp("\\b" + hook + "\\(").test(mine), `没有复用既有 hook ${hook}`);
}
ok(!/\bfetch\(|XMLHttpRequest|invoke\(/.test(mine), "「我的」页自己发了请求（本页只许复用既有 hook）");
ok(!/localStorage|sessionStorage/.test(mine), "「我的」页自己读了本地存储（缓存口径只能在 state 层）");
ok(!/from "@tauri-apps/.test(mine), "「我的」页直接引了 Tauri API（应由 state 层封装）");
ok(/useProfile\(/.test(mine), "个人信息没有取 useProfile（与个人信息页不同源会出现「学号未获取」）");
ok(/displayStudentId\(/.test(mine), "学号没有走 displayStudentId（脱敏口径会不一致）");
ok(/getCampusSnapshot/.test(mine) && /subscribeCampusData/.test(mine), "校园邮箱没有走缓存快照兜底（要么空着、要么又发一次请求）");
ok(!/useCampusData\(/.test(mine), "「我的」页调了 useCampusData（会连带拉整套校园数据；邮箱只该读缓存快照）");
ok(/from "\.\.\/lib\/grades\.js"/.test(mine), "学分/绩点没有用共用的 lib/grades.js（会和成绩页口径不一致）");
ok(/weightedAverage\(/.test(mine) && /creditsOf\(/.test(mine), "学分与绩点没有用共用口径函数");
ok(/MAIL_FOLDERS/.test(mine), "邮件未读数没有走 MAIL_FOLDERS（写死文件夹名会在加文件夹时漏数）");

if (fails.length) {
  console.error("「我的」页护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("「我的」页护栏：路由四处接线 + 三段无标题 + 学生卡比例 + 隐形分界线 + 三卡等分与累加 + 五项服务顺序与去向 + 底栏归属 + 复用既有 hook ✓");
