import net from 'node:net';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { GatewayError } from './policy.mjs';

const failure = () => new GatewayError('GATEWAY_PASSTHROUGH_FAILED', 502);

function connectSocket(options, signal) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ ...options, signal });
    socket.setTimeout(10000, () => socket.destroy(failure()));
    socket.once('error', () => reject(failure()));
    socket.once('connect', () => resolve(socket));
  });
}

function readBytes(socket, size) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      socket.off('readable', read);
      socket.off('error', failed);
      socket.off('end', failed);
      socket.off('close', failed);
    }
    function failed() { cleanup(); reject(failure()); }
    function read() {
      const bytes = socket.read(size);
      if (bytes) { cleanup(); resolve(bytes); }
      else if (socket.destroyed || socket.readableEnded) failed();
    }
    socket.on('readable', read);
    socket.once('error', failed);
    socket.once('end', failed);
    socket.once('close', failed);
    read();
  });
}

async function connectSocks(proxy, hostname, port, signal) {
  const socket = await connectSocket({ host: proxy.host, port: proxy.port }, signal);
  const deadline = setTimeout(() => socket.destroy(failure()), 10000);
  try {
    socket.pause();
    socket.write(Buffer.from([5, 1, 0]));
    const greeting = await readBytes(socket, 2);
    if (greeting[0] !== 5 || greeting[1] !== 0) throw failure();
    const name = Buffer.from(hostname, 'ascii');
    if (!name.length || name.length > 255) throw failure();
    const destination = Buffer.alloc(name.length + 7);
    destination.set([5, 1, 0, 3, name.length]);
    name.copy(destination, 5);
    destination.writeUInt16BE(port, name.length + 5);
    socket.write(destination);
    const reply = await readBytes(socket, 4);
    if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) throw failure();
    let addressLength;
    if (reply[3] === 1) addressLength = 4;
    else if (reply[3] === 4) addressLength = 16;
    else if (reply[3] === 3) addressLength = (await readBytes(socket, 1))[0];
    else throw failure();
    await readBytes(socket, addressLength + 2);
    signal?.throwIfAborted();
    socket.setTimeout(0);
    return socket;
  } catch {
    socket.destroy();
    throw failure();
  } finally { clearTimeout(deadline); }
}

function connectHttpProxy(proxy, hostname, port, signal) {
  return new Promise((resolve, reject) => {
    const authority = `${hostname}:${port}`;
    const request = http.request({
      hostname: proxy.host, port: proxy.port, method: 'CONNECT', path: authority,
      headers: { Host: authority }, signal, timeout: 10000,
    });
    request.once('error', () => reject(failure()));
    request.once('timeout', () => request.destroy(failure()));
    request.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); reject(failure()); return; }
      socket.setTimeout(0);
      if (head.length) socket.unshift(head);
      resolve(socket);
    });
    request.end();
  });
}

/** Connect only through the original network route. The returned stream is
 * opaque to this transport and carries no OneTHU account credentials. */
export function createCampusPassthrough(fallback = {}) {
  const matches = host => (fallback.bypass ?? []).some(value => {
    if (value === '<local>') return !host.includes('.');
    if (value.includes('/')) return false;
    const pattern = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
    return new RegExp('^' + pattern + '$', 'i').test(host);
  });
  const cidrs = (fallback.bypass ?? []).filter(value => value.includes('/'));
  return async (target, { signal } = {}) => {
    const protocol = target.protocol ?? 'https:';
    if (!['https:', 'http:'].includes(protocol)) throw failure();
    const hostname = target.hostname;
    const port = Number(target.port) || (protocol === 'http:' ? 80 : 443);
    if (typeof hostname !== 'string' || !hostname || !Number.isInteger(port) || port < 1 || port > 65535) throw failure();
    let bypass = matches(hostname);
    if (!bypass && cidrs.length) {
      const addresses = await lookup(hostname, { all: true }).catch(() => []);
      bypass = addresses.some(({ address, family }) => family === 4 && cidrs.some(cidr => {
        const [network, bits] = cidr.split('/'), parts = network.split('.');
        while (parts.length < 4) parts.push('0');
        const integer = value => value.split('.').reduce((result, part) => (result * 256 + Number(part)) >>> 0, 0);
        const mask = Number(bits) === 0 ? 0 : (0xffffffff << (32 - Number(bits))) >>> 0;
        return (integer(address) & mask) === (integer(parts.join('.')) & mask);
      }));
    }
    signal?.throwIfAborted();
    const proxy = bypass ? null : fallback[protocol === 'http:' ? 'http' : 'https'];
    if (proxy) return connectHttpProxy(proxy, hostname, port, signal);
    if (!bypass && fallback.socks) return connectSocks(fallback.socks, hostname, port, signal);
    const socket = await connectSocket({ host: hostname, port }, signal);
    socket.setTimeout(0);
    return socket;
  };
}
