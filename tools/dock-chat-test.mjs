#!/usr/bin/env node
/**
 * C20 OH 聊天界面护栏（霖 2026-10-01 走查）。
 * 两个现象：① 发消息后把「LLM 请求/响应」这类原始行直接摊在聊天里；② 底部统计文字用了
 * 等宽栈（本机回退成宋体观感，与正文不同族）。口径：原始日志/耗时默认不展示（人话状态
 * 「思考中…」承担进度，要看原始行自己点开工具调用链），统计文字回正文无衬线栈。
 * 反例提醒：不许用 `display: none` 把它藏住却留在 DOM 里——那读屏还会念。
 */
import { readFileSync } from "node:fs";

const DOCK = readFileSync("apps/desktop/src/plugins/ChatDock.tsx", "utf8");
const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/* ① 流式期原始 trace 不默认展开 */
ok(/p\.trace\.length > 0 \? <ChainBlock label="工具调用" lines=\{p\.trace\} \/> : null/.test(DOCK),
  "流式期的「工具调用」链又默认展开了（原始日志会摊在聊天里）");
ok(!/lines=\{p\.trace\} defaultOpen/.test(DOCK), "流式 trace 仍是 defaultOpen");
ok(/dock-thinking/.test(DOCK) && /p\.status \?\? "思考中…"/.test(DOCK), "没有「思考中…」这类人话状态");
/* 反例：不许用 display:none 藏 */
ok(!/dock-trace[^;]*display:\s*none/.test(CSS), "原始 trace 被 display:none 藏住（读屏还会念，属于假隐藏）");

/* ② 统计文字回正文无衬线栈 */
const foot = CSS.slice(CSS.indexOf(".dock-foot {"), CSS.indexOf("}", CSS.indexOf(".dock-foot {")));
ok(/font-family: inherit/.test(foot), ".dock-foot 没有回到正文无衬线栈（等宽/宋体观感）");
ok(!/serif/.test(foot), ".dock-foot 里出现 serif");

/* ③ 原始日志行本身仍在（不是删功能，只是默认不展示） */
ok(/m\.meta\?\.trace\?\.length \? <ChainBlock label="工具调用" lines=\{m\.meta\.trace\} \/>/.test(DOCK),
  "落定后的工具调用链被删了（应当保留、可点开回看）");

console.log(
  fails.length
    ? "OH 聊天护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "OH 聊天护栏：流式期只给人话状态（原始 trace 默认折叠但保留可展开）✓ 统计文字回正文无衬线栈 ✓",
);
process.exit(fails.length ? 1 : 0);
