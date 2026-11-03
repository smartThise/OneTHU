/** Account-fenced GUI credential handoff. An independently edited CLI record
 * creates a conflict; a later app refresh cannot silently replace it. */
import type {RuntimeStore} from './store.js';
import type {NodeSession} from './node/session.js';
import {accountKey} from './services/extendedSupport.js';
import {stable} from './tasks/validation.js';
export async function syncCloudConfig(runtime:NodeSession,store:RuntimeStore,config:{email:string;token:string}|null,beforeWrite:()=>void){
 if(config!==null&&(!config||typeof config.email!=='string'||!config.email.includes('@')||config.email.length>254||typeof config.token!=='string'||!config.token||config.token.length>16384||/[\x00-\x1f]/.test(config.token)))throw new Error('CLOUD_CONFIG_INVALID');
 const name=accountKey(runtime,'cloud'),ledger=accountKey(runtime,'desktop-cloud-origin');
 const current=await store.read<any>(name,null),previous=await store.read<any>(ledger,null);
 beforeWrite();
 if(current&&stable(current)!==stable(previous)&&stable(current)!==stable(config))return {status:'conflict'};
 await store.write(name,config);beforeWrite();await store.write(ledger,config);beforeWrite();
 return {status:config?'synced':'disconnected'};
}
