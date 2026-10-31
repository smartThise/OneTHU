import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampusServiceTokenLedger } from '../src/node/campusServiceTokens.js';

const site = 'https://service-new.tsinghua.edu.cn';
const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fixtureSignature123';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('successful service JSON witnesses both Bearer and custom token headers without changing bytes', async () => {
  const ledger = createCampusServiceTokenLedger(() => 1);
  assert.equal(ledger.permits(site, 'authorization', `Bearer ${token}`), false);
  const source = JSON.stringify({ data: { token }, message: 'fixture' });
  const response = ledger.observeResponse(site, new Response(source, { headers: { 'content-type': 'application/json' } }), () => {});
  assert.equal(await response.text(), source);
  assert.equal(ledger.permits(site, 'authorization', `Bearer ${token}`), true);
  assert.equal(ledger.permits(site, 'token', token), true);
  assert.equal(ledger.permits('https://other.tsinghua.edu.cn', 'token', token), false);
  assert.equal(ledger.permits(site, 'authorization', `Basic ${token}`), false);
  ledger.validateHeaders(site, new Headers({ authorization: `Bearer ${token}`, token, 'x-csrf-token': 'public-nonce' }));
});

test('unknown browser credentials are rejected including token and JWT in another custom header', () => {
  const ledger = createCampusServiceTokenLedger(() => 1);
  for (const headers of [{ authorization: `Bearer ${token}` }, { token }, { 'x-other': token }]) {
    assert.throws(() => ledger.validateHeaders(site, new Headers(headers)), /GATEWAY_SERVICE_TOKEN_REQUIRED/);
  }
  ledger.validateHeaders(site, new Headers({ 'x-api-version': '2.0.0', 'x-xsrf-token': token, 'content-type': 'application/json' }));
});

test('epoch changes and expiry revoke witnessed tokens', async () => {
  let epoch = 1, clock = 0;
  const ledger = createCampusServiceTokenLedger(() => epoch, () => clock);
  await ledger.observeResponse(site, json({ access_token: token }), () => {}).text();
  epoch++;
  assert.equal(ledger.permits(site, 'token', token), false);
  await ledger.observeResponse(site, json({ access_token: token }), () => {}).text();
  clock = 12 * 60 * 60 * 1000;
  assert.equal(ledger.permits(site, 'token', token), false);
});

test('failed/non-JSON responses and arbitrary JSON strings never witness opaque credentials', async () => {
  const ledger = createCampusServiceTokenLedger(() => 1);
  const opaque = '0123456789abcdef0123456789abcdef01234567';
  await ledger.observeResponse(site, json({ token }, 401), () => {}).text();
  await ledger.observeResponse(site, new Response(token), () => {}).text();
  await ledger.observeResponse(site, json({ title: opaque }), () => {}).text();
  assert.equal(ledger.permits(site, 'token', token), false);
  assert.equal(ledger.permits(site, 'token', opaque), false);
  await ledger.observeResponse(site, json({ token: opaque }), () => {}).text();
  assert.equal(ledger.permits(site, 'authorization', `Token ${opaque}`), true);
});

test('large JSON continues streaming unchanged and cannot populate ledger', async () => {
  const ledger = createCampusServiceTokenLedger(() => 1);
  const source = JSON.stringify({ token, padding: 'x'.repeat(256 * 1024) });
  assert.equal(await ledger.observeResponse(site, new Response(source, { headers: { 'content-type': 'application/json' } }), () => {}).text(), source);
  assert.equal(ledger.permits(site, 'token', token), false);
});

test('an account switch during streamed response cannot register the old token', async () => {
  let epoch = 1;
  const ledger = createCampusServiceTokenLedger(() => epoch);
  const response = ledger.observeResponse(site, json({ token }), () => {});
  epoch = 2;
  await response.text();
  assert.equal(ledger.permits(site, 'token', token), false);
});
