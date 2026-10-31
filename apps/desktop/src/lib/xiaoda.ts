/**
 * 清小搭（xiaoda.tsinghua.edu.cn 校园 AI 学伴）桌面装配：
 * - XiaodaClient + token 生命周期（localStorage 持久化 + JWT exp 校验，venue 同款）
 * - xiaodaEnsureLogin：token 缺失/过期时用本机记住的 OneTHU 凭据 + 受信指纹
 *   走 ITS 直连完整登录（受信指纹生效则零 2FA）
 * 实验页专用（不与其他 OneTHU 功能联动，凭据/指纹是应用级基础设施）。
 */
import { XiaodaClient, XiaodaAuthRequiredError, xiaodaTokenExpiresAt, type XiaodaUser } from "@onethu/core";
import { nativeFetch } from "./transport.js";
import { logLine } from "./clients.js";

const TOKEN_KEY = "onethu.xiaodaToken";

function readStoredToken(): string | null {
  try {
    const t = globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
    if (!t) return null;
    const exp = xiaodaTokenExpiresAt(t);
    if (exp !== null && exp <= Date.now()) return null; // 过期视为无 token
    return t;
  } catch {
    return null;
  }
}

export const xiaodaClient = new XiaodaClient({
  fetch: (u, init) => nativeFetch(String(u), init as Parameters<typeof nativeFetch>[1]),
  log: (line) => void logLine(line),
});
const storedToken = readStoredToken();
if (storedToken) xiaodaClient.setToken(storedToken);

export function xiaodaHasToken(): boolean {
  return readStoredToken() !== null || xiaodaClient.hasToken();
}

/** One-use official ticket for the private gateway; never redeemed/stored here. */
export async function xiaodaGatewayTicket() {
  const {loadRemembered,currentFingerprint,session}=await import('./clients.js');
  const owner=session.username,fingerprint=await currentFingerprint(),remembered=await loadRemembered();
  if(!owner||session.state!=='ready'||remembered&&remembered.username!==owner)throw new Error('AUTH_SESSION_CONFLICT');
  const ticket=await xiaodaClient.authorizeTicket(remembered?.username,remembered?.password,fingerprint,session.finger3??'');
  if(session.username!==owner||session.state!=='ready'||session.fingerprint!==fingerprint)throw new Error('AUTH_SESSION_CHANGED');
  return ticket;
}

/** 确保已登录：有 token 先验活（getUserInfo）；否则用记住的凭据完整登录 */
export async function xiaodaEnsureLogin(): Promise<XiaodaUser> {
  if (xiaodaClient.hasToken()) {
    const exp = xiaodaClient.tokenExpiresAt();
    if (exp === null || exp > Date.now()) {
      try {
        return await xiaodaClient.getUserInfo();
      } catch (e) {
        if (!(e instanceof XiaodaAuthRequiredError)) throw e;
        // token 失效 → 落到完整登录
      }
    }
  }
  const { loadRemembered, currentFingerprint, session } = await import("./clients.js");
  const owner = session.username;
  const remembered = await loadRemembered();
  if (!owner || remembered && remembered.username !== owner) throw new Error("AUTH_SESSION_CONFLICT");
  const fingerprint = await currentFingerprint();
  // 密码可能没有（未勾选「记住密码」）——先走「已认证 id 会话漫游出票」（不吃密码）；
  // 只有真需要账号密码时（表单带 SM2 公钥）才报「未记住密码」的明确提示。
  const user = await xiaodaClient.login(
    remembered?.username,
    remembered?.password,
    fingerprint,
    session.finger3 ?? "",
  );
  if (session.username !== owner || session.state !== "ready") throw new Error("AUTH_SESSION_CHANGED");
  try {
    globalThis.localStorage?.setItem(TOKEN_KEY, xiaodaClient.getToken());
  } catch {
    /* 持久化尽力而为 */
  }
  return user;
}
