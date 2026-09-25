#!/usr/bin/env node
/**
 * OneTHU dev 启动器（跨平台）—— scripts/dev-launch.sh 的等价实现。
 *
 * 为什么不直接跑 .sh：原脚本是 macOS 专用的（$HOME/Library/Caches、
 * codesign、open、.app bundle、TCC 定位授权），Windows 上 Git Bash
 * 也提供不了这些语义。本文件在 Node 里复刻它的**运行时职责**，与
 * prebuild.mjs 同一思路（跨平台前置，替代 POSIX-only 管道）。
 *
 * 与原脚本的职责对应关系：
 *   ① vite :5180（没起就后台拉起）      -> ensureVite()
 *   ② Rust debug 构建                    -> 交给 `tauri dev`（CLI 自己 cargo build）
 *   ③ 装壳 + 启动                        -> 交给 `tauri dev`（Windows 不需要 .app wrapper）
 *   ④ 前置：@onethu/info-lib 必须先构建  -> ensureInfoLib()（原脚本靠 outDir 已存在，此处补上）
 *
 * 用法（任选其一）：
 *   node apps/desktop/scripts/dev-launch.mjs
 *   pnpm --filter @onethu/desktop exec node scripts/dev-launch.mjs
 *
 * 原生壳前置（Rust + MSVC）缺失时自动降级为浏览器热更新模式并给出安装步骤，
 * 而不是像原脚本那样直接退出。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * 解析一个包的 CLI 入口 .js，用 process.execPath 直接 spawn。
 * 好处：绕开 .cmd/.ps1 wrapper 与 shell 拼接（避免 DEP0190），
 * 也不依赖子进程管道——沙箱环境下管道会被拒（spawn EPERM）。
 */
function resolveCliJs(spec) {
  const pkgPath = require.resolve(`${spec}/package.json`);
  const pkg = require(pkgPath);
  const bin = pkg.bin;
  const rel = typeof bin === "string" ? bin : bin && Object.values(bin)[0];
  return rel ? join(dirname(pkgPath), rel) : null;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, ".."); // apps/desktop
const REPO = resolve(DESKTOP, "..", ".."); // 仓库根
const HOST = "127.0.0.1";
const PORT = 5180;
const URL = `http://${HOST}:${PORT}/`;

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);
const isWindows = process.platform === "win32";

const WANT_BROWSER = process.argv.includes("--browser");

/* ---------------------------------------------------------------- 工具函数 */

/** 探测可执行文件：先查 PATH，再查常见安装位置。 */
function findExe(name, candidates) {
  // where.exe / which 是真实可执行文件，不需要 shell；用 shell 会触发
  // Node 的 DEP0190（args 经字符串拼接）。
  const probe = spawnSync(isWindows ? "where.exe" : "which", [name], { encoding: "utf8" });
  if (probe.status === 0 && probe.stdout && probe.stdout.trim()) {
    return probe.stdout.trim().split(/\r?\n/)[0].trim();
  }
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

/** 用系统默认浏览器打开 dev server（降级模式下的原生窗口替代品）。 */
function openBrowser() {
  try {
    if (isWindows) {
      // start 是 cmd 内建命令，必须经 shell；URL 由本文件固定常量生成，无注入面。
      spawn("cmd", ["/c", "start", "", URL], { stdio: "ignore", windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [URL], { stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [URL], { stdio: "ignore" }).unref();
    }
    log("OK", `已在浏览器打开 ${URL}`);
  } catch {
    log("..", `浏览器未能自动打开，请手动访问 ${URL}`);
  }
}

/** 等待 dev server 就绪（对应原脚本的 curl 轮询 + 30s 超时）。 */
async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL, { method: "GET" });
      if (res.ok) return true;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function serverAlive() {
  try {
    const res = await fetch(URL, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------- ① 原生壳前置检查 */

const cargo = findExe("cargo", [
  process.env.CARGO_HOME && join(process.env.CARGO_HOME, "bin", "cargo.exe"),
  process.env.USERPROFILE && join(process.env.USERPROFILE, ".cargo", "bin", "cargo.exe"),
  process.env.HOME && join(process.env.HOME, ".cargo", "bin", "cargo"),
]);

// Tauri CLI 入口（node_modules 内，跨平台同一份 .js，无需 .cmd wrapper）
let tauriCli = null;
try {
  tauriCli = resolveCliJs("@tauri-apps/cli");
} catch {
  tauriCli = null;
}

const nodeDir = dirname(process.execPath);
// pnpm 在 Windows 上是 %APPDATA%\npm\pnpm.cmd（PowerShell 里 Get-Command 给的是 .ps1，
// cmd.exe 不认，所以直接按目录拼）
const pnpmDir = process.env.APPDATA ? join(process.env.APPDATA, "npm") : null;

let nativeOk = Boolean(cargo) && Boolean(tauriCli) && existsSync(tauriCli);

/**
 * 构造子进程环境，显式补齐 PATH。
 *
 * 为什么必须补：`tauri dev` 会 fork 一个 shell 跑 beforeDevCommand
 * （`node ./scripts/prebuild.mjs && pnpm dev`），那个 shell 按**命令名**解析
 * `node`/`pnpm`，而 Tauri CLI 找 cargo 也是按 PATH——两者都不认我们上面
 * 的回退探测路径。实测两次失败：
 *   1) `failed to run 'cargo metadata' ... program not found`
 *   2) `'node' is not recognized as an internal or external command`
 * 所以把 node / cargo / pnpm 所在目录直接注入，不依赖父进程环境。
 */
function childEnv() {
  const env = { ...process.env };
  const sep = isWindows ? ";" : ":";
  const dirs = [cargo && dirname(cargo), nodeDir, pnpmDir].filter(Boolean);

  const current = (env.PATH || "").split(sep);
  const norm = (s) => s.replace(/[\\/]+$/, "").toLowerCase();
  const have = new Set(current.filter(Boolean).map(norm));
  const add = dirs.filter((d) => !have.has(norm(d)));

  if (add.length) env.PATH = [...add, ...current.filter(Boolean)].join(sep);
  return env;
}

/* ------------------------------------------------- ② @onethu/info-lib 构建 */

/**
 * 这是 pnpm dev 报「无法解析 @onethu/info-lib」的根因修复：
 * 该包 exports 指向 dist/，但没有 predev 钩子，dist 缺席时 Vite 直接解析失败。
 * 已构建则跳过（幂等，避免每次 dev 多花几秒）。
 */
function ensureInfoLib() {
  const entry = join(REPO, "packages", "info-lib", "dist", "index.js");
  if (existsSync(entry)) {
    log("OK", "@onethu/info-lib/dist 已存在，跳过构建");
    return true;
  }
  log("..", "@onethu/info-lib/dist 缺失，正在构建（首次约数秒）…");
  const tsc = resolveCliJs("typescript");
  const r = spawnSync(process.execPath, [tsc, "-p", join(REPO, "packages", "info-lib")], {
    cwd: REPO,
    stdio: "inherit",
  });
  if (r.status !== 0 || !existsSync(entry)) {
    log("XX", "@onethu/info-lib 构建失败——请先手动跑 pnpm --filter @onethu/info-lib build");
    return false;
  }
  log("OK", "@onethu/info-lib/dist 构建完成");
  return true;
}

/* --------------------------------------------------------------- ③ vite */

let viteProc = null;

/** 启动 vite。--strictPort 保证端口死了就是死了，不会悄悄换到 5181 让原生壳连错端口。 */
function startVite() {
  log("..", `vite 未运行，后台启动（${URL}）…`);
  const viteCli = resolveCliJs("vite");
  viteProc = spawn(process.execPath, [viteCli, "--strictPort"], {
    cwd: DESKTOP,
    stdio: "inherit", // 不用管道：保持输出直通，也避开命名管道限制
    env: childEnv(),
  });
  viteProc.on("exit", (code) => {
    if (code !== 0 && code !== null) log("!!", `vite 异常退出（code ${code}）`);
  });
}

function shutdown() {
  if (viteProc && !viteProc.killed) {
    try {
      viteProc.kill();
    } catch {
      /* 忽略 */
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});
process.on("exit", shutdown);

/* --------------------------------------------------------------- 主流程 */

async function main() {
  console.log("");
  log("OneTHU", `dev 启动器 · 平台 ${process.platform} · Node ${process.versions.node}`);
  console.log("");

  // 前置：依赖包构建（原 pnpm dev 缺这一步）
  if (!ensureInfoLib()) process.exit(1);

  // ── 原生模式：完全不碰 vite，整套交给 tauri dev ──────────────────────
  // 关键：tauri.conf.json 的 beforeDevCommand 是 `node ./scripts/prebuild.mjs && pnpm dev`，
  // 会自己起 vite。Tauri 对 beforeDevCommand 非零退出是「杀进程」语义（CLI #3907），
  // 所以这里绝不能抢先占住 :5180——否则 beforeDevCommand 因 strictPort 冲突退非零，
  // tauri dev 会跟着自杀。
  if (nativeOk) {
    console.log("");
    log("..", "启动原生桌面壳（cargo 首次编译较慢，可能数分钟，请耐心等待）…");
    log("..", "vite 由 tauri beforeDevCommand 拉起；窗口出现后前端改动即热更新。");
    console.log("");

    // `--` 之后的参数透传给 cargo runner。
    // 必须给 --bin：src-tauri/Cargo.toml 有 [[bin]] notify_probe（required-features
    // =["notify-probe"]），cargo 认为「存在多个二进制且无默认目标」，于是
    //   cargo run --no-default-features
    // 直接报 `could not determine which binary to run`。
    // 根治要在 Cargo.toml 的 [package] 加 default-run = "onethu"，
    // 但那属于改动项目文件，此处用透传绕过，零改动。
    const tauriProc = spawn(process.execPath, [tauriCli, "dev", "--", "--bin", "onethu"], {
      cwd: DESKTOP,
      stdio: "inherit",
      env: childEnv(),
    });

    // 首次 cargo 编译要几分钟，--browser 时额外先开个浏览器顶一下
    if (WANT_BROWSER) setTimeout(openBrowser, 1500);

    tauriProc.on("exit", (code) => {
      log("--", `tauri dev 退出（code ${code}）`);
      shutdown();
      process.exit(code ?? 0);
    });
    return;
  }

  // ── 降级模式：自己起 vite，浏览器热更新 ─────────────────────────────
  if (await serverAlive()) {
    log("OK", `vite 已在 ${URL} 运行`);
  } else {
    startVite();
    if (!(await waitForServer(30000))) {
      log("XX", "vite 30s 未就绪（检查上面的 vite 日志）");
      shutdown();
      process.exit(1);
    }
    log("OK", `vite :${PORT} 就绪`);
  }

  console.log("");
  log("!!", "缺少原生壳工具链，无法启动桌面窗口——已降级为浏览器热更新模式。");
  console.log("");
  console.log("   缺少：");
  if (!cargo) console.log("     - Rust / cargo（未安装）");
  if (!tauriCli) console.log("     - Tauri CLI（node_modules 内未找到 @tauri-apps/cli）");
  console.log("");
  console.log("   Windows 安装步骤（装完重开终端）：");
  console.log("     1) Rust:  winget install --id Rustlang.Rustup");
  console.log("     2) MSVC:  winget install --id Microsoft.VisualStudio.2022.BuildTools \\");
  console.log("               --override \"--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended\"");
  console.log("     3) 校验:  cargo --version && rustc --version");
  console.log("");
  console.log(`   WebView2 运行时本机已有；现在可直接用浏览器开发：${URL}`);
  console.log("   前端热更新（HMR）在浏览器里完全可用。");
  console.log("");
  if (WANT_BROWSER) openBrowser();
  log("..", "按 Ctrl+C 结束 vite");
  await new Promise(() => {}); // 挂住，交给信号处理
}

main().catch((err) => {
  log("XX", `启动器异常：${err && err.stack ? err.stack : err}`);
  shutdown();
  process.exit(1);
});
