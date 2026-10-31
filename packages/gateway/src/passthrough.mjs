import net from 'node:net';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { GatewayError } from './policy.mjs';

/** Unregistered sites keep their own end-to-end TLS and original proxy route.
 * No account cookies, proxy credentials, CA certificate or HTTP body enter here. */
export function createCampusPassthrough(fallback = {}) {
  if (!fallback.https && fallback.socks) return null;
  const matches = host => (fallback.bypass ?? []).some(value => {
    if (value.includes('/') || value === '<local>') return false;
    const pattern = value.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.');
    return new RegExp('^' + pattern + '$', 'i').test(host);
  });
  const cidrs=(fallback.bypass??[]).filter(value=>value.includes('/'));
  return async (target, { signal } = {}) => {
    let bypass=matches(target.hostname);
    if(!bypass&&cidrs.length){
      const addresses=await lookup(target.hostname,{all:true}).catch(()=>[]);
      bypass=addresses.some(({address,family})=>family===4&&cidrs.some(cidr=>{
        const [network,bits]=cidr.split('/'),parts=network.split('.');while(parts.length<4)parts.push('0');
        const integer=value=>value.split('.').reduce((result,part)=>(result*256+Number(part))>>>0,0);
        const mask=Number(bits)===0?0:(0xffffffff<<(32-Number(bits)))>>>0;
        return (integer(address)&mask)===(integer(parts.join('.'))&mask);
      }));
    }
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new GatewayError('GATEWAY_PASSTHROUGH_FAILED', 502)); } };
    const proxy = bypass ? null : fallback.https;
    if (proxy) {
      const request = http.request({ hostname: proxy.host, port: proxy.port, method: 'CONNECT',
        path: `${target.hostname}:443`, headers: { Host: `${target.hostname}:443` }, signal, timeout: 10000 });
      request.once('error', fail); request.once('timeout', () => request.destroy());
      request.once('connect', (response, socket, head) => {
        if (response.statusCode !== 200) { socket.destroy(); fail(); return; }
        socket.setTimeout(0);
        if (head.length) socket.unshift(head);
        settled = true; resolve(socket);
      });
      request.end();
    } else {
      const socket = net.connect({ host: target.hostname, port: 443, signal });
      socket.setTimeout(10000, () => socket.destroy());
      socket.once('error', fail); socket.once('connect', () => { socket.setTimeout(0); settled = true; resolve(socket); });
    }
    });
  };
}
