#!/usr/bin/env node
/**
 * MadModel 续期泵护栏（`ensureMadModelToken` / `preflightMadModel`）：把应用层依赖
 * （lib/clients、plugins/registry）换成桩，用假 fetch 驱动，不触网、不需要登录。覆盖：
 *   ① 发票→兑换成功：返回 token 并写回 madmodelToken / madmodelAt / reachable=1
 *   ② 统一认证没给票：报「需重新登录」，且不误写 reachable=0
 *   ③ 兑换 307（校外 IP 门禁）：文案保留 307（loader 的自动重签钩子依赖它）+ reachable=0
 *   ④ 票据被拒（10001）：报「兑换被拒」并带服务端原因
 *   ⑤ preflight：新鲜 token 静默、到期失败返回提示而非抛错、自费模式不介入
 *
 * 跑法：node tools/madmodel-pump-test.mjs
 * 退出码 0 = 全部断言通过。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mm-pump-"));
const stubClients = path.join(scratch, "stub-clients.mjs");
const stubRegistry = path.join(scratch, "stub-registry.mjs");
const hookPath = path.join(scratch, "hook.mjs");
const stubTransport = path.join(scratch, "stub-transport.mjs");
fs.writeFileSync(stubTransport, [
  '// 桩：会话预热（真机里走应用运输层，让原生仓完成 wengine 会话建立/续期）',
  'export const nativeFetch = async (url) => { globalThis.__mmWarmCalls = (globalThis.__mmWarmCalls || 0) + 1; globalThis.__mmWarmUrl = String(url); };',
].join("\n"));
const stubTauri = path.join(scratch, "stub-tauri.mjs");
fs.writeFileSync(stubTauri, [
  '// 桩：中继命令（真机里由 src-tauri/src/madmodel_relay.rs 提供）',
  'export const invoke = async (cmd) => {',
  '  if (globalThis.__mmTauriThrow) throw new Error("非 Tauri 环境");',
  '  if (cmd === "madmodel_relay_start") return globalThis.__mmRelayPort ?? 8797;',
  '  return undefined;',
  '};',
].join("\n"));
// @onethu/core 的 barrel（src/index.ts）含 strip-only 不支持的 TS 语法（参数属性），
// 但本测试只要 webvpnWrap 一个纯函数——指向叶子模块即可，顺带让包装 hex 用真实实现。
const coreStub = path.join(scratch, "core-stub.mjs");
fs.writeFileSync(
  coreStub,
  'export { webvpnWrap } from ' + JSON.stringify(pathToFileURL(path.join(ROOT, "packages/core/src/crypto/webvpn.ts")).href) + ';\n',
);

// 桩：http.request / info.idServiceTicketUrl / logLine 与 getPlugin / updatePlugin
fs.writeFileSync(stubClients, [
  'export const http = {',
  '  request: async (url) => globalThis.__mmHttp(String(url)),',
  '  jar: { getCookies: (u) => (globalThis.__mmJarCookies ? globalThis.__mmJarCookies(String(u)) : []) },',
  '};',
  'export const info = { idServiceTicketUrl: async (form) => globalThis.__mmMint(String(form)) };',
  'export const logLine = async () => {};',
].join("\n"));
fs.writeFileSync(stubRegistry, [
  'export const getPlugin = () => ({ settings: globalThis.__mmSettings });',
  'export const updatePlugin = (id, patch) => { globalThis.__mmSettings = { ...globalThis.__mmSettings, ...patch.settings }; };',
].join("\n"));
fs.writeFileSync(hookPath, [
  'import { pathToFileURL } from "node:url";',
  'export async function resolve(specifier, context, next) {',
  '  const parent = context.parentURL || "";',
  '  if (specifier === "@onethu/core") return { url: pathToFileURL(' + JSON.stringify(coreStub) + ').href, shortCircuit: true };',
  '  if (specifier === "@tauri-apps/api/core") return { url: pathToFileURL(' + JSON.stringify(stubTauri) + ').href, shortCircuit: true };',
  '  if (parent.includes("/state/madmodel.ts")) {',
  '    if (specifier.endsWith("lib/clients.js")) return { url: pathToFileURL(' + JSON.stringify(stubClients) + ').href, shortCircuit: true };',
  '    if (specifier.endsWith("plugins/registry.js")) return { url: pathToFileURL(' + JSON.stringify(stubRegistry) + ').href, shortCircuit: true };',
  '    if (specifier.endsWith("lib/transport.js")) return { url: pathToFileURL(' + JSON.stringify(stubTransport) + ').href, shortCircuit: true };',
  '  }',
  '  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {',
  '    try { return await next(specifier, context); }',
  '    catch (e) { try { return await next(specifier.slice(0, -3) + ".ts", context); } catch { throw e; } }',
  '  }',
  '  return next(specifier, context);',
  '}',
].join("\n"));
register(pathToFileURL(hookPath));

const modUrl = pathToFileURL(path.join(ROOT, "apps/desktop/src/state/madmodel.ts")).href;
const { ensureMadModelToken, madmodelDue, preflightMadModel, isChannelError } = await import(modUrl);

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + " " + (extra || "")); }
};
const okJson = (obj) => ({ status: 200, headers: { get: () => null }, json: async () => obj });
const reset = (mint, http) => {
  globalThis.__mmSettings = { provider: "madmodel" };
  globalThis.__mmMint = mint;
  globalThis.__mmHttp = http;
};
const TICKET = "https://madmodel.cs.tsinghua.edu.cn/authLogin?ticket=ST-unit-1";

// ① 发票 → 兑换成功
{
  let seenUrl = "";
  reset(async () => TICKET, async (u) => { seenUrl = u; return okJson({ success: true, data: "TOKEN-ABC" }); });
  const tok = await ensureMadModelToken();
  check("① 返回 token", tok === "TOKEN-ABC", tok);
  check("① 兑换 URL 带 ticket", seenUrl.includes("/model-api/auth-login/check?ticket=ST-unit-1"), seenUrl);
  check("① 写回 madmodelToken", globalThis.__mmSettings.madmodelToken === "TOKEN-ABC");
  check("① 写回 reachable=1", globalThis.__mmSettings.madmodelReachable === "1");
  check("① 写入签发时刻", Number(globalThis.__mmSettings.madmodelAt) > 0);
}

// ② 统一认证没给票
{
  reset(async () => null, async () => okJson({ success: true, data: "X" }));
  let err = null;
  try { await ensureMadModelToken(); } catch (e) { err = e; }
  check("② 抛错且指向统一认证", Boolean(err) && /统一认证未给出票据/.test(err.message), err && err.message);
  check("② 不误写 reachable=0", globalThis.__mmSettings.madmodelReachable === undefined, String(globalThis.__mmSettings.madmodelReachable));
}

// ③ 校外 307
{
  reset(async () => TICKET, async () => ({ status: 307, headers: { get: () => null }, json: async () => null }));
  let err = null;
  try { await ensureMadModelToken(); } catch (e) { err = e; }
  check("③ 文案含 307", Boolean(err) && err.message.includes("307"), err && err.message);
  check("③ 写回 reachable=0", globalThis.__mmSettings.madmodelReachable === "0");
}

// ④ 票据被拒
{
  reset(async () => TICKET, async () => okJson({ success: false, status: 10001, message: "ticket已过期或无效，请重新登录" }));
  let err = null;
  try { await ensureMadModelToken(); } catch (e) { err = e; }
  check("④ 报兑换被拒并带服务端原因", Boolean(err) && /兑换被拒/.test(err.message) && /10001|ticket/.test(err.message), err && err.message);
}

// ⑤ preflight 三分支
{
  reset(async () => TICKET, async () => ({ status: 307, headers: { get: () => null }, json: async () => null }));
  globalThis.__mmSettings = { provider: "madmodel", madmodelToken: "OLD", madmodelAt: String(Date.now()) };
  check("⑤a 新鲜 token 不触发续期", madmodelDue() === false);
  const a = await preflightMadModel();
  check("⑤a 静默返回 null", a === null, String(a));
  check("⑤a 探针把校外写进 reachable=0", globalThis.__mmSettings.madmodelReachable === "0");

  reset(async () => null, async () => ({ status: 307, headers: { get: () => null }, json: async () => null }));
  globalThis.__mmSettings = { provider: "madmodel" };
  check("⑤b 无签发时刻视为到期", madmodelDue() === true);
  const b = await preflightMadModel();
  check("⑤b 返回提示而非抛错", typeof b === "string" && b.includes("统一认证"), String(b).slice(0, 80));

  globalThis.__mmSettings = { provider: "custom", apiKey: "sk-x" };
  const c = await preflightMadModel();
  check("⑤c 自费模式不介入", c === null, String(c));
}

// ⑥ 校外通道：可达性 0 → 兑换走 webvpn 包装，并写回包装基址（不改写 reachable）
{
  let seenUrl = "";
  reset(async () => TICKET, async (u) => { seenUrl = u; return okJson({ success: true, data: "TOKEN-WRAP" }); });
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "0" };
  globalThis.__mmJarCookies = () => [];   // 本场景：jar 里没有 wengine 票
  const tok = await ensureMadModelToken();
  check("⑥ 校外兑换成功", tok === "TOKEN-WRAP", tok);
  check("⑥ 兑换走包装域", seenUrl.startsWith("https://webvpn.tsinghua.edu.cn/https/"), seenUrl.slice(0, 80));
  check("⑥ 兑换 URL 仍带 ticket", seenUrl.includes("/model-api/auth-login/check?ticket=ST-unit-1"), seenUrl.slice(0, 120));
  check("⑥ 写回中继基址（127.0.0.1）", globalThis.__mmSettings.madmodelBase === "http://127.0.0.1:8797/v1", String(globalThis.__mmSettings.madmodelBase));
  check("⑥ 不覆写 reachable（通道判定归探针）", globalThis.__mmSettings.madmodelReachable === "0", String(globalThis.__mmSettings.madmodelReachable));
  check("⑥ 无会话票时留空而不炸", globalThis.__mmSettings.madmodelCookie === "", String(globalThis.__mmSettings.madmodelCookie));
}

// ⑦ 会话票刷新：preflight 每次对话前把最新 wengine 票写进设置（Rust 侧消费）
{
  // 探针必须失败（307）才会维持 reachable=0——否则 preflight 会先判成校内
  reset(async () => TICKET, async (u) => (u.includes("/model-api/auth-login/check") && !u.includes("ticket=") ? { status: 307, headers: { get: () => null }, json: async () => null } : okJson({ success: true, data: "X" })));
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "0", madmodelToken: "OLD", madmodelAt: String(Date.now()) };
  globalThis.__mmJarCookies = (u) => (u.includes("webvpn.tsinghua.edu.cn") ? [{ name: "wengine_vpn_ticket", value: "wrdvpn1-TESTTICKET" }] : []);
  const out = await preflightMadModel();
  check("⑦ preflight 静默返回 null", out === null, String(out));
  check("⑦ 中继形态不带会话票", globalThis.__mmSettings.madmodelCookie === "", String(globalThis.__mmSettings.madmodelCookie));
  check("⑦ 中继基址已写回设置", globalThis.__mmSettings.madmodelBase === "http://127.0.0.1:8797/v1", String(globalThis.__mmSettings.madmodelBase));
  // 校内侧：同样的 preflight 应把两字段清空（回到直连语义）
  // 校内侧：探针返回 200（校内）→ 包装参数应被清空
  reset(async () => TICKET, async () => okJson({ success: true, data: "X" }));
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "1", madmodelReachableAt: String(Date.now()), madmodelToken: "OLD", madmodelAt: String(Date.now()), madmodelBase: "x", madmodelCookie: "y" };
  await preflightMadModel();
  check("⑦ 校内时清空包装参数", globalThis.__mmSettings.madmodelBase === "" && globalThis.__mmSettings.madmodelCookie === "", JSON.stringify([globalThis.__mmSettings.madmodelBase, globalThis.__mmSettings.madmodelCookie]));
}

// ⑧ 中继不可用（非 Tauri/启动失败）→ 退化为「包装域 + 会话票」
{
  // 探针失败（307=校外）→ 通道 webvpn；中继不可用 → 退化
  reset(async () => TICKET, async (u) => (u.includes("/model-api/auth-login/check") && !u.includes("ticket=") ? { status: 307, headers: { get: () => null }, json: async () => null } : okJson({ success: true, data: "TOKEN-FB" })));
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "0", madmodelReachableAt: String(Date.now()), madmodelToken: "OLD", madmodelAt: String(Date.now()) };
  globalThis.__mmJarCookies = (u) => (u.includes("webvpn.tsinghua.edu.cn") ? [{ name: "wengine_vpn_ticket", value: "wrdvpn1-FALLBACK" }] : []);
  globalThis.__mmTauriThrow = true;
  await preflightMadModel();
  check("⑧ 退化基址 = 包装域", String(globalThis.__mmSettings.madmodelBase).startsWith("https://webvpn.tsinghua.edu.cn/https/"), String(globalThis.__mmSettings.madmodelBase).slice(0, 70));
  check("⑧ 退化时带上会话票", String(globalThis.__mmSettings.madmodelCookie).includes("wrdvpn1-FALLBACK"), String(globalThis.__mmSettings.madmodelCookie));
  globalThis.__mmTauriThrow = false;
}

// ⑨ 探针假阳性：直连请求被弹入 webvpn（传输层跟完整条跳链，终态 200）→ 必须判校外
{
  let seenForProbe = "";
  reset(
    async () => TICKET,
    async (u) => {
      if (u.includes("/model-api/auth-login/check") && !u.includes("ticket=")) {
        seenForProbe = u;
        return { status: 200, headers: { get: (k) => (k.toLowerCase() === "x-onethu-final-url" ? "https://webvpn.tsinghua.edu.cn/https/aa/model-api/auth-login/check" : null) }, json: async () => null };
      }
      return okJson({ success: true, data: "TOKEN-B" });
    },
  );
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "1", madmodelToken: "OLD", madmodelAt: String(Date.now()) };
  await preflightMadModel();
  check("⑨ 被弹入 webvpn 时判为校外（reachable=0）", globalThis.__mmSettings.madmodelReachable === "0", String(globalThis.__mmSettings.madmodelReachable));
  check("⑨ 通道随之切到中继基址", globalThis.__mmSettings.madmodelBase === "http://127.0.0.1:8797/v1", String(globalThis.__mmSettings.madmodelBase));
  check("⑨ 探针确实走了直连 URL", seenForProbe.startsWith("https://madmodel.cs.tsinghua.edu.cn/"), seenForProbe);
}

// ⑩ 兑换回 HTML 壳（包装通道弹登录页）→ 报 webvpn 会话未就绪，而不是「兑换被拒」
{
  reset(async () => TICKET, async () => ({ status: 200, headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) }, json: async () => null }));
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "1", madmodelToken: "", madmodelAt: "0" };
  let err = null;
  try { await ensureMadModelToken(); } catch (e) { err = e; }
  check("⑩ 报 webvpn 会话未就绪", Boolean(err) && /webvpn 会话未就绪/.test(err.message), err && err.message);
}

// ⑪ 通道类错误判定（决定是否自动重试）
{
  check("⑪ 识别 webvpn 会话已失效", isChannelError("webvpn 会话已失效：中继上游被弹回登录页") === true);
  check("⑪ 识别直连 307", isChannelError("校外环境（MadModel IP 门禁 307），免费档不可用") === true);
  check("⑪ 不误判模型类错误", isChannelError("模型无任何输出——请检查「模型」名称与 API Endpoint") === false);
  check("⑪ 不误判票据类错误", isChannelError("兑换被拒（HTTP 200：ticket已过期或无效）——请重新登录") === false);
}

// ⑫ Tauri 环境里中继启动失败 → 留空基址（不再静默退化为必然被弹登录页的单票路径）
{
  reset(async () => TICKET, async (u) => (u.includes("/model-api/auth-login/check") && !u.includes("ticket=") ? { status: 307, headers: { get: () => null }, json: async () => null } : okJson({ success: true, data: "X" })));
  globalThis.window = { __TAURI_INTERNALS__: {} };   // 伪装成 Tauri 环境
  globalThis.__mmTauriThrow = true;                  // 中继命令失败
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "0", madmodelToken: "OLD", madmodelAt: String(Date.now()), madmodelBase: "http://127.0.0.1:1111/v1", madmodelCookie: "" };
  await preflightMadModel();
  check("⑫ Tauri 下中继失败 → 基址留空", globalThis.__mmSettings.madmodelBase === "", String(globalThis.__mmSettings.madmodelBase));
  check("⑫ 不写单票退化路径", globalThis.__mmSettings.madmodelCookie === "", String(globalThis.__mmSettings.madmodelCookie));
  delete globalThis.window;
  globalThis.__mmTauriThrow = false;
}

// ⑬ 会话预热：中继首次启动时调用一次运输层 GET（真机里用于建立 wengine 会话）
{
  reset(async () => TICKET, async (u) => (u.includes("/model-api/auth-login/check") && !u.includes("ticket=") ? { status: 307, headers: { get: () => null }, json: async () => null } : okJson({ success: true, data: "X" })));
  globalThis.__mmWarmCalls = 0;
  globalThis.__mmSettings = { provider: "madmodel", madmodelReachable: "0", madmodelToken: "OLD", madmodelAt: String(Date.now()) };
  await preflightMadModel();
  check("⑬ 预热调用一次", globalThis.__mmWarmCalls === 1, String(globalThis.__mmWarmCalls));
  check("⑬ 预热目标是包装域", String(globalThis.__mmWarmUrl || "").startsWith("https://webvpn.tsinghua.edu.cn/https/"), String(globalThis.__mmWarmUrl).slice(0, 70));
  await preflightMadModel();
  check("⑬ 同一中继不重复预热", globalThis.__mmWarmCalls === 1, String(globalThis.__mmWarmCalls));
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log("\nmadmodel 续期泵护栏：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);