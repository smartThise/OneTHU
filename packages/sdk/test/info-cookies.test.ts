import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, InfoClient, MemoryCookieJar, infoUrls, mergeInfoCookieBody, webvpnDecodeUrl, webvpnWrap } from '@onethu/core';
import { createNodeTransport } from '../src/node/transport.js';
import { probeUniversityIdentity } from '../src/node/identityProbe.js';

test('Info refresh after handoff uses the renewed CSRF/session and preserves the gateway ticket', async () => {
  let cookieReads = 0;
  const roams: { csrf: string | null; cookie: string }[] = [];
  const transport = createNodeTransport({ epoch: () => 0, assertCurrent() {}, fetch: (async (raw: string, init: RequestInit = {}) => {
    const physical = new URL(raw), url = new URL(webvpnDecodeUrl(raw) ?? raw);
    if (physical.pathname === '/wengine-vpn/cookie') return new Response(++cookieReads === 1
      ? 'JSESSIONID=info-A;XSRF-TOKEN=csrf-A'
      : 'JSESSIONID=info-B;\r\nXSRF-TOKEN=csrf-B;wengine_vpn_ticket=body-overwrite;heartbeat=body-heartbeat;Path=/');
    if (url.pathname.endsWith('/grjbxx')) return Response.json({ result: 'success', object: { ryh: '12345678' } });
    if (url.pathname.endsWith('/onlineAppRedirect')) {
      roams.push({ csrf: url.searchParams.get('_csrf'), cookie: new Headers(init.headers).get('cookie') ?? '' });
      return Response.json({});
    }
    throw new Error('unexpected synthetic Info request');
  }) as typeof globalThis.fetch });
  try {
    const gateway = new URL('https://webvpn.tsinghua.edu.cn/');
    transport.jar.setRaw(gateway, 'wengine_vpn_ticket=wrdvpn1-trusted-fixture; Path=/');
    // A pre-existing installation may still contain the former root-scoped
    // value. Its insertion order must not beat the refreshed application value.
    transport.jar.setRaw(gateway, 'XSRF-TOKEN=legacy-root-csrf; Path=/');
    assert.equal(await probeUniversityIdentity(transport.fetch, transport.jar, () => {}), '12345678');
    const http = new HttpClient({ fetch: transport.fetch, jar: transport.jar }); http.webVPNEncoder = webvpnWrap;
    await assert.rejects(new InfoClient(http).getSchedule('2026-10-25', '2026-10-26'), /未返回 roamingurl/);
    assert.equal(cookieReads, 2); assert.equal(roams.length, 1);
    assert.equal(roams[0]!.csrf, 'csrf-B');
    assert.deepEqual(roams[0]!.cookie.split('; ').sort(), ['JSESSIONID=info-B', 'XSRF-TOKEN=csrf-B', 'wengine_vpn_ticket=wrdvpn1-trusted-fixture'].sort());
    const logical = transport.cookieHeader(new URL('https://info.tsinghua.edu.cn/'));
    assert.match(logical, /JSESSIONID=info-B/); assert.match(logical, /XSRF-TOKEN=csrf-B/);
    assert.equal(transport.jar.serialize().includes('body-overwrite'), false);
    assert.equal(transport.jar.serialize().includes('body-heartbeat'), false);
    assert.equal(JSON.parse(transport.jar.serialize()).some((c: { name: string }) => c.name === 'Path'), false);
  } finally { transport.close(); }
});

test('Info bootstrap seeds the native application path with the response epoch and filters attributes/control cookies', async () => {
  const jar = new MemoryCookieJar();
  const seeds: { url: string; pair: string; path?: string; epoch?: number }[] = [];
  const csrf = await mergeInfoCookieBody({ jar, nativeSeedHook(url, pair, path, epoch) { seeds.push({ url, pair, path, epoch }); } },
    'JSESSIONID=fixture;\r\nXSRF-TOKEN=fresh;Domain=evil.test;SameSite=None;wengine_vpn_ticket=bad;show_vpn=bad;refresh=bad;bad=contains space',
    { nativeEpoch: 7 });
  assert.equal(csrf, 'fresh'); assert.equal(seeds.length, 4);
  assert.deepEqual(new Set(seeds.map(seed => seed.epoch)), new Set([7]));
  assert.deepEqual(seeds.filter(seed => seed.url.startsWith('https://webvpn.')).map(seed => seed.path), [new URL(infoUrls.INFO_PREFIX).pathname + '/', new URL(infoUrls.INFO_PREFIX).pathname + '/']);
  assert.equal(jar.getCookies(new URL('https://webvpn.tsinghua.edu.cn/')).length, 0);
  assert.equal(jar.getCookies(new URL(webvpnWrap('https://learn.tsinghua.edu.cn/'))).length, 0);
  assert.equal(jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).length, 2);
  assert.equal(jar.getCookies(new URL(infoUrls.INFO_PREFIX + '/')).length, 2);
  assert(jar.getCookies(new URL(infoUrls.INFO_PREFIX + '/')).every(cookie => cookie.httpOnly === undefined));
});

test('Info Cookie body can preserve matching response metadata but cannot invent public cookie provenance',async()=>{
 const jar=new MemoryCookieJar(),physical=new URL(infoUrls.INFO_PREFIX+'/');
 jar.setRaw(physical,`XSRF-TOKEN=known; Path=${physical.pathname}; Secure`);
 await mergeInfoCookieBody({jar},'XSRF-TOKEN=known');
 assert.equal(jar.getCookies(physical).find(cookie=>cookie.name==='XSRF-TOKEN')?.httpOnly,false);
 assert.equal(jar.getCookies(new URL('https://info.tsinghua.edu.cn/')).find(cookie=>cookie.name==='XSRF-TOKEN')?.httpOnly,undefined);
 await mergeInfoCookieBody({jar},'XSRF-TOKEN=replaced');
 assert.equal(jar.getCookies(physical).find(cookie=>cookie.name==='XSRF-TOKEN')?.httpOnly,undefined);
 jar.setRaw(physical,`XSRF-TOKEN=private; Path=${physical.pathname}; Secure; HttpOnly`);
 await mergeInfoCookieBody({jar},'XSRF-TOKEN=private');
 assert.equal(jar.getCookies(physical).find(cookie=>cookie.name==='XSRF-TOKEN')?.httpOnly,true);
});

test('logout during native cookie seeding cannot write the old response into the JavaScript jar', async () => {
  const jar = new MemoryCookieJar();
  let epoch = 0, release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const pending = mergeInfoCookieBody({ jar, async nativeSeedHook() { entered(); await hold; } }, 'XSRF-TOKEN=old', {
    nativeEpoch: 0,
    assertCurrent() { if (epoch !== 0) throw Object.assign(new Error('AUTH_SESSION_CHANGED'), { code: 'AUTH_SESSION_CHANGED' }); },
  });
  await started; epoch++; release();
  await assert.rejects(pending, { code: 'AUTH_SESSION_CHANGED' });
  assert.equal(jar.serialize(), '[]');
});
