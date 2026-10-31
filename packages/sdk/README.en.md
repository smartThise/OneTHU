# OneTHU SDK

[简体中文](README.md)

An independent Node.js runtime for OneTHU. CLI, MCP, plugins and assistant hosts share university sessions, services, authorization checks and scheduling. The desktop application does not need to be running.

Requires **Node.js 20.19.x or 22.12+**. Public declarations pass strict NodeNext checks with TypeScript 5.9. This repository currently distributes locally built `.tgz` archives; this package has not been published to npm.

## Build and install

From the repository root:

```sh
pnpm install
pnpm --filter @onethu/sdk pack:standalone
```

Install the resulting archive in another project:

```sh
npm install /absolute/path/onethu-sdk-0.11.4.tgz
```

The default output is `packages/sdk/artifacts/`. Runtime code, public declarations and license notices are included, without `workspace:*` dependencies. A `.sha256` file accompanies the archive. Use `node packages/sdk/scripts/pack.mjs --out /absolute/output` to select an output directory. Packing does not publish to npm.

Standard Node type dependencies are bundled, so installation needs no separate university SDK or workspace package. Run `node packages/sdk/scripts/test-pack.mjs /absolute/path/sdk.tgz` to perform an offline installation and check the runtime and public TypeScript API in a temporary consumer project.

## Runtime lifecycle

```ts
import { createOneThu } from '@onethu/sdk';

const app = await createOneThu({ dataDir: '/absolute/private/profile' });
try {
  // Discovery is offline.
  console.log(app.list().operations.map(operation => operation.name));
  // Restoration explicitly performs a read-only account/session probe.
  const status = await app.auth.restore();
  if (status.authenticated) {
    console.log(await app.call({ operation: 'learn.currentSemester' }));
  }
} finally {
  await app.close();
}
```

The profile is private to the OS user and exclusively locked while the runtime is active. Use one active runtime per process, call `close()` on exit, and use a separate private profile on each device.

## Login and two-factor authentication

Obtain credentials through hidden terminal input or another secure input surface. Call `app.auth.login({ username, password })`. A `need-2fa` result contains the methods advertised by the university. Continue with `chooseMethod(type)`, `sendCode(type)` when applicable, and `verify(type, code)` on `app.auth.twoFactor`; `cancel()` ends the pending flow.

The interactive flow stays in one process. Passwords are kept in memory; established cookies and stable device identifiers are stored privately. A new process can restore an established session, but cannot resume an earlier process's password or unfinished challenge. Trusted-device registration is requested only with explicit `trustDevice: true`. Exclude passwords, cookies, verification codes and tokens from host logs.

## Discovery and authorization

`app.list()` describes implemented operations, argument schemas, permissions and mutation flags. Treat it as the callable capability list.

```ts
await app.call({ operation: 'learn.courses', args: [] });
await app.call({
  operation: 'cal.add',
  args: ['Study plan', '2026-10-25', '10:00', '11:00', { local: true }],
  confirm: true,
});
```

Mutations require local confirmation by default. A local host may pass `confirm: true` after reviewing the operation with its user; model, MCP and plugin requests cannot use this flag to bypass local policy. Credentials, plugin installation, model settings and IM bindings are local configuration operations. `setAutomatic(true, { confirm: true })` explicitly enables automatic execution; the host should explain that choice first.

Calls accept `deadlineUnixMs`. The second argument can provide an abort `signal`, a permission set and a final `beforeWrite` guard. Account/policy changes and expired deadlines prevent further submission. Downloads return successful files and itemized failures; partial results are not a complete course archive.

## Scope

- University learning, portal, reservation, mail, CalDAV and course-selection reads reuse shared clients. Query `list()` for the available operations.
- Mail/CalDAV, cloud and external-homework sessions are configured separately for the current account. External sources currently use imported sessions; upstream authentication requirements still apply.
- `memory.*` reads Markdown only from this account's `accounts/<account SHA-256>/memory` directory. OH cloud memory and the desktop mirror remain separate.
- Notifications, IM, tasks and plugins run in Node. Enabled native plugin code has the OS user's process privileges and requires explicit installation and enablement.
- GUI navigation, boards and windows belong to the desktop host. The distributable package targets Node; workspace browser exports for shared modules remain available to desktop source builds.
- Real university, Windows ACL and multi-account checks depend on release validation. Synthetic fixtures do not establish complete live-service or device coverage.

## License

Read the complete project [LICENSE](LICENSE), including its additional use conditions, and the provenance and dependency notices in `LICENSES/` and `dist/THIRD_PARTY_NOTICES.txt`. These files accompany the distribution.
