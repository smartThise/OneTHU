import { useSyncExternalStore } from "react";
import { mcpServerEnabled, cliAutoExecuteEnabled, subscribeUserExt, setMcpServer, setCliAutoExecute } from "./userext.js";
import { confirmationMode, type ConfirmationMode } from "@onethu/sdk/policy";
import { ohAuthorized, subscribePrivacy, initPrivacyConsent } from "./privacyConsent.js";
import { initCliInstallation, getSharedRuntimeStatus, sharedRuntimeSnapshot, subscribeSharedRuntime, updateSharedPolicy, usesSharedRuntime, type SharedRuntimeStatus } from "../lib/sharedRuntime.js";

export interface CliRuntimeStatus {
  requested: boolean; authorized: boolean; enabled: boolean; listening: boolean;
  reachableNow: boolean; endpoint?: string; cliEndpoint?: string; errorCode?: string;
  phase: "stopped" | "syncing" | "ready" | "error";
  confirmationMode: ConfirmationMode;
  background?: boolean;
  handoffPending?: boolean;
}
let status: CliRuntimeStatus = { requested: mcpServerEnabled(), authorized: ohAuthorized(), enabled: false, listening: false, reachableNow: false, phase: "stopped", confirmationMode: confirmationMode(cliAutoExecuteEnabled()) };
const listeners = new Set<() => void>();
let active = false, revision = 0;
let policyHydrated = false, applyingSharedPolicy = false;
let preparationError: string | undefined;
let handoffPending = false;
type LocalPolicy = { requested: boolean; authorized: boolean; automatic: boolean };
type PolicyIntent = LocalPolicy & { revision: number; expectedAccount: string | null; expectedEpoch: number };
function localPolicy(): LocalPolicy { return { requested: mcpServerEnabled(), authorized: ohAuthorized(), automatic: cliAutoExecuteEnabled() }; }
function samePolicy(a: LocalPolicy, b: LocalPolicy): boolean { return a.requested === b.requested && a.authorized === b.authorized && a.automatic === b.automatic; }
let observedLocalPolicy = localPolicy(), policyRevision = 0;
let policyIntent: PolicyIntent | undefined;
let policyRunning: Promise<void> | undefined;
let nativeRevision = 0;
let invalidationVersion = 0, acknowledgedInvalidationVersion = 0;
// Native downloads belong to the authorized in-app service. External CLI
// requests are additionally gated by createCliService and the listener policy.
async function syncNativeAccess(enabled: boolean, invalidate = false) {
  // Wall time keeps revisions ordered across HMR/page reload; the local counter
  // distinguishes changes in one millisecond. Capture before the async import.
  const next = Math.max(Date.now() * 1024, nativeRevision + 1);
  nativeRevision = next;
  if (invalidate) invalidationVersion++;
  const invalidation = invalidationVersion;
  const { invoke } = await import("@tauri-apps/api/core");
  // Keep invalidation on every newer request until acknowledged. A concurrent
  // reconnect must not overtake a policy change and preserve its active writes.
  await invoke("cli_access_sync", { enabled, revision: next, invalidate: invalidation > acknowledgedInvalidationVersion });
  acknowledgedInvalidationVersion = Math.max(acknowledgedInvalidationVersion, invalidation);
}
function publish(next: CliRuntimeStatus) { status = next; listeners.forEach(fn => fn()); }
export function cliRuntimeSnapshot() { return status; }
export function reportCliRuntimeError(error: unknown) {
  const code = /[A-Z][A-Z_]{3,}/.exec(String(error))?.[0] ?? "runtime-unavailable";
  preparationError = code;
  publish({ ...status, phase: "error", reachableNow: false, errorCode: code });
}
export function clearCliRuntimeError() { preparationError = undefined; }
export function setCliHandoffPending(value: boolean) {
  handoffPending = value;
  publish({ ...status, handoffPending: value, reachableNow: value ? false : status.reachableNow });
}
export function subscribeCliRuntime(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function useCliRuntime() { return useSyncExternalStore(subscribeCliRuntime, cliRuntimeSnapshot, cliRuntimeSnapshot); }

export async function syncCliRuntime(): Promise<void> {
  // Native consent starts denied while its saved value is loading. Hydration
  // must complete before that temporary value can revoke the resident policy.
  await initPrivacyConsent();
  await initCliInstallation();
  if (usesSharedRuntime() && handoffPending) {
    try { await (await import("../lib/clients.js")).retrySharedSessionHandoff(); }
    catch {
      publish({ ...status, handoffPending: true, phase: "error", reachableNow: false });
      return;
    }
  }
  if (usesSharedRuntime() && policyIntent) { await flushPolicyIntent(); return; }
  const current = ++revision;
  const requested = mcpServerEnabled(), authorized = ohAuthorized();
  const mode = confirmationMode(cliAutoExecuteEnabled());
  const policyChanged = mode !== status.confirmationMode;
  publish({ ...status, requested, authorized, confirmationMode: mode, enabled: false, reachableNow: false, phase: active ? "syncing" : "stopped", errorCode: undefined });
  const nativeSync = syncNativeAccess(active && authorized, policyChanged);
  if (!active) { await nativeSync.catch(() => undefined); return; }
  try {
    await nativeSync;
    if (usesSharedRuntime()) {
      // The GUI's reviewed service adapter remains available to terminal clients
      // for contacts, organizations, vault, and other app-owned capabilities.
      const {callRust}=await import("../plugins/rust.js");
      await callRust("onethu.harness","mcp_sync",{},8000);
      let shared = await getSharedRuntimeStatus();
      if (!policyHydrated && (shared.policy.configured === false || shared.policy.appEnabled !== authorized)) {
        // Existing same-device consent survives the one-time host migration.
        shared = await updateSharedPolicy(requested && authorized, cliAutoExecuteEnabled());
      } else if (!authorized && shared.policy.enabled) {
        shared = await updateSharedPolicy(false, shared.policy.automatic);
      }
      policyHydrated = true;
      if (current !== revision || policyIntent) return;
      applySharedPolicy(shared);
      await syncNativeAccess(active && authorized);
      await (await import("./cliTasks.js")).prepareDesktopTaskRuntime();
      if (current !== revision) return;
      publishShared(shared);
      return;
    }
    const { callRust } = await import("../plugins/rust.js");
    const value = await callRust("onethu.harness", "mcp_sync", {}, 8_000) as Partial<CliRuntimeStatus> & { supported?: boolean };
    if (current !== revision) return;
    if (value?.supported !== true) throw new Error("unsupported-runtime");
    publish({ requested, authorized, confirmationMode: mode, enabled: value.enabled === true, listening: value.listening === true,
      reachableNow: value.reachableNow === true && requested && authorized, endpoint: value.endpoint, cliEndpoint: value.cliEndpoint,
      phase: value.errorCode ? "error" : "ready", errorCode: value.errorCode });
  } catch {
    if (current !== revision) return;
    publish({ ...status, phase: "error", enabled: false, reachableNow: false, errorCode: "runtime-unavailable" });
  }
}
function applySharedPolicy(shared: SharedRuntimeStatus) {
  if (policyIntent) return;
  applyingSharedPolicy = true;
  try { setMcpServer(shared.policy.enabled); setCliAutoExecute(shared.policy.automatic); }
  finally { observedLocalPolicy = localPolicy(); applyingSharedPolicy = false; }
}
function publishShared(shared: SharedRuntimeStatus) {
  const requested = shared.policy.enabled, authorized = ohAuthorized();
  publish({ requested, authorized, confirmationMode: confirmationMode(shared.policy.automatic), enabled: requested && authorized,
    listening: true, reachableNow: requested && authorized && !preparationError && !handoffPending, phase: preparationError || handoffPending ? "error" : "ready", errorCode: preparationError, handoffPending, cliEndpoint: "OneTHU CLI", background: true });
}
subscribeSharedRuntime(shared => {
  if (!policyHydrated || applyingSharedPolicy || policyIntent || !usesSharedRuntime()) return;
  applySharedPolicy(shared);
  if (active) publishShared(shared);
});
export function setCliRuntimeActive(value: boolean) {
  active = value;
  // Harness/App lifecycle controls the GUI bridge, never the resident scheduler.
  if (!value) { ++revision; void syncNativeAccess(false).catch(() => undefined); publish({ ...status, phase: "stopped", enabled: false, listening: false, reachableNow: false }); }
  else void syncCliRuntime();
}
function flushPolicyIntent(): Promise<void> {
  if (policyRunning) return policyRunning;
  const running = Promise.resolve().then(async () => {
    while (policyIntent) {
      const intent = policyIntent;
      try {
        const shared = await updateSharedPolicy(intent.requested && intent.authorized, intent.automatic, intent);
        // An earlier response cannot overwrite a newer toggle or its local
        // consent. Drain the latest intent next, under its original account.
        if (policyIntent?.revision !== intent.revision) continue;
        policyIntent = undefined;
        applySharedPolicy(shared);
        await syncNativeAccess(active && ohAuthorized());
        await (await import("./cliTasks.js")).prepareDesktopTaskRuntime();
        if (!policyIntent && active) publishShared(shared);
      } catch (error) {
        if (policyIntent && policyIntent.revision !== intent.revision) continue;
        if (/CLI_SHARED_SESSION_CHANGED/.test(String(error))) policyIntent = undefined;
        // Keep the intent for an explicit Retry. Transport writes are never
        // automatically replayed, and the captured account/epoch still fences it.
        publish({ ...status, phase: "error", reachableNow: false, errorCode: /CLI_SHARED_SESSION_CHANGED/.test(String(error)) ? "CLI_SHARED_SESSION_CHANGED" : "runtime-unavailable" });
        return;
      }
    }
  });
  policyRunning = running;
  void running.finally(() => { if (policyRunning === running) policyRunning = undefined; });
  return running;
}
function changed() {
  if (applyingSharedPolicy) return;
  const desired = localPolicy();
  if (samePolicy(observedLocalPolicy, desired)) return;
  observedLocalPolicy = desired;
  const shared = usesSharedRuntime() && policyHydrated ? sharedRuntimeSnapshot() : null;
  if (shared) {
    ++revision;
    policyIntent = { ...desired, revision: ++policyRevision, expectedAccount: shared.username, expectedEpoch: shared.epoch };
    publish({ ...status, requested: desired.requested, authorized: desired.authorized, confirmationMode: confirmationMode(desired.automatic), enabled: false, reachableNow: false, phase: "syncing", errorCode: undefined });
    void syncNativeAccess(active && desired.authorized, true).catch(() => undefined);
    void flushPolicyIntent();
    return;
  }
  void syncCliRuntime();
}
subscribeUserExt(changed);
subscribePrivacy(changed);

if (typeof window !== "undefined") window.addEventListener("onethu-cli-installation", () => { policyHydrated = false; void syncCliRuntime(); });
