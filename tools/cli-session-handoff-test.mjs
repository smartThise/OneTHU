/** No real profiles, credentials, native processes or university requests. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';
const source = path => readFileSync(stage && existsSync(`${stage}/${path}`) ? `${stage}/${path}` : new URL(path, root), 'utf8');
const root = new URL('../', import.meta.url);
const stage = process.env.ONETHU_FRONTEND_STAGE;
const sharedSource=source('apps/desktop/src/lib/sharedRuntime.ts');
const sharedAst=ts.createSourceFile('shared.ts',sharedSource,ts.ScriptTarget.Latest,true);
const mergeNode=sharedAst.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='mergeSameAccountServiceCookies');
const mergeCode=ts.transpileModule(mergeNode.getText(sharedAst).replace(/^export\s+/,''),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const mergeSameAccountServiceCookies=new Function(mergeCode+';return mergeSameAccountServiceCookies;')();
function functionsAt(path, names, env, imports = {}, setup = '', result = `{${names.join(',')}}`) {
  env={initCliInstallation:async()=>{},...env};
  const ast = ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
  const selected = names.map(name => {
    const fn = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(fn, name); return fn.getText(ast).replace(/^export\s+/, '');
  }).join('\n');
  const code = ts.transpileModule(selected, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function('require', ...Object.keys(env), `${setup}\n${code}\nreturn ${result};`)(name => { assert.ok(name in imports, name); return imports[name]; }, ...Object.values(env));
}
let passed = 0;
const policy=functionsAt('apps/desktop/src/lib/sharedAuthPolicy.ts',['isSharedRuntimeUnavailable','canBindDeferredLogin'],{});
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const cookie = { name: 'native-only', value: 'fixture-cookie', domain: 'webvpn.tsinghua.edu.cn', path: '/', secure: true, hostOnly: true };
const snapshot = { username: 'account-a', fingerprint: 'device-a', finger3: 'fixture-trust', cookiesJson: '[]', savedAt: 1 };
function handoffFixture() {
  const files = new Map(), adoptions = [], pending = [];
  let local = { ...snapshot }, proof = false, status = { username: null, epoch: 2, session: { state: 'idle' } };
  const environment = {
    ...policy,
    SHARED_HANDOFF_FILE: 'handoff', SHARED_LOGOUT_FILE: 'logout', SESSION_FILE: 'session',
    fileRead: async key => files.get(key) ?? null,
    fileWrite: async (key, text) => files.set(key, text), fileDelete: async key => files.delete(key),
    markSharedHandoffPending: async value => pending.push(value),
    getSharedRuntimeStatus: async () => status, exportSharedSession: async () => ({ ...status, snapshot: null }),
    loadConsistentSessionSnapshot: async () => local,
    exportNativeSessionCookies: async () => ({ revision: 4, cookies: [cookie] }),
    store: { saveSession: async value => { local = value; } },
    adoptSharedSession: async (value, epoch, reason) => { adoptions.push({ value, epoch, reason }); if (!proof) throw Error('AUTH_HANDOFF_UNVERIFIED'); return { ...status, username: value.username, epoch: 3, session: { state: 'ready' }, snapshot: value }; },
    rememberSharedSession() {},
  };
  const api = functionsAt('apps/desktop/src/lib/clients.ts', ['readPendingSharedHandoff', 'saveSessionSnapshot', 'stageSharedHandoff', 'performSharedSessionHandoff'], environment, {}, 'let pendingSharedHandoffMemory=null,resumeGeneration=0,sharedHandoffRetryAfter=0,sharedLoggedOut=false,loginSharedEpoch=2,fingerprintRequest=null;');
  return { api, files, adoptions, pending, get local() { return local; }, accept() { proof = true; }, remote(value) { status = value; } };
}
await test('failed proof retains a durable intent and full native cookies; retry needs no password', async () => {
  const f = handoffFixture();
  await f.api.stageSharedHandoff(snapshot, { username: null, epoch: 2 }, 'login');
  await assert.rejects(f.api.performSharedSessionHandoff(), /AUTH_HANDOFF_UNVERIFIED/);
  assert.equal(JSON.parse(f.files.get('handoff')).snapshot.cookiesJson, JSON.stringify([cookie]));
  assert.equal(f.local.cookiesJson, JSON.stringify([cookie]));
  assert.equal(f.adoptions[0].value.cookiesJson, JSON.stringify([cookie]));
  assert.ok(!JSON.stringify(f.adoptions[0]).includes('password'));
  f.accept();
  const adopted = await f.api.performSharedSessionHandoff();
  assert.equal(adopted.session.state, 'ready'); assert.equal(f.files.has('handoff'), false);
  assert.equal(f.pending.at(-1), false);
});
await test('a newer CLI logout/account epoch supersedes the intent without replaying credentials or old cookies', async () => {
  const f = handoffFixture();
  await f.api.stageSharedHandoff(snapshot, { username: null, epoch: 2 }, 'login');
  f.remote({ username: null, epoch: 3, session: { state: 'idle' }, tombstone: true });
  assert.equal(await f.api.performSharedSessionHandoff(), null);
  assert.equal(f.adoptions.length, 0); assert.equal(f.files.has('handoff'), false);
});
await test('school login remains ready when background handoff is temporarily unavailable', async () => {
  const state = { state: 'ready', username: 'account-a' }, notices = [];
  const { adoptSuccessfulDesktopLogin } = functionsAt('apps/desktop/src/lib/clients.ts', ['adoptSuccessfulDesktopLogin'], {
    usesSharedRuntime: () => true, loginSharedEpoch: 2, loginSharedAccount: null,
    stageSharedHandoff: async () => {}, currentSessionSnapshot: () => snapshot,
    retrySharedSessionHandoff: async () => { throw Error('AUTH_HANDOFF_UNVERIFIED'); },
    prepareSharedTasksAfterLogin: async () => { throw Error('Unavailable background must not start a local scheduler'); },
    markSharedHandoffPending: async value => notices.push(value), logLine: async () => {}, session: state,
  });
  await adoptSuccessfulDesktopLogin();
  assert.equal(state.state, 'ready'); assert.equal(state.username, 'account-a'); assert.deepEqual(notices, [true]);
});
function resumeFixture(importFails, { sharedState = "ready", local = null, blockedServices = false, remembered = null, startupFailure = false } = {}) {
  const events = [], native = { cookies: [cookie], revision: 4 }, saved = { ...snapshot, cookiesJson: JSON.stringify([{ ...cookie, name: 'daemon-cookie' }]) };
  const session = { username: 'account-a', state: 'ready', fingerprint: 'device-a', reset() { events.push('reset-js'); this.state = 'idle'; }, injectCredentials() {} };
  const jar = label => ({ hydrate() { events.push(`hydrate-${label}`); } });
  const helper={userId:'account-a',password:''};
  const env = {
    ...policy,
    usesSharedRuntime: () => true, finishPendingSharedLogout: async () => {}, readPendingSharedHandoff: async () => null,
    loadConsistentSessionSnapshot: async()=>local, mergeSameAccountServiceCookies,
    exportSharedSession: async () => {if(startupFailure)throw Error(typeof startupFailure==='string'?startupFailure:'CLI_DAEMON_START_FAILED');return { username: 'account-a', epoch: 2, session: { state: sharedState }, snapshot: saved };},
    exportNativeSessionCookies: async () => ({ ...native }),
    importNativeSessionCookies: async (cookies, revision) => {
      assert.equal(revision, native.revision); events.push('import-native');
      if (importFails) throw Error('DISK_WRITE_FAILED');
      native.cookies = cookies; native.revision++; return native.revision;
    },
    rememberSharedSession() {}, saveSessionSnapshot: async () => { events.push('save-snapshot'); },
    http: { jar: jar('http') }, learnHttp: { jar: jar('learn') },
    learn: { applyCsrf() {}, resume: async () => true },
    probeLearnSession: async () => { events.push('learn-probe');return {ready:true,csrf:'fixture',page:'fixture',diagnostic:'fixture'}; },
    info: { resume: async () => { events.push('info-warmup');if(blockedServices)await new Promise(()=>{});return true; } }, store: { saveSession: async () => {} },
    loadRemembered: async () => remembered, logLine: async () => {}, prepareSharedTasksAfterLogin: async () => {events.push('prepare-tasks');if(blockedServices)await new Promise(()=>{});}, session,
  };
  const api = functionsAt('apps/desktop/src/lib/clients.ts', ['performResumeSession'], env, {
    './infoLib.js': { libAcceptSharedSession: async () => { events.push('accept-owner'); }, setLibFinger3() {}, helper },
  }, 'let resumeGeneration=0,resumeSnapshotUsername=null,sharedSessionEpoch=1,sharedLoggedOut=false,pendingSecret=null,fingerprintRequest=null;');
  return { ...api, events, native, session, helper };
}
await test('daemon restore imports the native jar atomically before both JS mirrors and Learn', async () => {
  const f = resumeFixture(false);
  assert.equal(await f.performResumeSession(), true);
  assert.ok(f.events.indexOf('import-native') < f.events.indexOf('reset-js'));
  assert.ok(f.events.indexOf('import-native') < f.events.indexOf('save-snapshot'));
  assert.ok(f.events.indexOf('hydrate-http') < f.events.indexOf('learn-probe'));
  assert.ok(f.events.indexOf('hydrate-learn') < f.events.indexOf('learn-probe'));
  assert.equal(f.native.cookies[0].name, 'daemon-cookie');
});
await test('Info warm-up and background task synchronization cannot hold the foreground sign-in mutex',async()=>{
  const f=resumeFixture(false,{blockedServices:true});let timer;
  try{assert.equal(await Promise.race([f.performResumeSession(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('foreground restore held by unrelated service')),100);})]),true);}
  finally{clearTimeout(timer);}
  assert.equal(f.session.state,'ready');assert.equal(f.events.includes('info-warmup'),false);assert.equal(f.events.includes('prepare-tasks'),true);
});
await test('a restored CLI owner receives only its matching remembered credentials for legacy GUI services',async()=>{
  const f=resumeFixture(false,{remembered:{username:'account-a',password:'synthetic-only'}});
  assert.equal(await f.performResumeSession(),true);assert.equal(f.helper.userId,'account-a');assert.equal(f.helper.password,'synthetic-only');
  const other=resumeFixture(false,{remembered:{username:'account-b',password:'must-not-inject'}});
  assert.equal(await other.performResumeSession(),true);assert.equal(other.helper.password,'');assert.equal(other.helper.userId,'account-a');
});
await test('a failed background startup still restores the GUI owned native school session without importing background cookies',async()=>{
  const f=resumeFixture(false,{startupFailure:true,local:snapshot});
  assert.equal(await f.performResumeSession(),true);assert.equal(f.session.state,'ready');
  assert.equal(f.events.includes('import-native'),false);assert.equal(f.native.cookies[0].value,cookie.value);
});
await test('CLI profile write failures preserve native GUI login and keep identity conflicts blocked',async()=>{
  const f=resumeFixture(false,{startupFailure:'CLI_DAEMON_INSTALL_UNAVAILABLE',local:snapshot});
  assert.equal(await f.performResumeSession(),true);assert.equal(f.session.state,'ready');assert.equal(f.events.includes('import-native'),false);
  for(const code of ['CLI_DAEMON_UNSAFE_PATH','CLI_DAEMON_RUNTIME_CHECKSUM_FAILED','CLI_SHARED_SESSION_CHANGED','AUTH_HANDOFF_UNVERIFIED'])assert.equal(policy.isSharedRuntimeUnavailable(code),false,code);
});
await test('explicit school login reaches 2FA even when the optional CLI profile is unavailable',async()=>{
  const events=[],session={state:'idle',username:'',finger3:''};
  const api=functionsAt('apps/desktop/src/lib/clients.ts',['performLogin'],{
    ...policy,usesSharedRuntime:()=>true,finishPendingSharedLogout:async()=>{},
    getSharedRuntimeStatus:async()=>{throw Error('CLI_DAEMON_INSTALL_UNAVAILABLE')},
    logLine:async()=>{},currentFingerprint:async()=> 'retained-device',session,
  },{'./infoLib.js':{assertLoginAccount(){},helper:{},setLibFinger3(){},libLogin:async()=>{events.push('school-login');return {state:'need-2fa',methods:[{type:'sms'}],debugHtml:''}}}},'let loginSharedEpoch=1,loginSharedAccount=null,pendingSecret=null;');
  const result=await api.performLogin('account-a','synthetic-only',{remember:true});
  assert.equal(result.state,'need-2fa');assert.equal(session.state,'need-2fa');assert.equal(session.username,'account-a');assert.deepEqual(events,['school-login']);
});
await test('deferred login binds only to the same account or a fresh non-logged-out daemon',async()=>{
  for(const shared of [
    {username:null,epoch:8,bootstrapAllowed:true,session:{state:'idle'}},
    {username:'account-a',epoch:8,session:{state:'ready'}},
  ]){
    const f=handoffFixture();await f.api.stageSharedHandoff(snapshot,{username:null,epoch:null},'login');f.remote(shared);f.accept();
    assert.equal((await f.api.performSharedSessionHandoff()).username,'account-a');assert.equal(f.adoptions[0].epoch,8);
  }
  for(const shared of [
    {username:null,epoch:8,tombstone:true,bootstrapAllowed:true,session:{state:'idle'}},
    {username:'account-b',epoch:8,session:{state:'ready'}},
    {username:'account-a',epoch:8,session:{state:'need-2fa',twoFactor:{pending:true}}},
  ]){
    const f=handoffFixture();await f.api.stageSharedHandoff(snapshot,{username:null,epoch:null},'login');f.remote(shared);
    await assert.rejects(f.api.performSharedSessionHandoff(),/CLI_SHARED_SESSION_CHANGED/);assert.equal(f.adoptions.length,0);
  }
});
await test('explicit native login reaches its school 2FA flow when CLI startup failed, while existing CLI 2FA stays protected',async()=>{
  let attempts=0,cli2fa=false;
  const session={state:'idle',username:'',fingerprint:'',finger3:''};
  const {performLogin}=functionsAt('apps/desktop/src/lib/clients.ts',['performLogin'],{
    ...policy,usesSharedRuntime:()=>true,finishPendingSharedLogout:async()=>{},
    getSharedRuntimeStatus:async()=>{if(!cli2fa)throw Error('CLI_DAEMON_START_FAILED');return {username:'account-a',epoch:5,session:{state:'need-2fa',twoFactor:{pending:true}}};},
    logLine:async()=>{},currentFingerprint:async()=>'fixed-device',session,
  },{'./infoLib.js':{setLibFinger3(){},helper:{},assertLoginAccount(){},libLogin:async()=>{attempts++;return{state:'need-2fa',methods:[]};}}},'let loginSharedEpoch=null,loginSharedAccount=null,pendingSecret=null;');
  assert.equal((await performLogin('account-a','synthetic-only',{})).state,'need-2fa');assert.equal(attempts,1);
  cli2fa=true;await assert.rejects(performLogin('account-a','synthetic-only',{}),/CLI login is still in progress/);assert.equal(attempts,1);
});
await test('failed atomic native import preserves old cookies and never overwrites the saved account', async () => {
  const f = resumeFixture(true);
  await assert.rejects(f.performResumeSession(), /DISK_WRITE_FAILED/);
  assert.equal(f.native.cookies[0].name, 'native-only'); assert.equal(f.native.revision, 4);
  assert.deepEqual(f.events, ['import-native']);
});
await test('pending handoff blocks empty-daemon cleanup and preserves the school snapshot', async () => {
  const events = [];
  const { performResumeSession } = functionsAt('apps/desktop/src/lib/clients.ts', ['performResumeSession'], {
    ...policy,
    usesSharedRuntime: () => true, finishPendingSharedLogout: async () => {},
    readPendingSharedHandoff: async () => ({ snapshot }), retrySharedSessionHandoff: async () => { throw Error('AUTH_HANDOFF_UNVERIFIED'); },
    exportSharedSession: async () => { events.push('empty-daemon'); return { snapshot: null, tombstone: true }; },
    logLine: async () => {}, session: { state: 'ready' },
  }, {}, 'let resumeGeneration=0,resumeSnapshotUsername=null,pendingSecret=null;');
  await assert.rejects(performResumeSession(), /AUTH_HANDOFF_UNVERIFIED/);
  assert.deepEqual(events, []);
});
await test('successful delayed handoff hydrates an idle GUI even after adoption remembered the new epoch', async () => {
  const session = { state: 'idle', username: '' }, events = [];
  const shared = { username: 'account-a', epoch: 3, session: { state: 'ready' } };
  let pending = true;
  const { refreshSharedSession } = functionsAt('apps/desktop/src/lib/clients.ts', ['sharedSessionStateKey', 'rememberSharedSession', 'refreshSharedSession'], {
    usesSharedRuntime: () => true, session, finishPendingSharedLogout: async () => {},
    readPendingSharedHandoff: async () => pending ? { snapshot } : null,
    markSharedHandoffPending: async () => {}, getSharedRuntimeStatus: async () => shared,
    prepareSharedTasksAfterLogin: async () => {},
    hydrate: async () => { events.push('hydrate'); session.state = 'ready'; session.username = 'account-a'; return true; },
    adopt: async () => { pending = false; return shared; },
  }, {}, `let clientLoginRequest=null,resumeRequest=null,sharedHandoffRetryAfter=0,sharedSessionEpoch=null,sharedSessionState=null,resumeGeneration=0,pendingSecret=null,resumeSnapshotUsername=null;
  async function retrySharedSessionHandoff(){const adopted=await adopt();rememberSharedSession(adopted);return adopted;}
  async function resumeSession(){return hydrate();}`);
  assert.deepEqual(await refreshSharedSession(() => events.push('changing')), { kind: 'ready', username: 'account-a' });
  assert.deepEqual(events, ['changing', 'hydrate']);
  assert.equal(await refreshSharedSession(), null);
});
await test('a newer account epoch rejects a just-completed older school login instead of claiming it is ready', async () => {
  const session = { state: 'ready', username: 'account-a' };
  const { adoptSuccessfulDesktopLogin } = functionsAt('apps/desktop/src/lib/clients.ts', ['adoptSuccessfulDesktopLogin'], {
    usesSharedRuntime: () => true, loginSharedEpoch: 2, loginSharedAccount: null,
    stageSharedHandoff: async () => {}, currentSessionSnapshot: () => snapshot,
    retrySharedSessionHandoff: async () => null,
    prepareSharedTasksAfterLogin: async () => { throw Error('Stale account must not prepare tasks'); },
    markSharedHandoffPending: async () => {}, logLine: async () => {}, session,
  });
  await assert.rejects(adoptSuccessfulDesktopLogin(), /CLI_SHARED_SESSION_CHANGED/);
  assert.equal(session.state, 'idle'); assert.equal(session.username, '');
});

await test('same-epoch startup completion preserves a ready GUI service session without importing older cookies',async()=>{
  const shared={username:'account-a',epoch:4,session:{state:'ready'}};
  const {refreshSharedSession}=functionsAt('apps/desktop/src/lib/clients.ts',['sharedSessionStateKey','rememberSharedSession','refreshSharedSession'],{
    usesSharedRuntime:()=>true,session:{username:'account-a',state:'ready'},finishPendingSharedLogout:async()=>{},readPendingSharedHandoff:async()=>null,
    getSharedRuntimeStatus:async()=>shared,resumeSession:async()=>{throw Error('Must preserve fresh GUI cookies and CSRF');},
  },{},'let clientLoginRequest=null,resumeRequest=null,sharedSessionEpoch=4,sharedSessionState=JSON.stringify(["account-a","idle",false]),resumeGeneration=0,pendingSecret=null;');
  assert.equal(await refreshSharedSession(()=>{throw Error('Must not show a connecting overlay');}),null);
});



await test('an unverified startup export preserves the matching local native session until its own read-only probe succeeds',async()=>{
  const f=resumeFixture(false,{sharedState:'idle',local:snapshot});
  assert.equal(await f.performResumeSession(),true);
  assert.equal(f.native.cookies[0].name,'native-only');assert.equal(f.native.revision,4);
  assert.equal(f.events.includes('import-native'),false);assert.equal(f.events.includes('accept-owner'),false);
  assert.equal(f.events.includes('learn-probe'),true);
});
await test('an unverified daemon export for a different durable owner cannot replace native cookies or show cached identity',async()=>{
  const f=resumeFixture(false,{sharedState:'idle',local:{...snapshot,username:'account-b'}});
  await assert.rejects(f.performResumeSession(),/CLI_SHARED_RESTORE_PENDING/);
  assert.deepEqual(f.events,[]);assert.equal(f.native.revision,4);
});
console.log(`${passed} private session handoff checks passed`);
