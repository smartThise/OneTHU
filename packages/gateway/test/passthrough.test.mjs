import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import vm from 'node:vm';
import { once } from 'node:events';
import { createCampusGateway } from '../src/index.mjs';
import { createCampusPassthrough } from '../src/passthrough.mjs';
import { createPacScript } from '../src/pac.mjs';

test('disabled HTTP sites relay their own browser session and can be enabled on the next connection',async t=>{
 let enabled=false,shared=0;
 const seen=[];
 const upstream=http.createServer((req,res)=>{
  let body='';
  req.on('data',chunk=>body+=chunk);
  req.on('end',()=>{
   seen.push({url:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization,body});
   res.writeHead(200,{'set-cookie':'own=renewed; Path=/','content-type':'text/plain'}).end('original response');
  });
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>upstream.close());
 const gateway=createCampusGateway({allowedOrigins:['http://plain.tsinghua.edu.cn'],authorizeSocket:async()=>true,
  isBypassed:()=>!enabled,connectBypass:()=>new Promise((resolve,reject)=>{
   const socket=net.connect(upstream.address().port,'127.0.0.1',()=>resolve(socket));socket.on('error',reject);
  }),session:{epoch:()=>1,assertCurrent(){},request(){shared++;return new Response('shared response');}}});
 const address=await gateway.listen();t.after(()=>gateway.close());
 async function request(){
  return new Promise((resolve,reject)=>{
   const req=http.request({host:address.host,port:address.port,method:'POST',path:'http://plain.tsinghua.edu.cn/submit?q=1',
    headers:{host:'plain.tsinghua.edu.cn','sec-fetch-site':'none',cookie:'own=browser',authorization:'Bearer own-token','content-length':4}},res=>{
     let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({body,cookie:res.headers['set-cookie']}));
    });req.on('error',reject);req.end('body');
  });
 }
 assert.deepEqual(await request(),{body:'original response',cookie:['own=renewed; Path=/']});
 assert.deepEqual(seen,[{url:'/submit?q=1',cookie:'own=browser',authorization:'Bearer own-token',body:'body'}]);
 assert.equal(shared,0);
 enabled=true;
 assert.deepEqual(await request(),{body:'shared response',cookie:undefined});
 assert.equal(shared,1);
});

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
 assert.equal(typeof createCampusPassthrough({socks:{host:'127.0.0.1',port:1080}}),'function');
});

test('HTTP and HTTPS select their original proxy and default destination port', async t => {
  const calls = [];
  const servers = [];
  for (const scheme of ['http', 'https']) {
    const server = http.createServer();
    server.on('connect', (request, socket) => {
      calls.push({ scheme, target: request.url });
      socket.end('HTTP/1.1 200 Connection Established\r\n\r\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    servers.push(server);
    t.after(() => server.close());
  }
  const connect = createCampusPassthrough({
    http: { host: '127.0.0.1', port: servers[0].address().port },
    https: { host: '127.0.0.1', port: servers[1].address().port },
  });
  for (const protocol of ['http:', 'https:']) {
    const socket = await connect({ protocol, hostname: 'site.tsinghua.edu.cn' });
    socket.destroy();
  }
  const implicit = await connect({ hostname: 'site.tsinghua.edu.cn', port: '8443' });
  implicit.destroy();
  assert.deepEqual(calls, [
    { scheme: 'http', target: 'site.tsinghua.edu.cn:80' },
    { scheme: 'https', target: 'site.tsinghua.edu.cn:443' },
    { scheme: 'https', target: 'site.tsinghua.edu.cn:8443' },
  ]);
});

test('direct HTTP respects an explicit bypass and returns the original socket', async t => {
  const server = net.createServer(socket => socket.end('direct'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const connect = createCampusPassthrough({
    http: { host: '127.0.0.1', port: 1 },
    bypass: ['127.0.0.1'],
  });
  const socket = await connect({ protocol: 'http:', hostname: '127.0.0.1', port: server.address().port });
  let text = '';
  for await (const part of socket) text += part.toString();
  assert.equal(text, 'direct');
});

test('SOCKS-only routing completes its fragmented handshake and preserves tunneled bytes', async t => {
  let destination;
  const server = net.createServer(socket => {
    let step = 0, bytes = Buffer.alloc(0);
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      if (step === 0 && bytes.length >= 3) {
        assert.deepEqual([...bytes.subarray(0, 3)], [5, 1, 0]);
        bytes = bytes.subarray(3); step++;
        socket.write(Buffer.from([5]));
        setImmediate(() => socket.write(Buffer.from([0])));
      }
      if (step === 1 && bytes.length >= 5 && bytes.length >= bytes[4] + 7) {
        assert.deepEqual([...bytes.subarray(0, 4)], [5, 1, 0, 3]);
        const length = bytes[4];
        destination = { host: bytes.subarray(5, length + 5).toString(), port: bytes.readUInt16BE(length + 5) };
        step++;
        socket.write(Buffer.from([5, 0, 0, 1, 127]));
        setImmediate(() => socket.end(Buffer.concat([Buffer.from([0, 0, 1, 0, 80]), Buffer.from('opaque')])));
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const connect = createCampusPassthrough({ socks: { host: '127.0.0.1', port: server.address().port } });
  const socket = await connect({ hostname: 'site.tsinghua.edu.cn', port: '8443' });
  assert.equal(socket.timeout, 0);
  let text = '';
  for await (const part of socket) text += part.toString();
  assert.equal(text, 'opaque');
  assert.deepEqual(destination, { host: 'site.tsinghua.edu.cn', port: 8443 });
});

test('SOCKS refusal and aborted handshakes fail without falling through to another route', async t => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.once('data', () => socket.write(Buffer.from([5, 255])));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  const connect = createCampusPassthrough({ socks: { host: '127.0.0.1', port: server.address().port } });
  await assert.rejects(connect({ hostname: 'site.tsinghua.edu.cn' }), { code: 'GATEWAY_PASSTHROUGH_FAILED' });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(connect({ hostname: 'site.tsinghua.edu.cn' }, { signal: cancelled.signal }));
});

test('aborting an in-progress SOCKS handshake releases its socket', async t => {
  const started = new AbortController();
  let closed;
  const server = net.createServer(socket => {
    closed = once(socket, 'close');
    socket.once('data', () => started.abort());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const connect = createCampusPassthrough({ socks: { host: '127.0.0.1', port: server.address().port } });
  await assert.rejects(connect({ hostname: 'site.tsinghua.edu.cn' }, { signal: started.signal }),
    { code: 'GATEWAY_PASSTHROUGH_FAILED' });
  await closed;
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
