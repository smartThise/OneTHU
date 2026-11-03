/** Move approved outbound bindings to the resident process. This does not start
 * another IM listener or expose credentials through the CLI/plugin facade. */
import { session } from "../lib/clients.js";
import { sharedAccountGuard, sharedRuntimeRequest, usesSharedRuntime } from "../lib/sharedRuntime.js";
import { loadImConfig, subscribeImConfig, imConfigReadable } from "./store.js";
import { getAdapter } from "./registry.js";
import { listTaskChannels } from "./taskNotifications.js";
import { mcpServerEnabled } from "../state/userext.js";
import { ohAuthorized } from "../state/privacyConsent.js";
import { ImStorage } from "./imStorage.js";

export interface SharedNotificationSync { channelMap?: Record<string, string>; conflicts?: Array<{ channel: string; reason: string }> }
let tail: Promise<SharedNotificationSync | undefined> = Promise.resolve(undefined);
type WechatContext = { owner?: string; botId?: string; recipient?: string; contextToken?: string };
const contextStore = new ImStorage<WechatContext>("onethu.im.taskcontext.v1", "onethu.im.taskcontext.salt.v1", "onethu-im-task-context-v1", 120_000, () => ({}));
export async function rememberSharedWechatContext(recipient: string, contextToken: string): Promise<void> {
  if (!usesSharedRuntime() || session.state !== "ready" || !ohAuthorized()) return;
  const owner = session.username, config = await loadImConfig();
  if (!config.enabled.wechat || config.bindings.wechat !== recipient || !config.channels.wechat?.botId || session.username !== owner) return;
  await contextStore.save({ owner, recipient, contextToken, botId: config.channels.wechat.botId });
  await syncSharedTaskNotifications();
}
export function syncSharedTaskNotifications(): Promise<SharedNotificationSync | undefined> {
  if (!usesSharedRuntime() || session.state !== "ready" || !ohAuthorized()) return Promise.resolve(undefined);
  const owner = session.username;
  const next = tail.catch(() => undefined).then(async () => {
    const guard = await sharedAccountGuard(owner), cfg = await loadImConfig();
    if (!imConfigReadable()) throw new Error("IM_CONFIGURATION_RECOVERY_REQUIRED");
    const legacy = await listTaskChannels();
    const channels: Array<Record<string, unknown>> = [];
    for (const channel of ["feishu", "wechat"] as const) {
      const recipient = cfg.bindings[channel], legacyId = legacy.find(row => row.kind === channel)?.id;
      const creds = cfg.channels[channel];
      if (!cfg.enabled[channel] || !recipient || !creds) {
        channels.push({ channel, config: null }); continue;
      }
      if (channel === "feishu") {
        const value = cfg.channels.feishu!;
        if (!value.appId || !value.appSecret) continue;
        channels.push({ channel, legacyId, config: { appId: value.appId, appSecret: value.appSecret, chatId: recipient, receiveIdType: "open_id" } });
      } else {
        const value = cfg.channels.wechat!;
        const stored = await contextStore.load();
        const contextToken = getAdapter("wechat")?.notificationContext?.(recipient) ??
          (stored?.owner === owner && stored.botId === value.botId && stored.recipient === recipient ? stored.contextToken : undefined);
        // An uninitialized/new recipient must revoke the previous desktop
        // binding until a real message establishes a usable reply context.
        if (!contextToken || !value.botToken) { channels.push({ channel, config: null, retainLegacyId: legacyId }); continue; }
        channels.push({ channel, legacyId, sourceIdentity: value.botId, config: { botToken: value.botToken,
          userId: recipient, contextToken, baseUrl: value.baseUrl } });
      }
    }
    if (session.username !== owner || session.state !== "ready") throw new Error("CLI_SHARED_SESSION_CHANGED");
    const result = await sharedRuntimeRequest<SharedNotificationSync>("notificationsSync", { channels, ...guard });
    if (result.conflicts?.length) throw new Error("TASK_NOTIFICATION_BINDING_CONFLICT");
    return result;
  });
  tail = next; return next;
}

/** Credential changes only enqueue synchronization; settings/task controls read
 * errors through syncSharedTaskNotifications and never claim a failed delivery. */
subscribeImConfig(() => { void syncSharedTaskNotifications().catch(() => undefined); });
