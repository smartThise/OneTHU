# SDK personal assistant

`createAssistant({store,fetch?,listOperations,dispatch,getAccount,provider?})`
runs a bounded, OpenAI-compatible tool-calling loop. Model and IM network calls run
only when `run` is invoked. The host supplies the private SDK store and operation
router, confining execution strictly to registered SDK operations (with zero shell or
arbitrary JavaScript execution).

Methods:

- `configure(config,{confirm:true})`: saves local assistant settings per school account.
- `status()`: returns readiness flags, provider/model names, active budgets, and the
  exposed-operation count, omitting the API key and endpoint URL. Availability reflects
  local configuration state without performing a live network probe.
- `run(text,{signal?,beforeWrite?,sessionId?})`: runs a conversation turn and returns
  `{text,tools,usage,turns,complete,stopReason,sessionId,errorCode?}`.
- `clear(sessionId='default',{confirm:true})`: clears short-term memory for that account and session.
- `close()`: aborts in-flight model/tool requests and waits for active wrappers to settle.

Custom model configuration:

```js
await assistant.configure({
  baseUrl: 'https://your-model-provider.example/v1',
  apiKey: '...', model: 'your-model', language: 'zh-CN',
}, {confirm:true});
```

Requests post to `/chat/completions`, so configure `baseUrl` without that suffix.
Remote providers require HTTPS, while HTTP loopback URLs are supported for local model
servers. HTTP redirects are rejected so `Authorization` headers stay pinned to the
configured origin. The API key is stored in plaintext inside the user-private local
SDK store. User prompts and the allowed tool outputs needed to answer them are sent to
the configured model provider, so choose an endpoint appropriate for campus data.

When configured with `provider:'madmodel'`, the assistant delegates model requests to an
injected `provider(body,{signal,beforeWrite,model})` callback, which returns a standard
chat-completions JSON payload while honoring cancellation and final write guards. If
`provider:'madmodel'` is selected without supplying that callback, `status()` reports
unavailable and `run` returns an explicit error; MadModel sign-in and school session
setup are managed by the host application.

`listOperations()` supplies the full operation descriptors—including `localOnly` and
`mutation` flags—so the assistant can filter capabilities accurately. By default, only
read-only operations are exposed to the model. Passing `allowedOperations:[...]` selects
a custom subset, while `localOnly` operations, `auth.*`, `config.*`, `agent.*`,
`assistant.*`, and unknown or GUI-only operations always remain excluded. Including an
operation in `allowedOperations` exposes its schema to the model, while actual execution
routes through `dispatch(operation,args,{signal,beforeWrite})` with source `agent` under
the SDK's automatic or per-request permission policy.

The model interacts through two tools: `onethu_catalog` (bounded catalog and schema
lookup) and `onethu_call` (single-operation invocation with positional `args`). Tool
calls run serially with full runtime argument validation. Once any write attempt is
denied by permission or confirmation policy, subsequent writes in the same `run` are
blocked immediately. Every tool output is tagged as external untrusted content, redacted
for common secret fields and credential query parameters, and truncated explicitly when
oversized—keeping any prompt-like text inside fetched pages or documents strictly inert.

Default per-run budgets cap execution at 6 model turns, 12 tool calls, 2,048 output
tokens per round, 24,000 total tokens, 120 seconds overall, and 60 seconds per model
HTTP request. Configurable upper bounds allow up to 12 turns, 32 tool calls, 8,192
output tokens, and 200,000 total tokens. Total token tracking uses provider-reported
usage when available and falls back to a conservative byte estimate to bound local
processing (provider billing counts tokens independently). Separate byte caps also guard
user input, conversation history, response bodies, and tool payloads.

If a model response is interrupted after one or more tools have succeeded, `run` returns
`complete:false` along with the completed tool audit records; runs ending with missing
text, exhausted token/tool budgets, or partial provider stops likewise return
`complete:false`. Request cancellation or school-account switches immediately halt
subsequent tool calls and memory updates. Host SDK adapters should carry `signal` and
`beforeWrite` guards right up to outbound submission, as requests already transmitted
upstream take effect on the remote server.

Conversation memory is partitioned by school account and `sessionId` (IM callers should
use `channel:chat:sender` IDs). Each session retains up to 20 user/assistant text
messages plus brief tool status receipts, omitting raw tool arguments and response
bodies. Reconfiguring the assistant or clearing memory cancels active runs for that
account.

`node --test packages/sdk/test/assistant.test.mjs` runs offline against loopback HTTP
servers and local model fixtures, covering the full tool loop, permissions,
account/session memory isolation, redirect rejection, aborts, size/budget limits,
partial failures, and injected providers. Live model endpoints, Windows host behavior,
and end-to-end Feishu/WeChat conversations with real accounts are verified separately
during acceptance testing—verify live connectivity independently after configuring a
gateway or model provider.
