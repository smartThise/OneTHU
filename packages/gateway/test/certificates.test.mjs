import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import tls from 'node:tls';
import { once } from 'node:events';
import { createCertificateAuthority } from '../src/certificates.mjs';

const hosts = ['learn.tsinghua.edu.cn', 'info.tsinghua.edu.cn', 'id.tsinghua.edu.cn'];
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'onethu-ca-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ca = await createCertificateAuthority({ directory, allowedHosts: hosts, ...options });
  return { ca, directory };
}

test('CA is unique per installation, persists, and exposes no private material', async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  assert.notEqual(a.ca.fingerprint, b.ca.fingerprint);
  const reused = await createCertificateAuthority({ directory: a.directory, allowedHosts: hosts });
  assert.equal(reused.fingerprint, a.ca.fingerprint);
  assert.equal(reused.certificatePem, await readFile(a.ca.certificatePath, 'utf8'));
  assert.doesNotMatch(JSON.stringify(a.ca.status()), /PRIVATE KEY|privateKey/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(a.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(a.directory, 'ca-identity.json'))).mode & 0o777, 0o600);
  }
});

test('issued leaf validates against its CA with exactly one permitted SAN and includes the root chain', async t => {
  const { ca } = await fixture(t);
  const issued = await ca.issue(hosts[0]);
  const leaf = new X509Certificate(issued.cert);
  const root = new X509Certificate(ca.certificatePem);
  assert.equal(leaf.ca, false);
  assert.equal(leaf.subjectAltName, `DNS:${hosts[0]}`);
  assert.equal(leaf.checkHost(hosts[1]), undefined);
  assert.equal(leaf.checkPrivateKey(createPrivateKey(issued.key)), true);
  assert.equal(leaf.verify(root.publicKey), true);
  assert.equal(issued.cert.match(/BEGIN CERTIFICATE/g).length, 2);
  const server = tls.createServer(issued, socket => socket.end('verified'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = tls.connect({ host: '127.0.0.1', port: server.address().port, servername: hosts[0], ca: ca.certificatePem });
  await once(client, 'secureConnect');
  assert.equal(client.authorized, true);
  client.resume();
  await once(client, 'close');
});

test('exact hostname policy rejects aliases, suffixes, wildcards, case variants and IP literals', async t => {
  const { ca } = await fixture(t);
  for (const host of ['evil.tsinghua.edu.cn', `evil.${hosts[0]}`, `${hosts[0]}.evil.example`, `*.${hosts[0]}`, hosts[0].toUpperCase(), `${hosts[0]}.`, '127.0.0.1', 'localhost']) {
    await assert.rejects(ca.issue(host), { code: 'GATEWAY_CERTIFICATE_HOST_REJECTED' });
  }
});

test('issuance deduplicates concurrent work, bounds LRU cache and supports AbortSignal', async t => {
  const { ca } = await fixture(t, { maxCachedCertificates: 1 });
  const first = await Promise.all([ca.issue(hosts[0]), ca.issue(hosts[0])]);
  assert.equal(first[0], first[1]);
  await ca.issue(hosts[1]);
  assert.equal(ca.status().cachedCertificates, 1);
  assert.notEqual((await ca.issue(hosts[0])).cert, first[0].cert);
  const alreadyAborted = AbortSignal.abort(new Error('cancelled'));
  await assert.rejects(ca.issue(hosts[0], { signal: alreadyAborted }), /cancelled/);
  const controller = new AbortController();
  const issue = ca.issue(hosts[2], { signal: controller.signal });
  controller.abort();
  await assert.rejects(issue, { name: 'AbortError' });
  await ca.issue(hosts[2]);
});

test('dynamic authorization issues one exact campus SAN and rechecks cached membership', async t => {
  const dynamic = 'service.tsinghua.edu.cn';
  const registered = new Set([dynamic]);
  const lookedUp = [];
  const { ca } = await fixture(t, { authorizeHost(host) { lookedUp.push(host); return registered.has(host); } });
  const issued = await ca.issue(dynamic);
  const leaf = new X509Certificate(issued.cert);
  assert.equal(leaf.subjectAltName, `DNS:${dynamic}`);
  assert.equal(leaf.checkHost('other.tsinghua.edu.cn'), undefined);
  assert.equal(leaf.verify(new X509Certificate(ca.certificatePem).publicKey), true);
  assert.equal(await ca.issue(dynamic), issued);
  registered.delete(dynamic);
  await assert.rejects(ca.issue(dynamic), { code: 'GATEWAY_CERTIFICATE_HOST_REJECTED' });
  assert.equal(ca.status().cachedCertificates, 0);
  const lookupsBeforeStatic = lookedUp.length;
  await ca.issue(hosts[0]);
  assert.equal(lookedUp.length, lookupsBeforeStatic, 'static exact hosts do not depend on registry availability');
  assert(lookedUp.every(host => host === dynamic));
});

test('dynamic callback cannot authorize identity hosts, external domains, IPs or noncanonical names', async t => {
  let lookups = 0;
  const { ca } = await fixture(t, { allowedHosts: [hosts[0]], authorizeHost() { lookups++; return true; } });
  for (const host of [
    'id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn', 'webvpn.tsinghua.edu.cn',
    'tsinghua.edu.cn', 'nottsinghua.edu.cn', 'tsinghua.edu.cn.outside.test', 'outside.test',
    '*.tsinghua.edu.cn', 'service.tsinghua.edu.cn.', 'Service.tsinghua.edu.cn',
    'service.tsinghua.edu.cn:443', 'user@service.tsinghua.edu.cn', '127.0.0.1', '[::1]', 'localhost',
  ]) await assert.rejects(ca.issue(host), { code: 'GATEWAY_CERTIFICATE_HOST_REJECTED' }, host);
  assert.equal(lookups, 0, 'invalid targets never reach the registry');
  await ca.issue('nested.service.tsinghua.edu.cn');
  assert(lookups > 0);
});

test('dynamic lookup requires synchronous strict true and masks callback failures', async t => {
  let result;
  const { ca } = await fixture(t, { authorizeHost() { if (result instanceof Error) throw result; return result; } });
  for (const value of [false, undefined, null, 1, 'true', {}, Promise.resolve(true), new Error('private registry detail')]) {
    result = value;
    await assert.rejects(ca.issue('dynamic.tsinghua.edu.cn'), { code: 'GATEWAY_CERTIFICATE_HOST_REJECTED', message: 'GATEWAY_CERTIFICATE_HOST_REJECTED' });
  }
  result = Promise.reject(new Error('private asynchronous registry detail'));
  await assert.rejects(ca.issue('dynamic.tsinghua.edu.cn'), { code: 'GATEWAY_CERTIFICATE_HOST_REJECTED' });
  assert.equal(ca.status().cachedCertificates, 0);
  const directory = join(tmpdir(), 'onethu-ca-invalid-callback-unused');
  await assert.rejects(createCertificateAuthority({ directory, allowedHosts: hosts, authorizeHost: true }), { code: 'GATEWAY_CERTIFICATE_CONFIG_INVALID' });
});

test('revocation during asynchronous issuance rejects all waiters without caching the certificate', async t => {
  let active = true;
  const { ca } = await fixture(t, { authorizeHost: () => active, maxCachedCertificates: 1 });
  const dynamic = 'pending.tsinghua.edu.cn';
  const results = Promise.allSettled([ca.issue(dynamic), ca.issue(dynamic)]);
  active = false;
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'GATEWAY_CERTIFICATE_HOST_REJECTED');
  }
  assert.equal(ca.status().cachedCertificates, 0);
  assert.equal(ca.status().pendingCertificates, 0);
  active = true;
  await ca.issue(dynamic);
  await ca.issue('second.tsinghua.edu.cn');
  assert.equal(ca.status().cachedCertificates, 1, 'dynamic hosts share the bounded LRU cache');
});

test('authorization is checked again before asynchronous issuance returns to its caller', async t => {
  let lookups = 0;
  const { ca } = await fixture(t, { authorizeHost: () => ++lookups < 3 });
  await assert.rejects(ca.issue('revoked.tsinghua.edu.cn'), { code: 'GATEWAY_CERTIFICATE_HOST_REJECTED' });
  assert.equal(lookups, 3);
  assert.equal(ca.status().cachedCertificates, 0);
});

test('concurrent factories share one creation, corrupt or mismatched identity is never replaced', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'onethu-ca-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const [a, b] = await Promise.all([1, 2].map(() => createCertificateAuthority({ directory, allowedHosts: hosts })));
  assert.equal(a.fingerprint, b.fingerprint);
  const path = join(directory, 'ca-identity.json');
  await writeFile(path, '{broken', { mode: 0o600 });
  await assert.rejects(createCertificateAuthority({ directory, allowedHosts: hosts }), { code: 'GATEWAY_CERTIFICATE_IDENTITY_INVALID' });
  assert.equal(await readFile(path, 'utf8'), '{broken');
});

test('unsafe directory, symlinked identity and a replaced public certificate fail closed', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  await writeFile(first.ca.certificatePath, second.ca.certificatePem);
  await assert.rejects(createCertificateAuthority({ directory: first.directory, allowedHosts: hosts }), { code: 'GATEWAY_CERTIFICATE_PUBLIC_COPY_MISMATCH' });
  const identity = join(second.directory, 'ca-identity.json');
  await rm(identity);
  await symlink(join(first.directory, 'ca-identity.json'), identity);
  await assert.rejects(createCertificateAuthority({ directory: second.directory, allowedHosts: hosts }), { code: 'GATEWAY_CERTIFICATE_FILE_UNSAFE' });
  if (process.platform !== 'win32') {
    const third = await fixture(t);
    await chmod(third.directory, 0o755);
    await assert.rejects(createCertificateAuthority({ directory: third.directory, allowedHosts: hosts }), { code: 'GATEWAY_CERTIFICATE_DIRECTORY_UNSAFE' });
  }
});
