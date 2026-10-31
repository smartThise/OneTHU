import test from 'node:test';
import assert from 'node:assert/strict';
import { webvpnWrap, type CookieRecord } from '@onethu/core';
import { mergeSelectionCookies, mergeUniversityCookies } from '@onethu/core';
import { createXkSessionProvider } from '../../../apps/desktop/src/lib/xkSession.js';

const cookie=(domain:string,value:string,path='/'):CookieRecord=>({domain,name:'JSESSIONID',value,path,secure:true,hostOnly:true});

test('physical selection cookies replace stale logical shadows while preserving all unrelated current state',()=>{
 const current=[cookie('cloud.tsinghua.edu.cn','current-cloud'),cookie('learn.tsinghua.edu.cn','current-learn'),cookie('id.tsinghua.edu.cn','current-id'),cookie('zhjwxk.cic.tsinghua.edu.cn','old','/restricted')];
 const incoming=[cookie('cloud.tsinghua.edu.cn','stale-cloud'),cookie('id.tsinghua.edu.cn','stale-id'),cookie('webvpn.tsinghua.edu.cn','new-selection',new URL(webvpnWrap('http://zhjwxk.cic.tsinghua.edu.cn/')).pathname),
  {...cookie('webvpn.tsinghua.edu.cn','stale-gateway'),name:'wengine_vpn_ticket'}];
 const merged=mergeSelectionCookies(current,incoming,false);
 assert(merged.changed);assert(!merged.cookies.some(c=>c.value==='old'||c.value==='stale-cloud'||c.value==='stale-id'||c.value==='stale-gateway'));
 assert(merged.cookies.some(c=>c.domain==='zhjwxk.cic.tsinghua.edu.cn'&&c.value==='new-selection'&&!c.secure&&c.path==='/'));
 for(const value of ['current-cloud','current-learn','current-id'])assert(merged.cookies.some(c=>c.value===value));
 assert.equal(mergeSelectionCookies(merged.cookies,incoming,false).changed,false);
});

test('ID renewal is explicitly scoped and keeps exact path semantics',()=>{
 const physical=cookie('webvpn.tsinghua.edu.cn','renewed',new URL(webvpnWrap('https://id.tsinghua.edu.cn/do/off')).pathname);
 const current=[cookie('id.tsinghua.edu.cn','old','/do/off/ui'),cookie('info.tsinghua.edu.cn','info')];
 assert.equal(mergeSelectionCookies(current,[physical],false).changed,false);
 const merged=mergeSelectionCookies(current,[physical],true);
 assert(!merged.cookies.some(c=>c.value==='old'));assert(merged.cookies.some(c=>c.domain==='id.tsinghua.edu.cn'&&c.path==='/do/off'));
 assert(merged.cookies.some(c=>c.value==='info'));
 assert.equal(mergeSelectionCookies(current,[],true).changed,false);
});

test('the completed isolated selection transaction overrides an older native copy',()=>{
 const native=[cookie('info.tsinghua.edu.cn','live-info'),cookie('zhjwxk.cic.tsinghua.edu.cn','older-native-selection'),cookie('cloud.tsinghua.edu.cn','live-cloud')];
 const isolated=[cookie('info.tsinghua.edu.cn','old-isolated-info'),cookie('zhjwxk.cic.tsinghua.edu.cn','completed-selection')];
 const snapshot=mergeSelectionCookies(native,isolated,false).cookies;
 assert(!snapshot.some(c=>c.value==='older-native-selection'||c.value==='old-isolated-info'));
 const current=[cookie('cloud.tsinghua.edu.cn','resident-cloud'),cookie('info.tsinghua.edu.cn','resident-info')];
 const adopted=mergeSelectionCookies(current,snapshot,false).cookies;
 for(const value of ['completed-selection','resident-cloud','resident-info'])assert(adopted.some(c=>c.value===value));
});

test('a verified live university renewal preserves resident cloud, mail and selection cookies',()=>{
 const current=[cookie('cloud.tsinghua.edu.cn','cloud'),cookie('mails.tsinghua.edu.cn','mail'),cookie('zhjwxk.cic.tsinghua.edu.cn','selection'),cookie('info.tsinghua.edu.cn','old-info'),
  {...cookie('webvpn.tsinghua.edu.cn','old-gateway'),name:'wengine_vpn_ticket'}];
 const incoming=[cookie('info.tsinghua.edu.cn','live-info'),cookie('cloud.tsinghua.edu.cn','stale-cloud'),cookie('zhjwxk.cic.tsinghua.edu.cn','stale-selection'),
  {...cookie('webvpn.tsinghua.edu.cn','live-gateway'),name:'wengine_vpn_ticket'}];
 const merged=mergeUniversityCookies(current,incoming);
 for(const value of ['cloud','mail','selection','live-info','live-gateway'])assert(merged.cookies.some(c=>c.value===value));
 for(const value of ['old-info','old-gateway','stale-cloud','stale-selection'])assert(!merged.cookies.some(c=>c.value===value));
});

test('a cached GUI selection context reads current credentials and rejects use after its owner changes',()=>{
 let identity={username:'one',password:'',fingerprint:'device-one',finger3:'old-trust'};
 const provider=createXkSessionProvider({http:{} as any,identity:()=>identity});
 const first=provider();identity={...identity,password:'new-in-memory-password',finger3:''};
 assert.equal(provider(),first);assert.equal(first.password,'new-in-memory-password');assert.equal(first.finger3,'');
 identity={username:'two',password:'different',fingerprint:'device-two',finger3:'other-trust'};
 assert.notEqual(provider(),first);assert.throws(()=>first.password,{code:'AUTH_SESSION_CHANGED'});
 assert.equal(provider().username,'two');
 const second=provider();identity={...identity,fingerprint:'new-device'};assert.notEqual(provider(),second);
 assert.throws(()=>second.finger3,{code:'AUTH_SESSION_CHANGED'});
});
