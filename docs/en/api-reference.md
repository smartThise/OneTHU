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

Select signatures by caller, even when names match. Plugin `learn.courses` need not have the same parameters/results as the portable Learn operation. Independent runtimes do not automatically own GUI state; discover their actual operations first.

## Plugin API

[types.ts](../../apps/desktop/src/plugins/types.ts) generates the current **41 namespaces and 297 method entries**. [facade.ts](../../apps/desktop/src/plugins/facade.ts) implements host behavior and permission checks.

```ts
// The host loads the plugin and injects ctx.
const status = ctx.onethu.session.status();
const username = ctx.onethu.session.username();
```

Each declaration determines synchronous/Promise behavior. Manifest permissions combine with mode, platform, identity, ownership and server authorization. “Inspect facade” in the generated table means no direct literal gate was extracted; contextual checks still apply.

- [Generated signatures](api-surface.md)
- [Machine-readable snapshot](../api-surface.json)
- [Manifests, sidecars and examples](plugin-development.md)

Rust plugins request `onethu.call` with `params.ns`, `params.method` and positional `params.args`. The host returns the matching ID's result/error. Host RPC, MCP tools and SDK envelopes are separate contracts.

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

`CallRequest` accepts `operation`, optional `args`, `confirm` and `deadlineUnixMs`. Positional-array schemas come from `app.list()`. A trusted embedder supplies source, permission set, signal and `beforeWrite` in the second argument; external envelopes cannot assign those capabilities.

Operation descriptors include name, description, schema, permission, mutation, authentication and local-only metadata. Authentication/local configuration uses separate methods. A model cannot enable local policy using `confirm:true`.

`app.auth.login` / `twoFactor` preserve one challenge; `restore` verifies saved state; `close` releases connections, executors and the profile lock. See [runtime state and guards](architecture/sdk-and-api.md).

## CLI and local JSON-RPC

```sh
onethu commands learn
onethu schema learn.courses
onethu call learn.courses --args '[]'
onethu --desktop commands
```

Default CLI uses its profile daemon. Explicit desktop/endpoint mode uses GUI services. The daemon has a random loopback port and private Bearer access record. The GUI service default is `http://127.0.0.1:8787`; it is not the daemon or Gateway port.

Internal clients POST JSON-RPC to `/cli/v1`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "service/call",
  "params": {"operation": "learn.courses", "args": []}
}
```

Real clients handle discovery, credentials, cancellation and deadline. An envelope alone does not grant access. `service/list` discovers operations, and `service/call` executes one. Clients validate JSON-RPC version, ID and exclusive result/error.

Public MCP supports `initialize`, `tools/list` and `tools/call`; its tools are `onethu_commands` and `onethu_call`. The optional SDK model assistant instead calls its discovery tool `onethu_catalog`. See [CLI architecture](architecture/cli-and-agents.md) and [usage](onethu-cli.md).

## Private interfaces and authorization

`desktop.*` handles main-window/session/Cookie/document/task handoff. `gateway.control` manages listeners, certificates, system settings, diagnostics and scoped ticket renewal. Authorized native/local control paths use them; public model directories exclude their credential payloads.

Account, source permission, mode/privacy consent and local execution policy all constrain calls. Tasks additionally hold manager-owned standing scope. External model tools cannot promote themselves to local configuration authority.

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

Sources: [CLI client](../../packages/cli/src/client.mjs), [daemon](../../packages/cli/src/daemon.mjs), [SDK dispatch](../../packages/sdk/src/index.ts), [Gateway manager](../../packages/gateway/src/manager.mjs). Individual operations may impose additional bounds.

Ordinary SDK projections retain strings/arrays while removing secret fields and URL credentials. Errors have separate diagnostic-length bounds. Learn `complete`, staging `nextOffset` and export item status indicate continuation/partial results. Business completeness, transport size and model context are separate concerns.

## Errors and compatibility

Schema, permission, account change, authentication, business denial, rate limiting and connection loss have distinct semantics. Reads may retry within budget; unknown writes require reconciliation. Returned page content is external data, with secrets removed from diagnostics and tool outputs.

Plugin types, operation schemas, private desktop protocol, board documents and runtime artifacts have their own versions/migrations. Declaration, registration, authorization and physical-device acceptance are separate evidence.

## Maintenance

```sh
node tools/docs-api-surface.mjs
node tools/cli-catalog.mjs --check
node tools/docs-catalog.mjs
pnpm lint:docs
```

Generated tables come from types/facade/extractor changes. Handwritten semantics live here and in architecture chapters. Count checks consume the JSON snapshot so interface additions do not leave verification fixtures behind.
