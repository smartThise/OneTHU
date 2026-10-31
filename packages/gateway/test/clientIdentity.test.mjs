import test from 'node:test';
import assert from 'node:assert/strict';
import { miniProgramRequest, parseClientTarget } from '../src/clientIdentity.mjs';
const xiaoda='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d982b795884e882abfa8ff3167aeb03e/0?/login.html';
const visit='https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/04655f71b042b9d2d8d10cd566bd9c39/0?/visitor/mobile/sso';
const q={referer:'https://servicewechat.com/wxc607b8a0063e7426/177/page-frame.html'};
const x={referer:'https://servicewechat.com/wx3cfa534a23db4039/43/page-frame.html'};
test('known mini programs authorize only their own school identity service and native business domain',()=>{
 assert.equal(miniProgramRequest(new URL(xiaoda),q).service,'xiaoda');
 assert.equal(miniProgramRequest(new URL(visit),x).service,'visit');
 assert.equal(miniProgramRequest(new URL('https://www.xiaoda.tsinghua.edu.cn/api/token/login?ticket=fixture'),q).identity,false);
 assert.throws(()=>miniProgramRequest(new URL(visit),q));assert.throws(()=>miniProgramRequest(new URL(xiaoda),x));
});
test('native exemptions reject unknown mini programs, browser cross-site, identity writes and arbitrary callbacks',()=>{
 for(const [target,headers,method] of [
  [xiaoda,{},'GET'],[xiaoda,{referer:'https://servicewechat.com/wx0000000000000000/1/page-frame.html'},'GET'],
  [xiaoda,{...q,'sec-fetch-site':'cross-site'},'GET'],[xiaoda,q,'POST'],
  [xiaoda.replace('?/login.html','?https://evil.example/'),q,'GET'],[xiaoda.replace('/form/','/check/'),q,'GET'],
  ['https://id.tsinghua.edu.cn/password/change',q,'GET'],['https://oauth.tsinghua.edu.cn/',q,'GET'],
  ['https://www.xiaoda.tsinghua.edu.cn:8443/',q,'GET'],
 ]) assert.throws(()=>miniProgramRequest(new URL(target),headers,method),{code:'GATEWAY_CLIENT_REQUEST_REJECTED'});
});
test('TLS authority cannot be changed by tunneled Host or an absolute-form request',()=>{
 const tunnel={origin:'https://id.tsinghua.edu.cn'};
 assert.equal(parseClientTarget('/do/off/', 'id.tsinghua.edu.cn',tunnel).origin,tunnel.origin);
 for(const [path,host] of [['https://evil.example/','id.tsinghua.edu.cn'],['//evil.example/','id.tsinghua.edu.cn'],['/','other.tsinghua.edu.cn'],['/x#fragment','id.tsinghua.edu.cn']])assert.throws(()=>parseClientTarget(path,host,tunnel));
});

test('Xingzai visitor web-view can return from the exact school confirmation page',()=>{
 const headers={referer:'https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle','sec-fetch-site':'same-site'};
 assert.equal(miniProgramRequest(new URL('https://visit.tsinghua.edu.cn/visitor/mobile/sso?ticket=official'),headers).service,'visit');
 assert.equal(miniProgramRequest(new URL('https://visit.tsinghua.edu.cn/visitor/mobile/sso?ticket=official'),{referer:'https://id.tsinghua.edu.cn/','sec-fetch-site':'same-site'}).service,'visit');
 assert.throws(()=>miniProgramRequest(new URL('https://visit.tsinghua.edu.cn/visitor/mbpm/records'),headers));
});
