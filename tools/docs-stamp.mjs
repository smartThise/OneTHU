#!/usr/bin/env node
/**
 * 给文档写入更新时间（docs/**，精确到分钟）。
 *
 * 约定：每份文档在标题下方带一行 `> 最后更新：YYYY-MM-DD HH:MM`，读者一眼可知文档是否
 * 跟得上代码。时间取该文件**最后一次内容变更**的时刻：
 *
 *   node tools/docs-stamp.mjs            # 默认：只给**改动过**的文档打当前时间，其余不动
 *   node tools/docs-stamp.mjs --all      # 全部取当前时间
 *   node tools/docs-stamp.mjs --from-git # 全部取该文件最后一次提交时间（回填用）
 *
 * 提交前跑一次默认模式即可。默认不动未改动的文件：否则每次提交后，该文件的「最后提交时间」
 * 都会比时间戳更晚，再跑一次又会刷新，来回抖动。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(ROOT, "docs");
const TZ = "Asia/Shanghai";
const PREFIX = "> 最后更新：";

const mode = process.argv.includes("--all")
  ? "all"
  : process.argv.includes("--from-git")
    ? "git"
    : "auto";

function stampOf(ms) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return parts;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    // `._*` 是 exFAT / macOS 的旁文件，不是文档
    else if (e.name.endsWith(".md") && !e.name.startsWith("._")) out.push(p);
  }
  return out;
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function lastCommitMs(rel) {
  try {
    const iso = git(["log", "-1", "--format=%cI", "--", rel]);
    const ms = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function isDirty(rel) {
  try {
    return git(["status", "--porcelain", "--", rel]) !== "";
  } catch {
    return true;
  }
}

function applyStamp(file, value) {
  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  const stampIdx = lines.findIndex((l) => l.startsWith(PREFIX));
  if (stampIdx >= 0) {
    if (lines[stampIdx] === PREFIX + value) return false;
    lines[stampIdx] = PREFIX + value;
  } else {
    const h1 = lines.findIndex((l) => l.startsWith("# "));
    const line = PREFIX + value;
    if (h1 >= 0) lines.splice(h1 + 1, 0, "", line);
    else lines.unshift(line, "");
  }
  fs.writeFileSync(file, lines.join("\n"));
  return true;
}

// 覆盖范围：docs/** 与仓库根 README（两者都是面向读者的文档）
const targets = [...walk(DOCS), path.join(ROOT, "README.md")].filter((f) => fs.existsSync(f));

let changed = 0;
for (const file of targets.sort()) {
  const rel = path.relative(ROOT, file);
  let value;
  if (mode === "all") value = stampOf(Date.now());
  else if (mode === "git") value = stampOf(lastCommitMs(rel) ?? Date.now());
  else {
    if (!isDirty(rel)) continue; // 未改动 → 保留现有时间戳
    value = stampOf(Date.now());
  }
  if (applyStamp(file, value)) {
    console.log("写入", rel, value);
    changed += 1;
  }
}
console.log(changed === 0 ? "全部文档时间戳已是最新" : `更新 ${changed} 份文档的时间戳`);
