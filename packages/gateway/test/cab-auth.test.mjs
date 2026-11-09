import test from 'node:test';
import assert from 'node:assert/strict';
import { CAB_ORIGIN, parseCabAuthEntry, parseCabIdentity, normalizeCabCallback, normalizeCabExchange } from '../src/cabAuth.mjs';

const uuid='00112233445566778899aabbccddeeff';
const redirectUrl=CAB_ORIGIN+'/ic-web//auth/token?uuid='+uuid;
const entry=CAB_ORIGIN+'/authcenter/toLoginPage?'+new URLSearchParams({redirectUrl,extInfo:''});
const form='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/979ef8ab2cb121846385bad28db48fac/0';
const path='/authcenter/doAuth/ffeeddccbbaa99887766554433221100';
const identity=form+'?'+path;
const callback=CAB_ORIGIN+path+'?ticket=official-ticket-012345';

test('cab retains the per-browser UUID and the server-issued identity transaction',()=>{
 assert.deepEqual(parseCabAuthEntry(entry),{entry,redirectUrl});
 assert.deepEqual(parseCabIdentity(entry,identity),{entry,redirectUrl,identityUrl:identity,callbackPath:path});
 assert.equal(normalizeCabCallback(callback,entry,identity),callback);
 assert.equal(normalizeCabCallback(callback.replace('https:','http:'),entry,identity),callback);
 const single=entry.replace('%2F%2Fauth','%2Fauth');assert.ok(parseCabAuthEntry(single));
});

test('cab entry rejects other destinations, duplicate parameters and concealed separators',()=>{
 for(const invalid of [
  entry.replace('https:','http:'),entry.replace(CAB_ORIGIN,CAB_ORIGIN+':443'),
  entry+'&redirectUrl='+encodeURIComponent(redirectUrl),entry+'&unexpected=true',
  entry.replace('extInfo=','extInfo=foreign'),entry.replace(uuid,'not-a-uuid'),
  entry.replace(encodeURIComponent(CAB_ORIGIN),encodeURIComponent('https://evil.example')),
  entry.replace('%2Fauth%2Ftoken','%2Faccount%2Fdelete'),entry+'#fragment',
  entry.replace(uuid,uuid+'%250d%250a'),entry.replace('%2Fic-web','%5c%5cic-web'),
  entry.replace('%3Fuuid%3D','%3Fuuid%3D'+uuid+'%26uuid%3D'),
 ])assert.equal(parseCabAuthEntry(invalid),null,invalid);
});

test('cab identity must be the registered form with its exact callback route',()=>{
 for(const invalid of [
  identity.replace('/0?','/1?'),identity.replace('979ef8ab','00000000'),
  identity.replace(path,'//authcenter/doAuth/'+uuid),identity+'&extra=true',identity+'#fragment',
  identity.replace('/doAuth/','/logout/'),identity.replace(form,form.replace('https:','http:')),
  identity.replace(path,encodeURIComponent(path)),
 ])assert.equal(parseCabIdentity(entry,invalid),null,invalid);
});

test('cab tickets are one transaction only and cannot redirect into another account route',()=>{
 for(const invalid of [
  callback.replace(path,'/authcenter/doAuth/'+uuid),callback.replace(CAB_ORIGIN,'https://evil.example'),
  callback.replace(CAB_ORIGIN,CAB_ORIGIN+':443'),callback.replace('https:','http:').replace('cab.lib','other.lib'),
  callback+'&ticket=second',callback+'&redirectUrl='+encodeURIComponent('https://evil.example'),
  callback.replace('official-ticket-012345','ERROR'),callback.replace('official-ticket-012345',''),
  callback+'#fragment',callback.replace('official-ticket-012345','x%0ay'),
 ])assert.equal(normalizeCabCallback(invalid,entry,identity),null,invalid);
});

test('cab exchanges the official second token only for the original browser UUID',()=>{
 const exchange=CAB_ORIGIN+'/ic-web/auth/token?uuid='+uuid+'&uniToken=official-ticket-012345';
 assert.equal(normalizeCabExchange(exchange,entry),exchange);
 const double=exchange.replace('/ic-web/auth/','/ic-web//auth/');
 assert.equal(normalizeCabExchange(double,entry),double);
 const reordered=CAB_ORIGIN+'/ic-web/auth/token?uniToken=official%2Btoken%2Fwith%3D%3D&uuid='+uuid;
 assert.equal(normalizeCabExchange(reordered,entry),reordered);
});

test('cab exchange rejects another UUID, origin, token field, or request shape',()=>{
 const exchange=CAB_ORIGIN+'/ic-web/auth/token?uuid='+uuid+'&uniToken=official-ticket-012345';
 for(const invalid of [
  exchange.replace('https:','http:'),exchange.replace(CAB_ORIGIN,'https://other.lib.tsinghua.edu.cn'),
  exchange.replace(CAB_ORIGIN,CAB_ORIGIN+':443'),exchange.replace('/ic-web/auth/','/ic-web///auth/'),
  exchange.replace(uuid,'ffeeddccbbaa99887766554433221100'),exchange.replace('uuid='+uuid+'&',''),
  exchange+'&uuid='+uuid,exchange+'&uniToken=another',exchange+'&extInfo=',exchange+'#fragment',
  exchange.replace('official-ticket-012345',''),exchange.replace('official-ticket-012345','ERROR'),
  exchange.replace('official-ticket-012345','line%0dbreak'),exchange.replace('official-ticket-012345','nested%250abreak'),
  exchange.replace('official-ticket-012345','a'.repeat(4097)),exchange.replace('uniToken','ticket'),
 ])assert.equal(normalizeCabExchange(invalid,entry),null,invalid);
 assert.equal(normalizeCabExchange(exchange,'not-an-entry'),null);
});
