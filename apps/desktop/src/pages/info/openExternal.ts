/**
 * 系统浏览器打开外链 —— Tauri WebView 内 window.open / <a target=_blank> 均不生效
 * （点"按兵不动"的根源），必须经宿主层交给系统默认浏览器。分层降级：
 *  1) scheme 白名单：仅放行 http/https，拒绝 file:/javascript:/mailto: 等一切其他协议；
 *  2) Tauri 官方 opener 插件 openUrl（主通道，Rust 侧 tauri-plugin-opener）；
 *  3) 自写 open_external 命令（Rust 侧系统 open/xdg-open/start，免 ACL，插件异常时兜底）；
 *  4) 非 Tauri 的浏览器预览环境：window.open 原生可用；
 *  5) 末级兜底：复制链接到剪贴板，由用户手动打开。
 */
import { isTauri } from "../../lib/transport.js";

export async function openExternal(rawUrl: string): Promise<void> {
  // 1) 白名单校验：非法字符串 / 非 http(s) 一律拒绝
  let url = "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      url = parsed.toString();
    }
  } catch {
    /* 非 URL 字符串（含空串） */
  }
  if (!url) return;

  // 2) 官方 opener 插件 → 系统默认浏览器（未装/未授权时 import 或调用抛错，降级）
  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
    return;
  } catch {
    /* 继续降级 */
  }

  // 3) 自写 command 兜底（Rust 侧还有一次 scheme 校验；浏览器预览环境必失败，直接跳过）
  if (isTauri) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external", { url });
      return;
    } catch {
      /* 继续降级 */
    }
  }

  // 4) 纯浏览器预览：window.open 正常弹新窗
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (win) return;

  // 5) 末级兜底：复制到剪贴板，交给用户手动打开
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    /* 剪贴板不可用时静默（调用方 UI 通常仍展示链接上下文） */
  }
}

/**
 * 支付宝深链调起（移动端专用，thu-info-lib cardRechargeFromWechatAlipay 同款拼法）：
 * 把校园卡下单返回的 qr.alipay.com 收款 URL 包进支付宝官方扫码深链
 * （alipayqr://platformapi/startapp?saId=10000007&qrcode=<enc>），opener 发
 * ACTION_VIEW Intent 直跳支付宝 App 并自带该订单，用户在支付宝内确认支付。
 * 安全约定：深链前缀硬编码、仅接受 qr.alipay.com 的 https 收款 URL（服务端返回），
 * 不提供任意 scheme 注入面。返回 false（未装支付宝/桌面端）由调用方回落二维码扫码。
 */
export async function openAlipayDeepLink(webUrl: string): Promise<boolean> {
  if (!/^https:\/\/qr\.alipay\.com\//.test(webUrl)) return false;
  const deep =
    "alipayqr://platformapi/startapp?saId=10000007&qrcode=" + encodeURIComponent(webUrl);
  try {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(deep);
    return true;
  } catch {
    return false;
  }
}
