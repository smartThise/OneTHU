import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCampusBrowserTarget } from '../src/node/campusProxyPolicy.js';

function denied(url: string) {
  assert.throws(() => assertCampusBrowserTarget(new URL(url)), { code: 'GATEWAY_AUTH_REQUIRED', status: 401 }, url);
}
function allowed(url: string) {
  assert.doesNotThrow(() => assertCampusBrowserTarget(new URL(url)), url);
}

test('all ID and OAuth browser requests stay outside the account authority', () => {
  for (const host of ['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn']) {
    for (const path of ['/', '/do/off/ui/auth/login/check', '/security_check', '/b/doubleAuth/login', '/b/account/deleteDevice', '/logout', '/assets/script.js']) {
      denied(`https://${host}${path}`);
    }
  }
});

test('Learn login, logout and ticket redemption are blocked in every known route form', () => {
  for (const path of ['/f/login', '/f/login/', '/j_spring_security_check', '/f/j_spring_security_check',
    '/f/j_spring_security_logout', '/b/j_spring_security_thauth_roaming_entry?ticket=synthetic-other-account']) {
    denied(`https://learn.tsinghua.edu.cn${path}`);
  }
});

test('routing normalization closes encoded, matrix-parameter, path-info and double-decoding bypasses', () => {
  for (const path of ['/f/j_spring_security_logout;jsessionid=synthetic',
    '/f;%6a%73%65%73%73%69%6f%6e%69%64=x/%6a_spring_security_logout',
    '/%2566/%256a_spring_security_logout', '//f///j_spring_security_logout/',
    '/f/j_spring_security_logout/extra', '/f/ignored/%252e%252e/j_spring_security_logout',
    '/f%5cj_spring_security_logout', '/f/login%00ignored', '/F/J_SPRING_SECURITY_LOGOUT']) {
    denied(`https://learn.tsinghua.edu.cn${path}`);
  }
});

test('Info ticket redemption is blocked while ordinary portal application launch remains allowed', () => {
  const base = 'https://info.tsinghua.edu.cn/b/yyfw/vyyfwxx/info/portal_fg/common/onlineAppRedirect';
  for (const tail of ['?ticket=synthetic', '?yyfwid=app&ticket=', '?%74icket=synthetic', '?%2574icket=synthetic',
    ';jsessionid=synthetic?ticket=synthetic', '/?ticket=synthetic']) denied(base + tail);
  allowed(base + '?yyfwid=app&_csrf=synthetic&machine=p');
  allowed(base + '?yyfwid=app&description=ticket');
  for(const method of ['POST','PUT','PATCH','DELETE'])assert.throws(()=>assertCampusBrowserTarget(new URL(base+'?yyfwid=app'),method),{code:'GATEWAY_AUTH_REQUIRED'});
  assert.doesNotThrow(()=>assertCampusBrowserTarget(new URL(base+'?yyfwid=app'),'HEAD'));
  allowed('https://info.tsinghua.edu.cn/b/business/document?ticket=ordinary-business-reference');
});

test('selection credential or ticket submission is blocked without blocking course selection writes', () => {
  for (const scheme of ['http', 'https']) {
    denied(`${scheme}://zhjwxk.cic.tsinghua.edu.cn/j_acegi_formlogin_xsxk.do`);
    denied(`${scheme}://zhjwxk.cic.tsinghua.edu.cn/%6a_acegi_formlogin_xsxk.do;jsessionid=synthetic`);
    allowed(`${scheme}://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksJxjhBs.do?m=submit`);
  }
});

test('business forms, uploads, downloads, CSRF queries and device disconnection remain permitted', () => {
  for (const url of [
    'https://learn.tsinghua.edu.cn/b/wlxt/kczy/zy/student/submit?csrf=synthetic',
    'https://learn.tsinghua.edu.cn/b/wlxt/kcwj/wjgl/upload',
    'https://learn.tsinghua.edu.cn/b/wlxt/file/download?token=synthetic-signed-download',
    'https://learn.tsinghua.edu.cn/files/%D6%D0%CE%C4.pdf',
    'https://learn.tsinghua.edu.cn/files/login-notes.pdf',
    'https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/index',
    'https://usereg.tsinghua.edu.cn/home/delete?id=synthetic&user_mac=synthetic',
    'https://card.tsinghua.edu.cn/login/getUserInfoFromToken',
  ]) allowed(url);
});

test('policy matching leaves the original URL bytes and query unchanged', () => {
  const target = new URL('https://learn.tsinghua.edu.cn/b/%77lxt//file;version=1?token=synthetic%2Bvalue');
  const before = target.href;
  assertCampusBrowserTarget(target);
  assert.equal(target.href, before);
});
