import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar, webvpnWrap } from '@onethu/core';
import { resolveMyhomeLogin } from '../src/node/myhomeAuth.js';

const origin='http://myhome.tsinghua.edu.cn';
const root=webvpnWrap(origin+'/');
const callback=origin+'//?ticket=official-fixture-ticket';
const oauth='https://oauth.tsinghua.edu.cn/lb-auth/lbredirect?scheme=http&host=myhome.tsinghua.edu.cn&port=80&uri=//?ticket=official-fixture-ticket';
const redirect=(location:string,cookie?:string)=>new Response(null,{status:302,headers:{location,...(cookie?{'set-cookie':cookie}:{})}});
const anonymous='<html><title>欢迎光临我们的家园</title><h1>欢迎光临</h1><a href="/web_netweb_user/noLogin.aspx">用户登录</a></html>';
const logged='<html><a href="/web_netweb_user/logout.aspx">退出登录</a><p>欢迎回来</p></html>';
function fixture(options:{already?:boolean;callback?:string|null;badFinal?:boolean;redirect?:string;epochChange?:boolean;concurrentCookie?:boolean}={}){
 let epoch=1,authenticated=options.already===true,callbackCount=0;
 const jar=new MemoryCookieJar();jar.setRaw(new URL('https://info.tsinghua.edu.cn/'),'info_session=keep; Path=/; Secure; HttpOnly');
 jar.setRaw(new URL(origin+'/'),'ASP.NET_SessionId=old; Path=/; HttpOnly');
 const initial=jar.serialize(),calls:string[]=[];
 const runtime={jar,epoch:()=>epoch,assertCurrent(value:number){if(value!==epoch)throw new Error('AUTH_SESSION_CHANGED');},requestCallback:async()=>{
  callbackCount++;if(options.epochChange)epoch++;
  if(options.concurrentCookie)jar.setRaw(new URL(origin+'/'),'ASP.NET_SessionId=newer; Path=/; HttpOnly');
  return options.callback===undefined?callback:options.callback;
 },fetch:async(input:any,init?:RequestInit)=>{
  const url=String(input);calls.push(url);assert.equal(init?.method,'GET');
  const cookie=new Headers(init?.headers).get('cookie')??'';
  assert.doesNotMatch(cookie,/info_session/);
  assert.doesNotMatch(cookie,/ASP.NET_SessionId=old/);
  if(url===root)return new Response(authenticated&&!options.badFinal?logged:anonymous,{headers:{'content-type':'text/html'}});
  if(url===oauth)return redirect(options.redirect??webvpnWrap(callback),'oauth_private=do-not-merge; Path=/; Secure');
  if(url===webvpnWrap(callback)){authenticated=true;return redirect(root,'ASP.NET_SessionId=official; Path=/; HttpOnly');}
  throw new Error('UNEXPECTED_TEST_ROUTE');
 }};
 return {runtime,jar,initial,calls,get callbackCount(){return callbackCount;}};
}

test('MyHome keeps raw callback URI and commits only the authenticated service cookies',async()=>{
 const f=fixture();await resolveMyhomeLogin(f.runtime);
 assert.equal(f.callbackCount,1);assert.ok(f.calls.includes(oauth));
 assert.equal(f.jar.getCookies(new URL(origin+'/')).find(cookie=>cookie.name==='ASP.NET_SessionId')?.value,'official');
 assert.equal(f.jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).find(cookie=>cookie.name==='info_session')?.value,'keep');
 assert.equal(JSON.parse(f.jar.serialize()).some((cookie:any)=>cookie.domain==='oauth.tsinghua.edu.cn'),false);
});

test('MyHome renews even an old logged-in page because it has no reliable account ID',async()=>{
 const f=fixture({already:true});await resolveMyhomeLogin(f.runtime);
 assert.equal(f.callbackCount,1);assert.equal(f.calls[0],oauth);assert.ok(f.calls.includes(root));
});

test('an anonymous welcome page cannot validate MyHome authentication',async()=>{
 const f=fixture({badFinal:true});
 await assert.rejects(resolveMyhomeLogin(f.runtime),{serviceReason:'CAMPUS_SERVICE_MYHOME_VERIFY'});
 assert.equal(f.jar.serialize(),f.initial);
});

test('MyHome refuses unrelated callbacks and redirect origins before fetching them',async()=>{
 for(const invalid of ['https://evil.test/?ticket=secret',origin+'/logout.aspx?ticket=secret',origin+'/?ticket=secret&extra=1',null]){
  const f=fixture({callback:invalid});await assert.rejects(resolveMyhomeLogin(f.runtime),{serviceReason:'CAMPUS_SERVICE_MYHOME_CALLBACK'});
  assert.deepEqual(f.calls,[]);assert.equal(f.jar.serialize(),f.initial);
 }
 for(const destination of ['https://evil.test/','https://id.tsinghua.edu.cn/do/off/ui/auth/login/check','https://webvpn.tsinghua.edu.cn/']){
  const f=fixture({redirect:destination});await assert.rejects(resolveMyhomeLogin(f.runtime));
  assert.equal(f.calls.length,1);assert.equal(f.jar.serialize(),f.initial);
 }
});

test('MyHome cancellation and account changes cannot merge a partial login',async()=>{
 const f=fixture({epochChange:true});await assert.rejects(resolveMyhomeLogin(f.runtime),/AUTH_SESSION_CHANGED/);assert.equal(f.jar.serialize(),f.initial);
 const g=fixture();const controller=new AbortController();controller.abort();
 await assert.rejects(resolveMyhomeLogin(g.runtime,controller.signal),{code:'GATEWAY_CANCELLED'});assert.equal(g.calls.length,0);
});

test('MyHome preserves a newer shared cookie written during its isolated transaction',async()=>{
 const f=fixture({concurrentCookie:true});await resolveMyhomeLogin(f.runtime);
 assert.equal(f.jar.getCookies(new URL(origin+'/')).find(cookie=>cookie.name==='ASP.NET_SessionId')?.value,'newer');
});
