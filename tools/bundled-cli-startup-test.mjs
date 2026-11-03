/** Start the packaged Node/CLI in a fresh private profile, never a real account. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,chmod,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {DaemonClient} from '../packages/cli/src/daemon.mjs';
const source=path.resolve(process.argv[2]??'apps/desktop/src-tauri/resources/cli-runtime');
const manifest=JSON.parse(await readFile(path.join(source,'runtime.json'),'utf8'));
assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);
const temp=await mkdtemp(path.join(tmpdir(),'onethu-bundled-startup-'));
const runtime=path.join(temp,'runtime'),profile=path.join(temp,'profile');
const hash=b=>createHash('sha256').update(b).digest('hex');
let child,closed,log;
try {
  await mkdir(runtime,{mode:0o700});await mkdir(profile,{mode:0o700});
  for(const [name,digest] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(name)&&!name.split(/[\\/]/).includes('..'));
    const body=await readFile(path.join(source,name));assert.equal(hash(body),digest,name);
    const target=path.join(runtime,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,body);
  }
  await writeFile(path.join(runtime,'runtime.json'),JSON.stringify(manifest));
  const node=path.join(runtime,process.platform==='win32'?'node.exe':'node');
  if(manifest.files.onethu){
    await chmod(path.join(runtime,'onethu'),0o755);
    const output=process.platform==='win32'
      ?execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(runtime,'onethu.ps1'),'--version'],{encoding:'utf8'})
      :execFileSync(path.join(runtime,'onethu'),['--version'],{encoding:'utf8'});
    assert.equal(output.trim(),manifest.version,'standalone launcher extracts and verifies its own Node runtime');
    assert.equal(hash(await readFile(node)),manifest.nodeSha256);
  }

  const nodeBytes=gunzipSync(await readFile(path.join(runtime,'node.gz')));
  assert.equal(hash(nodeBytes),manifest.nodeSha256);await writeFile(node,nodeBytes);await chmod(node,0o755);
  log=await open(path.join(profile,'startup.log'),'w',0o600);
  const env={...process.env,ONETHU_CLI_RUNTIME_ID:manifest.buildId};
  for(const key of ['NODE_OPTIONS','NODE_PATH','ONETHU_ENDPOINT'])delete env[key];
  child=spawn(node,[path.join(runtime,'bin/onethu.mjs'),'daemon','serve','--data-dir',profile],{cwd:runtime,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','ignore',log.fd]});
  closed=once(child,'close');let record;
  for(let i=0;i<150;i++) {
    if(child.exitCode!==null)throw Error('Packaged CLI exited before discovery');
    try {record=JSON.parse(await readFile(path.join(profile,'daemon-access.json'),'utf8'));break;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(record,'Packaged runtime publishes discovery in 15 seconds');
  const client=new DaemonClient(record,5000);
  const status=await client.call('daemon.status');
  assert.equal(status.version,manifest.version);assert.equal(status.runtimeId,manifest.buildId);assert.equal(status.desktopProtocolVersion,1);
  const exported=await client.call('desktop.exportSession');
  assert.equal(exported.snapshot,null);assert.equal(exported.username,null);
  await client.call('daemon.stop');
  await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Packaged CLI did not stop')),10000).unref())]);
  assert.equal(child.exitCode,0);
  console.log('✓ packaged '+manifest.platform+'/'+manifest.arch+' '+manifest.version+': verified files, detached startup, private export, graceful exit');
} finally {
  if(child&&child.exitCode===null){child.kill();await closed.catch(()=>{});}
  await log?.close();await rm(temp,{recursive:true,force:true});
}
