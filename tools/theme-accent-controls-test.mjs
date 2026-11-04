#!/usr/bin/env node
/* 主题色必须进入交互控件：按钮强填充、分段指示器、底部/暂存箱胶囊。
 * 非交互的 device bezel / exchange card 仍使用稳定的 action pair。 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (p) => readFileSync(p, "utf8");
const button = read("packages/gui/src/styles/button.css");
const semantic = read("packages/gui/src/tokens/semantic.css");
const workbench = read("packages/gui/src/recipes/workbench.css");
const compat = read("packages/gui/src/recipes/compatibility.css");

assert.match(button, /--og-c-btn-strong:\s*var\(--og-accent\)/, "按钮强填充跟随 accent");
assert.match(button, /--og-c-btn-on-strong:\s*var\(--og-accent-on\)/, "按钮前景跟随 accent-on");
assert.match(semantic, /--og-segment-active:\s*var\(--og-accent\)/, "分段指示器跟随 accent");
assert.match(semantic, /--og-segment-active-ink:\s*var\(--og-accent-on\)/, "分段指示器文字跟随 accent-on");
for (const [text, name] of [
  [workbench, "oneshot 胶囊"],
  [workbench, "vault 胶囊"],
  [compat, "宿主 primary 按钮"],
]) {
  assert.match(text, /var\(--og-accent\)/, name + " 使用 accent");
}
assert.match(semantic, /--og-action:\s*var\(--og-ref-neutral-950\)/, "action 仍保留稳定暗色（设备边框/兑换卡）");
console.log("主题色交互控件接线：通过");
