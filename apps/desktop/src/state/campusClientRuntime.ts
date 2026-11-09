/** GUI-owned service renewal for an explicitly enabled local system gateway.
 * The queue carries service enums only; no password leaves this GUI runtime. */
import { session, logLine } from '../lib/clients.js';
import { usesSharedRuntime, sharedAccountGuard, exportNativeSessionCookies } from '../lib/sharedRuntime.js';
import { nativeSessionEpoch } from '../lib/transport.js';
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
        const status=await call<{capabilities?:{trustedMiniPrograms?:boolean};allowedOrigins?:string[]}>('status');
        available=status.capabilities?.trustedMiniPrograms===true||status.allowedOrigins?.includes('https://git.tsinghua.edu.cn')===true;
        checkedAt=Date.now();
      }
      if(!available)return;
      const row=await call<{id:string;service:'xiaoda'|'visit'|'gitlab'|'madmodel'|'stu'|'cab'|'discover'|'myhome'|'seat'|'thesis'|'selection';entryMode?:0|1|'default';entryUrl?:string;identityUrl?:string}|null>('client-pending');
      if(!row)return;
      let ok=false;
      let result:Record<string,unknown>={};
      try{
        if(session.username!==guard.expectedAccount||session.state!=='ready')return;
        if(row.entryMode!==undefined&&row.entryMode!==0&&row.entryMode!==1&&row.entryMode!=='default')return;
        if(row.service==='xiaoda')result={official:await (await import('../lib/xiaoda.js')).xiaodaGatewayTicket(row.entryMode??0)};
        else if(row.service==='visit')result={official:await (await import('../lib/visit.js')).visitGatewayTicket(row.entryMode??0)};
        else if(row.service==='madmodel'){
          const ticket=await (await import('./madmodel.js')).madmodelGatewayTicket();
          if(!ticket)return;
          result={madmodelTicket:ticket};
        }else if(row.service==='stu'){
          if(!row.entryUrl)return;
          const callback=await (await import('../lib/stu.js')).stuGatewayCallback(row.entryUrl);
          if(!callback)return;
          result={stuCallback:callback};
        }else if(row.service==='cab'){
          if(!row.entryUrl||!row.identityUrl)return;
          const callback=await (await import('../lib/cab.js')).cabGatewayCallback(row.entryUrl,row.identityUrl);
          if(!callback)return;
          result={cabCallback:callback};
        }else if(row.service==='discover'){
          const {DISCOVER_IDENTITY_URL,normalizeDiscoverCallback}=await import('@onethu/sdk/validation');
          if(row.identityUrl!==DISCOVER_IDENTITY_URL)return;
          const callback=await (await import('../lib/campusServiceAuth.js')).obtainCampusCallback(row.identityUrl,normalizeDiscoverCallback,'discover');
          if(!callback)return;
          result={discoverCallback:callback};
        }else if(row.service==='myhome'){
          const callback=await (await import('../lib/myhome.js')).myhomeGatewayCallback();
          if(!callback)return;
          result={myhomeCallback:callback};
        }else if(row.service==='seat'){
          const callback=await (await import('../lib/seat.js')).seatGatewayCallback();
          if(!callback)return;
          result={seatCallback:callback};
        }else if(row.service==='thesis'){
          const callback=await (await import('../lib/thesis.js')).thesisGatewayCallback();
          if(!callback)return;
          result={thesisCallback:callback};
        }else if(row.service==='selection'){
          await (await import('./data.js')).prepareSelectionGatewaySession();
          result={selectionReady:true};
        }else if(row.service==='gitlab'){
          const revision=await nativeSessionEpoch();
          if(!await (await import('./gitlab.js')).gitlabEnsureSession({forceProbe:true}))return;
          const snapshot=await exportNativeSessionCookies();
          if(snapshot.revision!==revision)return;
          const cookie=snapshot.cookies.find(c=>c.domain==='git.tsinghua.edu.cn'&&c.path==='/'&&c.name==='_gitlab_session'
            &&(c.expiresAt===undefined||c.expiresAt>Date.now()));
          if(!cookie?.value)return;
          result={gitlabCookie:cookie.value};
        }
        else return;
        ok=session.username===guard.expectedAccount&&session.state==='ready';
      }catch(error){
        const value=error as {code?:unknown;reason?:unknown};
        const code=typeof value?.code==='string'&&/^[A-Z][A-Z0-9_]{2,80}$/.test(value.code)?value.code:'RENEWAL_FAILED';
        const reason=typeof value?.reason==='string'&&/^[a-z-]{1,60}$/.test(value.reason)?' '+value.reason:'';
        void logLine('[GATEWAY-RENEW] '+row.service+' '+code+reason).catch(()=>{});
      }finally{await call('client-complete',{id:row.id,ok,...(ok?result:{})});}
    }catch{/* A stopped/older gateway or genuine school challenge remains explicit to its caller. */}
    finally{busy=false;}
  };
  window.setInterval(()=>void poll(),2500);
}
