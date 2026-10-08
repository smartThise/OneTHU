#!/usr/bin/env node
/**
 * G1 护栏：手机顶栏（根页 logo / 非根页「<」返回 / 右上「···」页面级操作菜单）。
 *
 * 口径（docs/ui-ux-polish-detailed.md §12 G1，霖两轮细化后定稿）：
 *  ① 根页 = 底栏五项（今日/待办/服务/收藏/我的），左上角照旧 OneTHU logo；其它页把 logo
 *     换成「<」返回键，**页内返回键手机上不再出现**（PC 照旧）。
 *  ② 右上「···」打开当前页的页面级操作菜单（收藏 / 刷新 / 整页主操作），复用长按菜单
 *     宿主与展开动画；工具栏（收藏夹编辑、设置页栏目管理、寻迹选项、选课学期）留在页内。
 *  ③ 一份声明两处消费：PageHead 的 menu 是唯一声明处，PC 渲染成右上按钮、手机进菜单；
 *     返回目标也只有一处（PageHead 的 back 槽 → BackButton 的 to/label），顶栏读同一份。
 *
 * 跑法：node tools/topbar-chrome-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
const read = (p) => readFileSync(p, "utf8");

const CHROME = "apps/desktop/src/state/pageChrome.ts";
const LAYOUT = "apps/desktop/src/components/Layout.tsx";
const CTX = "apps/desktop/src/components/ContextMenu.tsx";
const COLLECT = "apps/desktop/src/components/Collect.tsx";
const APP = "apps/desktop/src/state/app.tsx";
const SHARED = "apps/desktop/src/pages/learn/shared.tsx";
const CSS = "apps/desktop/src/styles/global.css";
const SRC = "apps/desktop/src";

for (const f of [CHROME, LAYOUT, CTX, COLLECT, APP, SHARED, CSS]) ok(existsSync(f), `缺少文件 ${f}`);

/* ① 注册表：快照只在可见性变化时换引用（否则 useSyncExternalStore 打转） ------- */
const chrome = read(CHROME);
ok(/export function syncPageChrome\(/.test(chrome), "pageChrome 没有 syncPageChrome");
ok(/export function clearPageChrome\(/.test(chrome), "pageChrome 没有 clearPageChrome（卸载会残留上一页菜单）");
ok(/export function subscribePageChrome\(/.test(chrome), "pageChrome 没有 subscribePageChrome");
ok(/export function pageChromeSnapshot\(/.test(chrome), "pageChrome 没有 pageChromeSnapshot");
ok(/export function readPageChrome\(/.test(chrome), "pageChrome 没有 readPageChrome（菜单项要读最新闭包）");
ok(
  /hasBack === snapshot\.hasBack && hasMenu === snapshot\.hasMenu\) return;/.test(chrome),
  "syncPageChrome 没有「可见性没变就不通知」的短路（每次渲染换引用会把顶栏渲染打转）",
);
ok(
  /export function pageChromeSnapshot\(\): ChromeSnapshot \{\s*return snapshot;\s*\}/.test(chrome),
  "pageChromeSnapshot 每次构造新对象（useSyncExternalStore 会因为引用变化无限重渲染）",
);

/* ② 顶栏：根页 logo / 非根页返回 / 「···」菜单 ---------------------------------- */
const layout = read(LAYOUT);
ok(/BOTTOM_NAV_PAGES\.includes\(rawPage as BottomNavPage\)/.test(layout), "顶栏没有按「底栏五项」判根页");
ok(/function MobileTopbar\(/.test(layout), "没有独立的 MobileTopbar 组件（顶栏要能拿到菜单 api）");
{
  /* 真机踩过：顶栏放在 ContextMenuLayer 外面 → useContextMenu() 拿到 NOOP → 点「···」没反应 */
  const open = layout.indexOf("<ContextMenuLayer>");
  const close = layout.indexOf("</ContextMenuLayer>");
  const bar = layout.indexOf("<MobileTopbar");
  ok(open >= 0 && close > open && bar > open && bar < close, "顶栏没有渲染在 ContextMenuLayer 内部（「···」会拿到 NOOP，点了没反应）");
  const comp = layout.slice(layout.indexOf("function MobileTopbar("), open);
  ok(/useContextMenu\(\)/.test(comp), "MobileTopbar 没有用顶层的 useContextMenu（拿不到长按菜单宿主）");
  ok(!/<MobileTopbar[\s\S]{0,80}ctx=/.test(layout), "Shell 里还留着拿不到 api 的 ctx");
}
/* 霖 2026-10-02 #7：两支改成按 leadSwap.cur 渲染（进场的一份在前、退场的一份在后），
   分支本体与原来一致：有 target 出「<」，根页出 logo。 */
ok(/leadSwap\.cur === "back" \? \(/.test(layout) && /<IconBack/.test(layout), "顶栏没有「<」返回键分支");
ok(/\) : \(\s*<span className=\{"topbar-logo"[\s\S]{0,140}?<BrandLogo size=\{11\} \/>/.test(layout), "根页顶栏左上角不是 OneTHU logo 了");
ok(
  /readPageChrome\(\)\.back \?\? \{ to: owner, label: pageTitle\(owner\) \}/.test(layout),
  "非根页没有「声明父页 → 归属 tab」的返回回落（深链冷启动会没有返回键）",
);
ok(
  /back\(\(\) => navigate\(target\.to, target\.params, \{ replace: true \}\)\)/.test(layout),
  "顶栏返回没有优先走会话内导航栈（back()），而是直接跳硬编码父页",
);
ok(/aria-label="更多操作"/.test(layout), "「···」按钮没有无障碍名");
ok(/\{chrome\.hasMenu \? \(/.test(layout), "「···」没有按「当前页有没有页面级操作」显示");
ok(
  /ctx\.open\(\{[\s\S]{0,200}r\.bottom/.test(layout),
  "「···」没有以按钮矩形为锚开菜单（展开动画与长按菜单同源的要求落空）",
);
ok(/useSyncExternalStore\(subscribePageChrome, pageChromeSnapshot, pageChromeSnapshot\)/.test(layout), "顶栏没有订阅 pageChrome");

/* ③ PageHead：唯一声明处 + 同步 + PC 渲染 --------------------------------------- */
ok(/menu\?: PageMenuItem\[\]/.test(layout), "PageHead 没有 menu 槽");
ok(/\n\s*syncPageChrome\(\{/.test(layout), "PageHead 没有把返回目标/菜单同步给顶栏");
ok(/useEffect\(\(\) => clearPageChrome, \[\]\)/.test(layout), "PageHead 卸载没有清空顶栏 chrome");
ok(/backTargetOf\(backTo, backProps\?\.label, backProps\?\.courseId, backProps\?\.courseTab\)/.test(layout), "PageHead 没有从 back 槽的 BackButton 上取返回目标");
ok(/className="page-head-page-actions"/.test(layout), "PageHead 没有页面级操作的容器（PC 渲染点）");
ok(
  /\.page-head-page-actions \{ display: none; \}/.test(cssInMedia("839.98px", ".page-head-page-actions { display: none; }")),
  "手机端没有隐藏页内那份页面级操作（会和「···」重复）",
);
ok(
  /\.page-head-back \{ display: none; \}/.test(cssInMedia("839.98px", ".page-head-back { display: none; }")),
  "手机端没有隐藏页内返回键（顶栏「<」已取代它）",
);
ok(/\.topbar-back,/.test(cssInMedia("839.98px", ".topbar-back,")), "手机端没有顶栏返回键样式");
ok(/\.topbar-more \{ margin-left: auto; \}/.test(cssInMedia("839.98px", ".topbar-more { margin-left: auto; }")), "「···」没有靠右");

/* ③b dev 徽标：霖 2026-10-01 #2 起放**顶栏正中**、缩成一枚只写「dev」的小标 ---------
   要求三条：① 水平居中（left:50% + translateX(-50%)）；② 提交号那截在手机上隐藏（小标）；
   ③ 不压得住「<」与「···」——居中在 200 附近，两个按钮分别在 16 与 350，几何上不重叠
   （真机另用 elementFromPoint 复核，见走查记录）。 */
{
  const dev = read("apps/desktop/src/components/DevPanel.tsx");
  ok(/className="dev-badge"/.test(dev), "DevPanel 徽标没有 .dev-badge 类名（手机端定位靠它）");
  ok(/<span className="dev-badge-commit">/.test(dev), "DevPanel 徽标没有把提交号包进 .dev-badge-commit（手机上藏不掉）");
  const block = cssInMedia("839.98px", ".dev-badge {");
  ok(!!block, "手机端没有 .dev-badge 的定位规则（dev 徽标会盖住顶栏「···」）");
  ok(/left: 50% !important/.test(block) && /right: auto !important/.test(block) && /transform: translateX\(-50%\)/.test(block), ".dev-badge 手机端没有水平居中到顶栏中间");
  ok(/top: 18px !important/.test(block) && /bottom: auto !important/.test(block), ".dev-badge 没有落在顶栏竖直中间（顶栏 60 高、小标 24 高 → top 18）");
  ok(/font-size: 12px !important/.test(block), ".dev-badge 手机端没有缩到最小可读字号（12px 阶梯）");
  ok(/\.dev-badge-commit \{ display: none; \}/.test(cssInMedia("839.98px", ".dev-badge-commit")), "手机端没有藏掉 dev 徽标的提交号（要的是一枚小标）");
}

/* ④ 一份声明：页面级操作不许再留在 actions 里 -------------------------------- */
ok(/export function useContextMenu\(/.test(read(CTX)), "ContextMenu 没有 useContextMenu（顶栏菜单复用它）");
for (const f of walk(SRC)) {
  const raw = read(f).replace(/\/\*[\s\S]*?\*\//g, " ");
  const m = /actions=\{([\s\S]*?)\n(\s*)\}\n/.exec(raw);
  if (!m) continue;
  const body = m[1];
  ok(!/IconRefresh/.test(body), `${relative(SRC, f)} 的 actions 里还有刷新按钮（G1 起「刷新」进顶栏菜单）`);
  ok(!/CollectStar|PageAtomStar|usePageCollect/.test(body), `${relative(SRC, f)} 的 actions 里还有收藏控件（G1 起「收藏」进顶栏菜单）`);
}

/* ④b 页面不许自己拼页头（绕过 PageHead 就会绕过 G1 口径：手机端页内留下星标/返回） -- */
for (const f of walk(SRC)) {
  if (f.endsWith("components/Layout.tsx")) continue; /* PageHead 自己的实现处 */
  const raw = read(f);
  ok(!/className="page-head-actions"/.test(raw), `${relative(SRC, f)} 手拼了 .page-head-actions（页面级操作必须走 PageHead 的 menu）`);
  ok(!/className="page-head"/.test(raw), `${relative(SRC, f)} 手拼了 .page-head（必须用 PageHead）`);
}

/* ⑤ 返回目标只有一份实现 ------------------------------------------------------ */
ok(/export function backTargetOf\(/.test(read(APP)), "state/app.tsx 没有 backTargetOf（返回目标唯一口径）");
ok((read(APP).match(/export function backTargetOf\(/g) ?? []).length === 1, "backTargetOf 有多份实现");
ok(/backTargetOf\(to, label, courseId, courseTab\)/.test(read(SHARED)), "BackButton 没有用 backTargetOf");
ok(/import \{ backTargetOf/.test(read(SHARED)), "BackButton 没引用 backTargetOf");
/* 收藏菜单项与 CollectStar 同一份弹层（菜单里点「收藏」也是选收藏夹） */
ok(/export function usePageCollect\(/.test(read(COLLECT)), "Collect.tsx 没有 usePageCollect");
ok(/<CollectModal atom=\{atom\} onClose=\{\(\) => setOpen\(false\)\} \/>/.test(read(COLLECT)), "usePageCollect 没有复用 CollectModal（收藏口径会分叉）");
/* 不可用项：菜单里点了不生效，PC 按钮同步 disabled */
ok(/aria-disabled=\{it\.disabled \? true : undefined\}/.test(read(CTX)), "菜单项没有 disabled 语义");
ok(/if \(it\.disabled\) return;/.test(read(CTX)), "菜单项 disabled 时仍然会执行 onSelect");
ok(/disabled=\{m\.disabled\}/.test(read(LAYOUT)), "PC 页头按钮没有同步 menu 项的 disabled");

function cssInMedia(width, needle) {
  const css = read(CSS);
  const at = css.indexOf(needle);
  if (at < 0) return "";
  /* 找它前面最近的一个 @media 起始，确认宽度匹配且没被 } 提前闭合 */
  const before = css.slice(0, at);
  const lastMedia = before.lastIndexOf("@media");
  if (lastMedia < 0) return "";
  const head = css.slice(lastMedia, css.indexOf("{", lastMedia));
  if (!head.includes(width)) return "";
  const braces = css.slice(lastMedia, at);
  if ((braces.match(/\{/g) ?? []).length !== (braces.match(/\}/g) ?? []).length + 1) return "";
  return css.slice(at, at + needle.length + 600);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}

if (fails.length) {
  console.error("手机顶栏护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("手机顶栏护栏：根页 logo/非根页返回、··· 菜单复用长按宿主、一份声明两处消费、返回目标单一口径、工具栏留页内 ✓");
