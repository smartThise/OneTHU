import http from 'node:http';
import tls from 'node:tls';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { CLIENT_IDENTITY_HOST, CLIENT_BUSINESS_HOSTS, createMiniNavigationGrants, parseClientTarget, describeMiniRequest } from './clientIdentity.mjs';
import {
  GatewayError, normalizeAllowedOrigins, parseProxyTarget, parseConnectAuthority, parseCampusConnectAuthority,
  parseTunnelTarget, sanitizeRequestHeaders, sanitizeResponseHeaders,
  validateFetchMetadata, validateMethod, campusLandingCategory, originMembership,
} from './policy.mjs';

export { GatewayError } from './policy.mjs';

const fail = (code, status = 400) => { throw new GatewayError(code, status); };
const safeError = error => error instanceof GatewayError ? error : new GatewayError('GATEWAY_UPSTREAM_FAILED', 502);
const metadataEnum = (value, values) => value === undefined ? 'missing' : values.includes(value) ? value : 'other';
function diagnosticCampusHostname(value) {
  if (typeof value !== 'string' || value.length > 253 || !value.endsWith('.tsinghua.edu.cn')) return undefined;
  return value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ? value : undefined;
}

function boundedInteger(value, fallback, maximum) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail('GATEWAY_CONFIG_INVALID');
  return result;
}

function errorPayload(error) {
  const safe = safeError(error);
  const body = JSON.stringify({ error: { code: safe.code } });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', Connection: 'close' };
  if (safe.status === 407) headers['Proxy-Authenticate'] = 'Basic realm="OneTHU campus gateway", charset="UTF-8"';
  return { safe, body, headers };
}

function respondError(res, error, req) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  const { safe, body, headers } = errorPayload(error);
  if (safe.code === 'GATEWAY_IDENTITY_SESSION_REQUIRED' && ['GET','HEAD'].includes(req?.method) &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' &&
      /\btext\/html\b/i.test(req.headers.accept ?? '')) {
    const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>更新学校登录 · University sign-in</title><style>html{color-scheme:light dark;font:16px/1.7 system-ui,sans-serif;background:light-dark(#f7f7f5,#171717);color:light-dark(#222,#eee)}body{max-width:36rem;margin:12vh auto;padding:24px}h1{font-size:1.6rem;line-height:1.4}p{opacity:.8}.actions{display:flex;gap:16px;flex-wrap:wrap;margin-top:28px}a{color:inherit;text-underline-offset:5px}.retry{background:light-dark(#222,#eee);color:light-dark(#fff,#171717);padding:10px 20px;border-radius:24px;text-decoration:none}small{display:block;margin-top:32px;opacity:.55}</style><body><h1>请更新学校登录<br><span lang="en">University sign-in needed</span></h1><p>学校的统一认证返回了登录表单。请在 OneTHU 更新学校登录，再回到此页重试。</p><p lang="en">The university identity service returned a sign-in form. Refresh your university sign-in in OneTHU, then retry this page.</p><div class="actions"><a class="retry" href="">重新尝试 · Retry</a><a href="https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/index">返回 Info · Back to Info</a></div><small>GATEWAY_IDENTITY_SESSION_REQUIRED</small></body></html>';
    res.writeHead(safe.status,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(html),
      'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}).end(req.method==='HEAD'?undefined:html);
    return;
  }
  res.writeHead(safe.status, headers).end(body);
}

function socketError(socket, error) {
  if (socket.destroyed || !socket.writable) return;
  const { safe, body, headers } = errorPayload(error);
  const head = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
  socket.end(`HTTP/1.1 ${safe.status} ${http.STATUS_CODES[safe.status] ?? 'Error'}\r\n${head}\r\n${body}`, () => socket.destroy());
}

function withSignal(promise, signal, lateValue) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); fn(value); };
    const abort = () => finish(reject, signal.reason ?? new GatewayError('GATEWAY_CANCELLED', 499));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(value => {
      if (settled) { try { void Promise.resolve(lateValue?.(value)).catch(() => {}); } catch {} }
      else finish(resolve, value);
    }, error => finish(reject, error));
  });
}

function waitDrain(res, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { res.off('drain', drain); res.off('close', close); signal.removeEventListener('abort', abort); };
    const drain = () => { cleanup(); resolve(); };
    const close = () => { cleanup(); reject(new GatewayError('GATEWAY_CANCELLED', 499)); };
    const abort = () => { cleanup(); reject(signal.reason); };
    res.once('drain', drain); res.once('close', close); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else if (res.destroyed) close();
  });
}

/**
 * A protocol prototype with an injected authoritative session. This factory
 * neither creates a school session nor changes proxy/CA/daemon configuration.
 * session.request must return Fetch-decoded Response bytes and own its cookies.
 */
export function createCampusGateway(options = {}) {
  const staticOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const { session } = options;
  if (!session || !['epoch', 'assertCurrent', 'request'].every(name => typeof session[name] === 'function')) fail('GATEWAY_CONFIG_INVALID');
  if (session.authorizeTarget !== undefined && typeof session.authorizeTarget !== 'function') fail('GATEWAY_CONFIG_INVALID');
  if (session.authorizeBrowserCredential !== undefined && typeof session.authorizeBrowserCredential !== 'function') fail('GATEWAY_CONFIG_INVALID');
  const origins = originMembership(staticOrigins, session.authorizeTarget && (target => session.authorizeTarget(target)));
  const peerAuthorization = options.authorizeSocket !== undefined;
  if (peerAuthorization ? typeof options.authorizeSocket !== 'function' || options.token !== undefined
    : typeof options.token !== 'string' || options.token.length < 32 || options.token.length > 1024 || /[^\x21-\x7e]/.test(options.token)) fail('GATEWAY_CONFIG_INVALID');
  if (options.tls !== undefined && typeof options.tls !== 'function') fail('GATEWAY_CONFIG_INVALID');
  if (options.connectPassthrough !== undefined && typeof options.connectPassthrough !== 'function') fail('GATEWAY_CONFIG_INVALID');
  if (session.browserCookies !== undefined && typeof session.browserCookies !== 'function') fail('GATEWAY_CONFIG_INVALID');
  const credentials = Buffer.from(`onethu:${options.token}`, 'utf8');
  const timeoutMs = boundedInteger(options.timeoutMs, 30_000, 180_000);
  const maxUploadBytes = boundedInteger(options.maxUploadBytes, 8 * 1024 * 1024, 1024 * 1024 * 1024);
  const maxDownloadBytes = boundedInteger(options.maxDownloadBytes, 64 * 1024 * 1024, 4 * 1024 * 1024 * 1024);
  const maxConnections = boundedInteger(options.maxConnections, 32, 1024);
  const sockets = new Set();
  const controllers = new Set();
  const tunnels = new WeakMap();
  const peerChecks = new WeakMap();
  const requestsByHost = new Map();
  const recentRejections = [];
  const clientDiagnostics = { verifiedConnections:0, otherConnections:0, tlsFailures:0, sharedRequests:0, independentRequests:0, recentRequests:[] };
  const miniNavigationGrants = createMiniNavigationGrants();
  const clientPeers=new Map();let clientPeerSequence=0;
  function clientPeerTag(client){
    if(!Number.isSafeInteger(client?.pid)||client.pid<1)return 'unavailable';
    const key=client.platform+':'+client.pid;
    if(!clientPeers.has(key)){clientPeers.set(key,'client-'+(++clientPeerSequence));if(clientPeers.size>64)clientPeers.delete(clientPeers.keys().next().value);}
    return clientPeers.get(key);
  }
  const preflightUrl = 'http://onethu-preflight.invalid/' + randomBytes(24).toString('hex');
  let activeRequests = 0;
  let stopped = false;
  let listening;
  let closing;

  function recordRejection(req, target, error) {
    const safe = safeError(error);
    const code = safe.code;
    const destinationHost = diagnosticCampusHostname(safe.destinationHost);
    let referrerAllowed = false;
    try {
      const referrer = new URL(req.headers.referer);
      referrerAllowed = !referrer.username && !referrer.password && !referrer.hash && origins.has(referrer.origin);
    } catch {}
    // Diagnostics must never retain URLs, arbitrary header values, credentials,
    // bodies, or account identities. Only parsed allowlisted hosts and enums.
    recentRejections.push({
      ...(tunnels.get(req.socket)?.client ? {clientApplication:'wechat'} : {}),
      ...(typeof error?.serviceReason==='string'&&/^(?:CAMPUS_SERVICE|NETWORK|AUTH)_[A-Z0-9_]{1,64}$/.test(error.serviceReason)?{serviceReason:error.serviceReason}:{}),
      code: /^GATEWAY_[A-Z_]{1,64}$/.test(code) ? code : 'GATEWAY_UPSTREAM_FAILED',
      ...(destinationHost ? { destinationHost } : {}),
      host: target && origins.has(target.origin) ? target.hostname : null,
      method: metadataEnum(req.method, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'PROPFIND', 'REPORT']),
      fetchSite: metadataEnum(req.headers['sec-fetch-site'], ['same-origin', 'same-site', 'cross-site', 'none']),
      fetchMode: metadataEnum(req.headers['sec-fetch-mode'], ['cors', 'navigate', 'no-cors', 'same-origin', 'websocket']),
      fetchDest: metadataEnum(req.headers['sec-fetch-dest'], ['document', 'iframe', 'frame', 'empty', 'script', 'style', 'image', 'font',
        'worker', 'serviceworker', 'sharedworker', 'audio', 'video', 'manifest', 'report', 'object', 'embed', 'track', 'audioworklet', 'paintworklet', 'xslt', 'webidentity']),
      fetchUser: metadataEnum(req.headers['sec-fetch-user'], ['?1']),
      hasOrigin: req.headers.origin !== undefined,
      originMatchesTarget: !!target && req.headers.origin === target.origin,
      referrerAllowed,
      landingCategory: campusLandingCategory(target),
    });
    if (recentRejections.length > 8) recentRejections.shift();
  }

  async function authenticate(req) {
    if (peerAuthorization) {
      const socket = req.socket;
      if (!peerChecks.has(socket)) {
        const aborter = new AbortController(); controllers.add(aborter);
        const cancel = () => aborter.abort(new GatewayError('GATEWAY_CANCELLED', 499));
        socket.once('close', cancel);
        const timeout = setTimeout(() => aborter.abort(new GatewayError('GATEWAY_PEER_AUTH_TIMEOUT', 403)), 5000);
        timeout.unref();
        const check = withSignal(Promise.resolve().then(() => options.authorizeSocket(socket, { signal: aborter.signal })), aborter.signal)
          .then(allowed => { if (allowed !== true || socket.destroyed) fail('GATEWAY_PEER_AUTH_REQUIRED', 403); })
          .finally(() => { clearTimeout(timeout); controllers.delete(aborter); socket.off('close', cancel); });
        peerChecks.set(socket, check);
      }
      return peerChecks.get(socket);
    }
    const value = req.headers['proxy-authorization'];
    const match = typeof value === 'string' && /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(value);
    if (!match) fail('GATEWAY_PROXY_AUTH_REQUIRED', 407);
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1] || decoded.length !== credentials.length || !timingSafeEqual(decoded, credentials)) fail('GATEWAY_PROXY_AUTH_REQUIRED', 407);
  }

  function framing(req) {
    const counts = new Map();
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index].toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (req.rawHeaders.length > 200 || ['host', 'proxy-authorization', 'content-length', 'transfer-encoding', 'origin', 'referer', 'sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-fetch-user'].some(name => (counts.get(name) ?? 0) > 1)) fail('GATEWAY_REQUEST_REJECTED');
    if (counts.get('host') !== 1) fail('GATEWAY_HOST_REJECTED');
    if (req.headers.expect !== undefined) fail('GATEWAY_EXPECTATION_REJECTED', 417);
    if (req.headers.upgrade !== undefined || req.headers.trailer !== undefined) fail('GATEWAY_UPGRADE_REJECTED', 501);
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^(?:0|[1-9]\d*)$/.test(length) || !Number.isSafeInteger(Number(length)))) fail('GATEWAY_REQUEST_REJECTED');
    if (length !== undefined && Number(length) > maxUploadBytes) fail('GATEWAY_UPLOAD_TOO_LARGE', 413);
    const encoding = req.headers['transfer-encoding'];
    if (encoding !== undefined && (encoding.toLowerCase() !== 'chunked' || length !== undefined)) fail('GATEWAY_REQUEST_REJECTED');
    return encoding !== undefined || Number(length ?? 0) > 0;
  }

  function currentEpoch() {
    try {
      const value = session.epoch();
      if (!Number.isSafeInteger(value)) throw new Error();
      session.assertCurrent(value);
      return value;
    } catch { fail('GATEWAY_SESSION_CHANGED', 409); }
  }

  function assertEpoch(epoch) {
    try {
      if (session.epoch() !== epoch) throw new Error();
      session.assertCurrent(epoch);
    } catch { fail('GATEWAY_SESSION_CHANGED', 409); }
  }

  async function handle(req, res, tunnel) {
    let target;
    let controller;
    let timer;
    let upload;
    let reader;
    let upstreamResponse;
    let completed = false;
    let counted = false;
    let clientDiagnostic;
    const cancel = () => controller?.abort(new GatewayError('GATEWAY_CANCELLED', 499));
    const disconnected = () => { if (!res.writableFinished) cancel(); };
    try {
      // Once headers have arrived, the operation timer owns cancellation and
      // can send a stable timeout response instead of racing socket inactivity.
      req.socket.setTimeout(0);
      if (stopped) fail('GATEWAY_CLOSED', 503);
      if (!tunnel) await authenticate(req);
      const hasBody = framing(req);
      if (hasBody && ['GET', 'HEAD'].includes(req.method)) fail('GATEWAY_REQUEST_REJECTED');
      // An in-process activation probe exercises the actual peer-authenticated
      // listener before PAC is installed. It exposes no account or upstream
      // data and still requires normal socket authentication.
      if (!tunnel && req.method === 'GET' && !hasBody && req.url === preflightUrl && req.headers.host === 'onethu-preflight.invalid') {
        res.writeHead(204, { 'Cache-Control': 'no-store', Connection: 'close' }).end();
        return;
      }
      target = tunnel?.client ? parseClientTarget(req.url, req.headers.host, tunnel)
        : tunnel ? parseTunnelTarget(req.url, req.headers.host, tunnel, origins) : parseProxyTarget(req.url, req.headers.host, origins);
      validateMethod(req.method, target);
      // Legacy campus HTTP pages lack browser Fetch Metadata. Redirect safe
      // navigations to an explicitly enabled HTTPS facade before borrowing any
      // account session. Never replay a body or forward an unproven HTTP form.
      if (!tunnel && target.protocol === 'http:' && options.upgradeInsecureRequests === true &&
          ['GET', 'HEAD'].includes(req.method) && !hasBody && origins.has(`https://${target.host}`)) {
        const upgraded = new URL(target.href); upgraded.protocol = 'https:';
        res.writeHead(307, { Location: upgraded.href, 'Cache-Control': 'no-store', Connection: 'close', 'Content-Length': '0' }).end();
        return;
      }
      let clientRequest = null;
      if (tunnel?.client) {
        try { assertEpoch(tunnel.epoch);clientRequest = miniNavigationGrants.authorize(target, req.headers, req.method, tunnel.client,tunnel.epoch,{hasBody}); }
        catch (error) {
          // Other mini programs and manual verification retain their own
          // identity exchange. They receive none of the OneTHU cookie jar.
          if (typeof options.clientIdentity.passthrough !== 'function') throw error;
          clientRequest = {identity:target.hostname===CLIENT_IDENTITY_HOST,unborrowed:true};
        }
      }
      if (!clientRequest) validateFetchMetadata(req.headers, target, origins, { method: req.method, hasBody });
      if (clientRequest?.identity && !clientRequest.unborrowed && hasBody) fail('GATEWAY_CLIENT_REQUEST_REJECTED', 403);
      if (clientRequest) {
        const route = clientRequest.unborrowed ? 'independent' : 'shared';
        clientDiagnostics[route === 'shared' ? 'sharedRequests' : 'independentRequests']++;
        clientDiagnostic = { ...describeMiniRequest(target,req.headers), route, peer:clientPeerTag(tunnel.client), navigationHandoff:clientRequest.navigationHandoff===true, at:Date.now(), status:null };
        clientDiagnostics.recentRequests.push(clientDiagnostic);
        if (clientDiagnostics.recentRequests.length > 16) clientDiagnostics.recentRequests.shift();
      }
      const epoch = tunnel?.epoch ?? currentEpoch();
      assertEpoch(epoch);
      if (activeRequests >= maxConnections) fail('GATEWAY_BUSY', 503);
      activeRequests++; counted = true;
      controller = new AbortController(); controllers.add(controller);
      timer = setTimeout(() => controller.abort(new GatewayError('GATEWAY_TIMEOUT', 504)), timeoutMs);
      timer.unref();
      const check = () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        assertEpoch(epoch);
        if (!clientRequest && !origins.has(target.origin)) fail('GATEWAY_TARGET_REJECTED', 403);
      };
      req.once('aborted', cancel); req.once('error', cancel); res.once('close', disconnected);
      let allowAuthorization = false;
      if (req.headers.authorization !== undefined && session.authorizeBrowserCredential) {
        try {
          const decision = session.authorizeBrowserCredential(target.href, 'authorization', req.headers.authorization);
          if (decision && typeof decision.then === 'function') void Promise.resolve(decision).catch(() => {});
          allowAuthorization = decision === true;
        } catch { /* A failed witness lookup must never forward a credential. */ }
      }
      check();
      const headers = sanitizeRequestHeaders(req.rawHeaders, { allowAuthorization: allowAuthorization || !!clientRequest && !clientRequest.identity });
      if (clientRequest?.unborrowed && typeof req.headers.cookie === 'string') headers.set('cookie',req.headers.cookie);
      if (hasBody) {
        let sent = 0;
        upload = new Transform({
          transform(chunk, _encoding, callback) {
            try { check(); sent += chunk.length; if (sent > maxUploadBytes) fail('GATEWAY_UPLOAD_TOO_LARGE', 413); callback(null, chunk); }
            catch (error) { callback(error); }
          },
        });
        upload.on('error', error => controller.abort(safeError(error)));
        controller.signal.addEventListener('abort', () => { req.unpipe(upload); upload.destroy(); }, { once: true });
        req.pipe(upload);
      }
      check();
      const init = { method: req.method, headers, signal: controller.signal, redirect: 'manual', preserveResponseBytes: true };
      if (upload) { init.body = upload; init.duplex = 'half'; }
      const response = upstreamResponse = await withSignal(Promise.resolve().then(() => {
        check(); return clientRequest?.unborrowed ? options.clientIdentity.passthrough(target.href,init)
          : clientRequest ? options.clientIdentity.request(target.href, init, clientRequest) : session.request(target.href, init);
      }), controller.signal, value => value?.body?.cancel());
      check();
      if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 || !response.headers || response.body && typeof response.body.getReader !== 'function') fail('GATEWAY_UPSTREAM_INVALID', 502);
      requestsByHost.set(target.hostname, (requestsByHost.get(target.hostname) ?? 0) + 1);
      if (clientDiagnostic) clientDiagnostic.status = response.status;
      const encoding = response.headers.get('content-encoding')?.trim();
      if (encoding && encoding.toLowerCase() !== 'identity' && (response.status === 206 || response.headers.has('content-range'))) fail('GATEWAY_ENCODED_RANGE_UNSUPPORTED', 502);
      const outputHeaders = sanitizeResponseHeaders(response.headers);
      if (clientRequest?.unborrowed || clientRequest && options.clientIdentity.isUnborrowed?.(response) === true) {
        const cookies = response.headers.getSetCookie?.() ?? [];
        if (cookies.length > 32 || cookies.some(value => /[\r\n\0]/.test(value) || value.length > 8192)) fail('GATEWAY_UPSTREAM_INVALID',502);
        if (cookies.length) outputHeaders['set-cookie'] = cookies;
      }
      // Learn's own JavaScript reads its non-authentication CSRF cookie. Only
      // the account adapter may project this one explicitly approved value;
      // upstream Set-Cookie and all browser authentication cookies stay hidden.
      if (['https://learn.tsinghua.edu.cn', 'https://info.tsinghua.edu.cn'].includes(target.origin) && session.browserCookies) {
        const cookies = await withSignal(Promise.resolve().then(() => session.browserCookies(target.href)), controller.signal);
        check();
        if (!Array.isArray(cookies) || cookies.length > 1 || cookies.some(cookie => cookie?.name !== 'XSRF-TOKEN' ||
          typeof cookie.value !== 'string' || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,4096}$/.test(cookie.value))) fail('GATEWAY_BROWSER_COOKIE_REJECTED', 502);
        outputHeaders['set-cookie'] = cookies.length
          ? `XSRF-TOKEN=${cookies[0].value}; Path=/; Secure; SameSite=Strict`
          : 'XSRF-TOKEN=; Path=/; Secure; SameSite=Strict; Max-Age=0';
      }
      reader = response.body?.getReader();
      if (reader) controller.signal.addEventListener('abort', () => { void reader.cancel().catch(() => {}); }, { once: true });
      const startResponse = () => { check(); if (!res.headersSent) res.writeHead(response.status, outputHeaders); };
      if (req.method !== 'HEAD' && ![204, 205, 304].includes(response.status) && reader) {
        let received = 0;
        while (true) {
          check();
          const part = await withSignal(reader.read(), controller.signal);
          check();
          if (part.done) { completed = true; break; }
          if (!(part.value instanceof Uint8Array)) fail('GATEWAY_UPSTREAM_INVALID', 502);
          received += part.value.byteLength;
          if (received > maxDownloadBytes) fail('GATEWAY_DOWNLOAD_TOO_LARGE', 502);
          startResponse();
          if (!res.write(part.value)) { await waitDrain(res, controller.signal); check(); }
        }
      }
      startResponse(); res.end();
    } catch (error) {
      recordRejection(req, target, error);
      controller?.abort(safeError(error));
      respondError(res, error, req);
    } finally {
      clearTimeout(timer);
      req.off('aborted', cancel); req.off('error', cancel); res.off('close', disconnected);
      if (upload) { req.unpipe(upload); upload.destroy(); }
      if (reader) { if (!completed) void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
      else if (upstreamResponse?.body) { try { void Promise.resolve(upstreamResponse.body.cancel()).catch(() => {}); } catch {} }
      if (controller) controllers.delete(controller);
      if (counted) activeRequests--;
    }
  }

  function setup(server) {
    server.headersTimeout = Math.min(timeoutMs, 10_000);
    server.requestTimeout = timeoutMs;
    server.keepAliveTimeout = 1_000;
    server.maxHeadersCount = 100;
    server.on('checkContinue', (_req, res) => respondError(res, new GatewayError('GATEWAY_EXPECTATION_REJECTED', 417)));
    server.on('checkExpectation', (_req, res) => respondError(res, new GatewayError('GATEWAY_EXPECTATION_REJECTED', 417)));
    server.on('upgrade', (_req, socket) => socketError(socket, new GatewayError('GATEWAY_UPGRADE_REJECTED', 501)));
    server.on('clientError', (error, socket) => socketError(socket, new GatewayError(error.code === 'HPE_HEADER_OVERFLOW' ? 'GATEWAY_HEADERS_TOO_LARGE' : 'GATEWAY_REQUEST_REJECTED', error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400)));
  }

  const inner = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    const tunnel = tunnels.get(req.socket);
    if (!tunnel) { respondError(res, new GatewayError('GATEWAY_TUNNEL_REJECTED', 403)); return; }
    void handle(req, res, tunnel);
  });
  setup(inner);
  inner.on('connect', (_req, socket) => socketError(socket, new GatewayError('GATEWAY_METHOD_REJECTED', 405)));

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => { void handle(req, res, null); });
  setup(server);
  server.maxConnections = maxConnections;
  server.on('connection', socket => {
    if (stopped || sockets.size >= maxConnections) { socket.destroy(); return; }
    sockets.add(socket);
    socket.on('error', () => {});
    socket.setTimeout(timeoutMs, () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  });

  server.on('connect', (req, socket, head) => {
    socket.setTimeout(0);
    socket.pause();
    void (async () => {
      let target;
      let controller;
      let timer;
      let established = false;
      const disconnected = () => {
        clearTimeout(timer);
        if (controller) { controllers.delete(controller); controller.abort(new GatewayError('GATEWAY_CANCELLED', 499)); }
      };
      try {
        if (stopped) fail('GATEWAY_CLOSED', 503);
        await authenticate(req);
        if (framing(req)) fail('GATEWAY_REQUEST_REJECTED');
        const clientHost = String(req.url).replace(/:443$/, '');
        const clientEligible = options.clientIdentity && peerAuthorization && options.resolveClient && options.tlsClient &&
          req.url === `${clientHost}:443` && [CLIENT_IDENTITY_HOST, ...CLIENT_BUSINESS_HOSTS].includes(clientHost) &&
          [clientHost, req.url].includes(req.headers.host);
        const client = clientEligible ? await options.resolveClient(socket) : null;
        if (clientEligible) clientDiagnostics[client ? 'verifiedConnections' : 'otherConnections']++;
        const identityPassthrough = clientEligible && clientHost === CLIENT_IDENTITY_HOST && !client;
        if(options.connectPassthrough&&!client&&(!origins.has(`https://${String(req.url).replace(/:443$/,'')}`)||identityPassthrough)){
          const candidate = identityPassthrough ? new URL(`https://${CLIENT_IDENTITY_HOST}/`) : parseCampusConnectAuthority(req.url,req.headers.host);
          if(!origins.has(candidate.origin)){
            target=candidate;
            controller=new AbortController();controllers.add(controller);
            socket.once('close',disconnected);
            timer=setTimeout(()=>controller.abort(new GatewayError('GATEWAY_TIMEOUT',504)),10000);timer.unref();
            const upstream=await withSignal(options.connectPassthrough(target,{signal:controller.signal}),controller.signal,s=>s.destroy());
            if(socket.destroyed||controller.signal.aborted){upstream.destroy();throw controller.signal.reason;}
            clearTimeout(timer);
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');established=true;
            if(head.length)upstream.write(head);
            socket.on('error',()=>upstream.destroy());upstream.on('error',()=>socket.destroy());
            upstream.once('close',()=>socket.destroy());socket.once('close',()=>upstream.destroy());
            controller.signal.addEventListener('abort',()=>{socket.destroy();upstream.destroy();},{once:true});
            socket.setTimeout(timeoutMs,()=>socket.destroy());upstream.setTimeout(timeoutMs,()=>upstream.destroy());
            socket.pipe(upstream);upstream.pipe(socket);socket.resume();return;
          }
        }
        target = client ? new URL(`https://${clientHost}/`) : parseConnectAuthority(req.url, req.headers.host, origins);
        // Browsers do not attach page provenance to the CONNECT handshake.
        // Every HTTP request inside this authenticated tunnel is checked below.
        if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) validateFetchMetadata(req.headers, target);
        if (!options.tls) fail('GATEWAY_TLS_NOT_CONFIGURED', 501);
        const epoch = currentEpoch();
        controller = new AbortController(); controllers.add(controller);
        socket.once('close', disconnected);
        timer = setTimeout(() => controller.abort(new GatewayError('GATEWAY_TIMEOUT', 504)), Math.min(timeoutMs, 10_000));
        timer.unref();
        const certificate = await withSignal(Promise.resolve().then(() => (client ? options.tlsClient : options.tls)(target.hostname, { signal: controller.signal })), controller.signal);
        if (controller.signal.aborted || socket.destroyed) throw controller.signal.reason ?? new GatewayError('GATEWAY_CANCELLED', 499);
        assertEpoch(epoch);
        if (!client && !origins.has(target.origin)) fail('GATEWAY_TARGET_REJECTED', 403);
        let context;
        try { context = tls.createSecureContext({ key: certificate?.key, cert: certificate?.cert, minVersion: 'TLSv1.2' }); }
        catch { fail('GATEWAY_TLS_CERTIFICATE_INVALID', 502); }
        if (!certificate?.key || !certificate?.cert) fail('GATEWAY_TLS_CERTIFICATE_INVALID', 502);
        const handshaking = tls.createServer({
          key: certificate.key, cert: certificate.cert, minVersion: 'TLSv1.2',
          ALPNProtocols: ['http/1.1'], handshakeTimeout: Math.min(timeoutMs, 10_000),
          SNICallback(servername, callback) {
            if (servername.toLowerCase() !== target.hostname) callback(new GatewayError('GATEWAY_TLS_SNI_REJECTED', 403));
            else callback(null, context);
          },
        });
        handshaking.on('tlsClientError', () => { if (client) clientDiagnostics.tlsFailures++; socket.destroy(); });
        controller.signal.addEventListener('abort', () => socket.destroy(), { once: true });
        handshaking.once('secureConnection', secure => {
          clearTimeout(timer); controllers.delete(controller); socket.off('close', disconnected);
          secure.on('error', () => {});
          secure.setTimeout(timeoutMs, () => secure.destroy());
          try {
            assertEpoch(epoch);
            if (stopped || controller.signal.aborted || !client && !origins.has(target.origin) || secure.servername && secure.servername.toLowerCase() !== target.hostname || secure.alpnProtocol && secure.alpnProtocol !== 'http/1.1') fail('GATEWAY_TLS_SNI_REJECTED', 403);
            tunnels.set(secure, { origin: target.origin, hostname: target.hostname, epoch, ...(client ? { client } : {}) });
            inner.emit('connection', secure);
          } catch { secure.destroy(); }
        });
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); established = true;
        if (head.length) socket.unshift(head);
        handshaking.emit('connection', socket);
        socket.resume();
      } catch (error) {
        recordRejection(req, target, error);
        clearTimeout(timer);
        if (controller) controllers.delete(controller);
        socket.off('close', disconnected);
        if (established) socket.destroy();
        else socketError(socket, error);
      }
    })();
  });

  return {
    listen({ port = 0 } = {}) {
      if (stopped) return Promise.reject(new GatewayError('GATEWAY_CLOSED', 503));
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) return Promise.reject(new GatewayError('GATEWAY_CONFIG_INVALID'));
      if (listening) return listening;
      listening = new Promise((resolve, reject) => {
        const error = () => { server.off('listening', ready); listening = undefined; reject(new GatewayError('GATEWAY_LISTEN_FAILED', 503)); };
        const ready = () => { server.off('error', error); const address = server.address(); resolve({ host: '127.0.0.1', port: address.port }); };
        server.once('error', error); server.once('listening', ready); server.listen({ host: '127.0.0.1', port });
      });
      return listening;
    },
    address() {
      const address = server.address();
      return address && typeof address === 'object' ? { host: '127.0.0.1', port: address.port } : null;
    },
    async preflight() {
      if (!peerAuthorization || stopped || !listening) fail('GATEWAY_PREFLIGHT_UNAVAILABLE', 503);
      const endpoint = await listening;
      await new Promise((resolve, reject) => {
        const request = http.request({ hostname: endpoint.host, port: endpoint.port, method: 'GET', path: preflightUrl,
          headers: { Host: 'onethu-preflight.invalid' }, agent: false, timeout: 10000 }, response => {
          const parts = []; let size = 0;
          response.on('data', chunk => { size += chunk.length; if (size <= 2048) parts.push(chunk); });
          response.on('error', () => reject(new GatewayError('GATEWAY_PREFLIGHT_FAILED', 503)));
          response.on('end', () => {
            if (response.statusCode === 204) return resolve();
            let code;
            try { if (size <= 2048) code = JSON.parse(Buffer.concat(parts).toString('utf8')).error?.code; } catch {}
            reject(new GatewayError(typeof code === 'string' && /^GATEWAY_[A-Z_]{1,64}$/.test(code) ? code : 'GATEWAY_PREFLIGHT_FAILED', 503));
          });
        });
        request.once('error', error => reject(error instanceof GatewayError ? error : new GatewayError('GATEWAY_PREFLIGHT_FAILED', 503)));
        request.once('timeout', () => request.destroy(new GatewayError('GATEWAY_PREFLIGHT_TIMEOUT', 503)));
        request.end();
      });
    },
    statistics() { return { requests: [...requestsByHost.values()].reduce((sum, count) => sum + count, 0), hosts: Object.fromEntries(requestsByHost),
      recentRejections: recentRejections.map(entry => ({ ...entry })),
      clientDiagnostics:{...clientDiagnostics,recentRequests:clientDiagnostics.recentRequests.map(entry=>({...entry}))} }; },
    close() {
      if (closing) return closing;
      stopped = true;
      for (const controller of controllers) controller.abort(new GatewayError('GATEWAY_CLOSED', 503));
      for (const socket of sockets) socket.destroy();
      closing = (async () => {
        if (listening) await listening.catch(() => {});
        await new Promise(resolve => { server.close(() => resolve()); });
      })();
      return closing;
    },
  };
}
