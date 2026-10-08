#!/usr/bin/env node
/**
 * MadModel 取票链护栏（`InfoClient.idServiceTicketUrl`）：假 fetch 驱动 CAS 三形态，
 * 不触网、不需要登录。覆盖：
 *   ① 会话活着 → checkSingle 确认页 → POST 指纹字段 → 302 带票
 *   ② 会话活着 → 确认页只回锚点（无 Location）
 *   ③ 表单直接 302 带票（部分链路）
 *   ④ 会话死了且无凭据 → 返回 null（调用方据此提示重新登录，而不是抛错）
 *   ⑤ 泵链路：取到的票据能按 pump 的方式兑换
 *
 * 跑法：node tools/madmodel-ticket-test.mjs
 * 退出码 0 = 全部断言通过。
 *
 * 说明：仓库里的 TS 用 `.js` 后缀互相导入（构建器解析），Node 直跑需要一层解析钩子——
 * 本脚本自带（写进临时目录后 register），因此无需任何命令行参数。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mm-ticket-"));
const hookPath = path.join(scratch, "hook.mjs");
const shimPath = path.join(scratch, "sm-crypto-shim.mjs");
fs.writeFileSync(shimPath, [
  'import { createRequire } from "node:module";',
  'const require = createRequire(' + JSON.stringify(path.join(ROOT, "packages/core/src/crypto/sm2.ts")) + ');',
  'const mod = require("sm-crypto");',
  'export const sm2 = mod.sm2; export const sm3 = mod.sm3; export const sm4 = mod.sm4; export default mod;',
].join("\n"));
fs.writeFileSync(hookPath, [
  'import { pathToFileURL } from "node:url";',
  'export async function resolve(specifier, context, next) {',
  '  if (specifier === "sm-crypto") return { url: pathToFileURL(' + JSON.stringify(shimPath) + ').href, shortCircuit: true };',
  '  if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {',
  '    try { return await next(specifier, context); }',
  '    catch (e) { try { return await next(specifier.slice(0, -3) + ".ts", context); } catch { throw e; } }',
  '  }',
  '  return next(specifier, context);',
  '}',
].join("\n"));
register(pathToFileURL(hookPath));

const coreUrl = (rel) => pathToFileURL(path.join(ROOT, "packages/core/src", rel)).href;
const { HttpClient, MemoryCookieJar } = await import(coreUrl("http.ts"));
const { InfoClient } = await import(coreUrl("info/client.ts"));

const FORM = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/d736f067a6705ab942df52f958a0f23b/0?/authLogin";
const CHECK_SINGLE = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle";
const TICKET_TARGET = "https://madmodel.cs.tsinghua.edu.cn/authLogin?ticket=";

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + " " + (extra || "")); }
};

const CHECK_SINGLE_PAGE = "<html><title>Title</title><form action=\"/do/off/ui/auth/login/checkSingle\" method=\"POST\" id=\"logined\">"
  + "<input type=hidden name=i_rememberme value=on><input type=hidden name=fingerPrint value=\"\"><input type=hidden name=fingerGenPrint value=\"\"></form>"
  + "<script>$(function(){ $('#logined').submit(); })</script></html>";
const ANCHOR_PAGE = "<html><a href=\"" + TICKET_TARGET + "ST-anchor-777\">直接跳转</a></html>";
const PASSWORD_PAGE = "<html><form id=theform action=check><input name=sm2publicKey value=abcd></form></html>";

function makeFetch(plan) {
  const seen = [];
  const f = async (url, init) => {
    const u = String(url);
    const method = (init && init.method) || "GET";
    const body = init && init.body ? String(init.body) : "";
    seen.push({ u, method, body });
    if (method === "POST") {
      return new Response(plan.postBody || "", { status: plan.postStatus, headers: plan.postLocation ? { location: plan.postLocation } : {} });
    }
    if (plan.formStatus === 302) return new Response("", { status: 302, headers: { location: plan.formLocation } });
    return new Response(plan.formBody || "", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  return [f, seen];
}

// ① 会话活着 → checkSingle → 302 带票（并核对 POST 字段）
{
  const [fetchLike, seen] = makeFetch({ formBody: CHECK_SINGLE_PAGE, postStatus: 302, postLocation: TICKET_TARGET + "ST-live-123" });
  const info = new InfoClient(new HttpClient({ jar: new MemoryCookieJar(), fetch: fetchLike }));
  const t = await info.idServiceTicketUrl(FORM);
  check("① 取到票据 URL", t === TICKET_TARGET + "ST-live-123", String(t));
  const post = seen.find((s) => s.method === "POST");
  check("① POST 打到 checkSingle", Boolean(post) && post.u === CHECK_SINGLE, post && post.u);
  check("① POST 字段齐（i_rememberme/fingerPrint/fingerGenPrint）",
    Boolean(post) && post.body.includes("i_rememberme=on") && post.body.includes("fingerPrint=") && post.body.includes("fingerGenPrint="),
    post && post.body.slice(0, 80));
}

// ② 确认页只回锚点
{
  const [fetchLike] = makeFetch({ formBody: CHECK_SINGLE_PAGE, postStatus: 200, postBody: ANCHOR_PAGE });
  const info = new InfoClient(new HttpClient({ jar: new MemoryCookieJar(), fetch: fetchLike }));
  const t = await info.idServiceTicketUrl(FORM);
  check("② 从锚点抠票", t === TICKET_TARGET + "ST-anchor-777", String(t));
}

// ③ 表单直接 302 带票
{
  const [fetchLike] = makeFetch({ formStatus: 302, formLocation: TICKET_TARGET + "ST-direct-9" });
  const info = new InfoClient(new HttpClient({ jar: new MemoryCookieJar(), fetch: fetchLike }));
  const t = await info.idServiceTicketUrl(FORM);
  check("③ 直落票据", t === TICKET_TARGET + "ST-direct-9", String(t));
}

// ④ 会话死了且无凭据 → null（不抛错）+ 可读诊断
{
  const [fetchLike] = makeFetch({ formBody: PASSWORD_PAGE });
  const info = new InfoClient(new HttpClient({ jar: new MemoryCookieJar(), fetch: fetchLike }));
  const t = await info.idServiceTicketUrl(FORM);
  check("④ 无会话无凭据返回 null", t === null, String(t));
  check("④ 诊断含 no-id-credentials", String(info.lastDebug || "").includes("no-id-credentials"), String(info.lastDebug).slice(0, 120));
}

// ⑤ 泵链路：取票 → 兑换
{
  const [base] = makeFetch({ formBody: CHECK_SINGLE_PAGE, postStatus: 302, postLocation: TICKET_TARGET + "ST-live-999" });
  const http = new HttpClient({
    jar: new MemoryCookieJar(),
    fetch: async (u, init) => {
      const s = String(u);
      if (s.includes("/model-api/auth-login/check?ticket=")) {
        return new Response(JSON.stringify({ success: true, status: 0, data: "FAKE.JWT.TOKEN" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return base(u, init);
    },
  });
  const info = new InfoClient(http);
  const ticketUrl = await info.idServiceTicketUrl(FORM);
  const ticket = /[?&]ticket=([^&#]+)/.exec(String(ticketUrl))[1];
  const res = await http.request("https://madmodel.cs.tsinghua.edu.cn/model-api/auth-login/check?ticket=" + encodeURIComponent(ticket), { redirect: "manual", direct: true });
  const j = await res.json();
  check("⑤ 取票→兑换贯通", j.success === true && j.data === "FAKE.JWT.TOKEN", JSON.stringify(j));
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log("\nmadmodel 取票护栏：" + pass + " 通过 / " + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);