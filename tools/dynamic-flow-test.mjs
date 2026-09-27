/**
 * 取色开关的**端到端流程**测试（node + 极简 DOM 替身，跑真实模块）。
 *
 * 为什么要这一层：状态机（dynamicPlan）能证明"决定对不对"，但证明不了"决定真的落到了主题上"。
 * Windows 侧的反馈是「关掉开关后主题不刷新、要手动再选一次」——那属于流程问题，必须在流程层验。
 *
 * 两条路径都在这里跑：
 *   · 取不到调色板（Windows 桌面 / Android < 12）→ 降级清华紫，开关为开，关掉后必须回到原主题
 *   · 有调色板（Android 12+）→ 注入角色、主题让位，关掉后同样必须回到原主题
 * 判据一律是「关掉之后 data-theme 与注入样式是否自己回来了」，不依赖用户手动操作。
 */
import { dom, resetDom } from "./dom-stub.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Tauri 的 IPC：这个替身对象必须在被测模块 import 之前装好（invoke 会在调用时读它）。
   返回 null 等价于"本平台没有动态取色"；返回调色板等价于 Android 12+。 */
let nextPalette = null;
globalThis.window.__TAURI_INTERNALS__ = {
  invoke: async (cmd) => (cmd === "dynamic_color" ? nextPalette : undefined),
};

const { activateTheme, activeThemeId, deactivateTheme, setFollowSystem, setDayNightTheme } = await import(
  "../apps/desktop/src/state/theme.ts"
);
const { enableDynamicColor, disableDynamicColor, isDynamicEnabled } = await import(
  "../apps/desktop/src/lib/dynamicColor.ts"
);
const DEVICE = JSON.parse(readFileSync("tools/device-palette.json", "utf8")).palette;
const themeNow = () => dom.documentElement.dataset.theme ?? null;
const injected = () => document.getElementById("onethu-dynamic-color")?.textContent ?? null;

/* ---- 1) Windows 路径：取不到调色板 ---- */
activateTheme("onethu.theme.violet");
assert.equal(themeNow(), "onethu.theme.violet", "前置：紫水晶应已生效");

await enableDynamicColor();
assert.equal(isDynamicEnabled(), true, "取不到调色板也必须把开关置为开");
assert.equal(themeNow(), "onethu.theme.tsinghua", "取不到调色板应降级到清华紫");
assert.equal(dom.documentElement.dataset.dynamic, undefined, "没有调色板就不该注入取色角色");
assert.deepEqual(
  JSON.parse(localStorage.getItem("onethu.dynamicColor.restore")),
  { activeId: "onethu.theme.violet" },
  "应记下被顶掉的主题（含 null 也要能表达，所以是 JSON）",
);

disableDynamicColor();
assert.equal(isDynamicEnabled(), false, "关掉后偏好应为关");
assert.equal(
  themeNow(),
  "onethu.theme.violet",
  "关掉开关后主题必须自己回到原主题（不许要用户手动再选一次）——Windows 侧反馈的那条",
);
assert.equal(localStorage.getItem("onethu.dynamicColor.restore"), null, "关掉后快照必须清空");

/* ---- 2) 关卡往返：连点两次不许粘住 ---- */
await enableDynamicColor();
assert.equal(themeNow(), "onethu.theme.tsinghua");
disableDynamicColor();
assert.equal(themeNow(), "onethu.theme.violet", "第二次往返同样要自己回到原主题");

/* ---- 3) 没有手动主题（跟随昼夜/基础令牌）时应交回调度，而不是停在清华紫 ---- */
deactivateTheme();
assert.equal(themeNow(), null, "前置：基础令牌态没有 data-theme");
await enableDynamicColor();
assert.equal(themeNow(), "onethu.theme.tsinghua");
disableDynamicColor();
assert.equal(themeNow(), null, "没有手动主题时应回到基础令牌（不是停在清华紫）");

/* ---- 3b) 跟随昼夜：关掉后应回到"调度当前生效的那一套"，且手动选择仍是空 ---- */
setFollowSystem(true);
setDayNightTheme("onethu.theme.ivory", "onethu.theme.night");
assert.equal(themeNow(), "onethu.theme.ivory", "前置：跟随昼夜（替身的系统亮暗=false → 白天档）");
await enableDynamicColor();
assert.equal(themeNow(), "onethu.theme.tsinghua", "降级态应压住昼夜调度");
disableDynamicColor();
assert.equal(themeNow(), "onethu.theme.ivory", "关掉后应回到调度当前生效的白天档");
assert.equal(activeThemeId(), null, "跟随昼夜的用户不该被提升成「手动选中」了某个主题");
setFollowSystem(false);
setDayNightTheme(null, null);

/* ---- 4) Android 路径：有调色板 ---- */
activateTheme("onethu.theme.violet");
resetDom();
nextPalette = DEVICE;
await enableDynamicColor();
assert.equal(isDynamicEnabled(), true);
assert.equal(dom.documentElement.dataset.dynamic, "on", "有调色板时应打开取色开关");
assert.equal(themeNow(), null, "取色生效时主题必须让位（否则半套配色）");
const css = injected() ?? "";
assert.ok(css.includes('html:root[data-dynamic="on"]'), "缺少亮色角色注入");
assert.ok(css.includes('html:root[data-dynamic="on"][data-scheme="dark"]'), "缺少暗色角色注入");
assert.ok(css.includes("--md-sys-color-surface: #FFFFFF"), "亮色面应取真机调色板的 tone 100（#FFFFFF）");
assert.ok(!/--md-sys-color-error/.test(css), "功能色不该被取色改写");

disableDynamicColor();
assert.equal(themeNow(), "onethu.theme.violet", "取色关掉后必须回到原主题（Android 路径同样不许要手动再选）");
assert.equal(injected(), null, "注入样式必须整体移除");
assert.equal(dom.documentElement.dataset.dynamic, undefined, "data-dynamic 必须摘掉");

/* ---- 5) 开关真要开启：偏好落盘必须是开（Windows 死结的回归） ---- */
nextPalette = null;
await enableDynamicColor();
assert.equal(localStorage.getItem("onethu.dynamicColor"), "1", "开启后偏好必须是 1");
assert.equal(activeThemeId(), "onethu.theme.tsinghua", "降级态下 activeId 应指向清华紫");
disableDynamicColor();
assert.equal(localStorage.getItem("onethu.dynamicColor"), "0", "关闭后偏好必须是 0");

console.log("取色流程：Windows 降级路径 ✓ / Android 调色板路径 ✓ / 往返两次不粘住 ✓ / 关掉自动回到原主题 ✓");
