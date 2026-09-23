/**
 * 开发者构建（ONETHU_DEV=1）专属功能的守卫。
 *
 * 用户明确要求：右上角 commit 徽标、日志导出这类东西**正式版里不能出现**。
 * 这条纪律靠"构建期常量 + 动态 import"实现——一旦有人把 DevPanel 改成静态 import，
 * 或正式版脚本误设 ONETHU_DEV，正式包就会多出 dev UI 而没人察觉。这个测试守它。
 *
 * 跑法：node --import ./tools/ts-resolve-register.mjs tools/devtools-test.mjs
 */
import { existsSync, readFileSync } from "node:fs";

let pass = 0;
function ok(cond, label) {
  if (!cond) {
    console.error("  ✗ " + label);
    process.exit(1);
  }
  pass += 1;
  console.log("  ✓ " + label);
}
const read = (p) => readFileSync(p, "utf8");

console.log("[1] 构建期常量：dev 开关只认环境变量，commit/构建时间由 vite 注入");
{
  const vite = read("apps/desktop/vite.config.ts");
  ok(vite.includes('process.env.ONETHU_DEV === "1"'), "ONETHU_DEV=1 才开 dev 构建（默认关）");
  ok(vite.includes("__ONETHU_DEV__: JSON.stringify(DEV_BUILD)"), "__ONETHU_DEV__ 由 DEV_BUILD 注入");
  ok(vite.includes("git rev-parse --short HEAD"), "注入编译时 commit（徽标显示的就是它）");
  ok(vite.includes("-dirty"), "工作区有未提交改动时标 -dirty（避免误认构建来源）");
  ok(vite.includes("__ONETHU_BUILD_TIME__"), "注入构建时间");
  const globals = read("apps/desktop/src/globals.d.ts");
  ok(globals.includes("declare const __ONETHU_DEV__: boolean;"), "全局声明存在（裸标识符才能被静态折叠）");
}

console.log("[2] dev 面板：__ONETHU_DEV__ 门控 + 动态 import（否则整块会进正式版）");
{
  const layout = read("apps/desktop/src/components/Layout.tsx");
  ok(
    layout.includes('const DevPanel = __ONETHU_DEV__ ? lazy(() => import("./DevPanel.js")) : null;'),
    "Layout 用 __ONETHU_DEV__ 门控 + 动态 import",
  );
  ok(!/^import\s[^\n]*DevPanel/m.test(layout), "DevPanel 不是静态 import");
  ok(layout.includes("{DevPanel ? ("), "JSX 里按 DevPanel 是否为空渲染");
  ok(layout.includes("lazy, Suspense"), "react 侧引入了 lazy/Suspense");

  const panel = read("apps/desktop/src/components/DevPanel.tsx");
  ok(panel.includes("export default function DevPanel"), "DevPanel 有默认导出（lazy 需要）");
  ok(panel.includes("dev · {BUILD_COMMIT}"), "右上角徽标显示 commit");
  ok(panel.includes("debug_log_export"), "面板可一键导出运行日志");
  ok(panel.includes('position: "fixed", top: 6, right: 8'), "徽标固定在右上角");
  ok(panel.includes("devLogText()"), "面板能看/复制前端日志");
}

console.log("[3] 日志桥：有界 + 熔断 + 不回灌（诊断通道不能反噬主流程）");
{
  const dev = read("apps/desktop/src/lib/devlog.ts");
  ok(/const MAX_ENTRIES = \d+/.test(dev) && dev.includes("splice(0, entries.length - MAX_ENTRIES)"), "环形缓冲有上限");
  ok(dev.includes("failures >= MAX_FAILURES"), "连续失败后熔断，不再转发");
  ok(dev.includes('text.indexOf("[FE]") === 0'), "自身产生的行不回灌（防 invoke 失败死循环）");
  ok(dev.includes("MAX_LINE") && dev.includes("clip("), "单行截断（防超大对象刷爆日志）");
  ok(dev.includes("FLUSH_MS") && dev.includes("MAX_PER_FLUSH"), "批量 + 限速转发（不逐行 invoke）");
  const main = read("apps/desktop/src/main.tsx");
  ok(main.includes("if (__ONETHU_DEV__) {") && main.includes('import("./lib/devlog.js")'), "main.tsx 只在 dev 构建装桥");
  ok(!/^import[^\n]*devlog/m.test(main), "main.tsx 不静态 import 日志桥");
}

console.log("[4] 设置页运行日志行：正式版不显示");
{
  const s = read("apps/desktop/src/pages/Settings.tsx");
  ok(s.includes("{__ONETHU_DEV__ ? <DebugLogRow /> : null}"), "DebugLogRow 由 __ONETHU_DEV__ 门控");
}

console.log("[5] 构建脚本：dev 链带开关 + 产物校验；正式版链不带开关且反向校验");
{
  const DEV_SH = "/home/lin/tools/build-android-dev.sh";
  const REL_SH = "/home/lin/tools/build-android.sh";
  const DEV_EXE_SH = "/home/lin/tools/build-desktop-dev.sh";
  if (existsSync(DEV_SH) && existsSync(REL_SH)) {
    const dev = read(DEV_SH);
    ok(dev.includes("export ONETHU_DEV=1"), "dev APK 脚本导出 ONETHU_DEV=1");
    ok(dev.includes("onethu.dev.badge.hidden"), "dev APK 脚本校验 dev 面板进了产物");
    ok(dev.includes("/assets/DevPanel-"), "dev APK 脚本按 APK 内 .so 硬校验面板已进包");
    const rel = read(REL_SH);
    ok(!rel.includes("export ONETHU_DEV") && !rel.includes("ONETHU_DEV=1"), "正式版 APK 脚本不设置 ONETHU_DEV");
    ok(rel.includes("onethu.dev.badge.hidden"), "正式版 APK 脚本反向校验产物里没有 dev 标记");
    ok(rel.includes("/assets/DevPanel-"), "正式版 APK 脚本按 .so 反向校验面板不存在");
  } else {
    console.log("  · 跳过：本机没有 /home/lin/tools 构建脚本（非开发机）");
  }
  if (existsSync(DEV_EXE_SH)) {
    const exe = read(DEV_EXE_SH);
    ok(exe.includes("export ONETHU_DEV=1"), "桌面 dev exe 脚本导出 ONETHU_DEV=1");
    ok(exe.includes("onethu-dev.exe"), "桌面 dev exe 产物与正式版分开（onethu-dev.exe）");
    ok(exe.includes("/assets/DevPanel-"), "桌面 dev exe 脚本按 exe 内资源名硬校验面板已进包");
  } else {
    console.log("  · 跳过：本机没有桌面 dev exe 脚本");
  }
}

console.log("\ndev 专属功能： " + pass + " 断言全部通过");
