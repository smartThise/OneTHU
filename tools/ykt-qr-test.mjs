/**
 * 雨课堂扫码登录状态机单测（离线，不联网）。
 *
 * 运行：node tools/ykt-qr-test.mjs
 *
 * 覆盖：
 *  - 未完成态（服务端明确返回 code≠0）
 *  - 单次长轮询超时 → 自动重发（同一 token）
 *  - 取消（AbortSignal）→ 立即中止、不再发请求
 *  - token 过期 → 自动重建二维码（重取 pre-info）
 *  - 成功 → 解析 Set-Cookie 并补齐清华固定字段
 *  - R18c：扫码保活（Android 前台服务）启停随面板生命周期（stub 断言调用序列）
 *  - R18c-bugfix：isAndroidHost 多信号判定（stub navigator 模拟三种宿主，
 *    回归：tauri.conf 伪装 UA 后 Android 真机仍须判为 Android）
 *  - R20-A：外部作业链接打开通道分流 pickExtHwOpenChannel（Android+http(s) →
 *    应用内 WebView 桌面模式；桌面/预览 → 系统浏览器；非 http(s) → 拒绝）
 *
 * 说明：core 源码内部用 `.js` 扩展名互相引用（TS bundler 解析），Node 类型剥离
 * 不能把 `.js` 映射到 `.ts` —— 这里注册一个同步 resolve 钩子做重映射后再动态 import。
 */
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.endsWith(".js") && context.parentURL?.endsWith(".ts")) {
        try {
          return next(specifier.slice(0, -3) + ".ts", context);
        } catch {
          /* 继续抛原始错误 */
        }
      }
      throw err;
    }
  },
});

const { runYuketangQrLogin, yuketangQrPoll, yuketangQrStart, yuketangCookieFromHeader } = await import(
  "../packages/core/src/exthw/yuketangQr.ts"
);

/* ── 断言小工具 ── */
let failed = 0;
function ok(cond, name, extra = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
  }
}

/* ── 造一个 JWT（exp 为秒）── */
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const makeJwt = (expSeconds) => `${b64url({ typ: "JWT", alg: "HS256" })}.${b64url({ iat: 0, exp: expSeconds })}.sig`;

const preInfoBody = (qrContent, token) => JSON.stringify({ code: 0, msg: "", data: { qrContent, qrImage: "", token } });

/** 造响应：body 为对象 → JSON；setCookies 走传输层自定义头 */
function resp(bodyObj, setCookies) {
  const headers = {};
  if (setCookies) headers["x-onethu-set-cookie"] = JSON.stringify(setCookies);
  return new Response(typeof bodyObj === "string" ? bodyObj : JSON.stringify(bodyObj), { headers });
}

/**
 * 假 fetch：
 *  - pre-info：返回 qrContent=qrN、token=JWT(exp 由 ttlMs/虚拟时钟决定)
 *  - login：按 mode 行为（hang=长轮询挂起 / pending=返回 code≠0 / ok=Set-Cookie 成功）
 * 每次 login 调用推进虚拟时钟 stepMs（模拟长轮询耗时）。
 */
function makeFake({ ttlMs = 60_000, stepMs = 30_000, mode = "hang", limit = Infinity, ac } = {}) {
  const st = { preInfoCalls: 0, loginCalls: 0, clock: 0, qrSeq: 0 };
  const fetchLike = (url, init) => {
    const signal = init?.signal;
    if (url.includes("app-web-pre-info")) {
      st.preInfoCalls++;
      const exp = Math.round((st.clock + ttlMs) / 1000);
      return Promise.resolve(resp(JSON.parse(preInfoBody(`QR-${++st.qrSeq}`, makeJwt(exp)))));
    }
    if (url.includes("app-web-login")) {
      st.loginCalls++;
      if (st.loginCalls >= limit) ac?.abort(); // 触顶后主动取消
      if (mode === "ok") {
        return Promise.resolve(resp({ code: 0, data: {} }, ["sessionid=SESS123; Path=/", "csrftoken=CSRF456"]));
      }
      if (mode === "pending") {
        st.clock += stepMs;
        return Promise.resolve(resp({ code: 1, msg: "未扫码" }));
      }
      // hang：长轮询挂起，直到被 abort
      return new Promise((_, reject) => {
        const onAbort = () => {
          st.clock += stepMs;
          reject(new DOMException("aborted", "AbortError"));
        };
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  };
  return { fetchLike, st };
}

/* ── ① 单次长轮询：超时返回 timedOut ── */
console.log("[1] 单次长轮询超时");
{
  const { fetchLike } = makeFake({ mode: "hang" });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 20 });
  ok(r.done === false && r.timedOut === true, "未扫码挂起 → timedOut（正常，应重发）", JSON.stringify(r));
}

/* ── ② 单次长轮询：服务端明确未完成 → message ── */
console.log("[2] 服务端明确未完成");
{
  const { fetchLike } = makeFake({ mode: "pending" });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 500 });
  ok(r.done === false && !r.timedOut && r.message === "未扫码", "code≠0 → done:false + 服务端 msg", JSON.stringify(r));
}

/* ── ③ 成功：解析 Set-Cookie + 补齐固定字段 ── */
console.log("[3] 成功取回会话");
{
  const { fetchLike } = makeFake({ mode: "ok" });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 500 });
  ok(r.done === true, "code=0 + Set-Cookie → done:true");
  ok(!!r.cookie && r.cookie.includes("sessionid=SESS123") && r.cookie.includes("csrftoken=CSRF456"), "会话 Cookie 取回", r.cookie);
  ok(!!r.cookie && r.cookie.includes("xtbz=ykt") && r.cookie.includes("uv_id=2598") && r.cookie.includes("university_id=2598"), "补齐清华固定字段");
}

/* ── ④ 状态机：未完成态（超时重发）+ token 过期重建 ── */
console.log("[4] 状态机：超时重发 + 过期重建");
{
  const ac = new AbortController();
  const { fetchLike, st } = makeFake({ ttlMs: 60_000, stepMs: 30_000, mode: "hang", limit: 5, ac });
  const phases = [];
  const r = await runYuketangQrLogin({
    fetchLike,
    signal: ac.signal,
    pollTimeoutMs: 5,
    now: () => st.clock,
    onPhase: (p) => phases.push(p.phase),
  });
  const qrCount = phases.filter((p) => p === "qr").length;
  const expiredCount = phases.filter((p) => p === "expired").length;
  ok(r.aborted === true, "触顶取消 → aborted", JSON.stringify(r));
  ok(st.loginCalls === 5, "单次超时后自动重发（同 token 多次轮询）", `loginCalls=${st.loginCalls}`);
  ok(expiredCount >= 2 && qrCount >= 3 && st.preInfoCalls >= 3, "过期后自动重建二维码", `qr=${qrCount} expired=${expiredCount} preInfo=${st.preInfoCalls}`);
}

/* ── ⑤ 状态机：取消（卸载）立即中止，不再发请求 ── */
console.log("[5] 状态机：取消");
{
  const ac = new AbortController();
  const { fetchLike, st } = makeFake({ ttlMs: 600_000, mode: "hang" });
  setTimeout(() => ac.abort(), 30);
  const r = await runYuketangQrLogin({ fetchLike, signal: ac.signal, pollTimeoutMs: 5000, now: () => st.clock });
  ok(r.aborted === true, "取消 → aborted", JSON.stringify(r));
  ok(st.loginCalls === 1, "取消后不再发新请求", `loginCalls=${st.loginCalls}`);
}

/* ── ⑥ 状态机：成功即返回 ── */
console.log("[6] 状态机：成功");
{
  const ac = new AbortController();
  const { fetchLike, st } = makeFake({ mode: "ok" });
  const phases = [];
  const r = await runYuketangQrLogin({
    fetchLike,
    signal: ac.signal,
    pollTimeoutMs: 500,
    now: () => st.clock,
    onPhase: (p) => phases.push(p.phase),
  });
  ok(r.done === true && !!r.cookie && r.cookie.includes("sessionid=SESS123"), "扫码确认 → 返回 cookie", JSON.stringify(r));
  ok(phases[0] === "qr", "先推 qr 阶段");
}

/* ── ⑦ yuketangQrStart：解析 JWT exp ── */
console.log("[7] pre-info 解析（含 JWT exp）");
{
  const expSec = Math.floor(Date.now() / 1000) + 120; // 未来 2 分钟（< 5 分钟兜底，不被封顶）
  const fake = () => Promise.resolve(resp(JSON.parse(preInfoBody("https://x/qr", makeJwt(expSec)))));
  const info = await yuketangQrStart(fake);
  ok(info.qrContent === "https://x/qr" && info.token.startsWith("eyJ"), "返回 qrContent + token");
  ok(info.expireAt === expSec * 1000, "expireAt 取自 JWT exp", `expireAt=${info.expireAt}`);
}

/* ── ⑧ 传输层超时 → 继续轮询（R17 23.1）── */
console.log("[8] 传输层超时 → 继续轮询");
{
  // 8a：yuketangQrPoll 必须把传输层超时放大到「本地轮询 + 10s」，
  // 否则 tauriFetch/Rust http_request 会先于 AbortSignal 抢跑（扫码必失败根因）。
  let seenTimeoutMs;
  const fetchLike = (url, init) => {
    if (url.includes("app-web-pre-info")) {
      return Promise.resolve(resp(JSON.parse(preInfoBody("QR-T", makeJwt(Math.floor(Date.now() / 1000) + 120)))));
    }
    seenTimeoutMs = init?.timeoutMs;
    return Promise.resolve(resp({ code: 1, msg: "未扫码" }));
  };
  await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 28_000 });
  ok(seenTimeoutMs === 38_000, "传输层超时 = 本地轮询 + 10s", `timeoutMs=${seenTimeoutMs}`);
}
{
  // 8b：传输层抛超时（reqwest `operation timed out` / JS 兜底「请求超时」）
  // → 归为 timedOut（未扫码），交由状态机重发，而非当硬错误退出。
  const boom = () =>
    Promise.reject(
      new Error(
        "网络错误: error sending request for url (https://pro.yuketang.cn/api/v3/user/login/app-web-login): operation timed out",
      ),
    );
  const r = await yuketangQrPoll(boom, "tok", { timeoutMs: 500 });
  ok(r.done === false && r.timedOut === true, "传输层超时 → timedOut（继续轮询）", JSON.stringify(r));
}
{
  // 8c：状态机：第一次传输超时、第二次成功 —— 不得因传输超时退出。
  let loginCalls = 0;
  const fetchLike = (url) => {
    if (url.includes("app-web-pre-info")) {
      return Promise.resolve(resp(JSON.parse(preInfoBody("QR-T", makeJwt(Math.floor(Date.now() / 1000) + 120)))));
    }
    loginCalls++;
    if (loginCalls === 1) {
      return Promise.reject(
        new Error(
          "网络错误: error sending request for url (https://pro.yuketang.cn/api/v3/user/login/app-web-login): operation timed out",
        ),
      );
    }
    return Promise.resolve(resp({ code: 0, data: {} }, ["sessionid=SESS123"]));
  };
  const r = await runYuketangQrLogin({ fetchLike, pollTimeoutMs: 1000, now: () => 0 });
  ok(r.done === true && !!r.cookie, "传输超时后继续轮询 → 最终成功", JSON.stringify(r));
  ok(loginCalls === 2, "传输超时被重发（非硬错误退出）", `loginCalls=${loginCalls}`);
}

/* ── ⑨ connection aborted → 继续轮询（R17b 24.1，同 token）── */
console.log("[9] connection aborted → 继续轮询（同 token）");
{
  // 9a：真机退后台被 MIUI 掐断长轮询时 reqwest 抛的传输层错误
  // → 必须归为 timedOut（未扫码），而非硬错误退出。
  const boom = () =>
    Promise.reject(
      new Error(
        "网络错误: error sending request for url (https://pro.yuketang.cn/api/v3/user/login/app-web-login): client error (SendRequest): connection error: connection aborted",
      ),
    );
  const r = await yuketangQrPoll(boom, "tok", { timeoutMs: 500 });
  ok(r.done === false && r.timedOut === true, "connection aborted → timedOut（继续轮询）", JSON.stringify(r));
  ok(
    typeof r.message === "string" && /connection aborted/.test(r.message),
    "原始错误串保留在 message（诊断用）",
    r.message,
  );
}
{
  // 9a′：其它传输层错误（network error / connection reset）同样可恢复
  const netErr = () => Promise.reject(new Error("网络错误: error sending request for url (…): connection reset by peer"));
  const r = await yuketangQrPoll(netErr, "tok", { timeoutMs: 500 });
  ok(r.done === false && r.timedOut === true, "connection reset → timedOut（继续轮询）", JSON.stringify(r));
}
{
  // 9b：状态机：首次 connection aborted、第二次成功 —— 必须用**同一 token** 重发，
  // 不得重建二维码（换 token = 已扫的码作废）。
  const tokens = [];
  let loginCalls = 0;
  const fetchLike = (url, init) => {
    if (url.includes("app-web-pre-info")) {
      return Promise.resolve(
        resp(JSON.parse(preInfoBody("QR-ABORT", makeJwt(Math.floor(Date.now() / 1000) + 120)))),
      );
    }
    loginCalls++;
    tokens.push(JSON.parse(init.body).token);
    if (loginCalls === 1) {
      return Promise.reject(
        new Error(
          "网络错误: error sending request for url (https://pro.yuketang.cn/api/v3/user/login/app-web-login): client error (SendRequest): connection error: connection aborted",
        ),
      );
    }
    return Promise.resolve(resp({ code: 0, data: {} }, ["sessionid=SESS123"]));
  };
  const r = await runYuketangQrLogin({ fetchLike, pollTimeoutMs: 1000, now: () => 0 });
  ok(r.done === true && !!r.cookie, "connection aborted 后继续轮询 → 最终成功", JSON.stringify(r));
  ok(loginCalls === 2, "连接被掐被重发（非硬错误退出）", `loginCalls=${loginCalls}`);
  ok(tokens.length === 2 && tokens[0] === tokens[1], "重发沿用同一 token（二维码不换）", JSON.stringify(tokens));
}

/* ── ⑩ 官方网页通道：Cookie 原文 → 凭据串（R18 24.2）── */
console.log("[10] 官方网页通道：Cookie 原文 → 凭据串");
{
  const cookie = yuketangCookieFromHeader("sessionid=SESS123; csrftoken=CSRF456; uv_id=2598");
  ok(cookie.includes("sessionid=SESS123") && cookie.includes("csrftoken=CSRF456"), "解析出会话 Cookie", cookie);
  ok(
    cookie.includes("xtbz=ykt") && cookie.includes("university_id=2598") && cookie.includes("platform_id=3"),
    "补齐清华固定字段",
    cookie,
  );
  ok(yuketangCookieFromHeader("   ") === "" && yuketangCookieFromHeader("garbage") === "", "空 / 无对原文 → 空串（回退手动粘贴）");
}

/* ── ⑪ R18c：扫码保活启停随面板生命周期 ── */
console.log("[11] R18c：扫码保活启停随面板生命周期");
const tick = () => new Promise((r) => setTimeout(r, 0));
{
  // 11a：Android 正常路径 —— qr 启动、过期停止、刷新重启、成功/取消/卸载收口
  const { createQrKeepAlive, bindQrKeepAlive } = await import("../apps/desktop/src/lib/qrKeepAlive.ts");
  const calls = [];
  const ctrl = createQrKeepAlive({
    isAndroid: true,
    invoke: async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    },
  });
  const ka = bindQrKeepAlive(ctrl);
  ka.onPhase("loading");
  await tick();
  ok(calls.length === 0, "loading 阶段不启停", calls.join(","));

  ka.onPhase("qr");
  await tick();
  ok(calls.join(",") === "start_qr_keep_alive" && ctrl.on === true, "二维码就绪 → start", calls.join(","));

  ka.onPhase("qr");
  await tick();
  ok(calls.join(",") === "start_qr_keep_alive", "重复 qr 幂等（不重复 start）", calls.join(","));

  ka.onPhase("expired");
  await tick();
  ok(
    calls.join(",") === "start_qr_keep_alive,stop_qr_keep_alive" && ctrl.on === false,
    "过期 → stop",
    calls.join(","),
  );

  ka.onPhase("qr");
  await tick();
  ok(calls[calls.length - 1] === "start_qr_keep_alive" && ctrl.on === true, "过期后刷新出新码 → 重新 start");

  ka.stop(); // 成功 / 取消 / 卸载统一收口
  await tick();
  ok(calls.filter((c) => c === "stop_qr_keep_alive").length === 2, "成功 / 取消 / 卸载 → stop", calls.join(","));

  ka.stop(); // 已停后再 stop：幂等，不重复 invoke
  await tick();
  ok(calls.filter((c) => c === "stop_qr_keep_alive").length === 2, "未生效时重复 stop 不重复 invoke", calls.join(","));
}
{
  // 11b：非 Android —— 零行为（不 invoke、不报错）
  const { createQrKeepAlive } = await import("../apps/desktop/src/lib/qrKeepAlive.ts");
  const calls = [];
  const ctrl = createQrKeepAlive({
    isAndroid: false,
    invoke: async (cmd) => {
      calls.push(cmd);
      return { ok: true };
    },
  });
  const r = await ctrl.start();
  await ctrl.stop();
  ok(r.ok === false && r.reason === "not-android", "非 Android → {ok:false, reason:not-android}", JSON.stringify(r));
  ok(calls.length === 0 && ctrl.on === false, "非 Android 不 invoke");
}
{
  // 11c：通知权限被拒 —— 返回 ok:false 不抛错，onStatus 不置 true，未生效时 stop 不 invoke
  const { createQrKeepAlive } = await import("../apps/desktop/src/lib/qrKeepAlive.ts");
  const calls = [];
  const states = [];
  const ctrl = createQrKeepAlive({
    isAndroid: true,
    invoke: async (cmd) => {
      calls.push(cmd);
      return cmd === "start_qr_keep_alive" ? { ok: false, reason: "notifications-denied" } : { ok: true };
    },
    onStatus: (on) => states.push(on),
  });
  const r = await ctrl.start();
  ok(
    r.ok === false && r.reason === "notifications-denied",
    "权限被拒 → {ok:false, reason:notifications-denied}",
    JSON.stringify(r),
  );
  ok(states.length === 0 && ctrl.on === false, "未生效不触发 onStatus（保留「另一台设备」提示）");
  await ctrl.stop();
  ok(calls.join(",") === "start_qr_keep_alive", "未生效时 stop 不 invoke", calls.join(","));
}
{
  // 11d：invoke 抛错（IPC/服务异常）—— 静默降级
  const { createQrKeepAlive } = await import("../apps/desktop/src/lib/qrKeepAlive.ts");
  const ctrl = createQrKeepAlive({
    isAndroid: true,
    invoke: async () => {
      throw new Error("boom");
    },
  });
  const r = await ctrl.start();
  ok(r.ok === false && r.reason === "invoke-error", "invoke 抛错 → {ok:false, reason:invoke-error}（不抛）", JSON.stringify(r));
}

/* ── ⑫ R18c-bugfix：isAndroidHost 判定（stub navigator 模拟三种宿主）── */
console.log("[12] R18c-bugfix：isAndroidHost 多信号判定（stub navigator）");
{
  // androidHost.ts 零依赖，可直接导入；yktWebview.ts 因拖入 @onethu/core（TS 参数属性）
  // 无法在 Node strip 模式下导入，故这里对同一判定函数做 stub 直测。
  const { isAndroidNavigator } = await import("../apps/desktop/src/lib/androidHost.ts");

  // tauri.conf.json windows[].userAgent（webvpn 票绑定 UA，不能改）—— Android 真机被伪装成这条 Windows UA
  const SPOOFED_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

  // 12a：Android 真机（本 bug 回归用例）：UA 被伪装，靠 platform 兜底
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, platform: "Linux armv8l" }) === true,
    "Android 真机：UA 被伪装 + platform 'Linux armv8l' → true（R18c-bugfix 修复点）",
  );
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, platform: "Linux aarch64" }) === true,
    "Android 真机：UA 被伪装 + platform 'Linux aarch64' → true",
  );
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, platform: "Linux armv7l" }) === true,
    "Android 真机（32 位）：platform 'Linux armv7l' → true",
  );
  // 12b：Android 真机：UA 未被伪装（原判定保留）
  ok(
    isAndroidNavigator({
      userAgent: "Mozilla/5.0 (Linux; Android 14; M2012K11AC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
    }) === true,
    "Android：UA 含 Android（未被伪装）→ true（原判定）",
  );
  // 12c：userAgentData.platform 兜底（platform 缺失 / 较新内核）
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, userAgentData: { platform: "Android" } }) === true,
    "Android：userAgentData.platform = 'Android'（UA 被伪装、platform 缺失）→ true",
  );
  // 12d：负例 —— Windows / macOS / Linux-x86 桌面、浏览器预览：三信号均不命中 → false
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, platform: "Win32", userAgentData: { platform: "Windows" } }) === false,
    "Windows 桌面（Win32）→ false（官方网页登录入口继续隐藏）",
  );
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, platform: "MacIntel", userAgentData: { platform: "macOS" } }) === false,
    "macOS 桌面（MacIntel）→ false",
  );
  ok(
    isAndroidNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
    }) === false,
    "Linux-x86 桌面（Linux x86_64）→ false（不得与 arm/aarch 混淆）",
  );
  ok(
    isAndroidNavigator({ userAgent: SPOOFED_UA, platform: "", userAgentData: null }) === false,
    "无任何 Android 信号（浏览器预览兜底）→ false",
  );
  ok(isAndroidNavigator(null) === false && isAndroidNavigator(undefined) === false, "nav 缺失 → false");
}

/* ── ⑬ R20-A：外部作业链接打开通道分流（stub navigator + stub invoke）── */
console.log("[13] R20-A：外部作业链接打开通道分流（pickExtHwOpenChannel）");
{
  const { pickExtHwOpenChannel, isHttpUrl } = await import("../apps/desktop/src/lib/androidHost.ts");

  // R18c-bugfix 同款三宿主信号（外部作业点击处的真实输入形态）
  // tauri.conf.json windows[].userAgent 同串：Android 真机主窗口 UA 被伪装成这条
  const SPOOFED_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";
  const ANDROID_SPOOFED = { userAgent: SPOOFED_UA, platform: "Linux armv8l" }; // UA 被伪装的 Android 真机
  const WINDOWS = { userAgent: SPOOFED_UA, platform: "Win32", userAgentData: { platform: "Windows" } };

  // 13a：http(s) 白名单
  ok(isHttpUrl("https://pro.yuketang.cn/web") === true, "https → 放行");
  ok(isHttpUrl("http://example.com/a?b=1") === true, "http → 放行（含大小写混排协议头场景见下）");
  ok(isHttpUrl("HTTPS://PRO.YUKETANG.CN/WEB") === true, "HTTPS 大写 → 放行（大小写不敏感）");
  ok(isHttpUrl("javascript:alert(1)") === false, "javascript: → 拒绝");
  ok(isHttpUrl("intent://foo#Intent;package=bar;end") === false, "intent: → 拒绝");
  ok(isHttpUrl("data:text/html,x") === false && isHttpUrl("mailto:a@b.c") === false, "data: / mailto: → 拒绝");
  ok(isHttpUrl("") === false, "空串 → 拒绝");

  // 13b：Android 宿主 + http(s) → 应用内 WebView 桌面模式
  ok(
    pickExtHwOpenChannel(ANDROID_SPOOFED, "https://pro.yuketang.cn/web", true) === "webview",
    "Android 真机（UA 被伪装）+ https → webview（R20-A 主链路）",
  );
  ok(
    pickExtHwOpenChannel({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/124 Mobile", platform: "Linux armv8l" }, "http://x.example/", true) === "webview",
    "Android（UA 未被伪装）+ http → webview",
  );
  // 13c：桌面端 / 浏览器预览 → 保持现状系统浏览器
  ok(
    pickExtHwOpenChannel(WINDOWS, "https://pro.yuketang.cn/web", true) === "browser",
    "Windows 桌面 + https → browser（桌面端保持 openExternal 现状）",
  );
  ok(
    pickExtHwOpenChannel(ANDROID_SPOOFED, "https://pro.yuketang.cn/web", false) === "browser",
    "非 Tauri（浏览器预览，即便信号像 Android）→ browser（不 invoke）",
  );
  // 13d：非 http(s) 一律拒绝（Android 也不开 WebView，桌面也不交系统浏览器）
  ok(
    pickExtHwOpenChannel(ANDROID_SPOOFED, "javascript:alert(1)", true) === "reject",
    "Android + javascript: → reject（不开 WebView）",
  );
  ok(
    pickExtHwOpenChannel(WINDOWS, "intent://foo#Intent;package=bar;end", true) === "reject",
    "桌面 + intent: → reject（不交系统浏览器）",
  );
}

console.log("[14] 扫码成功响应携带 UserID/Auth（后续免扫码换票凭据）");
{
  const fetchLike = async () =>
    new Response(JSON.stringify({ code: 0, data: { UserID: 10086, Auth: "AUTH-ROUND-1" } }), {
      headers: { "x-onethu-set-cookie": JSON.stringify(["sessionid=SESS-1; Path=/"]) },
    });
  const r = await yuketangQrPoll(fetchLike, "tok", { timeoutMs: 500 });
  ok(r.done === true && /sessionid=SESS-1/.test(r.cookie ?? ""), "Cookie 仍正常解析");
  ok(r.userId === "10086", "UserID 被带出（数字转字符串）", String(r.userId));
  ok(r.auth === "AUTH-ROUND-1", "Auth 被带出", String(r.auth));
}

console.log(failed === 0 ? "\n全部通过 ✅" : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
