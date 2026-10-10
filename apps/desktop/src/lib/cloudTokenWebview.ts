/**
 * 清华云盘应用内读取桥：先把统一 HttpClient jar 的允许域 Cookie 显式同步到原生仓；
 * WebView 页面带入会话，成功后再把它的新 Cookie 回灌到 HttpClient 与原生仓。
 * 页面脚本只读已有访问口令，不会生成或重置。
 */
import { invoke } from "@tauri-apps/api/core";
import { webvpnWrap } from "@onethu/core";
import { http } from "./clients.js";
import { isAndroidNavigator } from "./androidHost.js";
import { isTauri } from "./transport.js";

export interface CloudCookieSeed {
  url: string;
  /** 每项为一条 Set-Cookie 样式字符串，不含日志输出。 */
  cookies: string[];
}

interface CloudTokenPayload {
  token?: string;
  cancelled?: boolean;
  cookieSeeds?: CloudCookieSeed[];
}

const TOKEN_RE = /^[0-9a-f]{40}$/i;
const TIMEOUT_MS = 10 * 60 * 1000 + 8_000;
const COOKIE_ORIGINS = [
  "https://cloud.tsinghua.edu.cn/",
  "https://id.tsinghua.edu.cn/",
  "https://oauth.tsinghua.edu.cn/",
  "https://webvpn.tsinghua.edu.cn/",
] as const;
const ALLOWED_COOKIE_HOSTS = new Set(COOKIE_ORIGINS.map((url) => new URL(url).hostname));

let inFlight: Promise<string> | null = null;

/** 打开应用内云盘 profile 页，读取并返回现有 40 位访问口令。 */
export function readCloudTokenInWebview(): Promise<string> {
  if (!isTauri) {
    return Promise.reject(new Error("应用内云盘登录仅能在 OneTHU 中使用。"));
  }
  if (inFlight) return inFlight;

  const pending = runWebviewFlow();
  inFlight = pending;
  void pending.finally(() => {
    if (inFlight === pending) inFlight = null;
  }).catch(() => undefined);
  return pending;
}

// （已删 seedSharedSession）2026-10-10 实录：把 TS HttpClient jar 的票推进原生仓会
// 用**陈旧 webvpn 票污染管线活票**——WebView 首跳即 logoutByOther、静默爬取 302 循环。
// 原生仓（NATIVE_JAR_ARC）本就是权威会话源（lib 管线在用、票是活的），
// 种子一律由 Rust 侧直接从原生仓取，前端不再往里推任何票。

/** 将 WebView 登录/续期得到的 Cookie 回灌统一 jar；只接收固定的清华认证域。 */
async function mergeReturnedCookies(seeds: CloudCookieSeed[] | undefined): Promise<void> {
  if (!Array.isArray(seeds)) return;
  for (const seed of seeds) {
    let parsed: URL;
    try {
      parsed = new URL(seed.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || !ALLOWED_COOKIE_HOSTS.has(parsed.hostname)) continue;
    const lines = (Array.isArray(seed.cookies) ? seed.cookies : []).filter((line) =>
      typeof line === "string" && line.length > 0 && !/[\r\n]/.test(line) && line.includes("="),
    );
    for (const line of lines) http.jar.setRaw(parsed, line);
    try {
      await invoke("http_native_seed", { url: seed.url, lines });
    } catch {
      /* Token 本身仍可用；下次启动由统一登录流程恢复 */
    }
  }
}

async function acceptPayload(payload: CloudTokenPayload): Promise<string> {
  if (payload.cancelled) throw new Error("已取消读取云盘访问口令。");
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  if (!TOKEN_RE.test(token)) {
    throw new Error("云盘页面没有返回有效内容，请重试或手动粘贴访问口令。");
  }
  await mergeReturnedCookies(payload.cookieSeeds);
  return token;
}

async function runWebviewFlow(): Promise<string> {
  // 记住的清华账密（内存传递）：WebView 落到 id 登录表单页时自动填表提交
  // （THOS eid_fill_script 同款）；无记住密码时传空，脚本自静默、由用户手输。
  const { loadRemembered } = await import("./clients.js");
  const remembered = await loadRemembered().catch(() => null);
  const cred = {
    username: remembered?.username ?? "",
    password: remembered?.password ?? "",
    // 零跳通道：cloud profile 的 webvpn 包装 URL——SSO 链在 wengine 服务端完成
    // （THOS 内嵌页同构），客户端只需要 webvpn 会话票（实测 wengine 认我们种的票）。
    targetUrl: webvpnWrap("https://cloud.tsinghua.edu.cn/profile/#get-auth-token"),
  };
  const android = typeof navigator !== "undefined" && isAndroidNavigator(navigator);
  if (android) {
    const payload = await invoke<CloudTokenPayload>("open_cloud_token_window", cred);
    return acceptPayload(payload);
  }

  const { listen } = await import("@tauri-apps/api/event");
  let unlistenToken: (() => void) | undefined;
  let unlistenCancelled: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolveToken!: (token: string) => void;
  let rejectToken!: (error: Error) => void;

  const result = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  const finish = (token?: string, error?: Error): void => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    if (error) rejectToken(error);
    else resolveToken(token ?? "");
  };

  try {
    // 先订阅再 invoke，避免 WebView 很快加载完成时错过回传事件。
    unlistenToken = await listen<CloudTokenPayload>("cloud-token", (event) => {
      void acceptPayload(event.payload).then(
        (token) => finish(token),
        (error) => finish(undefined, error instanceof Error ? error : new Error(String(error))),
      );
    });
    unlistenCancelled = await listen<string>("cloud-token-cancelled", (event) => {
      const reason = typeof event.payload === "string" ? event.payload : "closed";
      finish(undefined, new Error(
        reason === "timeout" ? "等待云盘页面超时，请确认已登录后重试。" : "已取消读取云盘访问口令。",
      ));
    });
    timeout = setTimeout(() => {
      finish(undefined, new Error("等待云盘页面超时，请确认已登录后重试。"));
    }, TIMEOUT_MS);

    await invoke<string>("open_cloud_token_window", cred);
    return await result;
  } finally {
    if (timeout) clearTimeout(timeout);
    unlistenToken?.();
    unlistenCancelled?.();
  }
}
