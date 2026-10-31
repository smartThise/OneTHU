import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import { once } from 'node:events';
import { createCampusGateway } from '../src/index.mjs';
import { createCampusPassthrough } from '../src/passthrough.mjs';
import { createPacScript } from '../src/pac.mjs';

test('an unregistered university site keeps opaque TLS and inherited proxy without receiving account state',async t=>{
 const calls=[];
 const original=http.createServer();
 original.on('connect',(req,socket)=>{
  calls.push({target:req.url,headers:req.headers});socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(socket);
 });
 original.listen(0,'127.0.0.1');await once(original,'listening');t.after(()=>original.close());
 const gateway=createCampusGateway({allowedOrigins:['https://learn.tsinghua.edu.cn'],authorizeSocket:async()=>true,
  connectPassthrough:createCampusPassthrough({https:{host:'127.0.0.1',port:original.address().port}}),
  tls(){throw new Error('unregistered site must retain its original TLS certificate');},
  session:{epoch:()=>1,assertCurrent(){},request(){throw new Error('account transport must not receive opaque traffic');}}});
 const address=await gateway.listen();t.after(()=>gateway.close());
 const socket=net.connect(address.port,address.host);await once(socket,'connect');
 socket.write('CONNECT public-new.tsinghua.edu.cn:443 HTTP/1.1\r\nHost: public-new.tsinghua.edu.cn:443\r\n\r\n');
 let output='';for await(const part of socket){output+=part;if(output.includes('\r\n\r\n'))break;}
 assert.match(output,/200 Connection Established/);socket.destroy();
 assert.equal(calls.length,1);assert.equal(calls[0].target,'public-new.tsinghua.edu.cn:443');
 assert.equal(calls[0].headers.cookie,undefined);assert.equal(calls[0].headers.authorization,undefined);assert.equal(calls[0].headers['proxy-authorization'],undefined);
 const tunnel=await createCampusPassthrough({https:{host:'127.0.0.1',port:original.address().port}})({hostname:'public-new.tsinghua.edu.cn'});
 t.after(()=>tunnel.destroy());
 assert.equal(tunnel.timeout,0,'the connection deadline must not become an idle timeout for the established tunnel');
});

test('broad discovery PAC excludes authentication hosts and unrelated traffic',()=>{
 const context=vm.createContext({});vm.runInContext(createPacScript(['https://learn.tsinghua.edu.cn'],{host:'127.0.0.1',port:12345},{https:{host:'127.0.0.1',port:7897}},{campusPassthrough:true}),context);
 assert.equal(context.FindProxyForURL('https://new.tsinghua.edu.cn/','new.tsinghua.edu.cn'),'PROXY 127.0.0.1:12345');
 for(const host of ['id.tsinghua.edu.cn','oauth.tsinghua.edu.cn','webvpn.tsinghua.edu.cn','eviltsinghua.edu.cn','google.com'])assert.equal(context.FindProxyForURL('https://'+host+'/',host),'PROXY 127.0.0.1:7897');
 assert.equal(createCampusPassthrough({socks:{host:'127.0.0.1',port:1080}}),null);
});

async function connectResponse(address, request, host) {
  const socket = net.connect(address.port, address.host);
  await once(socket, 'connect');
  socket.write(`CONNECT ${request} HTTP/1.1\r\nHost: ${host ?? request}\r\n\r\n`);
  let output = '';
  for await (const part of socket) { output += part; if (output.includes('\r\n\r\n')) break; }
  socket.destroy();
  return output;
}

test('campus CONNECT with a non-443 port is transparently forwarded with its original port', async t => {
  const calls = [];
  const original = http.createServer();
  original.on('connect', (req, socket) => {
    calls.push(req.url);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.pipe(socket);
  });
  original.listen(0, '127.0.0.1'); await once(original, 'listening'); t.after(() => original.close());
  const gateway = createCampusGateway({
    allowedOrigins: ['https://learn.tsinghua.edu.cn'], authorizeSocket: async () => true,
    connectPassthrough: createCampusPassthrough({ https: { host: '127.0.0.1', port: original.address().port } }),
    tls() { throw new Error('non-443 campus tunnels stay opaque'); },
    session: { epoch: () => 1, assertCurrent() {}, request() { throw new Error('passthrough must not borrow account state'); } },
  });
  const address = await gateway.listen(); t.after(() => gateway.close());
  // The campus PAC sends every *.tsinghua.edu.cn HTTPS URL here regardless of port.
  const traffic = await connectResponse(address, 'traffic.tsinghua.edu.cn:8443');
  assert.match(traffic, /200 Connection Established/);
  assert.deepEqual(calls, ['traffic.tsinghua.edu.cn:8443'], 'upstream must receive the original port, not a rewritten 443');
  // Identity hosts, unrelated hosts and mismatched Host headers stay rejected.
  assert.match(await connectResponse(address, 'id.tsinghua.edu.cn:8443'), /401/);
  assert.match(await connectResponse(address, 'webvpn.tsinghua.edu.cn:443'), /401/);
  assert.match(await connectResponse(address, 'example.com:8443'), /403/);
  assert.match(await connectResponse(address, 'traffic.tsinghua.edu.cn:8443', 'other.tsinghua.edu.cn:8443'), /403/);
});
