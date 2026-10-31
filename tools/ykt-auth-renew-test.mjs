#!/usr/bin/env node
/**
 * 雨课堂免扫码续期协议护栏（离线，不联网）。
 *
 * 现场：OneTHU 扫码只保存 sessionid，24h 后只能重新扫码；官方网页在扫码后
 * 还会用 UserID/Auth 调 /pc/web_login 换取网页会话。本测试覆盖：
 *  [1] app-web-login 的 UserID/Auth 能被带出（扫码结果不再丢字段）
 *  [2] /pc/web_login 使用保存的 UserID/Auth，合并新 sessionid 并轮换 Auth
 *  [3] 缺少 Auth / 续期失败时明确抛错，供上层回退扫码
 *  [4] 不把 Auth 拼进 Cookie、不改变固定字段
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildYktCookieExportJson, parseYktCookieExportJson, renewYuketangSession, yuketangQrPoll } from "../packages/core/src/exthw/index.ts";

const setCookieHeader = (cookies) => ({ "x-onethu-set-cookie": JSON.stringify(cookies) });

/* [1] 扫码成功响应里的 UserID/Auth 必须被带出 */
{
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify({ code: 0, data: { UserID: 10086, Auth: "AUTH-1" } }),
      { headers: setCookieHeader(["sessionid=S1; Path=/", "csrftoken=C1"]) },
    );
  };
  const r = await yuketangQrPoll(fake, "token", { timeoutMs: 1000 });
  assert.equal(r.done, true);
  assert.equal(r.cookie?.includes("sessionid=S1"), true);
  assert.equal(r.userId, "10086");
  assert.equal(r.auth, "AUTH-1");
  assert.equal(calls.length, 1);
}

/* [2] 用 UserID/Auth 换新会话：新 sessionid 覆盖旧值，并轮换 Auth */
{
  let seen;
  const fake = async (url, init) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({ success: true, data: { UserID: 10086, Auth: "AUTH-2" } }),
      { headers: setCookieHeader(["sessionid=S2; Path=/", "csrftoken=C2"]) },
    );
  };
  const r = await renewYuketangSession(
    { cookie: "sessionid=S1; csrftoken=C1; uv_id=2598", userId: "10086", auth: "AUTH-1" },
    fake,
  );
  assert.match(seen.url, /\/pc\/web_login$/);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.body, "UserID=10086&Auth=AUTH-1");
  assert.match(seen.init.headers["Content-Type"], /application\/x-www-form-urlencoded/);
  assert.equal(seen.init.headers["X-CSRFToken"], "C1");
  assert.match(seen.init.headers["Cookie"], /sessionid=S1/);
  assert.equal(r.cookie.includes("sessionid=S2"), true);
  assert.equal(r.cookie.includes("sessionid=S1"), false);
  assert.equal(r.cookie.includes("csrftoken=C2"), true);
  assert.equal(r.cookie.includes("uv_id=2598"), true);
  assert.equal(r.userId, "10086");
  assert.equal(r.auth, "AUTH-2");
  assert.equal(r.cookie.includes("AUTH-1") || r.cookie.includes("AUTH-2"), false);
}

/* [2b] 扫码凭据没有 csrftoken 时，先 GET /web 取 CSRF，再带 Cookie 换票 */
{
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/web")) {
      return new Response("<html></html>", {
        headers: setCookieHeader(["csrftoken=CSRF-PRE; Path=/", "sessionid=FRESH; Path=/"]),
      });
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: setCookieHeader(["sessionid=S3; Path=/"]),
    });
  };
  const r = await renewYuketangSession(
    { cookie: "sessionid=OLD; uv_id=2598", userId: "1", auth: "A" },
    fake,
  );
  assert.equal(calls.length, 2);
  const post = calls[1].init;
  assert.match(post.headers["Cookie"], /sessionid=FRESH/);
  assert.equal(post.headers["X-CSRFToken"], "CSRF-PRE");
  assert.equal(r.cookie.includes("sessionid=S3"), true);
}

/* [3] 没有 Auth 不能发请求；失败响应要明确抛错 */
{
  let calls = 0;
  await assert.rejects(
    () => renewYuketangSession({ cookie: "sessionid=S1" }, async () => { calls++; return new Response("{}"); }),
    /缺少网页换票凭据/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () => renewYuketangSession(
      { cookie: "sessionid=S1", userId: "1", auth: "expired" },
      async () => new Response(JSON.stringify({ success: false, msg: "invalid auth" }), { status: 200 }),
    ),
    /续期失败/,
  );
}

/* [4] 响应没有新 Cookie 时不能谎报成功；body 是 HTML 但 Set-Cookie 有新 sessionid 要接受 */
{
  await assert.rejects(
    () => renewYuketangSession(
      { cookie: "sessionid=S1", userId: "1", auth: "A" },
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    ),
    /续期失败/,
  );
  const r = await renewYuketangSession(
    { cookie: "sessionid=S1; csrftoken=C1", userId: "1", auth: "A" },
    async () => new Response("<html><body>ok</body></html>", {
      status: 200,
      headers: { "content-type": "text/html", "x-onethu-set-cookie": JSON.stringify(["sessionid=S9; Path=/"]) },
    }),
  );
  assert.equal(r.cookie.includes("sessionid=S9"), true);
}

/* [5] 导出/导入保留换票凭据；旧文件缺字段仍能解析 */
{
  const text = buildYktCookieExportJson({
    cookie: "sessionid=S1",
    userId: "10086",
    auth: "AUTH-1",
  });
  const parsed = parseYktCookieExportJson(text);
  assert.equal(parsed.cookie, "sessionid=S1");
  assert.equal(parsed.userId, "10086");
  assert.equal(parsed.auth, "AUTH-1");
  const legacy = parseYktCookieExportJson(JSON.stringify({ kind: "onethu.yuketang.session", version: 1, cookie: "sessionid=S2" }));
  assert.equal(legacy.cookie, "sessionid=S2");
  assert.equal(legacy.auth, undefined);
}

/* [6] 接线护栏：扫码落地保存 Auth、刷新链与心跳都接上免扫码换票 */
{
  const exthw = readFileSync("apps/desktop/src/state/exthw.ts", "utf8");
  const modal = readFileSync("apps/desktop/src/components/ExtHwLoginModal.tsx", "utf8");
  const settings = readFileSync("apps/desktop/src/components/ExtHwSettingsSection.tsx", "utf8");
  assert.match(exthw, /renewYuketangSessionFromStored/);
  assert.match(exthw, /reloginYuketang:\s*\(\)\s*=>\s*renewYuketangSessionFromStored\(\)/);
  assert.match(exthw, /await renewYuketangSessionFromStored\(\)/);
  assert.match(modal, /credential\.userId/);
  assert.match(modal, /credential\.auth/);
  assert.match(settings, /parsed\.userId/);
  assert.match(settings, /parsed\.auth/);
}

console.log("ykt-auth-renew-test: 全部断言通过（扫码捕获 Auth/UserID + /pc/web_login 换票 + 失败回退 + 导出迁移 + 接线）");