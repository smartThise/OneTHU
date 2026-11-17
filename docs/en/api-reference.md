# OneTHU API reference


[中文](../api-reference.md) · [System architecture](architecture.md)

## Select an interface

| Caller | Interface | Contract | Lifecycle |
| --- | --- | --- | --- |
| JS app plugin | `ctx.onethu.<namespace>.<method>` | `OnethuApi` and facade | GUI/native host |
| Rust plugin / Harness | Reverse `onethu.call` | Plugin protocol and facade | Sidecar or Android embedding |
| Embedded Node program | `createOneThu`, `app.list`, `app.call` | SDK registry and schemas | Caller-owned runtime |
| Terminal / external agent | `onethu commands/schema/call` | Current runtime directory | Daemon or explicit desktop mode |
| MCP client | `onethu_commands`, `onethu_call` | Source-visible operations | CLI stdio/local service |
| OH app tools | `app_services`, `app_call`, dedicated tools | Running app facade | App, mode and privacy consent |
| OneTHU main window | Private `desktop.*`, `gateway.control` | Local protocol and owner/epoch checks | Private daemon/native bridge |

Always check the signature for your specific caller environment, even when operation names match across layers: for example, the GUI plugin method `learn.courses` and the portable SDK `learn.courses` operation define their own parameter and return shapes. Standalone SDK runtimes operate independently of GUI frontend state, so call `app.list()` (or `onethu commands`) first to inspect the operations registered in that runtime.

## Plugin API

[types.ts](../../apps/desktop/src/plugins/types.ts) defines the source of truth for the **41 namespaces and 297 method entries** currently in the plugin API, while [facade.ts](../../apps/desktop/src/plugins/facade.ts) implements the host handlers and permission gates.

```ts
// The host loads the plugin and injects ctx.
const status = ctx.onethu.session.status();
const username = ctx.onethu.session.username();
```

Each method signature specifies whether it returns synchronously or via a `Promise`. At runtime, manifest permissions work alongside current app mode, platform capabilities, active account identity, resource ownership, and upstream service authorization. Where the generated reference table lists “Inspect facade,” `facade.ts` enforces dynamic or contextual checks rather than a single static permission string.

- [Generated signatures](api-surface.md)
- [Machine-readable snapshot](../api-surface.json)
- [Manifests, sidecars and examples](plugin-development.md)

Rust plugins invoke host methods by sending an `onethu.call` request with `params.ns`, `params.method`, and positional `params.args`, receiving the correlated result or error by request ID. Host plugin RPC, MCP tool invocations, and embedded SDK `CallRequest` envelopes each use their own dedicated wire format.

## SDK calls

```ts
const controller = new AbortController();
const result = await app.call({
  operation: 'learn.courses',
  args: [],
  deadlineUnixMs: Date.now() + 30_000,
}, {
  signal: controller.signal,
});
```

`CallRequest` accepts an `operation` name along with optional positional `args`, `confirm`, and `deadlineUnixMs`, validated against the tuple schemas returned by `app.list()`. Host-level controls—caller `source`, granted permissions, `AbortSignal`, and `beforeWrite` hooks—are passed exclusively through the trusted second options argument, keeping caller privileges isolated from external request payloads.

Each operation descriptor exposes its name, description, parameter schema, required permission, and metadata flags for mutation, authentication, and local-only access. Account sign-in and local policy changes go through dedicated host methods, while `confirm:true` in a call envelope applies strictly to per-request user confirmation.

`app.auth.login` and `app.auth.twoFactor` maintain an active 2FA challenge within the session, `app.auth.restore` verifies persisted credentials on startup, and `app.close()` cleanly releases network connections, background executors, and the profile lock. See [runtime state and guards](architecture/sdk-and-api.md) for lifecycle details.

## CLI and local JSON-RPC

```sh
onethu commands learn
onethu schema learn.courses
onethu call learn.courses --args '[]'
onethu --desktop commands
```

By default, the CLI connects to its profile's background daemon over a dynamically assigned loopback port protected by a private Bearer access record. Passing `--desktop` (or an explicit endpoint) routes requests to the running GUI app's local service—`http://127.0.0.1:8787` by default, separate from both the CLI daemon's ephemeral port and the Gateway proxy listeners.

Internal clients POST JSON-RPC requests to `/cli/v1`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "service/call",
  "params": {"operation": "learn.courses", "args": []}
}
```

Authenticated local clients pair this JSON-RPC envelope with discovery, Bearer credentials, cancellation signals, and deadline budgets: `service/list` enumerates available operations, and `service/call` dispatches one. Responses follow strict JSON-RPC 2.0 framing, matching the request `id` and carrying either `result` or `error`.

The public MCP server supports `initialize`, `tools/list`, and `tools/call`, exposing `onethu_commands` for discovery and `onethu_call` for execution (while the built-in SDK model assistant uses `onethu_catalog` for discovery). See [CLI architecture](architecture/cli-and-agents.md) and [usage](onethu-cli.md).

## Private interfaces and authorization

`desktop.*` coordinates session state, Cookie mirrors, versioned documents, and scheduled-task handoff with the main window, while `gateway.control` manages proxy listeners, local certificates, system proxy settings, diagnostics, and scoped ticket renewal. Both namespaces are reserved for authenticated local control paths and excluded from public model tool directories.

Every call is governed jointly by the active account, caller-source permissions, user mode and privacy consent, and local execution policy. Scheduled tasks additionally carry a standing scope managed by the task scheduler, while local configuration changes remain restricted to trusted host interfaces.

## Size, time and completeness

| Boundary | Current implementation | Caller behavior |
| --- | --- | --- |
| Ordinary CLI/MCP request | 1 MiB | Argument files retain the envelope limit |
| Private desktop handoff | 8 MiB | Registered private methods only |
| Local client response | 16 MiB | Business pagination, batches or files |
| SDK positional argument count | At most 16 | Follow tuple schema |
| SDK argument JSON length | 100,000 JS characters | Separate from wire-byte limits |
| SDK operation time | About 110 seconds by default, at most 150 | Shorter deadlines supported; client reserves response margin |
| Managed Gateway | 1 GiB upload, 4 GiB download, 180 seconds | Streaming/backpressure/cancellation; upstream may fail sooner |
| Model context/tool result | Assistant-specific budget | Inspect truncation and remaining content |

Sources: [CLI client](../../packages/cli/src/client.mjs), [daemon](../../packages/cli/src/daemon.mjs), [SDK dispatch](../../packages/sdk/src/index.ts), [Gateway manager](../../packages/gateway/src/manager.mjs). Individual operations may apply tighter domain-specific bounds.

Public SDK projections preserve regular strings and arrays while stripping secret fields and authenticated URL parameters, and error payloads enforce separate diagnostic length caps. Callers should inspect domain-level pagination and status fields—such as Learn's `complete` flag, staging `nextOffset` cursors, and per-item export statuses—alongside transport payload limits and assistant context budgets.

## Errors and compatibility

The runtime distinguishes schema validation errors, permission denials, account switches, authentication challenges, upstream business rejections, rate limits, and network drops so callers can handle each case cleanly. Read operations can retry within their remaining deadline budget, while timed-out writes reconcile upstream state before retrying. Returned page content is treated as external data, with credentials scrubbed from diagnostics and tool outputs.

Plugin type definitions, SDK operation schemas, the private desktop protocol, board documents, and packaged runtime artifacts each version and migrate on their own schedule. Shipping a capability end-to-end spans four stages: type declaration, runtime registration, permission wiring, and verification on target devices.

## Maintenance

```sh
node tools/docs-api-surface.mjs
node tools/cli-catalog.mjs --check
node tools/docs-catalog.mjs
pnpm lint:docs
```

Regenerate the API surface tables whenever `types.ts`, `facade.ts`, or the extractor scripts change, and keep architectural notes here and in the architecture chapters. Automated count checks read directly from the JSON snapshot so test fixtures stay aligned as new methods land.
