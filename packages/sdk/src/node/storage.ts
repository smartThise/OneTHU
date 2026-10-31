/** Private, account-scoped Node storage. Passwords are intentionally unsupported. */
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SessionData } from '@onethu/core';
import { isDynamicCampusOrigin } from '@onethu/gateway/policy';
const exec = promisify(execFile);
export function authError(code: string): Error & { code: string } { return Object.assign(new Error(code), { code }); }
export type DeviceIdentity = { fingerprint: string; account?: string; finger3?: string };
export type StoredSession = { version: 1; session: SessionData | null; device: DeviceIdentity; epoch?: number; explicitLogout?: boolean; gatewayState?: unknown };
const noFollow = constants.O_NOFOLLOW ?? 0;
function gatewayCache(value:unknown):unknown {
  const g=value as {version?:unknown;owner?:unknown;epoch?:unknown;routes?:unknown[];tokens?:unknown[]}|undefined;
  if(!g||g.version!==1||typeof g.owner!=='string'||!/^[a-f0-9]{64}$/.test(g.owner)||!Number.isSafeInteger(g.epoch)||Number(g.epoch)<0||!Array.isArray(g.routes)||g.routes.length>256||!Array.isArray(g.tokens)||g.tokens.length>256)return undefined;
  const routes=g.routes.flatMap(item=>{
    const r=item as {origin?:unknown;upstreamOrigin?:unknown;transport?:unknown;learned?:unknown};
    if(!r||typeof r.origin!=='string'||typeof r.upstreamOrigin!=='string'||!isDynamicCampusOrigin(r.origin)||!isDynamicCampusOrigin(r.upstreamOrigin)||!['direct','webvpn'].includes(String(r.transport))||r.origin!==r.upstreamOrigin&&r.origin!==r.upstreamOrigin.replace(/^http:/,'https:'))return [];
    return [{origin:r.origin,upstreamOrigin:r.upstreamOrigin,transport:r.transport,url:r.origin+'/',learned:r.learned===true}];
  });
  const allowed=new Set(routes.map(r=>r.origin));
  const tokens=g.tokens.flatMap(item=>{
    const r=item as {origin?:unknown;tokens?:unknown[]};
    if(!r||typeof r.origin!=='string'||!allowed.has(r.origin)||!Array.isArray(r.tokens)||r.tokens.length>128)return [];
    return [{origin:r.origin,tokens:r.tokens.flatMap(item=>{
      const token=item as {hash?:unknown;expiry?:unknown};
      return token&&typeof token.hash==='string'&&/^[a-f0-9]{64}$/.test(token.hash)&&Number.isSafeInteger(token.expiry)?[{hash:token.hash,expiry:token.expiry}]:[];
    })}];
  });
  return {version:1,owner:g.owner,epoch:g.epoch,routes,tokens};
}
const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT';
async function privateMode(target: string, directory: boolean): Promise<void> {
  if (process.platform !== 'win32') { await chmod(target, directory ? 0o700 : 0o600); return; }
  // Build a fresh protected DACL: /grant:r alone would leave unrelated explicit
  // grants intact. The path is an environment value, never executable syntax.
  // Explicit .NET constructors avoid PowerShell's New-Object argument binding;
  // direct persistence writes the modified descriptor sections. Paths remain
  // data, including quotes and Unicode, without a provider or wildcard lookup.
  const script = `$ErrorActionPreference='Stop'; $step='identity'; try { $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $step='descriptor'; $acl=[System.Security.AccessControl.${directory ? 'DirectorySecurity' : 'FileSecurity'}]::new(); $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $inheritance=[System.Security.AccessControl.InheritanceFlags]::${directory ? 'ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit' : 'None'}; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inheritance,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); $step='apply'; [System.IO.${directory ? 'Directory' : 'File'}]::SetAccessControl($env:ONETHU_PRIVATE_STORAGE_PATH,$acl) } catch { [Console]::Error.WriteLine('ONETHU_ACL_STAGE='+$step+';TYPE='+$_.Exception.GetType().Name); exit 1 }`;
  try { await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout:15_000, env: {...process.env, ONETHU_PRIVATE_STORAGE_PATH:target} }); }
  catch (error) {
    // Never return PowerShell stderr: it can contain a user's private path.
    const e=error as {killed?:boolean;stderr?:string};
    const stage=/ONETHU_ACL_STAGE=(identity|descriptor|apply);/.exec(e.stderr??'')?.[1]??'launch';
    throw Object.assign(authError('AUTH_STORAGE_ACL_FAILED'),{stage:'storage-acl',reason:e.killed?'acl-timeout':`acl-${stage}`});
  }
}
async function checkFile(target: string, directory = false): Promise<void> {
  const stat = await lstat(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1)) throw authError('AUTH_STORAGE_UNSAFE_PATH');
  if (process.platform !== 'win32' && typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw authError('AUTH_STORAGE_UNSAFE_OWNER');
  if (process.platform !== 'win32' && (stat.mode & 0o077)) throw authError('AUTH_STORAGE_PERMISSIONS');
}
function validateSession(value: unknown): StoredSession {
  const v = value as StoredSession;
  if (!v || v.version !== 1 || !v.device || !/^[a-f0-9]{32}$/.test(v.device.fingerprint)) throw authError('AUTH_STORAGE_INVALID');
  if (v.device.account !== undefined && (typeof v.device.account !== 'string' || !/^\d{1,32}$/.test(v.device.account))) throw authError('AUTH_STORAGE_INVALID');
  if (v.device.finger3 !== undefined && (typeof v.device.finger3 !== 'string' || v.device.finger3.length > 8192)) throw authError('AUTH_STORAGE_INVALID');
  if (v.epoch !== undefined && (!Number.isSafeInteger(v.epoch) || v.epoch < 0)) throw authError('AUTH_STORAGE_INVALID');
  if (v.explicitLogout !== undefined && typeof v.explicitLogout !== 'boolean') throw authError('AUTH_STORAGE_INVALID');
  if (v.session !== null) {
    const s = v.session;
    if (!s || typeof s.username !== 'string' || !/^\d{1,32}$/.test(s.username) || s.username !== v.device.account || s.fingerprint !== v.device.fingerprint || typeof s.cookiesJson !== 'string' || s.cookiesJson.length > 4_000_000 || !Number.isFinite(s.savedAt)) throw authError('AUTH_STORAGE_INVALID');
    let cookies: unknown;
    try { cookies = JSON.parse(s.cookiesJson); } catch { throw authError('AUTH_STORAGE_INVALID'); }
    if (!Array.isArray(cookies) || cookies.length > 10000 || cookies.some(c => !c || typeof c.name !== 'string' || typeof c.value !== 'string' || typeof c.domain !== 'string' || !/^[a-z0-9.-]+$/i.test(c.domain) || typeof c.path !== 'string' || !c.path.startsWith('/') || typeof c.secure !== 'boolean' || typeof c.hostOnly !== 'boolean' || /[\r\n\0]/.test(c.name+c.value+c.domain+c.path) || (c.expiresAt !== undefined && !Number.isFinite(c.expiresAt)))) throw authError('AUTH_STORAGE_INVALID');
  }
  // Copy only known fields. An old or hand-edited file cannot smuggle a password
  // into the next snapshot via object spreading.
  return { version: 1, epoch: v.epoch ?? 0, explicitLogout: v.explicitLogout === true, gatewayState:v.session?gatewayCache(v.gatewayState):undefined,device: { fingerprint: v.device.fingerprint, account: v.device.account, finger3: v.device.finger3 }, session: v.session && {
    username: v.session.username, fingerprint: v.device.fingerprint, finger3: v.device.finger3,
    cookiesJson: v.session.cookiesJson, savedAt: v.session.savedAt,
  } };
}
/** Validate an account handoff before any state or transport is changed. */
export function validateDesktopSession(value: unknown): SessionData {
  const input = value as SessionData;
  if (!input || typeof input !== 'object' || !input.fingerprint) throw authError('AUTH_HANDOFF_INVALID');
  const valid = validateSession({version:1,device:{account:input.username,fingerprint:input.fingerprint,finger3:input.finger3},session:input}).session!;
  const cookies = JSON.parse(valid.cookiesJson) as {domain:string}[];
  if (!cookies.length || cookies.some(cookie => {
    const domain = cookie.domain.replace(/^\./,'').toLowerCase();
    return domain !== 'tsinghua.edu.cn' && !domain.endsWith('.tsinghua.edu.cn');
  })) throw authError('AUTH_HANDOFF_COOKIE_SCOPE');
  return valid;
}
export async function openSessionStorage(dataDir: string, timeoutMs = 5000) {
  if (!path.isAbsolute(dataDir) || dataDir.split(/[\\/]/).includes('..')) throw authError('AUTH_STORAGE_UNSAFE_PATH');
  const root = path.resolve(dataDir);
  await mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  // Ancestors may be OS aliases (macOS /tmp), but the owned directory itself
  // must be a real directory and all accesses remain inside its canonical path.
  try { await mkdir(root, { mode: 0o700 }); await privateMode(root, true); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  await checkFile(root, true);
  if (process.platform === 'win32') await privateMode(root, true);
  const canonical = await realpath(root);
  const lock = path.join(canonical, '.session.lock');
  const nonce = randomBytes(16).toString('hex');
  const started = Date.now();
  while (true) {
    let created = false;
    try {
      await mkdir(lock, { mode: 0o700 }); created = true; await privateMode(lock, true);
      const owner = await open(path.join(lock, 'owner.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      try { await owner.writeFile(JSON.stringify({ pid: process.pid, nonce })); await owner.sync(); } finally { await owner.close(); }
      break;
    } catch (e) {
      if (created) { await unlink(path.join(lock,'owner.json')).catch(()=>undefined);await rmdir(lock).catch(()=>undefined);throw e; }
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      await checkFile(lock, true);
      try {
        await checkFile(path.join(lock, 'owner.json'));
        const handle = await open(path.join(lock, 'owner.json'), constants.O_RDONLY | noFollow);
        let owner: {pid?: unknown; nonce?: unknown};
        try { owner = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
        if (Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0 && typeof owner.nonce === 'string') {
          let dead = false;
          try { process.kill(Number(owner.pid), 0); } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
          if (dead) {
            // Serialize stale-owner recovery, then re-read the nonce under this
            // gate. Two contenders must never unlink a newly acquired lock.
            const recovery=path.join(canonical,'.session.recovery');let acquired=false,reclaimed=false;
            try {
              try { await mkdir(recovery,{mode:0o700});acquired=true; }
              catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
              if(acquired){
                await checkFile(path.join(lock,'owner.json'));
                const again=await open(path.join(lock,'owner.json'),constants.O_RDONLY|noFollow);
                let current:{pid?:unknown;nonce?:unknown};try{current=JSON.parse(await again.readFile('utf8'));}finally{await again.close();}
                if(current.pid===owner.pid&&current.nonce===owner.nonce&&(await readdir(lock)).every(name=>name==='owner.json')){
                  await unlink(path.join(lock,'owner.json'));await rmdir(lock);reclaimed=true;
                }
              }
            }finally{if(acquired)await rmdir(recovery);}
            if(reclaimed)continue;
          }
        }
      } catch (error) { if (!isMissing(error) && !(error instanceof SyntaxError)) throw error; }
      if (Date.now() - started >= timeoutMs) throw authError('AUTH_SESSION_BUSY');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  let closed = false;
  const file = path.join(canonical, 'session.json');
  let writes: Promise<void> = Promise.resolve();
  async function load(): Promise<StoredSession | null> {
    if (closed) throw authError('AUTH_SESSION_CLOSED');
    try {
      await checkFile(file); const handle = await open(file, constants.O_RDONLY | noFollow);
      try { if ((await handle.stat()).size > 5_000_000) throw authError('AUTH_STORAGE_INVALID'); return validateSession(JSON.parse(await handle.readFile('utf8'))); }
      finally { await handle.close(); }
    } catch (error) { if (isMissing(error)) return null; throw error; }
  }
  async function save(value: StoredSession): Promise<void> {
    if (closed) throw authError('AUTH_SESSION_CLOSED');
    const safe = validateSession(value);
    const operation = writes.catch(() => undefined).then(async () => {
      await checkFile(canonical, true);
      try { await checkFile(file); } catch (e) { if (!isMissing(e)) throw e; }
      const temporary = path.join(canonical, `.session-${nonce}-${randomBytes(6).toString('hex')}.tmp`);
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
      try {
        try { await privateMode(temporary, false); await handle.writeFile(JSON.stringify(safe)); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, file);
      } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
    });
    writes = operation; await operation;
  }
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    try { await writes; } finally {
      await checkFile(lock, true);
      const handle = await open(path.join(lock, 'owner.json'), constants.O_RDONLY | noFollow);
      let owner: {nonce?: string}; try { owner = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
      if (owner.nonce !== nonce) throw authError('AUTH_LOCK_OWNERSHIP_CHANGED');
      await unlink(path.join(lock, 'owner.json')); await rmdir(lock);
    }
  }
  return { load, save, close, directory: canonical };
}
