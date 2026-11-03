/** Desktop is a client of the resident runtime; Android owns its in-app manager. */
import { createTaskManager, invokeTaskOperation, taskOperations, type TaskManager, type TaskState, type TaskGrant, type TaskOperation } from "@onethu/sdk/tasks";
import { fileRead, fileWrite, fileDelete, session } from "../lib/clients.js";
import { nativeSessionEpoch } from "../lib/transport.js";
import { mcpServerEnabled, subscribeUserExt } from "./userext.js";
import { ohAuthorized, subscribePrivacy } from "./privacyConsent.js";
import { requirePluginRuntimeOwner } from "../plugins/windowOwner.js";
import { listTaskChannels as localTaskChannels, sendTaskNotification, readTaskInbox as localTaskInbox, normalizeTaskChannels as normalizeLocalChannels } from "../im/taskNotifications.js";
import { isCliTransferBusy, initCliInstallation, appTaskRuntimeSafe, callSharedOperation, sharedAccountGuard, sharedRuntimeRequest, usesSharedRuntime } from "../lib/sharedRuntime.js";
import { syncSharedTaskNotifications } from "../im/sharedTaskNotifications.js";
export async function listTaskChannels() {
  if (!usesSharedRuntime()) return localTaskChannels();
  const owner = session.username;
  if (!enabled() || session.state !== "ready") throw new Error("CLI_DISABLED");
  await syncSharedTaskNotifications();
  const rows = await callSharedOperation("tasks.channels", [], owner) as Array<{ id: string; channel: string; available: boolean }>;
  if (!enabled() || session.username !== owner) throw new Error("CLI_SHARED_SESSION_CHANGED");
  return rows.map(row => ({ ...row, kind: row.channel, label: row.channel === "inbox" ? "OneTHU" : row.channel === "wechat" ? "WeChat" : row.channel === "feishu" ? "Feishu" : row.channel }));
}
export async function readTaskInbox(): Promise<Awaited<ReturnType<typeof localTaskInbox>>> {
  if (!usesSharedRuntime()) return localTaskInbox();
  const owner = session.username;
  if (!enabled() || session.state !== "ready") throw new Error("CLI_DISABLED");
  const result = await callSharedOperation("notifications.inbox", [{ limit: 500 }], owner) as { messages: Array<{ id: string; text: string; createdAt: number; taskId?: string }> };
  if (!enabled() || session.username !== owner) throw new Error("CLI_SHARED_SESSION_CHANGED");
  return result.messages.slice().reverse().map(row => ({ id: row.id, owner, taskId: row.taskId ?? "", text: row.text, createdAt: row.createdAt }));
}
export async function normalizeTaskChannels(value: unknown) {
  if (!usesSharedRuntime()) return normalizeLocalChannels(value);
  const draft = structuredClone(value) as import("@onethu/sdk/tasks").TaskDraft;
  if (!draft?.template || !Array.isArray(draft.template.channels)) return draft;
  const channels = await listTaskChannels();
  draft.template.channels = draft.template.channels.map(id => channels.find(channel => channel.kind === id)?.id ?? id);
  return draft;
}
export type DesktopTaskInput = { operation: string; args?: unknown[]; confirm?: boolean; deadlineUnixMs?: number };
export interface DesktopTaskBinding {
  call(input: DesktopTaskInput): Promise<unknown>;
  dispatch(input: DesktopTaskInput, grant: TaskGrant, signal: AbortSignal): Promise<unknown>;
  resolveOperation(name: string): TaskOperation | undefined;
}
interface Runtime {
  binding?: DesktopTaskBinding; manager?: Promise<TaskManager>;
  retiringManager?: Promise<void>;
  consentTail: Promise<unknown>; approval?: () => Promise<void>;
  listeners: Set<() => void>; subscribed: boolean; inboxListeners?: Set<() => void>;
}
const key = Symbol.for("onethu.cli.tasks.runtime.v1");
const globals = globalThis as typeof globalThis & { [key]?: Runtime };
const runtime = globals[key] ??= { consentTail: Promise.resolve(), listeners: new Set(), subscribed: false };
const enabled = () => ohAuthorized();
export const subscribeDesktopTasks = (fn: () => void) => { runtime.listeners.add(fn); return () => { runtime.listeners.delete(fn); }; };
function changed() { for (const fn of runtime.listeners) fn(); }
export function bindDesktopTasks(binding: DesktopTaskBinding): void {
  requirePluginRuntimeOwner(); runtime.binding = binding;
  // A desktop failure is shown to the caller. Starting a second scheduler here
  // would duplicate downloads and notifications when the daemon recovers.
  if (usesSharedRuntime()) {
    if (runtime.manager) { runtime.retiringManager = runtime.manager.then(manager => manager.stop()); runtime.manager = undefined; }
    void prepareDesktopTaskRuntime().catch(reportPreparationError);
    return;
  }
  if (!runtime.subscribed) {
    runtime.subscribed = true;
    const sync = () => {
      if (!runtime.manager) return;
      void runtime.manager.then(manager => enabled() ? manager.start() : manager.stop()).catch(() => undefined);
    };
    subscribeUserExt(sync); subscribePrivacy(sync);
  }
  // A failed read never becomes an empty task store. Leave the rejected promise
  // visible to management controls until the app is restarted/repaired.
  void getManager().then(manager => { if (enabled()) manager.start(); }).catch(() => undefined);
}
async function getManager(): Promise<TaskManager> {
  requirePluginRuntimeOwner();
  await initCliInstallation();
  if(!appTaskRuntimeSafe())throw new Error("CLI_DAEMON_SHUTDOWN_PENDING");
  if (usesSharedRuntime()) throw new Error("TASK_MANAGER_OWNED_BY_DAEMON");
  if (!runtime.binding) throw new Error("TASK_RUNTIME_NOT_READY");
  return runtime.manager ??= createTaskManager({
    storage: {
      async load() { const text = await fileRead("cli-tasks-v1", { strict: true }); return text ? JSON.parse(text) as TaskState : null; },
      async save(state) { await fileWrite("cli-tasks-v1", JSON.stringify(state), { strict: true }); changed(); },
    },
    async getOwner() {
      if (!enabled() || session.state !== "ready" || !session.username) return null;
      const id = session.username, epoch = await nativeSessionEpoch();
      return enabled() && session.state === "ready" && session.username === id ? { id, epoch } : null;
    },
    async authorizeGrant({ scope }) {
      const approval = runtime.approval;
      if (!approval) return false;
      await approval();
      const available = new Set((await listTaskChannels()).filter(channel => channel.available).map(channel => channel.id));
      if (scope.channels.some(channel => !available.has(channel))) throw new Error("TASK_NOTIFICATION_CHANNEL_UNAVAILABLE");
      await approval(); return true;
    },
    resolveOperation(name) { return runtime.binding?.resolveOperation(name); },
    dispatch(operation, args, { confirmationGrant, signal }) {
      if (!runtime.binding) return Promise.reject(new Error("TASK_RUNTIME_NOT_READY"));
      return runtime.binding.dispatch({ operation, args }, confirmationGrant, signal);
    },
    notify: sendTaskNotification,
  }).then(async manager=>{
    const saved=await fileRead("cli-retired-state-v1",{strict:true});
    if(saved){
      const retired=JSON.parse(saved);
      if(retired.owner===session.username&&retired.state){
        const available=new Set((await localTaskChannels()).filter(channel=>channel.available).map(channel=>channel.id));
        for(const task of retired.state.tasks){if(task.owner===session.username&&(task.scope.channels??[]).some((channel:string)=>!available.has(retired.channelMap[channel]??channel)))task.enabled=false;}
        const imported=await manager.importState("resident-cli-retirement",retired.state,retired.channelMap,{replaceOwner:true});
        if(imported.conflicts.length)reportPreparationError(new Error("TASK_MIGRATION_CONFLICT"));
        else await fileDelete("cli-retired-state-v1",{strict:true});
      }
    }return manager;
  });
}
/** The callback is supplied by the service after local approval. It is never
 * accepted from the CLI/MCP JSON. Grant-creating controls are serialized while
 * pause/remove/run remain independent, so a running job cannot block revocation. */
export async function runDesktopTaskControl(operation: string, args: unknown[], approval: () => Promise<void>, expectedSharedEpoch?: number): Promise<unknown> {
  if(isCliTransferBusy?.())throw new Error("CLI_TRANSFER_BUSY");
  if (usesSharedRuntime()) {
    await runtime.retiringManager;
    await approval();
    const guard = await sharedAccountGuard(session.username);
    if (expectedSharedEpoch !== undefined && guard.expectedEpoch !== expectedSharedEpoch) throw new Error("CLI_SHARED_SESSION_CHANGED");
    // Migration warnings remain visible separately. Existing daemon tasks must
    // remain inspectable and revocable while an older task awaits reconciliation.
    await migrateDesktopTasks(guard).catch(reportPreparationError);
    await approval();
    const result = await callSharedOperation(operation, args, guard.expectedAccount, true, guard.expectedEpoch);
    if (taskOperations.some(item => item.name === operation && "mutation" in item && item.mutation)) changed();
    return result;
  }
  const manager = await getManager();
  const definition = taskOperations.find(item => item.name === operation);
  if (!definition) throw new Error("UNKNOWN_TASK_OPERATION");
  if (!definition.requiresGrant) { await approval(); return invokeTaskOperation(manager, operation, args); }
  const job = runtime.consentTail.catch(() => undefined).then(async () => {
    await approval();
    const prepared = [...args];
    if (operation === "tasks.create" || operation === "tasks.update") {
      const index = operation === "tasks.create" ? 0 : 1;
      prepared[index] = await normalizeTaskChannels(prepared[index]);
    }
    runtime.approval = approval;
    try { return await invokeTaskOperation(manager, operation, prepared); }
    finally { runtime.approval = undefined; }
  });
  runtime.consentTail = job; return job;
}

let migration: Promise<void> | undefined;
async function reportPreparationError(error: unknown) {
  const { reportCliRuntimeError } = await import("./cliRuntime.js");
  reportCliRuntimeError(error);
}
/** Migration happens when an authenticated desktop joins the daemon, even if
 * the user never opens task settings before closing the window. */
export async function prepareDesktopTaskRuntime(): Promise<void> {
  if (!usesSharedRuntime() || !enabled() || session.state !== "ready") return;
  await runtime.retiringManager;
  const guard = await sharedAccountGuard(session.username);
  await syncSharedTaskNotifications();
  await (await import("./sharedCloudConfig.js")).syncSharedCloudConfig();
  await migrateDesktopTasks(guard);
  (await import("./cliRuntime.js")).clearCliRuntimeError();
  changed();
}
async function migrateDesktopTasks(guard: { expectedAccount: string; expectedEpoch: number }): Promise<void> {
  if (migration) { await migration; return; }
  const job = (async () => {
    const markerRaw = await fileRead("cli-tasks-daemon-migration-v1", { strict: true });
    const markers: Record<string, number> = markerRaw ? JSON.parse(markerRaw) : {};
    if (markers[guard.expectedAccount]) return;
    const raw = await fileRead("cli-tasks-v1", { strict: true });
    const retiredRaw=await fileRead("cli-retired-state-v1",{strict:true});
    const retired=retiredRaw?JSON.parse(retiredRaw):null;
    const state:TaskState=retired?.owner===guard.expectedAccount&&retired.state?retired.state:raw?JSON.parse(raw):{version:1,tasks:[]};
    const notifications = await syncSharedTaskNotifications();
    const result = await sharedRuntimeRequest<{ conflicts: Array<{ id: string; reason: string }> }>("migrateTasks", {
      origin: "desktop-v1", state, channelMap: notifications?.channelMap ?? {}, ...guard,
    });
    if (result.conflicts?.length) throw new Error("TASK_MIGRATION_CONFLICT");
    // Keep the complete source as a recovery backup. Mark only after the daemon
    // durably accepted the IDs/history/ledgers; its own receipt is idempotent.
    markers[guard.expectedAccount] = Date.now();
    await fileWrite("cli-tasks-daemon-migration-v1", JSON.stringify(markers), { strict: true });
    if(retired?.owner===guard.expectedAccount)await fileDelete("cli-retired-state-v1",{strict:true});
  })();
  migration = job;
  try { await job; } finally { if (migration === job) migration = undefined; }
}
export function desktopTaskCall(input: DesktopTaskInput): Promise<unknown> {
  requirePluginRuntimeOwner();
  if (!runtime.binding) return Promise.reject(new Error("TASK_RUNTIME_NOT_READY"));
  return runtime.binding.call(input);
}

export async function saveResidentTasksBeforeUninstall(){
 const guard=await sharedAccountGuard(session.username);
 const retired=await sharedRuntimeRequest("retire",guard);
 await fileWrite("cli-retired-state-v1",JSON.stringify(retired),{strict:true});
 const markers=JSON.parse(await fileRead("cli-tasks-daemon-migration-v1",{strict:true})??"{}");
 delete markers[session.username];
 await fileWrite("cli-tasks-daemon-migration-v1",JSON.stringify(markers),{strict:true});
}
if(typeof window!=="undefined")window.addEventListener("onethu-cli-installation",()=>{
 if(runtime.binding)bindDesktopTasks(runtime.binding);
});

export async function pauseAppTasksForInstall(){
 if(!usesSharedRuntime()&&runtime.manager)await(await runtime.manager).stop();
}
