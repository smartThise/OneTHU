/**
 * 弹层分端护栏：右推面板 / 预览大窗的几何**必须写在组件里**，不能在 CSS 里写。
 *
 * 背景（真实踩过的坑）：这些弹层的 mask/panel 是 style={} 内联样式，内联优先级高于类选择器，
 * 于是在 global.css 里写 @media (min-width:840px) { .tab-manage-panel { ... } } 完全不生效——
 * 改完「没生效」比不改更糟：代码里有一段看着对、实际被静默压掉的规则。
 *
 * 本护栏做两件事：
 * 1. global.css 里不许出现这几个弹层的几何规则（出现了就是又写了一遍没用的 CSS）；
 * 2. 对应组件必须 useExpanded() 且真的把「PC 样式对象」用在 style 上（防漏接线）。
 */
import { readFileSync } from "node:fs";

const CSS = "apps/desktop/src/styles/global.css";
const SRC = readFileSync(CSS, "utf8");
const fails = [];

/* ① CSS 里不得出现内联几何弹层的选择器（连带伪类/后代都要拦） */
const BANNED = ["tab-manage-mask", "tab-manage-panel", "confirm-card", "confirm-mask"];
const cssLines = SRC.split("\n");
for (let i = 0; i < cssLines.length; i++) {
  const line = cssLines[i];
  if (line.trimStart().startsWith("/*")) continue;
  for (const sel of BANNED) {
    if (line.includes("." + sel) && line.includes("{")) {
      fails.push(CSS + ":" + (i + 1) + " 用 CSS 给内联几何弹层 " + sel + " 加样式（不会生效，请改组件里的样式对象）");
    }
  }
}

/* ② 组件接线：useExpanded() 必须存在，且 PC 样式对象必须被 style 用上 */
const CASES = [
  {
    file: "apps/desktop/src/components/TabManageModal.tsx",
    need: ["useExpanded()", "maskStylePc", "panelStylePc", "expanded ? maskStylePc : maskStyle", "expanded ? panelStylePc : panelStyle"],
  },
  {
    file: "apps/desktop/src/components/FilePreview.tsx",
    need: ["useExpanded()", "maskStyleWide", "panelStyleWide", "expanded ? maskStyleWide : maskStyle", "expanded ? panelStyleWide : panelStyle"],
  },
];
for (const c of CASES) {
  const t = readFileSync(c.file, "utf8");
  for (const n of c.need) {
    if (!t.includes(n)) fails.push(c.file + " 缺少「" + n + "」（PC 弹层样式没接线）");
  }
}

if (fails.length) {
  console.error("弹层分端护栏：不合格");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("弹层分端护栏：CSS 无内联弹层几何 + 组件按平台接线 ✓");
