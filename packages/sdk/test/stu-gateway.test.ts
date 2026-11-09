import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeTransport } from '../src/node/transport.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';
import { createClientIdentity } from '../src/node/clientIdentity.js';
import { STU_ORIGIN, parseStuAuthEntry } from '@onethu/gateway/stu-auth';
import { validateFetchMetadata } from '@onethu/gateway/policy';

function entry(state='first') {
 const inner='/api/v2/authorize?response_type=code&client_id=RCHFIyPfkGKjXbzxalGZTD79Gl0&redirect_uri='+encodeURIComponent(STU_ORIGIN+'/csnova/oauth_authorized')+'&state='+encodeURIComponent(state);
 return STU_ORIGIN+'/api/user/tsinghua-auth-redirect?returnto='+encodeURIComponent(inner);
}
function callback(url:string,ticket='official-ticket-123456') {
 const params=new URL(url).searchParams;params.set('ticket',ticket);
 return STU_ORIGIN+'/api/user/tsinghua-auth-callback?'+params;
}
const documentRequest={headers:{'sec-fetch-dest':'document',accept:'text/html'}};

test('stu authentication preserves the OAuth transaction and stores the callback cookie in the shared jar',async t=>{
 const url=entry('space + percent%'),parsed=parseStuAuthEntry(url)!;
 const calls:string[]=[];
 const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},fetch:async(input:any,init:any)=>{
  calls.push(input);
  if(input===url)return new Response(null,{status:302,headers:{location:parsed.identityUrl}});
  assert.equal(input,callback(url));assert.equal(init.method,'GET');
  return new Response(null,{status:302,headers:{location:parsed.returnTo,'set-cookie':'stu_session=official; Path=/; Secure; HttpOnly'}});
 }});
 t.after(()=>transport.close());
 const proxy=createCampusProxySession({fetch:transport.fetch,fetchCampusDirect:transport.fetch,http:{jar:transport.jar},epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),requestStuCallback:async(value:string)=>{assert.equal(value,url);return callback(value);}} as any,[STU_ORIGIN]);
 const response=await proxy.request(url,documentRequest);
 assert.equal(response.status,200);
 const html=await response.text();assert.match(html,/http-equiv="refresh"/);assert.ok(html.includes((STU_ORIGIN+parsed.returnTo).replace(/&/g,'&amp;')));
 assert.equal(response.headers.has('set-cookie'),false);
 assert.equal(transport.jar.getCookies(new URL(STU_ORIGIN))[0]?.value,'official');
 assert.deepEqual(calls,[url,callback(url)]);
 await assert.rejects(proxy.request(callback(url),documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
});

test('stu entry only accepts explicit document reads and a verified official identity redirect',async t=>{
 let requests=0,renewals=0;
 const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},fetch:async()=>{requests++;return new Response(null,{status:302,headers:{location:'https://id.tsinghua.edu.cn/other'}});}});
 t.after(()=>transport.close());
 const proxy=createCampusProxySession({fetch:transport.fetch,fetchCampusDirect:transport.fetch,http:{jar:transport.jar},epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),requestStuCallback:async()=>{renewals++;return callback(entry());}} as any,[STU_ORIGIN]);
 for(const init of [{method:'POST',body:'credentials'},{}])await assert.rejects(proxy.request(entry(),init),{code:'GATEWAY_AUTH_REQUIRED'});
 await assert.rejects(proxy.request(entry(),documentRequest),{code:'GATEWAY_SERVICE_SSO_REQUIRED'});
 assert.equal(requests,1);assert.equal(renewals,0);
 const metadata={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
 assert.doesNotThrow(()=>validateFetchMetadata(metadata,new URL(entry()),new Set([STU_ORIGIN]),{method:'GET',hasBody:false}));
 assert.throws(()=>validateFetchMetadata(metadata,new URL(entry().replace('RCHFIy','other')),new Set([STU_ORIGIN]),{method:'GET',hasBody:false}));
});

test('stu broker keeps each tab ticket private and removes cancelled transactions',async()=>{
 let epoch=1;
 const identity=createClientIdentity({epoch:()=>epoch,assertCurrent(value:number){if(value!==epoch)throw new Error('changed');},status:()=>({authenticated:true}),session:{username:'fixture'},fetchCampusDirect:async()=>new Response()} as any);
 try {
  const one=identity.renewStu(entry('one')),two=identity.renewStu(entry('two'));
  const a=identity.desktop.pending()!,b=identity.desktop.pending()!;
  assert.notEqual(a.id,b.id);assert.equal(a.entryUrl,entry('one'));assert.equal(b.entryUrl,entry('two'));
  assert.throws(()=>identity.desktop.complete({id:a.id,ok:true,stuCallback:callback(entry('two'))}),/CLI_BRIDGE_INVALID/);
  identity.desktop.complete({id:b.id,ok:true,stuCallback:callback(entry('two'),'ticket-two')});
  identity.desktop.complete({id:a.id,ok:true,stuCallback:callback(entry('one'),'ticket-one')});
  assert.equal(await one,callback(entry('one'),'ticket-one'));assert.equal(await two,callback(entry('two'),'ticket-two'));
  assert.equal(identity.desktop.complete({id:a.id,ok:true,stuCallback:callback(entry('one'))}).accepted,false);
  const controller=new AbortController();const cancelled=identity.renewStu(entry('cancel'),controller.signal);
  const c=identity.desktop.pending()!;controller.abort();
  await assert.rejects(cancelled,{code:'GATEWAY_CANCELLED'});
  assert.equal(identity.desktop.complete({id:c.id,ok:true,stuCallback:callback(entry('cancel'))}).accepted,false);
  const stale=identity.renewStu(entry('old'));const old=identity.desktop.pending()!;epoch++;
  assert.equal(identity.desktop.complete({id:old.id,ok:true,stuCallback:callback(entry('old'))}).accepted,false);await assert.rejects(stale);
 } finally {identity.close();}
});

test('failed stu renewal backs off without reusing successful tickets',async()=>{
 const identity=createClientIdentity({epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),session:{username:'fixture'},fetchCampusDirect:async()=>new Response()} as any);
 try {
  const first=identity.renewStu(entry());const row=identity.desktop.pending()!;
  identity.desktop.complete({id:row.id,ok:false});assert.equal(await first,null);
  assert.equal(await identity.renewStu(entry()),null);
  assert.equal(identity.desktop.pending(),null);
 } finally {identity.close();}
});
