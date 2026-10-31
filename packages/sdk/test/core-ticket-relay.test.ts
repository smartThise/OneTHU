import test from 'node:test';
import assert from 'node:assert/strict';
import {XiaodaClient,VisitClient} from '@onethu/core';
const ticket='12345678-1234-1234-1234-123456789abc';
test('Qingxiaoda authorization exposes one official service ticket without redeeming or persisting a business token',async()=>{
 const requests:string[]=[];const client=new XiaodaClient({fetch:async(input)=>{requests.push(String(input));return new Response('<a href="https://www.xiaoda.tsinghua.edu.cn/login.html?ticket='+ticket+'">Continue</a>');}});
 const result=await client.authorizeTicket();assert.equal(result.ticket,ticket);assert.equal(requests.length,1);assert.equal(client.hasToken(),false);assert.ok(requests.every(url=>url.startsWith('https://id.tsinghua.edu.cn/')));
});
test('visitor authorization preserves a native-followed official ticket URL and does not exchange it prematurely',async()=>{
 let calls=0;const client=new VisitClient({fetch:async()=>{calls++;return new Response('<html>official callback shell</html>',{headers:{'x-onethu-final-url':'https://visit.tsinghua.edu.cn/visitor/mobile/sso?ticket='+ticket}});}});
 const result=await client.authorizeTicket();assert.equal(result.ticket,ticket);assert.equal(calls,1);assert.equal(client.hasToken(),false);
});
