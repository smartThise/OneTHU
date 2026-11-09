import test from 'node:test';
import assert from 'node:assert/strict';
import { THESIS_ORIGIN, THESIS_IDENTITY_URL } from '@onethu/gateway/thesis-auth';
import { createNodeTransport } from '../src/node/transport.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';

const home = THESIS_ORIGIN + '/home/qh/index';
const callback = THESIS_ORIGIN + '/qh/thesis/tsinghua/Login?ticket=official-fixture-ticket';
const documentRequest = { headers: { 'sec-fetch-dest': 'document', accept: 'text/html' } };
const anonymous = '<div class="topLogin"><a class="cd-popup-trigger0">登录</a></div>';
const logged = '<div class="topLogin"><span>当前读者</span><a href="/qh/thesis/logout">退出</a></div>';
const html = (body: string, cookie?: string) => new Response(body, { headers: {
  'content-type': 'text/html; charset=utf-8', ...(cookie ? { 'set-cookie': cookie } : {}),
} });

function fixture() {
  const calls: string[] = [];
  let renewals = 0;
  let epoch = 1;
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), target = new URL(url);
    const cookie = new Headers(init?.headers).get('cookie') ?? '';
    calls.push(url);
    assert.equal(init?.method, 'GET');
    assert.doesNotMatch(cookie, /info_session/);
    if (target.origin === THESIS_ORIGIN && target.pathname === '/qh/thesis/toLogin/') {
      assert.equal(target.searchParams.get('loginto'), 'tsinghua');
      return html('<script>window.location.href = "' + THESIS_IDENTITY_URL + '";</script>', 'JSESSIONID=transaction; Path=/; Secure; HttpOnly');
    }
    if (url === callback) {
      assert.match(cookie, /JSESSIONID=transaction/);
      return new Response(null, { status: 302, headers: { location: home, 'set-cookie': 'JSESSIONID=official; Path=/; Secure; HttpOnly' } });
    }
    if (target.origin === THESIS_ORIGIN && ['/', '/home/qh/index', '/qh/qhSearch/QbIndex'].includes(target.pathname)) {
      return html(cookie.includes('JSESSIONID=official') ? logged : anonymous);
    }
    throw new Error('Unexpected thesis fixture route');
  };
  const transport = createNodeTransport({ epoch: () => epoch, assertCurrent() {}, fetch });
  transport.jar.setRaw(new URL('https://info.tsinghua.edu.cn/'), 'info_session=preserved; Path=/; Secure; HttpOnly');
  const runtime = {
    fetch: transport.fetch, fetchCampusDirect: transport.fetch, fetchWithoutSession: fetch,
    http: { jar: transport.jar }, epoch: () => epoch, assertCurrent() {},
    status: () => ({ authenticated: true }), session: { username: 'fixture-reader' },
    requestThesisCallback: async () => { renewals++; return callback; },
  };
  const createProxy = () => createCampusProxySession(runtime as any, [THESIS_ORIGIN]);
  return { transport, calls, createProxy, proxy: createProxy(), setEpoch(value: number) { epoch = value; }, get renewals() { return renewals; } };
}

test('thesis gateway privately exchanges a verified ticket and returns to the original document', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  const returnPath = '/qh/qhSearch/QbIndex?query=alpha&sort=year';
  const entry = THESIS_ORIGIN + '/qh/thesis/toLogin/?loginto=tsinghua&beforepage=' + encodeURIComponent(returnPath);
  const response = await f.proxy.request(entry, documentRequest);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /http-equiv="refresh"/);
  assert.ok(body.includes((THESIS_ORIGIN + returnPath).replaceAll('&', '&amp;')));
  assert.equal(body.includes('official-fixture-ticket'), false);
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(f.renewals, 1);
  assert.equal(f.transport.jar.getCookies(new URL(home)).find(cookie => cookie.name === 'JSESSIONID')?.value, 'official');
  assert.equal(f.transport.jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).find(cookie => cookie.name === 'info_session')?.value, 'preserved');
  assert.equal(f.calls.includes(THESIS_IDENTITY_URL), false);
});

test('thesis gateway rejects callback replay and malformed entry requests before borrowing the session', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  const entry = THESIS_ORIGIN + '/qh/thesis/toLogin/?loginto=tsinghua&beforepage=';
  for (const [url, init] of [
    [callback, documentRequest],
    [callback.replace('/Login?', '/%4cogin?'), documentRequest],
    [entry + encodeURIComponent('//evil.example/'), documentRequest],
    [entry + '&loginto=tsinghua', documentRequest],
    [entry + '&unknown=1', documentRequest],
    [entry, { method: 'POST', body: 'credentials', ...documentRequest }],
    [entry, {}],
  ] as const) await assert.rejects(f.proxy.request(url, init), { code: 'GATEWAY_AUTH_REQUIRED' });
  assert.equal(f.calls.length, 0);
  assert.equal(f.renewals, 0);
});

test('thesis homepage prepares its session once and reuses it on refresh', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  for (let refresh = 0; refresh < 3; refresh++) {
    const response = await f.proxy.request(home, documentRequest);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /当前读者/);
  }
  assert.equal(f.renewals, 1);
  assert.equal(f.calls.filter(url => new URL(url).pathname === '/qh/thesis/toLogin/').length, 1);
  assert.equal(f.calls.filter(url => url === callback).length, 1);
});

test('a new thesis proxy reuses the current account jar without requesting another ticket', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  await (await f.proxy.request(home, documentRequest)).text();
  const next = f.createProxy();
  const response = await next.request(THESIS_ORIGIN + '/qh/qhSearch/QbIndex', documentRequest);
  assert.match(await response.text(), /当前读者/);
  assert.equal(f.renewals, 1);
  assert.equal(f.calls.filter(url => url === callback).length, 1);
});

test('thesis direct routing is restored when the account epoch changes', async t => {
  const f = fixture(); t.after(() => f.transport.close());
  await (await f.proxy.request(home, documentRequest)).text();
  f.setEpoch(2);
  const response = await f.proxy.request(home, documentRequest);
  assert.match(await response.text(), /当前读者/);
  assert.ok(f.calls.every(url => new URL(url).origin === THESIS_ORIGIN));
});
