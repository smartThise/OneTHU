import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GatewayError } from './policy.mjs';

const exec = promisify(execFile);
const fail = code => { throw new GatewayError(code, 403); };
const port = value => Number.isInteger(value) && value > 0 && value <= 65535;
function tuple(socket) {
  if (!socket || socket.destroyed || socket.localAddress !== '127.0.0.1' || socket.remoteAddress !== '127.0.0.1' ||
      socket.remoteFamily !== 'IPv4' || !port(socket.localPort) || !port(socket.remotePort) || socket.localPort === socket.remotePort)
    fail('GATEWAY_PEER_SOCKET_INVALID');
  return `${socket.remotePort}:${socket.localPort}`;
}

export function parseWindowsPeer(output) {
  let row; try { row = JSON.parse(output); } catch { fail('GATEWAY_PEER_UNVERIFIED'); }
  if (!row || Array.isArray(row) || !Number.isSafeInteger(row.pid) || row.pid < 1 || row.pid > 2147483647 ||
      typeof row.sid !== 'string' || !/^S-1-(?:\d+-){1,14}\d+$/.test(row.sid) || row.sid !== row.currentSid)
    fail('GATEWAY_PEER_UID_MISMATCH');
  return Object.freeze({ platform: 'win32', pid: row.pid, sid: row.sid });
}

/** Exact client TCP tuple + process owner SID, never the reverse listener row.
 * Uses CurrentUser identity; construction does not change the machine. */
export function createWindowsPeerAuthorizer({ platform = process.platform, run = exec } = {}) {
  const cache = new WeakMap(); let active = 0;
  const waiting=[];
  function release(){active--;const next=waiting.shift();if(next){next.signal?.removeEventListener('abort',next.abort);active++;next.resolve(release);}}
  function acquire(signal){
    signal?.throwIfAborted();if(active<4){active++;return Promise.resolve(release);}
    if(waiting.length>=32)fail('GATEWAY_PEER_BUSY');
    return new Promise((resolve,reject)=>{const row={resolve,signal,abort:()=>{const at=waiting.indexOf(row);if(at>=0)waiting.splice(at,1);reject(signal.reason);}};
      waiting.push(row);signal?.addEventListener('abort',row.abort,{once:true});});
  }
  async function describe(socket, { signal } = {}) {
    if (platform !== 'win32') fail('GATEWAY_PEER_UNSUPPORTED');
    signal?.throwIfAborted(); const key = tuple(socket);
    let entry = cache.get(socket);
    if (entry && entry.key !== key) fail('GATEWAY_PEER_SOCKET_INVALID');
    if (!entry) {
      const promise = (async () => {
        const free=await acquire(signal);
        // Only validated integers enter the fixed PowerShell program.
        const script = `$ErrorActionPreference='Stop'
$rows=@(Get-NetTCPConnection -State Established -LocalAddress 127.0.0.1 -LocalPort ${socket.remotePort} -RemoteAddress 127.0.0.1 -RemotePort ${socket.localPort})
if($rows.Count -ne 1){throw 'Peer ambiguous'}
$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$rows[0].OwningProcess)
$o=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
if($o.ReturnValue -ne 0){throw 'Owner unavailable'}
@{pid=[int]$p.ProcessId;sid=$o.Sid;currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value}|ConvertTo-Json -Compress`;
        try {
          const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
            { encoding: 'utf8', timeout: 4500, maxBuffer: 8192, windowsHide: true, signal, killSignal: 'SIGKILL' });
          if (result.stderr?.trim()) fail('GATEWAY_PEER_UNVERIFIED');
          const identity = parseWindowsPeer(result.stdout); if (tuple(socket) !== key) fail('GATEWAY_PEER_SOCKET_INVALID'); return identity;
        } catch (error) { if (error instanceof GatewayError) throw error; fail('GATEWAY_PEER_UNAVAILABLE'); }
        finally { free(); }
      })();
      entry = { key, promise }; cache.set(socket, entry);
    }
    const identity = await entry.promise; signal?.throwIfAborted(); if (tuple(socket) !== key) fail('GATEWAY_PEER_SOCKET_INVALID'); return identity;
  }
  const authorize = async (socket, options) => { await describe(socket, options); return true; };
  authorize.describe = describe; return authorize;
}
