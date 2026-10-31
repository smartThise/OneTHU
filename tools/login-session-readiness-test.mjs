/** Production recovery behavior with isolated transports; no school requests. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { LearnClient } from "../packages/core/src/learn/client.ts";

let checks = 0;
async function check(name, run) { await run(); checks++; console.log(`PASS ${name}`); }
const credentials = () => ({ username: "fixture", password: "fixture-only", fingerprint: "fixture" });
for (const [name, hook, html, expected, requests] of [
  ["host rejection never falls back to standalone password login", async () => false, "", false, 0],
  ["host exception never falls back to standalone password login", async () => { throw new Error("offline"); }, "", false, 0],
  ["host success still requires a real learning CSRF", async () => true, '<a href="/do/off/ui/auth/login/form/fixture">登录</a>', false, 1],
  ["host success with a learning session is accepted", async () => true, '<input name="_csrf" value="fixture-csrf">', true, 1],
]) await check(name, async () => {
  const calls = [];
  const client = new LearnClient({ text: async url => { calls.push(url); return html; } });
  client.credentialProvider = credentials;
  client.reloginHook = hook;
  assert.equal(await client.silentRelogin(), expected);
  assert.equal(calls.length, requests);
  assert.ok(calls.every(url => !url.includes("/f/login") && !url.includes("login/check")));
});
await check("standalone clients keep their passwordless fallback", async () => {
  const calls = [];
  const client = new LearnClient({ text: async url => { calls.push(url); return '<input name="_csrf" value="fixture-csrf">'; } });
  assert.equal(await client.silentRelogin(), true);
  assert.ok(calls.some(url => url.includes("/f/login")));
});

function productionFunction(path, name) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  // Replace only the transport/module boundary, retaining the actual function body.
  return declaration.getText(ast).replaceAll('import("../lib/infoLib.js")', "loadInfoLib()").replaceAll('import("./infoLib.js")', "loadInfoLib()");
}
await check("concurrent learning recovery shares its result before applying throttle", async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let ensured = 0;
  const ensureLearnSession = async () => { ensured++; await barrier; return true; };
  const code = productionFunction("apps/desktop/src/state/data.ts", "relearnRoamOnce");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const recover = new Function("ensureLearnSession", `let roamInflight=null,lastRelearnAt=0;${js};return relearnRoamOnce;`)(ensureLearnSession);
  const first = recover(), second = recover();
  assert.equal(first, second);
  release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(ensured, 1);
  assert.equal(await recover(), false);
});
await check("2FA and trusted login share bounded learning-session preparation", async () => {
  const source = readFileSync(new URL("../apps/desktop/src/lib/clients.ts", import.meta.url), "utf8");
  assert.equal((source.match(/await resumeLearnAfterLogin\(\)/g) ?? []).length, 2);
  let resumes = 0, roams = 0;
  const learn = { applyCsrf() {} };
  const probeLearnSession = async () => ({ready:++resumes===2,csrf:"fixture",page:"fixture",diagnostic:"fixture"});
  const loadInfoLib = async () => ({ libRoamLearn: async () => { roams++; return true; } });
  const code = productionFunction("apps/desktop/src/lib/clients.ts", "resumeLearnAfterLogin");
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const prepare = new Function("loadInfoLib", "learn", "logLine", "probeLearnSession", "nativeFetch", "learnHttp", "resumeGeneration", `${js};return resumeLearnAfterLogin;`)(loadInfoLib, learn, async () => {}, probeLearnSession, async()=>{}, {}, 0);
  await prepare();
  assert.deepEqual([resumes, roams], [2, 1]);
});
console.log(`login-session-readiness-test: ${checks} checks passed`);
