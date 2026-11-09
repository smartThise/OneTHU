import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { campusDirectResponse } from '../src/node/campusDirect.js';
import { createNodeTransport } from '../src/node/transport.js';

function incoming(body:Buffer, encoding?:string, status=200) {
 const stream=new PassThrough();
 Object.assign(stream, {statusCode:status,statusMessage:status===200?'OK':'Fixture',rawHeaders:[
  'Content-Type','text/html; charset=utf-8','Content-Length',String(body.length),
  'Set-Cookie','first=one; Path=/; HttpOnly','Set-Cookie','second=two; Path=/; Secure',
  ...(encoding?['Content-Encoding',encoding]:[]),
 ]});
 queueMicrotask(()=>stream.end(body));
 return stream as PassThrough & IncomingMessage;
}

test('campus direct decodes gzip, deflate and brotli while retaining original metadata and repeated cookies',async()=>{
 const original=Buffer.from('<p>后勤通知 — original response</p>');
 for(const [encoding,compress] of [['gzip',gzipSync],['x-gzip',gzipSync],['deflate',deflateSync],['x-deflate',deflateSync],['br',brotliCompressSync]] as const){
  const compressed=compress(original),response=campusDirectResponse(incoming(compressed,encoding));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),original);
  assert.equal(response.headers.get('content-encoding'),encoding);
  assert.equal(response.headers.get('content-length'),String(compressed.length));
  assert.deepEqual(response.headers.getSetCookie(),['first=one; Path=/; HttpOnly','second=two; Path=/; Secure']);
  assert.equal(response.status,200);assert.equal(response.statusText,'OK');
 }
});

test('stacked campus response codings decode in reverse application order and identity stays byte-exact',async()=>{
 const original=Buffer.from([0,1,2,255,120,200]);
 const stacked=brotliCompressSync(gzipSync(original));
 assert.deepEqual(Buffer.from(await campusDirectResponse(incoming(stacked,'gzip, br')).arrayBuffer()),original);
 assert.deepEqual(Buffer.from(await campusDirectResponse(incoming(gzipSync(original),'identity, GZIP')).arrayBuffer()),original);
 assert.deepEqual(Buffer.from(await campusDirectResponse(incoming(original)).arrayBuffer()),original);
 assert.deepEqual(Buffer.from(await campusDirectResponse(incoming(original,'identity')).arrayBuffer()),original);
});

test('HEAD and bodyless status responses consume their input without invoking a decoder',async()=>{
 for(const [method,status] of [['HEAD',200],['head',200],['GET',204],['GET',205],['GET',304]] as const){
  const source=incoming(Buffer.from('deliberately not gzip'),'gzip',status);
  const response=campusDirectResponse(source,method);
  assert.equal(response.body,null);assert.equal(response.status,status);assert.equal(await response.text(),'');
 }
});

test('campus response decoder failures and source aborts reject the body instead of hanging',async()=>{
 for(const encoding of ['gzip','deflate','br']){
  const response=campusDirectResponse(incoming(Buffer.from('invalid compressed body'),encoding));
  await assert.rejects(response.arrayBuffer());
 }
 const source=new PassThrough();
 Object.assign(source,{statusCode:200,statusMessage:'OK',rawHeaders:['Content-Encoding','gzip']});
 const response=campusDirectResponse(source as unknown as IncomingMessage);
 const reading=response.arrayBuffer();
 source.destroy(new Error('fixture aborted'));
 await assert.rejects(reading,/fixture aborted/);
});

test('cancelling a decoded response destroys its upstream stream',async()=>{
 const source=new PassThrough();
 Object.assign(source,{statusCode:200,statusMessage:'OK',rawHeaders:['Content-Encoding','br']});
 const response=campusDirectResponse(source as unknown as IncomingMessage);
 await response.body!.cancel();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(source.destroyed,true);
});

test('large compressed responses start streaming before the complete encoded body arrives',async()=>{
 let produced=0;
 const count=128,payload=Buffer.alloc(4096);
 let seed=1;
 for(let index=0;index<payload.length;index++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;payload[index]=seed>>>24;}
 const member=gzipSync(payload);
 const source=new Readable({read(){
  if(produced===count){this.push(null);return;}
  produced++;this.push(member);
 },highWaterMark:member.byteLength});
 Object.assign(source,{statusCode:200,statusMessage:'OK',rawHeaders:['Content-Encoding','gzip']});
 const response=campusDirectResponse(source as IncomingMessage),reader=response.body!.getReader();
 const first=await reader.read();assert.equal(first.done,false);assert(produced<count);
 let length=first.value!.byteLength;
 while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;}
 assert.equal(length,count*payload.byteLength);
});

test('the shared transport response-size limit counts decoded bytes',async t=>{
 const original=Buffer.from('A'.repeat(100000)),compressed=gzipSync(original);
 assert(compressed.byteLength<1024);
 const transport=createNodeTransport({epoch:()=>1,assertCurrent(){},maxResponseBytes:1024,fetch:async()=>campusDirectResponse(incoming(compressed,'gzip'))});
 t.after(()=>transport.close());
 const response=await transport.fetch('https://myhome.tsinghua.edu.cn/',{redirect:'manual'});
 await assert.rejects(response.arrayBuffer(),{code:'NETWORK_RESPONSE_TOO_LARGE'});
});

test('unknown content codings fail explicitly',()=>{
 const source=incoming(Buffer.from('unknown'),'unknown');
 assert.throws(()=>campusDirectResponse(source),{code:'CAMPUS_SERVICE_ENCODING_UNSUPPORTED'});
 source.destroy();
});
