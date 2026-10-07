/**
 * 统一传输层 —— 清华服务端不允许跨域，浏览器 fetch 会被 CORS 拦截。
 *
 * 桌面端（Tauri）：invoke Rust `http_request`（reqwest），显式透传 Cookie 头，
 * 手动逐跳跟随重定向并在每一跳刷新 Cookie —— 与老 thu-app-desktop 验证过的方案同构。
 * 浏览器预览：退回 window.fetch（仅 UI 开发；登录会被 CORS 拦截并给出明确提示）。
 */
import type { FetchLike } from "@onethu/core";
import { webvpnWrap } from "@onethu/core";
// R21c：body 序列化的唯一真源（FormData→multipart / 二进制→base64）
import { serializeFetchBody } from "./bodySerialize.js";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 每跳 cookie 供应者（clients.ts 注入）：包装 URL 解码出真实域 / 直连跳自身域，
 *  从 jar 取该域会话 cookie —— 教务漫游链的 CAS 中间跳必须带 id 桶会话。 */
let hopCookieProvider: ((hopUrl: string) => string | null) | null = null;
export function setHopCookieProvider(fn: (hopUrl: string) => string | null): void {
  hopCookieProvider = fn;
}

/** 跳转包装器（clients.ts 注入）：链内已在 webvpn 时，重定向落到的非公网域
 *  必须续包装——否则 id/oauth（公网）302 指向内网域（cab.lib 等）时原样直连跟随，
 *  校外超时死链、校内通道分裂（会话一半在 webvpn 一半在直连，互相看不见）。
 *  纯直连链（校园 card）不受影响：只有链中出现过 webvpn 跳才启用。 */
let hopUrlWrapper: ((url: string) => string) | null = null;
export function setHopUrlWrapper(fn: (url: string) => string): void {
  hopUrlWrapper = fn;
}

/** 每跳日志（clients.ts 注入 logLine）：记录重定向链每一跳的 URL+状态码 */
let hopLogger: ((hopUrl: string, status: number, cookies?: string) => void) | null = null;
export function setHopLogger(fn: (hopUrl: string, status: number, cookies?: string) => void): void {
  hopLogger = fn;
}

interface HttpOutput {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  set_cookies: string[];
  /** 逐跳 Set-Cookie（http_native）：[所在跳URL, 原始行] —— 供按真实域分桶入账 */
  set_cookie_hops?: Array<[string, string]>;
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
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HttpOutput> {
  const { invoke } = await import("@tauri-apps/api/core");
  const p = invoke<HttpOutput>("http_request", {
    input: {
      url,
      method,
      headers,
      body: body ?? null,
      body_b64: bodyB64 ?? null,
      // R17 23.1：透传 Rust reqwest 的 timeout_ms（缺省 null → Rust 侧默认 20s）。
      // 长轮询端点（雨课堂 app-web-login）需 >20s，由调用方显式放大。
      timeout_ms: opts.timeoutMs ?? null,
    },
  });
  // R17 23.1：init.signal 生效——abort → 立即 reject JS promise，Rust 请求自然结束。
  // 此前 signal 被忽略：调用方 28s 超时 abort 后仍 await 到 Rust 20s 超时，
  // reqwest 的 Display 吞掉 source 链 → 被 core 当硬错误退出（扫码必失败根因）。
  const signal = opts.signal;
  let onAbort: (() => void) | undefined;
  const abortPromise = signal
    ? new Promise<never>((_, rej) => {
        const fire = (): void => rej(new DOMException("请求已取消", "AbortError"));
        if (signal.aborted) fire();
        else {
          onAbort = fire;
          signal.addEventListener("abort", onAbort, { once: true });
        }
      })
    : null;
  // 45s 超时兜底：Rust reqwest 无默认超时，webvpn 链路偶发悬挂会无限 await
  // （「校外卡死」实录）。到点即弃约解阻塞，后台 Rust 任务自生自灭（有界泄漏）。
  // R17 23.1：调用方显式放大 timeoutMs 时，兜底须更晚，否则又变成传输层抢跑。
  const guardMs = Math.max(45_000, (opts.timeoutMs ?? 0) + 5_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`请求超时（${guardMs / 1000}s）：${url.slice(0, 120)}`)), guardMs);
  });
  try {
    return await Promise.race(abortPromise ? [p, guard, abortPromise] : [p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * 原生浏览器语义通道（2026-09-17 上游对齐）：Rust 共享 reqwest client
 * （cookie_store 原生分域仓 + 原生跟随重定向 limited 25）——等价 RN 的
 * okhttp。重定向跟随/cookie 收发全在原生层，TS 零介入。thu-info-lib
 * 的 platformFetch 走此通道。
 */
/** 原生 cookie 仓清空（换新匿名身份）——被 id 服务器按会话封锁时的自愈 */
/** jar → rust 仓播种：wengine 引导页等「票种在响应体里」的会话（不经
 *  Set-Cookie，rust 侧收不到）。url 为该 cookie 的归属域。 */
export async function nativeSeedCookies(url: string, lines: string[]): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("http_native_seed", { url, lines });
  } catch {
    /* 非 tauri 环境忽略 */
  }
}

export async function nativeCookieClear(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // 域清（id 单点互踢根治）：learn/info/教务/webvpn 的会话票全保，只清死域。
    // 全清曾让重建后各页集体红条几秒（learn/info 会话陪葬要漫游重拉）。
    await invoke("http_native_clear_cookies_domain", {
      suffixes: ["id.tsinghua.edu.cn", "oauth.tsinghua.edu.cn"],
    });
  } catch {
    /* 非 tauri 环境忽略 */
  }
}

export async function nativeFetch(
  url: string,
  init: {
    method?: string;
    body?: string | URLSearchParams | FormData | Uint8Array;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<Response> {
  const { invoke } = await import("@tauri-apps/api/core");
  // body 统一压成 string / base64（2026-09-17 实录：URLSearchParams 直接传会被 invoke
  // 序列化成 map，Rust HttpInput.body 要 string——learn 作业/通知 POST 全灭根因）
  //
  // R21c 真机定案（作业提交 400「Required String parameter 'xszyid' is not present」）：
  // FormData 此前**不在此函数的类型与分支里**，落到 String(body) = "[object FormData]"
  // 发出，且没有 multipart 的 Content-Type → learn 的 Tomcat 直接 400。网络学堂专线
  // （learnHttp）全部请求都走本函数，所以作业/附件提交一直不通；同日 tauriFetch 早前
  // 已修 FormData，两个包装因此长期分叉 —— 现统一到 serializeFetchBody 单一真源。
  const ser = await serializeFetchBody(init.body);
  let bodyStr: string | null = ser.bodyStr;
  let bodyB64: string | null = ser.bodyB64;
  // headers 归一化（2026-09-17 定案）：HttpClient.request 传的是 Headers 类实例，
  // invoke 的 JSON 序列化把它变 {}——Content-Type 全丢，learn 的 Tomcat 对
  // 无 Content-Type 的 POST body 回 400（作业/通知全灭根因）。
  let plainHeaders: Record<string, string> = {};
  if (init.headers) {
    if (typeof Headers !== "undefined" && init.headers instanceof Headers) {
      plainHeaders = Object.fromEntries([...init.headers.entries()]);
    } else if (typeof init.headers === "object") {
      plainHeaders = Object.fromEntries(
        Object.entries(init.headers as Record<string, string>).filter(([, v]) => typeof v === "string"),
      );
    }
  }
  // Content-Type 补默认必须保留（2026-09-17 讨论区回归根因）：#bbsPost 只带
  // X-Requested-With/Referer，不设 Content-Type——裸奔的 form POST 会被 learn
  // Tomcat 回 400。multipart（FormData）同样必须带上 boundary，否则服务器不解析。
  const hasContentType = Object.keys(plainHeaders).some((k) => k.toLowerCase() === "content-type");
  if (!hasContentType && ser.contentType) plainHeaders["Content-Type"] = ser.contentType;
  // lib 原始请求的域名分流（2026-09-17 三案同源定案）：nativeFetch 此前 URL
  // 原样进 rust = 校内域（card/seat.lib/info2021/zhjwxk…）校外直连超时——
  // 圈存「请确认校园网/WebVPN 可达」、图书馆极慢、选课部分链路全栽这里。
  // 包装域名单外的一切 *.tsinghua.edu.cn 统一 webvpnWrap（与 roam 兑付落点
  // 同轨——9-06 已定案 card 会话建在包装通道）；公网可达域直连不动。
  let wireUrl = url;
  try {
    const h = new URL(url).hostname;
    if (
      h.endsWith("tsinghua.edu.cn") &&
      h !== "webvpn.tsinghua.edu.cn" &&
      h !== "id.tsinghua.edu.cn" &&
      h !== "oauth.tsinghua.edu.cn" &&
      h !== "learn.tsinghua.edu.cn" &&
      h !== "mails.tsinghua.edu.cn" &&
      // MadModel 免费档（2026-09-20）：校园网内直连签发 token，webvpn 包装没有意义
      // 且会掩盖失败原因（泵里 direct:true 在应用层这层包装里此前未生效）。
      h !== "madmodel.cs.tsinghua.edu.cn" &&
      !url.startsWith("https://webvpn.tsinghua.edu.cn/")
    ) {
      wireUrl = webvpnWrap(url);
    }
  } catch {
    /* 畸形 URL 原样 */
  }
  const p = invoke<HttpOutput>("http_native", {
    input: {
      url: wireUrl,
      method: init.method ?? "GET",
      headers: plainHeaders,
      body: bodyStr,
      body_b64: bodyB64,
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`请求超时（90s）：${url.slice(0, 120)}`)), 90_000);
  });
  let res: HttpOutput;
  try {
    res = await Promise.race([p, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const respHeaders = new Headers(res.headers as HeadersInit);
  for (const sc of res.set_cookies) {
    try {
      respHeaders.append("set-cookie", sc);
    } catch {
      /* 容忍非法头值 */
    }
  }
  respHeaders.set("x-onethu-final-url", res.url);
  respHeaders.set("x-onethu-set-cookie", JSON.stringify(res.set_cookies));
  if (res.set_cookie_hops) {
    respHeaders.set("x-onethu-set-cookie-hops", JSON.stringify(
      res.set_cookie_hops.map(([u, l]) => ({ u, l })),
    ));
  }
  const bodyInit: BodyInit | null =
    res.status === 204 || res.status === 205 || res.status === 304
      ? null
      : res.body_b64
        ? b64ToBytes(res.body_b64)
        : res.body;
  return new Response(bodyInit, {
    status: res.status,
    statusText: res.status_text,
    headers: respHeaders,
  });
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
export async function tauriFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let currentUrl = url;
  let method = (init.method ?? "GET").toUpperCase();
  // R17 23.1：signal / timeoutMs 为 core 侧扩展字段（FetchLike 的 RequestInit 之外）
  const signal = init.signal ?? undefined;
  const timeoutMs = (init as RequestInit & { timeoutMs?: number }).timeoutMs;
  const headers = collectHeaders(init);
  // R21c：与 nativeFetch 共用同一实现（此前各一份，FormData 只在这里被修过）。
  const ser = await serializeFetchBody(init.body);
  // 302/303 的 POST 转 GET 时会被清空（下方重定向语义），故用 let
  let body: string | undefined = ser.bodyStr ?? undefined;
  let bodyB64: string | undefined = ser.bodyB64 ?? undefined;
  if (ser.contentType) headers["Content-Type"] ??= ser.contentType;
  const redirect = init.redirect ?? "follow";
  // 上游对齐（2026-09-17，读 thu-info-app/packages/thu-info-lib 原源）：RN 的
  // okhttp 原生跟随一切重定向——包括被 302 引回 webvpn 登录页的「舞步」：带着
  // 活会话 cookie 透明转完 wengine→id→oauth 自动回到原 URL 拿数据（透明 SSO）。
  // lib 管线必须走这个语义；dance-break 是 OneTHU 旧管线的蜂窝防互踢补丁，
  // 对 lib 请求关闭（followLoginDance），旧 HttpClient 路径保持不变。
  const followLoginDance = (init as RequestInit & { followLoginDance?: boolean }).followLoginDance === true;
  // lib 登录链（webvpn→oauth→id CAS→check→回调落地）实测 12+ 跳；对齐 vendored
  // lib 的 webvpnRequest maxHops 25（10 曾在链中段打爆：重定向次数超限）
  const maxHops = 25;

  // 逐跳 cookie 记忆（webvpn POC 的 webvpnRequest 做法）：302 中间跳下发的会话 Cookie 绝不能丢。
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

  // 粘性 webvpn 状态：链内只要出现过 webvpn 跳，后续重定向到非公网域一律续包装
  // （非粘性版在链中途路过公网域（id/oauth）时丢失状态 → card/userindex 直连漏兑）
  let chainEverVpn = url.startsWith("https://webvpn.tsinghua.edu.cn/");
  for (let hop = 0; hop <= maxHops; hop++) {
    // 本跳真实域的会话 cookie：包装 URL 解码出原始域（如 wrapped id 跳需要 id 桶
    // 的 JSESSIONID，否则 CAS 看不到 SSO 会话、链条断在登录页——POC 的扁平 jar 天然带上）
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

    const res = await invokeHttp(currentUrl, method, headers, body, bodyB64, { signal, timeoutMs });
    hopLogger?.(
      currentUrl,
      res.status,
      [...pairs.keys()].join(",") + " ←新发[" + (res.set_cookies ?? []).map((sc) => sc.replace(/;.*$/, "").slice(0, 46)).join(" | ") + "]",
    );

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
        let nextUrl = new URL(location, currentUrl).toString();
        // 舞步检测（2026-09-13 蜂窝实录）：webvpn 会话死时，各包装请求各自被 302
        // 进 webvpn 登录舞 → N 条并行舞各自落地新 wengine 票据互烧 → 会话永远半死
        // （每 2s 一轮 XK-DANCE、恢复成功 43s 又死）。停跳打标交上层单飞重建；
        // 合法舞者（登录链）走 manual 逐跳不受影响。
        // lib 登录链例外（2026-09-16 真机实录）：oauth 兑付落点
        // /login?oauth_login=true&code=… 是登录流程本身的最后一跳（服务端兑付
        // code 后再 302 到门户落地页）——误判成死舞步会把登录链掐死在半空
        // （症状：GET 重定向次数超限，末跳=…code=…）。带 code= 视为合法落点继续跟随。
        if (
          !followLoginDance &&
          nextUrl.startsWith("https://webvpn.tsinghua.edu.cn/login") &&
          !/[?&]code=/.test(nextUrl)
        ) {
          respHeaders.set("x-onethu-auth-dance", "webvpn-login");
          currentUrl = nextUrl;
          break;
        }
        if (nextUrl.startsWith("https://webvpn.tsinghua.edu.cn/")) chainEverVpn = true;
        if (chainEverVpn && hopUrlWrapper && !nextUrl.startsWith("https://webvpn.tsinghua.edu.cn/")) {
          nextUrl = hopUrlWrapper(nextUrl);
        }
        currentUrl = nextUrl;
        // 浏览器语义：303 一律转 GET；301/302 的 POST 转 GET（307/308 保持原样）
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = undefined;
          bodyB64 = undefined;
        }
        continue;
      }
    }

    // 204/205/304 是 fetch 规范的「无体状态」：Response 构造器带 body（哪怕是空串）直接
    // TypeError「Response cannot have a body with the given status」。CalDAV PUT 覆盖/
    // DELETE 成功都回 204（创建才是 201），此前云端修改与删除全灭于此——必须归零为 null。
    const bodyInit: BodyInit | null =
      res.status === 204 || res.status === 205 || res.status === 304
        ? null
        : res.body_b64 ? b64ToBytes(res.body_b64) : res.body;
    return new Response(bodyInit, {
      status: res.status,
      statusText: res.status_text,
      headers: respHeaders,
    });
  }

  throw new Error(`重定向次数超限（${maxHops}）末跳=${currentUrl.slice(0, 140)}`);
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

/**
 * 错误的可读提示。
 *
 * 关键点：**Tauri 命令是用字符串 reject 的**（Rust 侧 `Err("会话已失效…")`），
 * 那些值不是 Error 实例。曾经这里只认 `err instanceof Error`，于是所有原生错误
 * （会话失效 / HTTP 403 / 文件过大 / 空文件）统统显示成「未知网络错误」——
 * 真话被吞掉，排查只能靠猜。现在先把任意形态的 err 归一成一句话，再场景化。
 *
 * 归一（`rawErrorText`）与「会话失效」判定（`isSessionExpiredError`）已挪到
 * `lib/sessionErrors.ts`：那是零依赖叶子模块，单测能直接 import（本文件会把整个
 * `@onethu/core` 拖进来，Node 的类型剥离跑不动 core 的参数属性语法）。
 */
export { rawErrorText, isSessionExpiredError } from "./sessionErrors.js";
import { rawErrorText } from "./sessionErrors.js";

/** 最近一次界面报错的原文（只随「复制诊断摘要」带出，不自动上报） */
let lastRawError = "";
export function lastErrorText(): string {
  return lastRawError;
}

export function explainNetworkError(err: unknown): string {
  const raw = rawErrorText(err).trim();
  lastRawError = raw;
  if (!raw) return "操作失败（原生未给出原因，可到「设置 → 诊断」看日志）";
  // 原生侧的大小闸门：说清多大、该怎么办，而不是丢一个网络错误
  const big = /too-large:(\d+):(\d+)/.exec(raw);
  if (big) {
    const mb = (n: string): string => `${(Number(n) / 1024 / 1024).toFixed(1)} MB`;
    return `文件较大（${mb(big[1]!)}），应用内预览上限 ${mb(big[2]!)}——请改用「下载」或「另存为」。`;
  }
  if (/会话已失效|需要重新登录|未登录/.test(raw)) {
    // 修文案重复（2026-09-23，用户截图为证）：原样套前缀会把
    // 「会话已失效，需要重新登录」变成「会话已失效：会话已失效，需要重新登录（…）」，
    // 既重复又不提供任何新信息。现在只补一句可操作的下一步，且不重复补。
    const advice = "下拉刷新即可重试；若持续出现，到「设置 → 账户」重新登录。";
    if (raw === "会话已失效，需要重新登录") return advice;
    const clean = raw.replace(/^会话已失效[：:]\s*/, "");
    if (/重新登录|下拉刷新/.test(clean)) return clean;
    return `${/。[）」]$/.test(clean) ? clean : clean + "。"}${advice}`;
  }
  if (/^HTTP \d{3}/.test(raw)) {
    return `${raw}：服务端拒绝了这次请求（登录态过期或该文件无权限）`;
  }
  if (!isTauri && /fetch|network|Failed to fetch/i.test(raw)) {
    return "浏览器预览不支持直连校园网（CORS 拦截）。请运行桌面端：pnpm tauri:dev。";
  }
  if (/网络错误|timed? ?out|timeout/i.test(raw)) {
    return "网络超时：请确认校园网 / WebVPN 可达。";
  }
  return raw;
}
