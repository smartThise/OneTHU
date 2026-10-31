import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sanitizeRequestHeaders } from '../src/policy.mjs';
import { createCampusGateway } from '../src/index.mjs';

const bearer = 'Bearer fixture.header.signature';
test('authorization requires an explicit strict witness option and retains only bounded unambiguous Bearer values', () => {
  const headers = ['Authorization', bearer, 'Proxy-Authorization', 'Basic private', 'Cookie', 'private=1', 'x-onethu-private', 'private'];
  const result = sanitizeRequestHeaders(headers, { allowAuthorization: true });
  assert.equal(result.get('authorization'), bearer);
  for (const name of ['proxy-authorization', 'cookie', 'x-onethu-private']) assert.equal(result.get(name), null);
  assert.equal(sanitizeRequestHeaders(headers).get('authorization'), null);
  for (const allowAuthorization of [false, 'true', 1, {}, Promise.resolve(true)]) assert.equal(sanitizeRequestHeaders(headers, { allowAuthorization }).get('authorization'), null);
  for (const value of ['Basic fixture', 'Bearer', 'Bearer a b', 'Bearer a,b', 'Bearer a:b', 'Bearer a\\b', 'Bearer a%20b', 'Bearer a===', 'Bearer ' + 'a'.repeat(4097)]) {
    assert.equal(sanitizeRequestHeaders(['Authorization', value], { allowAuthorization: true }).get('authorization'), null);
  }
  assert.equal(sanitizeRequestHeaders(['Authorization', bearer, 'authorization', bearer], { allowAuthorization: true }).get('authorization'), null);
  assert.equal(sanitizeRequestHeaders(['Authorization', bearer, 'Connection', 'authorization'], { allowAuthorization: true }).get('authorization'), null);
});

test('kernel requests a target-bound credential witness only after target and browser provenance checks', async t => {
  const origin = 'https://new-service.tsinghua.edu.cn';
  const calls = [], witnesses = [];
  let decision = (url, name, value) => new URL(url).origin === origin && name === 'authorization' && value === bearer;
  const gateway = createCampusGateway({ allowedOrigins: ['https://learn.tsinghua.edu.cn'], authorizeSocket: async () => true,
    session: { epoch: () => 1, assertCurrent() {}, authorizeTarget: url => new URL(url).origin === origin,
      authorizeBrowserCredential: (...args) => { witnesses.push(args); return decision(...args); },
      async request(url, init) { calls.push({ url, init }); return new Response(null, { status: 302, headers: { location: 'https://outside.test/' } }); } } });
  const address = await gateway.listen(); t.after(() => gateway.close());
  const request = (url, site = 'same-origin', authorization = bearer) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ host: address.host, port: address.port, path: target.href, headers: { host: target.host,
      'sec-fetch-site': site, origin: target.origin, authorization, 'proxy-authorization': 'Basic proxy-private' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(await request(origin + '/api?fixture=1'), 302);
  assert.deepEqual(witnesses[0], [origin + '/api?fixture=1', 'authorization', bearer]);
  assert.equal(calls[0].init.headers.get('authorization'), bearer);
  assert.equal(calls[0].init.headers.get('proxy-authorization'), null);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(await request('https://learn.tsinghua.edu.cn/'), 302);
  assert.equal(calls[1].init.headers.get('authorization'), null, 'a witness for one service cannot be used on another');
  assert.equal(await request(origin + '/api', 'cross-site'), 403);
  assert.equal(await request('https://outside.test/'), 403);
  assert.equal(witnesses.length, 2); assert.equal(calls.length, 2);
  for (const invalid of [() => 'true', () => { throw new Error('private witness'); }, () => Promise.resolve(true), () => Promise.reject(new Error('private witness'))]) {
    decision = invalid;
    assert.equal(await request(origin + '/api'), 302);
    assert.equal(calls.at(-1).init.headers.get('authorization'), null);
  }
});
