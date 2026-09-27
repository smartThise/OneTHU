/**
 * R20-B1：雨课堂作业详情归一化单测（离线，mock 响应，不打真实平台）。
 *
 * 运行：node tools/ykt-exercise-detail-test.mjs
 * 覆盖（字段依据 docs/外部作业源-需求与实现方案.md 28.4 实测快照，已脱敏）：
 *  - exercise 级映射：name / description / max_retry / is_allowed_late_submission /
 *    answer_count / font → fontUrl
 *  - 单题映射：problem_id（String 化）/ index / content{ ProblemType, TypeText, Body,
 *    Options, AllowResults, score, max_retry } / user{ my_answer.content, remark,
 *    comment[], my_score, status, count, my_count }
 *  - R20-C1 剩余重交次数：user.count>0 → remainingRetries = count - my_count（缺省 0）；
 *    count<=0/缺失 → 不设（不限/未知，web 端置 999，不得当 0）
 *  - R20-C2 新字段映射：user.count → totalCount（原值，缺失不设）/ user.my_count → usedCount
 *    （缺失按 0 参与计算但字段仅在存在时设置）/ user.submit_time → submitTime（毫秒 →
 *    "YYYY-MM-DD HH:MM"，缺失/非数字/0 不设）/ user.submission_status → submissionStatus
 *    （原样透传，存在才设）
 *  - R20-C2 late_submission 双口径容错（不下结论，28.11 vs 28.1 冲突待 P1b）：数字（毫秒）
 *    → lateDeadline；对象含 deduct_score → lateDeductScore（此时 lateDeadline 不设）；
 *    对象无 deduct_score / 都不是 → 均不设
 *  - 三态（保守）：status 4=已批改 / 3=已交未批 / 无 user 或（无显式 status 且
 *    answer_count=0 无作答痕迹）→ 未答
 *  - 得分透出条件：仅「已批改」且为有效数字（含真实 0 分）；-1 / "-1.00" 占位、
 *    缺失、已交未批 → 一律不透出（避免未出分显示 0）
 *  - 请求形状：路径 /mooc-api/v1/lms/exercise/get_exercise_list/{leaf}/、
 *    classroom_id / term=latest / uv_id、头 XTBZ: ykt + 既有 UA；uvId 参数 → 凭据 uvId → "2598" 回落
 *  - 缺字段容错：data 空对象 / problems 缺失 / content·user 缺字段 / 字符串数字 → 不崩给默认值
 *  - 异常：errcode≠0 / 缺 data / leafTypeId 空 / HTTP 401 → 抛带上下文的错误
 */
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";

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
function deepEq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(same, `${msg}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/** 构造按 URL 路由的 mock fetchLike；记录每次请求 {url, method, headers}（与 exthw-status-test 同款） */
function makeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = v;
    calls.push({ url, method, headers });
    for (const r of routes) {
      if (r.match(url)) {
        if (r.throw) throw new Error(r.throw);
        return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}), {
          status: r.status ?? 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

async function rejects(fn, needle, msg) {
  try {
    await fn();
    ok(false, `${msg}（未抛错）`);
  } catch (e) {
    ok(String(e?.message ?? e).includes(needle), `${msg}（错误含「${needle}」）`);
  }
}

/** 脱敏快照（按 28.4 实测字段构造）：3 题 = 已批改 / 已交未批 / 未答 全覆盖 */
const SNAPSHOT = {
  errcode: 0,
  data: {
    name: "第 2 次平时作业",
    description: "<p>请在截止前完成，支持补交。</p>",
    max_retry: 3,
    is_allowed_late_submission: true,
    late_submission: 1760000000000,
    answer_count: 2,
    score_type: 1,
    font: "https://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_0123abcd5678.ttf",
    problems: [
      {
        problem_id: 40201,
        index: 1,
        content: {
          ProblemType: 1,
          TypeText: "单选题",
          Body: '<p>下列说法正确的是（ ）<span class="xuetangx-com-encrypted-font">𛈒𛈒</span></p>',
          Options: [
            { name: "A", value: 0, content: "选项一" },
            { name: "B", value: 1, content: "选项二" },
          ],
          AllowResults: ["text", "pic", "file"],
          score: 2,
          data: { answer: 1 },
          max_retry: 1,
        },
        content_score: 2,
        submission_status: 1,
        review_detail: null,
        user: {
          my_answer: { content: "<p>B</p>", attachment: [] },
          remark: "",
          comment: [],
          my_score: "2.00",
          status: 4,
          count: 1,
        },
      },
      {
        problem_id: 40202,
        index: 2,
        content: {
          ProblemType: 5,
          TypeText: "主观题",
          Body: "<p>简述……（脱敏）</p>",
          AllowResults: ["text", "pic", "file"],
          score: 8,
          max_retry: 3,
        },
        user: {
          my_answer: { content: "<p>我的作答（脱敏）</p>", attachment: [{ id: 7, name: "fig.png" }] },
          remark: "注意结合课程内容作答",
          comment: [
            { content: "第 2 段论证不够充分", name: "张老师", index: 2, avatar: "", attachment: "" },
            { content: "整体思路清晰", name: "张老师" },
          ],
          my_score: "-1.00",
          status: 3,
        },
      },
      {
        // 无 user → 未答；content 缺 AllowResults / max_retry → 默认值
        problem_id: 40203,
        index: 3,
        content: { ProblemType: 2, TypeText: "多选题", Body: "<p>（脱敏）</p>", Options: [], score: 2 },
      },
      {
        // R24 fix ②（2026-09-23 实测快照）：拍图作答 —— content 为空、图片在 my_answer.pics[]
        problem_id: 40204,
        index: 4,
        content: { ProblemType: 5, TypeText: "主观题", Body: "<p>（脱敏）</p>", AllowResults: ["pic"], score: 10 },
        user: {
          my_answer: {
            content: "",
            time: "0",
            oSubject: { attachments: { filelist: [] } },
            pics: [
              { status: "success", name: "a.jpg", url: "blob:https://pro.yuketang.cn/xxxx", fileUrl: "https://qn1-next.xuetangonline.com/17896291161802.jpg", size: 602285 },
              { status: "success", name: "b.jpg", url: "blob:https://pro.yuketang.cn/yyyy", fileUrl: "https://qn1-next.xuetangonline.com/17896291212185.jpg", size: 423885 },
            ],
          },
          remark: "已批",
          comment: [],
          my_score: "8.00",
          status: 4,
          submit_time: "2026-09-17 15:15",
          my_count: 1,
          count: 5,
        },
      },
    ],
  },
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.88 Safari/537.36";

/* ───────────────── [1] 脱敏快照归一化 ───────────────── */
console.log("\n[1] 快照归一化（exercise 级 + 单题字段映射）");
{
  const fetchLike = makeFetch([{ match: (u) => u.includes("/get_exercise_list/1234/"), body: SNAPSHOT }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const d = await src.getExerciseDetail("1234", "77");

  eq(d.name, "第 2 次平时作业", "name 透传");
  eq(d.description, "<p>请在截止前完成，支持补交。</p>", "description 透传");
  eq(d.maxRetry, 3, "max_retry → maxRetry");
  eq(d.lateAllowed, true, "is_allowed_late_submission → lateAllowed");
  eq(d.answerCount, 2, "answer_count → answerCount");
  eq(d.fontUrl, "https://fe-static-yuketang.yuketang.cn/fe_font/product/exam_font_0123abcd5678.ttf", "font → fontUrl");
  eq(d.problems.length, 4, "problems 数量");

  const p1 = d.problems[0];
  eq(p1.problemId, "40201", "problem_id String 化");
  eq(p1.index, 1, "index 透传");
  eq(p1.type, 1, "ProblemType → type");
  eq(p1.typeText, "单选题", "TypeText → typeText");
  eq(p1.score, 2, "content.score → score");
  ok(p1.bodyHtml.includes('xuetangx-com-encrypted-font'), "bodyHtml 保留加密字体 span");
  deepEq(p1.allowResults, ["text", "pic", "file"], "AllowResults → allowResults");
  eq(p1.maxRetry, 1, "content.max_retry → 本题 maxRetry");
  ok(Array.isArray(p1.options) && p1.options.length === 2, "Options 原样透传");
  eq(p1.myStatus, "graded", "status 4 → graded");
  eq(p1.myScore, 2, '已批改 + my_score "2.00" → myScore 2（字符串数字）');
  eq(p1.myAnswerHtml, "<p>B</p>", "my_answer.content → myAnswerHtml");
  eq(p1.remainingRetries, 1, "user.count=1（my_count 缺省 0）→ remainingRetries 1");
  // R20-C2：count 原值透传；my_count/submit_time/submission_status 缺失不设（28.4 快照无这些字段）
  eq(p1.totalCount, 1, "user.count=1 → totalCount 1（原值）");
  eq(p1.usedCount, undefined, "user.my_count 缺失 → usedCount 不设");
  eq(p1.submitTime, undefined, "user.submit_time 缺失 → submitTime 不设");
  eq(p1.submissionStatus, undefined, "user.submission_status 缺失 → submissionStatus 不设");
  eq(p1.remark, undefined, "空 remark 不设");
  eq(p1.comments, undefined, "空 comment[] 不设");

  const p2 = d.problems[1];
  eq(p2.myStatus, "submitted", "status 3 → submitted");
  eq(p2.myScore, undefined, '已交未批 + my_score "-1.00" 占位 → 不透出');
  eq(p2.remainingRetries, undefined, "无 user.count → remainingRetries 不设（不限/未知）");
  eq(p2.myAnswerHtml, "<p>我的作答（脱敏）</p>", "myAnswerHtml 透传");
  eq(p2.remark, "注意结合课程内容作答", "remark 透传");
  deepEq(
    p2.comments,
    [
      { content: "第 2 段论证不够充分", name: "张老师", index: 2 },
      { content: "整体思路清晰", name: "张老师" },
    ],
    "comment[] → comments（滤 avatar/attachment 等多余字段）",
  );

  const p3 = d.problems[2];
  eq(p3.myStatus, "unanswered", "无 user → unanswered");
  eq(p3.myAnswerHtml, undefined, "未答不给 myAnswerHtml");
  eq(p3.myScore, undefined, "未答不给 myScore");
  eq(p3.remainingRetries, undefined, "无 user → remainingRetries 不设");
  // R20-C2：无 user → 四个新字段一律不设
  eq(p3.totalCount, undefined, "无 user → totalCount 不设");
  eq(p3.usedCount, undefined, "无 user → usedCount 不设");
  eq(p3.submitTime, undefined, "无 user → submitTime 不设");
  eq(p3.submissionStatus, undefined, "无 user → submissionStatus 不设");
  deepEq(p3.allowResults, [], "缺 AllowResults → []");
  eq(p3.maxRetry, 0, "缺 content.max_retry → 0（保守）");
  deepEq(p3.options, [], "Options: [] → 空数组透传");

  // R24 fix ②（2026-09-23 实测快照）：拍图作答 —— content 空串、图片在 my_answer.pics[]
  const p4 = d.problems[3];
  eq(p4.myStatus, "graded", "pics 作答 + status 4 → graded");
  eq(p4.submitTime, "2026-09-17 15:15", "submit_time 字符串形态 → submitTime（取前 16 位）");
  eq(p4.usedCount, 1, "my_count=1 → usedCount 1");
  ok(
    p4.myAnswerHtml !== undefined && (p4.myAnswerHtml.match(/<img /g) ?? []).length === 2,
    "my_answer.pics[] → 2 张 <img> 追加进 myAnswerHtml（content 为空也能显示我的提交）",
  );
  ok(p4.myAnswerHtml.includes('src="https://qn1-next.xuetangonline.com/17896291161802.jpg"'), "img src 取 fileUrl（CDN 直链）");
  ok(!p4.myAnswerHtml.includes("blob:"), "pics[].url 的 blob: 临时引用不入 HTML");
  ok(p4.myAnswerHtml.includes('referrerpolicy="no-referrer"'), "img 带 referrerpolicy=no-referrer（CDN Referer 白名单口径）");
}

/* ───────────────── [2] 请求形状与 uvId 回落 ───────────────── */
console.log("\n[2] 请求形状（XTBZ / UA / 路径与查询串 / uvId 回落）");
{
  const fetchLike = makeFetch([{ match: (u) => u.includes("/get_exercise_list/1234/"), body: SNAPSHOT }]);
  const src = createYuketangSource({ cookie: "sessionid=abc; uv_id=2598" }, fetchLike, 30);
  await src.getExerciseDetail("1234", "77");
  const c = fetchLike.calls[0];
  ok(c.url.startsWith("https://pro.yuketang.cn/mooc-api/v1/lms/exercise/get_exercise_list/1234/"), "路径前缀正确");
  ok(c.url.includes("classroom_id=77&term=latest&uv_id=2598"), "查询串 classroom_id/term=latest/uv_id");
  eq(c.method, "GET", "GET 请求");
  eq(c.headers["xtbz"], "ykt", "头 XTBZ: ykt");
  eq(c.headers["user-agent"], UA, "UA 沿用既有常量（Chrome/79 桌面串）");
  ok((c.headers["cookie"] ?? "").includes("sessionid=abc"), "Cookie 透传");
  eq(fetchLike.calls.length, 1, "详情拉取只发一次请求");
}
{
  const fetchLike = makeFetch([{ match: (u) => u.includes("/get_exercise_list/"), body: SNAPSHOT }]);
  const src = createYuketangSource({ cookie: "sessionid=abc", uvId: "777" }, fetchLike, 30);
  await src.getExerciseDetail("1234", "77");
  ok(fetchLike.calls[0].url.includes("uv_id=777"), "uvId 参数缺省 → 凭据 uvId");
  await src.getExerciseDetail("1234", "77", "8888");
  ok(fetchLike.calls[1].url.includes("uv_id=8888"), "显式 uvId 参数优先");
}
{
  const fetchLike = makeFetch([{ match: (u) => u.includes("/get_exercise_list/"), body: SNAPSHOT }]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30); // 无 uvId
  await src.getExerciseDetail("1234", "77");
  ok(fetchLike.calls[0].url.includes("uv_id=2598"), "无任何 uvId → 清华默认 2598");
}

/* ───────────────── [3] 三态与得分透出条件 ───────────────── */
console.log("\n[3] 三态（保守）与得分透出");
{
  const mk = (problems, answerCount = 0) => ({
    data: { name: "x", answer_count: answerCount, problems },
  });
  const cases = [
    {
      body: mk([{ content: { ProblemType: 5 }, user: { status: 4, my_score: "0.00", my_answer: { content: "<p>i</p>" } } }], 1),
      status: "graded",
      score: 0,
      why: "已批改 + 真实 0 分 → myScore 0（0 是有效分）",
    },
    {
      body: mk([{ content: {}, user: { status: 4, my_answer: { content: "<p>i</p>" } } }], 1),
      status: "graded",
      score: undefined,
      why: "已批改但缺 my_score → 不透出",
    },
    {
      body: mk([{ content: {}, user: { status: 4, my_score: -1, my_answer: { content: "<p>i</p>" } } }], 1),
      status: "graded",
      score: undefined,
      why: "已批改但 my_score -1 占位（数字）→ 不透出",
    },
    {
      body: mk([{ content: {}, user: { status: 3, my_score: "30.00", my_answer: { content: "<p>i</p>" } } }], 1),
      status: "submitted",
      score: undefined,
      why: "已交未批（status 3）即使有数字分 → 不透出",
    },
    {
      body: mk([{ content: {}, user: { my_answer: { content: "<p>i</p>" } } }], 0),
      status: "submitted",
      why: "无显式 status 但有作答内容 → submitted（内容证据）",
    },
    {
      body: mk([{ content: {}, user: { my_answer: {} } }], 0),
      status: "unanswered",
      why: "无 status + answer_count=0 + 无内容 → unanswered（保守）",
    },
    {
      body: mk([{ content: {}, user: { my_answer: {} } }], 3),
      status: "submitted",
      why: "无 status 但整卷 answer_count>0 → submitted",
    },
    {
      body: mk([{ content: {} }], 5),
      status: "unanswered",
      why: "无 user（即使 answer_count>0）→ unanswered",
    },
  ];
  const fetchLike = makeFetch(
    cases.map((c, i) => ({ match: (u) => u.includes(`/get_exercise_list/500${i}/`), body: c.body })),
  );
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const d = await src.getExerciseDetail(`500${i}`, "77");
    eq(d.problems[0].myStatus, c.status, c.why.replace(/→.*/, `→ ${c.status}`));
    if ("score" in c) eq(d.problems[0].myScore, c.score, c.why);
  }
}

/* ───────────────── [4] 缺字段容错 ───────────────── */
console.log("\n[4] 缺字段容错（不崩，给默认值）");
{
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/get_exercise_list/6001/"), body: { data: {} } },
    { match: (u) => u.includes("/get_exercise_list/6002/"), body: { data: { problems: [{ content: {} }, {}] } } },
    { match: (u) => u.includes("/get_exercise_list/6003/"), body: { data: { max_retry: "2", problems: [] } } },
    { match: (u) => u.includes("/get_exercise_list/6004/"), body: { data: { font: null, name: null } } },
    {
      match: (u) => u.includes("/get_exercise_list/6005/"),
      body: {
        data: {
          problems: [
            { content: {}, user: { count: 3, my_count: 3 } },
            { content: {}, user: { count: 0, my_count: 0 } },
            { content: {}, user: { count: "2", my_count: "1" } },
            { content: {}, user: { count: 1 } },
          ],
        },
      },
    },
  ]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);

  const d1 = await src.getExerciseDetail("6001", "77");
  eq(d1.name, "", "data:{} → name 空串");
  eq(d1.description, "", "data:{} → description 空串");
  eq(d1.maxRetry, 0, "data:{} → maxRetry 0");
  eq(d1.lateAllowed, false, "data:{} → lateAllowed false");
  eq(d1.answerCount, 0, "data:{} → answerCount 0");
  eq(d1.fontUrl, undefined, "data:{} → fontUrl 不设");
  deepEq(d1.problems, [], "data:{} → problems []");

  const d2 = await src.getExerciseDetail("6002", "77");
  const q1 = d2.problems[0];
  eq(q1.type, 0, "content 缺 ProblemType → type 0");
  eq(q1.typeText, "", "content 缺 TypeText → 空串");
  eq(q1.bodyHtml, "", "content 缺 Body → 空串");
  eq(q1.score, 0, "content 缺 score → 0");
  deepEq(q1.allowResults, [], "content 缺 AllowResults → []");
  eq(q1.myStatus, "unanswered", "缺 user → unanswered");
  const q2 = d2.problems[1];
  eq(q2.problemId, "", "整题缺 problem_id → 空串不崩");
  eq(q2.index, 2, "缺 index → 数组序兜底（第 2 题 = 2）");
  eq(q2.myStatus, "unanswered", "缺 content+user → unanswered");

  const d3 = await src.getExerciseDetail("6003", "77");
  eq(d3.maxRetry, 2, 'max_retry 字符串 "2" → 2（字符串数字）');

  const d4 = await src.getExerciseDetail("6004", "77");
  eq(d4.fontUrl, undefined, "font:null → fontUrl 不设");
  eq(d4.name, "", "name:null → 空串");

  // R20-C1：剩余重交次数口径（web left_times 同款；count<=0 = 不限次不设）
  const d5 = await src.getExerciseDetail("6005", "77");
  eq(d5.problems[0].remainingRetries, 0, "count=3 my_count=3 → remainingRetries 0（已用完）");
  eq(d5.problems[1].remainingRetries, undefined, "count=0 → 不设（不限次，web 端置 999）");
  eq(d5.problems[2].remainingRetries, 1, 'count="2" my_count="1"（字符串数字）→ 1');
  eq(d5.problems[3].remainingRetries, 1, "count=1 my_count 缺省 → 1（缺省按 0）");
  // R20-C2：totalCount / usedCount 原值透传（含 0 与字符串数字；my_count 缺失不设）
  eq(d5.problems[0].totalCount, 3, "count=3 → totalCount 3（原值）");
  eq(d5.problems[0].usedCount, 3, "my_count=3 → usedCount 3（原值）");
  eq(d5.problems[1].totalCount, 0, "count=0 → totalCount 0（原值透传，不限次判定看 remainingRetries）");
  eq(d5.problems[1].usedCount, 0, "my_count=0 → usedCount 0（原值透传）");
  eq(d5.problems[2].totalCount, 2, 'count="2" → totalCount 2（字符串数字）');
  eq(d5.problems[2].usedCount, 1, 'my_count="1" → usedCount 1（字符串数字）');
  eq(d5.problems[3].totalCount, 1, "count=1 → totalCount 1");
  eq(d5.problems[3].usedCount, undefined, "my_count 缺失 → usedCount 不设");
}

/* ───────────────── [5] 异常（带上下文抛错） ───────────────── */
console.log("\n[5] 异常路径");
{
  const fetchLike = makeFetch([
    { match: (u) => u.includes("/get_exercise_list/7001/"), body: { errcode: 401000, errmsg: "login needed" } },
    { match: (u) => u.includes("/get_exercise_list/7002/"), body: { msg: "no data" } },
    { match: (u) => u.includes("/get_exercise_list/7003/"), body: "<html>login</html>" },
    { match: (u) => u.includes("/get_exercise_list/7004/"), body: { data: {} }, status: 401 },
  ]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);
  await rejects(() => src.getExerciseDetail("7001", "77"), "401000", "errcode≠0 → 抛 errcode 上下文");
  await rejects(() => src.getExerciseDetail("7002", "77"), "缺 data", "缺 data → 抛「缺 data」");
  await rejects(() => src.getExerciseDetail("7003", "77"), "非 JSON", "HTML 响应 → 抛非 JSON");
  await rejects(() => src.getExerciseDetail("7004", "77"), "会话已失效", "HTTP 401 → 抛会话失效");
  await rejects(() => src.getExerciseDetail("", "77"), "leafTypeId", "空 leafTypeId → 抛参数错误");
  await rejects(() => src.getExerciseDetail("   ", "77"), "leafTypeId", "空白 leafTypeId → 抛参数错误");
}

/* ───────────────── [6] R20-C2 新字段映射（有值 / 缺失 / 对象形态 late_submission） ───────────────── */
console.log("\n[6] R20-C2 新字段（totalCount/usedCount/submitTime/submissionStatus + late_submission 双口径）");
{
  const submitMs = 1760000000000;
  // 与 core fmtLocal 同式的本地时间格式化（时区无关，用于生成期望值）
  const fmt = (ms) => {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const mkBody = (lateSubmission, user) => ({
    errcode: 0,
    data: {
      name: "C2",
      is_allowed_late_submission: true,
      ...(lateSubmission !== undefined ? { late_submission: lateSubmission } : {}),
      answer_count: 1,
      problems: [
        {
          problem_id: 9001,
          index: 1,
          content: { ProblemType: 5, TypeText: "主观题", Body: "<p>x</p>", score: 5 },
          ...(user !== undefined ? { user } : {}),
        },
      ],
    },
  });
  const fetchLike = makeFetch([
    // ① 有值：四个新字段全给 + 数字形态 late_submission → lateDeadline
    {
      match: (u) => u.includes("/get_exercise_list/8101/"),
      body: mkBody(submitMs, { count: 5, my_count: 2, submit_time: submitMs, submission_status: 2, my_answer: { content: "<p>a</p>" } }),
    },
    // ② 缺失：user 无新字段、data 无 late_submission → 全部不设
    { match: (u) => u.includes("/get_exercise_list/8102/"), body: mkBody(undefined, { my_answer: {} }) },
    // ③ 对象形态 late_submission（docs §28.11：含 deduct_score）→ lateDeductScore，lateDeadline 不设
    {
      match: (u) => u.includes("/get_exercise_list/8103/"),
      body: mkBody({ deduct_score: 2, deadline: "2026-01-01" }, { count: 3, my_count: 1, submit_time: submitMs, submission_status: 1 }),
    },
    // ③b 对象但无 deduct_score → 两者都不设
    { match: (u) => u.includes("/get_exercise_list/8104/"), body: mkBody({ other: 1 }, {}) },
    // ④ 字符串数字：count/my_count/submit_time/submission_status 均为数字串 → 照常解析
    {
      match: (u) => u.includes("/get_exercise_list/8105/"),
      body: mkBody("1760000000000", { count: "4", my_count: "1", submit_time: "1760000000000", submission_status: "3" }),
    },
    // ⑤ 0 值：late_submission=0 / submit_time=0 → falsy 同官方 truthiness 口径，不设
    { match: (u) => u.includes("/get_exercise_list/8106/"), body: mkBody(0, { submit_time: 0, count: 0 }) },
  ]);
  const src = createYuketangSource({ cookie: "s=1" }, fetchLike, 30);

  // ① 有值
  const d1 = await src.getExerciseDetail("8101", "77");
  eq(d1.problems[0].totalCount, 5, "user.count=5 → totalCount 5（原值）");
  eq(d1.problems[0].usedCount, 2, "user.my_count=2 → usedCount 2（原值）");
  eq(d1.problems[0].remainingRetries, 3, "remainingRetries 语义不变：5-2=3");
  eq(d1.problems[0].submitTime, fmt(submitMs), "user.submit_time（毫秒）→ submitTime 本地 YYYY-MM-DD HH:MM");
  eq(d1.problems[0].submissionStatus, 2, "user.submission_status=2 → submissionStatus 2（原样透传）");
  eq(d1.lateDeadline, fmt(submitMs), "late_submission 数字（毫秒）→ lateDeadline（R20-B2 行为不变）");
  eq(d1.lateDeductScore, undefined, "数字形态 → lateDeductScore 不设");

  // ② 缺失
  const d2 = await src.getExerciseDetail("8102", "77");
  eq(d2.problems[0].totalCount, undefined, "user.count 缺失 → totalCount 不设");
  eq(d2.problems[0].usedCount, undefined, "user.my_count 缺失 → usedCount 不设");
  eq(d2.problems[0].submitTime, undefined, "user.submit_time 缺失 → submitTime 不设");
  eq(d2.problems[0].submissionStatus, undefined, "user.submission_status 缺失 → submissionStatus 不设");
  eq(d2.lateDeadline, undefined, "late_submission 缺失 → lateDeadline 不设");
  eq(d2.lateDeductScore, undefined, "late_submission 缺失 → lateDeductScore 不设");

  // ③ 对象形态（含 deduct_score）
  const d3 = await src.getExerciseDetail("8103", "77");
  eq(d3.lateDeductScore, 2, "late_submission 对象 deduct_score=2 → lateDeductScore 2");
  eq(d3.lateDeadline, undefined, "对象形态 → lateDeadline 不设（不下结论，待 P1b 定稿）");
  eq(d3.problems[0].submitTime, fmt(submitMs), "对象形态 late_submission 不影响题级 submitTime 映射");
  eq(d3.problems[0].submissionStatus, 1, "对象形态 late_submission 不影响题级 submissionStatus 映射");
  eq(d3.problems[0].remainingRetries, 2, "对象形态 late_submission 不影响 remainingRetries（3-1=2）");

  // ③b 对象但无 deduct_score
  const d4 = await src.getExerciseDetail("8104", "77");
  eq(d4.lateDeductScore, undefined, "对象无 deduct_score → lateDeductScore 不设");
  eq(d4.lateDeadline, undefined, "对象无 deduct_score → lateDeadline 不设");
  eq(d4.problems[0].totalCount, undefined, "无 user → totalCount 不设");

  // ④ 字符串数字
  const d5 = await src.getExerciseDetail("8105", "77");
  eq(d5.problems[0].totalCount, 4, 'count="4"（数字串）→ totalCount 4');
  eq(d5.problems[0].usedCount, 1, 'my_count="1"（数字串）→ usedCount 1');
  eq(d5.problems[0].remainingRetries, 3, "数字串 4-1 → remainingRetries 3");
  eq(d5.problems[0].submitTime, fmt(submitMs), 'submit_time="1760000000000"（数字串）→ submitTime');
  eq(d5.problems[0].submissionStatus, 3, 'submission_status="3"（数字串）→ submissionStatus 3');
  eq(d5.lateDeadline, fmt(submitMs), 'late_submission="1760000000000"（数字串）→ lateDeadline');

  // ⑤ 0 值
  const d6 = await src.getExerciseDetail("8106", "77");
  eq(d6.lateDeadline, undefined, "late_submission=0 → lateDeadline 不设");
  eq(d6.lateDeductScore, undefined, "late_submission=0 → lateDeductScore 不设");
  eq(d6.problems[0].submitTime, undefined, "submit_time=0（官方 falsy，视作未提交）→ submitTime 不设");
  eq(d6.problems[0].totalCount, 0, "count=0 → totalCount 0（原值透传）");
  eq(d6.problems[0].remainingRetries, undefined, "count=0 → remainingRetries 语义不变（不设）");
}

console.log(`\n合计：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail > 0 ? 1 : 0;
if (fail > 0) console.error("存在失败断言，详见上方 ✗");
