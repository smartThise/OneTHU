/**
 * TUOJ R23 修复回归测试（霖实测两条）：
 *
 * ③ 自动重登失效：会话过夜老化时 TUOJ 返回 200 + 非 JSON（登录页 HTML），
 *    此前抛普通 Error → `isTuojSessionError` 不命中 → 自动重漫游（rerouteTuoj）不触发，
 *    用户只能手动退出重登。修复：非 JSON 归一为 TuojSessionError。
 *    配套：exthw.ts 启动续期（tuojStartupRenewed，静态断言钉住）。
 * ④ 点旧作业被导向最新作业：TUOJ 官方 SPA 对无子路径的 /contest/{tid} 回落到最新
 *    contest；条目自带 URL 必须带 /home 后缀才能正确落位。
 *
 * 跑法：node tools/tuoj-r23-test.mjs（需要 Node ≥ 22.15 的 module.registerHooks）
 */
import * as nodeModule from "node:module";
import { readFileSync } from "node:fs";

if (typeof nodeModule.registerHooks !== "function") {
  console.log(`本脚本需要 Node ≥ 22.15（module.registerHooks）以把 .js 直引重解析到 .ts；当前 ${process.version}，跳过。`);
  process.exit(0);
}

nodeModule.registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "sm-crypto") {
      return {
        url: "data:text/javascript,export const sm2={};export const sm3={};export const sm4={};",
        shortCircuit: true,
      };
    }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && specifier.endsWith(".js")) {
      const p = new URL(specifier, context.parentURL).href.replace(/\.js$/, ".ts");
      return { url: p, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { createTuojSource, isTuojSessionError, BASE } = await import("../packages/core/src/exthw/tuoj.ts");

let pass = 0, fail = 0;
const eq = (name, a, b) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.error(`✗ ${name}: 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); }
};
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${name}${extra !== undefined ? `：${extra}` : ""}`); }
};

const DAY = 86400000;

function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push(String(url));
    for (const r of routes) {
      if (r.match(url, init)) {
        return {
          status: r.status ?? 200,
          finalUrl: r.finalUrl ?? url,
          headers: new Map(),
          text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})),
        };
      }
    }
    return { status: 404, finalUrl: url, headers: new Map(), text: async () => "{}" };
  };
  fn.calls = calls;
  return fn;
}

const COURSE_LIST = { courses: [{ _id: "8", title: "算法训练" }] };
const RANK = { courseRank: { contests: [{ _id: "83", title: "homework1" }] } };
const CONTEXT = {
  data: {
    context: {
      metadata: { title: "homework1" },
      schedule: { effectiveEndAt: Date.now() + 3 * DAY },
    },
  },
};
const RANKLIST = { ranklist: { players: [] } };

/* ── ④ 条目 URL 带 /home 后缀（官方 SPA 对裸 /contest/{tid} 回落最新 contest）── */
{
  const fetchLike = makeFetch([
    { match: (u) => u.endsWith("/api/course/list"), body: COURSE_LIST },
    { match: (u) => u.endsWith("/api/user/lookup"), body: { user: { _id: "u1", username: "2020010100" } } },
    { match: (u) => u.endsWith("/course/8/rank"), body: RANK },
    { match: (u) => u.includes("/contest/83/context"), body: CONTEXT },
    { match: (u) => u.includes("/contest/83/ranklist"), body: RANKLIST },
  ]);
  const src = createTuojSource({ cookie: "" }, fetchLike, 30);
  const items = await src.fetch();
  eq("拉到 1 条作业", items.length, 1);
  eq(
    "R23-④ 条目 URL 带 /home（裸 /contest/{tid} 会被官方页导向最新 contest）",
    items[0]?.url,
    `${BASE}/course/8/contest/83/home`,
  );
  ok("R23-④ 条目 id 不变（tuoj-8-83）", items[0]?.id === "tuoj-8-83", items[0]?.id);
}

/* ── ③ 会话老化返回 200 + 非 JSON → TuojSessionError（触发自动重漫游） ── */
{
  const fetchLike = makeFetch([
    { match: (u) => u.endsWith("/api/course/list"), body: "<html>请先登录</html>" },
  ]);
  const src = createTuojSource({ cookie: "" }, fetchLike, 30);
  let err = null;
  try {
    await src.fetch();
  } catch (e) {
    err = e;
  }
  ok("R23-③ 200+非 JSON 必须抛错（不能静默空列表）", err !== null);
  ok("R23-③ 非 JSON 归一为 TuojSessionError", isTuojSessionError(err), err?.constructor?.name);
  ok(
    "R23-③ 错误文案含「重新登录」引导",
    err instanceof Error && err.message.includes("重新登录"),
    err?.message,
  );
}

/* ── ③ 配套：启动续期标记在 exthw.ts 在场（静态护栏） ── */
{
  const src = readFileSync(new URL("../apps/desktop/src/state/exthw.ts", import.meta.url), "utf8");
  ok("R23-③ 启动续期标记（tuojStartupRenewed）在 refreshExtHw 生效", /tuojStartupRenewed/.test(src));
  ok(
    "R23-③ 启动续期走 force + relaxThrottle（绕过 24h 频控，尊重显式退出抑制）",
    /maybeAutoTuojCas\(s, \{ force: true, relaxThrottle: true \}\)/.test(src),
  );
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
