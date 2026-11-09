import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar, webvpnWrap } from '@onethu/core';
import { mergeServiceCookies } from '../src/node/serviceCookies.js';

const origin='https://cab.lib.tsinghua.edu.cn';
const set=(jar:MemoryCookieJar,url:string,cookie:string)=>jar.setRaw(new URL(url),cookie);
function clone(jar:MemoryCookieJar){const value=new MemoryCookieJar();value.hydrate(jar.serialize());return value;}
const value=(jar:MemoryCookieJar,url:string,name:string)=>jar.getCookies(new URL(url)).find(cookie=>cookie.name===name)?.value;

test('service cookie commit accepts the exact host and both scoped WebVPN schemes',()=>{
 const shared=new MemoryCookieJar(),candidate=clone(shared),before=shared.serialize();
 for(const url of [origin,webvpnWrap(origin+'/'),webvpnWrap(origin.replace('https:','http:')+'/')]){
  const parsed=new URL(url);set(candidate,url,'service=accepted; Path='+parsed.pathname+'; Secure; HttpOnly');
 }
 set(candidate,'https://info.tsinghua.edu.cn','info=ignored; Path=/');
 set(candidate,'https://webvpn.tsinghua.edu.cn/','gateway=ignored; Path=/');
 set(candidate,origin,'parent=ignored; Domain=tsinghua.edu.cn; Path=/');
 set(candidate,webvpnWrap('https://seat.lib.tsinghua.edu.cn/'),'seat=ignored; Path='+new URL(webvpnWrap('https://seat.lib.tsinghua.edu.cn/')).pathname);
 mergeServiceCookies(shared,candidate,before,origin);
 const records=JSON.parse(shared.serialize());
 assert.equal(records.length,3);
 assert.ok(records.every((cookie:any)=>cookie.name==='service'));
});

test('service cookie commit preserves concurrent updates and unrelated sessions',()=>{
 const shared=new MemoryCookieJar();
 set(shared,origin,'auth=before; Path=/');set(shared,origin,'deleted=before; Path=/');
 set(shared,'https://info.tsinghua.edu.cn','info=keep; Path=/');
 const before=shared.serialize(),candidate=clone(shared);
 set(candidate,origin,'auth=candidate; Path=/');set(candidate,origin,'deleted=; Max-Age=0; Path=/');set(candidate,origin,'new=candidate; Path=/');
 set(shared,origin,'auth=newer; Path=/');set(shared,origin,'deleted=newer; Path=/');set(shared,origin,'new=newer; Path=/');
 mergeServiceCookies(shared,candidate,before,origin);
 assert.equal(value(shared,origin,'auth'),'newer');assert.equal(value(shared,origin,'deleted'),'newer');assert.equal(value(shared,origin,'new'),'newer');
 assert.equal(value(shared,'https://info.tsinghua.edu.cn','info'),'keep');
});

test('service cookie commit applies verified updates and deletions when the baseline still matches',()=>{
 const shared=new MemoryCookieJar();set(shared,origin,'auth=before; Path=/');set(shared,origin,'deleted=before; Path=/');
 const before=shared.serialize(),candidate=clone(shared);
 set(candidate,origin,'auth=after; Path=/');set(candidate,origin,'deleted=; Max-Age=0; Path=/');set(candidate,origin,'new=added; Path=/');
 mergeServiceCookies(shared,candidate,before,origin);
 assert.equal(value(shared,origin,'auth'),'after');assert.equal(value(shared,origin,'deleted'),undefined);assert.equal(value(shared,origin,'new'),'added');
});
