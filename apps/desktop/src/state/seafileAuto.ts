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
    const { session, currentFingerprint } = await import("../lib/clients.js");
    void logLine(`[SEAFILE-AUTO] 开始：GET profile（带 jar，follow）`).catch(() => undefined);
    let res = await http.request(PROFILE_URL, { redirect: "follow" });
    let finalUrl = res.headers.get("x-onethu-final-url") ?? PROFILE_URL;
    let body = await res.text();

    // checkSingle 确认续用（venue R10 同款实测坑）：云盘 OAuth 经 id 统一认证时，
    // wengine 侧 id 会话与直连会话并存 → id 出「确认续用」壳页（len~917）。
    // 不是没登录！POST 确认（i_rememberme+指纹+隐藏字段）后续用会话，再取一次 profile。
    if (/login\/checkSingle|id="logined"/.test(body)) {
      const fields: Record<string, string> = {
        i_rememberme: "on",
        fingerPrint: await currentFingerprint(),
        fingerGenPrint: session.finger3 ?? "",
      };
      const reH = /<input[^>]*type="hidden"[^>]*name="([^"]*)"[^>]*value="([^"]*)"/g;
      let mh: RegExpExecArray | null;
      while ((mh = reH.exec(body)) !== null) fields[mh[1]!] = mh[2]!;
      void logLine(`[SEAFILE-AUTO] 遇 checkSingle 确认页 → 续用会话`).catch(() => undefined);
      res = await http.request("https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle", {
        method: "POST",
        body: new URLSearchParams(fields),
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        redirect: "follow",
      });
      finalUrl = res.headers.get("x-onethu-final-url") ?? "";
      body = await res.text();
      // 确认后链路应走完 OAuth 回调 → 需要再取一次 profile 拿真页面
      if (!/profile/.test(finalUrl)) {
        res = await http.request(PROFILE_URL, { redirect: "follow" });
        finalUrl = res.headers.get("x-onethu-final-url") ?? PROFILE_URL;
        body = await res.text();
      }
    }

    void logLine(
      `[SEAFILE-AUTO] 拿到页面：finalUrl=${finalUrl.slice(0, 100)} len=${body.length} ` +
        `consent=${/authorize|consent|同意|allow/i.test(body.slice(0, 3000)) ? 1 : 0} ` +
        `htmlTitle=${/<title>([^<]{0,60})</i.exec(body)?.[1] ?? "?"}`,
    ).catch(() => undefined);
    // 真·登录表单（sm2 公钥在 = id 会话确实不在）——区别于上面的 checkSingle 壳页
    if (/sm2publicKey/.test(body) || /login\/form/.test(finalUrl)) {
      return { ok: false, error: "SSO 会话不可用（请先重新登录 OneTHU 再试）" };
    }
    // OAuth 授权确认页（清华云盘走 thu-oauth 授权码流，首次需用户同意一次）
    if (/oauth\.tsinghua\.edu\.cn/.test(finalUrl) || /同意|授权|allow|approve/i.test(body.slice(0, 3000))) {
      return {
        ok: false,
        error: "需要首次授权：云盘登录走清华 OAuth，请先在浏览器/App 里打开一次 cloud.tsinghua.edu.cn 并点「同意授权」（之后即静默）",
      };
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
