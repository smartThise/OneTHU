#!/usr/bin/env node
/** Offline login-entry regressions. No credentials, cookies or real HTTP.
 * Run: node --import tsx tools/login-public-key-test.mjs */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { idLoginResponse, passwordlessEntry, login, roam, roamingWrapper, verifyAndReLogin, clearOutstandingLogin, getOutstandingLoginIdentity } from "../packages/info-lib/src/lib/core.ts";
import { setPlatformFetch, ResponseStatusError } from "../packages/info-lib/src/utils/network.ts";
import { LoginError, LoginPreparationError } from "../packages/info-lib/src/utils/error.ts";

const require = createRequire(new URL("../packages/info-lib/package.json", import.meta.url));
const { sm2 } = require("sm-crypto");
const key = sm2.generateKeyPairHex().publicKey;
const KEY = `<div id="sm2publicKey"> \n${key}\n </div>`;
const INPUT_KEY = `<input id="sm2publicKey" value=" ${key} ">`;
const CONFIRM = `<form action="/do/off/ui/auth/login/checkSingle"><input type="hidden" name="fingerPrint" value=""><input type="hidden" name="fingerGenPrint" value=""><input type="hidden" name="sig" value="fixture"></form>`;
const SUCCESS = `登录成功。正在重定向到<a href="https://oauth.tsinghua.edu.cn/fixture-callback">继续</a>`;
const ID_CHECK = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check";
// School React shell: the body has no server-rendered verification text.
const TWO_FACTOR_SHELL = '<html><head><title>二次认证</title></head><body><div id="root"></div><script src="/v2/dist/doubleauth/doubleAuth.bundle.js"></script></body></html>';
const helper = () => ({
  trustBrowser: true, fingerprint: "fixture-fingerprint", fingerGenPrint: "fixture-trust",
  userId: "123456", password: "fixture-only", mocked: () => false,
  clearCookieHandler: async () => {}, trustFingerprintNameHook: async () => "Fixture",
});
const reply = (text, url, status = 200) => ({ text, status, headers: [], finalUrl: url });
let count = 0;
async function check(name, run) { await run(); count++; console.log(`ok ${count} ${name}`); }
function errorIs(reason, stage) {
  return error => {
    assert.ok(error instanceof LoginPreparationError);
    assert.equal(error.code, "AUTH_PREPARATION_FAILED");
    assert.equal(error.reason, reason);
    if (stage) assert.equal(error.stage, stage);
    assert.doesNotMatch(JSON.stringify(error), /fixture-secret|https?:|<html|cookie/i);
    return true;
  };
}

await check("text and input keys trim and submit encrypted credentials once", async () => {
  for (const html of [KEY, INPUT_KEY]) {
    const calls = [];
    setPlatformFetch(async (url, init) => { calls.push({ url, ...init }); return reply(SUCCESS, url); });
    assert.equal(await idLoginResponse(helper(), html, ID_CHECK, "i_user"), SUCCESS);
    assert.equal(calls.length, 1);
    const form = new URLSearchParams(calls[0].body);
    assert.equal(form.get("i_user"), "123456");
    assert.notEqual(form.get("i_pass"), "fixture-only");
    assert.equal(form.get("fingerGenPrint"), "fixture-trust");
    assert.equal(form.has("singleLogin"), false);
    assert.equal(form.has("deviceName"), false);
  }
});
await check("ordinary repeated credential submissions reuse trust without auto-selecting session SSO", async () => {
  const calls = [];
  setPlatformFetch(async (url, init) => { calls.push(new URLSearchParams(init.body)); return reply(SUCCESS, url); });
  for (let i = 0; i < 3; i++) await idLoginResponse(helper(), KEY, ID_CHECK, "i_user");
  assert.equal(calls.length, 3);
  for (const body of calls) {
    assert.equal(body.get("fingerGenPrint"), "fixture-trust");
    assert.equal(body.get("fingerPrint"), "fixture-fingerprint");
    assert.equal(body.has("singleLogin"), false);
    assert.equal(body.has("deviceName"), false);
  }
  await idLoginResponse({ ...helper(), singleSignOn: true }, KEY, ID_CHECK, "i_user");
  assert.equal(calls[3].get("singleLogin"), "on");
  assert.equal(calls[3].get("deviceName"), "Fixture");
});
await check("gateway shells stop before credentials; post-submit failures are not replayed", async () => {
  const shell = '<html><body><script>var __vpn_hostname_data="fixture-secret";var __vpn_app_hostname_data="fixture-secret";</script></body></html>';
  for (const html of [shell, '<title>503 Service Unavailable</title><h1>503 Service Unavailable</h1>']) {
    let posts = 0;
    setPlatformFetch(async url => { posts++; return reply(html, url); });
    await assert.rejects(idLoginResponse(helper(), html, ID_CHECK, "i_user"), errorIs("gateway-unavailable"));
    assert.equal(posts, 0);
    await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), errorIs("gateway-unavailable"));
    assert.equal(posts, 1);
  }
  setPlatformFetch(async url => reply(SUCCESS, url));
  assert.equal(await idLoginResponse(helper(), shell + KEY, ID_CHECK, "i_user"), SUCCESS);
});
await check("confirmation fallback keeps returned key, then one credential POST", async () => {
  const calls = [];
  setPlatformFetch(async (url, init) => { calls.push({ url, ...init }); return reply(calls.length === 1 ? INPUT_KEY : SUCCESS, url); });
  assert.equal(await idLoginResponse(helper(), CONFIRM, ID_CHECK, "i_user"), SUCCESS);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith("/checkSingle"));
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get("fingerGenPrint"), "fixture-trust");
  assert.equal(body.get("i_rememberme"), "on");
  assert.equal(calls[1].url, ID_CHECK);
});
await check("confirmation loops never repeat a POST", async () => {
  let n = 0;
  setPlatformFetch(async url => { n++; return reply(CONFIRM, url); });
  await assert.rejects(idLoginResponse(helper(), CONFIRM, ID_CHECK, "i_user"), errorIs("confirmation-loop", "trusted-confirmation"));
  assert.equal(n, 1);
});
await check("credential rejection preserves the school note and never retries", async () => {
  let n = 0;
  const rejected = `${KEY}<p id="msg_note">密码错误</p>`;
  setPlatformFetch(async url => { n++; return reply(rejected, url); });
  await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), e => e.message === "密码错误");
  assert.equal(n, 1);
});
await check("credential POST without a school note cannot produce a blank login error", async () => {
  setPlatformFetch(async url => reply("<main>WebVPN portal fixture-secret</main>", url));
  await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), errorIs("unexpected-page"));
  setPlatformFetch(async url => reply(KEY, url));
  await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), errorIs("unexpected-page"));
});
await check("transport errors and HTTP 429 retain their original identity/status", async () => {
  const timeout = new Error("fixture timeout");
  setPlatformFetch(async () => { throw timeout; });
  await assert.rejects(idLoginResponse(helper(), CONFIRM, ID_CHECK, "i_user"), e => e === timeout);
  setPlatformFetch(async url => reply("busy", url, 429));
  await assert.rejects(idLoginResponse(helper(), CONFIRM, ID_CHECK, "i_user"), e => e instanceof ResponseStatusError && e.status === 429);
});
await check("unsafe confirmation actions cannot send hidden fields", async () => {
  let n = 0;
  setPlatformFetch(async () => { n++; throw new Error("must not send"); });
  for (const action of ["https://evil.example/checkSingle", "http://id.tsinghua.edu.cn/security_check", "//evil.example/checkSingle", "https://id.tsinghua.edu.cn:444/security_check", "https://id.tsinghua.edu.cn@evil.example/security_check", "/not-an-auth-endpoint"]) {
    const html = `<form action="${action}"><input name="fingerPrint"><input name="sig" value="fixture-secret"></form>`;
    await assert.rejects(idLoginResponse(helper(), html, ID_CHECK, "i_user"), errorIs("unsafe-confirmation", "trusted-confirmation"));
  }
  assert.equal(n, 0);
});
await check("known security_check confirmation and username scheme work", async () => {
  const calls = [];
  setPlatformFetch(async (url, init) => { calls.push({ url, ...init }); return reply(calls.length === 1 ? KEY : "<main>账号设置</main>", url); });
  assert.equal(await idLoginResponse(helper(), '<form action="https://id.tsinghua.edu.cn/security_check"><input name="fingerPrint"></form>', "https://id.tsinghua.edu.cn/security_check", "username"), "<main>账号设置</main>");
  assert.equal(calls.length, 2);
  assert.equal(new URLSearchParams(calls[1].body).get("username"), "123456");
  assert.equal(new URLSearchParams(calls[1].body).has("i_user"), false);
});
await check("already successful and 2FA entry pages require no public key", async () => {
  setPlatformFetch(async () => { throw new Error("must not send"); });
  assert.equal(await idLoginResponse(helper(), SUCCESS, ID_CHECK, "i_user"), SUCCESS);
  assert.equal(await idLoginResponse(helper(), "<main>账号设置</main>", ID_CHECK, "username"), "<main>账号设置</main>");
  assert.equal(await idLoginResponse(helper(), "<main>二次认证</main>", ID_CHECK, "i_user"), "<main>二次认证</main>");
  await assert.rejects(idLoginResponse(helper(), "<main>账号设置</main>", ID_CHECK, "i_user"), errorIs("unexpected-page"));
});
await check("credential POST can enter 2FA without a second submission", async () => {
  let n = 0;
  setPlatformFetch(async url => { n++; return reply("<main>二次认证</main>", url); });
  assert.match(await idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), /二次认证/);
  assert.equal(n, 1);
});
await check("title-only React 2FA shell is recognized before and after credentials", async () => {
  for (const shell of [TWO_FACTOR_SHELL, TWO_FACTOR_SHELL.replace("二次认证", "&#20108;&#27425;&#35748;&#35777;")]) {
    let posts = 0;
    setPlatformFetch(async url => { posts++; return reply(shell, url); });
    assert.equal(await idLoginResponse(helper(), shell, ID_CHECK, "i_user"), shell);
    assert.equal(posts, 0);
    assert.equal(await idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), shell);
    assert.equal(posts, 1);
  }
});
await check("shared 2FA scripts, hidden text and password forms are not verification pages", async () => {
  const scripts = '<script src="/v2/dist/doubleauth/doubleAuth.bundle.js"></script><script>const title="二次认证"</script><p hidden>二次认证</p><main>请登录</main>';
  setPlatformFetch(async url => reply(scripts, url));
  await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), errorIs("unexpected-page"));
  for (const page of [KEY + '<p>二次认证说明</p>', TWO_FACTOR_SHELL.replace('<div id="root"></div>', '<input name="i_pass">')]) {
    setPlatformFetch(async url => reply(page, url));
    await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), errorIs(page.includes("sm2publicKey") ? "unexpected-page" : "missing-public-key"));
  }
  setPlatformFetch(async url => reply(TWO_FACTOR_SHELL.replace('<div id="root"></div>', '<p id="msg_note">密码错误</p>'), url));
  await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), e => e instanceof LoginError && e.message === "密码错误");
});
await check("malformed key is a safe classified failure", async () => {
  setPlatformFetch(async () => { throw new Error("must not send"); });
  await assert.rejects(idLoginResponse(helper(), '<div id="sm2publicKey">fixture-secret</div>', ID_CHECK, "i_user"), errorIs("invalid-public-key"));
});
await check("keyless empty/login/blocked/other pages receive stable reasons", async () => {
  for (const [html, reason] of [[" ", "empty-response"], ['<input name="i_pass">', "missing-public-key"], ["<body>Too many requests</body>", "access-restricted"], ["<body>WebVPN portal fixture-secret</body>", "unexpected-page"]]) {
    await assert.rejects(idLoginResponse(helper(), html, ID_CHECK, "i_user"), errorIs(reason, "credential-entry"));
  }
});
await check("trust limit is based on visible error text, including confirmation responses", async () => {
  for (const html of ['<p id="msg_note">认证因子数量已达到上限</p>', "<main>信任设备过多，请删除旧设备</main>"]) {
    await assert.rejects(idLoginResponse(helper(), html, ID_CHECK, "i_user"), errorIs("trust-limit", "credential-entry"));
  }
  setPlatformFetch(async url => reply('<p id="msg_note">受信设备数量已达到上限</p>', url));
  await assert.rejects(idLoginResponse(helper(), CONFIRM, ID_CHECK, "i_user"), errorIs("trust-limit", "trusted-confirmation"));
  await assert.rejects(idLoginResponse(helper(), KEY, ID_CHECK, "i_user"), errorIs("trust-limit", "credential-entry"));
});
await check("script/style/hidden trust-limit strings do not classify the page", async () => {
  const hidden = '<script>const message="信任设备达到上限"</script><style>/*受信设备过多*/</style><p hidden>认证因子数量上限</p>';
  await assert.rejects(idLoginResponse(helper(), hidden + "<main>请登录</main>", ID_CHECK, "i_user"), errorIs("unexpected-page"));
  setPlatformFetch(async url => reply(SUCCESS, url));
  assert.equal(await idLoginResponse(helper(), KEY + '<p>信任设备数量上限说明</p>', ID_CHECK, "i_user"), SUCCESS);
});
await check("trustBrowser=false cannot silently post a confirmation", async () => {
  setPlatformFetch(async () => { throw new Error("must not send"); });
  assert.equal(await passwordlessEntry({ ...helper(), trustBrowser: false }, CONFIRM), null);
});
await check("authenticated roaming skips credential POST and password rejection is not replayed", async () => {
  const calls = [];
  setPlatformFetch(async (url, init) => { calls.push({ url, ...init }); return reply(calls.length === 1 ? SUCCESS : "info page", url); });
  assert.equal(await roam(helper(), "id", "fixture"), "info page");
  assert.equal(calls.filter(c => c.method === "POST").length, 0);
  calls.length = 0;
  setPlatformFetch(async (url, init) => { calls.push({ url, ...init }); return reply(init.method === "POST" ? '<p id="msg_note">密码错误</p>' : KEY, url); });
  await assert.rejects(roam(helper(), "id", "fixture"));
  assert.equal(calls.filter(c => c.method === "POST").length, 1);
});
await check("wrapper stops initial authentication/admission failures without starting roaming or login", async () => {
  const errors = [new LoginError("fixture rejection"), new LoginPreparationError("trust-limit"), new ResponseStatusError("fixture 429", 429), new ResponseStatusError("fixture 403", 403), Object.assign(new Error("fixture cooldown"), { code: "AUTH_COOLDOWN" })];
  for (const policy of [undefined, "id"]) {
    for (const error of errors) {
      let requests = 0;
      setPlatformFetch(async () => { requests++; throw new Error("must not send"); });
      await assert.rejects(roamingWrapper(helper(), policy, "fixture", async () => { throw error; }), e => e === error);
      assert.equal(requests, 0);
    }
  }
});
await check("wrapper does not repeat a failed credential POST or enter full login afterward", async () => {
  const errors = [new LoginError("fixture wrong password"), new LoginPreparationError("trust-limit"), new ResponseStatusError("fixture 429", 429), new ResponseStatusError("fixture 403", 403), Object.assign(new Error("fixture cooldown"), { code: "AUTH_COOLDOWN" })];
  for (const error of errors) {
    const calls = [];
    setPlatformFetch(async (url, init) => {
      calls.push({ url, ...init });
      if (init.method === "POST") throw error;
      return reply(KEY, url);
    });
    await assert.rejects(roamingWrapper(helper(), "id", "fixture", async () => { throw new Error("resource unavailable"); }), e => e === error);
    assert.equal(calls.length, 2);
    assert.equal(calls.filter(c => c.method === "POST").length, 1);
  }
});
await check("wrapper outer catch preserves a protected error from the recovered operation", async () => {
  const error = new LoginError("fixture permission rejection");
  let operations = 0, requests = 0;
  setPlatformFetch(async url => { requests++; return reply(requests === 1 ? SUCCESS : "resource page", url); });
  await assert.rejects(roamingWrapper(helper(), "id", "fixture", async () => {
    if (++operations === 1) throw new Error("resource session expired");
    throw error;
  }), e => e === error);
  assert.equal(operations, 2);
  assert.equal(requests, 2);
});
await check("wrapper retains the ordinary resource/network roaming recovery", async () => {
  let operations = 0, requests = 0;
  setPlatformFetch(async url => {
    requests++;
    if (requests === 1) throw new Error("fixture transient transport failure");
    return reply(requests === 2 ? SUCCESS : "resource page", url);
  });
  assert.equal(await roamingWrapper(helper(), "id", "fixture", async response => {
    if (++operations === 1) throw new Error("resource session expired");
    return response;
  }), "resource page");
  assert.equal(operations, 2);
  assert.equal(requests, 3);
});
await check("a restricted session probe cannot escalate ordinary resource failure into a password login", async () => {
  let requests = 0, admissions = 0;
  const h = { ...helper(), beforeLoginAttemptHook: async () => { admissions++; } };
  setPlatformFetch(async url => { requests++; return reply("restricted", url, 429); });
  await assert.rejects(roamingWrapper(h, undefined, "fixture", async () => { throw new Error("resource session expired"); }), e => e.status === 429);
  assert.equal(requests, 1);
  assert.equal(admissions, 0);
});
await check("session probe transport, HTTP errors and malformed responses cannot submit credentials", async () => {
  const cases = ["network", "403", "429", "500", "502", "503", "504", "cookie-empty", "cookie-guide", "invalid-json", "empty-object", "wrong-owner"];
  for (const shape of cases) {
    clearOutstandingLogin();
    let posts = 0, admissions = 0;
    const h = { ...helper(), beforeLoginAttemptHook: async () => { admissions++; } };
    setPlatformFetch(async (url, init) => {
      if (init.method === "POST") posts++;
      if (shape === "network") throw new TypeError("fixture connection failure");
      if (/^\d+$/.test(shape)) return reply("unavailable", url, Number(shape));
      if (url.includes("/wengine-vpn/cookie")) {
        return reply(shape === "cookie-empty" ? "" : shape === "cookie-guide" ? '<script>var __vpn_hostname_data="fixture";var __vpn_app_hostname_data="fixture";</script>' : "XSRF-TOKEN=fixture-csrf;", url);
      }
      return reply(shape === "invalid-json" ? "<main>Upstream unavailable</main>" : shape === "wrong-owner" ? '{"object":{"ryh":"654321"}}' : '{"object":null}', url);
    });
    await assert.rejects(verifyAndReLogin(h));
    assert.equal(posts, 0, shape);
    assert.equal(admissions, 0, shape);
  }
});
await check("only confirmed HTTP 401, login pages and explicit JSON expiry permit normal recovery", async () => {
  for (const shape of ["401", "cookie-login", "user-login", "json-expired", "alive"]) {
    clearOutstandingLogin();
    let posts = 0, admissions = 0;
    const h = { ...helper(), beforeLoginAttemptHook: async () => { admissions++; } };
    setPlatformFetch(async (url, init) => {
      if (init.method === "POST") posts++;
      if (url.includes("/wengine-vpn/cookie")) {
        if (shape === "401") return reply("expired", url, 401);
        return reply(shape === "cookie-login" ? '<a href="https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/fixture/0">Sign in</a>' : "XSRF-TOKEN=fixture-csrf;", url);
      }
      if (url.includes("/grjbxx")) return reply(shape === "user-login" ? KEY : shape === "json-expired" ? '{"status":401}' : '{"object":{"ryh":"123456"}}', url);
      if (url.includes("/login?oauth_login=true")) return reply(KEY, url);
      if (url === ID_CHECK || url.includes("/do/off/ui/auth/login/form/")) return reply(SUCCESS, url);
      if (url.endsWith("/fixture-callback")) return reply("portal", "https://webvpn.tsinghua.edu.cn/");
      if (url.includes("/lb-auth/lbredirect?")) return reply("info page", url);
      throw new Error("Unexpected fixture recovery request");
    });
    assert.equal(await verifyAndReLogin(h), shape !== "alive", shape);
    assert.equal(posts, shape === "alive" ? 0 : 1, shape);
    assert.equal(admissions, shape === "alive" ? 0 : 1, shape);
  }
});
await check("read-only verification checks the owner and never starts a login for expired sessions", async () => {
  for (const expired of [false, true]) {
    clearOutstandingLogin();
    let posts = 0;
    const h = helper();
    setPlatformFetch(async (url, init) => {
      if (init.method === "POST") posts++;
      if (url.includes("/wengine-vpn/cookie")) return reply("XSRF-TOKEN=fixture-csrf;", url);
      if (url.includes("/grjbxx")) return reply(expired ? '{"status":401}' : '{"object":{"ryh":"123456"}}', url);
      throw Error("Read-only verification must not visit a login entry");
    });
    if (expired) {
      await assert.rejects(verifyAndReLogin(h, {allowLogin: false}), {code: "AUTH_SESSION_EXPIRED"});
    } else {
      assert.equal(await verifyAndReLogin(h, {allowLogin: false}), false);
    }
    assert.equal(posts, 0);
  }
});
await check("service HTTP 5xx stops at the failed operation before attempting roaming", async () => {
  for (const status of [500, 502, 503, 504]) {
    let requests = 0;
    const error = new ResponseStatusError("fixture service unavailable", status);
    setPlatformFetch(async () => { requests++; throw Error("Must not start authentication"); });
    await assert.rejects(roamingWrapper(helper(), "id", "fixture", async () => { throw error; }), e => e === error);
    assert.equal(requests, 0);
  }
});

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
await check("attempt identity is synchronous, immutable to callers, shared on join and cleared on settle", async () => {
  clearOutstandingLogin();
  assert.equal(getOutstandingLoginIdentity(), null);
  const gate = deferred();
  let hookIdentity;
  const h = { ...helper(), beforeLoginAttemptHook: async () => { hookIdentity = getOutstandingLoginIdentity(); await gate.promise; } };
  setPlatformFetch(async url => reply("busy", url, 503));
  const first = login(h, "123456", "fixture-only").catch(e => e);
  const identity = getOutstandingLoginIdentity();
  assert.equal(identity.userId, "123456");
  assert.ok(identity.attemptId > 0);
  const joined = login(h, "123456", "fixture-only").catch(e => e);
  assert.deepEqual(getOutstandingLoginIdentity(), identity);
  identity.userId = "654321";
  assert.equal(getOutstandingLoginIdentity().userId, "123456");
  await Promise.resolve();
  assert.deepEqual(hookIdentity, getOutstandingLoginIdentity());
  gate.resolve();
  await Promise.all([first, joined]);
  assert.equal(getOutstandingLoginIdentity(), null);
  const nextGate = deferred();
  h.beforeLoginAttemptHook = async () => nextGate.promise;
  const next = login(h, "123456", "fixture-only").catch(e => e);
  assert.equal(getOutstandingLoginIdentity().attemptId, identity.attemptId + 1);
  clearOutstandingLogin();
  assert.equal(getOutstandingLoginIdentity(), null);
  nextGate.resolve();
  await next;
});
await check("login admission is shared, runs before cookies/HTTP and a join never re-runs it", async () => {
  clearOutstandingLogin();
  const gate = deferred();
  let hooks = 0, clears = 0, requests = 0;
  const h = { ...helper(), beforeLoginAttemptHook: async () => { hooks++; await gate.promise; }, clearCookieHandler: async () => { clears++; } };
  setPlatformFetch(async url => { requests++; return reply("unavailable", url, 503); });
  const first = login(h, "123456", "fixture-only");
  const joined = login(h, "123456", "fixture-only");
  const settled = Promise.allSettled([first, joined]);
  await Promise.resolve();
  assert.deepEqual([hooks, clears, requests], [1, 0, 0]);
  gate.resolve();
  assert.ok((await settled).every(r => r.status === "rejected"));
  assert.deepEqual([hooks, clears, requests], [1, 1, 1]);
});
await check("rejected admission does not clear cookies or send a request", async () => {
  clearOutstandingLogin();
  const denied = new Error("fixture cooldown");
  let clears = 0;
  const h = { ...helper(), beforeLoginAttemptHook: async () => { throw denied; }, clearCookieHandler: async () => { clears++; } };
  setPlatformFetch(async () => { throw new Error("must not send"); });
  await assert.rejects(login(h, "123456", "fixture-only"), e => e === denied);
  assert.equal(clears, 0);
});
await check("joining cannot overwrite the first attempt's account or password", async () => {
  clearOutstandingLogin();
  const gate = deferred();
  const h = { ...helper(), beforeLoginAttemptHook: async () => gate.promise };
  setPlatformFetch(async url => reply("busy", url, 503));
  const first = login(h, "123456", "first-fixture").catch(e => e);
  await assert.rejects(login(h, "654321", "other-fixture"), e => e.code === "AUTH_IN_PROGRESS");
  const sameAccount = login(h, "123456", "replacement-fixture").catch(e => e);
  assert.equal(h.userId, "123456");
  assert.equal(h.password, "first-fixture");
  gate.resolve();
  await Promise.all([first, sameAccount]);
});
await check("an old attempt settling cannot detach the newer outstanding attempt", async () => {
  clearOutstandingLogin();
  const oldReply = deferred(), newGate = deferred();
  let hooks = 0, requests = 0;
  const h = { ...helper(), beforeLoginAttemptHook: async () => { if (++hooks === 2) await newGate.promise; } };
  setPlatformFetch(async url => { requests++; return requests === 1 ? oldReply.promise : reply("busy", url, 503); });
  const old = login(h, "123456", "fixture-only").catch(e => e);
  while (requests < 1) await Promise.resolve();
  clearOutstandingLogin();
  const newer = login(h, "123456", "fixture-only").catch(e => e);
  const newIdentity = getOutstandingLoginIdentity();
  await Promise.resolve();
  oldReply.resolve(reply("<main>unexpected page</main>", "https://id.tsinghua.edu.cn/"));
  await old;
  assert.deepEqual(getOutstandingLoginIdentity(), newIdentity);
  const joined = login(h, "123456", "fixture-only").catch(e => e);
  await Promise.resolve();
  assert.equal(hooks, 2);
  newGate.resolve();
  await Promise.all([newer, joined]);
  assert.equal(requests, 2);
});
await check("an old timeout cannot detach the newer outstanding attempt", async () => {
  clearOutstandingLogin();
  const setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
  const timers = [];
  globalThis.setTimeout = (fn, delay, ...args) => {
    if (delay !== 180_000) return setTimer(fn, delay, ...args);
    const timer = { run: fn, cleared: false }; timers.push(timer); return timer;
  };
  globalThis.clearTimeout = timer => {
    if (timers.includes(timer)) timer.cleared = true;
    else clearTimer(timer);
  };
  try {
    const oldReply = deferred(), newGate = deferred();
    let hooks = 0, requests = 0;
    const h = { ...helper(), beforeLoginAttemptHook: async () => { if (++hooks === 2) await newGate.promise; } };
    setPlatformFetch(async url => ++requests === 1 ? oldReply.promise : reply("busy", url, 503));
    const old = login(h, "123456", "fixture-only").catch(e => e);
    while (requests < 1) await Promise.resolve();
    clearOutstandingLogin();
    const newer = login(h, "123456", "fixture-only").catch(e => e);
    const newIdentity = getOutstandingLoginIdentity();
    timers[0].run();
    assert.match((await old).message, /timeout/i);
    assert.deepEqual(getOutstandingLoginIdentity(), newIdentity);
    const joined = login(h, "123456", "fixture-only").catch(e => e);
    await Promise.resolve();
    assert.equal(hooks, 2);
    newGate.resolve();
    await Promise.all([newer, joined]);
    oldReply.resolve(reply("old page", "https://id.tsinghua.edu.cn/"));
    assert.equal(requests, 2);
    assert.ok(timers.every(t => t.cleared));
  } finally {
    globalThis.setTimeout = setTimer;
    globalThis.clearTimeout = clearTimer;
  }
});
await check("full login keeps 2FA hooks, uses one OAuth entry and completes authenticated roaming", async () => {
  clearOutstandingLogin();
  const calls = [], actions = [];
  let successes = 0;
  const h = { ...helper(), beforeLoginAttemptHook: async () => {}, afterLoginSuccessHook: () => { successes++; }, twoFactorMethodHook: async () => "totp", twoFactorAuthHook: async () => "123456", trustFingerprintHook: async () => false };
  setPlatformFetch(async (url, init) => {
    calls.push({ url, ...init });
    if (url.includes("/login?oauth_login=true")) return reply(KEY, url);
    if (url === ID_CHECK) return reply(TWO_FACTOR_SHELL.replace("二次认证", "&#20108;&#27425;&#35748;&#35777;"), url);
    if (url.endsWith("/b/doubleAuth/login")) {
      const action = new URLSearchParams(init.body).get("action"); actions.push(action);
      return reply(JSON.stringify({ result: "success", object: action === "FIND_APPROACHES" ? { hasTotp: true } : { redirectUrl: "/fixture-finish" } }), url);
    }
    if (url.endsWith("/fixture-finish") || url.includes("/do/off/ui/auth/login/form/")) return reply(SUCCESS, url);
    if (url.endsWith("/fixture-callback")) return reply("portal", "https://webvpn.tsinghua.edu.cn/");
    if (url.includes("/lb-auth/lbredirect?")) return reply("info page", url);
    throw new Error("Unexpected fixture route");
  });
  await login(h, "123456", "fixture-only");
  assert.equal(calls.filter(c => c.url.includes("oauth_login=true")).length, 1);
  assert.equal(calls.filter(c => c.url === ID_CHECK).length, 1);
  assert.deepEqual(actions, ["FIND_APPROACHES", "SEND_CODE", "VERITY_TOTP_CODE"]);
  assert.equal(successes, 1);
});
await check("a live WebVPN gateway detour cannot block re-authentication", async () => {
  clearOutstandingLogin();
  const calls = [];
  const PORTAL = '<main>WebVPN 门户</main>';
  const LOGOUT = "https://webvpn.tsinghua.edu.cn/logout";
  const OAUTH = "https://webvpn.tsinghua.edu.cn/login?oauth_login=true";
  setPlatformFetch(async (url, init) => {
    calls.push({ url, ...init });
    if (url === OAUTH) return calls.filter(c => c.url === OAUTH).length === 1 ? reply(PORTAL, "https://webvpn.tsinghua.edu.cn/") : reply(KEY, url);
    if (url === LOGOUT) return reply("logged out", url);
    if (url === ID_CHECK) return reply(SUCCESS, url);
    if (url.endsWith("/fixture-callback")) return reply("portal", "https://webvpn.tsinghua.edu.cn/");
    if (url.includes("/do/off/ui/auth/login/form/")) return reply(SUCCESS, url);
    if (url.includes("/lb-auth/lbredirect?")) return reply("info page", url);
    throw new Error("Unexpected fixture route");
  });
  const h = { ...helper(), beforeLoginAttemptHook: async () => {}, afterLoginSuccessHook: () => {} };
  await login(h, "123456", "fixture-only");
  assert.equal(calls.filter(c => c.url === LOGOUT).length, 1, "gateway session ends before the OAuth retry");
  assert.equal(calls.filter(c => c.url === OAUTH).length, 2, "entry retried exactly once");
  assert.equal(calls.filter(c => c.url === ID_CHECK).length, 1, "credentials submitted once after recovery");
  assert.ok(calls.findIndex(c => c.url === LOGOUT) > calls.findIndex(c => c.url === OAUTH), "logout follows the detour");
});
await check("the public ID form is used when the gateway still detours", async () => {
  clearOutstandingLogin();
  const calls = [];
  const PORTAL = '<main>WebVPN 门户</main>';
  const OAUTH = "https://webvpn.tsinghua.edu.cn/login?oauth_login=true";
  const ID_FORM = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/";
  setPlatformFetch(async (url, init) => {
    calls.push({ url, ...init });
    if (url === OAUTH) return reply(PORTAL, "https://webvpn.tsinghua.edu.cn/");
    if (url === "https://webvpn.tsinghua.edu.cn/logout") return reply("logged out", url);
    if (url === ID_FORM) return reply(KEY, url);
    if (url === ID_CHECK) return reply(SUCCESS, url);
    if (url.endsWith("/fixture-callback")) return reply("portal", "https://webvpn.tsinghua.edu.cn/");
    if (url.includes("/do/off/ui/auth/login/form/")) return reply(SUCCESS, url);
    if (url.includes("/lb-auth/lbredirect?")) return reply("info page", url);
    throw new Error("Unexpected fixture route");
  });
  const h = { ...helper(), beforeLoginAttemptHook: async () => {}, afterLoginSuccessHook: () => {} };
  await login(h, "123456", "fixture-only");
  assert.equal(calls.filter(c => c.url === ID_FORM).length, 1, "direct ID form reached without WebVPN");
  assert.equal(calls.filter(c => c.url === ID_CHECK).length, 1);
});
console.log(`${count} login public-key regressions passed (offline).`);
