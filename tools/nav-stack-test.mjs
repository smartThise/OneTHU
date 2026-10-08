#!/usr/bin/env node
/**
 * E1 护栏：会话内导航栈是唯一事实来源，系统返回键只走 WebView 历史这一条通道。
 *
 * 由来（docs/ui-ux-polish-detailed.md §6 E1）：全仓原先没有导航栈——各页返回按钮
 * 各自硬编码父页，「待办 → 全部作业 → 某作业」返回会掉回待办。
 *
 * 真机实测（2026-10-01）纠正了「wry 会替我们退 WebView 历史」的推断：Tauri 生成的
 * TauriActivity 把 handleBackNavigation 置为 false，返回键实际走 AppPlugin 的
 * back-button JS 事件。于是设计定为「事件驱动 + 纯 JS 栈 + URL 只 replaceState 同步」：
 *
 *   1. 只有 state/navStack.ts 碰 history 与 back-button（别处再写一遍就会与栈分叉）；
 *   2. 路由入口 navigate() 必须经过 pushNav/replaceNav，且不再直接写 location.hash
 *      （写 hash 会触发 hashchange，把刚设的状态冲回顶层页——旧版闪回 bug 的根因）；
 *   3. Android 返回键 = back-button 事件（按需注册）：先关浮层 → 再退页帧；
 *      回到根就摘掉监听，让 AppPlugin 原生退出应用（ACL 不放行 plugin:app|exit）；
 *   4. 有栈上限；返回按钮不再硬编码父页（BackButton 走 back()，深链才回落声明父页）；
 *   5. 浮层优先：二级菜单 / 收藏弹层 / 抽屉 / 命令面板 / 主题弹层 / 文件预览登记 overlay 帧。
 *
 * 跑法：node tools/nav-stack-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const NAV_STACK = "apps/desktop/src/state/navStack.ts";
const APP = "apps/desktop/src/state/app.tsx";
const BACK_BTN = "apps/desktop/src/pages/learn/shared.tsx";
/** 已登记的浮层（id → 所在文件） */
const OVERLAYS = [
  ["ctx-menu", "apps/desktop/src/components/ContextMenu.tsx"],
  ["ctx-collect", "apps/desktop/src/components/ContextMenu.tsx"],
  ["nav-drawer", "apps/desktop/src/components/Layout.tsx"],
  ["palette", "apps/desktop/src/components/CommandPalette.tsx"],
  ["theme-picker", "apps/desktop/src/components/ThemePickerModal.tsx"],
  ["file-preview", "apps/desktop/src/components/FilePreview.tsx"],
];

const maskComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const read = (p) => maskComments(readFileSync(p, "utf8"));
const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (f === "node_modules" || f === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

const navStack = read(NAV_STACK);
const app = read(APP);
const src = walk("apps/desktop/src");

/* ① 唯一 history 入口 ------------------------------------------------------- */
ok(existsSync(NAV_STACK), "缺少 state/navStack.ts（E1 的栈模块）");
const HISTORY_RE = /history\.(pushState|replaceState|back|go)\s*\(|addEventListener\(\s*["']popstate["']|onBackButtonPress\(/;
const historyFiles = src.filter((f) => HISTORY_RE.test(read(f)));
ok(
  historyFiles.length === 1 && historyFiles[0] === NAV_STACK,
  `history/popstate 只允许出现在 ${NAV_STACK}，实际：${historyFiles.join(", ") || "（无）"}`,
);

/* ② 路由入口经过栈，且不再写 location.hash ---------------------------------- */
ok(/pushNav\(frame\)/.test(app) && /replaceNav\(frame\)/.test(app), "navigate() 没有经过 pushNav/replaceNav（栈会与页面状态分叉）");
ok(!/location\.hash\s*=/.test(app), "app.tsx 仍在直接写 location.hash（会触发 hashchange 冲回顶层页，E1 要消除的闪回根因）");
ok(/opts\?\.replace/.test(app), "navigate() 没有 replace 分支（登录/登出/2FA 归位会往栈里塞垃圾帧）");
for (const n of [1, 2, 3]) {
  ok(
    (app.match(/navigate\("today", undefined, \{ replace: true \}\)/g) || []).length >= 3,
    "登录 / 2FA / 登出归位没有全部用 replace（应至少 3 处）",
  );
}
ok(
  /useSyncExternalStore\(subscribeNav, topPageFrame, topPageFrame\)/.test(app),
  "app.tsx 没有订阅栈（系统返回键退栈后页面不会重渲染）",
);

/* ③ 建根帧用 replaceState + 不再依赖 WebView 历史 --------------------------- */
ok(/history\.replaceState\(\{ dshNav: 0 \}/.test(navStack), "建根帧没有用 replaceState");
ok(!/history\.pushState/.test(navStack), "又在 pushState 了：真机上 canGoBack() 对 pushState 条目恒 false，历史条目数与栈帧数会对不上（实测差 1）");
ok(!/addEventListener\("popstate"/.test(navStack), "又回到 popstate 退栈：返回键实际走 back-button 事件，popstate 只有在 WebView 自己导航时才触发");
ok(/export function back\(\): boolean/.test(navStack), "back() 应返回 boolean（调用方据此决定是否退出应用）");
ok(/export const MAX_FRAMES = 50;/.test(navStack), "栈没有上限（霖定口径 ~50，防内存；断言必须带分号，否则 5000 也会匹配）");
ok(/function trim\(\)/.test(navStack) && /trim\(\)/.test(navStack.replace(/function trim\(\)[\s\S]*?\n\}/, "")), "有 MAX_FRAMES 但没有真正裁剪");

/* ④ 返回键通道：onBackButtonPress（只注册一次）→ 先关浮层 → 退页帧 → 根节点 exitApp -- */
const navRaw4 = read("apps/desktop/src/state/navStack.ts");
ok(/const \{ onBackButtonPress \} = await import\("@tauri-apps\/api\/app"\)/.test(navStack), "没有用官方 onBackButtonPress 注册返回键（返回键会走 canGoBack() 兜底并退出应用）");
ok(/plugin:onethu-mobile\|mobile_exit/.test(navStack), "根节点没有走自有插件退出命令（Tauri 的 plugin:app|exit 在这套 ACL 下被拒）");
ok(!/plugin:app\|exit/.test(navStack), "用了 plugin:app|exit：ACL 不放行（真机实测被拒）");
ok(!/\.unregister\(\)/.test(navStack), "又去摘返回键监听了：真机实测摘除后 Kotlin 监听表仍有残留条目，根节点退出会失效");
ok(!/listen\("back-button"/.test(navStack), "又用 @tauri-apps/api/event 的 listen 注册 back-button：那是事件插件，Kotlin Plugin.hasListener 看的是插件自己的监听表（实测事件不来、返回键照旧退出）");
ok(/backError = String\(e instanceof Error/.test(navRaw4), "注册/退出异常没有留痕（真机上会静默失效）");
ok(
  /if \(top\?\.kind === "overlay"\) \{[\s\S]{0,200}?frames\.pop\(\)[\s\S]{0,120}?top\.close\(\)/.test(navStack),
  "back() 没有先关最上层浮层（返回键会跳过浮层直接退页帧）",
);
ok(/export function canGoBack\(\): boolean \{\s*return frames\.length > 1 \|\| topFrame\(\)\?\.kind === "overlay";/.test(navStack), "canGoBack 判据不对（应含「栈顶是浮层」）");

/* ④b 原生退出通道：Kotlin exitApp + Rust mobile_exit + 权限三件套 ----------------- */
const mobileRs = read("apps/desktop/src-tauri/plugins/onethu-mobile/src/commands.rs");
const mobileLib = read("apps/desktop/src-tauri/plugins/onethu-mobile/src/lib.rs");
const mobileBuild = read("apps/desktop/src-tauri/plugins/onethu-mobile/build.rs");
const mobileKt = read("apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt");
const mobileToml = read("apps/desktop/src-tauri/plugins/onethu-mobile/permissions/default.toml");
ok(/pub async fn mobile_exit/.test(mobileRs) && /run_mobile_plugin\("exitApp"/.test(mobileRs), "Rust 侧缺 mobile_exit → exitApp 转调");
ok(/commands::mobile_exit/.test(mobileLib), "mobile_exit 没有登记进 invoke_handler");
ok(/"mobile_exit"/.test(mobileBuild), "build.rs 命令表没有 mobile_exit（权限文件不会生成）");
ok(/fun exitApp\(invoke: Invoke\)[\s\S]{0,120}?activity\.finish\(\)/.test(mobileKt), "Kotlin exitApp 没有 finish Activity");
ok(/allow-mobile-exit/.test(mobileToml), "插件默认权限集没有 allow-mobile-exit（前端调用会被 ACL 拒）");

/* ⑤ 浮层登记：hook 唯一 + 五个调用点 --------------------------------------- */
ok(/export function useOverlayBack\(id: string, open: boolean, close: \(\) => void\)/.test(navStack), "缺少 useOverlayBack 浮层登记 hook");
for (const [id, file] of OVERLAYS) {
  ok(existsSync(file), `浮层文件不存在：${file}`);
  if (existsSync(file)) {
    ok(new RegExp(`useOverlayBack\\("${id}"`).test(read(file)), `${file} 没有登记浮层帧 ${id}`);
  }
}

/* ⑥ 返回按钮不再硬编码父页 -------------------------------------------------- */
ok(existsSync(BACK_BTN), "缺少 pages/learn/shared.tsx");
if (existsSync(BACK_BTN)) {
  const back = read(BACK_BTN);
  /* G1 起目标与参数由 backTargetOf 算（顶栏返回键共用同一份），仍必须走 back() */
  ok(
    /onClick=\{\(\) => back\(\(\) => navigate\(target\.to, target\.params, \{ replace: true \}\)\)\}/.test(back),
    "BackButton 没有走栈（back() + 深链才回落声明父页）",
  );
  ok(/backTargetOf\(to, label, courseId, courseTab\)/.test(back), "BackButton 没有用 backTargetOf 算目标（G1 后必须与顶栏返回键同一份）");
  ok(!/onClick=\{\(\) => navigate\(to, params\)\}/.test(back), "BackButton 还是直接 navigate 到硬编码父页");
}
/* 只认「返回文案」的按钮：「进入网络学堂 →」这类前进入口不算返回（曾把 TasksPage 的
   前进按钮误判成返回，护栏自己也要有反例意识） */
const BACK_LABEL = /(←\s*返回|返回列表|回网络学堂|回待办|返回上一|回课程)/;
for (const f of src) {
  const raw = readFileSync(f, "utf8");
  /* 文件内已登记浮层的「返回」是浮层内部关闭（点它 → 关状态 → hook 退帧），
     这类不算页面返回按钮；判定：该文件有 useOverlayBack 且按钮不 navigate */
  const overlayInternal = /useOverlayBack\(/.test(raw);
  for (const line of raw.split("\n")) {
    if (!BACK_LABEL.test(line) || !/<button/.test(line)) continue;
    if (overlayInternal && !/navigate\(/.test(line)) continue;
    ok(/back\(/.test(line), `${f} 的返回按钮没走 back()：${line.trim().slice(0, 48)}`);
  }
}

/* ⑦ 查证结论必须留痕（wry 的返回键语义） ----------------------------------- */
const navRaw = readFileSync(NAV_STACK, "utf8");
ok(/handleBackNavigation/.test(navRaw) && /back-button/.test(navRaw) && /AppPlugin/.test(navRaw), "navStack.ts 没记录真机查证结论（Tauri 关掉 handleBackNavigation、返回键走 AppPlugin 的 back-button 事件）");
ok(/register_listener/.test(navRaw) && /onBackButtonPress/.test(navRaw) && /驼峰/.test(navRaw), "navStack.ts 没记录返回键两个实测坑（命令名必须下划线 register_listener、官方入口 onBackButtonPress、驼峰被 ACL 拒）");

if (fails.length) {
  console.error("导航栈护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
/* ⑨ dev 自检：真机走查要看得到栈深与返回键监听状态 --------------------------- */
const devRaw = read("apps/desktop/src/components/DevPanel.tsx");
ok(read("apps/desktop/src/state/navStack.ts").includes("export function navDebugState"), "navStack 没有 navDebugState（dev 面板无法自检栈深/监听）");
ok(/navDebugState, subscribeNav/.test(devRaw), "DevPanel 没有订阅导航栈自检");
ok(/导航栈/.test(devRaw) && /listening \? "在册" : "未注册"/.test(devRaw), "DevPanel 没有「导航栈」行（栈深 / 可返回 / 监听状态）");
ok(/backError = String\(e instanceof Error/.test(read("apps/desktop/src/state/navStack.ts")), "注册/摘除异常没有留痕（真机上会静默失效）");

console.log("导航栈护栏：唯一 history/back-button 入口 + navigate 收口 + 纯 JS 栈（不依赖 WebView 历史）+ 栈上限 50 + 返回键先关浮层再退栈、栈空退出 + 六个浮层登记 + 返回按钮走栈 ✓");
