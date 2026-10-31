import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { createManagedGateway, createPacScript } from '../src/manager.mjs';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'onethu-manager-'));
  let authenticated = true;
  const state = { supported: true, trusted: false, proxyEnabled: false, recoveryRequired: false };
  const platform = { status: async () => ({ ...state }), trust: async () => { state.trusted = true; }, untrust: async () => { state.trusted = false; },
    enableProxy: async ({ pacUrl }) => { state.proxyEnabled = true; state.pacUrl = pacUrl; state.recoveryRequired = true; },
    disableProxy: async () => { state.proxyEnabled = false; state.recoveryRequired = false; return { restored: true }; } };
  const session = { epoch: () => 1, assertCurrent: value => assert.equal(value, 1), status: () => ({ authenticated, state: authenticated ? 'ready' : 'idle' }),
    request: async () => new Response('campus fixture') };
  const manager = createManagedGateway({ dataDir: dir, allowedOrigins: ['https://campus.example', 'http://campus.example'], session,
    platformFactory: () => platform, ...options });
  t.after(async () => { await manager.close(); await rm(dir, { recursive: true, force: true }); });
  return { manager, dir, platform, state, logout: () => { authenticated = false; } };
}

test('read-only status and shutdown leave pristine profile untouched', async t => {
  const { manager, dir } = await fixture(t);
  const status = await manager.control({ action: 'status' });
  assert.equal(status.running, false); assert.equal(status.certificate.ready, false);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(manager.control({ action: 'start' }), /GATEWAY_CONFIRM_REQUIRED/);
  await manager.control({ action: 'stop', confirm: true });
  assert.deepEqual(await readdir(dir), []);
});

test('start, scoped PAC, authentication, status redaction, and stop form a complete lifecycle', async t => {
  const { manager, state } = await fixture(t);
  const status = await manager.control({ action: 'start', confirm: true });
  assert.equal(status.running, true); assert.equal(status.certificate.ready, true);
  const credentials = await manager.control({ action: 'credentials', confirm: true });
  assert.equal(JSON.stringify(status).includes(credentials.password), false);
  assert.equal(state.proxyEnabled, false); assert.equal(state.trusted, false);
  const pac = await fetch(status.pacUrl); assert.equal(pac.status, 200);
  const ctx = vm.createContext({}); vm.runInContext(await pac.text(), ctx);
  assert.equal(ctx.FindProxyForURL('https://campus.example/', 'campus.example'), `PROXY 127.0.0.1:${status.endpoint.port}`);
  assert.equal(ctx.FindProxyForURL('https://campus.example.evil/', 'campus.example.evil'), 'DIRECT');
  const body = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: status.endpoint.host, port: status.endpoint.port, path: 'http://campus.example/',
      headers: { Host: 'campus.example', 'Sec-Fetch-Site': 'none', 'Proxy-Authorization': `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}` } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, data }));
    }); req.on('error', reject); req.end();
  });
  assert.deepEqual(body, { status: 307, data: '' });
  await manager.control({ action: 'trust', confirm: true });
  const enabled = await manager.control({ action: 'system-enable', confirm: true });
  assert.equal(enabled.systemProxy.enabled, true); assert.equal(enabled.systemProxy.recoveryRequired, false);
  const stopped = await manager.control({ action: 'stop', confirm: true });
  assert.equal(stopped.running, false); assert.equal(state.proxyEnabled, false);
  await assert.rejects(fetch(status.pacUrl));
});

test('login is required and failed restoration preserves a running endpoint for repair', async t => {
  const { manager, platform, state, logout } = await fixture(t);
  await manager.control({ action: 'start', confirm: true });
  state.proxyEnabled = true;
  const restore = platform.disableProxy;
  platform.disableProxy = async () => ({ restored: false, failures: ['Wi-Fi'] });
  await assert.rejects(manager.control({ action: 'stop', confirm: true }), /GATEWAY_PROXY_RESTORE_FAILED/);
  assert.equal((await manager.control({ action: 'status' })).running, true);
  platform.disableProxy = restore;
  await manager.control({ action: 'stop', confirm: true });
  logout();
  await assert.rejects(manager.control({ action: 'start', confirm: true }), /GATEWAY_LOGIN_REQUIRED/);
});

test('PAC validates its listener and never falls back direct on allowed campus hosts', () => {
  assert.throws(() => createPacScript(['https://campus.example'], { host: '0.0.0.0', port: 1234 }));
  const ctx = vm.createContext({}); vm.runInContext(createPacScript(['https://campus.example'], { host: '127.0.0.1', port: 1234 }), ctx);
  assert.equal(ctx.FindProxyForURL('https://campus.example', 'CAMPUS.EXAMPLE'), 'PROXY 127.0.0.1:1234');
});

test('account revocation closes proxy and test browser even when OS recovery fails', async t => {
  let closed = 0;
  const { manager, platform, state } = await fixture(t, { browserFactory: async () => ({ close: async () => { closed++; } }) });
  const started = await manager.control({ action: 'start', confirm: true });
  await manager.control({ action: 'open-browser', confirm: true });
  state.proxyEnabled = true; state.recoveryRequired = true;
  const restore = platform.disableProxy;
  platform.disableProxy = async () => ({ restored: false, failures: ['Wi-Fi'] });
  await assert.rejects(manager.control({ action: 'stop', confirm: true, revoke: true }), /GATEWAY_PROXY_RESTORE_FAILED/);
  assert.equal(closed, 1);
  const after = await manager.control({ action: 'status' });
  assert.equal(after.running, false); assert.equal(after.systemProxy.recoveryRequired, true);
  await assert.rejects(manager.control({ action: 'start', confirm: true }), /GATEWAY_PROXY_RECOVERY_REQUIRED/);
  // PAC remains reachable and fails closed at the revoked proxy endpoint.
  assert.equal((await fetch(started.pacUrl)).status, 200);
  platform.disableProxy = restore;
  await manager.control({ action: 'system-disable', confirm: true });
});
