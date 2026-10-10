/**
 * R20-B2：雨课堂原生作业详情页 —— 纯判定/展示函数 + core 新透出字段 单测（离线，mock，不打真实平台）。
 * R20-B2b：入口默认原生改版 —— [1] 改为全平台口径 + [5] 新增点击入口接线静态审计。
 *
 * 运行：node tools/ykt-detail-ui-test.mjs
 *
 * 覆盖：
 *  [1] 入口分流（apps/desktop/src/lib/yktDetail.ts）：
 *      pickHomeworkRoute 三态统一判定 —— yuketang + 参数齐备 → ykt-native
 *      （R20-B2b 起全平台默认原生，不再看 Android 宿主）；非雨课堂 / 缺参数 → external-web；
 *      无 source → internal。pickYktDetailEntry = ykt-native 的两态投影（旧口径兼容）。
 *  [2] 展示口径（同文件）：yktStatusChip 三态徽标（真实 0 分也显示）/ yktScoreText /
 *      yktTypeText（typeText 缺失时按 ProblemType 兜底）/ yktIsExternalLinkProblem（题型 9 红线）/
 *      yktAttachmentsText（空 → ""；无名附件回退 url / 占位）
 *  [3] 整卷汇总 yktExerciseSummary：answered / graded / scoreSum（无一题有分 → undefined）/
 *      整卷批改徽标（未作答·已交未批·部分已批·已批改·无题目）
 *  [4] core R20-B2 新透出字段（packages/core/src/exthw/yuketang.ts）：
 *      - 列表项 leaf_type_id → leafTypeId（String 化）、classroom_id → classroomId
 *      - 详情 late_submission → lateDeadline（毫秒 → 本地 "YYYY-MM-DD HH:MM"；缺失/0 → 不设）
 *      - my_answer.attachment（非对象元素过滤、空白名过滤、空数组 → 不设）
 *      - 题型 9 content.data.answer_problem_url → externalUrl（仅 http(s)；非题型 9 / 非法 url 不设）
 *  [5] R20-B2b 入口接线静态审计（漏接回归网）：全部作业/课程详情（shared.tsx）、今日页与
 *      收藏夹作业卡（HomeWidgets.tsx）、全局搜索（SearchPage.tsx）三处点击点必须统一走
 *      openHomeworkRow（lib/homeworkEntry.ts），不得自拼判定 / 直连详情页；原生详情页保留
 *      「浏览器打开」备用出口（openExternalHomework：桌面系统浏览器 / 移动 R20-A WebView）。
 *  [6] R20-B3：老师评语去重 dedupeYktRemarks（remark 与 comment[] 同文只渲染一处，优先具名
 *      批注口径；不同文全保留；批注间自身去重）+ 入口分数口径 homeworkEntryScoreText
 *      （考试 / 已批改雨课堂作业共用：已提交且带分 → "X/Y"；无分不显示）+ 两处接线静态审计。
 *  [7] R20-C1：作答/提交入口资格 yktSubmitEligibility（红线：试卷 / 全外链题永不出入口；
 *      时间窗未过截止或允许补交；未超 max_retry）+ parseYktLocalTime 解析口径 +
 *      详情页接线静态审计（入口仅在 eligible 渲染、二次确认、注入 Cookie、关闭后重拉）。
 *
 * 覆盖边界：homeworkEntry.ts openHomeworkRow / toHomework 的 externalLeafTypeId/
 * externalClassroomId 两行映射与 state/exthw.ts fetchYktExerciseDetail 依赖
 * @tauri-apps / localStorage（Node 无法加载），由 pnpm typecheck + [5] 静态审计 +
 * 真机烟测覆盖（docs 28.8 / 28.9）。
 */
import { registerHooks } from "node:module";
import { createYuketangSource } from "../packages/core/src/exthw/yuketang.ts";

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

const { pickYktDetailEntry, pickHomeworkRoute, yktStatusChip, yktExerciseSummary, yktTypeText, yktIsExternalLinkProblem, yktAttachmentsText, yktScoreText, dedupeYktRemarks, homeworkEntryScoreText, yktSubmitEligibility, yktAnswerPanelState, parseYktLocalTime } = await import(
  "../apps/desktop/src/lib/yktDetail.ts"
);

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

/** 构造按 URL 路由的 mock fetchLike（与 ykt-exercise-detail-test 同款） */
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

/** 毫秒时间戳 → 本地 "YYYY-MM-DD HH:MM"（与 core fmtLocal 同式，仅用于断言） */
function fmtExpect(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const YKT_BASE = "https://pro.yuketang.cn";

/* ───────────────── [1] 入口分流（R20-B2b：全平台默认原生） ───────────────── */
console.log("\n[1] 入口分流 pickHomeworkRoute / pickYktDetailEntry（R20-B2b 默认原生）");
{
  // 判定不再收宿主参数：PC 与 Android 同一口径，签名单参化
  eq(pickHomeworkRoute({ source: "yuketang", externalLeafTypeId: "100123", externalClassroomId: "777" }), "ykt-native", "雨课堂 + 参数齐备 → ykt-native（全平台默认原生，PC 亦然）");
  eq(pickHomeworkRoute({ source: "yuketang", externalClassroomId: "777" }), "external-web", "缺 leafTypeId → external-web（详情拉不了，别把用户带进死页）");
  eq(pickHomeworkRoute({ source: "yuketang", externalLeafTypeId: "100123" }), "external-web", "缺 classroomId → external-web");
  eq(pickHomeworkRoute({ source: "yuketang" }), "external-web", "双参数全缺 → external-web");
  eq(pickHomeworkRoute({ source: "yuketang", externalLeafTypeId: "", externalClassroomId: "" }), "external-web", "空串参数视同缺失 → external-web");
  eq(pickHomeworkRoute({ source: "tuoj", externalLeafTypeId: "1", externalClassroomId: "1" }), "external-web", "非雨课堂源 → external-web（R20-A 通道）");
  eq(pickHomeworkRoute({}), "internal", "内部作业（无 source）→ internal（站内详情）");

  // 两态投影（旧口径兼容）：native ⇔ ykt-native
  eq(pickYktDetailEntry({ source: "yuketang", externalLeafTypeId: "100123", externalClassroomId: "777" }), "native", "pickYktDetailEntry 投影：参数齐备 → native");
  eq(pickYktDetailEntry({ source: "yuketang", externalLeafTypeId: "100123" }), "external", "pickYktDetailEntry 投影：缺参 → external");
}

/* ───────────────── [2] 展示口径 ───────────────── */
console.log("\n[2] 展示口径（徽标 / 题型 / 附件文案）");
{
  deepEq(yktStatusChip({ myStatus: "graded", myScore: 2.5 }), { text: "已批 2.5 分", cls: "chip-blue" }, "已批改 + 分数 → 蓝徽标带分");
  deepEq(yktStatusChip({ myStatus: "graded", myScore: 0 }), { text: "已批 0 分", cls: "chip-blue" }, "真实 0 分（core 已剔 -1 占位）→ 照显 0 分");
  deepEq(yktStatusChip({ myStatus: "graded" }), { text: "已批改", cls: "chip-blue" }, "已批改无分 → 蓝徽标不带分");
  deepEq(yktStatusChip({ myStatus: "submitted" }), { text: "已交未批", cls: "chip-green" }, "已交未批 → 绿徽标");
  deepEq(yktStatusChip({ myStatus: "unanswered" }), { text: "未作答", cls: "chip-gray" }, "未作答 → 灰徽标");

  eq(yktScoreText(2), "2", "整数分不带小数尾零");
  eq(yktScoreText(2.5), "2.5", "半分照显");
  eq(yktScoreText(0), "0", "0 分照显");

  eq(yktTypeText({ type: 1, typeText: "单选题" }), "单选题", "typeText 存在 → 直用");
  eq(yktTypeText({ type: 2, typeText: "" }), "多选题", "typeText 空 → ProblemType 兜底（多选）");
  eq(yktTypeText({ type: 3, typeText: "  " }), "判断题", "typeText 纯空白 → 兜底（判断）");
  eq(yktTypeText({ type: 9, typeText: "" }), "外链题", "题型 9 → 外链题");
  eq(yktTypeText({ type: 99, typeText: "" }), "题目", "未知题型 → 中性兜底");

  eq(yktIsExternalLinkProblem({ type: 9 }), true, "题型 9 识别（红线：只给外链跳转）");
  eq(yktIsExternalLinkProblem({ type: 5 }), false, "主观题非外链");
  eq(yktIsExternalLinkProblem({ type: 0 }), false, "缺题型（0）非外链");

  eq(yktAttachmentsText(undefined), "", "无附件字段 → 空串（不渲染附件行）");
  eq(yktAttachmentsText([]), "", "空数组 → 空串");
  eq(yktAttachmentsText([{ name: "fig.png" }, { url: "https://cdn.x/b.pdf" }, { name: "  " }]), "fig.png、https://cdn.x/b.pdf、附件", "无名附件回退 url，再回退占位");
}

/* ───────────────── [3] 整卷汇总 ───────────────── */
console.log("\n[3] 整卷汇总 yktExerciseSummary");
{
  const P = (o) => ({ myStatus: "unanswered", ...o });
  const mixed = [
    P({ myStatus: "unanswered" }),
    P({ myStatus: "submitted" }),
    P({ myStatus: "graded", myScore: 2.5 }),
    P({ myStatus: "graded" }), // 已批但未透分（-1 占位被 core 剔除的形态）→ 不计入 scoreSum
  ];
  let s = yktExerciseSummary(mixed);
  eq(s.total, 4, "total = 题目数");
  eq(s.answered, 3, "answered = 已作答（submitted+graded）");
  eq(s.graded, 2, "graded = 已批改数");
  eq(s.scoreSum, 2.5, "scoreSum 只累加透出的得分（已批未透分不计）");
  deepEq(s.chip, { text: "已批 2/4 题", cls: "chip-blue" }, "部分已批 → 蓝徽标带进度");

  s = yktExerciseSummary([P({ myStatus: "graded", myScore: 8 }), P({ myStatus: "graded", myScore: 2 })]);
  eq(s.scoreSum, 10, "全批 → 合计");
  deepEq(s.chip, { text: "已批改", cls: "chip-blue" }, "全部已批 → 已批改");

  s = yktExerciseSummary([P({ myStatus: "submitted" }), P({ myStatus: "submitted" })]);
  eq(s.scoreSum, undefined, "无一题透分 → scoreSum 不设（避免误导 0 分）");
  deepEq(s.chip, { text: "已交未批", cls: "chip-green" }, "已交全未批 → 绿徽标");

  s = yktExerciseSummary([P({ myStatus: "unanswered" })]);
  deepEq(s.chip, { text: "未作答", cls: "chip-gray" }, "全未作答 → 灰徽标");
  eq(s.answered, 0, "全未作答 answered=0");

  s = yktExerciseSummary([]);
  deepEq(s.chip, { text: "无题目", cls: "chip-gray" }, "空 problems → 无题目（不崩）");
  eq(s.scoreSum, undefined, "空卷无得分");
}

/* ───────────────── [4] core R20-B2 新透出字段 ───────────────── */
console.log("\n[4] core：列表 leafTypeId/classroomId + 详情 lateDeadline/附件/题型9外链");
{
  // 4a. 列表项参数透出（R20-B2 原生详情入口的数据前提）
  const futureMs = Date.now() + 5 * 86400000;
  const fetchLike = makeFetch([
    {
      match: (u) => u.includes("/v2/api/web/courses/list"),
      body: { errcode: 0, data: { list: [{ classroom_id: "777", name: "雨课堂测试课", role: 5 }] } },
    },
    {
      match: (u) => u.includes("/v2/api/web/logs/learn/777"),
      body: {
        errcode: 0,
        data: {
          activities: [
            {
              type: 19,
              id: 901,
              title: "第一章作业",
              classroom_id: "777",
              content: { score_d: futureMs, leaf_type_id: 100123, leaf_id: "abc123", sku_id: "555" },
            },
            {
              // 缺 leaf_type_id（老课堂形态）→ 参数不设，UI 回退网页打开
              type: 19,
              id: 902,
              title: "无 leaf 的作业",
              classroom_id: "777",
              content: { score_d: futureMs, leaf_id: "def456" },
            },
          ],
        },
      },
    },
  ]);
  const src = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike, 30);
  const list = await src.fetch();
  eq(list.length, 2, "列表条数");
  eq(list[0].leafTypeId, "100123", "leaf_type_id → leafTypeId（String 化）");
  eq(list[0].classroomId, "777", "classroom_id → classroomId");
  eq(list[1].leafTypeId, undefined, "缺 leaf_type_id → 不设（入口分流回退 external）");
  eq(list[1].classroomId, "777", "classroomId 仍透出");

  // 4b. 详情新字段：lateDeadline / myAnswerAttachments / 题型9 externalUrl
  const LATE_MS = 1760000000000;
  const DETAIL = {
    errcode: 0,
    data: {
      name: "外链与附件作业",
      max_retry: 1,
      is_allowed_late_submission: false,
      late_submission: LATE_MS,
      answer_count: 2,
      problems: [
        {
          problem_id: 50101,
          index: 1,
          content: {
            ProblemType: 9,
            TypeText: "外链接题",
            Body: "<p>请到 OJ 平台完成本题</p>",
            score: 10,
            data: { answer_problem_url: "https://leetcode.cn/problems/two-sum/" },
          },
          user: { my_answer: { content: "" }, status: 4, my_score: "9.00" },
        },
        {
          problem_id: 50102,
          index: 2,
          content: {
            ProblemType: 9,
            TypeText: "",
            Body: "<p>非法外链形态</p>",
            score: 10,
            data: { answer_problem_url: "javascript:alert(1)" },
          },
          user: { my_answer: { content: "" }, status: 3 },
        },
        {
          problem_id: 50103,
          index: 3,
          content: {
            ProblemType: 5,
            TypeText: "主观题",
            Body: "<p>上传截图</p>",
            score: 5,
          },
          user: {
            my_answer: { content: "<p>见附件</p>", attachment: [{ id: 7, name: "fig.png" }, "junk", {}, { name: "  " }] },
            remark: "记得附源码",
            status: 4,
            my_score: "4.50",
          },
        },
        {
          // 无 attachment / 无 data → 相关字段不设
          problem_id: 50104,
          index: 4,
          content: { ProblemType: 5, TypeText: "主观题", Body: "<p>（脱敏）</p>", score: 5 },
          user: { my_answer: { content: "<p>正文</p>" }, status: 3 },
        },
      ],
    },
  };
  const fetchLike2 = makeFetch([{ match: (u) => u.includes("/get_exercise_list/100123/"), body: DETAIL }]);
  const src2 = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike2, 30);
  const d = await src2.getExerciseDetail("100123", "777");

  eq(d.lateDeadline, fmtExpect(LATE_MS), "late_submission（毫秒）→ lateDeadline（本地 YYYY-MM-DD HH:MM）");
  const p9a = d.problems[0];
  eq(p9a.type, 9, "题型 9 归一化");
  eq(p9a.externalUrl, "https://leetcode.cn/problems/two-sum/", "题型 9 answer_problem_url → externalUrl");
  eq(d.problems[1].externalUrl, undefined, "非 http(s) 外链拒收（红线：不在站内提交）");
  eq(d.problems[2].type, 5, "主观题非外链");
  deepEq(d.problems[2].myAnswerAttachments, [{ name: "fig.png" }], "attachment 非对象/空白名过滤");
  eq(d.problems[3].myAnswerAttachments, undefined, "无 attachment → 不设");
  eq(d.problems[3].externalUrl, undefined, "非题型 9 恒无 externalUrl");
  eq(d.problems[0].myScore, 9, "已批改得分照旧透出（回归）");

  // 4c. late_submission 缺失 / 0 → lateDeadline 不设（回归）
  const fetchLike3 = makeFetch([
    {
      match: (u) => u.includes("/get_exercise_list/9/"),
      body: {
        errcode: 0,
        data: { name: "无补交", max_retry: 0, problems: [], late_submission: 0 },
      },
    },
  ]);
  const src3 = createYuketangSource({ cookie: "sessionid=abc" }, fetchLike3, 30);
  const d3 = await src3.getExerciseDetail("9", "777");
  eq(d3.lateDeadline, undefined, "late_submission=0 → lateDeadline 不设");
  eq(d3.maxRetry, 0, "max_retry=0 照旧透出（UI 显「不可重交」）");
}

/* ───────────────── [5] 入口接线静态审计（R20-B2b：漏接回归网） ───────────────── */
console.log("\n[5] 入口接线静态审计（所有点击点统一 openHomeworkRow）");
{
  const { readFileSync } = await import("node:fs");
  const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

  // 作业行点击点全量清单（新增点击点必须接 openHomeworkRow 并登记到这里）
  const CLICK_POINTS = [
    ["shared.tsx HomeworkRow（全部作业 / 课程详情）", "../apps/desktop/src/pages/learn/shared.tsx"],
    ["HomeWidgets.tsx HomeworkRows（今日页 / 收藏夹作业卡）", "../apps/desktop/src/components/HomeWidgets.tsx"],
    ["SearchPage.tsx SearchHomeworkRow（全局搜索）", "../apps/desktop/src/pages/learn/SearchPage.tsx"],
  ];
  for (const [name, rel] of CLICK_POINTS) {
    const src = readSrc(rel);
    ok(src.includes("openHomeworkRow("), `${name}：行点击统一走 openHomeworkRow`);
    ok(!src.includes("pickYktDetailEntry(") && !src.includes("openExternalHomework("), `${name}：不自拼雨课堂判定 / 网页打开（防分流旁路）`);
    ok(!src.includes('navigate("learn-ykt-detail"') && !src.includes('navigate("learn-assignment-detail"'), `${name}：不绕过分流直连详情页`);
  }

  // 唯一执行层：三态动作全部收在 homeworkEntry.ts
  const entry = readSrc("../apps/desktop/src/lib/homeworkEntry.ts");
  ok(
    entry.includes("pickHomeworkRoute") &&
      entry.includes("openExternalHomework") &&
      entry.includes('navigate("learn-ykt-detail"') &&
      entry.includes('navigate("learn-assignment-detail"'),
    "homeworkEntry.ts = 唯一执行层（三态动作齐全：ykt-native / external-web / internal）",
  );

  // 原生详情页保留「浏览器打开」备用出口，文案统一
  const page = readSrc("../apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx");
  ok(page.includes("浏览器打开") && page.includes("openExternalHomework"), "原生详情页保留「浏览器打开」备用出口（R20-A 分流：桌面系统浏览器 / 移动 WebView）");
  ok(!page.includes("在网页中打开"), "旧文案「在网页中打开」已统一为「浏览器打开」");
}

/* ───────────────── [6] R20-B3：评语去重 + 入口分数口径 ───────────────── */
console.log("\n[6] R20-B3：dedupeYktRemarks（评语去重）+ homeworkEntryScoreText（入口分数）");
{
  // 6a. 霖实测形态：总评与具名批注同文 → 只渲染批注行（批注人「盛洁」保留，总评不再重复）
  deepEq(
    dedupeYktRemarks({ remark: "写得不错", comments: [{ name: "盛洁", content: "写得不错" }] }),
    { comments: [{ name: "盛洁", content: "写得不错" }] },
    "总评 ≡ 具名批注 → 丢总评留批注（去重核心场景）",
  );
  deepEq(
    dedupeYktRemarks({ remark: "写得不错 \n", comments: [{ name: "盛洁", content: "  写得不错" }] }),
    { comments: [{ name: "盛洁", content: "  写得不错" }] },
    "空白差异不影响同文判定",
  );
  deepEq(
    dedupeYktRemarks({ remark: "盛洁：写得不错", comments: [{ name: "盛洁", content: "写得不错" }] }),
    { comments: [{ name: "盛洁", content: "写得不错" }] },
    "总评内嵌「名：内容」形态 ≡ 批注 → 去重",
  );
  deepEq(
    dedupeYktRemarks({ remark: "盛洁:写得不错", comments: [{ name: "盛洁", content: "写得不错" }] }),
    { comments: [{ name: "盛洁", content: "写得不错" }] },
    "冒号全半角折叠后同文 → 去重",
  );
  deepEq(
    dedupeYktRemarks({ remark: "注意格式", comments: [{ name: "盛洁", content: "注意格式" }, { content: "第三题重做" }] }),
    { comments: [{ name: "盛洁", content: "注意格式" }, { content: "第三题重做" }] },
    "具名同文 + 不同文批注并存 → 总评去重，两条批注全保留",
  );

  // 6b. 无名批注同文 → 两形态渲染相同，保留总评、丢批注
  deepEq(dedupeYktRemarks({ remark: "好", comments: [{ content: "好" }] }), { remark: "好" }, "总评 ≡ 无名批注 → 留总评丢批注（渲染等价）");

  // 6c. 不同文 → 全保留（红线：去重不许丢评语）
  deepEq(
    dedupeYktRemarks({ remark: "总评：良好", comments: [{ name: "盛洁", content: "第二题订正" }] }),
    { remark: "总评：良好", comments: [{ name: "盛洁", content: "第二题订正" }] },
    "总评与批注不同文 → 都保留",
  );
  deepEq(
    dedupeYktRemarks({ remark: "丙", comments: [{ content: "甲" }, { content: "乙" }] }),
    { remark: "丙", comments: [{ content: "甲" }, { content: "乙" }] },
    "三段互异评语全保留且顺序不变",
  );

  // 6d. 批注之间自身去重（首条优先；总评缺位时也生效）
  deepEq(
    dedupeYktRemarks({ comments: [{ content: "同文" }, { name: "李四", content: "同文" }, { name: "王五", content: "另一句" }] }),
    { comments: [{ content: "同文" }, { name: "王五", content: "另一句" }] },
    "批注间同文 → 留首条（无总评场景）",
  );
  deepEq(
    dedupeYktRemarks({ comments: [{ content: "x" }, { content: "x" }, { content: "x" }] }),
    { comments: [{ content: "x" }] },
    "三条全同文 → 收敛为一条",
  );

  // 6e. 空值形态：字段缺省 = 不渲染该层；全空 → 整节隐藏
  deepEq(dedupeYktRemarks({}), {}, "无总评无批注 → 空对象（评语区隐藏）");
  deepEq(dedupeYktRemarks({ remark: "  ", comments: [{ content: "   " }] }), {}, "纯空白评语 ≡ 无（不渲染空行）");
  deepEq(dedupeYktRemarks({ remark: "只有总评", comments: [] }), { remark: "只有总评" }, "空批注数组 → 只留总评");
  deepEq(dedupeYktRemarks({ comments: [{ content: "只有批注" }] }), { comments: [{ content: "只有批注" }] }, "无总评 → 只留批注");

  // 6f. 入口分数口径（考试既有口径回归 + 已批改作业新场景共用）
  eq(homeworkEntryScoreText({ submitted: true, score: 60, totalScore: 100 }), "60/100", "考试：已出分 → 60/100（回归）");
  eq(homeworkEntryScoreText({ submitted: true, score: 30, totalScore: 40 }), "30/40", "已批改作业：合计分/满分 → 30/40");
  eq(homeworkEntryScoreText({ submitted: true, score: 8 }), "8", "卷面满分缺失 → 裸分数");
  eq(homeworkEntryScoreText({ submitted: true, score: 0, totalScore: 20 }), "0/20", "真实 0 分 + 满分 → 0/20 照实显示");
  eq(homeworkEntryScoreText({ submitted: true, score: 2.5 }), "2.5", "半分不带尾零");
  eq(homeworkEntryScoreText({ submitted: false, score: 60, totalScore: 100 }), "", "未提交 → 不显示（有分也不显）");
  eq(homeworkEntryScoreText({ score: 60 }), "", "submitted 缺省（falsy）→ 不显示");
  eq(homeworkEntryScoreText({ submitted: true }), "", "已交未批改（无分）→ 不显示（作业场景核心口径）");
  eq(homeworkEntryScoreText({}), "", "全缺 → 空串");

  // 6g. 接线静态审计：两处 UI 必须走新口径，不得残留旧的直渲染 / 内联拼接
  const { readFileSync } = await import("node:fs");
  const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const page = readSrc("../apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx");
  ok(page.includes("dedupeYktRemarks(p)") && page.includes("remarkView"), "详情页评语区走 dedupeYktRemarks 去重口径");
  ok(!page.includes("p.remark") && !page.includes("p.comments"), "详情页不再直渲染原始 remark / comments（防双显回归）");
  const shared = readSrc("../apps/desktop/src/pages/learn/shared.tsx");
  ok(shared.includes("homeworkEntryScoreText(h)"), "入口行分数统一走 homeworkEntryScoreText（考试 / 已批改作业同口径）");
  ok(!shared.includes("h.score !== undefined") || shared.includes("homeworkEntryScoreText"), "旧内联分数拼接已收敛进纯函数");
}

/* ───────────────── [7] R20-C1 作答/提交入口资格判定 ───────────────── */
console.log("\n[7] R20-C1 作答/提交入口资格 yktSubmitEligibility（纯函数 + 红线）");
{
  const T = new Date(2026, 5, 15, 12, 0, 0).getTime(); // 2026-06-15 12:00 本地
  const future = "2026-06-20 23:59";
  const past = "2026-06-10 23:59";
  const hw = (over = {}) => ({
    kind: "homework",
    deadline: future,
    now: T,
    problems: [{ type: 1, myStatus: "unanswered" }],
    ...over,
  });

  // 7a. 红线：试卷 / 全外链题永不出口
  eq(yktSubmitEligibility(hw({ kind: "exam" })).reason, "exam", "kind=exam → 红线不出入口");
  eq(yktSubmitEligibility(hw({ sourceType: 20 })).reason, "exam", "活动 type=20（试卷）→ 红线");
  eq(yktSubmitEligibility(hw({ sourceType: 6 })).reason, "exam", "旧 /subject type=6（试卷别名）→ 红线");
  eq(yktSubmitEligibility(hw({ kind: "exam", deadline: future })).eligible, false, "试卷即便未过截止也不出");
  eq(yktSubmitEligibility(hw({ problems: [{ type: 9, myStatus: "unanswered" }] })).reason, "external-only", "全为题型 9 → 红线不出");
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 9 }, { type: 1, myStatus: "unanswered" }] })).eligible,
    true,
    "含题型 9 但另有可作答题 → 照常出口（逐题红线在题目卡）",
  );
  eq(yktSubmitEligibility(hw({ problems: [] })).reason, "no-problems", "无题目明细 → 不出（详情未回/缺 problems）");

  // 7b. 时间窗：未过截止放行；过截止须允许补交
  eq(yktSubmitEligibility(hw()).eligible, true, "未过截止 → 出口（不要求 is_allowed_late_submission）");
  eq(yktSubmitEligibility(hw({ lateAllowed: false })).eligible, true, "未过截止 + 不允许补交 → 仍出口（按时提交）");
  eq(yktSubmitEligibility(hw({ deadline: past, lateAllowed: false })).reason, "deadline", "过截止 + 不允许补交 → 不出");
  eq(yktSubmitEligibility(hw({ deadline: past, lateAllowed: true })).eligible, true, "过截止 + 允许补交 + 无补交截止 → 出口");
  eq(
    yktSubmitEligibility(hw({ deadline: past, lateAllowed: true, lateDeadline: future })).eligible,
    true,
    "补交窗口内 → 出口",
  );
  eq(yktSubmitEligibility(hw({ deadline: past, lateAllowed: true, lateDeadline: past })).reason, "deadline", "过补交截止 → 不出");
  eq(yktSubmitEligibility(hw({ deadline: undefined })).eligible, true, "截止缺失 → 不误判过期，出口");
  eq(yktSubmitEligibility(hw({ deadline: "垃圾串" })).eligible, true, "截止不可解析 → 不误判过期，出口");
  eq(
    yktSubmitEligibility(hw({ now: new Date(2026, 5, 20, 23, 59, 0).getTime() })).eligible,
    false,
    "now === 截止整分 → 已过期（>=）",
  );

  // 7c. 未超 max_retry
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 1, myStatus: "graded", remainingRetries: 0 }] })).reason,
    "retry-exhausted",
    "唯一题剩余 0 次 → 超 max_retry 不出",
  );
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 1, remainingRetries: 0 }, { type: 2, remainingRetries: 2 }] })).eligible,
    true,
    "部分题用完但仍有可交题 → 出口",
  );
  eq(yktSubmitEligibility(hw({ problems: [{ type: 1, remainingRetries: undefined }] })).eligible, true, "次数未知（不限）→ 不拦");
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 1, remainingRetries: 0 }, { type: 2, remainingRetries: undefined }] })).eligible,
    true,
    "一题用完 + 一题不限 → 出口",
  );
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 1, myStatus: "graded" }], maxRetry: 0 })).reason,
    "retry-exhausted",
    "无次数信息 + maxRetry=0 + 全已提交 → 兜底不出",
  );
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 1, myStatus: "unanswered" }], maxRetry: 0 })).eligible,
    true,
    "无次数信息 + maxRetry=0 但未提交 → 出口（首交）",
  );

  // 7d. R27 fix（用户实测 bug）：服务端 user.my_count 是**整卷**计数 —— 交完第 1 题后，
  //     尚未作答的题也会带上 my_count=1，剩余 = count − my_count 对每题都变 0；
  //     旧口径据此把每题面板换成「次数已用尽」，表现为「提交一道题之后剩下所有题的
  //     提交窗口全部消失」。现口径：未作答的题永不因次数判据隐藏。
  const afterOneSubmit = [
    { type: 1, myStatus: "submitted", remainingRetries: 0 },
    { type: 1, myStatus: "unanswered", remainingRetries: 0 },
    { type: 1, myStatus: "unanswered", remainingRetries: 0 },
  ];
  eq(yktSubmitEligibility(hw({ problems: afterOneSubmit })).eligible, true, "交完一题后其余题未作答 → 提交入口仍在");
  eq(
    yktSubmitEligibility(hw({ problems: afterOneSubmit })).remainingRetries,
    0,
    "剩余次数只按已作答题统计（不再被未作答题的整卷计数误导）",
  );
  eq(yktAnswerPanelState(afterOneSubmit[0]), "exhausted", "已作答且用完次数 → 该题面板显示已用尽");
  eq(yktAnswerPanelState(afterOneSubmit[1]), "editor", "未作答题即使剩余 0 也保留作答面板");
  eq(yktAnswerPanelState({ myStatus: "unanswered" }), "editor", "次数未知 → 面板常在");
  eq(yktSubmitEligibility(hw({ problems: [{ type: 1, myStatus: "graded" }], maxRetry: 3 })).eligible, true, "无次数信息 + maxRetry>0 → 出口");
  eq(
    yktSubmitEligibility(hw({ problems: [{ type: 1, remainingRetries: 3 }, { type: 2, remainingRetries: 1 }] })).remainingRetries,
    1,
    "剩余次数展示取最小",
  );

  // 7d. parseYktLocalTime 解析口径
  const p = (s) => parseYktLocalTime(s);
  eq(p("2026-06-15 09:30"), new Date(2026, 5, 15, 9, 30).getTime(), "YYYY-MM-DD HH:MM");
  eq(p("2026/6/15 9:30"), new Date(2026, 5, 15, 9, 30).getTime(), "YYYY/M/D H:MM");
  eq(p("2026-06-15T09:30:00"), new Date(2026, 5, 15, 9, 30).getTime(), "ISO T 分隔 + 秒");
  eq(p(" 2026-06-15 09:30 "), new Date(2026, 5, 15, 9, 30).getTime(), "前后空白容忍");
  eq(p(""), undefined, "空串 → undefined");
  eq(p(undefined), undefined, "undefined → undefined");
  eq(p("2026-06-15"), undefined, "缺时间部分 → undefined");

  // 7e. 详情页接线静态审计（资格门 / 二次确认 / 注入 Cookie / 关闭重拉 / 不打印 Cookie）
  const { readFileSync } = await import("node:fs");
  const readSrc = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const page = readSrc("../apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx");
  ok(page.includes("yktSubmitEligibility("), "详情页资格判定走纯函数 yktSubmitEligibility");
  ok(page.includes("eligibility.eligible") && page.includes("作答 / 提交"), "入口按钮仅在 eligible 时渲染");
  ok(page.includes("confirmOk("), "打开官方页前有应用内二次确认");
  ok(page.includes("openYktSubmitWebview(") && page.includes("getYktCookie()"), "入口走应用内 WebView 且注入当前会话 Cookie");
  ok(page.includes("setTick((t) => t + 1)"), "webview 关闭后重拉真实状态（tick 触发 useEffect）");
  ok(!/setDetail\([^)]*submitted/.test(page), "无乐观更新（不直接改详情状态）");
  const submitLib = readSrc("../apps/desktop/src/lib/yktSubmitWebview.ts");
  ok(submitLib.includes('invoke("open_ykt_submit_window"'), "执行层调 open_ykt_submit_window（桌面窗口 / 移动 Dialog 同一命令）");
  ok(submitLib.includes('listen("ykt-submit-closed"'), "桌面端以 ykt-submit-closed 事件等待关闭");
  ok(
    !/log_debug[^)]*cookie/i.test(submitLib) && !/console\.(log|error)\([^)]*cookie/i.test(submitLib),
    "执行层不打印 Cookie（内存传递）",
  );
}

/* ───────── [8] 折叠/展开「我的作答」「老师评语」（R20-B3 fix ③）+ 主题配色接线（fix ②） ───────── */
console.log("\n[8] 折叠区块：默认展开 / 两区块可折叠 / 不记忆（静态审计）");
{
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../apps/desktop/src/pages/learn/YktAssignmentDetailPage.tsx", import.meta.url), "utf8");

  ok(page.includes("function CollapsibleSection("), "折叠收敛为独立 CollapsibleSection 组件");
  ok(/const \[open, setOpen\] = useState\(true\)/.test(page), "默认展开（useState(true)，不记忆口径）");
  // 两个区块都走折叠头；组件本体不写死区块名（切片止于 ProblemCard 的注释，防注释串味）
  const csBody = page.slice(page.indexOf("function CollapsibleSection("), page.indexOf("/** 单题卡"));
  ok(!csBody.includes("我的作答") && !csBody.includes("老师评语"), "CollapsibleSection 本体不写死区块名（label 由调用方传）");
  ok(page.includes('<CollapsibleSection label="我的作答">'), "「我的作答」区块接入折叠头");
  ok(page.includes('<CollapsibleSection label="老师评语">'), "「老师评语」区块接入折叠头");
  ok(csBody.includes("aria-expanded={open}"), "折叠头带 aria-expanded（无障碍）");
  ok(csBody.includes("setOpen((v) => !v)"), "点击切换开合");
  ok(csBody.includes("{open ? children : null}"), "折叠时内容不渲染（含 ProblemBody iframe，省的是真开销）");
  ok(cssHasToggle(), "折叠头样式（按钮复位 + 小箭头）已入全局样式表");
  ok((await cssHasToggle()) && (await cssHas("ykt-sec-hint")) && (await cssHas(".ykt-sec-toggle.is-closed")), "折叠可见性信号（尾部提示文字 + 收起态样式）已入全局样式表");
  // 主题配色接线静态审计（fix ②）：组件读实时主题注入文档
  const pb = readFileSync(new URL("../apps/desktop/src/components/exthw/ProblemBody.tsx", import.meta.url), "utf8");
  ok(pb.includes("theme: readYktDocTheme(wrapRef.current)"), "ProblemBody 以运行时主题配色构建沙箱文档（不假设明暗二元）");
  ok(pb.includes("onethu-theme-style") && pb.includes("MutationObserver"), "主题切换经 MutationObserver 触发文档重建");
}

async function cssHasToggle() {
  return cssHas(".ykt-sec-toggle") && cssHas(".ykt-sec-caret");
}

async function cssHas(needle) {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../apps/desktop/src/styles/global.css", import.meta.url), "utf8");
  return css.includes(needle);
}

console.log(`\n═══ R20-B2/B3/C1 雨课堂详情页单测：${pass} 通过 / ${fail} 失败 ═══`);
if (fail > 0) process.exit(1);
