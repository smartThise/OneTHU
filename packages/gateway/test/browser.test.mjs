import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeGatewayBrowserTarget } from '../src/browser.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

test('paused popup resumes before waiting for Page.enable acknowledgement', async () => {
  const commands = [], auth = deferred(), page = deferred();
  let resumed = false;
  const ready = initializeGatewayBrowserTarget(async (method, params, sessionId) => {
    assert.equal(sessionId, 'popup');
    commands.push(method);
    if (method === 'Fetch.enable') {
      assert.deepEqual(params, { handleAuthRequests: true });
      return auth.promise;
    }
    if (method === 'Page.enable') return page.promise;
    if (method === 'Runtime.runIfWaitingForDebugger') { resumed = true; page.resolve(); }
  }, { sessionId: 'popup', type: 'page' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commands, ['Fetch.enable']);
  assert.equal(resumed, false, 'proxy authentication must be installed before resume');
  auth.resolve();
  assert.equal(await ready, 'popup');
  assert.deepEqual(commands, ['Fetch.enable', 'Page.enable', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger']);
  assert.equal(resumed, true);
});

test('failed proxy authentication setup never releases the target', async () => {
  const commands = [];
  await assert.rejects(initializeGatewayBrowserTarget(async method => {
    commands.push(method);
    throw new Error('auth setup failed');
  }, { sessionId: 'popup', type: 'page' }), /auth setup failed/);
  assert.deepEqual(commands, ['Fetch.enable']);
});

test('page setup failure is reported after resuming without a permanent debugger pause', async () => {
  const commands = [];
  await assert.rejects(initializeGatewayBrowserTarget(async method => {
    commands.push(method);
    if (method === 'Page.enable') throw new Error('page setup failed');
  }, { sessionId: 'popup', type: 'page' }), /page setup failed/);
  assert.ok(commands.includes('Runtime.runIfWaitingForDebugger'));
});

test('workers get authentication and recursive attachment before startup resumes', async () => {
  const commands = [];
  await initializeGatewayBrowserTarget(async method => { commands.push(method); }, { sessionId: 'worker', type: 'worker' });
  assert.deepEqual(commands, ['Fetch.enable', 'Target.setAutoAttach', 'Runtime.runIfWaitingForDebugger']);
});
