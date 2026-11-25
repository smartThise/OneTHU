#!/usr/bin/env node
/** 系统字体 API 的纯逻辑护栏：字体族归一化 + 白名单候选路径。 */
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const F = await import("../apps/desktop/src/lib/systemFonts.ts");

ok(F.normalizeSystemFontFamily("ABCDEF+KaiTi") === "kaiti", "子集前缀 + KaiTi");
ok(F.normalizeSystemFontFamily("楷体") === "kaiti", "中文名");
ok(F.normalizeSystemFontFamily("STKaiti") === "kaiti", "STKaiti");
ok(F.normalizeSystemFontFamily("SimSun") === "simsun", "SimSun");
ok(F.normalizeSystemFontFamily("Microsoft YaHei") === "yahei", "雅黑");
ok(F.normalizeSystemFontFamily("Helvetica") === null, "未知字体返回 null");
ok(F.normalizeSystemFontFamily("") === null, "空串返回 null");

const kai = F.systemFontCandidates("kaiti");
ok(kai.some((p) => p.endsWith("simkai.ttf")), "楷体候选含 simkai.ttf");
ok(kai.every((p) => p.startsWith("C:/Windows/Fonts/") || p.startsWith("/System/") || p.startsWith("/usr/share/")), "候选都在白名单根目录");
ok(F.systemFontCandidates("nope").length === 0, "未知字体无候选");

if (fails.length) {
  console.error("system-font-test: " + fails.length + " 项失败");
  for (const f of fails) console.error(" ✗ " + f);
  process.exit(1);
}
console.log("system-font-test: 全部通过");
