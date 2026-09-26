/**
 * 动态取色护栏（§3.4）。
 *
 * 能在 PC 上验证的部分与只能在真机验证的部分，这里划清楚：
 *   可验证（本文件）：角色映射的正确性、缺档安全、亮暗方向、注入接线、降级链。
 *   不可验证（真机）：Android 12+ 真的读到了系统调色板（原生侧代码只由 APK 构建做编译校验）。
 * 真机侧一旦失败，链路靠降级保证不破相（空调色板 → 清华紫），所以这里重点钉"失败时安全"。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rolesFromPalette, mix, alpha } from "../apps/desktop/src/lib/dynamicRoles.ts";

const TONES = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
/** HSL → #rrggbb（只为造一份"形状正确"的合成调色板） */
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
  return "#" + rgb.map((v) => toHex((v + m) * 255)).join("");
}
const family = (h, s) => Object.fromEntries(TONES.map((t) => [String(t), hsl(h, s, t / 1000)]));

const PALETTE = {
  primary: family(295, 0.5),
  secondary: family(300, 0.12),
  tertiary: family(20, 0.35),
  neutral: family(280, 0.02),
  neutralVariant: family(280, 0.06),
};

const roles = rolesFromPalette(PALETTE);
const { light, dark } = roles;

/* [1] 完整性：产出的角色名必须真实存在于令牌里（拼错就是静默失效） */
const tokens = readFileSync("packages/ui/src/tokens.css", "utf8");
const lightBlock = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("\n}", tokens.indexOf(":root {")));
const defined = new Set([...lightBlock.matchAll(/(--md-sys-color-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
for (const bag of [light, dark]) {
  for (const role of Object.keys(bag)) {
    assert.ok(defined.has(role), "映射产出的角色在令牌里不存在：" + role);
  }
}

/* [2] 功能色与焦点环不跟随取色（语义色跨主题恒定） */
for (const bag of [light, dark]) {
  for (const role of Object.keys(bag)) {
    assert.ok(
      !/error|warning|success|focus/.test(role),
      "功能色不应被取色改写：" + role,
    );
  }
}

/* [3] 亮暗两套必须有别，且品牌色确实来自调色板 */
assert.notEqual(light["--md-sys-color-primary"], dark["--md-sys-color-primary"], "亮暗 primary 相同");
assert.equal(light["--md-sys-color-primary"].toLowerCase(), PALETTE.primary["400"].toLowerCase());
assert.equal(dark["--md-sys-color-primary"].toLowerCase(), PALETTE.primary["800"].toLowerCase());

const lum = (hexStr) => {
  const n = parseInt(hexStr.replace(/^#/, ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const SURFACES = ["surface", "surface-container-lowest", "surface-container-low", "surface-container", "surface-container-high"];

/* [4] 面层级：亮色都在高处、暗色都在低处，且容器面在正确的方向上分层 */
for (const s of SURFACES) {
  const l = lum(light["--md-sys-color-" + s]);
  const d = lum(dark["--md-sys-color-" + s]);
  assert.ok(l > 0.8, "亮色面不够亮：" + s + " → " + light["--md-sys-color-" + s]);
  assert.ok(d < 0.25, "暗色面不够暗：" + s + " → " + dark["--md-sys-color-" + s]);
}
assert.ok(
  lum(light["--md-sys-color-surface-container-high"]) < lum(light["--md-sys-color-surface"]),
  "亮色容器面应比页面底更深",
);
assert.ok(
  lum(dark["--md-sys-color-surface-container-high"]) > lum(dark["--md-sys-color-surface"]),
  "暗色容器面应比页面底更浅",
);
assert.equal(light["--md-sys-color-surface"], light["--md-sys-color-surface-container-lowest"], "亮色 surface 与 lowest 基线相同");
/* 暗色下卡片面比页面底**更浅**（与凝夜主题同方向：--bg #0e1117 → --surface #151a24） */
assert.ok(
  lum(dark["--md-sys-color-surface-container-lowest"]) > lum(dark["--md-sys-color-surface"]),
  "暗色 lowest 应比页面底更浅",
);

/* [5] 描边/状态层保持"半透明叠色"形态（令牌里本就是 rgba，换成实色会变重） */
for (const role of ["outline-variant", "outline-soft", "outline-strong", "skeleton", "state-hover", "state-pressed"]) {
  assert.ok(/^rgba\(/.test(light["--md-sys-color-" + role]), "亮色 " + role + " 应为 rgba：" + light["--md-sys-color-" + role]);
  assert.ok(/^rgba\(/.test(dark["--md-sys-color-" + role]), "暗色 " + role + " 应为 rgba：" + dark["--md-sys-color-" + role]);
}

/* [6] 缺档安全：ROM 只给一个族时，绝不产出"半套"配色 */
const partial = rolesFromPalette({ primary: PALETTE.primary });
assert.ok(Object.keys(partial.light).length > 0, "只有 primary 族时应产出品牌角色");
assert.equal(partial.light["--md-sys-color-surface"], undefined, "缺 neutral 族时不应产出面角色");
const empty = rolesFromPalette({});
assert.deepEqual(empty, { light: {}, dark: {} }, "空调色板应产出空映射（保留令牌默认值）");
assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
assert.equal(alpha("#102030", 0.5), "rgba(16, 32, 48, 0.5)");

/* [7] 注入与降级链接线（这两处没有 CSS 会自动生效，只能靠组件代码，必须钉住） */
const src = readFileSync("apps/desktop/src/lib/dynamicColor.ts", "utf8");
assert.ok(src.includes('html:root[data-dynamic=\\"on\\"]'), "缺少亮色注入选择器（特异性必须高于主题注入）");
assert.ok(src.includes('html:root[data-dynamic=\\"on\\"][data-scheme=\\"dark\\"]'), "缺少暗色注入选择器");
assert.ok(src.includes("document.documentElement.dataset.dynamic = \"on\""), "没有打开 data-dynamic 开关");
assert.ok(/delete document\.documentElement\.dataset\.dynamic/.test(src), "关闭时没有摘掉 data-dynamic");
assert.ok(src.includes("onethu.theme.tsinghua"), "缺少降级主题（清华紫）");
assert.ok(/try\s*\{[\s\S]*invoke[\s\S]*catch/.test(src), "原生调用必须包 try/catch（桌面没有这条命令）");
assert.ok(/if \(!palette \|\| Object\.keys\(palette\)\.length === 0\)/.test(src), "空调色板必须走降级分支");

console.log("动态取色护栏：映射 " + (Object.keys(light).length + Object.keys(dark).length) + " 个角色值 / 完整性 ✓ / 缺档安全 ✓ / 注入与降级接线 ✓");
