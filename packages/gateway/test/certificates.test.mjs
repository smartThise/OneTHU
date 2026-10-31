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
