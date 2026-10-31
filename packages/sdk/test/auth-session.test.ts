import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { openSessionStorage } from '../src/node/storage.js';
import { webvpnDecodeUrl } from '@onethu/core';

// The distributable SDK bundles info-lib's existing CommonJS dependencies. Test
// that actual Node boundary rather than the browser-oriented source loader.
const bundleDir=await mkdtemp(path.join(os.tmpdir(),'onethu-sdk-auth-bundle-'));
after(()=>rm(bundleDir,{recursive:true,force:true}));
const outfile=path.join(bundleDir,'session.mjs');
await build({entryPoints:[fileURLToPath(new URL('../src/node/session.ts',import.meta.url))],outfile,bundle:true,platform:'node',format:'esm',target:'node20',banner:{js:"import { createRequire as __sdkCreateRequire } from 'node:module'; const require = __sdkCreateRequire(import.meta.url);"},logLevel:'silent'});
const {createNodeSession}=await import(pathToFileURL(outfile).href) as typeof import('../src/node/session.js');

const temporaryDirs:string[]=[];after(async()=>{for(const dir of temporaryDirs)await rm(dir,{recursive:true,force:true});});
async function temporary(t:any,seed=true){const dir=await mkdtemp(path.join(os.tmpdir(),'onethu-sdk-session-'));temporaryDirs.push(dir);if(seed){const store=await openSessionStorage(dir);await store.save({version:1,device:{fingerprint:'b'.repeat(32),account:'12345678',finger3:'fixture-trust'},session:{username:'12345678',fingerprint:'b'.repeat(32),cookiesJson:JSON.stringify([{name:'sid',value:'fixture-cookie',domain:'id.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]),savedAt:1}});await store.close();}return dir;}
function fakeSchool(options:{account?:string;unavailable?:boolean;expired?:boolean}={}){const calls:{path:string;method:string}[]=[];return{calls,fetch:(async(input:string,init:RequestInit={})=>{
  const physical=new URL(input);const url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(input)??input:input);calls.push({path:url.pathname,method:init.method??'GET'});
  if(options.unavailable)return new Response('unavailable',{status:503});
  if(options.expired)return new Response('<form action="/login"><input name="i_pass"></form>');
  if(url.pathname==='/wengine-vpn/cookie')return new Response('XSRF-TOKEN=fixture-csrf;');
  if(url.pathname.endsWith('/grjbxx'))return Response.json({object:{ryh:options.account??'12345678'}});
  if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname))return new Response('<html><a href="/f/wlxt/index/course/student/?_csrf=fixture-learn">courses</a></html>');
  throw new Error('unexpected fixture request');
}) as typeof globalThis.fetch};}

test('standalone restoration verifies account with a read-only probe and preserves stable identity',async t=>{
  const dir=await temporary(t);const school=fakeSchool();const sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());
  assert.equal(sdk.status().authenticated,false);const result=await sdk.restore();assert.equal(result.authenticated,true);assert.equal(result.account,'***5678');assert.equal(sdk.session.fingerprint,'b'.repeat(32));assert.equal(sdk.session.finger3,'fixture-trust');assert.equal(sdk.learn.csrfToken,null);await sdk.ensureLearnReady();assert.equal(sdk.learn.csrfToken,'fixture-learn');assert.equal(school.calls.every(c=>c.method==='GET'),true);
  const epoch=sdk.epoch();await sdk.close();assert.throws(()=>sdk.assertCurrent(epoch),{code:'AUTH_SESSION_CLOSED'});
  const raw=await readFile(path.join(dir,'session.json'),'utf8');assert.equal(raw.includes('password'),false);assert.equal(JSON.parse(raw).device.fingerprint,'b'.repeat(32));
});
test('browser service preparation uses only existing SSO confirmation and never passwords or account initialization',async t=>{
 for(const mode of ['confirm','password','uninitialized']){
  const dir=await temporary(t),school=fakeSchool(),requests:{path:string;method:string;body:string}[]=[];let confirmed=false;
  const sdk=await createNodeSession({dataDir:dir,fetch:(async(raw:string,init:RequestInit={})=>{
   const url=new URL(webvpnDecodeUrl(raw)??raw),method=init.method??'GET',body=String(init.body??'');requests.push({path:url.pathname,method,body});
   if(url.pathname==='/ic-web/auth/userInfo')return Response.json(confirmed?{code:0,data:mode==='uninitialized'?{}:{pid:'12345678',accNo:123}}:{code:300,message:'login required'});
   if(url.pathname==='/ic-web/auth/address')return Response.json({code:0,data:'https://cab.lib.tsinghua.edu.cn/authcenter/toLoginPage'});
   if(url.pathname==='/authcenter/toLoginPage')return new Response(null,{status:302,headers:{location:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0'}});
   if(url.pathname.includes('/login/form/'))return new Response(mode==='password'?'<form><div id="sm2publicKey">fixture</div><input name="i_pass"></form>':'<form action="/do/off/ui/auth/login/checkSingle"></form>');
   if(url.pathname.endsWith('/login/checkSingle')){const fields=new URLSearchParams(body);assert.equal(fields.get('fingerPrint'),'b'.repeat(32));assert.equal(fields.get('fingerGenPrint'),'fixture-trust');return new Response(null,{status:302,headers:{location:'https://oauth.tsinghua.edu.cn/fixture-callback?ticket=fixture'}});}
   if(url.pathname==='/fixture-callback'){confirmed=true;return new Response('ready');}
   if(url.pathname==='/ic-web/roomDevice/roomInfos')return Response.json({code:0,data:[]});
   return school.fetch(raw,init);
  }) as typeof fetch});
  try{
   await sdk.restore();sdk.info.resetStaticSessionCaches();sdk.session.injectCredentials('12345678','must-never-replay');
   if(mode==='confirm')await sdk.ensureCampusService('https://cab.lib.tsinghua.edu.cn');
   else await assert.rejects(sdk.ensureCampusService('https://cab.lib.tsinghua.edu.cn'));
   assert.equal(sdk.status().authenticated,true);assert(requests.every(r=>!r.body.includes('must-never-replay')));
   assert(requests.filter(r=>r.method!=='GET').every(r=>r.path==='/do/off/ui/auth/login/checkSingle'));
   assert(!requests.some(r=>r.path==='/ic-web/account/update'||r.path.endsWith('/login/check')));
  }finally{await sdk.close();}
 }
});
test('another account response clears saved cookies and invalidates the previous generation',async t=>{
  const dir=await temporary(t);const sdk=await createNodeSession({dataDir:dir,fetch:fakeSchool({account:'87654321'}).fetch});t.after(()=>sdk.close());const epoch=sdk.epoch();
  await assert.rejects(sdk.restore(),{code:'AUTH_SESSION_CONFLICT'});assert.equal(sdk.status().authenticated,false);assert.equal(sdk.http.jar.serialize(),'[]');assert.throws(()=>sdk.assertCurrent(epoch),{code:'AUTH_SESSION_CHANGED'});await sdk.close();assert.equal(JSON.parse(await readFile(path.join(dir,'session.json'),'utf8')).session,null);
});
test('temporary probe outage preserves cookies without starting an implicit password login',async t=>{
  const dir=await temporary(t);const school=fakeSchool({unavailable:true});const sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());await assert.rejects(sdk.restore(),{code:'AUTH_PROBE_UNAVAILABLE'});assert.match(sdk.http.jar.serialize(),/fixture-cookie/);assert.equal(school.calls.length,1);assert.equal(school.calls[0].method,'GET');
});
test('login-page probe stays idle and a second active SDK runtime is excluded',async t=>{
  const dir=await temporary(t);const sdk=await createNodeSession({dataDir:dir,fetch:fakeSchool({expired:true}).fetch});t.after(()=>sdk.close());assert.equal((await sdk.restore()).state,'idle');await assert.rejects(createNodeSession({dataDir:dir,fetch:fakeSchool().fetch}),{code:'AUTH_RUNTIME_IN_USE'});await sdk.logout();assert.equal(sdk.status().account,null);assert.equal(sdk.http.jar.serialize(),'[]');
});
test('fresh runtime is offline until an explicit operation and persists no challenge/password',async t=>{
  const dir=await temporary(t,false);let calls=0;const sdk=await createNodeSession({dataDir:dir,fetch:async()=>{calls++;throw new Error('forbidden fixture network');}});t.after(()=>sdk.close());assert.equal((await sdk.restore()).state,'idle');assert.equal(calls,0);await sdk.close();const json=JSON.parse(await readFile(path.join(dir,'session.json'),'utf8'));assert.equal(json.session,null);assert.match(json.device.fingerprint,/^[a-f0-9]{32}$/);assert.equal(Object.keys(json).includes('password'),false);
});

test('real InfoHelper SM2 and interactive 2FA chain completes through the Node adapter without saving passwords',async t=>{
  const dir=await temporary(t,false);const require=createRequire(new URL('../../info-lib/package.json',import.meta.url));const {sm2}=require('sm-crypto');const key=sm2.generateKeyPairHex().publicKey;
  const success='登录成功。正在重定向到<a href="https://oauth.tsinghua.edu.cn/fixture-callback">Continue</a>';
  const confirm='<form action="/do/off/ui/auth/login/checkSingle"><input type="hidden" name="fingerPrint" value=""><input type="hidden" name="fingerGenPrint" value=""><input type="hidden" name="sig" value="fixture"></form>';
  const calls:{path:string;method:string;body:string}[]=[];
  const fetch=(async(input:string,init:RequestInit={})=>{
    const physical=new URL(input);const u=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(input)??input:input);const body=String(init.body??'');calls.push({path:u.pathname,method:init.method??'GET',body});
    if(u.pathname==='/login'&&u.searchParams.get('oauth_login')==='true')return new Response(`<div id="sm2publicKey">${key}</div>`);
    if(u.pathname.endsWith('/login/check'))return new Response('<html><title>二次认证</title><script src="/v2/dist/doubleauth/doubleAuth.bundle.js"></script></html>');
    if(u.pathname==='/b/doubleAuth/login'){
      const form=new URLSearchParams(body);if(form.get('action')==='FIND_APPROACHES')return Response.json({result:'success',object:{hasWeChatBool:false,phone:'12340001',hasTotp:true}});
      if(form.get('action')==='SEND_CODE')return Response.json({result:'success'});
      assert.equal(form.get('action'),'VERITY_TOTP_CODE');assert.equal(form.get('vericode'),'123456');return Response.json({result:'success',object:{redirectUrl:'/fixture-2fa-success'}});
    }
    if(u.pathname==='/fixture-2fa-success'||u.pathname.endsWith('/login/checkSingle'))return new Response(success);
    if(u.pathname==='/fixture-callback')return new Response('callback complete');
    if(u.pathname.includes('/login/form/'))return new Response(confirm);
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(u.pathname))return new Response('<input name="_csrf" value="fixture-token">');
    throw new Error('unexpected synthetic auth request');
  }) as typeof globalThis.fetch;
  const sdk=await createNodeSession({dataDir:dir,fetch});t.after(()=>sdk.close());
  const state=await sdk.login({username:'12345678',password:'fixture-password'});assert.equal(state.state,'need-2fa');assert.equal(sdk.status().state,'need-2fa');
  assert.equal(calls.filter(c=>c.body.includes('SEND_CODE')).length,0);
  assert.deepEqual(await sdk.twoFactor.verify('totp','123456'),{state:'ready'});assert.equal(sdk.status().authenticated,true);
  const credentialPosts=calls.filter(c=>c.path.endsWith('/login/check'));assert.equal(credentialPosts.length,1);const encrypted=new URLSearchParams(credentialPosts[0]!.body).get('i_pass');assert.ok(encrypted);assert.notEqual(encrypted,'fixture-password');
  assert.equal(calls.some(c=>/saveFinger/i.test(c.path)||/SAVE_FINGER/.test(c.body)),false);
  await sdk.close();const disk=await readFile(path.join(dir,'session.json'),'utf8');assert.equal(disk.includes('fixture-password'),false);assert.equal(disk.includes('123456'),true);assert.equal(disk.includes('vericode'),false);
});

const handoffSnapshot=(username='12345678')=>({username,fingerprint:'c'.repeat(32),finger3:'shared-device-trust',cookiesJson:JSON.stringify([{name:'sid',value:'handoff-cookie',domain:'id.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]),savedAt:Date.now()});
const gatewayHandoffSnapshot=(username='12345678')=>{
  const snapshot=handoffSnapshot(username);
  snapshot.cookiesJson=JSON.stringify([...JSON.parse(snapshot.cookiesJson),{
    name:'wengine_vpn_ticket',value:'wrdvpn1-authenticated-fixture',domain:'webvpn.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true,
  }]);
  return snapshot;
};

test('a verified native service handback preserves the live account, trust and unrelated business cookies',async t=>{
 const dir=await temporary(t),school=fakeSchool(),sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());
 await sdk.restore();
 sdk.http.jar.setRaw(new URL('https://cloud.tsinghua.edu.cn/'),'cloud=current; Path=/');
 const before=sdk.exportSession(),snapshot={...before.snapshot!,finger3:'must-not-replace-trust'};
 snapshot.cookiesJson=JSON.stringify([...JSON.parse(snapshot.cookiesJson),
  {name:'JSESSIONID',value:'renewed-selection',domain:'zhjwxk.cic.tsinghua.edu.cn',path:'/',secure:false,hostOnly:true},
  {name:'cloud',value:'stale-native',domain:'cloud.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]);
 await sdk.adoptSession({snapshot,expectedEpoch:sdk.epoch(),reason:'login',service:{name:'selection',identityRenewed:false}},async()=>{throw new Error('service handback must not stop the account');});
 assert.equal(sdk.status().authenticated,true);assert.equal(sdk.epoch(),before.epoch);assert.equal(sdk.session.finger3,'fixture-trust');
 assert.equal(sdk.http.jar.getCookies(new URL('https://cloud.tsinghua.edu.cn/')).find(c=>c.name==='cloud')?.value,'current');
 assert.equal(sdk.http.jar.getCookies(new URL('http://zhjwxk.cic.tsinghua.edu.cn/')).find(c=>c.name==='JSESSIONID')?.value,'renewed-selection');
 assert(school.calls.every(c=>c.method==='GET'));
});

test('service-only handback cannot bootstrap, change owners/devices or widen cookie scopes',async t=>{
 const dir=await temporary(t),school=fakeSchool(),sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());await sdk.restore();
 const before=sdk.exportSession(),snapshot=before.snapshot!;
 for(const input of [
  {snapshot:{...snapshot,username:'87654321'},reason:'login'},
  {snapshot:{...snapshot,fingerprint:'e'.repeat(32)},reason:'login'},
 ])await assert.rejects(sdk.adoptSession({...input,expectedEpoch:sdk.epoch(),service:{name:'selection',identityRenewed:true}} as any),{code:'AUTH_SESSION_CONFLICT'});
 await assert.rejects(sdk.adoptSession({snapshot,reason:'bootstrap',expectedEpoch:sdk.epoch(),service:{name:'selection',identityRenewed:false}}),{code:'AUTH_HANDOFF_INVALID'});
 await assert.rejects(sdk.adoptSession({snapshot,reason:'login',expectedEpoch:sdk.epoch(),service:{name:'any-site',identityRenewed:false}} as any),{code:'AUTH_HANDOFF_INVALID'});
 assert.equal(sdk.exportSession().snapshot?.cookiesJson,before.snapshot?.cookiesJson);
});

test('a verified live GUI university session restores an expired resident without passwords or unrelated cookie replacement',async t=>{
 const dir=await temporary(t),school=fakeSchool();let expired=false;
 const sdk=await createNodeSession({dataDir:dir,fetch:(async(raw:string,init:RequestInit={})=>{
  const url=new URL(webvpnDecodeUrl(raw)??raw);
  if(expired&&url.pathname.endsWith('/grjbxx')&&!new Headers(init.headers).get('cookie')?.includes('fresh-info'))return Response.json({status:401});
  return school.fetch(raw,init);
 }) as typeof fetch});t.after(()=>sdk.close());await sdk.restore();
 sdk.http.jar.setRaw(new URL('https://cloud.tsinghua.edu.cn/'),'cloud=current; Path=/');
 const epoch=sdk.epoch(),snapshot=sdk.exportSession().snapshot!;
 expired=true;sdk.session.state='idle';assert.equal((await sdk.restore()).state,'idle');sdk.noteInfoSessionRequired();
 snapshot.cookiesJson=JSON.stringify([...JSON.parse(snapshot.cookiesJson),{name:'info',value:'fresh-info',domain:'info.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true},
  {name:'cloud',value:'stale-native',domain:'cloud.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]);
 await sdk.adoptSession({snapshot,expectedEpoch:epoch,reason:'login',service:{name:'university',identityRenewed:true}});
 assert.equal(sdk.status().authenticated,true);assert.equal(sdk.epoch(),epoch);assert(!sdk.status().warnings.includes('CAMPUS_INFO_SESSION_REQUIRED'));
 assert.equal(sdk.http.jar.getCookies(new URL('https://cloud.tsinghua.edu.cn/')).find(c=>c.name==='cloud')?.value,'current');
 assert(school.calls.every(c=>c.method==='GET'));
 await sdk.logout();await assert.rejects(sdk.adoptSession({snapshot,expectedEpoch:sdk.epoch(),reason:'login',service:{name:'university',identityRenewed:true}}),{code:'AUTH_SESSION_CONFLICT'});
});
function coldInfoSchool(options:{account?:string;alwaysEmpty?:boolean}={}){
  const paths:string[]=[];let warm=false;
  return{paths,fetch:(async(input:string,init:RequestInit={})=>{
    const physical=new URL(input),url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(input)??input:input);
    paths.push(url.pathname);assert.ok(paths.length<=8,'identity proof must have a bounded request count');
    assert.equal(init.method??'GET','GET');
    const cookie=new Headers(init.headers).get('cookie')??'';
    assert.match(cookie,/(?:^|; )wengine_vpn_ticket=wrdvpn1-authenticated-fixture(?:;|$)/,'the real gateway ticket is required even when its value starts with wrdvpn1-');
    if(url.pathname==='/wengine-vpn/cookie'){
      if(!warm||options.alwaysEmpty)return new Response('');
      // The endpoint returns the application's complete cookie state, including
      // newline-separated pairs. A body control cookie cannot replace the
      // gateway's trusted HTTP/snapshot ticket.
      return new Response('JSESSIONID=fixture-info;\nXSRF-TOKEN=fixture-csrf\nINFO_BINDING=fixture-binding;wengine_vpn_ticket=body-ticket-must-not-win;heartbeat=body-heartbeat');
    }
    if(url.pathname==='/f/info/gxfw_fg/common/index'){
      assert.equal(warm,false,'one warm-up is sufficient and must not repeat');warm=true;
      return new Response('<html><title>Information portal fixture</title></html>');
    }
    if(url.pathname.endsWith('/grjbxx')){
      assert.equal(warm,true);
      for(const pair of ['JSESSIONID=fixture-info','XSRF-TOKEN=fixture-csrf','INFO_BINDING=fixture-binding'])assert.ok(cookie.split('; ').includes(pair),`identity request is missing ${pair.split('=')[0]}`);
      assert.equal(url.searchParams.get('_csrf'),'fixture-csrf');
      assert.equal(cookie.includes('body-ticket-must-not-win'),false);assert.equal(cookie.includes('body-heartbeat'),false);
      return Response.json({result:'success',object:{ryh:options.account??'12345678'}});
    }
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname))return new Response('<input name="_csrf" value="fixture-learn">');
    throw new Error('unexpected synthetic cold-info request');
  }) as typeof globalThis.fetch};
}

test('cold desktop handoff warms Info once and proves identity with its complete cookie state',async t=>{
  const dir=await temporary(t,false),school=coldInfoSchool();
  const sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());
  await sdk.adoptSession({snapshot:gatewayHandoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  assert.equal(sdk.status().authenticated,true);assert.equal(sdk.session.username,'12345678');
  assert.deepEqual(school.paths,['/wengine-vpn/cookie','/f/info/gxfw_fg/common/index','/wengine-vpn/cookie','/b/info/gxfw_fg/common/grjbxx']);
  const cookies=JSON.parse(sdk.exportSession().snapshot!.cookiesJson);
  assert.ok(cookies.some((c:any)=>c.domain==='info.tsinghua.edu.cn'&&c.name==='INFO_BINDING'&&c.value==='fixture-binding'));
  assert.ok(cookies.some((c:any)=>c.domain==='webvpn.tsinghua.edu.cn'&&c.path.startsWith('/https/')&&c.name==='INFO_BINDING'&&c.value==='fixture-binding'));
  assert.equal(cookies.some((c:any)=>c.value==='body-ticket-must-not-win'||c.value==='body-heartbeat'),false);
});

test('standalone restoration uses the same bounded cold Info proof',async t=>{
  const dir=await temporary(t,false),snapshot=gatewayHandoffSnapshot(),store=await openSessionStorage(dir);
  await store.save({version:1,device:{account:snapshot.username,fingerprint:snapshot.fingerprint,finger3:snapshot.finger3},session:snapshot});await store.close();
  const school=coldInfoSchool(),sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());
  assert.equal((await sdk.restore()).authenticated,true);assert.equal(sdk.learn.csrfToken,null);await sdk.ensureLearnReady();assert.equal(sdk.learn.csrfToken,'fixture-learn');
  assert.deepEqual(school.paths.slice(0,4),['/wengine-vpn/cookie','/f/info/gxfw_fg/common/index','/wengine-vpn/cookie','/b/info/gxfw_fg/common/grjbxx']);
  assert.equal(school.paths.filter(p=>p==='/f/info/gxfw_fg/common/index').length,1);
});

test('an empty Info cookie endpoint stops after one warm-up and preserves the prior session',async t=>{
  const dir=await temporary(t,false),school=coldInfoSchool({alwaysEmpty:true});
  const sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());const before=sdk.exportSession();
  await assert.rejects(sdk.adoptSession({snapshot:gatewayHandoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'}),{code:'AUTH_HANDOFF_UNVERIFIED'});
  assert.deepEqual(school.paths,['/wengine-vpn/cookie','/f/info/gxfw_fg/common/index','/wengine-vpn/cookie']);
  assert.equal(sdk.exportSession().snapshot,before.snapshot);assert.equal(sdk.epoch(),before.epoch);assert.equal(sdk.status().authenticated,false);assert.equal(sdk.http.jar.serialize(),'[]');
});

test('a cold Info proof for another account cannot replace the running account or stop its tasks',async t=>{
  const dir=await temporary(t),initial=fakeSchool(),candidate=coldInfoSchool({account:'87654321'});let useCandidate=false,stopped=false;
  const sdk=await createNodeSession({dataDir:dir,fetch:((input:string,init?:RequestInit)=>useCandidate?candidate.fetch(input,init):initial.fetch(input,init)) as typeof globalThis.fetch});t.after(()=>sdk.close());
  await sdk.restore();const before=sdk.exportSession();useCandidate=true;
  await assert.rejects(sdk.adoptSession({snapshot:gatewayHandoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'login'},async()=>{stopped=true;}),{code:'AUTH_HANDOFF_UNVERIFIED'});
  assert.equal(stopped,false);assert.equal(sdk.status().authenticated,true);assert.equal(sdk.session.username,'12345678');assert.equal(sdk.epoch(),before.epoch);
  assert.equal(sdk.exportSession().snapshot?.cookiesJson,before.snapshot?.cookiesJson);assert.equal(candidate.paths.filter(p=>p==='/f/info/gxfw_fg/common/index').length,1);
});

test('desktop handoff verifies identity, preserves trust and does not invalidate same-account task epochs',async t=>{
  const dir=await temporary(t,false), school=fakeSchool();const sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>sdk.close());
  assert.equal(sdk.desktopStatus().bootstrapAllowed,true);
  await sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  assert.equal(sdk.status().authenticated,true);assert.equal(sdk.session.fingerprint,'c'.repeat(32));assert.equal(sdk.session.finger3,'shared-device-trust');
  const epoch=sdk.epoch();await sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:epoch,reason:'login'});assert.equal(sdk.epoch(),epoch);
  const exported=sdk.exportSession();assert.equal(exported.snapshot?.username,'12345678');assert.equal(exported.snapshot?.finger3,'shared-device-trust');
  await sdk.adoptSession({snapshot:{...handoffSnapshot(),finger3:''},expectedEpoch:epoch,reason:'login'});
  assert.equal(sdk.exportSession().snapshot?.finger3,'shared-device-trust','an empty same-device bridge field cannot erase the existing trust credential');
  assert.equal(school.calls.every(row=>row.method==='GET'),true);
});
test('failed candidate probe leaves the old account and cookies unchanged',async t=>{
  const dir=await temporary(t);const sdk=await createNodeSession({dataDir:dir,fetch:fakeSchool().fetch});t.after(()=>sdk.close());await sdk.restore();
  const before=sdk.exportSession();let stopped=false;
  await assert.rejects(sdk.adoptSession({snapshot:handoffSnapshot('87654321'),expectedEpoch:sdk.epoch(),reason:'login'},async()=>{stopped=true;}),{code:'AUTH_HANDOFF_UNVERIFIED'});
  assert.equal(stopped,false);assert.equal(sdk.epoch(),before.epoch);assert.equal(sdk.exportSession().snapshot?.cookiesJson,before.snapshot?.cookiesJson);
  await assert.rejects(sdk.adoptSession({snapshot:handoffSnapshot('87654321'),expectedEpoch:sdk.epoch(),reason:'bootstrap'}),{code:'AUTH_SESSION_CONFLICT'});
});

test('gateway cache survives authority persistence with callback tickets and unknown fields removed',async t=>{
  const dir=await temporary(t,false),school=fakeSchool();
  const sdk=await createNodeSession({dataDir:dir,fetch:school.fetch});
  await sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  sdk.saveGatewayState({version:1,owner:'a'.repeat(64),epoch:sdk.epoch(),password:'must-be-removed',routes:[{origin:'https://future.tsinghua.edu.cn',upstreamOrigin:'https://future.tsinghua.edu.cn',transport:'direct',url:'https://future.tsinghua.edu.cn/callback?ticket=must-be-removed'}],tokens:[]});
  await sdk.close();
  const stored=await readFile(path.join(dir,'session.json'),'utf8');assert.equal(stored.includes('must-be-removed'),false);
  const reopened=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>reopened.close());
  const cache=reopened.loadGatewayState() as {routes:{url:string}[]};assert.equal(cache.routes[0]!.url,'https://future.tsinghua.edu.cn/');
});
test('logout tombstone persists across daemon restart and blocks stale desktop bootstrap',async t=>{
  const dir=await temporary(t,false);const sdk=await createNodeSession({dataDir:dir,fetch:fakeSchool().fetch});t.after(()=>sdk.close());
  const epoch=sdk.epoch();await sdk.logout();assert.equal(sdk.desktopStatus().tombstone,true);
  await assert.rejects(sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:epoch,reason:'bootstrap'}),{code:'AUTH_SESSION_CHANGED'});
  await sdk.close();const reopened=await createNodeSession({dataDir:dir,fetch:fakeSchool().fetch});t.after(()=>reopened.close());
  assert.equal(reopened.desktopStatus().bootstrapAllowed,false);await assert.rejects(reopened.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:reopened.epoch(),reason:'bootstrap'}),{code:'AUTH_HANDOFF_LOGGED_OUT'});
  await reopened.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:reopened.epoch(),reason:'login'});assert.equal(reopened.desktopStatus().tombstone,false);
});
test('desktop handoff rejects foreign cookie domains and strips additional secrets',async t=>{
  const dir=await temporary(t,false);const sdk=await createNodeSession({dataDir:dir,fetch:fakeSchool().fetch});t.after(()=>sdk.close());
  await assert.rejects(sdk.adoptSession({snapshot:{...handoffSnapshot(),cookiesJson:JSON.stringify([{name:'sid',value:'x',domain:'example.com',path:'/',secure:true,hostOnly:true}])},expectedEpoch:sdk.epoch(),reason:'bootstrap'}),{code:'AUTH_HANDOFF_COOKIE_SCOPE'});
  await sdk.adoptSession({snapshot:{...handoffSnapshot(),password:'NEVER_PERSIST'} as any,expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  assert.equal((await readFile(path.join(dir,'session.json'),'utf8')).includes('NEVER_PERSIST'),false);
});

test('same-account cookie renewal clears old service tokens and lazily fetches CSRF for the new jar',async t=>{
  const dir=await temporary(t);const school=fakeSchool();let learnReads=0;
  const fetch=(async(raw:string,init:RequestInit={})=>{
    const physical=new URL(raw),url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(raw)??raw:raw);
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname)){
      learnReads++;const renewed=new Headers(init.headers).get('cookie')?.includes('sid=handoff-cookie');
      return new Response(`<input name="_csrf" value="csrf-${renewed?'B':'A'}">`);
    }
    return school.fetch(raw,init);
  }) as typeof globalThis.fetch;
  const sdk=await createNodeSession({dataDir:dir,fetch});t.after(()=>sdk.close());await sdk.restore();
  assert.equal(sdk.learn.csrfToken,null);await sdk.ensureLearnReady();assert.equal(sdk.learn.csrfToken,'csrf-A');const epoch=sdk.epoch();
  const Info=sdk.info.constructor as any;Info.libToken='old-library-token';Info.libUserid='12345678';Info.libTokenTs=Date.now();Info.libRoomAuthUser='12345678';
  const renewed=handoffSnapshot();renewed.cookiesJson=JSON.stringify([...JSON.parse(renewed.cookiesJson),{name:'sid',value:'handoff-cookie',domain:'learn.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]);
  await sdk.adoptSession({snapshot:renewed,expectedEpoch:epoch,reason:'login'});
  assert.equal(sdk.epoch(),epoch);assert.equal(sdk.status().state,'ready');assert.equal(sdk.session.username,'12345678');
  assert.equal(sdk.learn.csrfToken,'');assert.equal(Info.libToken,'');assert.equal(Info.libUserid,'');assert.equal(Info.libTokenTs,0);assert.equal(Info.libRoomAuthUser,'');
  const before=learnReads;assert.deepEqual(await sdk.learn.getAllHomework([]),[]);
  assert.equal(sdk.learn.csrfToken,'csrf-B');assert.equal(learnReads,before+1);assert.equal(sdk.epoch(),epoch);
});

test('same-account handoff rejects late old-cookie responses without replaying a dispatched write',async t=>{
  const dir=await temporary(t),school=fakeSchool();let releaseLearn!:()=>void,releaseWrite!:()=>void,enterLearn!:()=>void,enterWrite!:()=>void;
  const learnEntered=new Promise<void>(resolve=>{enterLearn=resolve;}),writeEntered=new Promise<void>(resolve=>{enterWrite=resolve;});
  const learnHold=new Promise<void>(resolve=>{releaseLearn=resolve;}),writeHold=new Promise<void>(resolve=>{releaseWrite=resolve;});
  let holdOld=false,writes=0;
  const fetch=(async(raw:string,init:RequestInit={})=>{
    const physical=new URL(raw),url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(raw)??raw:raw);
    if(url.pathname==='/fixture-write'){
      writes++;enterWrite();await writeHold;
      return new Response('committed',{headers:{'set-cookie':'sid=old-write-cookie; Path=/'}});
    }
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname)&&holdOld){
      const renewed=new Headers(init.headers).get('cookie')?.includes('sid=handoff-cookie');
      if(!renewed){enterLearn();await learnHold;return new Response('<input name="_csrf" value="old-late-A">',{headers:{'set-cookie':'sid=old-late-cookie; Path=/'}});}
      return new Response('<input name="_csrf" value="current-B">');
    }
    return school.fetch(raw,init);
  }) as typeof globalThis.fetch;
  const sdk=await createNodeSession({dataDir:dir,fetch});t.after(()=>sdk.close());await sdk.restore();holdOld=true;
  const epoch=sdk.epoch(),oldRead=sdk.learn.resume(),oldWrite=sdk.fetch('https://id.tsinghua.edu.cn/fixture-write',{method:'POST',body:'fixture-no-real-operation'});
  // Attach rejection handlers before rotating to keep the synthetic ignored-
  // AbortSignal fetches observed while their late responses are still held.
  const readRejected=assert.rejects(oldRead,{code:'NETWORK_TIMEOUT'}),writeRejected=assert.rejects(oldWrite,{code:'NETWORK_TIMEOUT'});
  await Promise.all([learnEntered,writeEntered]);
  const renewed=handoffSnapshot();renewed.cookiesJson=JSON.stringify([...JSON.parse(renewed.cookiesJson),{name:'sid',value:'handoff-cookie',domain:'learn.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]);
  await sdk.adoptSession({snapshot:renewed,expectedEpoch:epoch,reason:'login'});
  releaseLearn();releaseWrite();await Promise.all([readRejected,writeRejected]);
  assert.equal(sdk.epoch(),epoch);assert.equal(sdk.status().state,'ready');assert.equal(writes,1);
  assert.equal(sdk.http.jar.serialize().includes('old-late-cookie'),false);assert.equal(sdk.http.jar.serialize().includes('old-write-cookie'),false);
  assert.equal(sdk.learn.csrfToken,'');await sdk.learn.getAllHomework([]);assert.equal(sdk.learn.csrfToken,'current-B');assert.equal(writes,1);
});

test('lazy Learn preparation after handoff is shared, cached, and retryable without changing authentication',async t=>{
  const dir=await temporary(t,false),school=fakeSchool();let pages=0,available=false;
  const sdk=await createNodeSession({dataDir:dir,fetch:(async(raw:string,init:RequestInit={})=>{
    const url=new URL(webvpnDecodeUrl(raw)??raw);
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname)){
      pages++;assert.equal(init.method??'GET','GET');
      return available?new Response('<input name="_csrf" value="lazy-ready">'):new Response('unavailable',{status:503});
    }
    return school.fetch(raw,init);
  }) as typeof globalThis.fetch});t.after(()=>sdk.close());
  await sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  assert.equal(pages,0);const epoch=sdk.epoch();
  const failed=await Promise.allSettled(Array.from({length:8},()=>sdk.ensureLearnReady()));
  assert.equal(failed.every(result=>result.status==='rejected'),true);assert.equal(pages,1);
  assert.equal(sdk.status().authenticated,true);assert.equal(sdk.epoch(),epoch);
  assert.equal(sdk.status().warnings.includes('LEARN_SESSION_UNAVAILABLE'),true);
  available=true;await Promise.all(Array.from({length:8},()=>sdk.ensureLearnReady()));
  assert.equal(pages,2);assert.equal(sdk.learn.csrfToken,'lazy-ready');
  assert.equal(sdk.status().warnings.includes('LEARN_SESSION_UNAVAILABLE'),false);
  await sdk.ensureLearnReady();assert.equal(pages,2);
});

test('same-account renewal fences a late lazy Learn preparation without losing the new CSRF',async t=>{
  const dir=await temporary(t,false),school=fakeSchool();let release!:()=>void,enter!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
  const sdk=await createNodeSession({dataDir:dir,fetch:(async(raw:string,init:RequestInit={})=>{
    const url=new URL(webvpnDecodeUrl(raw)??raw);
    if(/^\/f\/wlxt\/index\/course\/student\/?$/.test(url.pathname)){
      if(new Headers(init.headers).get('cookie')?.includes('sid=renewed'))return new Response('<input name="_csrf" value="new-csrf">');
      enter();await hold;return new Response('<input name="_csrf" value="old-csrf">',{headers:{'set-cookie':'late=old; Path=/'}});
    }
    return school.fetch(raw,init);
  }) as typeof globalThis.fetch});t.after(()=>sdk.close());
  await sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  const old=sdk.ensureLearnReady(),rejected=assert.rejects(old,{code:'AUTH_SESSION_CHANGED'});await entered;
  const snapshot=handoffSnapshot();snapshot.cookiesJson=JSON.stringify([...JSON.parse(snapshot.cookiesJson),{name:'sid',value:'renewed',domain:'learn.tsinghua.edu.cn',path:'/',secure:true,hostOnly:true}]);
  const epoch=sdk.epoch();await sdk.adoptSession({snapshot,expectedEpoch:epoch,reason:'login'});
  await sdk.ensureLearnReady();release();await rejected;
  assert.equal(sdk.epoch(),epoch);assert.equal(sdk.learn.csrfToken,'new-csrf');
  assert.equal(sdk.http.jar.serialize().includes('late'),false);
});

test('process shutdown preserves the account epoch while cancelling old requests and preventing late cookies',async t=>{
  const dir=await temporary(t,false),school=fakeSchool();let release!:(response:Response)=>void,enter!:()=>void;
  const entered=new Promise<void>(resolve=>{enter=resolve;});
  const sdk=await createNodeSession({dataDir:dir,fetch:(async(raw:string,init:RequestInit={})=>{
    if(new URL(raw).pathname==='/held-read'){enter();return new Promise<Response>(resolve=>{release=resolve;});}
    return school.fetch(raw,init);
  }) as typeof globalThis.fetch});t.after(()=>sdk.close());
  await sdk.adoptSession({snapshot:handoffSnapshot(),expectedEpoch:sdk.epoch(),reason:'bootstrap'});
  const epoch=sdk.epoch(),read=sdk.fetch('https://id.tsinghua.edu.cn/held-read');
  const rejected=assert.rejects(read,{code:'AUTH_SESSION_CLOSED'});await entered;await sdk.close();
  assert.throws(()=>sdk.assertCurrent(epoch),{code:'AUTH_SESSION_CLOSED'});
  release(new Response('late',{headers:{'set-cookie':'late=old-process; Path=/'}}));await rejected;
  const reopened=await createNodeSession({dataDir:dir,fetch:school.fetch});t.after(()=>reopened.close());
  assert.equal(reopened.epoch(),epoch);assert.equal((await reopened.restore()).authenticated,true);
  assert.equal(reopened.http.jar.serialize().includes('old-process'),false);
  await reopened.logout();assert.ok(reopened.epoch()>epoch);assert.equal(reopened.desktopStatus().tombstone,true);
});

test('parallel identity restoration is single-flight and Learn outage cannot delay or revoke school authentication',async t=>{
  const dir=await temporary(t),school=fakeSchool();let learnReads=0;
  const fetch=(async(raw:string,init:RequestInit={})=>{
    const physical=new URL(raw),url=new URL(/^\/https?\/[a-f0-9]{32,}\//.test(physical.pathname)?webvpnDecodeUrl(raw)??raw:raw);
    if(url.pathname.startsWith('/f/wlxt/')){learnReads++;return new Response('service unavailable',{status:503});}
    return school.fetch(raw,init);
  }) as typeof globalThis.fetch;
  const sdk=await createNodeSession({dataDir:dir,fetch});t.after(()=>sdk.close());
  const results=await Promise.all(Array.from({length:12},()=>sdk.restore()));
  assert(results.every(result=>result.authenticated));assert.equal(learnReads,0);
  assert.equal(school.calls.filter(call=>call.path.endsWith('/grjbxx')).length,1);
  assert.equal(sdk.learn.csrfToken,null);
  await assert.rejects(sdk.ensureLearnReady());assert.equal(learnReads,1);assert.equal(sdk.status().authenticated,true);
});
