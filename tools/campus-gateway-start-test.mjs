import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCampusGatewayStart } from '../apps/desktop/src/lib/campusGatewayStart.ts';

const ready = () => ({ username: 'fixture-a', epoch: 7, bootstrapAllowed: false, tombstone: false,
  session: { state: 'ready', authenticated: true, twoFactor: { pending: false } },
  policy: { enabled: false, automatic: false } });
const empty = () => ({ ...ready(), username: null, bootstrapAllowed: true, session: { state: 'idle', authenticated: false } });
function fixture(status = ready()) {
  const value = { gui: { username: 'fixture-a', state: 'ready', fingerprint: 'fixture-device', finger3: 'fixture-trust' }, status, reads: 0, exports: 0, adoptions: [] };
  const ports = {
    gui: () => value.gui,
    shared: async () => { value.reads++; return structuredClone(value.status); },
    cookies: async () => { value.exports++; return { cookies: [{ name: 'fixture-session', value: 'fixture-native-cookie', domain: 'learn.tsinghua.edu.cn', path: '/', secure: true, hostOnly: true }] }; },
    adopt: async (snapshot, expectedEpoch, reason) => { value.adoptions.push({ snapshot, expectedEpoch, reason }); return { ...ready(), epoch: expectedEpoch + 1 }; },
  };
  return { value, ports };
}

test('ready authoritative account starts with external CLI disabled without reading or replacing native cookies', async () => {
  const { value, ports } = fixture();
  assert.deepEqual(await prepareCampusGatewayStart(ports), { expectedAccount: 'fixture-a', expectedEpoch: 7 });
  assert.equal(value.reads, 1); assert.equal(value.exports, 0); assert.deepEqual(value.adoptions, []);
  assert.equal(value.status.policy.enabled, false);
});

test('only a genuinely empty bootstrap-eligible daemon receives the verified native snapshot', async () => {
  const { value, ports } = fixture(empty());
  assert.deepEqual(await prepareCampusGatewayStart(ports), { expectedAccount: 'fixture-a', expectedEpoch: 8 });
  assert.equal(value.reads, 2); assert.equal(value.exports, 1); assert.equal(value.adoptions.length, 1);
  const adoption = value.adoptions[0];
  assert.equal(adoption.reason, 'bootstrap'); assert.equal(adoption.expectedEpoch, 7);
  assert.equal(adoption.snapshot.username, 'fixture-a'); assert.equal(adoption.snapshot.fingerprint, 'fixture-device');
  assert.equal(JSON.parse(adoption.snapshot.cookiesJson)[0].value, 'fixture-native-cookie');
  assert.equal(value.status.policy.enabled, false);
});

for (const [name, status, code] of [
  ['another daemon account', { ...ready(), username: 'fixture-b' }, 'CLI_SHARED_SESSION_CHANGED'],
  ['an explicit logout tombstone', { ...empty(), tombstone: true }, 'CLI_SHARED_SESSION_CHANGED'],
  ['a same-account nonready owner', { ...ready(), session: { state: 'idle', authenticated: false } }, 'GATEWAY_LOGIN_REQUIRED'],
  ['a same-account unauthenticated owner', { ...ready(), session: { state: 'ready', authenticated: false } }, 'GATEWAY_LOGIN_REQUIRED'],
  ['an active daemon authentication flow', { ...ready(), session: { state: 'ready', twoFactor: { pending: true } } }, 'AUTH_IN_PROGRESS'],
  ['a pending second factor', { ...empty(), session: { state: 'need-2fa' } }, 'AUTH_IN_PROGRESS'],
  ['an empty owner without bootstrap permission', { ...empty(), bootstrapAllowed: false }, 'GATEWAY_LOGIN_REQUIRED'],
  ['a closed daemon', { ...empty(), session: { state: 'closed' } }, 'GATEWAY_LOGIN_REQUIRED'],
]) test(`start refuses ${name} without touching its account`, async () => {
  const { value, ports } = fixture(status);
  await assert.rejects(prepareCampusGatewayStart(ports), { message: code });
  assert.equal(value.exports, 0); assert.deepEqual(value.adoptions, []);
});

test('GUI authentication must already be ready', async () => {
  const { value, ports } = fixture(empty()); value.gui.state = 'need-2fa';
  await assert.rejects(prepareCampusGatewayStart(ports), { message: 'GATEWAY_LOGIN_REQUIRED' });
  assert.equal(value.reads, 0); assert.equal(value.exports, 0);
});

test('GUI account changes during status inspection cannot start the previous account', async () => {
  const { value, ports } = fixture(); const read = ports.shared;
  ports.shared = async () => { const result = await read(); value.gui.username = 'fixture-b'; return result; };
  await assert.rejects(prepareCampusGatewayStart(ports), { message: 'CLI_SHARED_SESSION_CHANGED' });
  assert.equal(value.exports, 0); assert.deepEqual(value.adoptions, []);
});

test('GUI change during native export cancels bootstrap before adoption', async () => {
  const { value, ports } = fixture(empty()); const read = ports.cookies;
  ports.cookies = async () => { const result = await read(); value.gui.fingerprint = 'replacement-device'; return result; };
  await assert.rejects(prepareCampusGatewayStart(ports), { message: 'CLI_SHARED_SESSION_CHANGED' });
  assert.deepEqual(value.adoptions, []);
});

for (const [name, update, code] of [
  ['logout', status => { status.epoch++; status.tombstone = true; }, 'CLI_SHARED_SESSION_CHANGED'],
  ['another login', status => { status.username = 'fixture-b'; status.epoch++; }, 'CLI_SHARED_SESSION_CHANGED'],
  ['pending authentication', status => { status.session.twoFactor = { pending: true }; }, 'AUTH_IN_PROGRESS'],
]) test(`a daemon ${name} during cookie export prevents snapshot adoption`, async () => {
  const { value, ports } = fixture(empty()); const read = ports.cookies;
  ports.cookies = async () => { const result = await read(); update(value.status); return result; };
  await assert.rejects(prepareCampusGatewayStart(ports), { message: code });
  assert.deepEqual(value.adoptions, []);
});

test('a GUI switch while bootstrap completes never proceeds to gateway start', async () => {
  const { value, ports } = fixture(empty()); const adopt = ports.adopt;
  ports.adopt = async (...args) => { const result = await adopt(...args); value.gui.username = 'fixture-b'; return result; };
  await assert.rejects(prepareCampusGatewayStart(ports), { message: 'CLI_SHARED_SESSION_CHANGED' });
});

test('adoption must return the ready account before a start fence is issued', async () => {
  const { ports } = fixture(empty());
  ports.adopt = async () => ({ ...ready(), username: 'fixture-b' });
  await assert.rejects(prepareCampusGatewayStart(ports), { message: 'CLI_SHARED_SESSION_CHANGED' });
});
