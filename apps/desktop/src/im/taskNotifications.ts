/** Task notifications use the existing single-owner IM adapters. Channel IDs
 * include a binding digest so rebinding IM cannot redirect an old task. */
import type { TaskDraft, TaskGrant } from "@onethu/sdk/tasks";
import { fileRead, fileWrite, session } from "../lib/clients.js";
import { mcpServerEnabled } from "../state/userext.js";
import { ohAuthorized } from "../state/privacyConsent.js";
import { loadImConfig } from "./store.js";
import { getAdapter } from "./registry.js";
import type { ChannelId } from "./types.js";
export interface TaskChannel { id: string; kind: "inbox" | ChannelId; label: string; available: boolean }
export interface TaskInboxItem { id: string; owner: string; taskId: string; text: string; createdAt: number }
async function digest(value: unknown): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function boundChannel(kind: ChannelId): Promise<{ id: string; recipient: string; available: boolean }> {
  const config = await loadImConfig(), recipient = config.bindings[kind] ?? "";
  const identity = kind === "feishu" ? config.channels.feishu?.appId : config.channels.wechat?.botId;
  const configured = kind === "feishu" ? !!config.channels.feishu?.appSecret : !!config.channels.wechat?.botToken;
  return { id: `${kind}:${await digest([session.username, kind, identity ?? "", recipient])}`, recipient,
    available: !!recipient && !!identity && configured && config.enabled[kind] };
}
export async function listTaskChannels(): Promise<TaskChannel[]> {
  const result: TaskChannel[] = [{ id: "inbox", kind: "inbox", label: "OneTHU", available: true }];
  for (const kind of ["wechat", "feishu"] as const) {
    const bound = await boundChannel(kind);
    result.push({ id: bound.id, kind, label: kind === "wechat" ? "WeChat" : "Feishu", available: bound.available });
  }
  return result;
}
export async function normalizeTaskChannels(value: unknown): Promise<TaskDraft> {
  const draft = structuredClone(value) as TaskDraft;
  if (!draft?.template || !Array.isArray(draft.template.channels)) return draft;
  const channels = await listTaskChannels();
  draft.template.channels = draft.template.channels.map(id => channels.find(channel => channel.kind === id)?.id ?? id);
  return draft;
}
// Queued file writes retain both concurrent tasks. No background delivery retry:
// the engine persists pending/unknown before calling the adapter.
let inboxTail = Promise.resolve();
async function loadInbox(): Promise<TaskInboxItem[]> {
  const raw = await fileRead("cli-task-inbox-v1", { strict: true });
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 500) throw new Error("TASK_INBOX_INVALID");
  return data as TaskInboxItem[];
}
export async function readTaskInbox(): Promise<TaskInboxItem[]> {
  const owner = session.username;
  if (!owner || session.state !== "ready" || !ohAuthorized()) throw new Error("TASK_ACCOUNT_REQUIRED");
  const inbox = await loadInbox();
  if (session.username !== owner || session.state !== "ready") throw new Error("TASK_ACCOUNT_CHANGED");
  return inbox.filter(item => item.owner === owner).map(item => ({ ...item }));
}
export async function sendTaskNotification(channel: string, text: string, idempotencyKey: string, { confirmationGrant: grant, signal }: { confirmationGrant: TaskGrant; signal: AbortSignal }): Promise<void> {
  const check = async () => {
    if (signal.aborted) throw new Error("TASK_CANCELLED");
    if (!ohAuthorized()) throw new Error("CLI_DISABLED");
    await grant.assertActive();
    if (!grant.channels.includes(channel)) throw new Error("TASK_CHANNEL_OUTSIDE_GRANT");
    if (signal.aborted || session.username !== grant.owner) throw new Error("TASK_ACCOUNT_CHANGED");
  };
  await check();
  if (channel === "inbox") {
    const write = inboxTail.catch(() => undefined).then(async () => {
      const rows = await loadInbox(); await check();
      if (rows.some(row => row.id === idempotencyKey)) return;
      rows.push({ id: idempotencyKey, owner: grant.owner, taskId: grant.taskId, text: text.slice(0, 16000), createdAt: Date.now() });
      await check(); await fileWrite("cli-task-inbox-v1", JSON.stringify(rows.slice(-500)), { strict: true });
    });
    inboxTail = write; return write;
  }
  const kind = channel.split(":")[0] as ChannelId;
  if (kind !== "wechat" && kind !== "feishu") throw new Error("TASK_NOTIFICATION_CHANNEL_UNAVAILABLE");
  const bound = await boundChannel(kind), adapter = getAdapter(kind);
  if (!bound.available || bound.id !== channel || !adapter?.notify) throw new Error("TASK_NOTIFICATION_BINDING_CHANGED");
  const finalCheck = async () => {
    await check();
    const current = await boundChannel(kind);
    if (!current.available || current.id !== channel || current.recipient !== bound.recipient) throw new Error("TASK_NOTIFICATION_BINDING_CHANGED");
    await check();
  };
  await adapter.notify(bound.recipient, text, idempotencyKey, finalCheck, signal);
}
