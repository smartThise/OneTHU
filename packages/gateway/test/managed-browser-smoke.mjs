// Optional real Chromium smoke using only generated fixture content and a
// process-local CA exception. No school login, global CA or OS proxy mutation.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManagedGateway } from '../src/manager.mjs';
import { openGatewayBrowser } from '../src/browser.mjs';

const dir = await mkdtemp(join(tmpdir(), 'onethu-managed-browser-'));
let browser;
let reads = 0;
const manager = createManagedGateway({ dataDir: dir, allowedOrigins: ['https://campus.example'],
  platformFactory: () => ({ status: async () => ({ supported: false, trusted: false }) }),
  browserFactory: async options => browser = await openGatewayBrowser({ ...options, headless: true }),
  session: { epoch: () => 1, assertCurrent: epoch => assert.equal(epoch, 1), status: () => ({ authenticated: true, state: 'ready' }),
    request: async (url, init) => {
      reads++;
      assert.equal(init.headers.has('proxy-authorization'), false);
      return new Response('<html><title>OneTHU gateway fixture</title><body><h1 id="ok">shared session connected</h1></body></html>', { headers: { 'Content-Type': 'text/html' } });
    } } });
try {
  await manager.control({ action: 'start', confirm: true });
  await manager.control({ action: 'open-browser', confirm: true });
  let title;
  for (let i = 0; i < 30; i++) {
    const result = await browser.command('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    title = result.result.value;
    if (title === 'OneTHU gateway fixture') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(title, 'OneTHU gateway fixture'); assert.ok(reads > 0);
  console.log('PASS: isolated Chromium, PAC, private proxy authentication, generated CA, and shared-session HTML.');
} finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
