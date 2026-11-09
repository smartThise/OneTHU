import http from 'node:http';
import { GatewayError } from './policy.mjs';
import { page, style, script } from './managementPage.mjs';

const headers = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const assets = new Map([
  ['/', ['text/html; charset=utf-8', page]],
  ['/style.css', ['text/css; charset=utf-8', style]],
  ['/app.js', ['text/javascript; charset=utf-8', script]],
]);

export async function serveManagement({ port = 0, authorizePeer, getSites, changeSite }) {
  let origin, closed = false;
  const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    function send(status, type, body) {
      res.writeHead(status, { ...headers, ...(status >= 500 ? { Connection: 'close' } : {}),
        'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    }
    const json = (status, value) => send(status, 'application/json; charset=utf-8', JSON.stringify(value));
    const requestOrigin = req.headers.origin;
    const pageNavigation = req.method === 'GET' && req.url === '/' && req.headers['sec-fetch-mode'] === 'navigate'
      && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers.host !== new URL(origin).host || req.socket.remoteAddress !== '127.0.0.1'
      || requestOrigin !== undefined && requestOrigin !== origin
      || !pageNavigation && ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) {
      json(403, { error: 'forbidden' }); return;
    }
    const asset = req.method === 'GET' && assets.get(req.url);
    const reading = req.method === 'GET' && req.url === '/api/sites';
    const changing = req.method === 'POST' && req.url === '/api/sites';
    if (!asset && !reading && !changing) { json(404, { error: 'not-found' }); return; }
    if (changing && (requestOrigin !== origin || req.headers['content-type'] !== 'application/json'
      || req.headers['transfer-encoding'] !== undefined || !/^[1-9]\d{0,2}$/.test(req.headers['content-length'] ?? ''))) {
      json(403, { error: 'forbidden' }); return;
    }
    if (!changing && (req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) !== 0)) {
      json(400, { error: 'invalid-request' }); return;
    }
    try {
      if (authorizePeer) {
        const allowed = await authorizePeer(req.socket, { signal: AbortSignal.timeout(10_000) });
        if (allowed !== true) throw new GatewayError('GATEWAY_MANAGEMENT_FORBIDDEN', 403);
      }
      if (closed || req.socket.destroyed) return;
      if (asset) { send(200, ...asset); return; }
      if (reading) { json(200, getSites()); return; }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
      if (!input || typeof input.host !== 'string' || typeof input.enabled !== 'boolean') {
        json(400, { error: 'invalid-request' }); return;
      }
      await changeSite(input.host, input.enabled, () => !closed && !req.socket.destroyed);
      json(200, getSites());
    } catch (error) {
      if (!res.destroyed) {
        const status = error instanceof GatewayError ? error.status : 500;
        json(status, { error: status === 403 ? 'forbidden' : status === 400 ? 'invalid-site' : 'unavailable' });
      }
    }
  });
  server.maxConnections = 24;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.setTimeout(15_000, socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = 'http://127.0.0.1:' + address.port;
  return {
    url: origin + '/', port: address.port,
    close: () => new Promise(resolve => {
      closed = true;
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
