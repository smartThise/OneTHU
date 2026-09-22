/**
 * 三源「提交状态」判定单测（离线，mock 响应，不打真实平台）。
 *
 * 运行：node tools/exthw-status-test.mjs
 * 覆盖：
 *  - 雨课堂作业（type 19）：answer_count>0 / my_answer.content 非空 → 已提交；空壳 → 保守未提交
 *  - 雨课堂试卷（type 20）：/v/exam/cover 的 result.unfinished_count<problem_count → 已提交；
 *    result 缺失 / 请求失败 → 保守未提交
 *  - TUOJ：ranklist 里按 _id/username 找到自己且 details 非空 → 已提交；找不到 / details 空 → 未提交
 *  - Tyche：task/Status（不带 all=true）submissionCount>0 → 已提交；0 / 报错 → 未提交
 *  - R19 27.2：Tyche「已批改」判定——submissionList 按 pid 分组取 submitedTime 最新
 *    （并列取 sid 最大），每个 pid 最新提交都有数字 score 且 result 非 0/1（判题中保守排除）
 *    → graded=true；score=Σ 各 pid 最新分、totalScore=100×pid 数，仅 graded 时透出
 *  - 附带校验：雨课堂状态请求带 XTBZ: ykt；TUOJ lookup 用 POST
 *  - R19 27.1：TUOJ 会话失效自动重漫游——401 → force 重漫游一次 → 重拉成功（R12 ①-④）；
 *    同源并发 401 in-flight 去重只漫游一次；进程级频控放宽（同源两次 ≥10min、每源每进程
 *    ≤3 次、AI 版 / 经典版独立计数）；失败文案「已尝试自动重新登录，仍失败：<原因>」
 *  - R21-A：Tyche 会话失效静默自动重登——status=login / 401 / 非 JSON（跳登录页）统一
 *    TycheSessionError（含 task/Status 内层冒泡）；reloginTyche 钩子 → 静默重登一次 →
 *    自动重拉（新 Cookie 生效）；同源并发失效 in-flight 去重；进程级频控（同源 ≥10min、
 *    每源每进程 ≤3 次，与 TUOJ 独立计数）；重登仍失败文案同款前缀；非会话错误 / 未注入
 *    钩子不重登；tycheLogin 登录链路（挑战 token / sha1 双哈希 / vcode 拒绝 / 错误映射）
 *  - R21-B：雨课堂会话失效归一（401/403、errcode=401000、code=50000、非 JSON 四特征 →
 *    YktSessionError；网络断不误判）；checkSession 健康检查（有效含归属人 / 各失效原因 /
 *    网络断 alive=null 不谎报）；Cookie 轮换捕获回写（x-onethu-set-cookie 白名单合并、
 *    后续请求即用新值、无轮换零回调）；Cookie 导出/导入往返与各类拒绝；
 *    refreshExternalHomework 对 yuketang 失效不做静默重登（无自动重登路径）
 */
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";
import { createTuojSource, CLASSIC_BASE as TUOJ_CLASSIC_BASE } from "../packages/core/src/exthw/tuoj.ts";
import { createTycheSource } from "../packages/core/src/exthw/tyche.ts";
import { createDsaSource, parseDsaDate, DsaSessionError, isDsaSessionError } from "../packages/core/src/exthw/dsa.ts";
import { SOURCE_NAMES } from "../packages/core/src/exthw/types.ts";
import * as nodeModule from "node:module";

/* R12 17.1：编排层 `exthw/index.ts` 内部用 `.js` 相对导入（TS bundler 解析），
 * Node 直引需经 registerHooks 重解析到 `.ts`（与 tools/tuoj-cas-test.mjs 同款）。
 * 静态 import 在本文件加载时已解析完毕，故编排层用动态 import（见文末）。 */
const canResolveTs = typeof nodeModule.registerHooks === "function";
if (canResolveTs) {
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
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
}

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${msg}`);
  } else {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/** 构造一个按 URL 路由的 mock fetchLike；记录每次请求 {url, method, headers, body}。
 *  R15：`match` 第三参拿到请求体（DSA 同一 URL 按 action 分流）。 */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    const body = typeof init.body === "string" ? init.body : "";
    calls.push({ url, method, headers, body });
    for (const r of routes) {
      if (r.match(url, method, body)) {
        if (r.throw) throw new Error(r.throw);
        const status = r.status ?? 200;
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

const FUTURE = Date.now() + 5 * 86400000; // 5 天后（时间窗内）
const pad = (n) => String(n).padStart(2, "0");
const localDT = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
/** 外部源统一 DDL 口径 "YYYY-MM-DD HH:MM"（本地时区） */
const localMin = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ───────────────────────── 雨课堂 ───────────────────────── */
console.log("\n[雨课堂]");
{
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/v2/api/web/courses/list"),
      body: {
        errcode: 0,
        data: {
          list: [
            { classroom_id: 1, name: "线代", role: 5 },
            { classroom_id: 2, name: "线代-4", role: 6 },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/1"),
      body: {
        errcode: 0,
        data: {
          activities: [
            { type: 19, id: 10, title: "部分作答作业", classroom_id: 1, content: { leaf_type_id: 100, leaf_id: 5, score_d: FUTURE } },
            // R23：部分作答 ≠ 已提交 —— 无明细（problems 空）时 answer_count>0 保守算已交
            { type: 19, id: 27, title: "无明细已交作业", classroom_id: 1, content: { leaf_type_id: 110, leaf_id: 27, score_d: FUTURE } },
            { type: 19, id: 11, title: "未交作业", classroom_id: 1, content: { leaf_type_id: 101, leaf_id: 6, score_d: FUTURE } },
            { type: 19, id: 19, title: "已批改作业", classroom_id: 1, content: { leaf_type_id: 102, leaf_id: 20, sku_id: 950, score_d: FUTURE } },
            { type: 19, id: 20, title: "已交未批作业", classroom_id: 1, content: { leaf_type_id: 103, leaf_id: 21, sku_id: 951, score_d: FUTURE } },
            { type: 19, id: 21, title: "混合批改作业", classroom_id: 1, content: { leaf_type_id: 104, leaf_id: 22, sku_id: 952, score_d: FUTURE } },
            { type: 19, id: 22, title: "缺 sku 作业", classroom_id: 1, content: { leaf_type_id: 105, leaf_id: 23, score_d: FUTURE } },
            { type: 19, id: 23, title: "缺 leaf 作业", classroom_id: 1, content: { leaf_type_id: 106, sku_id: 953, score_d: FUTURE } },
            // R20-B3：已批改作业分数（score = 已批题 my_score 合计 / totalScore = content.score 合计）
            { type: 19, id: 24, title: "零分已批改作业", classroom_id: 1, content: { leaf_type_id: 107, leaf_id: 24, sku_id: 954, score_d: FUTURE } },
            { type: 19, id: 25, title: "缺分已批改作业", classroom_id: 1, content: { leaf_type_id: 108, leaf_id: 25, sku_id: 955, score_d: FUTURE } },
            { type: 19, id: 26, title: "无满分已批改作业", classroom_id: 1, content: { leaf_type_id: 109, leaf_id: 26, sku_id: 956, score_d: FUTURE } },
            { type: 20, id: 12, title: "已交试卷", classroom_id: 1, content: { leaf_type_id: 200, leaf_id: 7, sku_id: 900, score_d: FUTURE } },
            { type: 20, id: 13, title: "未交试卷", classroom_id: 1, content: { leaf_type_id: 201, leaf_id: 8, sku_id: 901, score_d: FUTURE } },
            { type: 20, id: 14, title: "无 result 试卷", classroom_id: 1, content: { leaf_type_id: 202, leaf_id: 9, sku_id: 902, score_d: FUTURE } },
            { type: 20, id: 15, title: "状态报错试卷", classroom_id: 1, content: { leaf_type_id: 203, leaf_id: 10, sku_id: 903, score_d: FUTURE } },
            { type: 20, id: 16, title: "未出分试卷", classroom_id: 1, content: { leaf_type_id: 204, leaf_id: 11, sku_id: 904, score_d: FUTURE } },
            { type: 20, id: 17, title: "缺满分试卷", classroom_id: 1, content: { leaf_type_id: 205, leaf_id: 12, sku_id: 905, score_d: FUTURE } },
            { type: 20, id: 18, title: "零分已出分试卷", classroom_id: 1, content: { leaf_type_id: 206, leaf_id: 13, sku_id: 906, score_d: FUTURE } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/2"),
      body: {
        errcode: 0,
        data: {
          activities: [
            { type: 19, id: 20, title: "旁听作业", classroom_id: 2, content: { leaf_type_id: 300, leaf_id: 14, score_d: FUTURE } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/get_exercise_list/100/"),
      body: { data: { answer_count: 3, problems: [{ user: { my_answer: { content: "<p>x</p>" } } }, { user: { my_answer: { content: "" } } }] } },
    },
    { match: (u) => u.includes("/get_exercise_list/101/"), body: { data: { answer_count: 0, problems: [{ user: { my_answer: { content: "" } } }, { user: { my_answer: {} } }] } } },
    { match: (u) => u.includes("/get_exercise_list/110/"), body: { data: { answer_count: 2, problems: [] } } },
    { match: (u) => u.includes("/get_exercise_list/300/"), body: { data: { answer_count: 1, problems: [{ user: { my_answer: { content: "<p>y</p>" } } }] } } },
    // R16 21.1：已批改三态（status 4 + 真实分 = 已批改；status 3 / my_score -1 占位 = 已交未批；无 user = 未交）
    // R20-B3：题面分值 content.score 同响应可得（score 合计 / 满分合计的映射输入）
    {
      match: (u) => u.includes("/get_exercise_list/102/"),
      body: {
        data: {
          answer_count: 2,
          problems: [
            { content: { score: 20 }, user: { status: 4, my_score: "30.00", comment: "很好", my_answer: { content: "<p>a</p>" } } },
            { content: { score: 20 }, user: { status: 4, my_score: "0.00", my_answer: { content: "<p>b</p>" } } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/get_exercise_list/103/"),
      body: {
        data: {
          answer_count: 2,
          problems: [
            { content: { score: 20 }, user: { status: 3, my_score: "-1.00", my_answer: { content: "<p>a</p>" } } },
            { content: { score: 20 }, user: { status: 3, my_score: -1, my_answer: { content: "<p>b</p>" } } },
          ],
        },
      },
    },
    {
      // 混合：一题已批改（status 4）+ 一题已作答未批改（status 3）→ 保守不判已批改
      match: (u) => u.includes("/get_exercise_list/104/"),
      body: {
        data: {
          answer_count: 2,
          problems: [
            { content: { score: 15 }, user: { status: 4, my_score: "30.00", my_answer: { content: "<p>a</p>" } } },
            { content: { score: 15 }, user: { status: 3, my_score: "-1.00", my_answer: { content: "<p>b</p>" } } },
          ],
        },
      },
    },
    { match: (u) => u.includes("/get_exercise_list/105/"), body: { data: { answer_count: 0, problems: [{ user: { my_answer: {} } }] } } },
    { match: (u) => u.includes("/get_exercise_list/106/"), body: { data: { answer_count: 0, problems: [{ user: { my_answer: {} } }] } } },
    // R20-B3：分数映射边界 —— 真实 0 分 / 无一题有有效分 / 题面分值缺失
    {
      match: (u) => u.includes("/get_exercise_list/107/"),
      body: {
        data: {
          answer_count: 2,
          problems: [
            { content: { score: 10 }, user: { status: 4, my_score: "0.00", my_answer: { content: "<p>a</p>" } } },
            { content: { score: 10 }, user: { status: 4, my_score: 0, my_answer: { content: "<p>b</p>" } } },
          ],
        },
      },
    },
    {
      match: (u) => u.includes("/get_exercise_list/108/"),
      body: {
        data: {
          answer_count: 1,
          problems: [{ content: { score: 10 }, user: { status: 4, my_answer: { content: "<p>a</p>" } } }],
        },
      },
    },
    {
      match: (u) => u.includes("/get_exercise_list/109/"),
      body: {
        data: {
          answer_count: 1,
          problems: [{ user: { status: 4, my_score: 8, my_answer: { content: "<p>a</p>" } } }],
        },
      },
    },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=200"), body: { data: { problem_count: 20, total_score: 100, result: { status: 5, unfinished_count: 0, score: 60, score_finish: true } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=201"), body: { data: { problem_count: 31, total_score: 100, result: { status: 6, unfinished_count: 31, score: 0, score_finish: true } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=202"), body: { data: { problem_count: 10, total_score: 100, result: null } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=203"), throw: "boom" },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=204"), body: { data: { problem_count: 10, total_score: 100, result: { status: 5, unfinished_count: 0, score: 60, score_finish: false } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=205"), body: { data: { problem_count: 10, result: { status: 5, unfinished_count: 0, score: 60, score_finish: true } } } },
    { match: (u) => u.includes("/v/exam/cover") && u.includes("exam_id=206"), body: { data: { problem_count: 10, total_score: 100, result: { status: 5, unfinished_count: 0, score: 0, score_finish: true } } } },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 19, "拉到 19 条作业");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  // R23：部分作答 ≠ 已提交（霖实测：只交一道题被记为已交）——进行中，报进度
  eq(byTitle.get("部分作答作业")?.submitted, false, "R23：2 题只答 1 题 → 未提交（进行中）");
  eq(byTitle.get("部分作答作业")?.submittedCount, 1, "部分作答作业 submittedCount=1（有内容的题目数）");
  eq(byTitle.get("部分作答作业")?.totalCount, 2, "部分作答作业 totalCount=2");
  eq(byTitle.get("无明细已交作业")?.submitted, true, "R23：无题目明细时 answer_count>0 保守算已提交");
  eq(byTitle.get("无明细已交作业")?.submittedCount, 2, "无明细已交作业 submittedCount=2（回落 answer_count）");
  eq(byTitle.get("无明细已交作业")?.totalCount, undefined, "无明细已交作业 totalCount 缺省");
  eq(byTitle.get("未交作业")?.submitted, false, "answer_count=0 且无作答 → 未提交");
  // R16 21.1：graded 三态（status 4=已批改 / status 3=已交未批 / 无 user=未交）
  eq(byTitle.get("已批改作业")?.graded, true, "status=4 + 真实分 → graded=true");
  eq(byTitle.get("已批改作业")?.submitted, true, "已批改作业仍属已提交");
  eq(byTitle.get("已交未批作业")?.submitted, true, "status=3 → 已提交");
  eq(byTitle.get("已交未批作业")?.graded, false, "status=3 + my_score=-1（含数字 -1）→ graded=false");
  eq(byTitle.get("混合批改作业")?.graded, false, "混合场景（有已作答未批改题）→ 保守 graded=false");
  eq(byTitle.get("未交作业")?.graded, false, "无 user（未交）→ graded=false");
  // R20-B3：已批改作业分数（对齐考试口径：已提交且带分 → 入口显示「已批改 · 30/40」）
  eq(byTitle.get("已批改作业")?.score, 30, "已批改作业 score=30（status4 真实分合计 30+0，含真实 0 分）");
  eq(byTitle.get("已批改作业")?.totalScore, 40, "已批改作业 totalScore=40（题面 content.score 合计）");
  eq(byTitle.get("零分已批改作业")?.graded, true, "全 0 分且 status4 → graded=true（0 分是真实结果非占位）");
  eq(byTitle.get("零分已批改作业")?.score, 0, "真实 0 分 → score=0 照实透出");
  eq(byTitle.get("零分已批改作业")?.totalScore, 20, "真实 0 分 → totalScore=20 照设（显示「0/20」）");
  eq(byTitle.get("缺分已批改作业")?.graded, true, "status4 但 my_score 缺失 → 不判「未批改」（保守 graded=true）");
  eq(byTitle.get("缺分已批改作业")?.score, undefined, "无一题有有效分 → 不设 score（缺数据不谎报 0 分）");
  eq(byTitle.get("无满分已批改作业")?.score, 8, "题面 content.score 缺失 → 仍透出 score（入口显示裸分数）");
  eq(byTitle.get("无满分已批改作业")?.totalScore, undefined, "题面分值全缺失 → 不设 totalScore（满分合计为 0 不给）");
  eq(byTitle.get("已交未批作业")?.score, undefined, "未批改 → 不设 score（未批改不显示）");
  eq(byTitle.get("混合批改作业")?.score, undefined, "混合批改（graded=false）→ 即使单题有分也不设 score");
  eq(byTitle.get("已交作业")?.score, undefined, "已提交无批改信息 → 不设 score");
  // R16b：作业/试卷学生端深链（ai-workspace lms-graph），仅需 leaf_id；缺 leaf_id 回退旧课程日志页
  eq(
    byTitle.get("已批改作业")?.url,
    "https://pro.yuketang.cn/ai-workspace/lms-graph/1/exercise/20?is_chapter=1",
    "作业直链 = /ai-workspace/lms-graph/{cid}/exercise/{leaf_id}",
  );
  eq(
    byTitle.get("已交试卷")?.url,
    "https://pro.yuketang.cn/ai-workspace/lms-graph/1/quiz/7?is_chapter=1",
    "试卷直链 = /ai-workspace/lms-graph/{cid}/quiz/{leaf_id}",
  );
  eq(
    byTitle.get("缺 sku 作业")?.url,
    "https://pro.yuketang.cn/ai-workspace/lms-graph/1/exercise/23?is_chapter=1",
    "缺 sku_id 不影响深链（sku_id 不需要）",
  );
  eq(
    byTitle.get("缺 leaf 作业")?.url,
    "https://pro.yuketang.cn/v2/web/studentLog/1",
    "缺 leaf_id → 回退旧 studentLog 链接",
  );
  eq(byTitle.get("已交试卷")?.submitted, true, "试卷 result.unfinished_count<problem_count → 已提交");
  eq(byTitle.get("已交试卷")?.submittedCount, 20, "已交试卷 submittedCount=20（problem_count-unfinished_count）");
  eq(byTitle.get("已交试卷")?.totalCount, 20, "已交试卷 totalCount=20");
  eq(byTitle.get("未交试卷")?.submitted, false, "试卷 unfinished_count==problem_count → 未提交");
  eq(byTitle.get("未交试卷")?.totalCount, 31, "未交试卷 totalCount=31");
  eq(byTitle.get("无 result 试卷")?.submitted, false, "试卷 result 缺失/null → 保守未提交");
  eq(byTitle.get("状态报错试卷")?.submitted, false, "试卷状态请求失败 → 保守未提交");
  // R9：旁听标注（role=6 → audited，role=5/未知不标）
  eq(byTitle.get("旁听作业")?.audited, true, "role=6 课堂 → audited=true");
  eq(byTitle.get("旁听作业")?.submitted, true, "旁听作业照常判提交状态");
  eq(byTitle.get("已交作业")?.audited, undefined, "role=5 课堂 → 不标旁听");
  // R9：考试分数（仅已提交且已出分给 score/totalScore）
  eq(byTitle.get("已交试卷")?.score, 60, "已出分试卷 score=60");
  eq(byTitle.get("已交试卷")?.totalScore, 100, "已出分试卷 totalScore=100");
  eq(byTitle.get("未交试卷")?.score, undefined, "未提交试卷不设 score");
  eq(byTitle.get("未出分试卷")?.submitted, true, "未出分试卷仍按提交判定");
  eq(byTitle.get("未出分试卷")?.score, undefined, "score_finish=false → 不设 score");
  eq(byTitle.get("缺满分试卷")?.score, undefined, "缺 total_score → 不设 score");
  eq(byTitle.get("缺满分试卷")?.totalScore, undefined, "缺 total_score → 不设 totalScore");
  eq(byTitle.get("零分已出分试卷")?.score, 0, "score=0 且已出分 → 照实显示 0");
  eq(byTitle.get("零分已出分试卷")?.totalScore, 100, "score=0 且已出分 → totalScore=100");
  // R16 21.1：试卷 graded = 已提交且已出分（复用 R9 score 条件）
  eq(byTitle.get("已交试卷")?.graded, true, "已出分试卷 → graded=true");
  eq(byTitle.get("零分已出分试卷")?.graded, true, "0 分但已出分 → graded=true");
  eq(byTitle.get("未出分试卷")?.graded, false, "score_finish=false → graded=false");
  eq(byTitle.get("缺满分试卷")?.graded, false, "缺 total_score → graded=false");
  eq(byTitle.get("未交试卷")?.graded, false, "未提交试卷 → graded=false");
  eq(byTitle.get("无 result 试卷")?.graded, false, "result 缺失 → graded=false");
  const hwCalls = fetchLike.calls.filter((c) => c.url.includes("/get_exercise_list/"));
  eq(hwCalls.length, 12, "仅作业（type 19）走 get_exercise_list（12 份，分数与状态同一响应零额外请求）");
  ok(
    hwCalls.every((c) => c.headers["xtbz"] === "ykt"),
    "作业状态请求均带 XTBZ: ykt",
  );
  ok(
    hwCalls.every((c) => c.url.includes("classroom_id=") && c.url.includes("uv_id=")),
    "作业状态请求均带 classroom_id / uv_id",
  );
  const examCalls = fetchLike.calls.filter((c) => c.url.includes("/v/exam/cover"));
  eq(examCalls.length, 7, "试卷（type 20）走 /v/exam/cover");
  ok(
    examCalls.every((c) => c.headers["xtbz"] === "ykt"),
    "试卷状态请求均带 XTBZ: ykt",
  );
  ok(
    examCalls.every((c) => c.url.includes("exam_id=") && c.url.includes("classroom_id=") && c.url.includes("sku_id=")),
    "试卷状态请求均带 exam_id / classroom_id / sku_id",
  );
}

/* ───────────────────────── TUOJ ───────────────────────── */
console.log("\n[TUOJ]");
async function tuojCase(name, { me, players, expectSubmitted, expectDetailsLen }) {
  const fetchLike = makeFetch([
    { match: (u, m) => u.endsWith("/api/user/lookup") && m === "POST", body: me ?? {} },
    { match: (u) => u.endsWith("/api/course/list"), body: { courses: [{ _id: 8, title: "离散数学" }] } },
    { match: (u) => u.endsWith("/api/course/8/rank"), body: { courseRank: { contests: [{ _id: 83, title: "homework 1" }] } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/context"), body: { context: { metadata: { title: "homework 1" }, schedule: { endAt: FUTURE } } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/ranklist"), body: { ranklist: { players } } },
  ]);
  const src = createTuojSource({ cookie: "session=x" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 1, `${name}：拉到 1 条`);
  eq(items[0]?.submitted, expectSubmitted, `${name}：submitted`);
  if (expectDetailsLen !== undefined) eq(items[0]?.submittedCount, expectDetailsLen, `${name}：submittedCount`);
  ok(
    fetchLike.calls.some((c) => c.url.endsWith("/api/user/lookup") && c.method === "POST"),
    `${name}：lookup 用 POST`,
  );
}
await tuojCase("按 _id 命中且有提交", {
  me: { user: { _id: 1001, username: "2026000000" } },
  players: [
    { _id: 999, username: "other", details: { "0": { judgeId: 1 } } },
    { _id: 1001, username: "2026000000", details: { "0": { judgeId: 1 }, "1": { judgeId: 2 } } },
  ],
  expectSubmitted: true,
  expectDetailsLen: 2,
});
await tuojCase("命中但 details 为空", {
  me: { user: { _id: 1001, username: "2026000000" } },
  players: [{ _id: 1001, username: "2026000000", details: {} }],
  expectSubmitted: false,
});
await tuojCase("ranklist 里没有自己", {
  me: { user: { _id: 1001, username: "2026000000" } },
  players: [{ _id: 999, username: "other", details: { "0": { judgeId: 1 } } }],
  expectSubmitted: false,
});
await tuojCase("lookup 失败但按 username 命中", {
  me: {},
  players: [{ _id: 1001, username: "2026000000", details: { "0": { judgeId: 1 } } }],
  expectSubmitted: false, // 无 username 回退 → 找不到自己
});
{
  // 显式提供 fallback username 时应命中
  const fetchLike = makeFetch([
    { match: (u, m) => u.endsWith("/api/user/lookup") && m === "POST", body: {} },
    { match: (u) => u.endsWith("/api/course/list"), body: { courses: [{ _id: 8, title: "C" }] } },
    { match: (u) => u.endsWith("/api/course/8/rank"), body: { courseRank: { contests: [{ _id: 83 }] } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/context"), body: { context: { metadata: {}, schedule: { endAt: FUTURE } } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/ranklist"), body: { ranklist: { players: [{ _id: 1, username: "2026000000", details: { "0": {} } }] } } },
  ]);
  const src = createTuojSource({ cookie: "", username: "2026000000" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items[0]?.submitted, true, "lookup 失败但凭据 username 回退命中 → 已提交");
}

/* ───────────────────────── Tyche ───────────────────────── */
console.log("\n[Tyche]");
{
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/group/GroupList"), body: { groupList: [{ gid: 42, name: "程设" }] } },
    {
      match: (u) => u.includes("/group/ShowGroup?gid=42"),
      body: {
        group: {
          gid: 42,
          tasks: [
            { tid: 1406, title: "作业一", endTime: localDT(FUTURE) },
            { tid: 1407, title: "作业二", endTime: localDT(FUTURE) },
            { tid: 1408, title: "作业三（状态接口报错）", endTime: localDT(FUTURE) },
          ],
        },
      },
    },
    { match: (u) => u.includes("/task/Status?tid=1406&gid=42"), body: { submissionCount: 6, submissionList: [{ sid: 1 }, { sid: 2 }] } },
    { match: (u) => u.includes("/task/Status?tid=1407&gid=42"), body: { submissionCount: 0, submissionList: [] } },
    { match: (u) => u.includes("/task/Status?tid=1408&gid=42"), throw: "boom" },
  ]);
  const src = createTycheSource({ cookie: "JSESSIONID=x" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 3, "拉到 3 条作业");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  eq(byTitle.get("作业一")?.submitted, true, "submissionCount>0 → 已提交");
  eq(byTitle.get("作业一")?.submittedCount, 6, "submittedCount=6");
  eq(byTitle.get("作业一")?.graded, false, "submissionList 缺 pid/score → 保守 graded=false");
  eq(byTitle.get("作业二")?.submitted, false, "submissionCount=0 → 未提交");
  eq(byTitle.get("作业二")?.graded, false, "未提交 → graded=false");
  eq(byTitle.get("作业三（状态接口报错）")?.submitted, false, "状态接口报错 → 保守未提交");
  eq(byTitle.get("作业三（状态接口报错）")?.graded, false, "状态接口报错 → 保守 graded=false");
  const statusCalls = fetchLike.calls.filter((c) => c.url.includes("/task/Status?"));
  ok(
    statusCalls.every((c) => !c.url.includes("all=true")),
    "状态请求不带 all=true（只取本人提交）",
  );
}

/* ───────── R19 27.2：Tyche「已批改」判定（27.2b 字段定稿：pid/score/result/submitedTime/sid） ───────── */
console.log("\n[Tyche 已批改 R19 27.2]");
{
  /** 构造一条 Tyche 提交（字段名按 27.2b 实测） */
  const sub = (sid, pid, score, result = 2, submitedTime = "2026-09-19 20:31:05") => ({
    sid,
    pid,
    tid: 1500,
    gid: 42,
    uid: 2026,
    name: "lin",
    language: "C++",
    codeLength: 1024,
    time: 0,
    memory: 0,
    score,
    result,
    outdated: false,
    secret: 0,
    submitedTime,
  });
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/group/GroupList"), body: { groupList: [{ gid: 42, name: "程设" }] } },
    {
      match: (u) => u.includes("/group/ShowGroup?gid=42"),
      body: {
        group: {
          gid: 42,
          tasks: [
            { tid: 1500, title: "四题全过", endTime: localDT(FUTURE) },
            { tid: 1501, title: "同题多次提交", endTime: localDT(FUTURE) },
            { tid: 1502, title: "最新提交缺 score", endTime: localDT(FUTURE) },
            { tid: 1503, title: "判题中", endTime: localDT(FUTURE) },
            { tid: 1504, title: "无提交", endTime: localDT(FUTURE) },
          ],
        },
      },
    },
    // ① 4 个 pid 各 100 → graded=true score=400 totalScore=400（霖那份作业的形态）
    {
      match: (u) => u.includes("/task/Status?tid=1500&gid=42"),
      body: {
        status: "success",
        submissionCount: 4,
        submissionList: [sub(101, 9001, 100), sub(102, 9002, 100), sub(103, 9003, 100), sub(104, 9004, 100)],
      },
    },
    // ② 同 pid 多次提交取 submitedTime 最新（并列取 sid 最大）：只汇总最新一条的 score
    {
      match: (u) => u.includes("/task/Status?tid=1501&gid=42"),
      body: {
        status: "success",
        submissionCount: 4,
        submissionList: [
          sub(201, 9101, 50, 9, "2026-09-18 10:00:00"), // 旧提交（50 分，错误）
          sub(202, 9101, 100, 2, "2026-09-19 10:00:00"), // 最新 → 取 100
          sub(203, 9102, 80, 2, "2026-09-19 09:00:00"),
          sub(210, 9103, 0, 9, "2026-09-19 12:00:00"), // 与 sid=211 同秒，取 sid 大者
          sub(211, 9103, 100, 2, "2026-09-19 12:00:00"),
        ],
      },
    },
    // ③ 存在未判：9104 的最新提交缺 score（旧的反而有分也不回退）→ 保守 graded=false
    {
      match: (u) => u.includes("/task/Status?tid=1502&gid=42"),
      body: {
        status: "success",
        submissionCount: 3,
        submissionList: [
          sub(301, 9104, 100, 2, "2026-09-18 10:00:00"), // 旧提交有分
          sub(302, 9104, undefined, undefined, "2026-09-19 10:00:00"), // 最新缺 score
          sub(303, 9105, 100, 2, "2026-09-19 10:00:00"),
        ],
      },
    },
    // ③b 判题中：result=1（探测未观测到，保守排除）→ graded=false 不透出分数
    {
      match: (u) => u.includes("/task/Status?tid=1503&gid=42"),
      body: {
        status: "success",
        submissionCount: 2,
        submissionList: [sub(401, 9201, 100, 1, "2026-09-19 11:00:00"), sub(402, 9202, 100, 2, "2026-09-19 11:00:00")],
      },
    },
    // ④ 无提交 → graded=false
    { match: (u) => u.includes("/task/Status?tid=1504&gid=42"), body: { status: "success", submissionCount: 0, submissionList: [] } },
  ]);
  const src = createTycheSource({ cookie: "JSESSIONID=x" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 5, "拉到 5 条作业");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  // ① 四题全 100 → 已批改 · 400/400
  eq(byTitle.get("四题全过")?.submitted, true, "①4 题各一次 100 → 已提交");
  eq(byTitle.get("四题全过")?.graded, true, "①每个 pid 最新提交都有数字 score → graded=true");
  eq(byTitle.get("四题全过")?.score, 400, "①score=Σ 各 pid 最新 score=400");
  eq(byTitle.get("四题全过")?.totalScore, 400, "①totalScore=100×pid 数=400");
  // ② 同 pid 多次提交取最新（并列取 sid 最大）
  eq(byTitle.get("同题多次提交")?.graded, true, "②取每组最新 → 全有分 → graded=true");
  eq(byTitle.get("同题多次提交")?.score, 280, "②score=100+80+100=280（旧 50 分不回退、并列取 sid 大的 100）");
  eq(byTitle.get("同题多次提交")?.totalScore, 300, "②totalScore=100×3 pid=300");
  // ③ 存在未判（缺 score）→ 保守未批改，不透出分数
  eq(byTitle.get("最新提交缺 score")?.submitted, true, "③有提交 → 已提交");
  eq(byTitle.get("最新提交缺 score")?.graded, false, "③最新提交缺 score（旧的有分不回退）→ graded=false");
  eq(byTitle.get("最新提交缺 score")?.score, undefined, "③未批改 → 不透出 score（避免 0 分误导）");
  eq(byTitle.get("最新提交缺 score")?.totalScore, undefined, "③未批改 → 不透出 totalScore");
  // ③b result=1 判题中 → 保守排除
  eq(byTitle.get("判题中")?.graded, false, "③b result=1 视为判题中 → 保守 graded=false");
  eq(byTitle.get("判题中")?.score, undefined, "③b 判题中 → 不透出 score");
  // ④ 无提交
  eq(byTitle.get("无提交")?.submitted, false, "④无提交 → 未提交");
  eq(byTitle.get("无提交")?.graded, false, "④无提交 → graded=false");
}

/* ───────── R15 20.2：经典 TUOJ（复用 tuoj 客户端，仅参数化 base/id/name） ───────── */
console.log("\n[经典 TUOJ]");
{
  const fetchLike = makeFetch([
    { match: (u, m) => u.endsWith("/api/user/lookup") && m === "POST", body: { user: { _id: 1001, username: "2026000000" } } },
    { match: (u) => u.endsWith("/api/course/list"), body: { courses: [{ _id: 8, title: "数据结构" }] } },
    { match: (u) => u.endsWith("/api/course/8/rank"), body: { courseRank: { contests: [{ _id: 83, title: "hw1" }] } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/context"), body: { context: { metadata: { title: "hw1" }, schedule: { endAt: FUTURE } } } },
    { match: (u) => u.endsWith("/api/course/8/contest/83/ranklist"), body: { ranklist: { players: [{ _id: 1001, username: "2026000000", details: { "0": {} } }] } } },
  ]);
  const src = createTuojSource({ cookie: "session=x" }, fetchLike, 30, {
    base: TUOJ_CLASSIC_BASE,
    id: "tuojClassic",
    name: SOURCE_NAMES.tuojClassic,
  });
  const items = await src.fetch();
  eq(src.id, "tuojClassic", "源 id = tuojClassic");
  eq(src.name, SOURCE_NAMES.tuojClassic, "展示名取 SOURCE_NAMES.tuojClassic");
  eq(items.length, 1, "拉到 1 条作业");
  eq(items[0]?.source, "tuojClassic", "条目 source = tuojClassic");
  eq(items[0]?.id, "tuojClassic-8-83", "条目 id 前缀按源");
  eq(items[0]?.submitted, true, "ranklist 命中自己且 details 非空 → 已提交");
  ok(
    fetchLike.calls.length > 0 && fetchLike.calls.every((c) => c.url.startsWith(TUOJ_CLASSIC_BASE)),
    "全部请求走经典版 base",
  );
  ok(items[0]?.url?.startsWith(TUOJ_CLASSIC_BASE), "详情 url 走经典版 base");
}
{
  // 不传 config 时仍是 AI 版（零回归）
  const fetchLike = makeFetch([{ match: () => true, body: { courses: [] } }]);
  const src = createTuojSource({ cookie: "s=x" }, fetchLike, 30);
  eq(src.id, "tuoj", "缺省 id = tuoj");
  eq(src.name, "TUOJ", "缺省展示名回退 TUOJ（组装层传 SOURCE_NAMES）");
  await src.fetch();
  ok(
    fetchLike.calls.every((c) => c.url.startsWith("https://ai.tuoj.thusaac.com")),
    "缺省 base 仍为 AI 版",
  );
}

/* ───────── R15 20.2：DSA OJ（邮箱账密；endDate 容错解析） ───────── */
console.log("\n[DSA OJ]");
{
  // endDate 容错解析（纯函数，格式不确定）
  const local = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
  eq(parseDsaDate("2026-09-27 23:59:59"), local(2026, 9, 27, 23, 59, 59), "空格分隔按本地时间");
  eq(parseDsaDate("2026-09-27T23:59:59"), local(2026, 9, 27, 23, 59, 59), "ISO T 分隔按本地时间");
  eq(parseDsaDate("2026/09/27 23:59:59"), local(2026, 9, 27, 23, 59, 59), "斜杠分隔按本地时间");
  eq(parseDsaDate("2026-09-27"), local(2026, 9, 27), "仅日期按本地零点");
  eq(parseDsaDate("2026-09-27T23:59:59+08:00"), Date.UTC(2026, 8, 27, 15, 59, 59), "显式 +08:00 按绝对时刻");
  eq(parseDsaDate("2026-09-27T15:59:59Z"), Date.UTC(2026, 8, 27, 15, 59, 59), "Z 按 UTC");
  eq(parseDsaDate("1758960000000"), 1758960000000, "13 位数字串按毫秒");
  eq(parseDsaDate("1758960000"), 1758960000000, "10 位数字串按秒");
  eq(parseDsaDate(1758960000000), 1758960000000, "数字 ms 原样");
  ok(Number.isNaN(parseDsaDate("bad-format")), "无法识别 → NaN");
  ok(Number.isNaN(parseDsaDate("")), "空串 → NaN");
  ok(Number.isNaN(parseDsaDate(undefined)), "非字符串 → NaN");
}
{
  // 课程列表 + 逐课作业（相对未来日期，确保在时间窗内）
  const plusDays = (n) => new Date(Date.now() + n * 86400000);
  const fmtD = (d, sep) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}${sep}${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const d1 = plusDays(3);
  const expected = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), d1.getHours(), d1.getMinutes(), d1.getSeconds()).getTime();
  const fetchLike = makeFetch([
    { match: (u, m, b) => u.endsWith("/user.php") && b.includes("action=checklogin"), body: { islogin: true } },
    {
      match: (u, m, b) => u.endsWith("/course.php") && b.includes("action=usercourses"),
      body: { error: 0, courseList: [{ courseId: 12, name: "数据结构" }] },
    },
    {
      match: (u, m, b) => u.endsWith("/course.php") && b.includes("action=courseinfo"),
      body: {
        error: 0,
        courseList: [
          {
            myRole: 1,
            assignmentList: [
              { id: 1, name: "空格日期", endDate: fmtD(d1, " ") },
              { id: 2, name: "ISO 日期", endDate: fmtD(d1, "T") },
              { id: 3, name: "斜杠日期", endDate: fmtD(d1, " ").replace(/-/g, "/") },
              { id: 4, name: "坏格式", endDate: "not-a-date" },
            ],
          },
        ],
      },
    },
  ]);
  const src = createDsaSource({ cookie: "PHPSESSID=x", username: "me@mails.tsinghua.edu.cn" }, fetchLike, 30);
  const items = await src.fetch();
  eq(src.id, "dsa", "源 id = dsa");
  eq(src.name, "DSA OJ", "展示名 = DSA OJ");
  eq(items.length, 3, "坏格式 endDate 被跳过，其余 3 条保留");
  const byTitle = new Map(items.map((i) => [i.title, i]));
  eq(byTitle.get("空格日期")?.deadline, localMin(expected), "空格日期 DDL 正确");
  eq(byTitle.get("ISO 日期")?.deadline, localMin(expected), "ISO 日期 DDL 正确");
  eq(byTitle.get("斜杠日期")?.deadline, localMin(expected), "斜杠日期 DDL 正确");
  eq(byTitle.get("空格日期")?.courseName, "数据结构", "课程名取 usercourses");
  eq(byTitle.get("空格日期")?.submitted, false, "提交状态语义未确认 → 保守未提交");
  ok(byTitle.get("空格日期")?.url?.includes("course_id=12"), "详情 url 带 course_id");
  const checkCalls = fetchLike.calls.filter((c) => c.url.endsWith("/user.php"));
  ok(
    checkCalls.every((c) => c.method === "POST" && c.headers["content-type"] === "application/x-www-form-urlencoded"),
    "会话检查走 POST form-urlencoded",
  );
  ok(checkCalls.every((c) => c.headers["cookie"] === "PHPSESSID=x"), "请求携带会话 Cookie");
}
{
  // checklogin=false → 类型化会话失效错误
  const fetchLike = makeFetch([
    { match: (u, m, b) => u.endsWith("/user.php") && b.includes("action=checklogin"), body: { islogin: false } },
  ]);
  const src = createDsaSource({ cookie: "PHPSESSID=x" }, fetchLike, 30);
  let err;
  try {
    await src.fetch();
  } catch (e) {
    err = e;
  }
  ok(isDsaSessionError(err), "checklogin=false → 抛 DsaSessionError");
  eq(err instanceof DsaSessionError, true, "错误类型为 DsaSessionError");
}
{
  // 会话中途失效：usercourses error≠0 → 类型化错误
  const fetchLike = makeFetch([
    { match: (u, m, b) => u.endsWith("/user.php") && b.includes("action=checklogin"), body: { islogin: true } },
    { match: (u, m, b) => u.endsWith("/course.php") && b.includes("action=usercourses"), body: { error: 1 } },
  ]);
  const src = createDsaSource({ cookie: "PHPSESSID=x" }, fetchLike, 30);
  let err;
  try {
    await src.fetch();
  } catch (e) {
    err = e;
  }
  ok(isDsaSessionError(err), "usercourses error≠0 → 抛 DsaSessionError");
}
{
  // 未选课（courseList 空）→ 0 条，不报错
  const fetchLike = makeFetch([
    { match: (u, m, b) => u.endsWith("/user.php") && b.includes("action=checklogin"), body: { islogin: true } },
    { match: (u, m, b) => u.endsWith("/course.php") && b.includes("action=usercourses"), body: { error: 0, courseList: [] } },
  ]);
  const src = createDsaSource({ cookie: "PHPSESSID=x" }, fetchLike, 30);
  const items = await src.fetch();
  eq(items.length, 0, "未选课 → 0 条且不报错");
}

/* ───────── R12 17.1：TUOJ「已配置但会话失效」→ force 漫游 → 成功重拉 ───────── */
console.log("\n[TUOJ 失效自动重漫游 R12 17.1]");
if (!canResolveTs) {
  console.log("  跳过：需要 Node ≥ 22.15（module.registerHooks）以解析 core 的 .js→.ts 相对导入");
} else {
  const { refreshExternalHomework, resetTuojSessionRetryState, TuojSessionError, isTuojSessionError } = await import(
    "../packages/core/src/exthw/index.ts"
  );

  /** mock fetchLike：`listStatuses` 依次决定第 N 次 /api/course/list 的状态码（末项复用） */
  function makeTuojFetch(listStatuses) {
    let listHits = 0;
    const calls = [];
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fn = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const headers = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
      calls.push({ url, method, headers });
      if (url.endsWith("/api/course/list")) {
        const status = listStatuses[Math.min(listHits, listStatuses.length - 1)];
        listHits++;
        return status === 200
          ? json({ courses: [{ _id: 8, title: "离散数学" }] })
          : json({ message: "unauthorized" }, status);
      }
      if (url.endsWith("/api/user/lookup")) return json({ user: { _id: 1001, username: "2026000000" } });
      if (url.endsWith("/api/course/8/rank")) return json({ courseRank: { contests: [{ _id: 83 }] } });
      if (url.endsWith("/api/course/8/contest/83/context"))
        return json({ context: { metadata: { title: "hw1" }, schedule: { endAt: FUTURE } } });
      if (url.endsWith("/api/course/8/contest/83/ranklist"))
        return json({ ranklist: { players: [{ _id: 1001, username: "2026000000", details: { "0": {} } }] } });
      return new Response("not found", { status: 404 });
    };
    fn.calls = calls;
    fn.listHits = () => listHits;
    return fn;
  }

  // 类型化判定：401/403 抛 TuojSessionError；其他错误不误判
  ok(isTuojSessionError(new TuojSessionError(401)), "TuojSessionError(401) 判定为会话失效");
  ok(isTuojSessionError(new Error("boom")) === false, "普通 Error 不判会话失效");

  // ① 已配置但 401 → force 漫游成功 → 自动重拉一次 → 恢复
  {
    resetTuojSessionRetryState(); // R19 27.1：重漫游有进程级频控，每个用例先清零
    const creds = { tuoj: { cookie: "old", via: "password" } };
    const fetchLike = makeTuojFetch([401, 200]);
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        creds.tuoj = { cookie: "new", via: "cas" }; // 模拟 CAS 漫游覆盖凭据
        return true;
      },
    });
    eq(r.reroutedTuoj, true, "①触发了一次 force 重漫游");
    eq(roamCalls, 1, "①漫游恰好一次");
    eq(fetchLike.listHits(), 2, "①课程列表被拉取两次（首发 401 + 重拉）");
    eq(r.items.length, 1, "①重拉成功拉到 1 条作业");
    eq(r.errors.tuoj, undefined, "①重拉成功后不再有 TUOJ 错误");
    const listCalls = fetchLike.calls.filter((c) => c.url.endsWith("/api/course/list"));
    eq(listCalls[0]?.headers["cookie"], "old", "①首发用旧 cookie");
    eq(listCalls[1]?.headers["cookie"], "new", "①重拉用漫游后的新 cookie");
  }

  // ①b（R23，霖实测）已配置但会话老化 → 200 + 登录页 HTML（非 JSON）→ 同样触发 force 重漫游。
  //     此前非 JSON 抛普通 Error，isTuojSessionError 不命中 → 自动重登从不触发，只能手动退出重登。
  {
    resetTuojSessionRetryState();
    const creds = { tuoj: { cookie: "old", via: "cas" } };
    const jsonRes = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    let listHits = 0;
    const fetchLike = async (url) => {
      if (url.endsWith("/api/course/list")) {
        listHits++;
        // 首发：会话失效的典型形态（HTTP 200 + 登录页 HTML）
        if (listHits === 1) return new Response("<html><body>请先登录</body></html>", { status: 200 });
        return jsonRes({ courses: [{ _id: 8, title: "离散数学" }] });
      }
      if (url.endsWith("/api/user/lookup")) return jsonRes({ user: { _id: 1001, username: "2026000000" } });
      if (url.endsWith("/api/course/8/rank")) return jsonRes({ courseRank: { contests: [{ _id: 83 }] } });
      return jsonRes({});
    };
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        creds.tuoj = { cookie: "new", via: "cas" };
        return true;
      },
    });
    eq(r.reroutedTuoj, true, "①b R23：200+非 JSON 也判会话失效并触发重漫游");
    eq(roamCalls, 1, "①b 漫游恰好一次");
    eq(listHits, 2, "①b 课程列表拉取两次（首发非 JSON + 重拉）");
  }

  // ② 重拉仍 401 → 不再进入第二轮漫游（防循环），保留 401 错误
  {
    resetTuojSessionRetryState();
    const creds = { tuoj: { cookie: "old" } };
    const fetchLike = makeTuojFetch([401]);
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        return true;
      },
    });
    eq(roamCalls, 1, "②防循环：仅漫游一次");
    eq(fetchLike.listHits(), 2, "②重拉一次后停止");
    ok(r.errors.tuoj?.includes("会话已失效"), "②保留原 401 错误");
    eq(r.items.length, 0, "②无作业");
  }

  // ③ 漫游失败（返回 false）→ 维持原 401 错误，不重拉
  {
    resetTuojSessionRetryState();
    const creds = { tuoj: { cookie: "old" } };
    const fetchLike = makeTuojFetch([401, 200]);
    let roamCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        return false; // 频控拦截 / 漫游失败
      },
    });
    eq(r.reroutedTuoj, false, "③漫游失败不标记 rerouted");
    eq(roamCalls, 1, "③仍尝试过一次漫游");
    eq(fetchLike.listHits(), 1, "③不重拉");
    ok(r.errors.tuoj?.includes("会话已失效"), "③维持原 401 错误与设置页引导");
  }

  // ④（R15 20.2）经典 TUOJ 失效 → 按源 force 漫游 → 重拉（泛化后不再只认 tuoj）
  {
    resetTuojSessionRetryState();
    const creds = { tuojClassic: { cookie: "old", via: "password" } };
    const fetchLike = makeTuojFetch([401, 200]);
    const seen = [];
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async (source) => {
        seen.push(source);
        creds.tuojClassic = { cookie: "new", via: "cas" }; // 模拟经典版 CAS 漫游覆盖凭据
        return true;
      },
    });
    eq(seen.length, 1, "④经典 TUOJ 触发一次漫游");
    eq(seen[0], "tuojClassic", "④漫游钩子收到源 id = tuojClassic");
    eq(r.reroutedTuoj, true, "④reroutedTuoj=true");
    eq(r.reroutedSources.join(","), "tuojClassic", "④reroutedSources 记录经典版");
    eq(r.items.length, 1, "④重拉成功拉到 1 条");
    const listCalls = fetchLike.calls.filter((c) => c.url.endsWith("/api/course/list"));
    eq(listCalls[0]?.headers["cookie"], "old", "④首发用旧 cookie");
    eq(listCalls[1]?.headers["cookie"], "new", "④重拉用漫游后的新 cookie");
    ok(
      listCalls.every((c) => c.url.startsWith("https://oj.cs.tsinghua.edu.cn")),
      "④请求走经典版 base",
    );
  }

  /* ── R19 27.1：会话失效自动重漫游——in-flight 去重 + 进程级频控放宽 + 失败文案 ── */
  console.log("\n[TUOJ 失效自动重漫游 R19 27.1]");
  const REROUTE_PREFIX = "已尝试自动重新登录，仍失败：";

  // ⑤ 同源并发 401 → in-flight 去重：两个并发 refresh 只发起一次重漫游，各自重拉均成功
  {
    resetTuojSessionRetryState();
    const creds = { tuoj: { cookie: "old", via: "password" } };
    const fetchLike = makeTuojFetch([401, 401, 200]);
    let roamCalls = 0;
    const hook = async () => {
      roamCalls++;
      creds.tuoj = { cookie: "new", via: "cas" };
      return true;
    };
    const [ra, rb] = await Promise.all([
      refreshExternalHomework({ getCreds: () => creds, fetchLike, rerouteTuoj: hook }),
      refreshExternalHomework({ getCreds: () => creds, fetchLike, rerouteTuoj: hook }),
    ]);
    eq(roamCalls, 1, "⑤并发 401 只触发一次重漫游（共享 in-flight Promise）");
    eq(ra.reroutedTuoj, true, "⑤第一个 refresh 标记 rerouted");
    eq(rb.reroutedTuoj, true, "⑤第二个 refresh 共享漫游结果并标记 rerouted");
    eq(ra.items.length, 1, "⑤第一个 refresh 重拉成功");
    eq(rb.items.length, 1, "⑤第二个 refresh 重拉成功");
    eq(fetchLike.listHits(), 4, "⑤课程列表共 4 次（两轮各：首发 401 + 重拉 200）");
    ok(ra.errors.tuoj === undefined && rb.errors.tuoj === undefined, "⑤无错误残留");
  }

  // ⑥ 间隔频控（放宽后的 ≥10 分钟）：一次自动重漫游后紧接着再 401 → 不再自动重试；
  //   发起过漫游仍失败的错误文案带「已尝试自动重新登录，仍失败：」前缀，未发起则无前缀
  {
    resetTuojSessionRetryState();
    const creds = { tuoj: { cookie: "old" } };
    const fetchLike = makeTuojFetch([401]);
    let roamCalls = 0;
    const first = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        return false; // 漫游失败（如统一认证未通过）
      },
    });
    ok(first.errors.tuoj?.startsWith(REROUTE_PREFIX), "⑥发起过漫游仍失败 → 文案带「已尝试自动重新登录，仍失败：」前缀");
    ok(first.errors.tuoj?.includes("会话已失效"), "⑥前缀后保留原 401 原因");
    const second = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      rerouteTuoj: async () => {
        roamCalls++;
        return true;
      },
    });
    eq(roamCalls, 1, "⑥间隔 <10 分钟 → 第二次 refresh 不再自动重漫游（24h 频控已放宽为 10min）");
    ok(
      Boolean(second.errors.tuoj) && !second.errors.tuoj.startsWith(REROUTE_PREFIX),
      "⑥未发起漫游 → 文案无前缀（保留原 401 提示）",
    );
  }

  // ⑦ 每进程每源最多 3 次 + 两源独立：放行时钟跨过 10min 间隔连试 3 次后第 4 次被拦；
  //   AI 版烧完额度不影响经典版（各自计数）
  {
    resetTuojSessionRetryState();
    const creds = { tuoj: { cookie: "old" } };
    const fetchLike = makeTuojFetch([401]);
    const roamed = [];
    const hook = async (source) => {
      roamed.push(source);
      return false;
    };
    const realNow = Date.now;
    try {
      for (let n = 1; n <= 3; n++) {
        Date.now = () => realNow() + n * 11 * 60 * 1000; // 每轮快进 11 分钟，跨过 10min 间隔
        await refreshExternalHomework({ getCreds: () => creds, fetchLike, rerouteTuoj: hook });
      }
      eq(roamed.length, 3, "⑦放行时钟下每次 refresh 各自动重试一次（共 3 次）");
      Date.now = () => realNow() + 4 * 11 * 60 * 1000;
      const r4 = await refreshExternalHomework({ getCreds: () => creds, fetchLike, rerouteTuoj: hook });
      eq(roamed.length, 3, "⑦每进程每源最多 3 次自动重试（第 4 次不再漫游）");
      ok(
        Boolean(r4.errors.tuoj) && !r4.errors.tuoj.startsWith(REROUTE_PREFIX),
        "⑦超限后被拦的 refresh 文案无前缀（未发起漫游）",
      );
      // 两源独立：AI 版额度烧完，经典版首试仍放行
      const credsC = { tuojClassic: { cookie: "old-c" } };
      await refreshExternalHomework({ getCreds: () => credsC, fetchLike, rerouteTuoj: hook });
      eq(roamed.filter((s) => s === "tuojClassic").length, 1, "⑦AI 版超限不影响经典版（两源独立计数）");
    } finally {
      Date.now = realNow;
    }
  }
}

/* ───────── R21-A：Tyche 会话失效静默自动重登（记住密码） ───────── */
console.log("\n[Tyche 失效自动重登 R21-A]");
if (!canResolveTs) {
  console.log("  跳过：需要 Node ≥ 22.15（module.registerHooks）以解析 core 的 .js→.ts 相对导入");
} else {
  const { refreshExternalHomework, resetTycheSessionRetryState, resetTuojSessionRetryState, TycheSessionError, isTycheSessionError } = await import(
    "../packages/core/src/exthw/index.ts"
  );
  const { createTycheSource } = await import("../packages/core/src/exthw/tyche.ts");
  const TYCHE_BASE = "http://166.111.236.164:6080/tyche";

  const TYCHE_GROUP_OK = {
    group: { gid: 42, name: "程序设计基础", tasks: [{ tid: 1406, title: "作业一", judgeEndTime: localDT(FUTURE) }] },
  };
  const TYCHE_STATUS_OK = {
    status: "success",
    submissionCount: 1,
    submissionList: [{ pid: 1, sid: 1, score: 100, result: 2, submitedTime: "2026-09-19 10:00:00" }],
  };
  const TYCHE_LOGIN_BODY = { status: "login" };

  /** mock Tyche fetchLike：groupStatuses 依次决定第 N 次 GroupList 的响应（末项复用）；
   *  statusBody / statusBody2 分别是首发与（自动重登后）重拉时 task/Status 的响应。
   *  routeStatus = "login" → {status:"login"}；"fail" → throw 普通 Error；数字 → HTTP 该码。 */
  function makeTycheFetch(groupStatuses, { statusBody = TYCHE_STATUS_OK, statusBody2 = TYCHE_STATUS_OK } = {}) {
    let groupHits = 0;
    let statusHits = 0;
    const calls = [];
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const groupResp = (spec) => {
      if (spec === "login") return json(TYCHE_LOGIN_BODY);
      if (typeof spec === "number") return json({ message: "err" }, spec);
      if (spec === "fail") throw new Error("网络断开");
      return json({ groupList: [{ gid: 42, name: "程序设计基础" }] });
    };
    const fn = async (url, init = {}) => {
      const method = (init.method ?? "GET").toUpperCase();
      const headers = {};
      for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
      calls.push({ url, method, headers });
      if (url.endsWith("/group/GroupList")) {
        const spec = groupStatuses[Math.min(groupHits, groupStatuses.length - 1)];
        groupHits++;
        return groupResp(spec);
      }
      if (url.includes("/group/ShowGroup")) return json(TYCHE_GROUP_OK);
      if (url.includes("/task/Status")) {
        const body = statusHits++ === 0 ? statusBody : statusBody2;
        if (body === "login") return json(TYCHE_LOGIN_BODY);
        if (body === "fail") throw new Error("状态接口网络断开");
        return json(body);
      }
      return new Response("not found", { status: 404 });
    };
    fn.calls = calls;
    fn.groupHits = () => groupHits;
    return fn;
  }

  // ⑩ 类型判定：status=login / 401 / 非 JSON 三种失效都归 TycheSessionError，其余不误判
  {
    const sess = createTycheSource({ cookie: "c" }, makeTycheFetch(["login"]), 30);
    let err;
    try {
      await sess.fetch();
    } catch (e) {
      err = e;
    }
    ok(isTycheSessionError(err), "⑩GroupList status=login → TycheSessionError");
    ok(isTycheSessionError(new TycheSessionError("x")), "⑩TycheSessionError 实例判定为会话失效");
    ok(!isTycheSessionError(new Error("boom")), "⑩普通 Error 不判会话失效");
    ok(!(err instanceof Error && err.name === "TuojSessionError"), "⑩不与 TUOJ 会话错误混淆");
  }

  // ⑪ status=login → 静默自动重登一次 → 自动重拉成功（新 Cookie 生效）
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old", username: "u", password: "p" } };
    const fetchLike = makeTycheFetch(["login", "ok"]);
    let reloginCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      reloginTyche: async () => {
        reloginCalls++;
        creds.tyche = { cookie: "new", username: "u", password: "p" }; // 模拟重登覆盖凭据
        return true;
      },
    });
    eq(r.reloginTyche, true, "⑪触发了一次静默自动重登");
    eq(reloginCalls, 1, "⑪重登恰好一次");
    eq(fetchLike.groupHits(), 2, "⑪GroupList 拉取两次（首发 login + 重拉成功）");
    eq(r.items.length, 1, "⑪重拉成功拉到 1 条作业");
    eq(r.errors.tyche, undefined, "⑪重拉成功后不再有 Tyche 错误");
    const groupCalls = fetchLike.calls.filter((c) => c.url.endsWith("/group/GroupList"));
    eq(groupCalls[0]?.headers["cookie"], "old", "⑪首发用旧 cookie");
    eq(groupCalls[1]?.headers["cookie"], "new", "⑪重拉用重登后的新 cookie");
  }

  // ⑫ 重登失败 → 不进入第二轮（防循环），错误文案带「已尝试自动重新登录，仍失败：」前缀
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old", username: "u", password: "p" } };
    const fetchLike = makeTycheFetch(["login"]);
    let reloginCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      reloginTyche: async () => {
        reloginCalls++;
        return false; // 重登失败（密码错 / 需验证码等）
      },
    });
    eq(reloginCalls, 1, "⑫防循环：仅重登一次");
    eq(fetchLike.groupHits(), 1, "⑫重登失败不重拉");
    ok(r.errors.tyche?.startsWith("已尝试自动重新登录，仍失败："), "⑫文案带「已尝试自动重新登录，仍失败：」前缀");
    ok(r.errors.tyche?.includes("status=login"), "⑫前缀后保留原失效原因");
    eq(r.items.length, 0, "⑫无作业");
  }

  // ⑬ 非会话错误（网络断）不触发自动重登、无前缀
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old" } };
    const fetchLike = makeTycheFetch(["fail"]);
    let reloginCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      reloginTyche: async () => {
        reloginCalls++;
        return true;
      },
    });
    eq(reloginCalls, 0, "⑬普通网络错误不触发自动重登");
    ok(Boolean(r.errors.tyche) && !r.errors.tyche.startsWith("已尝试自动重新登录"), "⑬普通错误文案无前缀");
  }

  // ⑭ 未注入 reloginTyche 钩子 → 行为同旧版（不重登、无前缀）
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old" } };
    const fetchLike = makeTycheFetch(["login"]);
    const r = await refreshExternalHomework({ getCreds: () => creds, fetchLike });
    eq(fetchLike.groupHits(), 1, "⑭无钩子不重试");
    ok(Boolean(r.errors.tyche) && !r.errors.tyche.startsWith("已尝试自动重新登录"), "⑭无钩子文案无前缀");
  }

  // ⑮ 并发会话失效 → in-flight 去重：两个并发 refresh 只重登一次，各自重拉均成功
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old", username: "u", password: "p" } };
    const fetchLike = makeTycheFetch(["login", "login", "ok"]);
    let reloginCalls = 0;
    const hook = async () => {
      reloginCalls++;
      creds.tyche = { cookie: "new", username: "u", password: "p" };
      return true;
    };
    const [ra, rb] = await Promise.all([
      refreshExternalHomework({ getCreds: () => creds, fetchLike, reloginTyche: hook }),
      refreshExternalHomework({ getCreds: () => creds, fetchLike, reloginTyche: hook }),
    ]);
    eq(reloginCalls, 1, "⑮并发失效只触发一次重登（共享 in-flight Promise）");
    eq(ra.reloginTyche, true, "⑮第一个 refresh 标记 reloginTyche");
    eq(rb.reloginTyche, true, "⑮第二个 refresh 共享重登结果并标记");
    eq(ra.items.length, 1, "⑮第一个 refresh 重拉成功");
    eq(rb.items.length, 1, "⑮第二个 refresh 重拉成功");
    eq(fetchLike.groupHits(), 4, "⑮GroupList 共 4 次（两轮各：首发 login + 重拉 ok）");
    ok(ra.errors.tyche === undefined && rb.errors.tyche === undefined, "⑮无错误残留");
  }

  // ⑯ 频控：同源两次 ≥10min、每进程 ≤3 次（含失败），Tyche 与 TUOJ 独立计数
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old", username: "u", password: "p" } };
    const fetchLike = makeTycheFetch(["login"]);
    const attempts = [];
    const hook = async () => {
      attempts.push(1);
      return false;
    };
    const realNow = Date.now;
    try {
      // 第一轮：发起过重登仍失败 → 前缀
      const first = await refreshExternalHomework({ getCreds: () => creds, fetchLike, reloginTyche: hook });
      eq(attempts.length, 1, "⑯首次失效发起一次重登");
      ok(first.errors.tyche?.startsWith("已尝试自动重新登录，仍失败："), "⑯发起过重登仍失败 → 带前缀");
      // 第二轮：间隔 <10min → 不再自动重登，无前缀
      const second = await refreshExternalHomework({ getCreds: () => creds, fetchLike, reloginTyche: hook });
      eq(attempts.length, 1, "⑯间隔 <10min 不再自动重登");
      ok(Boolean(second.errors.tyche) && !second.errors.tyche.startsWith("已尝试自动重新登录"), "⑯被频控拦截的文案无前缀");
      // 放行时钟：跨过 10min 间隔再试 2 次（累计 3 次 = 每进程上限），第 4 次被拦
      for (let n = 2; n <= 3; n++) {
        Date.now = () => realNow() + n * 11 * 60 * 1000;
        await refreshExternalHomework({ getCreds: () => creds, fetchLike, reloginTyche: hook });
      }
      eq(attempts.length, 3, "⑯放行时钟下累计 3 次（每进程上限）");
      Date.now = () => realNow() + 4 * 11 * 60 * 1000;
      const r4 = await refreshExternalHomework({ getCreds: () => creds, fetchLike, reloginTyche: hook });
      eq(attempts.length, 3, "⑯第 4 次不再自动重登（超限）");
      ok(Boolean(r4.errors.tyche) && !r4.errors.tyche.startsWith("已尝试自动重新登录"), "⑯超限文案无前缀");
      // Tyche 与 TUOJ 频控独立计数：Tyche 已超限（上一步烧满 3 次），TUOJ 401 仍照常漫游
      resetTuojSessionRetryState(); // TUOJ 状态在本文件 R19 块已用掉，清零后单独验证独立性
      const tuojCreds = { tuoj: { cookie: "old" } };
      let tuojRoamCalls = 0;
      const tuojJson = (body, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      let tuojListHits = 0;
      const tuojFetch = async (url, init = {}) => {
        if (String(url).endsWith("/api/course/list")) {
          const st = tuojListHits++ === 0 ? 401 : 200;
          return st === 200
            ? tuojJson({ courses: [{ _id: 8, title: "离散数学" }] })
            : tuojJson({ message: "unauthorized" }, st);
        }
        if (String(url).endsWith("/api/user/lookup")) return tuojJson({ user: { _id: 1001, username: "2026000000" } });
        if (String(url).includes("/contest/83/context"))
          return tuojJson({ context: { metadata: { title: "hw1" }, schedule: { endAt: FUTURE } } });
        if (String(url).includes("/contest/83/ranklist"))
          return tuojJson({ ranklist: { players: [{ _id: 1001, username: "2026000000", details: { "0": {} } }] } });
        if (String(url).endsWith("/api/course/8/rank")) return tuojJson({ courseRank: { contests: [{ _id: 83 }] } });
        return new Response("not found", { status: 404 });
      };
      const rt = await refreshExternalHomework({
        getCreds: () => tuojCreds,
        fetchLike: tuojFetch,
        rerouteTuoj: async () => {
          tuojRoamCalls++;
          tuojCreds.tuoj = { cookie: "new" };
          return true;
        },
      });
      eq(tuojRoamCalls, 1, "⑯Tyche 超限不影响 TUOJ 重漫游（各自独立计数）");
      eq(rt.reroutedTuoj, true, "⑯TUOJ 401 照常漫游成功");
      eq(rt.items.length, 1, "⑯TUOJ 重拉成功");
    } finally {
      Date.now = realNow;
    }
  }

  // ⑰ 仅 task/Status 失效（GroupList 正常）也必须冒泡并触发重登（内层 catch 不能吞会话错误）
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old", username: "u", password: "p" } };
    const fetchLike = makeTycheFetch(["ok", "ok"], { statusBody: "login", statusBody2: TYCHE_STATUS_OK });
    let reloginCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      reloginTyche: async () => {
        reloginCalls++;
        creds.tyche = { cookie: "new", username: "u", password: "p" };
        return true;
      },
    });
    eq(reloginCalls, 1, "⑰task/Status 会话失效触发一次重登");
    eq(r.items.length, 1, "⑰重登后重拉成功");
    ok(r.items[0]?.graded === true && r.items[0]?.score === 100, "⑰重拉数据完整（已批改 100 分）");
  }

  // ⑱ task/Status 普通错误仍保守吞掉（不触发重登、不算失败）
  {
    resetTycheSessionRetryState();
    const creds = { tyche: { cookie: "old" } };
    const fetchLike = makeTycheFetch(["ok"], { statusBody: "fail" });
    let reloginCalls = 0;
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike,
      reloginTyche: async () => {
        reloginCalls++;
        return true;
      },
    });
    eq(reloginCalls, 0, "⑱状态接口普通错误不触发重登");
    eq(r.errors.tyche, undefined, "⑱且不作为该源错误");
    eq(r.items.length, 1, "⑱列表照常返回（状态保守未提交）");
    ok(r.items[0]?.submitted === false && r.items[0]?.graded === false, "⑱状态保守 false");
  }
}

/* ───────── R21-A：Tyche 账密登录客户端（记住密码自动重登所依赖的登录链路） ───────── */
console.log("\n[Tyche 登录 R21-A]");
if (!canResolveTs) {
  console.log("  跳过：需要 Node ≥ 22.15（module.registerHooks）以解析 core 的 .js→.ts 相对导入");
} else {
  const { tycheLogin } = await import("../packages/core/src/exthw/login.ts");
  const { createHash } = await import("node:crypto");
  const sha1 = (s) => createHash("sha1").update(s).digest("hex");
  const TYCHE_BASE = "http://166.111.236.164:6080/tyche";

  // ⑲ 成功链路：GetToken(vcode=false) → sha1(sha1(pwd)+token) → POST Login 取回 Cookie
  {
    const calls = [];
    const fetchLike = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: String(init.body ?? "") });
      if (String(url).includes("/user/GetToken")) {
        return new Response(JSON.stringify({ status: "success", vcode: false, token: "T1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-onethu-set-cookie": JSON.stringify(["JSESSIONID=abc; Path=/", "username=u; Path=/", "uid=1; Path=/"]),
        },
      });
    };
    const r = await tycheLogin("2026000000", "pw", fetchLike);
    eq(r.cookie, "JSESSIONID=abc; username=u; uid=1", "⑲登录取回会话 Cookie 串");
    eq(calls[0]?.method, "GET", "⑲先 GET 取挑战 token");
    ok(calls[0].url.includes("/user/GetToken?username=2026000000"), "⑲GetToken 带用户名");
    eq(calls[1]?.method, "POST", "⑳再 POST 登录");
    ok(calls[1].url.includes("/user/Login"), "⑳POST 打到 user/Login");
    ok(calls[1].body.includes("token=T1"), "⑳登录表单带挑战 token");
    ok(calls[1].body.includes(`password=${sha1(sha1("pw") + "T1")}`), "⑳口令变换 sha1(sha1(pwd)+token) 与 Login.html 一致");
  }
  // ㉑ vcode=true（考场锁定）→ 明确报错且不发登录 POST（无验证码输入通道，不能静默重登）
  {
    const calls = [];
    const fetchLike = async (url, init = {}) => {
      calls.push({ url: String(url) });
      return new Response(JSON.stringify({ status: "success", vcode: true, token: "T2" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    let err;
    try {
      await tycheLogin("u", "p", fetchLike);
    } catch (e) {
      err = e;
    }
    ok(err instanceof Error && err.message.includes("验证码"), "㉑vcode=true → 明确提示需要验证码");
    eq(calls.length, 1, "㉑不发登录 POST（只有 GetToken 一跳）");
  }
  // ㉒ 用户名不存在 / 密码错误 → 服务端 returnFailString 映射成中文
  {
    const fetchLike = async () =>
      new Response(JSON.stringify({ status: "error", returnFailString: "username_not_exist" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    let err;
    try {
      await tycheLogin("ghost", "p", fetchLike);
    } catch (e) {
      err = e;
    }
    ok(err instanceof Error && err.message.includes("用户名不存在"), "㉒username_not_exist → 中文提示");
    const fetchLike2 = async (url, init = {}) => {
      if (String(url).includes("/user/Login")) {
        return new Response(JSON.stringify({ returnFailString: "password_mismatch" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ status: "success", vcode: false, token: "T3" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    let err2;
    try {
      await tycheLogin("u", "bad", fetchLike2);
    } catch (e) {
      err2 = e;
    }
    ok(err2 instanceof Error && err2.message.includes("密码错误"), "㉒password_mismatch → 中文提示");
  }
}

/* ───────── R15 20.2：DSA 登录 + 经典 TUOJ 账密 base 参数化（动态引 core 登录层） ───────── */
console.log("\n[DSA 登录]");
if (!canResolveTs) {
  console.log("  跳过：需要 Node ≥ 22.15（module.registerHooks）以解析 core 的 .js→.ts 相对导入");
} else {
  const { dsaLogin, tuojLogin } = await import("../packages/core/src/exthw/login.ts");
  const { CLASSIC_BASE } = await import("../packages/core/src/exthw/tuoj.ts");
  {
    const calls = [];
    const fetchLike = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, body: String(init.body ?? "") });
      return new Response(JSON.stringify({ error: 0 }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-onethu-set-cookie": JSON.stringify(["PHPSESSID=abc; Path=/"]),
        },
      });
    };
    const r = await dsaLogin("me@mails.tsinghua.edu.cn", "pw", fetchLike);
    eq(r.cookie, "PHPSESSID=abc", "DSA 登录取回会话 Cookie");
    ok(calls[0].url.endsWith("/oj/user.php"), "DSA 登录打到 user.php");
    ok(
      calls[0].body.includes("action=login") && calls[0].body.includes("username=me%40mails.tsinghua.edu.cn"),
      "DSA 登录 form 编码含 action / username",
    );
  }
  {
    const fetchLike = async () =>
      new Response(JSON.stringify({ error: 1, message: "邮箱或密码错误" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    let err;
    try {
      await dsaLogin("a@b.c", "x", fetchLike);
    } catch (e) {
      err = e;
    }
    ok(err instanceof Error && err.message.includes("邮箱或密码错误"), "DSA 登录 error≠0 → 抛服务端消息");
  }
  {
    // 经典 TUOJ 账号密码登录走经典 base（base 参数化）
    const calls = [];
    const fetchLike = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method });
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-onethu-set-cookie": JSON.stringify(["session=x; Path=/"]),
        },
      });
    };
    const r = await tuojLogin("2026000000", "pw", fetchLike, CLASSIC_BASE);
    eq(r.cookie, "session=x", "经典 TUOJ 账密登录取回 Cookie");
    ok(calls[0].url.startsWith(CLASSIC_BASE), "经典 TUOJ 账密登录打到经典 base");
  }
}

/* ───────── R21-B：雨课堂会话失效归一 / 健康检查 / Cookie 轮换 / 导出导入 ───────── */
console.log("\n[雨课堂 R21-B 会话/保活/导出导入]");
{
  const { YktSessionError, isYktSessionError, mergeYktCookiePairs, buildYktCookieExportJson, parseYktCookieExportJson, YKT_COOKIE_EXPORT_KIND } = await import(
    "../packages/core/src/exthw/yuketang.ts"
  );
  const jsonRes = (body, status = 200, extraHeaders = {}) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...extraHeaders },
    });

  // ① 错误归一矩阵：四特征 → YktSessionError
  {
    let err;
    try {
      await createYuketangSource({ cookie: "sessionid=x" }, async () => new Response("unauthorized", { status: 401 }), 30).fetch();
    } catch (e) {
      err = e;
    }
    ok(isYktSessionError(err), "①HTTP 401 → YktSessionError");
    ok(err instanceof Error && err.message.includes("会话已失效") && err.message.includes("401"), "①401 文案含「会话已失效」与状态码");

    const h403 = await createYuketangSource({ cookie: "sessionid=x" }, async () => new Response("", { status: 403 }), 30).checkSession();
    eq(h403.alive, false, "①HTTP 403 checkSession alive=false");
    eq(h403.reason, "http403", "①403 reason=http403");

    const f401k = makeFetch([
      { match: (u) => u.includes("/v2/api/web/courses/list"), body: { errcode: 401000, errmsg: "Session not exists" } },
    ]);
    err = undefined;
    try {
      await createYuketangSource({ cookie: "sessionid=x" }, f401k, 30).fetch();
    } catch (e) {
      err = e;
    }
    ok(isYktSessionError(err) && err instanceof Error && err.message.includes("401000"), "①courses errcode=401000 → 会话错误含 401000");

    err = undefined;
    try {
      await createYuketangSource(
        { cookie: "sessionid=x" },
        makeFetch([{ match: (u) => u.includes("/get_exercise_list/"), body: { errcode: 401000, errmsg: "Session not exists" } }]),
        30,
      ).getExerciseDetail("7001", "77");
    } catch (e) {
      err = e;
    }
    ok(isYktSessionError(err) && err instanceof Error && err.message.includes("401000"), "①详情 errcode=401000 → 会话错误含 401000");

    const h50000 = await createYuketangSource(
      { cookie: "sessionid=x" },
      async () => jsonRes({ code: 50000, msg: "UNAUTHENTICATED", data: "" }),
      30,
    ).checkSession();
    eq(h50000.alive, false, "①basic-info code=50000 alive=false");
    eq(h50000.reason, "unauthenticated", "①50000 reason=unauthenticated");

    const hHtml = await createYuketangSource({ cookie: "sessionid=x" }, async () => new Response("<html>login</html>", { status: 200 }), 30).checkSession();
    eq(hHtml.alive, false, "①非 JSON（登录壳）alive=false");
    eq(hHtml.reason, "non-json", "①非 JSON reason=non-json");

    err = undefined;
    try {
      await createYuketangSource({ cookie: "sessionid=x" }, async () => new Response("<html>login</html>", { status: 200 }), 30).fetch();
    } catch (e) {
      err = e;
    }
    ok(isYktSessionError(err), "①courses 返回非 JSON → YktSessionError");

    ok(isYktSessionError(new YktSessionError()), "①YktSessionError 实例判定成立");
    ok(!isYktSessionError(new Error("boom")), "①普通 Error 不判会话失效");
    if (canResolveTs) {
      const { TuojSessionError } = await import("../packages/core/src/exthw/index.ts");
      ok(!isYktSessionError(new TuojSessionError()), "①不与 TUOJ 会话错误混淆");
    }
  }

  // ② 会话有效：alive=true + 宽松取归属人；basic-info 无需 XTBZ 头
  {
    const calls = [];
    const f = async (url, init = {}) => {
      calls.push({ url: String(url), headers: init.headers ?? {} });
      return jsonRes({ code: 0, msg: "", data: { name: "张三", username: "zhangsan" } });
    };
    const h = await createYuketangSource({ cookie: "sessionid=x", uvId: "2598" }, f, 30).checkSession();
    eq(h.alive, true, "②code=0 → 会话有效");
    eq(h.userName, "张三", "②宽松取到归属人姓名");
    ok(h.checkedAt > 0, "②记录检查时间");
    eq(calls.length, 1, "②健康检查只打一个请求");
    ok(calls[0].url.includes("/api/v3/user/basic-info"), "②打到 basic-info");
    ok(!Object.keys(calls[0].headers).some((k) => k.toLowerCase() === "xtbz"), "②basic-info 无需 XTBZ 头");
  }

  // ③ 网络断：alive=null（未知，不谎报失效），且不抛
  {
    const h = await createYuketangSource(
      { cookie: "sessionid=x" },
      async () => {
        throw new TypeError("fetch failed");
      },
      30,
    ).checkSession();
    eq(h.alive, null, "③网络断 alive=null");
    eq(h.reason, "network", "③网络断 reason=network");
  }

  // ④ Cookie 轮换捕获：Set-Cookie 白名单合并 → 回调一次 → 后续请求即用新值
  {
    const calls = [];
    const refreshes = [];
    const rotated = {
      "Content-Type": "application/json",
      "x-onethu-set-cookie": JSON.stringify(["sessionid=NEW; Path=/; HttpOnly", "randomtoken=zz; Path=/", "uv_id=2598; Path=/"]),
    };
    const f = async (url, init = {}) => {
      calls.push({ url: String(url), cookie: (init.headers ?? {})["Cookie"] ?? "" });
      if (String(url).includes("/v2/api/web/courses/list")) {
        return jsonRes({ errcode: 0, data: { list: [{ classroom_id: 1, name: "线代", role: 5 }] } }, 200, rotated);
      }
      return jsonRes({ errcode: 0, data: { activities: [] } });
    };
    await createYuketangSource({ cookie: "sessionid=OLD; uv_id=2598; xtbz=ykt" }, f, 30, { onCookieRefresh: (c) => refreshes.push(c) }).fetch();
    eq(refreshes.length, 1, "④轮换恰好回调一次");
    ok(refreshes[0].includes("sessionid=NEW"), "④轮换后的 Cookie 带新 sessionid");
    ok(!refreshes[0].includes("randomtoken"), "④非白名单字段（randomtoken）不并入");
    ok(refreshes[0].includes("xtbz=ykt") && refreshes[0].includes("uv_id=2598"), "④原有字段保留");
    ok(calls.length >= 2, "④课程后跟随了后续请求");
    ok(calls[0].cookie.includes("sessionid=OLD"), "④首发用旧 sessionid");
    ok(calls[1].cookie.includes("sessionid=NEW"), "④轮换后请求立即用新 sessionid");
    ok(calls.every((c) => !c.cookie.includes("randomtoken")), "④请求头永不带非白名单字段");

    // 无轮换 → 零回调
    const refreshes2 = [];
    await createYuketangSource(
      { cookie: "sessionid=OLD" },
      async () => jsonRes({ errcode: 0, data: { list: [] } }),
      30,
      { onCookieRefresh: (c) => refreshes2.push(c) },
    ).fetch();
    eq(refreshes2.length, 0, "④无 Set-Cookie → 不回调");
  }

  // ⑤ mergeYktCookiePairs 纯函数：换值 / 追加 / 忽略非白名单
  {
    const m = mergeYktCookiePairs("sessionid=a; uv_id=2598", new Map([["sessionid", "b"], ["platform_id", "3"]]));
    ok(m.includes("sessionid=b") && m.includes("platform_id=3") && m.includes("uv_id=2598"), "⑤换值 / 追加白名单字段 / 保留原有");
    eq(mergeYktCookiePairs("sessionid=a", new Map([["random", "z"]])), "sessionid=a", "⑤非白名单字段忽略");
    eq(mergeYktCookiePairs("sessionid=a", new Map()), "sessionid=a", "⑤空 pairs 原样返回");
  }

  // ⑥ Cookie 导出 / 导入往返与拒绝
  {
    const text = buildYktCookieExportJson({ cookie: "sessionid=abc; uv_id=2598", uvId: "2598", phone: "13800000000" }, new Date("2026-09-20T04:00:00Z"));
    const j = JSON.parse(text);
    eq(j.kind, YKT_COOKIE_EXPORT_KIND, "⑥导出 kind 标识");
    eq(j.version, 1, "⑥导出 version=1");
    eq(j.sensitive, true, "⑥sensitive 敏感标注恒真");
    ok(typeof j.warn === "string" && j.warn.length > 10, "⑥warn 警示文案（脱离 UI 也在）");
    ok(j.exportedAt.startsWith("2026-09-20"), "⑥导出时间（ISO）");
    const back = parseYktCookieExportJson(text);
    eq(back.cookie, "sessionid=abc; uv_id=2598", "⑥导入回读 cookie");
    eq(back.uvId, "2598", "⑥导入回读 uvId");
    eq(back.phone, "13800000000", "⑥导入回读 phone");
    const j2 = JSON.parse(buildYktCookieExportJson({ cookie: "sessionid=abc" }));
    eq(j2.phone, undefined, "⑥phone 缺省不设");

    let berr;
    try {
      buildYktCookieExportJson({ cookie: "uv_id=2598" });
    } catch (e) {
      berr = e;
    }
    ok(berr instanceof Error && berr.message.includes("sessionid"), "⑥缺 sessionid 拒绝导出");

    let perr;
    try {
      parseYktCookieExportJson("not json");
    } catch (e) {
      perr = e;
    }
    ok(perr instanceof Error && perr.message.includes("JSON"), "⑥坏 JSON 拒绝导入");
    try {
      parseYktCookieExportJson(JSON.stringify({ kind: "other", version: 1, cookie: "sessionid=a" }));
    } catch (e) {
      perr = e;
    }
    ok(perr instanceof Error && perr.message.includes("类型不符"), "⑥kind 不符拒绝导入");
    try {
      parseYktCookieExportJson(JSON.stringify({ kind: YKT_COOKIE_EXPORT_KIND, version: 2, cookie: "sessionid=a" }));
    } catch (e) {
      perr = e;
    }
    ok(perr instanceof Error && perr.message.includes("版本"), "⑥版本不符拒绝导入");
    try {
      parseYktCookieExportJson(JSON.stringify({ kind: YKT_COOKIE_EXPORT_KIND, version: 1, cookie: "uv_id=2598" }));
    } catch (e) {
      perr = e;
    }
    ok(perr instanceof Error && perr.message.includes("sessionid"), "⑥会话串缺 sessionid 拒绝导入");
  }

  // ⑦ 编排层：yuketang 失效只进 errors（无自动重登路径，不加前缀、不触发 Tyche 重登）
  if (canResolveTs) {
    const { refreshExternalHomework, resetTycheSessionRetryState, resetTuojSessionRetryState } = await import(
      "../packages/core/src/exthw/index.ts"
    );
    resetTycheSessionRetryState();
    resetTuojSessionRetryState();
    const creds = { yuketang: { cookie: "sessionid=dead", uvId: "2598" } };
    const r = await refreshExternalHomework({
      getCreds: () => creds,
      fetchLike: async () => new Response("unauthorized", { status: 401 }),
    });
    ok(typeof r.errors.yuketang === "string" && r.errors.yuketang.includes("会话已失效"), "⑦yuketang 失效文案进 errors 且含「会话已失效」");
    ok(!r.errors.yuketang.includes("已尝试自动重新登录"), "⑦无静默重登路径 → 不加自动重登前缀");
    eq(r.reloginTyche, false, "⑦不误触发 Tyche 自动重登");
    eq(r.items.length, 0, "⑦yuketang 单源失效时 items 为空");
  }
}

/* ───────────────────────── 汇总 ───────────────────────── */
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
