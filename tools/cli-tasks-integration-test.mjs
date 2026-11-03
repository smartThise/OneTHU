/** Real desktop service + task manager + device store + notification adapters.
 * Run with node --import tsx tools/cli-tasks-integration-test.mjs. No accounts/network. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as engine from '../packages/sdk/src/tasks/index.ts';
const root = new URL('../', import.meta.url);
function moduleAt(path, imports = {}, env = {}) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const code = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('exports', 'require', ...Object.keys(env), code)(exports, name => { if (!(name in imports)) throw Error(`Unexpected ${path} import ${name}`); return imports[name]; }, ...Object.values(env));
  return exports;
}
const catalog = JSON.parse(readFileSync(new URL('apps/desktop/src/cli/catalog.json', root), 'utf8'));
const validation = moduleAt('apps/desktop/src/cli/validation.ts');
const projection = moduleAt('apps/desktop/src/cli/publicResult.ts');
const policy = moduleAt('packages/sdk/src/policy.ts');
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
const ref = `learn:${'a'.repeat(64)}`;
function fixture() {
  const session = { username: 'account-a', state: 'ready' }, files = new Map(), subscribers = new Set(), saves = [], notifications = [], downloads = [];
  const config = { enabled: { feishu: true, wechat: false }, channels: { feishu: { appId: 'app-1', appSecret: 'secret-not-public' } }, bindings: { feishu: 'contact-1' } };
  let enabled = true, authorized = true, automatic = false, epoch = 1, confirmAnswer = true, prompts = 0, downloadHook, notificationHook, confirmHook;
  const subscribe = fn => { subscribers.add(fn); return () => subscribers.delete(fn); };
  const changed = () => { for (const fn of subscribers) fn(); };
  const userext = { mcpServerEnabled: () => enabled, cliAutoExecuteEnabled: () => automatic, subscribeUserExt: subscribe };
  const privacy = { ohAuthorized: () => authorized, subscribePrivacy: subscribe };
  const clients = { session, info: {}, fileRead: async name => files.get(name) ?? null, fileWrite: async (name, text) => { saves.push(name); files.set(name, text); } };
  const transport = { nativeSessionEpoch: async () => epoch, assertNativeSessionEpoch: async expected => { if (expected !== epoch) throw Error('AUTH_SESSION_CHANGED'); } };
  const taskNotifications = moduleAt('apps/desktop/src/im/taskNotifications.ts', {
    '../lib/clients.js': clients, '../state/userext.js': userext, '../state/privacyConsent.js': privacy,
    './store.js': { loadImConfig: async () => config },
    './registry.js': { getAdapter: () => ({ notify: async (recipient, text, key, check, signal) => {
      await notificationHook?.(); await check(); if (signal.aborted) throw Error('TASK_CANCELLED'); notifications.push({ recipient, text, key });
    } }) },
  });
  const taskModuleImports = { '@onethu/sdk/tasks': { ...engine, createTaskManager: ports => engine.createTaskManager({ ...ports, clock: { now: () => Date.now(), setTimeout: () => 1, clearTimeout() {} } }) },
    '../lib/clients.js': clients, '../lib/transport.js': transport, './userext.js': userext, './privacyConsent.js': privacy,
    '../plugins/windowOwner.js': { requirePluginRuntimeOwner() {} }, '../im/taskNotifications.js': taskNotifications,
    '../lib/sharedRuntime.js': { usesSharedRuntime: () => false, initCliInstallation:async()=>{}, appTaskRuntimeSafe:()=>true }, '../im/sharedTaskNotifications.js': { syncSharedTaskNotifications: async () => ({}) } };
  const windowGlobal = {};
  let tasks = moduleAt('apps/desktop/src/state/cliTasks.ts', taskModuleImports, { globalThis: windowGlobal });
  const tuple = items => ({ type: 'array', items, minItems: items.length, maxItems: items.length });
  const learn = [
    { name: 'courses', description: 'Courses', parameters: tuple([]), run: async () => ({ rows: [{ id: 'course-a', name: 'Course' }], complete: true }) },
    { name: 'resources', description: 'Resources', parameters: tuple([{ type: 'string' }]), run: async () => ({ items: [{ resourceRef: ref, courseId: 'course-a', resourceId: 'f1', title: 'Chapter 1', filename: 'one.pdf' }], homework: [], notifications: [], complete: true }) },
    { name: 'homework', description: 'Homework', parameters: tuple([{ type: 'string' }]), run: async () => ({ rows: [{ id: 'hw1', title: 'Assignment', deadline: new Date(Date.now() + 3600e3).toISOString() }], complete: true }) },
    { name: 'download', description: 'Download', parameters: tuple([{ type: 'string' }, { type: 'string' }]), mutation: true, run() { throw Error('Expected final guarded path'); } },
  ];
  const learnModule = { cliLearnOperations: learn, runCliLearnDownloadWithDeadline: async (_op, args, _deadline, check, signal) => {
    await downloadHook?.(signal); await check(); if (signal?.aborted) throw Error('TASK_CANCELLED'); downloads.push(args); return { ok: true };
  } };
  const serviceImports = { './catalog.json': catalog, './validation.js': validation, './publicResult.js': projection, '@onethu/sdk/tasks': engine, '@onethu/sdk/policy': policy,
    '../lib/sharedRuntime.js': { usesSharedRuntime: () => false, initCliInstallation:async()=>{}, appTaskRuntimeSafe:()=>true }, '../state/cliTasks.js': tasks, '../lib/cliLearn.js': learnModule, '../lib/clients.js': clients, '../lib/transport.js': transport,
    '../lib/venue.js': {}, '../state/userext.js': userext, '../state/privacyConsent.js': privacy,
    '../i18n/index.js': { t: key => key }, '../lib/confirm.js': { confirmChoice: async () => { prompts++; await confirmHook?.(); return confirmAnswer; } } };
  const api = { session: { status: () => session.state } };
  const createService = () => moduleAt('apps/desktop/src/cli/service.ts', { ...serviceImports, '../state/cliTasks.js': tasks }, { navigator: { platform: 'test' } }).createCliService(api, new Set(['learn:read']), { create: () => api, mutations: new Set(), internal:true });
  let service = createService();
  return { get service() { return service; }, get tasks() { return tasks; }, session, config, files, saves, downloads, notifications,
    promptCount: () => prompts, setConfirm(value) { confirmAnswer = value; }, setAutomatic(value) { automatic = value; changed(); },
    setEnabled(value) { enabled = value; changed(); }, setOwner(name) { session.username = name; epoch++; },
    holdConfirm(fn) { confirmHook = fn; },
    holdDownload(fn) { downloadHook = fn; }, holdNotification(fn) { notificationHook = fn; },
    async hmr() { tasks = moduleAt('apps/desktop/src/state/cliTasks.ts', taskModuleImports, { globalThis: windowGlobal }); service = createService(); await flush(); },
    async close() { enabled = false; changed(); await flush(); },
  };
}
const draft = (channels = ['inbox']) => ({ name: 'Course watch', schedule: { kind: 'interval', everyMinutes: 60 }, template: { kind: 'school-watch', courseIds: ['course-a'], outputDir: '/approved/tasks', channels } });
let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log(`PASS ${name}`); } catch (e) { fail++; console.error(`FAIL ${name}: ${e.stack}`); } }
await test('real desktop task create/run persists scope, downloads without file prompts and stores one inbox', async () => {
  const f = fixture();
  await assert.rejects(f.service.call({ operation: 'tasks.create', args: [draft()] }), /CONFIRMATION_REQUIRED/);
  const task = await f.service.call({ operation: 'tasks.create', args: [draft()], confirm: true });
  const run = await f.service.call({ operation: 'tasks.run', args: [task.id] });
  assert.equal(run.status, 'succeeded'); assert.equal(f.downloads.length, 1); assert.equal(f.promptCount(), 1);
  assert.equal((await f.tasks.readTaskInbox()).length, 1);
  const persisted = JSON.parse(f.files.get('cli-tasks-v1')); assert.equal(persisted.tasks[0].owner, 'account-a');
  assert.equal(persisted.tasks[0].scope.outputDir, '/approved/tasks');
  assert.ok(!JSON.stringify(persisted).includes('secret-not-public'));
  await f.close();
});
await test('OH built-in task route retains local continuing-scope approval', async () => {
  const f = fixture();
  // Harness tasks_manage supplies confirm:true to this exact shared route; the
  // flag requests a local decision and never substitutes for one.
  const channels = await f.tasks.desktopTaskCall({ operation: 'tasks.channels', args: [], confirm: false });
  assert.ok(channels.some(channel => channel.id === 'inbox' && channel.available));
  f.setConfirm(false);
  await assert.rejects(f.tasks.desktopTaskCall({ operation: 'tasks.create', args: [draft()], confirm: true }), /CONFIRMATION_CANCELLED/);
  assert.deepEqual(await f.tasks.desktopTaskCall({ operation: 'tasks.list', args: [] }), []);
  f.setConfirm(true);
  const task = await f.tasks.desktopTaskCall({ operation: 'tasks.create', args: [draft()], confirm: true });
  f.setConfirm(false);
  await assert.rejects(f.tasks.desktopTaskCall({ operation: 'tasks.update', args: [task.id, { ...draft(), name: 'Unapproved change' }], confirm: true }), /CONFIRMATION_CANCELLED/);
  assert.equal((await f.tasks.desktopTaskCall({ operation: 'tasks.get', args: [task.id] })).name, task.name);
  await f.tasks.desktopTaskCall({ operation: 'tasks.pause', args: [task.id], confirm: false });
  await assert.rejects(f.tasks.desktopTaskCall({ operation: 'tasks.resume', args: [task.id], confirm: true }), /CONFIRMATION_CANCELLED/);
  assert.equal((await f.tasks.desktopTaskCall({ operation: 'tasks.get', args: [task.id] })).enabled, false);
  f.setEnabled(false);
  assert.equal((await f.tasks.desktopTaskCall({ operation:'tasks.list',args:[] })).length,1);
  f.setConfirm(true);
  await f.tasks.desktopTaskCall({operation:'tasks.resume',args:[task.id],confirm:true});
  await f.tasks.desktopTaskCall({operation:'tasks.run',args:[task.id]});
  await f.close();
});
await test('pause bypasses global write gate and prevents delayed download publication', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.holdDownload(async signal => { entered.resolve(signal); await release.promise; });
  const task = await f.service.call({ operation: 'tasks.create', args: [draft()], confirm: true });
  const running = f.service.call({ operation: 'tasks.run', args: [task.id] }); const signal = await entered.promise;
  await f.service.call({ operation: 'tasks.pause', args: [task.id] }); assert.equal(signal.aborted, true);
  release.resolve(); const run = await running; assert.equal(run.status, 'cancelled'); assert.equal(f.downloads.length, 0);
  assert.equal(f.promptCount(), 1); await f.close();
});
await test('automatic device policy authorizes task creation but account isolation persists', async () => {
  const f = fixture(); f.setAutomatic(true);
  const task = await f.service.call({ operation: 'tasks.create', args: [draft()] }); assert.equal(f.promptCount(), 0);
  f.setOwner('account-b'); assert.deepEqual(await f.service.call({ operation: 'tasks.list' }), []);
  await assert.rejects(f.service.call({ operation: 'tasks.get', args: [task.id] }), /TASK_NOT_FOUND/);
  await f.close();
});
await test('IM grant captures binding identity and refuses delivery after recipient changes', async () => {
  const f = fixture(); const task = await f.service.call({ operation: 'tasks.create', args: [draft(['feishu'])], confirm: true });
  assert.match(task.scope.channels[0], /^feishu:[a-f0-9]{64}$/);
  f.config.bindings.feishu = 'other-contact';
  const run = await f.service.call({ operation: 'tasks.run', args: [task.id] });
  assert.equal(run.status, 'partial'); assert.equal(f.notifications.length, 0); assert.ok(run.errors.some(e => e.includes('BINDING_CHANGED')));
  await f.close();
});
await test('IM final guard rejects a binding change during token/prefetch await', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.holdNotification(async () => { entered.resolve(); await release.promise; });
  const task = await f.service.call({ operation: 'tasks.create', args: [draft(['feishu'])], confirm: true });
  const pending = f.service.call({ operation: 'tasks.run', args: [task.id] }); await entered.promise;
  f.config.bindings.feishu = 'other-contact'; release.resolve();
  const run = await pending; assert.equal(run.status, 'partial'); assert.equal(f.notifications.length, 0); await f.close();
});
await test('HMR reuses the manager/store and hands dispatch to the current service', async () => {
  const f = fixture(); const task = await f.service.call({ operation: 'tasks.create', args: [draft()], confirm: true });
  await f.hmr(); const list = await f.tasks.desktopTaskCall({ operation: 'tasks.list' }); assert.equal(list.length, 1);
  await f.tasks.desktopTaskCall({ operation: 'tasks.run', args: [task.id] }); assert.equal(f.downloads.length, 1); await f.close();
});
await test('an IM binding change during task consent cannot change the approved recipient', async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  f.holdConfirm(async () => { entered.resolve(); await release.promise; });
  const pending = f.service.call({ operation: 'tasks.create', args: [draft(['feishu'])], confirm: true }); await entered.promise;
  f.config.bindings.feishu = 'other-contact'; release.resolve();
  await assert.rejects(pending, /TASK_NOTIFICATION_CHANNEL_UNAVAILABLE/);
  assert.deepEqual(await f.service.call({ operation: 'tasks.list' }), []); await f.close();
});
console.log(`Desktop task integration: ${pass} passed, ${fail} failed`); if (fail) process.exitCode = 1;
