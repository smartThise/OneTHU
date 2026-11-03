/** Desktop bridge and scheduler ownership, without real accounts or processes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
function moduleAt(path, imports, env = {}) {
  imports = { '@onethu/core': { PUBLIC_DIRECT_HOSTS: new Set(['webvpn.tsinghua.edu.cn', 'id.tsinghua.edu.cn']), webvpnWrap: url => 'https://webvpn.tsinghua.edu.cn/https/' + new URL(url).hostname + new URL(url).pathname }, ...imports };
  const source = readFileSync(new URL(path, root), 'utf8');
  const code = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', ...Object.keys(env), code+(path==='apps/desktop/src/lib/sharedRuntime.ts'?'\ninstallation={installed:true,available:true,expectedVersion:"fixture"};':''))(exports, name => { if (!(name in imports)) throw Error(`Unexpected ${path} import ${name}`); return imports[name]; }, ...Object.values(env));
  return exports;
}
function functionAt(path, name, env) {
  env={initCliInstallation:async()=>{},...env};
  const text = readFileSync(new URL(path, root), 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name);
  const code = ts.transpileModule(node.getText(ast).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(env), `${code}\nreturn ${name};`)(...Object.values(env));
}
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
function bridgeFixture() {
  let status = { protocolVersion: 1, username: null, epoch: 1, session: { state: 'idle' }, policy: { enabled: true, appEnabled:true, automatic: false, configured: true }, bootstrapAllowed: true };
  let snapshot = null;
  const calls = [], changes = [];
  const bridge = moduleAt('apps/desktop/src/lib/sharedRuntime.ts', {
    './transport.js': { isTauri: true }, './androidHost.js': { isAndroidNavigator: () => false },
    '@tauri-apps/api/core': { async invoke(command, payload) {
      calls.push({ command, ...payload });
      if (command === 'cli_daemon_ensure') return { running: true };
      if (payload.method === 'desktop.exportSession') return { ...status, snapshot };
      if (payload.method === 'desktop.adoptSession') {
        assert.equal(payload.params.expectedEpoch, status.epoch);
        snapshot = payload.params.snapshot; status = { ...status, username: snapshot.username, epoch: status.epoch + 1, session: { state: 'ready' } };
      }
      return status;
    } },
  }, { navigator: { platform: 'MacIntel' } });
  bridge.subscribeSharedRuntime(value => changes.push(value));
  return { bridge, calls, changes, change(next) { status = { ...status, ...next }; } };
}
await test('fresh daemon accepts null account and private snapshots never reach public observers', async () => {
  const f = bridgeFixture();
  assert.equal((await f.bridge.exportSharedSession()).username, null);
  const snapshot = { username: 'account-a', fingerprint: 'device', cookiesJson: 'PRIVATE-COOKIE', finger3: 'PRIVATE-TRUST', savedAt: 1 };
  const adopted = await f.bridge.adoptSharedSession(snapshot, 1, 'login');
  assert.equal(adopted.snapshot.cookiesJson, 'PRIVATE-COOKIE');
  assert.equal(adopted.epoch, 2);
  assert.ok(!JSON.stringify(f.changes).includes('PRIVATE-'));
  assert.equal(f.calls.filter(row => row.command === 'cli_daemon_ensure').length, 1);
});
await test('stale account/epoch cannot dispatch a daemon task operation', async () => {
  const f = bridgeFixture();
  f.change({ username: 'account-a', epoch: 5, session: { state: 'ready' } });
  await assert.rejects(f.bridge.callSharedOperation('tasks.create', [], 'account-b', true), /SESSION_CHANGED/);
  await assert.rejects(f.bridge.callSharedOperation('tasks.create', [], 'account-a', true, 4), /SESSION_CHANGED/);
  assert.equal(f.calls.filter(row => row.method === 'desktop.call').length, 0);
  await f.bridge.callSharedOperation('tasks.list', [], 'account-a', false, 5);
  assert.deepEqual(f.calls.at(-1).params, { operation: 'tasks.list', args: [], confirm: false, expectedAccount: 'account-a', expectedEpoch: 5 });
  await assert.rejects(f.bridge.updateSharedPolicy(true, true, { expectedAccount: 'account-a', expectedEpoch: 4 }), /SESSION_CHANGED/);
  assert.equal(f.calls.filter(row => row.method === 'desktop.policy').length, 0);
});
await test('connection failure permits the next reconnect without replaying an ambiguous mutation', async () => {
  let ensures = 0, writes = 0;
  const bridge = moduleAt('apps/desktop/src/lib/sharedRuntime.ts', {
    './transport.js': { isTauri: true }, './androidHost.js': { isAndroidNavigator: () => false },
    '@tauri-apps/api/core': { async invoke(command, payload) {
      if (command === 'cli_daemon_ensure') { ensures++; return; }
      if (payload.method === 'desktop.call') { writes++; throw Error('CLI_DAEMON_CONNECTION_INTERRUPTED'); }
      return { protocolVersion: 1, username: 'a', epoch: 1, session: { state: 'ready' }, policy: { enabled: true, automatic: false } };
    } },
  }, { navigator: { platform: 'MacIntel' } });
  await assert.rejects(bridge.sharedRuntimeRequest('call', { operation: 'tasks.create' }), /INTERRUPTED/);
  assert.equal(writes, 1);
  await bridge.getSharedRuntimeStatus();
  assert.equal(ensures, 2);
  assert.equal(writes, 1);
});
await test('a safe status read reconnects once after a stopped daemon', async () => {
  let ensures = 0, reads = 0;
  const bridge = moduleAt('apps/desktop/src/lib/sharedRuntime.ts', {
    './transport.js': { isTauri: true }, './androidHost.js': { isAndroidNavigator: () => false },
    '@tauri-apps/api/core': { async invoke(command) {
      if (command === 'cli_daemon_ensure') { ensures++; return; }
      if (++reads === 1) throw Error('CLI_DAEMON_NOT_RUNNING');
      return { protocolVersion: 1, username: null, epoch: 1, session: { state: 'idle' }, policy: { enabled: true, automatic: false } };
    } },
  }, { navigator: { platform: 'MacIntel' } });
  assert.equal((await bridge.getSharedRuntimeStatus()).username, null);
  assert.equal(ensures, 2); assert.equal(reads, 2);
});
await test('native handback preserves full cookie attributes and isolates logical application cookies by physical path', async () => {
  const calls = [];
  const bridge = moduleAt('apps/desktop/src/lib/sharedRuntime.ts', {
    './transport.js': { isTauri: true }, './androidHost.js': { isAndroidNavigator: () => false },
    '@tauri-apps/api/core': { async invoke(command, payload) { calls.push({ command, payload }); return { revision: 8 }; } },
  });
  const cookies = [
    { name: 'wengine_vpn_ticket', value: 'fixture-authenticated-ticket', domain: 'webvpn.tsinghua.edu.cn', path: '/', secure: true, hostOnly: true, httpOnly: true },
    { name: 'JSESSIONID', value: 'info-fixture', domain: 'info.tsinghua.edu.cn', path: '/', secure: true, hostOnly: true, expiresAt: 4_000_000_000_000 },
    { name: 'JSESSIONID', value: 'learn-fixture', domain: 'learn.tsinghua.edu.cn', path: '/', secure: true, hostOnly: true },
    { name: 'JSESSIONID', value: 'authoritative-physical-info', domain: 'webvpn.tsinghua.edu.cn', path: '/https/info.tsinghua.edu.cn/', secure: true, hostOnly: true },
  ];
  assert.equal(await bridge.importNativeSessionCookies(cookies, 7), 8);
  assert.equal(calls[0].command, 'cli_session_cookies_import');
  assert.equal(calls[0].payload.expectedRevision, 7);
  const result = calls[0].payload.cookies;
  assert.deepEqual(result.find(row => row.name === 'wengine_vpn_ticket'), cookies[0]);
  assert.deepEqual(result.find(row => row.domain === 'info.tsinghua.edu.cn'), cookies[1]);
  assert.equal(result.find(row => row.domain === 'webvpn.tsinghua.edu.cn' && row.path.includes('info.tsinghua.edu.cn')).value, 'authoritative-physical-info');
  assert.equal(result.find(row => row.domain === 'webvpn.tsinghua.edu.cn' && row.path.includes('learn.tsinghua.edu.cn')).value, 'learn-fixture');
  assert.equal(result.filter(row => row.name === 'wengine_vpn_ticket').length, 1);
});
await test('same-account restore preserves absent direct cloud sessions and keeps daemon overlaps authoritative',async()=>{
  const {bridge}=bridgeFixture();
  const c=(domain,name,value)=>({domain,name,value,path:'/',hostOnly:true,secure:true});
  const incoming=[c('webvpn.tsinghua.edu.cn','wengine_vpn_ticket','new'),c('id.tsinghua.edu.cn','JSESSIONID','daemon')];
  const existing=[c('webvpn.tsinghua.edu.cn','wengine_vpn_ticket','old'),c('cloud.tsinghua.edu.cn','sessionid','cloud'),c('id.tsinghua.edu.cn','JSESSIONID','old-id'),c('external.invalid','session','external'),{...c('oauth.tsinghua.edu.cn','expired','old'),expiresAt:1}];
  const result=bridge.mergeSameAccountServiceCookies(incoming,existing,'a','a');
  assert.equal(result.length,3);assert.equal(result.find(c=>c.domain==='cloud.tsinghua.edu.cn').value,'cloud');
  assert.equal(result.find(c=>c.domain==='id.tsinghua.edu.cn').value,'daemon');
  assert.equal(result.filter(c=>c.name==='wengine_vpn_ticket').length,1);
  for(const owners of [['a','b'],[null,'a'],['a',null]])assert.equal(bridge.mergeSameAccountServiceCookies(incoming,existing,...owners),incoming);
});
function taskFixture() {
  const files = new Map(), calls = [], bindings = [], migrations = [];
  const session = { username: 'account-a', state: 'idle' };
  let unavailable = false, epoch = 3, conflicts = [], localManagers = 0;
  const bridge = {
    usesSharedRuntime: () => true,
    async sharedAccountGuard(username) { if (unavailable) throw Error('DAEMON_UNAVAILABLE'); return { expectedAccount: username, expectedEpoch: epoch }; },
    async sharedRuntimeRequest(method, params) { migrations.push({ method, params }); return { conflicts }; },
    async callSharedOperation(operation, args, owner, confirm, expectedEpoch) {
      if (unavailable) throw Error('DAEMON_UNAVAILABLE');
      if (expectedEpoch !== undefined && expectedEpoch !== epoch) throw Error('CLI_SHARED_SESSION_CHANGED');
      calls.push({ operation, args, owner, confirm, epoch });
      if (operation === 'notifications.inbox') return { messages: [{ id: 'n', text: 'One', createdAt: 4 }], hasMore: false };
      if (operation === 'tasks.channels') return [{ id: 'inbox', channel: 'inbox', available: true }];
      return [];
    },
  };
  const tasks = moduleAt('apps/desktop/src/state/cliTasks.ts', {
    '@onethu/sdk/tasks': { taskOperations: [{ name: 'tasks.create', mutation: true }, { name: 'tasks.list' }], createTaskManager() { localManagers++; throw Error('UNEXPECTED_LOCAL_SCHEDULER'); } },
    '../lib/clients.js': { session, fileRead: async name => files.get(name) ?? null, fileWrite: async (name, text) => files.set(name, text) },
    '../lib/transport.js': {}, './userext.js': { mcpServerEnabled: () => true }, './privacyConsent.js': { ohAuthorized: () => true },
    '../plugins/windowOwner.js': { requirePluginRuntimeOwner() {} }, '../im/taskNotifications.js': {},
    '../lib/sharedRuntime.js': bridge, '../im/sharedTaskNotifications.js': { syncSharedTaskNotifications: async () => ({ channelMap: {} }) },
    './cliRuntime.js': { reportCliRuntimeError() {}, clearCliRuntimeError() {} },
  }, { globalThis: {} });
  tasks.bindDesktopTasks({ call: async input => { bindings.push(input); return 'service'; } });
  session.state = 'ready';
  return { tasks, files, calls, bindings, migrations, session, get localManagers() { return localManagers; }, fail(value) { unavailable = value; }, setEpoch(value) { epoch = value; }, conflict(value) { conflicts = value; } };
}
await test('desktop never creates an in-app scheduler, including a daemon outage', async () => {
  const f = taskFixture();
  await f.tasks.runDesktopTaskControl('tasks.list', [], async () => {});
  f.fail(true);
  await assert.rejects(f.tasks.runDesktopTaskControl('tasks.list', [], async () => {}), /DAEMON_UNAVAILABLE/);
  assert.equal(f.localManagers, 0);
  assert.equal(f.calls.length, 1);
});
await test('migration keeps original task state and marks only successful durable adoption', async () => {
  const f = taskFixture();
  const raw = JSON.stringify({ version: 1, tasks: [{ id: 'old', owner: 'account-a', history: [{ id: 'run' }], notifications: { n: { state: 'unknown' } } }] });
  f.files.set('cli-tasks-v1', raw);
  f.conflict([{ id: 'old', reason: 'id-conflict' }]);
  await f.tasks.runDesktopTaskControl('tasks.list', [], async () => {});
  assert.equal(f.files.has('cli-tasks-daemon-migration-v1'), false);
  assert.equal(f.calls.length, 1, 'migration conflict must not hide the resident task list');
  f.conflict([]);
  await f.tasks.runDesktopTaskControl('tasks.list', [], async () => {});
  await f.tasks.runDesktopTaskControl('tasks.list', [], async () => {});
  assert.equal(f.migrations.length, 2);
  assert.equal(f.files.get('cli-tasks-v1'), raw);
  assert.ok(JSON.parse(f.files.get('cli-tasks-daemon-migration-v1'))['account-a']);
});
await test('approval uses the originally captured account epoch', async () => {
  const f = taskFixture();
  await assert.rejects(f.tasks.runDesktopTaskControl('tasks.create', [{}], async () => { f.setEpoch(4); }, 3), /SESSION_CHANGED/);
  assert.equal(f.calls.length, 0);
});
await test('a migration conflict preserves pause and removal of existing resident tasks', async () => {
  const f = taskFixture();
  f.files.set('cli-tasks-v1', JSON.stringify({ version: 1, tasks: [] }));
  f.conflict([{ id: 'old', reason: 'notification-binding-required' }]);
  await f.tasks.runDesktopTaskControl('tasks.pause', ['resident-task'], async () => {});
  await f.tasks.runDesktopTaskControl('tasks.remove', ['resident-task'], async () => {});
  assert.deepEqual(f.calls.map(row => row.operation), ['tasks.pause', 'tasks.remove']);
  assert.equal(f.files.has('cli-tasks-daemon-migration-v1'), false);
});
await test('inbox and channels render the resident store through existing UI contracts', async () => {
  const f = taskFixture();
  assert.deepEqual(await f.tasks.readTaskInbox(), [{ id: 'n', owner: 'account-a', taskId: '', text: 'One', createdAt: 4 }]);
  assert.equal((await f.tasks.listTaskChannels())[0].kind, 'inbox');
  assert.equal(f.calls[0].operation, 'notifications.inbox');
});
function runtimeFixture(options = {}) {
  let requested = true, automatic = false, authorized = options.authorized ?? true;
  const subscribers = new Set(), remoteListeners = new Set(), updates = [];
  let remote = { protocolVersion: 1, username: 'account-a', epoch: 1, session: { state: 'ready' }, policy: { enabled: true, appEnabled:true, automatic: false, configured: true } };
  let hold = null, handoffRetries = 0;
  const changed = () => { for (const fn of subscribers) fn(); };
  const subscribe = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
  const runtime = moduleAt('apps/desktop/src/state/cliRuntime.ts', {
    react: {}, '@onethu/sdk/policy': moduleAt('packages/sdk/src/policy.ts', {}),
    './userext.js': { mcpServerEnabled: () => requested, cliAutoExecuteEnabled: () => automatic, subscribeUserExt: subscribe,
      setMcpServer(value) { requested = value; changed(); }, setCliAutoExecute(value) { automatic = value; changed(); } },
    './privacyConsent.js': { ohAuthorized: () => authorized, subscribePrivacy: subscribe,
      initPrivacyConsent: async () => { if (options.initialize) authorized = await options.initialize(); } },
    '../plugins/rust.js': {callRust:async()=>({supported:true})},
    './cliTasks.js': { prepareDesktopTaskRuntime: async () => {} },
    '../lib/clients.js': { retrySharedSessionHandoff: async () => { handoffRetries++; runtime.setCliHandoffPending(false); } },
    '@tauri-apps/api/core': { invoke: async () => {} },
    '../lib/sharedRuntime.js': { usesSharedRuntime: () => true, initCliInstallation:async()=>{}, getSharedRuntimeStatus: async () => remote, sharedRuntimeSnapshot: () => remote,
      subscribeSharedRuntime(fn) { remoteListeners.add(fn); },
      async updateSharedPolicy(enabled, auto, expected) {
        if (expected && (expected.expectedAccount !== remote.username || expected.expectedEpoch !== remote.epoch)) throw Error('CLI_SHARED_SESSION_CHANGED');
        updates.push({ enabled, automatic: auto });
        const wait = hold; hold = null; if (wait) await wait;
        if (expected && (expected.expectedAccount !== remote.username || expected.expectedEpoch !== remote.epoch)) throw Error('CLI_SHARED_SESSION_CHANGED');
        remote = { ...remote, policy: { ...remote.policy, enabled, automatic: auto } }; for (const fn of remoteListeners) fn(remote); return remote;
      } },
  });
  const flush = async () => { for (let n = 0; n < 60; n++) await Promise.resolve(); };
  return { runtime, flush, updates, get handoffRetries() { return handoffRetries; }, get remote() { return remote; }, get requested() { return requested; }, get automatic() { return automatic; },
    request(value) { requested = value; changed(); }, auto(value) { automatic = value; changed(); },
    hold() { let release; hold = new Promise(resolve => { release = resolve; }); return release; },
    switchAccount() { remote = { ...remote, username: 'account-b', epoch: 2 }; for (const fn of remoteListeners) fn(remote); },
  };
}
await test('startup waits for saved consent before changing the resident execution policy', async () => {
  let release;
  const loading = new Promise(resolve => { release = resolve; });
  const f = runtimeFixture({ authorized: false, initialize: () => loading });
  f.runtime.setCliRuntimeActive(true);
  await f.flush();
  assert.equal(f.updates.length, 0);
  assert.equal(f.remote.policy.enabled, true);
  release(true);
  await f.flush();
  assert.equal(f.updates.length, 0);
  assert.equal(f.remote.policy.enabled, true);
  assert.equal(f.runtime.cliRuntimeSnapshot().authorized, true);
});
await test('closing the desktop bridge preserves daemon policy; explicit switch changes revoke it', async () => {
  const f = runtimeFixture(), { runtime, flush, updates } = f;
  runtime.setCliRuntimeActive(true); await flush();
  assert.equal(runtime.cliRuntimeSnapshot().background, true);
  runtime.setCliRuntimeActive(false); await flush();
  assert.equal(f.remote.policy.enabled, true);
  assert.deepEqual(updates, []);
  runtime.setCliRuntimeActive(true); await flush();
  f.request(false); await flush();
  assert.equal(f.remote.policy.enabled, false);
  assert.deepEqual(updates, [{ enabled: false, automatic: false }]);
});
await test('clearing a task preparation error preserves the handoff notice until explicit reconnect succeeds', async () => {
  const f = runtimeFixture();
  f.runtime.setCliRuntimeActive(true); await f.flush();
  f.runtime.setCliHandoffPending(true);
  f.runtime.reportCliRuntimeError(Error('TASK_MIGRATION_CONFLICT'));
  f.runtime.clearCliRuntimeError();
  assert.equal(f.runtime.cliRuntimeSnapshot().handoffPending, true);
  assert.equal(f.runtime.cliRuntimeSnapshot().reachableNow, false);
  await f.runtime.syncCliRuntime();
  assert.equal(f.handoffRetries, 1);
  assert.equal(f.runtime.cliRuntimeSnapshot().handoffPending, false);
  assert.equal(f.runtime.cliRuntimeSnapshot().reachableNow, true);
});
await test('rapid disable then enable retains the final intent while an earlier write is in flight', async () => {
  const f = runtimeFixture();
  f.runtime.setCliRuntimeActive(true); await f.flush();
  const release = f.hold();
  f.request(false); await f.flush();
  f.request(true); f.auto(true); await f.flush();
  assert.equal(f.requested, true); assert.equal(f.automatic, true);
  release(); await f.flush();
  assert.deepEqual(f.updates, [{ enabled: false, automatic: false }, { enabled: true, automatic: true }]);
  assert.equal(f.remote.policy.enabled, true); assert.equal(f.remote.policy.automatic, true);
  assert.equal(f.requested, true); assert.equal(f.runtime.cliRuntimeSnapshot().phase, 'ready');
});
await test('a queued policy intent cannot cross a CLI account switch', async () => {
  const f = runtimeFixture();
  f.runtime.setCliRuntimeActive(true); await f.flush();
  const release = f.hold();
  f.request(false); await f.flush(); f.request(true);
  f.switchAccount(); release(); await f.flush();
  assert.equal(f.updates.length, 1);
  assert.equal(f.runtime.cliRuntimeSnapshot().errorCode, 'CLI_SHARED_SESSION_CHANGED');
  await f.runtime.syncCliRuntime();
  assert.equal(f.runtime.cliRuntimeSnapshot().phase, 'ready');
});
await test('pending logout retries only the same account and epoch, preserving newer CLI logins', async () => {
  for (const [username, epoch, shouldLogout] of [['account-a', 3, true], ['account-a', 4, false], ['account-b', 3, false], [null, 4, false]]) {
    const calls = [];
    const finish = functionAt('apps/desktop/src/lib/clients.ts', 'finishPendingSharedLogout', {
      SHARED_LOGOUT_FILE: 'pending',
      fileRead: async () => JSON.stringify({ expectedAccount: 'account-a', expectedEpoch: 3 }),
      getSharedRuntimeStatus: async () => ({ username, epoch }),
      logoutSharedSession: async (...args) => calls.push(args),
      fileDelete: async () => calls.push('deleted'),
    });
    await finish();
    assert.equal(calls.length, shouldLogout ? 2 : 1);
    if (shouldLogout) assert.deepEqual(calls[0], ['account-a', 3]);
    assert.equal(calls.at(-1), 'deleted');
  }
});
await test('failed pending logout keeps its durable intention for the next reconnect', async () => {
  let deleted = false;
  const finish = functionAt('apps/desktop/src/lib/clients.ts', 'finishPendingSharedLogout', {
    SHARED_LOGOUT_FILE: 'pending', fileRead: async () => JSON.stringify({ expectedAccount: 'account-a', expectedEpoch: 3 }),
    getSharedRuntimeStatus: async () => ({ username: 'account-a', epoch: 3 }),
    logoutSharedSession: async () => { throw Error('DAEMON_UNAVAILABLE'); }, fileDelete: async () => { deleted = true; },
  });
  await assert.rejects(finish(), /DAEMON_UNAVAILABLE/);
  assert.equal(deleted, false);
});
await test('failed daemon connection/export or bootstrap proof preserves the only desktop session', async () => {
  for (const stage of ['old-native', 'daemon-offline', 'bootstrap-proof']) {
    const legacy = { username: 'account-a', fingerprint: 'stable-device', finger3: 'private-trust', cookiesJson: 'PRIVATE-NATIVE-AND-JS-COOKIES', savedAt: 1 };
    const original = JSON.stringify(legacy);
    const session = { username: 'account-a', state: 'ready', fingerprint: 'stable-device' };
    let writes = 0, clears = 0;
    const resume = functionAt('apps/desktop/src/lib/clients.ts', 'performResumeSession', {
      usesSharedRuntime: () => true, resumeGeneration: 0, resumeSnapshotUsername: null,
      sharedSessionEpoch: null, sharedLoggedOut: false, fingerprintRequest: null, pendingSecret: null,
      finishPendingSharedLogout: async () => {}, readPendingSharedHandoff: async () => null, logLine: async () => {}, session,
      exportSharedSession: async () => {
        if (stage !== 'bootstrap-proof') throw Error(stage === 'old-native' ? 'Command cli_daemon_ensure not found' : 'CLI_DAEMON_UNAVAILABLE');
        return { epoch: 1, snapshot: null, session: { state: 'idle' }, bootstrapAllowed: true, policy: { configured: false } };
      },
      loadConsistentSessionSnapshot: async () => legacy,
      stageSharedHandoff: async () => { throw Error('AUTH_HANDOFF_UNVERIFIED'); },
      fileWrite: async () => { writes++; }, store: { saveSession: async () => { writes++; } },
      http: { jar: { clear() { clears++; }, hydrate() { clears++; } } },
    });
    await assert.rejects(resume());
    assert.equal(JSON.stringify(legacy), original, stage);
    assert.equal(writes, 0, stage);
    assert.equal(clears, 0, stage);
    assert.equal(session.state, 'ready', stage);
  }
});
await test('CLI verification becoming ready in the same epoch hydrates once, then polling stays read-only', async () => {
  const path = 'apps/desktop/src/lib/clients.ts';
  const text = readFileSync(new URL(path, root), 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const names = ['sharedSessionStateKey', 'rememberSharedSession', 'refreshSharedSession'];
  const source = names.map(name => ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name).getText(ast).replace(/^export\s+/, '')).join('\n');
  const functions = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const controls = { current: { username: 'account-a', epoch: 1, session: { state: 'ready' } }, hydrates: 0, changing: 0 };
  const fixture = new Function('controls', `
    let sharedSessionEpoch = null, sharedSessionState = null, clientLoginRequest = null, resumeRequest = null;
    let pendingSecret = null, resumeGeneration = 0, resumeSnapshotUsername = null;
    const session = { state: 'ready', username: 'account-a' };
    const usesSharedRuntime = () => true;
    const finishPendingSharedLogout = async () => {};
    const readPendingSharedHandoff = async () => null;
    const getSharedRuntimeStatus = async () => controls.current;
    const resumeSession = async () => {
      controls.hydrates++;
      rememberSharedSession(controls.current);
      const ready = controls.current.session.state === 'ready';
      session.state = ready ? 'ready' : 'idle';
      session.username = ready ? controls.current.username : '';
      return ready;
    };
    ${functions}
    rememberSharedSession(controls.current);
    return { refresh: () => refreshSharedSession(() => controls.changing++) };
  `)(controls);
  assert.equal(await fixture.refresh(), null);
  controls.current = { username: null, epoch: 2, session: { state: 'idle', twoFactor: { pending: true } } };
  assert.equal((await fixture.refresh()).kind, 'unauthenticated');
  assert.equal(await fixture.refresh(), null);
  controls.current = { username: null, epoch: 2, session: { state: 'need-2fa', twoFactor: { pending: true } } };
  assert.equal((await fixture.refresh()).kind, 'unauthenticated');
  controls.current = { username: 'account-b', epoch: 2, session: { state: 'ready', twoFactor: { pending: false } } };
  assert.deepEqual(await fixture.refresh(), { kind: 'ready', username: 'account-b' });
  for (let n = 0; n < 10; n++) assert.equal(await fixture.refresh(), null);
  assert.equal(controls.hydrates, 3); assert.equal(controls.changing, 3);
});
await test('pending CLI verification preserves the legacy snapshot and avoids importing its stale account', async () => {
  for (const state of ['idle', 'need-2fa']) {
    const session = { username: 'old-account', state: 'ready' };
    const remembered = [];
    const resume = functionAt('apps/desktop/src/lib/clients.ts', 'performResumeSession', {
      usesSharedRuntime: () => true, resumeGeneration: 0, resumeSnapshotUsername: null, sharedLoggedOut: false,
      pendingSecret: null, finishPendingSharedLogout: async () => {}, readPendingSharedHandoff: async () => null, logLine: async () => {}, session,
      exportSharedSession: async () => ({ username: null, epoch: 2, session: { state, twoFactor: { pending: true } } }),
      rememberSharedSession: value => remembered.push(value),
      loadConsistentSessionSnapshot: async () => { throw Error('Legacy restore would interrupt CLI verification'); },
    });
    assert.equal(await resume(), false);
    assert.equal(session.username, ''); assert.equal(session.state, 'idle');
    assert.equal(remembered.length, 1);
  }
});
console.log(`${passed} shared-runtime checks passed`);
