/**
 * Monet 取色护栏（霖 2026-10-01 #1）。
 *
 * 「我的」页那条色盘渐变不再写死颜色，而是从当前主题色用 MD3 Monet（HCT/CAM16）现算。
 * 这种实现的问题全是「静态看不出来」的：色相偏了、彩度塌了、换主题不跟着变，截图都挺好看。
 * 所以这里直接**跑算法**，拿 MD3 基线向量卡死：
 *   · 源色 #6750A4（MD3 基线方案自己的源色）派生出的三条色调板，在 tone 40 上必须分别落到
 *     #6750A4 / #625B71 / #7D5260 ——容差 ±3/通道（官方老版求解器就是 |Δy|<0.002 的牛顿迭代，
 *     不是闭式解，要求逐位相等是假严格）；
 *   · HCT 往返：随机几个颜色 → HCT → 回 ARGB，ΔRGB 要小；
 *   · 色调板单调：tone 越小越暗，0/100 收到黑/白；
 *   · 渐变停点是「5 个停点 + 跟着源色走」，且模块里不许出现字面色（写死就失去意义）。
 *
 * 直接 import 应用的 .ts（Node 22.6+ 的类型擦除，本机 Node 26 实测可用）。
 */
import { readFileSync } from "node:fs";

const SRC = "apps/desktop/src/lib/monet.ts";
const MINE = "apps/desktop/src/pages/Mine.tsx";
const src = readFileSync(SRC, "utf8");
const mine = readFileSync(MINE, "utf8");

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

const m = await import("../" + SRC).catch((e) => {
  console.error("✗ 载入 " + SRC + " 失败：" + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});

const dist = (a, b) => Math.max(Math.abs(m.redFromArgb(a) - m.redFromArgb(b)), Math.abs(m.greenFromArgb(a) - m.greenFromArgb(b)), Math.abs(m.blueFromArgb(a) - m.blueFromArgb(b)));

/* ① MD3 基线向量：#6750A4 的三条板 tone 40 ---------------------------------- */
{
  const p = m.palettesFromSource(m.argbFromHex("#6750A4"));
  const cases = [
    ["primary", p.primary, "#6750a4"],
    ["secondary", p.secondary, "#625b71"],
    ["tertiary", p.tertiary, "#7d5260"],
  ];
  for (const [name, palette, want] of cases) {
    const got = m.hexFromArgb(palette.tone(40));
    const d = dist(m.argbFromHex(want), m.argbFromHex(got));
    ok(d <= 3, `Monet ${name} 板 tone40 = ${got}，与 MD3 基线 ${want} 相差 ${d}/通道（>3 说明算法跑偏了）`);
  }
  /* tertiary 的色相必须是源色 +60 那一族：与 primary 板在同 tone 下明显不同色 */
  ok(
    m.hexFromArgb(p.tertiary.tone(40)) !== m.hexFromArgb(p.primary.tone(40)),
    "tertiary 与 primary 同色——色相 +60 没生效，色盘退化成单色",
  );
}

/* ② 色调板单调 + 两端收黑收白 ------------------------------------------------ */
{
  const p = m.palettesFromSource(m.argbFromHex("#0d9488"));
  const tones = [10, 30, 50, 70, 90].map((t) => m.lstarFromArgb(p.primary.tone(t)));
  const ascending = tones.every((v, i) => i === 0 || v > tones[i - 1] - 1e-6);
  ok(ascending, `tone 越大 L* 没有越大（现在 ${tones.map((v) => v.toFixed(1)).join(" → ")}）——色调板方向反了`);
  ok(m.lstarFromArgb(p.primary.tone(0)) < 5, "tone 0 不是近黑");
  ok(m.lstarFromArgb(p.primary.tone(100)) > 95, "tone 100 不是近白");
}

/* ③ HCT 往返：ARGB → HCT → ARGB -------------------------------------------- */
{
  let worst = 0;
  let worstHex = "";
  for (const hex of ["#6750A4", "#0d9488", "#c2740a", "#2563eb", "#e8ebf2", "#0f1115", "#7c3aed"]) {
    const argb = m.argbFromHex(hex);
    const hct = m.hctFromArgb(argb);
    const back = m.argbFromHct(hct.hue, hct.chroma, hct.tone);
    const d = dist(argb, back);
    if (d > worst) {
      worst = d;
      worstHex = `${hex} → ${m.hexFromArgb(back)}（Δ${d}）`;
    }
  }
  ok(worst <= 4, `HCT 往返误差过大：${worstHex}`);
}

/* ④ 渐变停点：5 个、跟源色走、彼此不同色 ------------------------------------ */
{
  const a = m.paletteGradientStops("#6750A4");
  const b = m.paletteGradientStops("#0d9488");
  ok(a.colors.length === 5, `渐变停点不是 5 个（现在 ${a.colors.length} 个）`);
  ok(new Set(a.colors).size >= 4, `渐变停点重复太多（${a.colors.join(" ")}）——会看成单色`);
  ok(
    a.colors.every((c) => /^#[0-9a-f]{6}$/.test(c)),
    `停点里有非法颜色（${a.colors.join(" ")}）`,
  );
  ok(a.colors.join() !== b.colors.join(), "换源色后停点没变——色盘没跟着主题走");
  ok(/^#[0-9a-f]{6}$/.test(a.source) && a.source === "#6750a4", "停点里没带着源色（护栏与调试要它）");
}

/* ⑤ 不许写死颜色：模块里出现字面色就说明「算」是假的 ------------------------ */
{
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
  const literals = noComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  ok(literals.length === 0, `monet.ts 里出现字面色 ${literals.join(" ")}——色盘必须是算出来的`);
  /* 只认「rgb(数字」这种真的是颜色的写法（模块里那个解析用的正则不算） */
  ok(!/rgba?\(\s*\d/.test(noComments), "monet.ts 里出现字面 rgb() 颜色");
}

/* ⑥ 接线：Mine 页把主题色喂给它，并且跟着主题快照重算 ----------------------- */
{
  ok(/paletteGradientStops/.test(mine) && /getComputedStyle\(document\.documentElement\)/.test(mine), "Mine 页没有读主题令牌算色盘");
  ok(/useThemes\(\)/.test(mine) && /\[activeId, systemDark\]/.test(mine), "Mine 页没有订阅主题快照（换主题/昼夜切换不会重算）");
  ok(/argbFromCssColor/.test(mine), "Mine 页没有做 CSS 颜色解析（rgb()/hex 令牌都吃不到）");
}

if (fails.length) {
  console.error("Monet 取色护栏 ✗");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("Monet 取色护栏：MD3 基线向量（#6750A4 → #6750A4/#625B71/#7D5260 ±3）+ 色调板单调 + HCT 往返 + 5 停点跟主题走 + 模块内零字面色 ✓");
