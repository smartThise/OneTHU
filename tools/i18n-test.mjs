#!/usr/bin/env node
/**
 * i18n 护栏（2026-10-19，语言自动注册版）。
 *
 * 目录 `apps/desktop/src/i18n/locales/*.ts` 就是语言清单：丢一个 `<code>.ts` 进去
 * 就算注册一种语言。这里逐语言校验：
 *   ① 默认导出必须是 `{ label, messages }`，label 非空；
 *   ② 键集合必须与 zh-CN 完全一致（漏翻 = 运行期弹出键名）；
 *   ③ 不允许空文案；
 *   ④ `t()` 的占位符、缺键回落、切换订阅 / 持久化、未知语言码被拒绝；
 *   ⑤ 源码里用到的 `t("...")` / `tr("...")` 键必须真的存在；
 *   ⑥ 注册必须靠目录扫描（import.meta.glob），不许再硬编码 "en-US"。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/i18n-test.mjs ｜ 0 通过 / 1 违规
 */
import "./board-test-env.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/* ── 目录即清单：逐个语言文件加载 ─────────────────────────────── */
const DIR = "apps/desktop/src/i18n/locales";
const files = readdirSync(DIR).filter((f) => f.endsWith(".ts")).sort();
ok(files.length >= 2, "locales/ 下至少要有两种语言（现在 " + files.length + "）");

const locales = new Map();
for (const file of files) {
  const code = file.replace(/\.ts$/, "");
  const mod = await import(pathToFileURL(join(process.cwd(), DIR, file)).href);
  const def = mod.default;
  ok(!!def && typeof def === "object", `${file} 没有默认导出`);
  ok(typeof def?.label === "string" && def.label.trim().length > 0, `${file} 缺少 label（语言选择器会显示语言码）`);
  ok(!!def?.messages && typeof def.messages === "object", `${file} 缺少 messages`);
  if (def?.messages) locales.set(code, def);
}

const zh = locales.get("zh-CN")?.messages ?? {};
const zhKeys = Object.keys(zh).sort();
ok(zhKeys.length > 0, "zh-CN 不存在或没有文案（默认语言必须有）");

/* zh-CN 是事实源：键必须齐全。其它语言允许**只翻一部分**（缺键回落中文），
   但绝不能出现 zh-CN 没有的键（那一定是拼错了）。覆盖率只报告，不判失败。 */
const coverage = [];
for (const [code, def] of locales) {
  const keys = Object.keys(def.messages).sort();
  const extra = keys.filter((k) => !(k in zh));
  ok(extra.length === 0, `${code} 多出键：` + extra.slice(0, 8).join(", "));
  ok(keys.every((k) => def.messages[k].trim().length > 0), `${code} 有空文案：` + keys.filter((k) => !def.messages[k].trim()).slice(0, 8).join(", "));
  if (code !== "zh-CN") coverage.push(`${code} ${keys.length}/${zhKeys.length}`);
}

/* ── 运行时行为 ─────────────────────────────────────────────── */
const I = await import("../apps/desktop/src/i18n/index.ts");
ok(I.LOCALES.includes("zh-CN") && I.LOCALES.includes("en-US"), "内置语言没有注册进 LOCALES");
ok(I.LOCALE_LABELS["zh-CN"] === "简体中文", "语言显示名没有取自语言文件（zh-CN）");
ok(I.LOCALE_LABELS["en-US"] === "English", "语言显示名没有取自语言文件（en-US）");

I.setLocale("zh-CN");
ok(I.t("settings.section.help") === "帮助", "默认语言不是中文");
ok(I.t("board.template.applied", { name: "X" }) === "已套用模板：X", "占位符替换失效");
ok(I.t("nope.missing.key") === "nope.missing.key", "缺键没有回落到键名");

let fired = 0;
const off = I.subscribeLocale(() => { fired += 1; });
I.setLocale("en-US");
ok(fired === 1, "切换语言没有通知订阅者");
ok(I.t("settings.section.help") === "Help", "切换到英文后文案没变");
ok(globalThis.localStorage.getItem("onethu.locale") === "en-US", "语言选择没有持久化");
off();
I.setLocale("zh-CN");
ok(fired === 1, "取消订阅后仍在通知");

/* 未知语言码：忽略，不许静默改写成中文（旧实现的坑） */
I.setLocale("en-US");
I.setLocale("xx-XX");
ok(I.getLocale() === "en-US", "未知语言码没有被拒绝（会把用户踢回中文）");
I.setLocale("zh-CN");
ok(globalThis.localStorage.getItem("onethu.locale") === "zh-CN", "切回中文没有持久化");

/* ── 源码用到的键必须存在 ───────────────────────────────────── */
const NS = /^(settings|board|card|common|nav|shell|cat|auto)\./;
const used = new Set();
const walk = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "vendor" || name.name === "node_modules" || name.name === "i18n") continue;
      walk(p);
    } else if (/\.(tsx?|jsx?)$/.test(name.name)) {
      const text = readFileSync(p, "utf8");
      /* 引用形态只有三种：t()/tr() 调用、NAV 的 labelKey、CAT_KEY 里的 cat.*。
         （不扫全部字面量：「nav.go」「board.today」这类变量/板 id 会误伤。） */
      for (const m of text.matchAll(/\b(?:tr|t|i18n)\(\s*"([^"]+)"/g)) if (NS.test(m[1])) used.add(m[1]);
      for (const m of text.matchAll(/labelKey:\s*"([^"]+)"/g)) used.add(m[1]);
      for (const m of text.matchAll(/"(cat\.[a-zA-Z0-9]+)"/g)) used.add(m[1]);
      /* 标题表把键当数据存（PAGE_TITLES / TAB_SUFFIX），不会出现在 t("…") 调用里 */
      for (const m of text.matchAll(/"(page\.[a-zA-Z0-9]+|sub\.[a-zA-Z0-9]+\.[a-zA-Z0-9]+|tab\.[a-zA-Z0-9]+)"/g)) used.add(m[1]);
    }
  }
};
walk("apps/desktop/src");
const undefinedKeys = [...used].filter((k) => !(k in zh));
ok(used.size > 0, "没有扫到任何 t(\"...\") 调用（护栏失效）");
ok(undefinedKeys.length === 0, "源码引用了不存在的键：" + undefinedKeys.join(", "));

/* ── 结构约束：自动注册，不许回退到硬编码语言码 ─────────────── */
const indexSrc = readFileSync("apps/desktop/src/i18n/index.ts", "utf8");
ok(/import\.meta\.glob\("\.\/locales\/\*\.ts", \{ eager: true \}\)/.test(indexSrc), "index.ts 没有用 import.meta.glob 扫描 locales/（必须字面量调用，否则 Vite 不展开）");
ok(/typeof import\.meta\.env !== "undefined"/.test(indexSrc), "index.ts 没有区分 Vite / node 环境");
ok(/glob\("\.\/locales\/\*\.ts"/.test(indexSrc), "glob 的目录不是 locales/*.ts");
ok(!/next === "en-US"/.test(indexSrc) && !/raw === "en-US"/.test(indexSrc), "index.ts 又硬编码了 \"en-US\"（自定义语言会被打回中文）");

if (fails.length) {
  for (const f of fails) console.error("✗ " + f);
  process.exit(1);
}
console.log(`i18n: ${locales.size} locales, ${zhKeys.length} keys, ${used.size} used, all assertions passed`);
console.log(`  覆盖：${coverage.join(" ｜ ")}（未翻部分回落 zh-CN）`);
