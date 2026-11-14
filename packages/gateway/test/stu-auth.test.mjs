import test from 'node:test';
import assert from 'node:assert/strict';
import { STU_ORIGIN, parseStuAuthEntry, validStuCallback, normalizeStuCallback } from '../src/stuAuth.mjs';

const authorizePath = '/api/v2/authorize';
const entryPath = '/api/user/tsinghua-auth-redirect';
const callbackPath = '/api/user/tsinghua-auth-callback';
const clientId = 'RCHFIyPfkGKjXbzxalGZTD79Gl0';
const redirectUri = STU_ORIGIN + '/csnova/oauth_authorized';
const info9ClientId = 'rDG79bwkxagzdBRUlkMRe6dAiM8';
const info9RedirectUri = STU_ORIGIN + '/info/api/auth/callback';
const authorization = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, status: 'blank' });
const returnTo = authorizePath + '?' + authorization;
const makeEntry = value => STU_ORIGIN + entryPath + '?' + new URLSearchParams({ returnto: value });
const entry = makeEntry(returnTo);
const makeCallback = (value = returnTo, ticket = 'official-fixture-ticket') => STU_ORIGIN + callbackPath + '?' + new URLSearchParams({ returnto: value, ticket });

test('the official HTTP callback is upgraded only for the exact registered service and transaction', () => {
  const secure=makeCallback(),legacy=secure.replace('https:', 'http:');
  assert.equal(normalizeStuCallback(legacy,entry),secure);
  assert.equal(validStuCallback(legacy,entry),false);
  for(const value of [legacy.replace('stu.cs.', 'evil.cs.'),legacy.replace('stu.cs.tsinghua.edu.cn', 'stu.cs.tsinghua.edu.cn:80'),legacy.replace(callbackPath,callbackPath+'/'),legacy+'&returnto=bad']) {
    assert.equal(normalizeStuCallback(value,entry),null);
  }
});

test('the official entry retains its complete raw query and nested OAuth request', () => {
  const parsed = parseStuAuthEntry(entry);
  assert.equal(parsed.entry, entry);
  assert.equal(parsed.returnTo, returnTo);
  assert.equal(parsed.identityUrl,
    'https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/084cc75356bf414dcfb0e6e259081f4f/0?' + callbackPath + new URL(entry).search);
});

test('opaque OAuth state, nonce and PKCE survive without reserialization', () => {
  const params = new URLSearchParams(authorization);
  params.set('state', 'a+b/%25=你好');
  params.set('nonce', 'other-nonce');
  params.set('scope', 'openid profile');
  params.set('code_challenge', 'a'.repeat(43));
  params.set('code_challenge_method', 'S256');
  params.set('prompt', 'none');
  const nested = authorizePath + '?' + params;
  // Lowercase escaping is legal and must stay lowercase in the official entry.
  const input = makeEntry(nested).replaceAll('%2F', '%2f');
  const parsed = parseStuAuthEntry(input);
  assert.equal(parsed.entry, input);
  assert.equal(parsed.returnTo, nested);
  assert.ok(parsed.identityUrl.endsWith(new URL(input).search));
  assert.equal(validStuCallback(makeCallback(nested), input), true);
});

test('only registered authorization endpoints and client/redirect pairs are accepted', () => {
  const invalid = [
    returnTo.replace(clientId, 'another-client'),
    returnTo.replace('response_type=code', 'response_type=token'),
    returnTo.replace(encodeURIComponent(redirectUri), encodeURIComponent('https://evil.example/callback')),
    returnTo.replace(encodeURIComponent(redirectUri), encodeURIComponent(redirectUri + '/')),
    returnTo.replace(encodeURIComponent(redirectUri), encodeURIComponent('//evil.example/callback')),
    '/api/user/../v2/authorize?' + authorization,
    STU_ORIGIN + returnTo,
    '//stu.cs.tsinghua.edu.cn' + returnTo,
    returnTo + '#fragment',
    returnTo + '&returnto=https%3A%2F%2Fevil.example',
    returnTo + '&client_id=' + clientId,
    returnTo + '&state=one&state=two',
    returnTo + '&code_challenge_method=S256',
    returnTo + '&code_challenge=short&code_challenge_method=S256',
  ];
  for (const value of invalid) assert.equal(parseStuAuthEntry(makeEntry(value)), null, value);
});

test('Info9 retains its exact OAuth transaction through the shared school callback', () => {
  const params = new URLSearchParams({
    response_type: 'code', client_id: info9ClientId, redirect_uri: info9RedirectUri,
    scope: 'all', state: 'info9+state/%25=fixture',
  });
  const nested = (authorizePath + '?' + params).replaceAll('%2F', '%2f');
  const input = makeEntry(nested);
  const parsed = parseStuAuthEntry(input);
  assert.ok(parsed);
  assert.equal(parsed.entry, input);
  assert.equal(parsed.returnTo, nested);
  assert.ok(parsed.identityUrl.endsWith(callbackPath + new URL(input).search));
  const callback = makeCallback(nested);
  assert.equal(validStuCallback(callback, input), true);
  assert.equal(normalizeStuCallback(callback.replace('https:', 'http:'), input), callback);
  assert.equal(validStuCallback(callback, entry), false);
  assert.equal(validStuCallback(makeCallback(), input), false);
  params.set('state', 'another-info9-tab');
  assert.equal(validStuCallback(makeCallback(authorizePath + '?' + params), input), false);
});

test('registered clients cannot exchange redirect destinations or accept unknown clients', () => {
  for (const [id, destination] of [
    [clientId, info9RedirectUri],
    [info9ClientId, redirectUri],
    ['unknown-client', info9RedirectUri],
    [info9ClientId, info9RedirectUri + '/'],
    [info9ClientId, 'https://evil.example/info/api/auth/callback'],
  ]) {
    const params = new URLSearchParams({
      response_type: 'code', client_id: id, redirect_uri: destination, scope: 'all', state: 'fixture',
    });
    assert.equal(parseStuAuthEntry(makeEntry(authorizePath + '?' + params)), null);
  }
});

test('entry validation rejects extra parameters, alternate authorities and controls', () => {
  const invalid = [
    entry + '&returnto=' + encodeURIComponent(returnTo),
    entry + '&extra=value', entry + '#fragment', entry.replace('https:', 'http:'),
    entry.replace('stu.cs.', 'other.cs.'), entry.replace(STU_ORIGIN, STU_ORIGIN + ':443'),
    entry.replace(STU_ORIGIN, 'https://user@stu.cs.tsinghua.edu.cn'),
    entry.replace(entryPath, '/api/user/../user/tsinghua-auth-redirect'),
    entry.replace(entryPath, '/api/user%2Ftsinghua-auth-redirect'),
    makeEntry(returnTo + '&state=%0d%0aInjected'),
    makeEntry(returnTo + '&state=%250d%250aInjected'),
    makeEntry(returnTo + '&state=%255c%255cevil.example'),
    entry + '\n', makeEntry(returnTo + '&nonce=\u0000'),
  ];
  for (const value of invalid) assert.equal(parseStuAuthEntry(value), null);
  assert.equal(parseStuAuthEntry(null), null);
  assert.equal(parseStuAuthEntry(''), null);
});

test('callback accepts only the exact transaction and a service-issued ticket shape', () => {
  assert.equal(validStuCallback(makeCallback(), entry), true);
  assert.equal(validStuCallback(makeCallback(returnTo, 'official+token/with=padding'), entry), false);
  assert.equal(validStuCallback(makeCallback(returnTo, 'official+token/with=='), entry), true);
  const invalid = [
    makeCallback(returnTo.replace('status=blank', 'status=other')),
    makeCallback(returnTo, ''), makeCallback(returnTo, 'ERROR'),
    makeCallback(returnTo, 'line\nbreak'), makeCallback(returnTo, 'a'.repeat(4097)),
    makeCallback().replace(callbackPath, callbackPath + '/'),
    makeCallback().replace(STU_ORIGIN, 'https://evil.example'),
    makeCallback().replace('https:', 'http:'),
    makeCallback().replace(STU_ORIGIN, STU_ORIGIN + ':443'),
    makeCallback() + '&ticket=second', makeCallback() + '&code=another',
    makeCallback() + '&returnto=' + encodeURIComponent(returnTo),
    makeCallback() + '#fragment',
  ];
  for (const value of invalid) assert.equal(validStuCallback(value, entry), false);
  assert.equal(validStuCallback(makeCallback(), makeEntry(returnTo + '&state=another-tab')), false);
});

test('same semantic OAuth values with different inner encoding remain distinct transactions', () => {
  const lowercaseEncoding = returnTo.replaceAll('%2F', '%2f');
  assert.notEqual(lowercaseEncoding, returnTo);
  assert.ok(parseStuAuthEntry(makeEntry(lowercaseEncoding)));
  assert.equal(validStuCallback(makeCallback(lowercaseEncoding), entry), false);
});
