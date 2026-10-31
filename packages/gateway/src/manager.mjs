import http from 'node:http';
import { randomBytes, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCampusGateway } from './index.mjs';
import { GatewayError, normalizeAllowedOrigins } from './policy.mjs';
import { createCertificateAuthority } from './certificates.mjs';
import { createPlatformIntegration } from './platform.mjs';
import { openGatewayBrowser } from './browser.mjs';
import { withSecureCampusOrigins } from './routes.mjs';
export { DEFAULT_UPSTREAM_ORIGINS } from './routes.mjs';

export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://info.tsinghua.edu.cn', 'https://learn.tsinghua.edu.cn',
  'https://id.tsinghua.edu.cn', 'https://oauth.tsinghua.edu.cn',
  'https://card.tsinghua.edu.cn', 'http://zhjw.cic.tsinghua.edu.cn',
  'http://zhjwxk.cic.tsinghua.edu.cn', 'https://zhjwxk.cic.tsinghua.edu.cn',
  'http://myhome.tsinghua.edu.cn', 'https://m.myhome.tsinghua.edu.cn',
  'https://seat.lib.tsinghua.edu.cn', 'https://cab.lib.tsinghua.edu.cn',
  'https://dzpj.tsinghua.edu.cn', 'https://usereg.tsinghua.edu.cn',
  'https://app.cs.tsinghua.edu.cn', 'http://jxgl.cic.tsinghua.edu.cn',
  'http://yhdf.tsinghua.edu.cn', 'http://zzjl.graduate.tsinghua.edu.cn',
]);

const fail = (code, status = 400) => { throw new GatewayError(code, status); };
const safeCode = error => /^GATEWAY_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'GATEWAY_CONTROL_FAILED';

async function privateToken(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await lstat(directory);
  if (dir.isSymbolicLink() || !dir.isDirectory() || process.platform !== 'win32' &&
      (dir.uid !== process.getuid() || (dir.mode & 0o077))) fail('GATEWAY_DIRECTORY_UNSAFE');
  const path = join(directory, 'proxy-token');
  let file;
  try {
    try {
      file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      await file.writeFile(randomBytes(32).toString('base64url'));
      await file.sync();
      await file.close(); file = undefined;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    const entry = await lstat(path);
    if (!stat.isFile() || entry.isSymbolicLink() || stat.nlink !== 1 || stat.size !== 43 || process.platform !== 'win32' &&
        (stat.uid !== process.getuid() || (stat.mode & 0o077))) fail('GATEWAY_TOKEN_UNSAFE');
    const token = await file.readFile('utf8');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail('GATEWAY_TOKEN_INVALID');
    return token;
  } finally { await file?.close(); }
}

/** Scoped PAC: an unavailable gateway fails closed for campus URLs. Other
 * traffic goes DIRECT. System activation refuses an existing active proxy. */
export function createPacScript(origins, endpoint) {
  const allowed = [...normalizeAllowedOrigins(origins)];
  if (endpoint.host !== '127.0.0.1' || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) fail('GATEWAY_CONFIG_INVALID');
  const hosts = [...new Set(allowed.map(origin => new URL(origin).hostname))];
  return `function FindProxyForURL(url, host) {\n  var hosts = ${JSON.stringify(hosts)};\n  host = host.toLowerCase();\n  for (var i = 0; i < hosts.length; i++) {\n    if (host === hosts[i]) return "PROXY 127.0.0.1:${endpoint.port}";\n  }\n  return "DIRECT";\n}\n`;
}

async function servePac(origins, endpoint) {
  const path = `/campus-${randomBytes(18).toString('hex')}.pac`;
  const script = createPacScript(origins, endpoint);
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.url !== path || req.headers.origin ||
        !['127.0.0.1', 'localhost'].includes(String(req.headers.host).split(':')[0])) {
      res.writeHead(404, { 'Cache-Control': 'no-store', Connection: 'close' }).end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig', 'Content-Length': Buffer.byteLength(script),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
    res.end(req.method === 'HEAD' ? undefined : script);
  });
  server.headersTimeout = 5000; server.requestTimeout = 5000; server.maxHeadersCount = 20;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setTimeout(5000, () => socket.destroy()); });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}${path}`, close: () => new Promise(resolveClose => {
    for (const socket of sockets) socket.destroy(); server.close(resolveClose);
  }) };
}

/** One manager belongs to the already-open account authority. Creation and
 * status never create credentials, a second session, a CA, or change the OS.
 * @param {{dataDir: string, session: any, allowedOrigins?: readonly string[],
 * certificateFactory?: typeof createCertificateAuthority,
 * platformFactory?: typeof createPlatformIntegration,
 * browserFactory?: typeof openGatewayBrowser}} options
 */
export function createManagedGateway({ dataDir, session, allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  certificateFactory = createCertificateAuthority, platformFactory = createPlatformIntegration,
  browserFactory = openGatewayBrowser } = {}) {
  if (typeof dataDir !== 'string' || !dataDir || !session || typeof session.status !== 'function') fail('GATEWAY_CONFIG_INVALID');
  const origins = [...normalizeAllowedOrigins(withSecureCampusOrigins([...allowedOrigins]))];
  const directory = join(resolve(dataDir), 'gateway');
  const certificateDirectory = join(directory, 'certificates');
  const certificatePath = join(certificateDirectory, 'ca.pem');
  let authority, platform, proxy, pac, token, lastError = null;
  const browsers = new Set();
  let queue = Promise.resolve();
  let closed = false;

  async function existingPlatform() {
    if (platform) return platform;
    let fingerprint = '';
    try { fingerprint = new X509Certificate(await readFile(certificatePath)).fingerprint256; }
    catch (error) { if (error.code !== 'ENOENT') fail('GATEWAY_CERTIFICATE_PUBLIC_COPY_INVALID'); }
    if (!fingerprint) {
      try { await lstat(join(directory, 'platform-state.json')); fail('GATEWAY_CERTIFICATE_IDENTITY_MISSING'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { status: async () => ({ supported: ['darwin','win32'].includes(process.platform), trusted: false, proxyEnabled: false }),
        disableProxy: async () => ({ restored: true }), untrust: async () => ({ changed: false }) };
    }
    return platformFactory({ directory, certificatePath, fingerprint });
  }

  async function status() {
    const system = await (await existingPlatform()).status();
    const current = session.status();
    const certificate = authority ? { path: authority.certificatePath, fingerprint: authority.fingerprint, ready: true }
      : system.certificate ?? { ready: false };
    if (!certificate.path) {
      try { const parsed = new X509Certificate(await readFile(certificatePath)); Object.assign(certificate, { path: certificatePath, fingerprint: parsed.fingerprint256, ready: true }); }
      catch (error) { if (error.code !== 'ENOENT') fail('GATEWAY_CERTIFICATE_PUBLIC_COPY_INVALID'); }
    }
    return { running: !!proxy, endpoint: proxy?.address() ?? null, account: current,
      certificate: { ...certificate, trusted: system.trusted ?? system.certificate?.trusted },
      systemProxy: { ...system, enabled: system.proxyEnabled ?? system.enabled ?? false,
        recoveryRequired: !!system.recoveryRequired && (!proxy || !pac || system.pacUrl !== pac.url) },
      allowedOrigins: origins, pacUrl: pac?.url ?? null, lastError };
  }

  async function setup() {
    token ??= await privateToken(directory);
    authority ??= await certificateFactory({ directory: certificateDirectory, allowedHosts: [...new Set(origins.map(origin => new URL(origin).hostname))] });
    platform ??= platformFactory({ directory, certificatePath: authority.certificatePath, fingerprint: authority.fingerprint });
  }

  async function stop({ revoke = false } = {}) {
    let restoreError;
    if (revoke) { await proxy?.close(); proxy = undefined; }
    try {
      const integration = await existingPlatform();
      const state = await integration.status();
      if (state.proxyEnabled || state.enabled || state.recoveryRequired || state.systemProxy?.enabled || state.systemProxy?.recoveryRequired) {
        const restored = await integration.disableProxy({ confirm: true });
        if (restored.failures?.length) fail('GATEWAY_PROXY_RESTORE_FAILED');
      }
    } catch (error) { restoreError = error; }
    // Always retire managed browser profiles, including failed OS restoration.
    const results = await Promise.allSettled([...browsers].map(browser => browser.close()));
    browsers.clear();
    if (!restoreError || revoke) {
      await proxy?.close(); proxy = undefined;
      // During forced account revocation keep PAC serving a refused local port
      // until the old OS settings are explicitly repaired; never direct-fallback.
      if (!restoreError) { await pac?.close(); pac = undefined; }
    }
    if (restoreError) throw restoreError;
    if (results.some(result => result.status === 'rejected')) fail('GATEWAY_BROWSER_CLOSE_FAILED');
  }

  async function dispatch(params) {
    if (closed) fail('GATEWAY_CLOSED');
    if (!params || typeof params !== 'object' || Array.isArray(params)) fail('GATEWAY_CONTROL_INVALID');
    const { action, confirm } = params;
    if (action === 'status') return status();
    if (confirm !== true) fail('GATEWAY_CONFIRM_REQUIRED', 403);
    if (!['setup','start','stop','credentials','trust','untrust','system-enable','system-disable','open-browser'].includes(action)) fail('GATEWAY_ACTION_INVALID');
    if (action === 'stop') await stop({ revoke: params.revoke === true });
    else if (action === 'system-disable') {
      const restored = await (await existingPlatform()).disableProxy({ confirm: true });
      if (restored.failures?.length) fail('GATEWAY_PROXY_RESTORE_FAILED');
    }
    else if (action === 'untrust') {
      await stop(); await (await existingPlatform()).untrust({ confirm: true });
    } else {
      if (['start', 'open-browser', 'system-enable'].includes(action)) {
        const account = session.status();
        if (!account.authenticated && account.state !== 'ready') fail('GATEWAY_LOGIN_REQUIRED', 401);
      }
      await setup();
      if (action === 'start' && !proxy) {
        const state = await platform.status();
        if (state.proxyEnabled || state.recoveryRequired) fail('GATEWAY_PROXY_RECOVERY_REQUIRED');
        await pac?.close(); pac = undefined;
        const next = createCampusGateway({ allowedOrigins: origins, token, session, tls: (hostname, options) => authority.issue(hostname, options), upgradeInsecureRequests: true,
          maxUploadBytes: 1024 * 1024 * 1024, maxDownloadBytes: 4 * 1024 * 1024 * 1024, timeoutMs: 180_000 });
        try { const endpoint = await next.listen(); pac = await servePac(origins, endpoint); proxy = next; }
        catch (error) { await next.close(); throw error; }
      } else if (action === 'trust') await platform.trust({ confirm: true });
      else if (action === 'system-enable') {
        if (!proxy || !pac) fail('GATEWAY_NOT_RUNNING');
        await platform.enableProxy({ confirm: true, pacUrl: pac.url });
      } else if (action === 'credentials') {
        if (!proxy) fail('GATEWAY_NOT_RUNNING');
        return { username: 'onethu', password: token, endpoint: proxy.address() };
      } else if (action === 'open-browser') {
        if (!proxy || !pac) fail('GATEWAY_NOT_RUNNING');
        const browser = await browserFactory({ directory, endpoint: proxy.address(), pacUrl: pac.url,
          username: 'onethu', password: token, certificatePem: authority.certificatePem,
          url: origins.includes('https://learn.tsinghua.edu.cn') ? 'https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/' : `${origins[0]}/` });
        browsers.add(browser);
        browser.closed?.then(() => browsers.delete(browser), () => browsers.delete(browser));
      }
    }
    lastError = null;
    return status();
  }

  return {
    control(params) {
      const run = queue.then(() => dispatch(params)).catch(error => { lastError = safeCode(error); throw new GatewayError(lastError, error?.status ?? 500); });
      queue = run.catch(() => {}); return run;
    },
    close() {
      const run = queue.then(async () => {
        try { await stop({ revoke: true }); }
        finally { closed = true; await proxy?.close(); proxy = undefined; await pac?.close(); pac = undefined; }
      });
      queue = run.catch(() => {}); return run;
    },
  };
}
