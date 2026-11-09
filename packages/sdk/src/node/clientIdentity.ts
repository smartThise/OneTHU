/** Private, bounded GUI renewal broker. Never appears in MCP/agent catalogs. */
import { randomBytes } from 'node:crypto';
import { load } from 'cheerio';
import { GatewayError } from '@onethu/gateway/policy';
import type { NodeSession } from './session.js';
import {campusDirectFetch} from './campusDirect.js';
import {parseStuAuthEntry,validStuCallback} from '@onethu/gateway/stu-auth';
import {parseCabIdentity,normalizeCabCallback} from '@onethu/gateway/cab-auth';
import {DISCOVER_IDENTITY_URL,normalizeDiscoverCallback} from '@onethu/gateway/discover-auth';
import {MYHOME_IDENTITY_URL,normalizeMyhomeCallback} from '@onethu/gateway/myhome-auth';
import {SEAT_IDENTITY_URL,normalizeSeatCallback} from '@onethu/gateway/seat-auth';
import {THESIS_IDENTITY_URL,normalizeThesisCallback} from '@onethu/gateway/thesis-auth';

type MiniProgram = 'xiaoda'|'visit';
type Service = MiniProgram|'gitlab'|'madmodel'|'stu'|'cab'|'discover'|'myhome'|'seat'|'thesis'|'selection';
type Official = {ticket:string;html:string;url:string;status:number};
type Renewal = Official | {gitlabCookie:string} | {madmodelTicket:string} | {stuCallback:string} | {cabCallback:string} | {discoverCallback:string} | {myhomeCallback:string} | {seatCallback:string} | {thesisCallback:string} | {selectionReady:true};
type Runtime = Pick<NodeSession,'epoch'|'assertCurrent'|'status'|'session'|'fetchCampusDirect'>;
const fail = (code:string):never => { throw new GatewayError(code, 401); };

function validateOfficial(value:unknown,service:MiniProgram):Official {
  const v=value as Official;
  if(!v||typeof v.ticket!=='string'||!/^[A-Za-z0-9._~-]{16,512}$/.test(v.ticket)||typeof v.html!=='string'||v.html.length>256*1024||typeof v.url!=='string'||v.url.length>8192||!Number.isInteger(v.status)||v.status<200||v.status>399)throw new Error('CLI_BRIDGE_INVALID');
  const origin=service==='xiaoda'?'https://www.xiaoda.tsinghua.edu.cn':'https://visit.tsinghua.edu.cn';
  const matches=(input:string)=>{try{const url=new URL(input,origin);return url.origin===origin&&!url.username&&!url.password&&!url.hash&&['ticket','code'].some(key=>url.searchParams.get(key)===v.ticket);}catch{return false;}};
  const $=load(v.html);let witnessed=matches(v.url);
  $('a[href]').each((_i,node)=>{if(matches($(node).attr('href')!))witnessed=true;});
  if(!witnessed||$('input[name=i_pass],input[type=password]').length)throw new Error('CLI_BRIDGE_INVALID');
  return {ticket:v.ticket,html:v.html,url:v.url,status:v.status};
}
function officialResponse(official:Official,service:MiniProgram){
  // Native fetch may already have followed the official HTTP redirect. Restore
  // its ticket-bearing anchor for clients that consume ITS HTML, without
  // redeeming the one-use ticket or inventing an authentication credential.
  const callback=service==='xiaoda'?'https://www.xiaoda.tsinghua.edu.cn/login.html':'https://visit.tsinghua.edu.cn/visitor/mobile/sso';
  const href=callback+'?ticket='+encodeURIComponent(official.ticket);
  const html='<!doctype html><meta charset="utf-8"><p>登录成功。正在重定向到 <a href="'+href+'">Continue</a></p>';
  return new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'origin','refresh':'0; url='+href,
    'content-security-policy':"default-src 'none'; base-uri 'none'; form-action 'none'",'x-content-type-options':'nosniff'}});
}

export function createClientIdentity(runtime:Runtime, {unborrowedFetch=campusDirectFetch}: {unborrowedFetch?:typeof globalThis.fetch} = {}) {
  const unborrowedResponses=new WeakSet<Response>();
  type Pending = {id:string;service:Service;entryMode:0|1|'default';entryUrl?:string;identityUrl?:string;exclusive:boolean;retryKey:string;epoch:number;owner:string;expires:number;claimed:boolean;waiters:number;finish:(result:Renewal|null)=>void;promise:Promise<Renewal|null>};
  const pending = new Map<string,Pending>(), retryAt = new Map<string,number>();
  const results=new Map<Service,{epoch:number;owner:string;state:'renewed'|'sign-in-required';updatedAt:number}>();
  function fence(epoch:number,owner:string) {runtime.assertCurrent(epoch);if(!owner||runtime.session.username!==owner||!runtime.status().authenticated)fail('GATEWAY_SESSION_CHANGED');}
  function prune(){for(const [service,row] of pending)if(Date.now()>row.expires||row.epoch!==runtime.epoch()||row.owner!==runtime.session.username){pending.delete(service);row.finish(null);}}
  function renew(service:Service,epoch:number,owner:string,signal?:AbortSignal,entryMode:0|1|'default'=0,entryUrl?:string,identityUrl?:string,uniqueTicket=false) {
    prune();fence(epoch,owner);const key=`${epoch}:${service}:${entryMode}${uniqueTicket?':web':''}`;
    if(signal?.aborted)return Promise.reject(new GatewayError('GATEWAY_CANCELLED',499));
    if((retryAt.get(key)??0)>Date.now())return Promise.resolve(null);
    if(service==='stu'&&(!entryUrl||!parseStuAuthEntry(entryUrl)))throw new Error('CLI_BRIDGE_INVALID');
    if(service==='cab'&&(!entryUrl||!identityUrl||!parseCabIdentity(entryUrl,identityUrl)))throw new Error('CLI_BRIDGE_INVALID');
    if(service==='discover'&&identityUrl!==DISCOVER_IDENTITY_URL)throw new Error('CLI_BRIDGE_INVALID');
    if(service==='myhome'&&identityUrl!==MYHOME_IDENTITY_URL)throw new Error('CLI_BRIDGE_INVALID');
    if(service==='seat'&&identityUrl!==SEAT_IDENTITY_URL)throw new Error('CLI_BRIDGE_INVALID');
    if(service==='thesis'&&identityUrl!==THESIS_IDENTITY_URL)throw new Error('CLI_BRIDGE_INVALID');
    const independent=uniqueTicket||['stu','cab','discover','myhome','seat','thesis'].includes(service);
    // Every OAuth entry owns its ticket, including simultaneous tabs whose
    // state or PKCE values differ. Never coalesce these by service name.
    const pendingKey=independent?randomBytes(24).toString('hex'):service;
    let row=pending.get(pendingKey);
    if(row&&row.entryMode!==entryMode)return Promise.resolve(null);
    if(!row){
      if(pending.size>=16)throw new Error('CLI_BRIDGE_BUSY');
      let finish!:(result:Renewal|null)=>void;const promise=new Promise<Renewal|null>(resolve=>{finish=resolve;});
      row={id:randomBytes(24).toString('hex'),service,entryMode,entryUrl,identityUrl,exclusive:independent,retryKey:key,epoch,owner,expires:Date.now()+18000,claimed:false,waiters:0,finish,promise};
      pending.set(pendingKey,row);const current=row;
      const timer=setTimeout(()=>{if(pending.get(pendingKey)===current){pending.delete(pendingKey);retryAt.set(key,Date.now()+60000);current.finish(null);}},18000);timer.unref();
      void promise.finally(()=>clearTimeout(timer));
    }
    return new Promise<Renewal|null>((resolve,reject)=>{
      row.waiters++;
      let settled=false;
      const release=()=>{
        if(settled)return false;
        settled=true;
        row.waiters--;
        signal?.removeEventListener('abort',abort);
        return true;
      };
      const abort=()=>{
        if(!release())return;
        if((independent||service==='selection'&&row.waiters===0)&&pending.get(pendingKey)===row){
          pending.delete(pendingKey);
          row.finish(null);
        }
        reject(new GatewayError('GATEWAY_CANCELLED',499));
      };
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      void row.promise.then(ok=>{if(release())resolve(ok);});
    });
  }
  const desktop={
    status(){prune();return (['xiaoda','visit','gitlab','madmodel','stu','cab','discover','myhome','seat','thesis','selection'] as const).map(service=>{
      const row=[...pending.values()].find(row=>row.service===service),result=results.get(service);
      return {service,state:row?(row.claimed?'renewing':'queued'):result&&result.epoch===runtime.epoch()&&result.owner===runtime.session.username?result.state:'idle',
        ...(result&&result.epoch===runtime.epoch()&&result.owner===runtime.session.username?{updatedAt:result.updatedAt}:{})};
    });},
    prepare(service:Service='xiaoda'){
      if(!['xiaoda','visit','selection'].includes(service))throw new Error('CLI_BRIDGE_INVALID');
      const epoch=runtime.epoch(),owner=runtime.session.username;fence(epoch,owner);
      void renew(service,epoch,owner).catch(()=>undefined);return {queued:pending.has(service)};
    },
    pending(){prune();const row=[...pending.values()].find(row=>!row.claimed);if(!row)return null;row.claimed=true;return {id:row.id,service:row.service,entryMode:row.entryMode,...(row.entryUrl?{entryUrl:row.entryUrl}:{}),...(row.identityUrl?{identityUrl:row.identityUrl}:{})};},
    complete(input:{id:string;ok:boolean;official?:Official;gitlabCookie?:string;madmodelTicket?:string;stuCallback?:string;cabCallback?:string;discoverCallback?:string;myhomeCallback?:string;seatCallback?:string;thesisCallback?:string;selectionReady?:boolean}){
      prune();if(!input||typeof input.id!=='string'||typeof input.ok!=='boolean')throw new Error('CLI_BRIDGE_INVALID');
      const row=[...pending.values()].find(row=>row.id===input.id&&row.claimed);if(!row)return {accepted:false};
      fence(row.epoch,row.owner);
      let result:Renewal|null=null;
      if(input.ok){
        if(row.service==='selection'){
          if(input.selectionReady!==true)throw new Error('CLI_BRIDGE_INVALID');
          result={selectionReady:true};
        }else if(row.service==='gitlab'){
          const value=input.gitlabCookie;
          if(typeof value!=='string'||value.length>4096||!/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]+$/.test(value))throw new Error('CLI_BRIDGE_INVALID');
          result={gitlabCookie:value};
        }else if(row.service==='madmodel'){
          const ticket=input.madmodelTicket;
          if(typeof ticket!=='string'||!/^[A-Za-z0-9._~+/=-]{16,4096}$/.test(ticket))throw new Error('CLI_BRIDGE_INVALID');
          result={madmodelTicket:ticket};
        }else if(row.service==='stu'){
          if(typeof input.stuCallback!=='string'||!row.entryUrl||!validStuCallback(input.stuCallback,row.entryUrl))throw new Error('CLI_BRIDGE_INVALID');
          result={stuCallback:input.stuCallback};
        }else if(row.service==='cab'){
          if(typeof input.cabCallback!=='string'||!row.entryUrl||!row.identityUrl||normalizeCabCallback(input.cabCallback,row.entryUrl,row.identityUrl)!==input.cabCallback)throw new Error('CLI_BRIDGE_INVALID');
          result={cabCallback:input.cabCallback};
        }else if(row.service==='discover'){
          if(typeof input.discoverCallback!=='string'||normalizeDiscoverCallback(input.discoverCallback)!==input.discoverCallback)throw new Error('CLI_BRIDGE_INVALID');
          result={discoverCallback:input.discoverCallback};
        }else if(row.service==='myhome'){
          if(typeof input.myhomeCallback!=='string'||normalizeMyhomeCallback(input.myhomeCallback)!==input.myhomeCallback)throw new Error('CLI_BRIDGE_INVALID');
          result={myhomeCallback:input.myhomeCallback};
        }else if(row.service==='seat'){
          if(typeof input.seatCallback!=='string'||normalizeSeatCallback(input.seatCallback)!==input.seatCallback)throw new Error('CLI_BRIDGE_INVALID');
          result={seatCallback:input.seatCallback};
        }else if(row.service==='thesis'){
          if(typeof input.thesisCallback!=='string'||normalizeThesisCallback(input.thesisCallback)!==input.thesisCallback)throw new Error('CLI_BRIDGE_INVALID');
          result={thesisCallback:input.thesisCallback};
        }else result=validateOfficial(input.official,row.service);
      }
      for(const [key,value] of pending)if(value===row)pending.delete(key);
      retryAt.set(row.retryKey,Date.now()+(input.ok?(row.exclusive||row.service==='madmodel'?0:5000):60000));
      results.set(row.service,{epoch:row.epoch,owner:row.owner,state:input.ok?'renewed':'sign-in-required',updatedAt:Date.now()});row.finish(result);return {accepted:true};
    },
  };
  async function request(url:string,init:RequestInit,context:{service:MiniProgram;identity:boolean}) {
    const epoch=runtime.epoch(),owner=runtime.session.username;fence(epoch,owner);
    const target=new URL(url),check=()=>{init.signal?.throwIfAborted();fence(epoch,owner);};
    if(!context.identity){
      if(!(context.service==='xiaoda'&&target.origin==='https://www.xiaoda.tsinghua.edu.cn'||context.service==='visit'&&target.origin==='https://visit.tsinghua.edu.cn'))fail('GATEWAY_CLIENT_REQUEST_REJECTED');
      check();const response=await runtime.fetchCampusDirect(url,{...init,redirect:'manual'});check();return response;
    }
    const serviceId=context.service==='xiaoda'?'d982b795884e882abfa8ff3167aeb03e':'04655f71b042b9d2d8d10cd566bd9c39';
    const formPath=/^\/do\/off\/ui\/auth\/login\/form\/{1,2}([0-9a-fA-F]{30,32})(?:\/([01]))?\/?$/.exec(target.pathname);
    if(!formPath)throw new GatewayError('GATEWAY_CLIENT_REQUEST_REJECTED',403);
    if(target.origin!=='https://id.tsinghua.edu.cn'||formPath[1]!.toLowerCase()!==serviceId||!['GET','HEAD'].includes(init.method??'GET')||init.body)fail('GATEWAY_CLIENT_REQUEST_REJECTED');
    const entryMode=formPath[2]===undefined?'default':Number(formPath[2]) as 0|1;
    // Request only this registered service. Redirects stay visible to the
    // official client, which exchanges the school's real ticket itself.
    const get=async()=>{check();const response=await runtime.fetchCampusDirect(url,{method:'GET',signal:init.signal,redirect:'manual'});check();return response;};
    let response=await get();
    if(response.status===200){
      let html=await response.text();check();if(html.length>256*1024)fail('GATEWAY_UPSTREAM_INVALID');
      if(/sm2publicKey|i_pass\b/i.test(html)){
        const official=await renew(context.service,epoch,owner,init.signal??undefined,entryMode);check();
        if(!official||!('ticket' in official))return passthrough(url,init);
        return officialResponse(official,context.service);
      }
      const $=load(html),forms=$('form').filter((_i,form)=>$(form).attr('action')?.includes('checkSingle')??false);
      if(forms.length===1){
        const form=forms.first(),action=new URL(form.attr('action')!,target.origin);
        if(action.href!=='https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle')fail('GATEWAY_CLIENT_REQUEST_REJECTED');
        const data=new URLSearchParams();
        form.find('input[type=hidden][name]').each((_i,node)=>{const name=$(node).attr('name')!;if(!/pass|singleLogin|deviceName|finger/i.test(name))data.set(name,$(node).attr('value')??'');});
        data.set('i_rememberme','on');data.set('fingerPrint',runtime.session.fingerprint);
        data.set('fingerGenPrint',runtime.session.finger3??'');data.set('fingerGenPrint3',runtime.session.finger3??'');
        check();response=await runtime.fetchCampusDirect(action.href,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:data.toString(),signal:init.signal,redirect:'manual'});check();return response;
      }
      return new Response(html,{status:response.status,headers:response.headers});
    }
    return response;
  }
  async function passthrough(url:string,init:RequestInit){
    const target=new URL(url);
    if(!['https://id.tsinghua.edu.cn','https://www.xiaoda.tsinghua.edu.cn','https://visit.tsinghua.edu.cn'].includes(target.origin)||target.username||target.password||target.hash)fail('GATEWAY_CLIENT_REQUEST_REJECTED');
    // Raw HTTPS has no jar and follows no redirect: native Cookie/Set-Cookie
    // stay paired with that client's own official identity transaction.
    const response=await unborrowedFetch(url,{...init,redirect:'manual'});unborrowedResponses.add(response);return response;
  }
  async function renewXiaoda(signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    // Website popups and mini-programs must each receive an independently
    // issued ticket, even when their requests overlap on the same account.
    const result=await renew('xiaoda',epoch,owner,signal,0,undefined,undefined,true);
    fence(epoch,owner);
    return result&&'ticket' in result?result.ticket:null;
  }
  async function renewGitlab(){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('gitlab',epoch,owner);
    fence(epoch,owner);
    return result&&'gitlabCookie' in result?result.gitlabCookie:null;
  }
  async function renewSelection(signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('selection',epoch,owner,signal);
    fence(epoch,owner);
    return result!==null&&'selectionReady' in result&&result.selectionReady===true;
  }
  async function renewMadmodel(){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('madmodel',epoch,owner);
    fence(epoch,owner);
    return result&&'madmodelTicket' in result?result.madmodelTicket:null;
  }
  async function renewStu(entry:string,signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('stu',epoch,owner,signal,0,entry);
    fence(epoch,owner);
    return result&&'stuCallback' in result?result.stuCallback:null;
  }
  async function renewCab(entry:string,identityUrl:string,signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('cab',epoch,owner,signal,0,entry,identityUrl);
    fence(epoch,owner);
    return result&&'cabCallback' in result?result.cabCallback:null;
  }
  async function renewDiscover(identityUrl:string,signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('discover',epoch,owner,signal,0,undefined,identityUrl);
    fence(epoch,owner);
    return result&&'discoverCallback' in result?result.discoverCallback:null;
  }
  async function renewMyhome(signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('myhome',epoch,owner,signal,0,undefined,MYHOME_IDENTITY_URL);
    fence(epoch,owner);
    return result&&'myhomeCallback' in result?result.myhomeCallback:null;
  }
  async function renewSeat(signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('seat',epoch,owner,signal,0,undefined,SEAT_IDENTITY_URL);
    fence(epoch,owner);
    return result&&'seatCallback' in result?result.seatCallback:null;
  }
  async function renewThesis(signal?:AbortSignal){
    const epoch=runtime.epoch(),owner=runtime.session.username;
    const result=await renew('thesis',epoch,owner,signal,0,undefined,THESIS_IDENTITY_URL);
    fence(epoch,owner);
    return result&&'thesisCallback' in result?result.thesisCallback:null;
  }
  return {request,passthrough,renewXiaoda,renewGitlab,renewSelection,renewMadmodel,renewStu,renewCab,renewDiscover,renewMyhome,renewSeat,renewThesis,isUnborrowed:(response:Response)=>unborrowedResponses.has(response),desktop,close(){for(const row of pending.values())row.finish(null);pending.clear();retryAt.clear();results.clear();}};
}
