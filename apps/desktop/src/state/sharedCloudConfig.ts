/** Share an explicitly authorized cloud connection with the optional resident
 * service. Secrets only cross the private main-window bridge. */
import { session } from '../lib/clients.js';
import { sharedAccountGuard, sharedRuntimeRequest, sharedRuntimeSnapshot, subscribeSharedRuntime, usesSharedRuntime } from '../lib/sharedRuntime.js';
import { ensureSeafileLoaded, getSeafileAccount, getSeafileToken, subscribeSeafile } from './seafile.js';
import { cloudAuthorized, ohAuthorized, subscribePrivacy } from './privacyConsent.js';
let running:Promise<void>|undefined,pending=false,completed='';
export function syncSharedCloudConfig():Promise<void>{
 if(running){pending=true;return running;}
 const work=async()=>{
  if(!usesSharedRuntime()||session.state!=='ready'||!session.username)return;
  const owner=session.username;await ensureSeafileLoaded();
  const token=getSeafileToken(),account=getSeafileAccount();
  // A not-yet-verified account is pending, rather than an instruction to revoke.
  if(cloudAuthorized()&&ohAuthorized()&&token&&!account?.email)return;
  const allowed=cloudAuthorized()&&ohAuthorized();
  const config=cloudAuthorized()&&ohAuthorized()&&token&&account?.email?{token,email:account.email}:null;
  const snapshot=sharedRuntimeSnapshot();
  const signature=JSON.stringify([owner,snapshot?.epoch,config]);
  if(completed===signature)return;
  const guard=await sharedAccountGuard(owner);
  if(allowed!==(cloudAuthorized()&&ohAuthorized())||token!==getSeafileToken()||account?.email!==getSeafileAccount()?.email){pending=true;return;}
  if(session.username!==owner)throw new Error('CLI_SHARED_SESSION_CHANGED');
  const result=await sharedRuntimeRequest<{status:string}>('cloudSync',{...guard,config});
  if(result.status==='conflict')throw new Error('CLI_DATA_CONFIG_CONFLICT');
  completed=signature;
 };
 running=Promise.resolve().then(async()=>{do{pending=false;await work();}while(pending);}).finally(()=>{running=undefined;});return running;
}
const schedule=()=>{void syncSharedCloudConfig().catch(()=>undefined);};
subscribeSeafile(schedule);subscribePrivacy(schedule);subscribeSharedRuntime(schedule);
if(typeof window!=='undefined')window.addEventListener('onethu-cli-installation',schedule);
