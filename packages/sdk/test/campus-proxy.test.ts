import test from 'node:test';
import assert from 'node:assert/strict';
import { webvpnWrap } from '@onethu/core';
import { createNodeTransport } from '../src/node/transport.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';
import { withSecureCampusOrigins } from '@onethu/gateway/routes';

const origins=['https://learn.tsinghua.edu.cn','https://info.tsinghua.edu.cn','https://id.tsinghua.edu.cn'];
function fixture(fetch:any,allowed=origins){
  let epoch=1,ready=true;
  const assertCurrent=(value:number)=>{if(value!==epoch)throw Object.assign(new Error('AUTH_SESSION_CHANGED'),{code:'AUTH_SESSION_CHANGED'});};
  const transport=createNodeTransport({fetch,epoch:()=>epoch,assertCurrent});
  const runtime={fetch:transport.fetch,epoch:()=>epoch,assertCurrent,status:()=>({authenticated:ready,state:ready?'ready':'idle',epoch}),http:{jar:transport.jar}};
  return {session:createCampusProxySession(runtime as any,allowed),transport,bump(){epoch++;transport.rotate();},logout(){ready=false;epoch++;transport.rotate();}};
}
function chunks(bytes:Uint8Array,size=31){let offset=0;return new ReadableStream<Uint8Array>({pull(target){if(offset===bytes.length){target.close();return;}target.enqueue(bytes.subarray(offset,offset+size));offset=Math.min(offset+size,bytes.length);}});}

test('adapter rejects invalid targets before fetching or losing a nondefault port',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;return new Response('no');});
  for(const target of ['https://outside.test/','https://learn.tsinghua.edu.cn:8443/','https://user:pass@learn.tsinghua.edu.cn/','https://127.0.0.1/','https://webvpn.tsinghua.edu.cn/','https://learn.tsinghua.edu.cn/#fragment'])await assert.rejects(f.session.request(target),{code:'GATEWAY_TARGET_REJECTED'});
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

test('browser cookie projection exposes only Learn root non-HttpOnly XSRF token and preserves encoding',()=>{
  const f=fixture(async()=>new Response('unused'));
  const learn=new URL(origins[0]+'/');
  for(const line of ['XSRF-TOKEN=fixture%2Fcsrf%3D; Path=/; Secure','JSESSIONID=authentication-secret; Path=/; Secure; HttpOnly','sid=other-secret; Path=/; Secure','x-csrf=not-approved; Path=/; Secure'])f.transport.jar.setRaw(learn,line);
  f.transport.jar.setRaw(new URL(origins[1]+'/'),'XSRF-TOKEN=other-origin-secret; Path=/; Secure');
  assert.deepEqual(f.session.browserCookies(origins[0]+'/courses'),[{name:'XSRF-TOKEN',value:'fixture%2Fcsrf%3D'}]);
  assert.deepEqual(f.session.browserCookies(origins[1]+'/'),[]);
  assert.throws(()=>f.session.browserCookies('https://outside.test/'),{code:'GATEWAY_TARGET_REJECTED'});
  const physical=new URL(webvpnWrap(origins[0]+'/'));
  f.transport.jar.setRaw(new URL('https://webvpn.tsinghua.edu.cn/'),'XSRF-TOKEN=global-must-stay-private; Path=/; Secure');
  f.transport.jar.setRaw(new URL(webvpnWrap(origins[1]+'/')),'XSRF-TOKEN=other-app-secret; Path='+new URL(webvpnWrap(origins[1]+'/')).pathname+'; Secure');
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
  await(await f.session.request('https://zhjwxk.cic.tsinghua.edu.cn/')).text();assert.equal(seen[2]!.url,webvpnWrap('https://zhjwxk.cic.tsinghua.edu.cn/'),'already-supported HTTPS upstream must remain HTTPS');f.transport.close();
});

test('existing-cookie bootstrap retries GET once, seeds only the live application jar and never replays POST',async()=>{
  const page='<script>var __vpn_hostname_data="fixture"; var __vpn_app_hostname_data="app-fixture";</script>';
  const calls:{url:string;headers:Headers}[]=[];
  const f=fixture(async(url:string,init:RequestInit)=>{calls.push({url,headers:new Headers(init.headers)});if(url.includes('/wengine-vpn/cookie?'))return new Response('JSESSIONID=from-live-session; wengine_vpn_ticket=never-replace');return new Response(calls.length===1?page:'<html>ready</html>',{headers:{'content-type':'text/html; charset=utf-8'}});});
  assert.equal(await(await f.session.request(origins[0]+'/')).text(),'<html>ready</html>');assert.equal(calls.length,3);assert.equal(calls[2]!.headers.get('cookie'),'JSESSIONID=from-live-session');assert(!f.transport.jar.serialize().includes('never-replace'));f.transport.close();
  let attempts=0;const post=fixture(async()=>{attempts++;return new Response(page,{headers:{'content-type':'text/html'}});});await assert.rejects(post.session.request(origins[0]+'/form',{method:'POST',body:'value=1'}),{code:'GATEWAY_AUTH_REQUIRED'});assert.equal(attempts,1);post.transport.close();
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
