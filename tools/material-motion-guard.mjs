#!/usr/bin/env node
/**
 * 材质稳定性静态护栏（2026-10-31）。
 *
 * 背景：OneGUI 的玻璃材质依赖 `backdrop-filter`；而 CSS 祖先链上任何 `opacity < 1`、
 * `filter` 或混合模式都会建立 backdrop root，使子元素的背景模糊在动画期间失效。
 * 同时对比度引擎按合成背景选墨，祖先 opacity 的中间态会让它把字色定格成反色。
 * 于是「入场动画没模糊」「文字颜色突变」反复出现在不同页面。
 *
 * 本护栏把两条结构性约束钉死：
 *   1. 入场 keyframes 只动 transform，不写 opacity；
 *   2. 玻璃面 / 材质的祖先不做 opacity 动画（页面容器、遮罩、逐项进场容器）；
 *   3. 对比度引擎只在稳定合成态取样，且环境重取走颜色过渡、首帧同步定格。
 *
 * 跑法：node tools/material-motion-guard.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const APP = "apps/desktop/src/";
const GUI = "packages/gui/src/";

const motion = read(APP + "styles/motion.css");
const globalCss = read(APP + "styles/global.css");
const explorerUi = read(APP + "styles/explorer-ui.css");
const explorerOh = read(APP + "styles/explorer-oh.css");
const explorerHome = read(APP + "styles/explorer-home.css");
const base = read(GUI + "styles/base.css");
const overlay = read(GUI + "styles/overlay.css");
const contacts = read(GUI + "recipes/contacts.css");
const textContrast = read(APP + "lib/textContrast.ts");

let count = 0;
const check = (value, label) => {
  assert.ok(value, label);
  count++;
  console.log("  ✓ " + label);
};

/** 取一段 @keyframes 的内容（不依赖结束行格式，按大括号配平）。 */
function keyframesBody(css, name) {
  const start = css.indexOf(`@keyframes ${name}`);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

console.log("[1] 入场 keyframes：只动 transform，不写 opacity");
{
  const entrances = [
    [motion, ["m-rise", "m-grid-in", "m-spring-in", "m-page-in", "m-slide-right", "m-slide-left", "m-reveal-in", "m-expand-in", "m-tab-in", "m-tab-in-back", "m-page-head-in"]],
    [base, ["og-pop-in"]],
    [contacts, ["og-contact-card-in"]],
    [globalCss, ["page-in", "row-in"]],
    [explorerUi, ["ex-slide-down", "ex-ctxmenu-bloom"]],
    [explorerOh, ["ohx-grow", "ohx-grow-top"]],
    [explorerHome, ["hs-fade"]],
  ];
  const offenders = [];
  for (const [css, names] of entrances) {
    for (const name of names) {
      const body = keyframesBody(css, name);
      check(body !== null, `@keyframes ${name} 存在`);
      if (/(^|[;{\s])opacity\s*:/.test(body)) offenders.push(name);
    }
  }
  check(offenders.length === 0, `入场 keyframes 均不含 opacity（违规：${offenders.join(",") || "无"}）`);
}

console.log("[2] 玻璃面/页面容器：禁止透明度入场");
{
  check(/\.page-anim,[\s\S]{0,260}?\.content,[\s\S]{0,140}?\.tab-anim[\s\S]{0,220}?animation: none/.test(motion),
    "页面/页签容器 animation: none");
  check(/\.plg-form-overlay,[\s\S]{0,120}?\.confirm-mask\s*\{[\s\S]{0,80}?animation: none/.test(motion),
    "传统弹层遮罩不做 opacity 动画");
  check(/\.rch-mask\s*\{\s*animation: none/.test(globalCss), "校园卡充值遮罩不做 opacity 动画");
  check(/\.ex-sheet-mask\s*\{[\s\S]{0,140}?animation: none/.test(explorerUi), "抽屉遮罩不做 opacity 动画");
}

console.log("[3] OneGUI 遮罩：用 background-color 动画，不用 opacity");
{
  check(/\.og-scrim\s*\{[\s\S]{0,260}?animation: og-scrim-in/.test(overlay), ".og-scrim 使用 og-scrim-in");
  check(!/\.og-scrim\s*\{[\s\S]{0,260}?og-fade-in/.test(overlay), ".og-scrim 不再用 og-fade-in（opacity）");
  const inBody = keyframesBody(base, "og-scrim-in") ?? "";
  const outBody = keyframesBody(base, "og-scrim-out") ?? "";
  check(/background-color:/.test(inBody) && /background-color:/.test(outBody), "og-scrim 进出场只动画 background-color");
  check(!/(^|[;{\s])opacity\s*:/.test(inBody + outBody), "og-scrim 关键帧不含 opacity");
  const popIn = keyframesBody(base, "og-pop-in") ?? "";
  const popOut = keyframesBody(base, "og-pop-out") ?? "";
  check(!/(^|[;{\s])opacity\s*:/.test(popIn + popOut), "面板 pop 进出场不含 opacity（背景模糊全程有效）");
}

console.log("[4] 玻璃卡片不参与逐项/滚动进场");
{
  check(/:is\(\.stagger, \.stats, \.today-grid, \.market-grid, \.icon-grid\) > \*\s*\{[\s\S]{0,60}?animation: none/.test(motion),
    "统计卡/网格/stagger 容器 animation: none");
  check(!/html\.has-reveal[\s\S]{0,420}?opacity:\s*0/.test(motion), "滚动揭示不再以 opacity:0 藏身");
  check(/html\.has-reveal[\s\S]{0,300}?\[data-reveal-in\][\s\S]{0,120}?animation: m-reveal-in/.test(motion),
    "揭示只触发纯位移 m-reveal-in");
}

console.log("[5] 对比度引擎：稳定采样 + 首帧同步定格 + 环境变化过渡");
{
  check(/function hasTransientAncestor\(/.test(textContrast), "有祖先合成态检查（opacity/filter/混合模式）");
  check(/if \(samplingDelayed\(\) \|\| hasTransientAncestor\(el\)\) \{ retryAfterStable\(el, mode\); return; \}/.test(textContrast),
    "settle/settleIcon 在中间态跳过并延后");
  check(/function transitionInk\(/.test(textContrast) && /if \(mode === "env"\) transitionInk\(el\)/.test(textContrast),
    "环境重取时墨色变化走过渡（不跳色）");
  check(/const roots = pendingRoots\.splice\(0, pendingRoots\.length\);\s*\n\s*scanNew\(roots\);/.test(textContrast),
    "新增节点在渲染前同步扫描（首帧即定格）");
  check(!/scanNew\(roots\);\s*\n\s*\}, 350\)/.test(textContrast), "不再延迟 350ms 才扫描（会先画令牌色再改色）");
  check(/if \(reapplyScheduled\) \{ window\.clearTimeout\(reapplyScheduled\); reapplyScheduled = 0; \}/.test(textContrast),
    "环境变更合并为一次重取（避免两轮换墨）");
}

console.log(`\n材质稳定性护栏：${count} 项通过（入场只动 transform / 遮罩只动背景 / 首帧定格 / 环境重取过渡）`);