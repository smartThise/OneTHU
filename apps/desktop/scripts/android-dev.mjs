#!/usr/bin/env node
/**
 * OneTHU Android 调试启动器（供 .vscode/launch.json 调用）。
 *
 * 为什么不直接调 `tauri android dev`：它需要三件在 Windows 上并不默认成立的事，
 * 放进一个脚本里比塞进 launch.json 的 args/env 更可靠：
 *   ① 工具链环境变量（ANDROID_HOME / NDK_HOME / JAVA_HOME、cargo 与 platform-tools 的 PATH）
 *   ② Rust target 必须已安装（aarch64-linux-android 等），否则 cargo 报缺 std
 *   ③ 需要一个**在线设备**——没有就自动起 AVD（launch.json 的 preLaunchTask 有超时，
 *      不适合跑长期存活的模拟器进程）
 *
 * 与 build-android.mjs 的分工：那个面向"出可分发 APK"，这个面向"调试运行"。
 *
 * 用法：
 *   node apps/desktop/scripts/android-dev.mjs                # 自动选设备/架构
 *   node apps/desktop/scripts/android-dev.mjs --target arm64 # 强制真机架构
 *   node apps/desktop/scripts/android-dev.mjs --no-emulator  # 无设备时不自动起模拟器
 *   node apps/desktop/scripts/android-dev.mjs --release
 *   node apps/desktop/scripts/android-dev.mjs --dev-install  # 只装一份 dev 模式包（走 devUrl）
 *   node apps/desktop/scripts/android-dev.mjs --attach       # 只启动：不重编不重装，前端 HMR
 *
 * ⚠️ 「前端 HMR」到底靠什么，别被 `tauri android build` 骗了：
 *   `tauri android build --apk --debug` 编出来的是 **prod 模式**包——Tauri 的 dev/prod
 *   由 cargo feature `custom-protocol` 决定（tauri/build.rs: dev = !custom_protocol），
 *   而 `android build` 会带上它，于是 devUrl 被忽略、前端 dist 直接嵌进 libonethu_lib.so
 *   （实测：设备上 base.apk 里 grep -c 'assets/index-' = 5）。这种包怎么启动都不会连
 *   vite，改前端必须重编重装。
 *   要让前端走 127.0.0.1:5180，设备上装的必须是 `tauri android dev` 编出来的 dev 模式包
 *   （--dev-install 就是干这个的）。装好之后，只改前端时用 --attach 秒级启动即可。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, ".."); // apps/desktop
const REPO = resolve(DESKTOP, "..", "..");
const TAURI_DIR = join(DESKTOP, "src-tauri");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const NO_EMULATOR = flag("--no-emulator");
const FORCE_EMULATOR = flag("--emulator");
const RELEASE = flag("--release");
// 真机走不了 `tauri android dev`（见 installAndLaunch 的说明），需显式流程：
// 构建 debug APK -> 签名 -> adb install -> am start。--explicit 可强制启用。
const EXPLICIT = flag("--explicit");
// 只启动：不重编 Rust、不重装 APK，接上 vite + adb reverse 后把已装的包拉到前台。
// 前提是设备上装的是 dev 模式包（见文件头），装 prod 模式的包时这里会直接拦下。
const ATTACH = flag("--attach");
// 只装一份 dev 模式包：交给 `tauri android dev` 编 + 装（它才用 devUrl）。
// 前端产物不再烧进 so，之后改前端就能靠 vite HMR 即时生效。
const DEV_INSTALL = flag("--dev-install");
const FORCED_DEVICE = opt("--device", "");
const ABI_OVERRIDE = opt("--abi", "");
const AVD_NAME = opt("--avd", "OneTHU_API36");

const PORT = 5180;
const APP_ID = "app.onethu.desktop";
const BUILD_TOOLS_VERSION = "36.1.0";

/* 与已安装版本对齐；换版本时同步改这里（build-android.mjs 同源） */
const SDK = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || "", "Android", "Sdk");
const NDK = process.env.NDK_HOME || join(SDK, "ndk", "29.0.14206865");
const JAVA_HOME = process.env.JAVA_HOME || "C:\\Program Files\\Microsoft\\jdk-17.0.20.101-hotspot";

const ADB = join(SDK, "platform-tools", "adb.exe");
const EMULATOR = join(SDK, "emulator", "emulator.exe");

const log = (tag, msg) => console.log(`[${tag}] ${msg}`);

/** 前端 dev server 是否已就绪（对应 dev-launch.mjs 的同名探测）。 */
async function isServerUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

function childEnv() {
  const sep = ";";
  const dirs = [
    join(JAVA_HOME, "bin"),
    join(process.env.USERPROFILE || "", ".cargo", "bin"),
    join(SDK, "platform-tools"),
    join(SDK, "emulator"),
  ].filter(Boolean);
  return {
    ...process.env,
    JAVA_HOME,
    ANDROID_HOME: SDK,
    ANDROID_SDK_ROOT: SDK,
    NDK_HOME: NDK,
    PATH: [...dirs, process.env.PATH || ""].join(sep),
  };
}

/* --------------------------------------------------- ① 工具链自检 */

function preflight(light = false) {
  const missing = [];
  // 只启动（--attach）不碰 Rust/Gradle，所以 JDK、NDK、生成的 Android 工程都不必在
  if (!existsSync(ADB)) missing.push("platform-tools/adb");
  if (!light) {
    if (!existsSync(join(JAVA_HOME, "bin", "java.exe"))) missing.push(`JDK 17（${JAVA_HOME}）`);
    if (!existsSync(NDK)) missing.push(`NDK（${NDK}）`);
    if (!existsSync(join(TAURI_DIR, "gen", "android", "gradlew.bat"))) {
      missing.push("Android 工程未生成（先跑 tauri android init --ci）");
    }
  }
  if (missing.length) {
    log("XX", "环境不完整：");
    for (const m of missing) console.log(`     - ${m}`);
    process.exit(1);
  }
}

/* --------------------------------------------------- ② 设备 */

function listDevices() {
  const r = spawnSync(ADB, ["devices"], { encoding: "utf8", env: childEnv() });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("*"))
    .map((l) => {
      const [serial, state] = l.split(/\s+/);
      return { serial, state, isEmulator: serial.startsWith("emulator-") };
    });
}

let emulatorProc = null;

function bootEmulator() {
  if (NO_EMULATOR) {
    log("XX", "没有在线设备，且指定了 --no-emulator。请先连真机或起模拟器。");
    process.exit(1);
  }
  if (!existsSync(EMULATOR)) {
    log("XX", `未安装模拟器（${EMULATOR}）。可跑：sdkmanager "emulator" "system-images;android-36;google_apis_playstore;x86_64"`);
    process.exit(1);
  }
  log("..", `没有在线设备，后台启动模拟器 ${AVD_NAME}（有快照会较快）…`);

  // 先自查能不能写 .android：模拟器要在这里建 AVD 锁与 feature-flags 文件。
  // 写不了它会陷入重试循环把日志刷爆（实测 1.3GB）后才死，早拦下来省事。
  const androidHome = join(process.env.USERPROFILE || "", ".android");
  try {
    const probe = join(androidHome, ".onethu-write-probe");
    writeFileSync(probe, "x");
    unlinkSync(probe);
  } catch {
    log("XX", `无法写入 ${androidHome} —— 模拟器无法创建 AVD 锁文件，必然启动失败。`);
    console.log("");
    console.log("   检查该目录的权限，或确认没有安全软件/沙箱拦截。");
    console.log(`   也可手动验证：emulator -avd ${AVD_NAME} -gpu host`);
    console.log("");
    process.exit(1);
  }

  // 日志放 LOCALAPPDATA\Temp，不用 TEMP——某些受限/沙箱环境会把 TEMP 重定向到
  // 隔离目录，而模拟器在其中写不了 .android，会陷入重试把日志刷爆（实测 1.3GB）。
  const baseDir = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Temp")
    : process.env.TEMP || ".";
  const emuLog = join(baseDir, "onethu-emulator.log");

  let out = null;
  try {
    out = openSync(emuLog, "a");
    log("..", `模拟器日志：${emuLog}`);
  } catch {
    /* 打不开就不重定向 */
  }

  // 不加 -no-snapshot-load：默认走 default_boot 快照（冷启动 90s+，快照几秒）。
  emulatorProc = spawn(EMULATOR, ["-avd", AVD_NAME, "-gpu", "host"], {
    detached: true,
    stdio: out === null ? "ignore" : ["ignore", out, out],
    env: childEnv(),
  });
  emulatorProc.on("error", (e) => log("!!", `模拟器启动失败：${e.message}`));
  emulatorProc.unref();
}

async function waitForDevice(timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  let lastLog = 0;
  let exited = false;
  if (emulatorProc) emulatorProc.once("exit", () => (exited = true));

  while (Date.now() < deadline) {
    // 模拟器提前退出就别干等——直接报错更省时间
    if (exited) {
      log("XX", "模拟器进程已退出，未能提供设备。");
      log("..", "常见原因：AVD 被占用 / 显卡驱动问题 / 无权限写 %USERPROFILE%\\.android。");
      log("..", "可手动起模拟器看报错：emulator -avd " + AVD_NAME + " -gpu host");
      process.exit(1);
    }
    const dev = listDevices().find((d) => d.state === "device");
    if (dev) {
      const r = spawnSync(ADB, ["-s", dev.serial, "shell", "getprop", "sys.boot_completed"], {
        encoding: "utf8",
        env: childEnv(),
      });
      if ((r.stdout || "").trim() === "1") return dev;
    }
    if (Date.now() - lastLog > 15000) {
      log("..", "等待设备就绪…");
      lastLog = Date.now();
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  log("XX", "等待设备超时。可手动起模拟器后重试。");
  process.exit(1);
}

/* --------------------------------------------------- ③ Rust target */

/**
 * 该设备对应的架构名（arm64 / x86_64 …）。
 * 仅用于「确保 Rust target 已安装」与日志展示；实际编译目标由 Tauri 决定。
 */
function rustTargetFor(device) {
  // 模拟器是 x86_64；真机几乎都是 arm64（可用 --abi 覆盖）
  return ABI_OVERRIDE || (device.isEmulator ? "x86_64" : "arm64");
}

function ensureRustTarget(target) {
  const triple = {
    arm64: "aarch64-linux-android",
    armv7: "armv7-linux-androideabi",
    x86: "i686-linux-android",
    x86_64: "x86_64-linux-android",
  }[target];
  if (!triple) {
    log("XX", `未知 target：${target}`);
    process.exit(1);
  }
  const rustup = join(process.env.USERPROFILE || "", ".cargo", "bin", "rustup.exe");
  const r = spawnSync(rustup, ["target", "list", "--installed"], { encoding: "utf8" });
  if (r.status === 0 && (r.stdout || "").includes(triple)) return triple;
  log("..", `安装 Rust target ${triple} …`);
  const add = spawnSync(rustup, ["target", "add", triple], { stdio: "inherit" });
  if (add.status !== 0) {
    log("XX", `安装 ${triple} 失败`);
    process.exit(1);
  }
  return triple;
}

/* --------------------------------------------------- 主流程 */

/**
 * 确保前端开发服务器在 :5180 运行；已在跑则复用。
 * 返回 { proc } —— 由我们拉起时带 proc，退出时要一起收掉。
 */
async function ensureVite() {
  if (await isServerUp()) {
    log("OK", `前端 dev server 已在 :${PORT} 运行`);
    return { proc: null };
  }
  log("..", `启动前端 dev server（:${PORT}）…`);
  const viteCli = join(DESKTOP, "node_modules", "vite", "bin", "vite.js");
  const proc = spawn(process.execPath, [viteCli, "--strictPort"], {
    cwd: DESKTOP,
    stdio: ["ignore", "ignore", "ignore"], // 不占用终端；失败靠下面的端口探测暴露
    env: childEnv(),
  });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (await isServerUp()) return { proc };
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  log("XX", `前端 dev server 未能在 60s 内就绪（:${PORT}）`);
  process.exit(1);
}

function adb(args, { inherit = false } = {}) {
  return spawnSync(ADB, args, {
    encoding: inherit ? undefined : "utf8",
    stdio: inherit ? "inherit" : undefined,
    env: childEnv(),
  });
}

/**
 * 显式安装 + 启动（真机路径）。
 *
 * 为什么不用 `tauri android dev`：实测在 Windows 上它认不出 USB 真机，报
 *   Error Could not find an Android Emulator matching {t}
 * 然后回退去 "Opening Android Studio"（本机未装），根本走不到安装。
 * 这是 Tauri 已知问题（tauri-apps/tauri#11137：real devices 开箱不可用）。
 * 所以这里自己走完：adb reverse → 签名 → install → am start。
 */
function installAndLaunch(device, target) {
  const serial = device.serial;
  const apkRoot = join(TAURI_DIR, "gen", "android", "app", "build", "outputs", "apk", "universal", "debug");
  const src = join(apkRoot, "app-universal-debug.apk");
  if (!existsSync(src)) {
    log("XX", `未找到 debug APK：${src}`);
    process.exit(1);
  }

  // 端口反向映射：应用内 devUrl 是 127.0.0.1:5180，把设备的 5180 指回宿主 vite。
  // 这是真机能用 HMR 的关键，`tauri android dev` 本来会做，我们自己做。
  const rev = adb(["-s", serial, "reverse", `tcp:${PORT}`, `tcp:${PORT}`]);
  if (rev.status !== 0) {
    log("XX", `adb reverse 失败：${(rev.stderr || "").trim()}`);
    process.exit(1);
  }
  log("OK", `adb reverse tcp:${PORT} → 宿主（应用可访问 dev server）`);

  // debug APK 是未签名的，未签名包在真机上会弹确认且易被拒（实测
  // INSTALL_FAILED_ABORTED: User rejected permissions），所以用 debug keystore 签一下。
  const signed = join(process.env.LOCALAPPDATA || ".", "Temp", "onethu-debug-signed.apk");
  const bt = join(SDK, "build-tools", BUILD_TOOLS_VERSION);
  const zipalign = join(bt, "zipalign.exe");
  const apksigner = join(bt, "apksigner.bat");
  const ks = process.env.ONETHU_KEYSTORE || join(process.env.USERPROFILE || "", ".android", "debug.keystore");

  log("..", "对齐 + 签名 debug APK …");
  let r = spawnSync(zipalign, ["-p", "-f", "4", src, signed], { stdio: "inherit", env: childEnv() });
  if (r.status !== 0) {
    log("XX", "zipalign 失败");
    process.exit(1);
  }
  r = spawnSync("cmd", ["/c", apksigner, "sign",
    "--ks", ks,
    "--ks-key-alias", process.env.ONETHU_KEY_ALIAS || "androiddebugkey",
    "--ks-pass", `pass:${process.env.ONETHU_KS_PASS || "android"}`,
    "--key-pass", `pass:${process.env.ONETHU_KEY_PASS || "android"}`,
    signed], { stdio: "inherit", env: childEnv() });
  if (r.status !== 0) {
    log("XX", `apksigner 失败（keystore：${ks}）`);
    process.exit(1);
  }

  log("..", "安装到设备 …");
  r = adb(["-s", serial, "install", "-r", signed], { inherit: true });
  if (r.status !== 0) {
    log("XX", "安装失败。若是 INSTALL_FAILED_UPDATE_INCOMPATIBLE，先 adb uninstall app.onethu.desktop");
    process.exit(1);
  }

  log("..", "启动应用 …");
  r = adb(["-s", serial, "shell", "am", "start", "-n", `${APP_ID}/.MainActivity`]);
  if (r.status !== 0) {
    // 兜底：部分设备上 MainActivity 不在默认 namespace，用 monkey 走 LAUNCHER
    adb(["-s", serial, "shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1"]);
  }
  log("OK", `已在 ${serial} 上启动 ${APP_ID}`);
}

/* --------------------------------------------------- dev 模式 / 只启动 */

/**
 * 设备上那份包装的是 dev 模式还是 prod 模式。
 *
 * 判据：Tauri 只在 prod 模式（cargo feature `custom-protocol`）下把前端产物嵌进
 * libonethu_lib.so，而资源键名是明文（assets/index-xxxx.js），且 .so 在 APK 里不压缩，
 * 所以直接在设备上 grep 那个 apk 就能定性：
 *   命中  = prod（前端从包里出，devUrl 被忽略，怎么启动都不会热更新）
 *   不命中 = dev（前端从 devUrl 取，也就是 vite）
 */
function installedAppMode(serial) {
  const p = adb(["-s", serial, "shell", "pm", "path", APP_ID]);
  const line = (p.stdout || "").split(/\r?\n/).find((l) => l.startsWith("package:"));
  if (p.status !== 0 || !line) return { installed: false, prod: false, apk: "" };
  const apk = line.slice("package:".length).trim();
  const g = adb(["-s", serial, "shell", `grep -c 'assets/index-' '${apk}'`]);
  // 注意：`grep -c` 命中 0 次时退出码本来就是 1（不是出错），所以以 stdout 能否解析成
  // 数字为准——这恰恰是最常见的"确实是 dev 模式"。
  const n = Number.parseInt((g.stdout || "").trim(), 10);
  if (Number.isFinite(n)) return { installed: true, prod: n > 0, apk };
  return { installed: true, prod: null, apk }; // 查不了就不乱判
}

/**
 * `tauri android dev` 认的是**设备名**，不是 adb 序列号 —— 这就是 tauri#11137 在本机的
 * 真实成因：`android dev 10AE7N1122000XL` 会打一行
 *     Error Could not find an Android Emulator matching {t}
 * 然后把 device 置空、回退去 "Opening Android Studio"（tauri-cli
 * mobile/android/dev.rs 里 device_prompt 失败只 log::error 不 abort，随后走
 * open_and_wait）。实测把序列号换成型号 V2324HA 就立刻匹配上了。
 *   真机  -> ro.product.model
 *   模拟器 -> AVD 名（`adb -s emulator-5554 emu avd name`）
 */
function cliDeviceName(device) {
  if (device.isEmulator) {
    const r = spawnSync(ADB, ["-s", device.serial, "emu", "avd", "name"], { encoding: "utf8", env: childEnv() });
    const n = (r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.replace(/\r/g, "").trim())
      .find((s) => s && s !== "OK");
    if (n) return n;
  }
  const r = spawnSync(ADB, ["-s", device.serial, "shell", "getprop", "ro.product.model"], {
    encoding: "utf8",
    env: childEnv(),
  });
  const n = (r.stdout || "").trim();
  if (!n) {
    log("XX", `读不到 ${device.serial} 的设备名（ro.product.model），tauri android dev 无法定位它。`);
    process.exit(1);
  }
  return n;
}

/**
 * 交给 `tauri android dev`：它是唯一会用 devUrl 的路径（编 + 装 + 起前端 + Rust 热重载）。
 *
 * 注意不要给它传 --target：Tauri 自己会把设备架构映射成正确的 Rust 三元组，而经 `--`
 * 透传的 --target 会被**追加**到它已算好的后面，得到
 *   cargo build --target aarch64-linux-android ... --target arm64 --lib
 * -> error: could not find specification for target "arm64"（实测踩中）。
 *
 * --host 127.0.0.1 是必需的：Windows 上它默认拿**公网地址**（实测 59.66.19.197:5180）
 * 当 devUrl 并在那里等待，而 vite 绑在 127.0.0.1:5180，两边对不上会永久卡在
 *   "Waiting for your frontend dev server to start on http://<公网IP>:5180/"。
 * 配合 adb reverse，设备侧的 127.0.0.1:5180 就是宿主上的 vite。
 */
function runTauriAndroidDev(device) {
  const cliJs = join(DESKTOP, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const name = cliDeviceName(device);
  log("..", `tauri android dev 目标：${name}（adb 序列号 ${device.serial}）`);
  const args = [cliJs, "android", "dev", name, "--host", "127.0.0.1"];
  if (RELEASE) args.push("--release");

  const p = spawn(process.execPath, args, { cwd: DESKTOP, stdio: "inherit", env: childEnv() });
  const shutdown = () => {
    try {
      p.kill();
    } catch {
      /* 忽略 */
    }
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(130);
  });
  process.on("exit", shutdown);
  p.on("exit", (code) => {
    log("--", `tauri android dev 退出（code ${code}）`);
    process.exit(code ?? 0);
  });
}

/**
 * 装一份 dev 模式包（前端从 devUrl 取，不再烧进 so）。
 * 之后只改前端时就不必再走这里——用 --attach 秒级启动即可。
 */
async function devInstall(device) {
  // `tauri android dev` 会自己跑 beforeDevCommand 起 vite；已经有 server 占着 5180 时
  // 它起不来会直接以 "beforeDevCommand terminated with a non-zero status code" 收场，
  // 报错信息完全指不到端口，所以在这里先说清楚。
  if (await isServerUp()) {
    log("XX", `端口 ${PORT} 已经有 dev server 在跑，tauri android dev 会再起一个并冲突。`);
    log("..", "先结束那个进程（或改用 --attach 复用它），再跑本命令。");
    process.exit(1);
  }
  log("..", "dev 模式安装：tauri android dev（编 + 装 + 起前端；改 Rust 会自动重载）");
  runTauriAndroidDev(device);
}

/** 常驻不退出；Ctrl+C 时一并收掉由本启动器拉起的 vite */
function holdVite(vite) {
  const stop = () => {
    if (vite.proc) {
      try {
        vite.proc.kill();
      } catch {
        /* 忽略 */
      }
    }
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("exit", stop);
  return new Promise(() => {});
}

/**
 * 只启动：不重编 Rust、不重装 APK。
 *   1) 确保 vite dev server 在 :5180（已在跑就直接复用）
 *   2) adb reverse tcp:5180 → 宿主（应用里的 devUrl 就是 127.0.0.1:5180）
 *   3) force-stop + am start，让它重新从 vite 拉一次页面
 * 改前端由 vite HMR 即时生效，整个过程几秒。
 */
async function attachToDevice(device) {
  const serial = device.serial;

  const mode = installedAppMode(serial);
  if (!mode.installed) {
    log("XX", `${serial} 上没装 ${APP_ID}。`);
    log("..", "先跑「OneTHU Android (真机 USB 调试)」把包装上，再回来用这个配置。");
    process.exit(1);
  }
  if (mode.prod === true) {
    log("XX", "设备上装的是 prod 模式包：前端 dist 已烧进 libonethu_lib.so，不连 devUrl。");
    console.log("");
    console.log("   这种包无论怎么启动都不会热更新（改前端只能重编重装）。");
    console.log("   先装一次 dev 模式包，之后本配置就能秒级启动 + 前端 HMR：");
    console.log("");
    console.log(`     node apps/desktop/scripts/android-dev.mjs --device ${serial} --dev-install`);
    console.log("");
    console.log(`   （或直接在 launch.json 里加一条 args: ["--dev-install", "--device", "${serial}"]）`);
    console.log("");
    process.exit(1);
  }
  if (mode.prod === null) {
    log("!!", "没能在设备上核对包的类型（grep 不可用？），继续执行，但请留意热更新是否真的生效。");
  }

  const vite = await ensureVite();

  // 端口反向映射：应用内 devUrl 是 127.0.0.1:5180，把设备的 5180 指回宿主 vite。
  const rev = adb(["-s", serial, "reverse", `tcp:${PORT}`, `tcp:${PORT}`]);
  if (rev.status !== 0) {
    log("XX", `adb reverse 失败：${(rev.stderr || "").trim()}`);
    process.exit(1);
  }
  log("OK", `adb reverse tcp:${PORT} → 宿主（应用可访问 dev server）`);

  // 先 stop 再 start：上一次可能是没接 reverse 时启动的（页面停在加载失败），
  // 也可能在跑旧代码。重启才能保证是从当前 vite 重新拉的。
  adb(["-s", serial, "shell", "am", "force-stop", APP_ID]);
  const r = adb(["-s", serial, "shell", "am", "start", "-n", `${APP_ID}/.MainActivity`]);
  if (r.status !== 0) {
    // 兜底：部分设备上 MainActivity 不在默认 namespace，用 monkey 走 LAUNCHER
    adb(["-s", serial, "shell", "monkey", "-p", APP_ID, "-c", "android.intent.category.LAUNCHER", "1"]);
  }
  log("OK", `已在 ${serial} 上启动 ${APP_ID}（未重编、未重装）`);

  console.log("");
  log("OK", "前端改动即时生效（vite HMR，应用开着就不用再启动）；改 Rust 需重跑 --dev-install。");
  log("..", "按 Ctrl+C 结束（会一并停掉由本启动器拉起的前端 dev server）");
  await holdVite(vite);
}

async function main() {
  const modeLabel = ATTACH ? "只启动（前端 HMR）" : DEV_INSTALL ? "dev 模式安装" : RELEASE ? "release" : "debug";
  console.log("");
  log("OneTHU", `Android 调试启动 · ${modeLabel}`);
  console.log("");

  preflight(ATTACH);
  log("OK", ATTACH ? "只启动模式：不碰 Rust / Gradle" : "工具链就绪");

  // 设备选择（确定性优先，多设备同时在线时不会随机挑）：
  //   --device <serial>  显式指定，最优先
  //   --emulator         只用模拟器（忽略真机）
  //   默认               真机优先，其次模拟器 —— 手机插着时不会误跑到模拟器上
  let device;
  const online = listDevices().filter((d) => d.state === "device");

  if (FORCED_DEVICE) {
    device = online.find((d) => d.serial === FORCED_DEVICE);
    if (!device) {
      const seen = online.map((d) => `${d.serial}(${d.isEmulator ? "模拟器" : "真机"})`).join(", ") || "无";
      log("XX", `指定的设备 ${FORCED_DEVICE} 不在线。当前在线：${seen}`);
      log("..", "用 `adb devices` 确认序列号；真机需在手机上允许 USB 调试授权。");
      process.exit(1);
    }
  } else if (FORCE_EMULATOR) {
    device = online.find((d) => d.isEmulator);
  } else {
    device = online.find((d) => !d.isEmulator) || online.find((d) => d.isEmulator);
  }

  if (device) {
    log("OK", `目标设备：${device.serial}（${device.isEmulator ? "模拟器" : "真机"}）`);
  } else {
    bootEmulator();
    device = await waitForDevice();
    log("OK", `目标设备：${device.serial}（${device.isEmulator ? "模拟器" : "真机"}）`);
  }

  // ── 只启动：不重编、不重装 ────────────────────────────────────────
  if (ATTACH) {
    await attachToDevice(device);
    return;
  }

  // ── 只装 dev 模式包：交给 `tauri android dev`（它才用 devUrl）──────
  if (DEV_INSTALL) {
    await devInstall(device);
    return;
  }

  // 只说清会编到哪个架构，不替 Tauri 决定目标——理由见 runTauriAndroidDev 的注释。
  const target = rustTargetFor(device);
  ensureRustTarget(target);
  log("OK", `构建架构：${target}（由 Tauri 映射为 Rust 三元组）`);

  const cliJs = join(DESKTOP, "node_modules", "@tauri-apps", "cli", "tauri.js");

  // ── 真机：走显式流程 ───────────────────────────────────────────────
  // `tauri android dev` 在 Windows 上认不出 USB 真机（报
  // "Could not find an Android Emulator matching {t}" 并回退去开 Android Studio，
  // 见 tauri-apps/tauri#11137），所以真机不用它。
  //
  // ⚠️ 但 `tauri android build` 编出来的是 **prod 模式**包（前端 dist 烧进 so、
  // devUrl 被忽略），所以这条路 **没有前端热更新**——改前端必须整条重跑。
  // 要热更新就用 --dev-install（见文件头）。
  if (EXPLICIT || !device.isEmulator) {
    console.log("");
    log("..", "真机模式：构建 debug APK → 签名 → 安装 → 启动");
    log("!!", "注意：这是 prod 模式包（前端已烧进 so），没有前端热更新。");
    log("..", "要前端热更新：先 `--dev-install` 装一次 dev 模式包，之后用 `--attach`。");
    console.log("");

    const vite = await ensureVite();

    const buildArgs = [cliJs, "android", "build", "--apk", "--debug", "--target", target === "arm64" ? "aarch64" : target];
    const b = spawnSync(process.execPath, buildArgs, { cwd: DESKTOP, stdio: "inherit", env: childEnv() });
    if (b.status !== 0) {
      if (vite.proc) vite.proc.kill();
      process.exit(b.status ?? 1);
    }

    installAndLaunch(device, target);

    console.log("");
    log("OK", "应用已启动（prod 模式包，前端改动需重编重装）。");
    log("..", "按 Ctrl+C 结束（会一并停掉由本启动器拉起的前端 dev server）");
    await holdVite(vite);
    return;
  }

  // ── 模拟器：沿用 `tauri android dev` ─────────────────────────────
  console.log("");
  log("..", "启动 tauri android dev（dev 模式：前端 HMR + Rust 热重载；首次编译较慢）…");
  console.log("");
  runTauriAndroidDev(device);
}

main().catch((e) => {
  log("XX", `启动器异常：${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
