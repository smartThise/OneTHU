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
const reads = [], attachments = [];
let dialogs = 0;
const manager = createManagedGateway({ dataDir: dir, allowedOrigins: ['https://campus.example', 'https://courses.campus.example'],
  platformFactory: () => ({ status: async () => ({ supported: false, trusted: false }) }),
  browserFactory: async options => browser = await openGatewayBrowser({ ...options, headless: true,
    onProtocolEvent: event => {
      if (event.method === 'Target.attachedToTarget') attachments.push(event.params.targetInfo.targetId);
      if (event.method === 'Page.javascriptDialogOpening') dialogs++;
    } }),
  session: { epoch: () => 1, assertCurrent: epoch => assert.equal(epoch, 1), status: () => ({ authenticated: true, state: 'ready' }),
    request: async (url, init) => {
      const path = new URL(url).pathname;
      reads.push(path);
      assert.equal(init.headers.has('proxy-authorization'), false);
      if (path === '/course-data') return Response.json({ ok: true });
      const content = path === '/course' ? `
        <title>Loading course</title><body><h1 id="course">Course</h1>
        <script>alert('Fixture notice'); fetch('/course-data').then(r => r.json()).then(data => {
          if (data.ok) document.title = 'Course ready';
        });</script></body>` : `
        <title>OneTHU gateway fixture</title><body>
        <a id="card" href="https://courses.campus.example/course" target="_blank" style="display:block;width:200px;height:100px">Course card</a>
        <button id="script-popup" onclick="window.open('https://courses.campus.example/course', '_blank')" style="width:200px;height:100px">Open course</button>
        </body>`;
      return new Response(`<html>${content}</html>`, { headers: { 'Content-Type': 'text/html' } });
    } } });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function evaluate(expression, targetId) {
  const result = await browser.command('Runtime.evaluate', { expression, returnByValue: true }, targetId);
  assert.equal(result.exceptionDetails, undefined);
  return result.result.value;
}
async function waitFor(check, message) {
  for (let i = 0; i < 80; i++) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  assert.fail(message);
}
async function clickPopup(selector) {
  const before = new Set(browser.targets().map(target => target.targetId));
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  assert.ok(point.width > 0 && point.height > 0);
  const { x, y } = point;
  await browser.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await browser.command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await browser.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  const popup = await waitFor(() => browser.targets().find(target => target.type === 'page' && !before.has(target.targetId)), 'Click must create a popup target');
  await waitFor(async () => await evaluate('document.title', popup.targetId) === 'Course ready', 'Popup must load its document, dismiss its fixture alert, and complete fetch');
  assert.equal(browser.targets().find(target => target.targetId === popup.targetId).setup, 'ready');
  await browser.command('Page.close', {}, popup.targetId);
}
try {
  await manager.control({ action: 'start', confirm: true });
  await manager.control({ action: 'open-browser', confirm: true });
  await waitFor(async () => await evaluate('document.title') === 'OneTHU gateway fixture', 'Shared-session HTML must load');
  await clickPopup('#card');
  await clickPopup('#script-popup');
  assert.equal(reads.filter(path => path === '/course-data').length, 2);
  assert.equal(dialogs, 2);
  assert.equal(new Set(attachments).size, attachments.length, 'A target must not acquire duplicate Fetch interceptors');
  console.log('PASS: isolated Chromium, PAC, private proxy authentication, CA, real anchor and window.open clicks, popup fetches and dialogs.');
} finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
