import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar, webvpnWrap } from '@onethu/core';
import { createCampusProxySession } from '../src/node/campusProxy.js';

const infoOrigin = 'https://info.tsinghua.edu.cn';
const selectionOrigin = 'https://zhjwxk.cic.tsinghua.edu.cn';
const selector = 'A7298655396722EF78BA5B5FB0B5482A';
const businessHome = '/xkBks.vxkBksXkbBs.do?m=main';
const selectionEntry = `${infoOrigin}/f/info/portal_fg/teacher/roamingToApp?yyfwid=${selector}&bz=app`;
const resolvedService = {
  url: selectionOrigin + businessHome,
  origin: selectionOrigin,
  upstreamOrigin: 'http://zhjwxk.cic.tsinghua.edu.cn',
  transport: 'webvpn' as const,
};

function campusError(code: string) {
  return Object.assign(new Error(code), { code });
}

function fixture(options: {
  resolve: (value: string) => Promise<typeof resolvedService>;
  prepare: (origin: string) => Promise<void>;
}) {
  let epoch = 1;
  const fetched: string[] = [];
  const runtime = {
    epoch: () => epoch,
    assertCurrent(value: number) {
      if (value !== epoch) throw campusError('AUTH_SESSION_CHANGED');
    },
    status: () => ({ authenticated: true }),
    http: { jar: new MemoryCookieJar() },
    resolveCampusPortal: options.resolve,
    ensureCampusService: options.prepare,
    async fetch(url: string) {
      fetched.push(url);
      return new Response('<iframe src="/xk/top.html"></iframe>');
    },
  };
  return {
    proxy: createCampusProxySession(runtime as any, [infoOrigin]),
    fetched,
    rotate() { epoch++; },
  };
}

test('the official selection portal retries its original selector after one service preparation', async () => {
  const selected: string[] = [];
  const prepared: string[] = [];
  const f = fixture({
    async resolve(value) {
      selected.push(value);
      if (selected.length === 1) throw campusError('CAMPUS_SERVICE_IDENTITY_REQUIRED');
      return resolvedService;
    },
    async prepare(origin) { prepared.push(origin); },
  });

  const response = await f.proxy.request(selectionEntry, { headers: { 'sec-fetch-dest': 'document' } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /http-equiv="refresh"/);
  assert.deepEqual(selected, [selector, selector]);
  assert.deepEqual(prepared, [selectionOrigin]);
  assert.equal(f.proxy.authorizeTarget(selectionOrigin), true);
  assert.match(await (await f.proxy.request(selectionOrigin + businessHome)).text(), /xk\/top.html/);
  assert.deepEqual(f.fetched, [webvpnWrap('http://zhjwxk.cic.tsinghua.edu.cn' + businessHome)]);
});

test('other portal applications and verification challenges cannot trigger selection preparation', async () => {
  for (const current of [
    { id: '00112233445566778899aabbccddeeff', code: 'CAMPUS_SERVICE_IDENTITY_REQUIRED', expected: 'GATEWAY_IDENTITY_SESSION_REQUIRED' },
    { id: selector, code: 'CAMPUS_SERVICE_VERIFICATION_REQUIRED', expected: 'GATEWAY_VERIFICATION_REQUIRED' },
    { id: selector, code: 'CAMPUS_SERVICE_HTTP_503', expected: 'GATEWAY_SERVICE_SSO_REQUIRED' },
  ]) {
    let resolves = 0;
    let prepares = 0;
    const f = fixture({
      async resolve() { resolves++; throw campusError(current.code); },
      async prepare() { prepares++; },
    });
    await assert.rejects(f.proxy.request(selectionEntry.replace(selector, current.id)), { code: current.expected });
    assert.equal(resolves, 1);
    assert.equal(prepares, 0);
    assert.equal(f.proxy.authorizeTarget(selectionOrigin), false);
  }
});

test('selection preparation cannot repeatedly retry a still-expired identity or authorize a failed result', async () => {
  let resolves = 0;
  let prepares = 0;
  const f = fixture({
    async resolve() { resolves++; throw campusError('CAMPUS_SERVICE_IDENTITY_REQUIRED'); },
    async prepare() { prepares++; },
  });
  await assert.rejects(f.proxy.request(selectionEntry), { code: 'GATEWAY_IDENTITY_SESSION_REQUIRED' });
  assert.equal(resolves, 2);
  assert.equal(prepares, 1);
  assert.equal(f.proxy.authorizeTarget(selectionOrigin), false);
  assert.deepEqual(f.fetched, []);
});

test('a failed selection preparation stops before a second portal request', async () => {
  let resolves = 0;
  let prepares = 0;
  const f = fixture({
    async resolve() { resolves++; throw campusError('CAMPUS_SERVICE_IDENTITY_REQUIRED'); },
    async prepare() { prepares++; throw campusError('CAMPUS_SERVICE_SSO_REQUIRED'); },
  });
  await assert.rejects(f.proxy.request(selectionEntry), { code: 'GATEWAY_SERVICE_SSO_REQUIRED' });
  assert.equal(resolves, 1);
  assert.equal(prepares, 1);
  assert.equal(f.proxy.authorizeTarget(selectionOrigin), false);
});

test('cancellation during the first portal request stops before selection preparation', async () => {
  const controller = new AbortController();
  let prepares = 0;
  const f = fixture({
    async resolve() {
      controller.abort();
      throw campusError('CAMPUS_SERVICE_IDENTITY_REQUIRED');
    },
    async prepare() { prepares++; },
  });
  await assert.rejects(f.proxy.request(selectionEntry, { signal: controller.signal }), { code: 'GATEWAY_CANCELLED' });
  assert.equal(prepares, 0);
  assert.equal(f.proxy.authorizeTarget(selectionOrigin), false);
});

test('cancellation or account change during preparation prevents retry and route publication', async () => {
  for (const change of ['cancel', 'epoch']) {
    const controller = new AbortController();
    let resolves = 0;
    const f = fixture({
      async resolve() { resolves++; throw campusError('CAMPUS_SERVICE_IDENTITY_REQUIRED'); },
      async prepare() {
        if (change === 'cancel') controller.abort();
        else f.rotate();
      },
    });
    await assert.rejects(f.proxy.request(selectionEntry, { signal: controller.signal }), {
      code: change === 'cancel' ? 'GATEWAY_CANCELLED' : 'AUTH_SESSION_CHANGED',
    });
    assert.equal(resolves, 1);
    assert.equal(f.proxy.authorizeTarget(selectionOrigin), false);
    assert.deepEqual(f.fetched, []);
  }
});

test('cancellation while resolving the retried selection entry cannot publish a route', async () => {
  const controller = new AbortController();
  let resolves = 0;
  const f = fixture({
    async resolve() {
      resolves++;
      if (resolves === 1) throw campusError('CAMPUS_SERVICE_IDENTITY_REQUIRED');
      controller.abort();
      return resolvedService;
    },
    async prepare() {},
  });
  await assert.rejects(f.proxy.request(selectionEntry, { signal: controller.signal }), { code: 'GATEWAY_CANCELLED' });
  assert.equal(resolves, 2);
  assert.equal(f.proxy.authorizeTarget(selectionOrigin), false);
  assert.deepEqual(f.fetched, []);
});
