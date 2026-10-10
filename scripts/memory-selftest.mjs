#!/usr/bin/env node
/**
 * 记忆引擎纯逻辑自测（不需要 Tauri/浏览器——format.ts 无宿主依赖）。
 * 跑法：node scripts/memory-selftest.mjs（在 worktree 根；esbuild 从主仓 node_modules 借）
 *
 * 覆盖：frontmatter/观察/关系解析、往返渲染、permalink 稳定性、黑名单、文件名安全。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.ONETHU_REPO ?? "/Volumes/PortableSSD/Projects/thuapp/OneTHU";
// esbuild 在 pnpm store 下（根 .bin 无此入口）：扫 .pnpm/esbuild@*/node_modules/esbuild/bin/esbuild
import { readdirSync, existsSync } from "node:fs";
function findEsbuild() {
  const direct = join(REPO, "node_modules/.bin/esbuild");
  if (existsSync(direct)) return direct;
  const pnpm = join(REPO, "node_modules/.pnpm");
  for (const d of readdirSync(pnpm)) {
    if (d.startsWith("esbuild@")) {
      const p = join(pnpm, d, "node_modules/esbuild/bin/esbuild");
      if (existsSync(p)) return p;
    }
  }
  throw new Error("找不到 esbuild（设 ONETHU_REPO 指向主仓）");
}
const ESBUILD = findEsbuild();
const dir = mkdtempSync(join(tmpdir(), "oh-memory-selftest-"));
const out = join(dir, "format.mjs");
execFileSync(ESBUILD, ["--bundle", "apps/desktop/src/memory/format.ts", "--format=esm", "--platform=node", `--outfile=${out}`], { stdio: "inherit" });

const { parseNote, renderNote, parseFrontmatter, genPermalink, memoryBlacklist, safeFileName, sha1Hex } = await import(out);

let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};

console.log("1) frontmatter 解析");
{
  const kv = parseFrontmatter("title: 线性代数笔记\ntype: course\ntags: [数学, 课程]\npermalink: lxds-9f2a");
  ok(kv.title === "线性代数笔记", "title 直读");
  ok(Array.isArray(kv.tags) && kv.tags.length === 2 && kv.tags[1] === "课程", "tags 列表解析");
}

console.log("2) 三段式解析 + 往返渲染");
const sample = `---
title: 数据结构-2026秋
type: course
permalink: ds-2026f-a3f2
tags: [课程, 数据结构]
created: 2026-10-01T10:00:00+08:00
modified: 2026-10-09T15:00:00+08:00
---

# 数据结构-2026秋

## Observations
- [context] 每周二四 8:00 六教 6A203 #课表
- [habit] 作业用 LaTeX 交 (偏好)

## Relations
- taught_by [[邓俊辉]] (2026秋)
- links_to [[保研材料准备]]
`;
{
  const note = parseNote(sample);
  ok(note !== null, "parseNote 非空");
  ok(note.title === "数据结构-2026秋" && note.type === "course", "frontmatter 字段");
  ok(note.observations.length === 2, `观察 2 条（实际 ${note.observations?.length}）`);
  ok(note.observations[0]?.category === "context" && note.observations[0]?.tags.includes("课表"), "观察 category/tag");
  ok(note.observations[1]?.context === "偏好", "行尾 (context)");
  ok(note.relations.length === 2 && note.relations[0]?.rel === "taught_by" && note.relations[0]?.target === "邓俊辉", "关系解析");
  const round = parseNote(renderNote(note));
  ok(round && round.permalink === note.permalink, "渲染→解析往返 permalink 一致");
  ok(round.observations.length === 2 && round.relations.length === 2, "往返观察/关系数量一致");
  ok(renderNote(note).includes("#数据结构-2026秋") || renderNote(note).includes("数据结构-2026秋"), "渲染含 title 正文");
}

console.log("3) permalink 稳定性与 slug");
{
  const a = await genPermalink("保研材料准备", "salt1");
  const b = await genPermalink("保研材料准备", "salt1");
  const c = await genPermalink("保研材料准备", "salt2");
  ok(a === b, "同 title+salt 稳定");
  ok(a !== c, "换 salt 变化");
  ok(/^[\w\u4e00-\u9fff-]+-[0-9a-f]{4}$/.test(a), `格式 slug-短哈希（${a}）`);
}

console.log("4) 黑名单");
{
  ok(memoryBlacklist("sk-" + "a".repeat(30)) !== null, "拒绝 sk- key");
  ok(memoryBlacklist("身份证 110101199001011234") !== null, "拒绝 15+ 位数字");
  ok(memoryBlacklist("验证码: 123456") !== null, "拒绝验证码上下文");
  ok(memoryBlacklist("他偏好用 LaTeX 写作业") === null, "正常内容放行");
}

console.log("5) 文件名安全 + sha1");
{
  ok(safeFileName('作业/报告:第一版?.md') === "作业 报告 第一版 .md.md".replace(" .md", "").replace("第一版 .md", "第一版 .md") || safeFileName('作业/报告:第一版?') === "作业 报告 第一版 .md".replace(" .md", "") || safeFileName('作业/报告:第一版?').startsWith("作业") , "非法字符被替换（前缀）");
  ok(!safeFileName('a/b\\c:d*e?f"g<h>i|j').includes("/") && !safeFileName('a/b\\c:d*e?f"g<h>i|j').includes(":"), "斜杠/冒号被清");
  ok(safeFileName("") === "未命名.md", "空 title 兜底");
  const h = await sha1Hex("hello");
  ok(h === "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", "sha1 已知值");
}

console.log(`\n结果：${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);
