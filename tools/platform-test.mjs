/**
 * 双端断点护栏（§2.8.1）：断点必须**只有一个来源** state/platform.ts。
 *
 * 背景：改造期断点散落成 860（移动端）/ 861（任务页限宽）/ 1080（宽屏双栏）三套，
 * 组件还各自 matchMedia（Layout / Today / TasksPage），改一处必漏三处。
 * 2026-09-25 M1 收尾统一为 compact <600 / medium 600-840 / expanded >=840。
 *
 * 钉住四件事：
 *   [1] platformOf 的档位边界
 *   [2] CSS 里不再有 860/861 旧断点，且媒体查询数值与 BP 一致
 *   [3] 禁止组件自写「宽度类」matchMedia（只允许 state/usePlatformLayout.ts）
 *   [4] medium 档规则存在（过渡态不破）
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { BP, platformOf } from "../apps/desktop/src/state/platform.ts";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

/* [1] 档位边界 */
assert.equal(platformOf(320), "compact");
assert.equal(platformOf(BP.medium - 1), "compact");
assert.equal(platformOf(BP.medium), "medium");
assert.equal(platformOf(BP.expanded - 1), "medium");
assert.equal(platformOf(BP.expanded), "expanded");
assert.equal(platformOf(1440), "expanded");

/* 扫源码 */
const SRC = new URL("../apps/desktop/src/", import.meta.url);
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = new URL(name, dir);
    if (statSync(full).isDirectory()) walk(new URL(name + "/", dir));
    else if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".css")) {
      files.push([full.pathname, readFileSync(full, "utf8")]);
    }
  }
}
walk(SRC);
assert.ok(files.length > 50, "源码扫描数量异常：" + files.length);

/* [2] 旧断点不得复活 */
const legacy = [];
for (const [path, text] of files) {
  if (text.includes("(max-width: 860px)") || text.includes("(min-width: 861px)")) {
    legacy.push(path.slice(path.indexOf("apps/desktop/src/")));
  }
}
assert.deepEqual(legacy, [], "旧的 860/861 断点复活了：" + legacy.join(", "));

const css = read("apps/desktop/src/styles/global.css");
const maxMobile = (BP.expanded - 0.02).toFixed(2) + "px";
assert.ok(css.includes("@media (max-width: " + maxMobile + ")"), "CSS 缺少移动端断点 " + maxMobile);
assert.ok(css.includes("@media (min-width: " + BP.expanded + "px)"), "CSS 缺少 expanded 断点");
assert.ok(
  css.includes("@media (min-width: " + BP.medium + "px) and (max-width: " + maxMobile + ")"),
  "CSS 缺少 medium 档（600-840）规则",
);

/* [3] 宽度类 matchMedia 只允许出现在 usePlatformLayout.ts */
const allow = "apps/desktop/src/state/usePlatformLayout.ts";
const offenders = [];
for (const [path, text] of files) {
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
  const rel = path.slice(path.indexOf("apps/desktop/src/"));
  if (rel === allow) continue;
  let i = text.indexOf("matchMedia(");
  while (i >= 0) {
    const arg = text.slice(i + 11, text.indexOf(")", i));
    if (arg.indexOf("width") >= 0) offenders.push(rel + ": " + arg.trim());
    i = text.indexOf("matchMedia(", i + 1);
  }
}
assert.deepEqual(offenders, [], "组件自写宽度断点（应改用 usePlatformLayout）：" + offenders.join(", "));

console.log("双端断点：单源 " + BP.medium + "/" + BP.expanded + "；旧断点 0 处；自写宽度 matchMedia 0 处；medium 档在册 ✓");
