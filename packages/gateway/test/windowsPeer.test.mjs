import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowsPeerAuthorizer, parseWindowsPeer } from '../src/windowsPeer.mjs';
test('Windows peer accepts only one exact process in the current SID',async()=>{
 let calls=0;const socket={localAddress:'127.0.0.1',remoteAddress:'127.0.0.1',remoteFamily:'IPv4',localPort:12000,remotePort:13000,destroyed:false};
 const authorize=createWindowsPeerAuthorizer({platform:'win32',run:async(_cmd,args)=>{
  calls++;const script=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert.match(script,/-LocalPort 13000 -RemoteAddress 127.0.0.1 -RemotePort 12000/);assert.match(script,/GetOwnerSid/);
  return {stdout:JSON.stringify({pid:91,sid:'S-1-5-21-123',currentSid:'S-1-5-21-123'}),stderr:''};
 }});
 assert.equal(await authorize(socket),true);assert.equal((await authorize.describe(socket)).pid,91);assert.equal(calls,1);
 socket.remotePort++;await assert.rejects(authorize(socket),{code:'GATEWAY_PEER_SOCKET_INVALID'});
});
test('Windows attribution rejects another user, ambiguous output and malformed PID',()=>{
 for(const row of [{pid:1,sid:'S-1-5-21-2',currentSid:'S-1-5-21-1'},[],{pid:0,sid:'S-1-5-21-1',currentSid:'S-1-5-21-1'}])assert.throws(()=>parseWindowsPeer(JSON.stringify(row)));
});

test('Windows browser bursts queue with bounded PowerShell concurrency rather than rejecting the fifth asset',async()=>{
 let active=0,maximum=0;
 const authorize=createWindowsPeerAuthorizer({platform:'win32',run:async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setImmediate(resolve));active--;return {stdout:JSON.stringify({pid:91,sid:'S-1-5-21-123',currentSid:'S-1-5-21-123'}),stderr:''};}});
 const results=await Promise.all(Array.from({length:16},(_,i)=>authorize({localAddress:'127.0.0.1',remoteAddress:'127.0.0.1',remoteFamily:'IPv4',localPort:12000,remotePort:13000+i,destroyed:false})));
 assert.equal(results.length,16);assert.ok(results.every(Boolean));assert.equal(maximum,4);
});
