import type { HttpClient } from "../http.js";
import { INFO_PREFIX } from "./urls.js";

const gatewayControl = (name: string): boolean =>
  name === "wengine_vpn_ticket" || name.startsWith("show_") || name === "heartbeat" || name === "refresh";
const attribute = /^(?:domain|path|expires|max-age|secure|httponly|samesite|partitioned)$/i;

/** Merge the gateway's Info cookie body into the same application scopes used
 * by HTTP responses and desktop/CLI handoff. This body contains application
 * cookies, so it cannot replace gateway authentication or cookie attributes. */
export async function mergeInfoCookieBody(
  http: Pick<HttpClient, "jar" | "nativeSeedHook">,
  body: string,
  options: { assertCurrent?: () => void | Promise<void>; nativeEpoch?: number } = {},
): Promise<string | undefined> {
  if (/[<>\0]/.test(body)) return undefined;
  const physical = new URL(`${INFO_PREFIX}/`);
  const targets = [
    { url: new URL("https://info.tsinghua.edu.cn/"), path: "/" },
    { url: physical, path: physical.pathname },
  ];
  let csrf: string | undefined;
  for (const part of body.split(/[;\r\n]/)) {
    const pair = part.trim();
    // Cookie octets, with the quoted-value form used by RFC 6265. CRLF is a
    // pair separator, never an injectable Set-Cookie/header attribute.
    const match = /^([A-Za-z0-9_.%-]+)=([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*|"[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*")$/.exec(pair);
    if (!match || gatewayControl(match[1]!) || attribute.test(match[1]!)) continue;
    for (const target of targets) {
      await options.assertCurrent?.();
      await http.nativeSeedHook?.(target.url.href, pair, target.path, options.nativeEpoch);
      // A native seed can await IPC while logout changes the account. Check
      // again before adding this response to the JavaScript session mirror.
      await options.assertCurrent?.();
      const previous = http.jar.getCookies(target.url).find(cookie =>
        cookie.name === match[1] && cookie.value === match[2] &&
        cookie.domain === target.url.hostname && cookie.path === target.path);
      // A Cookie header carries no HttpOnly attributes. Preserve provenance
      // only for the exact unchanged record; a new value remains unknown.
      http.jar.setRaw(target.url, `${pair}; Path=${target.path}; Secure`, { httpOnly: previous?.httpOnly ?? null });
    }
    if (match[1] === "XSRF-TOKEN" && match[2]) csrf = match[2];
  }
  return csrf;
}
