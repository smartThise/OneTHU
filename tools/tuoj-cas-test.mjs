/**
 * TUOJ 清华统一认证（CAS）漫游 —— 单测 / 联调脚本。
 *
 * 运行：node tools/tuoj-cas-test.mjs
 * 可选：source ~/.onethu-creds.env（提供 TYCHE_BASIC 时额外跑 Tyche 验证码探针）
 *
 * ⚠️ 本机没有清华统一认证会话，无法端到端跑通漫游；本脚本覆盖：
 *   ① oauth/info 能取到 CAS 漫游 url；② 表单 url 返回 200 且是 CAS 登录页；
 *   ③ 锚点提取 / 登录页判定 纯函数；④ 无会话时 tuojRoam 抛出可读错误（真实网络）。
 * 说明：core 源码内部用 `.js` 扩展名互引（TS bundler 解析），Node 直引需把
 * `.js` 重解析到 `.ts`——见下方 registerHooks（与 tools/exthw-smoke.mjs 同款限制）。
 */
import * as nodeModule from "node:module";

if (typeof nodeModule.registerHooks !== "function") {
  console.log(`本脚本需要 Node ≥ 22.15（module.registerHooks）以把 .js 直引重解析到 .ts；当前 ${process.version}，跳过。`);
  process.exit(0);
}

nodeModule.registerHooks({
  resolve(specifier, context, next) {
    // InfoClient 依赖链会 import sm-crypto（CJS；Node ESM 认不出其命名导出）。
    // 本脚本只走 checkSingle 取票/兑付路径，不触碰 SM 加解密，注入空壳导出即可。
    if (specifier === "sm-crypto") {
      return {
        url: "data:text/javascript,export const sm2={};export const sm3={};export const sm4={};",
        shortCircuit: true,
      };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
      try {
        return next(specifier.slice(0, -3) + ".ts", context);
      } catch {
        /* 落回原样 */
      }
    }
    return next(specifier, context);
  },
});

const { tuojRoam, TuojCasError, extractTicketAnchor, isCasLoginPage, isCheckSinglePage, isTuojNoCoursesError } = await import(
  "../packages/core/src/exthw/tuojCas.ts"
);
// 经典 TUOJ base（R15 20.1：与 AI 版同套代码，仅 CAS 回调不同）
const { CLASSIC_BASE } = await import("../packages/core/src/exthw/tuoj.ts");
// 真实 InfoClient（#idCheckSingle 复用）——mock HttpClient 注入，验证确认 POST 行为
const { InfoClient } = await import("../packages/core/src/info/client.ts");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? "  " + extra : ""}`);
  }
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

/* ── 最小 HttpClient 替身（真实 fetch + 按域 CookieJar），供 tuojRoam 联调 ── */
function makeFakeHttp() {
  const jar = new Map(); // host → Map(name → value)
  const put = (host, name, value) => {
    if (!jar.has(host)) jar.set(host, new Map());
    jar.get(host).set(name, value);
  };
  const getCookies = (url) => {
    const host = new URL(url).hostname.toLowerCase();
    const out = [];
    for (const [h, m] of jar) {
      if (host === h || host.endsWith("." + h)) for (const [name, value] of m) out.push({ name, value });
    }
    return out;
  };
  const cookieHeader = (url) => {
    const c = getCookies(url);
    return c.length ? c.map((x) => `${x.name}=${x.value}`).join("; ") : null;
  };
  return {
    lastFinalUrl: "",
    jar: { getCookies },
    cookieHeaderFor: cookieHeader,
    async request(url, init = {}) {
      const { direct: _direct, ...rest } = init;
      const headers = new Headers(rest.headers ?? {});
      const ck = cookieHeader(url);
      if (ck && !headers.has("Cookie")) headers.set("Cookie", ck);
      if (!headers.has("User-Agent")) headers.set("User-Agent", UA);
      const res = await fetch(url, { ...rest, headers, redirect: "follow" });
      const host = new URL(res.url || url).hostname.toLowerCase();
      const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const line of lines) {
        const m = /^([^=;]+)=([^;]*)/.exec(line);
        if (m) put(host, m[1].trim(), m[2]);
      }
      this.lastFinalUrl = res.url || url;
      return res;
    },
  };
}

console.log("① oauth/info（真实网络）");
const infoRes = await fetch("https://ai.tuoj.thusaac.com/api/user/oauth/info", { headers: { "User-Agent": UA } });
const info = await infoRes.json();
check("HTTP 200", infoRes.status === 200, `status=${infoRes.status}`);
check("tsinghua.enable === true", info?.tsinghua?.enable === true, JSON.stringify(info?.tsinghua?.enable));
check(
  "url 是 CAS 漫游表单地址",
  typeof info?.tsinghua?.url === "string" &&
    info.tsinghua.url.startsWith("https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/") &&
    info.tsinghua.url.includes("/api/user/tsinghua/roaming/AI-TUOJ"),
  info?.tsinghua?.url,
);

console.log("\n② 表单 url → 无会话时是 CAS 登录页（真实网络）");
const formUrl = info.tsinghua.url;
const formRes = await fetch(formUrl, { headers: { "User-Agent": UA }, redirect: "follow" });
const formHtml = await formRes.text();
check("HTTP 200", formRes.status === 200, `status=${formRes.status}`);
check("isCasLoginPage(html) === true", isCasLoginPage(formHtml) === true, `body=${formHtml.length}B`);
check("登录页锚点不含 ticket（不会误跟）", !String(extractTicketAnchor(formHtml) ?? "").includes("ticket="), String(extractTicketAnchor(formHtml)));

console.log("\n②b 经典 TUOJ oauth/info（真实网络，R15 20.1）");
const classicInfoRes = await fetch(`${CLASSIC_BASE}/api/user/oauth/info`, { headers: { "User-Agent": UA } });
const classicInfo = await classicInfoRes.json();
check("HTTP 200", classicInfoRes.status === 200, `status=${classicInfoRes.status}`);
check("tsinghua.enable === true", classicInfo?.tsinghua?.enable === true, JSON.stringify(classicInfo?.tsinghua?.enable));
check(
  "url 是经典版 CAS 漫游表单地址（回调 .../api/user/tsinghua/login）",
  typeof classicInfo?.tsinghua?.url === "string" &&
    classicInfo.tsinghua.url.startsWith("https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/") &&
    classicInfo.tsinghua.url.includes("/api/user/tsinghua/login"),
  classicInfo?.tsinghua?.url,
);

console.log("\n③ 纯函数单测（构造页）");
const successPage =
  '<html><body>登录成功<script>x</script><a href="https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ?ticket=ST-123456-abc">跳转</a></body></html>';
check(
  "成功页锚点提取",
  extractTicketAnchor(successPage) ===
    "https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ?ticket=ST-123456-abc",
  String(extractTicketAnchor(successPage)),
);
check("相对锚点提取", extractTicketAnchor('<a href="/x?ticket=ST-1">go</a>') === "/x?ticket=ST-1");
check("无锚点 → null", extractTicketAnchor("<html>no link</html>") === null);
check("isCasLoginPage: sm2publicKey", isCasLoginPage('<input id="sm2publicKey" value="aa">') === true);
check("isCasLoginPage: i_pass", isCasLoginPage('<input name="i_pass">') === true);
check("isCasLoginPage: 业务页 → false", isCasLoginPage("<html><body>TUOJ</body></html>") === false);
check(
  "isCheckSinglePage: checkSingle 确认页",
  isCheckSinglePage('<form action="/do/off/ui/auth/login/checkSingle" method="post"></form>') === true,
);
check("isCheckSinglePage: 业务页 → false", isCheckSinglePage("<html><body>TUOJ</body></html>") === false);

console.log("\n④ tuojRoam 无统一认证会话 → 可读错误（真实网络，最小 HttpClient 替身）");
try {
  await tuojRoam(makeFakeHttp());
  check("应抛错但未抛", false);
} catch (e) {
  check("抛 TuojCasError", e instanceof TuojCasError, e?.constructor?.name);
  check(
    "错误消息含「需先登录清华统一认证」",
    e instanceof TuojCasError && e.message.includes("需先登录清华统一认证"),
    e?.message,
  );
}

/* ── mock HttpClient（离线，按 URL/方法路由；记录 calls） ── */
function makeMockHttp(routes) {
  const calls = [];
  const http = {
    lastFinalUrl: "",
    lastCookieNames: "",
    debug: () => {},
    jar: { getCookies: () => [] },
    async request(url, init = {}) {
      const method = (init.method ?? "GET").toUpperCase();
      calls.push({ url: String(url), method, body: init.body ? String(init.body) : "" });
      for (const r of routes) {
        if (r.match(String(url), method)) {
          const body = typeof r.body === "function" ? r.body() : r.body ?? "";
          const res = new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} });
          http.lastFinalUrl = r.finalUrl ?? String(url);
          return res;
        }
      }
      throw new Error(`no mock route: ${method} ${url}`);
    },
    async text(url, init = {}) {
      const res = await http.request(url, init);
      return res.text();
    },
  };
  http.calls = calls;
  return http;
}

/* ── R10 15.1-4：checkSingle 三形态（mock http，离线） ──
 * ①首 GET=密码页 → ensure=ok → 重试=确认页 → 确认 POST→302 ticket → 兑付 → 课程列表 ok
 * ②确认 POST 无 finger3 失败 → 文案分支正确
 * ③ensureOk=false 且无内存凭据 → 无凭据文案
 * ④（附加）ensureOk=false 有凭据 → 直登失败文案 */
const CAS_FORM =
  "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/929e496594c7a63203fb03e457a43c6b/0?/api/user/tsinghua/roaming/AI-TUOJ";
const CHECK_SINGLE_ACTION = "https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle";
const TICKET = "https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ?ticket=ST-123";
const PASSWORD_PAGE = '<html><body><input id="sm2publicKey" value="aa"><input name="i_pass"></body></html>';
const CHECK_SINGLE_PAGE =
  '<html><head><title>Title</title></head><body><form action="/do/off/ui/auth/login/checkSingle" method="post"></form></body></html>';
const OAUTH_INFO = JSON.stringify({ tsinghua: { enable: true, url: CAS_FORM } });
const COURSE_LIST = JSON.stringify({ courses: [{ _id: 8, title: "离散数学" }] });

console.log("\n⑤ checkSingle 三形态（mock http，离线）");
{
  // ① 密码页 → ensure=ok → 重试=确认页 → 确认 POST → 302 ticket → 兑付 → 课程列表
  const formHits = { n: 0 };
  const http = makeMockHttp([
    { match: (u) => u.endsWith("/api/user/oauth/info"), body: OAUTH_INFO },
    {
      match: (u, m) => u === CAS_FORM && m === "GET",
      body: () => (++formHits.n === 1 ? PASSWORD_PAGE : CHECK_SINGLE_PAGE),
      finalUrl: CAS_FORM,
    },
    { match: (u, m) => u === CHECK_SINGLE_ACTION && m === "POST", status: 302, headers: { location: TICKET } },
    {
      match: (u) => u.includes("oauth.tsinghua.edu.cn/lb-auth/lbredirect"),
      body: "",
      headers: { "x-onethu-final-url": TICKET },
    },
    { match: (u) => u.endsWith("/api/course/list"), body: COURSE_LIST },
  ]);
  const info = new InfoClient(http);
  info.setIdCredentials(() => ({ username: "2026000000", password: "pw", fingerprint: "fp", finger3: "f3" }));
  try {
    const r = await tuojRoam(http, {
      ensureIdSession: async () => true,
      hasIdCredentials: () => info.hasIdCredentials(),
      confirmIdCheckSingle: (u) => info.confirmIdCheckSingle(u),
    });
    check("①确认页不再误判、漫游成功", r.courseCount === 1, `courseCount=${r.courseCount}`);
  } catch (e) {
    check("①确认页不再误判、漫游成功", false, e?.message);
  }
  const post = http.calls.find((c) => c.method === "POST" && c.url === CHECK_SINGLE_ACTION);
  check("①确认 POST checkSingle 已发出", Boolean(post), post ? post.url : "(无)");
  check(
    "①确认 POST 带 fingerGenPrint=f3",
    Boolean(post) && post.body.includes("fingerGenPrint=f3"),
    post?.body,
  );
}

{
  // ② 直登已兑付服务票据（ensureOk=true）：CAS 表单仍回登录页也不能据此失败，
  // 以课程列表验收（2026-10-30 真机：consumeServiceTicket 成功后 CAS 必然回登录页）
  const formHits = { n: 0 };
  const http = makeMockHttp([
    { match: (u) => u.endsWith("/api/user/oauth/info"), body: OAUTH_INFO },
    {
      match: (u, m) => u === CAS_FORM && m === "GET",
      body: () => (++formHits.n === 1 ? PASSWORD_PAGE : CHECK_SINGLE_PAGE),
      finalUrl: CAS_FORM,
    },
    { match: (u, m) => u === CHECK_SINGLE_ACTION && m === "POST", body: "<html><body>确认失败，无票据</body></html>" },
    { match: (u) => u.endsWith("/api/course/list"), body: COURSE_LIST },
  ]);
  const info = new InfoClient(http);
  info.setIdCredentials(() => ({ username: "2026000000", password: "pw", fingerprint: "fp" })); // 无 finger3
  const r = await tuojRoam(http, {
    ensureIdSession: async () => true,
    hasIdCredentials: () => info.hasIdCredentials(),
    confirmIdCheckSingle: (u) => info.confirmIdCheckSingle(u),
  });
  check("②ensureOk 后即使 CAS 回登录页，也按课程列表验收成功", r.courseCount === 1, `courseCount=${r.courseCount}`);
}

{
  // ③ ensureOk=false 且无内存凭据 → 无凭据文案
  const http = makeMockHttp([
    { match: (u) => u.endsWith("/api/user/oauth/info"), body: OAUTH_INFO },
    { match: (u, m) => u === CAS_FORM && m === "GET", body: PASSWORD_PAGE, finalUrl: CAS_FORM },
  ]);
  const info = new InfoClient(http);
  info.setIdCredentials(() => null);
  try {
    await tuojRoam(http, {
      ensureIdSession: async () => false,
      hasIdCredentials: () => info.hasIdCredentials(),
      confirmIdCheckSingle: (u) => info.confirmIdCheckSingle(u),
    });
    check("③无凭据应抛错", false);
  } catch (e) {
    check(
      "③文案：内存中没有清华密码",
      e instanceof TuojCasError && e.message.includes("OneTHU 内存中没有清华密码"),
      e?.message,
    );
  }
}

{
  // ④（附加）ensureOk=false 但有内存凭据 → 直登失败文案
  const http = makeMockHttp([
    { match: (u) => u.endsWith("/api/user/oauth/info"), body: OAUTH_INFO },
    { match: (u, m) => u === CAS_FORM && m === "GET", body: PASSWORD_PAGE, finalUrl: CAS_FORM },
  ]);
  const info = new InfoClient(http);
  info.setIdCredentials(() => ({ username: "2026000000", password: "pw", fingerprint: "fp", finger3: "f3" }));
  try {
    await tuojRoam(http, {
      ensureIdSession: async () => false,
      hasIdCredentials: () => info.hasIdCredentials(),
      confirmIdCheckSingle: (u) => info.confirmIdCheckSingle(u),
    });
    check("④有凭据直登失败应抛错", false);
  } catch (e) {
    check(
      "④文案：自动登录清华统一认证未成功",
      e instanceof TuojCasError && e.message.includes("自动登录清华统一认证未成功"),
      e?.message,
    );
  }
}

{
  // ⑤-5（R11 16.2）统一认证已通过、课程列表 401/403 → stage=courses（可能未注册/未选课，
  // 自动登录据此走「无账号」提示而非失败）。CAS 表单返回非中间页、finalUrl 落漫游回调。
  const http = makeMockHttp([
    { match: (u) => u.endsWith("/api/user/oauth/info"), body: OAUTH_INFO },
    {
      match: (u, m) => u === CAS_FORM && m === "GET",
      body: "<html><body>redirecting</body></html>",
      finalUrl: "https://ai.tuoj.thusaac.com/api/user/tsinghua/roaming/AI-TUOJ",
    },
    { match: (u) => u.endsWith("/api/course/list"), status: 403, body: JSON.stringify({ message: "forbidden" }) },
  ]);
  try {
    await tuojRoam(http);
    check("⑤-5 课程列表 403 应抛错", false);
  } catch (e) {
    check("⑤-5 抛 TuojCasError", e instanceof TuojCasError, e?.constructor?.name);
    check("⑤-5 stage === courses", e?.stage === "courses", String(e?.stage));
    check("⑤-5 httpStatus === 403", e?.httpStatus === 403, String(e?.httpStatus));
    check("⑤-5 isTuojNoCoursesError === true", isTuojNoCoursesError(e) === true);
  }
  check("⑤-5 非 courses 错误不判无账号", isTuojNoCoursesError(new Error("x")) === false);
  check(
    "⑤-5 课程列表 200 非 JSON 不判无账号",
    isTuojNoCoursesError(new TuojCasError("x", "", { stage: "courses", httpStatus: 200 })) === false,
  );
}

{
  // ⑦（R15 20.2）经典 TUOJ 漫游：`deps.base` 参数化后，oauth/info、CAS 表单、课程校验
  //    全走经典 base；CAS url 仍取自服务端响应（回调 .../api/user/tsinghua/login）。
  const CLASSIC_FORM =
    "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/929e496594c7a63203fb03e457a43c6b/0?/api/user/tsinghua/login";
  const http = makeMockHttp([
    {
      match: (u) => u === `${CLASSIC_BASE}/api/user/oauth/info`,
      body: JSON.stringify({ tsinghua: { enable: true, url: CLASSIC_FORM } }),
    },
    {
      match: (u, m) => u === CLASSIC_FORM && m === "GET",
      body: "<html><body>redirecting</body></html>",
      finalUrl: `${CLASSIC_BASE}/api/user/tsinghua/login`,
    },
    { match: (u) => u === `${CLASSIC_BASE}/api/course/list`, body: COURSE_LIST },
  ]);
  try {
    const r = await tuojRoam(http, { base: CLASSIC_BASE });
    check("⑦经典 base 漫游成功", r.courseCount === 1, `courseCount=${r.courseCount}`);
  } catch (e) {
    check("⑦经典 base 漫游成功", false, e?.message);
  }
  check(
    "⑦请求 oauth/info 走经典 base",
    http.calls.some((c) => c.url === `${CLASSIC_BASE}/api/user/oauth/info`),
  );
  check(
    "⑦课程校验走经典 base",
    http.calls.some((c) => c.url === `${CLASSIC_BASE}/api/course/list`),
  );
  check(
    "⑦全程未打到 AI base",
    http.calls.every((c) => !c.url.startsWith("https://ai.tuoj.thusaac.com")),
    http.calls.map((c) => c.url).join(" | "),
  );
}

{
  // ⑧（R17 23.3）直登触发 2FA → 文案给出可操作指引，不再只说「详情见诊断日志」
  const http = makeMockHttp([
    { match: (u) => u.endsWith("/api/user/oauth/info"), body: OAUTH_INFO },
    { match: (u, m) => u === CAS_FORM && m === "GET", body: PASSWORD_PAGE, finalUrl: CAS_FORM },
  ]);
  try {
    await tuojRoam(http, {
      ensureIdSession: async () => {
        throw new Error("id 服务登录触发二次认证，请先在应用内重新登录一次（建立设备信任）后重试");
      },
      hasIdCredentials: () => true,
      confirmIdCheckSingle: async () => false,
    });
    check("⑧2FA 应抛错", false);
  } catch (e) {
    check("⑧抛 TuojCasError", e instanceof TuojCasError, e?.constructor?.name);
    check(
      "⑧文案：需要二次认证 + 信任此设备",
      e instanceof TuojCasError && e.message.includes("需要二次认证") && e.message.includes("信任此设备"),
      e?.message,
    );
  }
}

/* ── Tyche 验证码探针（可选：需 TYCHE_BASIC） ── */
if (process.env.TYCHE_BASIC) {
  console.log("\n⑥ Tyche vcode 探针（真实网络）");
  const basic = `Basic ${Buffer.from(process.env.TYCHE_BASIC).toString("base64")}`;
  const tRes = await fetch("http://166.111.236.164:6080/tyche/user/GetToken?username=root", {
    headers: { Authorization: basic, "User-Agent": UA },
  });
  const tJson = await tRes.json().catch(() => null);
  check("GetToken 可用（status=success）", tJson?.status === "success", JSON.stringify(tJson));
  check("GetToken 返回 vcode 字段", typeof tJson?.vcode === "boolean", `vcode=${tJson?.vcode}`);
} else {
  console.log("\n⑥ Tyche vcode 探针：跳过（未设置 TYCHE_BASIC）");
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败。`);
process.exit(fail === 0 ? 0 : 1);
