#!/usr/bin/env node
/**
 * 图标一致性护栏（手册 §6）。
 * 图标集是自绘的，一致性全靠人守；这里把「基座规格」和「不许再写散装 SVG」钉住——
 * 2026-02 之前有 13 处散装 SVG 散在页面里（其中 8 处 strokeWidth=2、尺寸不在四档内）。
 * 三处字符串形式的 SVG 是白名单：两个标签页回退图标（Layout / atoms）与富文本导出的标记。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "apps/desktop/src";
const icons = readFileSync(SRC + "/components/Icons.tsx", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* 1 基座规格：18×18 / viewBox 24 / 1.6 圆头 / currentColor / aria-hidden */
for (const [re, msg] of [
  [/width: 18,/, "基座默认宽应为 18"],
  [/height: 18,/, "基座默认高应为 18"],
  [/viewBox: "0 0 24 24",/, "基座 viewBox 应为 0 0 24 24"],
  [/strokeWidth: 1\.6,/, "基座描边应为 1.6"],
  [/stroke: "currentColor",/, "基座描边色应为 currentColor"],
  [/"aria-hidden": true,/, "基座应带 aria-hidden"],
]) {
  ok(re.test(icons), "Icons.tsx " + msg);
}
/* 16px 档用 1.4 描边，且只允许一个 16 号画布（手册 §6） */
ok(icons.indexOf('strokeWidth="1.4"') >= 0, "16px 档的 1.4 描边丢失");
const smallBox = (icons.match(/viewBox="0 0 16 16"/g) || []).length;
ok(smallBox === 1, "Icons.tsx 里的 16 号画布应只有 1 处（16px 档），实为 " + smallBox);

/* 1b G4：「设置」必须是真齿轮，不许退回「圆心 + 八条射线」的太阳画法 */
const gear = (() => {
  const i = icons.indexOf("export const IconSettings");
  if (i < 0) return "";
  return icons.slice(i, icons.indexOf(");", i));
})();
ok(!!gear, "Icons.tsx 里找不到 IconSettings");
ok(/<circle cx="12" cy="12" r="3\.1"/.test(gear), "设置图标没有内孔（齿轮要有中心圆孔）");
const gearPath = (/<path d="([^"]+)"/.exec(gear) ?? ["", ""])[1];
ok(gearPath.length > 200, "设置图标的齿轮外廓太短（看着不像齿，实长 " + gearPath.length + "）");
ok((gearPath.match(/a1\.5 1\.5 0 0 0/g) || []).length >= 8, "齿轮少于 8 个齿（G4：要一眼看出是齿轮）");
ok(!/M12 2\.8v3/.test(gear), "设置图标退回成「圆心 + 八条射线」的太阳画法了（G4 明确否掉）");

/* 1c 图标体不许重复（反馈 2026-10-05：IconSchedule 与 IconCalendar 的 SVG 路径逐字节相同，
   日程与预约并排显示时同形。这类复制粘贴肉眼看不出来，必须机器比） */
{
  const bodies = new Map();
  const re = /export const (Icon\w+) = \(p: SVGProps<SVGSVGElement>\) => \(\s*<svg {\.\.\.base\(p\)\}>([\s\S]*?)<\/svg>/g;
  for (const m of icons.matchAll(re)) {
    const body = m[2].replace(/\s+/g, " ").trim();
    const prev = bodies.get(body);
    if (prev) ok(false, "图标 " + m[1] + " 与 " + prev + " 的图形完全相同（并排显示会同形）");
    else bodies.set(body, m[1]);
  }
  ok(bodies.size >= 25, "图标体只解析出 " + bodies.size + " 个（正则可能失配，护栏失效）");
}

/* 2 收集所有 tsx 里手写的 svg */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}
const ALLOW = {
  "components/Layout.tsx": 1,
  "state/atoms.tsx": 1,
  "components/exthw/YktSubjectiveEditor.tsx": 1,
};
for (const file of walk(SRC)) {
  const rel = file.slice(SRC.length + 1);
  if (rel === "components/Icons.tsx") continue;
  const src = readFileSync(file, "utf8");
  const n = (src.match(/<svg/g) || []).length;
  if (n === 0) continue;
  const allowed = ALLOW[rel];
  ok(allowed === n, rel + " 有 " + n + " 处手写 SVG" + (allowed ? "（白名单只允许 " + allowed + " 处字符串形式的）" : "——请加进 Icons.tsx，别在页面里手写"));
  if (allowed === n) {
    ok(!/strokeWidth="|strokeWidth=\{/.test(src), rel + " 白名单内的 SVG 出现了 JSX 形式的属性（应只是字符串回退图标）");
  }
}

/* 3 页面里不许再出现 2 号描边（散装图标的典型特征） */
for (const file of walk(SRC)) {
  const rel = file.slice(SRC.length + 1);
  if (rel === "components/Icons.tsx") continue;
  const src = readFileSync(file, "utf8");
  ok(!/strokeWidth=\{?["']?2["']?\}?/.test(src), rel + " 出现 strokeWidth=2（图标一律走 Icons.tsx 的 1.6/1.4）");
}

console.log(
  fails.length
    ? "图标护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "图标护栏：基座 18/24/1.6 ✓ 16 档 1.4 ✓ 手写 SVG 仅剩 3 处白名单字符串 ✓ 无 strokeWidth=2 ✓",
);
process.exit(fails.length ? 1 : 0);
