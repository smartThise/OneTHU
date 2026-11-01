import test from 'node:test';
import assert from 'node:assert/strict';
import { miniProgramRequest, parseClientTarget, describeMiniRequest,createMiniNavigationGrants } from '../src/clientIdentity.mjs';
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
  [xiaoda,{referer:'https://evil.example/','sec-fetch-site':'cross-site'},'GET'],[xiaoda,q,'POST'],
  [xiaoda.replace('?/login.html','?https://evil.example/'),q,'GET'],[xiaoda.replace('/form/','/check/'),q,'GET'],
  ['https://id.tsinghua.edu.cn/password/change',q,'GET'],['https://oauth.tsinghua.edu.cn/',q,'GET'],
  ['https://www.xiaoda.tsinghua.edu.cn:8443/',q,'GET'],
 ]) assert.throws(()=>miniProgramRequest(new URL(target),headers,method),{code:'GATEWAY_CLIENT_REQUEST_REJECTED'});
});

test('real Mac native cross-site requests are scoped to the verified mini-program Referer and its service',()=>{
 assert.equal(miniProgramRequest(new URL('https://www.xiaoda.tsinghua.edu.cn/api/token/getUserInfo'),{...q,'sec-fetch-site':'cross-site'}).service,'xiaoda');
 assert.equal(miniProgramRequest(new URL(xiaoda),{...q,'sec-fetch-site':'cross-site'}).service,'xiaoda');
 assert.throws(()=>miniProgramRequest(new URL(visit),{...q,'sec-fetch-site':'cross-site'}));
 assert.throws(()=>miniProgramRequest(new URL('https://www.xiaoda.tsinghua.edu.cn/api/token/getUserInfo'),{referer:'https://evil.example/','sec-fetch-site':'cross-site'}));
});

const peer={application:'wechat',platform:'darwin',pid:41};
const documentHeaders={'sec-fetch-site':'none','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
const business=new URL('https://www.xiaoda.tsinghua.edu.cn/api/token/getUserInfo');
test('a same-process app-proven request permits exactly one registered no-Referer school navigation',()=>{
 const policy=createMiniNavigationGrants();
 assert.throws(()=>policy.authorize(new URL(xiaoda),documentHeaders,'GET',peer,1));
 policy.authorize(business,{...q,'sec-fetch-site':'cross-site'},'GET',peer,1);
 assert.equal(policy.authorize(new URL(xiaoda),documentHeaders,'GET',peer,1).navigationHandoff,true);
 assert.throws(()=>policy.authorize(new URL(xiaoda),documentHeaders,'GET',peer,1));
});
test('navigation grants reject another process, account epoch, service, XHR, body and unrelated target',()=>{
 const attacks=[
  {peer:{...peer,pid:42}}, {epoch:2}, {url:visit}, {url:'https://www.xiaoda.tsinghua.edu.cn'+new URL(xiaoda).pathname},
  {headers:{...documentHeaders,'sec-fetch-dest':'empty'}}, {headers:{...documentHeaders,origin:'https://evil.example'}},
  {headers:{...documentHeaders,'sec-fetch-site':'cross-site'}}, {headers:{...documentHeaders,referer:'https://evil.example'}},
  {method:'POST',options:{hasBody:true}}, {options:{hasBody:true}},
 ];
 for(const attack of attacks){const policy=createMiniNavigationGrants();policy.authorize(business,q,'GET',peer,1);
  assert.throws(()=>policy.authorize(new URL(attack.url??xiaoda),attack.headers??documentHeaders,attack.method??'GET',attack.peer??peer,attack.epoch??1,attack.options));}
});
test('navigation grants expire and cannot be issued by an unrelated mini program',()=>{
 let time=0;const policy=createMiniNavigationGrants({now:()=>time});policy.authorize(business,q,'GET',peer,1);time=10000;
 assert.throws(()=>policy.authorize(new URL(xiaoda),documentHeaders,'GET',peer,1));
 assert.throws(()=>policy.authorize(business,x,'GET',peer,1));
 assert.throws(()=>policy.authorize(new URL(xiaoda),documentHeaders,'GET',peer,1));
});

test('registered ITS aliases preserve mode and normalize only the known hexadecimal service ID',()=>{
 const alias=visit.replace('04655f71b042b9d2d8d10cd566bd9c39','04655F71B042B9D2D8D10CD566BD9C39').replace('/0?','/1/?');
 assert.equal(miniProgramRequest(new URL(alias),{referer:'https://visit.tsinghua.edu.cn/visitor/mobile/login','sec-fetch-site':'same-site'}).entryMode,1);
 assert.throws(()=>miniProgramRequest(new URL(alias.replace('/1/?','/2/?')),{referer:'https://visit.tsinghua.edu.cn/visitor/mobile/login'}));
 assert.throws(()=>miniProgramRequest(new URL(alias.replace('04655F','04656F')),{referer:'https://visit.tsinghua.edu.cn/visitor/mobile/login'}));
 const omitted=visit.replace('/0?','?');
 assert.equal(miniProgramRequest(new URL(omitted),{referer:'https://visit.tsinghua.edu.cn/visitor/mobile/login'}).entryMode,'default');
 assert.equal(miniProgramRequest(new URL('https://visit.tsinghua.edu.cn/visitor/mobile/sso?ticket=fixture'),{referer:alias}).service,'visit');
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

test('mini-program diagnostics classify rejected layouts without retaining identity URLs or credentials',()=>{
 const diagnostic=describeMiniRequest(new URL(xiaoda.replace('?/login.html','?%2Flogin.html')),{
  referer:'https://servicewechat.com/wxc607b8a0063e7426/177/app-service.html?secret=fixture-secret',
  cookie:'session=fixture-secret',authorization:'Bearer fixture-secret',token:'fixture-secret',
 });
 assert.equal(diagnostic.service,'xiaoda');assert.equal(diagnostic.callbackEncoded,true);assert.equal(diagnostic.callback,'xiaoda');
 assert.equal(diagnostic.referrerApp,'xiaoda');assert.equal(diagnostic.referrerLayout,'other');
 const serialized=JSON.stringify(diagnostic);for(const secret of ['fixture-secret','wxc607b8a0063e7426','d982b795884e882abfa8ff3167aeb03e','/login.html'])assert.equal(serialized.includes(secret),false);
});
