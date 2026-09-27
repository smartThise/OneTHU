/**
 * §3.5 B1 按钮体系护栏。
 *
 * 防的是"改一处、漏一片"：.btn/.icon-btn/.chip 在全应用有 459 处调用，
 * 样式或交互一旦分叉，用户看到的就是"有的按钮会浮、有的不会"。
 * 这里断言的是**同一套模型**：状态层 8%/12% 走令牌、焦点环只有一种、禁用只有一档、
 * 变体不各自写悬停底色、涟漪只动画 transform/opacity 且 reduced-motion 不生成。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const MOTION = readFileSync("apps/desktop/src/styles/motion.css", "utf8");
const TOKENS = readFileSync("packages/ui/src/tokens.css", "utf8");
const RIPPLE = readFileSync("apps/desktop/src/components/Ripple.tsx", "utf8");
const MAIN = readFileSync("apps/desktop/src/main.tsx", "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

/** 取选择器块（选择器 → 配对右括号），够断言用 */
function block(src, selector) {
  const i = src.indexOf(selector);
  if (i < 0) return "";
  const from = src.indexOf("{", i);
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (!depth) return src.slice(i, j + 1);
    }
  }
  return "";
}

/* [1] 令牌层：明暗两套的 8%/12%/8%/38% */
ok(/--md-sys-color-state-hover:\s*rgba\(38, 49, 72, 0\.08\)/.test(TOKENS), "亮色 hover 状态层应为 8%");
ok(/--md-sys-color-state-pressed:\s*rgba\(38, 49, 72, 0\.12\)/.test(TOKENS), "亮色 pressed 状态层应为 12%");
ok(/--md-sys-color-state-focus:\s*rgba\(38, 49, 72, 0\.08\)/.test(TOKENS), "亮色 focus 状态层应为 8%");
ok(/--md-sys-state-opacity-disabled:\s*0\.38/.test(TOKENS), "禁用不透明度应为 38%");
const dark = block(TOKENS, ':root[data-scheme="dark"]');
ok(/--md-sys-color-state-hover:\s*rgba\(255, 255, 255, 0\.08\)/.test(dark), "暗色 hover 状态层应为 8%");
ok(/--md-sys-color-state-pressed:\s*rgba\(255, 255, 255, 0\.12\)/.test(dark), "暗色 pressed 状态层应为 12%");
ok(/--md-sys-color-state-focus:\s*rgba\(255, 255, 255, 0\.08\)/.test(dark), "暗色 focus 状态层应为 8%");

/* [2] 状态层：三个组件类共用一层，hover 点亮、pressed 换 12% */
const layer = block(CSS, ".btn::after,");
ok(layer.includes("background: var(--md-sys-color-state-hover)"), "状态层底色应为 hover 令牌");
ok(layer.includes("inset: 0") && layer.includes("border-radius: inherit"), "状态层应铺满并继承圆角");
ok(/\.btn:hover::after[\s\S]{0,140}opacity: 1/.test(CSS), "hover 应点亮状态层");
ok(
  /\.btn:active::after[\s\S]{0,200}var\(--md-sys-color-state-pressed\)/.test(CSS),
  "pressed 状态层应用 12% 令牌",
);
ok(/\.icon-btn::after/.test(CSS) && /\.chip::after/.test(CSS), "icon-btn / chip 必须共用同一状态层");

/* [3] 焦点环：只有令牌环一种 */
ok(
  block(CSS, ".btn:focus-visible,").includes("box-shadow: var(--md-sys-focus-ring)"),
  "焦点环必须走 --md-sys-focus-ring",
);
ok(!/outline: 2px solid var\(--accent\)/.test(CSS), "不该再留手写的 accent 描边焦点环");

/* [4] 禁用：只有 38% 一档 */
ok(/opacity: var\(--md-sys-state-opacity-disabled\)/.test(CSS), "禁用应统一用 38% 令牌");
ok(!/\.btn\[disabled\][^}]*opacity: 0\.4/.test(CSS), "不该再写死 0.4");
ok(!/\.icon-btn\[disabled\][^}]*opacity: 0\.3/.test(CSS), "不该再写死 0.3");

/* [5] 变体不分叉：悬停不再换底色（彩色底上状态层同样成立） */
ok(!/\.btn:hover\s*{[^}]*background/.test(CSS), "基础按钮悬停不再换底色");
ok(!/\.btn-primary:hover\s*{[^}]*background/.test(CSS), "primary 悬停不再换底色");
ok(!/\.btn:active\s*{[^}]*transform/.test(CSS), "按压反馈统一由状态层 + 涟漪承担，不再各写位移");

/* [6] 定位基准：状态层与涟漪都要宿主 position: relative（FAB 自身 position: fixed） */
for (const cls of [".btn {", ".icon-btn {", ".chip {"]) {
  ok(
    new RegExp(cls.replace(/[.{]/g, "\\$&") + "[\\s\\S]{0,260}position: relative").test(CSS),
    cls + " 需要 position: relative（状态层/涟漪的定位基准）",
  );
}

/* [7] 涟漪：只动画 transform/opacity，reduced-motion 不生成，启动已挂载 */
ok(/export function installRipple/.test(RIPPLE), "Ripple.tsx 应导出 installRipple");
ok(/prefersReducedMotion\(\)/.test(RIPPLE), "reduced-motion 时必须不生成涟漪");
ok(/aria-disabled/.test(RIPPLE), "禁用按钮不该出涟漪");
ok(/pointerType === "mouse"/.test(RIPPLE), "鼠标指针不该出涟漪（§2.8.3：指针设备用状态层）");
const kf = block(MOTION, "@keyframes md-ripple");
ok(/transform/.test(kf) && /opacity/.test(kf), "涟漪关键帧应动画 transform 与 opacity");
ok(!/\b(width|height|top|left|margin|padding):/.test(kf), "涟漪关键帧不许动画布局属性（§3.10）");
ok(
  /animation:\s*md-ripple\s+var\(--md-sys-motion-duration-long-2\)/.test(block(MOTION, ".md-ripple {")),
  "涟漪时长应走动效令牌",
);
ok(/overflow: hidden/.test(block(MOTION, ".md-ripple-layer {")), "涟漪层自己负责裁剪，不动宿主 overflow");
/* FAB 同款模型（B1 范围含 FAB） */
const fab = block(CSS, ".hard-refresh-fab {");
ok(fab.includes("background: var(--md-sys-color-surface-container-lowest)"), "FAB 底色应走令牌");
ok(block(CSS, ".hard-refresh-fab::after").includes("var(--md-sys-color-state-hover)"), "FAB 应共用状态层");
ok(!/\.hard-refresh-fab:active\s*{[^}]*transform/.test(CSS), "FAB 按压不该再各写缩放");
ok(RIPPLE.includes(".hard-refresh-fab"), "FAB 应接入涟漪");
ok(
  /installRipple\(\);/.test(MAIN) && /from "\.\/components\/Ripple\.js"/.test(MAIN),
  "启动时必须挂上全局涟漪",
);

if (fails.length) {
  console.error("按钮体系护栏：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("按钮体系护栏：状态层 8%/12% ✓ 焦点环令牌化 ✓ 禁用 38% ✓ 涟漪仅 transform/opacity ✓ 启动已挂载 ✓");
