import { createHash } from 'node:crypto';
import { createPacScript } from './pac.mjs';
import { GatewayError } from './policy.mjs';
const fail = () => { throw new GatewayError('GATEWAY_PROXY_FALLBACK_INVALID',400); };
export function windowsProxyPlan(config, before) {
  if(!config||typeof config.autoDetect!=='boolean'||typeof config.autoConfigUrl!=='string'||typeof config.proxy!=='string')fail();
  if(config.autoDetect||config.autoConfigUrl)throw new GatewayError('GATEWAY_EXISTING_PROXY_ENABLED',400);
  if(config.proxy.length>4096||typeof (config.proxyBypass??'')!=='string'||(config.proxyBypass??'').length>8192)fail();
  const fallback={http:null,https:null,socks:null,bypass:(config.proxyBypass??'').split(';').map(s=>s.trim()).filter(Boolean)};
  const endpoint=value=>{
    const match=/^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+):([1-9][0-9]{0,4})$/.exec(value.trim());
    if(!match||Number(match[2])>65535)fail();return {host:match[1].replace(/^\[|\]$/g,''),port:Number(match[2])};
  };
  if(config.proxy){
    if(!config.proxy.includes('=')){fallback.http=endpoint(config.proxy);fallback.https=fallback.http;}
    else for(const rule of config.proxy.split(';')){
      const match=/^(http|https|socks)=(.+)$/.exec(rule.trim());
      if(!match||fallback[match[1]])fail();fallback[match[1]]=endpoint(match[2]);
    }
  }
  // Reuse the actual PAC validator so unsupported bypass syntax fails before
  // any network setting is touched.
  createPacScript(['https://learn.tsinghua.edu.cn'],{host:'127.0.0.1',port:1},fallback);
  return {version:1,platform:'win32',fingerprint:createHash('sha256').update(JSON.stringify([config,before])).digest('hex'),services:[{name:'CurrentUser',fallback}]};
}
