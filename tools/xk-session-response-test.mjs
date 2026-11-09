/** Offline response regressions: real HttpClient + selection readers, no school calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, AuthRequiredError, onAuthRequired } from '../packages/core/src/http.ts';
import { webvpnWrap, decodeUrl } from '../packages/core/src/crypto/webvpn.ts';
import { getSelectedCourses, getXkSelectedFull, syncZhjwxkSession, setZhjwxkNativeClear, setZhjwxkReloginHook } from '../packages/core/src/zhjwxk/client.ts';
import { isXkSessionError } from '../packages/core/src/zhjwxk/html-language.ts';
import { softRecover } from '../apps/desktop/src/lib/reload.ts';
import { sm2 } from 'sm-crypto';

const injection='<script>var __vpn_hostname_data="webvpn.tsinghua.edu.cn";var __vpn_app_hostname_data="fixture";var ignored="accessDenied /do/off/ui/auth/login/checkSingle 电子身份服务系统";</script>';
const entry=injection+'<form><a href="?p_xnxq=2099-2100-1">选课</a></form>';
const headers='<tr class="trr1"><th></th><th>Course Type</th><th>Preference</th><th>Course Code</th><th>Course Name</th><th>Section</th><th>Class Time</th><th>Instructor</th><th>Credits</th></tr>';
const row='<tr class="trr2"><td><input name="p_del_id" value="2099-2100-1;TEST123;01;"></td><td>Required</td><td>1st choice</td><td>TEST123</td><td>Fixture Course</td><td>01</td><td>Tuesday 08:00</td><td>Fixture Teacher</td><td>3</td></tr>';
const selected=injection+'<table>'+headers+row+'</table>';
const empty=injection+'<table>'+headers+'</table>';

function fixture(body,status=200){
 const calls=[];
 const http=new HttpClient({fetch:async(url,init={})=>{
  const logical=new URL(decodeUrl(url)||url);calls.push({url:logical.href,method:init.method??'GET'});
  return new Response(logical.pathname==='/xklogin.do'?entry:body,{status:logical.pathname==='/xklogin.do'?200:status,headers:{'content-type':'text/html;charset=utf-8'}});
 }});http.webVPNEncoder=webvpnWrap;
 return {calls,session:{http,username:'fixture-owner',password:'',fingerprint:'fixture-device'}};
}

test('short and long authenticated WebVPN tables load without cookie dances, re-entry or credential posts',async()=>{
 for(const content of [selected,selected+'<!--'+'.'.repeat(18000)+'-->']){
  for(const load of [getSelectedCourses,getXkSelectedFull]){
   const f=fixture(content),courses=await load(f.session);
   assert.equal(courses.length,1);assert.equal(courses[0].name,'Fixture Course');
   assert.equal(f.calls.length,3);assert(f.calls.every(x=>x.method==='GET'));
   assert.equal(f.calls.filter(x=>x.url.includes('/xklogin.do')).length,1);
   assert(!f.calls.some(x=>x.url.includes('/wengine-vpn/cookie')));
  }
 }
});

test('an authenticated empty table remains an empty result rather than a failed login',async()=>{
 const f=fixture(empty);assert.deepEqual(await getXkSelectedFull(f.session),[]);assert.equal(f.calls.length,3);
});

test('only a successfully established selection entry publishes a credential-free service handback',async()=>{
 const f=fixture(selected),events=[];f.session.onSessionReady=async state=>{events.push(state);};
 await getXkSelectedFull(f.session);await getXkSelectedFull(f.session);
 assert.equal(events.length,1);assert.equal(events[0].identityRenewed,false);assert(Array.isArray(events[0].cookies));
});

test('gateway sync republishes a cached selection session from its verified isolated jar',async()=>{
 const f=fixture(selected),events=[],calls=[];
 const home=injection+'<iframe src="/xk/top.html"></iframe>';
 f.session.http.jar.setRaw(new URL('http://zhjwxk.cic.tsinghua.edu.cn/'),'JSESSIONID=old-native; Path=/');
 f.session.isoFetch=async(url)=>{
  const path=new URL(decodeUrl(url)||url).pathname;calls.push(path);
  return new Response(path==='/xklogin.do'?entry:path==='/xkBks.vxkBksXkbBs.do'?home:selected,
   {headers:{'set-cookie':'JSESSIONID=verified-selection; Path=/'}});
 };
 f.session.onSessionReady=async state=>{events.push(state);};
 await getXkSelectedFull(f.session);
 const loginCalls=calls.filter(path=>path==='/xklogin.do').length;
 events.length=0;
 await syncZhjwxkSession(f.session);
 assert.equal(calls.filter(path=>path==='/xklogin.do').length,loginCalls);
 assert.equal(events.length,1);
 assert.equal(events[0].identityRenewed,false);
 assert(events[0].cookies.some(cookie=>cookie.value==='verified-selection'));
 assert(!events[0].cookies.some(cookie=>cookie.value==='old-native'));
});

test('gateway sync rejects an unrecognized business page before publishing a cached session',async()=>{
 const f=fixture('<p>Temporary maintenance</p>'),events=[];
 f.session.onSessionReady=async state=>{events.push(state);};
 await getXkSelectedFull(f.session);
 events.length=0;
 await assert.rejects(syncZhjwxkSession(f.session),{code:'XK_AUTH_REQUIRED'});
 assert.deepEqual(events,[]);
});

test('gateway sync awaits its required publisher and propagates publication failure',async()=>{
 const f=fixture(entry),events=[];
 f.session.onSessionReady=async state=>{events.push(state);};
 await getXkSelectedFull(f.session);
 events.length=0;
 const failure=new Error('CLI_SHARED_SESSION_UNAVAILABLE');
 let published=false;
 await assert.rejects(syncZhjwxkSession(f.session,async state=>{
  assert.equal(state.identityRenewed,false);
  await Promise.resolve();
  published=true;
  throw failure;
 }),error=>error===failure);
 assert.equal(published,true);
 assert.deepEqual(events,[]);
});

test('actual identity forms, timeout pages and bootstrap shells still require recovery',async()=>{
 for(const page of [injection+'<input name="i_pass">',injection+'<form action="/do/off/ui/auth/login/checkSingle"></form>',injection+'<p>用户登陆超时或访问内容不存在。请重试</p>',injection+'<p>Session has expired</p>',injection+'<p>accessDenied</p>',injection]){
  assert.equal(isXkSessionError(page),true);
 }
 let globalRecovery=0;const stop=onAuthRequired(()=>globalRecovery++);
 const f=fixture(injection+'<input name="i_pass">');
 try{await assert.rejects(getXkSelectedFull(f.session),error=>error instanceof AuthRequiredError&&error.code==='XK_AUTH_REQUIRED');}
 finally{stop();}
 assert.equal(globalRecovery,0);
 assert.equal(await softRecover('xk-boot'),false);
 assert(f.calls.every(x=>x.method==='GET'),'read classification must not submit a password');
});

test('an existing SSO confirmation lands once and never falls through to password login',async()=>{
 const calls=[],events=[];
 const http=new HttpClient({fetch:async(url,init={})=>{
  const logical=new URL(decodeUrl(url)||url);calls.push({path:logical.pathname,method:init.method??'GET',body:String(init.body??'')});
  if(logical.pathname==='/xklogin.do')return new Response('<form action="/do/off/ui/auth/login/checkSingle"></form>');
  if(logical.pathname.endsWith('/checkSingle'))return new Response(null,{status:302,headers:{location:'http://zhjwxk.cic.tsinghua.edu.cn/callback?ticket=fixture'}});
  return new Response(logical.pathname==='/callback'?entry:selected);
 }});http.webVPNEncoder=webvpnWrap;
 const session={http,username:'fixture',password:'',fingerprint:'device',finger3:'existing-trust',onSessionReady:async state=>{events.push(state);}};
 const courses=await getXkSelectedFull(session);
 assert.equal(courses.length,1);assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert(calls.find(c=>c.method==='POST').path.endsWith('/checkSingle'));
 assert.equal(calls.filter(c=>c.path==='/xklogin.do').length,1);
 assert.equal(events.length,1);assert.equal(events[0].identityRenewed,true);assert(Array.isArray(events[0].cookies));
});

test('unused login strings and injected scripts do not invalidate plans or grid-based pages',()=>{
 for(const page of [selected,empty,injection+'<table id="kcTable"></table>',injection+'<script>var gridData1=[];</script>',injection+'<a href="/xkBks.vxkBksXkbBs.do?m=main">选课</a>'])assert.equal(isXkSessionError(page),false);
});

test('HTTP 500 remains a service failure and is never presented as an expired account or empty course list',async()=>{
 const f=fixture(injection+'<h1>HTTP Status 500</h1>',500);
 await assert.rejects(getXkSelectedFull(f.session),error=>error.message==='HTTP 500'&&!(error instanceof AuthRequiredError));
 assert.equal(f.calls.length,1);assert(f.calls.every(x=>x.method==='GET'));
});

test('selection credential recovery strips inherited single-login flags and uses the current device',async()=>{
 const key=sm2.generateKeyPairHex().publicKey,calls=[];
 const http=new HttpClient({fetch:async(url,init={})=>{
  const path=new URL(decodeUrl(url)||url).pathname;calls.push({path,method:init.method??'GET',body:new URLSearchParams(String(init.body??''))});
  if(path==='/xklogin.do')return new Response(`<form><div id="sm2publicKey">${key}</div><input name="i_pass"><input type="hidden" name="singleLogin" value="on"><input type="hidden" name="deviceName" value="old-device"></form>`);
  if(path.endsWith('/check'))return new Response('<p>登录成功</p><a href="http://zhjwxk.cic.tsinghua.edu.cn/callback?ticket=fixture">continue</a>');
  return new Response(path==='/callback'?entry:selected);
 }});http.webVPNEncoder=webvpnWrap;
 const courses=await getXkSelectedFull({http,username:'fixture',password:'fixture-only-not-real',fingerprint:'current-device',finger3:'current-trust'});
 assert.equal(courses.length,1);
 const posts=calls.filter(c=>c.method==='POST');assert.equal(posts.length,1);
 assert.equal(posts[0].body.has('singleLogin'),false);assert.equal(posts[0].body.has('deviceName'),false);
 assert.equal(posts[0].body.get('fingerPrint'),'current-device');assert.equal(posts[0].body.get('fingerGenPrint'),'current-trust');
});

test('the isolated service jar, rather than a stale global selection cookie, supplies the handback',async()=>{
 const f=fixture(selected),events=[];
 f.session.http.jar.setRaw(new URL('http://zhjwxk.cic.tsinghua.edu.cn/'),'JSESSIONID=old-native; Path=/');
 f.session.isoFetch=async(url)=>new Response(new URL(decodeUrl(url)||url).pathname==='/xklogin.do'?entry:selected,{headers:{'set-cookie':'JSESSIONID=completed-isolated; Path=/'}});
 f.session.onSessionReady=async state=>{events.push(state);};
 assert.equal((await getXkSelectedFull(f.session)).length,1);
 assert.equal(events.length,1);assert(events[0].cookies.some(cookie=>cookie.value==='completed-isolated'));
 assert(!events[0].cookies.some(cookie=>cookie.value==='old-native'));
});

test('a stuck confirmation retains identity and unrelated service cookies without a destructive fallback',async()=>{
 let cleared=0,recoveries=0;const calls=[];
 setZhjwxkNativeClear(async()=>{cleared++;});setZhjwxkReloginHook(async()=>{recoveries++;return false;});
 const confirmation='<form action="/do/off/ui/auth/login/checkSingle"></form>';
 const http=new HttpClient({fetch:async(url,init={})=>{
  const path=new URL(decodeUrl(url)||url).pathname;calls.push(path);
  return path.endsWith('/checkSingle')?new Response(null,{status:302,headers:{location:'http://zhjwxk.cic.tsinghua.edu.cn/callback?ticket=fixture'}}):new Response(confirmation);
 }});http.webVPNEncoder=webvpnWrap;
 http.jar.setRaw(new URL('https://id.tsinghua.edu.cn/'),'JSESSIONID=identity; Path=/');
 http.jar.setRaw(new URL('https://learn.tsinghua.edu.cn/'),'JSESSIONID=learn; Path=/');
 const before=http.jar.serialize();
 await assert.rejects(getXkSelectedFull({http,username:'fixture',password:'',fingerprint:'device'}),{code:'XK_AUTH_REQUIRED'});
 assert.equal(recoveries,1);assert.equal(cleared,0);assert.equal(http.jar.serialize(),before);
 assert(!calls.some(path=>path.endsWith('/check')||/login\/form\//.test(path)));
});
