// Optional real-browser acceptance against an entirely local campus fixture.
// Requires Playwright plus a local Chrome/Chromium; no system trust is changed.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { X509Certificate, createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCampusGateway } from '../src/index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'onethu-gateway-browser-'));
let browser, gateway;
try {
  writeFileSync(join(dir, 'openssl.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=learn.tsinghua.edu.cn\n[ext]\nsubjectAltName=DNS:learn.tsinghua.edu.cn\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', join(dir, 'openssl.cnf'),
    '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio: 'ignore', timeout: 15_000 });
  const certificate = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
  const spki = createHash('sha256').update(new X509Certificate(certificate.cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  const token = randomBytes(32).toString('hex');
  const calls = [];
  gateway = createCampusGateway({ allowedOrigins: ['https://learn.tsinghua.edu.cn'], token,
    tls: async () => certificate,
    session: {
      epoch: () => 1,
      assertCurrent: value => assert.equal(value, 1),
      async request(url, init) {
        const target = new URL(url);
        assert.equal(target.origin, 'https://learn.tsinghua.edu.cn');
        assert.equal(init.redirect, 'manual');
        const headers = new Headers(init.headers);
        assert.equal(headers.has('proxy-authorization'), false);
        assert.equal(headers.has('cookie'), false);
        assert.equal(headers.has('authorization'), false);
        calls.push({ path: target.pathname, method: init.method, site: headers.get('sec-fetch-site') });
        if (target.pathname === '/redirect') return new Response(null, { status: 302, headers: { location: '/next' } });
        if (target.pathname === '/submit') {
          const chunks = [];
          for await (const chunk of init.body) chunks.push(chunk);
          assert.equal(Buffer.concat(chunks).toString(), 'fixture upload');
          return Response.json({ saved: true });
        }
        if (target.pathname === '/download') return new Response(Uint8Array.from([0, 255, 128, 1]), { headers: { 'content-type': 'application/octet-stream' } });
        return new Response('<!doctype html><title>OneTHU gateway fixture</title><h1>Local gateway fixture</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
      },
    },
  });
  const { host, port } = await gateway.listen();
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}),
    proxy: { server: `http://${host}:${port}`, username: 'onethu', password: token },
    args: [`--ignore-certificate-errors-spki-list=${spki}`, '--disable-background-networking'],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://learn.tsinghua.edu.cn/', { waitUntil: 'domcontentloaded', timeout: 15_000 });
  assert.equal(await page.title(), 'OneTHU gateway fixture');
  const result = await page.evaluate(async () => {
    document.cookie = 'otherAccount=fixture; path=/';
    const response = await fetch('/submit', { method: 'POST', headers: { authorization: 'Bearer OTHER_ACCOUNT' }, body: 'fixture upload' });
    const bytes = await (await fetch('/download')).arrayBuffer();
    return { status: response.status, json: await response.json(), bytes: Array.from(new Uint8Array(bytes)) };
  });
  assert.deepEqual(result, { status: 200, json: { saved: true }, bytes: [0, 255, 128, 1] });
  await page.goto('https://learn.tsinghua.edu.cn/redirect', { waitUntil: 'domcontentloaded' });
  assert.equal(page.url(), 'https://learn.tsinghua.edu.cn/next');
  assert.ok(calls.some(row => row.method === 'POST' && row.site === 'same-origin'));
  console.log(JSON.stringify({ browser: await browser.version(), result: 'passed', checks: ['HTTPS CONNECT with proxy authentication', 'test-certificate SPKI trust in temporary browser only', 'native Fetch Metadata', 'HTML navigation', 'streamed POST', 'binary download', 'browser Cookie/Authorization isolation', 'same-origin redirect'], requests: calls }, null, 2));
} finally {
  await browser?.close();
  await gateway?.close();
  rmSync(dir, { recursive: true, force: true });
}
