import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientIdentity} from '../src/node/clientIdentity.js';
import {THESIS_IDENTITY_URL, THESIS_ORIGIN} from '@onethu/gateway/thesis-auth';
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

test('GitLab shares one private renewal and rejects a malformed or stale cookie completion',async()=>{
 const f=fixture(async()=>{throw new Error('unexpected network');});
 const first=f.identity.renewGitlab(),second=f.identity.renewGitlab();
 const row=f.identity.desktop.pending()!;
 assert.equal(row.service,'gitlab');assert.equal(f.identity.desktop.pending(),null);
 assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true,gitlabCookie:'token; Domain=other'}),/CLI_BRIDGE_INVALID/);
 f.rotate();
 assert.equal(f.identity.desktop.complete({id:row.id,ok:true,gitlabCookie:'obsolete-ticket'}).accepted,false);
 await Promise.all([assert.rejects(first),assert.rejects(second)]);
 const current=f.identity.renewGitlab(),next=f.identity.desktop.pending()!;
 assert.equal(f.identity.desktop.complete({id:next.id,ok:true,gitlabCookie:'fresh-ticket'}).accepted,true);
 assert.equal(await current,'fresh-ticket');
 assert.equal(JSON.stringify(f.identity.desktop.status()).includes('fresh-ticket'),false);
 f.identity.close();
});

test('successive MadModel reopenings request fresh one-use tickets without a successful-renewal lockout',async()=>{
 const f=fixture(async()=>{throw new Error('unexpected network');});
 for(const suffix of ['first','second']){
  const renewal=f.identity.renewMadmodel(),row=f.identity.desktop.pending()!;
  assert.equal(row.service,'madmodel');
  assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true,madmodelTicket:'bad\nvalue'}),/CLI_BRIDGE_INVALID/);
  const ticket='school-issued-ticket-'+suffix;
  f.identity.desktop.complete({id:row.id,ok:true,madmodelTicket:ticket});
  assert.equal(await renewal,ticket);
  assert.equal(JSON.stringify(f.identity.desktop.status()).includes(ticket),false);
 }
 f.identity.close();
});

test('a registered uppercase ITS form forwards its requested entry mode to the GUI without changing service scope',async()=>{
 const f=fixture(async()=>new Response('<input name="i_pass">'));
 const result=f.identity.request(url.replace('d982b795884e882abfa8ff3167aeb03e','D982B795884E882ABFA8FF3167AEB03E').replace('/0?','/1?'),{method:'GET'},{service:'xiaoda',identity:true});
 await new Promise(resolve=>setImmediate(resolve));const row=f.identity.desktop.pending()!;assert.equal(row.entryMode,1);
 f.identity.desktop.complete({id:row.id,ok:true,official});assert.match(await(await result).text(),/official-fixture-ticket/);f.identity.close();
});

test('official visitor double-slash entry borrows only its own official ticket',async()=>{
 const f=fixture(async()=>new Response('<input name="i_pass">'));
 const target='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form//04655f71b042b9d2d8d10cd566bd9c39/0?/visitor/mobile/sso';
 const result=f.identity.request(target,{method:'GET'},{service:'visit',identity:true});
 await new Promise(resolve=>setImmediate(resolve));const row=f.identity.desktop.pending();assert.equal(row?.service,'visit');assert.equal(row?.entryMode,0);
 const visitOfficial={...official,html:'<a href="https://visit.tsinghua.edu.cn/visitor/mobile/sso?ticket='+official.ticket+'">Continue</a>'};
 f.identity.desktop.complete({id:row.id,ok:true,official:visitOfficial});
 const response=await result;assert.match(response.headers.get('refresh'),/visit\.tsinghua\.edu\.cn\/visitor\/mobile\/sso\?ticket=/);
 await assert.rejects(f.identity.request(target.replace('/form//','/form///'),{method:'GET'},{service:'visit',identity:true}),{code:'GATEWAY_CLIENT_REQUEST_REJECTED'});
 f.identity.close();
});

test('Qingxiaoda website tickets are distinct from each other and a pending mini-program ticket',async()=>{
 const f=fixture(async()=>new Response('<input id="sm2publicKey">'));
 try {
  const mini=f.identity.request(url,{method:'GET'},{service:'xiaoda',identity:true});
  await new Promise(resolve=>setImmediate(resolve));
  const miniRow=f.identity.desktop.pending()!;
  const first=f.identity.renewXiaoda(),second=f.identity.renewXiaoda();
  const firstRow=f.identity.desktop.pending()!,secondRow=f.identity.desktop.pending()!;
  assert.equal(firstRow.service,'xiaoda');assert.equal(secondRow.service,'xiaoda');
  assert.equal(new Set([miniRow.id,firstRow.id,secondRow.id]).size,3);
  const result=(ticket:string)=>({...official,ticket,html:'<a href="https://www.xiaoda.tsinghua.edu.cn/login.html?ticket='+ticket+'">Continue</a>'});
  const a=result('website-ticket-first-0001'),b=result('website-ticket-second-0002');
  f.identity.desktop.complete({id:secondRow.id,ok:true,official:b});
  f.identity.desktop.complete({id:firstRow.id,ok:true,official:a});
  f.identity.desktop.complete({id:miniRow.id,ok:true,official});
  assert.equal(await first,a.ticket);assert.equal(await second,b.ticket);
  assert.match(await(await mini).text(),new RegExp(official.ticket));
  const third=f.identity.renewXiaoda(),thirdRow=f.identity.desktop.pending()!;
  assert.notEqual(thirdRow.id,firstRow.id);
  f.identity.desktop.complete({id:thirdRow.id,ok:true,official:result('website-ticket-third-0003')});
  assert.equal(await third,'website-ticket-third-0003');
 } finally {f.identity.close();}
});

test('Qingxiaoda website renewal validates the official receipt and revokes a cancelled or stale delivery',async()=>{
 const f=fixture(async()=>new Response('unused'));
 try {
  const result=f.identity.renewXiaoda(),row=f.identity.desktop.pending()!;
  assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true,official:{...official,html:'<a href="https://evil.example/?ticket='+official.ticket+'">bad</a>'}}),/CLI_BRIDGE_INVALID/);
  f.identity.desktop.complete({id:row.id,ok:true,official});assert.equal(await result,official.ticket);
  assert.equal(f.identity.desktop.complete({id:row.id,ok:true,official}).accepted,false);
  const controller=new AbortController(),cancelled=f.identity.renewXiaoda(controller.signal),cancelledRow=f.identity.desktop.pending()!;
  controller.abort();await assert.rejects(cancelled,{code:'GATEWAY_CANCELLED'});
  assert.equal(f.identity.desktop.complete({id:cancelledRow.id,ok:true,official}).accepted,false);
  const stale=f.identity.renewXiaoda(),oldRow=f.identity.desktop.pending()!;f.rotate();
  assert.equal(f.identity.desktop.complete({id:oldRow.id,ok:true,official}).accepted,false);await assert.rejects(stale);
  assert.equal(JSON.stringify(f.identity.desktop.status()).includes(official.ticket),false);
 } finally {f.identity.close();}
});

test('selection renewal coalesces and requires a claimed boolean acknowledgement',async()=>{
 const f=fixture(async()=>{throw new Error('Selection acknowledgement cannot send a school request');});
 try{
  let finished=false;
  const first=f.identity.renewSelection().then(value=>{finished=true;return value;});
  const second=f.identity.renewSelection();
  assert.deepEqual(f.identity.desktop.complete({id:'unclaimed',ok:true,selectionReady:true}),{accepted:false});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(finished,false);
  const row=f.identity.desktop.pending()!;
  assert.equal(row.service,'selection');
  assert.equal(f.identity.desktop.pending(),null);
  for(const value of [undefined,false,'true',1]){
   assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true,selectionReady:value} as any),/CLI_BRIDGE_INVALID/);
  }
  assert.equal(f.identity.desktop.complete({id:row.id,ok:true,selectionReady:true,official,gitlabCookie:'must-not-return'}).accepted,true);
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  assert.equal(f.identity.desktop.complete({id:row.id,ok:true,selectionReady:true}).accepted,false);
  const status=JSON.stringify(f.identity.desktop.status());
  assert.equal(status.includes(official.ticket),false);
  assert.equal(status.includes('must-not-return'),false);
 }finally{f.identity.close();}
});

test('selection renewal revokes stale acknowledgements and cancels only the affected waiter',async()=>{
 const f=fixture(async()=>new Response('unused'));
 try{
  const stale=f.identity.renewSelection();
  const staleRejection=assert.rejects(stale);
  const oldRow=f.identity.desktop.pending()!;
  f.rotate();
  assert.equal(f.identity.desktop.complete({id:oldRow.id,ok:true,selectionReady:true}).accepted,false);
  await staleRejection;

  const controller=new AbortController();
  const cancelled=f.identity.renewSelection(controller.signal);
  const cancelledRejection=assert.rejects(cancelled,{code:'GATEWAY_CANCELLED'});
  const remaining=f.identity.renewSelection();
  const row=f.identity.desktop.pending()!;
  controller.abort();
  await cancelledRejection;
  assert.equal(f.identity.desktop.complete({id:row.id,ok:true,selectionReady:true}).accepted,true);
  assert.equal(await remaining,true);
 }finally{f.identity.close();}
});

test('a failed selection acknowledgement returns false without credentials or a successful result',async()=>{
 const f=fixture(async()=>new Response('unused'));
 try{
  const pending=f.identity.renewSelection();
  const row=f.identity.desktop.pending()!;
  f.identity.desktop.complete({id:row.id,ok:false});
  assert.equal(await pending,false);
  assert.equal(f.identity.desktop.status().find(item=>item.service==='selection')?.state,'sign-in-required');
 }finally{f.identity.close();}
});

test('selection requests cancelled before dispatch leave no native recovery queued',async()=>{
 const f=fixture(async()=>new Response('unused'));
 try{
  const alreadyCancelled=new AbortController();alreadyCancelled.abort();
  await assert.rejects(f.identity.renewSelection(alreadyCancelled.signal),{code:'GATEWAY_CANCELLED'});
  assert.equal(f.identity.desktop.pending(),null);
  const firstController=new AbortController(),secondController=new AbortController();
  const first=f.identity.renewSelection(firstController.signal),second=f.identity.renewSelection(secondController.signal);
  const rejected=Promise.all([
   assert.rejects(first,{code:'GATEWAY_CANCELLED'}),
   assert.rejects(second,{code:'GATEWAY_CANCELLED'}),
  ]);
  firstController.abort();secondController.abort();await rejected;
  assert.equal(f.identity.desktop.pending(),null);
 }finally{f.identity.close();}
});

test('thesis renewals have independent single-use receipts and retain the fixed identity target',async()=>{
 const f=fixture(async()=>{throw new Error('Thesis renewal must be handled by the native account broker');});
 try{
  const first=f.identity.renewThesis(),second=f.identity.renewThesis();
  const firstRow=f.identity.desktop.pending()!,secondRow=f.identity.desktop.pending()!;
  assert.equal(firstRow.service,'thesis');assert.equal(secondRow.service,'thesis');
  assert.equal(firstRow.identityUrl,THESIS_IDENTITY_URL);assert.equal(secondRow.identityUrl,THESIS_IDENTITY_URL);
  assert.notEqual(firstRow.id,secondRow.id);
  const a=THESIS_ORIGIN+'/qh/thesis/tsinghua/Login?ticket=first-official-ticket';
  const b=THESIS_ORIGIN+'/qh/thesis/tsinghua/Login?ticket=second-official-ticket';
  assert.equal(f.identity.desktop.complete({id:secondRow.id,ok:true,thesisCallback:b}).accepted,true);
  assert.equal(f.identity.desktop.complete({id:firstRow.id,ok:true,thesisCallback:a}).accepted,true);
  assert.equal(await first,a);assert.equal(await second,b);
  assert.equal(f.identity.desktop.complete({id:firstRow.id,ok:true,thesisCallback:a}).accepted,false);
  assert.equal(JSON.stringify(f.identity.desktop.status()).includes('official-ticket'),false);
 }finally{f.identity.close();}
});

test('thesis rejects wrong-service and altered callbacks before accepting its valid receipt',async()=>{
 const f=fixture(async()=>new Response('unused'));
 try{
  const result=f.identity.renewThesis(),row=f.identity.desktop.pending()!;
  const callback=THESIS_ORIGIN+'/qh/thesis/tsinghua/Login?ticket=official-thesis-ticket';
  for(const invalid of [
   'https://evil.example/qh/thesis/tsinghua/Login?ticket=official-thesis-ticket',
   'https://cab.lib.tsinghua.edu.cn/authcenter/doAuth/0123456789abcdef0123456789abcdef?ticket=official-thesis-ticket',
   callback.replace('/tsinghua/Login','/tsinghua/Other'),callback+'&ticket=second',
   callback+'&beforepage=https%3A%2F%2Fevil.example',callback.replace('https:','http:'),
  ])assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true,thesisCallback:invalid}),/CLI_BRIDGE_INVALID/);
  assert.equal(f.identity.desktop.status().find(item=>item.service==='thesis')?.state,'renewing');
  assert.equal(f.identity.desktop.complete({id:row.id,ok:true,thesisCallback:callback}).accepted,true);
  assert.equal(await result,callback);
 }finally{f.identity.close();}
});

test('thesis cancellation and account changes revoke late callback deliveries',async()=>{
 const f=fixture(async()=>new Response('unused'));
 const callback=THESIS_ORIGIN+'/qh/thesis/tsinghua/Login?ticket=official-thesis-ticket';
 try{
  const alreadyCancelled=new AbortController();alreadyCancelled.abort();
  await assert.rejects(f.identity.renewThesis(alreadyCancelled.signal),{code:'GATEWAY_CANCELLED'});
  assert.equal(f.identity.desktop.pending(),null);
  const controller=new AbortController(),cancelled=f.identity.renewThesis(controller.signal);
  const cancelledRejection=assert.rejects(cancelled,{code:'GATEWAY_CANCELLED'});
  const row=f.identity.desktop.pending()!;controller.abort();await cancelledRejection;
  assert.equal(f.identity.desktop.complete({id:row.id,ok:true,thesisCallback:callback}).accepted,false);
  const stale=f.identity.renewThesis(),staleRejection=assert.rejects(stale),oldRow=f.identity.desktop.pending()!;
  f.rotate();
  assert.equal(f.identity.desktop.complete({id:oldRow.id,ok:true,thesisCallback:callback}).accepted,false);
  await staleRejection;
 }finally{f.identity.close();}
});
