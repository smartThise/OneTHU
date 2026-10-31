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
import { createCampusGateway } from '../src/index.mjs';

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
  const { request, withTls, ...settings } = options;
  const gateway = createCampusGateway({
    allowedOrigins: [`http://${hostname}`, `https://${hostname}`], token,
    timeoutMs: 2_000,
    session: {
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
