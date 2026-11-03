/** Private desktop -> resident runtime bridge. Never expose session snapshots to
 * plugins, HTTP clients, logs or model results. Android keeps its in-app host. */
import { webvpnWrap, PUBLIC_DIRECT_HOSTS, type CookieRecord, type SessionData } from "@onethu/core";
import { isTauri } from "./transport.js";
import { isAndroidNavigator } from "./androidHost.js";

export interface SharedRuntimeStatus {
  protocolVersion: 1;
  username: string | null;
  epoch: number;
  session: { state: string; username?: string; authenticated?: boolean; twoFactor?: { pending?: boolean } };
  policy: { enabled: boolean; appEnabled?: boolean; automatic: boolean; confirmationMode?: string; configured?: boolean };
  bootstrapAllowed?: boolean;
  tombstone?: boolean;
}
export interface SharedSessionSnapshot extends SharedRuntimeStatus { snapshot: SessionData | null }
export interface NativeSessionCookie extends CookieRecord { httpOnly?: boolean }
export async function exportNativeSessionCookies(): Promise<{ revision: number; cookies: NativeSessionCookie[] }> {
  if (!usesSharedRuntime()) throw new Error("CLI_DAEMON_DESKTOP_REQUIRED");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("cli_session_cookies_export");
}
/** Keep direct service sessions absent from the daemon only when both durable
 * owners match. The daemon still owns every overlapping cookie and gateway
 * cookie. A logout, unknown owner or account switch always replaces the jar. */
export function mergeSameAccountServiceCookies(incoming: NativeSessionCookie[], existing: NativeSessionCookie[], nativeOwner: string | null, verifiedOwner: string | null): NativeSessionCookie[] {
  if (!nativeOwner || nativeOwner !== verifiedOwner) return incoming;
  const key = (c: NativeSessionCookie) => `${c.domain}\n${c.path}\n${c.name}`;
  const seen = new Set(incoming.map(key));
  const retained = existing.filter(c => c.domain.endsWith(".tsinghua.edu.cn") && c.domain !== "webvpn.tsinghua.edu.cn"
    && c.name !== "wengine_vpn_ticket" && !c.name.startsWith("show_") && c.name !== "heartbeat" && c.name !== "refresh"
    && (c.expiresAt === undefined || c.expiresAt > Date.now()) && !seen.has(key(c)));
  return [...incoming, ...retained];
}
export async function importNativeSessionCookies(cookies: NativeSessionCookie[], expectedRevision: number): Promise<number> {
  if (!usesSharedRuntime()) throw new Error("CLI_DAEMON_DESKTOP_REQUIRED");
  // SDK clients also keep logical-domain cookies. Rust sends the physical
  // WebVPN request, so supply application-scoped copies without replacing any
  // authoritative physical cookie already returned by the daemon.
  const native = new Map<string, NativeSessionCookie>();
  const key = (cookie: NativeSessionCookie) => `${cookie.domain}\n${cookie.path}\n${cookie.name}`;
  for (const cookie of cookies) {
    if (cookie.domain === "tsinghua.edu.cn" || PUBLIC_DIRECT_HOSTS.has(cookie.domain) || !cookie.domain.endsWith(".tsinghua.edu.cn")) continue;
    if (cookie.name === "wengine_vpn_ticket" || cookie.name.startsWith("show_") || cookie.name === "heartbeat" || cookie.name === "refresh") continue;
    const wrapped = new URL(webvpnWrap(`https://${cookie.domain}${cookie.path}`));
    const physical = { ...cookie, domain: wrapped.hostname, path: wrapped.pathname, hostOnly: true, secure: true };
    native.set(key(physical), physical);
  }
  for (const cookie of cookies) native.set(key(cookie), cookie);
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<{ revision: number }>("cli_session_cookies_import", { cookies: [...native.values()], expectedRevision });
  return result.revision;
}
export const desktopCliSupported = () => isTauri && !isAndroidNavigator(typeof navigator === "undefined" ? undefined : navigator);
export interface CliInstallation { installed: boolean; available: boolean; version?: string; expectedVersion: string }
let installation: CliInstallation | null = null;
let installationReady: Promise<void> | undefined;
let retirementBlocked = false;
export const appTaskRuntimeSafe = () => !retirementBlocked;
export const usesSharedRuntime = () => desktopCliSupported() && installation?.available === true;
export const cliInstallationSnapshot = () => installation;
export async function initCliInstallation(): Promise<void> {
  if (!desktopCliSupported()) return;
  return installationReady ??= import("@tauri-apps/api/core").then(async ({ invoke }) => {
    installation = await invoke<CliInstallation>("cli_package_prepare"); retirementBlocked = false;
  }).catch(() => { installationReady = undefined; retirementBlocked = true; });
}
export async function refreshCliInstallation(): Promise<CliInstallation | null> {
  if (!desktopCliSupported()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  installation = await invoke<CliInstallation>("cli_package_status");
  return installation;
}
let transferBusy=false;
export const isCliTransferBusy=()=>transferBusy;
export async function changeCliInstallation(action: "install" | "uninstall"): Promise<void> {
  if (!desktopCliSupported()) throw new Error("CLI_DAEMON_DESKTOP_REQUIRED");
  const { invoke } = await import("@tauri-apps/api/core");
  if(transferBusy)throw new Error("CLI_TRANSFER_BUSY");
  transferBusy=true;let retired=false;
  try {
    if(action==="install")await (await import("../state/cliTasks.js")).pauseAppTasksForInstall();
    if (action === "uninstall" && usesSharedRuntime()) {
      retired=true;await (await import("../state/cliTasks.js")).saveResidentTasksBeforeUninstall();
      await (await import("../state/sharedCalendar.js")).exportCalendarToApp();
      await (await import("./clients.js")).detachInstalledCli();
    }
    await invoke(`cli_package_${action}`);
    ensuring = undefined;
    await refreshCliInstallation();retirementBlocked=false;
    if (action === "install") await (await import("./clients.js")).connectInstalledCli();
  }catch(error){
    if(retired&&usesSharedRuntime()){
      try{const guard=await sharedAccountGuard((await import("./clients.js")).session.username);await sharedRuntimeRequest("unretire",guard);}catch{/* Retained profile is recoverable on the next explicit retry. */}
    }
    throw error;
  }finally{transferBusy=false;window.dispatchEvent(new Event("onethu-cli-installation"));}
}

let ensuring: Promise<void> | undefined;
let current: SharedRuntimeStatus | null = null;
const listeners = new Set<(status: SharedRuntimeStatus, previous: SharedRuntimeStatus | null) => void>();
export function sharedRuntimeSnapshot() { return current; }
export function subscribeSharedRuntime(fn: (status: SharedRuntimeStatus, previous: SharedRuntimeStatus | null) => void) {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
function observe<T extends SharedRuntimeStatus>(status: T): T {
  if (status?.protocolVersion !== 1 || typeof status.epoch !== "number" || !(status.username === null || typeof status.username === "string") || !status.policy) throw new Error("CLI_DAEMON_PROTOCOL_MISMATCH");
  // Retain public status only. Cookies and trust credentials stay in the caller.
  const previous = current;
  current = { protocolVersion: 1, username: status.username, epoch: status.epoch,
    session: status.session, policy: status.policy, bootstrapAllowed: status.bootstrapAllowed, tombstone: status.tombstone };
  for (const fn of listeners) fn(current, previous);
  return status;
}
export async function ensureSharedRuntime(): Promise<void> {
  if (!usesSharedRuntime()) throw new Error("CLI_DAEMON_DESKTOP_REQUIRED");
  if (!ensuring) {
    const request = import("@tauri-apps/api/core").then(async ({ invoke }) => { await invoke("cli_daemon_ensure"); });
    ensuring = request;
    void request.catch(() => { if (ensuring === request) ensuring = undefined; });
  }
  return ensuring;
}
export async function sharedRuntimeRequest<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  await ensureSharedRuntime();
  const { invoke } = await import("@tauri-apps/api/core");
  try { return await invoke<T>("cli_daemon_request", { method: `desktop.${method}`, params }); }
  catch (error) {
    // The next explicit call may restart/reconnect the host. Never replay the
    // failed request: a mutation could have reached its destination already.
    ensuring = undefined;
    if ((method === "status" || method === "exportSession") && /CLI_DAEMON_(?:NOT_RUNNING|UNAVAILABLE|CONNECTION_INTERRUPTED)/.test(String(error))) {
      await ensureSharedRuntime();
      try { return await invoke<T>("cli_daemon_request", { method: `desktop.${method}`, params }); }
      catch (retryError) { ensuring = undefined; throw retryError; }
    }
    throw error;
  }
}
export async function getSharedRuntimeStatus(): Promise<SharedRuntimeStatus> { return observe(await sharedRuntimeRequest<SharedRuntimeStatus>("status")); }
export async function exportSharedSession(): Promise<SharedSessionSnapshot> { return observe(await sharedRuntimeRequest<SharedSessionSnapshot>("exportSession")); }
export async function adoptSharedSession(snapshot: SessionData, expectedEpoch: number, reason: "bootstrap" | "login"): Promise<SharedSessionSnapshot> {
  observe(await sharedRuntimeRequest<SharedRuntimeStatus>("adoptSession", { snapshot, expectedEpoch, reason }));
  return exportSharedSession();
}
export async function logoutSharedSession(expectedAccount: string | null, expectedEpoch: number): Promise<void> {
  observe(await sharedRuntimeRequest<SharedRuntimeStatus>("logout", { expectedAccount, expectedEpoch }));
}
export async function updateSharedPolicy(enabled: boolean, automatic: boolean, expected?: { expectedAccount: string | null; expectedEpoch: number }): Promise<SharedRuntimeStatus> {
  const status = await getSharedRuntimeStatus();
  if (expected && (status.username !== expected.expectedAccount || status.epoch !== expected.expectedEpoch)) throw new Error("CLI_SHARED_SESSION_CHANGED");
  return observe(await sharedRuntimeRequest<SharedRuntimeStatus>("policy", { enabled, automatic, appEnabled: (await import("../state/privacyConsent.js")).ohAuthorized(),
    expectedAccount: status.username, expectedEpoch: status.epoch }));
}
export async function sharedAccountGuard(username: string): Promise<{ expectedAccount: string; expectedEpoch: number }> {
  const status = await getSharedRuntimeStatus();
  if (!username || status.username !== username || status.session.state !== "ready") throw new Error("CLI_SHARED_SESSION_CHANGED");
  return { expectedAccount: username, expectedEpoch: status.epoch };
}
export async function callSharedOperation(operation: string, args: unknown[], username: string, confirm = false, expectedEpoch?: number): Promise<unknown> {
  const guard = await sharedAccountGuard(username);
  if (expectedEpoch !== undefined && guard.expectedEpoch !== expectedEpoch) throw new Error("CLI_SHARED_SESSION_CHANGED");
  return sharedRuntimeRequest("call", { operation, args, confirm, ...guard });
}
