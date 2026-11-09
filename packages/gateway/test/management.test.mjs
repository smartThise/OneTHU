import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serveManagement } from '../src/management.mjs';
import { requestSites, script } from '../src/managementPage.mjs';
import { GatewayError } from '../src/policy.mjs';

const sites = { sites: [{ host: 'learn.tsinghua.edu.cn', enabled: true }] };
const noWait = async () => {};

test('management reads recover from one transient failure and stop retrying a rejected request', async () => {
  let calls = 0;
  assert.deepEqual(await requestSites({}, { wait: noWait, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('unavailable', { status: 503 }) : Response.json(sites);
  } }), sites);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(requestSites({}, { wait: noWait, fetchImpl: async () => {
    calls++; return new Response('forbidden', { status: 403 });
  } }), /403/);
  assert.equal(calls, 1);
});

test('a site change retries the identical idempotent payload after a lost acknowledgement', async () => {
  const payload = JSON.stringify({ host: 'learn.tsinghua.edu.cn', enabled: false });
  const requests = [];
  const state = { sites: [{ host: 'learn.tsinghua.edu.cn', enabled: false }] };
  const actual = await requestSites({ method: 'POST', body: payload }, {
    wait: noWait,
    fetchImpl: async (_url, init) => {
      requests.push({ method: init.method, body: init.body });
      if (requests.length === 1) throw new TypeError('connection reset after saving');
      return Response.json(state);
    },
  });
  assert.deepEqual(actual, state);
  assert.deepEqual(requests, [{ method: 'POST', body: payload }, { method: 'POST', body: payload }]);
});

test('unresponsive management requests time out after two bounded attempts', async () => {
  let calls = 0;
  await assert.rejects(requestSites({}, {
    timeoutMs: 5, wait: noWait,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  }), { name: 'AbortError' });
  assert.equal(calls, 2);
});

test('malformed management state is rejected before rendering', async () => {
  await assert.rejects(requestSites({}, {
    wait: noWait, fetchImpl: async () => Response.json({ sites: [{ host: 'learn.tsinghua.edu.cn' }] }),
  }), /Invalid site response/);
  new Function(script);
});

test('transient peer failures close the connection so a fresh request can authenticate', async t => {
  let calls = 0;
  const management = await serveManagement({
    authorizePeer: async () => {
      calls++;
      if (calls === 1) throw new GatewayError('GATEWAY_PEER_UNAVAILABLE', 503);
      return true;
    },
    getSites: () => sites,
    changeSite: async () => {},
  });
  t.after(() => management.close());
  const agent = new http.Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  const get = () => new Promise((resolve, reject) => {
    http.get(new URL('/api/sites', management.url), { agent }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, connection: response.headers.connection }));
    }).on('error', reject);
  });
  assert.deepEqual(await get(), { status: 503, connection: 'close' });
  assert.equal((await get()).status, 200);
});
