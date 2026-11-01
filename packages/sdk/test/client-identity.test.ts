import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientIdentity} from '../src/node/clientIdentity.js';
const url='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html';
const official={ticket:'official-fixture-ticket-0001',html:'<a href="https://www.xiaoda.tsinghua.edu.cn/login.html?ticket=official-fixture-ticket-0001">Continue</a>',url:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/check',status:200};
function fixture(fetch:any){
 let epoch=1;const runtime:any={epoch:()=>epoch,assertCurrent:(value:number)=>{if(value!==epoch)throw new Error('changed');},status:()=>({authenticated:true}),session:{username:'fixture-user',fingerprint:'installation-fixture',finger3:'existing-trust'},fetchCampusDirect:fetch};
 return {runtime,identity:createClientIdentity(runtime),rotate(){epoch++;}};
}
test('official confirmation uses existing trust, drops browser/new-device fields and returns the real ticket',async()=>{
 let calls=0;const f=fixture(async(target:string,init:any)=>{
  calls++;
  if(calls===1)return new Response('<form action="/do/off/ui/auth/login/checkSingle"><input type="hidden" name="csrf" value="nonce"><input type="hidden" name="singleLogin" value="new"><input type="hidden" name="deviceName" value="bad"></form>');
  assert.equal(target,'https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle');
  const body=new URLSearchParams(init.body);assert.equal(body.get('fingerPrint'),'installation-fixture');assert.equal(body.get('fingerGenPrint3'),'existing-trust');assert.equal(body.has('singleLogin'),false);assert.equal(body.has('deviceName'),false);assert.equal(body.get('csrf'),'nonce');
  return new Response('<a href="https://www.xiaoda.tsinghua.edu.cn/login.html?ticket=official-fixture">Continue</a>');
 });
 const response=await f.identity.request(url,{method:'GET'},{service:'xiaoda',identity:true});assert.match(await response.text(),/official-fixture/);assert.equal(calls,2);f.identity.close();
});
test('expired identity queues one GUI renewal; only a claimed request completion can release it',async()=>{
 let renewed=false;const f=fixture(async()=>new Response(renewed?'official-success':'<input id="sm2publicKey">'));
 const result=f.identity.request(url,{method:'GET'},{service:'xiaoda',identity:true});
 await new Promise(resolve=>setImmediate(resolve));
 const row=f.identity.desktop.pending()!;assert.equal(row.service,'xiaoda');assert.equal(f.identity.desktop.pending(),null);
 assert.deepEqual(f.identity.desktop.complete({id:'unknown',ok:true}),{accepted:false});
 renewed=true;assert.equal(f.identity.desktop.complete({id:row.id,ok:true,official}).accepted,true);assert.match(await(await result).text(),/official-fixture-ticket-0001/);f.identity.close();
});
test('account epoch change revokes an outstanding renewal; no stale GUI completion is accepted',async()=>{
 const f=fixture(async()=>new Response('<input id="sm2publicKey">'));const result=f.identity.request(url,{method:'GET'},{service:'xiaoda',identity:true});
 await new Promise(resolve=>setImmediate(resolve));const row=f.identity.desktop.pending()!;f.rotate();
 assert.equal(f.identity.desktop.complete({id:row.id,ok:true,official}).accepted,false);
 await assert.rejects(result);f.identity.close();
});
test('identity adapter refuses password writes, unknown origins and arbitrary service IDs before sending anything',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return new Response('unexpected');});
 for(const [target,init] of [[url,{method:'POST',body:'i_pass=forbidden'}],[url.replace('d982b795884e882abfa8ff3167aeb03e','00000000000000000000000000000000'),{}],['https://evil.example/',{}]] as const)await assert.rejects(f.identity.request(target,init,{service:'xiaoda',identity:true}));
 assert.equal(calls,0);f.identity.close();
});

test('other mini programs keep their own official Cookie transaction without reading or modifying the authority jar',async()=>{
 let authorityCalls=0;const f=fixture(async()=>{authorityCalls++;throw new Error('authority transport forbidden');});
 const identity=createClientIdentity(f.runtime,{unborrowedFetch:async(input,init)=>{
  assert.equal(String(input),'https://id.tsinghua.edu.cn/do/off/ui/auth/login/check');
  assert.equal(new Headers(init?.headers).get('cookie'),'own-client=fixture');assert.equal(init?.redirect,'manual');
  return new Response('own official result',{headers:{'set-cookie':'own-client=new; Secure; HttpOnly; Path=/'}});
 }});
 const response=await identity.passthrough('https://id.tsinghua.edu.cn/do/off/ui/auth/login/check',{method:'POST',headers:{cookie:'own-client=fixture'},body:'own-form'});
 assert.equal(identity.isUnborrowed(response),true);assert.equal(authorityCalls,0);
 await assert.rejects(identity.passthrough('https://evil.example/',{}));identity.close();f.identity.close();
});

test('manual preparation returns immediately and exposes only renewal enums to the GUI control plane',()=>{
 const f=fixture(async()=>{throw new Error('preparing does not send a school request');});
 assert.equal(f.identity.desktop.prepare('xiaoda').queued,true);
 assert.equal(f.identity.desktop.status()[0].state,'queued');
 const row=f.identity.desktop.pending()!;assert.equal(f.identity.desktop.status()[0].state,'renewing');
 f.identity.desktop.complete({id:row.id,ok:true,official});assert.equal(f.identity.desktop.status()[0].state,'renewed');f.rotate();assert.equal(f.identity.desktop.status()[0].state,'idle');f.identity.close();
});

test('GUI ticket relay rejects another service callback and keeps the claimed request available for a valid completion',()=>{
 const f=fixture(async()=>new Response('unused'));f.identity.desktop.prepare('xiaoda');const row=f.identity.desktop.pending()!;
 assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true,official:{...official,html:'<a href="https://evil.example/?ticket='+official.ticket+'">bad</a>'}}),/CLI_BRIDGE_INVALID/);
 assert.equal(f.identity.desktop.status()[0].state,'renewing');f.identity.desktop.complete({id:row.id,ok:true,official});
 assert.equal(JSON.stringify(f.identity.desktop.status()).includes(official.ticket),false);f.identity.close();
});

test('a registered uppercase ITS form forwards its requested entry mode to the GUI without changing service scope',async()=>{
 const f=fixture(async()=>new Response('<input name="i_pass">'));
 const result=f.identity.request(url.replace('d982b795884e882abfa8ff3167aeb03e','D982B795884E882ABFA8FF3167AEB03E').replace('/0?','/1?'),{method:'GET'},{service:'xiaoda',identity:true});
 await new Promise(resolve=>setImmediate(resolve));const row=f.identity.desktop.pending()!;assert.equal(row.entryMode,1);
 f.identity.desktop.complete({id:row.id,ok:true,official});assert.match(await(await result).text(),/official-fixture-ticket/);f.identity.close();
});
