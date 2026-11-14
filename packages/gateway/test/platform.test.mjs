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
    services: { 'Wi-Fi': { pac: { url: 'https://previous.example/proxy.pac', enabled: false }, web: group(), secure: group(), socks: group(), bypass: ['127.0.0.1', 'localhost', '*.local', '<local>'] },
      USB: { pac: { url: '', enabled: false }, web: group(), secure: group(), socks: group(), bypass: [] } },
    win: { AutoConfigURL: { exists: false, value: null, kind: null }, ProxyEnable: { exists: false, value: null, kind: null } },
    winConfiguration: { autoDetect: false, autoConfigUrl: '', proxy: '' },
  };
  const run = async (command, args) => {
    state.calls.push({ command, args: [...args] });
    if (command.endsWith('networksetup')) {
      const [action, service, value] = args;
      if (action === '-listallnetworkservices') return { stdout: 'An asterisk (*) denotes that a network service is disabled.\nWi-Fi\nUSB\n*Disabled\n' };
      if (action === '-getproxyautodiscovery') return { stdout: `Auto Proxy Discovery: ${state.discovery ? 'On' : 'Off'}\n` };
      const item = state.services[service];
      if (action === '-getproxybypassdomains') return { stdout: item.bypass.length ? item.bypass.join('\n') + '\n' : `There aren't any bypass domains set on ${service}.\n` };
      const kind = action.includes('autoproxy') ? 'pac' : action.includes('socks') ? 'socks' : action.includes('secureweb') ? 'secure' : 'web';
      if (action.startsWith('-get')) {
        const current = kind === 'socks' && state.socks ? { ...item[kind], enabled: true } : item[kind];
        return { stdout: kind === 'pac' ? `URL: ${current.url || '(null)'}\nEnabled: ${current.enabled ? 'Yes' : 'No'}\n` :
          `Enabled: ${current.enabled ? 'Yes' : 'No'}\nServer: ${current.server}\nPort: ${current.port}\nAuthenticated Proxy Enabled: ${current.authenticated}\n` };
      }
      if (state.failMutation || state.failAction === action) throw new Error('denied: private output must not escape');
      if (action === '-setautoproxyurl') {
        if (!value) throw new Error('Invalid URL');
        item.pac = { url: value, enabled: true };
      }
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
  for (const method of ['trust', 'untrust', 'prepareProxy', 'enableProxy', 'disableProxy']) {
    assert.throws(() => f.integration[method]({ pacUrl: url }), { code: 'GATEWAY_PLATFORM_CONFIRMATION_REQUIRED' });
  }
  assert.equal(f.state.calls.length, 0);
  const status = await f.integration.status();
  assert.equal(status.trusted, false);
  assert.equal(status.proxyEnabled, false);
});

test('macOS restores prior PAC enablement and nonempty URLs while retaining inactive generated URLs', async t => {
  const f = await fixture(t);
  const before = clone(f.state.services);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  assert.equal(f.state.services['Wi-Fi'].pac.url, url);
  assert.equal(f.state.services.USB.pac.enabled, true);
  assert.equal((await f.integration.status()).proxyEnabled, true);
  assert.deepEqual(await f.integration.disableProxy({ confirm: true }), { restored: true, conflicts: [], failures: [], retainedInactivePacUrls: ['USB'] });
  before.USB.pac.url = url;
  assert.deepEqual(f.state.services, before);
  assert.equal(f.state.calls.some(call => call.args.includes('Disabled')), false);
  assert.equal(f.state.calls.some(call => /sudo|osascript/.test(call.command)), false);
});

function manualProxies(f) {
  for (const kind of ['web', 'secure', 'socks']) f.state.services['Wi-Fi'][kind] = { enabled: true, server: '127.0.0.1', port: '7897', authenticated: '0' };
  f.state.services['Wi-Fi'].bypass = ['127.0.0.1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'localhost', '*.local', '*.crashlytics.com', '<local>'];
  f.state.services.USB.socks = { enabled: true, server: 'proxy.example', port: '1080', authenticated: '0' };
}
const serviceUrls = { 'Wi-Fi': 'http://127.0.0.1:41827/wifi.pac', USB: 'http://127.0.0.1:41827/usb.pac' };

test('macOS prepares per-service manual proxy and bypass descriptors without writing anything', async t => {
  const f = await fixture(t);
  manualProxies(f);
  const before = clone(f.state.services);
  const plan = await f.integration.prepareProxy({ confirm: true });
  assert.equal(plan.version, 1); assert.equal(plan.platform, 'darwin');
  assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(plan.services, [
    { name: 'Wi-Fi', fallback: { http: { host: '127.0.0.1', port: 7897 }, https: { host: '127.0.0.1', port: 7897 },
      socks: { host: '127.0.0.1', port: 7897 }, bypass: before['Wi-Fi'].bypass } },
    { name: 'USB', fallback: { http: null, https: null, socks: { host: 'proxy.example', port: 1080 }, bypass: [] } },
  ]);
  assert.deepEqual(f.state.services, before);
  assert.equal(f.state.calls.some(call => call.args[0].startsWith('-set')), false);
  assert.doesNotMatch(JSON.stringify(plan), /password|username|privateKey|certificate|authenticated/);
  await assert.rejects(readFile(join(f.directory, 'platform-state.json')), { code: 'ENOENT' });
});

test('macOS composed PAC restores routing settings and retains only an inactive URL when originally blank', async t => {
  const f = await fixture(t);
  manualProxies(f);
  const before = clone(f.state.services);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true });
  const result = await f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: serviceUrls });
  assert.equal(result.coexistence, true);
  for (const [name, service] of Object.entries(f.state.services)) {
    assert.deepEqual(service.pac, { url: serviceUrls[name], enabled: true });
    for (const kind of ['web', 'secure', 'socks']) assert.equal(service[kind].enabled, false);
    assert.deepEqual(service.bypass, before[name].bypass);
  }
  const changes = f.state.calls.filter(call => call.args[0].startsWith('-set'));
  for (const name of Object.keys(serviceUrls)) assert.equal(changes.find(call => call.args[1] === name).args[0], '-setautoproxyurl');
  const status = await f.integration.status();
  assert.deepEqual(status.activeServices, ['Wi-Fi', 'USB']); assert.equal(status.coexistence, true);
  assert.deepEqual(status.pacUrlsByService, serviceUrls);
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
  before.USB.pac.url = serviceUrls.USB;
  assert.deepEqual(f.state.services, before, 'manual metadata and bypass rules restored; formerly blank PAC remains disabled');
  assert.equal(f.state.calls.some(call => call.args[0] === '-setproxybypassdomains'), false);
  assert.equal(f.state.calls.some(call => ['-setwebproxy', '-setsecurewebproxy', '-setsocksfirewallproxy'].includes(call.args[0])), false);
});

test('macOS composed activation rejects changed snapshots and altered fallback plans before mutation', async t => {
  for (const change of ['port', 'bypass', 'descriptor']) {
    const f = await fixture(t); manualProxies(f);
    const expectedPlan = await f.integration.prepareProxy({ confirm: true });
    if (change === 'port') f.state.services['Wi-Fi'].web.port = '7898';
    else if (change === 'bypass') f.state.services['Wi-Fi'].bypass.push('changed.example');
    else expectedPlan.services[0].fallback.http.host = 'changed.example';
    await assert.rejects(f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: serviceUrls }), { code: 'GATEWAY_PROXY_PLAN_CHANGED' });
    assert.equal(f.state.calls.some(call => call.args[0].startsWith('-set')), false);
    await assert.rejects(readFile(join(f.directory, 'platform-state.json')), { code: 'ENOENT' });
  }
});

test('status detects later proxy changes without mutating settings or recovery journal', async t => {
  const f = await fixture(t); manualProxies(f);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true });
  await f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: serviceUrls });
  assert.equal((await f.integration.status()).settingsChanged, false);
  f.state.services['Wi-Fi'].web.enabled = true;
  f.state.services['Wi-Fi'].secure.enabled = true;
  f.state.services.USB.pac.url = 'https://later-user.example/proxy.pac';
  const before = clone(f.state.services);
  const journal = await readFile(join(f.directory, 'platform-state.json'), 'utf8');
  const mutations = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
  const status = await f.integration.status();
  assert.equal(status.settingsChanged, true);
  assert.equal(status.settingsUnreadable, false);
  assert.deepEqual(status.changedServices, ['Wi-Fi', 'USB']);
  assert.deepEqual(f.state.services, before);
  assert.equal(await readFile(join(f.directory, 'platform-state.json'), 'utf8'), journal);
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, mutations);
});

test('macOS refresh keeps the PAC endpoint and adopts changed manual proxies as the restore baseline', async t => {
  const f = await fixture(t); manualProxies(f);
  await f.integration.enableProxy({ confirm: true, expectedPlan: await f.integration.prepareProxy({ confirm: true }), pacUrlsByService: serviceUrls });
  const wifi = f.state.services['Wi-Fi'];
  wifi.pac.enabled = false;
  for (const kind of ['web', 'secure', 'socks']) wifi[kind] = { enabled: true, server: '127.0.0.1', port: '7898', authenticated: '0' };
  wifi.bypass.push('new-private.example');
  const changed = clone(wifi);
  const before = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
  const expectedPlan = await f.integration.prepareProxy({ confirm: true, refresh: true });
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, before);
  for (const kind of ['http', 'https', 'socks']) assert.deepEqual(expectedPlan.services[0].fallback[kind], { host: '127.0.0.1', port: 7898 });
  assert.deepEqual(expectedPlan.services[0].fallback.bypass, changed.bypass);
  await f.integration.enableProxy({ confirm: true, refresh: true, expectedPlan, pacUrlsByService: serviceUrls });
  assert.deepEqual(wifi.pac, { enabled: true, url: serviceUrls['Wi-Fi'] });
  for (const kind of ['web', 'secure', 'socks']) assert.equal(wifi[kind].enabled, false);
  assert.equal((await f.integration.status()).settingsChanged, false);
  const after = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
  const repeated = await f.integration.prepareProxy({ confirm: true, refresh: true });
  await f.integration.enableProxy({ confirm: true, refresh: true, expectedPlan: repeated, pacUrlsByService: serviceUrls });
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, after);
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
  assert.deepEqual(f.state.services['Wi-Fi'], changed);
});

test('macOS refresh recognizes proxy-off and individual protocol changes', async t => {
  const f = await fixture(t); manualProxies(f);
  await f.integration.enableProxy({ confirm: true, expectedPlan: await f.integration.prepareProxy({ confirm: true }), pacUrlsByService: serviceUrls });
  const wifi = f.state.services['Wi-Fi'];
  // A proxy-off action repeats the already-disabled manual flags and turns off PAC.
  wifi.pac.enabled = false;
  let expectedPlan = await f.integration.prepareProxy({ confirm: true, refresh: true });
  for (const kind of ['http', 'https', 'socks']) assert.equal(expectedPlan.services[0].fallback[kind], null);
  await f.integration.enableProxy({ confirm: true, refresh: true, expectedPlan, pacUrlsByService: serviceUrls });
  // With our PAC still active, a changed HTTPS proxy leaves other protocol baselines intact.
  wifi.secure = { enabled: true, server: '127.0.0.1', port: '7899', authenticated: '0' };
  expectedPlan = await f.integration.prepareProxy({ confirm: true, refresh: true });
  assert.deepEqual(expectedPlan.services[0].fallback.https, { host: '127.0.0.1', port: 7899 });
  assert.equal(expectedPlan.services[0].fallback.http, null);
  assert.equal(expectedPlan.services[0].fallback.socks, null);
  await f.integration.enableProxy({ confirm: true, refresh: true, expectedPlan, pacUrlsByService: serviceUrls });
  await f.integration.disableProxy({ confirm: true });
  assert.equal(wifi.secure.enabled, true);
  assert.equal(wifi.secure.port, '7899');
  assert.equal(wifi.web.enabled, false);
  assert.equal(wifi.socks.enabled, false);
});

test('macOS refresh checks the full observed snapshot again before any writes', async t => {
  for (const edit of ['port', 'bypass', 'pac', 'plan']) {
    const f = await fixture(t); manualProxies(f);
    await f.integration.enableProxy({ confirm: true, expectedPlan: await f.integration.prepareProxy({ confirm: true }), pacUrlsByService: serviceUrls });
    const expectedPlan = await f.integration.prepareProxy({ confirm: true, refresh: true });
    if (edit === 'port') f.state.services['Wi-Fi'].web.port = '7900';
    else if (edit === 'bypass') f.state.services['Wi-Fi'].bypass.push('changed.example');
    else if (edit === 'pac') f.state.services['Wi-Fi'].pac.enabled = false;
    else expectedPlan.services[0].fallback.http.port = 7900;
    const journal = await readFile(join(f.directory, 'platform-state.json'), 'utf8');
    const mutations = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
    await assert.rejects(f.integration.enableProxy({ confirm: true, refresh: true, expectedPlan, pacUrlsByService: serviceUrls }), { code: 'GATEWAY_PROXY_PLAN_CHANGED' });
    assert.equal(await readFile(join(f.directory, 'platform-state.json'), 'utf8'), journal);
    assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, mutations);
  }
});

test('macOS refresh preserves external PAC, discovery and unsupported authentication settings', async t => {
  for (const edit of ['pac', 'discovery', 'authenticated']) {
    const f = await fixture(t); manualProxies(f);
    await f.integration.enableProxy({ confirm: true, expectedPlan: await f.integration.prepareProxy({ confirm: true }), pacUrlsByService: serviceUrls });
    if (edit === 'pac') f.state.services['Wi-Fi'].pac = { enabled: true, url: 'https://other.example/config.pac' };
    else if (edit === 'discovery') f.state.discovery = true;
    else f.state.services['Wi-Fi'].web = { ...f.state.services['Wi-Fi'].web, enabled: true, authenticated: '1' };
    const original = clone(f.state.services);
    const journal = await readFile(join(f.directory, 'platform-state.json'), 'utf8');
    const mutations = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
    await assert.rejects(f.integration.prepareProxy({ confirm: true, refresh: true }), {
      code: edit === 'authenticated' ? 'GATEWAY_AUTHENTICATED_PROXY_UNSUPPORTED' : 'GATEWAY_EXISTING_PROXY_ENABLED',
    });
    assert.deepEqual(f.state.services, original);
    assert.equal(await readFile(join(f.directory, 'platform-state.json'), 'utf8'), journal);
    assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, mutations);
  }
});

test('an interrupted macOS refresh retains the new baseline and waits for recovery', async t => {
  const f = await fixture(t); manualProxies(f);
  await f.integration.enableProxy({ confirm: true, expectedPlan: await f.integration.prepareProxy({ confirm: true }), pacUrlsByService: serviceUrls });
  const wifi = f.state.services['Wi-Fi'];
  wifi.pac.enabled = false;
  for (const kind of ['web', 'secure', 'socks']) wifi[kind] = { enabled: true, server: '127.0.0.1', port: '7900', authenticated: '0' };
  const latest = clone(wifi);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true, refresh: true });
  f.state.failAction = '-setsocksfirewallproxystate';
  await assert.rejects(f.integration.enableProxy({ confirm: true, refresh: true, expectedPlan, pacUrlsByService: serviceUrls }), { code: 'GATEWAY_SYSTEM_PERMISSION_REQUIRED' });
  assert.equal((await f.integration.status()).restorePending, true);
  const mutations = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
  await assert.rejects(f.integration.prepareProxy({ confirm: true, refresh: true }), { code: 'GATEWAY_PROXY_RECOVERY_REQUIRED' });
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, mutations);
  f.state.failAction = undefined;
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
  assert.deepEqual(wifi, latest);
});

test('Windows refresh explicitly leaves its existing integration untouched', async t => {
  const f = await fixture(t, 'win32');
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  const before = clone(f.state.win);
  const journal = await readFile(join(f.directory, 'platform-state.json'), 'utf8');
  await assert.rejects(f.integration.prepareProxy({ confirm: true, refresh: true }), { code: 'GATEWAY_PLATFORM_UNSUPPORTED' });
  assert.throws(() => f.integration.enableProxy({ confirm: true, refresh: true, pacUrlsByService: { CurrentUser: url }, expectedPlan: {} }), { code: 'GATEWAY_PLATFORM_UNSUPPORTED' });
  assert.deepEqual(f.state.win, before);
  assert.equal(await readFile(join(f.directory, 'platform-state.json'), 'utf8'), journal);
});

test('status accepts pending journal states and reports unavailable service queries without writing', async t => {
  const f = await fixture(t);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  const path = join(f.directory, 'platform-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const entry = saved.proxy.entries.find(value => value.service === 'Wi-Fi' && value.kind === 'pac');
  entry.pending = { before: entry.before, after: entry.owned };
  entry.owned = entry.before;
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  assert.equal((await f.integration.status()).settingsChanged, false);
  assert.equal((await f.integration.status()).restorePending, true);
  f.state.services['Wi-Fi'].pac = clone(entry.pending.before);
  assert.equal((await f.integration.status()).settingsChanged, false);
  const integration = createPlatformIntegration({ ...f.options, run: async (command, args) => {
    if (command.endsWith('networksetup') && args[0] === '-getautoproxyurl' && args[1] === 'Wi-Fi') throw new Error('service disappeared');
    return f.options.run(command, args);
  } });
  const status = await integration.status();
  assert.equal(status.settingsChanged, true);
  assert.equal(status.settingsUnreadable, true);
  assert.deepEqual(status.changedServices, ['Wi-Fi']);
  assert.equal(await readFile(path, 'utf8'), JSON.stringify(saved));
});

test('Windows status detects changed fields and accepts an interrupted registry write', async t => {
  const f = await fixture(t, 'win32');
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  assert.equal((await f.integration.status()).settingsChanged, false);
  const path = join(f.directory, 'platform-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const entry = saved.proxy.entries[0];
  entry.pending = { before: entry.before, after: entry.owned,
    intermediate: { ...entry.before, AutoConfigURL: entry.owned.AutoConfigURL } };
  entry.owned = entry.before;
  f.state.win = clone(entry.pending.intermediate);
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  assert.equal((await f.integration.status()).settingsChanged, false);
  f.state.win.ProxyEnable = { exists: true, value: 1, kind: 'DWord' };
  const status = await f.integration.status();
  assert.equal(status.settingsChanged, true);
  assert.deepEqual(status.changedServices, ['CurrentUser']);
});

test('macOS composed activation requires exactly one loopback PAC for each planned service', async t => {
  const f = await fixture(t); manualProxies(f);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true });
  assert.throws(() => f.integration.enableProxy({ confirm: true, pacUrlsByService: serviceUrls }), { code: 'GATEWAY_PROXY_PLAN_INVALID' });
  for (const pacUrlsByService of [{ 'Wi-Fi': serviceUrls['Wi-Fi'] }, { ...serviceUrls, Unknown: url }]) {
    await assert.rejects(f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService }), { code: 'GATEWAY_PROXY_PLAN_CHANGED' });
  }
  assert.throws(() => f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: { ...serviceUrls, USB: 'https://external.example/proxy.pac' } }), { code: 'GATEWAY_PAC_URL_INVALID' });
  assert.equal(f.state.calls.some(call => call.args[0].startsWith('-set')), false);
});

test('macOS composition still refuses arbitrary PAC, discovery, authenticated or malformed proxies', async t => {
  for (const condition of ['pac', 'discovery', 'authenticated', 'host']) {
    const f = await fixture(t); manualProxies(f);
    if (condition === 'pac') f.state.services.USB.pac.enabled = true;
    else if (condition === 'discovery') f.state.discovery = true;
    else if (condition === 'authenticated') f.state.services['Wi-Fi'].web.authenticated = '1';
    else f.state.services['Wi-Fi'].web.server = 'user:password@proxy.example';
    await assert.rejects(f.integration.prepareProxy({ confirm: true }), {
      code: condition === 'authenticated' ? 'GATEWAY_AUTHENTICATED_PROXY_UNSUPPORTED' : condition === 'host' ? 'GATEWAY_PROXY_SETTINGS_UNREADABLE' : 'GATEWAY_EXISTING_PROXY_ENABLED',
    });
    assert.equal(f.state.calls.some(call => call.args[0].startsWith('-set')), false);
  }
});

test('macOS composed activation stops after a permission denial and retains explicit recovery', async t => {
  const f = await fixture(t); manualProxies(f);
  const before = clone(f.state.services);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true });
  f.state.failAction = '-setsocksfirewallproxystate';
  await assert.rejects(f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: serviceUrls }), { code: 'GATEWAY_SYSTEM_PERMISSION_REQUIRED' });
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, 4);
  assert.equal((await f.integration.status()).restorePending, true);
  f.state.failAction = undefined;
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
  assert.deepEqual(f.state.services, before);
  assert.equal((await f.integration.status()).recoveryRequired, false);
});

test('macOS restore stops on the first permission denial without trying other services', async t => {
  const f = await fixture(t); manualProxies(f);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true });
  await f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: serviceUrls });
  const beforeFailure = clone(f.state.services);
  const mutations = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
  f.state.failMutation = true;
  const result = await f.integration.disableProxy({ confirm: true });
  assert.deepEqual(result.failures, ['USB/socks']);
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, mutations + 1);
  assert.deepEqual(f.state.services, beforeFailure);
  assert.equal((await f.integration.status()).restorePending, true);
  assert.equal(JSON.parse(await readFile(join(f.directory, 'platform-state.json'), 'utf8')).proxy.restorePending, true);
  f.state.failMutation = false;
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
});

test('already-disabled legacy empty-URL recovery needs no OS write or authorization helper', async t => {
  const f = await fixture(t);
  await f.integration.enableProxy({ confirm: true, pacUrl: url });
  const path = join(f.directory, 'platform-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const entry = saved.proxy.entries.find(value => value.service === 'USB' && value.kind === 'pac');
  entry.owned.enabled = false;
  entry.pending = { before: clone(entry.owned), after: { url: '', enabled: false } };
  saved.proxy.entries = [entry];
  f.state.services.USB.pac.enabled = false;
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  const mutations = f.state.calls.filter(call => call.args[0].startsWith('-set')).length;
  assert.equal((await f.integration.status()).restorePending, true);
  assert.deepEqual(await f.integration.disableProxy({ confirm: true }), { restored: true, conflicts: [], failures: [], retainedInactivePacUrls: ['USB'] });
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, mutations);
  assert.equal(f.state.calls.some(call => /osascript|sudo/.test(call.command)), false);
  assert.deepEqual(f.state.services.USB.pac, { url, enabled: false });
  assert.equal((await f.integration.status()).restorePending, false);
});

test('macOS composed recovery restores a pending SOCKS mutation and preserves later manual user edits', async t => {
  const f = await fixture(t); manualProxies(f);
  const before = clone(f.state.services);
  const expectedPlan = await f.integration.prepareProxy({ confirm: true });
  await f.integration.enableProxy({ confirm: true, expectedPlan, pacUrlsByService: serviceUrls });
  const path = join(f.directory, 'platform-state.json');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  const socks = saved.proxy.entries.find(entry => entry.service === 'Wi-Fi' && entry.kind === 'socks');
  socks.pending = { before: socks.before, after: socks.owned }; socks.owned = socks.before;
  await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  f.state.services.USB.socks = { ...f.state.services.USB.socks, server: 'user-change.example' };
  const result = await createPlatformIntegration(f.options).disableProxy({ confirm: true });
  assert.deepEqual(result.conflicts, ['USB/socks']); assert.deepEqual(result.failures, []);
  assert.deepEqual(f.state.services['Wi-Fi'], before['Wi-Fi']);
  assert.deepEqual(f.state.services.USB.pac, { url: serviceUrls.USB, enabled: false });
  assert.equal(f.state.services.USB.socks.server, 'user-change.example');
  assert.equal(f.state.services.USB.socks.enabled, false);
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

test('permission denial has safe actionable errors and leaves untouched settings for explicit recovery', async t => {
  const f = await fixture(t);
  const before = clone(f.state.services);
  f.state.failMutation = true;
  await assert.rejects(f.integration.enableProxy({ confirm: true, pacUrl: url }), cause => {
    assert.equal(cause.code, 'GATEWAY_SYSTEM_PERMISSION_REQUIRED');
    assert.doesNotMatch(cause.message, /private output/);
    return true;
  });
  assert.deepEqual(f.state.services, before);
  assert.equal(f.state.calls.filter(call => call.args[0].startsWith('-set')).length, 1);
  assert.equal((await f.integration.status()).restorePending, true);
  f.state.failMutation = false;
  assert.equal((await f.integration.disableProxy({ confirm: true })).restored, true);
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

test('Windows composed activation preserves a current manual proxy and restores its exact managed registry values',async t=>{
 const f=await fixture(t,'win32');
 f.state.win.ProxyEnable={exists:true,value:1,kind:'DWord'};
 f.state.winConfiguration={autoDetect:false,autoConfigUrl:'',proxy:'127.0.0.1:7897',proxyBypass:'localhost;*.local'};
 const before=clone(f.state.win),plan=await f.integration.prepareProxy({confirm:true});
 assert.equal(plan.services[0].fallback.https.port,7897);
 await f.integration.enableProxy({confirm:true,expectedPlan:plan,pacUrlsByService:{CurrentUser:url}});
 assert.equal(f.state.win.ProxyEnable.value,0);assert.equal(f.state.win.AutoConfigURL.value,url);
 assert.equal((await f.integration.status()).coexistence,true);
 await f.integration.disableProxy({confirm:true});assert.deepEqual(f.state.win,before);
});

test('Windows composed activation rejects a changed manual fallback before writing registry state',async t=>{
 const f=await fixture(t,'win32'),plan=await f.integration.prepareProxy({confirm:true});
 f.state.winConfiguration.proxy='127.0.0.1:7897';
 await assert.rejects(f.integration.enableProxy({confirm:true,expectedPlan:plan,pacUrlsByService:{CurrentUser:url}}),{code:'GATEWAY_PROXY_PLAN_CHANGED'});
 assert.equal(f.state.calls.some(call=>Buffer.from(call.args.at(-1),'base64').toString('utf16le').includes('ONETHU:write-proxy')),false);
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
