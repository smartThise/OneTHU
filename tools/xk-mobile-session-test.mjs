/** Actual selection client and GUI provider with native cookie semantics.
 * Synthetic data only. The transport discards JS Cookie headers like Tauri. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, MemoryCookieJar } from '../packages/core/src/http.ts';
import { webvpnWrap, decodeUrl } from '../packages/core/src/crypto/webvpn.ts';
import { getXkSelectedFull, resolveZhjwxkSemester } from '../packages/core/src/zhjwxk/client.ts';
import { createXkSessionProvider } from '../apps/desktop/src/lib/xkSession.ts';
import fs from 'node:fs';
import ts from 'typescript';

const origin = 'http://zhjwxk.cic.tsinghua.edu.cn';
const semester = '2099-2100-2';
const bootstrap = '<script>var __vpn_hostname_data="webvpn.tsinghua.edu.cn";var __vpn_app_hostname_data="fixture-selection";var __vpn_app_protocol_data="http";</script>';
const home = bootstrap + `<frameset><frame src="/xk/top.html?p_xnxq=${semester}"></frameset>`;
const selected = bootstrap + '<table><tr class="trr1"><th></th><th>Course Code</th><th>Course Name</th><th>Section</th><th>Instructor</th><th>Credits</th><th>Class Time</th></tr>'
  + `<tr class="trr2"><td><input name="p_del_id" value="${semester};TEST101;1;"></td><td>TEST101</td><td>Fixture course</td><td>1</td><td>Fixture instructor</td><td>3</td><td>Tuesday 08:00</td></tr></table>`;

function fixture({ seedBlocked = false, alreadyAuthenticated = false } = {}) {
  const nativeJar = new MemoryCookieJar();
  const requests = [];
  const seeds = [];
  let epoch = 7;
  nativeJar.setRaw(new URL('https://info.tsinghua.edu.cn/'), 'JSESSIONID=other-service; Path=/; Secure');
  if (alreadyAuthenticated) nativeJar.setRaw(new URL(webvpnWrap(origin + '/')), `JSESSIONID=fixture-selection; Path=${new URL(webvpnWrap(origin + '/')).pathname}; Secure`);
  const fetch = async (url, init = {}) => {
    const wire = new URL(url);
    const logical = wire.pathname === '/wengine-vpn/cookie' ? wire : new URL(decodeUrl(url) || url);
    requests.push({ path: logical.pathname, method: init.method || 'GET' });
    if (logical.pathname === '/wengine-vpn/cookie') {
      return new Response('JSESSIONID=fixture-selection', { headers: { 'x-onethu-cookie-epoch': String(epoch) } });
    }
    // Only the native jar determines authentication. init.headers.Cookie is ignored.
    const authenticated = nativeJar.getCookies(wire).some(cookie => cookie.value === 'fixture-selection');
    return new Response(authenticated ? (logical.searchParams.get('m') === 'main' ? home : selected) : bootstrap,
      { headers: { 'x-onethu-cookie-epoch': String(epoch) } });
  };
  const http = new HttpClient({ fetch });
  http.webVPNEncoder = webvpnWrap;
  http.nativeSeedHook = async (url, pair, path, sourceEpoch) => {
    assert.equal(sourceEpoch, epoch);
    if (seedBlocked) throw Object.assign(new Error('AUTH_SESSION_CHANGED'), { code: 'AUTH_SESSION_CHANGED' });
    await Promise.resolve();
    seeds.push({ url, path });
    nativeJar.setRaw(new URL(url), `${pair}; Path=${path}`);
  };
  const provider = createXkSessionProvider({
    http,
    isoFetch: fetch,
    identity: () => ({ username: 'fixture-owner', password: '', fingerprint: 'fixture-phone', finger3: 'fixture-trust' }),
    // Android has no resident CLI publication callback.
  });
  return { provider, nativeJar, requests, seeds };
}

test('mobile isolated selection seeds the native jar and loads without a CLI or credential POST', async () => {
  const f = fixture();
  const session = f.provider();
  assert.equal(await resolveZhjwxkSemester(session), semester);
  const rows = await getXkSelectedFull(f.provider(), { semester });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Fixture course');
  assert(f.seeds.some(seed => seed.url === origin + '/'));
  assert(f.seeds.some(seed => seed.url === webvpnWrap(origin + '/')));
  assert(f.requests.every(request => request.method === 'GET'));
  assert(!f.requests.some(request => request.path === '/xklogin.do' || request.path.includes('/auth/login/')));
  assert.equal(f.nativeJar.getCookies(new URL('https://info.tsinghua.edu.cn/'))[0].value, 'other-service');
});

test('a live native selection session is reused even when the JS identity jar is empty', async () => {
  const f = fixture({ alreadyAuthenticated: true });
  assert.equal(await resolveZhjwxkSemester(f.provider()), semester);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, '/xkBks.vxkBksXkbBs.do');
  assert.equal(f.seeds.length, 0);
});

test('a rejected native cookie seed stops selection before replay or credential recovery', async () => {
  const f = fixture({ seedBlocked: true });
  await assert.rejects(resolveZhjwxkSemester(f.provider()), { code: 'AUTH_SESSION_CHANGED' });
  assert.equal(f.seeds.length, 0);
  assert(!f.requests.some(request => request.path === '/xklogin.do' || request.path.includes('/auth/login/')));
});

test('mobile selection authentication failures leave loading with a visible retryable error', async () => {
  const source = fs.readFileSync(new URL('../apps/desktop/src/state/data.ts', import.meta.url), 'utf8');
  const file = ts.createSourceFile('data.ts', source, ts.ScriptTarget.Latest, true);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'commitCore') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert(callback, 'test must execute the production commitCore callback');
  const compiled = ts.transpileModule('const run=' + callback.getText(file) + ';return run;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  for (const recovered of [false, true]) {
    const states = [], errors = [];
    const failure = Object.assign(new Error('fixture selection session unavailable'), { code: 'XK_AUTH_REQUIRED' });
    const dependencies = {
      coreSeqRef: { current: 0 }, genRef: { current: 1 }, stageCartRef: { current: [] },
      xkSession: () => ({}), getXkSelectedFull: async () => { throw failure; },
      getQueueStatus: async () => [], getXkQueueData: async () => ({ map: {}, phase: false }), getXkPlan: async () => [],
      isAuthError: error => error?.code === 'XK_AUTH_REQUIRED',
      logPageError() {}, softRecover: async () => recovered,
      setCoreState: state => states.push(state), setError: error => errors.push(error),
      explainNetworkError: error => error.message,
    };
    const run = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
    assert.deepEqual(await run(semester, null, 1), []);
    assert.deepEqual(states, ['error']);
    assert.deepEqual(errors, [failure.message]);
  }
});
