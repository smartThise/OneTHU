/**
 * F3 静默重登护栏（b16 收窄版）。
 *
 * 本轮口径（2026-10-02，霖拍板）：既有静默重登全在 JS 侧（`lib/clients.ts:libSoftRelogin()`
 * 与 `lib/infoLib.ts:libEnsureSession()`），原来那套「`universalFetch` 全局拦截 + URL→站点映射
 * + 站点 handler 注册」是**重复实现**，已撤除；开关本轮只记录用户偏好，**不接任何真实链路**，
 * 语义等诊断结论。所以本护栏只守三件事：
 *   1. 撤干净了（transport 复原、站点映射与注册 API 不许回来）；
 *   2. 留下来的开关 / 调度器 / 日志出口 / 清除入口 / dev 钩子仍然自洽（行为 + 结构性断言）；
 *   3. 不许偷偷把「凭据重登」接回真实链路（本轮明确不做）。
 *
 * 「单飞 / 限流 / 退避 / 日志不含凭据」是有时序的行为，只做文本断言等于没测，
 * 所以这里**直接加载 TS 源码跑行为自检**（Node 原生类型剥离）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

/* ── localStorage 桩（模块读开关要用） ── */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const R = await import("../apps/desktop/src/lib/relogin.ts");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 结构断言只看代码，不看注释（注释里正当地写着「已撤除 X」，不该被判成回退） */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");

/* ① 默认关：键不存在即关；关着时调度器一个 source 都不许调 */
{
  R.resetReloginStateForTest();
  ok(R.isAutoReloginOn() === false, "自动重登默认必须是关（localStorage 键不存在即关）");
  ok(R.AUTO_RELOGIN_KEY === "onethu.relogin.auto.v1", "开关持久化键被改动了（真机取证要按这个键看）");
  let calls = 0;
  const ran = await R.runRelogin("t-off", async () => {
    calls += 1;
    return true;
  });
  ok(ran === false, "关着开关时 runRelogin 必须返回 false");
  ok(calls === 0, `关着开关时不许调用任何凭据重登（实际 ${calls} 次）`);
}

/* ② 开关读写：开 = 写 "1"，关 = 删键（设置页读的是同一份真相） */
{
  R.resetReloginStateForTest();
  R.setAutoRelogin(true);
  ok(R.isAutoReloginOn() === true && store.get(R.AUTO_RELOGIN_KEY) === "1", "开开关要写 1");
  R.setAutoRelogin(false);
  ok(R.isAutoReloginOn() === false && !store.has(R.AUTO_RELOGIN_KEY), "关开关要删键（回到默认关）");
}

/* ③ 单飞：同来源 3 并发只重登 1 次，且三处拿到同一结果 */
R.setAutoRelogin(true);
{
  R.resetReloginStateForTest();
  let calls = 0;
  const attempt = async () => {
    calls += 1;
    await sleep(40);
    return true;
  };
  const rs = await Promise.all([
    R.runRelogin("t-single", attempt),
    R.runRelogin("t-single", attempt),
    R.runRelogin("t-single", attempt),
  ]);
  ok(rs.every((v) => v === true), "单飞时三个并发都要拿到同一个成功结果");
  ok(calls === 1, `单飞失败：attempt 被调了 ${calls} 次（应为 1）`);
}

/* ④ 限流：冷却期内不再尝试；冷却常量 = 30s */
{
  R.resetReloginStateForTest();
  let calls = 0;
  const attempt = async () => {
    calls += 1;
    return true;
  };
  ok(R.RELOGIN_MIN_INTERVAL_MS === 30_000, "每来源重登最短间隔必须是 30s");
  const t0 = 1_000_000;
  ok((await R.runRelogin("t-throttle", attempt, t0)) === true, "第一次重登应当执行");
  ok((await R.runRelogin("t-throttle", attempt, t0 + 5_000)) === false, "5s 内的第二次必须被限流挡掉");
  ok(calls === 1, `限流失败：冷却期内 attempt 被调了 ${calls} 次（应为 1）`);
  ok((await R.runRelogin("t-throttle", attempt, t0 + 31_000)) === true, "过了 30s 应允许再试");
}

/* ⑤ 失败退避：失败一次后冷却翻倍，封顶 10 分钟 */
{
  R.resetReloginStateForTest();
  const attempt = async () => false;
  await R.runRelogin("t-backoff", attempt, 2_000_000);
  ok(R.reloginCooldownMs("t-backoff") === 60_000, "失败一次后冷却应为 60s");
  await R.runRelogin("t-backoff", attempt, 2_000_000 + 60_000);
  ok(R.reloginCooldownMs("t-backoff") === 120_000, "连续两次失败后冷却应为 120s");
  for (let i = 0; i < 12; i += 1) await R.runRelogin("t-backoff", attempt, 9_000_000 + i * 3_600_000);
  ok(R.reloginCooldownMs("t-backoff") === R.RELOGIN_BACKOFF_MAX_MS, "退避必须封顶在 10 分钟");
  ok(R.RELOGIN_BACKOFF_MAX_MS === 600_000, "退避封顶常量必须是 10 分钟");
}

/* ⑥ 凭据不进日志：成功路径与抛错路径都不许出现账密/票据字样 */
{
  R.resetReloginStateForTest();
  const lines = [];
  R.setReloginLogSink((l) => lines.push(l));
  const SECRET = "hunter2-SECRET-pw";
  await R.runRelogin("t-log-ok", async () => true);
  await R.runRelogin("t-log-err", async () => {
    throw new Error(`登录失败 password=${SECRET} cookie=SESSION=${SECRET} 用户名 2026000000 邮箱 a@b.edu.cn`);
  });
  const bad = lines.filter(
    (l) => l.includes(SECRET) || /password|passwd|cookie|token=|密码|用户名|账密|@b\.edu\.cn/i.test(l),
  );
  ok(bad.length === 0, `日志里出现了凭据字样：${bad.join(" | ")}`);
  ok(lines.length > 0, "重登结果必须落日志（否则真机取证无从下手）");
  R.setReloginLogSink(() => undefined);
}

/* ⑦ dev 一次性取证钩子：标记 → 消费一次 → 立刻失效 */
{
  R.resetReloginStateForTest();
  ok(R.isDevSelfHealFailureArmed() === false, "dev 钩子默认必须是未标记");
  R.armDevSelfHealFailure();
  ok(R.isDevSelfHealFailureArmed() === true, "dev 钩子 armed 状态没记住");
  ok(R.consumeDevSelfHealFailureOnce() === true, "dev 钩子第一次消费必须为 true");
  ok(R.consumeDevSelfHealFailureOnce() === false, "dev 钩子必须一次性（第二次消费为 false）");
  ok(R.isDevSelfHealFailureArmed() === false, "dev 钩子消费后必须清空标记");
}

/* ⑧ 结构性断言：撤干净了 + 结构自洽 + 本轮不接真实链路 */
const TRANSPORT = readFileSync("apps/desktop/src/lib/transport.ts", "utf8");
const SETTINGS = readFileSync("apps/desktop/src/pages/Settings.tsx", "utf8");
const MAIN = readFileSync("apps/desktop/src/main.tsx", "utf8");
const RELOGIN_CODE = stripComments(readFileSync("apps/desktop/src/lib/relogin.ts", "utf8"));
const DEVPANEL = readFileSync("apps/desktop/src/components/DevPanel.tsx", "utf8");
const LAYOUT = readFileSync("apps/desktop/src/components/Layout.tsx", "utf8");
/** 设置页里 F3 这两行（自动重登 / 清除登录信息）的文案切片：只查这两行的用户可见文案 */
const f3From = SETTINGS.indexOf("自动重登");
const f3To = SETTINGS.indexOf("<SectionHead", f3From);
const SETTINGS_F3_COPY = f3To > f3From ? stripComments(SETTINGS.slice(f3From, f3To)) : "";
ok(SETTINGS_F3_COPY.length > 0, "设置页里定位不到 F3 的两行（自动重登 / 清除登录信息）");

/* ⑧.1 transport 复原：不许再有全局拦截，也不许再有站点映射 */
ok(!/withAutoRelogin/.test(TRANSPORT), "transport.ts 里又出现了 withAutoRelogin（回退到 b15 的错口径）");
ok(!/siteOfUrl/.test(TRANSPORT), "transport.ts 里又出现了 siteOfUrl（回退到 b15 的错口径）");
ok(!/from "\.\/relogin\.js"/.test(TRANSPORT), "transport.ts 不该再 import lib/relogin.js");
ok(
  /export const universalFetch: FetchLike = \(url, init\) =>\s*\n?\s*isTauri \? tauriFetch\(url, init\) : window\.fetch\(url, init\);/.test(
    TRANSPORT,
  ),
  "universalFetch 必须复原为「isTauri ? tauriFetch : window.fetch」原样直通",
);

/* ⑧.2 站点映射 / 注册 API / 启动接线全部撤除 */
ok(!existsSync("apps/desktop/src/state/reloginSites.ts"), "state/reloginSites.ts 必须已删除");
ok(!/wireReloginSites/.test(MAIN), "main.tsx 不许再有 wireReloginSites 接线");
for (const name of [
  "siteOfUrl",
  "withAutoRelogin",
  "registerRelogin",
  "registerCredentialClearer",
  "hasReloginHandler",
  "reloginSites",
]) {
  ok(!new RegExp(`\\b${name}\\b`).test(RELOGIN_CODE), `lib/relogin.ts 里又出现了已撤除的 ${name}`);
}

/* ⑧.3 本轮不接真实链路：凭据重登来源与 dev 消费点都不许进业务代码 */
ok(
  !/ensureDirectIdLogin|extHwLogin|credentialReloginFallback/.test(RELOGIN_CODE),
  "凭据重登来源又回到了 lib/relogin.ts（挂点须等诊断结论，不许回退到 b15 口径）",
);
const srcFiles = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p);
  }
})("apps/desktop/src");
const consumers = srcFiles.filter(
  (f) =>
    !f.endsWith("lib/relogin.ts") && // 定义处
    stripComments(readFileSync(f, "utf8")).includes("consumeDevSelfHealFailureOnce("),
);
ok(
  consumers.length === 0,
  `dev 钩子被接到了真实链路（本轮明确不挂）：${consumers.join(", ") || "-"}；仅允许 tools/relogin-test.mjs 消费`,
);
const armers = srcFiles.filter(
  (f) => !f.endsWith("lib/relogin.ts") && stripComments(readFileSync(f, "utf8")).includes("armDevSelfHealFailure("),
);
ok(
  armers.length === 1 && armers[0].endsWith("components/DevPanel.tsx"),
  `dev 钩子只许在 DevPanel 里被调用（实际：${armers.join(", ") || "无"}）`,
);
ok(/armDevSelfHealFailure\(\)/.test(DEVPANEL), "dev 面板没有「模拟登录状态失效」按钮");
ok(
  /__ONETHU_DEV__ \? lazy\(\(\) => import\("\.\/DevPanel\.js"\)\)/.test(LAYOUT),
  "DevPanel 不是 __ONETHU_DEV__ 静态折叠的（dev 钩子会进正式版）",
);

/* ⑧.4 设置页：开关读同一份真相 + 清除入口在位；用户文案不许出现内部名词 */
ok(/isAutoReloginOn\(\)/.test(SETTINGS), "设置页开关没有读同一份真相");
ok(/setAutoRelogin\(/.test(SETTINGS), "设置页开关没有写同一份真相");
ok(
  /clearAllReloginCredentials/.test(SETTINGS) && /清除已保存的登录信息/.test(SETTINGS),
  "设置页缺少清除已保存登录信息的入口",
);
ok(!/会话|凭据|凭证/.test(SETTINGS_F3_COPY), "F3 两行的用户文案里出现了内部名词「会话/凭据」（应说「登录状态/登录信息」）");

/* ⑨ 调度器不许出现「每请求各自重登」的写法（反例：重登风暴） */
ok(/if \(st\.inflight\)/.test(RELOGIN_CODE), "缺少单飞复用分支（反例：每请求各自重登）");
ok(
  /st\.lastAttempt && now - st\.lastAttempt < cooldown/.test(RELOGIN_CODE),
  "缺少限流判定（反例：冷却期内反复重登）",
);
ok(/if \(!isAutoReloginOn\(\)\) return false;/.test(RELOGIN_CODE), "缺少默认关短路（反例：关着开关仍然重登）");
ok(!/for \(.*\)\s*\{\s*[^}]*runRelogin/.test(RELOGIN_CODE), "出现循环重登（反例：重登风暴）");

/* ══════════════════════════════════════════════════════════════════════
 * F3 三修护栏（①②⑤，b16 第二段）：行为自检直接加载 libSessionGuard.ts
 * （零依赖模块，业务侧与护栏共用同一份实现）。
 * ① 判活面扩到子服务；② 探针去假活；⑤ 冷却守卫前置 + 封顶下调 + 手动清零。
 * ══════════════════════════════════════════════════════════════════════ */
const GUARD = await import("../apps/desktop/src/lib/libSessionGuard.ts");
const INFOLIB_SRC = readFileSync("apps/desktop/src/lib/infoLib.ts", "utf8");
const INFOLIB_CODE = stripComments(INFOLIB_SRC);
const CLIENTS_CODE = stripComments(readFileSync("apps/desktop/src/lib/clients.ts", "utf8"));
const RELOAD_CODE = stripComments(readFileSync("apps/desktop/src/lib/reload.ts", "utf8"));
const LAYOUT_CODE = stripComments(readFileSync("apps/desktop/src/components/Layout.tsx", "utf8"));
const STRINGS_SRC = readFileSync("packages/info-lib/src/constants/strings.ts", "utf8");
/** ③ 既有触发/文案的来源文件（结构性断言 + 文案集合同值对照用） */
const CORE_HTTP_CODE = stripComments(readFileSync("packages/core/src/http.ts", "utf8"));
const CORE_INFO_CODE = stripComments(readFileSync("packages/core/src/info/client.ts", "utf8"));
const TRANSPORT_CODE = stripComments(readFileSync("apps/desktop/src/lib/transport.ts", "utf8"));
/** b18：站点表 / 兜底判据的结构断言要看源码（路径特征与真实域的先后顺序等） */
const GUARD_SRC = readFileSync("apps/desktop/src/lib/libSessionGuard.ts", "utf8");
/** b19 P0：三态出口与 data.ts 三处登出分支的结构断言要看源码 */
const DATA_SRC = readFileSync("apps/desktop/src/state/data.ts", "utf8");
const DATA_CODE = stripComments(DATA_SRC);
/** b18 A 的真机样本站点码（用 webvpnDecodeUrl 同源算法解出的真实域见各断言注释） */
const LEARN_SITE_CODE =
  "77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc";
const ZHJWXK_SITE_CODE =
  "77726476706e69737468656265737421eaff4b8b3f3b2653770bc7b88b5c2d320506b1aec738590a49ba";
const ZHJW_SITE_CODE =
  "77726476706e69737468656265737421eaff4b8b69336153301c9aa596522b20bc86e6e559a9b290";

/* ⑩ ① 判活面扩到子服务：alive 后按站点补重建 + 并发单飞 */
{
  const seen = [];
  const okFlow = await GUARD.ensureLibSessionFlow({
    sites: ["learn", "libroom"],
    ensurePortal: async () => true,
    rebuildSite: async (s) => {
      seen.push(s);
      return true;
    },
  });
  ok(okFlow === true, "① 门户 alive + 站点重建成功时 ensureLibSessionFlow 必须返回 true");
  ok(seen.join(",") === "learn,libroom", `① 必须按点名站点补重建（实际 ${seen.join(",") || "无"}）`);

  let deadCalls = 0;
  const okDead = await GUARD.ensureLibSessionFlow({
    sites: ["learn"],
    ensurePortal: async () => false,
    rebuildSite: async () => {
      deadCalls += 1;
      return true;
    },
  });
  ok(okDead === false && deadCalls === 0, `① 门户没活时不许烧票重建子服务（实际调用 ${deadCalls} 次）`);

  GUARD.resetLibSoftStateForTest();
  let rebuilds = 0;
  const flow = () =>
    GUARD.runLibSoftSingleFlight("lib-session", () =>
      GUARD.ensureLibSessionFlow({
        sites: ["seat"],
        ensurePortal: async () => true,
        rebuildSite: async () => {
          rebuilds += 1;
          await sleep(40);
          return true;
        },
      }),
    );
  const conc = await Promise.all([flow(), flow(), flow()]);
  ok(conc.every((v) => v === true), "① 并发三入口都要拿到同一个成功结果");
  ok(rebuilds === 1, `① 单飞失败：并发下站点重建被调了 ${rebuilds} 次（应为 1）`);

  const okFail = await GUARD.ensureLibSessionFlow({
    sites: ["card"],
    ensurePortal: async () => true,
    rebuildSite: async () => false,
  });
  ok(okFail === false, "① 点名站点重建失败时结果必须是 false（否则用户看到假活）");

  ok(GUARD.sitesOfLostUrl("https://learn.tsinghua.edu.cn/f/wlxt/index").join(",") === "learn", "① learn URL 必须映射到 learn");
  ok(
    GUARD.sitesOfLostUrl("https://cab.lib.tsinghua.edu.cn/ic-web/auth/address").join(",") === "libroom",
    "① cab.lib（座位/研讨间）URL 必须映射到 libroom",
  );
  ok(GUARD.sitesOfLostUrl("https://seat.lib.tsinghua.edu.cn/Public/home").join(",") === "seat", "① seat.lib URL 必须映射到 seat");
  ok(GUARD.sitesOfLostUrl("https://card.tsinghua.edu.cn/login").join(",") === "card", "① card URL 必须映射到 card");
  ok(GUARD.sitesOfLostUrl("https://zhjw.cic.tsinghua.edu.cn/portal3rd.do").join(",") === "zhjw", "① 教务 URL 必须映射到 zhjw");
  ok(GUARD.sitesOfLostUrl("https://example.com/x").length === 0, "① 认不出的 URL 不许瞎猜站点");
  ok(
    GUARD.normalizeLibSites(["learn", "learn", "bogus", "card"]).join(",") === "learn,card",
    "① 站点列表必须去重并过滤未知项",
  );

  ok(/ensureLibSessionFlow\(/.test(INFOLIB_CODE), "① libEnsureSession 没有走共享的「alive→按站点补重建」流程");
  ok(
    /export async function libEnsureSession\(opts: \{ sites\?: LibRebuildSite\[\] \}/.test(INFOLIB_CODE),
    "① libEnsureSession 必须接受 sites（按当前失联站点补建）",
  );
  for (const [site, entry] of [
    ["learn", "return await libRoamLearn();"],
    ["card", "await helper.loginCampusCard();"],
    ["seat", 'await info.forceEnsure("library");'],
    ["libroom", "await helper.loginLibraryRoomBooking();"],
    ["zhjw", 'await roam(helper, "default", infoUrls.JXRL_ROAM_ID);'],
  ]) {
    ok(INFOLIB_CODE.includes(entry), `① ${site} 站点没有接到既有重建入口：${entry}`);
  }
  ok(
    /ensurePortal: ensureInfoPortal/.test(INFOLIB_CODE) && /rebuildSite: rebuildLibSite/.test(INFOLIB_CODE),
    "① libEnsureSession 没有把门户判活与站点重建接进共享流程",
  );
  ok(
    /libSitesOfLostUrl\(/.test(INFOLIB_CODE) && /webvpnDecodeUrl\(/.test(INFOLIB_CODE),
    "① 失联 URL 必须先解码回真实域再映射站点",
  );
  ok(
    /libSitesOfLostUrl\(url\)/.test(CLIENTS_CODE) && /libSoftReplayOnce\(await libSoftReloginResult\(sites\)/.test(CLIENTS_CODE),
    "③ nativeFetch 恢复钩子没有按请求落点反推站点后交共享单飞",
  );
  ok(/sites: \["learn"\]/.test(CLIENTS_CODE), "① learn.reloginHook 没有点名 learn 站点");  ok(/libSoftRenewUsable\(\["card"\]\)/.test(CLIENTS_CODE), "① card renewer 没有点名 card 站点");
  // b18 A：看门狗/scope 恢复没有请求上下文 → 只做门户判活，不再用全局「最后一次失败落点」反推站点
  // （b17 真机实录 SOFT-RECOVER[global] fail sites=[libroom] 就是那条过期归属）。
  ok(
    /await libEnsureSessionResult\(\)/.test(RELOAD_CODE) && !/lostSitesFromLastFailure/.test(RELOAD_CODE),
    "① softRecover 必须改为无请求上下文的门户判活（b19 起走三态出口 libEnsureSessionResult；不许再用全局最后落点反推站点）",
  );
}

/* ⑪ ② 探针去假活：本人校验 / 拿不到结论必 fail / 重试一次 */
{
  const okBody = JSON.stringify({ object: { ryh: "2026000000" } });
  ok(GUARD.parseXsrfToken("a=1; XSRF-TOKEN=abc123; b=2") === "abc123", "② XSRF-TOKEN 解析被改动");
  ok(GUARD.judgeInfoProbeBody(okBody, "2026000000") === true, "② 本人 ryh 必须判 alive");
  ok(GUARD.judgeInfoProbeBody(okBody, "2025000000") === false, "② 非本人 ryh 必须判死");
  ok(GUARD.judgeInfoProbeBody("<html>登录页</html>", "2026000000") === null, "② 非 JSON（登录页）必须返回「拿不到结论」");
  ok(GUARD.judgeInfoProbeBody(JSON.stringify({ object: {} }), "2026000000") === null, "② 缺 object.ryh 必须返回「拿不到结论」");
  ok(GUARD.judgeInfoProbeBody(okBody, "") === null, "② 没有期望学号必须返回「拿不到结论」");

  let xsrfFetches = 0;
  const aliveXsrf = await GUARD.probeInfoOwnSession(
    async (u) => {
      xsrfFetches += 1;
      return {
        status: 200,
        body: u.includes("wengine-vpn/cookie") ? "XSRF-TOKEN=same-value;" : "<html>landing</html>",
      };
    },
    "2026000000",
    { sleep: async () => {} },
  );
  ok(aliveXsrf === false, "② 200 + XSRF-TOKEN= 的假活响应绝不许判 alive");
  ok(xsrfFetches === 4, `② 拿不到结论必须重试一次（共 2 轮 × 2 请求，实际 ${xsrfFetches}）`);

  const noConclusion = await GUARD.probeInfoOwnSession(
    async () => ({ status: 500, body: "" }),
    "2026000000",
    { sleep: async () => {} },
  );
  ok(noConclusion === false, "② 拿不到结论（HTTP 500）必须 fail");

  let userDataHits = 0;
  const flaky = await GUARD.probeInfoOwnSession(
    async (u) => {
      if (u.includes("wengine-vpn/cookie")) return { status: 200, body: "XSRF-TOKEN=t;" };
      userDataHits += 1;
      return userDataHits === 1
        ? { status: 200, body: "<html>抖一下</html>" }
        : { status: 200, body: JSON.stringify({ object: { ryh: "2026000000" } }) };
    },
    "2026000000",
    { sleep: async () => {} },
  );
  ok(flaky === true, "② 一次抖动后重试成功必须判 alive");
  ok(userDataHits === 2, `② 抖动重试只许一次（userData 请求实际 ${userDataHits} 次）`);

  ok(!/XSRF-TOKEN=/.test(INFOLIB_CODE), "② infoLib.ts 里又出现了 XSRF-TOKEN 假活判据（应走 judgeInfoProbeBody）");
  ok(/probeInfoOwnSession\(/.test(INFOLIB_CODE), "② infoLib.ts 没有用共享探针 probeInfoOwnSession");
  ok(/LIB-CRED 未命中/.test(INFOLIB_SRC), "② 无登录信息分支必须留 LIB-CRED 未命中日志");

  const cookieConst = /GET_COOKIE_URL\s*=\s*\n?\s*"([^"]+)"/.exec(STRINGS_SRC)?.[1] ?? "";
  const userDataConst = /USER_DATA_URL\s*=\s*\n?\s*"([^"]+)"/.exec(STRINGS_SRC)?.[1] ?? "";
  ok(cookieConst !== "" && cookieConst === GUARD.INFO_PROBE_COOKIE_URL, "② 探针 GET_COOKIE_URL 与 info-lib 常量不同值");
  ok(userDataConst !== "" && userDataConst === GUARD.INFO_PROBE_USER_DATA_URL, "② 探针 USER_DATA_URL 与 info-lib 常量不同值");
}

/* ⑫ ⑤ 冷却语义：守卫前置（并发穿透 1 次）+ 封顶 120s + 手动清零 */
{
  GUARD.resetLibSoftStateForTest();
  ok(GUARD.LIB_SOFT_MIN_INTERVAL_MS === 30_000, "⑤ 最短间隔必须保留 30s 起步（不许放开风控连锤）");
  ok(GUARD.LIB_SOFT_BACKOFF_MAX_MS === 120_000, "⑤ 退避封顶必须是新选的 120s（2min）");

  let penetrations = 0;
  const entry = () =>
    GUARD.runLibSoftSingleFlight("lib-session", async () => {
      penetrations += 1;
      await sleep(40);
      return true;
    });
  const five = await Promise.all([entry(), entry(), entry(), entry(), entry()]);
  ok(five.every((v) => v === true), "⑤ 并发五入口都要拿到同一个成功结果");
  ok(penetrations === 1, `⑤ 守卫未被前置：五入口穿透 ${penetrations} 次（应为 1）`);

  let blockedRuns = 0;
  const blocked = await GUARD.runLibSoftSingleFlight("lib-session", async () => {
    blockedRuns += 1;
    return true;
  });
  ok(blocked === false && blockedRuns === 0, "⑤ 冷却期内的新入口必须被判掉且不执行");

  // 守卫前置的关键：不同入口键并发时，占位冷却必须已同步写回（若写回被挪到 await 之后，
  // 第二个键会穿透守卫 → 穿透数 2）。这是「先置占位再 await」的可观测反例。
  GUARD.resetLibSoftStateForTest();
  let dualPenetration = 0;
  const dualEntry = (key) =>
    GUARD.runLibSoftSingleFlight(key, async () => {
      dualPenetration += 1;
      await sleep(30);
      return true;
    });
  const dual = await Promise.all([dualEntry("lib-session"), dualEntry("site:learn")]);
  ok(dualPenetration === 1, `⑤ 占位冷却未前置：不同键并发穿透 ${dualPenetration} 次（应为 1）`);
  ok(dual.filter((v) => v === true).length === 1, "⑤ 不同键并发只许一个入口真正跑（另一个被冷却判掉）");

  // 链内再入同一键不许等待自己（自锁死会把恢复链和 UI 一起挂住）——本断言跑不完即超时
  // （加 1s 竞速是为了让「await 自身」的反例注入落成**断言失败**，而不是 Node 的
  //  unsettled-top-level-await 进程级退出；判据本身没变）
  GUARD.resetLibSoftStateForTest();
  let nestedResult = null;
  const reent = await Promise.race([
    GUARD.runLibSoftSingleFlight("lib-session", async () => {
      nestedResult = await GUARD.runLibSoftSingleFlight("lib-session", async () => true);
      return true;
    }),
    sleep(1000).then(() => "timeout"),
  ]);
  ok(reent === true && nestedResult === false, "⑤ 链内再入同键必须立即回报 false 而不是等待自己（自锁死）");
  GUARD.resetLibSoftStateForTest(); // 反例注入可能拖住尾链，后续断言不被污染

  GUARD.resetLibSoftStateForTest();
  await GUARD.runLibSoftSingleFlight("lib-session", async () => false);
  const firstBackoff = GUARD.libSoftCooldownLeftMs();
  ok(firstBackoff > 55_000 && firstBackoff <= 60_000, `⑤ 失败一次应为 60s 退避（实际 ${firstBackoff}ms）`);
  for (let i = 0; i < 3; i += 1) {
    GUARD.expireLibSoftCooldownForTest();
    await GUARD.runLibSoftSingleFlight("lib-session", async () => false);
  }
  const capBackoff = GUARD.libSoftCooldownLeftMs();
  ok(capBackoff > 115_000 && capBackoff <= 120_000, `⑤ 退避必须封顶 120s（实际 ${capBackoff}ms）`);

  GUARD.resetLibSoftBackoff();
  ok(GUARD.libSoftCooldownLeftMs() === 0 && GUARD.libSoftStreak() === 0, "⑤ 手动清零必须把冷却与 streak 都归零");
  let afterReset = 0;
  const reran = await GUARD.runLibSoftSingleFlight("lib-session", async () => {
    afterReset += 1;
    return true;
  });
  ok(reran === true && afterReset === 1, "⑤ 清零后下一次恢复必须真的能跑");

  ok(!/let libSoftCooldownUntil/.test(CLIENTS_CODE), "⑤ clients.ts 又自持了 libSoftCooldownUntil（守卫应收在共享单飞）");
  ok(!/10 \* 60_000|600_000/.test(CLIENTS_CODE), "⑤ clients.ts 里还有 10min 封顶残留");
  ok(/resetLibSoftBackoff\(\)/.test(CLIENTS_CODE), "⑤ 交互登录成功路径没有清零冷却");
  ok(/export (?:async )?function clearLibSoftBackoff\(\)/.test(CLIENTS_CODE), "⑤ 缺少 UI 可调用的手动清零出口");
  ok(/clearLibSoftBackoff\(\)/.test(LAYOUT_CODE), "⑤ 用户点「重试」没有清零冷却（ErrorNote 未接线）");
  ok(
    /libSoftStreak\(\)/.test(CLIENTS_CODE) && /libSoftCooldownLeftMs\(\)/.test(CLIENTS_CODE),
    "⑤ SOFT-RELOGIN 日志应带 streak/cooldown 以便真机取证",
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * F3 ③④ 护栏（b17）：③ 触发面下移到 nativeFetch + 删既有重复触发；④ 只加旁证日志。
 * ══════════════════════════════════════════════════════════════════════ */

/* ⑬ ③ 判据：复用既有文案集合与既有登录页集合，不另发明 */
{
  // Rust 鉴权类文案集合必须与 core `isAuthError` 同值（防漂移）
  const coreAuthPattern = /return \/(AuthRequiredError[\s\S]*?)\/i\.test\(/.exec(CORE_INFO_CODE)?.[1] ?? "";
  ok(
    coreAuthPattern !== "" && new RegExp(coreAuthPattern, "i").source === GUARD.LIB_AUTH_ERROR_TEXT.source,
    "③ Rust 鉴权文案集合与 core isAuthError 不同值（判据漂移）",
  );
  ok(GUARD.isLibAuthFailureText("会话已失效，需要重新登录") === true, "③ Rust 侧「会话已失效」必须判为鉴权类错误");
  ok(GUARD.isLibAuthFailureText("未登录") === true, "③ Rust 侧「未登录」必须判为鉴权类错误");
  ok(GUARD.isLibAuthFailureText("HTTP 403") === false, "③ 普通 HTTP 错误不许判成鉴权类错误");
  ok(GUARD.isLibAuthFailureText("预览失败：文件内容为空") === false, "③ 空文件类错误不许判成鉴权类错误");

  // 登录页判据 = 既有集合（body×2 / URL / auth-dance header），逐条对照
  ok(GUARD.looksLibLoggedOut({ body: '<form><input id="sm2publicKey"></form>' }) === true, "③ id=\"sm2publicKey\" 必须命中");
  ok(GUARD.looksLibLoggedOut({ body: '<input name="i_pass">' }) === true, "③ name=\"i_pass\" 必须命中");
  ok(GUARD.looksLibLoggedOut({ url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/?x=1" }) === true, "③ 登录落点 URL 必须命中");
  ok(GUARD.looksLibLoggedOut({ authDance: "webvpn-login" }) === true, "③ x-onethu-auth-dance=webvpn-login 必须命中");
  ok(GUARD.looksLibLoggedOut({ body: '{"object":{"ryh":"2026000000"}}', url: "https://learn.tsinghua.edu.cn/x" }) === false, "③ 普通 200 正常响应不许命中");
  ok(GUARD.looksLibLoggedOut({}) === false, "③ 空响应不许命中");

  // 结构性：判据只此一处（core 里那套已删）
  ok(!/#looksLoggedOut/.test(CORE_HTTP_CODE), "③ core 侧 #looksLoggedOut 必须删除（否则与 nativeFetch 重复触发）");
  ok(!/#reloginInflight/.test(CORE_HTTP_CODE) && !/#relogin\b/.test(CORE_HTTP_CODE), "③ core 侧旧重登单飞必须一并删除");
  ok(!/\.onAuthRequired\(/.test(CLIENTS_CODE), "③ 既有 http.onAuthRequired 实例级触发必须删除");
}

/* ⑭ ③ 编排：一类信号 → 一次重登 + 一次重放；再失败交回原结果/原错误；不许重复触发 */
{
  const classifyLoginPage = (r) =>
    r.status === 200 && GUARD.looksLibLoggedOut({ body: r.body })
      ? { signal: "logged-out-page", detail: "status=200" }
      : null;

  // 命中 → 重登 1 次 + 重放 1 次；重放仍失效 → 交回重放结果，不再重登
  let attempts = 0;
  let recoveries = 0;
  const out = await GUARD.withLibAuthRecovery({
    attempt: async () => {
      attempts += 1;
      return { status: 200, body: '<input name="i_pass">' };
    },
    classifyError: () => null,
    classifyValue: classifyLoginPage,
    recover: async () => {
      recoveries += 1;
      return true;
    },
  });
  ok(attempts === 2, `③ 命中登录页必须只重放一次（尝试实际 ${attempts} 次）`);
  ok(recoveries === 1, `③ 同一失败只许重登一次（实际 ${recoveries} 次）`);
  ok(out.kind === "value" && out.failure !== null, "③ 重放后仍失效要交回重放结果且标记失效");

  // Rust 鉴权类错误：抛错形态 → 同样只重登一次 + 只重放一次
  let errAttempts = 0;
  let errRecoveries = 0;
  const outErr = await GUARD.withLibAuthRecovery({
    attempt: async () => {
      errAttempts += 1;
      throw new Error("会话已失效，需要重新登录");
    },
    classifyError: (e) => (GUARD.isLibAuthFailureText(e?.message) ? { signal: "rust-auth-error", detail: "x" } : null),
    classifyValue: () => null,
    recover: async () => {
      errRecoveries += 1;
      return true;
    },
  });
  ok(errAttempts === 2, `③ Rust 鉴权错误必须只重放一次（尝试实际 ${errAttempts} 次）`);
  ok(errRecoveries === 1, `③ Rust 鉴权错误只许重登一次（实际 ${errRecoveries} 次）`);
  ok(outErr.kind === "error" && outErr.error?.message === "会话已失效，需要重新登录", "③ 再失败必须把（重放后的）原始错误交回调用方");

  // 重登失败 → 不重放，原错误原样交回
  let deadAttempts = 0;
  const outDead = await GUARD.withLibAuthRecovery({
    attempt: async () => {
      deadAttempts += 1;
      throw new Error("会话已失效，需要重新登录");
    },
    classifyError: () => ({ signal: "rust-auth-error", detail: "x" }),
    classifyValue: () => null,
    recover: async () => false,
  });
  ok(deadAttempts === 1, `③ 重登失败不许重放（尝试实际 ${deadAttempts} 次）`);
  ok(outDead.kind === "error" && outDead.error?.message === "会话已失效，需要重新登录", "③ 重登失败必须原样交回第一个错误");

  // 普通 200 正常响应：一次都不许额外请求、不许重登（反例①：判据放宽到所有 200）
  let okAttempts = 0;
  let okRecoveries = 0;
  const outOk = await GUARD.withLibAuthRecovery({
    attempt: async () => {
      okAttempts += 1;
      return { status: 200, body: '{"object":{"ryh":"2026000000"}}' };
    },
    classifyError: () => null,
    classifyValue: classifyLoginPage,
    recover: async () => {
      okRecoveries += 1;
      return true;
    },
  });
  ok(okAttempts === 1 && okRecoveries === 0 && outOk.failure === null, "③ 普通 200 不许触发重登或重放");

  // 并发同一失败：恢复动作走共享单飞 → 真重登只跑一次
  GUARD.resetLibSoftStateForTest();
  let realRelogins = 0;
  const concurrent = () =>
    GUARD.withLibAuthRecovery({
      attempt: async () => ({ status: 200, body: '<input name="i_pass">' }),
      classifyError: () => null,
      classifyValue: classifyLoginPage,
      recover: () =>
        GUARD.runLibSoftSingleFlight("lib-session", async () => {
          realRelogins += 1;
          await sleep(30);
          return true;
        }),
    });
  const outs = await Promise.all([concurrent(), concurrent(), concurrent()]);
  ok(realRelogins === 1, `③ 并发多个失败只许重登一次（实际 ${realRelogins} 次）`);
  ok(outs.every((o) => o.kind === "value" && o.failure !== null), "③ 并发失败都要交回自己的重放结果");

  // 认不出站点 → 不猜；但**不再直接 return false**——转 B 兜底判据（b18）
  ok(GUARD.sitesOfLostUrl("https://example.com/x").length === 0, "③ 认不出的落点必须返回空站点");
  ok(
    /const sites = libSitesOfLostUrl\(url\);/.test(CLIENTS_CODE) && /if \(sites\.length\)/.test(CLIENTS_CODE),
    "③ 恢复钩子必须先按该次请求自身落点反推站点，认得出才走定向重登",
  );
  ok(/siteSrc=request/.test(CLIENTS_CODE), "③ 日志必须标出站点来自该次请求（siteSrc=request）");
  ok(/judgeLibFullChainRecovery\(/.test(CLIENTS_CODE), "③ 认不出站点后必须转 B 兜底判据（不许直接放弃）");

  // 所有重登入口仍走共享单飞；传输层不新增第二套调度
  ok(/setNativeFetchAuthHooks\(/.test(CLIENTS_CODE), "③ nativeFetch 恢复钩子没有接线");
  ok(/withLibAuthRecovery[<(]/.test(TRANSPORT_CODE), "③ nativeFetch 没有走共享的恢复编排");
  /* b36 形状变更（**含义没变**）：判定从 `nativeFetch` 本体搬进两条原生通道共用的唯一入口
   * `judgedNativeFetch()`——单次请求原语仍是编排里被调用的那个 attempt，只是改由各通道自己的
   * 薄壳传入（`() => nativeFetchOnce(url, init)` / `() => tauriFetchOnce(url, init)`）。
   * 「单次请求原语交给编排」这条含义由下面的断言与 ㉘ 共同承担。 */
  ok(
    /return judgedNativeFetch\(url, \(\) => nativeFetchOnce\(url, init\)\);/.test(TRANSPORT_CODE),
    "③ nativeFetch 必须把单次请求原语交给唯一的判定入口（b36 形状变了、含义没变：一次编排 + 至多一次重放）",
  );
  ok(
    !/runLibSoftSingleFlight|libEnsureSession|libSoftRelogin/.test(TRANSPORT_CODE),
    "③ 传输层不许新增第二套调度（恢复动作必须由注入钩子提供）",
  );
  ok(/libSitesOfLostUrl\(url\)/.test(CLIENTS_CODE), "③ 站点必须由请求落点 URL 反推");
  ok(/return libSoftReplayOnce\(await libSoftReloginResult\(sites\), "request"\)/.test(CLIENTS_CODE),
    "③ 恢复必须走共享单飞的三态出口（libSoftReloginResult → libEnsureSessionResult → 同步三态判定；b22 起不再折回布尔）");
}

/* ⑮ ④ 旁证日志：存在且脱敏；播种/回写/清除一律不动 */
{
  ok(GUARD.maskLibTicket("wrdvpn1-8a566dabcdef") === "wrdvpn1-8a56…", "④ 脱敏必须只留前 12 位（前 8 位是固定前缀）");
  ok(GUARD.maskLibTicket(null) === "(无)" && GUARD.maskLibTicket("") === "(无)", "④ 空票值必须显示「(无)」");
  ok(!GUARD.maskLibTicket("wrdvpn1-8a566dabcdef").includes("6d"), "④ 脱敏后不许出现第 13 位起的内容");
  ok(GUARD.maskLibTicket("wrdvpn1-8a566dabcdef").length === 13, "④ 脱敏结果 = 前 12 位 + 省略号");

  ok(/LIB-JAR wengine_vpn_ticket=\$\{maskLibTicket\(/.test(CLIENTS_CODE), "④ LIB-JAR 旁证日志必须走脱敏函数");
  ok(!/LIB-JAR[^\n]*wengine_vpn_ticket=\$\{(?!maskLibTicket)/.test(CLIENTS_CODE), "④ LIB-JAR 日志不许直接插入完整票值");
  ok(/setNativePreflightProbe\(/.test(CLIENTS_CODE), "④ nativeFetch 预检探针没有接线");
  ok(
    /wireUrl\.startsWith\("https:\/\/webvpn\.tsinghua\.edu\.cn\/"\)/.test(CLIENTS_CODE),
    "④ 旁证日志必须只在 webvpn 落点打印（与 [NATIVE-STORE] 行并列）",
  );
  ok(/nativePreflightProbe\?\.\(wireUrl\)/.test(TRANSPORT_CODE), "④ 传输层没有在交给原生仓前回调探针");

  // 播种 / 回写：b21 ④ 起播种统一走 `planSeedToNative`（基础设施票过滤 + 单调保护
  // 都在里面），两处播种口仍原样在位。
  ok((CLIENTS_CODE.match(/nativeSeedCookies\(url,/g) ?? []).length === 2, "④ 两处 nativeSeedHook 播种回写必须原样保留");
  ok(
    /name === "wengine_vpn_ticket" \|\| name\.startsWith\("show_"\)/.test(
      readFileSync("apps/desktop/src/lib/cookieSync.ts", "utf8"),
    ),
    "④ 基础设施票过滤必须保留（不许把 wengine 票播种进原生仓）",
  );
  ok(
    (CLIENTS_CODE.match(/planSeedToNative\(url, pair\)/g) ?? []).length === 2,
    "④ 两处播种口必须都过 planSeedToNative（不许各写一份过滤）",
  );
  ok(/setPlatformClearCookies/.test(INFOLIB_CODE), "④ setPlatformClearCookies 必须在装配处注册（b21 起真正实现）");
}

/* ══════════════════════════════════════════════════════════════════════
 * F3 b18 护栏：A 教务/选课 API 落点的站点归属；B 站点空集时的全链恢复兜底。
 * A 的每条路径特征都在 libSessionGuard.ts 的注释里对着真机样本（URL 去查询串）；
 * 本组把那些样本原样搬进来当断言——样本漂移/特征被改都会红。
 * ══════════════════════════════════════════════════════════════════════ */

/* ⑯ A 站点归属：真实域优先 → 证据驱动路径特征兜底 → 认不出仍为空 */
{
  /* A-1 真机 403 样本（OPPO 10-03 14:49:01.047）：站点码 LEARN_SITE_CODE 解出
     learn.tsinghua.edu.cn；路径 /b/kc/ 是 learn 的教务代理命名空间 → learn。
     注意：这条路径字面里带 zhjw，但归属按真实域/真实通道，不许按字面给 zhjw。 */
  const b17Oppo403 =
    `https://webvpn.tsinghua.edu.cn/https/${LEARN_SITE_CODE}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`;
  ok(
    GUARD.sitesOfLostUrl(b17Oppo403).join(",") === "learn",
    `A 教务 403 真机样本必须归属 learn（实际 ${GUARD.sitesOfLostUrl(b17Oppo403).join(",") || "空"}）`,
  );
  ok(
    GUARD.sitesOfLostUrl(b17Oppo403).join(",") !== "zhjw",
    "A 不许因路径里带 zhjw 字样就归属 zhjw（站点码解出的是 learn，会给错重建入口）",
  );
  ok(
    GUARD.sitesOfLostUrl("https://learn.tsinghua.edu.cn/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester").join(",") ===
      "learn",
    "A 解出真实域后的同一教务 API 必须归属 learn",
  );
  ok(
    GUARD.sitesOfLostUrl(`https://webvpn.tsinghua.edu.cn/https/${LEARN_SITE_CODE}/b/kc/v_wlkc_xk_sjddb/detail`).join(",") ===
      "learn",
    "A 同命名空间的另一条 learn 教务 API（/b/kc/v_wlkc_xk_sjddb/）必须归属 learn",
  );

  /* A-2 真机选课样本（OPPO 10-03 14:48:47.252）：站点码 ZHJWXK_SITE_CODE 解出
     zhjwxk.cic.tsinghua.edu.cn；路径 /js.vjsKcbBs.do 是选课系统 API → zhjw。 */
  ok(
    GUARD.sitesOfLostUrl(`https://webvpn.tsinghua.edu.cn/http/${ZHJWXK_SITE_CODE}/js.vjsKcbBs.do`).join(",") === "zhjw",
    "A 选课 zhjwxk 真机样本（/js.vjsKcbBs.do）必须归属 zhjw",
  );
  for (const u of [
    "https://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksXkbBs.do",
    "https://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksJxjhBs.do",
    "https://zhjwxk.cic.tsinghua.edu.cn/jhBks.vjhBksPyfakcbBs.do",
    "https://zhjwxk.cic.tsinghua.edu.cn/xklogin.do",
  ]) {
    ok(GUARD.sitesOfLostUrl(u).join(",") === "zhjw", `A 选课系统 API 必须归属 zhjw：${u}`);
  }

  /* A-3 真机 zhjw.cic 教务样本（REDMI b17-cold.log）：站点码 ZHJW_SITE_CODE 解出
     zhjw.cic.tsinghua.edu.cn；/portal3rd.do 与 /jxmh_out.do → zhjw。 */
  ok(
    GUARD.sitesOfLostUrl(`https://webvpn.tsinghua.edu.cn/http/${ZHJW_SITE_CODE}/portal3rd.do`).join(",") === "zhjw",
    "A 教务 portal3rd.do 真机样本必须归属 zhjw",
  );
  ok(
    GUARD.sitesOfLostUrl(`https://webvpn.tsinghua.edu.cn/http/${ZHJW_SITE_CODE}/jxmh_out.do`).join(",") === "zhjw",
    "A 课表 jxmh_out.do 真机样本必须归属 zhjw",
  );
  ok(
    GUARD.sitesOfLostUrl("https://zhjw.cic.tsinghua.edu.cn/portal3rd.do").join(",") === "zhjw",
    "A 直连 zhjw.cic 的教务 URL 必须归属 zhjw",
  );

  /* A-4 认不出 → 空集（不许猜） */
  ok(GUARD.sitesOfLostUrl("https://example.com/x").length === 0, "A 认不出的域必须返回空集（不许猜站点）");
  ok(
    GUARD.sitesOfLostUrl(`https://webvpn.tsinghua.edu.cn/https/${"0".repeat(96)}/unknown/path`).length === 0,
    "A 站点码解不出、路径也无特征时必须返回空集",
  );
  ok(
    GUARD.sitesOfLostUrl("").length === 0 && GUARD.sitesOfLostUrl(null).length === 0 && GUARD.sitesOfLostUrl(undefined).length === 0,
    "A 空 URL 必须返回空集",
  );

  /* A-5 真实域优先（路径特征只能兜底，不许改写真实域结论） */
  ok(
    GUARD.sitesOfLostUrl("https://learn.tsinghua.edu.cn/portal3rd.do").join(",") === "learn",
    "A 真实域已认得出时必须以真实域为准（路径特征不许覆盖）",
  );
  ok(
    /const byHost = sitesOfLostHost\(u\);[\s\S]*?if \(byHost\.length\) return byHost;[\s\S]*?return sitesOfLostPath\(u\);/.test(
      GUARD_SRC,
    ),
    "A sitesOfLostUrl 必须「先真实域、后路径特征」，路径特征不许前置",
  );
  ok(
    /webvpnDecodeUrl/.test(INFOLIB_CODE) && /return sitesOfLostUrl\(decoded\);/.test(INFOLIB_CODE),
    "A 失联 URL 必须先用 webvpnDecodeUrl 解回真实域再进站点表",
  );
  ok(
    GUARD.ALL_LIB_REBUILD_SITES.join(",") === "learn,card,seat,libroom,zhjw",
    "A/B 五站点全集必须与 LibRebuildSite 一致（B 的全链恢复按它展开）",
  );

  /* A-6 站点来源：以该次请求自身落点为准，删掉全局「最后一次失败落点」 */
  ok(/siteSrc=request/.test(CLIENTS_CODE), "A 定向重登日志必须标出站点来源 siteSrc=request");
  ok(!/lostSitesFromLastFailure/.test(CLIENTS_CODE), "A clients.ts 里的全局最后落点归属必须删除");
  ok(
    !/lastFinalUrl|lastTarget/.test(CLIENTS_CODE) && !/lastFinalUrl|lastTarget/.test(RELOAD_CODE),
    "A 不许再用 http.lastFinalUrl/http.lastTarget 这类全局状态反推站点",
  );
  ok(
    /siteSrc=none/.test(RELOAD_CODE) && /await libEnsureSessionResult\(\)/.test(RELOAD_CODE),
    "A 无请求上下文的看门狗/scope 恢复只能做门户判活（b19 起走三态出口），日志须标 siteSrc=none",
  );
}

/* ⑰ B 兜底：登录链闸 + 交互登录闸 + 升级判据 + 恰好一次全链恢复 */
{
  /* B-1 登录链自身落点必须被识别（b17 真机 21 条判定里 20 条；OPPO 现场 15 条空集全在 id） */
  for (const u of [
    "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/eea30cbedcaf97c69d28b2d92f2",
    "https://id.tsinghua.edu.cn/do/off/ui/auth/login/check",
    "https://id.tsinghua.edu.cn/do/off/ui/auth/login/checkSingle",
    `https://webvpn.tsinghua.edu.cn/https/${"f".repeat(40)}/do/off/ui/auth/login/form/x/0`,
    "https://webvpn.tsinghua.edu.cn/login?oauth_login=true",
    "https://oauth.tsinghua.edu.cn/lb-auth/lbredirect?scheme=https&host=seat.lib.tsinghua.edu.cn",
    "https://madmodel.cs.tsinghua.edu.cn/model-api/auth-login/check",
  ]) {
    ok(GUARD.isLibLoginChainUrl(u) === true, `B 登录链自身落点必须被判掉（否则触发重登风暴）：${u}`);
  }
  /* 业务请求 URL 不许被误判成登录链——b17 实录：learn 主数据链被 302 进 id 登录表单，
     那条路径的**请求 URL 仍是 learn**，必须照常归属站点并救援。 */
  for (const u of [
    "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/",
    `https://webvpn.tsinghua.edu.cn/https/${LEARN_SITE_CODE}/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester`,
    "https://cab.lib.tsinghua.edu.cn/ic-web/auth/address",
    "https://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksXkbBs.do",
  ]) {
    ok(GUARD.isLibLoginChainUrl(u) === false, `B 业务请求 URL 不许被判成登录链（会漏救真失联）：${u}`);
  }
  /* 该次失败是登录链 200 登录页 → 判据直接给 0 次（哪怕 UI 自认为已登录） */
  let j = GUARD.judgeLibFullChainRecovery({
    onLoginPage: false, interactiveLogin: false, hasCreds: true, loginChainPage: true, now: 1_000_000,
  });
  ok(j.escalate === false && j.reason === "login-chain-page", "B 登录链 200 登录页绝不许触发兜底");
  /* 交互登录 / 2FA 进行中 → 0 次 */
  j = GUARD.judgeLibFullChainRecovery({
    onLoginPage: false, interactiveLogin: true, hasCreds: true, loginChainPage: false, now: 1_000_000,
  });
  ok(j.escalate === false && j.reason === "interactive-login", "B 交互登录进行中绝不许触发兜底");
  ok(GUARD.libEmptySiteHitCount(1_000_000) === 0, "B 被闸掉的判定不许计入空集计数窗");

  /* 最强信号：UI 不在登录页（自认为已登录）→ 立刻升级 */
  GUARD.resetLibEmptySiteWindowForTest();
  j = GUARD.judgeLibFullChainRecovery({
    onLoginPage: false, interactiveLogin: false, hasCreds: false, loginChainPage: false, now: 2_000_000,
  });
  ok(j.escalate === true && j.reason === "ui-not-on-login-page", "B UI 自认为已登录却收到失联信号必须立刻升级全链恢复");

  /* UI 在登录页 + 有登录信息：窗内连续 3 次才升级（一次抖动不许抢跑） */
  GUARD.resetLibEmptySiteWindowForTest();
  const base = 3_000_000;
  const withCreds = (now) =>
    GUARD.judgeLibFullChainRecovery({
      onLoginPage: true, interactiveLogin: false, hasCreds: true, loginChainPage: false, now,
    });
  const j1 = withCreds(base);
  const j2 = withCreds(base + 1_000);
  const j3 = withCreds(base + 2_000);
  ok(j1.escalate === false && j1.hits === 1, "B 登录页 + 有登录信息：第 1 次不许升级");
  ok(j2.escalate === false && j2.hits === 2, "B 登录页 + 有登录信息：第 2 次不许升级");
  ok(j3.escalate === true && j3.reason === "login-page-with-creds×3", "B 登录页 + 有登录信息：第 3 次必须升级（静默重登一次）");
  ok(GUARD.LIB_EMPTY_SITE_ESCALATE_N === 3, "B 升级阈值必须明确写死为 3（不许漂移）");

  /* 计数窗过期：跨窗的旧命中不算 */
  GUARD.resetLibEmptySiteWindowForTest();
  withCreds(base + 100_000);
  withCreds(base + 101_000);
  const outOfWindow = withCreds(base + 101_000 + GUARD.LIB_EMPTY_SITE_WINDOW_MS + 1);
  ok(outOfWindow.escalate === false && outOfWindow.hits === 1, "B 空集计数必须按 60s 窗过期（旧命中不许累计）");

  /* UI 在登录页 + 没有登录信息 → 永远 0 次 */
  GUARD.resetLibEmptySiteWindowForTest();
  let noCredHits = 0;
  for (let i = 0; i < 6; i += 1) {
    const r = GUARD.judgeLibFullChainRecovery({
      onLoginPage: true, interactiveLogin: false, hasCreds: false, loginChainPage: false, now: base + 200_000 + i * 1_000,
    });
    if (r.escalate) noCredHits += 1;
  }
  ok(noCredHits === 0, `B 登录页 + 无登录信息必须 0 次恢复（实际 ${noCredHits} 次）`);

  /* B-2 行为：站点空集 + 满足兜底 → 恰好一次全链恢复；并发/冷却只放行一次 */
  GUARD.resetLibSoftStateForTest();
  let portalRuns = 0;
  let siteRebuilds = 0;
  const hookRecover = async () => {
    const jj = GUARD.judgeLibFullChainRecovery({
      onLoginPage: false, interactiveLogin: false, hasCreds: false, loginChainPage: false,
    });
    if (!jj.escalate) return false;
    return GUARD.runLibSoftSingleFlight("lib-session", () =>
      GUARD.ensureLibSessionFlow({
        sites: [...GUARD.ALL_LIB_REBUILD_SITES],
        ensurePortal: async () => {
          portalRuns += 1;
          await sleep(30);
          return true;
        },
        rebuildSite: async () => {
          siteRebuilds += 1;
          return true;
        },
      }),
    );
  };
  const outs = await Promise.all([hookRecover(), hookRecover(), hookRecover(), hookRecover(), hookRecover()]);
  ok(portalRuns === 1, `B 五入口并发只许真恢复一次（门户判活实际 ${portalRuns} 次）`);
  ok(siteRebuilds === 5, `B 一次全链恢复必须补建五个站点（实际 ${siteRebuilds} 次）`);
  ok(outs.every((v) => v === true), "B 并发的兜底入口都要拿到同一个成功结果");
  const afterCooldown = await hookRecover();
  ok(afterCooldown === false && portalRuns === 1, "B 30s 冷却期内的后续空集判定不许再恢复");

  /* B-3 恢复失败不重试风暴：失败一次即落 60s 退避 */
  GUARD.resetLibSoftStateForTest();
  let failRuns = 0;
  const failingRecover = () =>
    GUARD.runLibSoftSingleFlight("lib-session", async () => {
      failRuns += 1;
      return false;
    });
  const failOuts = await Promise.all([failingRecover(), failingRecover(), failingRecover(), failingRecover(), failingRecover()]);
  ok(failRuns === 1, `B 恢复失败不许重试风暴（实际 ${failRuns} 次）`);
  ok(failOuts.every((v) => v === false), "B 失败结果必须如实交回 false");
  const failCooldown = GUARD.libSoftCooldownLeftMs();
  ok(failCooldown > 55_000 && failCooldown <= 60_000, `B 恢复失败后应落 60s 退避（实际 ${failCooldown}ms）`);
  GUARD.resetLibSoftBackoff();
  ok(GUARD.libEmptySiteHitCount() === 0, "B 手动清零必须一并清空空集计数窗（下一次现场从头计）");

  /* B-4 结构性：兜底必须走既有共享单飞，传输层不许有第二套调度 */
  ok(/judgeLibFullChainRecovery\(/.test(CLIENTS_CODE), "B 恢复钩子没有接入站点空集兜底判据");
  ok(
    /return libSoftReplayOnce\(await libSoftReloginResult\(\[\.\.\.ALL_LIB_REBUILD_SITES\]\), "escalate"\)/.test(CLIENTS_CODE),
    "B 兜底必须交既有共享单飞（libSoftReloginResult → libEnsureSessionResult，五站点）",
  );
  ok(/isLibLoginChainUrl\(url\)/.test(CLIENTS_CODE), "B 登录链闸必须按该次请求 URL 判定");
  ok(
    /if \(!j\.escalate\) return false;/.test(CLIENTS_CODE),
    "B 判据说不升级时必须直接返回 false（0 次恢复）",
  );
  ok(
    !/hookReloginInflight|reloginCooldown|hookCooldownUntil/.test(CLIENTS_CODE),
    "B 兜底不许在业务侧新建第二套单飞/冷却标识符（只能复用 libSessionGuard 的共享单飞）",
  );
  ok(
    /libLoginPending\(\)/.test(CLIENTS_CODE) && /loginCooldownLeftMs\(\) > 0/.test(CLIENTS_CODE),
    "B 「交互登录中」必须复用既有 loginGate 冷却与 lib 登录链挂起状态",
  );
  ok(
    /onLoginPage: session\.state !== "ready"/.test(CLIENTS_CODE),
    "B 「UI/会话在登录页」必须取既有会话标记（session.state）",
  );
  ok(
    !/cooldown|Cooldown|inflight|Inflight|singleFlight|SingleFlight/.test(TRANSPORT_CODE),
    "B 传输层不许出现 cooldown/inflight/singleFlight 标识符（第二套调度）",
  );
  ok(/runLibSoftSingleFlight/.test(GUARD_SRC), "B 恢复仍必须走 libSessionGuard 的共享单飞");
}

/* ══════════════════════════════════════════════════════════════════════
 * ⑱ P0 三态（b19）：done / failed / skipped + 旧布尔薄封装 + data.ts 三处登出分支。
 *
 * 背景：`runLibSoftSingleFlight` 的 `false` 同时表示「真失败」与「被占位冷却/在飞判掉、
 * 任务根本没执行」；`state/data.ts` 三处据此 `backToLogin()`（b18 真机：运行中会话全灭 →
 * 恢复落占位冷却窗内 0ms 返回 false → 用户被踢到登录页且 ≥2 分钟不自愈）。
 * 本组先测三态本身（含 **skipped 同步返回、绝不 await 自身**），再守 data.ts 的
 * 三个 P0 分支「只有 failed 才 backToLogin」与「skipped 原地留可重试错误条」。
 * ══════════════════════════════════════════════════════════════════════ */
{
  /* ⑱-1 真执行且成功 → done；成功后 streak 归零、仍落 30s 起步冷却 */
  GUARD.resetLibSoftStateForTest();
  let doneRuns = 0;
  const doneRes = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    doneRuns += 1;
    await sleep(20);
    return true;
  });
  ok(doneRes.state === "done" && doneRes.reason === undefined, `P0 真成功必须回 state=done（实际 ${JSON.stringify(doneRes)}）`);
  ok(doneRuns === 1, `P0 真成功任务只许执行一次（实际 ${doneRuns}）`);
  ok(GUARD.libSoftStreak() === 0, "P0 成功后 streak 必须归零");
  const afterDoneCd = GUARD.libSoftCooldownLeftMs();
  ok(afterDoneCd > 25_000 && afterDoneCd <= 30_000, `P0 成功后仍写 30s 起步占位冷却（实际 ${afterDoneCd}ms）`);

  /* ⑱-2 真执行且失败（返回 false / 抛错）→ failed，退避仍按 30s×2^streak 推进 */
  GUARD.resetLibSoftStateForTest();
  const failRes = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
  ok(failRes.state === "failed", `P0 真失败必须回 state=failed（实际 ${JSON.stringify(failRes)}）`);
  ok(GUARD.libSoftStreak() === 1, `P0 真失败必须推进 streak（实际 ${GUARD.libSoftStreak()}）`);
  const failCd = GUARD.libSoftCooldownLeftMs();
  ok(failCd > 55_000 && failCd <= 60_000, `P0 真失败仍走 30s×2^1=60s 退避（实际 ${failCd}ms）`);
  GUARD.resetLibSoftStateForTest();
  const threwRes = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    throw new Error("boom");
  });
  ok(threwRes.state === "failed", "P0 任务抛错同样按 state=failed 结算（不许漏成 done）");

  /* ⑱-3 占位冷却窗内 → skipped/cooldown，且任务执行次数为 0、不推进 streak */
  GUARD.resetLibSoftStateForTest();
  let cdRuns = 0;
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => { cdRuns += 1; return true; });
  const cdRes = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => { cdRuns += 1; return true; });
  ok(cdRes.state === "skipped" && cdRes.reason === "cooldown", `P0 冷却窗内必须是 skipped/cooldown（实际 ${JSON.stringify(cdRes)}）`);
  ok(cdRuns === 1, `P0 冷却窗内任务执行次数必须为 0（实际新增 ${cdRuns - 1}）`);
  ok(cdRes.pending === undefined, "P0 cooldown 跳过没有在飞链可等（pending 必须为空）");
  ok(GUARD.libSoftStreak() === 0, "P0 冷却跳过不许推进 streak（否则退避窗被跳过事件污染）");

  /* ⑱-4 同键在飞 + 链内再入 → skipped/reentrant：同步返回（不 await 自身）、不自锁死。
     外层任务**真的 await 内层结果**——正确实现里内层是同步 resolve 的 skipped，
     若把内层改成 await 外层在飞 promise（自锁语义破坏），这里会整条挂住直到竞速超时。 */
  GUARD.resetLibSoftStateForTest();
  let innerResult = null;
  let innerAwaited = null;
  let innerSyncSettled = false;
  let reentTimedOut = false;
  const outerRes = await Promise.race([
    GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
      const innerPromise = GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
        throw new Error("链内再入时内层任务绝不许执行");
      });
      innerPromise.then((r) => { innerResult = r; innerSyncSettled = true; });
      // 同步性判据：已 resolve 的 promise 的 then 回调，排在下面这行 await 的续体之前
      await Promise.resolve();
      innerAwaited = await innerPromise;
      return true;
    }),
    sleep(1000).then(() => "timeout"),
  ]);
  if (outerRes === "timeout") reentTimedOut = true;
  ok(!reentTimedOut, "P0 链内再入同键不许 await 自身（自锁死超时）");
  ok(innerSyncSettled === true, "P0 reentrant 必须同步返回（同一微任务 tick 内已就绪，不许 await 自身）");
  ok(
    innerResult !== null && innerResult.state === "skipped" && innerResult.reason === "reentrant",
    `P0 链内再入必须是 skipped/reentrant（实际 ${JSON.stringify(innerResult)}）`,
  );
  ok(
    innerAwaited !== null && innerAwaited.state === "skipped" && innerAwaited.reason === "reentrant",
    `P0 链内再入的结果必须可 await（正确实现里它就是已就绪的 skipped，实际 ${JSON.stringify(innerAwaited)}）`,
  );
  ok(outerRes !== "timeout" && outerRes.state === "done", "P0 外层链结果不受内层 skipped 影响");
  ok(GUARD.libSoftStreak() === 0, "P0 链内再入跳过不许推进 streak");
  GUARD.resetLibSoftStateForTest(); // 清掉反例注入可能拖住的尾链，后续断言不被污染

  /* ⑱-5 cooldown:false 的站点键不受冷却影响（门户 alive 后仍按站点补建） */
  GUARD.resetLibSoftStateForTest();
  let siteRuns = 0;
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => true); // 置 30s 占位冷却
  const siteA = await GUARD.runLibSoftSingleFlightResult("site:learn", async () => { siteRuns += 1; return true; }, { cooldown: false });
  const siteB = await GUARD.runLibSoftSingleFlightResult("site:learn", async () => { siteRuns += 1; return true; }, { cooldown: false });
  ok(
    siteA.state === "done" && siteB.state === "done" && siteRuns === 2,
    `P0 cooldown:false 的站点键不受冷却影响（每次都要真执行，实际 ${siteRuns} 次）`,
  );

  /* ⑱-6 旧布尔薄封装：done→true、skipped→false（旧语义逐字保留，⑫ 的 ⑤ 组不受影响） */
  GUARD.resetLibSoftStateForTest();
  ok((await GUARD.runLibSoftSingleFlight("lib-session", async () => true)) === true, "P0 旧布尔薄封装 done→true");
  let wrapRuns = 0;
  const wrappedSkipped = await GUARD.runLibSoftSingleFlight("lib-session", async () => { wrapRuns += 1; return true; });
  ok(wrappedSkipped === false && wrapRuns === 0, "P0 旧布尔薄封装把 skipped 折成 false（既有调用点语义不变）");

  /* ⑱-7 结构性：data.ts 三处 P0 分支必须依据三态 */
  ok(/libEnsureSessionResult\(\)/.test(DATA_CODE), "P0-1 relearnRoamOnce 必须消费三态出口 libEnsureSessionResult");
  ok(!/libEnsureSession\(\)/.test(DATA_CODE), "P0-1 不许再把布尔 libEnsureSession() 的 false 当失败（三态没透传）");
  ok(!/if \(!ok\) return false/.test(DATA_CODE), "P0-1 三态被折回布尔（skipped 又等价于失败）");
  ok(/if \(r\.state !== "done"\) return r;/.test(DATA_CODE), "P0-1 skipped/failed 必须原样透传给调用方");
  ok(/settleLibSoftPending\(await relearnRoamOnce\(\)\)/.test(DATA_CODE) && /re\.state === "done"/.test(DATA_CODE), "P0-1 静默刷新出口也必须按 done 判定（不许布尔折返；且要在守卫之外等真结算）");
  ok(/softRecoverResult\("campus"\)/.test(DATA_CODE), "P0-2 campus 路径必须消费三态出口 softRecoverResult");
  ok(!/await softRecover\("campus"\)/.test(DATA_CODE), "P0-2 campus 路径不许再消费布尔 softRecover（会把 skipped 当失败）");
  ok(/if \(recovered\.state === "failed" \|\| reRoamed\.state === "failed"\)/.test(DATA_CODE),
    "P0-2 只有「两个恢复入口都 failed」才 backToLogin（不许把 skipped 折进来）");
  ok(/if \(reRoamed\.state === "skipped"\)/.test(DATA_CODE), "P0-3 learn 路径必须显式处理 skipped（不许当失败）");

  const campusBlock = DATA_CODE.slice(
    DATA_CODE.indexOf('logPageError("CAMPUS-AUTH"'),
    DATA_CODE.indexOf('logPageError("CAMPUS", err)'),
  );
  const learnBlock = DATA_CODE.slice(
    DATA_CODE.indexOf('logPageError("LEARN-AUTH"'),
    DATA_CODE.indexOf('logPageError("LEARN", err)'),
  );
  ok(campusBlock.length > 0 && learnBlock.length > 0, "P0 结构性断言取不到 campus/learn 的 AuthRequired 分支");
  /* 「布尔 false → backToLogin」在 P0 两处必须绝迹：登出点前必须是有三态判定支撑的分支 */
  const campusLogout = campusBlock.indexOf("backToLogin()");
  const learnLogout = learnBlock.indexOf("backToLogin()");
  ok(campusLogout >= 0 && learnLogout >= 0, "P0 真失败分支必须保留 backToLogin（防吞真失败）");
  ok(/state === "failed"/.test(campusBlock.slice(0, campusLogout)),
    "P0-2 campus 登出前必须出现 failed 三态判定（不许拿到布尔 false 就登出）");
  ok(
    learnBlock.indexOf('state === "skipped"') >= 0 && learnBlock.indexOf('state === "skipped"') < learnLogout,
    "P0-3 learn 的 skipped 分支必须在 backToLogin 之前（skipped 不许登出）",
  );
  ok(/state === "skipped"[\s\S]*?return;[\s\S]*?backToLogin\(\)/.test(learnBlock),
    "P0-3 learn 的 skipped 分支必须原地 return（不得 fallthrough 到 backToLogin）");
  /* skipped 路径必须落「原地可重试错误条」（复用既有 setState(\"error\")/setError，不新造 UI） */
  for (const [name, block] of [["P0-2 campus", campusBlock], ["P0-3 learn", learnBlock]]) {
    ok(
      /setState\("error"\)/.test(block) && /setError\(RELOGIN_PENDING_NOTE\)/.test(block) && /return;/.test(block),
      `${name} skipped 路径必须落原地可重试错误条并原地返回（不许把用户置为登出）`,
    );
  }
  const pendingNote = /export const RELOGIN_PENDING_NOTE\s*=\s*\n?\s*"([^"]+)"/.exec(DATA_SRC)?.[1] ?? "";
  ok(pendingNote !== "", "P0 缺少 skipped 路径的用户文案常量 RELOGIN_PENDING_NOTE");
  ok(!/会话|凭据/.test(pendingNote), `P0 新用户文案不许出现内部名词「会话/凭据」：${pendingNote}`);

  /* ⑱-8 三态出口连线：reload / clients / infoLib 的薄封装与真机取证日志 */
  ok(
    /export function softRecoverResult\(/.test(RELOAD_CODE) && /export function softRecover\(/.test(RELOAD_CODE),
    "P0 softRecover 必须三态出口 + 旧布尔薄封装并存",
  );
  ok(/await libEnsureSessionResult\(\)/.test(RELOAD_CODE), "P0 softRecover 必须消费三态出口（无请求上下文的门户判活）");
  ok(/state=\$\{r\.state\}/.test(RELOAD_CODE), "P0 SOFT-RECOVER 日志必须带 state=（真机判据 A 要读 skipped）");
  ok(
    /export async function libEnsureSessionResult\(/.test(INFOLIB_CODE) &&
      /export async function libEnsureSession\(opts: \{ sites\?: LibRebuildSite\[\] \}/.test(INFOLIB_CODE),
    "P0 libEnsureSession 必须三态出口 + 旧布尔薄封装并存（旧签名不许动）",
  );
  ok(/runLibSoftSingleFlightResult\("lib-session"/.test(INFOLIB_CODE), "P0 libEnsureSessionResult 必须走共享单飞的三态出口");
  ok(
    /libSoftReloginResult\(/.test(CLIENTS_CODE) && /SOFT-RELOGIN state=\$\{r\.state\}/.test(CLIENTS_CODE),
    "P0 SOFT-RELOGIN 日志必须按 state=done|failed|skipped 落（不许再把两种含义都写成 fail）",
  );
  ok(/reason=\$\{r\.reason\}/.test(CLIENTS_CODE), "P0 SOFT-RELOGIN 日志必须带 reason=（cooldown|reentrant）");
  ok(
    /async function libSoftRelogin\(sites: LibRebuildSite\[\] = \[\]\): Promise<boolean>/.test(CLIENTS_CODE),
    "P0 clients.ts 必须保留旧布尔薄封装 libSoftRelogin（b19 定下的旧语义出口；b22 起本文件内已无调用点，定义与语义仍不许消失）",
  );
  ok(
    /export interface LibSoftResult/.test(GUARD_SRC) && /export type LibSoftState = "done" \| "failed" \| "skipped"/.test(GUARD_SRC),
    "P0 三态类型必须定义在 libSessionGuard.ts 且只有三个取值",
  );
}

/* ══════════════════════════════════════════════════════════════════════
 * ⑲ P0 收口（b20）：① 止血——今日页新闻源的有界退避 + 单飞 + 日志去重 +
 *   渲染期不写日志；② 判据 C——`skipped/reentrant + pending` 在守卫之外结算真结果。
 *
 * 背景（b19 真机，`<设备>` REDMI，真死会话）：
 *  - 今日页新闻源 844 条 `PAGE-ERR TODAY-NEWS` / 139s（≈6/s、峰值 8/s），
 *    同 buffer `TODAYCAL-SHAPE` 1272 条：失败后无条件立刻重拉 + 渲染期写日志；
 *  - 真结算 `failed`（id 限流 `Failed to get public key.`）被页面层拿到的 `skipped`
 *    遮住：运输层恢复钩子持飞 → 页面层只看得到「没执行」，既不登出也不自愈。
 * 本组用**零依赖模块**（`state/todayNewsRetry.ts` / `state/libSoftSettle.ts`）做行为
 * 断言，再对 `state/data.ts` / `lib/libSessionGuard.ts` 做结构性断言。
 * ══════════════════════════════════════════════════════════════════════ */
const SETTLE = await import("../apps/desktop/src/state/libSoftSettle.ts");
const SETTLE_CODE = stripComments(readFileSync("apps/desktop/src/state/libSoftSettle.ts", "utf8"));
const RETRY = await import("../apps/desktop/src/state/todayNewsRetry.ts");
const GUARD_CODE_19 = stripComments(GUARD_SRC);
{
  /* ⑲-1 退避纯函数：零延迟起步 / 指数递增 / 封顶 / 成功复位 / 有界 */
  ok(RETRY.TODAYNEWS_RETRY_BASE_MS === 3_000, "止血：退避起步必须是 3s");
  ok(RETRY.TODAYNEWS_RETRY_MAX_MS === 60_000, "止血：退避封顶必须是 60s（每分钟至多一份请求）");
  ok(RETRY.TODAYNEWS_RETRY_MAX_ATTEMPTS === 6, "止血：单串自动重试上限必须是 6（有界）");
  ok(RETRY.nextTodayNewsRetryDelay(0) === 0, "止血：attempt=0 必须零延迟（首次立即，健康路径观感不变）");
  ok(RETRY.nextTodayNewsRetryDelay(-1) === 0, "止血：负数 attempt 也必须零延迟（不许 NaN/负值塞给 setTimeout）");
  const seq = [1, 2, 3, 4, 5, 6, 7, 12].map((n) => RETRY.nextTodayNewsRetryDelay(n));
  ok(seq[0] === 3_000 && seq[1] === 6_000 && seq[2] === 12_000 && seq[3] === 24_000,
    `止血：连续失败必须按 3s×2^(n-1) 递增（实际 ${seq.join(",")}）`);
  ok(seq.every((v, i) => i === 0 || v >= seq[i - 1]), `止血：退避必须单调不减（实际 ${seq.join(",")}）`);
  ok(seq[seq.length - 1] === 60_000 && RETRY.nextTodayNewsRetryDelay(99) === 60_000,
    `止血：退避必须封顶 60s（实际 ${seq[seq.length - 1]} / ${RETRY.nextTodayNewsRetryDelay(99)}）`);
  ok(RETRY.nextTodayNewsRetryDelay(5) === 48_000 && RETRY.nextTodayNewsRetryDelay(0) === 0,
    "止血：成功复位必须回到零延迟（纯函数无隐藏状态）");
  ok(!RETRY.shouldRetryTodayNews(0), "止血：没失败过不许排重试");
  ok([1, 2, 3, 4, 5].every((n) => RETRY.shouldRetryTodayNews(n)), "止血：1..5 次连续失败仍允许重试");
  ok(!RETRY.shouldRetryTodayNews(6) && !RETRY.shouldRetryTodayNews(7), "止血：第 6 次连续失败起必须停（有界）");

  /* ⑲-2 判据 C 行为：reentrant + pending → 用真结算；cooldown / 无 pending → 绝不 await */
  let release = null;
  const gate = new Promise((res) => {
    release = res;
  });
  let reentrantSettled = false;
  const reentrantP = SETTLE.settleLibSoftPending({
    state: "skipped",
    reason: "reentrant",
    pending: gate,
  });
  reentrantP.then(() => {
    reentrantSettled = true;
  });
  await Promise.resolve();
  ok(reentrantSettled === false, "C：skipped/reentrant + pending 必须真的等 pending（不许同步返回假结果）");
  release({ state: "failed" });
  const reFailed = await reentrantP;
  ok(reFailed.state === "failed", `C：pending 结算 failed 必须浮出 failed（实际 ${JSON.stringify(reFailed)}）`);
  const reDone = await SETTLE.settleLibSoftPending({
    state: "skipped",
    reason: "reentrant",
    pending: Promise.resolve({ state: "done" }),
  });
  ok(reDone.state === "done", `C：pending 结算 done 必须原样成为 done（实际 ${JSON.stringify(reDone)}）`);
  const reRejected = await SETTLE.settleLibSoftPending({
    state: "skipped",
    reason: "reentrant",
    pending: Promise.reject(new Error("boom")),
  });
  ok(reRejected.state === "failed", "C：pending 抛错必须归成 failed（不许吞成 skipped）");

  const cooldown = { state: "skipped", reason: "cooldown" };
  let cooldownSettled = false;
  const cooldownP = SETTLE.settleLibSoftPending(cooldown);
  cooldownP.then(() => {
    cooldownSettled = true;
  });
  await Promise.resolve();
  ok(cooldownSettled === true, "C：skipped/cooldown 必须同一微任务内就绪（绝不 await、绝不瞎等）");
  ok((await cooldownP) === cooldown, "C：skipped/cooldown 必须原样返回同一个对象（不改写、不新建）");
  const reNoPending = { state: "skipped", reason: "reentrant" };
  let noPendingSettled = false;
  SETTLE.settleLibSoftPending(reNoPending).then(() => {
    noPendingSettled = true;
  });
  await Promise.resolve();
  ok(noPendingSettled === true, "C：reentrant 但缺 pending 必须立即返回（pending 缺失时不许瞎等）");
  ok((await SETTLE.settleLibSoftPending(reNoPending)) === reNoPending, "C：缺 pending 必须原样返回");

  /* ⑲-3 判据 C 动作映射：只有 failed 落登录页；done 重取；其余留错误条 */
  ok(SETTLE.libSoftPageAction({ state: "failed" }) === "back-to-login", "C：真失败必须 back-to-login");
  ok(SETTLE.libSoftPageAction({ state: "done" }) === "retry-load", "C：真成功必须 retry-load（重取一次）");
  ok(SETTLE.libSoftPageAction({ state: "skipped", reason: "cooldown" }) === "show-pending-note",
    "C：cooldown 判掉必须留错误条（绝不 back-to-login）");
  ok(SETTLE.libSoftPageAction({ state: "skipped", reason: "reentrant" }) === "show-pending-note",
    "C：缺 pending 的 reentrant 必须留错误条（绝不 back-to-login）");
  ok(
    SETTLE.libSoftPageAction(await SETTLE.settleLibSoftPending(cooldown)) !== "back-to-login",
    "C：cooldown 走完整链路后也绝不许 back-to-login",
  );

  /* ⑲-4 结构性：`await pending` 只许出现在守卫之外、且在 reentrant+pending 早返回之后 */
  ok(!/await[^\n;]*\bpending\b/.test(GUARD_CODE_19), "C：守卫内部绝不许 await pending（等自己 → 自锁）");
  const settleGuard = SETTLE_CODE.indexOf('r.reason !== "reentrant" || !r.pending) return r;');
  const settleAwait = SETTLE_CODE.indexOf("await r.pending");
  ok(settleGuard >= 0, "C：settleLibSoftPending 必须有「非 reentrant / 无 pending 立即 return」的守卫");
  ok(settleAwait > settleGuard, "C：await pending 必须排在早返回之后（cooldown 分支不可能走到它）");
  ok(!/\.pending\b/.test(DATA_CODE), "C：data.ts 不许自己 await pending（统一走 settleLibSoftPending，守卫之外）");
  const settleCalls = DATA_CODE.match(/await settleLibSoftPending\(/g) ?? [];
  ok(settleCalls.length >= 3, `C：三处 P0 出口都要在守卫之外结算 pending（实际 ${settleCalls.length} 处）`);
  ok(
    /const reRoamed = await settleLibSoftPending\(await relearnRoamOnce\(\)\)/.test(DATA_CODE),
    "C：relearnRoamOnce 的返回必须先经 settleLibSoftPending 再判定",
  );
  ok(
    /const recovered = await settleLibSoftPending\(await softRecoverResult\("campus"\)\)/.test(DATA_CODE),
    "C：campus 的 softRecoverResult 也必须先结算 pending 再判定",
  );
  ok(
    /const raw = await m\.libEnsureSessionResult\(\);\s*const r = await settleLibSoftPending\(raw\);/.test(DATA_CODE),
    "C：relearnRoamOnce 内部的 libEnsureSessionResult 出口必须先结算 pending",
  );
  const campusBlock19 = DATA_CODE.slice(
    DATA_CODE.indexOf('logPageError("CAMPUS-AUTH"'),
    DATA_CODE.indexOf('logPageError("CAMPUS", err)'),
  );
  const learnBlock19 = DATA_CODE.slice(
    DATA_CODE.indexOf('logPageError("LEARN-AUTH"'),
    DATA_CODE.indexOf('logPageError("LEARN", err)'),
  );
  ok(
    campusBlock19.indexOf("await settleLibSoftPending(") >= 0 &&
      campusBlock19.indexOf("await settleLibSoftPending(") < campusBlock19.indexOf("backToLogin()"),
    "C：campus 必须在 backToLogin 之前结算 pending（否则真失败仍被 skipped 遮住）",
  );
  ok(
    learnBlock19.indexOf("await settleLibSoftPending(") >= 0 &&
      learnBlock19.indexOf("await settleLibSoftPending(") < learnBlock19.indexOf("backToLogin()"),
    "C：learn 必须在 backToLogin 之前结算 pending",
  );
  ok(
    /if \(recovered\.state === "failed" \|\| reRoamed\.state === "failed"\) \{/.test(campusBlock19) &&
      /if \(reRoamed\.state === "skipped"\) \{/.test(learnBlock19),
    "C：只有真 failed 才 backToLogin（cooldown 的 skipped 分支必须先原地 return）",
  );
  ok(
    /if \(reRoamed\.state === "skipped"\)/.test(learnBlock19) &&
      /setError\(RELOGIN_PENDING_NOTE\)/.test(learnBlock19),
    "C：cooldown 仍走 b19 的 skipped 分支（原地留可重试错误条）",
  );

  /* ⑲-5 结构性止血：单飞 / 退避接线 / 日志去重 / load 不再依赖 data */
  ok(/todayNewsInflight/.test(DATA_CODE) && /if \(running\) return running;/.test(DATA_CODE),
    "止血：同一 feedKey 必须单飞（同一时刻不许并发多份新闻请求）");
  ok(/nextTodayNewsRetryDelay\(attemptRef\.current\)/.test(DATA_CODE),
    "止血：TODAY-NEWS 失败路径必须走退避纯函数（不许无条件立刻重拉）");
  ok(/shouldRetryTodayNews\(attemptRef\.current\)/.test(DATA_CODE),
    "止血：自动重试必须有界（不许无限重试）");
  ok(/logPageError\("TODAY-NEWS", err\)/.test(DATA_CODE) && /todayNewsLogged\.has\(feedKey\)/.test(DATA_CODE),
    "止血：TODAY-NEWS 失败日志必须按失败串去重（退避期只记一次）");
  ok(!/\[status, subsKey, feedKey, data\]/.test(DATA_CODE),
    "止血：useTodayNewsFeed 的 load 不许再把 data 放进依赖（紧环根因）");
  ok((DATA_CODE.match(/attemptRef\.current = 0;/g) ?? []).length >= 2,
    "止血：失败计数必须在成功路径与手动刷新路径都复位");
  ok(/dataRef\.current/.test(DATA_CODE), "止血：失败判定必须走 ref（不许用闭包里的旧 data）");

  /* ⑲-6 结构性止血：今日校历渲染期不再写日志（b19：TODAYCAL-SHAPE 1272 条/139s） */
  ok(!/if \(nodes !== null && !Array\.isArray\(nodes\)\)/.test(DATA_CODE),
    "止血：TODAYCAL-SHAPE 不许再写在渲染期（每次渲染都会写一条）");
  ok(
    /useEffect\(\(\) => \{\s*if \(nodes === null \|\| Array\.isArray\(nodes\)\) return;/.test(DATA_CODE),
    "止血：TODAYCAL-SHAPE 必须搬进 effect",
  );
  ok(/shapeLoggedRef/.test(DATA_CODE), "止血：TODAYCAL-SHAPE 必须每种形状只写一次（去重标记）");
  ok(
    /cacheFetch\(TODAYCAL_SRC_KEY/.test(DATA_CODE) &&
      /cacheSet\(TODAYCAL_KEY, nodes2\)/.test(DATA_CODE) &&
      !/cacheFetch\(TODAYCAL_KEY/.test(DATA_CODE),
    "止血：原始日历与派生节点必须分键缓存（否则 nodes 又是非数组对象）",
  );
  ok(/return c && Array\.isArray\(c\.data\) \? c\.data : null;/.test(DATA_CODE),
    "止血：读 todaycal 缓存必须按 Array.isArray 消毒（旧毒化缓存不上屏）");
}

/* ══════════════════════════════════════════════════════════════════════
 * ⑳ 两仓同步（b21 ④）：单调保护 / 同步挂点 / 清仓两仓 / 结构性。
 *
 * 背景（阶段 0 只读取证，REDMI dev 包 b20 的两样本冷启）：
 *  - 实际发请求的是原生仓（`lib.rs:1351` 的 `http_native` 丢弃调用方 Cookie 头，
 *    收发全走 `SharedNativeJar`）；JS jar 只是影子 + 老通道供票。
 *  - 真机：JS jar 的 `wengine_vpn_ticket` 恒为持久化快照里的 `wrdvpn1-b293…`
 *    （跨进程不变），原生仓每次冷启从 `(无)` 铸新票（`ae98a5…` / `80f516…`），
 *    并列数百行从不相等，且 JS 侧那张票从未被任何一方更新。
 * 本组用零依赖模块 `lib/cookieSync.ts` 做行为断言，再对 `transport.ts` /
 * `clients.ts` / `infoLib.ts` 做结构性断言。
 * ══════════════════════════════════════════════════════════════════════ */
const CS = await import("../apps/desktop/src/lib/cookieSync.ts");
const CS_CODE = stripComments(readFileSync("apps/desktop/src/lib/cookieSync.ts", "utf8"));
{
  /* ⑳-1 单调保护：新票覆盖旧票；旧票回放一律拒收（两个方向都测） */
  const K = CS.cookieSyncKey("webvpn.tsinghua.edu.cn", "/", "wengine_vpn_ticket");
  CS.resetCookieSyncState();
  ok(CS.decideCookieSync(K, "v-old") === "accept", "④ 单调：首个观测值必须被采纳");
  ok(CS.decideCookieSync(K, "v-old") === "same", "④ 单调：同值重复必须判 same（幂等，不重复写）");
  ok(CS.decideCookieSync(K, "v-new") === "accept", "④ 单调：新票必须覆盖旧票（新→旧方向之外都放行）");
  ok(CS.decideCookieSync(K, "v-old") === "stale", "④ 单调：旧票不许覆盖新票（回放必须拒收）");
  ok(CS.decideCookieSync(K, "v-new") === "same", "④ 单调：被采纳的新票仍是当前值");
  ok(CS.decideCookieSync(K, "v-newer") === "accept", "④ 单调：更新的票继续覆盖");
  ok(CS.cookieSyncKey("WebVPN.Tsinghua.EDU.CN", "/", "wengine_vpn_ticket") === K, "④ 键必须对主机名大小写归一");
  /* 冷启基线：先用水合出来的旧值当世代 0，第一张新票上位后旧值即退役 */
  CS.resetCookieSyncState();
  ok(CS.decideCookieSync(K, "fresh", "persisted-old") === "accept", "④ 单调：水合基线是旧值时，第一张新票必须采纳");
  ok(CS.decideCookieSync(K, "persisted-old") === "stale", "④ 单调：此后持久化旧值回放必须拒收（2026-09-17 现场形态）");
  ok(
    CS.isWengineInfraCookie("wengine_vpn_ticket") &&
      CS.isWengineInfraCookie("show_vpn") &&
      CS.isWengineInfraCookie("heartbeat") &&
      CS.isWengineInfraCookie("refresh"),
    "④：基础设施票名单必须与播种过滤同一份（wengine_vpn_ticket/show_*/heartbeat/refresh）",
  );
  ok(!CS.isWengineInfraCookie("JSESSIONID") && !CS.isWengineInfraCookie("XSRF-TOKEN"), "④：应用会话票不算基础设施票");

  /* ⑳-2 同步挂点：只在「原生响应带 Set-Cookie」时产生回灌，且只在值真的变化时写 */
  CS.resetCookieSyncState();
  ok(CS.planNativeCookieMirror([]).length === 0, "④ 挂点：没有 Set-Cookie 的请求必须 0 次回灌（不是每请求动作）");
  ok(
    CS.planNativeCookieMirror([{ u: "https://learn.tsinghua.edu.cn/", l: "JSESSIONID=abc; Path=/" }]).length === 0,
    "④ 挂点：非基础设施票不走物理域回灌（仍走既有解码入账，本模块不碰）",
  );
  const mirror = CS.planNativeCookieMirror([
    { u: "https://webvpn.tsinghua.edu.cn/login?oauth_login=true", l: "wengine_vpn_ticket=wrdvpn1-abc123" },
  ]);
  ok(
    mirror.length === 1 &&
      mirror[0].url === "https://webvpn.tsinghua.edu.cn/login?oauth_login=true" &&
      mirror[0].line === "wengine_vpn_ticket=wrdvpn1-abc123; Path=/",
    "④ 回灌：裸 Set-Cookie 必须归一化为 `name=value; Path=/` 后按物理跳域入账（否则 JS 侧永远读不到新票）",
  );
  ok(
    CS.planNativeCookieMirror([{ u: "https://webvpn.tsinghua.edu.cn/", l: "wengine_vpn_ticket=wrdvpn1-abc123; Path=/" }])
      .length === 0,
    "④ 回灌：同值重复不许重复写（幂等；稳态下每请求 0 次）",
  );
  ok(
    CS.planNativeCookieMirror([
      { u: "https://webvpn.tsinghua.edu.cn/", l: "wengine_vpn_ticket=wrdvpn1-xyz789; Domain=.tsinghua.edu.cn; Path=/https/x" },
    ])[0]?.line === "wengine_vpn_ticket=wrdvpn1-xyz789; Path=/",
    "④ 回灌：必须收窄到「物理域 + Path=/」这一个键（否则同名异键副本会让两仓看起来仍不同步）",
  );
  /* 结构性：回灌必须在 http_native 之后、且被「有 Set-Cookie」门控 */
  const invokeAt = TRANSPORT_CODE.indexOf('invoke<HttpOutput>("http_native"');
  const sinkAt = TRANSPORT_CODE.indexOf("nativeCookieSink?.(res.set_cookie_hops");
  ok(invokeAt > 0 && sinkAt > 0 && invokeAt < sinkAt, "④ 挂点：回灌必须挂在 http_native 之后（不许在每请求前播种）");
  ok(
    /if \(res\.set_cookie_hops && res\.set_cookie_hops\.length > 0\) \{\s*try \{\s*nativeCookieSink\?\./.test(
      TRANSPORT_CODE,
    ),
    "④ 挂点：回灌必须被「本次响应真的带 Set-Cookie」门控（无 Set-Cookie 的请求 0 次）",
  );
  ok(
    (CLIENTS_CODE.match(/nativeSeedHook = \(url, pair\) => \{\s*const line = planSeedToNative\(url, pair\);/g) ?? [])
      .length === 2,
    "④ 播种：共用 http 实例（learn 之外的 info/card/seat/libroom/zhjw）与 learn 专线必须走同一条带单调保护的播种口",
  );
  ok(
    (CLIENTS_CODE.match(/nativeSeedCookies\(/g) ?? []).length === 2,
    "④ 播种：nativeSeedCookies 只允许出现在两个播种口里（不许新增旁路调用）",
  );
  ok(/setNativeCookieSink\(\(hops\) => \{/.test(CLIENTS_CODE), "④ 结构性：回灌必须在客户端装配处接线");
  ok(/resetCookieSyncState\(\)/.test(CLIENTS_CODE), "④ 结构性：冷启水合后必须重置 cookie 世代（旧值退役基线）");

  /* ⑳-3 播种方向的单调保护：只有「新→旧」被拒 */
  CS.resetCookieSyncState();
  const LEARN = "https://learn.tsinghua.edu.cn/";
  ok(CS.planSeedToNative(LEARN, "csrftoken=v1") === "csrftoken=v1; Path=/", "④ 播种：应用域票必须能播进原生仓");
  ok(CS.planSeedToNative(LEARN, "csrftoken=v2") === "csrftoken=v2; Path=/", "④ 播种：更新后的票必须能覆盖");
  ok(CS.planSeedToNative(LEARN, "csrftoken=v1") === null, "④ 播种：被换掉的旧票回放必须拒收（旧不许盖新）");
  ok(CS.planSeedToNative(LEARN, "csrftoken=v2") === null, "④ 播种：同值重复不重复播（幂等）");
  ok(CS.planSeedToNative("https://webvpn.tsinghua.edu.cn/", "wengine_vpn_ticket=wrdvpn1-x") === null,
    "④ 播种：基础设施票绝不播种（2026-09-17 真票被引导页旧票覆盖的现场）");
  ok(/if \(isWengineInfraCookie\(name\)\) return null;/.test(CS_CODE), "④ 播种：基础设施票过滤必须在同一个判定函数里（不许各处各写一份）");

  /* ⑳-4 清仓：setPlatformClearCookies 真正实现，且两个仓一起清、全清只在显式登出 */
  ok(/setPlatformClearCookies\(\(\) => \{/.test(INFOLIB_CODE), "④ 清仓：setPlatformClearCookies 必须真正实现（不许再是空函数）");
  ok(!/setPlatformClearCookies\(\(\) => \{[\s\S]{0,900}?void 0;/.test(INFOLIB_CODE), "④ 清仓：不许留 `void 0` 式空实现");
  ok(
    /async function clearBothCookieJarsFull\(\): Promise<void> \{\s*http\.jar\.clear\(\);\s*await nativeCookieClearAll\(\)/.test(
      INFOLIB_CODE,
    ),
    "④ 清仓：两仓全清必须同时触达 JS jar 与原生仓",
  );
  ok(
    /export async function nativeCookieClearAll\(\)[\s\S]*?invoke\("http_native_clear_cookies"\)/.test(TRANSPORT_CODE),
    "④ 清仓：原生全清必须打到 http_native_clear_cookies",
  );
  const fullBranchAt = INFOLIB_CODE.indexOf("if (explicitLogoutClear) {");
  ok(
    fullBranchAt > 0 && INFOLIB_CODE.indexOf("void clearBothCookieJarsFull();", fullBranchAt) > fullBranchAt,
    "④ 清仓：两仓全清只允许在显式登出分支（explicitLogoutClear）里",
  );
  ok(
    (INFOLIB_CODE.match(/explicitLogoutClear = true/g) ?? []).length === 1,
    "④ 清仓：全清标记只许显式登出（libLogout）置位",
  );
  ok(
    /export async function libLogout\(\): Promise<void> \{[\s\S]*?clearCookies\(\)/.test(INFOLIB_CODE),
    "④ 清仓：显式登出必须经平台清仓钩子清两仓",
  );
  ok(
    /export async function libLogin\([\s\S]*?nativeCookieClear\(\)\.catch/.test(INFOLIB_CODE),
    "④ 清仓：登录（含静默重登）仍只走既有 nativeCookieClear 的 id/oauth 边界——绝不全清",
  );
  const libLoginAt = INFOLIB_CODE.indexOf("export async function libLogin(");
  const libLoginChunk = INFOLIB_CODE.slice(libLoginAt, INFOLIB_CODE.indexOf("export async function libSend2FA("));
  ok(!/explicitLogoutClear = true/.test(libLoginChunk), "④ 清仓：登录链路绝不许置全清标记（不许在正常业务流里清仓）");
  ok(
    /http\.jar\.clear\("id\.tsinghua\.edu\.cn"\);\s*http\.jar\.clear\("oauth\.tsinghua\.edu\.cn"\);/.test(INFOLIB_CODE),
    "④ 清仓：登录前的平台清仓只许按 id/oauth 域清（对齐既有 nativeCookieClear 边界）",
  );

  /* ⑳-5 传输层仍然不持调度状态（沿用既有口径：单飞/冷却/退避都在 libSessionGuard） */
  ok(!/libSoftCooldownUntil|libSoftStreak|libSoftSingleFlight|RL_SOFT|cooldownUntil/.test(TRANSPORT_CODE),
    "④ 结构性：transport.ts 仍不许出现单飞/冷却调度状态");
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉑ P1 三处旧布尔出口（b22）：`skipped` 不再被当成失败结论。
 *
 * 背景（b21 段末普查留下的 P1 三处，消费点都还拿到折出来的布尔 `false`）：
 *  - `lib/clients.ts` 的 nativeFetch 恢复钩子（旧 `:320` / `:348`）：`skipped` 时打
 *    「重登未成功 → 不重放」——把「被冷却判掉 / 链内再入」与「真失败」混成一个结论；
 *  - `lib/clients.ts` 的 renewer 桥（旧 `:280` / `:281`）：把 `false` 交给 core 的
 *    `#withRenew` / `#withCardSession` / `#ensureCardSession` → core 立刻抛原
 *    `AuthRequiredError`（用户见错误条）；
 *  - `pages/info/tabStates.tsx` 的 `logTabErr`（旧 `:22` / `:33`）：`skipped` 时不自动重拉，
 *    错误条多留一次。
 *
 * **两档口径（b22 真机窗口一改出来的）**：钩子由「某一次请求」的失败触发，而恢复链自身的
 * 请求也走同一个 `nativeFetch` —— 链内请求命中登录页时钩子拿到的 `pending` 就是**它自己
 * 所在的那条链**，`await` 它＝自锁（真机实录：23:24:16 起链、23:33:20 仍在飞，期间零结算
 * 零重建，会话再也恢复不了）。所以：
 *  - 运输层钩子 → `state/libSoftSettle.ts` 的 `libSoftHookReplay()`：**同步**判定，绝不 await；
 *  - renewer 桥 / tab 层 / `state/data.ts` 三个 P0 出口 → `settleLibSoftPending()` 后再判
 *    （它们在链的调用栈之外，`await pending` 不自锁，b20 判据 C 未回退）。
 * 本组用零依赖模块 `state/libSoftSettle.ts` 的判定函数做行为断言，与
 * `libSessionGuard.ts` 的 `withLibAuthRecovery`（「只重放一次」的唯一执行者）组合做端到端
 * 断言，并**专测链内再入不自锁**（看门狗：若钩子 await 自己所在的链，链永远不结算）；
 * core 侧只做「类型与签名未变」的结构性断言（三态在桥内消化，`packages/core` 一行未动）。
 * 不碰 Tauri / React，纯 TS 源码加载。
 * ══════════════════════════════════════════════════════════════════════ */
{
  const TABS_CODE = stripComments(readFileSync("apps/desktop/src/pages/info/tabStates.tsx", "utf8"));
  const authErr = () => {
    const e = new Error("AuthRequiredError 会话已失效");
    e.name = "AuthRequiredError";
    return e;
  };
  /* 模拟 core `#withRenew` / `#withCardSession` 的 AuthRequired 支
   * （`packages/core/src/info/client.ts:467-468` / `:492-493`）：renew 返回假值立刻抛原错，
   * 返回真值才允许 core 自己那一次重试。桥交回什么，这里就复现什么。 */
  const coreWithRenewLike = async (renew, op) => {
    try {
      return await op();
    } catch (e) {
      if (!(e instanceof Error) || e.name !== "AuthRequiredError") throw e;
      if (!(await renew().catch(() => false))) throw e;
      return await op();
    }
  };

  /* ㉑-1 判定函数本身：只有 failed 是失败结论，skipped 两种子情形都不是 */
  ok(SETTLE.libSoftHookReplay({ state: "done" }).replay === true, "㉑ P1-1：真 done 才允许重放");
  const failedOutcome = SETTLE.libSoftHookReplay({ state: "failed" });
  ok(failedOutcome.replay === false && /state=failed/.test(failedOutcome.line),
    "㉑ P1-1：真 failed 不重放且日志写 state=failed");
  const cdOutcome = SETTLE.libSoftHookReplay({ state: "skipped", reason: "cooldown" });
  ok(cdOutcome.replay === false && /state=skipped reason=cooldown/.test(cdOutcome.line) &&
      /被冷却判掉/.test(cdOutcome.line) && !/重登失败/.test(cdOutcome.line),
    `㉑ P1-1：skipped/cooldown 不重放、日志写「被冷却判掉」且不写「重登失败」（实际 ${JSON.stringify(cdOutcome)}）`);
  /* reentrant 的入参故意带一个「永不结算」的 pending：同步判定必须立刻给论，绝不 await 它 */
  const reOutcome = SETTLE.libSoftHookReplay({
    state: "skipped",
    reason: "reentrant",
    pending: new Promise(() => {}),
  });
  ok(reOutcome.replay === false && /state=skipped reason=reentrant/.test(reOutcome.line) &&
      !/重登失败/.test(reOutcome.line),
    `㉑ P1-1：reentrant 不重放、日志写「在飞链未结算」且不写「重登失败」（实际 ${JSON.stringify(reOutcome)}）`);
  ok(SETTLE.libSoftHookReplay({ state: "skipped", reason: "cooldown" }).line.indexOf("state=failed") < 0,
    "㉑ P1-1：skipped/cooldown 的日志不许含 state=failed（两种含义不许共用一个结论）");
  ok(!/async function libSoftHookReplay/.test(SETTLE_CODE),
    "㉑ P1-1：钩子判定必须是同步函数（async = 有机会 await 在飞链 = 自锁）");

  /* ㉑-2 P1-1 反自锁（b22 真机窗口一的根因）：钩子在链内拿到 reentrant 时**绝不** await pending。
   *  复刻真机拓扑：外层链的任务里发起「一次请求」，该请求的恢复钩子链内再入守卫，拿到
   *  skipped/reentrant + pending；pending 就是这条链自己。给 200ms 看门狗——若钩子 await 它，
   *  链永远不结算（真机实测卡死 9 分钟以上），断言必红。 */
  GUARD.resetLibSoftStateForTest();
  let innerD = null;
  let chainSettled = false;
  const chainP = GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    innerD = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
    // 链内请求的恢复钩子：同步判定（正确实现）——绝不 settleLibSoftPending(innerD)
    const hookSays = SETTLE.libSoftHookReplay(innerD).replay;
    if (hookSays) throw new Error("链内再入绝不许重放");
    return true; // 链照常结算
  }).then(() => { chainSettled = true; });
  for (let i = 0; i < 50 && !innerD; i += 1) await Promise.resolve();
  ok(innerD !== null && innerD.state === "skipped" && innerD.reason === "reentrant" && Boolean(innerD.pending),
    `㉑ P1-1：链内再入必须拿到 skipped/reentrant + pending（实际 ${JSON.stringify(innerD)}）`);
  await new Promise((r) => setTimeout(r, 200));
  ok(chainSettled,
    "㉑ P1-1：链内请求命中 reentrant 时钩子绝不许 await 自己所在的链（自锁 → 链永久不结算）");
  await chainP;
  /* 守卫之外的观察者仍然可以结算同一个 pending（b20 判据 C 的能力没丢） */
  const observer = await SETTLE.settleLibSoftPending(innerD);
  ok(observer.state === "done", "㉑ P1-1：守卫之外的观察者仍能结算在飞链真结果（判据 C 未回退）");

  /* ㉑-3 P1-1 端到端：reentrant / cooldown / failed 都不重放，各自落对应日志、交回第一个错误 */
  GUARD.resetLibSoftStateForTest();
  let innerE = null;
  let releaseE = null;
  const gateE = new Promise((r) => { releaseE = r; });
  const outerE = GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    innerE = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
    await gateE;
    return true;
  });
  for (let i = 0; i < 50 && !innerE; i += 1) await Promise.resolve();
  const originalErrE = authErr();
  let attemptsE = 0;
  let recoverReturned = false;
  const linesE = [];
  const outEP = GUARD.withLibAuthRecovery({
    attempt: async () => { attemptsE += 1; throw originalErrE; },
    classifyError: () => ({ signal: "logged-out-page", detail: "status=200" }),
    classifyValue: () => null,
    recover: async () => {
      const v = SETTLE.libSoftHookReplay(innerE).replay; // 钩子口径：同步
      recoverReturned = true;
      return v;
    },
    log: (l) => linesE.push(l),
  });
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
  ok(recoverReturned, "㉑ P1-1：reentrant 时钩子必须同步给定论（不许等在飞链）");
  ok(attemptsE === 1, `㉑ P1-1：reentrant 不重放（实际尝试 ${attemptsE} 次）`);
  releaseE();
  const outE = await outEP;
  await outerE;
  ok(outE.kind === "error" && outE.error === originalErrE, "㉑ P1-1：reentrant 不重放时原样交回第一个错误");
  ok(linesE.some((l) => /重登未成功 → 不重放/.test(l)),
    `㉑ P1-1：reentrant 的「不重放」必须经既有 withLibAuthRecovery 落日志（实际 ${JSON.stringify(linesE)}）`);

  GUARD.resetLibSoftStateForTest();
  let cdRuns = 0;
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => { cdRuns += 1; return true; });
  const cdRaw = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => { cdRuns += 1; return true; });
  ok(cdRaw.state === "skipped" && cdRaw.reason === "cooldown" && cdRaw.pending === undefined,
    `㉑ P1-1：占位冷却窗内必须是 skipped/cooldown（实际 ${JSON.stringify(cdRaw)}）`);
  const cdDecide = SETTLE.libSoftHookReplay(cdRaw).replay;
  const originalErrCd = authErr();
  let attemptsCd = 0;
  const outCd = await GUARD.withLibAuthRecovery({
    attempt: async () => { attemptsCd += 1; throw originalErrCd; },
    classifyError: () => ({ signal: "logged-out-page", detail: "status=200" }),
    classifyValue: () => null,
    recover: async () => cdDecide,
  });
  ok(attemptsCd === 1 && cdRuns === 1,
    `㉑ P1-1：skipped/cooldown 不许重放、不许执行任务（尝试 ${attemptsCd} / 任务 ${cdRuns}）`);
  ok(outCd.kind === "error" && outCd.error === originalErrCd, "㉑ P1-1：skipped/cooldown 时交回原错误（不许吞错）");
  ok(cdDecide === false, "㉑ P1-1：skipped/cooldown 判定必须是不重放");
  ok(/state=failed/.test(SETTLE.libSoftHookReplay({ state: "failed" }).line) &&
      /不重放/.test(SETTLE.libSoftHookReplay({ state: "failed" }).line),
    "㉑ P1-1：真 failed 的判定必须是 hold（不许当 done 重放）");

  GUARD.resetLibSoftStateForTest();
  const failedRaw = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
  ok(failedRaw.state === "failed", "㉑ P1-1：真跑过但失败必须结算成 failed（不许折成 skipped）");
  const originalErrFail = authErr();
  let attemptsF = 0;
  const outF = await GUARD.withLibAuthRecovery({
    attempt: async () => { attemptsF += 1; throw originalErrFail; },
    classifyError: () => ({ signal: "logged-out-page", detail: "status=200" }),
    classifyValue: () => null,
    recover: async () => SETTLE.libSoftHookReplay(failedRaw).replay,
  });
  ok(attemptsF === 1 && outF.kind === "error" && outF.error === originalErrFail,
    `㉑ P1-1：真 failed 不重放、原样交回第一个错误（实际尝试 ${attemptsF} 次）`);

  /* ㉑-4 P1-1 普通成功路径不受影响：0 次恢复、0 次重放 */
  GUARD.resetLibSoftStateForTest();
  let okAttempts = 0;
  let recoverCalls = 0;
  const outOk = await GUARD.withLibAuthRecovery({
    attempt: async () => {
      okAttempts += 1;
      return "fine";
    },
    classifyError: () => null,
    classifyValue: () => null,
    recover: async () => {
      recoverCalls += 1;
      return true;
    },
  });
  ok(okAttempts === 1 && recoverCalls === 0, `㉑ P1-1：普通成功路径不受影响（尝试 ${okAttempts} / 恢复 ${recoverCalls}）`);
  ok(outOk.kind === "value" && outOk.value === "fine", "㉑ P1-1：普通成功路径原样交回响应");

  /* ㉑-5 P1-1 结构性：钩子同步判定 + 日志把 failed 与 skipped 分开；钩子层绝不许再出现 settle */
  const replayAt = CLIENTS_CODE.indexOf("function libSoftReplayOnce");
  const replayBlock = CLIENTS_CODE.slice(replayAt, CLIENTS_CODE.indexOf("\n}", replayAt) + 2);
  ok(replayAt >= 0, "㉑ P1-1：clients.ts 缺少 libSoftReplayOnce（nativeFetch 恢复钩子的三态出口）");
  ok(/libSoftHookReplay\(raw\)/.test(replayBlock) && /return o\.replay;/.test(replayBlock),
    "㉑ P1-1：恢复钩子必须同步按 libSoftHookReplay 的布尔定重放（不许自己另判）");
  ok(!/settleLibSoftPending/.test(replayBlock) && !/await /.test(replayBlock.replace(/\/\*[\s\S]*?\*\//g, "")),
    "㉑ P1-1：恢复钩子内绝不许 await / settleLibSoftPending（链内自锁的唯一入口）");
  ok(/libSoftReplayOnce\(await libSoftReloginResult\(sites\), "request"\)/.test(CLIENTS_CODE) &&
      /libSoftReplayOnce\(await libSoftReloginResult\(\[\.\.\.ALL_LIB_REBUILD_SITES\]\), "escalate"\)/.test(CLIENTS_CODE),
    "㉑ P1-1：两处钩子都必须把原样三态交给同步判定（不许先结算）");
  ok(/state=failed → 不重放/.test(SETTLE_CODE),
    "㉑ P1-1：真 failed 必须落 state=failed 的「不重放」行（判定与文案同在 libSoftSettle.ts）");
  ok(/被冷却判掉/.test(SETTLE_CODE) && /state=skipped reason=reentrant/.test(SETTLE_CODE),
    "㉑ P1-1：skipped 的两种子情形必须各落 state=/reason= 日志（cooldown 写「被冷却判掉」）");
  ok(!/重登失败/.test(SETTLE_CODE),
    "㉑ P1-1：不许再把 skipped/cooldown 记成「重登失败」（failed 分支只说 state=failed → 不重放）");
  ok(/void logLine\(`LIB-AUTH \$\{siteSrc\} \$\{o\.line\}`\)/.test(replayBlock),
    "㉑ P1-1：恢复钩子必须原样落 libSoftHookReplay 给的诊断行（不许另写一套文案）");
  ok(!/libSoftRelogin\(sites\)/.test(CLIENTS_CODE) && !/libSoftRelogin\(\["card"\]\)/.test(CLIENTS_CODE),
    "㉑ P1：两处消费者不许再折回布尔 libSoftRelogin（skipped 与 failed 混在一个 false 里）");

  /* ㉑-6 P1-2 renewer 桥：reentrant 结算 done → core 不抛错；cooldown → 不交出 false；failed → 既有失败语义 */
  GUARD.resetLibSoftStateForTest();
  let innerR = null;
  let releaseR = null;
  const gateR = new Promise((r) => { releaseR = r; });
  const outerR = GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    innerR = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
    await gateR;
    return true; // 在飞链真结算 = done
  });
  for (let i = 0; i < 50 && !innerR; i += 1) await Promise.resolve();
  const renewReentrant = async () => SETTLE.libSoftRenewDecision(await SETTLE.settleLibSoftPending(innerR));
  let opRuns = 0;
  let opThrew = null;
  let opVal = null;
  const opP = coreWithRenewLike(renewReentrant, async () => {
    opRuns += 1;
    if (opRuns === 1) throw authErr();
    return "card-ok";
  }).then((v) => { opVal = v; }, (e) => { opThrew = e; });
  releaseR();
  await opP;
  await outerR;
  ok(opThrew === null && opVal === "card-ok", "㉑ P1-2：reentrant 结算 done 时必须当作登录状态可用（core 不发错）");
  ok(opRuns === 2, `㉑ P1-2：true 之后由 core 自己那次重试完成（实际 op ${opRuns} 次）`);

  GUARD.resetLibSoftStateForTest();
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => true); // 置 30s 占位冷却
  let cdRuns2 = 0;
  const cdRaw2 = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => { cdRuns2 += 1; return true; });
  const renewCooldown = await SETTLE.libSoftRenewDecision(await SETTLE.settleLibSoftPending(cdRaw2));
  ok(cdRaw2.state === "skipped" && cdRaw2.reason === "cooldown" && cdRuns2 === 0, "㉑ P1-2：cooldown 场景前置成立（任务 0 次）");
  ok(renewCooldown === true, "㉑ P1-2：cooldown 时 renewer 桥必须回 true（绝不把 false 当失败交给 core）");
  let opRuns2 = 0;
  let opThrew2 = null;
  let opVal2 = null;
  await coreWithRenewLike(async () => renewCooldown, async () => {
    opRuns2 += 1;
    if (opRuns2 === 1) throw authErr();
    return "ok2";
  }).then((v) => { opVal2 = v; }, (e) => { opThrew2 = e; });
  ok(opThrew2 === null && opVal2 === "ok2" && opRuns2 === 2,
    `㉑ P1-2：cooldown 时 core 走它自己的有界重试一次（不抛原错；实际 op ${opRuns2} 次）`);

  const originalErrF = authErr();
  let opRunsF = 0;
  let opThrewF = null;
  const renewFailed = SETTLE.libSoftRenewDecision({ state: "failed" });
  await coreWithRenewLike(async () => renewFailed, async () => {
    opRunsF += 1;
    throw originalErrF;
  }).catch((e) => { opThrewF = e; });
  ok(renewFailed === false && opThrewF === originalErrF && opRunsF === 1,
    `㉑ P1-2：真 failed 保持既有失败语义（原样抛回第一个错误、不重试；实际 op ${opRunsF} 次）`);

  /* ㉑-7 P1-2 结构性：桥内消化 + `packages/core` 的 renewer 类型/签名一行未动 */
  ok(/async function libSoftRenewUsable\(sites: LibRebuildSite\[\] = \[\]\): Promise<boolean>/.test(CLIENTS_CODE),
    "㉑ P1-2：clients.ts 缺少 renewer 桥 libSoftRenewUsable");
  ok(/libSoftRenewDecision\(await settleLibSoftPending\(await libSoftReloginResult\(sites\)\)\)/.test(CLIENTS_CODE),
    "㉑ P1-2：renewer 桥必须「先守卫外结算在飞真结果、再按只有 failed 才是失败交回」");
  ok((CLIENTS_CODE.match(/libSoftRenewUsable\(/g) ?? []).length === 3,
    `㉑ P1-2：renewer 桥只许「定义 + info/card 两个入口」（实际 ${(CLIENTS_CODE.match(/libSoftRenewUsable\(/g) ?? []).length} 处）`);
  ok(/setRenewers\(hooks: \{ info\?: \(\) => Promise<boolean>; card\?: \(\) => Promise<boolean> \}\): void \{/.test(CORE_INFO_CODE),
    "㉑ P1-2：packages/core 的 setRenewers 类型/签名未变（仍是 () => Promise<boolean>）");
  ok(/#renewInfo: \(\(\) => Promise<boolean>\) \| null = null;/.test(CORE_INFO_CODE) &&
      /#renewCard: \(\(\) => Promise<boolean>\) \| null = null;/.test(CORE_INFO_CODE),
    "㉑ P1-2：packages/core 的 renewer 字段类型未变");
  ok(!/libSoftSettle|settleLibSoftPending|libSoftRenewDecision|libSoftHookReplay/.test(CORE_INFO_CODE),
    "㉑ P1-2：packages/core 不许出现三态桥内标识符（类型与逻辑一律不许改）");

  /* ㉑-8 P1-3 tabStates：skipped → 0 次错误条、failed → 1 次；只有 done 才自动重拉 */
  let errorBars = 0;
  let tabRetries = 0;
  const applyTab = (r) => {
    const act = SETTLE.libSoftTabAction(r);
    if (act === "keep-error") errorBars += 1; // 只有真 failed 才落错误条
    if (act === "retry-load") tabRetries += 1;
  };
  applyTab({ state: "skipped", reason: "cooldown" });
  applyTab({ state: "skipped", reason: "reentrant" });
  ok(errorBars === 0, `㉑ P1-3：skipped 不许落错误条（实际 ${errorBars} 次）`);
  applyTab({ state: "failed" });
  ok(errorBars === 1, `㉑ P1-3：failed 才落错误条（实际 ${errorBars} 次）`);
  ok(tabRetries === 0, `㉑ P1-3：skipped/failed 都不许自动重拉（实际 ${tabRetries} 次）`);
  applyTab({ state: "done" });
  ok(tabRetries === 1, `㉑ P1-3：done 才自动重拉一次（实际 ${tabRetries} 次）`);
  ok(/settleLibSoftPending\(await softRecoverResult\(tag\)\)/.test(TABS_CODE),
    "㉑ P1-3：tab 必须消费三态出口并在守卫之外结算在飞真结果");
  ok(/if \(act === "retry-load" && retry\)/.test(TABS_CODE), "㉑ P1-3：retry 必须被 retry-load 门控");
  ok(!/await softRecover\(/.test(TABS_CODE), "㉑ P1-3：tab 不许再把布尔 softRecover 的 false 当失败（三态没透传）");
  ok(/TAB-AUTH \$\{tag\} state=\$\{r\.state\}/.test(TABS_CODE) && /action=\$\{act\}/.test(TABS_CODE),
    "㉑ P1-3：tab 的 auth 支必须落 state=/reason=/action= 诊断行");
  ok(/from "\.\.\/\.\.\/state\/libSoftSettle\.js"/.test(TABS_CODE),
    "㉑ P1-3：tab 必须复用 b20 的 state/libSoftSettle（不许在页面里再写一套三态判定）");
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉒ P2 + 看门狗 + 可选组（b23）：`skipped` 不再被当成失败结论。
 *
 * 背景（b22 段末「残余未覆盖」剩下的三块）：
 *  - P2 七处 `state/data.ts` 布尔出口（`xk-boot / xk-level / xk-core / xk-queue /
 *    calendar / weeksched / exams`）；
 *  - `lib/reload.ts` 的全局失登看门狗仍用布尔 `softRecover("global")`；
 *  - 可选组 `pages/Schedule.tsx`、`pages/info/DormTab.tsx | LibraryTab.tsx | LibRoomTab.tsx`。
 * 这些点拿到的都是把三态折出来的布尔 `false`——`skipped`（被冷却判掉 / 链内再入）
 * 与真 `failed` 混成一个结论，于是「判掉」被记成错误条 / 空数组 / 失败 toast。
 *
 * 判定复用 b22 的 `libSoftTabAction()`（done→retry-load / failed→keep-error /
 * skipped→mark-pending），不另造第二套；链外观察者一律先 `settleLibSoftPending()`
 * 取在飞链真结果，只有真 `failed` 才是失败结论。本组：
 *  - ㉒-1 判定表 + 端到端真结算（done / failed / cooldown / reentrant→真结果两支）；
 *  - ㉒-2 data.ts 七处结构性：三态出口 → skipped 分支先 return/continue → 失败表现在其后；
 *  - ㉒-3 `:1933` toast 文案只在真 `done`（rebuilt）时才宣称「已自动重建」；
 *  - ㉒-4 看门狗：结构性（不再用布尔 `softRecover("global")`）+ 三态分流行为；
 *  - ㉒-5 可选组结构性：每一处 `skipped` 分支必须先 return，失败表现在其后。
 * ══════════════════════════════════════════════════════════════════════ */
{
  const SCHEDULE_CODE = stripComments(readFileSync("apps/desktop/src/pages/Schedule.tsx", "utf8"));
  const DORM_CODE = stripComments(readFileSync("apps/desktop/src/pages/info/DormTab.tsx", "utf8"));
  const LIBTAB_CODE = stripComments(readFileSync("apps/desktop/src/pages/info/LibraryTab.tsx", "utf8"));
  const LIBROOM_CODE = stripComments(readFileSync("apps/desktop/src/pages/info/LibRoomTab.tsx", "utf8"));

  /* ㉒-1 判定表 + 端到端真结算 */
  ok(SETTLE.libSoftTabAction({ state: "done" }) === "retry-load", "㉒ 判定：done 必须走既有原地重取（健康路径不变）");
  ok(SETTLE.libSoftTabAction({ state: "failed" }) === "keep-error", "㉒ 判定：只有真 failed 是失败结论");
  for (const reason of ["cooldown", "reentrant"]) {
    ok(SETTLE.libSoftTabAction({ state: "skipped", reason }) === "mark-pending",
      `㉒ 判定：skipped/${reason} 不是失败结论（不许落错误条 / 空数组 / 失败 toast）`);
  }

  GUARD.resetLibSoftStateForTest();
  const doneRaw2 = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => true);
  ok(doneRaw2.state === "done" && SETTLE.libSoftTabAction(await SETTLE.settleLibSoftPending(doneRaw2)) === "retry-load",
    "㉒ 端到端：真执行成功 → done → 既有原地重取路径");
  GUARD.resetLibSoftStateForTest();
  const failedRaw2 = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
  ok(failedRaw2.state === "failed" && SETTLE.libSoftTabAction(await SETTLE.settleLibSoftPending(failedRaw2)) === "keep-error",
    "㉒ 端到端：真执行失败 → failed → 落既有失败表现（不许吞真失败）");
  GUARD.resetLibSoftStateForTest();
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => true);   // 写 30s 占位冷却
  let cdRuns23 = 0;
  const cdRaw23 = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => { cdRuns23 += 1; return true; });
  ok(cdRaw23.state === "skipped" && cdRaw23.reason === "cooldown" && cdRuns23 === 0,
    "㉒ 端到端：占位冷却窗内必须是 skipped/cooldown 且任务 0 次");
  ok(SETTLE.libSoftTabAction(await SETTLE.settleLibSoftPending(cdRaw23)) === "mark-pending",
    "㉒ 端到端：skipped/cooldown 不许落失败表现（cooldown 没有 pending，绝不瞎等）");
  /* 链内再入 + pending：链外观察者结算出的真结果才是结论（P2 收益的关键一支） */
  GUARD.resetLibSoftStateForTest();
  let innerDone23 = null;
  let releaseDone23 = null;
  const gateDone23 = new Promise((r) => { releaseDone23 = r; });
  const outerDone23 = GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    innerDone23 = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
    await gateDone23;
    return true;   // 在飞链真结算 = done
  });
  for (let i = 0; i < 50 && !innerDone23; i += 1) await Promise.resolve();
  ok(innerDone23 !== null && innerDone23.state === "skipped" && innerDone23.reason === "reentrant" && Boolean(innerDone23.pending),
    "㉒ 端到端：链内再入必须是 skipped/reentrant + pending");
  const settleDone23 = SETTLE.settleLibSoftPending(innerDone23);
  releaseDone23();
  const settledDone23 = await settleDone23;
  await outerDone23;
  ok(settledDone23.state === "done" && SETTLE.libSoftTabAction(settledDone23) === "retry-load",
    "㉒ 端到端：reentrant 的真结算 done 必须按 done 走（不是失败、也不是停在 pending）");
  GUARD.resetLibSoftStateForTest();
  let innerFail23 = null;
  let releaseFail23 = null;
  const gateFail23 = new Promise((r) => { releaseFail23 = r; });
  const outerFail23 = GUARD.runLibSoftSingleFlightResult("lib-session", async () => {
    innerFail23 = await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
    await gateFail23;
    return false;   // 在飞链真结算 = failed
  });
  for (let i = 0; i < 50 && !innerFail23; i += 1) await Promise.resolve();
  const settleFail23 = SETTLE.settleLibSoftPending(innerFail23);
  releaseFail23();
  const settledFail23 = await settleFail23;
  await outerFail23;
  ok(settledFail23.state === "failed" && SETTLE.libSoftTabAction(settledFail23) === "keep-error",
    "㉒ 端到端：reentrant 的真结算 failed 必须落失败表现（判据 C 不许回退）");

  /* ㉒-2 / ㉒-5 结构性（同一句式：三态出口 → skipped 分支先 return/continue → 失败表现在其后）。
   * `scope` 的每一次出现都要过一遍（LibraryTab 的 `lib` 有 5 处、LibRoomTab 的 `libroom` 有 3 处）。
   * `expectRetryLoad=false` 只给 `xk-level`（它的 done 支原样与 failed 同表现，本就没有重取分支）。 */
  const outletCheck = (name, code, scope, pendingMarkers, failMarkers, expectRetryLoad = true) => {
    const call = `libSoftTabAction(await settleLibSoftPending(await softRecoverResult("${scope}")))`;
    let from = 0;
    let n = 0;
    for (;;) {
      const at = code.indexOf(call, from);
      if (at < 0) break;
      n += 1;
      const region = code.slice(at, at + 2600);
      const first = (arr) =>
        arr.reduce((best, m) => { const i = region.indexOf(m); return i >= 0 && i < best ? i : best; }, Infinity);
      const pendIdx = first(pendingMarkers);
      const failIdx = first(failMarkers);
      ok(pendIdx !== Infinity,
        `㉒ ${name} #${n}：三态出口后必须显式处理 skipped（不然 skipped 落错误条 / 空数组 / 失败 toast）`);
      ok(failIdx !== Infinity, `㉒ ${name} #${n}：failed 的既有失败表现必须保留（不许把真失败一起吞掉）`);
      if (pendIdx !== Infinity && failIdx !== Infinity) {
        ok(failIdx > pendIdx, `㉒ ${name} #${n}：失败表现必须先让过 skipped 分支（skipped 不许落失败）`);
        ok(/return|continue/.test(region.slice(pendIdx, failIdx)),
          `㉒ ${name} #${n}：skipped 分支必须先 return/continue，不许 fallthrough 到失败表现`);
      }
      if (expectRetryLoad) ok(/"retry-load"/.test(region), `㉒ ${name} #${n}：done 的既有原地重取路径必须保留（健康路径不变）`);
      from = at + call.length;
    }
    ok(n > 0, `㉒ ${name}：取不到三态出口（必须 libSoftTabAction + settleLibSoftPending + softRecoverResult）`);
  };

  /* —— P2 七处（`state/data.ts`）—— */
  outletCheck("P2 data.ts xk-boot", DATA_CODE, "xk-boot", ['"ZHJWXK-AUTH-PENDING"'], ['logPageError("ZHJWXK", err)']);
  outletCheck("P2 data.ts xk-level", DATA_CODE, "xk-level", ['if (act === "mark-pending") return null;'], ['logPageError("XK-LEVEL", err)'], false);
  outletCheck("P2 data.ts xk-core", DATA_CODE, "xk-core", ["retryAfterPending = true"], ["return [];"]);
  ok(/if \(act === "mark-pending"\) \{ retryAfterPending = true; continue; \}/.test(DATA_CODE),
    "㉒ P2 data.ts xk-core：skipped 必须走既有有界重试（continue），不许直接 return []（空数组＝失败表现）");
  ok(/logPageError\(retryAfterPending \? "XK-CORE-AUTH-PENDING" : "XK-CORE-AUTH", err\)/.test(DATA_CODE),
    "㉒ P2 data.ts xk-core：skipped 触发的有界重试再败只许记 pending，不许落 XK-CORE-AUTH 失败 tag（done / failed 之后仍败才保留失败 tag）");
  outletCheck("P2 data.ts xk-queue", DATA_CODE, "xk-queue",
    ["登录状态暂时未能自动恢复，队列数据可稍后重试"], ["课余量排队人数获取失败"]);
  outletCheck("P2 data.ts calendar", DATA_CODE, "calendar", ['"CALENDAR-AUTH-PENDING"'], ['logPageError("CALENDAR", err)']);
  outletCheck("P2 data.ts weeksched", DATA_CODE, "weeksched", ['"SCHEDULE-AUTH-PENDING"'], ['logPageError("SCHEDULE", err)']);
  outletCheck("P2 data.ts exams", DATA_CODE, "exams", ['"EXAMS-AUTH-PENDING"'], ["explainNetworkError(err)"]);

  /* ㉒-3 `data.ts:1933` 的 toast 文案：只在真 done（rebuilt）时才宣称「已自动重建」 */
  ok(/setToast\(rebuilt/.test(DATA_CODE), "㉒ P2-4：失败 toast 必须被 rebuilt（真 done）门控，不许无条件宣称已重建");
  ok(/let rebuilt = false;/.test(DATA_CODE) && DATA_CODE.indexOf("rebuilt = true;") < DATA_CODE.indexOf("setToast(rebuilt"),
    "㉒ P2-4：rebuilt 只许在 done 的 retry-load 支里置真，且文案在其后");
  ok(!/获取失败，可稍后重试（登录状态已自动重建）/.test(DATA_CODE),
    "㉒ P2-4：旧的无条件「登录状态已自动重建」文案必须删除（skipped 与 failed 都会命中它）");
  ok(/登录状态暂时未能自动恢复，队列数据可稍后重试/.test(DATA_CODE),
    "㉒ P2-4：skipped 必须留可重试态文案（不落失败 toast、不宣称重建成功）");

  /* —— ㉒-4 看门狗（`lib/reload.ts`）：结构性 + 三态分流 —— */
  const wdAt = RELOAD_CODE.indexOf("export function installAuthWatchdog");
  const wdBlock = wdAt >= 0 ? RELOAD_CODE.slice(wdAt, RELOAD_CODE.indexOf("\n}", wdAt) + 2) : "";
  ok(wdBlock.length > 0, "㉒ 看门狗：取不到 installAuthWatchdog（结构断言无法执行）");
  ok(!/softRecover\("global"\)/.test(wdBlock),
    '㉒ 看门狗：不许再用布尔 softRecover("global") 直接结算失败（skipped 与 failed 混成一个 false）');
  ok(/softRecoverResult\("global"\)/.test(wdBlock), '㉒ 看门狗：必须消费三态出口 softRecoverResult("global")');
  ok(/if \(r\.state !== "failed"\) return;/.test(wdBlock),
    "㉒ 看门狗：只有 failed 才许进失败结算（done / skipped 直接返回、不误报）");
  ok(!/settleLibSoftPending/.test(wdBlock),
    "㉒ 看门狗：不等在飞链（零收益、有挂链风险；需真结果的观察者在页面层 P0 出口 / renewer 桥 / tab 层）");
  let wdSettlements = 0;
  const wdSettle = (r) => { if (r.state !== "failed") return; wdSettlements += 1; };
  wdSettle({ state: "done" });
  wdSettle({ state: "skipped", reason: "cooldown" });
  wdSettle({ state: "skipped", reason: "reentrant" });
  ok(wdSettlements === 0, `㉒ 看门狗：done / skipped 都不许落失败结算（实际 ${wdSettlements} 次）`);
  wdSettle({ state: "failed" });
  ok(wdSettlements === 1, "㉒ 看门狗：真 failed 才落失败结算");

  /* —— ㉒-5 可选组（`pages/`）—— */
  outletCheck("可选组 Schedule.tsx", SCHEDULE_CODE, "schedule-win",
    ["setWinError(RELOGIN_PENDING_NOTE)"], ["setWinError(err instanceof Error"]);
  outletCheck("可选组 DormTab.tsx", DORM_CODE, "dorm",
    ['"ELE-RECORD-PENDING"'], ["setRecError(explainNetworkError(err))"]);
  outletCheck("可选组 LibraryTab.tsx", LIBTAB_CODE, "lib",
    ['"LIB-LIST-PENDING"', '"LIB-REC-PENDING"', '"LIB-FLOOR-PENDING"', '"LIB-SECTION-PENDING"', '"LIB-SEAT-PENDING"'],
    ["setLibError(explainNetworkError(err))", "setRecError(explainNetworkError(err))", "setSeatError(explainNetworkError(err))"]);
  outletCheck("可选组 LibRoomTab.tsx", LIBROOM_CODE, "libroom",
    ['"LIBROOM-KIND-PENDING"', '"LIBROOM-REC-PENDING"', '"LIBROOM-RES-PENDING"'],
    ["setKindError(explainNetworkError(err))", "setRecError(explainNetworkError(err))", "setResError(explainNetworkError(err))"]);

  /* 三态透传（结构性）：五份源码里都不许再出现布尔 softRecover 的消费点 */
  for (const [name, code] of [
    ["state/data.ts", DATA_CODE],
    ["lib/reload.ts（看门狗已改）", RELOAD_CODE.replace(wdBlock, "")],
    ["pages/Schedule.tsx", SCHEDULE_CODE],
    ["pages/info/DormTab.tsx", DORM_CODE],
    ["pages/info/LibraryTab.tsx", LIBTAB_CODE],
    ["pages/info/LibRoomTab.tsx", LIBROOM_CODE],
  ]) {
    ok(!/await softRecover\(/.test(code), `㉒ ${name} 不许再用布尔 softRecover（skipped 与 failed 混在一个 false 里）`);
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉓ 登录体验打磨（b25）：误登出清零 + 用户文案扫描面 + XK-SEARCH 三态。
 *
 * 背景（霖本轮口径）：体验要「不被误登出、不出现会话/超时这类吓人的用户文案、
 * 不卡」。本节守三件事：
 *  - ㉓-1 结构性：`state/data.ts` 里**每一个** `backToLogin()` 的最近判定都必须是
 *    「三态出口之后的 `failed` 支」——只要出现「catch 到 AuthRequiredError 就直接
 *    backToLogin」的形态就红（本轮 W1 修的就是这一形态）；
 *  - ㉓-2 W1/W2/W3 三态行为：`useSemesters`（W1）补齐两跳、`useLearnData`（W2）
 *    补第二跳、`XK-SEARCH`（W3）按三态收口；三处都「只有 failed 才登出」，
 *    `skipped` 一律原地留可重试提示条；
 *  - ㉓-3 文案：`Settings.tsx` 的两处用户可见文案不再含「会话」；`ui-copy-lint`
 *    的扫描面必须覆盖模板串（含插值）与独占行的 JSX 文本——旧实现这两类整类漏检。
 * ══════════════════════════════════════════════════════════════════════ */
{
  /* —— ㉓-1 结构性：backToLogin 的最近判定必须是 failed 三态支 —— */
  /** 返回不合规的登出点（`{cond}`）。判定法（b33 扩充了第 3 条）：
   *  1) 登出点必须落在某个 `catch (err)` 区段内（catch 之外裸登出 = 旧形态）；
   *  2) 该区段内必须出现 `state === "failed"`（b19 三态语义仍在，不许只凭其它条件登出）；
   *  3) 登出要么由 `failed` 支直接给出，要么由 b33 的「存活复核」闸门收口——
   *     即区段内按顺序出现 `state === "failed"` → `libSoftSessionLooksAlive(` →
   *     `armLibSoftAutoRetry(` → `backToLogin()`（命中存活证据就不登出，只走有限次重跑）。
   *  窗口取 3000 字符：b33 在 failed 支里加了复核 + 有限次重跑，campus 的
   *  `catch → backToLogin` 距离从 ~1100 涨到 1536–2104 字符（护栏自己量过）。 */
  const badLogouts = (code) => {
    const bad = [];
    for (const m of code.matchAll(/backToLogin\(\)/g)) {
      const before = code.slice(Math.max(0, m.index - 3000), m.index);
      const lastCatch = before.lastIndexOf("catch (");
      const lastIf = before.lastIndexOf("if (");
      const braceAt = lastIf >= 0 ? before.indexOf("{", lastIf) : -1;
      const cond = lastIf >= 0 ? before.slice(lastIf, braceAt < 0 ? before.length : braceAt) : "";
      const region = lastCatch >= 0 ? before.slice(lastCatch) + "backToLogin()" : "";
      const hasFailedEvidence = /state === "failed"/.test(region);
      const directFailed = lastIf > lastCatch && /state === "failed"/.test(cond);
      const aliveGatedShape =
        /state === "failed"[\s\S]*?libSoftSessionLooksAlive\s*\([\s\S]*?armLibSoftAutoRetry\([\s\S]*?backToLogin\(\)/.test(region);
      if (lastCatch < 0 || !hasFailedEvidence || !(directFailed || aliveGatedShape)) {
        bad.push({ cond: cond.replace(/\s+/g, " ").slice(0, 100), behindCatch: !(lastIf > lastCatch) });
      }
    }
    return bad;
  };
  const dataBad = badLogouts(DATA_CODE);
  ok(
    dataBad.length === 0,
    `㉓-1 data.ts 每个 backToLogin() 的最近判定都必须是 failed 三态支（实际违规 ${dataBad.length} 处：${JSON.stringify(dataBad)}）`,
  );
  /* 反例的确定性自检：同一函数喂三种夹具，判定器本身不许放行旧形态、也不许误杀新形态 */
  const bareFixture = `
    try { await load(); } catch (err) {
      if (err instanceof Error && err.name === "AuthRequiredError") { backToLogin(); return; }
      setState("error");
    }`;
  ok(badLogouts(bareFixture).length === 1, "㉓-1 反例夹具：catch 直连 backToLogin 的旧形态必须被判红（判定器本身不许放行）");
  const gatedFixture = `
    try { await load(); } catch (err) {
      if (err instanceof Error && err.name === "AuthRequiredError") {
        if (recovered.state === "failed" || reRoamed.state === "failed") { backToLogin(); return; }
        return;
      }
    }`;
  ok(badLogouts(gatedFixture).length === 0, "㉓-1 反例夹具：failed 支里的 backToLogin 必须判绿");
  /** b33 夹具：failed 支里先做存活复核 + 有限次重跑，只有重试用尽才登出——必须判绿 */
  const aliveGatedFixture = `
    try { await load(); } catch (err) {
      if (err instanceof Error && err.name === "AuthRequiredError") {
        if (recovered.state === "failed" || reRoamed.state === "failed") {
          const alive = libSoftSessionLooksAlive({ doneAtStart, doneNow: libSoftLastDoneAtMs(), recoveryInFlight: libSoftRecoveryInFlight(), now: Date.now() });
          if (alive.alive) {
            const arm = armLibSoftAutoRetry(currentAuthEpoch(), left, autoRetry, { recoveryInFlight: false });
            if (arm !== "exhausted") return;
          }
          backToLogin();
          return;
        }
      }
    }`;
  ok(badLogouts(aliveGatedFixture).length === 0, "㉓-1 反例夹具：b33 存活复核 + 有限次重跑闸门内的 backToLogin 必须判绿");
  /** 反向夹具：只凭存活复核就登出、区段里没有真 failed 证据——必须判红 */
  const noFailEvidenceFixture = `
    try { await load(); } catch (err) {
      if (err instanceof Error && err.name === "AuthRequiredError") {
        if (libSoftSessionLooksAlive({ doneAtStart, doneNow: 0, recoveryInFlight: false, now: Date.now() }).alive) return;
        backToLogin();
      }
    }`;
  ok(badLogouts(noFailEvidenceFixture).length === 1,
    "㉓-1 反例夹具：没有真 failed 证据、只凭存活复核的登出必须判红（不许把登出条件改成「复核不通过」）");

  /* —— ㉓-2 W1/W2 三态行为（真值表 + 源码结构同型断言）—— */
  const S = (state, reason) => (state === "skipped" ? { state, reason } : { state });
  const states = [
    S("done"),
    S("failed"),
    S("skipped", "cooldown"),
    S("skipped", "reentrant"),
  ];
  /* W1 useSemesters：campus 同款两跳（relearn → softRecover("semesters")） */
  const semestersDecide = (reRoamed, recovered) => {
    if (reRoamed.state === "done") return "retry-load";
    if (recovered.state === "done") return "retry-load";
    if (recovered.state === "failed" || reRoamed.state === "failed") return "back-to-login";
    return "show-pending-note";
  };
  /* W2 useLearnData：第二跳 + skipped 先收口、真 failed 才登出 */
  const learnDecide = (reRoamed, recovered) => {
    if (reRoamed.state === "done") return "retry-load";
    if (recovered.state === "done") return "retry-load";
    if (reRoamed.state === "skipped") {
      if (recovered.state !== "failed") return "show-pending-note";
    }
    if (recovered.state === "failed" || reRoamed.state === "failed") return "back-to-login";
    return "unreachable";
  };
  for (const [name, decide] of [["W1 semesters", semestersDecide], ["W2 learn", learnDecide]]) {
    for (const a of states) {
      for (const b of states) {
        const act = decide(a, b);
        const realDone = a.state === "done" || b.state === "done";
        const realFail = a.state === "failed" || b.state === "failed";
        const label = `relearn=${a.state}${a.reason ? "/" + a.reason : ""} + recover=${b.state}${b.reason ? "/" + b.reason : ""}`;
        if (realDone) {
          ok(act === "retry-load", `㉓-2 ${name} done 必须重走数据链（${label} → ${act}）`);
        } else if (realFail) {
          ok(act === "back-to-login", `㉓-2 ${name} 真 failed 必须保留登出（${label} → ${act}）`);
        } else {
          ok(act === "show-pending-note", `㉓-2 ${name} skipped 一律不登出、原地留可重试提示条（${label} → ${act}）`);
        }
      }
    }
  }
  /* 源码结构：W1 必须真的是「两跳 + failed 才登出」，W2 必须有第二跳且 skipped 先收口 */
  const semBlock = DATA_CODE.slice(DATA_CODE.indexOf('logPageError("SEMESTERS-AUTH"'), DATA_CODE.indexOf("/* ============ 选课系统"));
  ok(semBlock.length > 0, "㉓-2 W1：取不到 useSemesters 的 AuthRequired 分支（结构断言无法执行）");
  ok(/settleLibSoftPending\(await relearnRoamOnce\(\)\)/.test(semBlock), "㉓-2 W1：学期列表必须先试免密重建一次");
  ok(/softRecoverResult\("semesters"\)/.test(semBlock), "㉓-2 W1：免密重建非 done 时必须再给 WebVPN 全链一次机会");
  ok(/if \(recovered\.state === "failed" \|\| reRoamed\.state === "failed"\)/.test(semBlock), "㉓-2 W1：只有真 failed 才 backToLogin");
  ok(/SEMESTERS-AUTH-PENDING/.test(semBlock) && /setError\(RELOGIN_PENDING_NOTE\)/.test(semBlock),
    "㉓-2 W1：skipped 必须留「登录状态暂时未能自动恢复」可重试错误条（不登出）");
  const learnAuthBlock = DATA_CODE.slice(DATA_CODE.indexOf('logPageError("LEARN-AUTH"'), DATA_CODE.indexOf("/* ============ 学期列表"));
  ok(learnAuthBlock.length > 0, "㉓-2 W2：取不到 useLearnData 的 AuthRequired 分支");
  ok(/softRecoverResult\("learn"\)/.test(learnAuthBlock), "㉓-2 W2：learn 必须补上第二跳 softRecoverResult(\"learn\")");
  ok(/if \(reRoamed\.state === "skipped"\)/.test(learnAuthBlock) && /if \(recovered\.state !== "failed"\)/.test(learnAuthBlock),
    "㉓-2 W2：skipped 必须先原地收口（不登出），真 failed 才落到登出支");
  ok(/LEARN-AUTH-PENDING/.test(learnAuthBlock) && /setError\(RELOGIN_PENDING_NOTE\)/.test(learnAuthBlock),
    "㉓-2 W2：skipped 必须留可重试错误条（不登出）");
  /* scope 不许与既有命名冲突（每跳一次、名字唯一） */
  const scopes = [...DATA_CODE.matchAll(/softRecoverResult\("([a-z-]+)"\)/g)].map((m) => m[1]);
  for (const s of ["semesters", "learn", "xk-search"]) {
    ok(scopes.filter((x) => x === s).length === 1, `㉓-2 scope "${s}" 必须恰好出现一次（新增 scope 不许与既有冲突）`);
  }

  /* —— ㉓-3 W3 XK-SEARCH：auth 失败按三态收口，绝不登出 —— */
  const xkSearchBlock = DATA_CODE.slice(DATA_CODE.indexOf("const failSearch = useCallback("), DATA_CODE.indexOf("const newSearch = useCallback("));
  ok(xkSearchBlock.length > 0, "㉓-3 W3：取不到 XK-SEARCH 的 failSearch（结构断言无法执行）");
  ok(/settleLibSoftPending\(await softRecoverResult\("xk-search"\)\)/.test(xkSearchBlock),
    "㉓-3 W3：选课搜索失败必须消费三态出口并在守卫外结算在飞真结果");
  ok(/XK-SEARCH-AUTH-PENDING/.test(xkSearchBlock), "㉓-3 W3：skipped 必须落 XK-SEARCH-AUTH-PENDING（不当失败）");
  ok(/setSearchError\(RELOGIN_PENDING_NOTE\)/.test(xkSearchBlock), "㉓-3 W3：skipped 必须留可重试提示条（不落吓人文案）");
  ok(/logPageError\("XK-SEARCH", err\)/.test(xkSearchBlock), "㉓-3 W3：failed 必须保留既有失败 tag 与失败表现");
  ok(!/backToLogin/.test(xkSearchBlock), "㉓-3 W3：选课搜索失败不许把用户置为登出（保留搜索现场）");
  ok(/const authish =/.test(xkSearchBlock) && /if \(!authish\)/.test(xkSearchBlock),
    "㉓-3 W3：只有 auth 类失败才进三态收口；普通失败（网络/异常页）走既有路径");
  const xkAct = (r) => (r.state === "done" ? "refetch" : r.state === "failed" ? "keep-error" : "pending-note");
  ok(xkAct(S("done")) === "refetch" && xkAct(S("failed")) === "keep-error", "㉓-3 W3：done 重跑搜索 / failed 保留失败表现");
  for (const r of [S("skipped", "cooldown"), S("skipped", "reentrant")]) {
    ok(xkAct(r) === "pending-note", `㉓-3 W3：skipped/${r.reason} 必须落 pending 提示条而不是失败表现`);
  }

  /* —— ㉓-4 文案：Settings 两处用户可见文案 + ui-copy-lint 扫描面 —— */
  const SETTINGS_CODE = stripComments(SETTINGS); // 只看代码，注释里正当地写着「会话」不算
  ok(!/会话/.test(SETTINGS_CODE), "㉓-4 Settings 用户可见文案不许再说「会话」（注释除外）");
  ok(!/凭据/.test(SETTINGS_CODE), "㉓-4 Settings 用户可见文案不许再说「凭据」（注释除外）");
  ok(!/会话有效/.test(SETTINGS) && !/会话已失效（/.test(SETTINGS), "㉓-4 Settings 检查登录状态的两条通知不许再说「会话」");
  ok(!/会话已失效：作业页将拉不到/.test(SETTINGS), "㉓-4 Settings 雨课堂失效提示不许再说「会话已失效」");
  ok(!/记住密码（会话失效后/.test(SETTINGS), "㉓-4 Settings「记住密码」说明不许再说「会话失效」");
  ok(/登录状态已失效：作业页将拉不到雨课堂数据/.test(SETTINGS), "㉓-4 Settings 雨课堂失效提示必须改成「登录状态」口径");
  ok(/记住密码（登录状态失效后自动重新登录）/.test(SETTINGS), "㉓-4 Settings「记住密码」说明必须改成「登录状态」口径");
  const LINT = await import("./ui-copy-lint.mjs");
  const hitsOf = (src) => LINT.lintSource(src, "probe.tsx").filter((v) => v.rule === "R1" && v.hit === "会话");
  ok(hitsOf('const m = `会话已失效（${st.reason}）`;').length > 0,
    "㉓-4 ui-copy-lint 必须覆盖「带插值的模板串」里的会话（改前整串漏检）");
  ok(hitsOf('notify("yuketang", "会话已失效");').length > 0, "㉓-4 ui-copy-lint 必须覆盖 notify(...) 的字符串实参");
  ok(hitsOf("<div>\n  会话已失效：作业页将拉不到数据\n</div>").length > 0,
    "㉓-4 ui-copy-lint 必须覆盖独占一行的 JSX 文本（改前两端没有 >/< 就漏检）");
  ok(LINT.lintSource('const m = `登录状态已失效（${st.reason}）`;', "probe.tsx").length === 0,
    "㉓-4 ui-copy-lint 改后必须绿（「登录状态」口径不是违规）");
  /* 同一份判定器喂改前的 Settings 原文必须红（与命令行的「改前红」互相印证） */
  ok(hitsOf('notify("yuketang", `会话已失效（${st.reason ?? "未知原因"}）——可扫码重登`);').length > 0,
    "㉓-4 ui-copy-lint 必须能抓住改前 Settings.tsx 的那行原文（红→绿有据）");

  /* —— ㉓-5 上游原文的显示层净化：core 的 raw 错误不含内部名词才能上屏 —— */
  const USERCOPY = await import("../apps/desktop/src/lib/userCopy.ts");
  ok(
    USERCOPY.userCopy("网络学堂会话已失效（HTTP 401）") === "网络学堂登录状态已失效（HTTP 401）",
    "㉓-5 userCopy 必须把上游 raw「会话已失效」换成「登录状态已失效」",
  );
  ok(USERCOPY.userCopy("教务会话已超时，请重试") === "教务登录状态已失效，请重试",
    "㉓-5 userCopy 必须把「会话已超时」收成「登录状态已失效」");
  ok(!/会话|凭据|凭证|Cookie/.test(USERCOPY.userCopy("图书馆会话已失效，请重试；凭据请重新导入 Cookie")),
    "㉓-5 userCopy 之后上屏文本不许再出现任何内部名词（会话/凭据/凭证/Cookie）");
  ok(USERCOPY.userCopy("网络超时：请确认校园网 / WebVPN 可达。") === "网络超时：请确认校园网 / WebVPN 可达。",
    "㉓-5 网络超时是真实网络诊断（带行动指引），不许被净化改坏");
  ok(USERCOPY.userCopy("") === "" && USERCOPY.userCopy("普通错误") === "普通错误", "㉓-5 userCopy 必须幂等、不抛、不改无关文本");
  ok(/userCopy\(explainNetworkErrorRaw\(err\)\)/.test(TRANSPORT_CODE),
    "㉓-5 explainNetworkError 必须在唯一出口做一次 userCopy 净化（含直接回原文的兜底分支）");
  const settingsSinks = [
    "userCopy(ext.errors[source])",
    "userCopy(st.message)",
    "userCopy(ext.errors.yuketang)",
    "userCopy(ext.yktSession.reason",
    "userCopy(ext.errors.tyche)",
    "userCopy(ext.errors.dsa)",
  ];
  for (const s of settingsSinks) {
    ok(SETTINGS.includes(s), `㉓-5 设置页上屏上游 raw 错误的每个位置都必须过 userCopy（缺 ${s}）`);
  }
  const assignmentsPage = readFileSync("apps/desktop/src/pages/learn/AssignmentsPage.tsx", "utf8");
  ok(/userCopy\(err \?\? ""\)/.test(assignmentsPage), "㉓-5 作业页的扩展服务错误条也必须过 userCopy");
  const mailState = readFileSync("apps/desktop/src/state/mail.ts", "utf8");
  ok(/setError\(userCopy\(/.test(mailState), "㉓-5 邮件错误条也必须过 userCopy");

  /* —— ㉓-6 W5 定时器收紧：madmodel 快速重试必须退避，不许「已知校外仍每分钟空跑」 —— */
  const MADMODEL = readFileSync("apps/desktop/src/state/madmodel.ts", "utf8");
  const MADMODEL_CODE = stripComments(MADMODEL);
  ok(/let fastRetryBackoffMs = 60_000;/.test(MADMODEL_CODE), "㉓-6 madmodel 快速重试必须有退避状态（首次 60s）");
  ok(/Math\.min\(fastRetryBackoffMs \* 2, 5 \* 60_000\)/.test(MADMODEL_CODE),
    "㉓-6 连续校外必须指数退避且 5 分钟封顶（实测旧实现每 60s 一轮 3 跳请求 + 4 行日志）");
  ok(/if \(Date\.now\(\) < fastRetryAt\) return;/.test(MADMODEL_CODE),
    "㉓-6 退避窗口内必须直接短路——不许继续发请求");
  ok(/madmodelReachable === "1"\)/.test(MADMODEL_CODE) && /fastRetryAt = 0;/.test(MADMODEL_CODE),
    "㉓-6 拿到登录信息或探针判校内必须复位退避（保住「刚连上校园网」的快速恢复）");
  ok(/setInterval\(tick, 10 \* 60_000\)/.test(MADMODEL_CODE),
    "㉓-6 每 10 分钟的巡检泵与对话前按需 preflight 的数据新鲜度语义不许改");
  ok(/setInterval\(\(\) => \{[\s\S]*?\}, 60_000\)\.unref\?\.\(\);/.test(MADMODEL_CODE),
    "㉓-6 60s 检查节拍保留（只是退避窗口内不发请求）");
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉔ 流畅度治理（b26）：切页长帧的空闲预热机制 + core 残余「超时」上屏文案。
 *
 * 背景（霖本轮口径）：体验要「不卡一下」。真机（慢机 / 老 WebView）归因结论——
 * 切页的长帧来自「新页整棵子树的一次挂载渲染」，其中可确定归因、可离线化的一段是
 * 选课页挂载时的 THUbook 评价索引：同步 `JSON.parse` 约 111KB 的 `onethu.tbookIdx`
 * （实测 10.8ms）+ 1080 条 NFKC 归一化建图（13.8ms），冷 JIT 更贵。本节守两件事：
 *  - ㉔-1 该重计算必须有**空闲预热**出口、只在新鲜缓存时做（不发新网络）、并在启动
 *    路径接线；页面自己的 SWR 抓取（数据新鲜度）一字不动；
 *  - ㉔-2/㉔-3 core 残余的「超时」原文（`yuketangQr.ts` 的「等待扫码超时」、core
 *    失登判据里的「登录超时 / 登陆超时」）必须在显示层收成可操作口径；真实网络诊断
 *    （网络超时 / 请求超时）不许被无脑替换；`ui-copy-lint` 的 R1 必须新增「超时」。
 * ══════════════════════════════════════════════════════════════════════ */
{
  /* —— ㉔-1 W1：选课页索引的空闲预热（把重计算从点击帧挪到空闲期） —— */
  const XKREVIEWS_CODE = stripComments(readFileSync("apps/desktop/src/lib/xkreviews.ts", "utf8"));
  const APP_SRC = readFileSync("apps/desktop/src/App.tsx", "utf8");
  const COURSES_SRC = readFileSync("apps/desktop/src/pages/zhjwxk/Courses.tsx", "utf8");
  ok(/export function tbWarmIndexOnIdle\(\): void/.test(XKREVIEWS_CODE),
    "㉔-1 选课页索引必须有空闲预热出口 tbWarmIndexOnIdle()（切页帧里不再付同步解析+建图）");
  ok(/requestIdleCallback/.test(XKREVIEWS_CODE) && /timeout: 3000/.test(XKREVIEWS_CODE),
    "㉔-1 预热必须走 requestIdleCallback 且带超时兜底（空闲被饿死时仍会做，不占点击帧）");
  ok(/setTimeout\(run, 1200\)/.test(XKREVIEWS_CODE),
    "㉔-1 无 requestIdleCallback 的老 WebView 必须退化为定时器（两个宿主都要能跑）");
  ok(/if \(S\.loadingPromise \|\| S\.ready\) return;/.test(XKREVIEWS_CODE),
    "㉔-1 预热必须幂等（已就绪 / 已有在飞 promise 直接返回，不许重复建图）");
  ok(/Date\.now\(\) - ts >= IDX_TTL/.test(XKREVIEWS_CODE) && /onethu\.tbookIdxTs/.test(XKREVIEWS_CODE),
    "㉔-1 预热只允许在本地缓存**仍新鲜**时做：此时 tbEnsureIndex 的 fresh 分支为真、不发任何网络请求");
  ok(/const idx = await fetchIndex\(\);/.test(XKREVIEWS_CODE),
    "㉔-1 缓存过期/缺失时的网络抓取必须保留（不许为了快砍数据新鲜度）");
  ok(/if \(status !== "ready"\) return;[\s\S]{0,900}tbWarmIndexOnIdle\(\);/.test(stripComments(APP_SRC)),
    "㉔-1 预热必须在启动路径上接线（登录就绪后的 effect 内）");
  ok(/void tbEnsureIndex\(\)\.catch\(\(\) => undefined\);/.test(COURSES_SRC),
    "㉔-1 选课页仍须自己触发 tbEnsureIndex（SWR 与新鲜度语义不变）");

  /* —— ㉔-2 W2：userCopy 的逐条新规则（收敛、可测、不过度） —— */
  const USERCOPY = await import("../apps/desktop/src/lib/userCopy.ts");
  ok(USERCOPY.userCopy("等待扫码超时") === "暂未收到扫码，请重新获取二维码",
    "㉔-2 core「等待扫码超时」必须收成可操作口径（暂未收到扫码，请重新获取二维码）");
  ok(USERCOPY.userCopy("登录超时") === "登录状态已失效" && USERCOPY.userCopy("登陆超时") === "登录状态已失效",
    "㉔-2 core 自身失登判据里的「登录超时 / 登陆超时」必须收成「登录状态已失效」");
  ok(!/超时|会话|凭据|凭证|Cookie/.test(USERCOPY.userCopy("等待扫码超时；登录超时；会话已失效；凭据 Cookie")),
    "㉔-2 净化后上屏文本不许再含 超时/会话/凭据/凭证/Cookie");
  ok(USERCOPY.userCopy("网络超时：请确认校园网 / WebVPN 可达。") === "网络超时：请确认校园网 / WebVPN 可达。",
    "㉔-2 真实网络诊断（网络超时 + 行动指引）不许被改坏");
  ok(USERCOPY.userCopy("请求超时（30s 无响应，服务可能维护中）") === "请求超时（30s 无响应，服务可能维护中）",
    "㉔-2 请求级网络超时是真实诊断，不许被无脑替换（规则必须收敛到已知 core 原文形态）");
  ok(USERCOPY.userCopy("考试查询窗口触发服务端处理超时（jsp.timeout），已缩窗重试仍达") === "考试查询窗口触发服务端处理超时（jsp.timeout），已缩窗重试仍达",
    "㉔-2 服务端处理超时不是登录问题，保持原文（只收认证类超时）");
  const onceCopy = USERCOPY.userCopy("等待扫码超时 / 登录超时");
  ok(USERCOPY.userCopy(onceCopy) === onceCopy, "㉔-2 新规则必须幂等");

  /* —— ㉔-3 W2：新上屏点收口 + ui-copy-lint 可测面 —— */
  const EXTHW_MODAL = readFileSync("apps/desktop/src/components/ExtHwLoginModal.tsx", "utf8");
  ok((EXTHW_MODAL.match(/userCopy\(err\)/g) ?? []).length >= 2,
    "㉔-3 扫码 / 官方登录弹窗的两处错误行都必须过 userCopy（core 原文的唯一出口）");
  ok(/userCopy\(st\.reason \?\? "未知原因"\)/.test(SETTINGS),
    "㉔-3 设置页雨课堂「登录状态已失效（原因）」括号里的原因也必须过 userCopy");
  const LINT24 = await import("./ui-copy-lint.mjs");
  ok(LINT24.BANNED.some(([re, why]) => re.test("操作超时") && /用户侧/.test(why)),
    "㉔-3 ui-copy-lint 的 R1 禁用词必须新增「超时」（用户可见面不许再说超时）");
  const timeoutHits = (src) => LINT24.lintSource(src, "probe.tsx").filter((v) => v.rule === "R1" && v.hit === "超时");
  ok(timeoutHits('notify("yuketang", "等待扫码超时");').length > 0,
    "㉔-3 ui-copy-lint 必须能抓住用户可见文案里的「超时」（改前红）");
  ok(timeoutHits('const m = `登录状态已失效（${reason}）`;').length === 0,
    "㉔-3 改后口径（登录状态已失效）必须判绿");
  ok(LINT24.lintSource('const tip = "暂未收到扫码，请重新获取二维码";', "probe.tsx").length === 0,
    "㉔-3 新的可操作口径本身不许触发任何规则");
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉕ b31 P0（RC1 + RC2）：登录代次守卫 + 冷却态自动重试 + 重试按钮时序。
 *
 * 真机 BEFORE（b29 干净包，未注入；`/tmp/b31-rc1-b29.log`）：服务端 logout → 刷新触发
 * boot → `trySilentRelogin(成功) +2620ms`（`SILENT-RELOGIN ok`）之后仍有
 * `SOFT-RECOVER[global] state=skipped reason=cooldown (35ms)`、
 * `SOFT-RELOGIN state=skipped reason=cooldown streak=1 cooldown=60s`、
 * `PAGE-ERR CAMPUS-AUTH-PENDING` → 主页警示条常驻（恢复任务压根没执行、也没人回来重跑）。
 * 本组用**零依赖模块**（`state/authEpoch.ts` / `state/libSoftAutoRetry.ts`）做行为断言，
 * 再对 `state/app.tsx` / `state/data.ts` / `components/Layout.tsx` 做结构性断言。
 * ══════════════════════════════════════════════════════════════════════ */
const EPOCH = await import("../apps/desktop/src/state/authEpoch.ts");
const AUTO = await import("../apps/desktop/src/state/libSoftAutoRetry.ts");
const APP_CODE = stripComments(readFileSync("apps/desktop/src/state/app.tsx", "utf8"));
const AUTO_CODE = stripComments(readFileSync("apps/desktop/src/state/libSoftAutoRetry.ts", "utf8"));
const DATA_CODE_25 = DATA_CODE;
const hookSlice = (src, name) => {
  const i = src.indexOf(`export function ${name}(`);
  if (i < 0) return "";
  const j = src.indexOf("export function ", i + name.length);
  return src.slice(i, j < 0 ? src.length : j);
};
const CAMPUS_SLICE = hookSlice(DATA_CODE_25, "useCampusData");
const LEARN_SLICE = hookSlice(DATA_CODE_25, "useLearnData");
const SEM_SLICE = hookSlice(DATA_CODE_25, "useSemesters");
{
  /* ㉕-1 登录代次纯模块：0 起、每次 bump +1、护栏可复位 */
  EPOCH.resetAuthEpochForTest();
  ok(EPOCH.currentAuthEpoch() === 0, "㉕-1 代次初值必须是 0");
  ok(EPOCH.bumpAuthEpoch() === 1 && EPOCH.currentAuthEpoch() === 1, "㉕-1 bump 必须 +1 且可读回");
  ok(EPOCH.bumpAuthEpoch() === 2, "㉕-1 连续 bump 单调递增");
  EPOCH.resetAuthEpochForTest();
  ok(EPOCH.currentAuthEpoch() === 0, "㉕-1 护栏复位生效");

  /* ㉕-2 plan 纯函数：上限 3 / 抖动 / 在飞不叠加 / 已有定时器共用 */
  const base = { attempts: 0, hasTimer: false, recoveryInFlight: false, cooldownLeftMs: 5_000 };
  const p1 = AUTO.planLibSoftAutoRetry(base);
  ok(AUTO.LIB_SOFT_AUTO_RETRY_MAX === 3, "㉕-2 自动重试上限必须是 3 次");
  ok(p1.arm === true && p1.attempt === 1, "㉕-2 冷却态必须安排自动重试（attempt=1）");
  ok(p1.delayMs === 5_000 + AUTO.LIB_SOFT_AUTO_RETRY_JITTER_MS,
    `㉕-2 间隔必须是「冷却剩余 + 抖动」（实际 ${p1.delayMs}）`);
  ok(AUTO.planLibSoftAutoRetry({ ...base, hasTimer: true }).arm === false,
    "㉕-2 同 epoch 已有定时器时不许再叠加（并发加载共用一次）");
  ok(AUTO.planLibSoftAutoRetry({ ...base, recoveryInFlight: true }).arm === false,
    "㉕-2 有在飞恢复链时不许叠加自动重试");
  ok(AUTO.planLibSoftAutoRetry({ ...base, attempts: 3 }).exhausted === true,
    "㉕-2 用满 3 次必须报 exhausted（调用方才允许落警示）");
  ok(AUTO.planLibSoftAutoRetry({ ...base, cooldownLeftMs: -100 }).delayMs === AUTO.LIB_SOFT_AUTO_RETRY_JITTER_MS,
    "㉕-2 冷却已过（负剩余）只加抖动，不许无限等");
}

{
  /* ㉕-3 运行期闸门：一 epoch 一个定时器、到期各等待者跑一次、摘要每 epoch 至多一条、
   *      epoch 变化重置、卸载注销回收（真定时器，抖动窗口内） */
  AUTO.resetLibSoftAutoRetryForTest();
  const logs = [];
  AUTO.setLibSoftAutoRetryLogger((l) => logs.push(l));
  const calls = [];
  const r1 = AUTO.armLibSoftAutoRetry(11, 0, () => calls.push("a"));
  const r2 = AUTO.armLibSoftAutoRetry(11, 0, () => calls.push("b"));
  ok(r1 === "armed" && r2 === "shared", `㉕-3 同 epoch 并发加载必须共用一次（实际 ${r1}/${r2}）`);
  ok(AUTO.libSoftAutoRetryState().hasTimer === true && AUTO.libSoftAutoRetryState().waiters === 2,
    "㉕-3 一个定时器挂两个等待者");
  await sleep(AUTO.LIB_SOFT_AUTO_RETRY_JITTER_MS + 200);
  ok(calls.length === 2 && calls.includes("a") && calls.includes("b"),
    `㉕-3 到点必须把该 epoch 的等待者各跑一次（实际 ${calls.length}）`);
  ok(logs.length === 1 && /^AUTO-RECOVER /.test(logs[0]),
    `㉕-3 AUTO-RECOVER 摘要每 epoch 至多一条（实际 ${logs.length}）`);
  ok(AUTO.libSoftAutoRetryState().attempts === 1 && AUTO.libSoftAutoRetryState().hasTimer === false,
    "㉕-3 到点后次数 +1、定时器清空");
  AUTO.armLibSoftAutoRetry(11, 0, () => {});
  await sleep(AUTO.LIB_SOFT_AUTO_RETRY_JITTER_MS + 200);
  AUTO.armLibSoftAutoRetry(11, 0, () => {});
  await sleep(AUTO.LIB_SOFT_AUTO_RETRY_JITTER_MS + 200);
  ok(AUTO.libSoftAutoRetryState().attempts === 3, "㉕-3 有限次：用满 3 次即止");
  ok(AUTO.armLibSoftAutoRetry(11, 0, () => {}) === "exhausted",
    "㉕-3 用尽后返回 exhausted（不无限重试）");
  ok(logs.length === 1, `㉕-3 摘要仍只 1 条（不刷屏，实际 ${logs.length}）`);
  AUTO.armLibSoftAutoRetry(12, 0, () => {});
  ok(AUTO.libSoftAutoRetryState().epoch === 12 && AUTO.libSoftAutoRetryState().attempts === 1,
    "㉕-3 epoch 变化必须重置次数（旧定时器清掉）");
  const noop = () => {};
  AUTO.armLibSoftAutoRetry(13, 10_000, noop);
  const beforeRel = AUTO.libSoftAutoRetryState();
  AUTO.releaseLibSoftAutoRetry(13, noop);
  const afterRel = AUTO.libSoftAutoRetryState();
  ok(beforeRel.attempts === 1 && afterRel.attempts === 0 && afterRel.hasTimer === false,
    "㉕-3 组件卸载注销等待者并回收定时器/次数");
  AUTO.resetLibSoftAutoRetryForTest();
}

{
  /* ㉕-4 三处加载路径：发起捕获代次 + 每个结算点陈旧守卫 + 冷却态自动重试替代警示 */
  ok((DATA_CODE_25.match(/const epochAtStart = currentAuthEpoch\(\);/g) || []).length >= 3,
    "㉕-4 campus / learn / semesters 三处都必须「发起时」捕获登录代次");
  for (const [name, slice] of [["campus", CAMPUS_SLICE], ["learn", LEARN_SLICE], ["semesters", SEM_SLICE]]) {
    ok(slice.length > 0, `㉕-4 ${name} 切片为空，结构性断言失效`);
    ok((slice.match(/epochStale\(epochAtStart\)/g) || []).length >= 3,
      `㉕-4 ${name} 的每个结算点都必须有陈旧守卫（epoch 变了一律不写回）`);
    const armAt = slice.indexOf("armLibSoftAutoRetry(");
    ok(armAt > 0, `㉕-4 ${name} 的 skipped/cooldown 必须安排自动重试`);
    const noteAt = slice.indexOf("RELOGIN_PENDING_NOTE");
    ok(noteAt > armAt && slice.includes('=== "exhausted"'),
      `㉕-4 ${name} 的警示只允许出现在自动重试用尽（exhausted）之后`);
    const btAt = slice.indexOf("backToLogin()");
    const failAt = slice.lastIndexOf('state === "failed"', btAt);
    ok(btAt > 0 && failAt > 0 && failAt < btAt,
      `㉕-4 ${name} 仍只有真 failed 才 backToLogin（三态语义未改）`);
    ok(!/setError\(RELOGIN_PENDING_NOTE\);\s*return;/.test(slice.slice(0, armAt)),
      `㉕-4 ${name} 冷却态不许在安排自动重试之前直接弹警示`);
    /* b33（第三条路径）：failed 支必须先做「同代次内是否已有恢复成功 / 是否仍有恢复在飞」
     * 的只读复核；命中就不登出、改走同一 auto-retry 闸门的有限次重跑，只有复核不命中
     * 或次数用尽才 backToLogin——(A) 不误踢、(B) 真死仍如实落登录页，双侧都在代码里。 */
    ok(slice.includes("doneAtStart") && slice.includes("libSoftLastDoneAtMs()"),
      `㉖ ${name} 必须在发起时捕获「最近恢复成功」基线并在判定时重读（只读时间戳）`);
    ok(/state === "failed"[\s\S]*?libSoftSessionLooksAlive\([\s\S]*?armLibSoftAutoRetry\([\s\S]*?backToLogin\(\)/.test(slice),
      `㉖ ${name} failed 支的顺序必须是「存活复核 → 有限次重跑 → 才 backToLogin」`);
    ok(/recoveryInFlight: libSoftRecoveryInFlight\(\)/.test(slice),
      `㉖ ${name} 存活复核必须读 libSoftRecoveryInFlight()（在飞证据）`);
    ok(/recoveryInFlight: false/.test(slice),
      `㉖ ${name} 复核命中后的重跑必须传 recoveryInFlight:false（否则「在飞」这一支无人重跑）`);
    ok(/LIB-AUTH-ALIVE-RECHECK/.test(slice), `㉖ ${name} 存活复核必须有可 grep 的日志口径`);
    /* b36（b33 遗留）：真死侧（`verdict=none` ⇒ `alive.alive === false`）也要留一行可复核
     * 日志。形状：`if (alive.alive) { …LIB-AUTH-ALIVE-RECHECK… } else { claimLibAuthDeadLine
     * → logLine } backToLogin()`。**含义没变**：仍只有真 failed 才 backToLogin；这行只读、
     * 不触发任何恢复。 */
    const scope = `${name.toUpperCase()}-AUTH`;
    const looksAt = slice.indexOf("libSoftSessionLooksAlive(");
    const elseAt = looksAt < 0 ? -1 : slice.indexOf("} else {", looksAt);
    const deadAt = slice.indexOf("claimLibAuthDeadLine(");
    const btAfterElse = elseAt < 0 ? -1 : slice.indexOf("backToLogin()", elseAt);
    ok(elseAt > 0 && deadAt > elseAt && deadAt < btAfterElse,
      `㉖-4 ${name} 真死支（verdict=none）必须先 claimLibAuthDeadLine 再 backToLogin（不许打进存活支）`);
    ok(slice.includes(`claimLibAuthDeadLine(currentAuthEpoch(), "${scope}")`),
      `㉖-4 ${name} 真死日志的 scope 必须是闭合字面量 ${scope}`);
    ok(
      /const deadLine = claimLibAuthDeadLine\(currentAuthEpoch\(\), "[A-Z]+-AUTH"\);\s*\n\s*if \(deadLine\) void logLine\(deadLine\)\.catch\(\(\) => undefined\);/.test(slice),
      `㉖-4 ${name} 真死日志只许落 claimLibAuthDeadLine 返回的原行（不许再拼错误原文 / URL）`,
    );
  }
  ok(DATA_CODE_25.includes("libSoftCooldownLeftMs()") && DATA_CODE_25.includes("relearnRoamCooldownLeftMs()"),
    "㉕-4 自动重试的延迟必须同时吃「lib 冷却剩余」与「relearn 20s 节流剩余」（否则空转烧光次数）");
}

{
  /* ㉕-5 app.tsx：四个出口自增，并通过 useApp() 暴露 authEpoch */
  ok(/authEpoch: number;/.test(APP_CODE), "㉕-5 AppState 必须暴露 authEpoch");
  ok(APP_CODE.includes("setAuthEpoch(bumpAuthEpoch())"), "㉕-5 React 镜像必须来自 authEpoch 模块真值");
  ok((APP_CODE.match(/bumpEpoch\(\)/g) || []).length >= 4,
    "㉕-5 登录成功 / 2FA 完成 / 落登录页 / 登出四个出口都必须推进代次");
  ok(/authEpoch,\s*\n\s*\}\)/.test(APP_CODE) || /backToLogin,\s*logout,\s*authEpoch\]/.test(APP_CODE),
    "㉕-5 authEpoch 必须进 context 值（消费点才能拿到）");
}

{
  /* ㉕-6 重试按钮时序：先 await 清冷却再 onRetry，按钮期间置忙 */
  const enAt = LAYOUT_CODE.indexOf("export function ErrorNote");
  const enSlice = enAt < 0 ? "" : LAYOUT_CODE.slice(enAt, LAYOUT_CODE.indexOf("export function SkeletonRows", enAt));
  ok(enSlice.length > 0, "㉕-6 ErrorNote 切片为空，结构性断言失效");
  ok(enSlice.includes("setRetrying(true)") && enSlice.includes("disabled={retrying}"),
    "㉕-6 重试按钮必须置忙（防连点抢跑）");
  const finIdx = enSlice.indexOf(".finally(");
  const retryIdx = enSlice.indexOf("onRetry?.()");
  ok(finIdx > 0 && retryIdx > finIdx, "㉕-6 必须先 await 清冷却，再触发 onRetry");
  ok(!/\bonRetry\?\.\(\)/.test(enSlice.slice(0, finIdx)),
    "㉕-6 清冷却之前不许先触发 onRetry（旧 fire-and-forget 竞态）");
  ok(enSlice.includes("clearLibSoftBackoff()"), "㉕-6 重试必须先清静默重登的冷却");
  ok(/export async function clearLibSoftBackoff\(\): Promise<void>/.test(CLIENTS_CODE),
    "㉕-6 clearLibSoftBackoff 必须是可 await 的 Promise 形态（既有调用点仍兼容）");
  ok(/export function libSoftRecoveryInFlight\(/.test(GUARD_CODE_19),
    "㉕-6 libSoftRecoveryInFlight 只读观察在位（不叠加判定用）");
}

{
  /* ㉕-7 链外结算铁律不回退：data.ts 三处只经 settleLibSoftPending 等真结果，
   *      绝不在守卫内 await 在飞链（⑲-4 仍逐条在跑） */
  const settleCalls = (DATA_CODE_25.match(/settleLibSoftPending\(/g) || []).length;
  ok(settleCalls >= 6, `㉕-7 三条路径的两个恢复入口都必须链外结算真结果（实际 ${settleCalls} 处）`);
  ok((DATA_CODE_25.match(/await\s+r?\.?pending/g) || []).length === 0,
    "㉕-7 页面层不许直接 await pending（必须经 settleLibSoftPending）");
  ok(AUTO_CODE.includes("AUTO-RECOVER"), "㉕-7 AUTO-RECOVER 摘要模板在位（真机取证口径）");
}

{
  /* ══════════════════════════════════════════════════════════════════
   * ㉖ b33（b31 收尾·闪回登录页的第三条路径）：同一代次内两跳误判的护栏。
   *
   * 真机反例（`/tmp/b31-after-s3.log`）：`SOFT-RECOVER[global] state=done (195ms)`
   * 之后 67ms，另一跳 `relearnRoamOnce()` 的漫游请求拿到 id 登录链 200 页被判
   * `failed`，b19「任一入口真 failed 即登出」把刚证明活着的会话覆盖掉 → 闪回登录页。
   *
   * 口径：`failed` 落 `backToLogin()` **之前**只读复核「同代次内是否已有恢复成功 /
   * 是否仍有恢复在飞」；命中不登出、改走同一 auto-retry 闸门的**有限次**重跑；
   * 不命中（真死）或次数用尽 → 如实登出。本组做**双侧**断言：
   *  (A) 有存活证据 → 绝不 back-to-login（重跑）；(B) 真死 / 用尽 → 必须 back-to-login。
   * ══════════════════════════════════════════════════════════════════ */
  /* —— ㉖-1 只读时间戳：只在真成功（done）时写，失败绝不写 —— */
  GUARD.resetLibSoftStateForTest();
  ok(GUARD.libSoftLastDoneAtMs() === 0, "㉖ 复位后「最近恢复成功」读数必须是 0");
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => true);
  const afterDone = GUARD.libSoftLastDoneAtMs();
  ok(afterDone > 0, "㉖ 真成功（done）必须记录「最近恢复成功」时间戳");
  GUARD.resetLibSoftStateForTest();
  await GUARD.runLibSoftSingleFlightResult("lib-session", async () => false);
  ok(GUARD.libSoftLastDoneAtMs() === 0, "㉖ 真失败（failed）绝不许写「最近恢复成功」时间戳");
  GUARD.resetLibSoftStateForTest();
  ok(/if \(ok\) libSoftLastDoneAt = Date\.now\(\);/.test(GUARD_CODE_19),
    "㉖ 时间戳必须挂在「ok === true」支上（不许在 failed / skipped 分支写）");
  ok(/export function libSoftLastDoneAtMs\(\)/.test(GUARD_CODE_19),
    "㉖ 必须提供只读访问口 libSoftLastDoneAtMs()（不改变既有语义）");

  /* —— ㉖-2 纯函数真值表：三条存活证据 + 真死 —— */
  const probe = (o) => ({ doneAtStart: 0, doneNow: 0, recoveryInFlight: false, now: 30_000, ...o });
  const v = (o) => SETTLE.libSoftSessionLooksAlive(probe(o));
  ok(v({ doneAtStart: 1_000, doneNow: 2_000 }).verdict === "done-after-start" && v({ doneAtStart: 1_000, doneNow: 2_000 }).alive === true,
    "㉖-2 本次加载期间有恢复成功（代次未变）= 最强存活证据");
  ok(v({ doneAtStart: 1_000, doneNow: 1_000 }).alive === false,
    "㉖-2 基线内的旧成功不许当成新证据（必须严格大于 doneAtStart）");
  ok(v({ doneAtStart: 29_500, doneNow: 29_500 }).verdict === "recent-done",
    "㉖-2 宽限窗内的既有成功（本次加载未再刷新）算存活证据");
  ok(v({ doneAtStart: 20_000, doneNow: 20_000 }).alive === true,
    "㉖-2 宽限窗边界（age = grace）必须仍算存活证据");
  ok(v({ doneAtStart: 19_999, doneNow: 19_999, recoveryInFlight: false }).alive === false,
    "㉖-2 宽限窗外且无在飞恢复 = 真死（不许无限宽限）");
  ok(v({ recoveryInFlight: true }).verdict === "in-flight",
    "㉖-2 仍有恢复在飞时算存活证据（等它的结论，不登出）");
  ok(v({}).verdict === "none" && v({}).alive === false,
    "㉖-2 没有成功证据、也没有在飞恢复 = none（真死）");
  ok(SETTLE.LIB_SOFT_ALIVE_GRACE_MS === 10_000, "㉖-2 宽限窗必须是 10s（真机事件里 done 比误判早 67ms）");

  /* —— ㉖-3 双侧判定（与 data.ts 的结构一一对应；有限次用尽也算真死侧） —— */
  const decide = (probeArgs, attempts) => {
    if (!SETTLE.libSoftSessionLooksAlive(probe(probeArgs)).alive) return "back-to-login";
    const plan = AUTO.planLibSoftAutoRetry({ attempts, hasTimer: false, recoveryInFlight: false, cooldownLeftMs: 5_000 });
    return plan.exhausted ? "back-to-login" : "rerun";
  };
  ok(decide({ doneAtStart: 1_000, doneNow: 2_000 }, 0) === "rerun",
    "㉖-3 (A) 会话有存活证据 → 绝不登出，改为有限次重跑该加载");
  ok(decide({ recoveryInFlight: true }, 1) === "rerun",
    "㉖-3 (A) 仍有恢复在飞 → 不登出、有限次重跑（等结论）");
  ok(decide({}, 0) === "back-to-login",
    "㉖-3 (B) 会话真死（无成功证据、无在飞）→ 必须如实落登录页");
  ok(decide({ doneAtStart: 1_000, doneNow: 2_000 }, AUTO.LIB_SOFT_AUTO_RETRY_MAX) === "back-to-login",
    "㉖-3 (B) 有限次重跑用尽 → 必须如实落登录页（不许把真失败吞掉、不许卡在坏页面）");
  ok(decide({ doneAtStart: 1_000, doneNow: 2_000 }, AUTO.LIB_SOFT_AUTO_RETRY_MAX - 1) === "rerun",
    "㉖-3 (A) 上限内仍必须重跑（三态语义不被绕过）");

  /* —— ㉖-4 真死侧日志（b36，b33 遗留）：必有一条 / 每 epoch 至多一条 / 计数式 / 不含敏感值 ——
   * b33 只在复核命中时打 LIB-AUTH-ALIVE-RECHECK；(B) 真死一侧原来一条日志都没有。
   * 现在 `verdict=none` 也必须落一行 `LIB-AUTH-DEAD`，且同一 epoch 至多一条。 */
  SETTLE.resetLibAuthDeadLogForTest();
  const dead1 = SETTLE.claimLibAuthDeadLine(7, "CAMPUS-AUTH");
  ok(dead1 === "LIB-AUTH-DEAD verdict=none scope=CAMPUS-AUTH hits=1",
    `㉖-4 真死（verdict=none）必有一条可复核日志（实际 ${JSON.stringify(dead1)}）`);
  const dead2 = SETTLE.claimLibAuthDeadLine(7, "LEARN-AUTH");
  const dead3 = SETTLE.claimLibAuthDeadLine(7, "SEMESTERS-AUTH");
  ok(dead2 === null && dead3 === null, "㉖-4 同一 epoch 至多一条 LIB-AUTH-DEAD（其余只计数、不刷屏）");
  const deadState = SETTLE.libAuthDeadLogState();
  ok(deadState.epoch === 7 && deadState.hits === 3 && deadState.logged === true,
    `㉖-4 闸门必须是计数式（hits 记满 3、logged=true；实际 hits=${deadState.hits} logged=${deadState.logged}）`);
  const dead4 = SETTLE.claimLibAuthDeadLine(8, "LEARN-AUTH");
  ok(dead4 === "LIB-AUTH-DEAD verdict=none scope=LEARN-AUTH hits=1",
    "㉖-4 epoch 变化必须重置闸门（新登录代次可以再落一条）");
  ok(/^LIB-AUTH-DEAD verdict=none scope=(CAMPUS|LEARN|SEMESTERS)-AUTH hits=\d+$/.test(dead1),
    "㉖-4 行内字段只允许 verdict / scope / hits 三个（取值范围闭合）");
  ok(!/(https?:|\?|=%)/.test(dead1) && !/(cookie|ticket|token|passwd|password|credential|wrdvpn)/i.test(dead1),
    "㉖-4 真死日志绝不许带 URL / 查询串 / 票值 / 凭据");
  ok(
    /export type LibAuthDeadScope = "CAMPUS-AUTH" \| "LEARN-AUTH" \| "SEMESTERS-AUTH";/.test(SETTLE_CODE),
    "㉖-4 scope 必须是闭合字面量集合（不许动态拼入 URL / 查询串）",
  );
  const deadTpl = /`LIB-AUTH-DEAD[^`]*`/.exec(SETTLE_CODE)?.[0] ?? "";
  ok(
    deadTpl !== "" && (deadTpl.match(/\$\{/g) || []).length === 2 && !/(url|cookie|ticket|token|password)/i.test(deadTpl),
    `㉖-4 LIB-AUTH-DEAD 模板只许 scope / hits 两个插值、不许出现 URL 或票值字段（实际 ${JSON.stringify(deadTpl)}）`,
  );
  SETTLE.resetLibAuthDeadLogForTest();
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉗ F3 ④ 两条旁枝（b35，霖 2026-10-05 裁定「把旁支解决了」）
 *
 * 旁枝 (i) 其余票种两仓主动核对：除「响应带 Set-Cookie」的被动入账外，登录成功 /
 *   冷启就绪各做**一次**主动核对（有界：同触发器每会话最多一次；无轮询无定时器；
 *   幂等：同值不写；可观测：每次真跑恰一行计数日志；失败静默降级不抛）。
 *   方向仍是原生 → JS；**基础设施票只回灌、不反播**。
 * 旁枝 (ii) 冷启原生仓从 `(无)` 起：查证结论 = Rust 侧**一直有** save/load
 *   （`load_from_file` 在 setup、`save_if_dirty` 在 30s 循环），丢的是 host-only——
 *   旧 tsv 取 `cookie::Cookie::domain()`（原始 `Domain=` 属性，host-only 为 None）后
 *   `continue` 丢掉，于是含 `wengine_vpn_ticket` 在内的 host-only 票从未落盘。
 *   本组钉住：落盘改用 cookie_store 自带 serde JSON（保真）、只读 dump 不改状态、
 *   清仓语义一行未动（b21 红线）。
 * ══════════════════════════════════════════════════════════════════════ */
{
  /* —— ㉗-1 主动核对计划：有界幂等 + 单调规则 + 基础设施票只回灌不反播 —— */
  CS.resetCookieSyncState();
  const empty = CS.planJarReconcile([], () => null);
  ok(empty.plans.length === 0 && empty.stats.total === 0, "㉗-1 空快照必须 0 计划（核对本身不产生副作用）");
  const ticketRow = [{ host: "webvpn.tsinghua.edu.cn", path: "/", name: "wengine_vpn_ticket", value: "wrdvpn1-newAAA" }];
  const p1 = CS.planJarReconcile(ticketRow, () => null);
  ok(p1.plans.length === 1 && p1.stats.missing === 1 && p1.stats.infra === 1,
    "㉗-1 原生有、JS 缺 → 1 条回灌（missing / infra 各计 1）");
  ok(
    p1.plans[0].url === "https://webvpn.tsinghua.edu.cn/" && p1.plans[0].line === "wengine_vpn_ticket=wrdvpn1-newAAA; Path=/",
    "㉗-1 回灌行必须归一化为 `name=value; Path=/` 并落物理域键（否则 JS 侧读不到）",
  );
  const p2 = CS.planJarReconcile(ticketRow, () => "wrdvpn1-newAAA");
  ok(p2.plans.length === 0 && p2.stats.same === 1, "㉗-1 同值不重复写（幂等；stats.same=1、0 条写行）");
  CS.resetCookieSyncState();
  const p3 = CS.planJarReconcile([{ host: "learn.tsinghua.edu.cn", path: "/", name: "JSESSIONID", value: "v-new" }], () => "v-old");
  ok(p3.plans.length === 1 && p3.stats.updated === 1, "㉗-1 JS 有但不同 → 按单调规则让新值上位（stats.updated=1）");
  const p4 = CS.planJarReconcile([{ host: "learn.tsinghua.edu.cn", path: "/", name: "JSESSIONID", value: "v-old" }], () => "v-new");
  ok(p4.plans.length === 0 && p4.stats.stale === 1, "㉗-1 旧值回放必须被单调规则拒收（stats.stale=1、0 条写行）");
  ok(
    CS.planSeedToNative("https://webvpn.tsinghua.edu.cn/", "wengine_vpn_ticket=wrdvpn1-newAAA") === null,
    "㉗-1 基础设施票绝不反播（播种口恒 null，回灌方向才是它的通道）",
  );
  CS.resetCookieSyncState();
  const pInfraPath = CS.planJarReconcile([{ host: "webvpn.tsinghua.edu.cn", path: "/wengine/x", name: "refresh", value: "0" }], () => null);
  ok(pInfraPath.plans[0]?.line === "refresh=0; Path=/", "㉗-1 基础设施票的键必须收窄到 Path=/（与 b21 回灌同一口径，避免同名异键副本）");
  CS.resetCookieSyncState();
  const pPath = CS.planJarReconcile([{ host: "Learn.Tsinghua.EDU.CN", path: "/b/kc", name: "csrftoken", value: "t1" }], () => null);
  ok(pPath.plans[0]?.line === "csrftoken=t1; Path=/b/kc", "㉗-1 非基础设施票保留原生生效路径（老通道按路径匹配供票）");
  ok(
    CS.cookieSyncKey("Learn.Tsinghua.EDU.CN", "/b/kc", "csrftoken") === CS.cookieSyncKey("learn.tsinghua.edu.cn", "/b/kc", "csrftoken"),
    "㉗-1 键必须对主机名大小写归一",
  );

  /* —— ㉗-2 执行器：有界 / 幂等 / 可观测 / 失败静默降级 —— */
  const mkIO = (rows, existing = {}, fail = false) => {
    const io = { dumps: 0, writes: [], logs: [] };
    io.dumpNative = async () => {
      io.dumps += 1;
      if (fail) throw new Error("invoke unavailable");
      return rows;
    };
    io.existingValueOf = (h, p, n) => existing[`${h}|${p}|${n}`] ?? null;
    io.writeJs = (p) => {
      io.writes.push(p.line);
    };
    io.log = (l) => {
      io.logs.push(l);
    };
    return io;
  };
  CS.resetCookieSyncState();
  const io1 = mkIO([{ host: "learn.tsinghua.edu.cn", path: "/", name: "JSESSIONID", value: "a1" }]);
  const rec1 = CS.createCookieReconciler(io1);
  ok((await rec1.run("login")) === "done", "㉗-2 首次核对必须真跑并返回 done");
  ok(io1.dumps === 1 && io1.writes.length === 1 && io1.logs.length === 1, "㉗-2 一次核对 = 一次 dump + 写缺的键 + 恰一行日志");
  ok(
    /^LIB-JAR-RECONCILE trigger=login native=1 missing=1 updated=0 same=0 stale=0 infra=0$/.test(io1.logs[0]),
    "㉗-2 日志必须可检索、只带计数（不含任何票值）",
  );
  ok((await rec1.run("login")) === "skipped", "㉗-2 同一触发器第二次必须 skipped（有界：每会话最多一次）");
  ok(io1.dumps === 1 && io1.writes.length === 1 && io1.logs.length === 1, "㉗-2 skipped 不许再 dump / 再写 / 再刷日志");
  ok((await rec1.run("boot")) === "done" && io1.dumps === 2, "㉗-2 boot 触发器独立计数（登录成功与冷启就绪各一次）");
  CS.resetCookieSyncState();
  const io2 = mkIO(
    [{ host: "learn.tsinghua.edu.cn", path: "/", name: "JSESSIONID", value: "same1" }],
    { "learn.tsinghua.edu.cn|/|JSESSIONID": "same1" },
  );
  await CS.createCookieReconciler(io2).run("boot");
  ok(io2.writes.length === 0, "㉗-2 同值不重复写（0 条 writeJs）");
  CS.resetCookieSyncState();
  const io3 = mkIO([{ host: "learn.tsinghua.edu.cn", path: "/", name: "JSESSIONID", value: "c1" }]);
  const rec3 = CS.createCookieReconciler(io3);
  const both = await Promise.all([rec3.run("login"), rec3.run("login")]);
  ok(both.includes("done") && both.includes("skipped") && io3.dumps === 1, "㉗-2 并发重入只真跑一次（先占位）");
  CS.resetCookieSyncState();
  const io4 = mkIO([], {}, true);
  const rec4 = CS.createCookieReconciler(io4);
  let threw = false;
  let rr = "";
  try {
    rr = await rec4.run("boot");
  } catch {
    threw = true;
  }
  ok(!threw && rr === "failed", "㉗-2 dump 失败必须静默降级（不抛、返回 failed）");
  ok(io4.logs.length === 1 && /^LIB-JAR-RECONCILE trigger=boot failed /.test(io4.logs[0]), "㉗-2 失败也必须留一行可检索日志");
  ok(io4.writes.length === 0, "㉗-2 失败时不许写 JS jar");
  CS.resetCookieSyncState();
  const io5 = mkIO([{ host: "learn.tsinghua.edu.cn", path: "/", name: "JSESSIONID", value: "d1" }]);
  io5.log = () => {
    throw new Error("log broken");
  };
  ok((await CS.createCookieReconciler(io5).run("boot")) === "done", "㉗-2 日志口抛错也不许影响主链（返回 done）");
  const reconcileImpl = CS_CODE.slice(CS_CODE.indexOf("export function planJarReconcile"), CS_CODE.indexOf("export function planSeedToNative"));
  ok(
    !/nativeSeedCookies|planSeedToNative|http_native_seed/.test(reconcileImpl),
    "㉗-2 主动核对的实现里不许出现「反播原生」的口子（只产出写 JS jar 的行）",
  );

  /* —— ㉗-3 结构性：接线 / 挂点 / 清仓语义未变 / 原生落盘无损 —— */
  const RECONCILE_CODE = CLIENTS_CODE.slice(CLIENTS_CODE.indexOf("const jarReconciler"), CLIENTS_CODE.indexOf("function clearLibSoftBackoff"));
  ok(/http\.jar\.setRaw\(new URL\(p\.url\), p\.line\)/.test(RECONCILE_CODE), "㉗-3 核对写回必须走既有 JS jar 的 setRaw");
  ok(!/nativeSeedCookies|planSeedToNative/.test(RECONCILE_CODE), "㉗-3 核对接线里不许出现反播原生的播种调用");
  ok(
    (CLIENTS_CODE.match(/reconcileCookieJarsOnce\(/g) ?? []).length === 4,
    "㉗-3 主动核对只允许 1 处定义 + 3 处挂点（登录成功 / 2FA 完成 / 冷启就绪）",
  );
  ok(
    (CLIENTS_CODE.match(/reconcileCookieJarsOnce\("login"\)/g) ?? []).length === 2 &&
      (CLIENTS_CODE.match(/reconcileCookieJarsOnce\("boot"\)/g) ?? []).length === 1,
    "㉗-3 触发器只允许 login（登录成功 + 2FA 完成）与 boot（冷启就绪）",
  );
  ok(
    CLIENTS_CODE.indexOf("resetCookieSyncState()") < CLIENTS_CODE.indexOf('reconcileCookieJarsOnce("boot")'),
    "㉗-3 冷启核对必须在 cookie 世代重置（水合基线）之后",
  );
  ok(
    /export async function nativeCookieDump\(\)[\s\S]{0,400}?invoke\("http_native_cookie_dump"\)/.test(TRANSPORT_CODE),
    "㉗-3 只读快照必须打到 http_native_cookie_dump",
  );
  /* 原生侧（Rust）：JSON 落盘 / 只读 dump / 清仓语义未变 */
  const RUST_CODE = stripComments(readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8"));
  ok(
    /cookie_store::serde::json::load_all/.test(RUST_CODE) && /save_incl_expired_and_nonpersistent/.test(RUST_CODE),
    "㉗ 原生落盘必须换成 cookie_store 自带 serde JSON（host-only / 默认路径保真）",
  );
  const saveSlice = RUST_CODE.slice(RUST_CODE.indexOf("fn save_to_file"), RUST_CODE.indexOf("fn load_from_file"));
  ok(!/\.domain\(\)/.test(saveSlice), "㉗ 落盘不许再读原始 Domain= 属性（host-only 会被丢——b21 冷启 (无) 的根因）");
  ok(/create_dir_all/.test(saveSlice), "㉗ 落盘前必须确保父目录存在（旧实现 `let _ = write` 静默失败）");
  ok(!/store\(false/.test(saveSlice.slice(saveSlice.indexOf("Err(e) =>"))), "㉗ 写失败绝不许清 dirty（否则失败即永久丢数据）");
  const dumpAt = RUST_CODE.indexOf("fn http_native_cookie_dump");
  const dumpSlice = RUST_CODE.slice(dumpAt, dumpAt + 600);
  ok(dumpAt > 0 && !/store\(true|\.clear\(\)|seed_line/.test(dumpSlice), "㉗ 只读 dump 不许改原生仓状态（不 seed / 不清仓 / 不置 dirty）");
  ok(/http_native_cookie_dump,\s*thos_open_portal,/.test(RUST_CODE), "㉗ 只读 dump 必须在 invoke_handler 里注册");
  ok(
    /fn http_native_clear_cookies\(\)[\s\S]{0,200}?NATIVE_JAR_ARC\.clear\(\);/.test(RUST_CODE),
    "㉗ 清仓语义未变：显式登出仍走 http_native_clear_cookies → 原生仓全清（b21 红线）",
  );
  ok(
    /fn http_native_clear_cookies_domain\(suffixes: Vec<String>\)[\s\S]{0,400}?let keep: Vec<String> = \{/.test(RUST_CODE),
    "㉗ 清仓语义未变：登录前仍按 id/oauth 域清（保留其余票），一行未动",
  );
  ok(/fn clear\(&self\) \{[\s\S]{0,200}?self\.1\.store\(true/.test(RUST_CODE), "㉗ clear() 仍置 dirty（清仓后 30s 内落盘，冷启不会回魂）");
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉘ b36 口径 1：触发面唯一 —— 不存在绕过 ③ 的原生通道，且每条请求恰好一次判定。
 *
 * 病根（b17/b18 残留）：③ 判定只挂在 `nativeFetch`（`http_native` 原语）上；Tauri 下
 * `universalFetch` 走的是 `tauriFetch`（自成一体的逐跳跳循环），**完全绕过判定**——
 * DormTab（水票下单/查询）、CourseInfoTab、ThubookPage、market、exthw、cloudCal、
 * plugins SDK 等调用方撞上登录状态失效时，③ 抓不到，只能靠各自页面兜底。
 *
 * 口径（霖 2026-10-05 裁定「口径 1」）：把 `tauriFetch` 也收进**同一个**判定入口。
 * 结构：唯一入口 `judgedNativeFetch(url, attempt)` 里只出现一次 `withLibAuthRecovery`；
 * 两条通道各自只有一层薄壳（`nativeFetch` / `tauriFetch`），两个单次请求原语
 * （`nativeFetchOnce` / `tauriFetchOnce`）不含判定、也互不调用 ⇒ 不可能双重包装。
 * 判据集合一个字未改（仍是 `isLibAuthFailureText` + `looksLibLoggedOut`，未加 401/403）。
 * ══════════════════════════════════════════════════════════════════════ */
{
  const fnSlice = (src, name) => {
    const m = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
    if (!m) return "";
    const end = src.indexOf("\n}\n", m.index);
    return src.slice(m.index, end < 0 ? src.length : end + 3);
  };
  const JUDGED = fnSlice(TRANSPORT_CODE, "judgedNativeFetch");
  const NATIVE_ENTRY = fnSlice(TRANSPORT_CODE, "nativeFetch");
  const TAURI_ENTRY = fnSlice(TRANSPORT_CODE, "tauriFetch");
  const NATIVE_ONCE = fnSlice(TRANSPORT_CODE, "nativeFetchOnce");
  const TAURI_ONCE = fnSlice(TRANSPORT_CODE, "tauriFetchOnce");

  /* —— ㉘-1 唯一判定入口：两处切片必须都非空，否则后续断言失效 —— */
  ok(JUDGED.length > 0 && NATIVE_ENTRY.length > 0 && TAURI_ENTRY.length > 0 && NATIVE_ONCE.length > 0 && TAURI_ONCE.length > 0,
    `㉘-1 传输层函数切片取不到（judged=${JUDGED.length} native=${NATIVE_ENTRY.length} tauri=${TAURI_ENTRY.length} nativeOnce=${NATIVE_ONCE.length} tauriOnce=${TAURI_ONCE.length}）`);
  const judgeSites = (TRANSPORT_CODE.match(/withLibAuthRecovery[<(]/g) || []).length;
  ok(judgeSites === 1, `㉘-1 判定入口必须唯一（transport.ts 里 withLibAuthRecovery 实际 ${judgeSites} 处）`);
  ok(JUDGED.includes("withLibAuthRecovery") && JUDGED.includes("isLibAuthFailureText") && JUDGED.includes("looksLibLoggedOut"),
    "㉘-1 唯一判定入口必须同时做「Rust 鉴权文案」与「200 登录页」两类判定（判据复用既有）");

  /* —— ㉘-2 不存在绕过判定的原生通道：两条公开入口都走唯一入口 —— */
  ok(NATIVE_ENTRY.includes("judgedNativeFetch(url, () => nativeFetchOnce(url, init))"),
    "㉘-2 nativeFetch 通道必须经唯一判定入口");
  ok(TAURI_ENTRY.includes("judgedNativeFetch(url, () => tauriFetchOnce(url, init))"),
    "㉘-2 tauriFetch 通道必须经唯一判定入口（原先绕过 ③ 的通道已收口）");
  const uniAt = TRANSPORT_CODE.indexOf("export const universalFetch");
  const uniSlice = uniAt < 0 ? "" : TRANSPORT_CODE.slice(uniAt, uniAt + 320);
  ok(/isTauri\s*\?\s*tauriFetch\(url, init\)\s*:\s*window\.fetch\(url, init\)/.test(uniSlice),
    "㉘-2 universalFetch 的 Tauri 分支必须落到受判定的 tauriFetch（不许再直连原语）");
  ok(!/export[^\n]*invokeHttp/.test(TRANSPORT_CODE), "㉘-2 原始 invoker invokeHttp 不许导出（否则可绕过判定）");
  ok(!/export[^\n]*function\s+(?:nativeFetchOnce|tauriFetchOnce)\s*\(/.test(TRANSPORT_CODE),
    "㉘-2 两个单次请求原语必须私有（公开面只允许受判定的 nativeFetch / tauriFetch）");

  /* —— ㉘-3 不双重包装：原语无判定、互不调用；判定入口只接 attempt —— */
  /** 取函数体（跳过声明行；`= {}` 这类默认参数不会误当函数体开始）。 */
  const bodyOf = (s) => {
    const m = /\{\s*\n/.exec(s);
    return m ? s.slice(m.index + 1) : s;
  };
  const NATIVE_ONCE_BODY = bodyOf(NATIVE_ONCE);
  const TAURI_ONCE_BODY = bodyOf(TAURI_ONCE);
  ok(!/withLibAuthRecovery|judgedNativeFetch/.test(NATIVE_ONCE_BODY), "㉘-3 nativeFetchOnce 不许自带判定（否则同一请求判两次）");
  ok(!/withLibAuthRecovery|judgedNativeFetch/.test(TAURI_ONCE_BODY), "㉘-3 tauriFetchOnce 不许自带判定（否则同一请求判两次）");
  ok(!/nativeFetchOnce\(|tauriFetch\(/.test(NATIVE_ONCE_BODY),
    "㉘-3 nativeFetchOnce 不许调用其它原语或公开入口（调用 = 同一请求被判两次）");
  ok(!/nativeFetch\(|tauriFetch\(/.test(TAURI_ONCE_BODY),
    "㉘-3 tauriFetchOnce 不许调用其它原语或公开入口（调用 = 同一请求被判两次，即双重包装）");
  ok(!/[\s(]tauriFetch\(/.test(JUDGED) && !/[\s(]nativeFetch\(/.test(JUDGED),
    "㉘-3 判定入口只接 attempt 原语，不许内部再调公开入口（重复包装）");
  ok((TRANSPORT_CODE.match(/hooks\.recover\(/g) || []).length === 1 && /hooks \? hooks\.recover\(url, failure\)/.test(JUDGED),
    "㉘-3 恢复动作只允许一个调用点（唯一注入钩子）");
  ok(/let nativeFetchAuthHooks: NativeFetchAuthHooks \| null = null;/.test(TRANSPORT_CODE),
    "㉘-3 两条通道必须共用同一个恢复钩子单例（就是同一把共享单飞）");
  ok((CLIENTS_CODE.match(/setNativeFetchAuthHooks\(/g) || []).length === 1,
    "㉘-3 恢复钩子只允许一个接线点（业务侧唯一，不许两条通道各接一套）");
  ok(!/runLibSoftSingleFlight|libEnsureSession|libSoftRelogin/.test(TRANSPORT_CODE),
    "㉘-3 传输层仍不许新增第二套调度（恢复动作必须由注入钩子提供）");

  /* —— ㉘-4 每条请求恰好一次判定 + 恰好一次重登（行为，含不双重触发） —— */
  let classifyCalls = 0;
  let attempts2 = 0;
  let relogins = 0;
  await GUARD.withLibAuthRecovery({
    attempt: async () => {
      attempts2 += 1;
      return { status: 200, body: '<input name="i_pass">' };
    },
    classifyError: () => {
      classifyCalls += 1;
      return null;
    },
    classifyValue: (r) => {
      classifyCalls += 1;
      return GUARD.looksLibLoggedOut({ body: r.body }) ? { signal: "logged-out-page", detail: "status=200" } : null;
    },
    recover: async () => {
      relogins += 1;
      return true;
    },
  });
  ok(classifyCalls === 2 && attempts2 === 2 && relogins === 1,
    `㉘-4 一次失效 = 恰好一次判定（2 次 attempt 各一次）+ 一次重登 + 一次重放（实际 classify=${classifyCalls} attempt=${attempts2} recover=${relogins}）`);

  let okClassify = 0;
  let okAttempts2 = 0;
  let okRelogins = 0;
  await GUARD.withLibAuthRecovery({
    attempt: async () => {
      okAttempts2 += 1;
      return { status: 200, body: '{"object":{"ryh":"2026000000"}}' };
    },
    classifyError: () => {
      okClassify += 1;
      return null;
    },
    classifyValue: () => {
      okClassify += 1;
      return null;
    },
    recover: async () => {
      okRelogins += 1;
      return true;
    },
  });
  ok(okAttempts2 === 1 && okClassify === 1 && okRelogins === 0,
    `㉘-4 正常 200 = 一次 attempt、一次判定、0 重登 0 重放（实际 attempt=${okAttempts2} classify=${okClassify} recover=${okRelogins}）`);

  /* 两条通道共用同一钩子 ⇒ 并发同一失效时真重登仍只有一次（与 ⑭ 的共享单飞断言同源，
   * 这里补证「两个通道各来一发，合并成一把单飞」）。 */
  GUARD.resetLibSoftStateForTest();
  let realRelogins2 = 0;
  const viaChannel = (label) =>
    GUARD.withLibAuthRecovery({
      attempt: async () => {
        void label;
        return { status: 200, body: '<input name="i_pass">' };
      },
      classifyError: () => null,
      classifyValue: (r) => (GUARD.looksLibLoggedOut({ body: r.body }) ? { signal: "logged-out-page", detail: "x" } : null),
      recover: () =>
        GUARD.runLibSoftSingleFlight("lib-session", async () => {
          realRelogins2 += 1;
          await sleep(30);
          return true;
        }),
    });
  await Promise.all([viaChannel("native"), viaChannel("tauri"), viaChannel("tauri")]);
  ok(realRelogins2 === 1, `㉘-4 两个通道并发同一失效率只许真重登一次（实际 ${realRelogins2} 次）`);
}

/* ══════════════════════════════════════════════════════════════════════
 * ㉙ b38 判定域限缩：③ 只对清华 / WebVPN 域生效，域名单与既有常量同源。
 *
 * 裁定（霖 2026-10-05）：把 ③ 判定限缩到清华 / WebVPN 域。b36 口径 1 把 `tauriFetch`
 * 收进唯一判定入口后，`universalFetch` 上的外部 / 非清华消费方（拓课 / 雨课堂 /
 * market / cloudCal / trace / thubook / `tsinghua.app` / 水站 / 洗衣机外部域）也会过
 * ③——它们若真返回「像登录页」的 200 或鉴权类文案就会触发一次全链恢复（有共享单飞与
 * 冷却兜底、不登出，但属误触发面）。
 *
 * 口径：gate 落在**唯一判定入口** `judgedNativeFetch` 上（两条原生通道一并生效 ⇒ 不留
 * 「某条通道漏 gate」的新绕过面）；域外请求直接执行原语、不进判定/恢复、不落 LIB-AUTH。
 * 域名单**不新造**：`LIB_AUTH_JUDGE_HOST_BASE = "tsinghua.edu.cn"` 与 transport.ts 的
 * 域分流判据同源，站点表五域与 core 的 `WEBVPN_ROOT` 全落判据内。
 * 清华会话链判定一字未改（㉙-2 逐域为证；㉘ 的「两条通道 → 唯一入口」形状 b38 未变，
 * 变的只是入口内部先过域闸）。
 * ══════════════════════════════════════════════════════════════════════ */
{
  const fnSlice29 = (src, name) => {
    const m = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
    if (!m) return "";
    const end = src.indexOf("\n}\n", m.index);
    return src.slice(m.index, end < 0 ? src.length : end + 3);
  };
  const GUARD_CODE = stripComments(readFileSync("apps/desktop/src/lib/libSessionGuard.ts", "utf8"));

  /* —— ㉙-1 外部域一律不进 ③ 判定（域名逐个取自既有代码，不新造） —— */
  const EXTERNAL_DOMAINS = [
    ["https://ai.tuoj.thusaac.com/api/user/oauth/info", "拓课（packages/core/src/exthw/tuoj.ts 的 BASE）"],
    ["https://api.github.com/repos/smartThise/OneTHU-Market/contents/x", "market（apps/desktop/src/lib/market.ts）"],
    ["https://pro.yuketang.cn/v2/api/web/courses/list", "雨课堂（packages/core/src/exthw/yuketang.ts 的 BASE）"],
    ["https://thubook.help/thubook/", "THUbook（apps/desktop/src/pages/ThubookPage.tsx 的 BASE）"],
    ["https://restapi.amap.com/v3/place/text?keywords=x", "trace（apps/desktop/src/lib/trace.ts 的 REST）"],
    ["https://tsinghua.app/api/semesters", "CourseInfoTab / coursex（b36 段明标外部域）"],
    ["https://yshz-user.haier-ioc.com/api/x", "洗衣机外部域（b36 真机实录）"],
  ];
  for (const [u, who] of EXTERNAL_DOMAINS) {
    ok(GUARD.isLibAuthJudgeUrl(u) === false, `㉙-1 外部域不许进 ③ 判定：${who} → ${u}`);
  }
  ok(
    GUARD.isLibAuthJudgeUrl("https://eviltsinghua.edu.cn/x") === false,
    "㉙-1 近似域（裸 endsWith 会放它进来的 eviltsinghua.edu.cn）必须不算清华域——判据是带点后缀",
  );
  ok(GUARD.isLibAuthJudgeUrl("https://tsinghua.edu.cn.evil.com/x") === false, "㉙-1 后缀伪装域不算清华域");
  ok(GUARD.isLibAuthJudgeUrl("") === false && GUARD.isLibAuthJudgeUrl("not a url") === false,
    "㉙-1 空值 / 畸形 URL 不判（不猜：外部请求不为解析失败买单）");

  /* —— ㉙-2 清华 / WebVPN 域照旧进判定（清华会话链一个都不能掉） —— */
  const TSINGHUA_URLS = [
    "https://learn.tsinghua.edu.cn/f/wlxt/index/course/student/index",
    "https://info.tsinghua.edu.cn/f/info/gxfw_fg/common/grjbxx",
    "https://seat.lib.tsinghua.edu.cn/api/seat",
    "https://cab.lib.tsinghua.edu.cn/ic-web/auth/address",
    "https://card.tsinghua.edu.cn/business/getCardUserinfo",
    "https://zhjwxk.cic.tsinghua.edu.cn/xkBks.vxkBksXkbBs.do",
    "https://zhjw.cic.tsinghua.edu.cn/portal3rd.do",
    "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/0a993de7/0",
    "https://oauth.tsinghua.edu.cn/oauth2/authorize",
    "https://madmodel.cs.tsinghua.edu.cn/api/x",
    "https://app.cs.tsinghua.edu.cn/Api/JieliWashers?building=1",
    "https://mails.tsinghua.edu.cn/coremail/index.jsp",
    "http://myhome.tsinghua.edu.cn/kongjian",
    "https://dzpj.tsinghua.edu.cn/x",
    "https://tsinghua.edu.cn/",
    // webvpn 包装 URL（物理域就是 webvpn.tsinghua.edu.cn —— 裁定里的「WebVPN 域」）
    "https://webvpn.tsinghua.edu.cn/wengine-vpn/cookie?method=get&host=info.tsinghua.edu.cn&scheme=https&path=/f/info/gxfw_fg/common/index",
    "https://webvpn.tsinghua.edu.cn/https/77726476706e69737468656265737421f9f9479369247b59700f81b9991b2631506205de/b/info/gxfw_fg/common/grjbxx",
  ];
  for (const u of TSINGHUA_URLS) {
    ok(GUARD.isLibAuthJudgeUrl(u) === true, `㉙-2 清华 / WebVPN 域必须照旧进 ③ 判定：${u}`);
  }

  /* —— ㉙-3 域名单与既有常量同源（不许自己发明域名列表） —— */
  const suffixInTransport = /h\.endsWith\("([^"]+)"\)/.exec(TRANSPORT_CODE)?.[1] ?? "";
  ok(
    suffixInTransport === GUARD.LIB_AUTH_JUDGE_HOST_BASE,
    `㉙-3 判定域基必须与 transport.ts 域分流判据同源（transport=${suffixInTransport} / 判据=${GUARD.LIB_AUTH_JUDGE_HOST_BASE}）`,
  );
  /* 站点表五域：从 sitesOfLostHost 源码机械提取（新增站点也会被本断言覆盖）。
   * 正则字面量里的 `?` 是可选字符（如 `zhjwx?k?`），比对时按「去掉 ?」取代表域名。 */
  const sitesSrc = fnSlice29(GUARD_CODE, "sitesOfLostHost");
  const siteHosts = [...sitesSrc.matchAll(/([a-z0-9?\\\.\-]+)\\\.tsinghua\\\.edu\\\.cn/gi)].map(
    (m) =>
      `${m[1]
        .replace(/\?/g, "")
        .replace(/\\\./g, ".")
        .replace(/\.$/, "")}.tsinghua.edu.cn`,
  );
  ok(siteHosts.length >= 5, `㉙-3 sitesOfLostHost 站点域提取失败（实际 ${siteHosts.length} 个：${siteHosts.join(",")}）`);
  for (const h of siteHosts) {
    ok(GUARD.sitesOfLostUrl(`https://${h}/x`).length > 0, `㉙-3 提取出的站点域必须真被站点表认得：${h}`);
    ok(GUARD.isLibAuthJudgeUrl(`https://${h}/x`) === true, `㉙-3 站点表域必须在判定域内：${h}`);
  }
  /* core 的 webvpn 落点常量 */
  const WEBVPN_CODE = stripComments(readFileSync("packages/core/src/crypto/webvpn.ts", "utf8"));
  const webvpnRoot = /export const WEBVPN_ROOT = "([^"]+)"/.exec(WEBVPN_CODE)?.[1] ?? "";
  ok(webvpnRoot === "https://webvpn.tsinghua.edu.cn", `㉙-3 WEBVPN_ROOT 取值漂移（实际 ${webvpnRoot}）`);
  ok(GUARD.isLibAuthJudgeUrl(`${webvpnRoot}/https/abc/x`) === true, "㉙-3 webvpn 落点必须在判定域内");
  /* 判据本体里不许再出现任何字面域名（只许引用同源常量）：把常量名摘掉后，
   * 剩下的代码里不许有任何「引号包着的域名样串」。 */
  const judgePredSrc = fnSlice29(GUARD_CODE, "isLibAuthJudgeUrl");
  ok(judgePredSrc.length > 0, "㉙-3 判据函数切片取不到");
  const judgeStripped = judgePredSrc.split("LIB_AUTH_JUDGE_HOST_BASE").join("");
  ok(
    !/https?:\/\//.test(judgePredSrc) &&
      !/["'`][a-z0-9.-]*[a-z0-9]\.[a-z]{2,}["'`]/i.test(judgeStripped),
    "㉙-3 判据里不许写任何字面域名（域名单只许来自 LIB_AUTH_JUDGE_HOST_BASE 这一个同源常量）",
  );

  /* —— ㉙-4 判定入口仍唯一：withLibAuthRecovery 全仓只一处调用 —— */
  const walkSrc = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const p = `${dir}/${d.name}`;
      if (d.isDirectory()) {
        return d.name === "node_modules" || d.name === "dist" || d.name.startsWith(".") ? [] : walkSrc(p);
      }
      return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
    });
  const callSites29 = [];
  for (const f of [...walkSrc("apps/desktop/src"), ...walkSrc("packages")]) {
    if (f.endsWith("lib/libSessionGuard.ts")) continue; // 唯一实现处（定义，不是调用）
    const n = (stripComments(readFileSync(f, "utf8")).match(/withLibAuthRecovery[<(]/g) || []).length;
    if (n) callSites29.push(`${f}×${n}`);
  }
  ok(
    callSites29.length === 1 && callSites29[0].endsWith("×1"),
    `㉙-4 withLibAuthRecovery 全仓只许一处调用（唯一判定入口；实际 ${JSON.stringify(callSites29)}）`,
  );
  ok(
    callSites29[0] === "apps/desktop/src/lib/transport.ts×1",
    "㉙-4 唯一调用点必须在 transport.ts 的唯一判定入口里",
  );

  /* —— ㉙-5 gate 落在唯一判定入口最前面：域外只执行原语一次，不判不恢复 —— */
  const judgedSrc29 = fnSlice29(TRANSPORT_CODE, "judgedNativeFetch");
  const gateAt = judgedSrc29.indexOf("isLibAuthJudgeUrl(url)");
  const judgeAt = judgedSrc29.indexOf("withLibAuthRecovery");
  ok(gateAt >= 0 && judgeAt > gateAt, "㉙-5 域闸必须在唯一判定入口的判定之前");
  ok(
    /if \(!isLibAuthJudgeUrl\(url\)\) return \(await attempt\(\)\)\.res;/.test(judgedSrc29),
    "㉙-5 域外分支必须只执行原语一次并原样返回（不判、不恢复、不落 LIB-AUTH）",
  );
  ok((judgedSrc29.match(/withLibAuthRecovery[<(]/g) || []).length === 1, "㉙-5 域闸不许复制 / 分裂判定入口");
  ok(
    /import \{[\s\S]{0,400}?isLibAuthJudgeUrl[\s\S]{0,400}?\} from "\.\/libSessionGuard\.js"/.test(TRANSPORT_CODE),
    "㉙-5 域闸判据必须来自共享模块 libSessionGuard（护栏加载的同一份实现，不许在传输层另写一份）",
  );
}

/* ── 结论 ── */
/* ── ㉚ 静默刷新的三态结算（霖 2026-10-07 第 49 条；b23 P2 同句式）────────────────
   旧版返回 `LearnBundle | null`，把「没执行」与「失败」混成一个 null；旧 data.ts:369 曾据此清缓存
   ＝静默丢数据。本组钉死：三态齐全、skipped 一律保旧值、silent 路径里不许出现 cache = null。 */
const dataSrc = readFileSync("apps/desktop/src/state/data.ts", "utf8");
const silentIdx = dataSrc.indexOf("export function refreshLearnDataSilently");
const silentEnd = dataSrc.indexOf("let autoRefreshTimer", silentIdx);
const silentBody = silentIdx < 0 || silentEnd < 0 ? "" : dataSrc.slice(silentIdx, silentEnd);
ok(silentIdx >= 0 && silentBody.length > 0, "找不到 refreshLearnDataSilently（第 49 条的对象没了）");
ok(/export interface LearnSilentResult/.test(dataSrc) && /LearnSilentState = "done" \| "skipped" \| "failed"/.test(dataSrc), "静默刷新没有三态结算类型（done/skipped/failed）");
ok(/state: "skipped", reason: "reentrant"/.test(silentBody), "单飞在飞时没有按 skipped/reentrant 结算（会把「没执行」混成失败）");
ok(/if \(re\.state === "skipped"\) \{/.test(silentBody) && /reason: re\.reason === "cooldown" \? "cooldown" : "reentrant"/.test(silentBody), "免密重登被节流判掉时没有保旧值的 skipped/cooldown 分支");
ok(/state: "skipped", reason: "transient"/.test(silentBody), "非鉴权类错误没有走 skipped/transient（保旧值）");
ok(/state: "failed"/.test(silentBody), "没有 failed 态（真失败无法与「没执行」区分）");
ok(!/cache = null/.test(silentBody), "静默刷新里出现 cache = null（＝静默丢数据，第 49 条禁）");
ok(/data: cache\?\.data \?\? null/.test(silentBody), "skipped/failed 结算没有带上当前缓存句柄（无法保旧值）");
ok(/LEARN-SILENT/.test(dataSrc) && /logLearnSilent\(r, key\)/.test(silentBody), "静默刷新没有打 LEARN-SILENT 标记（真机走查无法过滤结算）");
/* ── ㉛ 登录申请冷却的「假失败」（霖 2026-10-07 第 48 条）────────────────────
   `loginGate` 20s 冷却里 `ensureInfoPortal()` 返回的 false 是「没执行」而不是「失败」；
   旧链路把它当 failed → 可能触发登出（b18 真机的假失败）。本组钉死：只读标注一次性消费、
   只有冷却分支置位、failed+cooldown 必须改判 skipped/cooldown。 */
const guardSrc = readFileSync("apps/desktop/src/lib/libSessionGuard.ts", "utf8");
const infoSrc = readFileSync("apps/desktop/src/lib/infoLib.ts", "utf8");
ok(/export function notePortalSkipReason/.test(guardSrc) && /export function consumePortalSkipReason/.test(guardSrc), "没有门户冷却的只读标注（note/consume）");
const consumeIdx = guardSrc.indexOf("export function consumePortalSkipReason");
const consumeBody = consumeIdx < 0 ? "" : guardSrc.slice(consumeIdx, guardSrc.indexOf("}", consumeIdx) + 1);
ok(/lastPortalSkipReason = null/.test(consumeBody), "标注不是一次性消费（读后不清会泄漏到下一次调用）");
ok((infoSrc.match(/notePortalSkipReason\("cooldown"\)/g) || []).length === 1, "置位冷却标注的位置不是恰好一处（只许冷却分支置位）");
ok(/notePortalSkipReason\(null\)/.test(infoSrc), "判活入口没有先清标注（上一次的冷却标注会污染本次）");
ok(/consumePortalSkipReason\(\)/.test(infoSrc) && /r\.state === "failed" && skip === "cooldown"/.test(infoSrc), "failed+cooldown 没有改判 skipped/cooldown（假失败仍会触发登出）");
ok(/return \{ state: "skipped", reason: "cooldown" \};/.test(infoSrc), "没有真正返回 skipped/cooldown");
if (fails.length) {
  console.log("静默重登护栏不通过：\n" + fails.map((f) => "  ✗ " + f).join("\n"));
  process.exit(1);
}
console.log(
  "静默重登护栏（b16 收窄版）：默认关不调用 ✓ 开关读写一致 ✓ 单飞（3 并发 1 次）✓ " +
    "30s 限流 + 2 的幂退避封顶 10min ✓ 凭据不进日志 ✓ dev 钩子一次性且只在 DevPanel ✓ " +
    "transport 复原（无 withAutoRelogin/siteOfUrl）✓ 站点映射与启动接线已撤 ✓ 本轮未接真实链路 ✓ " +
    "设置页开关与清除入口在位 ✓\n" +
    "F3 三修护栏（①②⑤）：① alive→按站点补建（learn/card/seat/libroom/zhjw 接既有入口、并发只重建一次、认不出不猜）✓ " +
    "② info 域本人校验（XSRF-only 不判活、拿不到结论必 fail、抖动只重试一次、LIB-CRED 未命中留痕）✓ " +
    "⑤ 守卫前置（五入口并发穿透 1 次）+ 封顶 120s + 手动清零 ✓\n" +
    "F3 ③④ 护栏（b17）：③ 判据复用既有集合（文案与 core isAuthError 同值、登录页四条全中、普通 200 不中）✓ " +
    "命中→一次重登+一次重放、再失败交回原错误、并发只重登一次、认不出站点不重登 ✓ " +
    "core #looksLoggedOut/自动重放与 http.onAuthRequired 已删、传输层无第二套调度 ✓ " +
    "④ LIB-JAR 旁证只留前 12 位、播种/回写/setPlatformClearCookies 未动 ✓\n" +
    "F3 A/B 护栏（b18）：A 真实域优先 + 证据驱动路径特征兜底（真机 403 样本 /b/kc/ → learn；" +
    "选课 zhjwxk /xkBks.·/js.vjsKcbBs.do·/jhBks.·/xklogin.do 与 zhjw.cic /portal3rd.do·/jxmh_out.do → zhjw；" +
    "认不出仍空集；站点来源只剩「该次请求自身落点」）✓ " +
    "B 站点空集兜底（登录链 200 登录页 / 交互登录中 → 0 次；UI 自认为已登录 → 立刻一次性全链恢复；" +
    "登录页 + 有登录信息 → 窗内连续 3 次；并发只 1 次、失败不重试风暴、共享单飞与 30s/120s 冷却不变）✓\n" +
    "F3 P0 三态护栏（b19）：done/failed/skipped 三态（真成功 done、真失败 failed、冷却窗内与链内再入 " +
    "skipped 且任务执行 0 次、skipped 同步返回不 await 自身不自锁、cooldown:false 站点键不受冷却影响、" +
    "旧布尔薄封装语义不变）✓ data.ts 三处 P0（只有 failed 才 backToLogin、skipped 原地留可重试错误条、" +
    "SOFT-RELOGIN/SOFT-RECOVER 日志带 state/reason）✓\n" +
    "F3 P0 收口护栏（b20）：① 止血——今日新闻源退避纯函数（attempt=0 零延迟、3s×2^(n-1) 递增、封顶 60s、" +
    "成功复位、单串上限 6 有界）✓ data.ts 单飞表（同 feedKey 同一时刻一份请求）+ 退避接线 + 失败日志按" +
    "失败串去重 + load 不再依赖 data（紧环根因）✓ 今日校历原始值与派生节点分键缓存、形状日志搬进 effect " +
    "且每种形状只写一次（渲染期不再写日志）✓ ② 判据 C——skipped/reentrant + pending 在守卫之外结算真结果" +
    "（pending 结算 failed → 页面层 backToLogin；done → 重取一次；cooldown / 缺 pending 绝不 await、绝不登出；" +
    "守卫内部无 await pending）✓\n" +
    "F3 ④ 两仓护栏（b21）：原生→JS 回灌挂在「响应真的带 Set-Cookie」上（无 Set-Cookie 0 次、" +
    "非基础设施票不碰、裸行归一化、同值幂等）✓ JS→原生仍只走两个既有播种口（learn 专线 + 共用 http 实例）" +
    "且基础设施票绝不播种 ✓ 单调保护（新票覆盖旧票、旧票回放一律拒收、冷启以水合旧值为退役基线）✓ " +
    "setPlatformClearCookies 真正实现（两仓全清只在显式登出分支、登录前只清 id/oauth 域、登录链路不许置全清标记）✓ " +
    "transport.ts 仍不含单飞/冷却调度状态 ✓\n" +
    "F3 P1 三态护栏（b22）：nativeFetch 恢复钩子（同步判定、绝不 await 在飞链——链内再入 reentrant 时链照常结算，" +
    "看门狗实测不自锁；done → 重放一次；failed → 不重放、交回原错误；skipped/cooldown → 不重放、任务 0 次、" +
    "交回原错误，日志写「被冷却判掉」而非「重登失败」；普通成功路径 0 恢复 0 重放）✓ renewer 桥（reentrant 结算 " +
    "done → core 不抛 AuthRequiredError；cooldown → " +
    "绝不交出 false、core 走自己的有界重试一次；failed → 原样抛回第一个错误；packages/core 的 setRenewers 与 " +
    "renewer 字段类型/签名未变、core 侧无桥内标识符）✓ tabStates（skipped → 0 次错误条、failed → 1 次、只有 " +
    "done 才经既有 retry 自动重拉；消费三态出口 softRecoverResult + 守卫外 settleLibSoftPending）✓\n" +
    "F3 P2/看门狗/可选组三态护栏（b23）：P2 七处布尔出口（xk-boot / xk-level / xk-core / xk-queue / " +
    "calendar / weeksched / exams）逐处「三态出口 → skipped 先 return/continue → 失败表现在其后」，" +
    "skipped（cooldown 与 reentrant 两支）不落错误条 / 空数组 / 失败 toast，failed 保留既有失败表现，" +
    "done 保留既有原地重取；reentrant+pending 由链外观察者结算真结果（done→重取、failed→失败表现）；" +
    "`:1933` toast 只在真 done（rebuilt）时才宣称「登录状态已自动重建」✓ 全局失登看门狗消费 " +
    "softRecoverResult(\"global\")、只有 failed 进失败结算、绝不 await 在飞链、五份源码无布尔 softRecover 消费点 ✓ " +
    "可选组 Schedule / DormTab / LibraryTab（5 处）/ LibRoomTab（3 处）同句式（skipped 分支先 return，" +
    "失败表现让其先过；既有 forceEnsure / 4.2s 自动重试调用次数不变）✓\n" +
    "F3 登录体验打磨护栏（b25）：㉓-1 data.ts 每个 backToLogin() 的最近判定都是 failed 三态支" +
    "（判定器自带「catch 直连 backToLogin」反例夹具）✓ ㉓-2 W1 useSemesters 两跳（relearn → " +
    "softRecover(\"semesters\")）/ W2 useLearnData 第二跳（softRecover(\"learn\")）逐条真值表：" +
    "done→重走、failed→登出、skipped（cooldown/reentrant）→原地可重试提示条不登出，scope 唯一 ✓ " +
    "㉓-3 W3 XK-SEARCH auth 失败消费三态出口（done→重跑搜索 / failed→既有失败表现 / " +
    "skipped→XK-SEARCH-AUTH-PENDING + RELOGIN_PENDING_NOTE），绝不 backToLogin、非 auth 失败走既有路径 ✓ " +
    "㉓-4 文案：Settings 用户可见代码零「会话/凭据」，雨课堂提示与「记住密码」说明改「登录状态」口径；" +
    "ui-copy-lint 扫描面覆盖带插值模板串 / notify 实参 / 独占行 JSX 文本（改前红→改后绿）✓ " +
    "㉓-5 显示层净化：core 的 raw 错误原文（会话/凭据/Cookie）统一在唯一出口 userCopy 换用户口径，" +
    "网络超时等真实网络诊断原样保留；设置页 6 处 + 作业页 + 邮件错误条的上屏位置逐个过 userCopy ✓ " +
    "㉓-6 W5 定时器收紧：madmodel 快速重试按连续失败指数退避（首次 60s → 5 分钟封顶，判校内/拿到登录信息即复位），" +
    "10 分钟巡检泵与对话前按需 preflight 的新鲜度语义不变（真机静置实测旧实现每 60s 一轮 3 跳请求 + 4 行日志）✓ " +
    "F3 流畅度治理护栏（b26）：㉔-1 选课页 THUbook 索引的空闲预热（requestIdleCallback + 3s 超时兜底 + " +
    "无 idle 宿主退化为定时器、幂等、只在本地缓存仍新鲜时预热 = 零新增网络、缓存过期仍走页面自己的 " +
    "SWR 抓取、启动路径接线）✓ ㉔-2 core 残余「超时」原文逐条收口（等待扫码超时 → 暂未收到扫码，请重新获取二维码；" +
    "登录超时/登陆超时 → 登录状态已失效），真实网络诊断（网络超时 / 请求超时 / 服务端处理超时）原样保留、幂等 ✓ " +
    "㉔-3 新上屏点（扫码弹窗两处错误行、设置页雨课堂括号原因）全过 userCopy；ui-copy-lint R1 新增「超时」" +
    "（改前红 → 改后绿，插件作者向文案按既有 allow 机制逐条豁免）✓\n" +
    "F3 登录代次 + 冷却自动重试护栏（b31）：㉕-1 代次纯模块（0 起、单调 +1、可复位）✓ " +
    "㉕-2 冷却态自动重试 plan（上限 3 / 间隔=冷却剩余+抖动 / 已有定时器共用 / 在飞不叠加 / 用尽 exhausted）✓ " +
    "㉕-3 运行期闸门（同 epoch 一个定时器多等待者、到点各跑一次、AUTO-RECOVER 每 epoch 至多一条、epoch 变化重置、卸载回收）✓ " +
    "㉕-4 campus / learn / semesters 三处（发起捕获代次 + 每个结算点陈旧守卫 + skipped/cooldown 安排自动重试 + " +
    "警示只在 exhausted 之后 + 仍只有真 failed 才 backToLogin）✓ ㉕-5 app.tsx 四出口自增 + useApp 暴露 authEpoch ✓ " +
    "㉕-6 重试按钮先 await 清冷却再 onRetry（置忙防连点）✓ ㉕-7 链外结算铁律只经 settleLibSoftPending、绝不 await pending ✓ " +
    "㉕-8 同时吃 lib 冷却剩余与 relearn 20s 节流剩余（不许空转烧次数）✓\n" +
     "F3 第三条路径护栏（b33）：㉓-1 登出判定器扩充（failed 支 + b33 存活复核闸门都判绿，只凭复核登出判红）✓ " +
     "㉖-1 只读时间戳只在真 done 写、failed 绝不写（libSoftLastDoneAtMs 只读口在位）✓ " +
     "㉖-2 存活判据真值表（done-after-start / 宽限窗 10s 含边界 / 在飞 / none 真死，旧成功不许冒充新证据）✓ " +
     "㉖-3 双侧断言（A：有存活证据或在飞 → 绝不登出、有限次重跑；B：真死或用尽 3 次 → 必须如实落登录页）✓ " +
     "㉖ 三处加载路径结构（doneAtStart 基线 + failed 支「存活复核 → 有限次重跑 → 才 backToLogin」+ 重跑传 recoveryInFlight:false）✓\n" +
     "㉖-4 真死侧（b36，b33 遗留）：verdict=none 必有一条 LIB-AUTH-DEAD、每 epoch 至多一条（计数式闸门、epoch 变化重置），" +
     "行内只有 verdict/scope/hits（不含 URL / 查询串 / 票值 / 凭据）✓\n" +
     "F3 ④ 两条旁枝护栏（b35）：㉗-1 主动核对计划（空快照 0 计划、原生有 JS 缺 → 1 条按物理域归一化回灌、" +
     "同值 0 写、JS 有但不同 → 新值上位、旧值回放拒收、基础设施票只回灌不反播且键收窄 Path=/、" +
     "非基础设施票保留原生路径、键大小写归一）✓ ㉗-2 执行器（同触发器每会话最多真跑一次、" +
     "第二次 skipped 不 dump 不写不刷日志、并发重入只跑一次、同值 0 写、恰一行计数日志不含票值、" +
     "dump 失败不抛返回 failed 且 0 写、日志口抛错不影响主链）✓ ㉗-3 结构（核对只写 JS jar 的 setRaw、" +
     "反播口零出现、1 处定义 + 3 处挂点且触发器只有 login/boot、冷启核对在水合基线之后、" +
     "只读 dump 打到 http_native_cookie_dump 且不改原生仓状态）✓ ㉗ 旁枝 (ii) 查证与落地" +
     "（原生落盘改用 cookie_store serde JSON 保真 host-only、不再读原始 Domain= 属性、写前建目录、" +
     "写失败不清 dirty；清仓两命令与 clear() 置 dirty 语义一行未动——b21 红线）✓\n" +
     "F3 触发面唯一 + 真死侧日志护栏（b36）：㉘ 口径 1——判定入口唯一（transport.ts 里 withLibAuthRecovery 只 1 处）✓ " +
     "两条原生通道都经它（nativeFetch / tauriFetch；universalFetch 的 Tauri 分支落到受判定的 tauriFetch）✓ " +
     "两个单次请求原语不含判定、互不调用、保持私有 ⇒ 不双重包装 ✓ 原始 invoker invokeHttp 未导出、恢复动作只有一个调用点、" +
     "两通道共用同一钩子单例（同一把共享单飞）✓ 行为：一次失效 = 恰好一次判定 + 一次重登 + 一次重放，正常 200 = 一次判定 0 恢复，" +
     "两通道并发同一失效真重登仍只一次 ✓\n" +
     "F3 判定域限缩护栏（b38）：㉙-1 外部域一律不进 ③ 判定（拓课 ai.tuoj.thusaac.com / market api.github.com / " +
     "雨课堂 pro.yuketang.cn / thubook.help / trace restapi.amap.com / tsinghua.app / 洗衣机外部域逐个为证；近似域 eviltsinghua.edu.cn、" +
     "后缀伪装域、空值与畸形 URL 都不算）✓ ㉙-2 清华 / WebVPN 域照旧进判定（learn/info/seat.lib/cab.lib/card/zhjwxk.cic/zhjw.cic/" +
     "id/oauth/madmodel/app.cs/mails/myhome/dzpj + webvpn 包装 URL 逐个为证）✓ ㉙-3 域名单同源（域基与 transport.ts 域分流判据逐字相等、" +
     "sitesOfLostHost 五域机械提取后全落判据内、core WEBVPN_ROOT 落判据内、判据本体无字面域名）✓ " +
     "㉙-4 判定入口仍唯一（withLibAuthRecovery 全仓只 transport.ts 一处调用）✓ ㉙-5 域闸挂在唯一入口最前面、" +
     "域外只执行原语一次、不判不恢复、判据来自共享模块 libSessionGuard ✓",
);
