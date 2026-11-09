import test from 'node:test';
import assert from 'node:assert/strict';
import { THESIS_ORIGIN, THESIS_IDENTITY_URL, parseThesisLogin, normalizeThesisCallback } from '../src/thesisAuth.mjs';

const entry = THESIS_ORIGIN + '/qh/thesis/toLogin/?loginto=tsinghua&beforepage=';
const callback = THESIS_ORIGIN + '/qh/thesis/tsinghua/Login?ticket=official-ticket-012345';

test('thesis uses the registered identity application and a fixed default return page', () => {
  assert.equal(THESIS_IDENTITY_URL, 'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/4bf1579bc0410fc7dff3fd1db40d399e/0?/qh/thesis/tsinghua/Login');
  assert.deepEqual(parseThesisLogin(entry), { entry, redirectUrl: THESIS_ORIGIN + '/qh/qhSearch/QbIndex' });
  const missing = THESIS_ORIGIN + '/qh/thesis/toLogin/?loginto=tsinghua';
  assert.deepEqual(parseThesisLogin(missing), { entry: missing, redirectUrl: THESIS_ORIGIN + '/qh/qhSearch/QbIndex' });
});

test('thesis preserves the current same-origin page and its query', () => {
  const path = '/qh/qhSearch/QbIndex?title=%E6%95%B0%E6%8D%AE&sort=year';
  const url = entry + encodeURIComponent(path);
  assert.deepEqual(parseThesisLogin(url), { entry: url, redirectUrl: THESIS_ORIGIN + path });
  const order = THESIS_ORIGIN + '/qh/thesis/toLogin/?beforepage=%2Fqh%2FqhSearch%2FQbIndex&loginto=tsinghua';
  assert.equal(parseThesisLogin(order)?.redirectUrl, THESIS_ORIGIN + '/qh/qhSearch/QbIndex');
});

test('thesis rejects altered login routes, duplicate fields and foreign destinations', () => {
  for (const url of [
    entry.replace('newetds.', 'evil.'), entry.replace('newetds.lib.tsinghua.edu.cn', 'newetds.lib.tsinghua.edu.cn.evil.test'),
    entry.replace('newetds.lib.tsinghua.edu.cn', 'user@newetds.lib.tsinghua.edu.cn'),
    entry.replace('newetds.lib.tsinghua.edu.cn', 'newetds.lib.tsinghua.edu.cn:443'),
    entry.replace('https:', 'http:'), entry.replace('/toLogin/', '/toLogin'), entry.replace('/toLogin/', '/./toLogin/'),
    entry.replace('loginto=tsinghua', 'loginto=sys'), entry.replace('loginto=tsinghua', 'Loginto=tsinghua'),
    entry + '&loginto=tsinghua', entry + '&beforepage=', entry + '&isFront=1', entry + '#fragment', entry + '\n',
  ]) assert.equal(parseThesisLogin(url), null, url);
  for (const destination of [
    'https://evil.test/', '//evil.test/', '/%2fevil.test/', '/%252fevil.test/',
    '/\\evil.test/', '/%5cevil.test/', '/%255cevil.test/', '/qh/../logout', '/qh/%2e%2e/logout',
    '/qh/%252e%252e/logout', '/qh/thesis/toLogin/', '/qh/thesis/tsinghua/Login?ticket=a', '/qh/thesis/logout',
    '/qh/test#fragment', '/qh/test\r\nX-Test:bad', '/qh/test%250a', '/qh/%invalid', '/' + 'a'.repeat(4096),
  ]) assert.equal(parseThesisLogin(entry + encodeURIComponent(destination)), null, destination);
  assert.equal(parseThesisLogin(null), null);
});

test('thesis accepts only its fixed ticket callback and preserves encoded ticket bytes', () => {
  assert.equal(normalizeThesisCallback(callback), callback);
  assert.equal(normalizeThesisCallback(callback.replace('https:', 'http:')), callback);
  const encoded = THESIS_ORIGIN + '/qh/thesis/tsinghua/Login?ticket=official%2Bticket%2Fdata%3D%3D';
  assert.equal(normalizeThesisCallback(encoded), encoded);
});

test('thesis rejects callback confusion, repeat parameters, invalid and oversized tickets', () => {
  for (const url of [
    callback.replace('newetds.', 'evil.'), callback.replace('newetds.lib.tsinghua.edu.cn', 'newetds.lib.tsinghua.edu.cn.evil.test'),
    callback.replace('newetds.lib.tsinghua.edu.cn', 'user@newetds.lib.tsinghua.edu.cn'),
    callback.replace('newetds.lib.tsinghua.edu.cn', 'newetds.lib.tsinghua.edu.cn:443'), callback.replace('https:', 'ftp:'),
    callback.replace('/qh/thesis/tsinghua/Login', '/qh/thesis/tsinghua/login'),
    callback.replace('/qh/thesis/tsinghua/Login', '/qh/thesis/tsinghua/Login/'),
    callback.replace('/qh/thesis/tsinghua/Login', '/qh/thesis/tsinghua/../tsinghua/Login'),
    callback.replace('/qh/thesis/tsinghua/Login', '/qh/thesis/tsinghua/%4cogin'),
    callback.replace('ticket=', 'Ticket='), callback.replace('ticket=', '%74icket='),
    callback + '&ticket=second', callback + '&beforepage=/', callback + '&redirect=https%3A%2F%2Fevil.test',
    callback + '#fragment', callback + '\n',
    ...['', 'ERROR', 'BAD_CREDENTIALS', 'a'.repeat(4097), 'one%0atwo', 'one%250atwo', 'one%5ctwo', 'one%255ctwo', 'one+two']
      .map(ticket => callback.replace('official-ticket-012345', ticket)),
  ]) assert.equal(normalizeThesisCallback(url), null, url);
  assert.equal(normalizeThesisCallback(null), null);
});
