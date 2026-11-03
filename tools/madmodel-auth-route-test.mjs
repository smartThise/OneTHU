/**
 * Executes the real MadModel state module against an isolated clock/registry/HTTP fixture.
 * No campus requests, real credentials, persistent browser state or native app are used.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import "./ts-resolve-register.mjs";
const i18n = await import("../apps/desktop/src/i18n/index.ts");

const source = readFileSync(new URL("../apps/desktop/src/state/madmodel.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const SITE = "https://madmodel.cs.tsinghua.edu.cn";
const TUNNEL = "https://webvpn.tsinghua.edu.cn/https/fixture-madmodel";
const wrap = (url) => url.startsWith(SITE) ? TUNNEL + url.slice(SITE.length) : url;
const epoch = 1_800_000_000_000;
const token = (hours = 12, id = "fixture") =>
  `fixture.${Buffer.from(JSON.stringify({ exp: epoch / 1000 + hours * 3600, id })).toString("base64url")}.signature`;
const response = (status, body, headers = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function fixture(patch = {}, handler = () => response(200, { success: true })) {
  let now = epoch;
  const rec = { settings: {
    provider: "madmodel", madmodelToken: token(), madmodelAt: String(now),
    madmodelBase: "", madmodelCookie: "", madmodelReachable: "1",
    madmodelReachableAt: String(now), madmodelVerifiedAt: String(now - 11 * 60_000), ...patch,
  } };
  const calls = [];
  const writes = [];
  const logs = [];
  let cookie = "fixture-cookie";
  let relogins = 0;
  let nativeEpoch = 1;
  const events = new Map();
  const intervals = [];
  const storage = new Map([["onethu.madmodel.models.v1", JSON.stringify({ at: now, ids: ["fixture-model"] })]]);
  const clients = {
    session: { username: "fixture-account" },
    logLine: async (line) => { logs.push(line); },
    http: {
      cookieHeaderFor: () => cookie,
      request: async (url, init) => {
        calls.push({ url, init });
        return handler(url, init, calls.length);
      },
    },
  };
  const exports = {};
  const imports = {
    "../i18n/index.js": i18n,
    "../lib/clients.js": clients,
    "@onethu/core": { webvpnWrap: wrap, webvpnDecodeUrl: (url) => url.startsWith(TUNNEL) ? SITE + url.slice(TUNNEL.length) : null },
    "../lib/transport.js": { nativeSessionEpoch: async () => nativeEpoch, assertNativeSessionEpoch: async (epoch) => { if (epoch !== nativeEpoch) throw new Error("AUTH_SESSION_CHANGED"); } },
    "../plugins/registry.js": {
      getPlugin: () => rec,
      updatePlugin: (_id, patch) => { writes.push(patch); Object.assign(rec, patch); },
    },
    "../lib/infoLib.js": { libEnsureSession: async () => { relogins++; return false; } },
  };
  const context = vm.createContext({
    exports, module: { exports },
    require: (id) => { assert.ok(id in imports, `Unexpected module: ${id}`); return imports[id]; },
    Date: class extends Date { static now() { return now; } },
    Response, URL, URLSearchParams, atob,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, val) => storage.set(key, val) },
    window: { addEventListener: (event, fn) => events.set(event, fn) },
    navigator: {},
    setInterval: (fn) => { intervals.push(fn); return { unref() {} }; },
  });
  vm.runInContext(compiled, context, { filename: "madmodel.fixture.cjs" });
  return {
    api: exports, rec, calls, writes, logs, intervals, events,
    advance: (ms) => { now += ms; },
    setCookie: (value) => { cookie = value; },
    relogins: () => relogins,
    changeAccount: () => { nativeEpoch++; clients.session.username = "replacement-account"; },
  };
}

let passed = 0;
async function test(name, run) {
  await run();
  passed++;
  console.log(`✓ ${name}`);
}

await test("recent verified key does not wait for a route probe or early renewal",async()=>{
 const f=fixture({madmodelVerifiedAt:String(epoch-1000)});
 assert.equal(await f.api.preflightMadModel(),null);
 assert.equal(f.calls.filter(call=>call.url.endsWith("/auth-login")).length,0);
});

for (const status of [403, 429, 500, 503]) {
  await test(`HTTP ${status} does not invalidate or remint a fresh token`, async () => {
    const f = fixture({}, () => response(status, { success: false }));
    const before = f.rec.settings.madmodelVerifiedAt;
    assert.equal(await f.api.preflightMadModel(), null);
    assert.equal(f.calls.length, 1);
    assert.ok(f.calls[0].url.endsWith("/auth-login"));
    assert.equal(f.rec.settings.madmodelToken, token());
    assert.equal(f.rec.settings.madmodelVerifiedAt, before);
    assert.equal(f.rec.settings.madmodelFailStreak, undefined);
    await f.api.preflightMadModel();
    assert.equal(f.calls.length, 1, "temporary result must have its own backoff");
  });
}

for (const variant of ["network", "html", "unknown-json"]) {
  await test(`${variant} is temporary, never an auth failure`, async () => {
    const f = fixture({}, () => {
      if (variant === "network") throw new Error("fixture network failure");
      return response(200, variant === "html" ? "<html>Gateway unavailable</html>" : { message: "unknown" });
    });
    assert.equal(await f.api.preflightMadModel(), null);
    assert.equal(f.calls.length, 1);
    assert.equal(f.rec.settings.madmodelToken, token());
    assert.equal(f.relogins(), 0);
  });
}

await test("Retry-After throttles validation without changing last successful verification", async () => {
  const f = fixture({}, () => response(429, { success: false }, { "retry-after": "120" }));
  const before = f.rec.settings.madmodelVerifiedAt;
  await f.api.preflightMadModel();
  f.advance(119_000);
  await f.api.preflightMadModel();
  assert.equal(f.calls.length, 1);
  f.advance(1_001);
  await f.api.preflightMadModel();
  assert.equal(f.calls.length, 2);
  assert.equal(f.rec.settings.madmodelVerifiedAt, before);
});

await test("concurrent preflight requests share one actual validation", async () => {
  const gate = deferred();
  const f = fixture({}, () => gate.promise);
  const runs = Array.from({ length: 12 }, () => f.api.preflightMadModel());
  assert.ok(runs.every((run) => run === runs[0]));
  await Promise.resolve();
  gate.resolve(response(200, { success: true }));
  assert.deepEqual(await Promise.all(runs), Array(12).fill(null));
  assert.equal(f.calls.length, 1);
  await f.api.preflightMadModel();
  assert.equal(f.calls.length, 1, "valid result lasts ten minutes");
});

for (const invalid of [401, 200]) {
  await test(`explicit auth failure (${invalid}) renews once and respects automatic backoff`, async () => {
    const f = fixture({}, (url) => url.endsWith("/auth-login")
      ? response(invalid, { success: false })
      : response(503, { success: false }));
    const results = await Promise.all(Array.from({ length: 8 }, () => f.api.preflightMadModel()));
    assert.ok(results.every((value) => typeof value === "string"));
    assert.equal(f.calls.length, 2);
    for(let n=0;n<40&&!f.rec.settings.madmodelFailStreak;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.rec.settings.madmodelFailStreak, "1");
    assert.equal(f.relogins(), 0);
    await f.api.preflightMadModel();
    assert.equal(f.calls.length, 2, "invalid token must not bypass renewal backoff");
  });
}

await test("explicit invalid response accepts one newly issued token", async () => {
  const fresh = token(24, "new-fixture");
  const f = fixture({}, (url) => url.endsWith("/auth-login")
    ? response(401, { success: false })
    : response(200, { success: true, data: fresh }));
  assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.rec.settings.madmodelToken, fresh);
  assert.equal(f.calls.length, 2);
  await f.api.preflightMadModel();
  assert.equal(f.calls.length, 2, "newly issued token is already known valid");
});

await test("temporary verification does not renew a token even near expiry", async () => {
  const f = fixture({ madmodelToken: token(0.5) }, () => response(429, { success: false }));
  assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.calls.length, 1);
});

await test("early renewal failure preserves still-valid service and applies backoff", async () => {
  const f = fixture({ madmodelToken: token(0.5) }, (url) => url.endsWith("/auth-login")
    ? response(200, { success: true }) : response(503, {}));
  assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.rec.settings.madmodelToken, token(0.5));
  for(let n=0;n<40&&!f.rec.settings.madmodelFailStreak;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.rec.settings.madmodelFailStreak, "1");
  await f.api.preflightMadModel();
  assert.equal(f.calls.length, 2);
});

await test("a token expiring during a slow renewal failure is never released to chat", async () => {
  const gate = deferred();
  const f = fixture({ madmodelToken: token(18 / 3600) }, (url) => url.endsWith("/auth-login")
    ? response(200, { success: true }) : gate.promise);
  const pending = f.api.preflightMadModel();
  while (f.calls.length < 2) await new Promise((resolve) => setImmediate(resolve));
  f.advance(20_000);
  gate.resolve(response(503, {}));
  assert.equal(typeof await pending, "string", "expired token must return a warning, not null");
  assert.equal(typeof await f.api.preflightMadModel(), "string", "backoff cannot make an expired token usable");
  assert.equal(f.calls.length, 2);
});

await test("an unchanged near-expiry token does not remint on every message", async () => {
  const old = token(0.5);
  const f = fixture({ madmodelToken: old }, (url) => url.endsWith("/auth-login")
    ? response(200, { success: true }) : response(200, { success: true, data: old }));
  assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.calls.length, 2);
  for (let i = 0; i < 5; i++) assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.calls.length, 2);
  assert.ok(Number(f.rec.settings.madmodelNextAttemptAt) > epoch);
});

await test("automatic minting honors server Retry-After as well as the SSO backoff ladder", async () => {
  const f = fixture({ madmodelToken: "" }, () => response(429, {}, { "retry-after": "180" }));
  await assert.rejects(f.api.ensureMadModelToken(), /HTTP 429/);
  assert.equal(Number(f.rec.settings.madmodelNextAttemptAt), epoch + 180_000);
  f.advance(120_000);
  await assert.rejects(f.api.ensureMadModelToken(), /退避/);
  assert.equal(f.calls.length, 1);
});

await test("campus to WebVPN updates base/cookie without token renewal", async () => {
  const f = fixture({ madmodelReachableAt: "0" }, (url, init) => {
    if (url.endsWith("/check") && init.direct) return response(302, "", { location: "/fixture-gate" });
    return response(200, { success: true });
  });
  f.setCookie("new-fixture-cookie");
  assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.rec.settings.madmodelBase, `${TUNNEL}/v1`);
  assert.equal(f.rec.settings.madmodelCookie, "new-fixture-cookie");
  assert.equal(f.rec.settings.madmodelReachable, "0");
  assert.equal(f.rec.settings.madmodelToken, token());
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].url, `${TUNNEL}/model-api/auth-login`);
});

await test("WebVPN to campus clears stale tunnel base and cookie", async () => {
  const f = fixture({ madmodelBase: `${TUNNEL}/v1`, madmodelCookie: "stale", madmodelReachable: "0", madmodelReachableAt: "0" });
  assert.equal(await f.api.preflightMadModel(), null);
  assert.equal(f.rec.settings.madmodelBase, "");
  assert.equal(f.rec.settings.madmodelCookie, "");
  assert.equal(f.rec.settings.madmodelReachable, "1");
  assert.equal(f.calls[1].init.direct, true);
});

await test("cookie jar refresh is independent of token and route cache TTL", async () => {
  const f = fixture({ madmodelBase: `${TUNNEL}/v1`, madmodelCookie: "old", madmodelReachable: "0" });
  f.setCookie("rotated-fixture-cookie");
  await f.api.preflightMadModel();
  f.setCookie("next-fixture-cookie");
  await f.api.preflightMadModel();
  assert.equal(f.rec.settings.madmodelCookie, "next-fixture-cookie");
  assert.equal(f.calls.length, 1);
});

await test("failed route probes do not fabricate direct or tunnel reachability", async () => {
  const f = fixture({ madmodelReachableAt: "123" }, () => { throw new Error("fixture offline"); });
  assert.equal(await f.api.refreshMadModelRoute(), false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.rec.settings.madmodelReachableAt, "123");
  assert.equal(f.rec.settings.madmodelBase, "");
  assert.equal(f.rec.settings.madmodelReachable, "1");
  await f.api.refreshMadModelRoute();
  assert.equal(f.calls.length, 2);
});

await test("route HTTP 429 is backed off without probing more endpoints", async () => {
  const f = fixture({ madmodelReachableAt: "123" }, () => response(429, {}, { "retry-after": "180" }));
  assert.equal(await f.api.refreshMadModelRoute(), false);
  assert.equal(f.calls.length, 1);
  f.advance(179_000);
  await f.api.refreshMadModelRoute();
  assert.equal(f.calls.length, 1);
  assert.equal(f.rec.settings.madmodelReachableAt, "123");
});

await test("a successful HTTP login page is not route availability", async () => {
  const f = fixture({ madmodelReachableAt: "123" }, () => response(200, "<html>Sign in</html>"));
  assert.equal(await f.api.refreshMadModelRoute(), false);
  assert.equal(f.rec.settings.madmodelReachableAt, "123");
});

await test("concurrent forced route refresh is singleflight", async () => {
  const gate = deferred();
  const f = fixture({}, () => gate.promise);
  const runs = Array.from({ length: 8 }, () => f.api.refreshMadModelRoute(true));
  assert.ok(runs.every((run) => run === runs[0]));
  gate.resolve(response(200, { success: false }));
  assert.deepEqual(await Promise.all(runs), Array(8).fill(true));
  assert.equal(f.calls.length, 1);
});

await test("stale validation cannot invalidate a replacement token", async () => {
  const gate = deferred();
  const f = fixture({}, () => gate.promise);
  const pending = f.api.preflightMadModel();
  await Promise.resolve();
  f.rec.settings.madmodelToken = token(24, "replacement");
  gate.resolve(response(401, { success: false }));
  assert.equal(await pending, null);
  assert.equal(f.calls.length, 1);
  assert.equal(f.rec.settings.madmodelToken, token(24, "replacement"));
});

await test("switching to custom during route probing does not overwrite route", async () => {
  const gate = deferred();
  const f = fixture({ madmodelReachableAt: "123", madmodelBase: `${TUNNEL}/v1` }, () => gate.promise);
  const pending = f.api.refreshMadModelRoute();
  f.rec.settings.provider = "custom";
  gate.resolve(response(200, { success: true }));
  assert.equal(await pending, false);
  assert.equal(f.rec.settings.madmodelBase, `${TUNNEL}/v1`);
});

await test("explicit refresh is singleflight and temporary mint failure never proceeds to SSO", async () => {
  const gate = deferred();
  const f = fixture({}, () => gate.promise);
  const a = f.api.ensureMadModelToken(true);
  const b = f.api.ensureMadModelToken(true);
  assert.equal(a, b);
  gate.resolve(response(429, { success: false }));
  await assert.rejects(a, /HTTP 429/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.rec.settings.madmodelFailStreak, undefined);
});

await test("unrecognized SSO page does not trigger credential relogin", async () => {
  const f = fixture({}, (url) => url.includes("/auth-login/check")
    ? response(200, { success: false }) : response(200, "<html>Temporary gateway error</html>"));
  await assert.rejects(f.api.ensureMadModelToken(), /未能续签/);
  assert.equal(f.relogins(), 0);
  for(let n=0;n<40&&!f.rec.settings.madmodelFailStreak;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.rec.settings.madmodelFailStreak, "1");
});

await test("network change invalidates route TTL without reminting credentials; pump starts once", async () => {
  const f = fixture({ provider: "custom" });
  f.api.startMadModelPump();
  f.api.startMadModelPump();
  assert.equal(f.intervals.length, 2);
  f.rec.settings.provider = "madmodel";
  f.events.get("online")();
  await f.api.preflightMadModel();
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].url.endsWith("/check"));
  assert.ok(f.calls[1].url.endsWith("/auth-login"));
  assert.equal(f.rec.settings.madmodelToken, token());
});

await test("a network change during a pending route probe uses a fresh result", async () => {
  const gate = deferred();
  const f = fixture({ provider: "custom", madmodelReachableAt: "0" }, (_url, _init, index) =>
    index === 1 ? gate.promise : response(200, { success: true }));
  f.api.startMadModelPump();
  f.rec.settings.provider = "madmodel";
  const pending = f.api.preflightMadModel();
  f.events.get("online")();
  gate.resolve(response(200, { success: true }));
  assert.equal(await pending, null);
  assert.equal(f.calls.length, 3, "discard old route, probe current network, then validate");
});

await test("a network change while old probe JSON is loading cannot publish stale route TTL", async () => {
  const body = deferred();
  let parsing = false;
  const f = fixture({ provider: "custom", madmodelReachableAt: "0" }, (url, init, index) => {
    if (index === 1) return {
      status: 200, headers: new Headers(),
      json: () => { parsing = true; return body.promise; },
    };
    if (url.endsWith("/check") && init.direct) return response(302, "");
    return response(200, { success: true });
  });
  f.api.startMadModelPump();
  f.rec.settings.provider = "madmodel";
  const pending = f.api.preflightMadModel();
  while (!parsing) await new Promise((resolve) => setImmediate(resolve));
  f.events.get("online")();
  body.resolve({ success: true });
  assert.equal(await pending, null);
  assert.equal(f.rec.settings.madmodelBase, `${TUNNEL}/v1`, "fresh network route must win");
  assert.equal(f.rec.settings.madmodelReachable, "0");
  assert.equal(f.calls.length, 4, "discard stale body, direct gate, confirmed tunnel, token validation");
});

const PORTAL_COOKIE = "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index";
const portalHandler = (options = {}) => (url, init) => {
  if (url.includes("/auth-login/check?ticket=")) return response(200, { success: true, data: token(24, "portal-issued") });
  if (url.endsWith("/auth-login/check")) return response(200, { success: false });
  if (url.includes("/login/form/")) return response(200, '<input name="i_pass" type="password">');
  if (url === PORTAL_COOKIE) return options.cookie ?? response(200, "XSRF-TOKEN=fixture%2Bcsrf; Path=/;");
  if (url.includes("onlineAppRedirect")) {
    const query = new URL(url).searchParams;
    assert.equal(query.get("_csrf"), "fixture+csrf");
    assert.equal(query.get("yyfwid"), "19D04E39D96B36C494F2E48A1A4741FD");
    return options.roam ?? response(200, { object: { roamingurl: options.target ?? `${SITE}/authLogin?ticket=fixture%2Bticket&amp;other=1` } });
  }
  if (url.includes("/authLogin?")) return response(200, '<html><div id="app"></div></html>');
  throw new Error(`Unexpected fixture request: ${url}`);
};

await test("a healthy portal grants MadModel access even when cross-application ID SSO is absent", async () => {
  const f = fixture({ madmodelToken: "" }, portalHandler());
  assert.equal(await f.api.ensureMadModelToken(), token(24, "portal-issued"));
  assert.equal(f.relogins(), 0, "portal access must not submit credentials or request trust enrollment");
  const landed = f.calls.findIndex((call) => call.url.includes("/authLogin?"));
  const exchanged = f.calls.findIndex((call) => call.url.includes("/auth-login/check?ticket="));
  assert.ok(landed >= 0 && exchanged > landed, "DSH portal entry is visited before exchange");
  assert.equal(new URL(f.calls[exchanged].url).searchParams.get("ticket"), "fixture+ticket");
  assert.ok(f.calls.every((call) => !call.init.method || call.init.method === "GET"));
  assert.equal(f.rec.settings.madmodelFailStreak, "0");
  assert.ok(f.logs.every((line) => !line.includes("fixture+ticket") && !line.includes("fixture%2Bcsrf")));
});

await test("portal entry follows the confirmed WebVPN route before exchanging its ticket", async () => {
  const f = fixture({ madmodelToken: "", madmodelBase: `${TUNNEL}/v1` }, portalHandler({ target: `${TUNNEL}/authLogin?ticket=fixture%2Bticket` }));
  assert.equal(await f.api.ensureMadModelToken(), token(24, "portal-issued"));
  const landing = f.calls.find((call) => call.url.includes("/authLogin?"));
  assert.ok(landing.url.startsWith(TUNNEL));
  assert.equal(landing.init.direct, false);
});

for (const target of [
  "https://evil.example/authLogin?ticket=fixture",
  "https://madmodel.cs.tsinghua.edu.cn.evil.example/authLogin?ticket=fixture",
  "https://user@madmodel.cs.tsinghua.edu.cn/authLogin?ticket=fixture",
  "http://madmodel.cs.tsinghua.edu.cn/authLogin?ticket=fixture",
  `${SITE}/model-api/admin?ticket=fixture`,
  `${SITE}/authLogin?ticket=BAD_CREDENTIALS`,
  `${SITE}/authLogin?ticket=%ZZ`,
  `${SITE}/authLogin?ticket=fixture%20invalid`,
]) {
  await test(`portal rejects unsafe or invalid ticket target: ${target}`, async () => {
    const f = fixture({ madmodelToken: "" }, portalHandler({ target }));
    await assert.rejects(f.api.ensureMadModelToken(), /未能续签/);
    assert.ok(!f.calls.some((call) => call.url.includes("/authLogin?") || call.url.includes("/auth-login/check?ticket=")));
    assert.equal(f.rec.settings.madmodelToken, "");
  });
}

await test("portal rate limiting stops before password recovery and preserves Retry-After", async () => {
  const f = fixture({ madmodelToken: "" }, portalHandler({ roam: response(429, {}, { "retry-after": "180" }) }));
  await assert.rejects(f.api.ensureMadModelToken(), /HTTP 429/);
  assert.equal(f.relogins(), 0);
  assert.equal(Number(f.rec.settings.madmodelNextAttemptAt), epoch + 180_000);
});

await test("account switch after portal response discards its ticket without requesting the old account entry", async () => {
  const gate = deferred();
  const base = portalHandler();
  const f = fixture({ madmodelToken: "" }, (url, init) => url.includes("onlineAppRedirect") ? gate.promise : base(url, init));
  const pending = f.api.ensureMadModelToken();
  while (!f.calls.some((call) => call.url.includes("onlineAppRedirect"))) await new Promise((resolve) => setImmediate(resolve));
  f.changeAccount();
  gate.resolve(response(200, { object: { roamingurl: `${SITE}/authLogin?ticket=old-account` } }));
  await assert.rejects(pending, /AUTH_SESSION_CHANGED/);
  assert.ok(!f.calls.some((call) => call.url.includes("/authLogin?") || call.url.includes("/auth-login/check?ticket=")));
  assert.equal(f.rec.settings.madmodelToken, "");
  assert.equal(f.rec.settings.madmodelFailStreak, undefined, "old-account errors cannot change new account backoff");
});

await test("a token returned after account switch is never persisted", async () => {
  const gate = deferred();
  const f = fixture({}, () => gate.promise);
  const pending = f.api.ensureMadModelToken(true);
  while (f.calls.length < 1) await new Promise((resolve) => setImmediate(resolve));
  f.changeAccount();
  gate.resolve(response(200, { success: true, data: token(24, "old-account") }));
  await assert.rejects(pending, /AUTH_SESSION_CHANGED/);
  assert.equal(f.rec.settings.madmodelToken, token());
});

console.log(`MadModel auth/route fixtures: ${passed} passed; no network or real credentials used.`);
