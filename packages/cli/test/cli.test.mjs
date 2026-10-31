import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { LocalClient, parseEndpoint } from "../src/client.mjs";
import { run } from '../src/cli.mjs';

const entry = fileURLToPath(new URL("../bin/onethu.mjs", import.meta.url));
const pkg = fileURLToPath(new URL("..", import.meta.url));
const catalog = {
  name: "OneTHU CLI", version: "1", platform: "fixture",
  session: { status: "needs-login" },
  operations: [
    { name: "learn.courses", description: "List courses", parameters: { type: "array", maxItems: 0 }, mutation: false },
    { name: "todo.add", description: "Add todo", parameters: { type: "array", items: { type: "object" } }, mutation: true },
  ],
};
const rpc = (response, id, result) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
};
async function server(t, handler) {
  const calls = [];
  const listener = http.createServer(async (request, response) => {
    let text = "";
    for await (const part of request) text += part;
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    calls.push({ request, body });
    try { await handler(request, response, body); } catch (error) {
      response.writeHead(500); response.end("fixture handler failed");
      throw error;
    }
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  t.after(() => { listener.closeAllConnections(); listener.close(); });
  return { endpoint: `http://127.0.0.1:${listener.address().port}`, calls, listener };
}
function cli(args, { endpoint, env = {}, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...(endpoint ? ["--endpoint", endpoint] : []), ...args], {
      env: { ...process.env, ONETHU_ENDPOINT: "", ONETHU_TIMEOUT_MS: "", ...env }, stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; });
    child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}
function error(result, code, exitCode) {
  assert.equal(result.code, exitCode);
  assert.equal(result.stdout, "");
  assert.equal(JSON.parse(result.stderr).error.code, code);
}

test("help and version work offline", async () => {
  const help = await cli(["--help"]);
  assert.equal(help.code, 0); assert.equal(help.stderr, ""); assert.match(help.stdout, /shared account\/tasks/);
  const version = await cli(["--version"]);
  assert.equal(version.code, 0); assert.equal(version.stdout, JSON.parse(await readFile(join(pkg, "package.json"), "utf8")).version + "\n");
});

test('Node version guard matches the bundled gateway engine requirement',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(process.versions,'node');
  try {
    for(const [version,accepted] of [['18.20.0',false],['20.18.1',false],['20.19.0',true],['20.20.0',true],['21.7.0',false],['22.11.0',false],['22.12.0',true],['24.0.0',true]]){
      Object.defineProperty(process.versions,'node',{...descriptor,value:version});
      let stdout='',stderr='';const code=await run(['--help'],{env:{},stdout:{write:value=>{stdout+=value;}},stderr:{write:value=>{stderr+=value;}}});
      assert.equal(code,accepted?0:2,version);if(accepted)assert.match(stdout,/22\.12/);else assert.equal(JSON.parse(stderr).error.code,'NODE_VERSION');
    }
  } finally { Object.defineProperty(process.versions,'node',descriptor); }
});

test('gateway control requires an existing daemon and never creates an account profile',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'onethu-gateway-cli-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const profile=join(dir,'unopened-profile');
  error(await cli(['gateway','status','--data-dir',profile]),'DAEMON_REQUIRED',2);
  await assert.rejects(stat(profile),{code:'ENOENT'});
  error(await cli(['gateway','credentials','--data-dir',profile]),'CONFIRMATION_REQUIRED',2);
  error(await cli(['gateway','start','--data-dir',profile]),'CONFIRMATION_REQUIRED',2);
  error(await cli(['gateway','unknown','--confirm','--data-dir',profile]),'INVALID_ARGUMENT',2);
});

test('gateway rejects public desktop endpoint routing before sending control',async t=>{
  const local=await server(t,(_request,response,body)=>rpc(response,body.id,{}));
  error(await cli(['gateway','status'],local),'INVALID_ARGUMENT',2);
  assert.equal(local.calls.length,0);
});

test("status reports app session, without upgrading needs-login to healthy", async (t) => {
  const local = await server(t, (_req, res, body) => rpc(res, body.id, catalog));
  const result = await cli(["status", "--json"], local);
  assert.equal(result.code, 0); assert.equal(result.stderr, "");
  const status = JSON.parse(result.stdout);
  assert.equal(status.connected, true); assert.equal(status.operationCount, 2);
  assert.equal(status.session.status, "needs-login");
  assert.equal(local.calls[0].request.url, "/cli/v1");
  assert.deepEqual(local.calls[0].body, { jsonrpc: "2.0", id: 1, method: "service/list", params: {} });
});

test("commands and schema use the app's published catalog", async (t) => {
  const local = await server(t, (_req, res, body) => rpc(res, body.id, catalog));
  assert.deepEqual(JSON.parse((await cli(["commands", "learn"], local)).stdout), [catalog.operations[0]]);
  assert.deepEqual(JSON.parse((await cli(["schema", "learn.courses"], local)).stdout), catalog.operations[0].parameters);
  error(await cli(["schema", "learn.missing"], local), "UNKNOWN_OPERATION", 2);
});

test("natural commands and call preserve arrays, nested values and Unicode", async (t) => {
  const local = await server(t, (_req, res, body) => {
    const { deadlineUnixMs, ...params } = body.params;
    assert.ok(Number.isSafeInteger(deadlineUnixMs));
    assert.ok(deadlineUnixMs > Date.now() && deadlineUnixMs <= Date.now() + 120000);
    rpc(res, body.id, params);
  });
  const args = ["课程 A", { cursor: "a+b", tags: ["通知", null], enabled: false }, 0];
  const a = await cli(["learn", "courses", "--args", JSON.stringify(args)], local);
  const b = await cli(["call", "learn.courses", "--args=" + JSON.stringify(args)], local);
  assert.equal(a.code, 0); assert.deepEqual(JSON.parse(a.stdout), { operation: "learn.courses", args });
  assert.equal(b.stdout, a.stdout);
});

test("args-file supports UTF-8 BOM and confirmation stays an app request", async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "onethu-cli-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const path = join(temp, "参数.json");
  await writeFile(path, '\uFEFF[{"title":"测试"}]');
  const local = await server(t, (_req, res, body) => rpc(res, body.id, { confirmationRequested: body.params.confirm, args: body.params.args }));
  const result = await cli(["todo", "add", "--args-file", path, "--confirm"], local);
  assert.equal(result.code, 0);
  const { deadlineUnixMs, ...params } = local.calls[0].body.params;
  assert.ok(Number.isSafeInteger(deadlineUnixMs));
  assert.deepEqual(params, { operation: "todo.add", args: [{ title: "测试" }], confirm: true });
  assert.equal(JSON.parse(result.stdout).confirmationRequested, true);
});

test("operation deadline includes confirmation, caps long waits and preserves caller parameters", async () => {
  for (const timeout of [1, 10, 100, 120000, 150000, 600000]) {
    const client = new LocalClient({ timeout });
    const params = Object.freeze({ operation: "mail.send", args: ["fixture"], confirm: true });
    let sent;
    client.post = async (_path, message) => {
      sent = message;
      return { text: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: true }) };
    };
    const before = Date.now();
    await client.call("service/call", params);
    const after = Date.now();
    const budget = Math.min(timeout, 150000);
    const duration = budget - Math.min(2000, Math.floor(budget / 10));
    assert.ok(Number.isSafeInteger(sent.params.deadlineUnixMs));
    assert.ok(sent.params.deadlineUnixMs >= before + duration && sent.params.deadlineUnixMs <= after + duration);
    assert.ok(duration > 0 && duration <= timeout && duration <= 150000);
    assert.equal(sent.params.confirm, true);
    assert.equal(Object.hasOwn(params, "deadlineUnixMs"), false);
    await client.call("service/list", {});
    assert.deepEqual(sent.params, {});
  }
});

for (const [args, expected] of [
  [["call", "learn.courses", "--args", "{}"], "INVALID_ARGS"],
  [["call", "learn.courses", "--args", "secret-not-json"], "INVALID_ARGS"],
  [["call", "learn.courses", "--args", "[]", "--args-file", "file"], "INVALID_ARGUMENT"],
  [["call", "learn.courses", "--args-file", "/does/not/exist"], "INVALID_ARGS_FILE"],
  [["call", "../escape", "--args", "[]"], "INVALID_OPERATION"],
  [["status", "--confirm"], "INVALID_ARGUMENT"],
  [["status", "--unexpected"], "INVALID_ARGUMENT"],
  [["status", "--timeout", "0"], "INVALID_TIMEOUT"],
  [["status", "--timeout", "1e3"], "INVALID_TIMEOUT"],
  [["status", "--timeout", "100", "--timeout", "100"], "INVALID_ARGUMENT"],
]) {
  test(`invalid CLI arguments fail before network: ${args.join(" ")}`, async () => {
    const result = await cli(args); error(result, expected, 2);
    assert.ok(!result.stderr.includes("secret-not-json"));
  });
}

for (const endpoint of [
  "https://127.0.0.1:8787", "http://evil.example:8787", "http://localhost.evil.example:8787",
  "http://127.0.0.1:8787/mcp", "http://127.0.0.1:8787?token=secret", "http://user@127.0.0.1:8787",
  "http://2130706433:8787", "http://127.1:8787", "http://0.0.0.0:8787", "http://127.0.0.1:65536",
]) {
  test(`endpoint is restricted to canonical loopback: ${endpoint}`, async () => {
    error(await cli(["status"], { endpoint }), "INVALID_ENDPOINT", 2);
  });
}

test("localhost is pinned to IPv4; IPv6 literal is accepted; proxy env is ignored", async (t) => {
  assert.equal(parseEndpoint("http://[::1]:8787").hostname, "::1");
  const local = await server(t, (_req, res, body) => rpc(res, body.id, catalog));
  const result = await cli(["status"], { endpoint: local.endpoint.replace("127.0.0.1", "localhost"), env: { HTTP_PROXY: "http://192.0.2.1:1", http_proxy: "http://192.0.2.1:1" } });
  assert.equal(result.code, 0); assert.equal(local.calls.length, 1);
});

test("redirects are refused even when another local service is the target", async (t) => {
  const other = await server(t, (_req, res, body) => rpc(res, body.id, catalog));
  const local = await server(t, (_req, res) => { res.writeHead(307, { location: other.endpoint + "/cli/v1" }); res.end(); });
  error(await cli(["status"], local), "REDIRECT_REFUSED", 3);
  assert.equal(other.calls.length, 0);
});

test("403 explains app authorization with empty stdout and does not echo sensitive body", async (t) => {
  const local = await server(t, (_req, res) => { res.writeHead(403); res.end("token=must-not-leak"); });
  const result = await cli(["status"], local);
  error(result, "LOCAL_SERVICE_DISABLED", 3);
  assert.match(result.stderr, /OH settings/); assert.ok(!result.stderr.includes("must-not-leak"));
});

test("HTTP failures, invalid JSON and mismatched IDs are structured errors", async (t) => {
  let mode = "http";
  const local = await server(t, (_req, res, body) => {
    if (mode === "http") { res.writeHead(503); res.end("<html>private debug body</html>"); }
    else if (mode === "json") { res.writeHead(200); res.end("not json"); }
    else rpc(res, body.id + 1, catalog);
  });
  error(await cli(["status"], local), "HTTP_ERROR", 3);
  mode = "json"; error(await cli(["status"], local), "INVALID_RESPONSE", 3);
  mode = "id"; error(await cli(["status"], local), "INVALID_RESPONSE", 3);
});

test("service errors preserve a safe code/message and do not expose result data", async (t) => {
  const local = await server(t, (_req, res, body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32001, message: "Sign in again. token=secret-value", data: { code: "AUTH_REQUIRED", cookie: "hidden" } } }));
  });
  const result = await cli(["learn", "courses"], local);
  error(result, "AUTH_REQUIRED", 4);
  assert.match(result.stderr, /Sign in again/); assert.ok(!result.stderr.includes("secret-value") && !result.stderr.includes("hidden"));
});

test("message-only host failures expose reliable operation codes with existing redaction", async (t) => {
  let code;
  const local = await server(t, (_req, res, body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: `${code}: token=private-fixture` } }));
  });
  for (code of ["LEARN_RESPONSE_UNEXPECTED", "CLI_OUTPUT_DIRECTORY_SYMLINK", "CONFIRMATION_CANCELLED", "WRITE_BUSY"]) {
    const result = await cli(["learn", "courses"], local);
    error(result, code, 4);
    assert.ok(!result.stderr.includes("private-fixture"));
  }
});

test("explicit structured codes take precedence over a message prefix", async (t) => {
  const local = await server(t, (_req, res, body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000,
      message: "WRITE_BUSY: Check the app.", data: { code: "CLI_CONFIRMATION_DECLINED" } } }));
  });
  error(await cli(["learn", "courses"], local), "CLI_CONFIRMATION_DECLINED", 4);
});

test("generic protocol words, ordinary prose and discarded HTML remain SERVICE_ERROR", async (t) => {
  let message;
  const local = await server(t, (_req, res, body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message } }));
  });
  for (message of ["HTTP 403 Forbidden", "ERROR: Request failed", "API: Request failed", "The campus request failed.", "LEARN_RESPONSE_UNEXPECTED: <html>private-body</html>"]) {
    const result = await cli(["learn", "courses"], local);
    error(result, "SERVICE_ERROR", 4);
    assert.ok(!result.stderr.includes("private-body"));
  }
});

test("absolute deadline cancels hanging requests", async (t) => {
  const local = await server(t, () => {});
  const result = await cli(["status", "--timeout", "40"], local);
  error(result, "TIMEOUT", 3);
});

test("connection refused gives app startup instructions", async (t) => {
  const local = await server(t, () => {});
  await new Promise((resolve) => local.listener.close(resolve));
  error(await cli(["status"], local), "CONNECTION_FAILED", 3);
});

test("MCP stdio proxy forwards initialize, notification, session header and SSE", async (t) => {
  const local = await server(t, (req, res, body) => {
    assert.equal(req.url, "/mcp");
    if (body.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "fixture-session" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fixture", version: "1" } } }));
    } else {
      assert.equal(req.headers["mcp-session-id"], "fixture-session");
      assert.equal(req.headers["mcp-protocol-version"], "2024-11-05");
      if (!Object.hasOwn(body, "id")) { res.writeHead(202); res.end(); }
      else {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } })}\r\n\r\n`);
      }
    }
  });
  const child = spawn(process.execPath, [entry, "--endpoint", local.endpoint, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
  t.after(() => child.kill());
  let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } }) + "\n");
  assert.equal(JSON.parse((await lines.next()).value).result.serverInfo.name, "fixture");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: "list", method: "tools/list", params: {} }) + "\n");
  assert.deepEqual(JSON.parse((await lines.next()).value), { jsonrpc: "2.0", id: "list", result: { tools: [] } });
  const exited = once(child, "close"); child.stdin.end();
  assert.equal((await exited)[0], 0); assert.equal(stderr, "");
});

test("MCP errors remain JSON-RPC on stdout; diagnostics stay on stderr", async (t) => {
  const local = await server(t, (_req, res) => { res.writeHead(403); res.end("disabled"); });
  const result = await cli(["mcp"], { endpoint: local.endpoint, input: '{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n' });
  const protocol = JSON.parse(result.stdout);
  assert.equal(protocol.jsonrpc, "2.0"); assert.equal(protocol.id, 7);
  assert.equal(protocol.error.data.code, "LOCAL_SERVICE_DISABLED");
  assert.equal(JSON.parse(result.stderr).error.code, "LOCAL_SERVICE_DISABLED");
});

test("MCP invalid input is a protocol parse error and makes no HTTP request", async (t) => {
  const local = await server(t, () => {});
  const result = await cli(["mcp"], { endpoint: local.endpoint, input: 'not-json\n' });
  assert.equal(JSON.parse(result.stdout).error.code, -32700); assert.equal(result.stderr, ""); assert.equal(local.calls.length, 0);
});

test("macOS installer creates a usable launcher in a quoted, custom path", { skip: process.platform === "win32" }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), "onethu-cli-install-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const home = join(temp, "package ' space");
  const bin = join(temp, "bin space");
  const install = spawn("bash", [join(pkg, "scripts/install-macos.sh")], { env: { ...process.env, ONETHU_CLI_HOME: home, ONETHU_CLI_BIN: bin }, stdio: "pipe" });
  assert.equal((await once(install, "close"))[0], 0);
  const launcher = spawn(join(bin, "onethu"), ["--version"], { stdio: "pipe" });
  let output = ""; launcher.stdout.on("data", (chunk) => { output += chunk; });
  assert.equal((await once(launcher, "close"))[0], 0); assert.equal(output, JSON.parse(await readFile(join(pkg, "package.json"), "utf8")).version + "\n");
  assert.equal(JSON.parse(await readFile(join(home, "package.json"), "utf8")).name, "@onethu/cli");
});

test("malformed catalogs are protocol errors with empty stdout", async (t) => {
  const local = await server(t, (_req, res, body) => rpc(res, body.id, null));
  error(await cli(["status"], local), "INVALID_RESPONSE", 3);
});

test("MCP rejects mismatched replies without emitting the unrelated response", async (t) => {
  const local = await server(t, (_req, res, body) => rpc(res, body.id + 1, { privateOtherResult: true }));
  const result = await cli(["mcp"], { endpoint: local.endpoint, input: '{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n' });
  const protocol = JSON.parse(result.stdout);
  assert.equal(protocol.id, 7); assert.equal(protocol.error.data.code, "INVALID_RESPONSE");
  assert.ok(!result.stdout.includes("privateOtherResult"));
});
