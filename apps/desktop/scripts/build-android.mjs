#!/usr/bin/env node
/**
 * OneTHU Android APK 构建器（Windows 版）—— scripts/build-release-apk.sh 的等价实现。
 *
 * 为什么不能直接用 .sh：原脚本是 macOS 专用的，且其立意大半在 Windows 上不成立：
 *   - :39  NDK 工具链写死 `prebuilt/darwin-x86_64/bin`      -> Windows 是 windows-x86_64
 *   - :31  SDK 写死 `$HOME/Library/Android/sdk`              -> Windows 在 %LOCALAPPDATA%\Android\Sdk
 *   - :34  JDK 写死 `/opt/homebrew/opt/openjdk@17`           -> Windows 用系统 JAVA_HOME
 *   - :8-21 整段符号链接 + 内盘搬迁是为了绕 *exFAT 卷的 AppleDouble*（._drawable/._X.class）
 *           让 Gradle 误读。本仓库在 NTFS（C:/D: 均为 NTFS），这套完全不需要。
 *
 * 保留原脚本真正有价值的语义：
 *   ① 环境自检（JDK / NDK / SDK 缺了就明确报错，别让它烂在 Gradle 输出里）
 *   ② 构建前校验发布线不变量（正式包名 + 不脱敏）—— :87-106
 *   ③ zipalign + apksigner 签名——原脚本 :132-155
 *
 * 唯一绕不过的 Windows 前提：Tauri CLI 会把 Rust 产出的 .so **创建符号链接**到
 * jniLibs。这需要 SeCreateSymbolicLinkPrivilege：开启「开发者模式」后**重新登录**
 * 生效，或用管理员终端（管理员令牌自带该权限）。本脚本会先自检并给出明确指引。
 *
 * 用法：
 *   node apps/desktop/scripts/build-android.mjs            # release APK（aarch64）
 *   node apps/desktop/scripts/build-android.mjs --debug    # debug APK，跳过签名
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, ".."); // apps/desktop
const REPO = resolve(DESKTOP, "..", "..");
const TAURI_DIR = join(DESKTOP, "src-tauri");

const DEBUG = process.argv.includes("--debug");
const TARGET = "aarch64"; // 发布线只出 arm64（原脚本 :124 同）

/* 与已安装的 SDK 对齐；改版本时同步改这里 */
const SDK = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const NDK = process.env.NDK_HOME || join(SDK, "ndk", "29.0.14206865");
const JAVA_HOME = process.env.JAVA_HOME || "C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot";
const BUILD_TOOLS = join(SDK, "build-tools", "36.1.0");
const OUT_DIR = process.env.ONETHU_APK_OUT || join(process.env.USERPROFILE || ".", "Desktop", "OneTHU-builds");

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

function fail(msg) {
  log("XX", msg);
  process.exit(1);
}

/* 让子进程（tauri -> cargo -> gradle）拿到完整工具链 */
function childEnv() {
  const cargoBin = join(process.env.USERPROFILE || "", ".cargo", "bin");
  const parts = [join(JAVA_HOME, "bin"), cargoBin, join(SDK, "platform-tools"), process.env.PATH || ""];
  return {
    ...process.env,
    JAVA_HOME,
    ANDROID_HOME: SDK,
    ANDROID_SDK_ROOT: SDK,
    NDK_HOME: NDK,
    PATH: parts.filter(Boolean).join(";"),
  };
}

/* ---------------------------------------------------------- ① 环境自检 */

function preflight() {
  const missing = [];
  if (!existsSync(join(JAVA_HOME, "bin", "java.exe"))) missing.push(`JDK 17 -> 期望 ${JAVA_HOME}`);
  if (!existsSync(NDK)) missing.push(`NDK -> 期望 ${NDK}`);
  if (!existsSync(join(SDK, "platforms", "android-36"))) missing.push("Android SDK Platform 36");
  if (!existsSync(BUILD_TOOLS)) missing.push(`build-tools -> 期望 ${BUILD_TOOLS}`);
  if (!existsSync(join(TAURI_DIR, "gen", "android", "gradlew.bat"))) {
    missing.push("Android 工程未生成（跑 pnpm --filter @onethu/desktop exec tauri android init --ci）");
  }
  if (missing.length) {
    log("XX", "环境不完整：");
    for (const m of missing) console.log(`     - ${m}`);
    process.exit(1);
  }
  // JAVA_HOME 常带尾部反斜杠，basename 取最后一段会拿到空串——先剥掉
  const jdkName = JAVA_HOME.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  log("OK", `环境就绪（JDK ${jdkName}，NDK ${NDK.split(/[\\/]/).pop()}）`);
}

/**
 * 符号链接能力自检。Tauri CLI 必须把 .so 软链进 jniLibs；无权限时它会在
 * Rust 编译成功之后才失败（白等 6 分钟），所以提前拦。
 */
function checkSymlinkAbility() {
  const probe = join(process.env.TEMP || ".", `onethu-symlink-probe-${process.pid}`);
  try {
    mkdirSync(probe, { recursive: true });
    writeFileSync(join(probe, "a.txt"), "x");
    symlinkSync(join(probe, "a.txt"), join(probe, "b.txt"), "file");
    log("OK", "符号链接权限可用");
  } catch (e) {
    console.log("");
    log("XX", `当前会话无法创建符号链接（${e.code || e.message}）——Tauri 无法把 .so 放进 jniLibs。`);
    console.log("");
    console.log("   Windows 需要 SeCreateSymbolicLinkPrivilege，二选一：");
    console.log("     1) 开启「开发者模式」（设置 → 隐私和安全性 → 开发者选项）；");
    console.log("        若已开启仍失败，注销后重新登录——已登录会话不会刷新令牌");
    console.log("     2) 用**管理员身份**打开终端再跑本命令");
    console.log("");
    process.exit(1);
  } finally {
    try {
      rmSync(probe, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
}

/* ------------------------------------------- ② 发布线不变量（原脚本 :87-106） */

function checkReleaseInvariants() {
  if (DEBUG) {
    log("..", "debug 构建，跳过发布线不变量校验");
    return;
  }
  const conf = JSON.parse(readFileSync(join(TAURI_DIR, "tauri.conf.json"), "utf8"));
  const privPath = join(REPO, "packages", "core", "src", "privacy", "config.ts");
  const priv = existsSync(privPath) ? readFileSync(privPath, "utf8") : "";
  const bad = [];
  if (conf.identifier !== "app.onethu.desktop") bad.push(`identifier=${conf.identifier}（应为 app.onethu.desktop）`);
  if (conf.productName !== "OneTHU") bad.push(`productName=${conf.productName}（应为 OneTHU）`);
  if (!priv.includes("export const DESENSITIZE_ENABLED = false;")) bad.push("脱敏开关不是 false（正式版不得脱敏）");
  if (bad.length) {
    log("XX", "发布线不变量未满足，拒绝构建：");
    for (const b of bad) console.log(`     - ${b}`);
    process.exit(1);
  }
  log("OK", "发布线不变量通过（OneTHU / app.onethu.desktop / 不脱敏）");
}

/* ---------------------------------------------------------- ③ 构建 */

function build() {
  const args = ["android", "build", "--apk", "--target", TARGET];
  if (DEBUG) args.push("--debug");
  log("..", `构建 APK（首次较慢：需为 Android target 编译整套 Rust）…`);
  const r = spawnSync(
    process.execPath,
    [join(DESKTOP, "node_modules", "@tauri-apps", "cli", "tauri.js"), ...args],
    { cwd: DESKTOP, stdio: "inherit", env: childEnv() },
  );
  if (r.status !== 0) fail(`构建失败（exit ${r.status}）——完整输出见上方`);
}

/* ------------------------------------------- ④ zipalign + 签名（原脚本 :132-155） */

function findApk(dir, pred) {
  if (!existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur)) {
      const p = join(cur, e);
      if (statSync(p).isDirectory()) stack.push(p);
      else if (e.endsWith(".apk") && pred(e)) return p;
    }
  }
  return null;
}

function packageApk() {
  const apkRoot = join(TAURI_DIR, "gen", "android", "app", "build", "outputs", "apk");
  // 未签名产物优先（release 未配签名时 Tauri 产出 unsigned）
  const src =
    findApk(apkRoot, (n) => /release/.test(n) && !/unsigned|aligned/.test(n)) ||
    findApk(apkRoot, (n) => /unsigned/.test(n));
  if (!src) fail(`找不到 APK 产物（${apkRoot}）`);
  log("OK", `产物：${src}`);

  if (DEBUG) {
    log("..", "debug 构建，跳过 zipalign/签名（已可直接 adb install）");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const version = JSON.parse(readFileSync(join(TAURI_DIR, "tauri.conf.json"), "utf8")).version;
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "");
  const out = join(OUT_DIR, `OneTHU-${version}-${stamp}.apk`);

  const zipalign = join(BUILD_TOOLS, "zipalign.exe");
  const apksigner = join(BUILD_TOOLS, "apksigner.bat");
  const run = (exe, argv) => {
    // Windows 上 .bat/.cmd 不能直接 spawn（Node 会以 EINVAL/status null 失败），
    // 必须经 cmd.exe 执行。zipalign 是 .exe 可直跑。
    const isBatch = /\.(bat|cmd)$/i.test(exe);
    const r = isBatch
      ? spawnSync("cmd", ["/c", exe, ...argv], { stdio: "inherit", env: childEnv() })
      : spawnSync(exe, argv, { stdio: "inherit", env: childEnv() });
    if (r.status !== 0) fail(`${exe} 失败（exit ${r.status}）`);
  };

  run(zipalign, ["-p", "-f", "4", src, out]);

  // 默认 debug keystore，与线上 Release 同证书（原脚本 :143-149 同策略）
  const ks = process.env.ONETHU_KEYSTORE || join(process.env.USERPROFILE || "", ".android", "debug.keystore");
  if (!existsSync(ks)) {
    log("!!", `未找到 keystore（${ks}）——产物未签名，已停在 zipalign 结果`);
    log("OK", `未签名产物：${out}`);
    return;
  }
  run(apksigner, [
    "sign",
    "--ks", ks,
    "--ks-key-alias", process.env.ONETHU_KEY_ALIAS || "androiddebugkey",
    "--ks-pass", `pass:${process.env.ONETHU_KS_PASS || "android"}`,
    "--key-pass", `pass:${process.env.ONETHU_KEY_PASS || "android"}`,
    out,
  ]);
  log("OK", `已签名：${out}`);
  console.log(`     安装：adb install -r "${out}"`);
}

/* ---------------------------------------------------------- 主流程 */

console.log("");
log("OneTHU", `Android APK 构建 · ${DEBUG ? "debug" : "release"} · ${TARGET}`);
console.log("");
preflight();
checkSymlinkAbility();
checkReleaseInvariants();
console.log("");
build();
console.log("");
packageApk();
console.log("");
log("OK", "完成");
