import http from 'node:http';
import { randomBytes, X509Certificate } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createCampusGateway } from './index.mjs';
import { GatewayError, normalizeAllowedOrigins, isCampusIdentityHost, originMembership } from './policy.mjs';
import { createCertificateAuthority } from './certificates.mjs';
import { createPlatformIntegration } from './platform.mjs';
import { openGatewayBrowser } from './browser.mjs';
import { GITLAB_ORIGIN, withSecureCampusOrigins } from './routes.mjs';
import { STU_ORIGIN } from './stuAuth.mjs';
import { DISCOVER_ORIGIN } from './discoverAuth.mjs';
import { THESIS_ORIGIN } from './thesisAuth.mjs';
import { createPacScript } from './pac.mjs';
import { createMacPeerAuthorizer } from './macPeer.mjs';
import { createWindowsPeerAuthorizer } from './windowsPeer.mjs';
import { createTrustedClientResolver } from './trustedClient.mjs';
import { CLIENT_IDENTITY_HOST, CLIENT_BUSINESS_HOSTS } from './clientIdentity.mjs';
import { gatewayCapabilities } from './capabilities.mjs';
import {readEndpointHints,writeEndpointHints} from './endpointHints.mjs';
import { createCampusPassthrough } from './passthrough.mjs';
import { serveManagement } from './management.mjs';
export { createPacScript } from './pac.mjs';
export { DEFAULT_UPSTREAM_ORIGINS } from './routes.mjs';

export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'https://info.tsinghua.edu.cn', 'https://learn.tsinghua.edu.cn',
  'https://card.tsinghua.edu.cn', 'http://zhjw.cic.tsinghua.edu.cn',
  'http://zhjwxk.cic.tsinghua.edu.cn', 'https://zhjwxk.cic.tsinghua.edu.cn',
  'http://myhome.tsinghua.edu.cn', 'https://m.myhome.tsinghua.edu.cn',
  'https://seat.lib.tsinghua.edu.cn', 'https://cab.lib.tsinghua.edu.cn',
  'https://dzpj.tsinghua.edu.cn', 'https://usereg.tsinghua.edu.cn',
  'https://app.cs.tsinghua.edu.cn', 'http://jxgl.cic.tsinghua.edu.cn',
  'http://yhdf.tsinghua.edu.cn', 'http://zzjl.graduate.tsinghua.edu.cn',
  GITLAB_ORIGIN, STU_ORIGIN, 'https://lib.tsinghua.edu.cn', DISCOVER_ORIGIN, THESIS_ORIGIN, 'https://www.xiaoda.tsinghua.edu.cn',
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

/** The loaded PAC gives campus URLs no direct fallback. Other traffic follows
 * the network service's inherited proxy rules, or DIRECT when none apply. */
async function servePac(origins, endpoint, fallback, options) {
  const path = options?.listener?.pacPath ?? `/campus-${randomBytes(18).toString('hex')}.pac`;
  const scriptNow = () => createPacScript(origins(), endpoint, fallback, {
    ...options, managementPort: options.managementPort(),
  });
  scriptNow();
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.url !== path || req.headers.origin ||
        !['127.0.0.1', 'localhost'].includes(String(req.headers.host).split(':')[0])) {
      res.writeHead(404, { 'Cache-Control': 'no-store', Connection: 'close' }).end(); return;
    }
    let script;
    try { script = scriptNow(); } catch { res.writeHead(503, { 'Cache-Control': 'no-store', Connection: 'close' }).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig', 'Content-Length': Buffer.byteLength(script),
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close' });
    res.end(req.method === 'HEAD' ? undefined : script);
  });
  server.headersTimeout = 5000; server.requestTimeout = 5000; server.maxHeadersCount = 20;
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.setTimeout(5000, () => socket.destroy()); });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(options?.listener?.pacPort??0, '127.0.0.1', resolveListen); });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}${path}`,hint:{pacPort:address.port,pacPath:path}, close: () => new Promise(resolveClose => {
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
  browserFactory = openGatewayBrowser, peerAuthorizerFactory,
  hostPlatform = process.platform } = {}) {
  if (typeof dataDir !== 'string' || !dataDir || !session || typeof session.status !== 'function') fail('GATEWAY_CONFIG_INVALID');
  const origins = [...normalizeAllowedOrigins(withSecureCampusOrigins([...allowedOrigins]))]
    .filter(origin => !isCampusIdentityHost(new URL(origin).hostname));
  if (!origins.length) fail('GATEWAY_CONFIG_INVALID');
  peerAuthorizerFactory ??= hostPlatform === 'win32' ? createWindowsPeerAuthorizer : createMacPeerAuthorizer;
  const dynamicOrigins = originMembership(new Set(), typeof session.authorizeTarget === 'function' ? target => session.authorizeTarget(target) : undefined);
  const authorizeDynamic = origin => dynamicOrigins.has(origin);
  const effectiveOrigins = () => {
    const all = new Set(origins);
    let current;
    try { current = session.allowedOrigins?.(); } catch { return [...all]; }
    if (current && typeof current.then === 'function') void Promise.resolve(current).catch(() => {});
    if (Array.isArray(current) && current.length <= 256) for (const origin of current) {
      if (all.size >= 256) break;
      if (authorizeDynamic(origin)) all.add(origin);
    }
    return [...all];
  };
  const directory = join(resolve(dataDir), 'gateway');
  const certificateDirectory = join(directory, 'certificates');
  const certificatePath = join(certificateDirectory, 'ca.pem');
  let authority, clientAuthority, platform, proxy, pac, management, token, endpointHints, lastError = null;
  let systemProxy;
  const systemPacs = new Map();
  const browsers = new Set();
  let queue = Promise.resolve();
  let closed = false;
  const bypassHosts = () => endpointHints?.bypassHosts ?? [];
  const managementPort = () => management?.port;
  const isBypassed = host => bypassHosts().includes(host);

  function accountKey() {
    const key = session.accountKey?.();
    return typeof key === 'string' && /^[a-f0-9]{64}$/.test(key) ? key : null;
  }

  async function rememberResume(mode) {
    endpointHints ??= await readEndpointHints(directory);
    const owner = accountKey();
    if (mode && !owner) return;
    const previous = endpointHints.resume;
    if (mode === 'manual' && previous?.account === owner && previous.mode === 'system') return;
    if (!mode && !previous) return;
    const updated = { ...endpointHints };
    if (mode) updated.resume = { mode, account: owner };
    else delete updated.resume;
    if (JSON.stringify(previous) === JSON.stringify(updated.resume)) return;
    await writeEndpointHints(directory, updated);
    endpointHints = updated;
  }

  function getSites() {
    const hosts = new Set(effectiveOrigins().map(origin => new URL(origin).hostname));
    return { sites: [...hosts].map(host => ({ host, enabled: !isBypassed(host) })) };
  }

  function changeSite(host, enabled, stillOpen) {
    const run = queue.then(async () => {
      if (closed || !management || !stillOpen()) fail('GATEWAY_NOT_RUNNING', 503);
      if (!getSites().sites.some(site => site.host === host)) fail('GATEWAY_TARGET_REJECTED');
      if (isBypassed(host) === !enabled) return;
      const next = new Set(bypassHosts());
      if (enabled) next.delete(host);
      else next.add(host);
      const updated = { ...endpointHints, bypassHosts: [...next].sort() };
      await writeEndpointHints(directory, updated);
      endpointHints = updated;
      if (enabled) session.prepareBrowserSite?.(host);
      proxy?.disconnectSite(host);
      systemProxy?.disconnectSite(host);
    });
    queue = run.catch(() => {});
    return run;
  }

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
        recoveryRequired: !!system.restorePending || !!system.settingsChanged || !!system.recoveryRequired && (system.pacUrlsByService
          ? !systemProxy || Object.entries(system.pacUrlsByService).some(([name, url]) => systemPacs.get(name)?.url !== url)
          : !proxy || !pac || system.pacUrl !== pac.url) },
      systemEndpoint: systemProxy?.address() ?? null,
      systemTraffic: systemProxy?.statistics() ?? { requests: 0, hosts: {} },
      capabilities: { ...gatewayCapabilities(hostPlatform), trustedMiniPrograms: !!session.clientIdentity && ['darwin','win32'].includes(hostPlatform) },
      clientRenewals: session.clientIdentity?.desktop?.status?.() ?? [],
      allowedOrigins: effectiveOrigins().filter(origin => !isBypassed(new URL(origin).hostname)),
      managementUrl: management?.url ?? null, pacUrl: pac?.url ?? null, lastError };
  }

  async function setup() {
    token ??= await privateToken(directory);
    endpointHints ??= await readEndpointHints(directory);
    authority ??= await certificateFactory({ directory: certificateDirectory, allowedHosts: [...new Set(origins.map(origin => new URL(origin).hostname))],
      authorizeHost: hostname => authorizeDynamic(`https://${hostname}`) });
    platform ??= platformFactory({ directory, certificatePath: authority.certificatePath, fingerprint: authority.fingerprint });
  }

  async function stop({ revoke = false } = {}) {
    let restoreError;
    if (revoke) { await proxy?.close(); proxy = undefined; await systemProxy?.close(); systemProxy = undefined; }
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
      await systemProxy?.close(); systemProxy = undefined;
      // During forced account revocation keep PAC serving a refused local port
      // until the old OS settings are explicitly repaired; never direct-fallback.
      if (!restoreError) {
        await pac?.close(); pac = undefined;
        await Promise.all([...systemPacs.values()].map(item => item.close())); systemPacs.clear();
      }
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
    if (action === 'stop') {
      await rememberResume(null);
      await stop({ revoke: params.revoke === true });
    }
    else if (action === 'system-disable') {
      const restored = await (await existingPlatform()).disableProxy({ confirm: true });
      if (restored.failures?.length) fail('GATEWAY_PROXY_RESTORE_FAILED');
      await systemProxy?.close(); systemProxy = undefined;
      await Promise.all([...systemPacs.values()].map(item => item.close())); systemPacs.clear();
      // Explicitly disabling system routing keeps a running manual gateway.
      // Remove the prior system choice before recording that narrower mode.
      await rememberResume(null);
      if (proxy) await rememberResume('manual');
    }
    else if (action === 'untrust') {
      await rememberResume(null);
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
          isBypassed, connectBypass: createCampusPassthrough(),
          maxUploadBytes: 1024 * 1024 * 1024, maxDownloadBytes: 4 * 1024 * 1024 * 1024, timeoutMs: 180_000 });
        try { const endpoint = await next.listen({port:endpointHints.manual?.proxyPort??0});
          pac = await servePac(effectiveOrigins, endpoint,undefined,{listener:endpointHints.manual,bypassHosts,managementPort});
          const controls = { authorizePeer: ['darwin','win32'].includes(hostPlatform) ? peerAuthorizerFactory() : undefined, getSites, changeSite };
          management ??= await serveManagement({ ...controls, port: endpointHints.managementPort }).catch(error => {
            if (error.code !== 'EADDRINUSE') throw error;
            return serveManagement(controls);
          });
          endpointHints.manual={proxyPort:endpoint.port,...pac.hint};
          endpointHints.managementPort=management.port;
          await writeEndpointHints(directory,endpointHints);proxy = next; }
        catch (error) { await next.close();await pac?.close();pac=undefined;throw error; }
      } else if (action === 'trust') await platform.trust({ confirm: true });
      else if (action === 'system-enable') {
        if (!proxy || !pac) fail('GATEWAY_NOT_RUNNING');
        if (['darwin', 'win32'].includes(hostPlatform) && typeof platform.prepareProxy === 'function') {
          const current = await status();
          if (current.systemProxy.enabled && !current.systemProxy.recoveryRequired) {
            await rememberResume('system');
            return current;
          }
          if (current.systemProxy.recoveryRequired) fail('GATEWAY_PROXY_RECOVERY_REQUIRED');
          if (!current.certificate.trusted) fail('GATEWAY_CERTIFICATE_TRUST_REQUIRED');
          const plan = await platform.prepareProxy({ confirm: true });
          const groups = new Map();
          const usedPorts=new Set(),nextHints={};
          const next = { address: () => groups.values().next().value?.address() ?? null,
            close: () => Promise.all([...groups.values()].map(item => item.close())),
            disconnectSite: host => { for (const gateway of groups.values()) gateway.disconnectSite(host); },
            statistics() {
              const result = { requests: 0, hosts: {}, recentRejections: [], clientDiagnostics:{verifiedConnections:0,otherConnections:0,tlsFailures:0,sharedRequests:0,independentRequests:0,recentRequests:[],identityRequests:[]} };
              for (const gateway of groups.values()) {
                const value = gateway.statistics(); result.requests += value.requests;
                for (const [host, count] of Object.entries(value.hosts)) result.hosts[host] = (result.hosts[host] ?? 0) + count;
                result.recentRejections.push(...value.recentRejections);
                const client=value.clientDiagnostics;
                if(client){for(const key of ['verifiedConnections','otherConnections','tlsFailures','sharedRequests','independentRequests'])result.clientDiagnostics[key]+=client[key];
                  result.clientDiagnostics.recentRequests.push(...client.recentRequests);
                  result.clientDiagnostics.identityRequests.push(...client.identityRequests);}
              }
              result.recentRejections = result.recentRejections.slice(-8);
              result.clientDiagnostics.recentRequests.sort((a,b)=>a.at-b.at);result.clientDiagnostics.recentRequests=result.clientDiagnostics.recentRequests.slice(-16);
              result.clientDiagnostics.identityRequests.sort((a,b)=>a.at-b.at);result.clientDiagnostics.identityRequests=result.clientDiagnostics.identityRequests.slice(-8);return result;
            } };
          try {
            systemProxy = next;
            for (const service of plan.services) {
              const key = JSON.stringify(service.fallback);
              const hint=Object.hasOwn(endpointHints.services,service.name)?endpointHints.services[service.name]:undefined;
              let gateway = groups.get(key);
              const passthrough = createCampusPassthrough(service.fallback);
              const trustedClients = !!session.clientIdentity && !!passthrough;
              if (!gateway) {
                const authorizeSocket = peerAuthorizerFactory();
                if (trustedClients) clientAuthority ??= await certificateFactory({ directory: certificateDirectory,
                  allowedHosts: [CLIENT_IDENTITY_HOST, ...CLIENT_BUSINESS_HOSTS] });
                gateway = createCampusGateway({ allowedOrigins: origins, session, authorizeSocket,
                  isBypassed, connectBypass: passthrough,
                  ...(trustedClients ? { resolveClient: createTrustedClientResolver(authorizeSocket), clientIdentity: session.clientIdentity,
                    tlsClient: (hostname, options) => clientAuthority.issue(hostname, options) } : {}),
                  ...(passthrough ? { connectPassthrough: passthrough } : {}),
                  tls: (hostname, options) => authority.issue(hostname, options), upgradeInsecureRequests: true,
                  maxUploadBytes: 1024 * 1024 * 1024, maxDownloadBytes: 4 * 1024 * 1024 * 1024, timeoutMs: 180_000 });
                groups.set(key, gateway);
                await gateway.listen({port:hint&&!usedPorts.has(hint.proxyPort)?hint.proxyPort:0});usedPorts.add(gateway.address().port);
                // Verify the deployed peer path before any network service is
                // changed. Filesystem/permission failures leave original
                // proxies intact rather than routing the whole browser to 503.
                await gateway.preflight();
              }
              const servicePac=await servePac(effectiveOrigins, gateway.address(), service.fallback, { campusPassthrough: !!passthrough, trustedClients,listener:hint,bypassHosts,managementPort });
              systemPacs.set(service.name,servicePac);Object.defineProperty(nextHints,service.name,{value:{proxyPort:gateway.address().port,...servicePac.hint},enumerable:true});
            }
            endpointHints.services=nextHints;await writeEndpointHints(directory,endpointHints);
            await platform.enableProxy({ confirm: true, expectedPlan: plan,
              pacUrlsByService: Object.fromEntries([...systemPacs].map(([name, item]) => [name, item.url])) });
          } catch (error) {
            // If OS rollback could not finish, retain live PAC/listener so the
            // still-installed rules do not strand the user's connection.
            const state = await platform.status().catch(() => ({ recoveryRequired: true }));
            if (!state.recoveryRequired && !state.proxyEnabled) {
              await next.close(); systemProxy = undefined;
              await Promise.all([...systemPacs.values()].map(item => item.close())); systemPacs.clear();
            }
            throw error;
          }
        } else await platform.enableProxy({ confirm: true, pacUrl: pac.url });
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
    if (action === 'start') await rememberResume('manual');
    if (action === 'system-enable') await rememberResume('system');
    lastError = null;
    return status();
  }

  async function resume() {
    if (closed) fail('GATEWAY_CLOSED');
    endpointHints ??= await readEndpointHints(directory);
    const intent = endpointHints.resume;
    const currentAccount = accountKey();
    const current = session.status();
    if (!intent || !currentAccount || intent.account !== currentAccount ||
        !current.authenticated && current.state !== 'ready') return status();
    const previous = await status();
    if (intent.mode === 'system' && !previous.certificate.trusted) fail('GATEWAY_CERTIFICATE_TRUST_REQUIRED');
    if (previous.systemProxy.settingsChanged || previous.systemProxy.settingsUnreadable) fail('GATEWAY_PROXY_SETTINGS_CHANGED');
    if (previous.systemProxy.recoveryRequired) {
      // A prior daemon may have left our exact PAC in the OS. Restore only
      // journal-owned values before constructing a fresh coexistence plan.
      const restored = await (await existingPlatform()).disableProxy({ confirm: true });
      if (restored.failures?.length) fail('GATEWAY_PROXY_RESTORE_FAILED');
      if (restored.conflicts?.length) fail('GATEWAY_PROXY_SETTINGS_CHANGED');
      await systemProxy?.close(); systemProxy = undefined;
      await Promise.all([...systemPacs.values()].map(item => item.close())); systemPacs.clear();
    }
    if (accountKey() !== currentAccount) fail('GATEWAY_SESSION_CHANGED');
    await dispatch({ action: 'start', confirm: true });
    if (intent.mode === 'system') {
      if (accountKey() !== currentAccount) fail('GATEWAY_SESSION_CHANGED');
      await dispatch({ action: 'system-enable', confirm: true });
    }
    return status();
  }

  function enqueue(work) {
    const run = queue.then(work).catch(error => {
      lastError = safeCode(error);
      throw new GatewayError(lastError, error?.status ?? 500);
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    control(params) {
      return enqueue(() => dispatch(params));
    },
    resume() { return enqueue(resume); },
    suspend() {
      return enqueue(async () => {
        if (closed) fail('GATEWAY_CLOSED');
        await stop({ revoke: true });
        return status();
      });
    },
    close() {
      const run = queue.then(async () => {
        try { await stop({ revoke: true }); }
        finally {
          closed = true; await proxy?.close(); proxy = undefined; await systemProxy?.close(); systemProxy = undefined;
          await management?.close(); management = undefined;
          await pac?.close(); pac = undefined;
          await Promise.all([...systemPacs.values()].map(item => item.close())); systemPacs.clear();
        }
      });
      queue = run.catch(() => {}); return run;
    },
  };
}
