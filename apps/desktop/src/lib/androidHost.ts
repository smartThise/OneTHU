/**
 * R18c-bugfix：Android 宿主判定（纯函数，零依赖 —— 不 import Tauri / React / @onethu/core，
 * 因此 tools/ykt-qr-test.mjs 可直接导入，用 stub navigator 模拟三种宿主做回归测试）。
 *
 * ⚠️ 坑（真机 R18b/R18c 两个入口同时失效的根因，务必先读）：
 * tauri.conf.json 给主窗口配了 `windows[].userAgent = Mozilla/5.0 (Windows NT 10.0; Win64; x64)
 * … Chrome/79`（webvpn 票按 UA 指纹绑定，该配置**不能改**）。Android WebView 加载主窗口时
 * 会把 navigator.userAgent 整体替换成这条 Windows UA —— 于是旧实现
 * `isAndroidHost = /android/i.test(navigator.userAgent)` 在真机上**恒为 false**：
 *   ① `YKT_WEB_LOGIN_AVAILABLE = isTauri && isAndroidHost` → 「官方网页登录」按钮被隐藏；
 *   ② YktQrPanel 传给保活控制器的 `isAndroid` 恒 false → 不 startQrKeepAlive（无前台服务、
 *      无通知、无权限请求），扫码保活整条链路静默失效。
 *
 * 因此改为多信号兜底（**任一命中即 Android**）：
 *  1. UA 含 "Android" —— 原判定保留（Android 浏览器 / UA 未被伪装的场景）；
 *  2. `navigator.userAgentData?.platform === "Android"` —— UA-Client-Hints 读的是真实 OS，
 *     不受 WebView setUserAgentString 伪装影响（旧内核无此 API，可选链兜底）；
 *  3. `navigator.platform` 为 Android WebView 的固定报法 `Linux armv8l` / `Linux aarch64`
 *     （32 位旧机为 armv7l；UA 被伪装不影响 platform，与 UA 来自不同通道）。
 *
 * 负例（三个信号均不命中 → false）：
 *  - Windows 桌面（platform "Win32" / userAgentData "Windows"）；
 *  - macOS 桌面（"MacIntel"）；Linux-x86 桌面（"Linux x86_64"，注意与 arm/aarch 报法不冲突）；
 *  - 桌面浏览器预览（真实 Windows/macOS/Linux-x86 UA + platform）。
 * 即：桌面端入口按 R18b 25.3.2 的窗口策略继续隐藏，本修复不改变桌面行为。
 */

/** 判定所需的宿主信号（结构化子集，DOM 的 Navigator 可直接传入） */
export interface AndroidHostSignals {
  userAgent?: string;
  platform?: string;
  userAgentData?: { platform?: string } | null;
}

/** Android WebView 的 navigator.platform 固定报法：Linux + arm/aarch，绝不含 x86 */
const ANDROID_PLATFORM_RE = /^Linux (armv\d|aarch)/;

/** 判定所需的 Windows 信号（结构化子集，DOM 的 Navigator 可直接传入）。 */
export interface WindowsHostSignals {
  platform?: string;
  userAgentData?: { platform?: string } | null;
}

/** Windows 宿主（WebView2）判定：**只用不受 UA 伪装影响的通道**。
 *  为什么不能用 UA：tauri.conf.json 把主窗口 UA 写成 Windows Chrome/79（webvpn 票绑定），
 *  所以 UA 里的 "Windows" 在安卓上也会命中——必须靠 userAgentData.platform / platform。 */
export function isWindowsNavigator(nav: WindowsHostSignals | null | undefined): boolean {
  if (!nav) return false;
  const uaData = nav.userAgentData?.platform?.toLowerCase();
  if (uaData === "windows") return true;
  return /^win/i.test(nav.platform ?? "");
}

/** 多信号判定：UA / userAgentData.platform / navigator.platform 任一命中即 Android。 */
export function isAndroidNavigator(nav: AndroidHostSignals | null | undefined): boolean {
  if (!nav) return false;
  // 信号 1：UA（原判定，UA 未被 tauri.conf 伪装时最直接）
  if (typeof nav.userAgent === "string" && /android/i.test(nav.userAgent)) return true;
  // 信号 2：UA-Client-Hints（真实 OS，不受 UA 字符串伪装影响）
  if (nav.userAgentData?.platform === "Android") return true;
  // 信号 3：platform（伪装 UA 改不到它；"Linux x86_64" 等 x86 报法不匹配）
  if (typeof nav.platform === "string" && ANDROID_PLATFORM_RE.test(nav.platform)) return true;
  return false;
}

/* ---------- R20-A：外部作业链接打开通道的纯分流判定 ----------
 * 零依赖纯函数（同本文件既有约定），真实打开动作在 ./extHwBrowse.ts；
 * tools/ykt-qr-test.mjs 对本函数做 stub 直测（见该测试 [13] 节）。 */

/** 仅放行 http(s)：javascript:/data:/intent:/mailto: 等一律不开（双侧白名单的 TS 侧） */
export function isHttpUrl(url: string): boolean {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

/** 外部作业链接的打开通道：
 *  - "reject"：非 http(s)，一律拒绝（不开 WebView 也不交系统浏览器）；
 *  - "webview"：Tauri + Android 宿主 → 应用内全屏 WebView 桌面模式（open_web_modal）；
 *  - "browser"：其余（桌面端 / 浏览器预览）→ 保持现状走系统浏览器（openExternal）。 */
export type ExtHwOpenChannel = "webview" | "browser" | "reject";

export function pickExtHwOpenChannel(
  nav: AndroidHostSignals | null | undefined,
  url: string,
  tauri: boolean,
): ExtHwOpenChannel {
  if (!isHttpUrl(url)) return "reject";
  if (tauri && isAndroidNavigator(nav)) return "webview";
  return "browser";
}

/* ---------- R21：文件预览 PDF 渲染通道的纯分流判定 ----------
 * 背景（2026-09-21「手机 PDF 预览还是不行」的根因）：FilePreview 旧实现用
 * `/android/i.test(navigator.userAgent)` 判定安卓，但主窗口 UA 被 tauri.conf.json
 * 伪装成 Windows Chrome/79（webvpn 票绑定，见本文件顶部说明）→ 真机恒 false →
 * 9-13 做的 pdf.js 内嵌预览在真机上从未执行，一直渲染安卓上空白/被下载的 <embed>。
 *
 * 判定规则：
 *  - 非 Android（桌面 WKWebView / WebView2 / 浏览器）：原生支持内嵌 PDF → "embed"；
 *  - Android 且 `navigator.pdfViewerEnabled === true`（本 WebView 自带 PDF 渲染器，
 *    Chromium 96+ 标准信号）：embed 观感最好（缩放/翻页/选中文本）→ "embed"；
 *  - 其余 Android（无内置渲染器）：pdf.js canvas 自绘 → "canvas"；
 *    pdf.js 失败时 UI 提供「换内嵌渲染」人工兜底 + 「系统应用打开」，绝不静默。 */

