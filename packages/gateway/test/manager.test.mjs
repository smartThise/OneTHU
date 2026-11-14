import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import { createManagedGateway, createPacScript, DEFAULT_ALLOWED_ORIGINS } from '../src/manager.mjs';
import { createCertificateAuthority } from '../src/certificates.mjs';
import { GatewayError } from '../src/index.mjs';
import { readEndpointHints } from '../src/endpointHints.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'onethu-manager-'));
  let authenticated = true;
  const state = { supported: true, trusted: false, proxyEnabled: false, recoveryRequired: false };
  const platform = { status: async () => ({ ...state }), trust: async () => { state.trusted = true; }, untrust: async () => { state.trusted = false; },
    enableProxy: async ({ pacUrl }) => { state.proxyEnabled = true; state.pacUrl = pacUrl; state.recoveryRequired = true; },
    disableProxy: async () => { state.proxyEnabled = false; state.recoveryRequired = false; return { restored: true }; } };
  const session = { epoch: () => 1, assertCurrent: value => assert.equal(value, 1), status: () => ({ authenticated, state: authenticated ? 'ready' : 'idle' }),
    request: async () => new Response('campus fixture') };
  const manager = createManagedGateway({ dataDir: dir, allowedOrigins: ['https://campus.example', 'http://campus.example'], session,
    platformFactory: () => platform, ...options });
  t.after(async () => { await manager.close(); await rm(dir, { recursive: true, force: true }); });
  return { manager, dir, platform, state, session, logout: () => { authenticated = false; } };
}

test('read-only status and shutdown leave pristine profile untouched', async t => {
  const { manager, dir } = await fixture(t);
  const status = await manager.control({ action: 'status' });
  assert.equal(status.running, false); assert.equal(status.certificate.ready, false);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(manager.control({ action: 'start' }), /GATEWAY_CONFIRM_REQUIRED/);
  await manager.control({ action: 'stop', confirm: true });
  assert.deepEqual(await readdir(dir), []);
});

test('managed identity passthrough removes identity hosts from effective routes and certificate policy', async t => {
  const identities = ['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn', 'webvpn.tsinghua.edu.cn'];
  assert.equal(DEFAULT_ALLOWED_ORIGINS.some(origin => identities.includes(new URL(origin).hostname)), false);
  let certificateHosts;
  const { manager } = await fixture(t, { allowedOrigins: ['https://campus.example', ...identities.map(host => `https://${host}`)],
    certificateFactory: async options => { certificateHosts = options.allowedHosts; return createCertificateAuthority(options); } });
  const started = await manager.control({ action: 'start', confirm: true });
  assert.deepEqual(started.allowedOrigins, ['https://campus.example']);
  assert.deepEqual(certificateHosts, ['campus.example']);
  const ctx = vm.createContext({}); vm.runInContext(await (await fetch(started.pacUrl)).text(), ctx);
  for (const host of identities) assert.equal(ctx.FindProxyForURL(`https://${host}/`, host), 'DIRECT');
});

test('start, scoped PAC, authentication, status redaction, and stop form a complete lifecycle', async t => {
  const { manager, state } = await fixture(t);
  const status = await manager.control({ action: 'start', confirm: true });
  assert.equal(status.running, true); assert.equal(status.certificate.ready, true);
  const credentials = await manager.control({ action: 'credentials', confirm: true });
  assert.equal(JSON.stringify(status).includes(credentials.password), false);
  assert.equal(state.proxyEnabled, false); assert.equal(state.trusted, false);
  const pac = await fetch(status.pacUrl); assert.equal(pac.status, 200);
  const ctx = vm.createContext({}); vm.runInContext(await pac.text(), ctx);
  assert.equal(ctx.FindProxyForURL('https://campus.example/', 'campus.example'), `PROXY 127.0.0.1:${status.endpoint.port}`);
  assert.equal(ctx.FindProxyForURL('https://campus.example.evil/', 'campus.example.evil'), 'DIRECT');
  const body = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: status.endpoint.host, port: status.endpoint.port, path: 'http://campus.example/',
      headers: { Host: 'campus.example', 'Sec-Fetch-Site': 'none', 'Proxy-Authorization': `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, data }));
    }); req.on('error', reject); req.end();
  });
  assert.deepEqual(body, { status: 307, data: '' });
  await manager.control({ action: 'trust', confirm: true });
  const enabled = await manager.control({ action: 'system-enable', confirm: true });
  assert.equal(enabled.systemProxy.enabled, true); assert.equal(enabled.systemProxy.recoveryRequired, false);
  const stopped = await manager.control({ action: 'stop', confirm: true });
  assert.equal(stopped.running, false); assert.equal(state.proxyEnabled, false);
  await assert.rejects(fetch(status.pacUrl));
});

test('restarting a managed proxy reuses its manual endpoint and exact cached PAC URL',async t=>{
 const f=await fixture(t);const first=await f.manager.control({action:'start',confirm:true});
 await f.manager.control({action:'stop',confirm:true});
 const second=await f.manager.control({action:'start',confirm:true});
 assert.deepEqual(second.endpoint,first.endpoint);assert.equal(second.pacUrl,first.pacUrl);
 assert.equal((await fetch(first.pacUrl)).status,200);
});

test('same-account suspension resumes the manual gateway and an explicit stop clears that intent',async t=>{
 const f=await fixture(t);
 f.session.accountKey=()=> 'a'.repeat(64);
 const started=await f.manager.control({action:'start',confirm:true});
 assert.deepEqual((await readEndpointHints(join(f.dir,'gateway'))).resume,{mode:'manual',account:'a'.repeat(64)});
 await f.manager.suspend();
 assert.equal((await f.manager.control({action:'status'})).running,false);
 f.logout();
 assert.equal((await f.manager.resume()).running,false);
 f.session.status=()=>({authenticated:true,state:'ready'});
 f.session.accountKey=()=> 'b'.repeat(64);
 assert.equal((await f.manager.resume()).running,false);
 f.session.accountKey=()=> 'a'.repeat(64);
 const resumed=await f.manager.resume();
 assert.equal(resumed.running,true);
 assert.deepEqual(resumed.endpoint,started.endpoint);
 assert.equal(resumed.pacUrl,started.pacUrl);
 await f.manager.control({action:'stop',confirm:true});
 assert.equal((await readEndpointHints(join(f.dir,'gateway'))).resume,undefined);
 assert.equal((await f.manager.resume()).running,false);
});

test('daemon replacement resumes only an explicitly authorized same-account gateway',async t=>{
 const f=await fixture(t);
 f.session.accountKey=()=> 'a'.repeat(64);
 const first=await f.manager.control({action:'start',confirm:true});
 await f.manager.close();
 const next=createManagedGateway({dataDir:f.dir,session:f.session,platformFactory:()=>f.platform,
  allowedOrigins:['https://campus.example','http://campus.example']});
 t.after(()=>next.close());
 const resumed=await next.resume();
 assert.equal(resumed.running,true);
 assert.equal(resumed.pacUrl,first.pacUrl);
 assert.deepEqual(resumed.endpoint,first.endpoint);
 await next.control({action:'untrust',confirm:true});
 assert.equal((await readEndpointHints(join(f.dir,'gateway'))).resume,undefined);
 assert.equal((await next.resume()).running,false);
});

test('system intent survives daemon replacement, refuses outside proxy edits and never installs trust',async t=>{
 const f=await fixture(t,{hostPlatform:'darwin',peerAuthorizerFactory:()=>async()=>true});
 f.session.accountKey=()=> 'a'.repeat(64);
 let enables=0,restores=0;
 f.state.trusted=true;
 f.platform.prepareProxy=async()=>({services:[{name:'Ethernet',fallback:{}}]});
 f.platform.enableProxy=async({pacUrlsByService})=>{
  enables++;
  Object.assign(f.state,{proxyEnabled:true,recoveryRequired:true,pacUrlsByService});
 };
 const disable=f.platform.disableProxy;
 f.platform.disableProxy=async()=>{restores++;return disable();};
 await f.manager.control({action:'start',confirm:true});
 const first=await f.manager.control({action:'system-enable',confirm:true});
 await f.manager.control({action:'start',confirm:true});
 assert.equal((await readEndpointHints(join(f.dir,'gateway'))).resume.mode,'system');
 await f.manager.close();
 // Simulate an unclean previous exit: the old owned PAC remains in the OS.
 Object.assign(f.state,{proxyEnabled:true,recoveryRequired:true,pacUrlsByService:first.systemProxy.pacUrlsByService});
 const next=createManagedGateway({dataDir:f.dir,session:f.session,platformFactory:()=>f.platform,
  hostPlatform:'darwin',peerAuthorizerFactory:()=>async()=>true,
  allowedOrigins:['https://campus.example','http://campus.example']});
 t.after(()=>next.close());
 f.state.trusted=false;
 const beforeRestore=restores;
 await assert.rejects(next.resume(),{code:'GATEWAY_CERTIFICATE_TRUST_REQUIRED'});
 assert.equal(restores,beforeRestore);
 f.state.trusted=true;
 f.state.settingsChanged=true;
 await assert.rejects(next.resume(),{code:'GATEWAY_PROXY_SETTINGS_CHANGED'});
 assert.equal(restores,beforeRestore);
 assert.equal(enables,1);
 f.state.settingsChanged=false;
 const resumed=await next.resume();
 assert.equal(restores,beforeRestore+1);
 assert.equal(enables,2);
 assert.deepEqual(resumed.systemEndpoint,first.systemEndpoint);
 assert.deepEqual(resumed.systemProxy.pacUrlsByService,first.systemProxy.pacUrlsByService);
 await next.resume();
 assert.equal(enables,2);
 await next.control({action:'system-disable',confirm:true});
 assert.deepEqual((await readEndpointHints(join(f.dir,'gateway'))).resume,{mode:'manual',account:'a'.repeat(64)});
 const manual=await next.resume();
 assert.equal(manual.running,true);
 assert.equal(manual.systemProxy.enabled,false);
 assert.equal(enables,2);
});

test('the local console toggles a whole site, preserves the original proxy and persists across restart',async t=>{
 const host='git.tsinghua.edu.cn';
 const fallback=http.createServer();
 let tunneledHost,peerAllowed=true;
 fallback.on('connect',(req,socket)=>{
  tunneledHost=req.url;
  socket.end('HTTP/1.1 200 Connection Established\r\n\r\nopaque fixture');
 });
 await new Promise(resolve=>fallback.listen(0,'127.0.0.1',resolve));
 t.after(()=>fallback.close());
 const originalPort=fallback.address().port;
 const f=await fixture(t,{hostPlatform:'darwin',peerAuthorizerFactory:()=>async()=>peerAllowed,
  allowedOrigins:['https://'+host,'http://'+host,'https://learn.tsinghua.edu.cn']});
 const originalProxy={host:'127.0.0.1',port:originalPort};
 f.platform.prepareProxy=async()=>({services:[{name:'Ethernet',fallback:{https:originalProxy,http:originalProxy}}]});
 f.platform.enableProxy=async({pacUrlsByService})=>Object.assign(f.state,{proxyEnabled:true,pacUrlsByService});
 f.state.trusted=true;
 const started=await f.manager.control({action:'start',confirm:true});
 const enabled=await f.manager.control({action:'system-enable',confirm:true});
 const management=new URL(started.managementUrl), api=new URL('/api/sites',management);
 const patch=(body,origin=management.origin)=>fetch(api,{
  method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body),
 });
 assert.equal((await fetch(management)).status,200);
 assert.equal((await fetch(api,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
 const navigation=await new Promise((resolve,reject)=>{
  http.get(management,{headers:{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}},response=>{
   response.resume(); resolve(response.statusCode);
  }).on('error',reject);
 });
 assert.equal(navigation,200);
 assert.equal((await patch({host,enabled:false},'https://outside.test')).status,403);
 assert.equal((await patch({host:'outside.test',enabled:false})).status,400);
 assert.equal((await patch({host:'id.tsinghua.edu.cn',enabled:false})).status,400);
 peerAllowed=false;
 assert.equal((await patch({host,enabled:false})).status,403);
 peerAllowed=true;
 assert.deepEqual((await (await fetch(api)).json()).sites,[{host,enabled:true},{host:'learn.tsinghua.edu.cn',enabled:true}]);
 const result=await patch({host,enabled:false});
 assert.equal(result.status,200);
 assert.equal((await result.json()).sites[0].enabled,false);
 const systemPac=enabled.systemProxy.pacUrlsByService.Ethernet;
 async function route(pac,scheme,hostname){
  const ctx=vm.createContext({});
  vm.runInContext(await(await fetch(pac)).text(),ctx);
  return ctx.FindProxyForURL(scheme+'://'+hostname+'/',hostname);
 }
 assert.equal(await route(systemPac,'https',host),'PROXY 127.0.0.1:'+enabled.systemEndpoint.port);
 assert.equal(await route(started.pacUrl,'http',host),'PROXY 127.0.0.1:'+started.endpoint.port);
 assert.equal(await route(systemPac,'https','learn.tsinghua.edu.cn'),'PROXY 127.0.0.1:'+enabled.systemEndpoint.port);
 const sysContext=vm.createContext({});
 vm.runInContext(await(await fetch(systemPac)).text(),sysContext);
 assert.equal(sysContext.FindProxyForURL(management.href,management.hostname),'DIRECT');
 assert.equal(await route(systemPac,'http','127.0.0.1'),'PROXY 127.0.0.1:'+originalPort);
 // A browser with an old PAC can still CONNECT to the old listener. Its new
 // tunnel must be opaque and reach the inherited proxy, with no campus cookies.
 const tunnel=await new Promise((resolve,reject)=>{
  const socket=net.connect(enabled.systemEndpoint.port,'127.0.0.1');
  let data='';
  socket.setTimeout(4000,()=>socket.destroy(new Error('fixture timeout')));
  socket.on('connect',()=>socket.write('CONNECT '+host+':443 HTTP/1.1\r\nHost: '+host+':443\r\n\r\n'));
  socket.on('data',chunk=>data+=chunk);
  socket.on('end',()=>resolve(data));
  socket.on('error',reject);
 });
 assert.equal(tunneledHost,host+':443');
 assert.match(tunnel,/^HTTP\/1.1 200 Connection Established\r\n\r\nopaque fixture$/);
 await f.manager.control({action:'stop',confirm:true});
 assert.equal((await fetch(api)).status,200,'the console stays usable while the gateway is stopped');
 const resumed=await f.manager.control({action:'start',confirm:true});
 assert.equal(resumed.managementUrl,started.managementUrl);
 await f.manager.close();
 await assert.rejects(fetch(management));
 const restarted=createManagedGateway({dataDir:f.dir,session:f.session,hostPlatform:'darwin',
  peerAuthorizerFactory:()=>async()=>true,platformFactory:()=>f.platform,
  allowedOrigins:['https://'+host,'http://'+host,'https://learn.tsinghua.edu.cn']});
 try {
  const state=await restarted.control({action:'start',confirm:true});
  assert.equal(state.managementUrl,started.managementUrl);
  assert.deepEqual(state.allowedOrigins,['https://learn.tsinghua.edu.cn']);
  assert.equal(await route(state.pacUrl,'https',host),'PROXY 127.0.0.1:'+state.endpoint.port);
  assert.equal((await patch({host,enabled:true})).status,200);
  assert.equal(await route(state.pacUrl,'https',host),'PROXY 127.0.0.1:'+state.endpoint.port);
 } finally { await restarted.close(); }
});

test('a new manager preserves system listener ports and exact PAC URLs across daemon replacement',async t=>{
 const peerAuthorizerFactory=()=>async()=>true;
 const f=await fixture(t,{peerAuthorizerFactory,hostPlatform:'darwin'});
 const plan={version:1,fingerprint:'fixture',services:[{name:'Wi-Fi',fallback:{}},{name:'Ethernet',fallback:{https:{host:'127.0.0.1',port:7897}}}]};
 f.platform.prepareProxy=async()=>plan;
 f.platform.enableProxy=async({pacUrlsByService})=>{f.state.proxyEnabled=true;f.state.recoveryRequired=true;f.state.pacUrlsByService=pacUrlsByService;};
 f.state.trusted=true;await f.manager.control({action:'start',confirm:true});
 const first=await f.manager.control({action:'system-enable',confirm:true}),urls={...first.systemProxy.pacUrlsByService};
 const scripts=await Promise.all(Object.values(urls).map(async url=>[url,await(await fetch(url)).text()]));
 await f.manager.close();
 const next=createManagedGateway({dataDir:f.dir,allowedOrigins:['https://campus.example','http://campus.example'],session:f.session,platformFactory:()=>f.platform,peerAuthorizerFactory,hostPlatform:'darwin'});
 try{
  await next.control({action:'start',confirm:true});const second=await next.control({action:'system-enable',confirm:true});
  assert.deepEqual(second.systemEndpoint,first.systemEndpoint);assert.deepEqual(second.systemProxy.pacUrlsByService,urls);
  for(const [url,script]of scripts)assert.equal(await(await fetch(url)).text(),script);
 }finally{await next.close();}
});

test('dynamic registered services update status, certificate lookup and fetched PAC without OS mutations', async t => {
  let epoch = 1; const grants = new Set(); let certificateOptions, platformWrites = 0;
  const service = 'https://new-service.tsinghua.edu.cn';
  const session = { epoch: () => epoch, assertCurrent: expected => assert.equal(expected, epoch), status: () => ({ authenticated: true, state: 'ready' }),
    request: async () => new Response('new service'), authorizeTarget: target => grants.has(new URL(target).origin),
    allowedOrigins: () => [...grants, 'https://webvpn.tsinghua.edu.cn', 'https://outside.test', 'https://unregistered.tsinghua.edu.cn'] };
  const { manager, platform } = await fixture(t, { session, allowedOrigins: ['https://learn.tsinghua.edu.cn'],
    certificateFactory: async options => { certificateOptions = options; return createCertificateAuthority(options); } });
  platform.enableProxy = async () => { platformWrites++; };
  const started = await manager.control({ action: 'start', confirm: true });
  const route = async (url) => {
    const ctx = vm.createContext({}); vm.runInContext(await (await fetch(started.pacUrl)).text(), ctx);
    return ctx.FindProxyForURL(url, new URL(url).hostname);
  };
  assert.equal(certificateOptions.authorizeHost('new-service.tsinghua.edu.cn'), false);
  assert.equal(await route(service), 'DIRECT');
  grants.add(service); grants.add('https://webvpn.tsinghua.edu.cn'); grants.add('https://outside.test');
  assert.deepEqual((await manager.control({ action: 'status' })).allowedOrigins, ['https://learn.tsinghua.edu.cn', service]);
  assert.equal(certificateOptions.authorizeHost('new-service.tsinghua.edu.cn'), true);
  assert.equal(certificateOptions.authorizeHost('webvpn.tsinghua.edu.cn'), false);
  assert.equal(certificateOptions.authorizeHost('outside.test'), false);
  assert.equal(await route(service), `PROXY 127.0.0.1:${started.endpoint.port}`);
  assert.equal(await route('https://www.tsinghua.edu.cn/'), 'DIRECT');
  assert.equal(await route('https://webvpn.tsinghua.edu.cn/'), 'DIRECT');
  grants.clear(); epoch++;
  assert.deepEqual((await manager.control({ action: 'status' })).allowedOrigins, ['https://learn.tsinghua.edu.cn']);
  assert.equal(certificateOptions.authorizeHost('new-service.tsinghua.edu.cn'), false);
  assert.equal(await route(service), 'DIRECT');
  assert.equal(platformWrites, 0);
});

test('login is required and failed restoration preserves a running endpoint for repair', async t => {
  const { manager, platform, state, logout } = await fixture(t);
  await manager.control({ action: 'start', confirm: true });
  state.proxyEnabled = true;
  const restore = platform.disableProxy;
  platform.disableProxy = async () => ({ restored: false, failures: ['Wi-Fi'] });
  await assert.rejects(manager.control({ action: 'stop', confirm: true }), /GATEWAY_PROXY_RESTORE_FAILED/);
  assert.equal((await manager.control({ action: 'status' })).running, true);
  platform.disableProxy = restore;
  await manager.control({ action: 'stop', confirm: true });
  logout();
  await assert.rejects(manager.control({ action: 'start', confirm: true }), /GATEWAY_LOGIN_REQUIRED/);
});

test('PAC validates its listener and never falls back direct on allowed campus hosts', () => {
  assert.throws(() => createPacScript(['https://campus.example'], { host: '0.0.0.0', port: 1234 }));
  const ctx = vm.createContext({}); vm.runInContext(createPacScript(['https://campus.example'], { host: '127.0.0.1', port: 1234 }), ctx);
  assert.equal(ctx.FindProxyForURL('https://campus.example', 'CAMPUS.EXAMPLE'), 'PROXY 127.0.0.1:1234');
});

test('Mac system activation uses a separate peer-authorized listener and per-service inherited PAC', async t => {
  const { manager, platform, state } = await fixture(t, { peerAuthorizerFactory: () => async () => true, hostPlatform: 'darwin' });
  const plan = { version: 1, fingerprint: 'fixture', services: [
    { name: 'Wi-Fi', fallback: { http: { host: '127.0.0.1', port: 7897 }, https: { host: '127.0.0.1', port: 7897 }, bypass: [] } },
    { name: 'Ethernet', fallback: {} },
  ] };
  platform.prepareProxy = async () => plan;
  platform.enableProxy = async ({ expectedPlan, pacUrlsByService }) => {
    assert.equal(expectedPlan, plan); assert.deepEqual(Object.keys(pacUrlsByService), ['Wi-Fi', 'Ethernet']);
    state.proxyEnabled = true; state.recoveryRequired = true; state.pacUrlsByService = pacUrlsByService;
  };
  const normal = await manager.control({ action: 'start', confirm: true });
  await assert.rejects(manager.control({ action: 'system-enable', confirm: true }), /GATEWAY_CERTIFICATE_TRUST_REQUIRED/);
  state.trusted = true;
  const enabled = await manager.control({ action: 'system-enable', confirm: true });
  assert.notEqual(enabled.systemEndpoint.port, normal.endpoint.port);
  assert.equal(enabled.systemProxy.recoveryRequired, false);
  const ctx = vm.createContext({});
  vm.runInContext(await (await fetch(state.pacUrlsByService['Wi-Fi'])).text(), ctx);
  assert.equal(ctx.FindProxyForURL('https://outside.example/', 'outside.example'), 'PROXY 127.0.0.1:7897');
  assert.equal(ctx.FindProxyForURL('https://campus.example/', 'campus.example'), `PROXY 127.0.0.1:${enabled.systemEndpoint.port}`);
  const request = http.request({ host: enabled.systemEndpoint.host, port: enabled.systemEndpoint.port,
    path: 'http://campus.example/', headers: { Host: 'campus.example', 'Sec-Fetch-Site': 'none' } });
  const result = new Promise((resolve, reject) => { request.on('response', res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); request.on('error', reject); });
  request.end(); assert.equal(await result, 307);
  const urls = Object.values(state.pacUrlsByService);
  // A partial restore still owns its PAC and listener; matching endpoints must
  // not make this incomplete network configuration appear healthy.
  state.restorePending = true;
  assert.equal((await manager.control({ action: 'status' })).systemProxy.recoveryRequired, true);
  await assert.rejects(manager.control({ action: 'system-enable', confirm: true }), /GATEWAY_PROXY_RECOVERY_REQUIRED/);
  state.restorePending = false;
  await manager.control({ action: 'system-disable', confirm: true });
  assert.equal((await manager.control({ action: 'status' })).systemEndpoint, null);
  for (const url of urls) await assert.rejects(fetch(url));
  assert.equal((await manager.control({ action: 'status' })).running, true);
});

test('a changed manual proxy is adopted automatically without replacing campus listeners or PAC URLs', { timeout: 5000 }, async t => {
  const f = await fixture(t, { hostPlatform: 'darwin', peerAuthorizerFactory: () => async () => true, proxyPollIntervalMs: 20 });
  f.session.accountKey = () => 'a'.repeat(64);
  f.state.trusted = true;
  let fallback = { https: { host: '127.0.0.1', port: 7897 } };
  let refreshed;
  const update = new Promise(resolve => { refreshed = resolve; });
  f.platform.prepareProxy = async () => ({ services: [
    { name: 'Ethernet', fallback }, { name: 'Wi-Fi', fallback: {} },
  ] });
  f.platform.enableProxy = async ({ refresh, pacUrlsByService }) => {
    Object.assign(f.state, { proxyEnabled: true, settingsChanged: false, recoveryRequired: true, pacUrlsByService });
    if (refresh) refreshed();
  };
  await f.manager.control({ action: 'start', confirm: true });
  const before = await f.manager.control({ action: 'system-enable', confirm: true });
  fallback = { https: { host: '127.0.0.1', port: 8999 } };
  f.state.settingsChanged = true;
  await update;
  const after = await f.manager.control({ action: 'status' });
  assert.equal(after.systemProxy.recoveryRequired, false);
  assert.deepEqual(after.endpoint, before.endpoint);
  assert.deepEqual(after.systemEndpoint, before.systemEndpoint);
  assert.deepEqual(after.systemProxy.pacUrlsByService, before.systemProxy.pacUrlsByService);
  const ethernet = await (await fetch(after.systemProxy.pacUrlsByService.Ethernet)).text();
  const wifi = await (await fetch(after.systemProxy.pacUrlsByService['Wi-Fi'])).text();
  const evaluate = (script, host) => {
    const context = vm.createContext({});
    vm.runInContext(script, context);
    return context.FindProxyForURL('https://' + host + '/', host);
  };
  assert.equal(evaluate(ethernet, 'outside.example'), 'PROXY 127.0.0.1:8999');
  assert.equal(evaluate(wifi, 'outside.example'), 'DIRECT');
  assert.equal(evaluate(ethernet, 'campus.example'), 'PROXY 127.0.0.1:' + after.systemEndpoint.port);
  fallback = {};
  f.state.settingsChanged = true;
  await f.manager.resume();
  const withoutProxy = await (await fetch(after.systemProxy.pacUrlsByService.Ethernet)).text();
  assert.equal(evaluate(withoutProxy, 'outside.example'), 'DIRECT');
  assert.equal(evaluate(withoutProxy, 'campus.example'), 'PROXY 127.0.0.1:' + after.systemEndpoint.port);
});

test('an unsupported replacement PAC leaves existing listeners and fallback untouched', async t => {
  const f = await fixture(t, { hostPlatform: 'darwin', peerAuthorizerFactory: () => async () => true });
  f.session.accountKey = () => 'a'.repeat(64);
  f.state.trusted = true;
  let writes = 0;
  f.platform.prepareProxy = async ({ refresh }) => {
    if (refresh) throw new GatewayError('GATEWAY_EXISTING_PROXY_ENABLED');
    return { services: [{ name: 'Ethernet', fallback: { https: { host: '127.0.0.1', port: 7897 } } }] };
  };
  f.platform.enableProxy = async ({ pacUrlsByService }) => {
    writes++;
    Object.assign(f.state, { proxyEnabled: true, recoveryRequired: true, pacUrlsByService });
  };
  await f.manager.control({ action: 'start', confirm: true });
  const before = await f.manager.control({ action: 'system-enable', confirm: true });
  f.state.settingsChanged = true;
  await assert.rejects(f.manager.resume(), { code: 'GATEWAY_EXISTING_PROXY_ENABLED' });
  const after = await f.manager.control({ action: 'status' });
  assert.equal(writes, 1);
  assert.deepEqual(after.systemEndpoint, before.systemEndpoint);
  assert.deepEqual(after.systemProxy.pacUrlsByService, before.systemProxy.pacUrlsByService);
  assert.match(await (await fetch(after.systemProxy.pacUrlsByService.Ethernet)).text(), /127\.0\.0\.1:7897/);
});

test('a partially applied proxy refresh keeps the new upstream available to its live PAC', async t => {
  const f = await fixture(t, { hostPlatform: 'darwin', peerAuthorizerFactory: () => async () => true });
  f.session.accountKey = () => 'a'.repeat(64);
  f.state.trusted = true;
  let fallback = { https: { host: '127.0.0.1', port: 7897 } };
  f.platform.prepareProxy = async () => ({ services: [{ name: 'Ethernet', fallback }] });
  f.platform.enableProxy = async ({ refresh, pacUrlsByService }) => {
    Object.assign(f.state, { proxyEnabled: true, recoveryRequired: true, pacUrlsByService });
    if (refresh) {
      f.state.restorePending = true;
      throw new GatewayError('GATEWAY_SYSTEM_PERMISSION_REQUIRED');
    }
  };
  await f.manager.control({ action: 'start', confirm: true });
  const before = await f.manager.control({ action: 'system-enable', confirm: true });
  fallback = { https: { host: '127.0.0.1', port: 8999 } };
  f.state.settingsChanged = true;
  await assert.rejects(f.manager.resume(), { code: 'GATEWAY_SYSTEM_PERMISSION_REQUIRED' });
  const after = await f.manager.control({ action: 'status' });
  assert.deepEqual(after.systemEndpoint, before.systemEndpoint);
  assert.equal(after.systemProxy.restorePending, true);
  assert.match(await (await fetch(after.systemProxy.pacUrlsByService.Ethernet)).text(), /127\.0\.0\.1:8999/);
});

test('account revocation closes proxy and test browser even when OS recovery fails', async t => {
  let closed = 0;
  const { manager, platform, state } = await fixture(t, { browserFactory: async () => ({ close: async () => { closed++; } }) });
  const started = await manager.control({ action: 'start', confirm: true });
  await manager.control({ action: 'open-browser', confirm: true });
  state.proxyEnabled = true; state.recoveryRequired = true;
  const restore = platform.disableProxy;
  platform.disableProxy = async () => ({ restored: false, failures: ['Wi-Fi'] });
  await assert.rejects(manager.control({ action: 'stop', confirm: true, revoke: true }), /GATEWAY_PROXY_RESTORE_FAILED/);
  assert.equal(closed, 1);
  const after = await manager.control({ action: 'status' });
  assert.equal(after.running, false); assert.equal(after.systemProxy.recoveryRequired, true);
  await assert.rejects(manager.control({ action: 'start', confirm: true }), /GATEWAY_PROXY_RECOVERY_REQUIRED/);
  // PAC remains reachable and fails closed at the revoked proxy endpoint.
  assert.equal((await fetch(started.pacUrl)).status, 200);
  platform.disableProxy = restore;
  await manager.control({ action: 'system-disable', confirm: true });
});

test('peer preflight failure leaves original network settings untouched and activation can be retried', async t => {
  let healthy = false, checks = 0, writes = 0;
  const f = await fixture(t, { hostPlatform: 'darwin', peerAuthorizerFactory: () => async () => {
    checks++; if (!healthy) throw new GatewayError('GATEWAY_PEER_UNAVAILABLE', 503); return true;
  } });
  f.platform.prepareProxy = async () => ({ version: 1, fingerprint: 'fixture', services: [{ name: 'Wi-Fi', fallback: {} }] });
  f.platform.enableProxy = async ({ pacUrlsByService }) => {
    writes++; f.state.proxyEnabled = true; f.state.recoveryRequired = true; f.state.pacUrlsByService = pacUrlsByService;
  };
  await f.manager.control({ action: 'start', confirm: true }); f.state.trusted = true;
  await assert.rejects(f.manager.control({ action: 'system-enable', confirm: true }), { code: 'GATEWAY_PEER_UNAVAILABLE' });
  assert.equal(checks, 1); assert.equal(writes, 0); assert.equal(f.state.proxyEnabled, false);
  const failed = await f.manager.control({ action: 'status' });
  assert.equal(failed.systemEndpoint, null); assert.equal(failed.systemProxy.recoveryRequired, false);
  healthy = true;
  const enabled = await f.manager.control({ action: 'system-enable', confirm: true });
  assert.equal(checks, 2); assert.equal(writes, 1); assert.equal(enabled.systemProxy.enabled, true);
  assert.equal(enabled.systemTraffic.requests, 0, 'preflight never forwards a school request');
});
