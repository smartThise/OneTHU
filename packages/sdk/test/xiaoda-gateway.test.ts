import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../src/node/transport.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';
import { XIAODA_ORIGIN, XIAODA_IDENTITY_URL, xiaodaCallbackUrl } from '@onethu/gateway/xiaoda-auth';

const rootLogin=XIAODA_ORIGIN+'/login?redirect=/';
const ticket='school-issued-xiaoda-ticket-0001';
const callback=xiaodaCallbackUrl(ticket)!;
const exchange=XIAODA_ORIGIN+'/api/token/login?type=0&ticket='+ticket;
const documentRequest={headers:{'sec-fetch-dest':'document',accept:'text/html'}};
function chunked(text:string){
 const bytes=Buffer.from(text);let offset=0;
 return new ReadableStream<Uint8Array>({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.subarray(offset,offset+13));offset+=13;}});
}
function fixture(options:{renew?:()=>Promise<string|null>}={}){
 let epoch=1,renewals=0;
 const requests:Array<{url:string;method:string;headers:Headers}>=[];
 const script='const source="'+XIAODA_IDENTITY_URL+'";window.open(source,"_blank");const channel=new BroadcastChannel("oauth-login-channel");';
 const assertCurrent=(expected:number)=>{if(expected!==epoch)throw Object.assign(new Error('changed'),{code:'AUTH_SESSION_CHANGED'});};
 const transport=createNodeTransport({epoch:()=>epoch,assertCurrent,fetch:async(input,init)=>{
  const url=String(input);requests.push({url,method:init?.method??'GET',headers:new Headers(init?.headers)});
  if(url===callback)return new Response('<script>fetch("/api/token/login?type=0&ticket='+ticket+'");localStorage.setItem("TOKEN",JSON.stringify("only-from-real-response"));</script>',{headers:{'content-type':'text/html; charset=utf-8'}});
  if(new URL(url).pathname==='/api/token/login')return Response.json({code:0,data:{token:'official-response-token-0001'}});
  if(new URL(url).pathname==='/assets/login.js')return new Response(chunked(script),{headers:{'content-type':'application/javascript'}});
  if(new URL(url).pathname==='/login')return new Response('<html>Official login UI<script src="/assets/login.js"></script></html>',{headers:{'content-type':'text/html'}});
  return Response.json({code:0,data:{success:true}});
 }});
 const runtime:any={fetch:transport.fetch,fetchCampusDirect:transport.fetch,http:{jar:transport.jar},epoch:()=>epoch,assertCurrent,status:()=>({authenticated:true}),
  requestXiaodaTicket:async()=>{renewals++;return options.renew?options.renew():ticket;}};
 return {session:createCampusProxySession(runtime,[XIAODA_ORIGIN]),requests,transport,script,get renewals(){return renewals;},rotate(){epoch++;transport.rotate();}};
}

test('Qingxiaoda root login issues a real callback and allows exactly one official API exchange',async t=>{
 const f=fixture();t.after(()=>f.transport.close());
 const login=await f.session.request(rootLogin,documentRequest);
 const navigation=await login.text();
 assert.equal(login.status,200);assert.match(navigation,/http-equiv="refresh"/);assert.ok(navigation.includes(callback));
 assert.equal(f.renewals,1);assert.equal(f.requests.length,0);
 const page=await f.session.request(callback,documentRequest);assert.match(await page.text(),/localStorage\.setItem/);
 const response=await f.session.request(exchange,{headers:{'x-requested-with':'XMLHttpRequest'}});assert.equal((await response.json()).code,0);
 assert.equal(f.requests.filter(request=>new URL(request.url).pathname==='/api/token/login').length,1);
 await assert.rejects(f.session.request(exchange),{code:'GATEWAY_AUTH_REQUIRED'});
 await assert.rejects(f.session.request(callback,documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
});

test('Qingxiaoda business requests preserve the official custom token header',async t=>{
 const f=fixture();t.after(()=>f.transport.close());
 await f.session.request(XIAODA_ORIGIN+'/api/token/getUserInfo',{headers:{token:'browser-user-token-0001',lang:'en'}});
 const headers=f.requests.at(-1)!.headers;
 assert.equal(headers.get('token'),'browser-user-token-0001');assert.equal(headers.get('lang'),'en');
 assert.equal(f.renewals,0);
});

test('Qingxiaoda non-root login retains its UI and official popup channel while replacing only the fixed ITS link',async t=>{
 const f=fixture();t.after(()=>f.transport.close());
 const path='/chat/conversation?view=detail';
 const url=XIAODA_ORIGIN+'/login?redirect='+encodeURIComponent(path);
 const page=await f.session.request(url,documentRequest);assert.match(await page.text(),/Official login UI/);
 assert.equal(f.requests[0]!.url,url);assert.equal(f.renewals,0);
 const script=await f.session.request(XIAODA_ORIGIN+'/assets/login.js');const source=await script.text();
 assert.ok(source.includes(XIAODA_ORIGIN+'/login?redirect=/'));assert.equal(source.includes(XIAODA_IDENTITY_URL),false);
 assert.ok(source.includes('BroadcastChannel("oauth-login-channel")'));assert.match(source,/window\.open\(source,"_blank"\)/);
});

test('Qingxiaoda rejects unknown tickets, invalid callback parameters and unsafe return paths before network access',async t=>{
 const f=fixture();t.after(()=>f.transport.close());
 for(const url of [XIAODA_ORIGIN+'/login.html?ticket=unknown',XIAODA_ORIGIN+'/api/token/login?type=0&ticket=unknown',
   XIAODA_ORIGIN+'/login?redirect='+encodeURIComponent('//evil.example/'),XIAODA_ORIGIN+'/login?redirect='+encodeURIComponent('/api/token/logout')]){
  await assert.rejects(f.session.request(url,documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
 }
 await f.session.request(rootLogin,documentRequest);
 for(const url of [callback+'&ticket=duplicate',exchange+'&type=3',exchange+'&extra=value'])await assert.rejects(f.session.request(url),{code:'GATEWAY_AUTH_REQUIRED'});
 assert.equal(f.requests.length,0);
});

test('Qingxiaoda rejects authenticated endpoint aliases rather than bypassing the ticket witness',async t=>{
 const f=fixture();t.after(()=>f.transport.close());
 for(const path of ['/api/token/%6cogin?ticket=unknown','/%6cogin.html?ticket=unknown','/api/token//login?ticket=unknown','/api/token/login;ignored?ticket=unknown']){
  await assert.rejects(f.session.request(XIAODA_ORIGIN+path,documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
 }
 assert.equal(f.requests.length,0);
});

test('Qingxiaoda entry mutation and account changes cannot mint or redeem stale tickets',async t=>{
 const f=fixture();t.after(()=>f.transport.close());
 await assert.rejects(f.session.request(rootLogin,{method:'POST',body:'invalid'}),{code:'GATEWAY_AUTH_REQUIRED'});
 await assert.rejects(f.session.request(XIAODA_ORIGIN+'/login?redirect=%2Fchat',{method:'POST',body:'invalid'}),{code:'GATEWAY_AUTH_REQUIRED'});
 await f.session.request(rootLogin,documentRequest);f.rotate();
 await assert.rejects(f.session.request(callback,documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
 assert.equal(f.requests.length,0);
 let release!:(value:string)=>void;
 const g=fixture({renew:()=>new Promise(resolve=>{release=resolve;})});t.after(()=>g.transport.close());
 const pending=g.session.request(rootLogin,documentRequest);await new Promise(resolve=>setImmediate(resolve));g.rotate();release(ticket);
 await assert.rejects(pending,{code:'AUTH_SESSION_CHANGED'});assert.equal(g.requests.length,0);
});
