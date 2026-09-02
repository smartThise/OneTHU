/**
 * 体育场馆模块 smoke：md5 向量、签名形状、客户端语义（envelope/1130002/空数据/提交 body）。
 * 运行：node --experimental-strip-types test/venue.smoke.mjs（与 webvpn.smoke 同轨）。
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { md5hex, venueSignQuery, buildVenueSign } from "../src/venue/sign.ts";

/* client.ts 沿用 core 的 ".js" 相对导入（bundler resolution），node strip-types
 * 需显式扩展名 → 就地拷贝一份把相对 .js 导入改写为 .ts（仅测试用，递归闭包）。 */
function stripTsModule(srcRel, outDir, done) {
  // srcRel: "../src/<subpath>.ts"；输出保目录结构，避免嵌套路径无目录 ENOENT
  const srcUrl = new URL(srcRel, import.meta.url);
  const outRel = srcRel.slice("../src/".length);
  const outUrl = new URL(outDir + outRel, import.meta.url);
  if (done.has(outUrl.href)) return outUrl.href;
  done.add(outUrl.href);
  let text = readFileSync(srcUrl, "utf8");
  text = text.replace(/(from\s*["'])(\.[^"']*?)\.js(["'])/g, (_m, a, p, b) => {
    const depAbs = new URL(p + ".ts", srcUrl);
    const depRel = "../src/" + depAbs.pathname.split("/src/")[1];
    // 输出侧相对路径 = 相对当前输出文件目录
    const depth = outRel.split("/").length - 1;
    const outDepRel = ("../".repeat(depth) || "./") + depRel.slice("../src/".length);
    stripTsModule(depRel, outDir, done);
    return a + outDepRel + b;
  });
  const outFile = fileURLToPath(outUrl);
  mkdirSync(outFile.slice(0, outFile.lastIndexOf("/")), { recursive: true });
  writeFileSync(outUrl, text);
  return outUrl.href;
}
mkdirSync(new URL("./.venue-build/", import.meta.url), { recursive: true });
const done = new Set();
stripTsModule("../src/venue/client.ts", "./.venue-build/", done);
const { VenueClient, VenueAuthRequiredError, VenueApiError, fmtVenueDate, venueTokenExpiresAt } = await import(
  new URL("./.venue-build/venue/client.ts", import.meta.url).href
);

let passed = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log("ok", name);
    });
}

await t("md5 RFC1321 vectors", () => {
  assert.equal(md5hex(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5hex("a"), "0cc175b9c0f1b6a831c399e269772661");
  assert.equal(md5hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(md5hex("message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
  assert.equal(md5hex("abcdefghijklmnopqrstuvwxyz"), "c3fcd3d76192e4007dfb496cca67e13b");
});

await t("抓包实测样本（2026-08-31 card/support/info 请求）", () => {
  const raw =
    "appId=1497016617475903488&nonce=ZZp5ZmyPkS8z7Wcn58jsdiZyJBiBGTSA&timeStamp=1788156279004&key=57325972627c40bd8c77296d39293705";
  assert.equal(md5hex(raw), "141d266f3d071152614824c8aa805169");
});

await t("签名 query 形状", () => {
  const fixed = buildVenueSign(1788156279004);
  // nonce 随机 → 只验证字段与 sign 可复算
  assert.equal(fixed.appId, "1497016617475903488");
  assert.equal(fixed.timeStamp, 1788156279004);
  assert.match(fixed.nonce, /^[A-Za-z0-9]{32}$/);
  assert.match(fixed.sign, /^[0-9a-f]{32}$/);
  const q = venueSignQuery();
  assert.match(q, /^appId=1497016617475903488&timeStamp=\d+&nonce=[A-Za-z0-9]{32}&sign=[0-9a-f]{32}$/);
});

await t("日期与 JWT exp 解析", () => {
  assert.equal(fmtVenueDate(20260901), "2026-09-01");
  assert.equal(fmtVenueDate("2026-09-01"), "2026-09-01");
  // iat 1788155137 / exp 1788173137 的真实形状（payload 仅含 exp 也行）
  const jwt = `x.${btoa(JSON.stringify({ exp: 1788173137 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.y`;
  assert.equal(venueTokenExpiresAt(jwt), 1788173137 * 1000);
  assert.equal(venueTokenExpiresAt("not-a-jwt"), null);
});

function jsonRes(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

await t("client：envelope 拆包 + 空数据原样返回", async () => {
  const seen = [];
  const client = new VenueClient({
    fetch: async (url, init) => {
      seen.push({ url: String(url), init });
      return jsonRes({ code: 0, message: "请求成功", success: true, data: null });
    },
  });
  client.setToken("x".repeat(40));
  const sites = await client.currentPage({ sceneUuid: "u1", reserveDate: "2026-09-01" });
  assert.deepEqual(sites, []); // null data → []（查不到不是错）
  const rec = await client.myRecords();
  assert.deepEqual(rec, []);
  // token 头 + 签名 query 存在
  assert.equal(seen[0].init.headers.token, "x".repeat(40));
  assert.match(String(seen[0].url), /appId=1497016617475903488&timeStamp=\d+&nonce=/);
  assert.ok(String(seen[0].url).startsWith("https://www.sports.tsinghua.edu.cn/venue/site/api/reserve/current/page?"));
});

await t("client：1130002 → 清 token + VenueAuthRequiredError", async () => {
  const client = new VenueClient({
    fetch: async () => jsonRes({ code: 500, message: "登录过期，请重新登录", success: false, errorCode: 1130002 }),
  });
  client.setToken("t".repeat(40));
  await assert.rejects(() => client.sceneList(), VenueAuthRequiredError);
  assert.equal(client.hasToken, false);
});

await t("client：业务错误透传原文", async () => {
  const client = new VenueClient({
    fetch: async () => jsonRes({ code: 500, message: "请选择时间", success: false, errorCode: 2210007 }),
  });
  await assert.rejects(
    () => client.sceneList(),
    (err) => err instanceof VenueApiError && err.message === "请选择时间" && err.code === 2210007,
  );
});

await t("client：chooseBuildings URL 单问号（query 经 opts 拼接）+ currentPage 带楼栋", async () => {
  const urls = [];
  const bodies = [];
  const client = new VenueClient({
    fetch: async (url, init) => {
      if (init && init.body) bodies.push(JSON.parse(init.body));
      urls.push(String(url));
      return jsonRes({ code: 0, message: "请求成功", success: true, data: [{ uuid: "bld1", siteName: "主馆" }] });
    },
  });
  client.setToken("t".repeat(40));
  const blds = await client.chooseBuildings("sc9");
  assert.equal(blds.length, 1);
  assert.ok(urls[0].includes("/api/site/chooseByType?"), urls[0]);
  assert.ok(!urls[0].includes("??"), urls[0]);
  const q = urls[0].split("?")[1];
  assert.equal((q.match(/\?/g) || []).length, 0, q);
  assert.ok(q.includes("sceneUuid=sc9"), q);
  assert.ok(q.includes("siteType=BUILDING"), q);
  assert.ok(q.includes("appId=") && q.includes("sign="), q);
  await client.currentPage({ sceneUuid: "sc9", reserveDate: "2026-09-01", classTypeUuid: "bld1", siteType: "DEV" });
  assert.equal(bodies[0].classTypeUuid, "bld1");
  assert.equal(bodies[0].siteType, "DEV");
  assert.equal(bodies[0].reserveDate, "2026-09-01");
});

/* addReserve 测试已随功能移除：预约须知第 12 条（脚本/插件预约封禁 6 个月 +
   函告院系），客户端刻意不实现应用内提交预约，预约一律引导官方网页。 */


/* —— ssoLogin：统一凭证换票链（mock 三段） —— */
const modUrl = new URL("./.venue-build/venue/client.ts", import.meta.url).href;
const { default: assert2 } = await import("node:assert");

await t("sameLevel/chooseRooms URL 形态（掩码链+房查）", async () => {
  const seen = [];
  const client = new VenueClient({
    fetch: async (url) => {
      seen.push(String(url));
      return jsonRes({ code: 0, success: true, data: null });
    },
  });
  client.setToken("t".repeat(40));
  await client.sameLevel("SC1");
  await client.chooseRooms("B1", "SC1");
  const sl = seen.find((u) => u.includes("/api/site/scene/sameLevel?"));
  assert(sl, "sameLevel 未发出");
  assert.equal((sl.split("?").length - 1), 1, "sameLevel 单问号");
  assert.ok(sl.includes("uuid=SC1"), "sameLevel 参数");
  const cr = seen.find((u) => u.includes("/api/site/chooseByType?"));
  assert.ok(cr.includes("siteUuid=B1"), "chooseRooms 缺 siteUuid");
  assert.ok(cr.includes("sceneUuid=SC1"), "chooseRooms 缺 sceneUuid");
  assert.ok(cr.includes("siteType=ROOM"), "chooseRooms 缺 siteType=ROOM");
});

console.log(`venue smoke: ${passed} passed`);



