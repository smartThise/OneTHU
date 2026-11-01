/** In-process bridge for info-lib's existing SM2 and 2FA flow. No password persistence. */
import type { InfoHelper } from '@onethu/info-lib';
import { formatTrustDeviceName } from '@onethu/core';
import { authError } from '../node/storage.js';
export type TwoFactorType = 'wechat'|'mobile'|'totp';
export type AuthMethod = {type:TwoFactorType; detail?:string};
export type AuthResult = {state:'ready'}|{state:'need-2fa';methods:AuthMethod[];codeReady:boolean};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
export function createAuthFlow(options:{helper:InfoHelper;trustDeviceName?:()=>string|Promise<string>;prepare:(username:string,password:string)=>Promise<void>;ready:()=>Promise<void>;failed:()=>void;cancel:()=>void;resend:(type:TwoFactorType)=>Promise<void>}) {
  const {helper}=options;
  let entry:{username:string;password:string;methods:AuthMethod[];selected?:TwoFactorType;trust:boolean;lastSent:number;p:Promise<void>;method:ReturnType<typeof deferred<TwoFactorType>>;code:ReturnType<typeof deferred<string>>;methodsReady:ReturnType<typeof deferred<void>>;codeReady:ReturnType<typeof deferred<void>>;settled:boolean}|null=null;
  helper.twoFactorMethodHook=async(wechat,phone,totp)=>{
    if(!entry||entry.settled)throw authError('AUTH_INTERACTION_REQUIRED');
    entry.methods=[...(wechat?[{type:'wechat' as const}]:[]),...(phone?[{type:'mobile' as const,detail:'***'+String(phone).slice(-4)}]:[]),...(totp?[{type:'totp' as const}]:[])];
    entry.methodsReady.resolve();return entry.method.promise;
  };
  helper.twoFactorAuthHook=async()=>{if(!entry||entry.settled)throw authError('AUTH_INTERACTION_REQUIRED');entry.codeReady.resolve();return entry.code.promise;};
  helper.trustFingerprintHook=async()=>!!entry&&!entry.settled&&entry.trust;
  helper.trustFingerprintNameHook=async()=>formatTrustDeviceName(await options.trustDeviceName?.()??'', 'CLI');
  let trustLimit=false;helper.twoFactorAuthLimitHook=async()=>{trustLimit=true;};
  const current=()=>{if(!entry||entry.settled)throw authError('AUTH_2FA_RESTART');return entry;};
  async function login(input:{username:string;password:string;trustDevice?:boolean}):Promise<AuthResult>{
    if(!/^\d{1,32}$/.test(input.username)||!input.password||input.password.length>4096)throw authError('AUTH_INVALID_CREDENTIALS');
    if(entry&&!entry.settled)throw authError('AUTH_IN_PROGRESS');
    trustLimit=false;
    const e={username:input.username,password:input.password,methods:[] as AuthMethod[],selected:undefined as TwoFactorType|undefined,trust:input.trustDevice===true,lastSent:0,p:Promise.resolve(),method:deferred<TwoFactorType>(),code:deferred<string>(),methodsReady:deferred<void>(),codeReady:deferred<void>(),settled:false};
    // A hook may never be reached. Mark deferred rejections handled independently.
    void e.method.promise.catch(()=>undefined);void e.code.promise.catch(()=>undefined);
    entry=e;
    e.p=(async()=>{await options.prepare(input.username,input.password);if(entry!==e)throw authError('AUTH_SESSION_CHANGED');await helper.login({userId:input.username,password:input.password});if(entry!==e)throw authError('AUTH_SESSION_CHANGED');await options.ready();if(entry!==e)throw authError('AUTH_SESSION_CHANGED');})().then(()=>{e.settled=true;e.password='';},error=>{e.settled=true;e.password='';if(entry===e)options.failed();throw error;});
    void e.p.catch(()=>undefined);
    const result=await Promise.race([e.p.then(()=> 'ready' as const),e.methodsReady.promise.then(()=> '2fa' as const)]);
    return result==='ready'?{state:'ready'}:{state:'need-2fa',methods:e.methods,codeReady:false};
  }
  async function chooseMethod(type:TwoFactorType):Promise<AuthResult>{
    const e=current();if(!e.methods.some(m=>m.type===type))throw authError('AUTH_2FA_METHOD');
    if(e.selected&&e.selected!==type)throw authError('AUTH_2FA_METHOD');
    if(!e.selected){e.selected=type;e.lastSent=Date.now();e.method.resolve(type);}
    await Promise.race([e.p,e.codeReady.promise]);
    return e.settled?{state:'ready'}:{state:'need-2fa',methods:e.methods,codeReady:true};
  }
  async function sendCode(type:TwoFactorType){const e=current();if(!e.selected)return chooseMethod(type);await chooseMethod(type);if(type==='totp')return;if(Date.now()-e.lastSent<60_000)throw authError('AUTH_2FA_SEND_COOLDOWN');e.lastSent=Date.now();await options.resend(type);}
  async function verify(type:TwoFactorType,code:string,trustDevice?:boolean):Promise<AuthResult>{
    const e=current();if(!/^[0-9]{4,12}$/.test(code))throw authError('AUTH_2FA_CODE_INVALID');
    if(trustDevice!==undefined)e.trust=trustDevice;
    await chooseMethod(type);if(!e.settled)e.code.resolve(code);await e.p;return{state:'ready'};
  }
  function cancel(){const e=entry;entry=null;options.cancel();if(e&&!e.settled){const error=authError('AUTH_LOGIN_CANCELLED');e.method.reject(error);e.code.reject(error);e.password='';}}
  return {login,chooseMethod,sendCode,verify,cancel,status(){return{pending:!!entry&&!entry.settled,methods:entry?.methods??[],selected:entry?.selected,trustLimit};}};
}
