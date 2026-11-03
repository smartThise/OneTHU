/** Private calendar document adapter. GUI and headless services address the
 * same account-keyed SDK records; there is no second calendar database. */
import { createHash } from 'node:crypto';
import type { RuntimeStore } from './store.js';
import type { NodeSession } from './node/session.js';
import { stable } from './tasks/validation.js';
import { accountKey } from './services/extendedSupport.js';
const MAGIC='onethu-secret-v1:';
function secret(value:string,email:string,decode=false){
  const key=Buffer.from(`OneTHU|${email}|remember`);
  if(decode&&!value.startsWith(MAGIC))throw new Error('APP_DATA_INVALID');
  const bytes=decode?Buffer.from(value.slice(MAGIC.length),'base64'):Buffer.from(value);
  const result=Buffer.from(bytes.map((byte,index)=>byte^key[index%key.length]!));
  return decode?result.toString('utf8'):MAGIC+result.toString('base64');
}
const keys:Record<string,string>={'caldav.local':'calendar','caldav.cfg':'mail','caldav.cache':'calendar-cache'};
export function createAppData(runtime:NodeSession,store:RuntimeStore){
  const key=(name:string)=>{if(!Object.hasOwn(keys,name))throw new Error('APP_DATA_NAME_DENIED');return accountKey(runtime,keys[name]!);};
  async function read(name:string){
    const data=await store.read<any>(key(name),null);
    const value=data===null?null:name==='caldav.local'?{events:data}:name==='caldav.cfg'?{email:data.email,secret:secret(data.authCode,data.email)}:data;
    const content=value===null?null:JSON.stringify(value);
    return {content,revision:createHash('sha256').update(content??'null').digest('hex')};
  }
  function parse(name:string,content:string|null){
    key(name);if(content===null)return null;
    if(typeof content!=='string'||Buffer.byteLength(content)>8*1024*1024)throw new Error('APP_DATA_INVALID');
    const data=JSON.parse(content);
    if(name==='caldav.cfg'){
      if(!data||typeof data.email!=='string'||!/^[^\s@]+@(?:mails\.)?tsinghua\.edu\.cn$/i.test(data.email)||typeof data.secret!=='string')throw new Error('APP_DATA_INVALID');
      const authCode=secret(data.secret,data.email,true);if(!authCode||authCode.length>16384)throw new Error('APP_DATA_INVALID');
      return {email:data.email,authCode};
    }
    if(!data||!Array.isArray(data.events)||data.events.length>20000||data.events.some((event:any)=>!event||typeof event.uid!=='string'||!Number.isFinite(event.start)||!Number.isFinite(event.end)))throw new Error('APP_DATA_INVALID');
    return name==='caldav.local'?data.events:data;
  }
  async function write(name:string,content:string|null,revision:string,beforeWrite:()=>void){
    const data=parse(name,content);const current=await read(name);
    if(current.revision!==revision)throw new Error('APP_DATA_CHANGED');
    beforeWrite();await store.write(key(name),data);beforeWrite();return read(name);
  }
  async function bootstrap(name:string,content:string|null,beforeWrite:()=>void,baseContent?:string|null){
    const marker=accountKey(runtime,'app-data-migrated-'+name);
    const migrated=await store.read(marker,false);
    if(migrated&&baseContent===undefined)return read(name);
    const incoming=parse(name,content),current=await store.read<any>(key(name),null);
    let next=current;
    if(migrated&&baseContent!==undefined){
      const base=parse(name,baseContent);
      const equal=(a:unknown,b:unknown)=>stable(a)===stable(b);
      if(name==='caldav.local'){
        const id=(event:any)=>JSON.stringify([event.uid,event.recurrenceId??null]);
        const original=new Map<string,any>((base??[]).map((event:any)=>[id(event),event]));
        const local=new Map<string,any>((incoming??[]).map((event:any)=>[id(event),event]));
        const merged=new Map<string,any>((current??[]).map((event:any)=>[id(event),event]));
        for(const uid of new Set([...original.keys(),...local.keys()])){
          const before=original.get(uid),after=local.get(uid);if(equal(before,after))continue;
          if(!equal(merged.get(uid),before)&&!equal(merged.get(uid),after))throw new Error('APP_DATA_MIGRATION_CONFLICT');
          if(after===undefined)merged.delete(uid);else merged.set(uid,after);
        }next=[...merged.values()];
      }else if(!equal(incoming,base)){
        if(!equal(current,base)&&!equal(current,incoming)&&name==='caldav.cfg')throw new Error('APP_DATA_MIGRATION_CONFLICT');
        next=incoming;
      }
    }else if(name==='caldav.local'){
      const records=new Map<string,any>();
      for(const event of [...(current??[]),...(incoming??[])]){
        const id=JSON.stringify([event.uid,event.recurrenceId??null]);
        if(records.has(id)&&stable(records.get(id))!==stable(event))throw new Error('APP_DATA_MIGRATION_CONFLICT');
        records.set(id,event);
      }next=[...records.values()];
    }else if(current===null)next=incoming;
    else if(name==='caldav.cfg'&&incoming&&stable(current)!==stable(incoming))throw new Error('APP_DATA_MIGRATION_CONFLICT');
    beforeWrite();if(next!==null||migrated)await store.write(key(name),next);
    beforeWrite();await store.write(marker,true);return read(name);
  }
  return {read,write,bootstrap};
}
