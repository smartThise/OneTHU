import test from 'node:test';
import assert from 'node:assert/strict';
import { webvpnWrap } from '@onethu/core';
import { MADMODEL_ORIGIN as site, MADMODEL_IDENTITY_URL as identity } from '@onethu/gateway/routes';
import { createNodeTransport } from '../src/node/transport.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';

function fixture(fetch:typeof globalThis.fetch=async()=>new Response('application')) {
  let epoch=1,issued=0;
  const transport=createNodeTransport({fetch,epoch:()=>epoch,assertCurrent(value){assert.equal(value,epoch);}});
  const session=createCampusProxySession({
    epoch:()=>epoch,assertCurrent(value:number){assert.equal(value,epoch);},
    status:()=>({authenticated:true}),http:{jar:transport.jar},
    fetch:transport.fetch,fetchCampusDirect:transport.fetch,
    resolveCampusPortal:async()=>{throw new Error('portal unavailable');},
    requestMadmodelTicket:async()=>{issued++;return 'official-fixture-ticket-'+issued;},
  } as any,[site]);
  return {session,close:()=>transport.close(),issued:()=>issued,renewAccount(){epoch++;transport.rotate();}};
}
const documentRequest={headers:{'sec-fetch-dest':'document'}};

test('Madmodel renews through its explicit login entry after the initial page and after account renewal',async t=>{
  const f=fixture();t.after(f.close);
  assert.match(await (await f.session.request(site+'/',documentRequest)).text(),/official-fixture-ticket-1/);
  assert.equal(await (await f.session.request(site+'/',documentRequest)).text(),'application');
  assert.match(await (await f.session.request(site+'/authLogin',documentRequest)).text(),/official-fixture-ticket-2/);
  f.renewAccount();
  assert.match(await (await f.session.request(site+'/',documentRequest)).text(),/official-fixture-ticket-3/);
  assert.equal(f.issued(),3);
});

test('Madmodel renewal accepts only body-free top-level GET navigation',async t=>{
  const f=fixture();t.after(f.close);
  for(const init of [{method:'POST',body:'value',...documentRequest},{headers:{'sec-fetch-dest':'iframe'}},{headers:{accept:'application/json'}}]){
    await assert.rejects(f.session.request(site+'/authLogin',init),{code:'GATEWAY_AUTH_REQUIRED'});
  }
  assert.equal(f.issued(),0);
  assert.equal(await (await f.session.request(site+'/authLogin?ticket=official-ticket',documentRequest)).text(),'application');
  assert.equal(f.issued(),0);
});

test('Madmodel rewrites its exact official login target in both scripts and HTTP redirects',async t=>{
  const f=fixture(async(input)=>{
    if(String(input).endsWith('/redirect'))return new Response(null,{status:302,headers:{location:identity}});
    return new Response('window.location.href='+JSON.stringify(identity),{headers:{'content-type':'application/javascript'}});
  });t.after(f.close);
  const script=await (await f.session.request(site+'/app.js')).text();
  assert.ok(script.includes(site+'/authLogin'));
  assert.ok(!script.includes(identity));
  const redirect=await f.session.request(site+'/redirect',documentRequest);
  assert.equal(redirect.headers.get('location'),site+'/authLogin');
  assert.equal(f.issued(),0);
});

test('Madmodel preserves unrelated identity redirects',async t=>{
  const other=identity.replace('d736f067a6705ab942df52f958a0f23b','084cc75356bf414dcfb0e6e259081f4f');
  const f=fixture(async()=>new Response(null,{status:302,headers:{location:other}}));t.after(f.close);
  const response=await f.session.request(site+'/redirect',documentRequest);
  assert.equal(response.headers.get('location'),other);
});

test('Madmodel computed identity URLs resolve only to the registered local renewal alias',async t=>{
  const f=fixture(async()=>new Response('const identityOrigin="https://id.tsinghua.edu.cn";const login=identityOrigin+"/do/off/ui/auth/login/form/d736f067a6705ab942df52f958a0f23b/0?/authLogin";',{headers:{'content-type':'application/javascript'}}));
  t.after(f.close);
  const source=await(await f.session.request(site+'/app.js')).text();
  assert.ok(source.includes('identityOrigin="'+site+'"'));
  const alias=site+new URL(identity).pathname+new URL(identity).search;
  assert.match(await(await f.session.request(alias,documentRequest)).text(),/official-fixture-ticket-1/);
  assert.equal(f.issued(),1);
  await f.session.request(alias.replace('d736f067a6705ab942df52f958a0f23b','different-application'),documentRequest);
  assert.equal(f.issued(),1);
});

test('concurrent Madmodel renewals each receive their own one-use ticket',async t=>{
  const f=fixture();t.after(f.close);
  const responses=await Promise.all([
    f.session.request(site+'/authLogin',documentRequest),
    f.session.request(site+'/authLogin',documentRequest),
  ]);
  const pages=await Promise.all(responses.map(response=>response.text()));
  assert.match(pages[0]!,/official-fixture-ticket-1/);
  assert.match(pages[1]!,/official-fixture-ticket-2/);
  assert.equal(f.issued(),2);
});

test('Madmodel retains the local login bridge when its portal selects WebVPN transport',async t=>{
  const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},fetch:async(input)=>{
    assert.equal(input,webvpnWrap(site+'/redirect'));
    return new Response(null,{status:302,headers:{location:identity}});
  }});t.after(()=>transport.close());
  const proxy=createCampusProxySession({
    epoch:()=>1,assertCurrent(){},status:()=>({authenticated:true}),http:{jar:transport.jar},
    fetch:transport.fetch,fetchCampusDirect:transport.fetch,
    resolveCampusPortal:async()=>({url:site+'/authLogin?ticket=fixture-portal-ticket',origin:site,upstreamOrigin:site,transport:'webvpn'}),
  } as any,[site]);
  await(await proxy.request(site+'/',documentRequest)).body?.cancel();
  const response=await proxy.request(site+'/redirect',documentRequest);
  assert.equal(response.headers.get('location'),site+'/authLogin');
});
