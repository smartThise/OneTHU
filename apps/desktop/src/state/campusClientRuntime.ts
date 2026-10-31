/** GUI-owned service renewal for an explicitly enabled local system gateway.
 * The queue carries service enums only; no password leaves this GUI runtime. */
import { session } from '../lib/clients.js';
import { usesSharedRuntime, sharedAccountGuard } from '../lib/sharedRuntime.js';
let started=false, busy=false;
let available=false, checkedAt=0;
export function initCampusClientRuntime(){
  if(started)return;started=true;
  const poll=async()=>{
    if(busy||!usesSharedRuntime()||session.state!=='ready'||!session.username)return;
    busy=true;
    try{
      const guard=await sharedAccountGuard(session.username);
      const {invoke}=await import('@tauri-apps/api/core');
      const call=<T>(action:string,extra:Record<string,unknown>={})=>invoke<T>('cli_daemon_request',{method:'gateway.control',params:{action,confirm:true,...guard,...extra}});
      if(Date.now()-checkedAt>30000){
        const status=await call<{capabilities?:{trustedMiniPrograms?:boolean}}>('status');
        available=status.capabilities?.trustedMiniPrograms===true;checkedAt=Date.now();
      }
      if(!available)return;
      const row=await call<{id:string;service:'xiaoda'|'visit'}|null>('client-pending');
      if(!row)return;
      let ok=false,official:unknown;
      try{
        if(session.username!==guard.expectedAccount||session.state!=='ready')return;
        if(row.service==='xiaoda')official=await (await import('../lib/xiaoda.js')).xiaodaGatewayTicket();
        else if(row.service==='visit')official=await (await import('../lib/visit.js')).visitGatewayTicket();
        else return;
        ok=session.username===guard.expectedAccount&&session.state==='ready';
      }finally{await call('client-complete',{id:row.id,ok,...(ok?{official}:{})});}
    }catch{/* A stopped/older gateway or genuine school challenge remains explicit to its caller. */}
    finally{busy=false;}
  };
  window.setInterval(()=>void poll(),2500);
}
