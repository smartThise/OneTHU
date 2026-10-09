/**
 * 云盘自动连接（SSO 漫游爬 profile 页的 Web API Token）。
 *
 * 用户已登录 OneTHU（id.tsinghua 会话在 jar）→ GET cloud.tsinghua.edu.cn/profile/
 * 时 CAS 自动发票落 seahub session → 页面里的 token（两种形态都兼容）提取 →
 * setSeafileToken 校验落盘。失败如实报因（无 SSO 会话/页面改版），绝不猜。
 *
 * 形态 A（老模板）：token 渲染在 <input>/<span>（40 位 hex）
 * 形态 B（SPA）：var app = {pageOptions: {..., apiToken: "hex40"}}
 */
import { http } from "../lib/clients.js";
import { logLine } from "../lib/clients.js";
import { setSeafileToken, type SeafileAccount } from "./seafile.js";

const PROFILE_URL = "https://cloud.tsinghua.edu.cn/profile/";

/** Seafile Web API Token = 40 位 hex */
const HEX40 = /[0-9a-f]{40}/;

function extractToken(html: string): string | null {
  // 形态 B：pageOptions.apiToken（SPA）
  const m =
    /apiToken["']?\s*[:=]\s*["']([0-9a-f]{40})["']/i.exec(html) ??
    /["']?api_token["']?\s*[:=]\s*["']([0-9a-f]{40})["']/i.exec(html);
  if (m?.[1]) return m[1];
  // 形态 A：input/span 里裸 40hex，且上下文含 token 字样（防误匹配其他 hash）
  const ctx = /(?:value|id|class)\s*=\s*["'][^"']*token[^"']*["'][^>]*value\s*=\s*["']([0-9a-f]{40})["']/i.exec(html);
  if (ctx?.[1]) return ctx[1];
  const span = />([0-9a-f]{40})</.exec(
    (html.match(/<[^>]*(?:token|auth)[^>]*>[^<]*[0-9a-f]{0,40}[^<]*<\/[^>]*>/i)?.[0] ?? ""),
  )?.[1];
  if (span) return span;
  return null;
}

export interface AutoConnectResult {
  ok: boolean;
  account?: SeafileAccount;
  error?: string;
}

/** SSO 漫游 → 抓 profile → 提取 token → 校验落盘（幂等：已连接直接返回） */
export async function autoConnectSeafile(): Promise<AutoConnectResult> {
  try {
    const res = await http.request(PROFILE_URL, { redirect: "follow" });
    const finalUrl = res.headers.get("x-onethu-final-url") ?? PROFILE_URL;
    const body = await res.text();
    // 没建立起云盘会话（被弹回统一认证登录页 = id 会话不在/过期）
    if (/id\.tsinghua\.edu\.cn|sm2publicKey|authLogin/.test(finalUrl + body.slice(0, 2000))) {
      return { ok: false, error: "SSO 会话不可用（请先重新登录 OneTHU 再试）" };
    }
    const token = extractToken(body);
    if (!token) {
      void logLine(
        `[SEAFILE-AUTO] profile 页未找到 token（finalUrl=${finalUrl.slice(0, 80)} len=${body.length}）`,
      ).catch(() => undefined);
      return { ok: false, error: "profile 页未找到 token（页面形态未知，请在云盘页手动粘贴一次）" };
    }
    const account = await setSeafileToken(token);
    void logLine(`[SEAFILE-AUTO] 云盘已自动连接：${account.name}（${account.email}）`).catch(() => undefined);
    return { ok: true, account };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
