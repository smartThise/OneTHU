import {constants} from 'node:fs';
import {open,lstat,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {GatewayError} from './policy.mjs';

const fail=()=>{throw new GatewayError('GATEWAY_ENDPOINT_HINTS_INVALID',500);};
const port=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
export function validateEndpointHints(value){
  if(!value||value.version!==1||!value.services||typeof value.services!=='object'||Array.isArray(value.services)||Object.keys(value.services).length>64)fail();
  const validate=hint=>{if(!hint||!port(hint.proxyPort)||!port(hint.pacPort)||hint.proxyPort===hint.pacPort||typeof hint.pacPath!=='string'||!/^\/campus-[a-f0-9]{36}\.pac$/.test(hint.pacPath))fail();};
  if(value.manual!==undefined)validate(value.manual);
  for(const [name,hint]of Object.entries(value.services)){if(!name||name.length>256||/[\x00-\x1f\x7f]/.test(name))fail();validate(hint);}
  return value;
}
function privateFile(stat){return stat.isFile()&&stat.nlink===1&&stat.size<=65536&&(process.platform==='win32'||stat.uid===process.getuid()&&!(stat.mode&0o077));}
export async function readEndpointHints(directory){
  let file;
  try{
    const path=join(directory,'endpoint-hints.json');
    if((await lstat(path)).isSymbolicLink())fail();
    file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));if(!privateFile(await file.stat()))fail();
    let value;try{value=JSON.parse(await file.readFile('utf8'));}catch{fail();}return validateEndpointHints(value);
  }catch(error){if(error.code==='ENOENT')return {version:1,services:{}};throw error;}
  finally{await file?.close();}
}
export async function writeEndpointHints(directory,value){
  validateEndpointHints(value);const bytes=JSON.stringify(value)+'\n';if(Buffer.byteLength(bytes)>65536)fail();
  const target=join(directory,'endpoint-hints.json'),temporary=target+'.'+randomBytes(8).toString('hex');let file;
  try{
    try{const stat=await lstat(target);if(stat.isSymbolicLink()||!privateFile(stat))fail();}catch(error){if(error.code!=='ENOENT')throw error;}
    file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
    await file.writeFile(bytes);await file.sync();await file.close();file=undefined;await rename(temporary,target);
  }finally{await file?.close();await unlink(temporary).catch(()=>{});}
}
