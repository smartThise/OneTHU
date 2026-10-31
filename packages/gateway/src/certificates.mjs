import 'reflect-metadata';
import * as x509 from '@peculiar/x509';
import { webcrypto, X509Certificate, createPrivateKey, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { isIP } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
const DAY = 86_400_000;
const creations = new Map();
const IDENTITY_HOSTS = new Set(['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn', 'webvpn.tsinghua.edu.cn']);
const exec = promisify(execFile);
const failure = code => Object.assign(new Error(code), { code });
const serial = () => `01${randomBytes(19).toString('hex')}`;
const pem = (kind, value) => `-----BEGIN ${kind}-----\n${Buffer.from(value).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${kind}-----\n`;

function hostname(value) {
  if (typeof value !== 'string' || value !== value.toLowerCase() || value.length > 253 || !value.includes('.') || isIP(value) ||
      !value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw failure('GATEWAY_CERTIFICATE_HOST_REJECTED');
  return value;
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32' &&
      ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())) throw failure('GATEWAY_CERTIFICATE_DIRECTORY_UNSAFE');
  if (process.platform === 'win32') await windowsPermissions(directory, true);
}

async function windowsPermissions(path, directory) {
  // Node's mode bits do not restrict NTFS ACLs. Replace inherited permissions
  // only on our own storage object, granting the current SID and SYSTEM access.
  const data = Buffer.from(JSON.stringify({ path, directory })).toString('base64');
  const script = `$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$item = Get-Item -LiteralPath $request.path -Force
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe certificate storage' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = if ($request.directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
$inheritance = if ($request.directory) { [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
foreach ($sid in @($identity, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
}
Set-Acl -LiteralPath $request.path -AclObject $acl`;
  try {
    await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { timeout: 30_000, maxBuffer: 64 * 1024, windowsHide: true });
  } catch { throw failure('GATEWAY_CERTIFICATE_PERMISSIONS_FAILED'); }
}

async function readFile(path, secret = false) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    const entry = await lstat(path);
    if (!stat.isFile() || entry.isSymbolicLink() || stat.nlink !== 1 || stat.size > 32_768 || process.platform !== 'win32' &&
        (stat.uid !== process.getuid() || secret && (stat.mode & 0o077) !== 0)) throw failure('GATEWAY_CERTIFICATE_FILE_UNSAFE');
    if (secret && process.platform === 'win32') await windowsPermissions(path, false);
    return await file.readFile('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw failure('GATEWAY_CERTIFICATE_FILE_UNSAFE');
    throw error;
  } finally { await file?.close(); }
}

async function writeNew(path, value) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}

async function loadIdentity(directory) {
  await privateDirectory(directory);
  const identityPath = join(directory, 'ca-identity.json');
  const certificatePath = join(directory, 'ca.pem');
  const lockPath = join(directory, '.ca-create.lock');
  let raw = await readFile(identityPath, true);
  if (raw === null) {
    let lock;
    try {
      lock = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST') throw failure('GATEWAY_CERTIFICATE_CREATION_IN_PROGRESS');
      throw error;
    }
    try {
      // Another process may have completed between the first read and our lock.
      raw = await readFile(identityPath, true);
      if (raw === null) {
        if (await readFile(certificatePath) !== null) throw failure('GATEWAY_CERTIFICATE_IDENTITY_MISSING');
        const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
        const certificate = await x509.X509CertificateGenerator.createSelfSigned({
          serialNumber: serial(), name: `CN=OneTHU Local Gateway ${randomBytes(8).toString('hex')}`,
          notBefore: new Date(Date.now() - 5 * 60_000), notAfter: new Date(Date.now() + 5 * 365 * DAY),
          keys, signingAlgorithm: algorithm,
          extensions: [new x509.BasicConstraintsExtension(true, 0, true),
            new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
            await x509.SubjectKeyIdentifierExtension.create(keys.publicKey, false, webcrypto)],
        }, webcrypto);
        raw = JSON.stringify({ version: 1, certificate: certificate.toString('pem'),
          privateKey: pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)) });
        await writeNew(identityPath, raw);
      }
    } finally { await lock.close(); await unlink(lockPath); }
  }
  let certificate, privateKey, parsed;
  try {
    const identity = JSON.parse(raw);
    if (identity.version !== 1) throw new Error();
    certificate = new X509Certificate(identity.certificate);
    const key = createPrivateKey(identity.privateKey);
    if (!certificate.ca || !certificate.checkPrivateKey(key) || !certificate.verify(certificate.publicKey) ||
        certificate.subject !== certificate.issuer || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
        Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now() + DAY) throw new Error();
    parsed = new x509.X509Certificate(identity.certificate);
    privateKey = await webcrypto.subtle.importKey('pkcs8', key.export({ type: 'pkcs8', format: 'der' }), algorithm, false, ['sign']);
  } catch { throw failure('GATEWAY_CERTIFICATE_IDENTITY_INVALID'); }
  const certificatePem = certificate.toString();
  const publicCopy = await readFile(certificatePath);
  if (publicCopy === null) {
    try { await writeNew(certificatePath, certificatePem); }
    catch (error) { if (error.code !== 'EEXIST' || (await readFile(certificatePath)) !== certificatePem) throw error; }
  } else {
    try { if (!new X509Certificate(publicCopy).raw.equals(certificate.raw)) throw new Error(); }
    catch { throw failure('GATEWAY_CERTIFICATE_PUBLIC_COPY_MISMATCH'); }
  }
  return { certificatePath, certificatePem, fingerprint: certificate.fingerprint256, privateKey, parsed };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolvePromise, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Certificate request aborted', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolvePromise, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Explicitly creates/loads a per-installation CA. Importing this module has no OS or filesystem effects.
 * authorizeHost is a synchronous lookup of the current service registry, never
 * a discovery or network operation. Dynamic authorization is checked on every
 * issue, including cache hits and completion of asynchronous key generation. */
export async function createCertificateAuthority({ directory, allowedHosts, authorizeHost, maxCachedCertificates = 64 } = {}) {
  if (typeof directory !== 'string' || !directory || !Array.isArray(allowedHosts) || !allowedHosts.length || allowedHosts.length > 256 ||
      authorizeHost !== undefined && typeof authorizeHost !== 'function' ||
      !Number.isSafeInteger(maxCachedCertificates) || maxCachedCertificates < 1 || maxCachedCertificates > 256) throw failure('GATEWAY_CERTIFICATE_CONFIG_INVALID');
  const allowed = new Set(allowedHosts.map(hostname));
  const location = resolve(directory);
  let creating = creations.get(location);
  if (!creating) {
    creating = loadIdentity(location);
    creations.set(location, creating);
    void creating.finally(() => { if (creations.get(location) === creating) creations.delete(location); }).catch(() => {});
  }
  const identity = await creating;
  const cache = new Map();
  const pending = new Map();
  function assertAuthorized(host) {
    hostname(host);
    if (allowed.has(host)) return;
    let authorized = false;
    if (authorizeHost && host.endsWith('.tsinghua.edu.cn') && !IDENTITY_HOSTS.has(host)) {
      try {
        const result = authorizeHost(host);
        authorized = result === true;
        // Async callbacks cannot authorize issuance. Observe a rejected promise
        // so a mistaken async lookup cannot create an unhandled rejection.
        if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
      } catch { /* Registry failures never authorize a host or expose details. */ }
    }
    if (!authorized) {
      cache.delete(host);
      throw failure('GATEWAY_CERTIFICATE_HOST_REJECTED');
    }
  }
  async function generate(host) {
    const keys = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']);
    const expires = Math.min(Date.now() + 7 * DAY, identity.parsed.notAfter.getTime());
    const certificate = await x509.X509CertificateGenerator.create({
      serialNumber: serial(), subject: `CN=${host}`, issuer: identity.parsed.subject,
      notBefore: new Date(Date.now() - 5 * 60_000), notAfter: new Date(expires),
      publicKey: keys.publicKey, signingKey: identity.privateKey, signingAlgorithm: algorithm,
      extensions: [new x509.BasicConstraintsExtension(false, undefined, true),
        new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
        new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
        new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: host }]),
        await x509.AuthorityKeyIdentifierExtension.create(identity.parsed, false, webcrypto)],
    }, webcrypto);
    const value = Object.freeze({ key: pem('PRIVATE KEY', await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)),
      cert: `${certificate.toString('pem')}\n${identity.certificatePem}` });
    assertAuthorized(host);
    cache.set(host, { value, expires });
    while (cache.size > maxCachedCertificates) cache.delete(cache.keys().next().value);
    return value;
  }
  return Object.freeze({
    certificatePath: identity.certificatePath, certificatePem: identity.certificatePem, fingerprint: identity.fingerprint,
    async issue(host, { signal } = {}) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Certificate request aborted', 'AbortError');
      assertAuthorized(host);
      const cached = cache.get(host);
      if (cached && cached.expires > Date.now() + 60_000) {
        cache.delete(host); cache.set(host, cached); return cached.value;
      }
      cache.delete(host);
      let work = pending.get(host);
      if (!work) {
        if (pending.size >= 16) throw failure('GATEWAY_CERTIFICATE_BUSY');
        work = generate(host);
        pending.set(host, work);
        void work.finally(() => pending.delete(host)).catch(() => {});
      }
      const value = await abortable(work, signal);
      assertAuthorized(host);
      return value;
    },
    status: () => ({ certificatePath: identity.certificatePath, fingerprint: identity.fingerprint,
      expiresAt: identity.parsed.notAfter.toISOString(), cachedCertificates: cache.size, pendingCertificates: pending.size }),
  });
}
