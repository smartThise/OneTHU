import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrustedClientResolver,isMacWeChatExecutable} from '../src/trustedClient.mjs';
test('Mac process name and Referer alone do not authorize a mini program',async()=>{
 for(const path of ['/tmp/WeChat.app/Contents/MacOS/WeChat','/Applications/WeChat.app/Contents/../evil','/Applications/Other.app/Contents/MacOS/WeChat'])assert.equal(isMacWeChatExecutable(path),false);
 const peer=Object.assign(async()=>true,{describe:async()=>({platform:'darwin',pid:50,uid:501})});
 let calls=0;
 const resolve=createTrustedClientResolver(peer,{run:async(cmd,args)=>{
  calls++;if(cmd==='/bin/ps')return {stdout:'/Applications/WeChat.app/Contents/MacOS/WeChat',stderr:''};
  assert.equal(cmd,'/usr/bin/codesign');assert.ok(args.includes('=anchor apple generic'));
  throw new Error('unsigned');
 }});
 assert.equal(await resolve({destroyed:false}),null);assert.equal(calls,2);
});
test('valid signed client proof is bound to the live socket and cached there',async()=>{
 const peer=Object.assign(async()=>true,{describe:async()=>({platform:'darwin',pid:50,uid:501})});let calls=0;
 const resolve=createTrustedClientResolver(peer,{run:async(cmd,args)=>{calls++;return {stdout:cmd==='/bin/ps'?'/Applications/WeChat.app/Contents/MacOS/WeChat':'',stderr:args.includes('-dv')?'TeamIdentifier=5A4RE8SF68\nIdentifier=com.tencent.flue.WeApp\n':''};}});
 const socket={destroyed:false};assert.equal((await resolve(socket)).application,'wechat');await resolve(socket);assert.equal(calls,3);
 socket.destroyed=true;assert.equal(await resolve(socket),null);
});

test('a valid Apple signature from another developer never becomes Tencent client proof',async()=>{
 const peer=Object.assign(async()=>true,{describe:async()=>({platform:'darwin',pid:50,uid:501})});
 const resolve=createTrustedClientResolver(peer,{run:async(cmd,args)=>({stdout:cmd==='/bin/ps'?'/Applications/WeChat.app/Contents/MacOS/WeChat':'',stderr:args.includes('-dv')?'TeamIdentifier=OTHERTEAM00\nIdentifier=com.tencent.flue.WeApp\n':''})});
 assert.equal(await resolve({destroyed:false}),null);
});
