/**
 * 临时来访人员报备（visit.tsinghua.edu.cn/visitor/mobile）桌面装配：
 * - VisitClient + 登录态生命周期（本机保存 token 与会话 cookie，JWT 到期即视为未登录）
 * - visitEnsureLogin：本机记住了账号密码时走统一身份直连登录（受信指纹生效则零二次验证）
 * 与 lib/xiaoda.ts 同款；凭据与指纹是应用级基础设施，不额外新增账号体系。
 */
import { VisitAuthRequiredError, VisitClient, visitTokenExpiresAt, type VisitSessionState, type VisitUser } from "@onethu/core";
import { nativeFetch } from "./transport.js";
import { logLine } from "./clients.js";

const SESSION_KEY = "onethu.visitSession";

function readStored(): VisitSessionState | null {
  try {
    const raw = globalThis.localStorage?.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as VisitSessionState;
    if (!s?.token) return null;
    const exp = visitTokenExpiresAt(s.token);
    if (exp !== null && exp <= Date.now()) return null; // 过期视为未登录
    return s;
  } catch {
    return null;
  }
}

export const visitClient = new VisitClient({
  fetch: (u, init) => nativeFetch(String(u), init as Parameters<typeof nativeFetch>[1]),
  log: (line) => void logLine(line),
});
const stored = readStored();
if (stored) visitClient.setSession(stored);

function persist(): void {
  try {
    globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(visitClient.session()));
  } catch {
    /* 落盘尽力而为 */
  }
}

export function visitHasSession(): boolean {
  return readStored() !== null || visitClient.hasToken();
}

/** One-use official ticket, scoped to the registered visitor service. */
export async function visitGatewayTicket() {
  const {loadRemembered,currentFingerprint,session}=await import('./clients.js');
  const owner=session.username,fingerprint=await currentFingerprint(),remembered=await loadRemembered();
  if(!owner||session.state!=='ready'||remembered&&remembered.username!==owner)throw new Error('AUTH_SESSION_CONFLICT');
  const ticket=await visitClient.authorizeTicket(remembered?.username,remembered?.password,fingerprint,session.finger3??'');
  if(session.username!==owner||session.state!=='ready'||session.fingerprint!==fingerprint)throw new Error('AUTH_SESSION_CHANGED');
  return ticket;
}

/** 保存登录态（宿主从官方页面回跳里换到之后调用） */
export function visitSaveSession(s: VisitSessionState): void {
  visitClient.setSession(s);
  persist();
}

export function visitSignOut(): void {
  visitClient.setSession(null);
  try {
    globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 确保已登录：有登录态先验活（拉一次功能目录）；否则用本机记住的账号密码直连登录 */
export async function visitEnsureLogin(): Promise<VisitUser | null> {
  if (visitClient.hasToken()) {
    const exp = visitClient.tokenExpiresAt();
    if (exp === null || exp > Date.now()) {
      try {
        await visitClient.menus();
        return visitClient.getUser();
      } catch (e) {
        if (!(e instanceof VisitAuthRequiredError)) throw e;
        // 登录态失效 → 落到完整登录
      }
    }
  }
  const { loadRemembered, currentFingerprint, session } = await import("./clients.js");
  const owner = session.username;
  const remembered = await loadRemembered();
  if (!owner || remembered && remembered.username !== owner) throw new Error("AUTH_SESSION_CONFLICT");
  const fingerprint = await currentFingerprint();
  const user = await visitClient.login(remembered?.username, remembered?.password, fingerprint, session.finger3 ?? "");
  if (session.username !== owner || session.state !== "ready") throw new Error("AUTH_SESSION_CHANGED");
  persist();
  return user;
}
