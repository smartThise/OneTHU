/**
 * §3.5 B3b 弹层护栏（桌面居中弹窗 + 手机底部抽屉）。
 *
 * 规则来源：§3 浮层允许「描边 + 投影」（与卡片相反）；手机端弹层统一成 bottom sheet
 * （贴底、满宽、只圆上面两角、抽屉把手、安全区内边距、上滑动画），
 * 抽屉内卡片在白底弹层上用灰阶分层（不再描边）。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const TOK = readFileSync("packages/ui/src/tokens.css", "utf8");
const MOT = readFileSync("apps/desktop/src/styles/motion.css", "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};
function block(selector) {
  const i = CSS.indexOf(selector);
  if (i < 0) return "";
  const from = CSS.indexOf("{", i);
  let depth = 0;
  for (let j = from; j < CSS.length; j++) {
    if (CSS[j] === "{") depth++;
    else if (CSS[j] === "}") {
      depth--;
      if (!depth) return CSS.slice(i, j + 1);
    }
  }
  return "";
}

/* [1] 遮罩走令牌（明暗各一档） */
ok(TOK.includes("--md-sys-color-scrim:"), "tokens.css 缺少 --md-sys-color-scrim");
ok((TOK.match(/--md-sys-color-scrim:/g) || []).length >= 2, "scrim 应有明暗两档");
ok(block(".home-modal-mask").includes("background: var(--md-sys-color-scrim)"), "遮罩应用 scrim 令牌");
ok(!/background:\s*rgba\(15, 23, 42/.test(CSS), "遮罩不应写死 rgba");

/* [2] 桌面弹窗：形状令牌 + elev-3 + 保留描边 */
const modal = block(".home-modal {");
ok(modal.includes("border-radius: var(--md-sys-shape-corner-large)"), "弹窗圆角应走形状令牌");
ok(modal.includes("box-shadow: var(--md-sys-elevation-3)"), "弹窗投影应用 --md-sys-elevation-3");
ok(/border:\s*1px solid var\(--border\)/.test(modal), "浮层保留描边（§3）");

/* [3] 手机底部抽屉（同一份规则块内） */
const mask = CSS.includes(".home-modal-mask { align-items: flex-end; padding: 0; }") ? ".home-modal-mask { align-items: flex-end; padding: 0; }" : "";
const sheet = block(".home-modal {\n    max-width: 100%;");
ok(mask.includes("align-items: flex-end") && mask.includes("padding: 0"), "手机端遮罩应贴底且去掉留白");
ok(sheet.includes("max-width: 100%") && sheet.includes("92dvh"), "抽屉应满宽、限高 92dvh");
ok(sheet.includes("var(--md-sys-shape-corner-large) var(--md-sys-shape-corner-large) 0 0"), "抽屉只圆上面两角");
ok(sheet.includes("env(safe-area-inset-bottom)"), "抽屉应留安全区内边距");
ok(/animation:\s*m-sheet-up/.test(sheet), "抽屉应有上滑动画");
ok(MOT.includes("@keyframes m-sheet-up"), "motion.css 缺少 m-sheet-up 关键帧");
ok(block(".home-modal::before").includes("border-radius: 999px"), "抽屉应有把手（纯 CSS ::before）");
ok(CSS.includes(".plg-sheet { width: 100%; max-width: 100%; max-height: 92dvh; border-radius: var(--md-sys-shape-corner-large)"), "插件抽屉圆角也应令牌化");

/* [4] 抽屉内卡片：灰阶分层、去描边、有状态层 */
for (const sel of [".wb-kind {", ".wb-row {"]) {
  const b = block(sel);
  ok(b.includes("position: relative"), sel + " 需要 position: relative（状态层定位）");
  ok(b.includes("background: var(--md-sys-color-surface-container)"), sel + " 应用灰阶底（弹层是白底）");
  ok(b.includes("border-radius: var(--md-sys-shape-corner-medium)"), sel + " 圆角应走形状令牌");
  ok(!/border:\s*1px solid var\(--border/.test(b), sel + " 不该再有可见描边");
}
ok(block(".btn::after,").includes(".wb-row::after"), "共享状态层应包含 .wb-row::after");
ok(!/\.wb-kind:hover[^{]*\{[^}]*border-color/.test(CSS), ".wb-kind hover 不该再改描边");

/* [5] 退场：整族必须有退场动画（缺了弹层会"啪"地消失） */
ok(CSS.includes(".plg-mask.is-closing") && CSS.includes(".home-modal-mask.is-closing"), "遮罩退场动画缺失");
ok(/\.plg-sheet\.is-closing,[\s\S]{0,120}m-pop-out/.test(CSS), "面板退场动画缺失（桌面缩小淡出）");
ok(/html\.is-phone \.plg-sheet\.is-closing,\nhtml\.is-phone \.home-modal\.is-closing \{\n  animation: m-sheet-down/.test(CSS), "手机抽屉退场应往下滑");
ok(CSS.includes("@keyframes m-fade-out") && CSS.includes("@keyframes m-sheet-down"), "退场关键帧缺失");
ok(/is-closing[\s\S]{0,80}emphasized-accelerate/.test(CSS), "退场应用 accelerate 曲线（离场加速）");

/* [6] 弹层必须 portal 到 body：否则祖先的动画/变换会成为 position:fixed 的包含块，
       遮罩只盖住所在页面那一块（R24 霖实测：插件设置页只把插件页那块遮罩变黑） */
const PLG = readFileSync("apps/desktop/src/pages/Plugins.tsx", "utf8");
ok(/return createPortal\(/.test(PLG) && PLG.includes("document.body"), "插件设置弹层未 portal 到 body");
const RCH = readFileSync("apps/desktop/src/pages/info/CardTab.tsx", "utf8");
ok(/const \[closing, setClosing\] = useState/.test(RCH), "校园卡充值弹窗缺退场相位（closing）");
ok(RCH.indexOf("setClosing(false)") < RCH.indexOf("if (!open)"), "closing 状态必须在早返回之前（hook 顺序）");

/* [7] 退场相位必须在重新打开时复位：父级只把 open 置 false、组件不卸载，
       残留 closing=true 会让第二次打开后永远关不掉（霖实测：校园卡充值第二次开开就关不上） */
const CARD = readFileSync("apps/desktop/src/pages/info/CardTab.tsx", "utf8");
ok(CARD.includes("setClosing(false)"), "校园卡充值弹窗的 closing 相位缺复位路径");
ok(CARD.includes("if (open) setClosing(false);"), "closing 应在重新打开时复位（useEffect 依赖 open）");
const DOCK = readFileSync("apps/desktop/src/plugins/ChatDock.tsx", "utf8");
ok(DOCK.includes("setClosing(false)"), "对话面板的 closing 相位缺复位路径");

/* [8] 内联 animation 会压掉 class 的退场动画：内联样式自带 animation 的弹层，
       入场也必须搬到 class 上，否则退场永远不生效（霖实测：校园卡充值"等 0.x 秒后啪地消失"） */
ok(CSS.includes(".rch-mask.is-closing") && CSS.includes(".rch-panel.is-closing"), "校园卡充值弹窗缺 class 退场动画");
ok(CARD.includes('className={"rch-mask"'), "校园卡充值遮罩应由 class 驱动（内联 opacity 会被动画压制）");
ok(!CARD.includes("maskStyle: React.CSSProperties = { animation:"), "退场动画必须搬离内联样式（内联 animation 优先级更高）");

/* [9] 退场 JS 延时必须与 CSS 退场时长同源：CSS 走 var(--dur-2)，JS 写死会截尾 */
{
  const MOTION = readFileSync("apps/desktop/src/styles/motion.css", "utf8");
  let ms = null;
  for (const f of ["packages/ui/src/tokens.css", "apps/desktop/src/styles/motion.css"]) {
    const t = readFileSync(f, "utf8");
    const m = /--md-sys-motion-duration-short-4:\s*(\d+)ms/.exec(t);
    if (m) { ms = Number(m[1]); break; }
  }
  ok(MOTION.includes("--dur-2: var(--md-sys-motion-duration-short-4)"), "--dur-2 应指向 short-4");
  ok(ms !== null && CARD.includes("onClose(), " + ms + ")"), "校园卡充值的退场延时应与 --dur-2（short-4）一致");
}

/* [10] B3c：退场相位共用 hook —— 组件不再各写一遍 closing/setTimeout */
const HOOK = readFileSync("apps/desktop/src/lib/useExitPhase.ts", "utf8");
ok(HOOK.includes("export function useExitPhase("), "缺少共用退场相位 hook");
ok(HOOK.includes("if (open === true)"), "hook 必须支持受控弹层重开复位（closing 残留会导致第二次关不掉）");
ok(/EXIT_MS = 200/.test(HOOK), "hook 的 EXIT_MS 应与 --dur-2（short-4 = 200ms）一致");
const PICKER = readFileSync("apps/desktop/src/components/FavAtomPicker.tsx", "utf8");
ok(PICKER.includes("useExitPhase(onClose)"), "收藏选择器应用共用 hook");
ok(!PICKER.includes("onClick={onClose}"), "收藏选择器的关闭入口应全部走 requestClose");
ok(PICKER.includes('" is-closing"'), "收藏选择器应把 closing 挂成 is-closing class");

/* [12] B3c 退场相位全覆盖：以下组件必须接入共用 hook，且关闭入口不得残留直接 onClose */
const MIGRATED = [
  "apps/desktop/src/components/FavAtomPicker.tsx",
  "apps/desktop/src/components/Collect.tsx",
  "apps/desktop/src/components/WidgetBindModal.tsx",
  "apps/desktop/src/components/TabManageModal.tsx",
  "apps/desktop/src/components/ExtHwLoginModal.tsx",
];
for (const f of MIGRATED) {
  const src = readFileSync(f, "utf8");
  ok(src.includes("useExitPhase"), f + " 未接入 useExitPhase");
  ok(!src.includes("onClick={onClose}"), f + " 仍有关闭入口直接调 onClose");
  ok(!src.includes('"Escape") onClose();'), f + " Escape 路径仍是直接 onClose");
}
/* 内联几何弹层：退场用内联 animation 覆盖，不得新增 CSS 类规则（style-scan 会拦） */
for (const f of ["apps/desktop/src/components/TabManageModal.tsx", "apps/desktop/src/components/ExtHwLoginModal.tsx"]) {
  const src = readFileSync(f, "utf8");
  ok(src.includes("maskOut") && src.includes("panelOut"), f + " 缺少内联退场样式常量");
  ok(src.includes("is-closing") || src.includes("...maskOut"), f + " 未在 closing 时应用退场样式");
}
/* 校园卡充值弹窗（走 class 路线）：.rch-*.is-closing 已由 CSS 覆盖 */
ok(CSS.includes(".rch-mask.is-closing"), "校园卡充值弹窗 class 退场缺失");

/* 定位型浮层：提醒浮层与地图浮卡的退场（class 路线；两者的几何各自是锚点定位，动画不受影响） */
for (const f of ["apps/desktop/src/pages/learn/shared.tsx", "apps/desktop/src/pages/Trace.tsx"]) {
  ok(readFileSync(f, "utf8").includes("useExitPhase"), f + " 未接入退场相位");
}
ok(CSS.includes(".hwremind-pop.is-closing"), "提醒浮层缺退场动画");
ok(CSS.includes(".trace-card.is-closing"), "地图浮卡缺退场动画");
ok(readFileSync("apps/desktop/src/pages/learn/shared.tsx", "utf8").includes('hwremind-pop" + (closing'), "提醒浮层未挂 is-closing");
ok(readFileSync("apps/desktop/src/pages/Trace.tsx", "utf8").includes('trace-card" + (cardClosing'), "地图浮卡未挂 is-closing");

/* 夹选择是模态内的二级视图：遮罩与面板必须同一相位（过去遮罩直接消失、面板还在动） */
const WB = readFileSync("apps/desktop/src/components/WidgetBindModal.tsx", "utf8");
ok(WB.includes("requestPickClose"), "夹选择浮层未接退场");
ok(/home-modal-mask" \+ \(pickClosing/.test(WB), "夹选择遮罩未跟随面板相位");

if (fails.length) {
  console.error("弹层护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("弹层护栏：遮罩走 scrim 令牌 ✓ 桌面弹窗形状/投影令牌化 ✓ 手机底部抽屉（贴底/满宽/把手/安全区/上滑）✓ 抽屉内卡片灰阶去描边 ✓");
