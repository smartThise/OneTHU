#!/usr/bin/env node
/**
 * B2b 列表项护栏：行类必须走令牌，禁止字面圆角与 Compat 描边，且交互行要有状态层。
 * 行家族是各页最容易各自长歪的一类（邮箱/云盘/服务目录/待办/组件绑定），所以统一在这里拦。
 */
import { readFileSync } from "node:fs";

const CSS = readFileSync("apps/desktop/src/styles/global.css", "utf8");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); };

/** 取某个类名的规则体（首个匹配；行类没有重复定义） */
function block(sel) {
  const i = CSS.indexOf(sel + " {");
  if (i < 0) return null;
  const j = CSS.indexOf("}", i);
  return CSS.slice(i + sel.length + 3, j);
}

const ROWS = [".mail-row", ".cloud-row", ".svc-row", ".task-row", ".wb-row", ".home-modal-row"];

for (const sel of ROWS) {
  const body = block(sel);
  ok(body !== null, sel + " 规则缺失");
  if (!body) continue;
  ok(!/border-radius:\s*\d/.test(body), sel + " 用了字面圆角（应走 --md-sys-shape-corner-*）");
  ok(!/--border-soft/.test(body), sel + " 分隔线用了 Compat 描边（应走 --md-sys-color-outline-variant）");
  ok(!/#[0-9a-fA-F]{3,6}|rgba?\(/.test(body), sel + " 出现字面色值");
}

/* 交互行必须有 hover（触摸端另有 :active 反馈） */
for (const sel of [".mail-row", ".cloud-row", ".svc-row", ".task-row", ".wb-row"]) {
  const pat = new RegExp(sel.replace(".", "\\.") + ":(hover|active)");
  ok(pat.test(CSS), sel + " 没有任何 hover/active 状态反馈");
}

console.log(
  fails.length
    ? "列表项护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n")
    : "列表项护栏：行类无字面圆角/字面色值 ✓ 分隔线走 outline-variant ✓ 交互行有状态层 ✓",
);
process.exit(fails.length ? 1 : 0);
