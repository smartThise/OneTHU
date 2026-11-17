import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar, webvpnWrap } from '@onethu/core';
import { createCampusProxySession } from '../src/node/campusProxy.js';
import { createClientIdentity } from '../src/node/clientIdentity.js';

const origin='https://info.tsinghua.edu.cn';
const target=origin+'/f/info/gxfw_fg/common/index?view=fixture';
const documentRequest={headers:{'sec-fetch-dest':'document','sec-fetch-mode':'navigate'}};
const expired=()=>new Response(null,{status:302,headers:{location:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0'}});
const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));

function fixture(prepare:(signal?:AbortSignal)=>Promise<void>,fetch:()=>Promise<Response>){
  let epoch=1;
  const requested:string[]=[];
  let warnings=0,preparations=0;
  const runtime={
    epoch:()=>epoch,
    assertCurrent(value:number){if(value!==epoch)throw Object.assign(new Error('changed'),{code:'AUTH_SESSION_CHANGED'});},
    status:()=>({authenticated:true}),
    http:{jar:new MemoryCookieJar()},
    session:{username:'fixture-account',fingerprint:'fixture-device'},
    fetch:async(url:string)=>{requested.push(url);return fetch();},
    ensureCampusService:async(service:string,signal?:AbortSignal)=>{assert.equal(service,origin);preparations++;await prepare(signal);},
    noteInfoSessionRequired(){warnings++;},
  };
  return {proxy:createCampusProxySession(runtime as any,[origin]),requested,
    preparations:()=>preparations,warnings:()=>warnings,rotate(){epoch++;}};
}

test('an expired Info document renews once and retries the exact original GET',async()=>{
  let ready=false;
  const f=fixture(async()=>{ready=true;},async()=>ready?new Response('<h1>Info</h1>'):expired());
  const response=await f.proxy.request(target,documentRequest);
  assert.equal(await response.text(),'<h1>Info</h1>');
  assert.equal(f.preparations(),1);
  assert.deepEqual(f.requested,[webvpnWrap(target),webvpnWrap(target)]);
});

test('Info background reads and submitted forms never start renewal or replay',async()=>{
  for(const request of [{headers:{'sec-fetch-dest':'empty'}},{...documentRequest,method:'POST',body:'fixture=form'}]){
    const f=fixture(async()=>{throw new Error('unexpected renewal');},async()=>expired());
    await assert.rejects(f.proxy.request(target,request),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
    assert.equal(f.preparations(),0);
    assert.equal(f.requested.length,1);
  }
});

test('concurrent Info documents join one renewal and a cancelled waiter leaves the others running',async()=>{
  let ready=false,release!:()=>void;
  const f=fixture(()=>new Promise(resolve=>{release=()=>{ready=true;resolve();};}),async()=>ready?new Response('ready'):expired());
  const controller=new AbortController();
  const first=f.proxy.request(target,{...documentRequest,signal:controller.signal});
  const failed=assert.rejects(first,{code:'GATEWAY_CANCELLED'});
  const second=f.proxy.request(target,documentRequest);
  await turn();
  assert.equal(f.preparations(),1);
  controller.abort();await failed;
  release();
  assert.equal(await(await second).text(),'ready');
  assert.equal(f.requested.length,3);
});

test('a failed Info renewal remains bounded and a second failure is never replayed again',async()=>{
  const f=fixture(async()=>{},async()=>expired());
  await assert.rejects(f.proxy.request(target,documentRequest),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
  assert.equal(f.preparations(),1);
  assert.equal(f.requested.length,2);
  await assert.rejects(f.proxy.request(target,documentRequest),{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
  assert.equal(f.preparations(),1);
  assert.equal(f.requested.length,3);
});

test('a stalled Info recovery expires without a second network request',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(()=>new Promise(()=>{}),async()=>expired());
  const result=f.proxy.request(target,documentRequest);
  const failed=assert.rejects(result,{code:'GATEWAY_IDENTITY_SESSION_REQUIRED'});
  await turn();t.mock.timers.tick(25_000);await failed;
  assert.equal(f.requested.length,1);
});

test('an account change retires Info recovery before retrying its document',async()=>{
  let release!:()=>void;
  const f=fixture(()=>new Promise(resolve=>{release=resolve;}),async()=>expired());
  const result=f.proxy.request(target,documentRequest);
  const failed=assert.rejects(result,{code:'AUTH_SESSION_CHANGED'});
  await turn();f.rotate();release();await failed;
  assert.equal(f.requested.length,1);
});

function broker(){
  let epoch=1;
  const identity=createClientIdentity({epoch:()=>epoch,assertCurrent(value:number){if(value!==epoch)throw new Error('changed');},
    status:()=>({authenticated:true}),session:{username:'fixture-account'},fetchCampusDirect:async()=>new Response()} as any);
  return {identity,rotate(){epoch++;}};
}

test('Info broker requires a verified receipt and cancellation affects one waiter only',async()=>{
  const f=broker();
  try{
    const controller=new AbortController();
    const first=f.identity.renewInfo(controller.signal),failed=assert.rejects(first,{code:'GATEWAY_CANCELLED'});
    const second=f.identity.renewInfo();
    const row=f.identity.desktop.pending()!;
    assert.equal(row.service,'info');assert.equal(f.identity.desktop.pending(),null);
    assert.throws(()=>f.identity.desktop.complete({id:row.id,ok:true}),/CLI_BRIDGE_INVALID/);
    controller.abort();await failed;
    assert.equal(f.identity.desktop.complete({id:row.id,ok:true,infoReady:true}).accepted,true);
    assert.equal(await second,true);
  }finally{f.identity.close();}
});

test('failed or obsolete Info receipts cannot report renewal success',async()=>{
  const f=broker();
  try{
    const first=f.identity.renewInfo(),row=f.identity.desktop.pending()!;
    f.identity.desktop.complete({id:row.id,ok:false});
    assert.equal(await first,false);
    assert.equal(await f.identity.renewInfo(),false);
    f.rotate();
    const stale=f.identity.renewInfo(),staleRow=f.identity.desktop.pending()!;
    const failed=assert.rejects(stale,/changed/);
    f.rotate();
    assert.equal(f.identity.desktop.complete({id:staleRow.id,ok:true,infoReady:true}).accepted,false);
    await failed;
  }finally{f.identity.close();}
});
