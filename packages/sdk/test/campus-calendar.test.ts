import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { createCampusGateway } from '@onethu/gateway';
import { isCampusCalendarRead, validateMethod } from '@onethu/gateway/policy';
import { validateCampusCalendarRead } from '../src/node/campusCalendar.js';
import { createCampusProxySession } from '../src/node/campusProxy.js';
import { createNodeTransport } from '../src/node/transport.js';

const origin = 'https://learn.tsinghua.edu.cn';
const calendar = new URL(origin + '/calendars/fixture-user/');
const principal = new URL(origin + '/principals/fixture-user');
const propfind = '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-privilege-set/><D:displayname/><D:supportedlock/><D:resourcetype/><D:supported-report-set/><D:sync-token/><A:calendar-color xmlns:A="http://apple.com/ns/ical/"/><L:supported-calendar-component-set xmlns:L="urn:ietf:params:xml:ns:caldav"/><R:max-image-size xmlns:R="urn:ietf:params:xml:ns:carddav"/></D:prop></D:propfind>';
const report = '<A:expand-property xmlns:A="DAV:">' + ['calendar-proxy-read-for', 'calendar-proxy-write-for'].map(name => `<A:property name="${name}" namespace="http://calendarserver.org/ns/"><A:property name="email-address-set" namespace="http://calendarserver.org/ns/"/><A:property name="displayname" namespace="DAV:"/><A:property name="calendar-user-address-set" namespace="urn:ietf:params:xml:ns:caldav"/></A:property>`).join('') + '</A:expand-property>';
const init = (body: BodyInit, headers: HeadersInit = {}) => ({ body, headers: { 'content-type': 'text/xml; charset=utf-8', ...headers } });
const validate = (body: BodyInit, method = 'PROPFIND', headers: HeadersInit = {}) => validateCampusCalendarRead(method === 'REPORT' ? principal : calendar, method, init(body, headers), () => {});
const denied = { code: 'GATEWAY_CALENDAR_REQUEST_REJECTED' };

test('observed PROPFIND and REPORT queries preserve original bytes, headers, and bounded Depth', async () => {
  for (const [method, target, body] of [['PROPFIND', calendar, propfind], ['REPORT', principal, report]] as const) {
    for (const depth of [undefined, '0', '1']) {
      const headers = new Headers({ 'content-type': 'text/xml', 'x-fixture': 'preserved' });
      if (depth) headers.set('depth', depth);
      const original = { method, body, headers, redirect: 'manual' as const };
      const result = await validateCampusCalendarRead(target, method, original, () => {});
      assert.deepEqual(result.body, new TextEncoder().encode(body));
      assert.equal(result.headers, headers);
      assert.equal(result.redirect, 'manual');
      assert.equal(headers.get('depth'), depth ?? null);
    }
  }
});

test('method admission is limited to exact HTTPS Learn collection paths', async () => {
  assert.equal(isCampusCalendarRead(calendar, 'PROPFIND'), true);
  assert.equal(isCampusCalendarRead(principal, 'REPORT'), true);
  for (const [method, value] of [
    ['PROPFIND', origin + '/calendars/fixture-user'], ['REPORT', origin + '/principals/fixture-user/'],
    ['REPORT', calendar.href], ['PROPFIND', principal.href],
    ['PROPFIND', 'http://learn.tsinghua.edu.cn/calendars/fixture-user/'],
    ['PROPFIND', 'https://info.tsinghua.edu.cn/calendars/fixture-user/'],
    ['PROPFIND', 'https://user@learn.tsinghua.edu.cn/calendars/fixture-user/'],
    ['PROPFIND', calendar.href + '?'], ['PROPFIND', calendar.href + '?_csrf=x'], ['PROPFIND', calendar.href + '#'],
    ['PROPFIND', origin + '/calendars/a/b/'], ['PROPFIND', origin + '/calendars/a%2Fb/'],
    ['PROPFIND', origin + '/calendars/%61/'], ['PROPFIND', origin + '/calendars/../'],
    ['PROPFIND', origin + '/calendars/' + 'x'.repeat(129) + '/'],
    ['PROPPATCH', calendar.href], ['MKCALENDAR', calendar.href], ['ACL', calendar.href],
  ]) {
    const target = new URL(value!);
    assert.equal(isCampusCalendarRead(target, method), false, `${method} ${target.pathname}`);
    assert.throws(() => validateMethod(method, target), { code: 'GATEWAY_METHOD_REJECTED' });
    if (['PROPFIND', 'REPORT'].includes(method!)) await assert.rejects(validateCampusCalendarRead(target, method!, init(propfind), () => {}), denied);
  }
  assert.throws(() => validateMethod('PROPFIND'), { code: 'GATEWAY_METHOD_REJECTED' });
  const ordinary = init('ordinary body');
  assert.equal(await validateCampusCalendarRead(calendar, 'POST', ordinary, () => {}), ordinary);
});

test('malformed XML, entities, external hrefs and namespace spoofing are rejected', async () => {
  const bad = [
    propfind + propfind, propfind.slice(0, -13), propfind.replace('</D:prop>', '</D:wrong>'),
    propfind.replace('<D:displayname/>', '<D:displayname>value</D:displayname>'),
    propfind.replace('<D:displayname/>', '<D:displayname href="https://outside.test/"/>'),
    propfind.replace('<D:displayname/>', '<D:href>https://outside.test/</D:href>'),
    propfind.replace('<D:displayname/>', '<D:displayname>&amp;</D:displayname>'),
    propfind.replace('<D:displayname/>', '<D:displayname>&#65;</D:displayname>'),
    propfind.replace('<D:displayname/>', '<D:displayname><![CDATA[x]]></D:displayname>'),
    propfind.replace('xmlns:D="DAV:"', 'xmlns:D="https://outside.test/"'),
    propfind.replace('<D:displayname/>', '<D:displayname xmlns:D="urn:ietf:params:xml:ns:caldav"/>'),
    propfind.replace('<D:displayname/>', '<D:displayname/><D:displayname/>'),
    propfind.replace('<D:displayname/>', '<U:displayname/>'),
    propfind.replace('<D:displayname/>', '<D:displayname x="a" x="b"/>'),
    propfind.replace('<D:displayname/>', '<D:displayname/ >'),
    propfind.replace('?><', '?><?unexpected x?><'),
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + propfind,
    propfind + '\u0000', '<!-- comment -->' + propfind,
  ];
  for (const body of bad) await assert.rejects(validate(body), denied);
  await assert.rejects(validate(new Uint8Array([0xc0, 0xaf])), denied);
});

test('unknown reports, sharing changes and unobserved properties stay forbidden', async () => {
  for (const body of [
    report.replaceAll('expand-property', 'calendar-query'),
    report.replaceAll('expand-property', 'calendar-multiget'),
    report.replace('calendar-proxy-read-for', 'calendar-proxy-read'),
    report.replace('calendar-proxy-write-for', 'set'),
    report.replace('email-address-set', 'href'),
    report.replace('namespace="DAV:"', 'namespace="https://outside.test/"'),
    report.replace('name="displayname"', 'name="displayname" name="displayname"'),
    report.replace('name="displayname" namespace="DAV:"/>', 'name="displayname" namespace="DAV:"><A:property name="displayname" namespace="DAV:"/></A:property>'),
    '<A:propertyupdate xmlns:A="DAV:"><A:set/></A:propertyupdate>',
    '<A:share xmlns:A="http://calendarserver.org/ns/"/>',
    propfind,
  ]) await assert.rejects(validate(body, 'REPORT'), denied);
  for (const body of [report, propfind.replace('displayname', 'getcontentlength'), propfind.replace('<D:prop>', '<D:allprop>').replace('</D:prop>', '</D:allprop>')]) await assert.rejects(validate(body), denied);
});

test('content type, content length, encoding and Depth are validated before reads', async () => {
  for (const headers of [
    { depth: 'infinity' }, { depth: '1, 0' }, { depth: '-1' },
    { 'content-type': 'application/json' }, { 'content-type': 'text/xml; charset=gbk' },
    { 'content-type': 'text/xml; charset=utf-8; other=value' }, { 'content-encoding': 'gzip' },
    { 'content-length': '99999' }, { 'content-length': '1' },
  ]) await assert.rejects(validate(propfind, 'PROPFIND', headers), denied);
  await assert.rejects(validateCampusCalendarRead(calendar, 'PROPFIND', { headers: { 'content-type': 'text/xml' } }, () => {}), denied);
});

test('bounded Web and Node streams preserve bytes and reject oversized chunks without forwarding', async () => {
  const bytes = new TextEncoder().encode(propfind);
  const web = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
  assert.deepEqual((await validate(web)).body, bytes);
  const node = Readable.from([Buffer.from(propfind.slice(0, 55)), Buffer.from(propfind.slice(55))]);
  assert.deepEqual((await validate(node as unknown as BodyInit)).body, bytes);
  let cancelled = false;
  const large = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(16 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(validate(large), { ...denied, status: 413 });
  assert.equal(cancelled, true);
  const exact = propfind + ' '.repeat(16 * 1024 - bytes.length);
  assert.equal((await validate(exact)).body instanceof Uint8Array, true);
  await assert.rejects(validate(exact + ' '), { ...denied, status: 413 });
});

test('epoch change while reading and abort while blocked stop validation', async () => {
  let checks = 0, cancelled = false;
  const epochError = new Error('fixture epoch changed');
  const web = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode(propfind)); }, cancel() { cancelled = true; } });
  await assert.rejects(validateCampusCalendarRead(calendar, 'PROPFIND', init(web), () => { if (++checks >= 3) throw epochError; }), error => error === epochError);
  assert.equal(cancelled, true);
  const controller = new AbortController(), reason = new Error('fixture abort');
  let blockedCancelled = false;
  const blocked = new ReadableStream<Uint8Array>({ cancel() { blockedCancelled = true; } });
  const pending = validateCampusCalendarRead(calendar, 'PROPFIND', { ...init(blocked), signal: controller.signal }, () => {});
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(blockedCancelled, true);
});

test('loopback gateway and authoritative adapter return actual DAV 207 without forwarding invalid queries', async t => {
  const seen: { method: string; body: Uint8Array; depth: string | null }[] = [];
  const multistatus = '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:"><D:response><D:href>/calendars/fixture-user/</D:href><D:propstat><D:prop><D:displayname>Fixture calendar</D:displayname></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
  const transport = createNodeTransport({ epoch: () => 1, assertCurrent() {}, fetch: async (_url: string, request: RequestInit) => {
    seen.push({ method: request.method!, body: new Uint8Array(await new Response(request.body).arrayBuffer()), depth: new Headers(request.headers).get('depth') });
    return new Response(multistatus, { status: 207, headers: { 'content-type': 'application/xml; charset=utf-8', 'set-cookie': 'private=hidden' } });
  } });
  const session = createCampusProxySession({ fetch: transport.fetch, epoch: () => 1, assertCurrent() {}, status: () => ({ authenticated: true, state: 'ready', epoch: 1 }), http: { jar: transport.jar } } as any, [origin, 'https://info.tsinghua.edu.cn']);
  const gateway = createCampusGateway({ allowedOrigins: [origin, 'https://info.tsinghua.edu.cn'], authorizeSocket: async () => true, session });
  const address = await gateway.listen();
  t.after(async () => { await gateway.close(); transport.close(); });
  const request = (url: URL, method: string, body: string, extra: Record<string, string> = {}) => new Promise<{ status: number; body: string; cookie: unknown }>((resolve, reject) => {
    const req = http.request({ hostname: address.host, port: address.port, path: url.href, method,
      headers: { host: url.host, 'sec-fetch-site': 'same-origin', origin: url.origin, 'content-type': 'text/xml', 'content-length': Buffer.byteLength(body), ...extra } }, response => {
      const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString(), cookie: response.headers['set-cookie'] }));
    }); req.on('error', reject); req.end(body);
  });
  for (const [target, method, body] of [[calendar, 'PROPFIND', propfind], [principal, 'REPORT', report]] as const) {
    const result = await request(target, method, body);
    assert.equal(result.status, 207); assert.equal(result.body, multistatus);
    assert.equal(JSON.stringify(result.cookie).includes('private'), false);
  }
  assert.deepEqual(seen.map(item => item.method), ['PROPFIND', 'REPORT']);
  assert.deepEqual(seen.map(item => Buffer.from(item.body).toString()), [propfind, report]);
  assert.deepEqual(seen.map(item => item.depth), [null, null]);
  for (const [target, method, body, status] of [
    [calendar, 'PROPFIND', '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>', 403],
    [principal, 'REPORT', report.replaceAll('expand-property', 'calendar-query'), 403],
    [calendar, 'PROPFIND', ' '.repeat(16 * 1024 + 1), 413],
    [new URL('https://info.tsinghua.edu.cn/calendars/fixture-user/'), 'PROPFIND', propfind, 405],
    [calendar, 'PROPPATCH', propfind, 405], [new URL(calendar.href + '?x=1'), 'PROPFIND', propfind, 405],
  ] as const) assert.equal((await request(target, method, body)).status, status);
  assert.equal((await request(calendar, 'PROPFIND', propfind, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal(seen.length, 2);
});
