import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryCookieJar } from '@onethu/core';
import { THESIS_ORIGIN, THESIS_IDENTITY_URL } from '../../gateway/src/thesisAuth.mjs';
import { resolveThesisLogin } from '../src/node/thesisAuth.js';

const home = THESIS_ORIGIN + '/home/qh/index';
const destination = THESIS_ORIGIN + '/qh/qhSearch/QbIndex';
const entry = THESIS_ORIGIN + '/qh/thesis/toLogin/?loginto=tsinghua&beforepage=' + encodeURIComponent('/qh/qhSearch/QbIndex');
const callback = THESIS_ORIGIN + '/qh/thesis/tsinghua/Login?ticket=official-fixture-ticket';
const logged = '<div class="topLogin"><span>当前读者</span><a href="/qh/thesis/logout">退出</a></div><div hidden><input type="password"></div>';
const anonymous = '<div class="topLogin"><a class="loginBtn cd-popup-trigger0">登录</a></div><script>function logout(){}</script>';
const page = (html: string, cookie?: string) => new Response(html, { headers: {
  'content-type': 'text/html; charset=utf-8', ...(cookie ? { 'set-cookie': cookie } : {}),
} });
const redirect = (location: string, cookie?: string) => new Response(null, { status: 302, headers: {
  location, ...(cookie ? { 'set-cookie': cookie } : {}),
} });
function fixture(options: { reusable?: boolean; callback?: string | null; entryIdentity?: string; next?: string;
  epochChange?: boolean; remainsAnonymous?: boolean; large?: boolean; concurrentCookie?: boolean; wait?: Promise<void> } = {}) {
  const jar = new MemoryCookieJar();
  jar.setRaw(new URL(THESIS_ORIGIN), 'JSESSIONID=old; Path=/; Secure; HttpOnly');
  jar.setRaw(new URL('https://info.tsinghua.edu.cn/'), 'info_session=keep; Path=/; Secure; HttpOnly');
  const initial = jar.serialize(), calls: string[] = [];
  let epoch = 1, authenticated = options.reusable ?? false, callbacks = 0;
  let callbackStarted = () => {};
  const ready = new Promise<void>(resolve => { callbackStarted = resolve; });
  const runtime = {
    jar, epoch: () => epoch,
    assertCurrent(value: number) { if (value !== epoch) throw new Error('AUTH_SESSION_CHANGED'); },
    requestCallback: async (_signal: AbortSignal) => {
      callbacks++; callbackStarted();
      if (options.wait) await options.wait;
      if (options.epochChange) epoch++;
      if (options.concurrentCookie) jar.setRaw(new URL(THESIS_ORIGIN), 'JSESSIONID=newer; Path=/; Secure; HttpOnly');
      return options.callback === undefined ? callback : options.callback;
    },
    fetch: async (input: any, init?: RequestInit) => {
      const url = String(input), cookie = new Headers(init?.headers).get('cookie') ?? '';
      calls.push(url); assert.equal(init?.method, 'GET'); assert.doesNotMatch(cookie, /info_session/);
      if (url === home) return page(options.large ? 'x'.repeat(600 * 1024) : authenticated ? logged : anonymous);
      if (url === entry) {
        assert.doesNotMatch(cookie, /JSESSIONID=old/);
        return page('<script>window.location.href = "' + (options.entryIdentity ?? THESIS_IDENTITY_URL) + '";</script>', 'JSESSIONID=transaction; Path=/; Secure; HttpOnly');
      }
      if (url === callback) {
        assert.match(cookie, /JSESSIONID=transaction/);
        authenticated = !options.remainsAnonymous;
        return redirect(options.next ?? home, 'JSESSIONID=verified; Path=/; Secure; HttpOnly');
      }
      throw new Error('UNEXPECTED_TEST_ROUTE');
    },
  };
  return { runtime, jar, initial, calls, ready, get callbacks() { return callbacks; } };
}

test('Thesis validates its entry, exchanges privately and preserves unrelated sessions', async () => {
  const f = fixture();
  assert.equal(await resolveThesisLogin(f.runtime, entry), destination);
  assert.equal(f.callbacks, 1);
  assert.equal(f.jar.getCookies(new URL(THESIS_ORIGIN)).find(cookie => cookie.name === 'JSESSIONID')?.value, 'verified');
  assert.equal(f.jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).find(cookie => cookie.name === 'info_session')?.value, 'keep');
  assert.equal(f.calls.includes(THESIS_IDENTITY_URL), false);
});

test('Thesis can reuse verified account controls despite an unrelated hidden password form', async () => {
  const f = fixture({ reusable: true });
  assert.equal(await resolveThesisLogin(f.runtime, entry), destination);
  assert.deepEqual(f.calls, [home]);
  assert.equal(f.callbacks, 0);
});

test('Thesis rejects anonymous pages and script-only logout text after exchange', async () => {
  const f = fixture({ remainsAnonymous: true });
  await assert.rejects(resolveThesisLogin(f.runtime, entry), { serviceReason: 'CAMPUS_SERVICE_THESIS_VERIFY' });
  assert.equal(f.jar.serialize(), f.initial);
});

test('Thesis only obtains a callback after witnessing its fixed official identity entry', async () => {
  const f = fixture({ entryIdentity: THESIS_IDENTITY_URL.replace('4bf1579', '4bf1578') });
  await assert.rejects(resolveThesisLogin(f.runtime, entry), { serviceReason: 'CAMPUS_SERVICE_THESIS_ENTRY' });
  assert.equal(f.callbacks, 0);
  assert.equal(f.jar.serialize(), f.initial);
});

test('Thesis refuses foreign callback and redirect targets before sending service cookies', async () => {
  for (const options of [{ callback: 'https://evil.example/?ticket=secret' }, { next: 'https://evil.example/' }]) {
    const f = fixture(options);
    await assert.rejects(resolveThesisLogin(f.runtime, entry));
    assert.equal(f.calls.some(url => url.includes('evil.example')), false);
    assert.equal(f.jar.serialize(), f.initial);
  }
});

test('Thesis account changes and response limits leave the shared jar untouched', async () => {
  for (const options of [{ epochChange: true }, { large: true }]) {
    const f = fixture(options);
    await assert.rejects(resolveThesisLogin(f.runtime, entry));
    assert.equal(f.jar.serialize(), f.initial);
  }
});

test('Thesis cancellation interrupts a stalled callback even if the broker ignores its signal', async () => {
  let finish = () => {};
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const f = fixture({ wait }), controller = new AbortController();
  const pending = resolveThesisLogin(f.runtime, entry, controller.signal);
  await f.ready;
  controller.abort();
  await assert.rejects(pending, { code: 'GATEWAY_CANCELLED', serviceReason: 'CAMPUS_SERVICE_THESIS_CALLBACK' });
  assert.equal(f.jar.serialize(), f.initial);
  finish();
});

test('Thesis cookie merge preserves a concurrent update from the active account', async () => {
  const f = fixture({ concurrentCookie: true });
  await resolveThesisLogin(f.runtime, entry);
  assert.equal(f.jar.getCookies(new URL(THESIS_ORIGIN)).find(cookie => cookie.name === 'JSESSIONID')?.value, 'newer');
});

test('Thesis rejects an invalid entry before making a request', async () => {
  const f = fixture();
  await assert.rejects(resolveThesisLogin(f.runtime, 'https://evil.example/'), { serviceReason: 'CAMPUS_SERVICE_THESIS_ENTRY' });
  assert.equal(f.calls.length, 0);
});
