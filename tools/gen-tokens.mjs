/**
 * 生成 packages/ui/src/palette.css —— MD3 Reference 层（tonal palette）。
 *
 * 依据 §3.1/§3.2：以「清华紫」为 seed 生成 tonal palette，结果**固化为 CSS 入 git**，
 * 零运行时依赖（material-color-utilities 只在构建期用，是 root devDependency）。
 *
 * 同时把派生的 System 角色（亮/暗）打印出来，供 §3.2 品牌色 / §3.3 暗色双套接入时取值。
 *
 * 用法：node --import ./tools/ext-resolve.mjs tools/gen-tokens.mjs [seed]
 */
import { writeFileSync } from "node:fs";
import { themeFromSourceColor, argbFromHex, hexFromArgb } from "@material/material-color-utilities";

const SEED = process.argv[2] ?? "#660874";
/** MD3 标准 tone 全集（Reference 层按需取用，一次生成省得以后再跑） */
const TONES = [0, 4, 6, 10, 12, 17, 20, 22, 24, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100];
const FAMILIES = ["primary", "secondary", "tertiary", "neutral", "neutralVariant", "error"];

const theme = themeFromSourceColor(argbFromHex(SEED));
const hex = (argb) => hexFromArgb(argb).toUpperCase();

/** camelCase → kebab-case：MD3 角色名转 CSS 变量名 */
const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
/** System 角色顺序（固定，便于 diff 阅读） */
const ROLE_ORDER = [
  "primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
  "secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer",
  "tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer",
  "error", "onError", "errorContainer", "onErrorContainer",
  "background", "onBackground", "surface", "onSurface", "surfaceVariant", "onSurfaceVariant",
  "outline", "outlineVariant", "shadow", "scrim", "inverseSurface", "inverseOnSurface", "inversePrimary",
];

const lines = [];
lines.push("/* ============================================================");
lines.push("   自动生成，请勿手改：node tools/gen-tokens.mjs " + SEED);
lines.push("   Reference 层（MD3 tonal palette）——种子「清华紫」" + SEED + "。");
lines.push("   派生规则：System 角色 = 某个 tone（亮色 scheme 见 docs/tokens-map.md）。");
lines.push("   ============================================================ */");
lines.push("");
lines.push(":root {");
for (const fam of FAMILIES) {
  lines.push("  /* ---- " + fam + " ---- */");
  for (const t of TONES) {
    const v = theme.palettes[fam].tone(t);
    lines.push("  --md-ref-palette-" + kebab(fam) + "-" + t + ": " + hex(v).toLowerCase() + ";");
  }
}
lines.push("}");
lines.push("");
for (const [schemeName, scheme] of [["亮色", theme.schemes.light], ["暗色", theme.schemes.dark]]) {
  lines.push("/* 派生 System 角色（" + schemeName + " scheme）——接入见 docs/tokens-map.md");
  for (const role of ROLE_ORDER) {
    const v = scheme[role];
    if (v === undefined) continue;
    lines.push("   --md-sys-color-" + kebab(role) + ": " + hex(v).toLowerCase());
  }
  lines.push("*/");
}

writeFileSync("packages/ui/src/palette.css", lines.join("\n") + "\n", "utf8");
console.log("已生成 packages/ui/src/palette.css（seed " + SEED + "，" + FAMILIES.length + " 个 tonal palette × " + TONES.length + " tone）");
console.log("亮色主色 primary = " + hex(theme.schemes.light.primary) + " / 暗色 primary = " + hex(theme.schemes.dark.primary));
console.log("亮色 surface = " + hex(theme.schemes.light.surface) + " / onSurface = " + hex(theme.schemes.light.onSurface) + " / outlineVariant = " + hex(theme.schemes.light.outlineVariant));
