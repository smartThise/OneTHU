#!/usr/bin/env node
/**
 * 双线不变量检查（2026-09-21 事故护栏）。
 *
 * 事故：demo 分支有两个**只属于 demo** 的提交（`feat(demo): 打开脱敏开关并改为独立
 * 应用身份`、demo 残余风险文档）。把 demo 合并/快进进发布线时，它们一起进了 dev3：
 * 发布线于是带着 `DESENSITIZE_ENABLED = true`（正式版会脱敏）与
 * `identifier = app.onethu.demo`（装成另一个应用、覆盖不了线上版本）。
 *
 * 纪律：**镜像只按文件摘取（git checkout <sha> -- <files>），永远不要把 demo 合并进
 * 发布线**；两线允许且应当在这几个文件上保持不同。
 *
 * 本检查可独立运行，也可在镜像提交后当作门禁：
 *   node tools/release-line-check.mjs            # 检查 git 引用（dev2/demo 或远端等价名）
 *   node tools/release-line-check.mjs --worktree # 检查当前工作区（镜像提交前自查）
 */
import { execFileSync } from "node:child_process";

const REF_CANDIDATES = {
  release: ["dev2", "origin/dev3", "github/dev3", "origin/dev2"],
  demo: ["demo", "origin/demo", "github/demo"],
};

function git(args, ref) {
  const spec = ref ? `${ref}:${args}` : args;
  return execFileSync("git", ["show", spec], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function fileExists(ref, path) {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${path}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pickRef(list) {
  for (const r of list) {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", r], { stdio: "ignore" });
      return r;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

const failures = [];
const notes = [];
const worktree = process.argv.includes("--worktree");

/** 发布线不变量：脱敏关、正式身份、无 demo 专属产物 */
function checkRelease(label, read, exists) {
  try {
    const privacy = read("packages/core/src/privacy/config.ts");
    if (!/export const DESENSITIZE_ENABLED = false;/.test(privacy)) {
      failures.push(`${label}：脱敏开关未关闭（DESENSITIZE_ENABLED 必须为 false——正式版不得脱敏）`);
    }
    const conf = read("apps/desktop/src-tauri/tauri.conf.json");
    if (!/"identifier": "app\.onethu\.desktop"/.test(conf)) {
      failures.push(`${label}：应用标识不是 app.onethu.desktop（会装成新应用、覆盖不了线上版本）`);
    }
    if (!/"productName": "OneTHU"/.test(conf)) failures.push(`${label}：productName 不是 OneTHU`);
    if (exists("docs/demo-build.md")) failures.push(`${label}：出现 demo 专属文档 docs/demo-build.md`);
    if (exists("apps/desktop/scripts/build-demo-apk.sh")) {
      failures.push(`${label}：出现 demo 专属脚本 apps/desktop/scripts/build-demo-apk.sh`);
    }
    // 入库的 gen/android 是符号链接（值随构建机不同），但发布线不该指向 demo 工程
    try {
      const link = read("apps/desktop/src-tauri/gen/android").trim();
      if (link.includes("onethu-android-demo")) {
        failures.push(`${label}：gen/android 软链指向 demo 工程（${link}）`);
      }
    } catch {
      /* 不是符号链接或读不到：跳过 */
    }
  } catch (e) {
    failures.push(`${label}：读取失败 ${String(e).slice(0, 80)}`);
  }
}

/** demo 线不变量：脱敏开、独立身份 */
function checkDemo(label, read) {
  const privacy = read("packages/core/src/privacy/config.ts");
  if (/export const DESENSITIZE_ENABLED = false;/.test(privacy)) {
    failures.push(`${label}：脱敏开关被关掉了（demo 必须脱敏）`);
  }
  const conf = read("apps/desktop/src-tauri/tauri.conf.json");
  if (!/"identifier": "app\.onethu\.demo"/.test(conf)) {
    failures.push(`${label}：应用标识不是 app.onethu.demo（demo 与正式版应可同机共存）`);
  }
}

if (worktree) {
  const { readFileSync, existsSync } = await import("node:fs");
  const branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();
  const read = (p) => readFileSync(p, "utf8");
  const exists = (p) => existsSync(p);
  if (branch === "demo") {
    checkDemo(`工作区(${branch})`, read);
    notes.push("当前在 demo 分支：按 demo 不变量检查（发布线不变量走 git 引用检查）");
  } else {
    checkRelease(`工作区(${branch})`, read, exists);
  }
} else {
  const rel = pickRef(REF_CANDIDATES.release);
  const demo = pickRef(REF_CANDIDATES.demo);
  if (rel) checkRelease(`发布线(${rel})`, (p) => git(p, rel), (p) => fileExists(rel, p));
  else notes.push("未找到发布线引用（dev2 / origin/dev3 / github/dev3），跳过发布线检查");
  if (demo) checkDemo(`demo 线(${demo})`, (p) => git(p, demo));
  else notes.push("未找到 demo 线引用，跳过 demo 检查");
}

for (const n of notes) console.log(`· ${n}`);
if (failures.length > 0) {
  console.error("✗ 双线不变量被破坏：");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("  提示：镜像只按文件摘取（git checkout <sha> -- <files>），不要把 demo 合并进发布线。");
  process.exit(1);
}
console.log("✓ 双线不变量检查通过（发布线不脱敏 + 正式身份 + 无 demo 产物；demo 线保持独立身份）");
