import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createCampusGateway, GatewayError } from '../src/index.mjs';

const token = 'c'.repeat(64);
const authorization = 'Basic ' + Buffer.from('onethu:' + token).toString('base64');
const hostname = 'learn.tsinghua.edu.cn';
let certDirectory, certificate;

before(() => {
  certDirectory = mkdtempSync(join(tmpdir(), 'onethu-gateway-test-'));
  writeFileSync(join(certDirectory, 'openssl.cnf'), [
    '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
    '[dn]', 'CN=learn.tsinghua.edu.cn',
    '[ext]', 'subjectAltName=DNS:learn.tsinghua.edu.cn,DNS:info.tsinghua.edu.cn',
    'basicConstraints=critical,CA:TRUE',
    'keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign',
    'extendedKeyUsage=serverAuth',
  ].join('\n'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', join(certDirectory, 'openssl.cnf'), '-keyout', join(certDirectory, 'key.pem'),
    '-out', join(certDirectory, 'cert.pem')], { stdio: 'ignore', timeout: 15_000 });
  certificate = { key: readFileSync(join(certDirectory, 'key.pem')), cert: readFileSync(join(certDirectory, 'cert.pem')) };
});
after(() => { if (certDirectory) rmSync(certDirectory, { recursive: true, force: true }); });

async function fixture(t, options = {}) {
  const state = { epoch: 1, calls: [], certificates: [] };
  const { request, withTls, browserCookies, authorizeTarget, ...settings } = options;
  const gateway = createCampusGateway({
    allowedOrigins: [`http://${hostname}`, `https://${hostname}`], token,
    timeoutMs: 2_000,
    session: {
      ...(browserCookies ? { browserCookies } : {}),
      ...(authorizeTarget ? { authorizeTarget } : {}),
      epoch: () => state.epoch,
      assertCurrent(expected) {
        if (expected !== state.epoch) throw Object.assign(new Error('private account changed'), { code: 'AUTH_SESSION_CHANGED' });
      },
      async request(url, init) {
        state.calls.push({ url, init });
        return request ? request(url, init, state) : new Response('campus fixture');
      },
    },
    ...(withTls ? { tls: async host => { state.certificates.push(host); return certificate; } } : {}),
    ...settings,
  });
  const address = await gateway.listen();
  assert.equal(address.host, '127.0.0.1');
  assert.ok(address.port > 0);
  t.after(() => gateway.close());
  return { gateway, address, state };
}

function collect(request) {
  return new Promise((resolve, reject) => {
    request.on('error', reject);
    request.on('response', response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
  });
}

async function proxyRequest(f, options = {}) {
  const { url = `http://${hostname}/course`, method = 'GET', headers = {}, body, auth = true } = options;
  const outgoing = { host: hostname, 'sec-fetch-site': 'none', ...(auth ? { 'proxy-authorization': authorization } : {}), ...headers };
  for (const [key, value] of Object.entries(outgoing)) if (value === null) delete outgoing[key];
  const request = http.request({ host: f.address.host, port: f.address.port, path: url, method,
    headers: outgoing, agent: false });
  const result = collect(request);
  request.end(body);
  return result;
}

test('dynamic campus membership uses only live authority lookups and retains provenance checks', async t => {
  const origin = 'https://new-service.tsinghua.edu.cn';
  const grants = new Set(); const lookups = [];
  const f = await fixture(t, { authorizeTarget: target => { lookups.push(target); return grants.has(new URL(target).origin); } });
  const request = (headers = {}) => proxyRequest(f, { url: origin + '/business?value=fixture', headers: { host: 'new-service.tsinghua.edu.cn', 'sec-fetch-site': 'same-origin', ...headers } });
  assert.equal((await request({ 'x-onethu-grant-origin': origin })).status, 403);
  assert.equal(f.state.calls.length, 0);
  grants.add(origin);
  assert.equal((await request()).status, 200);
  assert.equal((await request({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request({ 'sec-fetch-site': 'same-site', referer: 'https://unregistered.tsinghua.edu.cn/' })).status, 403);
  grants.add('https://registered.tsinghua.edu.cn');
  assert.equal((await request({ 'sec-fetch-site': 'same-site', referer: 'https://registered.tsinghua.edu.cn/page' })).status, 200);
  grants.clear(); f.state.epoch++;
  assert.equal((await request()).status, 403);
  assert.equal(f.state.calls.length, 2);
  assert(lookups.every(value => value === new URL(value).origin + '/'), 'queries never receive request paths or tickets');
});

test('a dynamic predicate cannot authorize identity, WebVPN, foreign origins or malformed return values', async t => {
  let answer = () => true, queried = 0;
  const f = await fixture(t, { authorizeTarget: () => { queried++; return answer(); }, withTls: true });
  for (const host of ['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn', 'webvpn.tsinghua.edu.cn', 'outside.test', 'tsinghua.edu.cn.attacker.test']) {
    assert.equal((await proxyRequest(f, { url: `https://${host}/`, headers: { host } })).status >= 400, true);
    const connection = await connect(f, { authority: host + ':443' });
    assert.equal(connection.status >= 400, true); connection.socket.destroy();
  }
  assert.equal(queried, 0); assert.equal(f.state.calls.length, 0); assert.equal(f.state.certificates.length, 0);
  for (const invalid of [() => 'true', () => 1, () => ({}), () => Promise.resolve(true), () => Promise.reject(new Error('private callback detail'))]) {
    answer = invalid;
    assert.equal((await proxyRequest(f, { url: 'https://new-service.tsinghua.edu.cn/', headers: { host: 'new-service.tsinghua.edu.cn' } })).status, 403);
  }
});

test('revoking a dynamic grant during upstream work cancels returned private data', async t => {
  let allowed = true;
  const f = await fixture(t, { authorizeTarget: () => allowed, request: async () => { allowed = false; return new Response('private after revoke'); } });
  const result = await proxyRequest(f, { url: 'https://new-service.tsinghua.edu.cn/', headers: { host: 'new-service.tsinghua.edu.cn' } });
  assert.equal(result.status, 403);
  assert.equal(result.body.includes('private after revoke'), false);
});

test('unknown service diagnostics accept only a strict campus destination hostname', async t => {
  let destinationHost = 'its.tsinghua.edu.cn';
  let untyped = false;
  const f = await fixture(t, { request() {
    const error = untyped ? new Error('untrusted failure') : new GatewayError('GATEWAY_SERVICE_NOT_ENABLED', 403);
    throw Object.assign(error, { destinationHost });
  } });
  const first = await proxyRequest(f);
  assert.equal(first.status, 403);
  assert.equal(f.gateway.statistics().recentRejections.at(-1).destinationHost, 'its.tsinghua.edu.cn');
  assert.deepEqual(JSON.parse(first.body), { error: { code: 'GATEWAY_SERVICE_NOT_ENABLED' } });
  for (const unsafe of [
    'https://its.tsinghua.edu.cn/private?ticket=fixture-secret', 'its.tsinghua.edu.cn/private',
    'its.tsinghua.edu.cn:443', 'its.tsinghua.edu.cn?ticket=fixture-secret', 'its.tsinghua.edu.cn#secret',
    'user@its.tsinghua.edu.cn', 'outside.test', '127.0.0.1', '[::1]', 'tsinghua.edu.cn',
    'ITS.tsinghua.edu.cn', 'its.tsinghua.edu.cn.', 'bad..tsinghua.edu.cn', '-bad.tsinghua.edu.cn',
    'bad_.tsinghua.edu.cn', 'a'.repeat(64) + '.tsinghua.edu.cn',
    Array(5).fill('a'.repeat(60)).join('.') + '.tsinghua.edu.cn',
  ]) {
    destinationHost = unsafe;
    await proxyRequest(f);
    assert.equal(Object.hasOwn(f.gateway.statistics().recentRejections.at(-1), 'destinationHost'), false);
  }
  untyped = true; destinationHost = 'its.tsinghua.edu.cn';
  await proxyRequest(f);
  assert.equal(Object.hasOwn(f.gateway.statistics().recentRejections.at(-1), 'destinationHost'), false);
  assert.equal(f.gateway.statistics().recentRejections.length, 8);
  assert.equal(JSON.stringify(f.gateway.statistics()).includes('fixture-secret'), false);
});

test('legacy HTTP upgrade never borrows a session without browser provenance or replays forms', async t => {
  const f = await fixture(t, { upgradeInsecureRequests: true });
  const result = await proxyRequest(f, { headers: { 'sec-fetch-site': null } });
  assert.equal(result.status, 307);
  assert.equal(result.headers.location, `https://${hostname}/course`);
  assert.equal(f.state.calls.length, 0);
  const post = await proxyRequest(f, { method: 'POST', headers: { 'sec-fetch-site': null, 'content-length': '3' }, body: 'abc' });
  assert.equal(post.status, 403);
  assert.equal(f.state.calls.length, 0);
});

test('an unapproved same-site sibling cannot borrow cached proxy authentication', async t => {
  const f = await fixture(t);
  for (const referer of [null, 'https://unapproved.tsinghua.edu.cn/page']) {
    const denied = await proxyRequest(f, { headers: { 'sec-fetch-site': 'same-site', referer } });
    assert.equal(denied.status, 403);
  }
  assert.equal(f.state.calls.length, 0);
  const allowed = await proxyRequest(f, { headers: { 'sec-fetch-site': 'same-site', referer: `https://${hostname}/page` } });
  assert.equal(allowed.status, 200);
});

async function connect(f, { authority = `${hostname}:443`, auth = true } = {}) {
  const socket = net.connect(f.address.port, f.address.host);
  await once(socket, 'connect');
  const result = new Promise((resolve, reject) => {
    let head = Buffer.alloc(0);
    const fail = error => { socket.destroy(); reject(error); };
    const read = chunk => {
      head = Buffer.concat([head, chunk]);
      const boundary = head.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      socket.pause();
      socket.removeListener('data', read);
      socket.removeListener('error', fail);
      const status = Number(head.toString('latin1', 0, boundary).split(' ')[1]);
      const rest = head.subarray(boundary + 4);
      if (rest.length) socket.unshift(rest);
      resolve({ socket, status });
    };
    socket.on('data', read);
    socket.once('error', fail);
  });
  socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth ? 'Proxy-Authorization: ' + authorization + '\r\n' : ''}\r\n`);
  return result;
}

async function tlsRequest(f, { servername = hostname, hostHeader = hostname, path = '/course', method = 'GET', body, headers = {} } = {}) {
  const tunnel = await connect(f);
  assert.equal(tunnel.status, 200);
  const secure = tls.connect({ socket: tunnel.socket, servername, ca: certificate.cert, ALPNProtocols: ['http/1.1'] });
  try {
    await once(secure, 'secureConnect');
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = (_options, callback) => { callback(null, secure); };
    try {
      const outgoing = { host: hostHeader, 'sec-fetch-site': 'none', ...headers };
      for (const [key, value] of Object.entries(outgoing)) if (value === null) delete outgoing[key];
      const request = https.request({ hostname, port: 443, path, method, agent, headers: outgoing });
      const result = collect(request);
      request.end(body);
      return await result;
    } finally { agent.destroy(); }
  } finally { secure.destroy(); tunnel.socket.destroy(); }
}

test('HTTP proxy forwards one request with manual redirects and removes credentials/internal headers', async t => {
  const f = await fixture(t, { request: (_url, init) => {
    const h = new Headers(init.headers);
    for (const name of ['cookie', 'authorization', 'proxy-authorization', 'x-hop']) assert.equal(h.has(name), false, name);
    assert.equal(h.get('accept-language'), 'zh-CN');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.preserveResponseBytes, true);
    return new Response('done', { headers: { 'set-cookie': 'session=secret', 'x-onethu-final-url': 'https://secret.invalid/', 'cache-control': 'public,max-age=3600' } });
  } });
  const r = await proxyRequest(f, { headers: { cookie: 'other-account=secret', authorization: 'Bearer OTHER_ACCOUNT', connection: 'x-hop', 'x-hop': 'secret', 'accept-language': 'zh-CN' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), 'done');
  assert.equal(r.headers['set-cookie'], undefined);
  assert.equal(r.headers['x-onethu-final-url'], undefined);
  assert.match(r.headers['cache-control'], /no-store/);
  assert.equal(f.state.calls.length, 1);
});

test('unauthorized HTTP and CONNECT do not call session or certificate provider', async t => {
  const f = await fixture(t, { withTls: true });
  assert.equal((await proxyRequest(f, { auth: false })).status, 407);
  const tunnel = await connect(f, { auth: false });
  assert.equal(tunnel.status, 407);
  tunnel.socket.destroy();
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.certificates.length, 0);
});

test('a separate peer-authorized listener accepts verified sockets while retaining request provenance', async t => {
  let checks = 0;
  const f = await fixture(t, { token: undefined, withTls: true, authorizeSocket: async socket => {
    checks++; assert.equal(socket.remoteAddress, '127.0.0.1'); return true;
  } });
  assert.equal((await proxyRequest(f, { auth: false })).status, 200);
  assert.equal((await proxyRequest(f, { auth: false, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await proxyRequest(f, { auth: false, headers: { 'sec-fetch-site': null } })).status, 403);
  const tunnel = await connect(f, { auth: false }); assert.equal(tunnel.status, 200); tunnel.socket.destroy();
  assert.equal(checks, 4); assert.equal(f.state.calls.length, 1);
});

test('peer authorization fails closed even when a client supplies legacy proxy credentials', async t => {
  const f = await fixture(t, { token: undefined, withTls: true, authorizeSocket: async () => false });
  assert.equal((await proxyRequest(f)).status, 403);
  const tunnel = await connect(f); assert.equal(tunnel.status, 403); tunnel.socket.destroy();
  assert.equal(f.state.calls.length, 0); assert.equal(f.state.certificates.length, 0);
  assert.throws(() => createCampusGateway({ allowedOrigins: ['https://learn.tsinghua.edu.cn'], token, authorizeSocket: () => true, session: {} }));
});

test('custom origin lists cannot route browser identity pages into the shared session or issue identity certificates', async t => {
  const identities = ['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn'];
  const f = await fixture(t, { withTls: true, token: undefined, authorizeSocket: async () => true,
    allowedOrigins: [`https://${hostname}`, ...identities.flatMap(host => [`https://${host}`, `http://${host}`])] });
  for (const host of identities) {
    for (const scheme of ['http', 'https']) {
      const result = await proxyRequest(f, { auth: false, url: `${scheme}://${host}/`, headers: { host } });
      assert.equal(result.status, 401);
      assert.match(result.body.toString(), /GATEWAY_AUTH_REQUIRED/);
    }
    const tunnel = await connect(f, { authority: `${host}:443`, auth: false });
    assert.equal(tunnel.status, 401);
    tunnel.socket.destroy();
  }
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.certificates.length, 0);
});

test('rejection diagnostics retain only bounded, redacted provenance categories', async t => {
  const f = await fixture(t, { token: undefined, authorizeSocket: async () => true });
  const secret = 'private-student-token-123456789';
  for (let index = 0; index < 10; index++) {
    const result = await proxyRequest(f, { auth: false, url: `https://${hostname}/${secret}?token=${secret}`, method: 'POST', body: secret,
      headers: { 'sec-fetch-site': secret, 'sec-fetch-mode': secret, 'sec-fetch-dest': secret, 'sec-fetch-user': secret,
        origin: `https://${secret}.example`, referer: `https://${hostname}/private?token=${secret}`, cookie: `student=${secret}`,
        'x-private-header': secret, authorization: `Bearer ${secret}` } });
    assert.equal(result.status, 403);
  }
  const stats = f.gateway.statistics();
  assert.equal(stats.recentRejections.length, 8);
  assert.deepEqual(stats.recentRejections[0], {
    code: 'GATEWAY_CROSS_SITE_REJECTED', host: hostname, method: 'POST', fetchSite: 'other', fetchMode: 'other', fetchDest: 'other', fetchUser: 'other',
    hasOrigin: true, originMatchesTarget: false, referrerAllowed: true, landingCategory: 'other',
  });
  assert.equal(JSON.stringify(stats).includes(secret), false);
  assert.equal(JSON.stringify(stats).includes(token), false);
  assert.equal(f.state.calls.length, 0);
  stats.recentRejections[0].host = secret;
  stats.recentRejections.pop();
  assert.equal(f.gateway.statistics().recentRejections.length, 8);
  assert.equal(JSON.stringify(f.gateway.statistics()).includes(secret), false);
});

test('navigation diagnostics describe an Info landing rejection without allowing it', async t => {
  const f = await fixture(t, { allowedOrigins: ['https://info.tsinghua.edu.cn'] });
  const result = await proxyRequest(f, { url: 'https://info.tsinghua.edu.cn/?private=query', headers: {
    host: 'info.tsinghua.edu.cn', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
    'sec-fetch-user': '?1', origin: 'https://info.tsinghua.edu.cn', referer: 'https://external.example/private',
  } });
  assert.equal(result.status, 403);
  assert.deepEqual(f.gateway.statistics().recentRejections, [{
    code: 'GATEWAY_CROSS_SITE_REJECTED', host: 'info.tsinghua.edu.cn', method: 'GET', fetchSite: 'cross-site', fetchMode: 'navigate',
    fetchDest: 'document', fetchUser: '?1', hasOrigin: true, originMatchesTarget: true, referrerAllowed: false, landingCategory: 'info-home',
  }]);
  assert.equal(f.state.calls.length, 0);
});

test('TLS tunnel rejection diagnostics capture missing navigation metadata without request contents', async t => {
  const f = await fixture(t, { withTls: true });
  const result = await tlsRequest(f, { path: '/f/wlxt/index/course/student/?private=hidden', headers: { 'sec-fetch-site': null } });
  assert.equal(result.status, 403);
  assert.deepEqual(f.gateway.statistics().recentRejections, [{
    code: 'GATEWAY_PROVENANCE_REQUIRED', host: hostname, method: 'GET', fetchSite: 'missing', fetchMode: 'missing', fetchDest: 'missing', fetchUser: 'missing',
    hasOrigin: false, originMatchesTarget: false, referrerAllowed: false, landingCategory: 'learn-home',
  }]);
});

const landingNavigationHeaders = {
  'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1',
};
const infoNewsLanding = 'https://info.tsinghua.edu.cn/f/info/xxfb_fg/xnzx/stu/index';

test('user-activated cross-site navigation accepts only explicit empty-query campus landings', async t => {
  const f = await fixture(t, { allowedOrigins: ['https://info.tsinghua.edu.cn', `https://${hostname}`],
    token: undefined, authorizeSocket: async () => true });
  const infoLandings=['https://info.tsinghua.edu.cn/',infoNewsLanding,
    'https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/index',
    'https://info.tsinghua.edu.cn/f/info/portal_fg/student/yyfwxxindex'];
  for (const url of [...infoLandings, `https://${hostname}/f/wlxt/index/course/student/`]) {
    for (const method of ['GET', 'HEAD']) {
      const result = await proxyRequest(f, { auth: false, url, method, headers: { ...landingNavigationHeaders, host: new URL(url).host } });
      assert.equal(result.status, 200, `${method} ${url}`);
    }
  }
  assert.equal(f.state.calls.length, 10);
  assert.deepEqual(f.gateway.statistics().recentRejections, []);
  for(const landing of infoLandings) {
    const rejected=await proxyRequest(f,{auth:false,url:landing+'?action=change',headers:{...landingNavigationHeaders,host:'info.tsinghua.edu.cn'}});
    assert.equal(rejected.status,403);
  }
  assert.equal(f.state.calls.length,10);
});

test('landing exception cannot authorize forms, query actions, subresources, frames, or unactivated navigation', async t => {
  const f = await fixture(t, { allowedOrigins: ['https://info.tsinghua.edu.cn', `https://${hostname}`],
    token: undefined, authorizeSocket: async () => true });
  const attempts = [
    { method: 'POST', body: 'action=change' }, { method: 'POST' }, { method: 'DELETE' },
    { method: 'GET', body: 'action=change', headers: { 'content-length': '13' } },
    { url: `${infoNewsLanding}?action=change` }, { url: `${infoNewsLanding}?` }, { url: `${infoNewsLanding}#private` },
    { url: `${infoNewsLanding}/` }, { url: 'https://info.tsinghua.edu.cn/logout' },
    { url: `https://${hostname}/f/wlxt/index/course/student/course?wlkcid=private` },
    { headers: { 'sec-fetch-user': null } }, { headers: { 'sec-fetch-user': '?0' } },
    { headers: { 'sec-fetch-mode': 'cors' } }, { headers: { 'sec-fetch-mode': null } },
    { headers: { 'sec-fetch-dest': 'iframe' } }, { headers: { 'sec-fetch-dest': 'image' } }, { headers: { 'sec-fetch-dest': null } },
    { headers: { origin: 'https://external.example' } }, { headers: { origin: 'https://info.tsinghua.edu.cn' } },
    { headers: { origin: 'null' } }, { headers: { 'sec-fetch-site': null } },
  ];
  for (const attempt of attempts) {
    const url = attempt.url ?? infoNewsLanding;
    const result = await proxyRequest(f, { ...attempt, auth: false, url,
      headers: { ...landingNavigationHeaders, host: new URL(url).host, ...attempt.headers } });
    assert.ok(result.status >= 400, JSON.stringify(attempt));
  }
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.gateway.statistics().recentRejections.at(-1).landingCategory, 'info-news');
});

test('TLS landing navigation retains socket authentication and preserves the actual request metadata', async t => {
  const f = await fixture(t, { withTls: true, request: (_url, init) => {
    assert.equal(init.headers.get('sec-fetch-site'), 'cross-site');
    assert.equal(init.headers.get('sec-fetch-user'), '?1');
    return new Response('landing');
  } });
  const result = await tlsRequest(f, { path: '/f/wlxt/index/course/student/', headers: landingNavigationHeaders });
  assert.equal(result.status, 200);
  const denied = await proxyRequest(f, { auth: false, url: `https://${hostname}/f/wlxt/index/course/student/`, headers: landingNavigationHeaders });
  assert.equal(denied.status, 407);
  assert.equal(f.state.calls.length, 1);
});

test('exact target policy rejects origin form, userinfo, nondefault port, suffix and Host confusion', async t => {
  const f = await fixture(t);
  for (const url of ['/course', `http://user:pass@${hostname}/`, `http://${hostname}:8080/`,
    `http://${hostname}.evil.invalid/`, 'http://127.0.0.1/', `http://${hostname}/#fragment`]) {
    const r = await proxyRequest(f, { url });
    assert.ok(r.status >= 400, `${url}: ${r.status}`);
  }
  assert.ok((await proxyRequest(f, { headers: { host: 'info.tsinghua.edu.cn' } })).status >= 400);
  assert.equal(f.state.calls.length, 0);
});

test('shared credentials are not attached to cross-site requests', async t => {
  const f = await fixture(t);
  for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://evil.invalid' }]) {
    assert.equal((await proxyRequest(f, { method: 'POST', body: 'action=change', headers })).status, 403);
  }
  assert.equal(f.state.calls.length, 0);
  assert.equal((await proxyRequest(f, { headers: { origin: `http://${hostname}`, 'sec-fetch-site': 'same-origin' } })).status, 200);
});

test('cached proxy authorization alone cannot grant requests with missing browser provenance', async t => {
  const f = await fixture(t, { withTls: true });
  const headers = { 'sec-fetch-site': null };
  assert.equal((await proxyRequest(f, { headers })).status, 403);
  assert.equal((await tlsRequest(f, { headers })).status, 403);
  assert.equal(f.state.calls.length, 0);
  assert.equal((await proxyRequest(f, { headers: { ...headers, origin: `http://${hostname}` } })).status, 200);
});

test('HTTPS uses an authenticated CONNECT and a certificate trusted only by this test client', async t => {
  const f = await fixture(t, { withTls: true });
  const r = await tlsRequest(f);
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), 'campus fixture');
  assert.deepEqual(f.state.certificates, [hostname]);
  assert.equal(f.state.calls[0].url, `https://${hostname}/course`);
});

test('only an explicitly projected Learn CSRF cookie reaches the browser', async t => {
  let projections = 0;
  const f = await fixture(t, { withTls: true, browserCookies: url => {
    projections++; assert.equal(new URL(url).origin, 'https://learn.tsinghua.edu.cn');
    return [{ name: 'XSRF-TOKEN', value: 'csrf-fixture%2Btoken' }];
  }, request: () => new Response('fixture', { headers: { 'Set-Cookie': 'JSESSIONID=must-stay-private; Path=/' } }) });
  const secure = await tlsRequest(f);
  assert.equal(secure.status, 200);
  assert.equal(String(secure.headers['set-cookie']), 'XSRF-TOKEN=csrf-fixture%2Btoken; Path=/; Secure; SameSite=Strict');
  const plain = await proxyRequest(f);
  assert.equal(plain.headers['set-cookie'], undefined); assert.equal(projections, 1);
  const expired = await fixture(t, { withTls: true, browserCookies: () => [] });
  assert.equal(String((await tlsRequest(expired)).headers['set-cookie']), 'XSRF-TOKEN=; Path=/; Secure; SameSite=Strict; Max-Age=0');
  for (const cookie of [{ name: 'JSESSIONID', value: 'private' }, { name: 'XSRF-TOKEN', value: 'bad; Domain=evil.example' }]) {
    const denied = await fixture(t, { withTls: true, browserCookies: () => [cookie] });
    assert.equal((await tlsRequest(denied)).status, 502);
  }
});

test('CONNECT without TLS support reports unsupported rather than claiming shared login', async t => {
  const f = await fixture(t);
  const tunnel = await connect(f);
  assert.equal(tunnel.status, 501);
  tunnel.socket.destroy();
  assert.equal(f.state.calls.length, 0);
});

test('CONNECT cannot be reused to request another HTTPS authority', async t => {
  const f = await fixture(t, { withTls: true });
  const r = await tlsRequest(f, { hostHeader: 'info.tsinghua.edu.cn' });
  assert.ok(r.status >= 400);
  assert.equal(f.state.calls.length, 0);
});

test('SNI must match CONNECT even when the test certificate covers both names', async t => {
  const f = await fixture(t, { withTls: true });
  await assert.rejects(tlsRequest(f, { servername: 'info.tsinghua.edu.cn' }));
  assert.equal(f.state.calls.length, 0);
});

test('binary response bytes and declared legacy charset are preserved', async t => {
  const bytes = Buffer.from([0, 255, 214, 208, 206, 196, 128, 1]);
  const f = await fixture(t, { request: () => new Response(bytes, { headers: { 'content-type': 'text/html; charset=gbk' } }) });
  const r = await proxyRequest(f);
  assert.deepEqual(r.body, bytes);
  assert.match(r.headers['content-type'], /charset=gbk/);
});

test('fetch-decoded response is not incorrectly marked compressed or given stale length', async t => {
  const f = await fixture(t, { request: () => new Response('decoded content', { headers: { 'content-encoding': 'gzip', 'content-length': '999' } }) });
  const r = await proxyRequest(f);
  assert.equal(r.body.toString(), 'decoded content');
  assert.equal(r.headers['content-encoding'], undefined);
  assert.notEqual(r.headers['content-length'], '999');
});

test('redirect is delivered to the client without a credentialed request to the destination', async t => {
  const f = await fixture(t, { request: () => new Response(null, { status: 302, headers: { location: 'https://external.invalid/' } }) });
  const r = await proxyRequest(f);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, 'https://external.invalid/');
  assert.equal(f.state.calls.length, 1);
});

test('upload is passed as a stream and a failed write is never retried', async t => {
  const bytes = Buffer.alloc(256 * 1024, 0xab);
  const f = await fixture(t, { request: async (_url, init) => {
    assert.equal(init.duplex, 'half');
    assert.equal(typeof init.body?.[Symbol.asyncIterator], 'function');
    const chunks = [];
    for await (const chunk of init.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
    throw new Error('upstream private details Cookie=secret');
  } });
  const r = await proxyRequest(f, { method: 'POST', body: bytes });
  assert.equal(r.status, 502);
  assert.doesNotMatch(r.body.toString(), /private|Cookie|secret/);
  assert.equal(f.state.calls.length, 1);
});

test('explicit upload limit fails before dispatch when Content-Length exceeds the limit', async t => {
  const f = await fixture(t, { maxUploadBytes: 16 });
  const r = await proxyRequest(f, { method: 'POST', body: Buffer.alloc(17), headers: { 'content-length': '17' } });
  assert.equal(r.status, 413);
  assert.equal(f.state.calls.length, 0);
});

test('request timeout aborts authority work and exposes no upstream details', async t => {
  let aborted = false;
  const f = await fixture(t, { timeoutMs: 50, request: (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('secret timeout')); }, { once: true });
  }) });
  const r = await proxyRequest(f);
  assert.ok(r.status >= 500);
  assert.equal(aborted, true);
  assert.doesNotMatch(r.body.toString(), /secret/);
});

test('account change while awaiting headers prevents old account content being returned', async t => {
  const f = await fixture(t, { request: (_url, _init, state) => {
    state.epoch++;
    return new Response('OLD_ACCOUNT_PRIVATE_CONTENT');
  } });
  const r = await proxyRequest(f);
  assert.ok(r.status >= 400);
  assert.doesNotMatch(r.body.toString(), /OLD_ACCOUNT_PRIVATE_CONTENT|private account/);
});

test('account change during a stream stops subsequent private chunks', async t => {
  const f = await fixture(t, { request: (_url, _init, state) => {
    let sent = false;
    return new Response(new ReadableStream({
      async pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('first')); return; }
        await new Promise(resolve => setTimeout(resolve, 25));
        state.epoch++;
        controller.enqueue(new TextEncoder().encode('OLD_ACCOUNT_PRIVATE_CONTENT'));
        controller.close();
      },
    }));
  } });
  let received = '';
  await new Promise((resolve, reject) => {
    const request = http.get({ host: f.address.host, port: f.address.port, path: `http://${hostname}/`, headers: { host: hostname, 'sec-fetch-site': 'none', 'proxy-authorization': authorization } }, response => {
      response.on('data', chunk => { received += chunk.toString(); });
      response.on('error', resolve);
      response.on('end', resolve);
    });
    request.on('error', reject);
  });
  assert.doesNotMatch(received, /OLD_ACCOUNT_PRIVATE_CONTENT/);
});

test('closing gateway cancels pending requests and releases its listener', async t => {
  let begin;
  const begun = new Promise(resolve => { begin = resolve; });
  let aborted = false;
  const f = await fixture(t, { request: (_url, init) => new Promise((_resolve, reject) => {
    begin();
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('closed')); }, { once: true });
  }) });
  const pending = proxyRequest(f).catch(() => null);
  await begun;
  await f.gateway.close();
  await pending;
  assert.equal(aborted, true);
  await f.gateway.close();
});

test('oversized first download chunk returns an explicit error, never a truncated success', async t => {
  const f = await fixture(t, { maxDownloadBytes: 4, request: () => new Response('12345') });
  const r = await proxyRequest(f);
  assert.equal(r.status, 502);
  assert.match(r.body.toString(), /GATEWAY_DOWNLOAD_TOO_LARGE/);
});

test('chunked upload enforces its limit while streaming', async t => {
  const f = await fixture(t, { maxUploadBytes: 16, request: async (_url, init) => {
    for await (const _chunk of init.body) { /* Consume the bounded stream. */ }
    return new Response('accepted');
  } });
  const r = await proxyRequest(f, { method: 'POST', headers: { 'transfer-encoding': 'chunked' }, body: Buffer.alloc(17) });
  assert.equal(r.status, 413);
  assert.match(r.body.toString(), /GATEWAY_UPLOAD_TOO_LARGE/);
});

test('non-cooperating authority promises still time out', async t => {
  const f = await fixture(t, { timeoutMs: 40, request: () => new Promise(() => {}) });
  const r = await proxyRequest(f);
  assert.equal(r.status, 504);
});

test('certificate provider timeout does not establish a tunnel', async t => {
  const f = await fixture(t, { timeoutMs: 40, tls: () => new Promise(() => {}) });
  const tunnel = await connect(f);
  assert.equal(tunnel.status, 504);
  tunnel.socket.destroy();
  assert.equal(f.state.calls.length, 0);
});

test('real Fetch-decoded gzip range cannot be returned with the original encoded byte interval', async t => {
  const compressed = gzipSync(Buffer.from('range data '.repeat(100)));
  const upstream = http.createServer((_req, res) => res.writeHead(206, {
    'content-encoding': 'gzip', 'content-range': `bytes 0-${compressed.length - 1}/${compressed.length}`,
    'content-length': compressed.length,
  }).end(compressed));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => new Promise(resolve => upstream.close(resolve)));
  const f = await fixture(t, { request: () => fetch(`http://127.0.0.1:${upstream.address().port}/`) });
  const r = await proxyRequest(f, { headers: { range: 'bytes=0-' } });
  assert.equal(r.status, 502);
  assert.match(r.body.toString(), /GATEWAY_ENCODED_RANGE_UNSUPPORTED/);
  assert.equal(r.headers['content-range'], undefined);
});

test('unencoded partial responses retain their correct byte range', async t => {
  const f = await fixture(t, { request: (_url, init) => {
    assert.equal(new Headers(init.headers).get('accept-encoding'), 'identity');
    return new Response('abc', { status: 206, headers: { 'content-range': 'bytes 0-2/100' } });
  } });
  const r = await proxyRequest(f, { headers: { range: 'bytes=0-2' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers['content-range'], 'bytes 0-2/100');
  assert.equal(r.body.toString(), 'abc');
});
