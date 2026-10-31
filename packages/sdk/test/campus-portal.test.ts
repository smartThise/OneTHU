import test from 'node:test';
import assert from 'node:assert/strict';
import { webvpnWrap, type HttpClient } from '@onethu/core';
import { resolveCampusPortal } from '../../core/src/info/campusPortal.js';
import { isCampusDirectAddress } from '../src/node/campusDirect.js';

const selector='00112233445566778899aabbccddeeff';
const form='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/00112233445566778899aabbccddeeff/0';
const context={csrf:'fixture-csrf',fingerprint:'existing-device',finger3:'existing-trust',assertCurrent(){}};
const redirect=(location:string)=>new Response(null,{status:302,headers:{location}});

test('official Info OAuth inforoam exchanges the existing portal ticket without entering a separate browser login',async()=>{
 const calls:string[]=[];
 const http={request:async(url:string,init:RequestInit={})=>{
  calls.push(url);assert.notEqual(init.method,'POST');
  if(url.toLowerCase().includes('onlineappredirect'))return Response.json({object:{roamingurl:'https://oauth.tsinghua.edu.cn/thu-oauth/inforoam?appid=fixture&amp;ticket=fixture-ticket'}});
  const u=new URL(url);assert.equal(u.pathname,'/thu-oauth/inforoam');assert.equal(u.searchParams.get('ticket'),'fixture-ticket');
  return redirect('https://cloud.tsinghua.edu.cn/accounts/complete?ticket=service-ticket');
 }} as unknown as HttpClient;
 const result=await resolveCampusPortal(http,selector,context);
 assert.equal(result.origin,'https://cloud.tsinghua.edu.cn');assert.equal(calls.length,2);
 assert(calls.every(url=>!url.includes('checkSingle')));
});

test('previously unknown campus applications use one generic cookie/trust SSO flow',async()=>{
 for(const host of ['future-service.tsinghua.edu.cn','another-new.cic.tsinghua.edu.cn']){
  const calls:{url:string;init:RequestInit}[]=[];
  const callback=`https://${host}/sso/callback?ticket=fixture-only`;
  const http={request:async(url:string,init:RequestInit={})=>{
   calls.push({url,init});
   if(url.toLowerCase().includes('onlineappredirect'))return Response.json({object:{roamingurl:webvpnWrap(`https://${host}/`)}});
   if(url===webvpnWrap(`https://${host}/`))return redirect(form);
   if(url===form)return new Response('<form action="/do/off/ui/auth/login/checkSingle"></form>');
   if(url.endsWith('/checkSingle'))return redirect(webvpnWrap(callback));
   throw new Error('unexpected request');
  }} as unknown as HttpClient;
  const result=await resolveCampusPortal(http,selector,context);
  assert.equal(result.url,callback);assert.equal(result.origin,`https://${host}`);
  const posts=calls.filter(call=>call.init.method==='POST');assert.equal(posts.length,1);
  const fields=new URLSearchParams(String(posts[0]!.init.body));
  assert.equal(fields.get('fingerPrint'),'existing-device');assert.equal(fields.get('fingerGenPrint'),'existing-trust');
  assert.equal(fields.has('i_pass'),false);assert.equal(fields.has('i_user'),false);
  assert.equal(calls.some(call=>call.url===callback),false,'one-use callback is consumed by the intended service browser');
 }
});

test('external targets and a different service callback cannot borrow identity',async()=>{
 for(const target of ['https://outside.test/','http://127.0.0.1/','https://evil.tsinghua.edu.cn.outside.test/','https://user@service.tsinghua.edu.cn/']){
  let calls=0;const http={request:async()=>{calls++;return Response.json({object:{roamingurl:target}});}} as unknown as HttpClient;
  await assert.rejects(resolveCampusPortal(http,selector,context),/TARGET_REJECTED/);assert.equal(calls,1);
 }
 let calls=0;
 const http={request:async(url:string)=>{
  calls++;if(url.toLowerCase().includes('onlineappredirect'))return Response.json({object:{roamingurl:'https://service.tsinghua.edu.cn/'}});
  if(url===webvpnWrap('https://service.tsinghua.edu.cn/'))return redirect(form);
  return redirect('https://other.tsinghua.edu.cn/callback?ticket=fixture');
 }} as unknown as HttpClient;
 await assert.rejects(resolveCampusPortal(http,selector,context),/CALLBACK_REJECTED/);assert.equal(calls,3);
});

test('an actual second-factor response stops immediately without code delivery or another login',async()=>{
 for(const afterConfirm of [false,true]){
  const posts:string[]=[];
  const http={request:async(url:string,init:RequestInit={})=>{
   if(init.method==='POST')posts.push(url);
   if(url.toLowerCase().includes('onlineappredirect'))return Response.json({object:{roamingurl:form}});
   if(afterConfirm&&url===form)return new Response('<form action="/do/off/ui/auth/login/checkSingle"></form>');
   return new Response('<h1>为保障您的账号安全，本次登录需要进行二次验证</h1><label>TOTP动态验证码</label>');
  }} as unknown as HttpClient;
  await assert.rejects(resolveCampusPortal(http,selector,context),/CAMPUS_SERVICE_VERIFICATION_REQUIRED/);
  assert.equal(posts.length,afterConfirm?1:0);assert(posts.every(url=>url.endsWith('/checkSingle')));
 }
});

test('credential pages, arbitrary selectors and account changes never replay a password',async()=>{
 const methods:string[]=[];
 const http={request:async(url:string,init:RequestInit={})=>{
  methods.push(init.method??'GET');return url.toLowerCase().includes('onlineappredirect')?Response.json({object:{roamingurl:form}}):new Response('<input name="i_pass"><div id="sm2publicKey"></div>');
 }} as unknown as HttpClient;
 await assert.rejects(resolveCampusPortal(http,selector,context),/IDENTITY_REQUIRED/);
 assert.deepEqual(methods,['GET','GET']);
 await assert.rejects(resolveCampusPortal(http,'https://id.tsinghua.edu.cn/',context),/SELECTOR_REJECTED/);
 await assert.rejects(resolveCampusPortal(http,selector,{...context,assertCurrent(){throw new Error('AUTH_SESSION_CHANGED');}}),/AUTH_SESSION_CHANGED/);
 assert.equal(methods.length,2);
});

test('direct HTTPS routing excludes local and private destinations while retaining TUN fake-IP support',()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.31.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(isCampusDirectAddress(address),false,address);
 for(const address of ['166.111.4.100','198.18.0.27','2001:4860:4860::8888'])assert.equal(isCampusDirectAddress(address),true,address);
});
