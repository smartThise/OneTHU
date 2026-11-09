import test from 'node:test';
import assert from 'node:assert/strict';
import { XIAODA_ORIGIN, XIAODA_IDENTITY_URL, parseXiaodaLogin, normalizeXiaodaCallback, xiaodaCallbackUrl, parseXiaodaTokenExchange } from '../src/xiaodaAuth.mjs';

const login = redirect => XIAODA_ORIGIN + '/login?' + new URLSearchParams({ redirect });

test('Qingxiaoda website reuses the registered mini-program ITS service and retains a local return path', () => {
  assert.equal(XIAODA_IDENTITY_URL,'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html');
  assert.equal(parseXiaodaLogin(XIAODA_ORIGIN+'/login').redirectPath,'/');
  assert.equal(parseXiaodaLogin(login('/')).redirectUrl,XIAODA_ORIGIN+'/');
  const path='/chat/conversation/agent?query=%E6%95%B0%E6%8D%AE%20%E7%BB%93%E6%9E%84&mode=read#answer';
  const parsed=parseXiaodaLogin(login(path));
  assert.equal(parsed.redirectPath,path);assert.equal(parsed.redirectUrl,XIAODA_ORIGIN+path);
});

test('Qingxiaoda return paths reject external authorities, controls, nested escaping and recursive authentication', () => {
  for (const path of ['https://evil.example/','//evil.example/','/\\evil.example/','/%2f%2fevil.example/','/%252f%252fevil.example/',
    '/chat?x=%0d%0aHeader','/chat?x=%2500','/login','/login?redirect=/','/login.html?ticket=x','/api/token/login?ticket=x','/api/token/logout',
    '/api%2ftoken%2flogout','/x/../login','/%2e%2e/login','/chat\n']) {
    assert.equal(parseXiaodaLogin(login(path)),null,path);
  }
  for (const input of [login('/')+'&redirect=%2Fchat',login('/')+'&changeLoginType=1',login('/')+'#fragment',login('/').replace('https:','http:'),login('/').replace(XIAODA_ORIGIN,'https://user@www.xiaoda.tsinghua.edu.cn')]) assert.equal(parseXiaodaLogin(input),null);
});

test('Qingxiaoda callback shape is normalized without changing the actual ticket', () => {
  const ticket='official+ticket/with==';
  const callback=xiaodaCallbackUrl(ticket);
  assert.equal(new URL(callback).searchParams.get('ticket'),ticket);
  assert.equal(normalizeXiaodaCallback(callback),callback);
  for (const value of ['', 'ERROR','BAD_CREDENTIALS','with space','line\nbreak','x'.repeat(4097)]) assert.equal(xiaodaCallbackUrl(value),null);
  for (const input of [callback+'&ticket=other',callback+'&type=0',callback.replace('/login.html','/login.html/'),callback.replace('https:','http:'),callback.replace('www.xiaoda.tsinghua.edu.cn','evil.example')]) assert.equal(normalizeXiaodaCallback(input),null);
});

test('Qingxiaoda official exchange accepts only its ticket and fixed web type', () => {
  const base=XIAODA_ORIGIN+'/api/token/login?';
  assert.deepEqual(parseXiaodaTokenExchange(base+'ticket=official-fixture&type=0'),{ticket:'official-fixture',type:0});
  assert.deepEqual(parseXiaodaTokenExchange(base+'ticket=official-fixture'),{ticket:'official-fixture',type:0});
  for (const query of ['ticket=a&type=3','ticket=a&type=0&type=0','ticket=a&ticket=b','ticket=a&redirect=https://evil.example/','type=0']) assert.equal(parseXiaodaTokenExchange(base+query),null);
});
