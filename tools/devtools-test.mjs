#!/usr/bin/env node
/**
 * dev 版独立构建的守卫（node tools/devtools-test.mjs，无依赖）。
 *
 * 守三件事：
 *   1. dev 能力只在开发者构建里加载：正式版 __ONETHU_DEV__ 折叠为 false，动态 import 被删除
 *   2. 正式版构建入口不设开关：设了等于把调试面板发出去
 *   3. dev 相关文件不含机器专属路径：只允许由仓库根与 $HOME 推导
 *
 * 退出码：有失败 1，全通过 0。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0;
let fail = 0;
const ok = (cond, name) => {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name);
  }
};
const has = (text, needle, name) => ok(text.includes(needle), name);
const lacks = (text, needle, name) => ok(!text.includes(needle), name);

const VITE = "apps/desktop/vite.config.ts";
const LAYOUT = "apps/desktop/src/components/Layout.tsx";
const MAIN = "apps/desktop/src/main.tsx";
const SETTINGS = "apps/desktop/src/pages/Settings.tsx";
const PANEL = "apps/desktop/src/components/DevPanel.tsx";
const DEVLOG = "apps/desktop/src/lib/devlog.ts";
const BUILDINFO = "apps/desktop/src/lib/buildinfo.ts";
const GLOBALS = "apps/desktop/src/globals.d.ts";
const BUILD_DEV = "apps/desktop/scripts/build-dev.mjs";
const BUILD_APK = "apps/desktop/scripts/build-dev-apk.sh";
const RELEASE_APK = "apps/desktop/scripts/build-release-apk.sh";
const PATCHER = "tools/patch-android-dev.py";
const PKG = "apps/desktop/package.json";
const DOC = "docs/dev-build.md";
const DOC_INDEX = "docs/README.md";
const CI = ".github/workflows/release.yml";

console.log("dev 版独立构建：");

// ---------- 0. 文件齐备 ----------
for (const f of [VITE, LAYOUT, MAIN, SETTINGS, PANEL, DEVLOG, BUILDINFO, GLOBALS, BUILD_DEV, BUILD_APK, PATCHER, PKG, DOC]) {
  ok(exists(f), "存在 " + f);
}

// ---------- 1. 构建期开关 ----------
const vite = read(VITE);
has(vite, 'process.env.ONETHU_DEV === "1"', "开关只认 ONETHU_DEV=1");
has(vite, "__ONETHU_DEV__:", "注入 __ONETHU_DEV__");
has(vite, "__ONETHU_COMMIT__:", "注入 __ONETHU_COMMIT__");
has(vite, "__ONETHU_BUILD_TIME__:", "注入 __ONETHU_BUILD_TIME__");
has(vite, "git rev-parse --short HEAD", "commit 取自 git rev-parse");
has(vite, 'return "unknown"', "无 git 时退化为 unknown");
has(read(GLOBALS), "__ONETHU_DEV__: boolean", "globals.d.ts 声明 __ONETHU_DEV__");
has(read(BUILDINFO), "__ONETHU_DEV__", "buildinfo 透出 dev 标记");

// ---------- 2. 加载门控 ----------
const layout = read(LAYOUT);
has(layout, "const DevPanel = __ONETHU_DEV__ ? lazy(", "Layout 用 __ONETHU_DEV__ 门控 DevPanel");
has(layout, 'import("./DevPanel.js")', "Layout 用动态 import（可被静态删除）");
lacks(layout, 'from "./DevPanel', "Layout 不得静态 import DevPanel");
has(layout, "<Suspense", "Layout 用 Suspense 包裹");
const main = read(MAIN);
has(main, "if (__ONETHU_DEV__)", "main.tsx 条件安装日志桥");
has(main, 'import("./lib/devlog.js")', "main.tsx 动态 import 日志桥");
const panel = read(PANEL);
has(panel, "export default", "DevPanel 默认导出（配合 lazy）");
has(panel, "BUILD_COMMIT", "徽标显示编译时 commit");
has(panel, "dev · ", "徽标文案 dev · <commit>");
has(panel, '"debug_log_export"', "面板可导出运行日志");
has(panel, 'position: "fixed"', "徽标固定在窗口角落");
lacks(panel, '.css"', "面板样式内联，不引样式表");
has(read(SETTINGS), "{__ONETHU_DEV__ ? <DebugLogRow /> : null}", "设置页运行日志行 dev-only");

// ---------- 3. 日志桥有界 ----------
const devlog = read(DEVLOG);
for (const [c, name] of [["MAX_ENTRIES", "环形缓冲条数上限"], ["MAX_LINE", "单行截断"], ["MAX_PENDING", "待发队列上限"], ["FLUSH_MS", "批量间隔"], ["MAX_PER_FLUSH", "单次转发上限"], ["MAX_FAILURES", "失败熔断阈值"]]) {
  has(devlog, c, "devlog 有 " + name + "（" + c + "）");
}
has(devlog, '"log_debug"', "devlog 转发到 Rust log_debug");
has(devlog, "installDevLogBridge", "devlog 导出安装函数");

// ---------- 4. 正式版入口不设开关 ----------
const pkg = read(PKG);
has(pkg, '"build:dev": "node scripts/build-dev.mjs"', "package.json 有 build:dev");
has(pkg, '"tauri:build:dev"', "package.json 有 tauri:build:dev");
has(pkg, '"android:dev"', "package.json 有 android:dev");
lacks(pkg, "ONETHU_DEV=1", "package.json 不内联开关（跨平台交给 build-dev.mjs）");
const buildDev = read(BUILD_DEV);
has(buildDev, 'ONETHU_DEV: "1"', "build-dev.mjs 置开关");
has(buildDev, "onethu.dev.badge.hidden", "build-dev.mjs 复核面板进产物");
const relApk = read(RELEASE_APK);
lacks(relApk, "onethuDev", "正式版 APK 脚本不设 dev 开关");
has(relApk, "/assets/DevPanel-", "正式版 APK 脚本反向复核面板不存在");
lacks(read(CI), "ONETHU_DEV", "CI 正式版构建不设开关");

// ---------- 5. dev 构建入口 ----------
const apk = read(BUILD_APK);
has(apk, "export ONETHU_DEV=1", "dev APK 脚本置前端开关");
has(apk, "ORG_GRADLE_PROJECT_onethuDev=true", "dev APK 脚本置 Gradle 开关");
has(apk, "patch-android-dev.py", "dev APK 脚本调用 dev 变体补丁");
has(apk, 'dirname "$0")/../../..', "dev APK 脚本从自身位置推导仓库根");
has(apk, "/assets/DevPanel-", "dev APK 脚本按 .so 内资源名复核面板进包");
has(apk, "app.onethu.desktop.dev", "dev APK 脚本复核 dev 包名");
lacks(apk, "| grep -q", "dev APK 脚本不用管道接 grep -q（pipefail 下 SIGPIPE 会误判）");
const patcher = read(PATCHER);
has(patcher, "pathlib.Path(__file__).resolve().parent.parent", "patcher 从自身位置推导仓库根");
has(patcher, "onethuDev", "patcher 提供 dev 变体开关");
has(patcher, "app.onethu.desktop.dev", "patcher 改写 applicationId");
has(patcher, "ic_launcher_dev", "patcher 生成反色 dev 图标");
has(patcher, "SRC_ICON", "patcher 从仓库图标同步");

// ---------- 6. 文档 ----------
const doc = read(DOC);
has(doc, "ONETHU_DEV=1", "文档写明开关");
has(doc, "build:dev", "文档写明桌面构建入口");
has(doc, "android:dev", "文档写明 Android 构建入口");
has(doc, "> 最后更新：", "文档带更新时间行");
has(read(DOC_INDEX), "dev-build.md", "文档索引已收录");

// ---------- 7. 无机器专属路径 ----------
// 模式用拼接与字符码构造：守卫自身也不出现这些字面量，因此可把守卫自己纳入审计
const SEP = String.fromCharCode(92);
const BAD = ["/ho" + "me/", "/Us" + "ers/", "/mn" + "t/", "C:" + SEP, "D:" + SEP];
const AUDIT = [VITE, GLOBALS, BUILDINFO, DEVLOG, PANEL, LAYOUT, MAIN, SETTINGS, PKG, BUILD_DEV, BUILD_APK, PATCHER, DOC, "tools/devtools-test.mjs"];
for (const f of AUDIT) {
  const hits = [];
  read(f).split("\n").forEach((line, i) => {
    for (const p of BAD) if (line.includes(p)) hits.push((i + 1) + " 行含 " + p);
  });
  ok(hits.length === 0, "无机器专属路径：" + f + (hits.length ? " → " + hits.join("；") : ""));
}

console.log("");
if (fail === 0) {
  console.log("dev 版独立构建：" + pass + " 断言全部通过");
} else {
  console.log("dev 版独立构建：" + pass + " 通过 / " + fail + " 失败");
}
process.exit(fail === 0 ? 0 : 1);
