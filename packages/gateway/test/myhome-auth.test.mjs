import test from 'node:test';
import assert from 'node:assert/strict';
import { MYHOME_ORIGIN, MYHOME_IDENTITY_URL, normalizeMyhomeCallback } from '../src/myhomeAuth.mjs';

const http='http://myhome.tsinghua.edu.cn';
const ticket='official-ticket-012345';

test('MyHome accepts only its registered service root and retains the HTTP wire callback',()=>{
 assert.equal(MYHOME_IDENTITY_URL,'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/0a993de7e533cd43a594459abdcab27d/1');
 for(const slash of ['/','//']){
  const value=http+slash+'?ticket='+ticket;
  assert.equal(normalizeMyhomeCallback(value),value);
  assert.equal(normalizeMyhomeCallback(MYHOME_ORIGIN+slash+'?ticket='+ticket),value);
 }
 const encoded=MYHOME_ORIGIN+'//?ticket=official%2Btoken%2Fwith%3D%3D';
 assert.equal(normalizeMyhomeCallback(encoded),http+'//?ticket=official%2Btoken%2Fwith%3D%3D');
});

test('MyHome refuses arbitrary hosts, paths, credentials, ports and extra parameters',()=>{
 const valid=http+'/?ticket='+ticket;
 for(const value of [
  valid.replace('myhome.','other.'),valid.replace('myhome.tsinghua.edu.cn','myhome.tsinghua.edu.cn.evil.test'),
  valid.replace('myhome.tsinghua.edu.cn','user@myhome.tsinghua.edu.cn'),valid.replace(http,http+':80'),
  valid.replace('http:','ftp:'),valid.replace('/?','/web_netweb_user/noLogin.aspx?'),
  valid.replace('/?','///?'),valid.replace('/?','/%2f?'),valid.replace('/?','/./?'),
  valid+'&ticket=second',valid+'&returnto=https%3A%2F%2Fevil.test',valid+'#fragment',
  valid.replace('ticket=','code='),valid.replace('ticket=','Ticket='),
  valid.replace(ticket,''),valid.replace(ticket,'ERROR'),valid.replace(ticket,'BAD_CREDENTIALS'),
  valid.replace(ticket,'a'.repeat(4097)),valid.replace(ticket,'one%0d%0atwo'),valid.replace(ticket,'one%250atwo'),
  valid.replace(ticket,'one%5ctwo'),valid.replace(ticket,'one%255ctwo'),valid+'\n',
 ])assert.equal(normalizeMyhomeCallback(value),null,value);
 assert.equal(normalizeMyhomeCallback(null),null);
});
