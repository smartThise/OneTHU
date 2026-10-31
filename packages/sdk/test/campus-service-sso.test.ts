import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, InfoClient, MemoryCookieJar, webvpnWrap } from '@onethu/core';

function fixture(fetch:any){
 const http=new HttpClient({fetch,jar:new MemoryCookieJar()});http.webVPNEncoder=webvpnWrap;
 const client=new InfoClient(http);client.setIdCredentials(()=>({username:'fixture-owner',password:'never-replay',fingerprint:'fingerprint',finger3:'trusted-device'}));
 return {client,http};
}

test('fixed selection/card services confirm existing SSO without replaying credentials',async()=>{
 for(const service of ['selection','card'] as const){
  const calls:{url:URL;method:string;body:string}[]=[],host=service==='selection'?'zhjwxk.cic.tsinghua.edu.cn':'card.tsinghua.edu.cn';
  const {client}=fixture(async(raw:string,init:RequestInit={})=>{
   const url=new URL(raw),method=init.method??'GET',body=String(init.body??'');calls.push({url,method,body});
   if(url.pathname.includes('/login/form/'))return new Response('<form action="/do/off/ui/auth/login/checkSingle"></form>');
   if(url.pathname.endsWith('/login/checkSingle'))return new Response(null,{status:302,headers:{location:`https://${host}/callback?ticket=fixture`}});
   if(url.pathname==='/lb-auth/lbredirect')return new Response('ready');
   throw new Error('unexpected network');
  });
  assert.equal(await client.resumeBrowserService(service),true);
  assert(calls.every(call=>!call.body.includes('never-replay')));
  const posts=calls.filter(call=>call.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0]!.url.pathname,'/do/off/ui/auth/login/checkSingle');
  assert.equal(new URLSearchParams(posts[0]!.body).get('fingerGenPrint'),'trusted-device');
  const consumed=calls.find(call=>call.url.pathname==='/lb-auth/lbredirect')!;
  assert.equal(consumed.url.searchParams.get('host'),host);assert.equal(consumed.url.searchParams.get('scheme'),service==='selection'?'http':'https');
 }
});

test('expired SSO returns false and unknown services or foreign callback targets cannot start credential flows',async()=>{
 const calls:string[]=[];
 const {client}=fixture(async(raw:string,init:RequestInit={})=>{calls.push(init.method??'GET');return new Response('<form><div id="sm2publicKey">fixture</div><input name="i_pass"></form>');});
 for(const service of ['selection','card'] as const)assert.equal(await client.resumeBrowserService(service),false);
 assert.deepEqual(calls,['GET','GET']);
 await assert.rejects(client.resumeBrowserService('https://outside.test/' as any),/CAMPUS_SERVICE_UNSUPPORTED/);assert.equal(calls.length,2);
 for(const target of ['https://outside.test/callback?ticket=fixture','https://learn.tsinghua.edu.cn/callback?ticket=fixture','http://oauth.tsinghua.edu.cn/callback?ticket=fixture']){
  let fetches=0;const f=fixture(async()=>{fetches++;return new Response(null,{status:302,headers:{location:target}});});
  await assert.rejects(f.client.resumeBrowserService('selection'));assert.equal(fetches,1);
 }
});
