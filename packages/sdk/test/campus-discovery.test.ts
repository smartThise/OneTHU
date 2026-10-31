import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar, webvpnWrap } from '@onethu/core';
import { createCampusProxySession } from '../src/node/campusProxy.js';

test('official portal discovery grants a new service, carries its minted token and revokes it on account switch',async()=>{
 const origin='https://not-in-source.tsinghua.edu.cn';
 const token='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fixtureSignature123';
 let epoch=1,discoveries=0,requests=0;
 let cache:unknown;
 const runtime={epoch:()=>epoch,assertCurrent(expected:number){assert.equal(expected,epoch);},status:()=>({authenticated:true,state:'ready'}),http:{jar:new MemoryCookieJar()},
  session:{username:'fixture-owner'},loadGatewayState:()=>cache,saveGatewayState(value:unknown){cache=value;},
  resolveCampusPortal:async(selector:string)=>{assert.equal(selector,'00112233445566778899aabbccddeeff');discoveries++;return {url:origin+'/callback?ticket=fixture',origin,upstreamOrigin:origin,transport:'direct' as const};},
  fetch:async()=>{throw new Error('discovered direct route must retain its shared direct jar');},
  fetchCampusDirect:async(_url:string,init:RequestInit)=>{requests++;if(requests===1)return Response.json({data:{token}});assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+token);return Response.json({ok:true});}};
 const proxy=createCampusProxySession(runtime as any,['https://info.tsinghua.edu.cn']);
 assert.equal(proxy.authorizeTarget(origin),false);
 const response=await proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?yyfwid=00112233445566778899aabbccddeeff&bz=app');
 assert.equal(response.status,302);assert.equal(response.headers.get('location'),origin+'/callback?ticket=fixture');
 assert.equal(response.headers.get('referrer-policy'),'strict-origin','the callback retains safe Info origin provenance without leaking URL parameters');
 assert.equal(proxy.authorizeTarget(origin),true);assert.equal(discoveries,1);
 assert.equal(JSON.stringify(proxy.allowedOrigins()).includes('ticket='),false);
 await (await proxy.request(origin+'/api/auth-result')).text();
 assert.equal(proxy.authorizeBrowserCredential(origin+'/api','authorization','Bearer '+token),true);
 await (await proxy.request(origin+'/api',{headers:{authorization:'Bearer '+token}})).text();
 const restarted=createCampusProxySession(runtime as any,['https://info.tsinghua.edu.cn']);
 assert.equal(restarted.authorizeTarget(origin),true,'a same-account backend restart restores official service routes');
 assert.equal(restarted.authorizeBrowserCredential(origin+'/api','authorization','Bearer '+token),true,'a restart retains only witnessed token hashes');
 assert.equal(JSON.stringify(cache).includes(token),false);assert.equal(JSON.stringify(cache).includes('ticket='),false);
 runtime.session.username='different-owner';
 const other=createCampusProxySession(runtime as any,['https://info.tsinghua.edu.cn']);
 assert.equal(other.authorizeTarget(origin),false,'cached routes cannot move between owners');
 runtime.session.username='fixture-owner';
 epoch++;
 assert.equal(proxy.authorizeTarget(origin),false);
 assert.equal(proxy.authorizeBrowserCredential(origin+'/api','authorization','Bearer '+token),false);
 await assert.rejects(proxy.request(origin+'/api'),{code:'GATEWAY_TARGET_REJECTED'});
});

test('caller URLs and duplicate portal selectors cannot authorize a new origin',async()=>{
 let calls=0;const runtime={epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:new MemoryCookieJar()},fetch:async()=>new Response(),resolveCampusPortal:async()=>{calls++;throw new Error('must not run');}};
 const proxy=createCampusProxySession(runtime as any,['https://info.tsinghua.edu.cn']);
 for(const query of ['yyfwid=00112233445566778899aabbccddeeff&target=https://evil.test','yyfwid=00112233445566778899aabbccddeeff&yyfwid=00112233445566778899aabbccddeeff','yyfwid=https://evil.test']){
  await assert.rejects(proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?'+query),{code:'GATEWAY_SERVICE_TARGET_REJECTED'});
 }
 assert.equal(calls,0);
});

test('existing application-specific session headers survive transparent proxying',async()=>{
 const origin='https://business-new.tsinghua.edu.cn';let seen:Headers|undefined;
 const proxy=createCampusProxySession({epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:new MemoryCookieJar()},
  resolveCampusPortal:async()=>({url:origin+'/',origin,upstreamOrigin:origin,transport:'webvpn'}),
  fetch:async(_url:string,init:RequestInit)=>{seen=new Headers(init.headers);return Response.json({ok:true});}} as any,['https://info.tsinghua.edu.cn']);
 await proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?yyfwid=00112233445566778899aabbccddeeff');
 await(await proxy.request(origin+'/business',{headers:{token:'existing-browser-business-session','x-api-version':'2.0.0'}})).text();
 assert.equal(seen!.get('token'),'existing-browser-business-session');assert.equal(seen!.get('x-api-version'),'2.0.0');
});

test('a discovered legacy service can change its WebVPN wire scheme without losing its HTTPS browser facade',async()=>{
 const origin='https://legacy-new.tsinghua.edu.cn';const calls:string[]=[];
 const proxy=createCampusProxySession({epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:new MemoryCookieJar()},
  resolveCampusPortal:async()=>({url:origin+'/callback?ticket=fixture',origin,upstreamOrigin:origin,transport:'webvpn'}),
  fetch:async(url:string)=>{calls.push(url);return calls.length===1?new Response(null,{status:302,headers:{location:webvpnWrap('http://legacy-new.tsinghua.edu.cn/home')}}):new Response('ready');}} as any,['https://info.tsinghua.edu.cn']);
 await proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?yyfwid=00112233445566778899aabbccddeeff');
 const response=await proxy.request(origin+'/callback?ticket=fixture');
 assert.equal(response.headers.get('location'),origin+'/home');
 assert.equal(await(await proxy.request(origin+'/home')).text(),'ready');
 assert.equal(calls[1],webvpnWrap('http://legacy-new.tsinghua.edu.cn/home'));
});

test('same-URL WebVPN scheme loops use one pinned same-account HTTPS route instead of browser redirect loops',async()=>{
 const origin='https://canonical-new.tsinghua.edu.cn',calls:string[]=[];
 const callback=origin+'/callback?ticket=fixture';
 const proxy=createCampusProxySession({epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:new MemoryCookieJar()},
  resolveCampusPortal:async()=>({url:callback,origin,upstreamOrigin:origin,transport:'webvpn'}),
  fetch:async(url:string)=>{calls.push(url);return new Response(null,{status:302,headers:{location:webvpnWrap(callback.replace('https:','http:'))}});},
  fetchCampusDirect:async(url:string)=>{calls.push(url);return new Response('<a href="http://canonical-new.tsinghua.edu.cn/data">signed-in</a><script src="'+webvpnWrap(origin+'/asset.js')+'"></script>',{headers:{'content-type':'text/html'}});}} as any,['https://info.tsinghua.edu.cn']);
 await proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?yyfwid=00112233445566778899aabbccddeeff');
 const response=await proxy.request(callback);assert.equal(response.status,200);const html=await response.text();assert(html.includes('signed-in'));assert(html.includes('href="'+origin+'/data"'));assert(!html.includes('webvpn.tsinghua.edu.cn'));
 assert.equal(calls.length,3);assert.equal(calls[2],callback);
 calls.length=0;
 await proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?yyfwid=00112233445566778899aabbccddeeff');
 assert((await(await proxy.request(callback)).text()).includes('signed-in'));
 assert.deepEqual(calls,[callback],'a new portal hint must not overwrite the already learned working transport');
});

test('the official synchronous POST selector joins the same broker without accepting credential/ticket submissions',async()=>{
 let calls=0;
 const origin='https://new-post-service.tsinghua.edu.cn';
 const proxy=createCampusProxySession({epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:new MemoryCookieJar()},fetch:async()=>{throw new Error('must use authority');},resolveCampusPortal:async()=>{calls++;return{url:origin+'/callback?ticket=fixture',origin,upstreamOrigin:origin,transport:'webvpn'};}} as any,['https://info.tsinghua.edu.cn']);
 const entry='https://info.tsinghua.edu.cn/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect?yyfwid=00112233445566778899aabbccddeeff&machine=p';
 const result=await proxy.request(entry,{method:'POST',body:'_csrf=public-nonce'});
 assert.equal(result.status,200);const body=await result.json();assert.equal(body.result,'success');assert.equal(new URL(body.object.roamingurl).origin,origin);assert.equal(calls,1);
 await assert.rejects(proxy.request(entry,{method:'POST',body:'ticket=foreign'}),{code:'GATEWAY_AUTH_REQUIRED'});assert.equal(calls,1);
});

test('an identity login form has its own recovery code and does not revoke the ready account',async()=>{
 const jar=new MemoryCookieJar();jar.setRaw(new URL('https://info.tsinghua.edu.cn/'),'fixture=preserved; Path=/');
 const proxy=createCampusProxySession({epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar},fetch:async()=>new Response('still-ready'),
  resolveCampusPortal:async()=>{throw Object.assign(new Error('private page contents must not escape'),{code:'CAMPUS_SERVICE_IDENTITY_REQUIRED'});}} as any,['https://info.tsinghua.edu.cn']);
 await assert.rejects(proxy.request('https://info.tsinghua.edu.cn/f/info/portal_fg/teacher/roamingToApp?yyfwid=00112233445566778899aabbccddeeff'),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
 assert.equal(jar.getCookies(new URL('https://info.tsinghua.edu.cn/'))[0]?.value,'preserved');
 assert.equal(await(await proxy.request('https://info.tsinghua.edu.cn/')).text(),'still-ready');
});
