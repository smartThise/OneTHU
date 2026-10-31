import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function isMacWeChatExecutable(path) {
  return typeof path === 'string' && path.startsWith('/Applications/WeChat.app/Contents/') &&
    path.length <= 1024 && !/[\x00-\x1f\x7f]/.test(path) && !path.split('/').some(part => part === '..' || part === '.');
}

/** Signature proof supplements same-user TCP attribution. A process name,
 * User-Agent or a page's Referer is never sufficient on its own. */
export function createTrustedClientResolver(authorizeSocket, { run = exec } = {}) {
  const cache = new WeakMap();
  return async (socket, { signal } = {}) => {
    if (typeof authorizeSocket.describe !== 'function') return null;
    if (!cache.has(socket)) cache.set(socket, (async () => {
      try {
        const peer = await authorizeSocket.describe(socket, { signal }); signal?.throwIfAborted();
        const options = { encoding: 'utf8', timeout: 4000, maxBuffer: 8192, signal, windowsHide: true };
        if (peer.platform === 'darwin') {
          const result = await run('/bin/ps', ['-p', String(peer.pid), '-o', 'comm='], options);
          const path = result.stdout.trim();
          if (result.stderr?.trim() || !isMacWeChatExecutable(path)) return null;
          // App Store builds use Apple's application-signing leaf certificate;
          // its subject OU is not the developer team. Verify the Apple chain
          // first, then read the team and identifier from the signed code.
          await run('/usr/bin/codesign', ['--verify', '--strict', '-R', '=anchor apple generic', path], options);
          const signed = await run('/usr/bin/codesign', ['-dv', '--verbose=2', path], options);
          const metadata = signed.stderr ?? '';
          if (!/^TeamIdentifier=5A4RE8SF68$/m.test(metadata) || !/^Identifier=com\.tencent\.(?:flue|xinWeChat)(?:\.[A-Za-z0-9_.-]+)?$/m.test(metadata)) return null;
        } else if (peer.platform === 'win32') {
          const script = `$ErrorActionPreference='Stop'
$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${peer.pid}'
$path=$p.ExecutablePath
if(!$path -or $path -notmatch '\\\\Tencent\\\\(?:WeChat|Weixin)\\\\' -or $path -match '(?:^|\\\\)\\.\\.(?:\\\\|$)'){throw 'Path invalid'}
$s=Get-AuthenticodeSignature -LiteralPath $path
if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch '(?:^|, )O=(?:Tencent Technology \\(Shenzhen\\) Company Limited|Tencent Technology \\(Shenzhen\\) Co\\.,? ?Ltd\\.?)(?:,|$)'){throw 'Signature invalid'}
'verified'`;
          const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options);
          if (result.stdout.trim() !== 'verified' || result.stderr?.trim()) return null;
        } else return null;
        signal?.throwIfAborted(); if (socket.destroyed) return null;
        return Object.freeze({ application: 'wechat', platform: peer.platform, pid: peer.pid });
      } catch { return null; }
    })());
    const result = await cache.get(socket); signal?.throwIfAborted(); return socket.destroyed ? null : result;
  };
}
