/** Execute the real TS CLI boundary with controlled host/UI imports. No account/network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('apps/desktop/src/cli/catalog.json', root), 'utf8'));
function moduleAt(path, imports = {}, env = {}, suffix = '') {
  const source = readFileSync(new URL(path, root), 'utf8');
  const code = ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  const require = name => {
    if (!Object.hasOwn(imports, name)) throw Error(`Unmocked import in ${path}: ${name}`);
    return imports[name];
  };
  new Function('exports', 'require', ...Object.keys(env), code + '\n' + suffix)(exports, require, ...Object.values(env));
  return exports;
}
const validation = moduleAt('apps/desktop/src/cli/validation.ts');
const projection = moduleAt('apps/desktop/src/cli/publicResult.ts');
const policy = moduleAt('packages/sdk/src/policy.ts');
const taskCommands = moduleAt('packages/sdk/src/tasks/operations.ts');
const messages = { t: key => key, msg: key => key, resolveMessage: text => text };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function fixture({ requested = true, authorized = true, automatic = false, internal = false, permissions = ['learn:read', 'library:read', 'library:book', 'kongjian:book', 'venue:book'] } = {}) {
  let epoch = 1;
  let epochRead = async () => epoch;
  let now = Date.now();
  let epochAssert = async expected => { if (epoch !== expected) throw Error('SESSION_CHANGED: native account generation changed'); };
  const session = { username: 'account-a', status: 'ready' };
  const subscribers = new Set();
  const subscribe = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
  const changed = () => { for (const fn of subscribers) fn(); };
  let taskBinding;
  const calls = [], timers = new Map(); let nextTimer = 0;
  const responses = new Map();
  const api = { session: { status: () => session.status, username: () => session.username } };
  for (const op of catalog) {
    const [namespace, method] = op.name.split('.');
    api[namespace] ??= {};
    api[namespace][method] ??= async (...args) => {
      calls.push({ operation: op.name, args });
      return responses.has(op.name) ? responses.get(op.name)(...args) : { ok: true };
    };
  }
  const confirm = moduleAt('apps/desktop/src/lib/confirm.tsx', {
    react: {}, 'react-dom': {}, 'react/jsx-runtime': {}, '@onethu/gui': {},
    '../state/navStack.js': {}, '../i18n/index.js': messages,
  }, { globalThis: {} }, 'exports.__pending = () => store.pending;');
  async function nativeCall(operation, args) {
    await responses.get(`prefetch:${operation}`)?.();
    if (typeof args.at(-1) === 'function') await args.pop()();
    calls.push({ operation, args });
    return responses.get(operation)?.(...args) ?? { status: 1 };
  }
  const info = Object.fromEntries(Object.entries({
    bookLibrarySeat: 'native-library.book', cancelLibBooking: 'native-library.cancel',
    bookLibRoom: 'native-libroom.book', cancelLibRoomBooking: 'native-libroom.cancel',
    kongjianBook: 'native-kongjian.book', kongjianCancel: 'native-kongjian.cancel',
    getLibRoomInfoList: 'libroom.list', getLibRoomResourceList: 'libroom.resources',
    getLibRoomRecords: 'libroom.records', fuzzySearchLibRoomMember: 'libroom.fuzzyMember',
  }).map(([method, name]) => [method, (...args) => nativeCall(name, args)]));
  const venue = { cancelReserve: (...args) => nativeCall('native-venue.cancel', args) };
  const userext = { mcpServerEnabled: () => requested, cliAutoExecuteEnabled: () => automatic, subscribeUserExt: subscribe };
  const privacy = { ohAuthorized: () => authorized, subscribePrivacy: subscribe, initPrivacyConsent: async () => {} };
  const learn = [{ name: 'courses', description: 'session-bound native course service', parameters: { type: 'array', items: [], minItems: 0, maxItems: 0, additionalItems: false },
    run: async () => { calls.push({ operation: 'learn.courses', args: [] }); return [{ id: 'course-a' }]; } }];
  const serviceModule = moduleAt('apps/desktop/src/cli/service.ts', {
    './catalog.json': catalog, './validation.js': validation, './publicResult.js': projection,
    '@onethu/sdk/policy': policy, '@onethu/sdk/tasks': taskCommands,
    '../lib/sharedRuntime.js': { usesSharedRuntime: () => false },
    '../state/cliTasks.js': { bindDesktopTasks(binding) { taskBinding = binding; }, runDesktopTaskControl: async (operation, args, check) => { await check(); calls.push({ operation, args }); return { ok: true }; }, listTaskChannels: async () => [], readTaskInbox: async () => [], normalizeTaskChannels: async draft => draft },
    '../lib/cliLearn.js': { cliLearnOperations: learn, runCliLearnDownloadWithDeadline: () => { throw Error('Unexpected download in boundary fixture'); } },
    '../lib/clients.js': { session, info }, '../lib/venue.js': { venueClient: venue },
    '../lib/transport.js': { nativeSessionEpoch: () => epochRead(), assertNativeSessionEpoch: expected => epochAssert(expected) },
    '../state/userext.js': userext, '../state/privacyConsent.js': privacy,
    '../i18n/index.js': messages, '../lib/confirm.js': confirm,
  }, { navigator: { platform: 'test' }, Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  let guardFactory = () => api;
  return {
    service: serviceModule.createCliService(api, new Set(permissions), {
      create: beforeWrite => guardFactory(beforeWrite), mutations: new Set(catalog.filter(op => op.mutation).map(op => op.name)), internal,
    }), api, calls, responses, session, confirm, timers,
    setGuardFactory(fn) { guardFactory = fn; },
    setRequested(value) { requested = value; changed(); }, setAuthorized(value) { authorized = value; changed(); },
    setAutomatic(value) { automatic = value; changed(); },
    setEpoch(value) { epoch = value; }, setEpochRead(fn) { epochRead = fn; },
    setEpochAssert(fn) { epochAssert = fn; }, advanceTime(ms) { now += ms; }, now: () => now,
    fireTimeout() { for (const timer of [...timers.values()]) if (timer.ms === 45_000) timer.fn(); },
    userext, privacy, get taskBinding() { return taskBinding; },
  };
}

let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack ?? error}`); }
}
async function pendingWrite(f, operation = 'cal.remove', args = ['local-item']) {
  const promise = f.service.call({ operation, args, confirm: true });
  await flush(); assert.ok(f.confirm.__pending(), 'real app confirmation should be visible');
  return { promise };
}

await test('disabled switch and revoked OH block list/call without any API work', async () => {
  for (const opts of [{ requested: false }, { authorized: false }]) {
    const f = fixture(opts);
    assert.throws(() => f.service.list(), /CLI_DISABLED/);
    await assert.rejects(f.service.call({ operation: 'info.schedule' }), /CLI_DISABLED/);
    assert.equal(f.calls.length, 0);
  }
});
await test('internal OH reads do not require an external CLI listener; revocation, tasks and mutation approval still apply', async () => {
  const f = fixture({ requested: false, internal: true });
  assert.ok(f.service.list().operations.some(op => op.name === 'contacts.list'));
  await f.service.call({ operation: 'contacts.list' });
  assert.equal(f.calls[0].operation, 'contacts.list');
  await f.service.call({ operation: 'tasks.list' });
  await assert.rejects(f.service.call({ operation: 'xiaoda.enableSkill', args: ['skill', true] }), /CONFIRMATION_REQUIRED/);
  const pending = f.service.call({ operation: 'xiaoda.enableSkill', args: ['skill', true], confirm: true });
  await flush(); assert.ok(f.confirm.__pending());
  f.confirm.answerConfirm(false); await assert.rejects(pending, /CONFIRMATION_CANCELLED/);
  assert.equal(f.calls.length, 2);
  f.setAuthorized(false); assert.throws(() => f.service.list(), /OH_AUTHORIZATION_REQUIRED/);
  await assert.rejects(f.service.call({ operation: 'contacts.list' }), /OH_AUTHORIZATION_REQUIRED/);
});
await test('unknown namespaces, extra flags, wrong types and prototype keys fail closed', async () => {
  const f = fixture();
  for (const input of [
    { operation: 'net.fetch', args: ['https://example.com'] },
    { operation: 'info.schedule', confirmed: true },
    { operation: 'info.schedule', args: 'all' },
    { operation: 'cloud.list', args: ['repo', { constructor: 'evil' }] },
    JSON.parse('{"operation":"info.schedule","__proto__":{"enabled":true}}'),
  ]) await assert.rejects(f.service.call(input), /UNKNOWN_OPERATION|INVALID_ARGUMENTS/);
  assert.equal(f.calls.length, 0);
});
await test('catalog is explicit and read results preserve more than a summary page', async () => {
  const f = fixture();
  const operations = f.service.list().operations;
  assert.equal(new Set(operations.map(op => op.name)).size, operations.length);
  assert.ok(operations.every(op => !Object.hasOwn(op, 'run')));
  assert.ok(!operations.some(op => /^(?:(?:net|storage|settings)\.|session\.login)/.test(op.name)));
  const records = Array.from({ length: 250 }, (_, id) => ({ id, title: `record-${id}` }));
  f.responses.set('cloud.repos', () => records);
  assert.deepEqual(await f.service.call({ operation: 'cloud.repos' }), records);
});
await test('all published mutations require confirm before executing or prompting', async () => {
  const f = fixture();
  function value(schema) {
    if (schema.enum) return schema.enum[0];
    if (schema.anyOf) return value(schema.anyOf[0]);
    if (schema.type === 'array') return [];
    if (schema.type === 'object') return Object.fromEntries((schema.required ?? []).map(key => [key, value(schema.properties[key])]));
    if (schema.type === 'boolean') return false;
    if (schema.type === 'number' || schema.type === 'integer') return 1;
    return 'test';
  }
  for (const op of catalog.filter(op => op.mutation)) {
    const args = op.parameters.items.slice(0, op.parameters.minItems).map(value);
    await assert.rejects(f.service.call({ operation: op.name, args }), /CONFIRMATION_REQUIRED|INVALID_ARGUMENTS/, op.name);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.confirm.__pending(), null);
});
await test('caller confirm:true still waits for the real app dialog', async () => {
  const f = fixture(); const { promise } = await pendingWrite(f);
  assert.equal(f.calls.length, 0);
  f.confirm.answerConfirm(true); await promise;
  assert.equal(f.calls.length, 1); assert.equal(f.confirm.__pending(), null);
});
await test('HMR module instances share confirmations within one window and clean up subscriptions', async () => {
  const windowGlobal = {};
  const load = global => moduleAt('apps/desktop/src/lib/confirm.tsx', {
    react: {}, 'react-dom': {}, 'react/jsx-runtime': {}, '@onethu/gui': {},
    '../state/navStack.js': {}, '../i18n/index.js': messages,
  }, { globalThis: global }, 'exports.__pending = () => store.pending; exports.__subscribe = subscribe;');
  const old = load(windowGlobal); let oldNotifications = 0;
  const unmount = old.__subscribe(() => oldNotifications++);
  const inFlight = old.confirmChoice('before HMR', { confirmText: 'Execute', cancelText: 'Cancel' });
  unmount();
  const current = load(windowGlobal); let notifications = 0;
  const unsubscribe = current.__subscribe(() => notifications++);
  assert.equal(current.__pending().msg, 'before HMR');
  current.answerConfirm(true); assert.equal(await inFlight, true);
  const retainedCallback = old.confirmChoice('old plugin callback after HMR', { confirmText: 'Execute', cancelText: 'Cancel' });
  assert.equal(current.__pending().msg, 'old plugin callback after HMR');
  assert.equal(notifications, 2); assert.equal(oldNotifications, 1);
  const anotherWindow = load({}); assert.equal(anotherWindow.__pending(), null);
  anotherWindow.answerConfirm(false); assert.ok(current.__pending());
  current.answerConfirm(true); assert.equal(await retainedCallback, true);
  unsubscribe(); old.answerConfirm(false); assert.equal(notifications, 3);
});
await test('an AbortSignal from a pre-HMR request cancels the visible current confirmation', async () => {
  const windowGlobal = {};
  const load = () => moduleAt('apps/desktop/src/lib/confirm.tsx', {
    react: {}, 'react-dom': {}, 'react/jsx-runtime': {}, '@onethu/gui': {},
    '../state/navStack.js': {}, '../i18n/index.js': messages,
  }, { globalThis: windowGlobal }, 'exports.__pending = () => store.pending;');
  const old = load(), controller = new AbortController();
  const pending = old.confirmChoice('cancel old request', { confirmText: 'Execute', cancelText: 'Cancel', signal: controller.signal });
  const current = load(); assert.ok(current.__pending());
  controller.abort(); assert.equal(await pending, false); assert.equal(current.__pending(), null);
});
await test('explicit local automatic policy skips both confirm flag and app dialog', async () => {
  const f = fixture({ automatic: true });
  assert.equal(f.service.list().confirmationMode, 'automatic');
  await f.service.call({ operation: 'cal.remove', args: ['local-item'] });
  assert.equal(f.calls.length, 1); assert.equal(f.confirm.__pending(), null);
  assert.equal(f.timers.size, 0);
  f.setAutomatic(false);
  assert.equal(f.service.list().confirmationMode, 'per-request');
  await assert.rejects(f.service.call({ operation: 'cal.remove', args: ['local-item'] }), /CONFIRMATION_REQUIRED/);
});
await test('public request fields and public operations cannot grant automatic policy', async () => {
  const f = fixture();
  for (const input of [
    { operation: 'cal.remove', args: ['local-item'], automatic: true },
    { operation: 'cal.remove', args: ['local-item'], confirmationMode: 'automatic' },
    { operation: 'settings.set', args: ['cliAutoExecute', true] },
    { operation: 'userext.setCliAutoExecute', args: [true] },
  ]) await assert.rejects(f.service.call(input), /INVALID_ARGUMENTS|UNKNOWN_OPERATION/);
  assert.equal(f.calls.length, 0); assert.equal(f.service.list().confirmationMode, 'per-request');
});
await test('automatic execution retains the global single-write gate', async () => {
  const f = fixture({ automatic: true }), work = deferred();
  f.responses.set('cal.remove', () => work.promise);
  const pending = f.service.call({ operation: 'cal.remove', args: ['first'] }); await flush();
  await assert.rejects(f.service.call({ operation: 'cal.remove', args: ['second'] }), /WRITE_BUSY/);
  work.resolve(null); await pending; assert.equal(f.calls.length, 1);
});
await test('automatic policy changes invalidate pending requests at the final reservation guard', async () => {
  for (const change of ['policy', 'server', 'consent', 'account', 'deadline']) {
    const f = fixture({ automatic: true }), work = deferred(); let started = false;
    f.responses.set('prefetch:native-library.cancel', async () => { started = true; await work.promise; });
    const pending = f.service.call({ operation: 'library.cancel', args: ['record'] }); await flush(); assert.ok(started);
    if (change === 'policy') { f.setAutomatic(false); f.setAutomatic(true); }
    if (change === 'server') { f.setRequested(false); f.setRequested(true); }
    if (change === 'consent') f.setAuthorized(false);
    if (change === 'account') f.setEpoch(2);
    if (change === 'deadline') f.advanceTime(111_000);
    work.resolve();
    await assert.rejects(pending, /CLI_SESSION_CHANGED|SESSION_CHANGED|CLI_DISABLED|CLI_DEADLINE_EXCEEDED/, change);
    assert.equal(f.calls.length, 0); assert.equal(f.confirm.__pending(), null);
  }
});
await test('enabling automatic policy cancels an existing prompt without retroactive execution', async () => {
  const f = fixture(), { promise } = await pendingWrite(f);
  f.setAutomatic(true);
  await assert.rejects(promise, /CONFIRMATION_CANCELLED|CLI_SESSION_CHANGED/);
  assert.equal(f.confirm.__pending(), null); assert.equal(f.calls.length, 0);
  await f.service.call({ operation: 'cal.remove', args: ['new-request'] }); assert.equal(f.calls.length, 1);
});
await test('automatic policy does not grant missing permissions or ignore expired requests', async () => {
  const f = fixture({ automatic: true, permissions: ['library:read'] });
  await assert.rejects(f.service.call({ operation: 'library.cancel', args: ['record'] }), /PERMISSION_REQUIRED/);
  await assert.rejects(f.service.call({ operation: 'cal.remove', args: ['record'], deadlineUnixMs: f.now() - 1 }), /CLI_DEADLINE_EXCEEDED/);
  assert.equal(f.calls.length, 0); assert.equal(f.confirm.__pending(), null);
});
await test('automatic consent is device-local and absent from portable user-extension documents', async () => {
  const values = new Map([['onethu.userext.v1', JSON.stringify({ v: 1, tools: [], flows: [], cliAutoExecute: true, automatic: true })]]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const load = () => moduleAt('apps/desktop/src/state/userext.ts', {
    '../i18n/index.js': messages, 'react-dom': {}, '../lib/safeHtml.js': {},
  }, { localStorage: storage });
  const first = load(); assert.equal(first.cliAutoExecuteEnabled(), false);
  first.setCliAutoExecute(true); first.setCreative(true);
  assert.equal(first.cliAutoExecuteEnabled(), true); assert.equal(load().cliAutoExecuteEnabled(), true);
  assert.ok(!Object.hasOwn(first.userExtSnapshot(), 'cliAutoExecute'));
  assert.ok(!Object.hasOwn(JSON.parse(values.get('onethu.userext.v1')), 'cliAutoExecute'));
  const exported = values.get('onethu.userext.v1');
  values.clear(); values.set('onethu.userext.v1', exported);
  assert.equal(load().cliAutoExecuteEnabled(), false, 'restoring the portable document on another device must not grant automatic writes');
});
await test('desktop settings expose an explicit localized automatic switch and keep revocation available', async () => {
  const snapshot = { requested: true, authorized: true, reachableNow: true, phase: 'ready' };
  const f = fixture();
  const locale = moduleAt('apps/desktop/src/i18n/locales/en-US.ts').default;
  const render = (android = false) => {
    const ui = moduleAt('apps/desktop/src/components/CliServerSettings.tsx', { './CliTasksSettings.js': { CliTasksSettings: () => null }, './CliTasksSettings.css': {},
      '@onethu/gui': { Btn: 'Btn', Inline: 'Inline', SettingsRow: 'SettingsRow', Switch: 'Switch' },
      'react/jsx-runtime': { Fragment: 'Fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
      '../lib/sharedRuntime.js': { refreshCliInstallation: async()=>null }, '../lib/transport.js': {isTauri:false},
      react: { useState: value=>[value,()=>{}], useEffect() {}, useSyncExternalStore: (_subscribe, get) => get() },
      '../i18n/index.js': { useLocale() {}, t: key => locale.messages[key] ?? key },
      '../state/userext.js': { ...f.userext, setCliAutoExecute: value => f.setAutomatic(value), setMcpServer() {} },
      '../state/cliRuntime.js': { useCliRuntime: () => snapshot, syncCliRuntime: async () => {} },
      '../lib/androidHost.js': { isAndroidNavigator: () => android },
    });
    return ui.CliServerSettings().props.children[2];
  };
  let row = render(); assert.equal(row.props.title, 'Allow automatic CLI / MCP execution');
  assert.match(row.props.sub, /bookings, cancellations, email sending and data changes/);
  assert.equal(row.props.control.props.checked, false);
  row.props.control.props.onChange(true); row = render(); assert.equal(row.props.control.props.checked, true);
  snapshot.requested = false; snapshot.authorized = false;
  assert.equal(render().props.control.props.disabled, false, 'user can revoke saved automatic consent while service is disabled');
  row.props.control.props.onChange(false); assert.equal(render().props.control.props.disabled, true);
  assert.equal(render(true), null, 'automatic-execution option is desktop-only');
  const seed = JSON.parse(readFileSync(new URL('docs/i18n/static-label-seed.json', root), 'utf8')).messages;
  const chinese = moduleAt('apps/desktop/src/i18n/locales/zh-CN.ts').default;
  for (const key of ['cli.auto.title', 'cli.auto.description', 'cli.auto.enabled']) {
    assert.equal(seed[key]['en-US'], locale.messages[key]); assert.equal(seed[key]['zh-CN'], chinese.messages[key]);
  }
});
await test('one write gate covers all callers until execution finishes', async () => {
  const f = fixture(); const work = deferred();
  f.responses.set('cal.remove', () => work.promise);
  const { promise } = await pendingWrite(f); f.confirm.answerConfirm(true); await flush();
  await assert.rejects(f.service.call({ operation: 'cal.remove', args: ['other'], confirm: true }), /WRITE_BUSY/);
  work.resolve(null); await promise;
  const next = await pendingWrite(f); f.confirm.answerConfirm(false);
  await assert.rejects(next.promise, /CONFIRMATION_CANCELLED/);
});
await test('45-second expiry closes its real confirmation and releases write gate', async () => {
  const f = fixture(); const { promise } = await pendingWrite(f);
  f.fireTimeout(); await assert.rejects(promise, /CONFIRMATION_CANCELLED/);
  assert.equal(f.confirm.__pending(), null); assert.equal(f.calls.length, 0);
  const next = await pendingWrite(f); f.confirm.answerConfirm(false); await assert.rejects(next.promise, /CONFIRMATION_CANCELLED/);
});
await test('revoking access closes pending confirmation without writing', async () => {
  const f = fixture(); const { promise } = await pendingWrite(f);
  f.setRequested(false); await assert.rejects(promise, /CLI_DISABLED|CONFIRMATION_CANCELLED/);
  assert.equal(f.confirm.__pending(), null); assert.equal(f.calls.length, 0);
});
await test('cancelled confirmation cannot later execute when an old button resolves', async () => {
  const f = fixture(); const { promise } = await pendingWrite(f); const pending = f.confirm.__pending();
  f.fireTimeout(); await assert.rejects(promise, /CONFIRMATION_CANCELLED/);
  pending.resolve(true); await flush(); assert.equal(f.calls.length, 0);
});
await test('close then reopen during the first native epoch await invalidates request', async () => {
  const f = fixture(); const epoch = deferred(); f.setEpochRead(() => epoch.promise);
  const promise = f.service.call({ operation: 'cloud.repos' });
  f.setRequested(false); f.setRequested(true); epoch.resolve(1);
  await assert.rejects(promise, /CLI_SESSION_CHANGED/); assert.equal(f.calls.length, 0);
});
await test('account changes while waiting for local confirmation block writes', async () => {
  const f = fixture(); const { promise } = await pendingWrite(f);
  f.session.username = 'account-b'; f.setEpoch(2); f.confirm.answerConfirm(true);
  await assert.rejects(promise, /CLI_SESSION_CHANGED|SESSION_CHANGED/); assert.equal(f.calls.length, 0);
});
await test('same username with a new native account generation also invalidates request', async () => {
  const f = fixture(); const { promise } = await pendingWrite(f);
  f.setEpoch(2); f.confirm.answerConfirm(true);
  await assert.rejects(promise, /SESSION_CHANGED/); assert.equal(f.calls.length, 0);
});
await test('account changes after a read starts discard its private result', async () => {
  const f = fixture(); const result = deferred(); f.responses.set('cloud.repos', () => result.promise);
  const promise = f.service.call({ operation: 'cloud.repos' }); await flush(); assert.equal(f.calls.length, 1);
  f.session.username = 'account-b'; result.resolve([{ private: 'old-account' }]);
  await assert.rejects(promise, /CLI_SESSION_CHANGED/);
});
await test('closing and reopening after a read starts still discards its result', async () => {
  const f = fixture(); const result = deferred(); f.responses.set('cloud.repos', () => result.promise);
  const promise = f.service.call({ operation: 'cloud.repos' }); await flush();
  f.setRequested(false); f.setRequested(true); result.resolve([{ private: 'old-access' }]);
  await assert.rejects(promise, /CLI_SESSION_CHANGED/);
});
await test('specialized learn service cannot bypass learn:read permission', async () => {
  const f = fixture({ permissions: [] });
  await assert.rejects(f.service.call({ operation: 'learn.courses' }), /PERMISSION_REQUIRED/);
  assert.equal(f.calls.length, 0);
});
await test('book and cancel require library:book even with library:read', async () => {
  const f = fixture({ permissions: ['library:read'] });
  for (const operation of ['library.book', 'library.cancel', 'libroom.book', 'libroom.cancel']) {
    await assert.rejects(f.service.call({ operation, args: [], confirm: true }), /PERMISSION_REQUIRED/);
  }
  assert.equal(f.calls.length, 0);
});
await test('ambiguous library timeout invokes the no-replay native method exactly once', async () => {
  const f = fixture(); f.responses.set('native-library.book', () => { throw Error('network timeout'); });
  const { promise } = await pendingWrite(f, 'library.book', [{ id: 12 }, 5]);
  f.confirm.answerConfirm(true); await assert.rejects(promise, /network timeout/);
  assert.deepEqual(f.calls.map(call => call.operation), ['native-library.book']);
});
await test('server-added credential fields never reach public structured output', async () => {
  const f = fixture();
  f.responses.set('gitlab.project', () => ({ id: 7, runners_token: 'private-runner', nested: {
    private_token: 'private-api', accessToken: 'private-access', cookie: 'private-cookie', password: 'private-password', title: 'kept',
  }, html: '<a href="https://example.com/read?ticket=secret&id=7">source</a>' }));
  const result = await f.service.call({ operation: 'gitlab.project', args: [7] });
  assert.deepEqual(result, { id: 7, nested: { title: 'kept' }, html: '<a href="https://example.com/read?id=7">source</a>' });
});
await test('public projection preserves Date reservation times as ISO strings', async () => {
  const f = fixture(); const start = new Date('2026-10-24T10:00:00.000Z');
  f.responses.set('libroom.records', () => [{ begin: start, end: new Date(start.getTime() + 3600_000) }]);
  assert.deepEqual(await f.service.call({ operation: 'libroom.records' }), [{ begin: start.toISOString(), end: '2026-10-24T11:00:00.000Z' }]);
});
await test('schema string length constraints are enforced', async () => {
  assert.throws(() => validation.validate('', { type: 'string', minLength: 1 }), /INVALID_ARGUMENTS/);
  assert.throws(() => validation.validate('abcd', { type: 'string', maxLength: 3 }), /INVALID_ARGUMENTS/);
  validation.validate('abc', { type: 'string', minLength: 1, maxLength: 3 });
});
await test('an already-expired request never enters confirmation or business logic', async () => {
  const f = fixture();
  for (const input of [
    { operation: 'cloud.repos', deadlineUnixMs: f.now() - 1 },
    { operation: 'cal.remove', args: ['local-item'], confirm: true, deadlineUnixMs: f.now() - 1 },
  ]) await assert.rejects(f.service.call(input), /CLI_DEADLINE_EXCEEDED/);
  assert.equal(f.confirm.__pending(), null); assert.equal(f.calls.length, 0);
});
await test('a native epoch check crossing the deadline cannot proceed to confirmation or submission', async () => {
  for (const operation of ['cloud.repos', 'cal.remove']) {
    const f = fixture(); const epochChecked = deferred(); let checking = false;
    f.setEpochAssert(async () => { checking = true; await epochChecked.promise; });
    const promise = f.service.call({ operation, args: operation === 'cal.remove' ? ['local-item'] : [], confirm: true, deadlineUnixMs: f.now() + 10 });
    await flush(); assert.ok(checking); f.advanceTime(11); epochChecked.resolve();
    await assert.rejects(promise, /CLI_DEADLINE_EXCEEDED/);
    assert.equal(f.confirm.__pending(), null); assert.equal(f.calls.length, 0);
  }
});

for (const [operation, args] of [
  ['library.book', [{ id: 12 }, 5]], ['library.cancel', ['record']],
  ['libroom.book', [{ devId: 1, devName: 'room', kindId: 2, roomId: 3 }, '2026-10-24 10:00', '2026-10-24 11:00']],
  ['libroom.cancel', ['record']],
  ['kongjian.book', ['http://myhome.tsinghua.edu.cn/kongjian/kj_yuyue2.aspx?room=fixture', { name: 'fixture', sid: 'fixture', tel: 'fixture', other: 'test' }]],
  ['kongjian.cancel', ['fixture$cancel']], ['venue.cancel', ['record']],
]) await test(`${operation}: service passes its original access guard through the reservation prefetch`, async () => {
  const f = fixture(); const prefetch = deferred(); let started = false;
  f.responses.set(`prefetch:native-${operation}`, () => { started = true; return prefetch.promise; });
  const { promise } = await pendingWrite(f, operation, args);
  f.confirm.answerConfirm(true); await flush(); assert.ok(started);
  f.setRequested(false); f.setRequested(true); prefetch.resolve();
  await assert.rejects(promise, /CLI_SESSION_CHANGED/); assert.equal(f.calls.length, 0);
});
await test('other guarded facade writes receive the same original account fence', async () => {
  const f = fixture(); const prefetch = deferred(); let started = false;
  f.setGuardFactory(check => ({ ...f.api, cal: { ...f.api.cal, remove: async (...args) => {
    started = true; await prefetch.promise; await check(); return f.api.cal.remove(...args);
  } } }));
  const { promise } = await pendingWrite(f); f.confirm.answerConfirm(true); await flush(); assert.ok(started);
  f.session.username = 'account-b'; f.setEpoch(2); prefetch.resolve();
  await assert.rejects(promise, /CLI_SESSION_CHANGED|SESSION_CHANGED/); assert.equal(f.calls.length, 0);
});
await test('all room queries explicitly request read-only account initialization', async () => {
  const f = fixture();
  for (const [operation, args] of [['libroom.list', []], ['libroom.resources', ['2026-10-24', 1]], ['libroom.records', []], ['libroom.fuzzyMember', ['fixture']]]) {
    await f.service.call({ operation, args });
    assert.deepEqual(f.calls.at(-1).args.at(-1), { readOnlyInitialization: true });
  }
});
await test('public errors strip authentication URLs and raw authentication pages', async () => {
  const f = fixture(); f.responses.set('cloud.repos', () => { throw Error('https://example.com?token=do-not-leak&id=7 Bearer privatebearer'); });
  await assert.rejects(f.service.call({ operation: 'cloud.repos' }), error => !error.message.includes('do-not-leak') && !error.message.includes('privatebearer'));
  f.responses.set('cloud.repos', () => { throw Error('<html><form>private login page</form></html>'); });
  await assert.rejects(f.service.call({ operation: 'cloud.repos' }), error => !error.message.includes('private login page'));
});

await test('runtime status ignores a stale enable reply after user disables the service', async () => {
  const f = fixture(); const first = deferred(); const invokes = [], rpcs = [];
  const runtime = moduleAt('apps/desktop/src/state/cliRuntime.ts', {
    '../lib/sharedRuntime.js': { usesSharedRuntime: () => false, initCliInstallation: async()=>{}, subscribeSharedRuntime() {} },
    '@onethu/sdk/policy': policy,
    react: {}, './userext.js': f.userext, './privacyConsent.js': f.privacy,
    '@tauri-apps/api/core': { invoke: async (method, params) => { invokes.push({ method, params }); } },
    '../plugins/rust.js': { callRust: async (...args) => { rpcs.push(args); return rpcs.length === 1 ? first.promise : { supported: true, enabled: false, listening: true, reachableNow: false }; } },
  });
  runtime.setCliRuntimeActive(true); await flush(); assert.equal(rpcs.length, 1);
  f.setRequested(false); await flush();
  first.resolve({ supported: true, enabled: true, listening: true, reachableNow: true }); await flush();
  assert.equal(runtime.cliRuntimeSnapshot().enabled, false);
  assert.equal(runtime.cliRuntimeSnapshot().reachableNow, false);
  assert.equal(invokes.at(-1).params.enabled, true, 'native OH download capability remains authorized while external CLI is off');
  assert.ok(invokes[1].params.revision > invokes[0].params.revision);
});
await test('policy revocation invalidates native writes even when a newer reconnect overtakes it', async () => {
  const f = fixture({ automatic: true }), held = deferred(), invokes = [];
  let hold = false;
  const runtime = moduleAt('apps/desktop/src/state/cliRuntime.ts', {
    '../lib/sharedRuntime.js': { usesSharedRuntime: () => false, initCliInstallation: async()=>{}, subscribeSharedRuntime() {} },
    '@onethu/sdk/policy': policy, react: {}, './userext.js': f.userext, './privacyConsent.js': f.privacy,
    '@tauri-apps/api/core': { invoke: async (method, params) => { invokes.push({ method, params }); if (hold) { hold = false; await held.promise; } } },
    '../plugins/rust.js': { callRust: async () => ({ supported: true, enabled: true, listening: true, reachableNow: true }) },
  });
  runtime.setCliRuntimeActive(true); await flush();
  hold = true; f.setAutomatic(false); await flush();
  assert.equal(invokes.at(-1).params.invalidate, true);
  await runtime.syncCliRuntime();
  assert.equal(invokes.at(-1).params.invalidate, true, 'a newer reconnect must carry the unacknowledged invalidation');
  held.resolve(); await flush();
  assert.equal(runtime.cliRuntimeSnapshot().confirmationMode, 'per-request');
  await runtime.syncCliRuntime(); assert.equal(invokes.at(-1).params.invalidate, false);
});

await test('concurrent Rust plugin startups register one RPC listener and dispatch each action once', async () => {
  const listening = deferred(), callbacks = [], invocations = []; let writes = 0;
  const rust = moduleAt('apps/desktop/src/plugins/rust.ts', {
    './windowOwner.js': { isPluginRuntimeOwner: () => true, requirePluginRuntimeOwner() {} },
    '../i18n/index.js': messages, '../cli/service.js': { createCliService: () => ({}) },
    '../state/cliRuntime.js': { setCliRuntimeActive() {} },
    './facade.js': { buildApi: () => ({ fixture: { write: async () => { writes++; return 'ok'; } } }), CLI_GUARDED_MUTATIONS: new Set() },
    './registry.js': { getPlugin: id => ({ manifest: { id, permissions: [] } }) },
    '../lib/clients.js': { logLine: async () => {} }, './runLifecycle.js': {},
    '../state/privacyConsent.js': { requireOhConsent() {} }, './events.js': { ensurePluginEventListener: async () => {} },
    '@tauri-apps/api/event': { listen: async (_name, callback) => { callbacks.push(callback); await listening.promise; return () => {}; } },
    '@tauri-apps/api/core': { invoke: async (method, args) => {
      invocations.push({ method, args });
      if (method === 'harness_bridge_take') return new Promise(() => {});
      if (method === 'plugin_call') return { commands: [] };
    } },
  });
  rust.bindRustApi('fixture.plugin', new Set());
  const tasks = Array.from({ length: 8 }, (_, index) => rust.spawnRustPlugin(`fixture.${index}`, '/fixture/sidecar'));
  await flush(); assert.equal(callbacks.length, 1); listening.resolve(); await Promise.all(tasks);
  assert.equal(invocations.filter(call => call.method === 'harness_bridge_take').length, 1);
  callbacks[0]({ payload: { pluginId: 'fixture.plugin', id: 101, method: 'onethu.call', params: { ns: 'fixture', method: 'write', args: [] } } });
  await flush(); assert.equal(writes, 1);
  assert.equal(invocations.filter(call => call.method === 'plugin_rpc_reply').length, 1);
});
await test('concurrent activations of the same plugin share one process handshake', async () => {
  const startup = deferred(); let starts = 0, bindings = 0;
  const loader = moduleAt('apps/desktop/src/plugins/loader.ts', {
    './windowOwner.js': { isPluginRuntimeOwner: () => true, requirePluginRuntimeOwner() {} },
    '../state/cliRuntime.js': {}, '../i18n/index.js': messages, './facade.js': {},
    '../lib/androidHost.js': {}, '../state/theme.js': {}, '../lib/market.js': {}, './pluginWidgets.js': {},
    './rust.js': { bindRustApi: () => { bindings++; }, spawnRustPlugin: async () => { starts++; return startup.promise; } },
    '../state/madmodel.js': { startMadModelPump() {} }, '../state/privacyConsent.js': { ohAuthorized: () => true },
    './registry.js': { getPlugin: id => ({ manifest: { id, kind: 'rust', permissions: [] }, binPath: '/fixture/sidecar' }) },
    './tabs.js': {}, './pluginAtoms.js': {}, '../lib/clients.js': { logLine: async () => {} },
  }, {}, 'exports.__activate = activate;');
  const tasks = Array.from({ length: 12 }, () => loader.__activate('fixture.plugin', {}));
  assert.ok(tasks.every(task => task === tasks[0])); await flush(); assert.equal(starts, 1); assert.equal(bindings, 1);
  startup.resolve({ commands: [] }); await Promise.all(tasks);
  await loader.__activate('fixture.plugin', {}); assert.equal(starts, 1);
});

await test('task grant creation needs local approval; pause and run are independent controls', async () => {
  const f = fixture();
  const draft = { name: 'Course watch', schedule: { kind: 'interval', everyMinutes: 5 }, template: { kind: 'school-watch', courseIds: ['a'], channels: ['inbox'] } };
  await assert.rejects(f.service.call({ operation: 'tasks.create', args: [draft] }), /CONFIRMATION_REQUIRED/);
  const created = f.service.call({ operation: 'tasks.create', args: [draft], confirm: true }); await flush();
  assert.ok(f.confirm.__pending());
  // Pausing never waits behind a pending write or another task confirmation.
  await f.service.call({ operation: 'tasks.pause', args: ['task-a'] });
  await f.service.call({ operation: 'tasks.run', args: ['task-a'] });
  f.confirm.answerConfirm(true); await created;
  assert.deepEqual(f.calls.map(c => c.operation), ['tasks.pause', 'tasks.run', 'tasks.create']);
});
await test('task grants are private references and retain scope/epoch checks', async () => {
  const f = fixture({internal:true,requested:false});
  await assert.rejects(f.service.call({ operation: 'cal.remove', args: ['x'], confirmationGrant: {} }), /Unknown argument|INVALID_ARGUMENT/);
  const controller = new AbortController(); let valid = true, checks = 0;
  const grant = { async assertAllowed(operation, args) { checks++; if (!valid) throw Error('TASK_CANCELLED'); if (operation !== 'learn.courses' || args.length) throw Error('TASK_OPERATION_OUTSIDE_GRANT'); } };
  await f.taskBinding.dispatch({ operation: 'learn.courses', args: [] }, grant, controller.signal);
  assert.ok(checks >= 2);
  await assert.rejects(f.taskBinding.dispatch({ operation: 'cal.remove', args: ['x'] }, grant, controller.signal), /TASK_OPERATION_OUTSIDE_GRANT/);
  valid = false;
  await assert.rejects(f.taskBinding.dispatch({ operation: 'learn.courses', args: [] }, grant, controller.signal), /TASK_CANCELLED/);
  assert.equal(f.calls.filter(c => c.operation === 'cal.remove').length, 0);
});

console.log(`\nCLI service boundary: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
