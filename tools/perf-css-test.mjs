#!/usr/bin/env node
/**
 * 长列表 / OH 性能护栏（D1，霖 2026-10-02）。
 *
 * D1 点名的三件事：①长列表上 `content-visibility: auto` + `contain-intrinsic-size`；
 * ②骨架屏→内容交叉淡入（杜绝闪跳）；③OH 聊天打开专项。
 *
 * 这个护栏只判「可判定的部分」——真机数字（滚动帧间隔 / 长任务 / 可交互时间）由 DoD 的探针给：
 *   ① 长列表容器与 OH 消息行必须真的带上 `content-visibility: auto` **和** `contain-intrinsic-size`
 *      （只有前者会让滚动条长度塌陷、跳到底部时抖）；
 *   ② 骨架→内容的过渡类必须存在、只动 opacity（不许动 width/height/margin，那才是 CLS 的源头）、
 *      并且有 reduced-motion 降级；
 *   ③ 这个过渡类必须真的被用起来（≥3 处列表页），否则等于没做；
 *   ④ **反例**：长列表优化不许只有 `will-change` / `translateZ(0)` 这类「看着像优化」的写法——
 *      即：提到 `.list` 的规则里必须出现 `content-visibility`，不许只有 `will-change`。
 */
import { readFileSync, readdirSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/* ① 长列表容器 */
for (const [sel, label] of [
  [".content .list", "长列表容器 .content .list"],
  [".dock-msgs .dock-msg", "OH 消息行 .dock-msgs .dock-msg"],
]) {
  /* 允许「多选择器同一条规则」的写法：目标选择器后面先跟别的选择器或逗号，再 }{ */
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+") + "[^{}]*\\{([^}]*)\\}", "m");
  const m = re.exec(CSS);
  ok(!!m, `找不到规则：${label}`);
  if (m) {
    ok(/content-visibility:\s*auto/.test(m[1]), `${label} 缺 content-visibility: auto`);
    ok(/contain-intrinsic-size:\s*auto\s+\d/.test(m[1]), `${label} 缺 contain-intrinsic-size（且必须用 auto 记住真实高度）`);
  }
}

/* ② 骨架→内容过渡类 */
const swap = /\.swap-in\s*\{([^}]*)\}/.exec(CSS);
ok(!!swap, "找不到骨架→内容的过渡类 .swap-in");
if (swap) {
  const body = swap[1];
  ok(/animation:\s*swap-in/.test(body), ".swap-in 没有挂 swap-in 动画");
  ok(!/(width|height|margin|padding|top|left)\s*:/.test(body), ".swap-in 动了布局属性（CLS 的源头）");
  const kf = /@keyframes\s+swap-in\s*\{([\s\S]*?)\n\}/.exec(CSS);
  ok(!!kf, "找不到 @keyframes swap-in");
  if (kf) {
    const props = [...kf[1].matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
    const bad = props.filter((p) => !["opacity", "animation-timing-function", "translate", "scale"].includes(p));
    ok(bad.length === 0, "@keyframes swap-in 动了 opacity 以外的属性：" + [...new Set(bad)].join(" / "));
  }
  ok(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}\.swap-in\s*\{[^}]*animation:\s*none/.test(CSS),
    ".swap-in 没有 reduced-motion 降级（改成静态直接显示）",
  );
}

/* ③ 过渡类真的被用起来 */
let used = 0;
for (const dir of ["apps/desktop/src/pages", "apps/desktop/src/pages/learn", "apps/desktop/src/pages/info"]) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !/\.tsx$/.test(e.name)) continue;
    const src = readFileSync(`${dir}/${e.name}`, "utf8");
    used += (src.match(/className="[^"]*\bswap-in\b/g) ?? []).length;
  }
}
ok(used >= 3, `骨架→内容过渡类只用了 ${used} 处（长列表页至少 3 处，否则等于没接）`);

/* ④ 反例：只有 will-change / translateZ(0) 不算优化 */
const listRules = [...CSS.matchAll(/[^\n{}]*\.list[^\n{}]*\{([^}]*)\}/g)].map((m) => m[1]);
const perfish = listRules.filter((b) => /will-change|translateZ\(0\)|backface-visibility/.test(b));
for (const b of perfish) {
  if (!/content-visibility/.test(b)) {
    fails.push("长列表上出现了「只加 will-change / translateZ(0)」的伪优化规则（D1 反例）");
  }
}

console.log(
  fails.length
    ? "长列表性能护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : `长列表性能护栏：列表/OH 消息 content-visibility + 占位尺寸 ✓ swap-in 过渡类（仅 opacity + 降级，已用 ${used} 处）✓ 无伪优化 ✓`,
);
process.exit(fails.length ? 1 : 0);
