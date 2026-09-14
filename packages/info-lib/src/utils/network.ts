/**
 * thu-info-lib 网络层（OneTHU 移植版，MIT © 2023 UNIDY2002）。
 *
 * 移植要点（2026-09-14 硬换数据层）：
 * - 原版依赖 cross-fetch + 自维护扁平 cookie 表（浏览器模式下靠原生 cookie 存储）；
 *   OneTHU 运行在 Tauri WebView，fetch 受 CORS 限制，必须走 Rust reqwest 连接池
 *   （今晚已实测：SSO 跳转 3s→65ms）。
 * - 因此本文件把「发请求」抽成可注入的 platformFetch，由 app 启动时注入
 *   tauriFetch 适配器；cookie 的存储/发送/重定向跟随全部由平台传输层
 *   （域名感知 cookie jar）负责，本文件不再自维护 cookie。
 * - 业务逻辑（SSO 链、roamingWrapper 重试阶梯、页面解析）零改动。
 */

export class ResponseStatusError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

/** 平台请求结果（文本化；二进制走 base64） */
export interface PlatformResponse {
    status: number;
    headers: Array<[string, string]>;
    text: string;
    finalUrl: string;
}

export type PlatformFetch = (
    url: string,
    init: { method?: string; body?: string; headers: Record<string, string>; timeoutMs?: number },
) => Promise<PlatformResponse>;

let platformFetchImpl: PlatformFetch | null = null;

/** app 启动时注入平台传输（未注入即抛错，防止静默走错通道） */
export const setPlatformFetch = (impl: PlatformFetch) => {
    platformFetchImpl = impl;
};

export const cookies: { [key: string]: string } = {};

let platformClearCookies: (() => void) | null = null;
export const setPlatformClearCookies = (fn: () => void) => {
    platformClearCookies = fn;
};

/** 清 cookie（登录前调用；委托平台 jar） */
export const clearCookies = () => {
    Object.keys(cookies).forEach((key) => delete cookies[key]);
    platformClearCookies?.();
};

/** 手动种 cookie（少数业务用；同时进平台 jar 的责任在注入方） */
export const setCookie = (key: string, value: string) => {
    cookies[key] = value;
};

/** 任意字符集的 encodeURIComponent（原版逻辑，中文按 GBK 等逐字编码） */
export const arbitraryEncode = (s: string, encoding = "UTF-8"): string =>
    encoding === "UTF-8"
        ? encodeURIComponent(s)
        : String(s)
              .split("")
              .map((ch) => {
                  if (/^[\u4e00-\u9fa5]$/.test(ch)) {
                      try {
                          return iconvLite
                              .encode(ch, encoding)
                              .reduce((a: string, b: number) => a + "%" + b.toString(16), "");
                      } catch {
                          return ch;
                      }
                  }
                  return ch;
              })
              .join("");

export const stringify = (form: Record<string, unknown>, paramEncoding = "UTF-8"): string =>
    Object.keys(form)
        .map((key) => `${arbitraryEncode(key, paramEncoding)}=${arbitraryEncode(form[key] as string, paramEncoding)}`)
        .join("&");

/** 原版 uFetch：GET/POST 文本化取回（字符集/编码由平台传输负责） */
export const uFetch = async (
    url: string,
    post?: object,
    timeout = 60000,
    paramEncoding = "UTF-8",
    serialized = false,
    requestContentType = "application/x-www-form-urlencoded",
): Promise<string> => {
    if (!platformFetchImpl) {
        throw new Error("platformFetch 未注入（app 启动时须调 setPlatformFetch）");
    }
    const headers: Record<string, string> = {
        "Content-Type": requestContentType,
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    const init: { method?: string; body?: string; headers: Record<string, string>; timeoutMs?: number } = {
        headers,
        timeoutMs: timeout,
    };
    if (post !== undefined) {
        init.method = "POST";
        init.body = serialized ? (post as unknown as string) : stringify(post as Record<string, unknown>, paramEncoding);
    }
    const response = await platformFetchImpl(url, init);
    if (response.status !== 200 && response.status !== 201) {
        let path = url;
        try {
            const queryBegin = path.lastIndexOf("?");
            if (queryBegin !== -1) path = path.substring(0, queryBegin);
            if (path.endsWith("/")) path = path.substring(0, path.length - 1);
            path = path.substring(path.lastIndexOf("/") + 1);
        } catch {
            throw new ResponseStatusError(`Unexpected response status code: ${response.status}`, response.status);
        }
        throw new ResponseStatusError(`Unexpected response status code: ${response.status} (${path})`, response.status);
    }
    return response.text;
};

/** 原版 getRedirectUrl：跟随重定向取最终 URL（平台传输自动跟随并回传 finalUrl） */
export const getRedirectUrl = async (url: string, timeout = 60000): Promise<string> => {
    if (!platformFetchImpl) {
        throw new Error("platformFetch 未注入");
    }
    const response = await platformFetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeoutMs: timeout,
    });
    return response.finalUrl || url;
};

/** 平台裸请求（供个别模块做二进制取回：text 为 base64 时由调用方解码） */
export const platformFetchRaw = async (
    url: string,
    timeout = 60000,
): Promise<PlatformResponse> => {
    if (!platformFetchImpl) {
        throw new Error("platformFetch 未注入");
    }
    return platformFetchImpl(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeoutMs: timeout,
    });
};
