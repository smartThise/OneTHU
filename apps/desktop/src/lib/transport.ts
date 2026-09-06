/**
 * 统一传输层 —— 清华服务端不允许跨域，浏览器 fetch 会被 CORS 拦截。
 *
 * 桌面端（Tauri）：invoke Rust `http_request`（reqwest），显式透传 Cookie 头，
 * 手动逐跳跟随重定向并在每一跳刷新 Cookie —— 与老 thu-app-desktop 验证过的方案同构。
 * 浏览器预览：退回 window.fetch（仅 UI 开发；登录会被 CORS 拦截并给出明确提示）。
 */
import type { FetchLike } from "@onethu/core";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 每跳 cookie 供应者（clients.ts 注入）：包装 URL 解码出真实域 / 直连跳自身域，
 *  从 jar 取该域会话 cookie —— 教务漫游链的 CAS 中间跳必须带 id 桶会话。 */
let hopCookieProvider: ((hopUrl: string) => string | null) | null = null;
export function setHopCookieProvider(fn: (hopUrl: string) => string | null): void {
  hopCookieProvider = fn;
}

/** 每跳日志（clients.ts 注入 logLine）：记录重定向链每一跳的 URL+状态码 */
let hopLogger: ((hopUrl: string, status: number) => void) | null = null;
export function setHopLogger(fn: (hopUrl: string, status: number) => void): void {
  hopLogger = fn;
}

interface HttpOutput {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  set_cookies: string[];
  url: string;
  body: string;
  body_b64?: string | null;
}

async function invokeHttp(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string,
  bodyB64?: string,
): Promise<HttpOutput> {
  const { invoke } = await import("@tauri-apps/api/core");
  const p = invoke<HttpOutput>("http_request", {
    input: { url, method, headers, body: body ?? null, body_b64: bodyB64 ?? null },
  });
  // 45s 超时兜底：Rust reqwest 无默认超时，webvpn 链路偶发悬挂会无限 await
  // （「校外卡死」实录）。到点即弃约解阻塞，后台 Rust 任务自生自灭（有界泄漏）。
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`请求超时（45s）：${url.slice(0, 120)}`)), 45_000);
  });
  try {
    return await Promise.race([p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function collectHeaders(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init.headers;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[k] = v;
  } else if (h) {
    Object.assign(out, h);
  }
  return out;
}

/**
 * FormData → multipart/form-data 序列化（learn tjzy 提交作业同款请求形态）。
 * - 纯文本 part：整块作为字符串体经 invoke 传输（UTF-8 由传输层保证）。
 * - 含文件（File/Blob）part：字节流 base64 后走 body_b64 通道 —— invoke 的 body
 *   是 UTF-8 字符串，二进制经字符串通道会损坏，必须 base64。
 * 返回 textBody / b64Body 二选一（恒有一个为 null）。
 */
async function serializeFormData(
  fd: FormData,
): Promise<{ textBody: string | null; b64Body: string | null; contentType: string }> {
  const boundary =
    "----onethuForm" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const enc = new TextEncoder();
  type Chunk = string | Uint8Array;
  const chunks: Chunk[] = [];
  let hasFile = false;
  for (const [name, value] of fd.entries()) {
    const disp = `Content-Disposition: form-data; name="${name}"`;
    if (typeof value === "string") {
      chunks.push(`--${boundary}\r\n${disp}\r\n\r\n${value}\r\n`);
    } else {
      hasFile = true;
      const fileName = (value instanceof File && value.name ? value.name : "blob").replace(
        /[\r\n"]/g,
        "_",
      );
      const mime = value instanceof File && value.type ? value.type : "application/octet-stream";
      chunks.push(`--${boundary}\r\n${disp}; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`);
      chunks.push(new Uint8Array(await value.arrayBuffer()));
      chunks.push("\r\n");
    }
  }
  chunks.push(`--${boundary}--\r\n`);
  const contentType = `multipart/form-data; boundary=${boundary}`;
  if (!hasFile) {
    return { textBody: chunks.join(""), b64Body: null, contentType };
  }
  const byteChunks = chunks.map((c) => (typeof c === "string" ? enc.encode(c) : c));
  const total = byteChunks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of byteChunks) {
    out.set(b, off);
    off += b.length;
  }
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < out.length; i += CHUNK) {
    const sub = Array.from(out.subarray(i, Math.min(i + CHUNK, out.length)));
    bin += String.fromCharCode(...sub);
  }
  return { textBody: null, b64Body: btoa(bin), contentType };
}

async function tauriFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = url;
  let method = (init.method ?? "GET").toUpperCase();
  let body = typeof init.body === "string" ? init.body : undefined;
  let bodyB64: string | undefined;
  const headers = collectHeaders(init);
  if (init.body instanceof URLSearchParams) {
    body = init.body.toString();
    headers["Content-Type"] ??= "application/x-www-form-urlencoded;charset=UTF-8";
  } else if (init.body instanceof FormData) {
    // 此前 FormData 落到 body=undefined：POST 空体发出，作业提交（tjzy）必然失败。
    const serialized = await serializeFormData(init.body);
    if (serialized.textBody !== null) {
      body = serialized.textBody;
    } else {
      bodyB64 = serialized.b64Body ?? undefined;
    }
    headers["Content-Type"] ??= serialized.contentType;
  }
  const redirect = init.redirect ?? "follow";
  const maxHops = 10;

  // 逐跳 cookie 记忆（demo webvpnRequest 的做法）：302 中间跳下发的会话 Cookie 绝不能丢。
  // 三层优先级：初始头(seed) < 本跳真实域会话(provider) < 链内新发(chain)。
  const seedCookies = new Map<string, string>();
  const chainCookies = new Map<string, string>();
  const seed = headers["Cookie"] ?? headers["cookie"];
  if (seed) {
    for (const pair of seed.split("; ")) {
      const i = pair.indexOf("=");
      if (i > 0) seedCookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  const allSetCookies: string[] = [];
  /** 每跳 Set-Cookie 与其所在 URL 成对记录：跨域重定向链（info→zhjw、锚点兑付）
   *  的会话 cookie 必须按各自 host 入 jar，否则全记到首跳域名桶里互相覆盖
   *  （19:47 实证：zhjw 漫游把 zhjw 会话记进 info 桶，info 被连带炸掉）。 */
  const hopRecords: Array<{ u: string; l: string }> = [];

  for (let hop = 0; hop <= maxHops; hop++) {
    // 本跳真实域的会话 cookie：包装 URL 解码出原始域（如 wrapped id 跳需要 id 桶
    // 的 JSESSIONID，否则 CAS 看不到 SSO 会话、链条断在登录页——demo 扁平 jar 天然带上）
    const pairs = new Map<string, string>(seedCookies);
    const extra = hopCookieProvider?.(currentUrl);
    if (extra) {
      for (const pair of extra.split("; ")) {
        const i = pair.indexOf("=");
        if (i > 0 && !pairs.has(pair.slice(0, i))) pairs.set(pair.slice(0, i), pair.slice(i + 1));
      }
    }
    for (const [k, v] of chainCookies) pairs.set(k, v);
    if (pairs.size > 0) {
      headers["Cookie"] = [...pairs].map(([k, v]) => `${k}=${v}`).join("; ");
    } else {
      delete headers["Cookie"];
      delete headers["cookie"];
    }

    const res = await invokeHttp(currentUrl, method, headers, body, bodyB64);
    hopLogger?.(currentUrl, res.status);

    for (const sc of res.set_cookies) {
      allSetCookies.push(sc);
      hopRecords.push({ u: currentUrl, l: sc });
      const m = /^([^=]+)=([^;]*)/.exec(sc);
      if (m?.[1]) chainCookies.set(m[1].trim(), m[2] ?? "");
    }

    const respHeaders = new Headers(res.headers as HeadersInit);
    for (const sc of res.set_cookies) {
      try {
        respHeaders.append("set-cookie", sc);
      } catch {
        /* 容忍非法头值 */
      }
    }
    if (allSetCookies.length > 0) {
      // WebKit 的 getSetCookie() 不可靠：显式通道交给 CookieJar（含全部中间跳）。
      // 头值禁止换行，用 JSON 编码（Set-Cookie 值本身不会含换行）。
      respHeaders.set("x-onethu-set-cookie", JSON.stringify(allSetCookies));
    }
    if (hopRecords.length > 0) {
      // 逐跳带 host 的精确通道（CookieJar 优先消费它）
      respHeaders.set("x-onethu-set-cookie-hops", JSON.stringify(hopRecords));
    }
    // 最终落点 URL（Response 构造器无法设置 url；兑付链诊断要用）
    respHeaders.set("x-onethu-final-url", currentUrl);

    if (redirect !== "manual" && res.status >= 300 && res.status < 400) {
      const location = res.headers["location"] ?? respHeaders.get("location") ?? undefined;
      if (location) {
        currentUrl = new URL(location, currentUrl).toString();
        // 浏览器语义：303 一律转 GET；301/302 的 POST 转 GET（307/308 保持原样）
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
          bodyB64 = undefined;
        }
        continue;
      }
    }

    const bodyInit: BodyInit = res.body_b64 ? b64ToBytes(res.body_b64) : res.body;
    return new Response(bodyInit, {
      status: res.status,
      statusText: res.status_text,
      headers: respHeaders,
    });
  }

  throw new Error("重定向次数超限（10）");
}

/** base64 → 字节（二进制响应体通道；Response(string) 会把 0x89 等
 *  非 UTF-8 字节替换成 U+FFFD，验证码图/PDF 必坏，必须走字节） */
function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const u8 = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** 注入 HttpClient 的 FetchLike */
export const universalFetch: FetchLike = (url, init) =>
  isTauri ? tauriFetch(url, init) : window.fetch(url, init);

/** 登录失败的场景化提示 */
export function explainNetworkError(err: unknown): string {
  if (err instanceof Error) {
    if (!isTauri && /fetch|network|Failed to fetch/i.test(err.message)) {
      return "浏览器预览不支持直连校园网（CORS 拦截）。请运行桌面端：pnpm tauri:dev，或先用演示模式。";
    }
    if (/网络错误|timed? ?out|timeout/i.test(err.message)) {
      return "网络超时：请确认校园网 / WebVPN 可达。";
    }
    return err.message;
  }
  return "未知网络错误";
}
