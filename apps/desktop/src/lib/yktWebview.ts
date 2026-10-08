/**
 * R18 24.2：雨课堂「官方网页登录」通道（应用内 WebView）前端桥。
 *
 * 背景：雨课堂官方登录页发短信前必须先过 TencentCaptcha / hCaptcha（交互式，纯接口不可行，
 * 见 R17 23.2）。本模块把「打开官方登录页 → 用户在其中完成扫码或手机号+图形验证码+短信 →
 * 读回 Cookie」封装成两个动作：
 *   - openYuketangWebLogin()：打开应用内原生 WebView 窗口（桌面 Tauri 窗口 / Android Dialog WebView）；
 *   - readYuketangWebCookies()：读取 `pro.yuketang.cn` 的 Cookie（含 HttpOnly），
 *     经 core 的 yuketangCookieFromHeader 补齐清华固定字段后返回可直接保存的凭据串。
 *
 * 取 Cookie 由用户点「我已登录，读取会话」触发（避免与页面跳转竞态）。
 * 读不到时抛错，调用方在 UI 里明确回退「高级：手动粘贴 Cookie」——绝不卡住。
 */
import { invoke } from "@tauri-apps/api/core";
import { yuketangCookieFromHeader } from "@onethu/core";
import { isAndroidNavigator } from "./androidHost.js";
import { isTauri } from "./transport.js";

/** 读取失败时的统一回退提示（桌面端读不到 / Android 未取到会话均适用） */
export const YKT_WEB_FALLBACK_HINT =
  "读取失败。请在电脑浏览器登录 pro.yuketang.cn 后，用下方「高级：手动粘贴浏览器登录信息」粘贴登录状态（浏览器 F12 → Application）。";

/**
 * 当前是否 Android 宿主（应用内全屏 WebView 的移动端实现）。
 *
 * R18c-bugfix：tauri.conf.json 的 `windows[].userAgent` 把主窗口 UA 伪装成
 * Windows Chrome/79（webvpn 票绑定 UA 指纹，不能改）→ Android 真机上
 * navigator.userAgent 不含 "Android"，旧的单 UA 判定恒为 false，导致
 * ① 官方网页登录按钮被隐藏（YKT_WEB_LOGIN_AVAILABLE）；
 * ② 扫码保活不启动（保活控制器收到 isAndroid=false，不 startQrKeepAlive）。
 * 改为多信号判定：UA + userAgentData.platform + navigator.platform 任一命中即 Android，
 * 详见 ./androidHost.ts（含三种宿主的负例说明）。
 */
export const isAndroidHost =
  typeof navigator !== "undefined" && isAndroidNavigator(navigator);

/**
 * R18b 25.3.2：桌面端「官方网页登录」原生窗口在 Windows 实测白屏、缩放不重绘、
 * 关不掉（主线程僵住，只能任务管理器强杀）。在真机确认稳定前，桌面端隐藏该入口
 * （桌面二维码本来可用），仅 Android 应用内全屏 WebView 保留此通道。
 */
export const YKT_WEB_LOGIN_AVAILABLE = isTauri && isAndroidHost;

/**
 * 打开雨课堂官方登录窗口（已打开则聚焦）。非 Tauri 环境（浏览器预览）直接给出明确提示。
 *
 * 返回：
 *  - Android：全屏 Dialog 内点「我已登录，读取会话」→ 直接带回补齐清华字段后的凭据串；
 *    用户直接关闭则返回 `null`（调用方显示回退提示）。
 *  - 桌面端：独立窗口，返回 `null`（读取由面板按钮 / `ykt-cookie` 事件触发）。
 */
export async function openYuketangWebLogin(): Promise<string | null> {
  if (!isTauri) throw new Error("官方网页登录需在 OneTHU App 内使用（浏览器预览不可用）。");
  const r = await invoke<string>("open_ykt_window");
  if (r && /sessionid=/i.test(r)) return yuketangCookieFromHeader(r);
  return null;
}

/**
 * 监听桌面端会话回传：WebView 内注入的「我已登录，读取会话」按钮把标记写进
 * `document.title`，Rust 后台线程读到后在非主线程用 `cookies_for_url` 取 Cookie，
 * 再 emit `ykt-cookie`（原始 `name=value; …`）。回调收到的是补齐清华字段后的凭据串。
 *
 * 返回取消监听的函数；Android / 浏览器预览无该事件（返回空操作）。
 */
export async function onYuketangWebCookie(cb: (cookie: string) => void): Promise<() => void> {
  if (!isTauri || isAndroidHost) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen<string>("ykt-cookie", (ev) => {
      const raw = typeof ev.payload === "string" ? ev.payload : "";
      if (/sessionid=/i.test(raw)) cb(yuketangCookieFromHeader(raw));
    });
  } catch {
    /* 事件系统不可用：忽略，面板按钮仍可手动读取 */
    return () => {};
  }
}

/**
 * 读取官方登录窗口里的会话 Cookie 并补齐清华固定字段。
 * 未取到会话（空 / 无 sessionid）时抛错——调用方展示 {@link YKT_WEB_FALLBACK_HINT}。
 */
export async function readYuketangWebCookies(): Promise<string> {
  if (!isTauri) throw new Error("官方网页登录需在 OneTHU App 内使用（浏览器预览不可用）。");
  const raw = await invoke<string>("read_ykt_cookies");
  if (!raw || !/sessionid=/i.test(raw)) {
    throw new Error("尚未检测到雨课堂登录状态（请先在窗口内完成扫码或短信登录）。");
  }
  return yuketangCookieFromHeader(raw);
}

/** 关闭官方登录窗口（窗口不存在时静默忽略）。 */
export async function closeYuketangWebLogin(): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("close_ykt_window");
  } catch {
    /* 窗口已由用户关闭 */
  }
}
