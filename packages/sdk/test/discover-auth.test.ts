import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar } from '@onethu/core';
import { resolveDiscoverLogin } from '../src/node/discoverAuth.js';
import {
  DISCOVER_ORIGIN, DISCOVER_IDP_ORIGIN, DISCOVER_IDENTITY_URL, DISCOVER_ACS,
  parseDiscoverLogin, normalizeDiscoverCallback, isDiscoverTransition,
} from '../../gateway/src/discoverAuth.mjs';

const history=DISCOVER_ORIGIN+'/entrance/myLibEntrance/myLibIndex/MyLibBorrowNow';
const entry=DISCOVER_ORIGIN+'/login?history='+encodeURIComponent(history);
const parsed=parseDiscoverLogin(entry)!;
const sso=DISCOVER_IDP_ORIGIN+'/idp/profile/SAML2/POST/SSO';
const callback=DISCOVER_IDP_ORIGIN+'/idp/Authn/External/info?ticket=official-fixture-ticket';
const transition=parsed.serviceUrl+'&ticket=library-fixture-ticket';
const redirect=(location:string,cookie?:string)=>new Response(null,{status:302,headers:{location,...(cookie?{'set-cookie':cookie}:{})}});
const form=(action:string,values:Record<string,string>)=>new Response('<html><form method="post" action="'+action+'">'+Object.entries(values).map(([name,value])=>'<input type="hidden" name="'+name+'" value="'+value+'">').join('')+'</form></html>',{headers:{'content-type':'text/html'}});
const base64=(value:string)=>Buffer.from(value).toString('base64');
function fixture(options:{responseId?:string;responseTarget?:string;relayState?:string;final?:string;epochChange?:boolean;callback?:string|null;removeOld?:boolean;concurrentOld?:string;oldIdentityCookies?:boolean;skipNative?:boolean;language?:string}={}){
 const flowEntry=options.language?entry+'&lang='+options.language:entry;
 const flow=parseDiscoverLogin(flowEntry)!;
 const finalTransition=flow.serviceUrl+'&ticket=library-fixture-ticket';
 let epoch=1,callbackCount=0,authenticated=false;const jar=new MemoryCookieJar();jar.setRaw(new URL('https://info.tsinghua.edu.cn/'),'info_session=keep; Path=/; Secure; HttpOnly');jar.setRaw(new URL(DISCOVER_ORIGIN),'old=keep; Path=/; Secure; HttpOnly');
 if(options.oldIdentityCookies){jar.setRaw(new URL(DISCOVER_IDP_ORIGIN+'/idp/'),'JSESSIONID=old-account; Path=/idp; Secure; HttpOnly');jar.setRaw(new URL('https://info.tsinghua.edu.cn/'),'parent_identity=old-account; Domain=tsinghua.edu.cn; Path=/; Secure; HttpOnly');}
 const initial=jar.serialize(),calls:Array<{url:string;method:string}>=[];
 const requestXml='<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="request-one" Destination="'+sso+'" AssertionConsumerServiceURL="'+DISCOVER_ACS+'" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>'+DISCOVER_ORIGIN+'/samlsp</saml:Issuer></samlp:AuthnRequest>';
 const samlRequest=base64(requestXml);
 const samlResponse=base64('<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" InResponseTo="'+(options.responseId??'request-one')+'" Destination="'+(options.responseTarget??DISCOVER_ACS)+'"><Assertion/></samlp:Response>');
 const assertCurrent=(value:number)=>{if(value!==epoch)throw new Error('AUTH_SESSION_CHANGED');};
 const runtime={jar,epoch:()=>epoch,assertCurrent,requestCallback:async(url:string)=>{assert.equal(url,DISCOVER_IDENTITY_URL);callbackCount++;if(options.concurrentOld)jar.setRaw(new URL(DISCOVER_ORIGIN),'old='+options.concurrentOld+'; Path=/; Secure; HttpOnly');if(options.epochChange)epoch++;return options.callback===undefined?callback:options.callback;},fetch:async(input:any,init?:RequestInit)=>{
  const url=String(input),method=init?.method??'GET',headers=new Headers(init?.headers);calls.push({url,method});
  if(url===flow.startUrl)return redirect(DISCOVER_ORIGIN+'/samlsp/user.html','sp=transaction; Path=/samlsp; Secure; HttpOnly');
  if(url===DISCOVER_ORIGIN+'/samlsp/user.html')return authenticated?redirect(options.final??finalTransition):form(sso,{SAMLRequest:samlRequest,RelayState:'original-relay'});
  if(url===sso&&method==='POST'){
   assert.equal(new URLSearchParams(init?.body as string).get('SAMLRequest'),samlRequest);
   assert.equal(headers.get('cookie'),null);
   if(options.skipNative)return form(DISCOVER_ACS,{SAMLResponse:samlResponse,RelayState:'original-relay'});
   return redirect(sso+'?execution=e1s1','JSESSIONID=private-idp; Path=/idp; Secure; HttpOnly');
  }
  if(url===sso+'?execution=e1s1'&&method==='GET')return form(url,{csrf_token:'fixture-csrf',shib_idp_ls_supported:'false',_eventId_proceed:''});
  if(url===sso+'?execution=e1s1'&&method==='POST'){
   assert.equal(headers.get('cookie'),'JSESSIONID=private-idp');
   assert.equal(new URLSearchParams(init?.body as string).get('csrf_token'),'fixture-csrf');
   return redirect(DISCOVER_IDP_ORIGIN+'/idp/external.jsp?conversation=e1s2');
  }
  if(url===DISCOVER_IDP_ORIGIN+'/idp/external.jsp?conversation=e1s2')return redirect(DISCOVER_IDENTITY_URL);
  if(url===callback)return redirect(sso+'?execution=e1s2&_eventId_proceed=1');
  if(url===sso+'?execution=e1s2&_eventId_proceed=1')return form(DISCOVER_ACS,{SAMLResponse:samlResponse,RelayState:options.relayState??'original-relay'});
  if(url===DISCOVER_ACS&&method==='POST'){
   assert.equal(new URLSearchParams(init?.body as string).get('SAMLResponse'),samlResponse);
   assert.match(headers.get('cookie')??'',/sp=transaction/);
   assert.doesNotMatch(headers.get('cookie')??'',/private-idp|info_session/);
   authenticated=true;
   const response=redirect(DISCOVER_ORIGIN+'/samlsp/user.html','library_session=official; Path=/; Secure; HttpOnly');
   if(options.removeOld)response.headers.append('set-cookie','old=; Max-Age=0; Path=/; Secure; HttpOnly');
   return response;
  }
  throw new Error('unexpected fixture route');
 }};
 return {runtime,calls,initial,jar,flowEntry,get callbackCount(){return callbackCount;}};
}

test('Discover validates local history, fixed IdP callbacks and exact transition context',()=>{
 assert.equal(parseDiscoverLogin(entry)?.targetUrl,history);
 assert.equal(parseDiscoverLogin(parsed.startUrl)?.targetUrl,history);
 assert.equal(parseDiscoverLogin(DISCOVER_ORIGIN+'/login')?.targetUrl,DISCOVER_ORIGIN+'/');
 for(const value of [entry+'&history='+encodeURIComponent(history),entry+'&extra=1',entry.replace('https:', 'http:'),DISCOVER_ORIGIN+'/login?history='+encodeURIComponent('https://evil.example/'),DISCOVER_ORIGIN+'/login?history='+encodeURIComponent(DISCOVER_ORIGIN+'/samlsp/user.html')])assert.equal(parseDiscoverLogin(value),null);
 assert.equal(normalizeDiscoverCallback(callback),callback);
 for(const value of [callback.replace(DISCOVER_IDP_ORIGIN,'https://id.tsinghua.edu.cn'),callback+'&ticket=second',callback.replace('/Authn/External/info','/logout'),callback.replace('https:','http:'),callback+'#fragment'])assert.equal(normalizeDiscoverCallback(value),null);
 assert.equal(isDiscoverTransition(transition,entry),true);
 assert.equal(isDiscoverTransition(transition.replace('library-fixture-ticket',''),entry),false);
 assert.equal(isDiscoverTransition(transition,entry.replace('MyLibBorrowNow','AnotherPage')),false);
});

test('Discover resolves the official SAML flow and merges only the service cookies',async()=>{
 const f=fixture();const result=await resolveDiscoverLogin(f.runtime,entry);
 assert.equal(result,transition);assert.equal(f.callbackCount,1);
 const cookies=JSON.parse(f.jar.serialize());
 assert.ok(cookies.some((cookie:any)=>cookie.name==='library_session'&&cookie.value==='official'));
 assert.ok(cookies.some((cookie:any)=>cookie.name==='info_session'&&cookie.value==='keep'));
 assert.ok(!cookies.some((cookie:any)=>cookie.domain==='idp.tsinghua.edu.cn'));
 assert.equal(f.calls.some(call=>call.url===DISCOVER_IDENTITY_URL),false);
});

test('Discover refuses a mismatched SAML response, RelayState, destination or final return target',async()=>{
 for(const options of [{responseId:'other-request'},{responseTarget:'https://evil.example/sso'},{relayState:'other-flow'},{final:transition.replace('MyLibBorrowNow','AnotherPage')},{callback:'https://evil.example/?ticket=outside'}]){
  const f=fixture(options);await assert.rejects(resolveDiscoverLogin(f.runtime,entry));assert.equal(f.jar.serialize(),f.initial);
 }
});

test('Discover account changes and cancellation cannot merge partial session cookies',async()=>{
 const f=fixture({epochChange:true});await assert.rejects(resolveDiscoverLogin(f.runtime,entry),/AUTH_SESSION_CHANGED/);assert.equal(f.jar.serialize(),f.initial);
 const g=fixture();const controller=new AbortController();controller.abort();await assert.rejects(resolveDiscoverLogin(g.runtime,entry,controller.signal));assert.equal(g.calls.length,0);assert.equal(g.jar.serialize(),g.initial);
});


test('Discover failure diagnostics contain fixed stages without callback or assertion values',async()=>{
 const cases=[
  {options:{responseId:'other-request'},stage:'SAML_RESPONSE'},
  {options:{callback:'https://evil.example/?ticket=secret'},stage:'CALLBACK'},
 ];
 for(const {options,stage} of cases){
  const f=fixture(options);
  await assert.rejects(resolveDiscoverLogin(f.runtime,entry),(error:any)=>{
   assert.equal(error.serviceReason,'CAMPUS_SERVICE_DISCOVER_'+stage);
   assert.equal(JSON.stringify(error).includes('secret'),false);
   assert.equal(JSON.stringify(error).includes('other-request'),false);
   return true;
  });
 }
 const f=fixture();await assert.rejects(resolveDiscoverLogin(f.runtime,'https://evil.example/'),{serviceReason:'CAMPUS_SERVICE_DISCOVER_ENTRY'});
});

test('Discover merges server deletions only when the shared cookie still matches the snapshot',async()=>{
 const unchanged=fixture({removeOld:true});await resolveDiscoverLogin(unchanged.runtime,entry);
 assert.equal(unchanged.jar.getCookies(new URL(DISCOVER_ORIGIN)).some(cookie=>cookie.name==='old'),false);
 const concurrent=fixture({removeOld:true,concurrentOld:'newer-value'});await resolveDiscoverLogin(concurrent.runtime,entry);
 assert.equal(concurrent.jar.getCookies(new URL(DISCOVER_ORIGIN)).find(cookie=>cookie.name==='old')?.value,'newer-value');
 assert.equal(concurrent.jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).find(cookie=>cookie.name==='info_session')?.value,'keep');
});


test('Discover discards existing IdP and parent-domain identity cookies from its fresh conversation',async()=>{
 const f=fixture({oldIdentityCookies:true});
 await resolveDiscoverLogin(f.runtime,entry);
 assert.equal(f.callbackCount,1);
 const records=JSON.parse(f.jar.serialize());
 assert.ok(records.some((cookie:any)=>cookie.name==='JSESSIONID'&&cookie.value==='old-account'));
 assert.ok(records.some((cookie:any)=>cookie.name==='parent_identity'&&cookie.value==='old-account'));
});

test('Discover refuses a valid-looking SAML response that skipped native account authentication',async()=>{
 const f=fixture({oldIdentityCookies:true,skipNative:true});
 await assert.rejects(resolveDiscoverLogin(f.runtime,entry),{code:'GATEWAY_SERVICE_FORM_REJECTED'});
 assert.equal(f.callbackCount,0);assert.equal(f.jar.serialize(),f.initial);
});


test('a language-bearing login returns a canonical single-encoded browser transition',async()=>{
 const f=fixture({language:'zh_CN'});
 const result=await resolveDiscoverLogin(f.runtime,f.flowEntry);
 const url=new URL(result);
 assert.equal(url.searchParams.get('targetUrl'),history);
 assert.equal(url.searchParams.get('ticket'),'library-fixture-ticket');
 assert.equal(url.searchParams.has('lang'),false);
 assert.equal(f.callbackCount,1);
});
