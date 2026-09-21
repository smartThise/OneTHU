/**
 * PDF 预览渲染通道护栏（2026-09-21 两次真机事故后定稿）。
 *
 * 事故一（安卓）：旧实现用裸 UA 正则判安卓（主窗口 UA 被 tauri.conf 伪装成
 *   Windows Chrome/79）→ pdf.js 分支从未在真机执行，一直渲染空白的 <embed>。
 * 事故二（Windows）：
 *   ① WebView2 的内置 PDF 查看器不可靠，<embed> 点开空白；
 *   ② data: URL 的 PDF 在 Chromium 系受限（改 blob: 也只是换一种脆弱）；
 *   ③ 最终用户实录「点任何预览直接白屏」→ 用户令：统一成安卓那种。
 *
 * 现在只有两条路：**pdf.js canvas 自绘（默认，全平台）** 与 **系统应用打开（人工出口）**。
 * 本护栏锁死这一点：任何平台都不许再引入 <embed> 渲染通道。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { isAndroidNavigator, isWindowsNavigator } = await import("../apps/desktop/src/lib/androidHost.ts");
const fpSrc = readFileSync(new URL("../apps/desktop/src/components/FilePreview.tsx", import.meta.url), "utf8");
const hostSrc = readFileSync(new URL("../apps/desktop/src/lib/androidHost.ts", import.meta.url), "utf8");

/* ---------- [1] 统一通道：只有自绘 ---------- */
/** 剔除注释行后再判定：注释里提到旧通道名（解释为什么删）不算违规——
 *  护栏自己踩过三次「注释里的字样被当成代码」的坑，这里一律先剥注释。 */
const fpCode = fpSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
assert.ok(!/<embed[\s>]/.test(fpCode), "不得再用 <embed> 渲染 PDF（Windows/WebView2 白屏根因）");
assert.ok(!/type="application\/pdf"/.test(fpCode), "不得再声明 application/pdf 内嵌通道");
assert.ok(!fpCode.includes("createObjectURL"), "blob URL 通道已删除（embed 专用）");
assert.ok(fpSrc.includes("<PdfCanvasView"), "PDF 必须走 pdf.js canvas 自绘");
assert.ok(fpSrc.includes("legacy/build/pdf.mjs"), "自绘必须保留 legacy 构建兜底（老内核缺现代 API）");
assert.ok(fpSrc.includes("系统应用打开"), "必须保留「系统应用打开」作为唯一人工出口");
assert.ok(/PDF-MODE canvas/.test(fpSrc), "诊断日志要写清通道=canvas（客户端排查用）");
assert.ok(!/choosePdfRenderMode/.test(fpSrc) && !/choosePdfRenderMode/.test(hostSrc),
  "分档函数已删除——通道统一后不该再存在「按平台选 embed」的入口");

/* ---------- [1b] Windows：预览暂不可用，只给下载（用户定案） ----------
 * 用户原话：「win 的构建维护成本太高了，我们先注明 win 的文件预览暂不可用，只能下载吧」。
 * 所以 Windows 不得再尝试渲染预览主体，必须给明确说明 + 下载/另存为出口。 */
assert.ok(/IS_WINDOWS_HOST && !winTryPreview/.test(fpCode), "Windows 必须走「暂不可用」分支，不再尝试渲染");
assert.ok(fpCode.includes("Windows 暂不支持应用内预览"), "要给用户明确说明（不要静默失败）");
assert.ok(fpCode.includes("doDownload()") && fpCode.includes("doSaveAs()"), "必须提供下载与另存为出口");
assert.ok(fpCode.includes("仍要尝试预览"), "保留低调的排查出口（将来在 Windows 上复现时不必改代码）");

/* ---------- [2] 预览崩溃兜底：任何预览出错不许白屏 ---------- */
assert.ok(/class PreviewErrorBoundary/.test(fpSrc), "预览必须有错误边界（否则一处抛错整窗白屏）");
assert.ok(/getDerivedStateFromError/.test(fpSrc), "错误边界要真的接管渲染错误");
assert.ok(/PREVIEW-CRASH/.test(fpSrc), "崩溃要落日志（客户端排查用）");
assert.ok(/<PreviewErrorBoundary/.test(fpSrc), "预览主体必须被边界包住");

/* ---------- [3] 平台判定锚点（伪装 UA 不得击穿） ---------- */
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
  "Windows 桌面不得误判为 Android",
);
assert.equal(isWindowsNavigator({ platform: "Linux aarch64", userAgentData: null }), false,
  "安卓（UA 伪装成 Windows）不得误判为 Windows");
assert.equal(isWindowsNavigator({ platform: "Win32", userAgentData: { platform: "Windows" } }), true, "真 Windows 要认出");
assert.ok(fpSrc.includes("isAndroidNavigator(") && fpSrc.includes("isWindowsNavigator("),
  "平台判定必须走 androidHost 多信号（用于诊断）");

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
