import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GatewayError } from './policy.mjs';

const exec = promisify(execFile);
const fail = (code, status = 403) => { throw new GatewayError(code, status); };
const decimal = (value, maximum) => /^(?:0|[1-9][0-9]*)$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= maximum;
const validPort = value => Number.isInteger(value) && value > 0 && value <= 65535;
function networkTuple(value) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):([1-9][0-9]{0,4})->(\d{1,3}(?:\.\d{1,3}){3}):([1-9][0-9]{0,4})$/.exec(value);
  return !!match && [match[1], match[3]].every(address => address.split('.').every(part => decimal(part, 255))) && validPort(Number(match[2])) && validPort(Number(match[4]));
}

function tupleOf(socket) {
  if (!socket || typeof socket !== 'object' || socket.destroyed || socket.readable === false || socket.writable === false ||
      socket.localAddress !== '127.0.0.1' || socket.remoteAddress !== '127.0.0.1' || socket.remoteFamily !== 'IPv4' ||
      !validPort(socket.localPort) || !validPort(socket.remotePort) || socket.localPort === socket.remotePort ||
      typeof socket.once !== 'function' || typeof socket.off !== 'function') fail('GATEWAY_PEER_SOCKET_INVALID');
  return `127.0.0.1:${socket.remotePort}->127.0.0.1:${socket.localPort}`;
}

/** Strict lsof -F0puftnPT records. UID belongs to a process record; each file
 * must independently identify IPv4/TCP, its complete tuple, and TCP state.
 * Never accept the reverse (server) row or choose one of several matches. */
export function verifyMacPeerOutput(output, tuple, uid) {
  if (typeof output !== 'string' || !output || !output.endsWith('\0\n') ||
      !/^127\.0\.0\.1:[1-9][0-9]*->127\.0\.0\.1:[1-9][0-9]*$/.test(tuple) || !networkTuple(tuple) ||
      !Number.isSafeInteger(uid) || uid < 0) fail('GATEWAY_PEER_UNVERIFIED');
  let processRecord, matches = 0, peerUid;
  for (const line of output.slice(0, -1).split('\n')) {
    if (!line.endsWith('\0')) fail('GATEWAY_PEER_UNVERIFIED');
    const fields = line.slice(0, -1).split('\0');
    if (fields.some(value => !/^[\x20-\x7e]+$/.test(value))) fail('GATEWAY_PEER_UNVERIFIED');
    if (fields[0].startsWith('p')) {
      if (processRecord && !processRecord.files || fields.length !== 2 ||
          !decimal(fields[0].slice(1), 2147483647) || Number(fields[0].slice(1)) === 0 ||
          !fields[1].startsWith('u') || !decimal(fields[1].slice(1), 4294967294)) fail('GATEWAY_PEER_UNVERIFIED');
      processRecord = { uid: Number(fields[1].slice(1)), files: 0 };
      continue;
    }
    if (!processRecord || !fields[0].startsWith('f') || !decimal(fields[0].slice(1), 2147483647)) fail('GATEWAY_PEER_UNVERIFIED');
    const values = new Map();
    for (const field of fields.slice(1)) {
      const name = field.startsWith('T') ? field.slice(0, 3) : field[0];
      if (!['t', 'P', 'n'].includes(name) && !/^T[A-Z]{2}$/.test(name) || values.has(name)) fail('GATEWAY_PEER_UNVERIFIED');
      if (name.startsWith('T') && field[3] !== '=') fail('GATEWAY_PEER_UNVERIFIED');
      values.set(name, field.slice(name.startsWith('T') ? 4 : 1));
    }
    if (values.get('t') !== 'IPv4' || values.get('P') !== 'TCP' || !networkTuple(values.get('n')) || !values.has('TST') ||
        ['TQR', 'TQS'].some(name => values.has(name) && !decimal(values.get(name), Number.MAX_SAFE_INTEGER))) fail('GATEWAY_PEER_UNVERIFIED');
    processRecord.files++;
    if (values.get('n') === tuple) {
      if (values.get('TST') !== 'ESTABLISHED') fail('GATEWAY_PEER_UNVERIFIED');
      matches++; peerUid = processRecord.uid;
    }
  }
  if (!processRecord?.files || matches !== 1) fail('GATEWAY_PEER_UNVERIFIED');
  if (peerUid !== uid) fail('GATEWAY_PEER_UID_MISMATCH');
  return true;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function limiter(maxConcurrent, maxPending) {
  let active = 0;
  const queue = [];
  function release() {
    active--;
    const entry = queue.shift();
    if (entry) { entry.signal.removeEventListener('abort', entry.abort); active++; entry.resolve(release); }
  }
  return signal => {
    if (signal.aborted) return Promise.reject(signal.reason);
    if (active < maxConcurrent) { active++; return Promise.resolve(release); }
    if (queue.length >= maxPending) return Promise.reject(new GatewayError('GATEWAY_PEER_BUSY', 503));
    return new Promise((resolve, reject) => {
      const entry = { resolve, signal, abort: () => {
        const index = queue.indexOf(entry); if (index !== -1) queue.splice(index, 1);
        reject(signal.reason);
      } };
      queue.push(entry); signal.addEventListener('abort', entry.abort, { once: true });
    });
  };
}

/** Same-UID authorization for a separate macOS system-proxy listener. This is
 * not per-application isolation: same-UID processes can already read the private
 * profile. Per-request Origin/Fetch Metadata and account checks stay required.
 * Construction is inert; commands are scoped to one listener port, never a PID. */
export function createMacPeerAuthorizer({ platform = process.platform, uid = process.getuid?.(), run = exec,
  timeoutMs = 8000, maxBuffer = 128 * 1024, maxConcurrent = 4, maxPending = 32 } = {}) {
  if (typeof run !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000 ||
      !Number.isInteger(maxBuffer) || maxBuffer < 1024 || maxBuffer > 1024 * 1024 ||
      !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16 ||
      !Number.isInteger(maxPending) || maxPending < 0 || maxPending > 256 ||
      platform === 'darwin' && (!Number.isSafeInteger(uid) || uid < 0 || uid > 4294967294)) fail('GATEWAY_CONFIG_INVALID', 400);
  const acquire = limiter(maxConcurrent, maxPending), cache = new WeakMap();
  async function inspect(socket, tuple, signal) {
    const controller = new AbortController(), deadline = Date.now() + timeoutMs;
    const abort = () => controller.abort(new GatewayError('GATEWAY_CANCELLED', 499));
    const close = () => controller.abort(new GatewayError('GATEWAY_PEER_CLOSED', 499));
    const timer = setTimeout(() => controller.abort(new GatewayError('GATEWAY_PEER_TIMEOUT', 503)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('close', close);
    let release;
    try {
      if (signal?.aborted) abort();
      if (socket.destroyed) close();
      release = await acquire(controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (tupleOf(socket) !== tuple) fail('GATEWAY_PEER_SOCKET_INVALID');
      const args = ['-nP', '-a', `-iTCP@127.0.0.1:${socket.localPort}`, '-sTCP:ESTABLISHED', '-F0puftnPT'];
      const result = await abortable(run('/usr/sbin/lsof', args, {
        encoding: 'utf8', timeout: Math.max(1, deadline - Date.now()), maxBuffer, killSignal: 'SIGKILL', signal: controller.signal,
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL: 'C', LANG: 'C' },
      }), controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason;
      if (tupleOf(socket) !== tuple) fail('GATEWAY_PEER_SOCKET_INVALID');
      if (!result || result.stderr?.trim() || typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > maxBuffer) fail('GATEWAY_PEER_UNAVAILABLE', 503);
      return verifyMacPeerOutput(result.stdout, tuple, uid);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(error?.killed || error?.code === 'ETIMEDOUT' ? 'GATEWAY_PEER_TIMEOUT' : 'GATEWAY_PEER_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer); socket.off('close', close); signal?.removeEventListener('abort', abort); release?.();
    }
  }
  return async function authorizeSocket(socket, { signal } = {}) {
    if (platform !== 'darwin') fail('GATEWAY_PEER_UNSUPPORTED', 501);
    if (signal?.aborted) fail('GATEWAY_CANCELLED', 499);
    const tuple = tupleOf(socket);
    let entry = cache.get(socket);
    if (entry && entry.tuple !== tuple) fail('GATEWAY_PEER_SOCKET_INVALID');
    if (!entry) { entry = { tuple, promise: inspect(socket, tuple, signal) }; cache.set(socket, entry); }
    try { await (signal ? abortable(entry.promise, signal) : entry.promise); }
    catch (error) { if (signal?.aborted) fail('GATEWAY_CANCELLED', 499); throw error; }
    if (tupleOf(socket) !== tuple) fail('GATEWAY_PEER_SOCKET_INVALID');
    return true;
  };
}
