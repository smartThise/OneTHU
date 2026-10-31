import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCertificateAuthority } from '../src/certificates.mjs';
import { createPlatformIntegration } from '../src/platform.mjs';

const url = 'http://127.0.0.1:41827/proxy.pac';
const clone = value => JSON.parse(JSON.stringify(value));
const group = () => ({ enabled: false, server: 'previous.proxy.example', port: '8080', authenticated: '0' });

async function fixture(t, platform = 'darwin') {
  const directory = await mkdtemp(join(tmpdir(), 'onethu-platform-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const ca = await createCertificateAuthority({ directory, allowedHosts: ['learn.tsinghua.edu.cn'] });
  const state = {
    calls: [], installed: false, trusted: false, failMutation: false,
    services: { 'Wi-Fi': { pac: { url: 'https://previous.example/proxy.pac', enabled: false }, web: group(), secure: group() },
      USB: { pac: { url: '', enabled: false }, web: group(), secure: group() } },
    win: { AutoConfigURL: { exists: false, value: null, kind: null }, ProxyEnable: { exists: false, value: null, kind: null } },
    winConfiguration: { autoDetect: false, autoConfigUrl: '', proxy: '' },
  };
  const run = async (command, args) => {
    state.calls.push({ command, args: [...args] });
    if (command.endsWith('networksetup')) {
      const [action, service, value] = args;
      if (action === '-listallnetworkservices') return { stdout: 'An asterisk (*) denotes that a network service is disabled.\nWi-Fi\nUSB\n*Disabled\n' };
      if (action === '-getsocksfirewallproxy') return { stdout: `Enabled: ${state.socks ? 'Yes' : 'No'}\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0\n` };
      if (action === '-getproxyautodiscovery') return { stdout: `Auto Proxy Discovery: ${state.discovery ? 'On' : 'Off'}\n` };
      const item = state.services[service];
      const kind = action.includes('autoproxy') ? 'pac' : action.includes('secureweb') ? 'secure' : 'web';
      if (action.startsWith('-get')) {
        const current = item[kind];
        return { stdout: kind === 'pac' ? `URL: ${current.url || '(null)'}\nEnabled: ${current.enabled ? 'Yes' : 'No'}\n` :
          `Enabled: ${current.enabled ? 'Yes' : 'No'}\nServer: ${current.server}\nPort: ${current.port}\nAuthenticated Proxy Enabled: ${current.authenticated}\n` };
      }
      if (state.failMutation) throw new Error('denied: private output must not escape');
      if (action === '-setautoproxyurl') item.pac = { url: value, enabled: true };
      else item[kind].enabled = value === 'on';
      return { stdout: '' };
    }
    if (command.endsWith('security')) {
      if (args[0] === 'find-certificate') return { stdout: state.installed ? ca.certificatePem : '' };
      if (args[0] === 'verify-cert') { if (!state.trusted) throw new Error('not trusted'); return { stdout: 'verified' }; }
      if (args[0] === 'add-trusted-cert') { state.installed = true; state.trusted = true; }
      if (args[0] === 'remove-trusted-cert') state.trusted = false;
      if (args[0] === 'delete-certificate') state.installed = false;
      return { stdout: '' };
    }
    assert.equal(command, 'powershell.exe');
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    const operation = /^# ONETHU:(.+)/.exec(script)[1];
    const payload = JSON.parse(Buffer.from(/FromBase64String\('([^']+)'\)/.exec(script)[1], 'base64').toString());
    if (operation === 'proxy-preflight') {
      assert.match(script, /WinHttpGetIEProxyConfigForCurrentUser/);
      assert.match(script, /GlobalFree/);
      if (state.failPreflight) throw new Error('configuration not found');
      return { stdout: JSON.stringify(state.winConfiguration) };
    }
    if (operation === 'read-proxy') return { stdout: JSON.stringify(state.win) };
    if (operation === 'write-proxy') {
      assert.deepEqual(state.win, payload.expected);
      state.win = clone(payload.desired);
      assert.match(script, /InternetSetOption/);
      return { stdout: '' };
    }
    if (operation === 'trust-status') return { stdout: JSON.stringify({ installed: state.installed, trusted: state.trusted }) };
    if (operation === 'trust') { state.installed = true; state.trusted = true; }
    if (operation === 'untrust') { state.installed = false; state.trusted = false; }
    assert.match(script, /CurrentUser/);
    return { stdout: '' };
  };
  const options = { directory, certificatePath: ca.certificatePath, fingerprint: ca.fingerprint, platform, run };
  const integration = createPlatformIntegration(options);
  return { directory, ca, state, integration, options };
}

test('construction is inert and mutation always requires explicit confirmation', async t => {
  const f = await fixture(t);
  assert.equal(f.state.calls.length, 0);
  for (const method of ['trust', 'untrust', 'enableProxy', 'disableProxy']) {
    assert.throws(() => f.integration[method]({ pacUrl: url }), { code: 'GATEWAY_PLATFORM_CONFIRMATION_REQUIRED' });
  }
  assert.equal(f.state.calls.length, 0);
  const status = await f.integration.status();
  assert.equal(status.trusted, false);
  assert.equal(status.proxyEnabled, false);
});

test('macOS snapshots enabled services, restores PAC URL and prior disabled state exactly', async t => {
  const f = await fixture(t);
  const before = clone(f.state.services);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  assert.equal(f.state.services['Wi-Fi'].pac.url, url);
  assert.equal(f.state.services.USB.pac.enabled, true);
  assert.equal((await f.integration.status()).proxyEnabled, true);
  assert.deepEqual(await f.integration.disableProxy({ confirm: true }), { restored: true, conflicts: [], failures: [] });
  assert.deepEqual(f.state.services, before);
  assert.equal(f.state.calls.some(call => call.args.includes('Disabled')), false);
  assert.equal(f.state.calls.some(call => /sudo|osascript/.test(call.command)), false);
});

test('macOS refuses existing PAC, HTTP, HTTPS, SOCKS and auto discovery before any mutation', async t => {
  for (const existing of ['pac', 'web', 'secure', 'socks', 'discovery']) {
    const f = await fixture(t);
    if (['socks', 'discovery'].includes(existing)) f.state[existing] = true;
    else f.state.services['Wi-Fi'][existing].enabled = true;
    await assert.rejects(f.integration.enableProxy({ confirm: true, pacUrl: url }), { code: 'GATEWAY_EXISTING_PROXY_ENABLED' });
    assert.equal(f.state.calls.some(call => call.args[0].startsWith('-set')), false);
    await assert.rejects(readFile(join(f.directory, 'platform-state.json')), { code: 'ENOENT' });
  }
});

test('restoration preserves later user edits and reports the precise conflict', async t => {
  const f = await fixture(t);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  f.state.services['Wi-Fi'].pac.url = 'https://user-change.example/proxy.pac';
  const restored = await f.integration.disableProxy({ confirm: true });
  assert.deepEqual(restored.conflicts, ['Wi-Fi/pac']);
  assert.equal(f.state.services['Wi-Fi'].pac.url, 'https://user-change.example/proxy.pac');
  assert.equal(f.state.services.USB.pac.enabled, false);
});

test('a new integration recovers interrupted write-ahead operations and refuses to overwrite a journal', async t => {
  const f = await fixture(t);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  const path = join(f.directory, 'platform-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const entry = saved.proxy.entries.find(value => value.service === 'Wi-Fi' && value.kind === 'pac');
  entry.pending = { before: entry.before, after: entry.owned };
  entry.owned = entry.before;
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  const restarted = createPlatformIntegration(f.options);
  assert.equal((await restarted.status()).recoveryRequired, true);
  await assert.rejects(restarted.enableProxy({ confirm: true, pacUrl: url }), { code: 'GATEWAY_PROXY_RECOVERY_REQUIRED' });
  assert.equal((await restarted.disableProxy({ confirm: true })).restored, true);
  assert.equal(f.state.services['Wi-Fi'].pac.enabled, false);
});

test('permission denial has safe actionable errors and rolls back untouched state', async t => {
  const f = await fixture(t);
  const before = clone(f.state.services);
  f.state.failMutation = true;
  await assert.rejects(f.integration.enableProxy({ confirm: true, pacUrl: url }), cause => {
    assert.equal(cause.code, 'GATEWAY_SYSTEM_PERMISSION_REQUIRED');
    assert.doesNotMatch(cause.message, /private output/);
    return true;
  });
  assert.deepEqual(f.state.services, before);
  assert.equal((await f.integration.status()).proxyEnabled, false);
});

test('trust and untrust act only on the exact local CA and never silently acquire admin rights', async t => {
  for (const platform of ['darwin', 'win32']) {
    const f = await fixture(t, platform);
    assert.equal((await f.integration.trust({ confirm: true })).changed, true);
    assert.equal((await f.integration.trust({ confirm: true })).changed, false);
    assert.equal((await f.integration.status()).trusted, true);
    await f.integration.enableProxy({ confirm: true, pacUrl: url });
    await assert.rejects(f.integration.untrust({ confirm: true }), { code: 'GATEWAY_DISABLE_PROXY_FIRST' });
    await f.integration.disableProxy({ confirm: true });
    await f.integration.untrust({ confirm: true });
    assert.equal(f.state.installed, false);
    assert.equal(f.state.calls.some(call => call.command.includes('sudo')), false);
    assert.equal(f.state.calls.some(call => call.command.endsWith('security') && call.args.includes('-d')), false);
  }
});

test('Windows preserves absent registry values, notifies WinINet, and detects concurrent edits', async t => {
  const f = await fixture(t, 'win32');
  const before = clone(f.state.win);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  assert.equal(f.state.win.AutoConfigURL.value, url);
  assert.equal(f.state.win.ProxyEnable.value, 0);
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
  assert.deepEqual(f.state.win, before);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  f.state.win.AutoConfigURL.value = 'https://user.example/proxy.pac';
  assert.deepEqual((await f.integration.disableProxy({ confirm: true })).conflicts, ['CurrentUser Internet Settings']);
  assert.equal(f.state.win.AutoConfigURL.value, 'https://user.example/proxy.pac');
});

test('Windows refuses existing manual proxy or automatic configuration', async t => {
  for (const field of ['AutoConfigURL', 'ProxyEnable']) {
    const f = await fixture(t, 'win32');
    f.state.win[field] = { exists: true, value: field === 'AutoConfigURL' ? 'https://existing.example/proxy.pac' : 1, kind: field === 'AutoConfigURL' ? 'String' : 'DWord' };
    await assert.rejects(f.integration.enableProxy({ confirm: true, pacUrl: url }), { code: 'GATEWAY_EXISTING_PROXY_ENABLED' });
    assert.equal(f.state.calls.some(call => Buffer.from(call.args.at(-1), 'base64').toString('utf16le').includes('ONETHU:write-proxy')), false);
  }
});

test('Windows checks active connection WPAD, PAC and manual proxy configuration before writing', async t => {
  for (const field of ['autoDetect', 'autoConfigUrl', 'proxy']) {
    const f = await fixture(t, 'win32');
    f.state.winConfiguration[field] = field === 'autoDetect' ? true : field === 'proxy' ? 'proxy.corporate.example:8080' : 'https://corporate.example/proxy.pac';
    await assert.rejects(f.integration.enableProxy({ confirm: true, pacUrl: url }), { code: 'GATEWAY_EXISTING_PROXY_ENABLED' });
    assert.equal(f.state.calls.some(call => Buffer.from(call.args.at(-1), 'base64').toString('utf16le').includes('ONETHU:write-proxy')), false);
    await assert.rejects(readFile(join(f.directory, 'platform-state.json')), { code: 'ENOENT' });
  }
});

test('Windows refuses missing or unreadable automatic proxy configuration', async t => {
  for (const missing of [true, false]) {
    const f = await fixture(t, 'win32');
    if (missing) f.state.failPreflight = true;
    else f.state.winConfiguration = { autoConfigUrl: '', proxy: '' };
    await assert.rejects(f.integration.enableProxy({ confirm: true, pacUrl: url }), { code: 'GATEWAY_PROXY_SETTINGS_UNREADABLE' });
    assert.equal(f.state.calls.some(call => Buffer.from(call.args.at(-1), 'base64').toString('utf16le').includes('ONETHU:write-proxy')), false);
    await assert.rejects(readFile(join(f.directory, 'platform-state.json')), { code: 'ENOENT' });
  }
});

test('Windows recovers a crash between its two registry writes', async t => {
  const f = await fixture(t, 'win32');
  const before = clone(f.state.win);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  const path = join(f.directory, 'platform-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const entry = saved.proxy.entries[0];
  entry.pending = { before: entry.before, after: entry.owned,
    intermediate: { ...entry.before, AutoConfigURL: entry.owned.AutoConfigURL } };
  f.state.win = clone(entry.pending.intermediate);
  entry.owned = entry.before;
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  assert.equal((await createPlatformIntegration(f.options).disableProxy({ confirm: true })).restored, true);
  assert.deepEqual(f.state.win, before);
});

test('Windows restores its PAC even when the user independently edits manual proxy state', async t => {
  const f = await fixture(t, 'win32');
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  f.state.win.ProxyEnable = { exists: true, value: 1, kind: 'DWord' };
  const restored = await f.integration.disableProxy({ confirm: true });
  assert.deepEqual(restored.conflicts, ['CurrentUser Internet Settings']);
  assert.deepEqual(f.state.win.AutoConfigURL, { exists: false, value: null, kind: null });
  assert.deepEqual(f.state.win.ProxyEnable, { exists: true, value: 1, kind: 'DWord' });
  assert.equal((await f.integration.status()).proxyEnabled, false);
});

test('Windows retains recovery state if a setting changes during restoration', async t => {
  const f = await fixture(t, 'win32');
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  let reads = 0;
  const integration = createPlatformIntegration({ ...f.options, run: async (command, args) => {
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    if (script.includes('ONETHU:read-proxy') && ++reads === 2) f.state.win.ProxyEnable = { exists: true, value: 1, kind: 'DWord' };
    return f.options.run(command, args);
  } });
  assert.deepEqual((await integration.disableProxy({ confirm: true })).failures, ['CurrentUser Internet Settings']);
  assert.equal((await integration.status()).recoveryRequired, true);
  await integration.disableProxy({ confirm: true });
  assert.equal(f.state.win.AutoConfigURL.exists, false);
  assert.equal(f.state.win.ProxyEnable.value, 1);
});

test('mutations serialize across instances and only accept a loopback PAC URL', async t => {
  const f = await fixture(t);
  for (const pacUrl of ['http://example.com:8888/a.pac', 'http://localhost:8888/a.pac', 'https://127.0.0.1:8888/a.pac', 'http://127.0.0.1/a.pac', 'http://u:p@127.0.0.1:8888/a.pac']) {
    assert.throws(() => f.integration.enableProxy({ confirm: true, pacUrl }), { code: 'GATEWAY_PAC_URL_INVALID' });
  }
  const other = createPlatformIntegration(f.options);
  const enabled = f.integration.enableProxy({ confirm: true, pacUrl: url });
  const disabled = other.disableProxy({ confirm: true });
  await enabled;
  assert.equal((await disabled).restored, true);
  assert.equal((await f.integration.status()).proxyEnabled, false);
});
