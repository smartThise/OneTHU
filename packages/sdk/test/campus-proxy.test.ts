import test from 'node:test';
import assert from 'node:assert/strict';
import { webvpnWrap } from '@onethu/core';
import { createNodeTransport } from '../src/node/transport.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';
import { GITLAB_ORIGIN, withSecureCampusOrigins } from '@onethu/gateway/routes';

const origins=['https://learn.tsinghua.edu.cn','https://info.tsinghua.edu.cn','https://id.tsinghua.edu.cn'];
function fixture(fetch:any,allowed=origins,ensureCampusService?: (origin:string)=>Promise<void>,upstreamOrigins?:Readonly<Record<string,string>>){
  let epoch=1,ready=true;
  const assertCurrent=(value:number)=>{if(value!==epoch)throw Object.assign(new Error('AUTH_SESSION_CHANGED'),{code:'AUTH_SESSION_CHANGED'});};
  const transport=createNodeTransport({fetch,epoch:()=>epoch,assertCurrent});
  const runtime={fetch:transport.fetch,fetchCampusDirect:transport.fetch,epoch:()=>epoch,assertCurrent,status:()=>({authenticated:ready,state:ready?'ready':'idle',epoch}),http:{jar:transport.jar},ensureCampusService};
  return {session:createCampusProxySession(runtime as any,allowed,upstreamOrigins),transport,bump(){epoch++;transport.rotate();},logout(){ready=false;epoch++;transport.rotate();}};
}
function chunks(bytes:Uint8Array,size=31){let offset=0;return new ReadableStream<Uint8Array>({pull(target){if(offset===bytes.length){target.close();return;}target.enqueue(bytes.subarray(offset,offset+size));offset=Math.min(offset+size,bytes.length);}});}

test('official Info and Learn entry links reuse the live account and preserve the school role redirect',async t=>{
 let fetches=0;
 const infoEntry=origins[1]+'/f/login',learnEntry=origins[0]+'/f/redirectByStuOrTeacher';
 for(const role of ['student','teacher']){
  const home=origins[0]+'/f/wlxt/index/course/'+role+'/';
  const f=fixture(async(url:string)=>{
   fetches++;assert.equal(url,webvpnWrap(learnEntry));
   return new Response(null,{status:302,headers:{location:webvpnWrap(home)}});
  });
  t.after(()=>f.transport.close());
  for(const method of ['GET','HEAD']){
   const info=await f.session.request(infoEntry,{method});
   assert.equal(info.status,302);
   assert.equal(info.headers.get('location'),origins[1]+'/f/info/gxfw_fg/common/index');
   const learn=await f.session.request(learnEntry,{method});
   assert.equal(learn.status,302);assert.equal(learn.headers.get('location'),home);
  }
  for(const url of [infoEntry,learnEntry]){
   await assert.rejects(f.session.request(url,{method:'POST',body:'i_pass=must-not-send'}),{code:'GATEWAY_AUTH_REQUIRED'});
   await assert.rejects(f.session.request(url+'?target=elsewhere'),{code:'GATEWAY_AUTH_REQUIRED'});
   await assert.rejects(f.session.request(url.replace('/f/','/f/%2f')),{code:'GATEWAY_AUTH_REQUIRED'});
  }
 }
 assert.equal(fetches,4);
 for(const location of ['https://id.tsinghua.edu.cn/login','https://outside.test/','https://learn.tsinghua.edu.cn/f/j_spring_security_logout']){
  const f=fixture(async()=>new Response(null,{status:302,headers:{location}}));t.after(()=>f.transport.close());
  await assert.rejects(f.session.request(learnEntry),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
 }
});

test('a direct service keeps a browser token obtained while bypassed isolated from the shared account',async t=>{
 const site='https://madmodel.cs.tsinghua.edu.cn',token='browser-owned-token-12345678';
 const transport=createNodeTransport({fetch:async()=>{throw new Error('shared transport must stay unused');},epoch:()=>1,assertCurrent(){}});
 t.after(()=>transport.close());
 transport.jar.setRaw(new URL(site),'sid=shared-cookie; Path=/; Secure; HttpOnly');
 let requests=0;
 const runtime:any={
  epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:transport.jar},fetch:transport.fetch,
  resolveCampusPortal:async()=>({url:site+'/',origin:site,upstreamOrigin:site,transport:'direct'}),
  fetchWithoutSession:async(url:string,init:RequestInit)=>{
   requests++;assert.equal(url,site+'/model-api/auth-login');
   const headers=new Headers(init.headers);
   assert.equal(headers.get('authorization'),'Bearer '+token);
   assert.equal(headers.has('cookie'),false);
   return Response.json({success:true},{headers:{'set-cookie':'sid=browser-response; Path=/'}});
  },
 };
 const proxy=createCampusProxySession(runtime,origins);
 await proxy.request(origins[1]+'/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect?yyfwid=00112233445566778899aabbccddeeff');
 const target=site+'/model-api/auth-login',before=transport.jar.serialize();
 assert.equal(proxy.authorizeIndependentBrowserCredential(target,'authorization','Bearer '+token),true);
 assert.equal(proxy.authorizeIndependentBrowserCredential('https://outside.test/','authorization','Bearer '+token),false);
 const response=await proxy.requestIndependent(target,{headers:{authorization:'Bearer '+token,cookie:'must-be-removed'}});
 assert.equal((await response.json()).success,true);
 assert.equal(transport.jar.serialize(),before);
 assert.equal(proxy.authorizeBrowserCredential(target,'authorization','Bearer '+token),false);
 assert.equal(requests,1);
});

test('reopening MadModel obtains an official ticket once and prepares another after a route toggle',async t=>{
 const site='https://madmodel.cs.tsinghua.edu.cn';
 let issued=0,requests=0;
 const transport=createNodeTransport({fetch:async()=>{requests++;return new Response('official application');},epoch:()=>1,assertCurrent(){}});
 t.after(()=>transport.close());
 const runtime:any={
  epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:transport.jar},fetch:transport.fetch,fetchCampusDirect:transport.fetch,
  resolveCampusPortal:async()=>{throw new Error('unavailable portal');},
  requestMadmodelTicket:async()=>{issued++;return 'official-ticket-123456';},
 };
 const proxy=createCampusProxySession(runtime,[site]);
 const init={headers:{'sec-fetch-dest':'document'}};
 const first=await proxy.request(site+'/',init);
 assert.match(await first.text(),/http-equiv="refresh"/);
 assert.equal(issued,1);assert.equal(requests,0);
 assert.equal(await (await proxy.request(site+'/',init)).text(),'official application');
 proxy.prepareBrowserSite('madmodel.cs.tsinghua.edu.cn');
 assert.match(await (await proxy.request(site+'/',init)).text(),/authLogin\?ticket=official-ticket-123456/);
 assert.equal(issued,2);
});

test('GitLab only renews document navigation, then retries the original URL without exposing the ticket',async t=>{
 const project=GITLAB_ORIGIN+'/team/project/-/issues?state=opened';
 const calls:string[]=[];
 let renewals=0;
 const f=fixture(async(url:string,init:RequestInit)=>{
  calls.push(url);
  const cookie=new Headers(init.headers).get('cookie');
  return cookie==='_gitlab_session=fresh-ticket'
   ? new Response('project',{headers:{'set-cookie':'_gitlab_session=fresh-ticket; Secure; HttpOnly; Path=/'}})
   : new Response(null,{status:302,headers:{location:'/users/sign_in'}});
 },[GITLAB_ORIGIN],async origin=>{
  assert.equal(origin,GITLAB_ORIGIN);renewals++;
  f.transport.jar.setRaw(new URL(origin),'_gitlab_session=fresh-ticket; Secure; HttpOnly; Path=/');
 });
 t.after(()=>f.transport.close());
 for(const [target,init] of [
  [project,{method:'POST',body:'operation'}],
  [GITLAB_ORIGIN+'/api/v4/user',{headers:{'sec-fetch-dest':'document'}}],
  [project,{headers:{'sec-fetch-dest':'empty'}}],
 ] as const){
  await assert.rejects(f.session.request(target,init),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
 }
 assert.equal(renewals,0);
 for(const path of ['/users/auth/thuid/callback','/users/%73ign_out','/users/sign_in']){
  await assert.rejects(f.session.request(GITLAB_ORIGIN+path),{code:'GATEWAY_AUTH_REQUIRED'});
 }
 assert.equal(calls.length,3);
 const response=await f.session.request(project,{headers:{'sec-fetch-dest':'document'}});
 assert.equal(await response.text(),'project');
 assert.equal(response.headers.has('set-cookie'),false);
 assert.deepEqual(f.session.browserCookies(project),[]);
 assert.deepEqual(calls.slice(3),[project,project]);
 assert.equal(renewals,1);
});

test('legacy JSP JavaScript MIME still removes the WebVPN envelope and preserves charset',async()=>{
 const f=fixture(async()=>new Response('vpn_eval((function(){\nfunction validate(){return true;}\n}\n).toString().slice(12, -2),"");',{headers:{'content-type':'javascript/x-javascript; charset=GBK'}}));
 const response=await f.session.request(origins[1]+'/scripts/validator.jsp?vpn-7');
 assert.equal(response.headers.get('content-type'),'application/javascript; charset=GBK');
 assert.equal(await response.text(),'function validate(){return true;}');f.transport.close();
});

test('restored Info public CSRF UUID survives missing Cookie-body attributes without exposing explicit HttpOnly cookies',()=>{
  const f=fixture(async()=>new Response('unused'));
  const nonce='12345678-1234-1234-1234-123456789abc';
  f.transport.jar.setRaw(new URL(origins[1]+'/'),`XSRF-TOKEN=${nonce}; Path=/; Secure`,{httpOnly:null});
  const before=f.transport.jar.serialize();
  assert.deepEqual(f.session.browserCookies(origins[1]+'/'),[{name:'XSRF-TOKEN',value:nonce}]);
  assert.equal(f.transport.jar.serialize(),before,'public projection never changes the authority cookie attributes');
  f.transport.jar.setRaw(new URL(origins[1]+'/'),`XSRF-TOKEN=${nonce}; Path=/; Secure; HttpOnly`);
  assert.deepEqual(f.session.browserCookies(origins[1]+'/'),[]);f.transport.close();
});

test('Info archive documents prepare their public nonce before HTML, cached HTML and the first script',async t=>{
 const origin='https://info2021.tsinghua.edu.cn',path='/f/info/xxfb_fg/xnzx/template/detail?xxid=00112233445566778899aabbccddeeff';
 const old='11111111-1111-1111-1111-111111111111',fresh='22222222-2222-2222-2222-222222222222';
 for(const status of [200,304])for(const metadata of [{ 'sec-fetch-dest':'document' },{accept:'text/html'}]){
  let mirrored=0;
  const f=fixture(async(url:string,init:RequestInit)=>{
   if(url.includes('/wengine-vpn/cookie?')){
    mirrored++;assert.equal(new URL(url).searchParams.get('host'),'info2021.tsinghua.edu.cn');
    return new Response('XSRF-TOKEN='+fresh+'; currentRequestUrl=fixture');
   }
   if(url.includes('/jquery.js'))assert(new Headers(init.headers).get('cookie')?.includes('XSRF-TOKEN='+fresh));
   return new Response(status===304?null:'<html>'+'.'.repeat(5000)+'<script src="/jquery.js"></script></html>',{status,headers:status===200?{'content-type':'text/html'}:{}});
  },[origin]);t.after(()=>f.transport.close());
  const physical=new URL(webvpnWrap(origin+'/'));
  f.transport.jar.setRaw(physical,'XSRF-TOKEN='+old+'; Path='+physical.pathname+'; Secure');
  const response=await f.session.request(origin+path,{headers:metadata});
  assert.equal(mirrored,1);
  assert.deepEqual(f.session.browserCookies(origin+path),[{name:'XSRF-TOKEN',value:fresh}]);
  assert.equal(f.transport.jar.getCookies(physical).find(cookie=>cookie.name==='XSRF-TOKEN')?.value,fresh);
  await response.text();
  await(await f.session.request(origin+'/jquery.js',{headers:{'sec-fetch-dest':'script'}})).text();
  assert.equal(mirrored,1,'assets reuse the prepared nonce without another mirror request');
 }
});

test('Info archive preparation preserves root and path-specific HttpOnly across logical and physical scopes',async t=>{
 const origin='https://info2021.tsinghua.edu.cn',path='/f/info/xxfb_fg/bmxx/departmentalView?code=fixture';
 const nonce='22222222-2222-2222-2222-222222222222';
 for(const scope of [origin+'/',origin+'/f/info',webvpnWrap(origin+'/'),webvpnWrap(origin+'/f/info'),webvpnWrap('http://info2021.tsinghua.edu.cn/f/info')]){
  const f=fixture(async(url:string)=>url.includes('/wengine-vpn/cookie?')
   ?new Response('XSRF-TOKEN='+nonce+'; JSESSIONID=fixture-private; currentRequestUrl=fixture')
   :new Response('<html>'+'.'.repeat(5000)+'</html>',{headers:{'content-type':'text/html'}}),[origin]);t.after(()=>f.transport.close());
  const target=new URL(scope);
  f.transport.jar.setRaw(target,'XSRF-TOKEN='+nonce+'; Path='+target.pathname+'; Secure; HttpOnly');
  await(await f.session.request(origin+path,{headers:{'sec-fetch-dest':'document'}})).text();
  assert.deepEqual(f.session.browserCookies(origin+path),[]);
  assert(f.transport.jar.getCookies(new URL(origin+'/')).find(cookie=>cookie.name==='XSRF-TOKEN')?.httpOnly);
 }
});

test('Info archive HTTPS facades publish the renewed HTTP upstream nonce before a first script',async t=>{
 const origin='https://info2021.tsinghua.edu.cn',upstream='http://info2021.tsinghua.edu.cn';
 const old='11111111-1111-1111-1111-111111111111',fresh='22222222-2222-2222-2222-222222222222';
 const f=fixture(async(url:string,init:RequestInit)=>{
  if(url.includes('/wengine-vpn/cookie?')){
   assert.equal(new URL(url).searchParams.get('scheme'),'http');
   return new Response('XSRF-TOKEN='+fresh+'; currentRequestUrl=fixture');
  }
  if(url.includes('/jquery.js')){
   const cookie=new Headers(init.headers).get('cookie')??'';
   assert(cookie.includes('XSRF-TOKEN='+fresh));assert(!cookie.includes(old));
  }
  return new Response('<html>'+'.'.repeat(5000)+'</html>',{headers:{'content-type':'text/html'}});
 },[origin],undefined,{[origin]:upstream});t.after(()=>f.transport.close());
 for(const scheme of [origin,upstream]){
  const physical=new URL(webvpnWrap(scheme+'/'));
  f.transport.jar.setRaw(physical,'XSRF-TOKEN='+old+'; Path='+physical.pathname+'; Secure');
 }
 await(await f.session.request(origin+'/f/info/xxfb_fg/xnzx/template/more',{headers:{'sec-fetch-dest':'document'}})).text();
 assert.deepEqual(f.session.browserCookies(origin+'/f/info/xxfb_fg/xnzx/template/more'),[{name:'XSRF-TOKEN',value:fresh}]);
 await(await f.session.request(origin+'/jquery.js',{headers:{'sec-fetch-dest':'script'}})).text();
});

test('Info archive cookie preparation is restricted to approved document requests',async t=>{
 const archive='https://info2021.tsinghua.edu.cn',path='/f/info/xxfb_fg/bmxx/departmentalView';
 for(const [origin,requested,method,headers,status] of [
  [archive,'/other','GET',{'sec-fetch-dest':'document'},200],
  [archive,'/f/redirectLoginUrl','GET',{'sec-fetch-dest':'document'},200],
  [archive,'/b/info/xxfb_fg/xnzx/template/detail','GET',{'sec-fetch-dest':'document'},200],
  [archive,path,'GET',{'sec-fetch-dest':'script'},200],
  [archive,path,'GET',{'sec-fetch-dest':'iframe'},200],
  [archive,path,'GET',{},200],
  [archive,path,'POST',{'sec-fetch-dest':'document'},200],
  [archive,path,'GET',{'sec-fetch-dest':'document'},403],
  ['https://info.tsinghua.edu.cn',path,'GET',{'sec-fetch-dest':'document'},200],
  ['https://other.tsinghua.edu.cn',path,'GET',{'sec-fetch-dest':'document'},200],
 ] as const){
  let mirrored=0;
  const f=fixture(async(url:string)=>{if(url.includes('/wengine-vpn/cookie?'))mirrored++;return new Response('<html>fixture</html>',{status,headers:{'content-type':'text/html'}});},[origin]);t.after(()=>f.transport.close());
  await(await f.session.request(origin+requested,{method,headers})).text();
  assert.equal(mirrored,0);
 }
});

test('account changes during the Info archive mirror cannot publish its nonce',async t=>{
 const origin='https://info2021.tsinghua.edu.cn';
 let release!:(response:Response)=>void,started!:()=>void;
 const pending=new Promise<void>(resolve=>{started=resolve;});
 const f=fixture(async(url:string)=>{
  if(url.includes('/wengine-vpn/cookie?')){started();return new Promise<Response>(resolve=>{release=resolve;});}
  return new Response('<html>'+'.'.repeat(5000)+'</html>',{headers:{'content-type':'text/html'}});
 },[origin]);t.after(()=>f.transport.close());
 const request=f.session.request(origin+'/f/info/xxfb_fg/bmxx/departmentalView',{headers:{'sec-fetch-dest':'document'}});
 await pending;f.bump();release(new Response('XSRF-TOKEN=22222222-2222-2222-2222-222222222222'));
 await assert.rejects(request,{code:'AUTH_SESSION_CHANGED'});
 assert.equal(f.transport.jar.getCookies(new URL(origin+'/')).some(cookie=>cookie.name==='XSRF-TOKEN'),false);
});

test('cancellation or account change while reading a cookie mirror cannot commit its body',async()=>{
 const origin='https://info2021.tsinghua.edu.cn';
 for(const change of ['cancel','account']){
  const jar=new Map();
  let epoch=1,release!:()=>void,started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const finish=new Promise<void>(resolve=>{release=resolve;});
  const controller=new AbortController();
  const runtime={epoch:()=>epoch,status:()=>({authenticated:true}),assertCurrent(value:number){if(value!==epoch)throw Object.assign(new Error('changed'),{code:'AUTH_SESSION_CHANGED'});},
   http:{jar:{getCookies(){return [];},setRaw(url:URL,pair:string){jar.set(url.href,pair);}}},
   async fetch(url:string){
    if(url.includes('/wengine-vpn/cookie?')){
     let first=true;
     return new Response(new ReadableStream({async pull(stream){
      if(first){first=false;stream.enqueue(new TextEncoder().encode('XSRF-TOKEN='));started();return;}
      await finish;stream.enqueue(new TextEncoder().encode('22222222-2222-2222-2222-222222222222'));stream.close();
     }}));
    }
    return new Response('<html>'+'.'.repeat(5000)+'</html>',{headers:{'content-type':'text/html'}});
   }};
  const proxy=createCampusProxySession(runtime as any,[origin]);
  const request=proxy.request(origin+'/f/info/xxfb_fg/bmxx/departmentalView',{signal:controller.signal,headers:{'sec-fetch-dest':'document'}});
  await ready;
  if(change==='cancel')controller.abort();else epoch++;
  release();
  await assert.rejects(request,{code:change==='cancel'?'GATEWAY_CANCELLED':'AUTH_SESSION_CHANGED'});
  assert.equal(jar.size,0);
 }
});

test('adapter rejects invalid targets before fetching or losing a nondefault port',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return new Response('no');});
  for(const target of ['https://outside.test/','https://learn.tsinghua.edu.cn:8443/','https://user:pass@learn.tsinghua.edu.cn/','https://127.0.0.1/','https://learn.tsinghua.edu.cn/#fragment'])await assert.rejects(f.session.request(target),{code:'GATEWAY_TARGET_REJECTED'});
  await assert.rejects(f.session.request('https://webvpn.tsinghua.edu.cn/'),{code:'GATEWAY_AUTH_REQUIRED'});
  assert.equal(calls,0);f.transport.close();
});

test('browser identity changes and ticket exchanges never reach upstream or mutate the live jar',async()=>{
 let calls=0;const allowed=[...origins,'https://oauth.tsinghua.edu.cn','https://zhjwxk.cic.tsinghua.edu.cn'];
 const f=fixture(async()=>{calls++;return new Response('unexpected',{headers:{'set-cookie':'CASTGC=replaced; Path=/; Secure'}});},allowed);
 f.transport.jar.setRaw(new URL(origins[2]+'/'),'CASTGC=current-owner; Path=/; Secure; HttpOnly');
 const before=f.transport.jar.serialize();
 for(const url of [origins[2]+'/do/off/ui/auth/login/check','https://oauth.tsinghua.edu.cn/logout',origins[0]+'/f/j_spring_security_logout',origins[0]+'/f/%6a_spring_security_check;jsessionid=fixture',origins[0]+'/b/j_spring_security_thauth_roaming_entry?ticket=fixture',origins[1]+'/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect?ticket=fixture','https://zhjwxk.cic.tsinghua.edu.cn/j_acegi_formlogin_xsxk.do']){
  for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE'])await assert.rejects(f.session.request(url,{method,...(['GET','HEAD'].includes(method)?{}:{body:'ticket=fixture'})}),{code:'GATEWAY_AUTH_REQUIRED'});
 }
 await assert.rejects(f.session.request(origins[1]+'/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect',{method:'POST',body:'ticket=fixture'}),{code:'GATEWAY_AUTH_REQUIRED'});
 assert.equal(calls,0);assert.equal(f.transport.jar.serialize(),before);f.transport.close();
});

test('browser cookie projection exposes only each approved application root non-HttpOnly XSRF token and preserves encoding',()=>{
  const f=fixture(async()=>new Response('unused'));
  const learn=new URL(origins[0]+'/');
  for(const line of ['XSRF-TOKEN=fixture%2Fcsrf%3D; Path=/; Secure','JSESSIONID=authentication-secret; Path=/; Secure; HttpOnly','sid=other-secret; Path=/; Secure','x-csrf=not-approved; Path=/; Secure'])f.transport.jar.setRaw(learn,line);
  f.transport.jar.setRaw(new URL(origins[1]+'/'),'XSRF-TOKEN=other-origin-secret; Path=/; Secure');
  assert.deepEqual(f.session.browserCookies(origins[0]+'/courses'),[{name:'XSRF-TOKEN',value:'fixture%2Fcsrf%3D'}]);
  assert.deepEqual(f.session.browserCookies(origins[1]+'/'),[{name:'XSRF-TOKEN',value:'other-origin-secret'}]);
  assert.throws(()=>f.session.browserCookies(origins[2]+'/'),{code:'GATEWAY_AUTH_REQUIRED'});
  assert.throws(()=>f.session.browserCookies('https://outside.test/'),{code:'GATEWAY_TARGET_REJECTED'});
  const physical=new URL(webvpnWrap(origins[0]+'/'));
  f.transport.jar.setRaw(new URL('https://webvpn.tsinghua.edu.cn/'),'XSRF-TOKEN=global-must-stay-private; Path=/; Secure');
  f.transport.jar.setRaw(new URL(webvpnWrap(origins[1]+'/')),'XSRF-TOKEN=other-app-secret; Path='+new URL(webvpnWrap(origins[1]+'/')).pathname+'; Secure');
  assert.deepEqual(f.session.browserCookies(origins[1]+'/'),[{name:'XSRF-TOKEN',value:'other-app-secret'}]);
  assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[{name:'XSRF-TOKEN',value:'fixture%2Fcsrf%3D'}]);
  f.transport.jar.setRaw(physical,'XSRF-TOKEN=physical%2Fcurrent; Path='+physical.pathname+'; Secure');
  assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[{name:'XSRF-TOKEN',value:'physical%2Fcurrent'}]);
  f.transport.jar.setRaw(physical,'XSRF-TOKEN=physical-httponly-secret; Path='+physical.pathname+'; Secure; HttpOnly');
  assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[],'a hidden newer physical token cannot fall back to an older visible logical copy');
  f.transport.jar.setRaw(learn,'XSRF-TOKEN=httponly-secret; Path=/; Secure; HttpOnly');
  assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[]);
  const persisted=JSON.parse(f.transport.jar.serialize());assert.equal(persisted.find((cookie:any)=>cookie.name==='XSRF-TOKEN'&&cookie.domain===learn.hostname).httpOnly,true);
  for(const cookie of persisted)delete cookie.httpOnly;f.transport.jar.hydrate(JSON.stringify(persisted));
  assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[],'legacy unknown HttpOnly is not public');
  f.logout();assert.throws(()=>f.session.browserCookies(origins[0]+'/'),{code:'GATEWAY_AUTH_REQUIRED'});f.transport.close();
});

test('known Learn course HTML supplies its current public nonce before headers without changing the private jar',async()=>{
 const old='11111111-1111-1111-1111-111111111111',current='22222222-2222-2222-2222-222222222222';
 const wrapped=webvpnWrap(origins[0]+`/b/wlxt/xt/avatar?_csrf=${current}`);
 const html=Buffer.concat([Buffer.from(`<html><script>const avatar='${wrapped}';</script>`),Buffer.from([0xd6,0xd0]),Buffer.from('</html>')]);
 const f=fixture(async()=>new Response(chunks(html,13),{headers:{'content-type':'text/html; charset=gbk'}}));
 const physical=new URL(webvpnWrap(origins[0]+'/'));f.transport.jar.setRaw(physical,`XSRF-TOKEN=${old}; Path=${physical.pathname}; Secure`);
 const before=f.transport.jar.serialize(),response=await f.session.request(origins[0]+'/f/wlxt/index/course/student/');
 assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[{name:'XSRF-TOKEN',value:current}],'header projection must be ready before the body is consumed');
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(html.toString('latin1').replace(wrapped,origins[0]+`/b/wlxt/xt/avatar?_csrf=${current}`),'latin1'));assert.equal(f.transport.jar.serialize(),before);
 await(await f.session.request(origins[0]+'/res/app.js')).text();
 assert.deepEqual(f.session.browserCookies(origins[0]+'/res/app.js'),[{name:'XSRF-TOKEN',value:current}],'assets cannot restore the stale mirror nonce');
 f.bump();assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[{name:'XSRF-TOKEN',value:old}],'a new account epoch cannot reuse the prior public nonce');f.transport.close();
});

test('public Learn nonce extraction rejects arbitrary pages, foreign links, ambiguity and tokens beyond the bounded prefix',async()=>{
 const old='11111111-1111-1111-1111-111111111111',a='22222222-2222-2222-2222-222222222222',b='33333333-3333-3333-3333-333333333333';
 for(const [path,html] of [
  ['/files/uploaded.html',`<a href="/b/wlxt/avatar?_csrf=${a}">x</a>`],
  ['/f/wlxt/index/course/student/',`<a href="https://outside.test/b/wlxt/avatar?_csrf=${a}">x</a>`],
  ['/f/wlxt/index/course/student/',`<a href="/b/wlxt/avatar?_csrf=${a}">a</a><a href="/b/kc/other?_csrf=${b}">b</a>`],
  ['/f/wlxt/index/course/student/','.'.repeat(65536)+`<a href="/b/wlxt/avatar?_csrf=${a}">x</a>`],
 ]){
  const f=fixture(async()=>new Response(chunks(Buffer.from(html!),31),{headers:{'content-type':'text/html'}}));
  f.transport.jar.setRaw(new URL(origins[0]+'/'),`XSRF-TOKEN=${old}; Path=/; Secure`);
  const response=await f.session.request(origins[0]+path);assert.equal(await response.text(),html);
  assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[{name:'XSRF-TOKEN',value:old}]);f.transport.close();
 }
});

test('adapter uses the authoritative jar and wraps campus hosts while keeping browser identity controls private',async()=>{
  const seen:{url:string;init:RequestInit}[]=[];
  const f=fixture(async(url:string,init:RequestInit)=>{seen.push({url,init});return new Response('ok');});
  f.transport.jar.setRaw(new URL(origins[0]!), 'JSESSIONID=shared-only; Path=/; Secure');
  const result=await f.session.request(origins[0]+'/a',{headers:{cookie:'injected=bad',authorization:'Bearer bad',origin:origins[0]!,referer:origins[0]+'/before'}});
  assert.equal(await result.text(),'ok');assert.equal(seen[0]!.url,webvpnWrap(origins[0]+'/a'));
  const headers=new Headers(seen[0]!.init.headers);assert.equal(headers.get('cookie'),'JSESSIONID=shared-only');assert.equal(headers.get('authorization'),null);assert.equal(headers.get('origin'),'https://webvpn.tsinghua.edu.cn');
  assert.equal(seen[0]!.init.redirect,'manual');assert.equal((seen[0]!.init as any).preserveResponseBytes,true);
  await assert.rejects(f.session.request(origins[2]+'/login'),{code:'GATEWAY_AUTH_REQUIRED'});assert.equal(seen.length,1);f.transport.close();
});

test('redirects stay manual and map WebVPN locations without collapsing application paths',async()=>{
  let calls=0;const location=webvpnWrap(origins[1]+'/double//path/?a=1');
  const f=fixture(async()=>{calls++;return new Response('moved',{status:307,headers:{location,'set-cookie':'private=hidden; Path=/'}});});
  const response=await f.session.request(origins[0]+'/form',{method:'POST',body:'field=value'});
  assert.equal(response.status,307);assert.equal(response.headers.get('location'),origins[1]+'/double//path/?a=1');assert.equal(response.headers.get('set-cookie'),null);await response.text();assert.equal(calls,1);f.transport.close();
  const expired=fixture(async()=>new Response('',{status:302,headers:{location:'/login'}}));
  await assert.rejects(expired.session.request(origins[0]+'/'),{code:'GATEWAY_AUTH_REQUIRED'});expired.transport.close();
});

test('streamed text inverse-maps split URLs and gateway scripts without transcoding GBK',async()=>{
  const wrapped=webvpnWrap(origins[1]+'/');
  const prefix=Buffer.from('<html>'+'.'.repeat(9000)+'<script src="/wengine-vpn/js/main.js"></script><SCRIPT SRC="/wengine-vpn/js/legacy.js"></SCRIPT><script>window.app=true;</script>','ascii');
  const text=Buffer.concat([prefix,Buffer.from([0xd6,0xd0,0xce,0xc4]),Buffer.from(`<a href="${wrapped}a//b">next</a><style>url(${wrapped.slice('https://webvpn.tsinghua.edu.cn'.length)}asset)</style><script>const path="${wrapped.replaceAll('/','\\/')}x";</script></html>`,'ascii')]);
  const f=fixture(async()=>new Response(chunks(text,17),{headers:{'content-type':'text/html; charset=gbk',etag:'old','content-length':String(text.length),'content-security-policy':`default-src 'self'; img-src ${wrapped}; script-src 'nonce-fixture' https://webvpn.tsinghua.edu.cn`}}));
  const response=await f.session.request(origins[0]+'/');const output=Buffer.from(await response.arrayBuffer());
  assert(output.includes(Buffer.from([0xd6,0xd0,0xce,0xc4])));assert.equal(response.headers.get('content-type'),'text/html; charset=gbk');assert.equal(response.headers.get('etag'),null);assert.equal(response.headers.get('content-length'),null);
  assert.equal(response.headers.get('content-security-policy'),`default-src 'self'; img-src ${origins[1]}/; script-src 'nonce-fixture' ${origins[0]}`);
  const ascii=output.toString('latin1');assert(!ascii.includes('/wengine-vpn/js/'));assert(ascii.includes('<script>window.app=true;</script>'));assert(ascii.includes(origins[1]+'/a//b'));assert(ascii.includes('url('+origins[1]+'/asset)'));assert(ascii.includes((origins[1]+'/x').replaceAll('/','\\/')));f.transport.close();
});

test('binary downloads exceed the old 64 MiB limit by streaming with bounded chunks',async()=>{
  let produced=0;const count=260,size=256*1024;
  const f=fixture(async()=>new Response(new ReadableStream<Uint8Array>({pull(target){if(produced===count){target.close();return;}produced++;target.enqueue(new Uint8Array(size).fill(0x9f));}}),{headers:{'content-type':'application/octet-stream'}}));
  const response=await f.session.request(origins[0]+'/file');assert(produced<count,'request must return before buffering the file');
  const reader=response.body!.getReader();let bytes=0;while(true){const part=await reader.read();if(part.done)break;assert(part.value.byteLength<=size);bytes+=part.value.byteLength;}
  assert.equal(bytes,count*size);f.transport.close();
});

test('byte ranges bypass text rewriting and keep their exact representation',async()=>{
  const data=Buffer.from(webvpnWrap(origins[1]+'/asset'));
  const f=fixture(async()=>new Response(data,{status:206,headers:{'content-type':'text/css','content-range':`bytes 0-${data.length-1}/${data.length}`,etag:'range'}}));
  const response=await f.session.request(origins[0]+'/file');assert.deepEqual(Buffer.from(await response.arrayBuffer()),data);assert.equal(response.headers.get('etag'),'range');f.transport.close();
});

test('WebVPN JavaScript is returned as original executable code without a vpn_eval dependency',async()=>{
  const original='globalThis.fixtureJQuery = { version: "3.6.0" };\r\n';
  const f=fixture(async()=>new Response(chunks(Buffer.from('vpn_eval((function(){\n'+original+'\n}\n).toString().slice(12, -2),"");'),9),{headers:{'content-type':'application/javascript; charset=utf-8'}}));
  const response=await f.session.request(origins[0]+'/jquery.js');const code=await response.text();assert.equal(code,original);
  const {runInNewContext}=await import('node:vm');const context:any={};runInNewContext(code,context);assert.equal(context.fixtureJQuery.version,'3.6.0');f.transport.close();
});

test('nested envelopes and HTML-labeled script responses preserve charset and CSP',async()=>{
 const prefix='vpn_eval((function(){\n',suffix='\n}\n).toString().slice(12, -2),"");\r\n\n';
 const original=Buffer.concat([Buffer.from('/* '),Buffer.from([0xd6,0xd0]),Buffer.from(' */\r\nvar fixtureLanguage="ok";')]);
 for(const type of ['text/html; charset=gbk','application/javascript']){
  const source=Buffer.concat([Buffer.from(prefix+prefix),original,Buffer.from(suffix+suffix)]);
  const f=fixture(async()=>new Response(chunks(source,1),{headers:{'content-type':type,'content-security-policy':"script-src 'self'",'x-content-type-options':'nosniff'}}));
  const response=await f.session.request(origins[0]+'/languagejs');assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  assert.equal(response.headers.get('content-type'),type);assert.equal(response.headers.get('content-security-policy'),"script-src 'self'");assert.equal(response.headers.get('x-content-type-options'),'nosniff');f.transport.close();
 }
});

test('secure browser aliases retain HTTP-only upstream routing and inverse-map navigation',async()=>{
  const allowed=withSecureCampusOrigins(['http://myhome.tsinghua.edu.cn','http://zhjw.cic.tsinghua.edu.cn','http://zhjwxk.cic.tsinghua.edu.cn','https://zhjwxk.cic.tsinghua.edu.cn']);
  const seen:{url:string;headers:Headers}[]=[];
  const f=fixture(async(url:string,init:RequestInit)=>{
    seen.push({url,headers:new Headers(init.headers)});
    if(url.startsWith('http://zhjw.'))return new Response('',{status:302,headers:{location:'/next//page/'}});
    return new Response('<a href="http://myhome.tsinghua.edu.cn/path">home</a>',{headers:{'content-type':'text/html'}});
  },allowed);
  const home=await f.session.request('https://myhome.tsinghua.edu.cn/');assert.equal(seen[0]!.url,webvpnWrap('http://myhome.tsinghua.edu.cn/'));assert.equal(await home.text(),'<a href="https://myhome.tsinghua.edu.cn/path">home</a>');
  const direct=await f.session.request('https://zhjw.cic.tsinghua.edu.cn/',{headers:{origin:'https://zhjw.cic.tsinghua.edu.cn',referer:'https://zhjw.cic.tsinghua.edu.cn/before'}});
  assert.equal(seen[1]!.url,'http://zhjw.cic.tsinghua.edu.cn/');assert.equal(seen[1]!.headers.get('origin'),'http://zhjw.cic.tsinghua.edu.cn');assert.equal(direct.headers.get('location'),'https://zhjw.cic.tsinghua.edu.cn/next//page/');await direct.text();
  await(await f.session.request('https://zhjwxk.cic.tsinghua.edu.cn/')).text();assert.equal(seen[2]!.url,webvpnWrap('http://zhjwxk.cic.tsinghua.edu.cn/'),'selection tickets and pages must use its HTTP-only upstream');f.transport.close();
});

test('existing-cookie bootstrap retries GET once, seeds only the live application jar and never replays POST',async()=>{
  const page='<script>var __vpn_hostname_data="fixture"; var __vpn_app_hostname_data="app-fixture";</script>';
  const calls:{url:string;headers:Headers}[]=[];
  const f=fixture(async(url:string,init:RequestInit)=>{calls.push({url,headers:new Headers(init.headers)});if(url.includes('/wengine-vpn/cookie?'))return new Response('JSESSIONID=from-live-session; wengine_vpn_ticket=never-replace');return new Response(calls.length===1?page:'<html>ready</html>',{headers:{'content-type':'text/html; charset=utf-8'}});});
  assert.equal(await(await f.session.request(origins[0]+'/')).text(),'<html>ready</html>');assert.equal(calls.length,3);assert.equal(calls[2]!.headers.get('cookie'),'JSESSIONID=from-live-session');assert(!f.transport.jar.serialize().includes('never-replace'));f.transport.close();
  let attempts=0;const post=fixture(async()=>{attempts++;return new Response(page,{headers:{'content-type':'text/html'}});});await assert.rejects(post.session.request(origins[0]+'/form',{method:'POST',body:'value=1'}),{code:'GATEWAY_AUTH_REQUIRED'});assert.equal(attempts,1);post.transport.close();
});

test('short application fragments with injected WebVPN variables are not mistaken for cookie bootstrap pages',async()=>{
 const fragment='<script>var __vpn_hostname_data="fixture";var __vpn_app_hostname_data="fixture";</script><footer>Campus service footer</footer>';
 let calls=0;const f=fixture(async()=>{calls++;return new Response(fragment,{headers:{'content-type':'text/html'}});});
 assert.equal(await(await f.session.request(origins[0]+'/footer')).text(),fragment);assert.equal(calls,1);f.transport.close();
});

test('service SSO GET is prepared by the existing authority once while browser identity requests stay blocked',async()=>{
 const cab='https://cab.lib.tsinghua.edu.cn';let preparations=0,release!:()=>void;
 const hold=new Promise<void>(resolve=>{release=resolve;});
 const f=fixture(async()=>new Response(null,{status:302,headers:{location:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0'}}),[...origins,cab],async origin=>{assert.equal(origin,cab);preparations++;await hold;});
 const a=f.session.request(cab+'/'),b=f.session.request(cab+'/');
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(preparations,1);release();
 for(const result of await Promise.all([a,b])){assert.equal(result.status,302);assert.equal(result.headers.get('location'),cab+'/');}
 await assert.rejects(f.session.request(cab+'/'),{code:'GATEWAY_AUTH_REQUIRED'});assert.equal(preparations,1);
 await assert.rejects(f.session.request('https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0'),{code:'GATEWAY_AUTH_REQUIRED'});
 const post=await f.session.request(cab+'/business',{method:'POST',body:'value=fixture'});assert.equal(post.status,302);assert.equal(preparations,1);f.transport.close();
});

test('account changes invalidate a pending browser service preparation',async()=>{
 const cab='https://cab.lib.tsinghua.edu.cn';let release!:()=>void,entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
 const f=fixture(async()=>new Response(null,{status:302,headers:{location:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0'}}),[...origins,cab],async()=>{entered();await hold;});
 const response=f.session.request(cab+'/');await started;f.bump();release();
 await assert.rejects(response,{code:'GATEWAY_AUTH_REQUIRED'});f.transport.close();
});

test('card root and selection redirects use only fixed authority preparations and never replay browser POSTs',async()=>{
 const card='https://card.tsinghua.edu.cn',selection='https://zhjwxk.cic.tsinghua.edu.cn',prepared:string[]=[],upstream:string[]=[];
 const f=fixture(async(raw:string)=>{upstream.push(raw);return new Response(null,{status:302,headers:{location:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/1'}});},[...origins,card,selection],async origin=>{prepared.push(origin);});
 const home=await f.session.request(card+'/');assert.equal(home.status,302);assert.equal(home.headers.get('location'),card+'/userindex');assert.deepEqual(upstream,[]);
 const entry=await f.session.request(selection+'/xklogin.do');assert.equal(entry.headers.get('location'),selection+'/xkBks.vxkBksXkbBs.do?m=main');assert.deepEqual(prepared,[card,selection]);
 await f.session.request(card+'/business/payment',{method:'POST',body:'fixture'});assert.deepEqual(prepared,[card,selection]);assert.equal(upstream.length,2);f.transport.close();
});

test('untrusted HTML cannot choose the cookie bootstrap host or steal identity cookies',async()=>{
  const page='<script>var __vpn_hostname_data="fixture"; var __vpn_app_hostname_data="id.tsinghua.edu.cn";</script>';
  const cookieHosts:string[]=[];let applications=0;
  const f=fixture(async(url:string)=>{
    if(url.includes('/wengine-vpn/cookie?')){const host=new URL(url).searchParams.get('host')!;cookieHosts.push(host);return new Response(host==='learn.tsinghua.edu.cn'?'JSESSIONID=learn-only':'sso=identity-secret');}
    return new Response(++applications===1?page:'<html>ready</html>',{headers:{'content-type':'text/html'}});
  });
  await(await f.session.request(origins[0]+'/')).text();assert.deepEqual(cookieHosts,['learn.tsinghua.edu.cn']);assert(!f.transport.jar.serialize().includes('identity-secret'));f.transport.close();
});

test('synthetic bootstrap cookies retain unknown HttpOnly provenance and cannot become browser-visible CSRF',async()=>{
 const page='<script>var __vpn_hostname_data="fixture"; var __vpn_app_hostname_data="fixture";</script>';
 let applications=0;
 const f=fixture(async(url:string)=>url.includes('/wengine-vpn/cookie?')?new Response('XSRF-TOKEN=synthetic-private; JSESSIONID=synthetic-session'):new Response(++applications===1?page:'<html>ready</html>',{headers:{'content-type':'text/html'}}));
 await(await f.session.request(origins[0]+'/')).text();
 const cookies=f.transport.jar.getCookies(new URL(origins[0]+'/'));
 assert(cookies.length>=2);assert(cookies.every(cookie=>cookie.httpOnly===undefined));assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[]);
 const physical=new URL(webvpnWrap(origins[0]+'/'));
 f.transport.jar.setRaw(physical,'XSRF-TOKEN=response-token; Path='+physical.pathname+'; Secure');
 assert.deepEqual(f.session.browserCookies(origins[0]+'/'),[{name:'XSRF-TOKEN',value:'response-token'}]);f.transport.close();
});

test('logout/epoch change rejects a pending response and an active stream',async()=>{
  let release!:(response:Response)=>void;
  const pending=fixture(()=>new Promise<Response>(resolve=>{release=resolve;}));const request=pending.session.request(origins[0]+'/');pending.bump();release(new Response('stale',{headers:{'set-cookie':'old=secret; Path=/'}}));await assert.rejects(request,{code:'AUTH_SESSION_CHANGED'});assert.equal(pending.transport.jar.serialize(),'[]');pending.transport.close();
  const streaming=fixture(async()=>new Response(chunks(new Uint8Array(8192),64),{headers:{'content-type':'application/octet-stream'}}));const response=await streaming.session.request(origins[0]+'/file');const reader=response.body!.getReader();await reader.read();streaming.logout();await assert.rejects(async()=>{while(!(await reader.read()).done){};},{code:'AUTH_SESSION_CHANGED'});streaming.transport.close();
});

test('Learn calendar roaming restores only the existing success anchor expected by its original client',async()=>{
 const base=origins[0]!,wrapped=webvpnWrap(base+'/');
 for(const href of [base+'/',wrapped,wrapped.slice('https://webvpn.tsinghua.edu.cn'.length),'/']){
  const source=`<script>var __vpn_hostname_data="fixture";var __vpn_app_hostname_data="fixture";</script><a href="${href}">OK fixture-user</a>`;
  const f=fixture(async()=>new Response(chunks(Buffer.from(source),1),{headers:{'content-type':'text/html'}}));
  const result=await(await f.session.request(base+'/roam.php?ticket=fixture')).text();
  assert.equal(result.match(/<a href='\/'>OK (.*?)<\/a>/)?.[1],'fixture-user');
  assert(result.includes('<script>var __vpn_hostname_data='),'unrelated response bytes stay intact');f.transport.close();
 }
 for(const [path,body] of [
  ['/other',`<a href="${base}/">OK fixture-user</a>`],
  ['/roam.php',`<a href="https://other.test/">OK fixture-user</a>`],
  ['/roam.php',`<a href="${base}/">ERROR fixture-user</a>`],
  ['/roam.php',`<a href="${base}/">OK <b>fixture-user</b></a>`],
 ]){
  const f=fixture(async()=>new Response(body,{headers:{'content-type':'text/html'}}));
  assert.equal(await(await f.session.request(base+path)).text(),body);f.transport.close();
 }
});

test('production allowlist excluding identity still prepares direct and wrapped fixed-service redirects once',async()=>{
 const cab='https://cab.lib.tsinghua.edu.cn',identity='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0?foreign=not-replayed';
 for(const location of [identity,webvpnWrap(identity)]){
  let prepared=0;const calls:{url:string;method:string;body:unknown}[]=[];
  const f=fixture(async(url:string,init:RequestInit)=>{calls.push({url,method:init.method??'GET',body:init.body});return new Response(null,{status:302,headers:{location}});},[origins[0]!,cab],async origin=>{assert.equal(origin,cab);prepared++;});
  const result=await f.session.request(cab+'/business-entry?custom=not-replayed');
  assert.equal(result.headers.get('location'),cab+'/');assert.equal(prepared,1);assert.equal(calls.length,1);assert.equal(calls[0]!.body,undefined);
  await assert.rejects(f.session.request(cab+'/'),{code:'GATEWAY_AUTH_REQUIRED'});assert.equal(prepared,1);
  if(location===identity)await f.session.request(cab+'/business',{method:'POST',body:'custom=not-replayed'});
  else await assert.rejects(f.session.request(cab+'/business',{method:'POST',body:'custom=not-replayed'}),{code:'GATEWAY_AUTH_REQUIRED'});
  assert.equal(prepared,1);assert.equal(calls.length,3);assert.equal(calls[2]!.body,'custom=not-replayed');f.transport.close();
 }
});

test('wrapped unknown services are distinguished from expired WebVPN authentication without being fetched',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return new Response(null,{status:302,headers:{location:webvpnWrap('https://unsupported.tsinghua.edu.cn/route?ticket=fixture')}});},[origins[0]!]);
 await assert.rejects(f.session.request(origins[0]+'/'),{code:'GATEWAY_SERVICE_UNSUPPORTED'});assert.equal(calls,1);f.transport.close();
});

test('official Info route redirects discover campus services and preserve their upstream transport',async t=>{
 const info='https://info.tsinghua.edu.cn';
 for(const destination of ['https://career.tsinghua.edu.cn/info/1031/5378.htm','https://lib.tsinghua.edu.cn/','http://legacy.tsinghua.edu.cn/news?id=2']){
  const id=destination.includes('lib.')?'routea0e943cd14c74d9b9a5416859c9ffd54':'ece02eecada569b9cae68be99461c98d';
  const entry=info+'/f/info/route?id='+id;const target=new URL(destination);const facade=new URL(destination);facade.protocol='https:';
  const calls:string[]=[];
  const f=fixture(async(url:string)=>{
   calls.push(url);
   if(url===webvpnWrap(entry))return new Response(null,{status:302,headers:{location:webvpnWrap(destination)}});
   assert.equal(url,webvpnWrap(destination));return new Response('real campus page');
  });t.after(()=>f.transport.close());
  const response=await f.session.request(entry,{headers:{'sec-fetch-dest':'document'}});
  assert.equal(response.status,200);assert.match(await response.text(),/http-equiv="refresh"/);
  assert.equal(response.headers.get('referrer-policy'),'strict-origin');
  assert.equal(f.session.authorizeTarget(facade.origin+'/'),true);
  assert.equal(await (await f.session.request(facade.href)).text(),'real campus page');
  assert.deepEqual(calls,[webvpnWrap(entry),webvpnWrap(destination)]);
  f.bump();assert.equal(f.session.authorizeTarget(facade.origin+'/'),false);
 }
});

test('official Info news IDs preserve the article destination across campus hosts',async t=>{
 const info='https://info.tsinghua.edu.cn';
 const article=info+'/f/info/xxfb_fg/xnzx/template/detail?xxid=00112233445566778899aabbccddeeff';
 const destination='https://info2021.tsinghua.edu.cn/f/info/xxfb_fg/bmxx/departmentalView?code=fixture-article';
 const calls:string[]=[];
 const f=fixture(async(url:string)=>{
  calls.push(url);
  if(url===webvpnWrap(article))return new Response(null,{status:302,headers:{location:webvpnWrap(destination)}});
  assert.equal(url,webvpnWrap(destination));
  return new Response('<title>Fixture article</title>');
 },[info]);t.after(()=>f.transport.close());
 for(let attempt=0;attempt<2;attempt++){
  const response=await f.session.request(article,{headers:{'sec-fetch-dest':'document'}});
  assert.equal(response.status,200);
  assert((await response.text()).includes(destination));
  assert.equal(f.session.authorizeTarget('https://info2021.tsinghua.edu.cn/'),true);
  assert.match(await(await f.session.request(destination)).text(),/Fixture article/);
 }
 assert.deepEqual(calls,[webvpnWrap(article),webvpnWrap(destination),webvpnWrap(article),webvpnWrap(destination)]);
 f.bump();assert.equal(f.session.authorizeTarget('https://info2021.tsinghua.edu.cn/'),false);
});

test('Info news discovery rejects forged selectors and cannot grant identity or outside hosts',async t=>{
 const info='https://info.tsinghua.edu.cn';
 const article=info+'/f/info/xxfb_fg/xnzx/template/detail?xxid=00112233445566778899aabbccddeeff';
 for(const source of [article+'&xxid=duplicate',article+'&url=https://other.test/',article+'&ticket=untrusted',article+'#fragment',article.replace('xxid=0011','xxid=bad-')]){
  const f=fixture(async()=>new Response(null,{status:302,headers:{location:webvpnWrap('https://info2021.tsinghua.edu.cn/article')}}),[info]);t.after(()=>f.transport.close());
  await assert.rejects(f.session.request(source),{code:source.includes('#')?'GATEWAY_TARGET_REJECTED':'GATEWAY_SERVICE_UNSUPPORTED'});
  assert.equal(f.session.authorizeTarget('https://info2021.tsinghua.edu.cn/'),false);
 }
 for(const destination of ['https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0','https://oauth.tsinghua.edu.cn/thu-oauth/auth','https://outside.test/article']){
  let calls=0;
  const f=fixture(async()=>{calls++;return new Response(null,{status:302,headers:{location:webvpnWrap(destination)}});},[info]);t.after(()=>f.transport.close());
  await assert.rejects(f.session.request(article),{code:destination.includes('outside.test')?'GATEWAY_SERVICE_UNSUPPORTED':'GATEWAY_IDENTITY_SESSION_REQUIRED'});
  assert.equal(calls,1);
  assert.equal(f.session.authorizeTarget(new URL(destination).origin),false);
 }
});

test('ordinary Info pages, extra route inputs and identity destinations cannot grant a campus origin',async t=>{
 const info='https://info.tsinghua.edu.cn',entry=info+'/f/info/route?id=ece02eecada569b9cae68be99461c98d';
 for(const path of [entry+'&url=external',info+'/f/info/other?id=ece02eecada569b9cae68be99461c98d',entry.replace('ece02eec','invalid-')]){
  const f=fixture(async()=>new Response(null,{status:302,headers:{location:webvpnWrap('https://unknown.tsinghua.edu.cn/news')}}));t.after(()=>f.transport.close());
  await assert.rejects(f.session.request(path),{code:'GATEWAY_SERVICE_UNSUPPORTED'});
  assert.equal(f.session.authorizeTarget('https://unknown.tsinghua.edu.cn/'),false);
 }
 for(const destination of ['https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/00112233445566778899aabbccddeeff/0','https://oauth.tsinghua.edu.cn/thu-oauth/auth']){
  const f=fixture(async()=>new Response(null,{status:302,headers:{location:destination}}));t.after(()=>f.transport.close());
  await assert.rejects(f.session.request(entry),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
  assert.equal(f.session.authorizeTarget(destination),false);
 }
});

test('static campus origins rewrite legacy HTTP WebVPN links without changing the service transport',async t=>{
 const lib='https://lib.tsinghua.edu.cn',seat='https://seat.lib.tsinghua.edu.cn';
 const old=webvpnWrap('http://seat.lib.tsinghua.edu.cn/home/web/f_second');
 const paths=[old,old.slice('https:'.length),old.slice('https://webvpn.tsinghua.edu.cn'.length)];
 const source=paths.map(url=>'<a href="'+url+'">Seat</a>').join('')+'<script>const route="'+old.replaceAll('/','\\/')+'";</script>';
 const f=fixture(async()=>new Response(source,{headers:{'content-type':'text/html'}}),[lib,seat]);t.after(()=>f.transport.close());
 const result=await (await f.session.request(lib+'/')).text();
 assert.equal(result.includes('webvpn.tsinghua.edu.cn'),false);
 assert.equal((result.match(/https:\/\/seat\.lib\.tsinghua\.edu\.cn\/home\/web\/f_second/g)??[]).length,3);
 assert(result.includes((seat+'/home/web/f_second').replaceAll('/','\\/')));
});
