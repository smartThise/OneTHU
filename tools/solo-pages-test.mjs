#!/usr/bin/env node
/**
 * G2 护栏：旧多 tab 页里的 23 个 tab 独立成页（docs/ui-ux-polish-detailed.md §12 G2）。
 *
 * 口径（霖确认）：
 *  ① 23 个 tab 各自一个 id / 标题 / 路由，独立页**没有 tab 条**、也不背旧多 tab 骨架；
 *  ② 手机上所有入口（服务页 / 今日卡片 / 搜索 / 命令面板 / 收藏 / 原子 open）都走独立页；
 *     PC 侧栏、右键与旧深链原样走旧多 tab 页（手机开 #/info 仍是旧页）；
 *  ③ 薄壳不复制 tab 实现——一处逻辑两个入口；手机分流只有一处（NAV_REGISTRY.soloPage
 *     + app.navigate 的档位判定）；「更多场馆」不提取。
 *
 * 跑法：node tools/solo-pages-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const read = (p) => readFileSync(p, "utf8");

const APP = "apps/desktop/src/state/app.tsx";
const NAV = "apps/desktop/src/state/navigation.ts";
const OWNER = "apps/desktop/src/state/navOwner.ts";
const SOLO = "apps/desktop/src/pages/solo/SoloTabPage.tsx";
const ATOMS = "apps/desktop/src/state/atoms.tsx";
const APPX = "apps/desktop/src/App.tsx";
const XK = "apps/desktop/src/pages/zhjwxk/Courses.tsx";
const ROOT = "apps/desktop/package.json";

for (const f of [APP, NAV, OWNER, SOLO, ATOMS, APPX, XK]) ok(existsSync(f), `缺少文件 ${f}`);

/** 23 个独立页：id → 期望渲染的既有 tab 组件（= 不许复制实现的那批） */
const SOLO_IDS = {
  grade: "ReportTab",
  fitness: "FitnessTab",
  exams: "ExamsTab",
  evaluation: "EvaluationTab",
  calendar: "CalendarTab",
  news: "NewsTab",
  profile: "ProfileTab",
  "course-info": "CourseInfoTab",
  dorm: "DormTab",
  washer: "WasherTab",
  hygiene: "HygieneTab",
  "campus-card": "CardTab",
  invoice: "InvoiceTab",
  payroll: "PayrollTab",
  "grad-income": "GradIncomeTab",
  "campus-net": "NetworkTab",
  "lib-seat": "LibraryTab",
  "lib-room": "LibRoomTab",
  classroom: "ClassroomTab",
  sports: "VenueSportsTab",
  "public-space": "KongjianTab",
  "xk-find": "XkFindSoloPage",
  "xk-manage": "XkManageSoloPage",
};

const app = read(APP);
const nav = read(NAV);
const owner = read(OWNER);
const solo = read(SOLO);
const atoms = read(ATOMS);
const appx = read(APPX);
const xk = read(XK);

/* ① 23 个 id 进 Page 联合类型 + TOP_PAGES（可深链）+ 标题表 + 归属表 ---------- */
const pageUnion = app.slice(app.indexOf("export type Page ="), app.indexOf("/** 子页导航参数"));
const topPages = app.slice(app.indexOf("const TOP_PAGES"), app.indexOf("as const;", app.indexOf("const TOP_PAGES")));
for (const id of Object.keys(SOLO_IDS)) {
  ok(new RegExp(`"${id}"`).test(pageUnion), `Page 联合类型里没有 ${id}`);
  ok(new RegExp(`"${id}"`).test(topPages), `TOP_PAGES 里没有 ${id}（深链会落回兜底页）`);
  ok(new RegExp(`^\\s*"?${id}"?:\\s*"`, "m").test(nav), `PAGE_TITLES 里没有 ${id}（顶栏标题会空）`);
  ok(new RegExp(`^\\s*"?${id}"?:\\s*"`, "m").test(owner), `PAGE_OWNER 里没有 ${id}（底栏无高亮）`);
}

/* ② 薄壳：每个 id 都有 spec、都渲染对应既有组件，且不复制实现 ------------------ */
const specBlock = solo.slice(solo.indexOf("export const SOLO_TABS"), solo.indexOf("export function isSoloPage"));
ok(/export const SOLO_TABS: Record<SoloPage, SoloTabSpec> = \{/.test(solo), "SOLO_TABS 不是穷尽的 Record<SoloPage, …>（漏一页编译不过这条护栏就废了）");
for (const [id, comp] of Object.entries(SOLO_IDS)) {
  const m = new RegExp(`^\\s*"?${id}"?:\\s*\\{`, "m").exec(specBlock);
  ok(!!m, `SOLO_TABS 里没有 ${id}`);
  ok(specBlock.includes(`<${comp}`), `SOLO_TABS.${id} 没有渲染既有组件 ${comp}（薄壳不许另写一份实现）`);
}
/* 细节：独立页不许再挂 tab 条 / 栏目管理（那正是被拆掉的东西） */
ok(!/SegmentedOverflow/.test(solo), "独立页还在渲染 tab 条（SegmentedOverflow）");
ok(!/TabManageModal/.test(solo), "独立页还在渲染栏目管理（TabManageModal）");
ok(!/loadTabLayout|saveTabLayout/.test(solo), "独立页还在读栏目布局（tabLayout）");
/* 外壳三件事：PageHead（含收藏菜单）+ 渲染 tab + 透传 navParams */
ok(/<PageHead[\s\S]{0,240}back=\{<BackButton to="services"/.test(solo), "独立页没走 PageHead + 返回服务（G1 顶栏口径）");
ok(/spec\.render\(navParams\)/.test(solo), "独立页没有把 navParams 透传给 tab 组件");
ok(/usePageCollect\(pageAtomRef\(spec\.atom\), spec\.title\)/.test(solo), "独立页没有接收藏（页级操作应走 PageHead 的 menu）");

/* ③ 分流：soloPage 覆盖 23 个，判定只有一处，更多场馆不提取 ------------------ */
const tabEntries = [...nav.matchAll(/\{ id: "[^"]+",[\s\S]*?\},?\n/g)].map((x) => x[0]).filter((x) => /soloPage: /.test(x));
const soloValues = new Set(tabEntries.map((e) => /soloPage: "([^"]+)"/.exec(e)?.[1]));
for (const id of Object.keys(SOLO_IDS)) ok(soloValues.has(id), `NAV_REGISTRY 里没有条目挂 soloPage: "${id}"`);
ok(tabEntries.length >= 23, `挂 soloPage 的注册表条目只有 ${tabEntries.length} 条（23 个独立页至少 23 条：宿舍电费与宿舍共用 dorm）`);
ok(soloValues.size === 23, `soloPage 覆盖了 ${soloValues.size} 个独立页（应为 23，多一个少一个都不行）`);
ok(!/soloPage: "more"/.test(nav), "「更多场馆」不该有独立页（它没有服务页入口，留在旧预约页）");
{
  /* 「更多场馆」所在的注册表条目（若将来补了条目）不许挂 soloPage */
  const moreEntry = /reserveTab: "more"[\s\S]{0,200}?\}/.exec(nav);
  ok(!moreEntry || !/soloPage/.test(moreEntry[0]), "「更多场馆」的条目挂了 soloPage");
}
/* 旧预约页的「更多场馆」tab 仍在（不是被删了，是没提取） */
const reserve = read("apps/desktop/src/pages/info/ReservePage.tsx");
ok(/\{ id: "more", label: "更多场馆" \}/.test(reserve), "旧预约页的「更多场馆」tab 被删了（口径是保留不提取）");
/* 分流判定唯一：soloTargetFor 只在 navigation 里定义一次，navigate 只调一次 */
ok((nav.match(/export function soloTargetFor\(/g) ?? []).length === 1, "soloTargetFor 必须只有一份实现");
{
  /* 分流必须只有一处：全 src 里 soloTargetFor 的调用点只允许 app.tsx 的那一次 */
  const calls = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) {
        const raw = readFileSync(p, "utf8");
        const hits = (raw.match(/soloTargetFor\(/g) ?? []).length - (raw.match(/function soloTargetFor\(/g) ?? []).length;
        if (hits) calls.push(`${relative("apps/desktop/src", p)}×${hits}`);
      }
    }
  };
  walk("apps/desktop/src");
  ok(calls.length === 1 && calls[0] === "state/app.tsx×1", `手机分流必须只有一处（现在：${calls.join(", ") || "无"}）——服务页/搜索各判一次必然漂`);
}
ok(/if \(!params\) return null;/.test(nav), "soloTargetFor 少了「无参数不改道」的短路（纯一级页会被误改）");
ok(/best\.keys/.test(nav), "soloTargetFor 没有「最具体匹配优先」（life-electricity 会被 life-dorm 抢走）");
ok(/platformOf\(window\.innerWidth\) !== "expanded"/.test(app), "navigate 没有按档位分流（compact/medium 应走独立页，expanded 走旧页）");

/* ④ 旧页与旧深链保留：旧聚合页文件 / 路由 / tab 条都还在 --------------------- */
for (const [f, needle] of [
  ["apps/desktop/src/pages/info/InfoPage.tsx", "SegmentedOverflow"],
  ["apps/desktop/src/pages/info/LifePage.tsx", "SegmentedOverflow"],
  ["apps/desktop/src/pages/info/ReservePage.tsx", "SegmentedOverflow"],
]) ok(read(f).includes(needle), `${f} 的旧多 tab 骨架被拆了（口径是旧页原样保留）`);
ok(/\{page === "info" && <InfoPage \/>\}/.test(appx), "旧「信息」页路由被摘了");
ok(/\{page === "life" && <LifePage \/>\}/.test(appx), "旧「生活」页路由被摘了");
ok(/\{page === "reserve" && <ReservePage \/>\}/.test(appx), "旧「预约」页路由被摘了");
ok(/\{page === "zhjwxk" && <ZhjwxkCoursesPage \/>\}/.test(appx), "旧「选课」页路由被摘了");
ok(/isSoloPage\(page\) && <SoloTabPage id=\{page\} \/>/.test(appx), "App 没有接独立页路由（薄壳进不来）");

/* ⑤ 选课独立页复用旧页的同一批组件与同一条通路 ------------------------------ */
ok(/export function XkFindSoloPage\(/.test(xk) && /export function XkManageSoloPage\(/.test(xk), "选课独立页没有导出");
ok(/<CourseListPanel wb=\{wb\} jump=\{jump\} jumpSeq=\{jumpSeq\} \/>/.test(xk), "课程查找独立页没有复用 CourseListPanel");
for (const sec of ["PlanSection", "PreviewSection", "StageSection", "QueueSection"]) {
  ok(new RegExp(`<${sec} wb=\\{wb\\} />`).test(xk.slice(xk.indexOf("export function XkManageSoloPage"))), `选课管理独立页没有复用 ${sec}`);
}
ok((xk.match(/function useXkPageHost\(/g) ?? []).length === 1, "选课工作台主机（跳转/详情/评价通路）必须只有一份");
ok((xk.match(/useXkPageHost\(\)/g) ?? []).length >= 3, "旧页或独立页没有用同一个主机 hook（详情/评价会点了没反应）");
ok(/_detailOpen = \(code, tid\) => setDetail\(\{ code, tid \}\)/.test(xk), "主机 hook 没接详情通路");
ok(/_reviewOpen = setReview/.test(xk), "主机 hook 没接评价通路");

/* ⑥ 收藏原子：独立页用既有原子 key（PC 旧页与手机独立页同一颗星） ------------ */
for (const key of ["info-report", "info-news", "life-card", "reserve-lib", "xk-find", "xk-manage"]) {
  ok(new RegExp(`key: "${key}"`).test(atoms), `PAGE_ATOMS 里没有 ${key}（独立页收藏会没有原子可挂）`);
}

/* ⑦ guard 链里必须跑本护栏 -------------------------------------------------- */
const guard = read("package.json");
ok(/solo-pages-test\.mjs/.test(guard), "guard 链里没有 solo-pages-test.mjs");
ok(existsSync(ROOT), "缺 apps/desktop/package.json");

if (fails.length) {
  console.error("独立页护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("独立页护栏：23 个 tab 各自成页（标题/路由/归属/深链齐）、薄壳不复制实现、手机分流一处、旧页与「更多场馆」原样保留 ✓");
