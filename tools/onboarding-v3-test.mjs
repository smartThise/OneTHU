/**
 * 首启导览护栏（2026-10-19 起：模式向导 flow4）。
 *
 * 背景：导览已从「V3 七步玻璃卡 + 拖拽演练 + 粒子」整体换成**模式向导**——
 * 第一步选极简/实用/完整，之后按所选模式走各自课程，最后可选接入。
 * 旧 V1/V2/V3/手机版播放端全部退役（文件可留，但 App 不再引用）。
 *
 * 本护栏钉：挂载唯一入口、flow4 完成标记与旧标记兼容、三种模式课程齐、
 * 结束/跳过/回退的 affordance、OneGUI Modal 语义、重放/重置链路。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/* 文案已走 i18n：中文原文在 zh-CN 词典里，源码里出现的是键。 */
const zhMessages = read("apps/desktop/src/i18n/locales/zh-CN.ts");
const keyFor = (s) => {
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = zhMessages.match(new RegExp('"([^"]+)"\\s*:\\s*"' + esc + '"'));
  return m ? m[1] : null;
};
const hasCopy = (src, s) => src.includes(s) || (keyFor(s) ? src.includes(keyFor(s)) : false);

const app = read("apps/desktop/src/App.tsx");
const tour = read("apps/desktop/src/components/OnboardingTour.tsx");
const state = read("apps/desktop/src/state/onboarding.ts");
const picker = read("apps/desktop/src/components/ExperienceModePicker.tsx");
const settings = read("apps/desktop/src/pages/Settings.tsx");

/* ---------- ① 挂载：只认新向导 ---------- */
assert.ok(/OnboardingTour as OnboardingTourGate/.test(app) && /<OnboardingTourGate \/>/.test(app), "App 必须挂 OnboardingTour 门（新向导）");
assert.ok(!/OnboardingTourV3|OnboardingTourMobile|OnboardingTourV2/.test(app), "App 不得再引已退役的 V2/V3/手机版播放端");

/* ---------- ② 偏好键：flow4 + 旧标记兼容 + 重放事件 ---------- */
assert.ok(tour.includes('const KEY="onethu.onboarded.flow4"'), "完成标记应为 onethu.onboarded.flow4");
assert.ok(/onethu\.onboarded\.flow3/.test(tour) && /onethu\.onboarded\.phone/.test(tour), "shouldStart 要兼容 flow3 / phone 旧标记（老用户不重复弹）");
assert.ok(/const REPLAY="onethu\.onboarding\.replay"/.test(tour) && /export function replayOnboarding\(\)\{window\.dispatchEvent/.test(tour), "重放走事件 onethu.onboarding.replay");
assert.ok(/addEventListener\(REPLAY,replay\)/.test(tour), "向导要订阅重放事件（设置页「导览」按钮用）");
assert.ok(/localStorage\.removeItem\("onethu\.onboarded\.flow4"\)/.test(state), "resetActiveOnboarding 要清 flow4（否则「导览」按钮点了不重来）");
assert.ok(settings.includes("resetActiveOnboarding();"), "设置页保留「导览」重走入口");

/* ---------- ③ 三种模式 × 各自课程 ---------- */
assert.ok(/ExperienceModePicker/.test(tour), "第一步要有模式选择器");
for (const s of ["极简模式", "实用模式", "完整模式"]) assert.ok(picker.includes(s), "模式选择器缺 " + s);
assert.ok(/chosen==="simple"\?SIMPLE_LESSONS:chosen==="practical"\?PRACTICAL_LESSONS:FULL_LESSONS/.test(tour), "三种模式必须各走自己的课程");
for (const t of [
  "白板与 OnePage：首页由你摆", "标签页与工作区：多任务不打架", "暂存箱：什么都能先收进来",
  "一个短口令，传递一组内容", "碰一碰：名片与内容接力", "组织：人、文件、项目一处管",
  "OneGO!：全局入口与自动化", "插件与 OH：把能力装进来", "外观与工作台：全都可调",
  "校园服务：完整模式的聚合", "数据与同步：跨设备继续",
]) {
  assert.ok(tour.includes(t), "完整模式缺一课：" + t);
}
assert.ok(tour.includes("悬浮球默认关闭，可在 OH 设置里开启。"), "完整模式导览缺少「悬浮球默认关闭、可手动开启」提示");
/* 文案已走 i18n：按 key + 行为断言（tour.mcp.* 是稳定契约） */
assert.ok(tour.includes("tour.mcp.title") && tour.includes("setMcpServer") && tour.includes("mcpServerEnabled"), "导览缺少 OH MCP 说明/开关");
assert.ok(/syncOverlayPreference/.test(tour) === false, "导览不应负责悬浮球启动同步（由 boot 干）");
for (const t of ["首页，只关心今天", "五个功能，固定在手边"]) assert.ok(tour.includes(t), "极简模式缺一课：" + t);
for (const t of ["首页，只关心今天", "更多功能：所有基础功能都在这里", "四个入口，随你安排"]) assert.ok(tour.includes(t), "实用模式缺一课：" + t);
/* 开场模式口径（用户 2026-10-19 给定原话） */
for (const t of [
  "仅保留学习、预约、生活、课表、信息五个功能。",
  "包含所有基础功能。",
  "充分体验 OneTHU 系列服务带来的高度便利性与可定制化。",
]) assert.ok(picker.includes(t), "模式卡描述缺：" + t);

/* ---------- ④ 结束/跳过/回退 + 弹层语义 + 演练返回 ---------- */
assert.ok(/localStorage\.setItem\(KEY,"1"\)/.test(tour), "结束必须写完成标记（否则下次启动又弹）");
for (const t of ["跳过导览", "上一步", "开始使用", "按此模式开始"]) assert.ok(hasCopy(tour, t), "导览缺少「" + t + "」");
assert.ok(/<Modal open/.test(tour) && /aria-label=\{i18n\("[^"]+"\)\}/.test(tour), "导览卡走 OneGUI Modal + 可读名");
assert.ok(/tour-resume/.test(tour) && hasCopy(tour, "继续导览") && hasCopy(tour, "正在体验："), "演练态要有「继续导览」返回条");

/* ---------- ⑤ 设置页模式卡片 ---------- */
assert.ok(/ExperienceModeControl/.test(settings), "设置页要有「使用模式」卡片");

console.log("首启导览护栏：flow4 模式向导 ✓ 三模式课程 ✓ 重放/重置链路 ✓ OneGUI 弹层 ✓ 演练返回 ✓");
