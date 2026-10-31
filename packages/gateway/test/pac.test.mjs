import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createPacScript } from '../src/pac.mjs';

function evaluate(fallback, origins = ['https://learn.tsinghua.edu.cn']) {
  const context = vm.createContext({
    isPlainHostName: host => !host.includes('.'),
    shExpMatch: (host, rule) => new RegExp('^' + rule.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$').test(host),
    isInNet: (host, network, mask) => {
      const ip = value => value.split('.').reduce((acc, n) => acc * 256 + Number(n), 0) >>> 0;
      return /^\d+\.\d+\.\d+\.\d+$/.test(host) && (ip(host) & ip(mask)) === (ip(network) & ip(mask));
    },
  });
  vm.runInContext(createPacScript(origins, { host: '127.0.0.1', port: 12345 }, fallback), context);
  return url => context.FindProxyForURL(url, new URL(url).hostname);
}
const clash = { host: '127.0.0.1', port: 7897 };

test('identity sites retain the original route even when custom campus origins include them', () => {
  const origins = ['https://learn.tsinghua.edu.cn', 'https://id.tsinghua.edu.cn', 'http://id.tsinghua.edu.cn',
    'https://oauth.tsinghua.edu.cn', 'http://oauth.tsinghua.edu.cn'];
  const clashRoute = evaluate({ http: clash, https: clash, socks: clash }, origins);
  const directRoute = evaluate({}, origins);
  const socksRoute = evaluate({ socks: { host: '127.0.0.1', port: 1080 } }, origins);
  for (const host of ['id.tsinghua.edu.cn', 'oauth.tsinghua.edu.cn']) {
    for (const scheme of ['https', 'http']) {
      const url = `${scheme}://${host}/login?service=private`;
      assert.equal(clashRoute(url), 'PROXY 127.0.0.1:7897');
      assert.equal(directRoute(url), 'DIRECT');
      assert.equal(socksRoute(url), 'SOCKS5 127.0.0.1:1080');
    }
  }
  assert.equal(clashRoute('https://learn.tsinghua.edu.cn/'), 'PROXY 127.0.0.1:12345');
  assert.equal(evaluate({ https: clash, bypass: ['id.tsinghua.edu.cn'] }, origins)('https://id.tsinghua.edu.cn/'), 'DIRECT');
});

test('campus routing preserves a manual Clash fallback for unrelated traffic', () => {
  const route = evaluate({ http: clash, https: clash, socks: clash });
  assert.equal(route('https://learn.tsinghua.edu.cn/course'), 'PROXY 127.0.0.1:12345');
  assert.equal(route('https://www.google.com/'), 'PROXY 127.0.0.1:7897');
  assert.equal(route('http://example.com/'), 'PROXY 127.0.0.1:7897');
  assert.equal(route('ftp://example.com/'), 'SOCKS5 127.0.0.1:7897');
});
test('original bypass rules remain direct while campus cannot inherit an overly broad exception', () => {
  const route = evaluate({ http: clash, https: clash, socks: clash, bypass: ['127.0.0.1', '192.168.0.0/16', '169.254/16', '<local>', '*.local', '*.crashlytics.com', '*.tsinghua.edu.cn'] });
  for (const url of ['http://127.0.0.1/', 'http://192.168.55.2/', 'http://169.254.2.3/', 'http://nas/', 'http://nas.local/', 'https://a.crashlytics.com/']) assert.equal(route(url), 'DIRECT');
  assert.equal(route('https://learn.tsinghua.edu.cn/'), 'PROXY 127.0.0.1:12345');
  assert.equal(route('https://learn.tsinghua.edu.cn.evil.example/'), 'PROXY 127.0.0.1:7897');
});
test('separate scheme settings and empty services retain their original behavior', () => {
  const route = evaluate({ http: clash, socks: { host: 'localhost', port: 1080 } });
  assert.equal(route('https://example.com/'), 'SOCKS5 localhost:1080');
  assert.equal(evaluate({})('https://example.com/'), 'DIRECT');
  assert.equal(evaluate({ http: clash })('https://example.com/'), 'DIRECT');
});
test('fallback values cannot inject PAC code or silently lose unsupported bypass syntax', () => {
  for (const fallback of [{ http: { host: 'a;DIRECT', port: 80 } }, { http: { host: 'localhost', port: 0 } },
    { bypass: ['10.0.0.0/99'] }, { bypass: ['fd00::/8'] }, { bypass: ['x\nDIRECT'] }]) assert.throws(() => evaluate(fallback));
});
