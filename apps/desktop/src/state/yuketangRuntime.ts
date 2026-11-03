/** Private GUI -> CLI synchronization, outside plugin and model-visible APIs. */
import { session } from "../lib/clients.js";
import { sharedAccountGuard, sharedRuntimeRequest, sharedRuntimeSnapshot, subscribeSharedRuntime, usesSharedRuntime } from "../lib/sharedRuntime.js";
import { ensureExtHwCredsLoaded, getExtHwCreds, subscribeExtHw, bindLegacyYuketangOwner, yuketangCredentialOwner } from "./exthw.js";
import { ohAuthorized, subscribePrivacy } from "./privacyConsent.js";
import { mcpServerEnabled, subscribeUserExt } from "./userext.js";
let started = false, busy: Promise<void> | undefined, completed = "", pending = false;
export function syncYuketangRuntime(): Promise<void> {
  if (busy) { pending = true; return busy; }
  const run = async () => {
    if (!usesSharedRuntime() || !ohAuthorized() || session.state !== "ready" || !session.username) return;
    const owner = session.username;
    await ensureExtHwCredsLoaded(); bindLegacyYuketangOwner();
    if (yuketangCredentialOwner() && yuketangCredentialOwner() !== owner) return;
    const creds = getExtHwCreds();
    const credential = creds.yuketang?.cookie ? { cookie: creds.yuketang.cookie, ...(creds.yuketang.uvId ? { uvId: creds.yuketang.uvId } : {}), days: creds.days ?? 30 } : null;
    const status = sharedRuntimeSnapshot();
    const signature = JSON.stringify([owner, status?.epoch, credential]);
    if (signature === completed) return;
    const guard = await sharedAccountGuard(owner);
    if (session.username !== owner || !ohAuthorized()) return;
    if ((getExtHwCreds().yuketang?.cookie || null) !== (credential?.cookie || null)) { pending = true; return; }
    const result = await sharedRuntimeRequest<{ status: string }>("yuketangSync", { ...guard, credential });
    // A separately configured CLI session is preserved. Queries through the GUI
    // still use its own session; the independent CLI reports its actual status.
    if (["synced", "disconnected", "independent", "conflict"].includes(result.status)) completed = signature;
  };
  busy = Promise.resolve().then(async () => { do { pending = false; await run(); } while (pending); }).finally(() => { busy = undefined; });
  return busy;
}
export function initYuketangRuntimeSync() {
  if (started) return;
  started = true;
  window.addEventListener("onethu-cli-installation",()=>void syncYuketangRuntime().catch(()=>undefined));
  const schedule = () => { void syncYuketangRuntime().catch(() => undefined); };
  subscribeExtHw(schedule); subscribePrivacy(schedule); subscribeUserExt(schedule);
  subscribeSharedRuntime((next, previous) => { if (!previous || next.epoch !== previous.epoch || next.username !== previous.username) completed = ""; schedule(); });
  schedule();
}
