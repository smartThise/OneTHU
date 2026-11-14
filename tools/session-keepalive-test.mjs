import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSessionKeepalive } from '../apps/desktop/src/lib/reload.ts';

function fixture(overrides = {}) {
  const account = { username: 'test-account', fingerprint: 'test-device', state: 'ready' };
  const calls = [];
  let time = 100_000;
  const check = createSessionKeepalive({
    account: () => account,
    loginPending: () => false,
    ensure: async () => { calls.push('ensure'); return true; },
    persist: async () => { calls.push('persist'); },
    publish: async () => { calls.push('publish'); },
    now: () => time,
    ...overrides,
  });
  return { account, calls, check, advance: ms => { time += ms; } };
}

test('a verified keepalive persists and publishes the same account', async () => {
  const f = fixture();
  assert.equal(await f.check(), true);
  assert.deepEqual(f.calls, ['ensure', 'persist', 'publish']);
});

test('timer and foreground events join one in-flight check', async () => {
  let complete;
  const f = fixture({ ensure: () => new Promise(resolve => { complete = resolve; }) });
  const first = f.check();
  assert.equal(f.check(), first);
  complete(true);
  assert.equal(await first, true);
  assert.deepEqual(f.calls, ['persist', 'publish']);
});

test('foreground event bursts are throttled while a later wake-up checks again', async () => {
  const f = fixture();
  await f.check();
  assert.equal(await f.check(), false);
  f.advance(15_000);
  assert.equal(await f.check(), true);
  assert.equal(f.calls.filter(call => call === 'ensure').length, 2);
});

test('an unverified session cannot be persisted or promoted to ready', async () => {
  const f = fixture({ ensure: async () => false });
  assert.equal(await f.check(), false);
  assert.deepEqual(f.calls, []);
  f.account.state = 'idle';
  assert.equal(await f.check(), false);
  assert.equal(f.account.state, 'idle');
});

test('interactive two-factor authentication is left alone', async () => {
  const f = fixture({ loginPending: () => true });
  assert.equal(await f.check(), false);
  assert.deepEqual(f.calls, []);
});

test('an account switch retires the old probe before persistence', async () => {
  let complete;
  const f = fixture({ ensure: () => new Promise(resolve => { complete = resolve; }) });
  const checking = f.check();
  f.account.username = 'another-account';
  complete(true);
  assert.equal(await checking, false);
  assert.deepEqual(f.calls, []);
});

test('logout during persistence prevents publication', async () => {
  let finish;
  const f = fixture({ persist: () => new Promise(resolve => { finish = resolve; }) });
  const checking = f.check();
  await Promise.resolve();
  f.account.state = 'idle';
  finish();
  assert.equal(await checking, false);
  assert.deepEqual(f.calls, ['ensure']);
});

test('a failed probe can be retried after the cooldown', async () => {
  let fail = true;
  const f = fixture({ ensure: async () => { if (fail) throw new Error('network unavailable'); return true; } });
  await assert.rejects(f.check(), /network unavailable/);
  fail = false;
  f.advance(15_000);
  assert.equal(await f.check(), true);
  assert.deepEqual(f.calls, ['persist', 'publish']);
});

test('the main-window installer covers desktop and mobile foreground events', async () => {
  const source = await readFile(new URL('../apps/desktop/src/lib/reload.ts', import.meta.url), 'utf8');
  for (const event of ['visibilitychange', 'focus', 'pageshow', 'online']) {
    assert(source.includes(`addEventListener("${event}", tick)`));
  }
  assert(source.includes('if (keepaliveInstalled) return;'));
  assert.match(source, /ensure: async \(\) => \{\s*if \(!await infoLib\.libEnsureSession\(\)\) return false;\s*return clients\.learn\.resume\(\);/);
  assert(source.includes('publish: clients.publishUniversitySession'));
});
