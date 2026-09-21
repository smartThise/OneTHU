/**
 * R21：PDF 预览渲染通道护栏（2026-09-21「手机 PDF 预览还是不行」事故）。
 *
 * 根因回顾：FilePreview 旧实现用 `/android/i.test(navigator.userAgent)` 判安卓，
 * 但主窗口 UA 被 tauri.conf.json 伪装成 Windows Chrome/79（webvpn 票绑定）→
 * 真机恒 false → pdf.js 分支从未在真机执行，一直渲染安卓上空白的 <embed>。
 *
 * 护栏三件事：
 *   [1] choosePdfRenderMode 纯函数分档（桌面 / 自带渲染器 / 其余安卓）；
 *   [2] 源码守卫：FilePreview 禁止再出现裸 UA 正则判安卓，必须走多信号判定与分流函数；
 *   [3] 源码守卫：pdf.js 自绘路径必须带 legacy 构建兜底 + 换内嵌渲染出口。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { choosePdfRenderMode, isAndroidNavigator, isWindowsNavigator } = await import("../apps/desktop/src/lib/androidHost.ts");

/* ---------- [1] choosePdfRenderMode 分档 ---------- */

// 桌面（任何信号）：一律 embed（WKWebView / WebView2 原生支持）
assert.equal(choosePdfRenderMode({ android: false, pdfViewerEnabled: undefined }), "embed");
assert.equal(choosePdfRenderMode({ android: false, pdfViewerEnabled: false }), "embed");
assert.equal(choosePdfRenderMode({ android: false, pdfViewerEnabled: true }), "embed");

// 安卓 + 内核自带 PDF 渲染器（pdfViewerEnabled === true）→ embed 观感最好
assert.equal(choosePdfRenderMode({ android: true, pdfViewerEnabled: true }), "embed");

// 安卓 + 无自带渲染器（false / 旧内核无此属性 undefined）→ pdf.js 自绘
assert.equal(choosePdfRenderMode({ android: true, pdfViewerEnabled: false }), "canvas");
assert.equal(choosePdfRenderMode({ android: true, pdfViewerEnabled: undefined }), "canvas");

// isAndroidNavigator 多信号回归（与 ykt-qr-test 互补的快速锚点）：
// 主窗口 UA 被伪装成 Windows Chrome/79 时，platform 报法仍是 Android 的 Linux arm
assert.equal(
  isAndroidNavigator({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36",
    platform: "Linux aarch64",
    userAgentData: null,
  }),
  true,
  "UA 被伪装时必须靠 platform 信号认出 Android",
);
assert.equal(
  isAndroidNavigator({ userAgent: "Mozilla/5.0 (Windows NT 10.0…) Chrome/126", platform: "Win32", userAgentData: { platform: "Windows" } }),
  false,
  "Windows 桌面不得误判",
);

/* ---------- [1b] Windows（WebView2）分档：一律 pdf.js 自绘 ----------
 * 用户实录（2026-09-21）：「windows pdf 预览好像不行」——WebView2 的内置 PDF 查看器不可靠，
 * 且 Chromium 系对 data: URL 的 PDF 加载限制严格。 */
assert.equal(choosePdfRenderMode({ android: false, windows: true, pdfViewerEnabled: true }), "canvas",
  "Windows 即使内核自称有查看器也走自绘（WebView2 不可靠）");
assert.equal(choosePdfRenderMode({ android: false, windows: true, pdfViewerEnabled: undefined }), "canvas");
// 其余桌面保持 embed（行为不变，零回归）
assert.equal(choosePdfRenderMode({ android: false, windows: false, pdfViewerEnabled: undefined }), "embed");
assert.equal(choosePdfRenderMode({ android: false, pdfViewerEnabled: true }), "embed", "未传 windows 时行为与改档前一致");

/* ---------- [1c] Windows 判定：绝不能吃伪装的 UA ----------
 * tauri.conf.json 把主窗口 UA 写成 Windows Chrome/79（webvpn 票绑定），
 * 安卓真机的 UA 也因此含 "Windows" → 判 Windows 只能用 userAgentData / platform。 */
assert.equal(
  isWindowsNavigator({ platform: "Win32", userAgentData: { platform: "Windows" } }),
  true,
  "真 Windows 桌面要认出来",
);
assert.equal(
  isWindowsNavigator({ platform: "Linux aarch64", userAgentData: null }),
  false,
  "安卓（UA 伪装成 Windows）绝不能误判为 Windows",
);
assert.equal(isWindowsNavigator({ platform: "MacIntel", userAgentData: { platform: "macOS" } }), false, "macOS 不误判");
assert.equal(isWindowsNavigator(undefined), false, "无信号按非 Windows");

/* ---------- [2][3] 源码守卫 ---------- */

const fpSrc = readFileSync(new URL("../apps/desktop/src/components/FilePreview.tsx", import.meta.url), "utf8");
const hostSrc = readFileSync(new URL("../apps/desktop/src/lib/androidHost.ts", import.meta.url), "utf8");

assert.ok(!fpSrc.includes("/android/i.test(") && !fpSrc.includes("/Android/.test("), "FilePreview 禁止用裸 UA 正则判安卓（真机 UA 被伪装，恒 false）");
assert.ok(fpSrc.includes("isAndroidNavigator("), "FilePreview 必须走 androidHost 多信号判定");
assert.ok(fpSrc.includes("choosePdfRenderMode("), "PDF 渲染通道必须经 choosePdfRenderMode 分流");
assert.ok(fpSrc.includes("pdfViewerEnabled"), "必须读取内核自带渲染器信号");
assert.ok(fpSrc.includes("legacy/build/pdf.mjs"), "pdf.js 自绘必须带 legacy 构建兜底（老内核缺现代 API）");
assert.ok(fpSrc.includes("换内嵌渲染"), "自绘失败必须保留「换内嵌渲染」人工出口");
assert.ok(fpSrc.includes("[FILE-PREVIEW]"), "解析失败必须留痕（console 可被 logcat 抓到）");
assert.ok(hostSrc.includes("export function choosePdfRenderMode"), "androidHost 应导出 choosePdfRenderMode");
assert.ok(hostSrc.includes("export function isWindowsNavigator"), "androidHost 应导出 isWindowsNavigator");
assert.ok(fpSrc.includes("isWindowsNavigator("), "FilePreview 必须用多信号判 Windows（UA 不可信）");
assert.ok(/choosePdfRenderMode\(\{[\s\S]{0,200}windows: IS_WINDOWS_HOST/.test(fpSrc), "分档必须把 Windows 信号传进去");
// embed 必须用 blob: URL（data: URL 的 PDF 在 Chromium 系常空白），且要 revoke
assert.ok(fpSrc.includes("URL.createObjectURL("), "内嵌渲染必须用 blob URL，而不是 data: URL");
assert.ok(fpSrc.includes("URL.revokeObjectURL("), "blob URL 必须在卸载时 revoke（防长会话泄漏）");
assert.ok(fpSrc.includes("PDF-MODE"), "渲染通道与平台必须落一行诊断日志（排查不用猜）");

console.log("pdf-render-mode-test: 全部断言通过（含 Windows 分档与伪装 UA 负例 + blob URL + 诊断日志）");

/* ---------- [4] 同族全库扫描：src 内禁止再出现「裸 UA 判安卓」的任何写法 ----------
 * 主窗口 UA 被 tauri.conf.json 伪装成 Windows Chrome/79（webvpn 票绑定），任何
 * 用 UA 字符串判 Android 的代码在真机恒 false。判定一律走 androidHost 多信号。 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = new URL("../apps/desktop/src", import.meta.url).pathname;
const FAMILY_PATTERNS = [
  // 只拦「判 Android」的 UA 用法；iPhone|iPad 判定不受安卓 UA 伪装影响，允许保留
  [/\/[^\n/]*[Aa]ndroid[^\n/]*\/[a-z]*\.test\(\s*navigator\.userAgent\s*\)/, "UA 正则判安卓"],
  [/userAgent\.includes\(\s*["']Android["']\s*\)/, "UA includes 判安卓"],
  [/navigator\.userAgent\)[^\n]{0,40}includes\(\s*["']Android["']/, "UA includes 判安卓（取反序）"],
];
const offenders = [];
(function walk(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) { walk(full); continue; }
    if (!/\.(ts|tsx)$/.test(name.name) || name.name === "androidHost.ts") continue;
    const text = readFileSync(full, "utf8");
    for (const [re, label] of FAMILY_PATTERNS) {
      if (re.test(text)) offenders.push(`${full} → ${label}`);
    }
  }
})(SRC_ROOT);
assert.deepEqual(offenders, [], `发现裸 UA 判安卓残留（改走 androidHost 多信号）:\n${offenders.join("\n")}`);
console.log("同族扫描：apps/desktop/src 无裸 UA 判安卓残留 ✓");
