# Headless plugin host

`createPluginHost` runs local JS and native plugins directly inside a standalone logged-in SDK process, with the caller holding the exclusive SDK data-directory lock for the host's lifetime.

```js
import { createPluginHost } from './plugins/index.mjs';

const plugins = createPluginHost({
  rootDir: '/absolute/sdk-data/plugins',
  getSession: () => ({ status: 'ready', username: 'current-user' }),
  resolveOperation: name => sdkCatalog.get(name),
  dispatch: (name, args, context) => sdk.call(name, args, context),
});
await plugins.inspect('/absolute/local-plugin');
await plugins.install('/absolute/local-plugin', { confirm: true });
await plugins.enable('example.plugin', { confirm: true });
await plugins.commands('example.plugin');
await plugins.call('example.plugin', 'courses', 'input');
await plugins.disable('example.plugin');
await plugins.uninstall('example.plugin', { confirm: true });
await plugins.close();
```

`resolveOperation` describes each SDK operation as `{ permission, mutation?, supported?, guiOnly? }`, failing closed on unknown operations. Reverse `dispatch` calls receive `{ pluginId, permissions, signal, confirm, beforeWrite }`, and the shared SDK router validates arguments, session generation, and final write authorization (`getSession` may be synchronous or async). Mutating operations require `confirm: true` on `call`, while plugin activation runs with read-only permissions. Both `enable` and `call` accept the caller's `signal` and `beforeWrite` hook; forward `beforeWrite` through to final SDK submissions so async plugins stay bound to their originating account and policy generation, and aborting `signal` terminates the child process along with any in-flight SDK calls.

`inspect` and `install` read local directories or `.zip` archives statically from `manifest.json` without executing plugin code, and `inspect` returns the parsed manifest, package digest, per-file SHA-256 hashes, and capability compatibility report. Installing, enabling, and uninstalling each require `{ confirm: true }`. Newly installed plugins start disabled; once enabled, that state persists across SDK restarts so subsequent `call` invocations spawn the plugin on demand, while listing plugins or commands reads metadata purely from disk. Activation and command calls default to a 30-second deadline (up to 150 seconds), and timeouts or `disable` calls terminate the child process and cancel its active SDK requests.

**JavaScript plugins** follow the single-file ES module contract (`export const manifest`, `export default function (ctx)`, `ctx.registerCommand`, and `ctx.onethu.*`), running in a Node worker that provides synchronous `storage`, `settings`, and session-snapshot APIs and flushes storage writes before a command resolves. Bundle any helper modules into the single entry file ahead of time (Node workers run without browser/DOM globals or multi-file relative imports), and include a `manifest.json` sidecar with an `"entry"` field such as `"entry": "plugin.js"` so metadata can be read statically before activation.

**Rust and native plugins** speak newline-delimited JSON-RPC (`activate({settings,permissions})`, `run({command,input})`, and reverse `onethu.call({ns,method,args})`) using a binary compiled for the host OS and CPU. The host sets `OH_MCP_PORT=0` so Harness sidecar binaries keep their standalone local MCP listener closed, and routes reverse `onethu.call` requests against the operations registered in the SDK router's capability catalog.

Desktop-only capabilities—GUI panels, themes, clipboard, native notifications, widgets, and WebViews—report as unavailable in headless mode, and WASM packages can be inspected and installed while awaiting a future OneTHU WASM runtime ABI before enabling.

JS and native plugins run as **trusted local child processes** with standard user-level filesystem and network access; manifest permissions scope calls across the `onethu.*` SDK bridge, so review and approve plugin packages before enabling them. The host strips session credentials from child environment variables, and opt-in `onEvent` diagnostic callbacks should treat emitted payloads as potentially containing user or plugin data.

ZIP extraction rejects path traversal, absolute or reserved Windows paths, symlinks, case-insensitive name collisions, file/directory conflicts, invalid CRCs, encrypted entries, and ZIP64 archives, enforcing caps of 4,096 entries, 64 MiB per file or archive, and 256 MiB total uncompressed size. The host re-verifies file hashes whenever starting a stopped plugin, and replacing an installed plugin requires uninstalling the previous version first. Per-plugin storage lives in an isolated private file capped at 4 MiB (removed on `uninstall`), while runtime setting overrides stay in memory for the host's lifetime—keep secret values out of static manifest defaults.

**Packaging note:** place `worker.mjs` alongside the bundled runtime (for example, `dist/worker.mjs` next to `dist/index.mjs`), or pass an explicit `workerUrl` to `createPluginHost`. `worker.mjs` depends only on Node built-in modules.

The test suite exercises protocol handling, archive guards, permissions, and lifecycle management offline using local JS fixtures, malformed ZIP test cases, and a zero-dependency Rust fixture compiled with `rustc`. Windows process/installation behavior and live Feishu/WeChat workflows can be verified separately in those target environments.
