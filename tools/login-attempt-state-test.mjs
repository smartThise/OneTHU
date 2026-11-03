/** Offline regression for stable device identity and refresh-resistant login admission.
 * Run: node tools/login-attempt-state-test.mjs
 * Executes the production functions with an isolated store; never contacts school services.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let checks = 0;
const check = (label, fn) => { fn(); checks++; console.log(`PASS ${label}`); };

// Extract complete AST function declarations, not a hand-written copy of their bodies.
const clientsSource = read("apps/desktop/src/lib/clients.ts");
const clientsAst = ts.createSourceFile("clients.ts", clientsSource, ts.ScriptTarget.Latest, true);
const stateNames = ["fingerprintRequest", "resumeRequest", "resumeSnapshotUsername", "resumeGeneration"];
const stateDeclarations = stateNames.map((name) => {
  const statement = clientsAst.statements.find((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => declaration.name.getText(clientsAst) === name));
  assert.ok(statement, `Production state ${name} must exist`);
  return statement.getText(clientsAst);
}).join("\n");
const functions = stateDeclarations + "\n" + ["currentFingerprint", "currentSessionSnapshot", "prepareSharedTasksAfterLogin", "persist", "loadConsistentSessionSnapshot", "hasLiveSnapshot", "trySilentRelogin", "resumeSession", "performResumeSession", "resumeSessionForBoot", "logout"].map((name) => {
  const declaration = clientsAst.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(declaration, `Production function ${name} must exist`);
  return declaration.getText(clientsAst);
}).join("\n");
const clientCode = ts.transpileModule(functions, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function identityHarness({ initial = null, backup = null, failSave = false, failLoad = false, failFile = false, failLogout = false, probe = null, remembered = null } = {}) {
  let saved = initial ? structuredClone(initial) : null;
  let created = 0;
  let networkCalls = 0;
  let discards = 0, passwordLogins = 0, hydrations = 0;
  const session = { username: "", fingerprint: "constructor-only", finger3: "", state: "idle", reset() { this.state = "idle"; }, injectCredentials(username, password) { this.username = username; this.password = password; } };
  const files = new Map();
  const store = {
    loadSession: async () => { if (failLoad) throw new Error("Storage read denied"); return saved; },
    saveSession: async (value) => {
      if (failSave) throw new Error("Storage unavailable");
      saved = structuredClone(value);
    },
    clearSession: async () => { saved = null; },
  };
  const noNetwork = () => { networkCalls++; throw new Error("Unexpected network call in offline identity recovery"); };
  const dependencies = {
    store, session,
    initCliInstallation: async () => {},
    usesSharedRuntime: () => false,
    probeLearnSession: async () => { networkCalls++; const ready=await probe();return {ready,csrf:ready?"fixture-csrf":null,page:"fixture",diagnostic:"fixture"}; },
    makeFingerprint: () => `stable-device-${++created}`,
    info: { resetStaticSessionCaches() {}, resume: probe ? async () => true : noNetwork },
    http: { jar: { serialize: () => "{}", hydrate: probe ? () => { hydrations++; } : noNetwork } },
    learnHttp: { jar: { hydrate: probe ? () => {} : noNetwork } },
    fileWrite: async (name, value) => { if (failFile) throw new Error("File unavailable"); files.set(name, value); },
    fileRead: async (name) => { if (failFile) throw new Error("File unavailable"); return files.get(name) ?? backup; },
    fileDelete: async (name) => files.delete(name),
    logLine: async () => {},
    learn: { applyCsrf() {}, resume: probe ? async () => { networkCalls++; return probe(); } : noNetwork },
    loadRemembered: async () => remembered,
    login: async () => { passwordLogins++; return { state: "ready" }; },
    require: (path) => {
      if (path === "./venue.js") return { venueLogout() {} };
      if (path === "../state/seafile.js") return { clearSeafileToken: async () => {} };
      assert.equal(path, "./infoLib.js");
      const discard = async () => {
        discards++;
        saved = { username: "", fingerprint: session.fingerprint, finger3: "", cookiesJson: "{}", savedAt: 1 };
        files.set("test-session", JSON.stringify(saved));
      };
      return { helper: {}, setLibFinger3() {}, libLoginPending: () => false,
        libDiscardLocalSession: discard,
        libLogout: async () => { await discard(); if (failLogout) throw Error("Native cookie clear denied"); },
      };
    },
    SESSION_FILE: "test-session",
    pendingSecret: null,
  };
  const exports = {};
  new Function("exports", ...Object.keys(dependencies), clientCode)(exports, ...Object.values(dependencies));
  return { ...exports, session, files, saved: () => saved, created: () => created, networkCalls: () => networkCalls,
    discards: () => discards, passwordLogins: () => passwordLogins, hydrations: () => hydrations };
}

const fresh = identityHarness();
const sent = await fresh.currentFingerprint();
check("first-use identity is mirrored before any successful login", () => {
  assert.equal(JSON.parse(fresh.files.get("test-session")).fingerprint, sent);
  assert.equal(fresh.saved().cookiesJson, "{}");
});
fresh.session.finger3 = "trust-bound-to-stable-device";
await fresh.persist();
check("first login persists the exact fingerprint sent to authentication", () => {
  assert.equal(sent, "stable-device-1");
  assert.equal(fresh.session.fingerprint, sent);
  assert.equal(fresh.saved().fingerprint, sent);
  assert.equal(JSON.parse(fresh.files.get("test-session")).fingerprint, sent);
});

const restarted = identityHarness({ initial: fresh.saved() });
const resumed = await restarted.resumeSession();
check("a fingerprint-only snapshot restores device identity without restoring a session", () => {
  assert.equal(resumed, false);
  assert.equal(restarted.session.fingerprint, sent);
  assert.equal(restarted.session.finger3, "trust-bound-to-stable-device");
  assert.equal(restarted.networkCalls(), 0);
});
const sentAgain = await restarted.currentFingerprint();
await restarted.persist();
check("login after restart reuses the stored identity and trust pairing", () => {
  assert.equal(sentAgain, sent);
  assert.equal(restarted.created(), 0);
  assert.equal(restarted.saved().fingerprint, sent);
  assert.equal(restarted.saved().finger3, "trust-bound-to-stable-device");
});

const backup = identityHarness({ backup: JSON.stringify(fresh.saved()) });
check("file mirror can recover a fingerprint-only snapshot", () => assert.equal(backup.saved(), null));
assert.equal(await backup.resumeSession(), false);
check("file recovery restores the same identity before the no-session return", () => {
  assert.equal(backup.session.fingerprint, sent);
  assert.equal(backup.session.finger3, "trust-bound-to-stable-device");
  assert.equal(backup.saved().fingerprint, sent);
  assert.equal(backup.networkCalls(), 0);
});

const unavailableIdentityStore = identityHarness({ failSave: true });
const memoryFingerprint = await unavailableIdentityStore.currentFingerprint();
check("failed identity persistence still leaves this attempt using one fingerprint", () => {
  assert.equal(unavailableIdentityStore.session.fingerprint, memoryFingerprint);
});

const simultaneous = identityHarness();
const requests = Array.from({ length: 12 }, () => simultaneous.currentFingerprint());
const identities = await Promise.all(requests);
check("parallel first-use callers share one identity and one generation", () => {
  assert.equal(new Set(requests).size, 1);
  assert.equal(new Set(identities).size, 1);
  assert.equal(simultaneous.created(), 1);
  assert.equal(simultaneous.saved().fingerprint, identities[0]);
  assert.equal(JSON.parse(simultaneous.files.get("test-session")).fingerprint, identities[0]);
});

const directRestore = identityHarness({ backup: JSON.stringify(fresh.saved()) });
assert.equal(await directRestore.currentFingerprint(), sent);
check("native mirror restores fingerprint and trust before resumeSession runs", () => {
  assert.equal(directRestore.created(), 0);
  assert.equal(directRestore.saved().fingerprint, sent);
  assert.equal(directRestore.session.finger3, "trust-bound-to-stable-device");
  assert.equal(directRestore.networkCalls(), 0);
});
const deniedRead = identityHarness({ failLoad: true, backup: JSON.stringify(fresh.saved()) });
assert.equal(await deniedRead.currentFingerprint(), sent);
check("denied WebView storage still recovers the native device identity", () => {
  assert.equal(deniedRead.created(), 0);
  assert.equal(deniedRead.session.fingerprint, sent);
});
const conflictingBackup = JSON.stringify({ ...fresh.saved(), username: "new-account" });
const splitStorage = identityHarness({ initial: { ...fresh.saved(), username: "old-account" }, backup: conflictingBackup });
assert.equal(await splitStorage.currentFingerprint(), sent);
check("identity lookup preserves conflicting native owner evidence for the cookie boundary", () => {
  assert.equal(splitStorage.saved().username, "old-account");
  assert.equal(splitStorage.files.has("test-session"), false, "Existing native mirror must not be overwritten");
});

const noStorage = identityHarness({ failLoad: true, failSave: true, failFile: true });
const firstVolatile = await noStorage.currentFingerprint();
const moreVolatile = await Promise.all(Array.from({ length: 8 }, () => noStorage.currentFingerprint()));
check("unavailable storage reuses one in-memory identity across sequential and parallel calls", () => {
  assert.ok(moreVolatile.every((value) => value === firstVolatile));
  assert.equal(noStorage.created(), 1);
});
for (const corruptBackup of ["broken JSON", "null", "{}", '{"fingerprint":42}']) {
  const corruptIdentity = identityHarness({ backup: corruptBackup });
  const identity = await corruptIdentity.currentFingerprint();
  check(`invalid native identity ${corruptBackup} generates and persists one usable replacement`, () => {
    assert.equal(identity, "stable-device-1");
    assert.equal(corruptIdentity.saved().fingerprint, identity);
    assert.equal(JSON.parse(corruptIdentity.files.get("test-session")).fingerprint, identity);
  });
}

const liveSnapshot = { ...fresh.saved(), username: "fixture-account", cookiesJson: '{"synthetic":[]}' };
for (const mirrorName of ["different-account", ""]) {
  const h = identityHarness({ initial: liveSnapshot, backup: JSON.stringify({ ...liveSnapshot, username: mirrorName }), probe: async () => true, remembered: { username: liveSnapshot.username, password: "fixture-only" } });
  const result = await h.resumeSessionForBoot();
  assert.deepEqual(await h.trySilentRelogin(), { ok: false });
  check(`conflicting durable owner '${mirrorName}' cannot hydrate, show cached account or silently login`, () => {
    assert.equal(result.outcome.kind, "unavailable");
    assert.equal(result.outcome.username, null);
    assert.equal(result.outcome.error.code, "AUTH_SESSION_CONFLICT");
    assert.equal(h.hydrations(), 0);
    assert.equal(h.networkCalls(), 0);
    assert.equal(h.passwordLogins(), 0);
    assert.equal(h.discards(), 1);
  });
}
for (const options of [{ failLoad: true }, { failFile: true }, { backup: '{"username": "fixture-account"}' }]) {
  const h = identityHarness({ initial: liveSnapshot, probe: async () => true, ...options });
  const result = await h.resumeSessionForBoot();
  check(`unreadable or malformed ownership blocks restore ${JSON.stringify(options)}`, () => {
    assert.equal(result.outcome.kind, "unavailable");
    assert.equal(result.outcome.username, null);
    assert.equal(h.networkCalls(), 0);
    assert.equal(h.hydrations(), 0);
  });
}
for (const probeResult of [true, false]) {
  const h = identityHarness({ initial: liveSnapshot, backup: JSON.stringify(liveSnapshot), probe: async () => probeResult, remembered: { username: "another-account", password: "fixture-only" } });
  await h.resumeSessionForBoot();
  assert.deepEqual(await h.trySilentRelogin(), { ok: false });
  check(`remembered credentials from another account cannot replace restored owner (${probeResult})`, () => {
    assert.equal(h.session.username, liveSnapshot.username);
    assert.equal(h.session.password, undefined);
    assert.equal(h.passwordLogins(), 0);
  });
}
const logoutClearFailure = identityHarness({ initial: liveSnapshot, failLogout: true });
logoutClearFailure.session.username = liveSnapshot.username;
logoutClearFailure.session.state = "ready";
await assert.rejects(logoutClearFailure.logout(), /Native cookie clear denied/);
check("logout exposes native clearing failure while removing in-memory account and saving signed-out intent", () => {
  assert.equal(logoutClearFailure.session.username, "");
  assert.equal(logoutClearFailure.session.state, "idle");
  assert.equal(logoutClearFailure.saved().username, "");
});
const unavailableCases = [
  Object.assign(new Error("webvpn-guide"), { code: "LEARN_RESPONSE_ERROR" }),
  Object.assign(new Error("HTTP 503"), { status: 503 }),
  Object.assign(new Error("HTTP 429"), { status: 429 }),
  Object.assign(new Error("HTTP 403"), { status: 403 }),
  new TypeError("Synthetic network interruption"),
];
const unavailableOutcomes = [];
for (const cause of unavailableCases) {
  const h = identityHarness({ initial: liveSnapshot, probe: async () => { throw cause; } });
  const result = await h.resumeSessionForBoot(100);
  unavailableOutcomes.push(result.outcome);
  check(`boot ${cause.message} preserves cached account and original service error`, () => {
    assert.equal(result.outcome.kind, "unavailable");
    assert.equal(result.outcome.username, liveSnapshot.username);
    assert.equal(result.outcome.error, cause);
    assert.equal(result.settlement, null);
    assert.equal(h.networkCalls(), 1);
    assert.notEqual(h.session.state, "ready", "A cached view does not claim verified server authentication");
  });
}
const aliveBoot = identityHarness({ initial: liveSnapshot, probe: async () => true });
assert.deepEqual((await aliveBoot.resumeSessionForBoot()).outcome, { kind: "ready", username: liveSnapshot.username });
check("verified live session returns ready", () => assert.equal(aliveBoot.session.state, "ready"));
const expiredBoot = identityHarness({ initial: liveSnapshot, probe: async () => false });
const expiredOutcome = (await expiredBoot.resumeSessionForBoot()).outcome;
check("explicitly missing authentication (401/login page result) stays unauthenticated", () => {
  assert.equal(expiredOutcome.kind, "unauthenticated");
  assert.notEqual(expiredBoot.session.state, "ready");
});
await import("./ts-resolve-register.mjs");
const { LearnClient } = await import("../packages/core/src/learn/client.ts");
for (const [label, response, expected] of [
  ["real LearnClient gateway classification", '<html><script src="/wengine-vpn/js/main.js"></script></html>', "unavailable"],
  ["real LearnClient HTTP 503", new Error("HTTP 503"), "unavailable"],
  ["real LearnClient HTTP 429", new Error("HTTP 429"), "unavailable"],
  ["real LearnClient HTTP 401", new Error("HTTP 401"), "unauthenticated"],
]) {
  let recoveries = 0;
  const learnClient = new LearnClient({
    text: async () => { if (response instanceof Error) throw response; return response; },
  });
  learnClient.reloginHook = async () => { recoveries++; return false; };
  const h = identityHarness({ initial: liveSnapshot, probe: () => learnClient.resume() });
  const result = await h.resumeSessionForBoot(100);
  check(`${label} retains its boot outcome`, () => {
    assert.equal(result.outcome.kind, expected);
    assert.equal(recoveries, expected === "unauthenticated" ? 1 : 0);
  });
}
const missingBoot = identityHarness();
check("no snapshot never opens a cached authenticated account", () => assert.equal(missingBoot.networkCalls(), 0));
assert.equal((await missingBoot.resumeSessionForBoot()).outcome.kind, "unauthenticated");
const ownerlessBoot = identityHarness({ initial: { ...liveSnapshot, username: "" } });
assert.equal((await ownerlessBoot.resumeSessionForBoot()).outcome.kind, "unauthenticated");
check("ownerless cookies cannot be presented as an authenticated account", () => assert.equal(ownerlessBoot.networkCalls(), 0));

let settleProbe;
const delayedBoot = identityHarness({ initial: liveSnapshot, probe: () => new Promise(resolve => { settleProbe = resolve; }) });
const bootResults = await Promise.all([delayedBoot.resumeSessionForBoot(5), delayedBoot.resumeSessionForBoot(5)]);
check("boot deadline releases the UI while duplicate mounts share the original probe", () => {
  assert.equal(delayedBoot.networkCalls(), 1);
  assert.ok(bootResults.every(result => result.outcome.kind === "unavailable" && result.outcome.username === liveSnapshot.username));
  assert.ok(bootResults.every(result => result.settlement));
});
settleProbe(false);
const lateOutcome = await bootResults[0].settlement;
check("a late authentication failure remains observable after the deadline", () => {
  assert.equal(lateOutcome.kind, "unauthenticated");
  assert.notEqual(delayedBoot.session.state, "ready");
});
let settleAfterLogout;
const logoutDuringProbe = identityHarness({ initial: liveSnapshot, probe: () => new Promise(resolve => { settleAfterLogout = resolve; }) });
const logoutBootResult = await logoutDuringProbe.resumeSessionForBoot(5);
await logoutDuringProbe.logout();
settleAfterLogout(true);
const logoutSettlement = await logoutBootResult.settlement;
check("late successful probe cannot revive a completed explicit logout", () => {
  assert.equal(logoutSettlement.kind, "unauthenticated");
  assert.equal(logoutDuringProbe.session.state, "idle");
  assert.equal(logoutDuringProbe.saved().username, "");
  assert.equal(logoutDuringProbe.saved().cookiesJson, "{}");
});

// Execute AppProvider's real result handler with isolated state setters. This
// proves transient results cannot reach the password fallback and late 401 can.
const appSource = read("apps/desktop/src/state/app.tsx");
const appAst = ts.createSourceFile("app.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findVariable(root, name) {
  let found;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(found, `Production boot variable ${name} must exist`);
  return found.getText(appAst);
}
const uiHandlerCode = ts.transpileModule(
  `const ${findVariable(appAst, "ownsBoot")}; const ${findVariable(appAst, "applyOutcome")}; return applyOutcome;`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
function bootUiHarness() {
  const states = [], users = [], errors = [];
  const authActionVersion = { current: 0 };
  let silentCalls = 0;
  const clients = { trySilentRelogin: async () => { silentCalls++; return { ok: false }; }, logLine: async () => {}, session: { username: "fixture-account" } };
  const deps = { cancelled: false, actionVersion: 0, authActionVersion, clients,
    setUser: x => users.push(x), setStatus: x => states.push(x), setError: x => errors.push(x), setTwoFactor() {},
    i18n: key => key, require: () => clients, setTimeout: () => 1,
  };
  const apply = new Function(...Object.keys(deps), uiHandlerCode)(...Object.values(deps));
  return { apply, states, users, errors, authActionVersion, silentCalls: () => silentCalls };
}
const cachedUi = bootUiHarness();
for (const outcome of unavailableOutcomes) await cachedUi.apply(outcome);
await cachedUi.apply(bootResults[0].outcome);
check("service errors and probe deadline never submit remembered credentials", () => {
  assert.equal(cachedUi.silentCalls(), 0);
  assert.ok(cachedUi.states.every(state => state === "ready"));
});
await cachedUi.apply(lateOutcome);
check("late confirmed expiry leaves the cached screen and enables the login fallback once", () => {
  assert.equal(cachedUi.silentCalls(), 1);
  assert.equal(cachedUi.states.at(-1), "logged-out");
  assert.equal(cachedUi.users.at(-1), null);
});
const noAccountUi = bootUiHarness();
await noAccountUi.apply({ kind: "unavailable", username: null, error: unavailableCases[0] });
check("unavailable storage without an account leaves login accessible with its error", () => {
  assert.deepEqual(noAccountUi.states, ["logged-out"]);
  assert.equal(noAccountUi.errors[0], unavailableCases[0]);
  assert.equal(noAccountUi.silentCalls(), 0);
});
const abandonedUi = bootUiHarness();
abandonedUi.authActionVersion.current++;
await abandonedUi.apply(lateOutcome);
await abandonedUi.apply({ kind: "ready", username: "old-account" });
check("manual authentication or logout owns the screen over a late boot result", () => {
  assert.equal(abandonedUi.silentCalls(), 0);
  assert.equal(abandonedUi.states.length, 0);
  assert.equal(abandonedUi.users.length, 0);
});

const logoutUiCode = ts.transpileModule(`const ${findVariable(appAst, "logout")}; return logout;`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const logoutUiStates = [], logoutUiErrors = [], logoutUiUsers = [];
const nativeFailure = Error("Native cookie clear denied");
const logoutUiDeps = {
  useCallback: (fn) => fn, authActionVersion: { current: 0 }, navigate() {},
  clients: { logout: async () => { throw nativeFailure; } },
  setStatus: value => logoutUiStates.push(value), setUser: value => logoutUiUsers.push(value),
  setError: value => logoutUiErrors.push(value), setTwoFactor() {},
};
await new Function(...Object.keys(logoutUiDeps), logoutUiCode)(...Object.values(logoutUiDeps))();
check("App logout hides account data and presents native cleanup failure instead of claiming success", () => {
  assert.deepEqual(logoutUiStates, ["logged-out"]);
  assert.deepEqual(logoutUiUsers, [null]);
  assert.deepEqual(logoutUiErrors, [nativeFailure]);
});

const gateCode = ts.transpileModule(read("apps/desktop/src/lib/loginGate.ts"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
let moduleId = 0;
const loadGate = () => import(`data:text/javascript;base64,${Buffer.from(gateCode).toString("base64")}#${++moduleId}`);
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const realNow = Date.now;
let now = 1_800_000_000_000;
const storageKey = "onethu.login-attempt-at";
const setStorage = (storage) => Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage });
const memoryStorage = () => {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
};

try {
  Date.now = () => now;
  const storage = memoryStorage();
  setStorage(storage);
  const gate = await loadGate();
  check("a fresh context allows one login", () => assert.equal(gate.loginCooldownLeftMs(), 0));
  gate.markLoginAttempt();
  check("a second attempt is rejected with a bounded remaining time", () => {
    assert.equal(gate.loginCooldownLeftMs(), 20_000);
    assert.throws(() => gate.markLoginAttempt(), (error) => error.code === "AUTH_COOLDOWN" && error.retryAfterMs === 20_000);
    assert.deepEqual([...storage.entries], [[storageKey, String(now)]]);
  });
  now += 7_500;
  check("rejected attempts do not extend the cooldown", () => {
    assert.throws(() => gate.markLoginAttempt(), (error) => error.retryAfterMs === 12_500);
    assert.equal(gate.loginCooldownLeftMs(), 12_500);
  });
  const reloaded = await loadGate();
  check("reloading the module retains the remaining cooldown through session storage", () => {
    assert.equal(reloaded.loginCooldownLeftMs(), 12_500);
    assert.throws(() => reloaded.markLoginAttempt(), (error) => error.code === "AUTH_COOLDOWN");
  });
  now += 12_499;
  check("the last millisecond remains guarded", () => assert.throws(() => reloaded.markLoginAttempt(), (error) => error.retryAfterMs === 1));
  now += 1;
  reloaded.markLoginAttempt();
  check("a new attempt is allowed at the exact expiry", () => assert.equal(reloaded.loginCooldownLeftMs(), 20_000));
  reloaded.markLoginSucceeded();
  check("verified success immediately clears this attempt's cooldown", () => {
    assert.equal(reloaded.loginCooldownLeftMs(), 0);
    assert.equal(storage.getItem(storageKey), null);
  });
  const afterSuccess = await loadGate();
  check("refresh after successful login does not resurrect its old cooldown", () => assert.equal(afterSuccess.loginCooldownLeftMs(), 0));
  afterSuccess.markLoginAttempt();
  check("a subsequent failed attempt is still guarded", () => assert.equal(afterSuccess.loginCooldownLeftMs(), 20_000));

  for (const corrupt of ["broken", "NaN", "Infinity", "-1", "0", "", String(now + 60_000), String(now - 60_000)]) {
    const corruptStorage = memoryStorage();
    corruptStorage.setItem(storageKey, corrupt);
    setStorage(corruptStorage);
    const isolated = await loadGate();
    check(`invalid or expired saved timestamp ${JSON.stringify(corrupt)} does not lock login`, () => {
      assert.equal(isolated.loginCooldownLeftMs(), 0);
      assert.doesNotThrow(() => isolated.markLoginAttempt());
      assert.equal(isolated.loginCooldownLeftMs(), 20_000);
    });
  }

  for (const kind of ["missing", "getter-denied", "operations-denied", "write-denied"]) {
    if (kind === "missing") setStorage(undefined);
    else if (kind === "getter-denied") Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true, get() { throw new Error("Access denied"); },
    });
    else setStorage({
      getItem() { if (kind === "operations-denied") throw new Error("Access denied"); return null; },
      setItem() { throw new Error("Storage full or denied"); },
    });
    const isolated = await loadGate();
    check(`${kind} session storage falls back to the in-memory gate`, () => {
      assert.doesNotThrow(() => isolated.markLoginAttempt());
      assert.equal(isolated.loginCooldownLeftMs(), 20_000);
      assert.throws(() => isolated.markLoginAttempt(), (error) => error.code === "AUTH_COOLDOWN");
    });
  }

  setStorage(memoryStorage());
  const clockShift = await loadGate();
  clockShift.markLoginAttempt();
  now -= 60_000;
  check("clock rollback cannot create an unbounded lockout", () => {
    assert.equal(clockShift.loginCooldownLeftMs(), 0);
    assert.doesNotThrow(() => clockShift.markLoginAttempt());
    assert.equal(clockShift.loginCooldownLeftMs(), 20_000);
  });
} finally {
  Date.now = realNow;
  if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
  else delete globalThis.sessionStorage;
}

console.log(`login-attempt-state-test: ${checks} checks passed (offline; no credentials or school requests)`);
