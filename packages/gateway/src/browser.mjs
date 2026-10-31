import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, lstat } from 'node:fs/promises';
import { X509Certificate, createHash } from 'node:crypto';
import { join } from 'node:path';

const failure = code => Object.assign(new Error(code), { code });

async function findBrowser() {
  const candidates = process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    .filter(Boolean).flatMap(root => [join(root, 'Google/Chrome/Application/chrome.exe'), join(root, 'Microsoft/Edge/Application/msedge.exe')])
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of candidates) { try { await access(candidate); return candidate; } catch {} }
  throw failure('GATEWAY_BROWSER_NOT_FOUND');
}

/** An isolated profile and private CDP pipe supply only this proxy's credential.
 * No browser extension, globally listening debug port, OS CA trust or default
 * browser profile is changed. Caller owns this process and its temporary data. */
export async function openGatewayBrowser({ directory, endpoint, pacUrl, username, password, certificatePem,
  url, executablePath, headless = false } = {}) {
  if (endpoint?.host !== '127.0.0.1' || !Number.isInteger(endpoint?.port) ||
      typeof password !== 'string' || typeof username !== 'string') throw failure('GATEWAY_BROWSER_CONFIG_INVALID');
  const binary = executablePath ?? await findBrowser();
  const root = join(directory, 'browsers');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory() || process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid())) throw failure('GATEWAY_BROWSER_DIRECTORY_UNSAFE');
  const profile = await mkdtemp(join(root, 'session-'));
  const spki = createHash('sha256').update(new X509Certificate(certificatePem).publicKey.export({ format: 'der', type: 'spki' })).digest('base64');
  const args = ['--remote-debugging-pipe', `--user-data-dir=${profile}`, `--proxy-pac-url=${pacUrl}`,
    `--ignore-certificate-errors-spki-list=${spki}`, '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    ...(headless ? ['--headless=new'] : []), 'about:blank'];
  const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: false });
  const pending = new Map(), targets = new Map();
  let sequence = 0, incoming = Buffer.alloc(0), ended = false;
  let finish;
  const closed = new Promise(resolveClosed => { finish = resolveClosed; });
  const end = () => {
    if (ended) return;
    ended = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(failure('GATEWAY_BROWSER_CLOSED')); }
    pending.clear();
    void rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}).finally(finish);
  };
  child.once('exit', end); child.once('error', end);
  child.stdio[3].on('error', () => {});
  child.stdio[4].on('error', () => {});

  function send(method, params = {}, sessionId) {
    if (ended) return Promise.reject(failure('GATEWAY_BROWSER_CLOSED'));
    const id = ++sequence;
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(failure('GATEWAY_BROWSER_TIMEOUT')); }, 15_000);
      timer.unref();
      pending.set(id, { resolve: resolveCommand, reject, timer });
      child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`, error => {
        if (error && pending.has(id)) { pending.delete(id); clearTimeout(timer); reject(failure('GATEWAY_BROWSER_CLOSED')); }
      });
    });
  }

  async function event(message) {
    const { method, params, sessionId } = message;
    if (method === 'Target.attachedToTarget') {
      const id = params.sessionId;
      const ready = (async () => {
        if (['page', 'iframe', 'worker', 'service_worker', 'shared_worker'].includes(params.targetInfo.type)) {
          await send('Fetch.enable', { handleAuthRequests: true }, id);
          if (params.targetInfo.type === 'page') await send('Page.enable', {}, id);
          // Child frames/popups inherit the same guarded auth handling.
          await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, id).catch(() => {});
        }
        await send('Runtime.runIfWaitingForDebugger', {}, id);
        return id;
      })();
      targets.set(params.targetInfo.targetId, ready);
      void ready.catch(() => {});
    } else if (method === 'Page.javascriptDialogOpening' && headless) {
      // A headless read-only check cannot answer a site's modal. Decline it;
      // visible user browsers always retain their normal native dialogs.
      await send('Page.handleJavaScriptDialog', { accept: false }, sessionId);
    } else if (method === 'Fetch.requestPaused') await send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
    else if (method === 'Fetch.authRequired') {
      const challenge = params.authChallenge;
      const own = challenge.source === 'Proxy' && challenge.origin === `http://${endpoint.host}:${endpoint.port}`;
      await send('Fetch.continueWithAuth', { requestId: params.requestId, authChallengeResponse: own
        ? { response: 'ProvideCredentials', username, password } : { response: 'Default' } }, sessionId);
    }
  }

  child.stdio[4].on('data', chunk => {
    incoming = Buffer.concat([incoming, chunk]);
    if (incoming.length > 16 * 1024 * 1024) { child.kill(); return; }
    let boundary;
    while ((boundary = incoming.indexOf(0)) >= 0) {
      const frame = incoming.subarray(0, boundary); incoming = incoming.subarray(boundary + 1);
      let message;
      try { message = JSON.parse(frame.toString('utf8')); } catch { continue; }
      if (message.id) {
        const entry = pending.get(message.id);
        if (!entry) continue;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(failure('GATEWAY_BROWSER_PROTOCOL_FAILED')); else entry.resolve(message.result);
      } else void event(message).catch(() => {});
    }
  });

  async function close() {
    if (!ended) {
      // Account revocation must not wait forever for a renderer or CDP reply.
      void send('Browser.close').catch(() => {});
      const wait = ms => new Promise(resolveWait => {
        const timer = setTimeout(resolveWait, ms);
        closed.then(() => { clearTimeout(timer); resolveWait(); });
      });
      await wait(750);
      if (!ended) { child.kill('SIGTERM'); await wait(750); }
      if (!ended) { child.kill('SIGKILL'); await wait(1500); }
      if (!ended) throw failure('GATEWAY_BROWSER_CLOSE_FAILED');
    }
  }
  try {
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const target = await send('Target.createTarget', { url: 'about:blank' });
    let ready = targets.get(target.targetId);
    if (!ready) {
      const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      ready = targets.get(target.targetId) ?? Promise.resolve(attached.sessionId);
    }
    const sessionId = await ready;
    // Opening the browser completes once its guarded page exists. A slow
    // school response or a visible site dialog must not close the new window.
    void send('Page.navigate', { url }, sessionId).catch(() => {});
    return { closed, close, command: (method, params) => send(method, params, sessionId) };
  } catch (error) { await close(); throw error; }
}
