import http from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GatewayError, sanitizeRequestHeaders } from './policy.mjs';

/** Relay a disabled HTTP site with the browser's own credentials. The shared
 * university session is never read, updated or used to retry this request. */
export async function forwardOriginalHttp(req, res, target, { connect, signal, maxUploadBytes, maxDownloadBytes }) {
  const socket = await connect(target, { signal });
  const agent = new http.Agent({ keepAlive: false });
  agent.createConnection = () => socket;
  const headers = sanitizeRequestHeaders(req.rawHeaders);
  for (const name of ['cookie', 'authorization', 'accept-encoding']) {
    if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name]);
  }
  headers.set('host', target.host);
  headers.set('connection', 'close');
  const outbound = http.request({
    hostname: target.hostname, port: Number(target.port) || 80,
    path: target.pathname + target.search, method: req.method,
    headers: Object.fromEntries(headers), agent, signal,
  });
  const fail = error => { outbound.destroy(error); socket.destroy(); };
  const abort = () => fail(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  function limit(maximum) {
    let bytes = 0;
    return new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > maximum ? new GatewayError('GATEWAY_TRANSFER_TOO_LARGE', 413) : null, chunk);
      },
    });
  }
  try {
    const receive = new Promise((resolve, reject) => {
      outbound.once('error', reject);
      outbound.once('response', async incoming => {
        try {
          // Raw HTTP bytes keep their original encoding and cookie headers.
          const responseHeaders = { ...incoming.headers, connection: 'close' };
          for (const name of ['proxy-authenticate', 'proxy-authorization', 'keep-alive', 'upgrade', 'trailer']) delete responseHeaders[name];
          for (const name of String(incoming.headers.connection ?? '').split(',').map(name => name.trim().toLowerCase())) {
            if (name && name !== 'close') delete responseHeaders[name];
          }
          res.writeHead(incoming.statusCode ?? 502, responseHeaders);
          await pipeline(incoming, limit(maxDownloadBytes), res);
          resolve();
        } catch (error) { reject(error); }
      });
    });
    const send = pipeline(req, limit(maxUploadBytes), outbound);
    await Promise.all([send, receive]);
  } finally {
    signal.removeEventListener('abort', abort);
    outbound.destroy();
    agent.destroy();
    socket.destroy();
  }
}
