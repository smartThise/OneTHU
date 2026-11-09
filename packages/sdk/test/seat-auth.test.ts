import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar, webvpnWrap } from '@onethu/core';
import { resolveSeatLogin } from '../src/node/seatAuth.js';

const origin='https://seat.lib.tsinghua.edu.cn';
const root=webvpnWrap(origin+'/home/web/f_second');
const owner='20250001';
const logged=(user=owner)=>'<script>window.ska.access_token="official-token-123456789";window.ska.userid="'+user+'";</script>';
const anonymous='<script>var hasTokenField="access_token";window.ska.access_token="";window.ska.userid="";</script><a>登录</a>';
const redirect=(location:string,cookie?:string)=>new Response(null,{status:302,headers:{location,...(cookie?{'set-cookie':cookie}:{})}});
function fixture(options:{beforeUser?:string;afterUser?:string;alias?:string;scheme?:'http'|'https';callback?:string|null;epochChange?:boolean;redirect?:string;longPage?:boolean}={}){
 let epoch=1,authenticated=false,callbacks=0;
 const callback=(options.scheme??'https')+'://seat.lib.tsinghua.edu.cn/api/id_tsinghua_callback?ticket=official-fixture-ticket';
 const oauth='https://oauth.tsinghua.edu.cn/lb-auth/lbredirect?scheme='+(options.scheme??'https')+'&host=seat.lib.tsinghua.edu.cn&port='+(options.scheme==='http'?'80':'443')+'&uri=/api/id_tsinghua_callback?ticket=official-fixture-ticket';
 const jar=new MemoryCookieJar();jar.setRaw(new URL(origin),'seat_session=old; Path=/; Secure; HttpOnly');
 jar.setRaw(new URL('https://info.tsinghua.edu.cn/'),'info_session=keep; Path=/; Secure; HttpOnly');
 const initial=jar.serialize(),calls:string[]=[];
 const runtime={jar,expectedAccount:options.alias??owner,epoch:()=>epoch,assertCurrent(value:number){if(value!==epoch)throw new Error('AUTH_SESSION_CHANGED');},requestCallback:async()=>{callbacks++;if(options.epochChange)epoch++;return options.callback===undefined?callback:options.callback;},fetch:async(input:any,init?:RequestInit)=>{
  const url=String(input);calls.push(url);assert.equal(init?.method,'GET');assert.doesNotMatch(new Headers(init?.headers).get('cookie')??'',/info_session/);
  if(url!==root)assert.doesNotMatch(new Headers(init?.headers).get('cookie')??'',/seat_session=old/);
  if(url===root){
   const page=options.longPage?'a'.repeat(600*1024):authenticated?logged(options.afterUser??owner):options.beforeUser?logged(options.beforeUser):anonymous;
   return new Response(page,{headers:{'content-type':'text/html'}});
  }
  if(url===oauth)return redirect(options.redirect??webvpnWrap(callback),'oauth_private=temporary; Path=/; Secure');
  if(url===webvpnWrap(callback)){authenticated=true;return redirect(root,'seat_session=verified; Path=/; Secure; HttpOnly');}
  throw new Error('UNEXPECTED_TEST_ROUTE');
 }};
 return {runtime,jar,initial,calls,oauth,get callbacks(){return callbacks;}};
}

test('Seat exchanges a real callback and verifies the current account before merging',async()=>{
 for(const scheme of ['http','https'] as const){
  const f=fixture({scheme});await resolveSeatLogin(f.runtime);
  assert.equal(f.callbacks,1);assert.ok(f.calls.includes(f.oauth));
  assert.equal(f.jar.getCookies(new URL(origin)).find(cookie=>cookie.name==='seat_session')?.value,'verified');
  assert.equal(f.jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).find(cookie=>cookie.name==='info_session')?.value,'keep');
  assert.equal(JSON.parse(f.jar.serialize()).some((cookie:any)=>cookie.domain==='oauth.tsinghua.edu.cn'),false);
 }
});

test('Seat reuses only a parsed nonempty session belonging to the known numeric account',async()=>{
 const f=fixture({beforeUser:owner});await resolveSeatLogin(f.runtime);
 assert.equal(f.callbacks,0);assert.deepEqual(f.calls,[root]);
 const alias=fixture({beforeUser:owner,alias:'named-account'});await resolveSeatLogin(alias.runtime);
 assert.equal(alias.callbacks,1);
});

test('Seat rejects a valid-looking token without a user and another numeric account',async()=>{
 for(const user of ['', '20250002']){
  const f=fixture({afterUser:user});await assert.rejects(resolveSeatLogin(f.runtime),{serviceReason:'CAMPUS_SERVICE_SEAT_VERIFY'});
  assert.equal(f.jar.serialize(),f.initial);
 }
 const f=fixture({beforeUser:'20250002'});await resolveSeatLogin(f.runtime);assert.equal(f.callbacks,1);
});

test('Seat refuses unrelated callbacks and routes before transmitting its session',async()=>{
 const f=fixture({callback:'https://evil.test/?ticket=secret'});await assert.rejects(resolveSeatLogin(f.runtime),{serviceReason:'CAMPUS_SERVICE_SEAT_CALLBACK'});assert.equal(f.jar.serialize(),f.initial);
 const g=fixture({redirect:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/check'});await assert.rejects(resolveSeatLogin(g.runtime),{serviceReason:'CAMPUS_SERVICE_SEAT_ROUTE'});assert.equal(g.jar.serialize(),g.initial);assert.equal(g.calls.length,2);
});

test('Seat stops on account changes, cancellation and oversized pages without a merge',async()=>{
 const f=fixture({epochChange:true});await assert.rejects(resolveSeatLogin(f.runtime),/AUTH_SESSION_CHANGED/);assert.equal(f.jar.serialize(),f.initial);
 const g=fixture();const controller=new AbortController();controller.abort();await assert.rejects(resolveSeatLogin(g.runtime,controller.signal),{code:'GATEWAY_CANCELLED'});assert.equal(g.calls.length,0);
 const large=fixture({longPage:true});await assert.rejects(resolveSeatLogin(large.runtime),{code:'NETWORK_RESPONSE_TOO_LARGE',serviceReason:'CAMPUS_SERVICE_SEAT_PROBE'});assert.equal(large.callbacks,0);assert.equal(large.jar.serialize(),large.initial);
});

test('Seat clears only its cloned service cookies when renewing a stale account',async()=>{
 const f=fixture({beforeUser:'20250002'});
 const prefix=new URL(webvpnWrap(origin+'/')).pathname;
 f.jar.setRaw(new URL(origin+'/'),'retired_session=old; Path=/; Secure; HttpOnly');
 f.jar.setRaw(new URL('https://webvpn.tsinghua.edu.cn'+prefix),'retired_mirror=old; Path='+prefix+'; Secure; HttpOnly');
 f.jar.setRaw(new URL('https://webvpn.tsinghua.edu.cn/'),'wengine_vpn_ticket=keep; Path=/; Secure; HttpOnly');
 await resolveSeatLogin(f.runtime);
 const cookies=JSON.parse(f.jar.serialize());
 assert.equal(cookies.some((cookie:any)=>cookie.name==='retired_session'||cookie.name==='retired_mirror'),false);
 assert.equal(cookies.find((cookie:any)=>cookie.name==='wengine_vpn_ticket')?.value,'keep');
 assert.equal(cookies.find((cookie:any)=>cookie.name==='info_session')?.value,'keep');
});
