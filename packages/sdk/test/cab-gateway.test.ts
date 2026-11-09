import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeTransport} from '../src/node/transport.js';
import {createCampusProxySession} from '../src/node/campusProxy.js';
import {CAB_ORIGIN,parseCabIdentity} from '@onethu/gateway/cab-auth';
import {webvpnWrap} from '@onethu/core';
const tokenUrl=CAB_ORIGIN+'/ic-web//auth/token?uuid='+'1'.repeat(32);
const entry=CAB_ORIGIN+'/authcenter/toLoginPage?redirectUrl='+encodeURIComponent(tokenUrl)+'&extInfo=';
const identity='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/979ef8ab2cb121846385bad28db48fac/0?/authcenter/doAuth/'+'2'.repeat(32);
const callback=CAB_ORIGIN+'/authcenter/doAuth/'+'2'.repeat(32)+'?ticket=official-fixture';
const documentRequest={headers:{'sec-fetch-dest':'document'}};

test('cab redeems the exact original callback and UUID before letting the official app initialize',async t=>{
 const calls:string[]=[];
 const fetch=async(input:any)=>{
  calls.push(input);
  if(input===webvpnWrap(entry))return new Response(null,{status:302,headers:{location:identity}});
  if(input===webvpnWrap(callback))return new Response(null,{status:302,headers:{location:webvpnWrap(tokenUrl)}});
  if(input===webvpnWrap(tokenUrl))return new Response(null,{status:302,headers:{location:webvpnWrap(CAB_ORIGIN+'/')}});
  if(input===webvpnWrap(CAB_ORIGIN+'/'))return new Response('official app');
  assert.equal(input,webvpnWrap(CAB_ORIGIN+'/ic-web/auth/userInfo'));return Response.json({code:0,data:{pid:'1234',token:'official-user-token'}});
 };
 const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},fetch});t.after(()=>transport.close());
 const proxy=createCampusProxySession({fetch:transport.fetch,fetchWithoutSession:fetch,epoch:()=>1,assertCurrent(){},session:{username:'1234'},status:()=>({authenticated:true}),http:{jar:transport.jar},requestCabCallback:async(e:string,i:string)=>{assert.equal(e,entry);assert.equal(i,identity);return callback;}} as any,[CAB_ORIGIN]);
 const response=await proxy.request(entry,documentRequest);
 assert.equal(response.status,200);assert.match(await response.text(),/http-equiv="refresh"/);
 assert.ok(calls.includes(webvpnWrap(tokenUrl)));
 assert.ok(parseCabIdentity(entry,identity));
 await assert.rejects(proxy.request(callback,documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
 await assert.rejects(proxy.request(tokenUrl,documentRequest),{code:'GATEWAY_AUTH_REQUIRED'});
});

test('cab does not start a private exchange for unbound or non-document requests',async t=>{
 let calls=0;const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},fetch:async()=>{calls++;throw Error('unexpected');}});t.after(()=>transport.close());
 const proxy=createCampusProxySession({fetch:transport.fetch,epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:transport.jar}} as any,[CAB_ORIGIN]);
 for(const [url,init] of [[entry,{}],[entry,{method:'POST',body:'foreign'}],[entry+'&other=value',documentRequest]] as const){
  await assert.rejects(proxy.request(url,init),{code:'GATEWAY_AUTH_REQUIRED'});
 }
 assert.equal(calls,0);
});

test('a wrong-account cab response leaves the shared service cookies unchanged',async t=>{
 const fetch=async(input:any)=>{
  if(input===webvpnWrap(entry))return new Response(null,{status:302,headers:{location:identity}});
  if(input===webvpnWrap(callback))return new Response(null,{status:302,headers:{location:webvpnWrap(tokenUrl),'set-cookie':'cab_session=wrong-account; Path=/; HttpOnly'}});
  if(input===webvpnWrap(tokenUrl))return new Response('complete');
  return Response.json({code:0,data:{pid:'9999'}});
 };
 const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},fetch});t.after(()=>transport.close());
 transport.jar.setRaw(new URL(CAB_ORIGIN),'cab_session=original; Path=/; HttpOnly');const before=transport.jar.serialize();
 const proxy=createCampusProxySession({fetch:transport.fetch,fetchWithoutSession:fetch,epoch:()=>1,assertCurrent(){},session:{username:'1234'},status:()=>({authenticated:true}),http:{jar:transport.jar},requestCabCallback:async()=>callback} as any,[CAB_ORIGIN]);
 await assert.rejects(proxy.request(entry,documentRequest),{code:'GATEWAY_SESSION_CHANGED'});
 assert.equal(transport.jar.serialize(),before);
});
