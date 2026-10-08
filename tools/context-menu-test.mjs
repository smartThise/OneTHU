#!/usr/bin/env node
/**
 * A3 护栏：长按菜单（移动端对应 PC 右键）。
 *
 * 由来：长按菜单的坑都在「看不见的地方」——判定时长写歪了（一滑就弹菜单）、
 * 定位没夹紧（菜单被屏幕边缘裁掉）、忘了抑制长按后补发的 click（菜单弹出的同时
 * 卡片也跳转）、以及最隐蔽的一条：为了「收藏」又写一份新存储（于是星标与菜单
 * 各显示一套收藏状态）。这些在类型检查和截图里都看不出来，只能做源码级断言。
 *
 * 断言（与施工图 A3「护栏」一节逐条对应）：
 *   ① 矩阵四类齐全：作业卡片=忽略/提醒/收藏、在线服务=固定/收藏、课程与页面=收藏、
 *      文件=下载/在文件夹中显示（都在各自宿主里，不是只写在文档里）；
 *   ② 菜单项只调既有数据层（hwIgnore / hwRemind / CollectModal / THOS 常用 /
 *      clients 下载 / localFile 定位），菜单组件自己不含任何存储 API 与存储键名；
 *   ③ 长按判定 500ms，位移超过 10px 取消，抬手/中断都清理定时器；
 *   ④ 定位是 portal 到 body + fixed，且四边都夹紧；
 *   ⑤ 全局拦截 contextmenu，但选中可选文本时放行原生菜单；
 *   ⑥ 键盘可达：Esc 关闭、↑↓ 移动、Enter 触发；
 *   ⑦ 触发瞬间**不自己发触感**（真机取证：WebView 的长按系统反馈已经响一次，再叠我们那条就是两下）；
 *   ⑧ 长按后紧随的那次 click 被吞掉（否则卡片会跟着跳转）；
 *   ⑨ 霖 2026-09-30 #3/#4 返工后的两条新口径：
 *      · 展开是「按点上的小液团长成面板」（位移走 back-out 过冲、尺寸走 easeOut、圆角从半宽收拢），
 *        背景是毛玻璃；只动 transform/opacity/clip-path；
 *      · 覆盖面：除四类宿主外还有一层全局 `data-ctx-atom`（今日页卡片 / 待办汇总卡与通知条 /
 *        作业列表行都在内）——「只有作业卡片能长按」正是这一条没做的后果。
 *
 * 跑法：node tools/context-menu-test.mjs ｜ 退出码 0（通过）/ 1（违规）
 */
import { readFileSync } from "node:fs";

const MENU = "apps/desktop/src/components/ContextMenu.tsx";
const LAYOUT = "apps/desktop/src/components/Layout.tsx";
const TASKS = "apps/desktop/src/pages/TasksPage.tsx";
const THOS = "apps/desktop/src/pages/info/ThosPage.tsx";
const LEARN = "apps/desktop/src/pages/Learn.tsx";
const FOLDER = "apps/desktop/src/pages/FolderPage.tsx";
const FILE_ROW = "apps/desktop/src/pages/learn/shared.tsx";
const TODAY = "apps/desktop/src/pages/Today.tsx";
const CSS = "apps/desktop/src/styles/global.css";
const MOTION = "apps/desktop/src/styles/motion.css";

/** 注释按等长空格遮蔽：注释里写「不要 localStorage」「500ms」都不算正文（本仓踩过这个坑） */
const maskComments = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
const read = (p) => maskComments(readFileSync(p, "utf8"));

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

const motion = readFileSync(MOTION, "utf8");
const menu = read(MENU);
const layout = read(LAYOUT);
const tasks = read(TASKS);
const thos = read(THOS);
const learn = read(LEARN);
const folder = read(FOLDER);
const fileRow = read(FILE_ROW);
const css = read(CSS);

/* ① 矩阵四类齐全（宿主里真的各有一条长按区） ------------------------------- */
ok(
  /selector: "\.hw-card"/.test(tasks) && /label: "忽略"/.test(tasks) && /label: "提醒"/.test(tasks) && /label: "收藏"/.test(tasks),
  "作业卡片的长按菜单缺项（矩阵第一行应为 忽略 / 提醒 / 收藏）",
);
ok(
  /selector: "\.thos-service-card"/.test(thos) && /label: on \? "取消固定" : "固定"/.test(thos) && /label: "收藏"/.test(thos),
  "在线服务的长按菜单缺项（矩阵第二行应为 固定 / 收藏）",
);
ok(/selector: "\.course-card"/.test(learn) && /label: "收藏"/.test(learn), "课程卡片的长按菜单缺 收藏（矩阵第三行的「课程」）");
ok(/useLongPress\(/.test(folder) && /label: "收藏"/.test(folder), "收藏夹项的长按菜单缺 收藏（矩阵第三行的「页面」）");
ok(
  /label: "下载"/.test(fileRow) && /label: "在文件夹中显示"/.test(fileRow),
  "文件的长按菜单缺项（矩阵第四行应为 下载 / 在文件夹中显示）",
);

/* ② 只调既有数据层；菜单自己不含存储 --------------------------------------- */
ok(!/localStorage|sessionStorage|setItem/.test(menu), "长按菜单自己碰了存储：菜单项只允许调用既有数据层");
ok(!/["'`]onethu\.[a-z0-9.]+/.test(menu), "长按菜单里出现了存储键名（A3 明确不新增 localStorage key）");
ok(
  /ignoreHw\(h\.id, h\.title\)/.test(tasks) && /CONFIRM_IGNORE_HW/.test(tasks) && /confirmDanger\(/.test(tasks),
  "作业「忽略」没走 hwIgnore + CONFIRM_IGNORE_HW 二次确认",
);
ok(
  /<HwRemindPop/.test(tasks) && /setHwReminder\(h\.id, m\)/.test(tasks),
  "作业「提醒」没复用卡片铃铛的 HwRemindPop + setHwReminder（会分叉出第二套档位）",
);
for (const [src, name] of [
  [tasks, "作业卡片"],
  [thos, "在线服务"],
  [learn, "课程卡片"],
  [folder, "收藏夹项"],
]) {
  ok(/<CollectModal/.test(src), name + "的「收藏」没走既有 CollectModal 通路（不许另写一份收藏存储）");
}
ok(/favorite\(item\.id\)/.test(thos), "在线服务「固定」没走本页既有的常用列表");
ok(
  /downloadLearnFile\(/.test(fileRow) && /revealLocalPath\(/.test(fileRow) && /download_directory_get/.test(fileRow),
  "文件菜单没走既有通路（下载 = downloadLearnFile，定位 = revealLocalPath + 下载目录）",
);

/* ③ 长按判定：500ms / 10px / 清理 ------------------------------------------ */
ok(/export const LONG_PRESS_MS = 500;/.test(menu), "长按判定不是 500ms");
ok(/export const LONG_PRESS_MOVE = 10;/.test(menu), "长按位移取消阈值不是 10px");
ok(/> LONG_PRESS_MOVE\) cancel\(\)/.test(menu), "位移超过阈值没有取消长按（会和列表滚动/轮播滑动打架）");
ok(
  /addEventListener\("touchstart", onStart/.test(menu) &&
    /addEventListener\("touchmove", onMove/.test(menu) &&
    /addEventListener\("touchend", ctl\.cancel/.test(menu) &&
    /addEventListener\("touchcancel", ctl\.cancel/.test(menu),
  "长按区的事件生命周期不齐（touchstart/touchmove 要起判定，touchend/touchcancel 要清理）",
);
ok(
  /onTouchEnd: \(\) => ctl\.current\?\.cancel\(\)/.test(menu) && /onTouchCancel: \(\) => ctl\.current\?\.cancel\(\)/.test(menu),
  "单项长按（列表项组件）的抬手/中断没有清理定时器",
);

/* ④ 定位：portal 到 body + fixed + 四边夹紧 -------------------------------- */
ok(/createPortal\(/.test(menu) && /document\.body/.test(menu), "菜单没有 portal 到 body（会被滚动容器裁掉）");
ok(/\.ctx-menu \{[\s\S]*?position: fixed/.test(css), "菜单定位不是 fixed（会被滚动容器裁掉 / 随内容滚走）");
ok(
  /left = Math\.max\(MENU_MARGIN, Math\.min\(left, vw - w - MENU_MARGIN\)\)/.test(menu) &&
    /top = Math\.max\(MENU_MARGIN, Math\.min\(top, vh - h - MENU_MARGIN\)\)/.test(menu),
  "左边/右边/上边/下边没有夹紧（菜单会被屏幕边缘裁掉）",
);
/* 霖 2026-10-01 #4：长按（手指）优先向左上弹（向下弹盖在手指底下）；鼠标右键保持右下 ------- */
ok(
  /* ⚠️ 2026-10-07 形状变更、含义未变：方向原先在布局里现算（takeHoldOrigin 一次性消费）。
     真机复验发现同一次手势会开两次菜单（JS 长按计时器 + Android 为长按补发的 contextmenu），
     第二次读到的必然是 false → 菜单翻到右下盖住手指。现改为「打开那一刻定死、随 CtxRequest.hold
     带走」，并补一条坐标判据（contextmenu 比计时器先到、或计时器被 touchcancel 掐掉时也认出手指）。 */
  /export function isHoldOrigin\(\): boolean/.test(menu) &&
    /export function isTouchContextMenu\(x: number, y: number\): boolean/.test(menu) &&
    /holdAt = typeof performance === "undefined" \? Date.now\(\) : performance\.now\(\);/.test(menu) &&
    /hold\?: boolean;/.test(menu) &&
    /hold: isHoldOrigin\(\) \|\| isTouchContextMenu\(r\.x, r\.y\)/.test(menu) &&
    /const fromHold = req\.hold === true;/.test(menu) &&
    (menu.match(/holdAt = 0;/g) ?? []).length === 1,
  "#4：菜单没有区分「手指长按 / 鼠标右键」的来源，或方向没有在打开那一刻定死随请求带走（长按时间戳被读一次就清会让第二次打开翻到右下）",
);
ok(
  /if \(fromHold\) \{\s*\n\s*left = req\.x - w;/.test(menu) && /top = req\.y - h;/.test(menu),
  "#4：长按菜单没有优先向左上方弹出（向下弹会被手指挡住）",
);
ok(
  /if \(left < MENU_MARGIN\) \{\s*\n\s*left = req\.x;/.test(menu) && /if \(top < MENU_MARGIN\) \{\s*\n\s*top = req\.y;/.test(menu),
  "#4：左上放不下时没有翻转到右/下（极端位置菜单会跑出屏幕或贴边裁切）",
);
ok(
  /\} else \{\s*\n\s*left = req\.x;/.test(menu) &&
    /if \(left \+ w > vw - MENU_MARGIN\) \{\s*\n\s*left = req\.x - w;/.test(menu) &&
    /if \(top \+ h > vh - MENU_MARGIN\) \{\s*\n\s*top = req\.y - h;/.test(menu),
  "鼠标右键路径被改掉了（Windows 习惯是向右下弹，右边/下边放不下才翻转）",
);
/* 落位尺寸必须取**布局盒**（2026-10-07 真机复验）：入场动画 ctx-bloom 的填充是 both，同一次手势的
   第二次打开（Android 为长按补发的 contextmenu，与长按计时器只差几毫秒）跑在动画「尚未开始、
   backwards 填充生效」的那一刻，getBoundingClientRect() 量到的是 0% 帧的液团尺寸（48×48）——
   于是 left = 按点 − 48px，菜单落到手指右下方（实测按点 (206,298) 的落位变成 (158,250)）。
   offsetWidth/Height 不受 transform 影响，两条路径量到同一尺寸，落位因此幂等。 */
{
  const to = menu.indexOf("}, [req, panelKey]);");
  const from = menu.lastIndexOf("useLayoutEffect(", to);
  const body = from >= 0 && to > from ? menu.slice(from, to) : "";
  ok(
    /const w = el\.offsetWidth;/.test(body) && /const h = el\.offsetHeight;/.test(body) && !/[^\w]r\.width/.test(body) && !/[^\w]r\.height/.test(body),
    "#4：落位尺寸没有取布局盒（offsetWidth/offsetHeight）——量到入场动画起始帧的液团尺寸会把菜单摆到手指右下方",
  );
  ok(
    /const last = placedRef\.current;/.test(body) &&
      /if \(last && last\.panel === panelKey && Math\.abs\(last\.x - req\.x\) < 4 && Math\.abs\(last\.y - req\.y\) < 4\) return;/.test(body),
    "#4：同一次手势的第二次打开没有沿用第一次的落位（会重新量一次）",
  );
}

/* ⑤ 文本选区放行 ------------------------------------------------------------ */
ok(
  /getSelection\?\.\(\)/.test(menu) && /sel\.isCollapsed/.test(menu) && /sel\.toString\(\)\.trim\(\)/.test(menu),
  "没有识别文本选区（空选区才该吃掉右键，非空要放行）",
);
ok(/getPropertyValue\("user-select"\)/.test(menu), "文本选区放行没有按「可选文本容器」判定（公告/通知要能复制）");
ok(/addEventListener\("contextmenu"/.test(layout) && /e\.preventDefault\(\)/.test(layout), "Layout 没有挂全局 contextmenu 拦截");
ok(/if \(hasTextSelection\(\)\) return;/.test(layout), "全局拦截没给文本选区放行：公告/通知文字将无法复制");

/* ⑥ 键盘可达 ---------------------------------------------------------------- */
ok(
  /e\.key === "Escape"/.test(menu) && /e\.key !== "ArrowDown" && e\.key !== "ArrowUp"/.test(menu) && /e\.key === "Enter"/.test(menu),
  "键盘可达不全（应 Esc 关闭 / ↑↓ 移动 / Enter 触发）",
);
ok(/role="menu"/.test(menu) && /role="menuitem"/.test(menu), "菜单缺少 menu / menuitem 语义");

/* ⑦ 触感 -------------------------------------------------------------------- */
ok(
  /haptic\("longPress"\)/.test(menu) && !/navigator\.vibrate/.test(menu),
  "长按没有走 lib/haptics.ts 的 longPress（霖 2026-10-02「长按手感恢复」）",
);
/* 恢复的前提是宿主侧把 WebView 那条系统长按反馈关掉：只关一头 = 两声，一头都不关 = 只关错的那声 */
{
  const KOTLIN = "apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt";
  const kotlin = readFileSync(KOTLIN, "utf8");
  const lib = readFileSync("apps/desktop/src/lib/haptics.ts", "utf8");
  const rust = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
  ok(/fun webHapticsOff\(invoke: Invoke\)/.test(kotlin) && /isHapticFeedbackEnabled = false/.test(kotlin),
    "宿主没关掉 WebView 的系统触感反馈（真机上长按会连振两下）");
  ok(/import android\.webkit\.WebView/.test(kotlin) && /v is WebView/.test(kotlin),
    "Kotlin 侧没在视图树里找主 WebView（关不掉就没有意义）");
  ok(/ui_web_haptics_off/.test(lib), "前端挂载时没调 ui_web_haptics_off");
  ok(/ui_web_haptics_off/.test(rust) && /webHapticsOff/.test(rust), "Rust 侧没把 webHapticsOff 接到命令上");
}
ok(!/ui_haptic_tick|navigator\.vibrate/.test(menu), "长按菜单绕过了 lib/haptics.ts 的降级链");

/* ⑧ 长按后抑制紧随的 click -------------------------------------------------- */
ok(
  /function armSwallow\(/.test(menu) && /swallowOrigin\.contains\(e\.target\)/.test(menu),
  "长按后没有抑制紧随的 click（菜单弹出的同时卡片会跟着跳转）",
);
ok(
  /addEventListener\("click", onSwallowClick, true\)/.test(menu),
  "抑制 click 必须挂 document 捕获阶段：挂目标元素晚于 React 的根容器委托，stopPropagation 来不及",
);

/* ⑨ D9 展开动画：从按点上的小液团长成面板（模仿 Liquid Morph Engine，不用它的着色器）---- */
ok(
  /let originX: "left" \| "right";/.test(menu) &&
    /let originY: "top" \| "bottom";/.test(menu) &&
    /transformOrigin: geom \? geom\.originX \+ " " \+ geom\.originY/.test(menu),
  "D9：菜单展开的原点必须由本次定位决策（向左上 / 翻转后的那一角）决定（固定从中心放大是反例）",
);
ok(
  /export const CTX_BLOB_SIZE = \d+;/.test(menu) &&
    /"--ctx-dx": \(blob\?\.dx \?\? 0\) \+ "px"/.test(menu) &&
    /"--ctx-sy": String\(blob\?\.sy \?\? 1\)/.test(menu) &&
    /"--ctx-r0": \(blob\?\.r0 \?\? \d+\) \+ "px"/.test(menu),
  "D9：面板起始不是按点上的小液团（液团尺寸/位移/起始圆角必须由实测矩形算出来）",
);
ok(
  /r0: Math\.round\(w \/ 2\)/.test(menu),
  "D9：液团起始圆角不是面板半宽——液团在角上必须是正圆（Liquid Morph 的 maxRadius 口径）",
);
ok(
  /const bx = req\.x - CTX_BLOB_SIZE \/ 2;/.test(menu) && /const by = req\.y - CTX_BLOB_SIZE \/ 2;/.test(menu),
  "D9：液团圆心没有落在按点上",
);
ok(
  /export const CTX_STAGGER_MS = 2[0-9];/.test(menu) &&
    /"--ctx-stagger": CTX_STAGGER_MS \+ "ms"/.test(menu) &&
    /calc\(var\(--ctx-i, 0\) \* var\(--ctx-stagger/.test(css),
  "D9：选项逐个浮现的步进不在 20–29ms 档（霖 #3 加快后），或没从 CTX_STAGGER_MS 一路接到 CSS",
);
const kf = [...css.matchAll(/@keyframes\s+(ctx-[a-z-]+)\s*\{([\s\S]*?)\n\}/g)];
ok(kf.length >= 2, "D9：缺少面板与选项的关键帧（ctx-bloom / ctx-item-in）");
/* 霖 2026-10-02 #4：遮罩的出现/退场要带模糊半径渐变（0 → r → 0），所以这两条关键帧额外
   放行 backdrop-filter；其余关键帧仍只许动 transform/opacity/clip-path（width/height 会触发布局）。 */
const BLUR_KF = ["ctx-blur-in", "ctx-blur-out"];
for (const [, name, body] of kf) {
  const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
  /* 第四批 #2 的 ctx-menu-out 用独立 `scale` 收场：它和 transform 一样只在合成器上跑，
   不动布局，所以白名单里放行 scale。 */
const allow = BLUR_KF.includes(name)
    ? ["opacity", "transform", "clip-path", "backdrop-filter", "-webkit-backdrop-filter"]
    : ["opacity", "transform", "scale", "clip-path"];
  const bad = props.filter((p) => !allow.includes(p));
  ok(bad.length === 0, "D9：关键帧 " + name + " 动了 " + bad.join("/") + "——" + (BLUR_KF.includes(name) ? "只许动 opacity/backdrop-filter" : "展开只许动 transform/opacity/clip-path") + "（width/height 会触发布局）");
}
const bloom = kf.find((m) => m[1] === "ctx-bloom");
ok(!!bloom, "D9：没有 ctx-bloom 关键帧（面板生长）");
if (bloom) {
  /* 过冲：back-out 曲线在 40%~60% 处把液团送过目标位置（乘数为负），全程 easeOut 是反例 */
  ok(/\*\s*-\d/.test(bloom[2]), "D9：面板生长没有过冲（位移乘数必须出现负值，即冲过目标再收回来）");
  ok(/--ctx-r0/.test(bloom[2]) && /--r-md/.test(bloom[2]), "D9：圆角没有从液团半宽收拢到标准圆角");
  /* 霖 2026-10-01 #3：弹出要快——面板走 --dur-3，且该档位实测 ≤ 320ms（读了 motion.css 的令牌值） */
  ok(
    /animation: ctx-bloom var\(--dur-3\) linear both/.test(css.slice(css.indexOf(".ctx-menu"), css.indexOf("@keyframes ctx-bloom"))),
    "D9：面板生长的时长不是 --dur-3 / 曲线不是 linear（曲线已烘进关键帧，缓动函数必须 linear）",
  );
  const dur3 = /--dur-3:\s*var\(--md-sys-motion-duration-medium-2\)/.test(motion) &&
    (() => {
      const m = /--md-sys-motion-duration-medium-2:\s*(\d+)ms/.exec(motion);
      return !!m && Number(m[1]) <= 320;
    })();
  ok(dur3, "D9：--dur-3 没有指向 MD3 medium-2，或该档位 >320ms（霖 #3 要求弹出更快）");
}
ok(/animation: ctx-item-in var\(--dur-2\) var\(--ease-out\) both/.test(css), "D9：选项浮现没有独立时长/缓动（加快后走 --dur-2）");
ok(/calc\(var\(--ctx-i, 0\) \* var\(--ctx-stagger, 24ms\) \+ 80ms\)/.test(css), "D9：选项要从面板行程约 25%（80ms）处才开始浮现（延迟必须含固定偏移）");
ok(/scale\(0\.7\)/.test(css), "D9：选项浮现没有 0.7→1 的缩放（只有淡入是反例）");
ok(
  /backdrop-filter: blur\(/.test(css) && /color-mix\(in srgb, var\(--md-sys-color-surface-container-lowest\)/.test(css),
  "D9：面板背景不是毛玻璃（霖 #3：背景给毛玻璃即可，不必复刻 liquid glass 着色器）",
);
ok(/prefersReducedMotion\(\)/.test(menu) && /is-still/.test(menu), "D9：展开动画没有 reduced-motion 降级");
ok(
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.ctx-menu,\s*\.ctx-item \{ animation: none; \}/.test(css),
  "D9：CSS 缺少 reduced-motion 直接显示的兜底",
);

/* ⑨b 霖 2026-10-01 #5/#6：面板更透、两级按压、其余元素毛玻璃 ------------------ */
{
  const menuBlock = css.slice(css.indexOf(".ctx-menu {"), css.indexOf(".ctx-title {"));
  const bg = /color-mix\(in srgb, var\(--md-sys-color-surface-container-lowest\) (\d+)%, transparent\)/.exec(menuBlock);
  ok(!!bg, "#6：菜单背景不是「surface-container-lowest + 透明度」的毛玻璃写法");
  ok(!!bg && Number(bg[1]) <= 60, `#6：菜单背景不够透（现在 ${bg ? bg[1] : "?"}%，要求 ≤60%）`);
  ok(
    /--backdrop-filter: blur\(2[0-9]px\)/.test(menuBlock) || /backdrop-filter: blur\(2[0-9]px\)/.test(menuBlock),
    "#6：面板更透之后背景没有糊得更狠（可读性会掉）",
  );
  /* 两级按压：按下 0.97 / 长按 1.1，且只动 transform（改尺寸会挤动邻居） */
  ok(/export const PRESS_ATTR = "data-ctx-press";/.test(menu), "#5：没有按压状态属性常量（两级按压没有事实源）");
  ok(
    /export function pressDown\(/.test(menu) && /export function pressHold\(/.test(menu) && /export function clearPress\(/.test(menu),
    "#5：缺少 pressDown / pressHold / clearPress（轻点与长按两级要分开）",
  );
  ok(
    /if \(el\) pressDown\(el\);/.test(menu) && /if \(hitEl\) pressHold\(hitEl\);/.test(menu),
    "#5：长按判定没有把按压状态挂到目标上（按下轻缩、长按放大都走它）",
  );
  ok(
    /if \(!held && pressed\) clearPress\(pressed\);/.test(menu) &&
      /export function clearPress\(el\?: HTMLElement\): void \{\s*\n\s*if \(el && pressedEl !== el\) return;/.test(menu) &&
      /useEffect\(\(\) => clearPress, \[\]\)/.test(menu),
    "#5：轻点抬手没收回缩、或菜单关闭后没撤掉 1.1 与遮罩、或按压状态会被别的长按入口误清（同一触摸有两个入口）",
  );
  /* 注释在 read() 里已被等长空格遮蔽，切片终点必须用真代码（用 .ctx-menu 块） */
  const press = css.slice(css.indexOf("[data-ctx-press][data-ctx-press] {"), css.indexOf(".ctx-menu {"));
  ok(/\[data-ctx-press\]\[data-ctx-press="tap"\] \{ --ctx-press-k: 0\.97; \}/.test(press), "#5：轻点没有轻微缩小（--ctx-press-k: 0.97）");
  /* 倍率只能写在 tap/hold（双属性）里：通用规则再写一份 `--ctx-press-k: 1` 会因为选择器更具体
     把 0.97/1.1 全压掉（真机踩过：倍率恒为 1，按下去完全不动） */
  const genericPress = /\[data-ctx-press\]\[data-ctx-press\] \{([^}]*)\}/.exec(press)?.[1] ?? "";
  ok(!/--ctx-press-k\s*:/.test(genericPress), "#5：通用按压规则里又写了 --ctx-press-k（选择器更具体，会把 tap/hold 的倍率压掉）");
  const holdBlock0 = /\[data-ctx-press\]\[data-ctx-press="hold"\]\s*\{([^}]*)\}/.exec(press)?.[1] ?? "";
  ok(/--ctx-press-k: 1\.1;/.test(holdBlock0), "#5：长按没有放大到 1.1");
  {
    /* 独立 `scale` 仍是现代引擎的唯一机制；`transform` 只允许出现在「旧引擎没有 scale」的
       兜底块里（霖 2026-10-04 老机型适配：WebView 96 丢弃 scale → 用 transform 补一版，
       专用 @supports not (scale: 1) 门住，且 .hw-card 已在门内显式退出）。 */
    const pressModern = press.replace(/@supports not \(scale: 1\) \{[\s\S]*?\n\}/, "");
    ok(
      /scale: var\(--ctx-press-k\)/.test(press) && !/transform:\s*scale\(/.test(pressModern),
      "#3/#5：按压缩放又走回 transform——卡片流的内联 transform 会被顶掉、整张卡跳位，且卡片入场动画会压掉过渡（改回 scale + --ctx-press-k）",
    );
    ok(
      /@supports not \(scale: 1\) \{[\s\S]*?transform: scale\(var\(--ctx-press-k\)\)[\s\S]*?\.hw-card \{ transform: none; \}/.test(press),
      "老机型（WebView 96）：缺 @supports not (scale: 1) 的 transform 兜底，或没在兜底里把 .hw-card 排除（卡片流自己消费倍率）",
    );
  }
  ok(
    /\[data-ctx-press\]\[data-ctx-press\] \{[\s\S]{0,120}?transition: scale var\(--dur-1\)/.test(press),
    "#5：按压过渡没有双属性选择器（元素自己写的 transition 会压掉它，余额速览那种就只剩突变）",
  );
  ok(
    /\[data-ctx-press\]\.hw-card \{[\s\S]{0,80}?scale: none;/.test(press) &&
      /transition: --ctx-press-k/.test(press) &&
      /var\(--ctx-press-k, 1\)/.test(read("apps/desktop/src/pages/TasksPage.tsx")),
    "#3：卡片流没有把按压系数乘进它自己的 transform（要不就被二次缩放、要不就跳位）",
  );
  ok(!/width:|height:|margin:|padding:/.test(press.replace(/\/\*[\s\S]*?\*\//g, "")), "#5：按压反馈动了尺寸/边距——必须只动缩放（不能挤动邻居）");
  /* 毛玻璃遮罩：挂 body 盖整屏 + 目标处 evenodd 挖洞；层级 菜单 2400 > 遮罩 2390 > 顶栏 30/底栏 60 */
  ok(/\.ctx-blur \{[\s\S]*?backdrop-filter: blur\(/.test(css), "#5：其余元素没有毛玻璃遮罩");
  ok(
    /--ctx-blur-r: ([1-4](?:\.\d+)?)px/.test(css) && /var\(--md-sys-color-scrim\) (\d+)%/.test(css.split(".ctx-blur {")[1]?.slice(0, 400) ?? ""),
    "#4：遮罩强度没有减弱（模糊半径要 1–4px、scrim 要显式给百分比）",
  );
  {
    const scrim = Number(/var\(--md-sys-color-scrim\) (\d+)%/.exec(css.split(".ctx-blur {")[1]?.slice(0, 400) ?? "")?.[1] ?? 100);
    /* 霖 2026-10-02 批次 5：上一版 34% 让画面发灰发脏，降亮度的力度减半 → 17% */
    ok(scrim === 17, `#5：遮罩底色不是减半后的 17%（现在 ${scrim}%——回到 34% 画面就发灰）`);
  }
  ok(
    /@keyframes ctx-blur-in \{[\s\S]*?backdrop-filter: blur\(0px\)[\s\S]*?backdrop-filter: blur\(var\(--ctx-blur-r\)\)/.test(css) &&
      /@keyframes ctx-blur-out \{[\s\S]*?backdrop-filter: blur\(var\(--ctx-blur-r\)\)[\s\S]*?backdrop-filter: blur\(0px\)/.test(css) &&
      /\.ctx-blur\.is-out \{ animation: ctx-blur-out/.test(css),
    "#4：遮罩出现/退场没有模糊半径渐变动画（0 → r → 0）",
  );
  ok(
    /const BLUR_OUT_MS = \d+;/.test(menu) && /layer\.classList\.add\("is-out"\)/.test(menu) &&
    /setTimeout\(\(\) => \{[\s\S]{0,160}?layer\.remove\(\);/.test(menu),
    "#4：退场只是 remove() 一帧消失，没等退场动画播完",
  );
  /* 第四批 #3：两处时长必须对齐，否则要么动画没播完就摘、要么空等 */
  const blurOutCss = Number(/animation: ctx-blur-out (\d+)ms/.exec(css)?.[1] ?? 0);
  const blurOutJs = Number(/const BLUR_OUT_MS = (\d+);/.exec(menu)?.[1] ?? 0);
  ok(
    /* 霖 2026-10-02 批次 5：曲线要慢入快出（standard-accelerate = cubic-bezier(0.3,0,1,1)），
       不是线性，也不是起步很快的 standard/decelerate。批次 6：时长按霖的要求收回 200ms。 */
    /\.ctx-blur \{[^}]*animation: ctx-blur-in 200ms var\(--md-sys-motion-easing-standard-accelerate\) both;/.test(css) &&
      /\.ctx-blur\.is-out \{[^}]*animation: ctx-blur-out 200ms var\(--md-sys-motion-easing-standard-accelerate\) both;/.test(css) &&
      blurOutCss === blurOutJs &&
      blurOutCss >= 150 &&
      blurOutCss <= 260,
    "#3：遮罩时长不是霖定的 200ms，或退场 CSS 与 BLUR_OUT_MS 不同值（两者必须同值且在 150–260ms 之间）",
  );
  /* 第四批 #2：菜单离场动画 */
  ok(
    /const MENU_OUT_MS = \d+;/.test(menu) &&
      /setTimeout\(\(\) => \{[\s\S]{0,80}setReq\(null\)/.test(menu) &&
      /\.ctx-menu\.is-out \{[^}]*animation: ctx-menu-out 180ms/.test(css) &&
      /@keyframes ctx-menu-out \{[\s\S]{0,120}to \{ opacity: 0; scale: 0\.94; \}/.test(css) &&
      /leaving \? " is-out" : ""/.test(menu) &&
      /<CtxMenu req=\{req\} leaving=\{leaving\}/.test(menu),
    "#2：菜单离场没有动画（关闭要留节点播 is-out，长按菜单与「···」菜单是同一个本体）",
  );
  /* 第四批 #1：同一手势被多路入口看到时只许振一次 */
  ok(
    /const HOLD_DUP_BEGIN_MS = 40;/.test(menu) &&
      /const dupEntry = t - lastHoldBeginAt <= HOLD_DUP_BEGIN_MS;/.test(menu) &&
      /held = true;\s*\n\s*if \(dupEntry\) return;/.test(menu),
    "#1：长按的重复入口没去重（同一手势会被单项/长按区/全局兜底两路各 haptic 一次，真机就是连振两下）",
  );
  ok(/const BLUR_CLASS = "ctx-blur";/.test(menu) && /blurLayer\.className = BLUR_CLASS;/.test(menu), "#5：遮罩层不是按约定类名插进 DOM 的");
  /* 霖 2026-10-02：遮罩期间 OH 悬浮坞也要进毛玻璃——靠 <html> 上的标记把三块压到遮罩之下 */
  ok(/const BLUR_ROOT_CLASS = "ctx-blur-on";/.test(menu), "#5：没有遮罩期根标记（OH 悬浮坞进不了毛玻璃）");
  ok(/document\.documentElement\.classList\.add\(BLUR_ROOT_CLASS\)/.test(menu), "遮罩起来时没挂根标记");
  /* 霖 2026-10-02 复看：抬手要平滑缩回原大小——标记不能直接摘（摘了就没了 transition），
     先落到 rest 态（倍率 1），JS 等过渡播完再摘；两个数字必须对齐 */
  ok(
    /\[data-ctx-press\]\[data-ctx-press="rest"\] \{ --ctx-press-k: 1; \}/.test(css),
    "缺抬手归位态（rest）：标记一摘 transition 就失效，缩放会突变回原大小",
  );
  ok(/const PRESS_REST_MS = \d+;/.test(menu), "JS 缺 PRESS_REST_MS（归位态保留时长）");
  ok(
    /setAttribute\(PRESS_ATTR, "rest"\)/.test(menu) && /getAttribute\(PRESS_ATTR\) === "rest"/.test(menu),
    "抬手没有走 rest 态（或没在过渡播完后才摘标记）",
  );
  {
    const restMs = Number(/const PRESS_REST_MS = (\d+);/.exec(menu)?.[1] ?? 0);
    const scaleMs = Number(/--dur-2: var\(--md-sys-motion-duration-short-4\)/.test(readFileSync(MOTION, "utf8")) ? 220 : 220);
    ok(restMs >= scaleMs, `PRESS_REST_MS(${restMs}) 小于最长那条 scale 过渡(${scaleMs}ms)：会提前摘标记，缩放收不完`);
    ok(restMs <= 600, `PRESS_REST_MS(${restMs}) 过长：标记常驻会让长按去重/菜单判定读到旧状态`);
  }
  ok(
    (menu.match(/document\.documentElement\.classList\.remove\(BLUR_ROOT_CLASS\)/g) ?? []).length >= 2,
    "退场路径没摘根标记（减弱动效那条 + 动画播完那条都要摘）",
  );
  ok(
    /html\.ctx-blur-on \.dock-island,[\s\S]{0,160}html\.ctx-blur-on \.dock-panel,[\s\S]{0,160}html\.ctx-blur-on \.dock-voice-mask \{[^}]*z-index: 2389;/.test(css),
    "OH 悬浮坞的三层（胶囊/面板/语音遮罩）没有一起压到毛玻璃之下",
  );
  {
    const z = Number(/html\.ctx-blur-on \.dock-island[\s\S]{0,220}?z-index: (\d+);/.exec(css)?.[1] ?? 0);
    const blurZ = Number(/\.ctx-blur \{[\s\S]*?z-index: (\d+)/.exec(css)?.[1] ?? 0);
    ok(z > 0 && blurZ > 0 && z < blurZ, "悬浮坞的层级没有压到遮罩之下（应 < .ctx-blur 的 z-index）");
    ok(!/html\.ctx-blur-on \.plg-badge/.test(css), "dev 徽标不该跟着改（只是调试用，正式版没有）");
  }
  ok(
    /document\.body\.appendChild\(blurLayer\)/.test(menu),
    "#5：遮罩没挂到 body——塞进目标的层叠上下文只能遮住页面内容区，顶栏/底栏是另外两个定位层，遮不住（真机实测过）",
  );
  ok(
    /export const HOLD_SCALE = 1\.1;/.test(menu) &&
      /const hw = \(el\.offsetWidth \* HOLD_SCALE\) \/ 2;/.test(menu) &&
      /clipPath = holeClip\(/.test(menu) &&
      /export function holeClip\(/.test(menu),
    "#5：遮罩没有在目标处挖洞（洞要按 offsetWidth×HOLD_SCALE 算：按当前矩形算会在 0.97→1.1 过渡中途量偏小，切到目标自己的边）",
  );
  /* 第四批 #4：挖洞必须是**两条子路径**的 path(evenodd)——单条 polygon(四角 + 洞四角) 会在
     洞与外圈之间留下两条斜连线，evenodd 把连线左侧的三角形清掉（真机现象见 §14/#4）。 */
  ok(
    /return 'path\(evenodd, "'/.test(menu) &&
      /"M0 0 H" \+ vw \+ " V" \+ vh \+ " H0 Z"/.test(menu) &&
      !/polygon\(evenodd/.test(menu),
    "#4：遮罩挖洞又用回单条 polygon(evenodd)：洞与外圈之间的斜连线会自交，左侧那块三角会被 evenodd 清掉",
  );
  /* 第四批 #5：洞要跟着目标的圆角走，否则圆角卡片挖出来是个直角矩形 */
  ok(
    /function holdRadius\(el: HTMLElement\): number/.test(menu) &&
      /borderTopLeftRadius/.test(menu) &&
      /const rr = Math\.max\(0, Math\.min\(radius, w \/ 2, h \/ 2\)\)/.test(menu) &&
      /A" \+ rr \+ " " \+ rr \+ " 0 0 1 /.test(menu),
    "#5：挖洞没有取目标的圆角（holeClip 要按 border-radius 画弧），圆角卡片会被挖成直角矩形",
  );
  /* 霖 2026-10-02 #1：缩放/高亮只给手指底下那个控件，菜单仍归原子宿主 */
  ok(
    /const PRESS_CTL_SEL = "button, a, \[role='button'\], input, select, label, summary";/.test(menu) &&
      /function pressElOf\(t: EventTarget \| null, host: HTMLElement\): HTMLElement \{/.test(menu) &&
      /pressEl = hit \? pressElOf\(e\.target, hit\) : null;/.test(menu) &&
      /\}, \(\) => pressEl\);/.test(menu),
    "#1：原子块（待办页统计区 + 两个入口）还是整块一起缩放——按压缩放要落到手指底下那个控件上",
  );
  ok(
    /export const TEXT_ZONES = "\.selectable, input, textarea";/.test(menu),
    "#2：全站禁选之后文本容器仍被排除在长按之外——那些地方会变成「既选不了也没菜单」",
  );
  /* 必须在 hold 规则自己的花括号里找 z-index：用 [\s\S]*? 会一路匹配到后面的 .ctx-blur，
     把遮罩的 2390 当成目标的层级（踩过：删掉目标的 z-index 也判绿） */
  const holdBlock = /\[data-ctx-press="hold"\]\s*\{([^}]*)\}/.exec(press)?.[1] ?? "";
  const zHold = /z-index:\s*(\d+)/.exec(holdBlock);
  const zBlur = /\.ctx-blur \{[\s\S]*?z-index: (\d+)/.exec(css);
  const zMenu = /\.ctx-menu \{[\s\S]*?z-index: (\d+)/.exec(css);
  const zTopbar = /\.mobile-topbar \{[\s\S]*?z-index: (\d+)/.exec(css);
  ok(!!zBlur && !!zTopbar && Number(zBlur[1]) > Number(zTopbar[1]), "#5：遮罩压不住顶栏（z-index 低于顶栏就只遮得住内容区）");
  ok(!!zMenu && !!zBlur && Number(zMenu[1]) > Number(zBlur[1]), "#5：菜单没有压在遮罩之上（层级顺序不对）");
  ok(!!zHold && Number(zHold[1]) > 0, "#5：长按目标没有抬到同层兄弟之上（放大后会被邻居的卡片压住）");
  ok(/pointer-events: none/.test(css.slice(css.indexOf(".ctx-blur {"), css.indexOf("@keyframes ctx-blur-in"))), "#5：遮罩没有放行点击（点外面关菜单会失效）");
  ok(
    /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-ctx-press\]\[data-ctx-press\],\s*\[data-ctx-press\]\.hw-card \{ transition: none; \}/.test(css),
    "#5：按压反馈缺少 reduced-motion 降级",
  );
  /* 霖 2026-10-02 #6：顶栏「···」是切换，不是每次重开 */
  ok(
    /interface CtxApi \{[\s\S]{0,200}?close: \(\) => void;[\s\S]{0,80}?isOpen: \(\) => boolean;/.test(menu) &&
      /if \(ctx\.isOpen\(\)\) \{\s*\n\s*ctx\.close\(\);\s*\n\s*return;/.test(read("apps/desktop/src/components/Layout.tsx")),
    "#6：顶栏「···」还是每次都重开菜单——菜单开着时应先关掉",
  );
  /* 触发器要放行：捕获期的「点外面即关」会抢在 click 之前把菜单关掉，于是 click 里看到的
     isOpen() 永远是 false（第二下变成重开）。这条正是真机踩出来的。 */
  ok(
    /export const TRIGGER_ATTR = "data-ctx-trigger";/.test(menu) &&
      /closest\("\[" \+ TRIGGER_ATTR \+ "\]"\)\) return;/.test(menu) &&
      /\[TRIGGER_ATTR\]: ""/.test(read("apps/desktop/src/components/Layout.tsx")),
    "#6：菜单的「点外面即关」没给触发器放行——顶栏「···」第二下会被自己那次 pointerdown 先关掉，再被 click 重开",
  );
  ok(/\.dev-badge-commit \{ display: none; \}/.test(css), "#2：dev 徽标在手机上没缩成小标（提交号还占位）");
}

/* ⑨c E8（b29 霖 2026-10-04 裁定）：垃圾桶一步展开 -------------------------------
   A3 增加「打开即进 panel」的能力；其余菜单用法（右键/长按出单项菜单、item.panel 二级面板、
   K6 顶栏「···」切换）必须一字不动。 */
{
  const PAGE = "apps/desktop/src/pages/learn/AssignmentsPage.tsx";
  ok(/openPanel: \(r: CtxPanelRequest\) => void;/.test(menu), "CtxApi 缺 openPanel（E8 一步展开的入口）");
  ok(/export interface CtxPanelRequest \{/.test(menu), "缺 CtxPanelRequest 类型（openPanel 的请求体）");
  ok(/initial\?: string;/.test(menu), "CtxRequest 缺 initial（打开即进 panel 的机制）");
  ok(
    /useState<string \| null>\(req\.initial \?\? null\)/.test(menu),
    "CtxMenu 没有从 req.initial 初始化 panelKey：一步展开不生效（仍会先出单项菜单）",
  );
  ok(
    /items: \[\{ key: PANEL_ITEM_KEY, label: r\.title \?\? "面板", panel: r\.panel \}\],\s*\n\s*initial: PANEL_ITEM_KEY,/.test(menu),
    "openPanel 没有合成「只有 panel 的 request」并把 initial 指向它（会退化成单项菜单）",
  );
  /* 单项菜单路径必须原样保留：open() 仍然渲染 items，item.panel 仍然进二级面板 */
  ok(
    /req\.items\.map\(\(it, i\) => \(/.test(menu) &&
      /if \(it\.panel\) \{\s*\n\s*setPanelKey\(it\.key\);/.test(menu) &&
      /if \(it\.panel\) \{\s*\n\s*setPanelKey\(it\.key\);\s*\n\s*return;/.test(menu),
    "open() 的单项菜单 / 进 panel 路径被改坏了：长按菜单的二级面板（提醒档位等）会失效",
  );
  ok(/ctx\.open\(\{/.test(read("apps/desktop/src/components/Layout.tsx")), "顶栏「···」不再走 ctx.open（K6 切换路径被改）");
  /* 一步展开只允许 E8 垃圾桶一处用；其它菜单调用点照旧走 open() */
  ok(/ctx\.openPanel\(\{/.test(read(PAGE)), "E8 垃圾桶没有走 ctx.openPanel（仍会先出单项菜单）");
  for (const [src, name] of [
    [layout, "Layout"],
    [tasks, "TasksPage"],
    [thos, "ThosPage"],
    [learn, "Learn"],
    [folder, "FolderPage"],
    [fileRow, "learn/shared"],
    [read(TODAY), "Today"],
  ]) {
    ok(!/openPanel\(/.test(src), `${name} 也用了 openPanel：一步展开只应是 E8 垃圾桶那一条路径`);
  }
}

/* ⑩ 覆盖面（霖 #4：此前只有作业卡片能长按）------------------------------------ */
ok(
  /export const ATOM_ATTR = "data-ctx-atom";/.test(menu) && /export const ZONE_ATTR = "data-ctx-zone";/.test(menu),
  "① 缺少全局可收藏长按面的属性常量（data-ctx-atom / data-ctx-zone）",
);
ok(
  /start\.closest<HTMLElement>\("\[" \+ ATOM_ATTR \+ "\]"\)/.test(menu),
  "① 全局兜底层没有按最近祖先找可收藏元素",
);
ok(
  /el\.closest\("\[" \+ ZONE_ATTR \+ "\]"\)/.test(menu),
  "① 全局兜底层没有给已挂长按区的宿主让路：同一处会弹两个菜单",
);
ok(
  /zone\.setAttribute\(ZONE_ATTR, ""\)/.test(menu) && /zone\.removeAttribute\(ZONE_ATTR\)/.test(menu),
  "① 长按区没有打/撤 data-ctx-zone 标记",
);
ok(
  /JSON\.parse\(raw\) as AtomRef/.test(menu) && /<CollectModal atom=\{collect\}/.test(menu),
  "① 全局可收藏长按面没有复用 CollectModal（不许另写一份收藏存储）",
);
ok(
  /const HOLD_DUP_BEGIN_MS = 40;/.test(menu),
  "① 全局兜底层与长按区/单项共用同一份判定（重复入口要靠 createLongPress 里的去重）",
);
ok(
  /data-card=\{def\.id\} \{\.\.\.lp\}/.test(read(TODAY)),
  "① 今日页卡片没有长按菜单（今日页是长按最常落空的地方）",
);
ok(
  /data-ctx-atom='\{"kind":"page","key":"learn-assignments"\}'/.test(read(TASKS)) &&
    /data-ctx-atom='\{"kind":"page","key":"learn-notices"\}'/.test(read(TASKS)),
  "① 待办页汇总卡/通知条没有挂 data-ctx-atom",
);
{
  const rowFull = read(FILE_ROW);
  const rowFrom = rowFull.indexOf("export function HomeworkRow(");
  const row = rowFull.slice(rowFrom, rowFull.indexOf("\nexport function ", rowFrom + 10));
  ok(/useLongPress\(/.test(row), "① 作业列表行没有长按菜单（此前只有作业卡片有）");
  ok(/key: "ignore"/.test(row) && /key: "remind"/.test(row) && /key: "collect"/.test(row),
    "① 作业行的长按菜单缺项（与作业卡片同口径：忽略/提醒/收藏）");
  /* 霖 2026-10-02：二级菜单齐了之后，行内的三个控件撤掉（把横向空间还给标题）；
     卡面按钮只在「作业流」卡片上保留一处。 */
  ok(!/hw-ignore-btn/.test(row) && !/<HwRemindButton/.test(row) && !/<CollectStar/.test(row),
    "① 作业行还留着行内的忽略/提醒/收藏控件（霖：撤掉，把位置让给标题）");
  ok(/hw-card-act/.test(read(TASKS)) && /<HwRemindButton/.test(read(TASKS)) && /<CollectStar/.test(read(TASKS)),
    "① 作业流卡片（TasksPage .hw-card）上的忽略/提醒/收藏三按钮被误删了（霖：只保留这一处）");
}

/* b32：提醒弹层（.hwremind-pop）必须接管 Esc -------------------------------------
 * 由来：它是独立浮层（作业卡片铃铛 / 学堂 DDL 提醒卡），此前只有「选档位」与「点铃铛再按一次」
 * 两条关闭路径，**没有任何 Escape 监听** → 按 Esc 关不掉。长按菜单里的「提醒」面板则相反：
 * Esc 归外层 A3 菜单的捕获期监听（ContextMenu.tsx），面板自己不该再接管，否则一次 Esc 关两层。 */
{
  const shared = read(FILE_ROW);
  const popFrom = shared.indexOf("export function HwRemindPop(");
  const pop = popFrom < 0 ? "" : shared.slice(popFrom, shared.indexOf("\nexport function ", popFrom + 10));
  ok(popFrom >= 0, "b32 找不到 HwRemindPop（提醒弹层）");
  ok(
    /addEventListener\("keydown", onKey, true\)/.test(pop) && /e\.key !== "Escape"/.test(pop),
    "b32 提醒弹层没有接管 Esc（.hwremind-pop 按 Esc 关不掉）",
  );
  ok(/onDismiss/.test(pop), "b32 提醒弹层没有 onDismiss 出口（Esc 关了等于没关）");
  ok(
    /onDismiss=\{\(\) => setOpen\(false\)\}/.test(shared) && /onDismiss=\{\(\) => setOpen\(false\)\}/.test(learn),
    "b32 独立提醒弹层（作业卡片铃铛 / 学堂 DDL 提醒卡）没有接 onDismiss",
  );
  const pf = tasks.indexOf("function HwRemindPanel(");
  const panel = pf < 0 ? "" : tasks.slice(pf, pf + 700);
  ok(pf >= 0 && !/onDismiss/.test(panel), "b32 长按菜单里的提醒面板不该自己接管 Esc（归 A3 菜单，否则一次 Esc 关两层）");
}

/* 输出 ---------------------------------------------------------------------- */
if (fails.length) {
  console.error("长按菜单护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("长按菜单护栏：四类矩阵齐全 + 全局可收藏面 + 只调既有 store + 500ms/10px 判定 + 四边夹紧 + 选区放行 + 键盘可达 + 长按触感 + 点击抑制 + 液团生长动画 ✓");
