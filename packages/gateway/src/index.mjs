import http from 'node:http';
import tls from 'node:tls';
import { timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import {
  GatewayError, normalizeAllowedOrigins, parseProxyTarget, parseConnectAuthority,
  parseTunnelTarget, sanitizeRequestHeaders, sanitizeResponseHeaders,
  validateFetchMetadata, validateMethod,
} from './policy.mjs';

export { GatewayError } from './policy.mjs';

const fail = (code, status = 400) => { throw new GatewayError(code, status); };
const safeError = error => error instanceof GatewayError ? error : new GatewayError('GATEWAY_UPSTREAM_FAILED', 502);

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

function respondError(res, error) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  const { safe, body, headers } = errorPayload(error);
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
  const origins = normalizeAllowedOrigins(options.allowedOrigins);
  const { session } = options;
  if (!session || !['epoch', 'assertCurrent', 'request'].every(name => typeof session[name] === 'function')) fail('GATEWAY_CONFIG_INVALID');
  if (typeof options.token !== 'string' || options.token.length < 32 || options.token.length > 1024 || /[^\x21-\x7e]/.test(options.token)) fail('GATEWAY_CONFIG_INVALID');
  if (options.tls !== undefined && typeof options.tls !== 'function') fail('GATEWAY_CONFIG_INVALID');
  const credentials = Buffer.from(`onethu:${options.token}`, 'utf8');
  const timeoutMs = boundedInteger(options.timeoutMs, 30_000, 180_000);
  const maxUploadBytes = boundedInteger(options.maxUploadBytes, 8 * 1024 * 1024, 1024 * 1024 * 1024);
  const maxDownloadBytes = boundedInteger(options.maxDownloadBytes, 64 * 1024 * 1024, 4 * 1024 * 1024 * 1024);
  const maxConnections = boundedInteger(options.maxConnections, 32, 1024);
  const sockets = new Set();
  const controllers = new Set();
  const tunnels = new WeakMap();
  let activeRequests = 0;
  let stopped = false;
  let listening;
  let closing;

  function authenticate(req) {
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
    if (req.rawHeaders.length > 200 || ['host', 'proxy-authorization', 'content-length', 'transfer-encoding', 'origin', 'sec-fetch-site'].some(name => (counts.get(name) ?? 0) > 1)) fail('GATEWAY_REQUEST_REJECTED');
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
    let controller;
    let timer;
    let upload;
    let reader;
    let upstreamResponse;
    let completed = false;
    let counted = false;
    const cancel = () => controller?.abort(new GatewayError('GATEWAY_CANCELLED', 499));
    const disconnected = () => { if (!res.writableFinished) cancel(); };
    try {
      // Once headers have arrived, the operation timer owns cancellation and
      // can send a stable timeout response instead of racing socket inactivity.
      req.socket.setTimeout(0);
      if (stopped) fail('GATEWAY_CLOSED', 503);
      if (!tunnel) authenticate(req);
      const hasBody = framing(req);
      validateMethod(req.method);
      if (hasBody && ['GET', 'HEAD'].includes(req.method)) fail('GATEWAY_REQUEST_REJECTED');
      const target = tunnel ? parseTunnelTarget(req.url, req.headers.host, tunnel, origins) : parseProxyTarget(req.url, req.headers.host, origins);
      validateFetchMetadata(req.headers, target);
      const epoch = tunnel?.epoch ?? currentEpoch();
      assertEpoch(epoch);
      if (activeRequests >= maxConnections) fail('GATEWAY_BUSY', 503);
      activeRequests++; counted = true;
      controller = new AbortController(); controllers.add(controller);
      timer = setTimeout(() => controller.abort(new GatewayError('GATEWAY_TIMEOUT', 504)), timeoutMs);
      timer.unref();
      const check = () => { if (controller.signal.aborted) throw controller.signal.reason; assertEpoch(epoch); };
      req.once('aborted', cancel); req.once('error', cancel); res.once('close', disconnected);
      const headers = sanitizeRequestHeaders(req.rawHeaders);
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
      const response = upstreamResponse = await withSignal(Promise.resolve().then(() => { check(); return session.request(target.href, init); }), controller.signal, value => value?.body?.cancel());
      check();
      if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 599 || !response.headers || response.body && typeof response.body.getReader !== 'function') fail('GATEWAY_UPSTREAM_INVALID', 502);
      const encoding = response.headers.get('content-encoding')?.trim();
      if (encoding && encoding.toLowerCase() !== 'identity' && (response.status === 206 || response.headers.has('content-range'))) fail('GATEWAY_ENCODED_RANGE_UNSUPPORTED', 502);
      const outputHeaders = sanitizeResponseHeaders(response.headers);
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
      controller?.abort(safeError(error));
      respondError(res, error);
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
      let controller;
      let timer;
      let established = false;
      const disconnected = () => {
        clearTimeout(timer);
        if (controller) { controllers.delete(controller); controller.abort(new GatewayError('GATEWAY_CANCELLED', 499)); }
      };
      try {
        if (stopped) fail('GATEWAY_CLOSED', 503);
        authenticate(req);
        if (framing(req)) fail('GATEWAY_REQUEST_REJECTED');
        const target = parseConnectAuthority(req.url, req.headers.host, origins);
        // Browsers do not attach page provenance to the CONNECT handshake.
        // Every HTTP request inside this authenticated tunnel is checked below.
        if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) validateFetchMetadata(req.headers, target);
        if (!options.tls) fail('GATEWAY_TLS_NOT_CONFIGURED', 501);
        const epoch = currentEpoch();
        controller = new AbortController(); controllers.add(controller);
        socket.once('close', disconnected);
        timer = setTimeout(() => controller.abort(new GatewayError('GATEWAY_TIMEOUT', 504)), Math.min(timeoutMs, 10_000));
        timer.unref();
        const certificate = await withSignal(Promise.resolve().then(() => options.tls(target.hostname, { signal: controller.signal })), controller.signal);
        if (controller.signal.aborted || socket.destroyed) throw controller.signal.reason ?? new GatewayError('GATEWAY_CANCELLED', 499);
        assertEpoch(epoch);
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
        handshaking.on('tlsClientError', () => socket.destroy());
        controller.signal.addEventListener('abort', () => socket.destroy(), { once: true });
        handshaking.once('secureConnection', secure => {
          clearTimeout(timer); controllers.delete(controller); socket.off('close', disconnected);
          secure.on('error', () => {});
          secure.setTimeout(timeoutMs, () => secure.destroy());
          try {
            assertEpoch(epoch);
            if (stopped || controller.signal.aborted || secure.servername && secure.servername.toLowerCase() !== target.hostname || secure.alpnProtocol && secure.alpnProtocol !== 'http/1.1') fail('GATEWAY_TLS_SNI_REJECTED', 403);
            tunnels.set(secure, { origin: target.origin, hostname: target.hostname, epoch });
            inner.emit('connection', secure);
          } catch { secure.destroy(); }
        });
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); established = true;
        if (head.length) socket.unshift(head);
        handshaking.emit('connection', socket);
        socket.resume();
      } catch (error) {
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
