import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { createMacPeerAuthorizer, verifyMacPeerOutput } from '../src/macPeer.mjs';

const uid = 501, tuple = '127.0.0.1:45001->127.0.0.1:45000';
const processRow = (pid = 17, owner = uid) => `p${pid}\0u${owner}\0\n`;
const fileRow = (name = tuple, state = 'ESTABLISHED', fd = 3) => `f${fd}\0tIPv4\0PTCP\0n${name}\0TST=${state}\0TQR=0\0TQS=0\0\n`;
const output = (owner = uid) => processRow(17, owner) + fileRow();
function socket() {
  return Object.assign(new EventEmitter(), { localAddress: '127.0.0.1', localPort: 45000,
    remoteAddress: '127.0.0.1', remotePort: 45001, remoteFamily: 'IPv4', destroyed: false, readable: true, writable: true });
}
function fixture(options = {}) {
  const calls = [];
  const authorize = createMacPeerAuthorizer({ platform: 'darwin', uid,
    run: async (...args) => { calls.push(args); return { stdout: output(), stderr: '' }; }, ...options });
  return { authorize, calls };
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('machine records bind the client tuple to its own UID, excluding the reverse server row', () => {
  const rows = processRow(10, 0) + fileRow('127.0.0.1:45000->127.0.0.1:45001') + processRow(20, uid) + fileRow();
  assert.equal(verifyMacPeerOutput(rows, tuple, uid), true);
  assert.throws(() => verifyMacPeerOutput(processRow() + fileRow('127.0.0.1:45000->127.0.0.1:45001'), tuple, uid), { code: 'GATEWAY_PEER_UNVERIFIED' });
});

test('one exact tuple owned by another UID cannot use a same-UID server record as authority', () => {
  const rows = processRow(10, uid) + fileRow('127.0.0.1:45000->127.0.0.1:45001') + processRow(20, uid + 1) + fileRow();
  assert.throws(() => verifyMacPeerOutput(rows, tuple, uid), { code: 'GATEWAY_PEER_UID_MISMATCH' });
});

test('duplicate matching sockets are ambiguous even when both owners match', () => {
  for (const owner of [uid, uid + 1]) {
    assert.throws(() => verifyMacPeerOutput(output() + processRow(18, owner) + fileRow(tuple, 'ESTABLISHED', 4), tuple, uid), { code: 'GATEWAY_PEER_UNVERIFIED' });
  }
});

for (const [name, value] of [
  ['missing output', ''],
  ['truncated final record', output().slice(0, -2)],
  ['unframed newline output', output().replaceAll('\0', '')],
  ['missing UID', output().replace('u501\0', '')],
  ['duplicate UID', output().replace('u501\0', 'u501\0u501\0')],
  ['negative UID', output().replace('u501', 'u-1')],
  ['non-numeric UID', output().replace('u501', 'ust')],
  ['non-canonical UID', output().replace('u501', 'u0501')],
  ['missing process record', fileRow()],
  ['incomplete trailing process', output() + processRow(18)],
  ['zero PID', output().replace('p17', 'p0')],
  ['missing TCP state', output().replace('TST=ESTABLISHED\0', '')],
  ['duplicate state', output().replace('TST=ESTABLISHED\0', 'TST=ESTABLISHED\0TST=ESTABLISHED\0')],
  ['not established', processRow() + fileRow(tuple, 'CLOSE_WAIT')],
  ['wrong direction only', processRow() + fileRow('127.0.0.1:45000->127.0.0.1:45001')],
  ['wrong client port', processRow() + fileRow('127.0.0.1:45002->127.0.0.1:45000')],
  ['hostname instead of numeric address', output().replace('n127.0.0.1', 'nlocalhost')],
  ['invalid port', output().replace(':45001->', ':99999->')],
  ['UDP descriptor', output().replace('PTCP', 'PUDP')],
  ['non-socket descriptor', output().replace('tIPv4', 'tREG')],
  ['malformed queue field', output().replace('TQR=0', 'TQR=unknown')],
  ['unknown field', output().replace('PTCP\0', 'PTCP\0xunexpected\0')],
]) test(`rejects ${name}`, () => {
  assert.throws(() => verifyMacPeerOutput(value, tuple, uid), { code: 'GATEWAY_PEER_UNVERIFIED' });
});

test('construction is inert; invocation is bounded, numeric, shell-free and once per socket', async () => {
  const f = fixture(), peer = socket(); assert.equal(f.calls.length, 0);
  assert.deepEqual(await Promise.all([f.authorize(peer), f.authorize(peer)]), [true, true]);
  assert.equal(await f.authorize(peer), true); assert.equal(f.calls.length, 1);
  const [command, args, options] = f.calls[0];
  assert.equal(command, '/usr/sbin/lsof');
  assert.deepEqual(args, ['-nP', '-a', '-iTCP@127.0.0.1:45000', '-sTCP:ESTABLISHED', '-F0puftnPT']);
  assert.ok(options.timeout > 0 && options.timeout <= 10_000); assert.equal(options.maxBuffer, 128 * 1024);
  assert.equal(options.killSignal, 'SIGKILL'); assert.equal(options.shell, undefined);
  assert.equal(options.env.LC_ALL, 'C'); assert.equal(options.env.DYLD_INSERT_LIBRARIES, undefined);
});

test('unsupported systems and invalid socket endpoints issue no command', async () => {
  const unsupported = fixture({ platform: 'linux' });
  await assert.rejects(unsupported.authorize(socket()), { code: 'GATEWAY_PEER_UNSUPPORTED' });
  assert.equal(unsupported.calls.length, 0);
  for (const change of [{ remoteAddress: '127.0.0.2' }, { localAddress: '0.0.0.0' }, { remoteAddress: '::ffff:127.0.0.1' },
    { remoteFamily: 'IPv6' }, { remotePort: 0 }, { localPort: '45000;evil' }, { destroyed: true }, { readable: false }]) {
    const f = fixture(); await assert.rejects(f.authorize(Object.assign(socket(), change)), { code: 'GATEWAY_PEER_SOCKET_INVALID' });
    assert.equal(f.calls.length, 0);
  }
});

test('unknown visibility, lsof failure, warnings and oversized output fail closed without child output', async () => {
  for (const run of [
    async () => { throw Object.assign(new Error('private child diagnostic'), { code: 1, stdout: output() }); },
    async () => ({ stdout: output(), stderr: 'could not inspect process' }),
    async () => ({ stdout: 'x'.repeat(2048), stderr: '' }),
  ]) {
    const f = fixture({ run, maxBuffer: 1024 });
    await assert.rejects(f.authorize(socket()), error => error.code === 'GATEWAY_PEER_UNAVAILABLE' && !error.message.includes('private'));
  }
});

test('a failed socket cannot trigger repeated lsof attempts', async () => {
  const calls = [], peer = socket(), f = fixture({ run: async () => { calls.push(true); return { stdout: output(uid + 1), stderr: '' }; } });
  for (let i = 0; i < 2; i++) await assert.rejects(f.authorize(peer), { code: 'GATEWAY_PEER_UID_MISMATCH' });
  assert.equal(calls.length, 1);
});

test('socket closure and tuple changes during inspection cannot authorize the former peer', async () => {
  const peer = socket(), started = deferred(); let commandSignal;
  const f = fixture({ run: async (_command, _args, options) => { commandSignal = options.signal; started.resolve(); return new Promise(() => {}); } });
  const pending = f.authorize(peer); await started.promise;
  peer.destroyed = true; peer.emit('close');
  await assert.rejects(pending, { code: 'GATEWAY_PEER_CLOSED' }); assert.equal(commandSignal.aborted, true);
  const moved = socket(), g = fixture({ run: async () => { moved.remotePort++; return { stdout: output(), stderr: '' }; } });
  await assert.rejects(g.authorize(moved), { code: 'GATEWAY_PEER_SOCKET_INVALID' });
});

test('pre-aborted and in-flight aborted requests never gain access', async () => {
  const before = new AbortController(); before.abort(); const f = fixture();
  await assert.rejects(f.authorize(socket(), { signal: before.signal }), { code: 'GATEWAY_CANCELLED' }); assert.equal(f.calls.length, 0);
  const controller = new AbortController(), started = deferred(); let commandSignal;
  const g = fixture({ run: async (_command, _args, options) => { commandSignal = options.signal; started.resolve(); return new Promise(() => {}); } });
  const pending = g.authorize(socket(), { signal: controller.signal }); await started.promise; controller.abort(new Error('private cancellation reason'));
  await assert.rejects(pending, { code: 'GATEWAY_CANCELLED' }); assert.equal(commandSignal.aborted, true);
});

test('inspection timeout includes a non-cooperative child and aborts the command signal', async () => {
  let commandSignal;
  const f = fixture({ timeoutMs: 25, run: async (_command, _args, options) => { commandSignal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(f.authorize(socket()), { code: 'GATEWAY_PEER_TIMEOUT' }); assert.equal(commandSignal.aborted, true);
});

test('concurrent commands and queued requests are bounded, with cancelled waiters removed', async () => {
  const first = deferred(), started = deferred(), calls = [];
  const f = fixture({ maxConcurrent: 1, maxPending: 1, run: async () => { calls.push(true); if (calls.length === 1) { started.resolve(); await first.promise; } return { stdout: output(), stderr: '' }; } });
  const a = f.authorize(socket()); await started.promise;
  const cancellation = new AbortController(), b = f.authorize(socket(), { signal: cancellation.signal });
  await assert.rejects(f.authorize(socket()), { code: 'GATEWAY_PEER_BUSY' }); assert.equal(calls.length, 1);
  cancellation.abort(); await assert.rejects(b, { code: 'GATEWAY_CANCELLED' });
  const c = f.authorize(socket()); first.resolve(); assert.deepEqual(await Promise.all([a, c]), [true, true]); assert.equal(calls.length, 2);
});

test('queued authorization deadline expires without launching another command', async () => {
  const first = deferred(), started = deferred(), calls = [];
  const f = fixture({ maxConcurrent: 1, timeoutMs: 25, run: async () => { calls.push(true); started.resolve(); await first.promise; return { stdout: output(), stderr: '' }; } });
  const a = f.authorize(socket()); const aResult = assert.rejects(a, { code: 'GATEWAY_PEER_TIMEOUT' }); await started.promise;
  const controller = new AbortController(), b = f.authorize(socket(), { signal: controller.signal });
  controller.abort(); await assert.rejects(b, { code: 'GATEWAY_CANCELLED' }); await aResult;
  assert.equal(calls.length, 1); first.resolve();
});

test('real macOS loopback peer has current UID and the reverse server row is not mistaken for the client', { skip: process.platform !== 'darwin', timeout: 5000 }, async t => {
  const server = net.createServer(), accepted = deferred(); server.once('connection', accepted.resolve);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = net.connect({ host: '127.0.0.1', port: server.address().port });
  t.after(async () => { client.destroy(); (await accepted.promise).destroy(); await new Promise(resolve => server.close(resolve)); });
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  const peer = await accepted.promise, authorize = createMacPeerAuthorizer();
  assert.equal(await authorize(peer), true); assert.equal(await authorize(peer), true);
  await assert.rejects(createMacPeerAuthorizer({ uid: process.getuid() + 1 })(peer), { code: 'GATEWAY_PEER_UID_MISMATCH' });
});

test('lsof filesystem warnings on stderr stay tolerable while other stderr stays fatal', async () => {
  const { lsofFatalStderr } = await import('../src/macPeer.mjs');
  const webdavWarning = 'lsof: WARNING: can\'t stat() webdav file system /Volumes/dav.example\n      Output information may be incomplete.\n      assuming "dev=36000002" from mount table\n';
  assert.equal(lsofFatalStderr(webdavWarning), false);
  assert.equal(lsofFatalStderr(''), false);
  assert.equal(lsofFatalStderr(undefined), true);
  assert.equal(lsofFatalStderr('lsof: some real error\n'), true);
  assert.equal(lsofFatalStderr('lsof: WARNING: partial\nfatal message\n'), true);
});
