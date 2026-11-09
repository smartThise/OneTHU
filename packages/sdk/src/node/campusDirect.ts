/** Pinned, certificate-verified HTTPS for official portal-discovered services. */
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { lookup } from 'node:dns/promises';
import { Readable, pipeline } from 'node:stream';
import { isIP } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import { authError } from './storage.js';

export function isCampusDirectAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    // 198.18/15 is intentionally usable: local TUN resolvers use fake-IP
    // routing. TLS still validates the original university hostname.
    return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
      !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(address) !== 6) return false;
  return /^2[0-9a-f]{3}:/i.test(address); // Global unicast only; rejects mapped IPv4.
}

/** Match Fetch's decoded-body contract even when an upstream ignores identity.
 * Keep its original headers so the gateway can remove encoded entity metadata. */
export function campusDirectResponse(incoming: IncomingMessage, method = 'GET'): Response {
  const headers = new Headers();
  for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
  const status = incoming.statusCode ?? 502;
  if (method.toUpperCase() === 'HEAD' || [204, 205, 304].includes(status)) {
    incoming.resume();
    return new Response(null, { status, statusText: incoming.statusMessage, headers });
  }
  const encodings = (headers.get('content-encoding') ?? '').split(',').map(value => value.trim().toLowerCase()).filter(value => value && value !== 'identity');
  const decoders = encodings.reverse().map(encoding => {
    if (encoding === 'gzip' || encoding === 'x-gzip') return createGunzip();
    if (encoding === 'deflate' || encoding === 'x-deflate') return createInflate();
    if (encoding === 'br') return createBrotliDecompress();
    throw authError('CAMPUS_SERVICE_ENCODING_UNSUPPORTED');
  });
  if (decoders.length) {
    // pipeline propagates source/decoder errors and cancellation in both
    // directions. The Web stream exposes those errors to the caller.
    pipeline([incoming, ...decoders], () => {});
  }
  const body = decoders.at(-1) ?? incoming;
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
    status, statusText: incoming.statusMessage, headers,
  });
}

export const campusDirectFetch: typeof globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !url.hostname.endsWith('.tsinghua.edu.cn')) throw authError('CAMPUS_SERVICE_TARGET_REJECTED');
  if (init.redirect !== 'manual') throw authError('CAMPUS_SERVICE_REDIRECT_REJECTED');
  init.signal?.throwIfAborted();
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  init.signal?.throwIfAborted();
  if (!addresses.length || addresses.some(item => !isCampusDirectAddress(item.address))) throw authError('CAMPUS_SERVICE_ADDRESS_REJECTED');
  const pinned = addresses[0]!;
  const headers = new Headers(init.headers);
  headers.set('accept-encoding', 'identity');
  const request = https.request(url, {
    method: init.method ?? 'GET', headers: Object.fromEntries(headers), agent: false,
    servername: url.hostname, rejectUnauthorized: true, signal: init.signal ?? undefined,
    lookup: ((_host: string, options: unknown, callback: (...args: any[]) => void) => {
      if ((options as { all?: boolean })?.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    }) as any,
  });
  const response = new Promise<Response>((resolve, reject) => {
    request.once('error', () => reject(authError('CAMPUS_SERVICE_NETWORK_FAILED')));
    request.once('response', incoming => {
      try { resolve(campusDirectResponse(incoming, init.method)); }
      catch (error) { incoming.destroy(); reject(error); }
    });
  });
  if (init.body != null) {
    const reader = new Response(init.body).body!.getReader();
    void (async () => {
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          if (!request.write(part.value)) await new Promise<void>((resolve, reject) => {
            const cleanup = () => { request.off('drain', drain); request.off('close', close); };
            const drain = () => { cleanup(); resolve(); }, close = () => { cleanup(); reject(authError('CAMPUS_SERVICE_NETWORK_FAILED')); };
            request.once('drain', drain); request.once('close', close);
          });
        }
        request.end();
      } catch { request.destroy(); }
      finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    })();
  } else request.end();
  return response;
};
