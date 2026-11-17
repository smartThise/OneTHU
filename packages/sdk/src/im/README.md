# Independent Node IM gateway

```js
const gateway = createImGateway({
  dataDir, notifications,
  getAccount: () => currentReadyUsernameOrNull,
  dispatch: async (event, {signal, assertBound, reply}) => {
    // Pass signal/assertBound through the assistant to final SDK writes.
    const result = await myAssistant.run(event.text, {
      signal, beforeWrite: assertBound,
      sessionId: `${event.channel}:${event.chatId}:${event.senderId}`,
    });
    return result.text;
  },
});
await gateway.configure('feishu', {
  credentials: {appId, appSecret},
  binding: {account: '20260001', senderId: 'ou_...', chatId: 'oc_...'},
}, {confirm:true});
await gateway.start();
```

`dispatch` receives `{eventId,channel,senderId,chatId,account,text,timestamp}` — a clean event payload keeping credentials and platform tokens internal to the gateway. Return a non-empty string to send a single reply, or call `reply(text)` directly when managing replies yourself; `reply` returns the notification receipt, including `unknown` outcomes.

WeChat configuration takes `{credentials:{botToken,baseUrl?,contextToken?},binding:{account,senderId}}`, using an already-bound token against the official iLink origin (initial QR login happens beforehand in the client). `contextToken` is optional when starting inbound polling, and each incoming message from the bound sender refreshes the outbound context automatically.

Lifecycle methods include `configure(channel,config,{confirm:true})`, `remove(channel,{confirm:true})`, `start(channel?)`, `stop(channel?)`, `status()` / `list()`, and `close()`. Senders are bound ahead of time via locally confirmed `configure` calls, and updating a binding cancels any active connection and in-flight handlers for that channel. `start()` brings up live connections once the active logged-in account matches the bound school account: calling `start()` with no argument skips bindings belonging to other accounts, while targeting a specific mismatched channel throws an error. `stop()` pauses polling in the current process, whereas `remove()` deletes the stored binding.

Transport protocols:

- **WeChat** polls `getupdates` with the standard iLink headers, persists `get_updates_buf` across restarts, honors the `-14` one-hour session suspension, and aborts pending long polls on `stop()`.
- **Feishu** connects via `/callback/ws/endpoint` (over Node's `ws` package) using protobuf framing, ping/pong heartbeats, bounded multipart reassembly, and post-admission ACKs, preserving exact `uint64` sequence and log IDs across round trips.
- Both transports reconnect with exponential backoff, reject HTTP redirects, and require Feishu WebSocket endpoints to resolve to `wss://` on `feishu.cn` or its subdomains.

The gateway processes direct text messages from the bound personal chat and ignores group chats, other senders, bot echoes, and media or rich-text payloads. Incoming events are written to disk before `dispatch` runs so duplicate deliveries or restarts skip events that were already claimed, completed, failed, or cancelled; if the process crashes mid-handler, the event stays marked with an unknown outcome for manual inspection without re-running automatically.

Events run sequentially per channel with a queue cap of 64 admitted items and a 120-second default timeout (up to 150 seconds). The gateway verifies the active school account on every admission and reply as well as once per second while a handler is running. Pass `signal` and `assertBound` all the way to final remote writes so account switches or cancellations stop outbound mutations before they are sent.

The caller holds the enclosing SDK data-directory lock. Credentials and transport cursors live as private local JSON under `dataDir/im` with the same file-permission and ACL protections as the notification store, while `status()` / `list()` expose operational state with credentials and target IDs omitted. Factory options `fetch`, `webSocketFactory`, `onStatus`, `handlerTimeoutMs`, `reconnectMs`, and `pollTimeoutMs` let adapters and deterministic tests customize networking and timing.

Run `node --test packages/sdk/test/im.test.mjs` to exercise filtering, replies, durable cursors and deduplication, cancellation, `-14` suspension, multipart fragments, ACKs, reconnect backoff, and endpoint validation against local HTTP and WebSocket fixtures. End-to-end verification on Windows hosts and live Feishu/WeChat accounts can be performed separately in target environments.
