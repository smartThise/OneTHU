import { readFile, stat } from "node:fs/promises";
import { CliError, DEFAULT_ENDPOINT, DEFAULT_TIMEOUT_MS, MAX_REQUEST_BYTES, LocalClient, errorPayload, parseTimeout } from "./client.mjs";
import { proxyMcp } from "./mcp.mjs";
import { exportLearn } from "./export.mjs";
import { loadSdk, StandaloneClient, sdkError } from "./standalone.mjs";
import { connectDaemon, daemonCommand } from "./daemon.mjs";
import { login } from "./login.mjs";

export const HELP = `OneTHU CLI · independent campus assistant (Node.js 20.18.1+)

Usage:
  onethu auth login [--username ID] [--trust-device]
  onethu auth logout --confirm
  onethu config automatic on|off --confirm
  onethu config enabled on|off --confirm
  onethu daemon start|stop|status|serve
  onethu daemon install|uninstall --confirm
  onethu status
  onethu commands [namespace]
  onethu schema <namespace.method>
  onethu call <namespace.method> [--args JSON | --args-file PATH] [--confirm]
  onethu <namespace> <method> [--args JSON | --args-file PATH] [--confirm]
  onethu learn export --output ABS_DIR [--semester ID] [--course ID] [--confirm]
  onethu mcp

Options:
  --desktop        Use services exposed by the graphical app (shared account/tasks)
  --data-dir PATH  Explicit isolated account, tasks and private configuration directory
  --username ID    Account for interactive auth login
  --password-stdin Read password from stdin (never pass a password as an argument)
  --trust-device   Explicitly request a trusted browser on successful authentication
  --json           Structured JSON output (the default)
  --endpoint URL   HTTP loopback origin (default ${DEFAULT_ENDPOINT})
  --timeout MS     HTTP timeout, 1–600000 ms (default ${DEFAULT_TIMEOUT_MS})
  --args JSON      Positional argument array, for example '["course-id"]'
  --args-file PATH Read the argument array from a UTF-8 JSON file
  --confirm        Approve a local CLI mutation (desktop mode additionally asks in-app)
  --output ABS_DIR Course export directory (learn export only)
  --semester ID    Export a specific semester (default: server's current semester)
  --course ID      Export one course from that semester
  --dry-run        Plan the export without creating files or downloading
  --help, -h       Show this help
  --version, -v    Show the installed CLI version

Environment: ONETHU_DATA_DIR, ONETHU_ENDPOINT (desktop mode), ONETHU_TIMEOUT_MS

The default runtime shares its account and tasks with the desktop app and OH.
Desktop startup loads the daemon; standalone users can run daemon start.
Approved daemon tasks continue after the graphical app or terminal closes.
MCP uses the same registry; automatic mutation authorization is configured locally.
An explicit --desktop or --endpoint uses the existing graphical app instead.
School authentication may require interactive two-factor verification.
learn export only writes with --confirm; incomplete exports return exit code 5.
Service calls are bounded to 150 seconds; mutations are never retried automatically.

Examples:
  onethu learn courses --args '[]'
  onethu schema learn.courses
  onethu call learn.courses --args-file ./arguments.json
  pnpm --filter @onethu/cli start --help
`;

function parse(argv, env) {
  const options = { endpoint: env.ONETHU_ENDPOINT || undefined, dataDir: env.ONETHU_DATA_DIR || undefined, timeout: env.ONETHU_TIMEOUT_MS || DEFAULT_TIMEOUT_MS };
  const positional = [];
  const seen = new Set();
  const booleans = new Map([["--desktop", "desktop"], ["--password-stdin", "passwordStdin"], ["--trust-device", "trustDevice"], ["--json", "json"], ["--confirm", "confirm"], ["--dry-run", "dryRun"], ["--help", "help"], ["-h", "help"], ["--version", "version"], ["-v", "version"]]);
  const values = new Map([["--data-dir", "dataDir"], ["--username", "username"], ["--endpoint", "endpoint"], ["--timeout", "timeout"], ["--args", "args"], ["--args-file", "argsFile"], ["--output", "output"], ["--semester", "semester"], ["--course", "course"]]);
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("-")) { positional.push(raw); continue; }
    const equals = raw.indexOf("=");
    const flag = equals < 0 ? raw : raw.slice(0, equals);
    const key = booleans.get(flag) ?? values.get(flag);
    if (!key) throw new CliError("INVALID_ARGUMENT", `Unknown option: ${flag}. Use --help for usage.`, 2);
    if (seen.has(key)) throw new CliError("INVALID_ARGUMENT", `Option supplied more than once: ${flag}.`, 2);
    seen.add(key);
    if (booleans.has(flag)) {
      if (equals >= 0) throw new CliError("INVALID_ARGUMENT", `${flag} does not take a value.`, 2);
      options[key] = true;
    } else {
      const value = equals >= 0 ? raw.slice(equals + 1) : argv[++i];
      if (!value || (equals < 0 && value.startsWith("--"))) throw new CliError("INVALID_ARGUMENT", `${flag} requires a value.`, 2);
      options[key] = value;
    }
  }
  if (options.args !== undefined && options.argsFile !== undefined) throw new CliError("INVALID_ARGUMENT", "Use either --args or --args-file.", 2);
  return { options, positional };
}

async function argsArray(options) {
  let text = options.args ?? "[]";
  if (options.argsFile !== undefined) {
    try {
      const info = await stat(options.argsFile);
      if (!info.isFile() || info.size > MAX_REQUEST_BYTES) throw new CliError("INVALID_ARGS_FILE", "Arguments file must be a regular UTF-8 JSON file no larger than 1 MiB.", 2);
      text = await readFile(options.argsFile, "utf8");
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("INVALID_ARGS_FILE", "Cannot read the arguments file. Check its path and permissions.", 2);
    }
  }
  if (Buffer.byteLength(text) > MAX_REQUEST_BYTES) throw new CliError("REQUEST_TOO_LARGE", "Arguments exceed the 1 MiB request limit.", 2);
  let args;
  try { args = JSON.parse(text.replace(/^\uFEFF/, "")); } catch {
    throw new CliError("INVALID_ARGS", "Arguments must be a valid JSON array. Use --args-file to avoid shell quoting problems.", 2);
  }
  if (!Array.isArray(args)) throw new CliError("INVALID_ARGS", "Arguments must be a positional JSON array, for example [] or [\"course-id\"]. Inspect onethu schema <operation> first.", 2);
  return args;
}

function operationName(name) {
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(name ?? "")) {
    throw new CliError("INVALID_OPERATION", "Use a published namespace.method operation from onethu commands.", 2);
  }
  return name;
}

function operations(result) {
  if (!result || !Array.isArray(result.operations) || !result.operations.every((item) => item && typeof item.name === "string")) {
    throw new CliError("INVALID_RESPONSE", "The local service did not return an operations catalog. Update OneTHU and the CLI together.", 3);
  }
  return result.operations;
}

export async function run(argv, { env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  let client;
  try {
    const [major,minor,patch] = process.versions.node.split(".").map(Number);
    if (major < 20 || major === 20 && (minor < 18 || minor === 18 && patch < 1)) throw new CliError("NODE_VERSION", "OneTHU CLI requires Node.js 20.18.1 or newer.", 2);
    const { options, positional } = parse(argv, env);
    options.timeout=parseTimeout(options.timeout);
    if (options.help || !positional.length && !options.version) { stdout.write(HELP); return 0; }
    if (options.version) {
      const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
      stdout.write(`${pkg.version}\n`);
      return 0;
    }
    const [command, ...rest] = positional;
    const isExport = command === "learn" && rest.length === 1 && rest[0] === "export";
    if (!isExport && ["output", "semester", "course", "dryRun"].some(key => options[key] !== undefined)) {
      throw new CliError("INVALID_ARGUMENT", "--output, --semester, --course and --dry-run are only valid for learn export.", 2);
    }
    if (command === "daemon") {
      if(options.desktop||options.endpoint)throw new CliError("INVALID_ARGUMENT","Daemon management uses the independent runtime.",2);
      if(rest.length!==1)throw new CliError("INVALID_ARGUMENT","Choose one daemon action.",2);
      const result=await daemonCommand(rest[0],options,{stdout,stderr});
      if(typeof result!=="number")stdout.write(JSON.stringify(result,null,2)+"\n");
      return typeof result==="number"?result:0;
    }
    const isCall = command === "call" || !["status", "commands", "schema", "mcp"].includes(command);
    if (!isCall && (options.args !== undefined || options.argsFile !== undefined || options.confirm)) {
      throw new CliError("INVALID_ARGUMENT", "--args, --args-file and --confirm are only valid for service calls.", 2);
    }
    if(options.desktop||options.endpoint)client=new LocalClient(options);
    else {
      // A running GUI is the service owner for app-only data as well. Explicit
      // isolated profiles/auth/config always keep their independent selection.
      if (!options.dataDir && !['auth','config'].includes(command)) {
        const desktop = new LocalClient({...options,timeout:1500});
        try {
          const info=await desktop.call('service/list');
          const requested=command==='call'||command==='schema'?rest[0]:isCall?`${command}.${rest[0]}`:null;
          if(info?.session?.status==='ready'&&(!requested||info.operations?.some(op=>op.name===requested)))client=new LocalClient(options);
        }
        catch(error) { if(!['CONNECTION_FAILED','LOCAL_SERVICE_DISABLED','TIMEOUT'].includes(error?.code)) throw error; }
      }
      if(!client){const sdk=await loadSdk();const dataDir=options.dataDir??sdk.defaultDataDir();
        client=await connectDaemon(dataDir,options.timeout)??new StandaloneClient(await sdk.createOneThu({dataDir}),options);}

    }
    if(command==="auth"||command==="config"){
      if(!client.runtime)throw new CliError("INVALID_ARGUMENT","Use the app for desktop account and policy settings.",2);
      let result;
      if(command==="config"){
        if(rest.length!==2||!["automatic","enabled"].includes(rest[0])||!["on","off"].includes(rest[1]))throw new CliError("INVALID_ARGUMENT","Use config automatic|enabled on|off --confirm.",2);
        result=await client.runtime[rest[0]==="automatic"?"setAutomatic":"setEnabled"](rest[1]==="on",{confirm:options.confirm});
      }else if(rest.length!==1)throw new CliError("INVALID_ARGUMENT","Use auth login, status or logout.",2);
      else if(rest[0]==="login")result=await login(client.runtime,options,{stdin,stderr});
      else if(rest[0]==="logout"){if(!options.confirm)throw new CliError("CONFIRMATION_REQUIRED","Logout requires --confirm.",2);result=await client.runtime.auth.logout();}
      else if(rest[0]==="status")result=await client.runtime.auth.status();
      else throw new CliError("INVALID_ARGUMENT","Use auth login, status or logout.",2);
      stdout.write(JSON.stringify(result,null,2)+"\n");return 0;
    }
    if (isExport) {
      const { report, exitCode } = await exportLearn(client, options);
      stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (exitCode) stderr.write(`${JSON.stringify(errorPayload(new CliError("EXPORT_PARTIAL", "The archive or plan is incomplete. Inspect the JSON report and its issues before relying on it.", exitCode)))}\n`);
      return exitCode;
    }
    let result;
    if (command === "mcp") {
      if (rest.length) throw new CliError("INVALID_ARGUMENT", "mcp accepts no positional arguments.", 2);
      return await proxyMcp(client, { stdin, stdout, stderr });
    }
    if (command === "status") {
      if (rest.length) throw new CliError("INVALID_ARGUMENT", "status accepts no positional arguments.", 2);
      const catalog = await client.call("service/list");
      const operationCount = operations(catalog).length;
      result = { connected: true, endpoint: `${client.endpoint.origin}/cli/v1`, name: catalog.name,
        version: catalog.version, platform: catalog.platform, session: catalog.session ?? { status: "unknown" },
        operationCount };
    } else if (command === "commands") {
      if (rest.length > 1) throw new CliError("INVALID_ARGUMENT", "commands accepts at most one namespace filter.", 2);
      const catalog = await client.call("service/list");
      result = operations(catalog).filter((item) => !rest[0] || item.name.startsWith(`${rest[0]}.`));
    } else if (command === "schema") {
      if (rest.length !== 1) throw new CliError("INVALID_ARGUMENT", "schema requires one namespace.method operation.", 2);
      const name = operationName(rest[0]);
      const catalog = await client.call("service/list");
      const operation = operations(catalog).find((item) => item.name === name);
      if (!operation) throw new CliError("UNKNOWN_OPERATION", "This app does not publish the requested operation. Run onethu commands.", 2);
      if (!operation.parameters || typeof operation.parameters !== "object") throw new CliError("INVALID_RESPONSE", "The operation has no published parameter schema.", 3);
      result = operation.parameters;
    } else {
      let operation;
      if (command === "call") {
        if (rest.length !== 1) throw new CliError("INVALID_ARGUMENT", "call requires one namespace.method operation.", 2);
        operation = operationName(rest[0]);
      } else {
        if (rest.length !== 1) throw new CliError("INVALID_ARGUMENT", "Use onethu <namespace> <method>, or onethu call <namespace.method>.", 2);
        operation = operationName(`${command}.${rest[0]}`);
      }
      const args = await argsArray(options);
      result = await client.call("service/call", { operation, args, ...(options.confirm ? { confirm: true } : {}) });
    }
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const safe=sdkError(error);stderr.write(`${JSON.stringify(errorPayload(safe))}\n`);
    return safe.exitCode;
  } finally {
    try { await client?.close?.(); }
    catch(error) { const safe=sdkError(error);stderr.write(`${JSON.stringify(errorPayload(safe))}\n`);return safe.exitCode; }
  }
}
