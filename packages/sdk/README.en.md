# OneTHU SDK

[简体中文](README.md)

A standalone Node.js runtime for OneTHU. It provides shared university sessions, campus service clients, authorization guards, and task scheduling for the CLI, MCP servers, plugins, and personal assistant hosts—running independently of the desktop application.

Requires **Node.js 20.19.x or 22.12+**, with public declarations verified under TypeScript 5.9 strict NodeNext checks. The SDK is distributed directly from this repository as a locally built `.tgz` archive (unpublished on the public npm registry).

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

By default, archives and their companion `.sha256` checksum files are written to `packages/sdk/artifacts/`. Each tarball bundles runtime code, public declarations, and license notices with zero `workspace:*` dependencies, and stays local on disk. Pass `node packages/sdk/scripts/pack.mjs --out /absolute/output` to customize the output directory.

Standard Node type dependencies are bundled directly in the archive, so consumers can install it standalone without separate university SDKs or workspace packages. Run `node packages/sdk/scripts/test-pack.mjs /absolute/path/sdk.tgz` to verify offline installation, runtime imports, and the public TypeScript API in a temporary consumer project.

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

Each profile directory is restricted to the current OS user and held under an exclusive lock while the runtime is active. Keep a single active runtime per process, call `close()` before exiting, and give each device its own private profile directory.

## Login and two-factor authentication

Collect credentials through hidden terminal input or another secure input surface, then call `app.auth.login({ username, password })`. When two-factor verification is required, the `need-2fa` result lists the methods offered by the university; complete verification on `app.auth.twoFactor` via `chooseMethod(type)`, `sendCode(type)` (when applicable), and `verify(type, code)`, or call `cancel()` to abort the pending challenge.

Interactive sign-in completes within a single process: passwords remain in memory only during login, while established session cookies and stable device identifiers are persisted in the private profile. Subsequent processes can restore an established session via `app.auth.restore()`, while any unfinished two-factor challenge or password stays scoped to the process that started it. Pass `trustDevice: true` when you explicitly want to register a trusted-device token with the university, and redact passwords, cookies, verification codes, and tokens from host logs.

## Discovery and authorization

`app.list()` returns the active catalog of implemented operations along with their argument schemas, required permissions, and mutation flags—use it as the source of truth for callable capabilities.

```ts
await app.call({ operation: 'learn.courses', args: [] });
await app.call({
  operation: 'cal.add',
  args: ['Study plan', '2026-10-25', '10:00', '11:00', { local: true }],
  confirm: true,
});
```

Mutations require local confirmation by default. An interactive local host may pass `confirm: true` after reviewing the action with the user, whereas requests originating from models, MCP clients, or plugins always follow the active local policy. Managing credentials, installing plugins, updating model settings, and binding IM channels are reserved for local host configuration. Calling `setAutomatic(true, { confirm: true })` enables automatic write execution; hosts should explain the scope of this setting to the user beforehand.

Every call accepts `deadlineUnixMs`, and the second argument supports an abort `signal`, a scoped permission set, and a final `beforeWrite` guard. Account switches, policy updates, or expired deadlines halt any unsubmitted write. Batch download operations return both saved files and itemized failure records—inspect per-item statuses and completeness flags to verify whether a course archive finished in full.

## Scope

- University learning, portal, reservation, mail, CalDAV, and course-selection reads share unified campus clients; inspect `list()` for the exact operations available.
- Mail/CalDAV, cloud storage, and external homework sources maintain per-account credentials. External homework integrations currently import existing sessions while respecting upstream authentication rules.
- `memory.*` reads Markdown notes from this profile's `accounts/<account SHA-256>/memory` directory, kept separate from OH cloud memory and desktop mirrors.
- Notifications, IM channels, scheduled tasks, and plugins run in Node. Enabled native plugins execute with the current OS user's process privileges and require explicit local installation and activation.
- GUI navigation, whiteboards, and native windows live in the desktop host. The standalone tarball targets Node, while browser-conditional workspace exports remain available to desktop source builds.
- Automated tests run against synthetic local fixtures; live university services, Windows ACL enforcement, and multi-account workflows are verified during release acceptance testing.

## License

See the project [LICENSE](LICENSE) (including its additional use conditions) along with the provenance and third-party dependency notices in `LICENSES/` and `dist/THIRD_PARTY_NOTICES.txt`, all of which ship inside the packaged archive.
