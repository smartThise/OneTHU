import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,symlink,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {readEndpointHints,writeEndpointHints,validateEndpointHints} from '../src/endpointHints.mjs';
const hint={proxyPort:41001,pacPort:41002,pacPath:'/campus-'+'a'.repeat(36)+'.pac'};
test('endpoint hints retain only bounded loopback port/path data and use a private atomic file',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'onethu-hints-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 assert.deepEqual(await readEndpointHints(dir),{version:1,services:{}});
 await writeEndpointHints(dir,{version:1,manual:hint,services:{'Wi-Fi':hint}});
 assert.deepEqual((await readEndpointHints(dir)).services['Wi-Fi'],hint);
 if(process.platform!=='win32')assert.equal((await stat(join(dir,'endpoint-hints.json'))).mode&0o077,0);
 for(const bad of [{...hint,proxyPort:22},{...hint,pacPath:'/arbitrary-path'},{...hint,pacPort:hint.proxyPort}])assert.throws(()=>validateEndpointHints({version:1,services:{'Wi-Fi':bad}}));
});
test('an endpoint cache symlink cannot redirect reads or overwrite another file',async t=>{
 if(process.platform==='win32')return t.skip('symlink permission depends on Windows developer mode');
 const dir=await mkdtemp(join(tmpdir(),'onethu-hints-link-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const target=join(dir,'other');await writeFile(target,'preserved',{mode:0o600});await symlink(target,join(dir,'endpoint-hints.json'));
 await assert.rejects(readEndpointHints(dir),{code:'GATEWAY_ENDPOINT_HINTS_INVALID'});
 await assert.rejects(writeEndpointHints(dir,{version:1,services:{'Wi-Fi':hint}}),{code:'GATEWAY_ENDPOINT_HINTS_INVALID'});
});

test('resume intent stores a bounded mode and an account digest without credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'onethu-hints-resume-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const resume={mode:'system',account:'a'.repeat(64)};
 await writeEndpointHints(dir,{version:1,services:{},resume});
 assert.deepEqual((await readEndpointHints(dir)).resume,resume);
 for(const invalid of [null,[],{}, {mode:'auto',account:'a'.repeat(64)}, {mode:'manual',account:'username'},
   {mode:'system',account:'A'.repeat(64)}, {...resume,password:'secret'}]){
  assert.throws(()=>validateEndpointHints({version:1,services:{},resume:invalid}),{code:'GATEWAY_ENDPOINT_HINTS_INVALID'});
 }
});
