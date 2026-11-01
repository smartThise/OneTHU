import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCertificateAuthority} from '../src/certificates.mjs';
import {createCampusGateway} from '../src/index.mjs';

async function connect(endpoint,ca,path,referer,cookie,{hostname='id.tsinghua.edu.cn',headers={}}={}){
 const req=http.request({host:endpoint.host,port:endpoint.port,method:'CONNECT',path:hostname+':443',headers:{host:hostname+':443'}});
 const connected=once(req,'connect');req.end();const [response,socket,head]=await connected;
 assert.equal(response.statusCode,200);if(head.length)socket.unshift(head);
 const secure=tls.connect({socket,servername:hostname,ca,ALPNProtocols:['http/1.1']});
 await once(secure,'secureConnect');
 const chunks=[];secure.on('data',chunk=>chunks.push(chunk));const ended=once(secure,'end');
 secure.end(`GET ${path} HTTP/1.1\r\nHost: ${hostname}\r\n${referer?`Referer: ${referer}\r\n`:''}${cookie?`Cookie: ${cookie}\r\n`:''}${Object.entries(headers).map(([k,v])=>k+': '+v+'\r\n').join('')}Connection: close\r\n\r\n`);
 await ended;return Buffer.concat(chunks).toString();
}
test('identity TLS stays opaque for browsers while signed-client requests require an exact mini-program service',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'onethu-mini-tls-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const ca=await createCertificateAuthority({directory:dir,allowedHosts:['id.tsinghua.edu.cn','www.xiaoda.tsinghua.edu.cn']});
 const cert=await ca.issue('id.tsinghua.edu.cn');let opaque=0,borrowed=0,issued=0;
 const official=tls.createServer({...cert,ALPNProtocols:['http/1.1']},socket=>{socket.on('data',()=>{opaque++;socket.end('HTTP/1.1 200 OK\r\nContent-Length: 16\r\nConnection: close\r\n\r\noriginal-browser');});});
 await new Promise(resolve=>official.listen(0,'127.0.0.1',resolve));t.after(()=>official.close());
 let signed=false;
 const clientIdentity={request:async()=>{borrowed++;return new Response('real-ticket-fixture');}};
 const gateway=createCampusGateway({allowedOrigins:['https://learn.tsinghua.edu.cn'],authorizeSocket:async()=>true,
  resolveClient:async()=>signed?{application:'wechat',platform:'darwin',pid:50}:null,tlsClient:async host=>{issued++;return ca.issue(host);},tls:async()=>cert,
  connectPassthrough:async()=>{const socket=net.connect(official.address().port,'127.0.0.1');await once(socket,'connect');return socket;},
  clientIdentity,
  session:{epoch:()=>1,assertCurrent:()=>{},request:async()=>{throw new Error('ordinary adapter must not get identity');}},
 });t.after(()=>gateway.close());const endpoint=await gateway.listen();
 assert.match(await connect(endpoint,ca.certificatePem,'/do/off/ui/auth/login/checkSingle'),/original-browser/);
 assert.equal(opaque,1);assert.equal(issued,0);assert.equal(borrowed,0);
 signed=true;
 const path='/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html';
 assert.match(await connect(endpoint,ca.certificatePem,path,'https://servicewechat.com/wxc607b8a0063e7426/177/page-frame.html'),/real-ticket-fixture/);
 assert.equal(borrowed,1);
 assert.match(await connect(endpoint,ca.certificatePem,path,'https://evil.example/'),/GATEWAY_CLIENT_REQUEST_REJECTED/);assert.equal(borrowed,1);
 assert.match(await connect(endpoint,ca.certificatePem,'/password/change','https://servicewechat.com/wxc607b8a0063e7426/177/page-frame.html'),/GATEWAY_CLIENT_REQUEST_REJECTED/);assert.equal(borrowed,1);
 clientIdentity.passthrough=async(_url,init)=>{assert.equal(init.headers.get('cookie'),'own-client=fixture');return new Response('own-client-flow',{headers:{'set-cookie':'own-client=renewed; Secure; HttpOnly; Path=/'}});};
 const own=await connect(endpoint,ca.certificatePem,'/do/off/ui/auth/login/form/00000000000000000000000000000000/0','https://servicewechat.com/wx0000000000000000/1/page-frame.html','own-client=fixture');
 assert.match(own,/own-client-flow/);assert.match(own,/set-cookie: own-client=renewed/i);assert.equal(borrowed,1);
 const stats=gateway.statistics().clientDiagnostics;
 assert.equal(stats.sharedRequests,1);assert.equal(stats.independentRequests,1);assert.equal(stats.tlsFailures,0);
 assert.equal(stats.recentRequests[0].service,'xiaoda');assert.equal(stats.recentRequests[1].route,'independent');
 assert.equal(JSON.stringify(stats).includes('own-client=fixture'),false);
 stats.recentRequests[0].host='mutated';assert.equal(gateway.statistics().clientDiagnostics.recentRequests[0].host,'id.tsinghua.edu.cn');
 await connect(endpoint,ca.certificatePem,'/api/token/getUserInfo','https://servicewechat.com/wxc607b8a0063e7426/177/page-frame.html',undefined,
  {hostname:'www.xiaoda.tsinghua.edu.cn',headers:{'Sec-Fetch-Site':'cross-site'}});
 assert.equal(borrowed,2);
 const navigation={'Sec-Fetch-Site':'none','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'};
 assert.match(await connect(endpoint,ca.certificatePem,path,undefined,undefined,{headers:navigation}),/real-ticket-fixture/);
 assert.equal(borrowed,3);assert.equal(gateway.statistics().clientDiagnostics.recentRequests.at(-1).navigationHandoff,true);
 assert.match(await connect(endpoint,ca.certificatePem,path,undefined,'own-client=fixture',{headers:navigation}),/own-client-flow/);
 assert.equal(borrowed,3);
});
