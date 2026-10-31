import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { X509Certificate, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const exec = promisify(execFile);
const queues = new Map();
const error = (code, message = code) => Object.assign(new Error(message), { code });
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NETWORKSETUP = '/usr/sbin/networksetup';
const SECURITY = '/usr/bin/security';

async function defaultRun(command, args) {
  return exec(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
}

async function checkedRead(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!(await lstat(path)).isFile() || stat.nlink !== 1 || stat.size > 256 * 1024 ||
        process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) throw error('GATEWAY_PLATFORM_STATE_UNSAFE');
    return await file.readFile('utf8');
  } catch (cause) {
    if (cause.code === 'ENOENT') return null;
    if (cause.code === 'ELOOP') throw error('GATEWAY_PLATFORM_STATE_UNSAFE');
    throw cause;
  } finally { await file?.close(); }
}

function fields(output) {
  const values = {};
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  if (!['Yes', 'No'].includes(values.Enabled)) throw error('GATEWAY_PROXY_SETTINGS_UNREADABLE');
  return values;
}

function pacUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw error('GATEWAY_PAC_URL_INVALID'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.hash ||
      /[\x00-\x20\x7f]/.test(value) || value.length > 2048) throw error('GATEWAY_PAC_URL_INVALID');
  return url.href;
}

const winRegistry = `
$ErrorActionPreference = 'Stop'
$registryPath = 'Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
function Read-Proxy {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($registryPath)
  try {
    $result = [ordered]@{}
    foreach ($name in @('AutoConfigURL','ProxyEnable')) {
      $exists = $null -ne $key -and $key.GetValueNames() -contains $name
      if ($exists) { $result[$name] = [ordered]@{ exists=$true; value=$key.GetValue($name); kind=$key.GetValueKind($name).ToString() } }
      else { $result[$name] = [ordered]@{ exists=$false; value=$null; kind=$null } }
    }
    return $result
  } finally { if ($null -ne $key) { $key.Dispose() } }
}
function Notify-Proxy {
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class OneTHUInternetSettings { [DllImport("wininet.dll", SetLastError=true)] public static extern bool InternetSetOption(IntPtr handle, int option, IntPtr buffer, int length); }'
  if (-not [OneTHUInternetSettings]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)) { throw 'SETTINGS_CHANGED failed' }
  if (-not [OneTHUInternetSettings]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)) { throw 'REFRESH failed' }
}
`;

function powershell(operation, body, data = {}) {
  const encoded = Buffer.from(JSON.stringify(data)).toString('base64');
  const script = `# ONETHU:${operation}\n$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')) | ConvertFrom-Json\n${body}`;
  return ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

/** Explicit OS integration. All mutation methods require confirm:true. No commands run at construction. */
export function createPlatformIntegration({ directory, certificatePath, fingerprint, platform = process.platform,
  run = defaultRun, userHome = homedir() } = {}) {
  if (typeof directory !== 'string' || !directory || typeof certificatePath !== 'string' || !certificatePath ||
      typeof fingerprint !== 'string' || !/^(?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(fingerprint) || typeof run !== 'function') throw error('GATEWAY_PLATFORM_CONFIG_INVALID');
  const location = resolve(directory);
  const statePath = join(location, 'platform-state.json');
  const caPath = resolve(certificatePath);
  const hash = fingerprint.replaceAll(':', '').toUpperCase();
  const keychain = join(userHome, 'Library', 'Keychains', 'login.keychain-db');
  const supported = platform === 'darwin' || platform === 'win32';
  const requireSupport = () => { if (!supported) throw error('GATEWAY_PLATFORM_UNSUPPORTED'); };
  const confirm = options => { if (options?.confirm !== true) throw error('GATEWAY_PLATFORM_CONFIRMATION_REQUIRED'); requireSupport(); };

  async function command(program, args, mutation = false) {
    try {
      const result = await run(program, args);
      if (result?.code && result.code !== 0 || result?.exitCode && result.exitCode !== 0) throw new Error();
      const output = typeof result === 'string' ? result : result?.stdout ?? '';
      if (mutation && /administrator access|authorization failed|^Error:/im.test(output)) throw new Error();
      return output;
    } catch {
      throw error(mutation ? 'GATEWAY_SYSTEM_PERMISSION_REQUIRED' : 'GATEWAY_SYSTEM_QUERY_FAILED', mutation
        ? 'The operating system rejected this change. Approve the OS authorization dialog or use an authorized helper; OneTHU never invokes sudo automatically.'
        : 'Could not read the operating system settings.');
    }
  }
  async function readState() {
    const raw = await checkedRead(statePath);
    if (raw === null) return { version: 1, platform, fingerprint: hash, trustOwned: false, proxy: null };
    let value;
    try { value = JSON.parse(raw); } catch { throw error('GATEWAY_PLATFORM_STATE_INVALID'); }
    if (value.version !== 1 || value.platform !== platform || value.fingerprint !== hash || typeof value.trustOwned !== 'boolean' ||
        value.proxy !== null && (!Array.isArray(value.proxy?.entries) || value.proxy.entries.length > 256)) throw error('GATEWAY_PLATFORM_STATE_INVALID');
    return value;
  }
  async function save(state) {
    await mkdir(location, { recursive: true, mode: 0o700 });
    const dir = await lstat(location);
    if (!dir.isDirectory() || dir.isSymbolicLink() || process.platform !== 'win32' && (dir.uid !== process.getuid() || (dir.mode & 0o077) !== 0)) throw error('GATEWAY_PLATFORM_STATE_UNSAFE');
    await checkedRead(statePath);
    const temporary = join(location, `.platform-${randomBytes(8).toString('hex')}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(state)); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temporary, statePath); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  function serialized(work) {
    const previous = queues.get(location) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    queues.set(location, next);
    void next.finally(() => { if (queues.get(location) === next) queues.delete(location); }).catch(() => {});
    return next;
  }
  async function certificate() {
    const value = await checkedRead(caPath);
    let parsed;
    try { parsed = new X509Certificate(value); }
    catch { throw error('GATEWAY_CERTIFICATE_PUBLIC_COPY_INVALID'); }
    if (!parsed.ca || parsed.fingerprint256.replaceAll(':', '') !== hash) throw error('GATEWAY_CERTIFICATE_FINGERPRINT_MISMATCH');
    return parsed;
  }
  async function trustStatus() {
    await certificate();
    if (platform === 'darwin') {
      const output = await command(SECURITY, ['find-certificate', '-a', '-p', keychain]);
      const installed = (output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [])
        .some(value => { try { return new X509Certificate(value).fingerprint256.replaceAll(':', '') === hash; } catch { return false; } });
      if (!installed) return { installed: false, trusted: false };
      try { await command(SECURITY, ['verify-cert', '-c', caPath, '-p', 'ssl', '-L']); return { installed: true, trusted: true }; }
      catch { return { installed: true, trusted: false }; }
    }
    const output = await command('powershell.exe', powershell('trust-status', `
$ErrorActionPreference = 'Stop'
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
try {
  $found = @($store.Certificates | Where-Object { $_.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256) -eq $request.hash }).Count -gt 0
  @{ installed=$found; trusted=$found } | ConvertTo-Json -Compress
} finally { $store.Close() }`, { hash }));
    try { const value = JSON.parse(output); return { installed: value.installed === true, trusted: value.trusted === true }; }
    catch { throw error('GATEWAY_SYSTEM_QUERY_FAILED'); }
  }
  async function readGroup(entry) {
    if (platform === 'win32') {
      try {
        const value = JSON.parse(await command('powershell.exe', powershell('read-proxy', `${winRegistry}\nRead-Proxy | ConvertTo-Json -Depth 5 -Compress`)));
        for (const [name, kind] of [['AutoConfigURL', 'String'], ['ProxyEnable', 'DWord']]) {
          if (typeof value[name]?.exists !== 'boolean' || value[name].exists && value[name].kind !== kind) throw new Error();
        }
        return value;
      } catch { throw error('GATEWAY_PROXY_SETTINGS_UNREADABLE'); }
    }
    const option = entry.kind === 'pac' ? '-getautoproxyurl' : entry.kind === 'web' ? '-getwebproxy' : '-getsecurewebproxy';
    const value = fields(await command(NETWORKSETUP, [option, entry.service]));
    if (entry.kind === 'pac') return { url: value.URL === '(null)' ? '' : value.URL ?? '', enabled: value.Enabled === 'Yes' };
    return { enabled: value.Enabled === 'Yes', server: value.Server ?? '', port: value.Port ?? '', authenticated: value['Authenticated Proxy Enabled'] ?? '' };
  }
  async function windowsProxyPreflight() {
    // The documented API reads the current user's connection configuration,
    // including WPAD that AutoConfigURL/ProxyEnable alone cannot represent.
    // https://learn.microsoft.com/windows/win32/api/winhttp/nf-winhttp-winhttpgetieproxyconfigforcurrentuser
    let config;
    try {
      const output = await command('powershell.exe', powershell('proxy-preflight', `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct OneTHUCurrentProxyConfig {
  public int AutoDetect;
  public IntPtr AutoConfigUrl;
  public IntPtr Proxy;
  public IntPtr ProxyBypass;
}
public static class OneTHUCurrentProxy {
  [DllImport("winhttp.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool WinHttpGetIEProxyConfigForCurrentUser(out OneTHUCurrentProxyConfig config);
  [DllImport("kernel32.dll")]
  public static extern IntPtr GlobalFree(IntPtr memory);
}
'@
$config = [OneTHUCurrentProxyConfig]::new()
try {
  if (-not [OneTHUCurrentProxy]::WinHttpGetIEProxyConfigForCurrentUser([ref]$config)) { throw 'Current user proxy configuration unavailable' }
  $autoConfigUrl = if ($config.AutoConfigUrl -eq [IntPtr]::Zero) { '' } else { [Runtime.InteropServices.Marshal]::PtrToStringUni($config.AutoConfigUrl) }
  $proxy = if ($config.Proxy -eq [IntPtr]::Zero) { '' } else { [Runtime.InteropServices.Marshal]::PtrToStringUni($config.Proxy) }
  [ordered]@{ autoDetect=($config.AutoDetect -ne 0); autoConfigUrl=$autoConfigUrl; proxy=$proxy } | ConvertTo-Json -Compress
} finally {
  foreach ($pointer in @($config.AutoConfigUrl, $config.Proxy, $config.ProxyBypass)) {
    if ($pointer -ne [IntPtr]::Zero) { [void][OneTHUCurrentProxy]::GlobalFree($pointer) }
  }
}`));
      config = JSON.parse(output);
      if (typeof config.autoDetect !== 'boolean' || typeof config.autoConfigUrl !== 'string' || typeof config.proxy !== 'string') throw new Error();
    } catch { throw error('GATEWAY_PROXY_SETTINGS_UNREADABLE'); }
    if (config.autoDetect || config.autoConfigUrl || config.proxy) throw error('GATEWAY_EXISTING_PROXY_ENABLED');
  }
  async function apply(state, entry, desired, args) {
    const current = await readGroup(entry);
    if (!equal(current, entry.owned)) throw error('GATEWAY_PROXY_SETTINGS_CHANGED');
    entry.pending = { before: current, after: desired,
      ...(platform === 'win32' ? { intermediate: { ...current, AutoConfigURL: desired.AutoConfigURL } } : {}) };
    await save(state);
    if (platform === 'darwin') await command(NETWORKSETUP, args, true);
    else await command('powershell.exe', powershell('write-proxy', `${winRegistry}
$current = Read-Proxy | ConvertTo-Json -Depth 5 -Compress
$expected = $request.expected | ConvertTo-Json -Depth 5 -Compress
if ($current -cne $expected) { throw 'OneTHU proxy compare-and-swap conflict' }
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPath)
try {
  foreach ($name in @('AutoConfigURL','ProxyEnable')) {
    $item = $request.desired.$name
    if ($item.exists) { $key.SetValue($name, $item.value, [Enum]::Parse([Microsoft.Win32.RegistryValueKind], [string]$item.kind)) }
    else { $key.DeleteValue($name, $false) }
  }
} finally { $key.Dispose() }
Notify-Proxy`, { expected: current, desired }), true);
    if (!equal(await readGroup(entry), desired)) throw error('GATEWAY_PROXY_SETTINGS_CHANGED');
    entry.owned = desired;
    delete entry.pending;
    await save(state);
  }
  async function restore(state) {
    const conflicts = [];
    const failures = [];
    if (!state.proxy) return { restored: true, conflicts, failures };
    for (const entry of [...state.proxy.entries].reverse()) {
      try {
        const current = await readGroup(entry);
        if (platform === 'win32') {
          let changed = false;
          const before = { ...entry.before };
          for (const name of ['AutoConfigURL', 'ProxyEnable']) {
            const owned = entry.pending ? [entry.pending.before[name], entry.pending.after[name]] : [entry.owned[name]];
            if (!owned.some(value => equal(value, current[name]))) {
              // Relinquish this field, not the whole registry group. In
              // particular a manual-proxy edit must not strand our PAC URL.
              before[name] = current[name];
              changed = true;
            }
          }
          if (changed) conflicts.push('CurrentUser Internet Settings');
          entry.before = before;
          entry.owned = current;
          delete entry.pending;
          await save(state);
          if (!equal(current, before)) await apply(state, entry, before);
          state.proxy.entries = state.proxy.entries.filter(value => value !== entry);
          await save(state);
          continue;
        }
        if (entry.pending) {
          if (equal(current, entry.pending.after)) entry.owned = entry.pending.after;
          else if (equal(current, entry.pending.before)) entry.owned = entry.pending.before;
          else if (entry.pending.intermediate && equal(current, entry.pending.intermediate)) entry.owned = entry.pending.intermediate;
          else throw error('GATEWAY_PROXY_SETTINGS_CHANGED');
          delete entry.pending;
          await save(state);
        }
        if (!equal(current, entry.owned)) throw error('GATEWAY_PROXY_SETTINGS_CHANGED');
        if (!equal(current, entry.before)) {
          if (platform === 'win32') await apply(state, entry, entry.before);
          else if (entry.kind === 'pac') {
            if (entry.owned.url !== entry.before.url) await apply(state, entry, { url: entry.before.url, enabled: true }, ['-setautoproxyurl', entry.service, entry.before.url]);
            if (entry.owned.enabled !== entry.before.enabled) await apply(state, entry, { ...entry.owned, enabled: entry.before.enabled }, ['-setautoproxystate', entry.service, entry.before.enabled ? 'on' : 'off']);
          } else await apply(state, entry, entry.before, [entry.kind === 'web' ? '-setwebproxystate' : '-setsecurewebproxystate', entry.service, entry.before.enabled ? 'on' : 'off']);
        }
        state.proxy.entries = state.proxy.entries.filter(value => value !== entry);
        await save(state);
      } catch (cause) {
        const identifier = platform === 'win32' ? 'CurrentUser Internet Settings' : `${entry.service}/${entry.kind}`;
        if (cause.code === 'GATEWAY_PROXY_SETTINGS_CHANGED' && platform !== 'win32') {
          conflicts.push(identifier);
          state.proxy.entries = state.proxy.entries.filter(value => value !== entry);
          await save(state);
        } else failures.push(identifier);
      }
    }
    if (!state.proxy.entries.length) { state.proxy = null; await save(state); }
    return { restored: !failures.length && !conflicts.length, conflicts, failures };
  }

  return Object.freeze({
    async status() {
      if (!supported) return { platform, supported: false, trusted: false, proxyEnabled: false, recoveryRequired: false };
      const state = await readState();
      const trust = await trustStatus();
      return { platform, supported: true, ...trust, trustOwned: state.trustOwned,
        proxyEnabled: !!state.proxy, recoveryRequired: !!state.proxy, pacUrl: state.proxy?.pacUrl ?? null,
        certificatePath: caPath, fingerprint };
    },
    trust(options = {}) {
      confirm(options);
      return serialized(async () => {
        const state = await readState();
        const status = await trustStatus();
        if (status.trusted) return { trusted: true, changed: false };
        if (status.installed && !state.trustOwned) throw error('GATEWAY_CERTIFICATE_ALREADY_INSTALLED');
        state.trustOwned = true;
        await save(state);
        if (platform === 'darwin') await command(SECURITY, ['add-trusted-cert', '-r', 'trustRoot', '-p', 'ssl', '-k', keychain, caPath], true);
        else await command('powershell.exe', powershell('trust', `
$ErrorActionPreference = 'Stop'
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($request.path)
if ($cert.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256) -ne $request.hash) { throw 'Certificate changed' }
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try { $store.Add($cert) } finally { $store.Close() }`, { path: caPath, hash }), true);
        if (!(await trustStatus()).trusted) throw error('GATEWAY_CERTIFICATE_TRUST_FAILED');
        return { trusted: true, changed: true };
      });
    },
    untrust(options = {}) {
      confirm(options);
      return serialized(async () => {
        const state = await readState();
        if (state.proxy) throw error('GATEWAY_DISABLE_PROXY_FIRST');
        if (!state.trustOwned) return { changed: false };
        const trust = await trustStatus();
        if (trust.installed) {
          if (platform === 'darwin') {
            if (trust.trusted) await command(SECURITY, ['remove-trusted-cert', caPath], true);
            await command(SECURITY, ['delete-certificate', '-Z', hash, keychain], true);
          } else await command('powershell.exe', powershell('untrust', `
$ErrorActionPreference = 'Stop'
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try { @($store.Certificates | Where-Object { $_.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256) -eq $request.hash }) | ForEach-Object { $store.Remove($_) } }
finally { $store.Close() }`, { hash }), true);
        }
        state.trustOwned = false;
        await save(state);
        return { changed: true };
      });
    },
    enableProxy(options = {}) {
      confirm(options);
      const url = pacUrl(options.pacUrl);
      return serialized(async () => {
        const state = await readState();
        if (state.proxy) throw error('GATEWAY_PROXY_RECOVERY_REQUIRED');
        state.proxy = { pacUrl: url, entries: [] };
        const entries = [];
        if (platform === 'darwin') {
          const services = (await command(NETWORKSETUP, ['-listallnetworkservices'])).split(/\r?\n/)
            .filter(value => value && !value.startsWith('*') && !value.startsWith('An asterisk'));
          if (!services.length || services.length > 64) throw error('GATEWAY_NETWORK_SERVICES_UNAVAILABLE');
          for (const service of services) {
            for (const kind of ['web', 'secure', 'pac']) entries.push({ service, kind });
            const socks = fields(await command(NETWORKSETUP, ['-getsocksfirewallproxy', service]));
            const discovery = await command(NETWORKSETUP, ['-getproxyautodiscovery', service]);
            if (!/^Auto Proxy Discovery: (On|Off)\s*$/.test(discovery.trim())) throw error('GATEWAY_PROXY_SETTINGS_UNREADABLE');
            if (socks.Enabled === 'Yes' || discovery.includes(': On')) throw error('GATEWAY_EXISTING_PROXY_ENABLED');
          }
        } else {
          await windowsProxyPreflight();
          entries.push({ kind: 'windows' });
        }
        for (const entry of entries) {
          entry.before = await readGroup(entry); entry.owned = entry.before;
          if (platform === 'darwin' ? entry.before.enabled :
              entry.before.ProxyEnable.exists && entry.before.ProxyEnable.value !== 0 ||
              entry.before.AutoConfigURL.exists && !!entry.before.AutoConfigURL.value) throw error('GATEWAY_EXISTING_PROXY_ENABLED');
        }
        state.proxy.entries = entries;
        await save(state);
        try {
          for (const entry of entries) {
            if (platform === 'win32') await apply(state, entry, {
              AutoConfigURL: { exists: true, value: url, kind: 'String' }, ProxyEnable: { exists: true, value: 0, kind: 'DWord' },
            });
            else if (entry.kind === 'pac') await apply(state, entry, { url, enabled: true }, ['-setautoproxyurl', entry.service, url]);
            else if (entry.owned.enabled) await apply(state, entry, { ...entry.owned, enabled: false },
              [entry.kind === 'web' ? '-setwebproxystate' : '-setsecurewebproxystate', entry.service, 'off']);
          }
        } catch (cause) { await restore(state); throw cause; }
        return { enabled: true, pacUrl: url, services: platform === 'darwin' ? [...new Set(entries.map(entry => entry.service))] : ['CurrentUser'] };
      });
    },
    disableProxy(options = {}) { confirm(options); return serialized(async () => restore(await readState())); },
  });
}
