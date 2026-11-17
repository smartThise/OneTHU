# Node outbound notifications

`createNotificationService({dataDir, fetch?, desktopSend?, timeoutMs?})` stores local state under `dataDir/notifications` (with the caller holding the SDK data-directory lock) and uses a 15-second default request timeout configurable between 50 ms and 60 seconds. Constructing the service is purely local—network requests run only when `send` or `sendTask` is called.

Methods:

- `configure(channel, config, {confirm:true,beforeWrite?})` and `remove(channel,{confirm:true,beforeWrite?})` manage channel settings.
- `list()` returns channel configuration and availability flags with credentials and target IDs omitted.
- `send({channel,text,title?,idempotencyKey},{confirm:true,signal?,beforeWrite?,expectedTarget?})` dispatches a notification.
- `taskChannels()` returns `{id,channel,transport,available}` entries for configured task destinations, and `sendTask(id,{text,title?,idempotencyKey},options)` sends to a pinned destination using the same confirmation, cancellation, and write guards as `send`.
- `inbox({limit?:1..500,before?:timestamp})` reads local inbox items, and `close()` releases the service.

Channel configuration:

| Channel | Configuration |
| --- | --- |
| `inbox` | `{}`; available by default, local only |
| `feishu` | `{appId,appSecret,chatId}` for a configured Feishu application bot |
| `wechat` | `{botToken,userId,contextToken,baseUrl?}` from an existing iLink binding |
| `webhook` | `{url,headers?}`; HTTPS only, redirects refused |

Feishu sends messages through `tenant_access_token/internal` and `im/v1/messages?receive_id_type=chat_id`. WeChat posts the iLink `sendmessage` envelope with its context token, client version, and auth headers to `https://ilinkai.weixin.qq.com`, using credentials from an already-logged-in binding; when a context token expires, a fresh message from the bound user or an updated `configure` call renews it, and `ret` / `errcode` `-14` surfaces a suspended WeChat session.

Passing a `desktopSend({channel,target,text,idempotencyKey,signal})` hook enables `{transport:'desktop',chatId}` and `{transport:'desktop',userId}` channels that delegate delivery to the desktop app's `channel.send`. Returning `{accepted:true,messageId?}` records `accepted` once a provider receipt is observed, whereas a `void` return (such as when the desktop Feishu queue enqueues asynchronously) records `queued`.

`send` returns a receipt containing `status`, `channel`, `idempotencyKey`, `duplicate`, timestamps, and any safe error code or provider message ID:

- `accepted`: acknowledged by the remote provider.
- `stored`: saved to the local `inbox`.
- `queued`: handed off to the `desktopSend` queue pending remote delivery.
- `rejected`: refused by the remote provider.
- `not_sent`: stopped before the outbound HTTP request began.
- `unknown`: interrupted after dispatch started, leaving remote delivery uncertain.

Each send writes to the local ledger before dispatching over the network and runs at most once per `(channel, idempotencyKey)`—even across restarts, provider rejections, rate limits, HTTP `5xx` responses, timeouts, or crashes. Replaying the same key with identical payload and target returns the recorded receipt (reporting `unknown` if a prior `pending` attempt was interrupted), while reusing a key with different text or a changed target throws an error. Callers that choose to retry generate a fresh `idempotencyKey`.

The optional `beforeWrite` hook runs right after token preparation and immediately before network dispatch, and `expectedTarget` lets IM reply flows verify that the recipient binding is unchanged. Pass the caller's `signal` and account/policy `beforeWrite` guard through to keep outbound writes aligned with the active session.

Scheduled tasks address destinations by fixed IDs returned from `tasks.channels` (stored inside an account-scoped SDK data directory): `inbox` uses `inbox`, and external channels use `wechat:<SHA-256>`, `feishu:<SHA-256>`, or `webhook:<SHA-256>`. The digest hashes the channel, transport, recipient, and Feishu `appId` or webhook URL—leaving out API secrets, bot tokens, and rotating WeChat context tokens so credential rotation keeps the ID stable while `taskChannels()` stays free of raw recipient IDs, URLs, and secrets.

Store the destination ID in the task's `template.channels` when authorizing the task (passing a bare external channel name fails with `TASK_NOTIFICATION_BINDING_REQUIRED`). If the recipient, Feishu app, or webhook URL changes—or if the channel is removed—existing tasks fail safely with `TASK_NOTIFICATION_BINDING_CHANGED` until updated and re-authorized with the new ID. Binding checks run inside the same serialized section as `configure` and `send` to prevent rebind races, while direct `notifications.send` calls always route to the channel's current configuration.

Configuration, ledger, and inbox files are stored as unencrypted private JSON protected by `0700` / `0600` modes on POSIX and per-user SID ACLs via `icacls` on Windows; symlinks, hard links, or permissive ownership cause operations to fail closed. Diagnostic receipts strip raw provider bodies, keys, tokens, and webhook URLs, and webhook delivery connects directly to the HTTPS endpoint configured by the local operator.

Run `node --test packages/sdk/test/notifications.test.mjs` to validate delivery, idempotency, task bindings, and storage guards over local loopback HTTP servers. Windows `icacls` behavior and live Feishu/WeChat delivery can be verified separately on Windows hosts and real accounts.
