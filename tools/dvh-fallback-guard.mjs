#!/usr/bin/env node
/**
 * 样式结构护栏：`dvh` 必须带「vh 前置」。
 *
 * 来由（2026-xx 退役机实测）：WebView 96（Chromium 96）**不支持 dvh**——`height: calc(100dvh - 210px)`
 * 会被整条丢弃（实测寻迹页 `.trace-map-wrap` 只剩自己的 `min-height: 320px`，而支持引擎上应为
 * 822 − 210 = 612px）。修法是每处 `dvh` 前面补一条同属性、同 calc 结构的 `vh` 版本：现代引擎后者覆盖
 * 前者（行为不变），老引擎拿到 vh（大视口高度，保守兜底）。
 *
 * 这条护栏守的就是那个配对关系，防的是「以后新增一处 dvh 忘了配 vh」：
 *   对 global.css 里**每个** `dvh` 声明，要求它**紧邻的前一个声明**是
 *     ① 同一属性名；② 值除 `dvh`→`vh` 外逐字符相同（＝同 calc 结构）；③ 中间除 `;` 与空白外无他物。
 *
 * 为什么不做成「上一行必须……」的纯行匹配：文件里有 5 处规则是单行写的
 * （`.plg-term.is-tall { max-height: none; height: 56vh; height: 56dvh; }`），
 * 那里「紧邻」只能是同一行内的前一个声明；按「前一个声明」判定对两种写法都成立，且更严格——
 * 同规则内插进任何别的声明就会红。
 *
 * 为什么不去改 tools/style-scan.mjs：那个脚本是「4pt 间距 / 字阶」的基线棘轮（只数 padding/margin/gap/
 * font-size 的字面量，带 --write-baseline 自我改写），不具备做行邻接结构断言的形态；按本轮约定
 * 另立本文件，并接进 package.json 的 guard 链（紧随 css-parse-test.mjs）。
 *
 * 用法：
 *   node tools/dvh-fallback-guard.mjs                  # 查默认文件
 *   node tools/dvh-fallback-guard.mjs <某个 css 路径>  # 反例自检用（拿被故意改坏的副本跑）
 */
import { readFileSync } from "node:fs";

const DEFAULT_FILE = "apps/desktop/src/styles/global.css";
const file = process.argv[2] || DEFAULT_FILE;

const raw = readFileSync(file, "utf8");

/* 注释等长遮蔽（保留换行）——源码注释里也有 `100dvh` 这类说明文字，不能当声明数。 */
const css = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const lineOf = (offset) => css.slice(0, offset).split("\n").length;

/* 声明扫描：`(?:^|[;{}])` 保证属性名前是规则/声明的边界，因此
   `@media (max-width: 839.98px)`、`@supports (display: grid)`、`selector(:has(*))` 里的
   伪 `属性: 值` 不会被当成声明（它们前面是 `(`）。 */
const DECL = /(?:^|[;{}])\s*([-\w]+)\s*:\s*([^;{}]*)/g;
const decls = [...css.matchAll(DECL)];

const violations = [];
let total = 0;

for (let i = 0; i < decls.length; i++) {
  const m = decls[i];
  const value = m[2];
  if (!/\d(?:\.\d+)?dvh\b/.test(value)) continue;
  total++;

  const prop = m[1];
  const dvhAt = m.index + m[0].indexOf(value) + value.search(/\d(?:\.\d+)?dvh\b/);
  const line = lineOf(dvhAt);
  const text = raw.split("\n")[line - 1].trim();

  const prev = decls[i - 1];
  const wantValue = value.trim().replace(/dvh\b/g, "vh");
  const sameRule = prev ? /^[;\s]*$/.test(css.slice(prev.index + prev[0].length, m.index)) : false;
  const okProp = prev && prev[1] === prop;
  const okValue = prev && prev[2].trim() === wantValue;

  if (!(okProp && okValue && sameRule)) {
    const why = !prev
      ? "文件里第一处 dvh 之前没有任何声明"
      : !sameRule
        ? `前一个声明不在同一条规则内（中间隔了 ${JSON.stringify(css.slice(prev.index + prev[0].length, m.index).slice(0, 40))}）`
        : `前一个声明是 "${prev[1]}: ${prev[2].trim().slice(0, 60)}"，不是同一属性的 vh 版本 "${prop}: ${wantValue.slice(0, 60)}"`;
    violations.push(`  ${file}:${line}  ${prop}: ${value.trim().slice(0, 70)}\n     ↳ ${why}`);
  }
}

if (violations.length) {
  console.error(`样式结构护栏：不通过 ✗  dvh 缺「vh 前置」${violations.length} 处（共 ${total} 处 dvh）`);
  console.error("  规则：每处 dvh 的紧邻前一个声明必须是同属性、同值的 vh 版本（vh 先、dvh 后）。");
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`样式结构护栏：${file} 的 ${total} 处 dvh 全部带紧邻的 vh 前置 ✓`);
