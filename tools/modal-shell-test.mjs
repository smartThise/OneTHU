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

if (fails.length) {
  console.error("弹层护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("弹层护栏：遮罩走 scrim 令牌 ✓ 桌面弹窗形状/投影令牌化 ✓ 手机底部抽屉（贴底/满宽/把手/安全区/上滑）✓ 抽屉内卡片灰阶去描边 ✓");
