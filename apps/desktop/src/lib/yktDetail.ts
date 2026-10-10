/**
 * R20-B2：雨课堂原生作业详情页的纯判定 / 展示函数（零依赖，无 JSX / 无 React /
 * 无 Tauri —— tools/ykt-detail-ui-test.mjs 用 Node 直引做回归测试，约定同
 * ./androidHost.ts）。
 *
 * 范围：
 *  - 入口分流（R20-B2b 默认原生）：作业行点击统一三态判定 pickHomeworkRoute ——
 *    雨课堂 + 详情参数齐备 → 原生详情页（**全平台默认**，不再限 Android 宿主，PC 同样
 *    直达原生页）；其余外部源 / 参数缺失 → external（openExternalHomework 内部分流：
 *    Android → 桌面模式 WebView，桌面 → 系统浏览器）；无 source 的内部作业 → internal
 *    （learn-assignment-detail）。真实导航/打开动作收在 ./homeworkEntry.ts（薄执行层）；
 *  - 展示口径：单题批改徽标、整卷批改/得分汇总、题型文案、作答附件文案。
 *
 * 红线（写死在本模块注释与页面实现里）：B2 无任何提交 UI；试卷（exam / type 6 / 20）
 * 不渲染提交入口（B2 整页本就没有提交区，天然满足，仍明确不引入）；题型 9 只显示外链跳转。
 */
import type { YkAttachment, YkMyStatus, YkProblem } from "@onethu/core";

/* ── 入口分流 ── */

/** 入口分流所需的最小行数据（Homework 的结构化子集，测试可传普通对象） */
export interface YktEntryRow {
  source?: string;
  /** core R20-B2 透出：get_exercise_list 路径段（缺失 → 没法拉详情，回退网页打开） */
  externalLeafTypeId?: string;
  externalClassroomId?: string;
}

/** 作业行点击的统一路由三态（R20-B2b：所有点击入口共用同一条判定） */
export type HomeworkRowRoute =
  | "ykt-native" // 雨课堂 + 详情参数齐备 → learn-ykt-detail 原生页（全平台默认）
  | "external-web" // 其余外部源 / 雨课堂参数缺失 → openExternalHomework（R20-A 分流）
  | "internal"; // 无 source 的网络学堂作业 → learn-assignment-detail

/** 作业行点击统一分流（纯函数，零依赖；真实导航/打开动作在 ./homeworkEntry.ts）：
 *  - "ykt-native"：雨课堂条目且 leafTypeId/classroomId 齐备 → 直达 learn-ykt-detail。
 *    R20-B2b 起**不再看宿主**：Android / 桌面（PC）一律默认原生，官方页降为页内
 *    「浏览器打开」备用出口（真机反馈：Android 上仍落 R20-A WebView，桌面原生页
 *    同样可用，故收敛为同一默认）；参数缺失才回退 external（详情拉不了，别把用户
 *    带进死页）；
 *  - "external-web"：非雨课堂外部源（TUOJ/Tyche…）或雨课堂参数缺失 → 保持 R20-A
 *    现状（openExternalHomework：Android 应用内 WebView 桌面模式，桌面系统浏览器）；
 *  - "internal"：无 source 的网络学堂作业 → learn-assignment-detail。 */
export function pickHomeworkRoute(row: YktEntryRow): HomeworkRowRoute {
  if (row.source === "yuketang" && Boolean(row.externalLeafTypeId) && Boolean(row.externalClassroomId)) {
    return "ykt-native";
  }
  return row.source ? "external-web" : "internal";
}

/** 雨课堂原生详情页入口判定（R20-B2 两态口径，pickHomeworkRoute 的投影，
 *  保留给旧调用点/测试：native ⇔ pickHomeworkRoute(row) === "ykt-native"）。 */
export function pickYktDetailEntry(row: YktEntryRow): "native" | "external" {
  return pickHomeworkRoute(row) === "ykt-native" ? "native" : "external";
}

/* ── 展示口径 ── */

/** 分数文案：数字直转（JS Number 不保留尾零：2 → "2"、2.5 → "2.5"、30.00 → "30"）。
 *  独立成函数是给后续分数舍入规则留缝，B2 原样展示。 */
export function yktScoreText(n: number): string {
  return String(n);
}

/** 入口行分数文案（R9 考试口径；R20-B3 起已批改雨课堂作业共用同一函数同一显示位）：
 *  已提交且带分 → "X/Y"（有卷面满分）/ "X"；未提交 / 无分（未出分 / 未批改）→ "" 不显示。
 *  「何时有分」由 core 决定（作业仅整卷已批改合计透出、试卷仅已出分透出），这里只管显示——
 *  两端（PC/移动）共用 HomeworkRow，一套 UI 自动生效。 */
export function homeworkEntryScoreText(h: { submitted?: boolean; score?: number; totalScore?: number }): string {
  if (!h.submitted || h.score === undefined) return "";
  return h.totalScore !== undefined ? `${yktScoreText(h.score)}/${yktScoreText(h.totalScore)}` : yktScoreText(h.score);
}

/** 单题批改徽标：已批改（蓝，有分带分数）/ 已交未批（绿）/ 未作答（灰） */
export function yktStatusChip(p: { myStatus: YkMyStatus; myScore?: number }): { text: string; cls: string } {
  if (p.myStatus === "graded") {
    return p.myScore !== undefined
      ? { text: `已批 ${yktScoreText(p.myScore)} 分`, cls: "chip-blue" }
      : { text: "已批改", cls: "chip-blue" };
  }
  if (p.myStatus === "submitted") return { text: "已交未批", cls: "chip-green" };
  return { text: "未作答", cls: "chip-gray" };
}

/** 整卷批改/得分汇总（详情页头部用） */
export interface YktExerciseSummary {
  total: number;
  /** 已作答题数（submitted + graded） */
  answered: number;
  /** 已批改题数 */
  graded: number;
  /** 已批题目得分合计（无一题透出得分时为 undefined，避免 0 分误导） */
  scoreSum?: number;
  /** 整卷批改状态徽标 */
  chip: { text: string; cls: string };
}

/** 整卷汇总（纯函数）：B2 只读口径，只统计 problems[] 里归一化好的三态与得分 */
export function yktExerciseSummary(problems: ReadonlyArray<YkProblem>): YktExerciseSummary {
  const total = problems.length;
  let answered = 0;
  let graded = 0;
  let scoreSum: number | undefined;
  for (const p of problems) {
    if (p.myStatus !== "unanswered") answered++;
    if (p.myStatus === "graded") {
      graded++;
      if (p.myScore !== undefined) scoreSum = (scoreSum ?? 0) + p.myScore;
    }
  }
  const chip = (() => {
    if (total === 0) return { text: "无题目", cls: "chip-gray" };
    if (answered === 0) return { text: "未作答", cls: "chip-gray" };
    if (graded >= total) return { text: "已批改", cls: "chip-blue" };
    if (graded > 0) return { text: `已批 ${graded}/${total} 题`, cls: "chip-blue" };
    return { text: "已交未批", cls: "chip-green" };
  })();
  return { total, answered, graded, ...(scoreSum !== undefined ? { scoreSum } : {}), chip };
}

/** 题型文案：typeText 缺失时按 ProblemType 兜底（docs 28.1：1 单选 2 多选 3 判断 4 填空 5 主观 9 外链） */
export function yktTypeText(p: Pick<YkProblem, "type" | "typeText">): string {
  const t = (p.typeText ?? "").trim();
  if (t) return t;
  const fallback: Record<number, string> = {
    1: "单选题",
    2: "多选题",
    3: "判断题",
    4: "填空题",
    5: "主观题",
    6: "试卷",
    9: "外链题",
  };
  return fallback[p.type] ?? "题目";
}

/** 题型 9（外链 OJ）：B2 只显示外链跳转，不渲染作答区（红线） */
export function yktIsExternalLinkProblem(p: Pick<YkProblem, "type">): boolean {
  return p.type === 9;
}

/** 作答附件 → 一行文案（"a.png、b.pdf"；无附件 → ""）。B2 只读展示文件名，下载属 R20-C。 */
export function yktAttachmentsText(atts: ReadonlyArray<YkAttachment> | undefined): string {
  if (!atts || atts.length === 0) return "";
  return atts
    .map((a) => (a.name ?? "").trim() || (a.url ?? "").trim() || "附件")
    .join("、");
}

/* ── 老师评语去重（R20-B3 fix，2026-09-20 霖 PC 实测：详情页同一评语渲染两次） ──
 *
 * 现象：详情页老师评语区出现两处相同内容——「老师评语：…」（remark 渲染）与
 * 「盛洁：…」（批注 comment[] 渲染，批注人名 + 相同内容）。
 * 排查（2026-09-20）：详情接口同一端点（get_exercise_list）的
 * `problems[].user{ remark, comment[]{content,index,name,avatar,attachment} }` 两个
 * 结构化字段在已批改题上会被雨课堂写成同文（R16 21.1 实测判别器已证 comment[] 在
 * status 4 题上是教师评语；本机 YKT_COOKIE 已失效 401000 无法再拉新快照，按既有
 * 实测字段表 + 霖所见「批注人名 + 同文」形状定位：两处分别来自 remark 与 comment[]，
 * my_answer.content 无批注人名形态可排除「作答内嵌批注块」假设）。core 保持数据
 * 忠实（不丢字段，R20-C 提交链路 / 未来导出仍要原始两字段），去重收敛在展示层。
 *
 * 口径：同文（忽略空白差异；批注人名按「名：内容」嵌名形态并比，冒号全半角折叠）
 * 只渲染一处，**优先保留具名批注行**（含批注人 = 渲染信息更全的规整口径）；无名批注
 * 与 remark 同文时两者渲染形态相同，保留 remark、丢批注。不同文的评语一律原样保留
 * （总评 + 逐条批注并存的合法形态不受影响）；remark 缺失时批注之间自身去重（首条优先）。
 */

/** 评语去重的最小输入（core YkProblem 的 remark / comments 子集，测试可传普通对象） */
export interface YktRemarkLike {
  /** 老师总评（user.remark） */
  remark?: string;
  /** 老师批注（user.comment[]，core 已滤空 content） */
  comments?: ReadonlyArray<{ content: string; name?: string; index?: number }>;
}

/** 去重后的渲染口径：remark / comments 缺省 = 该层不渲染（评语区整体隐藏） */
export interface YktRemarkView {
  remark?: string;
  comments?: Array<{ content: string; name?: string; index?: number }>;
}

/** 同文判定键：折叠所有空白 + 冒号全半角归一（"好" ≈ " 好 "；"盛洁：好" ≈ "盛洁:好"） */
function yktRemarkKey(s: string): string {
  return s.replace(/\s+/gu, "").replace(/[:：]/gu, ":");
}

/** 老师评语去重（纯函数）：同文评语只保留一处（详见上方口径说明）。
 *  返回值不含空数组/空串——调用方按「字段缺省 = 不渲染该层」处理。 */
export function dedupeYktRemarks(p: YktRemarkLike): YktRemarkView {
  const comments = (p.comments ?? []).filter((c) => typeof c.content === "string" && c.content.trim() !== "");
  const remark = typeof p.remark === "string" && p.remark.trim() !== "" ? p.remark : undefined;
  const remarkKey = remark !== undefined ? yktRemarkKey(remark) : "";
  // 与总评同文的具名批注（含「盛洁：好」嵌名形态）→ 保留批注行（批注人信息更全），总评不再单独渲染
  const namedDup =
    remarkKey !== ""
      ? comments.find(
          (c) =>
            c.name !== undefined &&
            (yktRemarkKey(c.content) === remarkKey || yktRemarkKey(`${c.name}：${c.content}`) === remarkKey),
        )
      : undefined;
  const dropRemark = namedDup !== undefined;
  const seen = new Set<string>();
  // 总评保留时先占同文键：后续与总评同文的（无名）批注自然被滤掉
  if (remark !== undefined && !dropRemark) seen.add(remarkKey);
  const out: NonNullable<YktRemarkView["comments"]> = [];
  for (const c of comments) {
    const key = yktRemarkKey(c.content);
    // 与总评 / 已收批注同文 → 丢（同文只渲染一处；不同文的批注原样保留）
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return {
    ...(remark !== undefined && !dropRemark ? { remark } : {}),
    ...(out.length > 0 ? { comments: out } : {}),
  };
}

/* ── R20-C1：作答 / 提交入口资格判定（纯函数） ──────────────────────────────
 *
 * 本阶段入口只做一件事：把用户拉进**雨课堂官方作答页**（应用内 WebView），提交
 * 仍由官方页逻辑完成。资格判定只决定「详情页要不要渲染入口」，不替代/不绕过官方页
 * 内的任何确认与拦截（官方页自己还会再判截止、次数、确认弹窗）。
 *
 * 判定口径（输入只用详情页已有数据 + 列表行截止时间，零新增 IO）：
 *  1. 红线：试卷（kind=exam / 活动 type 20；type 6 为旧 /subject 链接的试卷别名）
 *     永远不出入口；全为题型 9（外链 OJ）也不出（站内/官方作业页没有可作答内容）；
 *  2. 时间窗：未过截止放行；已过截止必须「允许补交」（is_allowed_late_submission）
 *     且未过补交截止 —— 即霖要求的三条件里「未过截止 ∧ 允许迟交」的落地口径
 *     （允许迟交是**补交分支**的门，不否定正常按时提交）；
 *  3. 未超 max_retry：每题有 `remainingRetries`（core R20-C1 新透出，web left_times
 *     同口径）时，只有**所有题**都明确剩余 0 次才算超；`undefined` = 不限/未知，不拦。
 *     题目都没有次数信息时用整卷 `maxRetry` 兜底：0（不可重交）且全部题已提交 → 超。
 *
 * 真实拦截永远在官方页内（本函数只做入口显隐，宁可多给一次入口也不误藏）。
 */

/** 资格判定输入（problems 传 YkProblem 子集即可，测试可传普通对象） */
export interface YktSubmitEligibilityInput {
  /** 作业类型（列表行 kind；exam = 试卷 → 红线） */
  kind?: "homework" | "exam";
  /** 活动源 type（19 作业 / 20 试卷；6 为旧 /subject 链接的试卷别名）——与 kind 双保险 */
  sourceType?: number;
  /** 题目列表（题型 / 剩余重交次数 / 三态） */
  problems?: ReadonlyArray<Pick<YkProblem, "type" | "remainingRetries" | "myStatus">>;
  /** 截止时间 "YYYY-MM-DD HH:MM"（列表行 deadline；缺失/不可解析 = 无截止约束） */
  deadline?: string;
  /** 是否允许补交（detail.lateAllowed） */
  lateAllowed?: boolean;
  /** 补交截止 "YYYY-MM-DD HH:MM"（detail.lateDeadline；缺失 = 允许补交即放行） */
  lateDeadline?: string;
  /** 整卷重交上限（detail.maxRetry；仅在题目无 per-problem 次数信息时兜底） */
  maxRetry?: number;
  /** 当前时间（ms；注入便于测试，缺省 Date.now()） */
  now?: number;
}

/** 入口不可渲染的原因（eligible=false 时给，供诊断 / 单测断言） */
export type YktSubmitBlockReason =
  | "exam" // 红线：试卷
  | "no-problems" // 无题目明细（详情未回 / 接口缺 problems）
  | "external-only" // 红线：全为题型 9（外链 OJ）
  | "deadline" // 已过截止且不允许补交 / 已过补交截止
  | "retry-exhausted"; // 已无重交次数

export interface YktSubmitEligibility {
  eligible: boolean;
  reason?: YktSubmitBlockReason;
  /** 剩余重交次数（仅所有题都有次数信息时给；undefined = 不限/未知）——展示用 */
  remainingRetries?: number;
}

/** "YYYY-MM-DD HH:MM" / "YYYY/MM/DD HH:MM" / ISO "YYYY-MM-DDTHH:MM" → 本地毫秒；
 *  不可解析（缺省 / 垃圾串）→ undefined（调用方按「无约束」处理，不误判已过期）。 */
export function parseYktLocalTime(s: string | undefined): number | undefined {
  if (typeof s !== "string") return undefined;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** 作答 / 提交入口资格判定（纯函数，零依赖；口径详见上方说明） */
export function yktSubmitEligibility(input: YktSubmitEligibilityInput): YktSubmitEligibility {
  // 红线 1：试卷（kind=exam / 活动 type 20 / 旧链接别名 6）永不出口
  if (input.kind === "exam" || input.sourceType === 20 || input.sourceType === 6) {
    return { eligible: false, reason: "exam" };
  }
  const problems = input.problems ?? [];
  if (problems.length === 0) return { eligible: false, reason: "no-problems" };
  // 红线 2：全为题型 9（外链 OJ）——官方作业页也没有可作答内容
  if (problems.every((p) => p.type === 9)) return { eligible: false, reason: "external-only" };
  // 未超 max_retry：所有题都有次数信息且全部 ≤0 才算超；undefined = 不限/未知，不拦
  const allHaveRetryInfo = problems.every((p) => typeof p.remainingRetries === "number");
  // R27 fix（用户实测 bug）：**整卷所有题都已作答**才按次数封入口。
  // 根因：服务端 user.my_count 是整卷计数——交完第 1 题后，尚未作答的题也会带上
  // my_count=1，于是 `剩余 = count − my_count` 对每题都变成 0；旧口径据此封掉入口，
  // 结果「提交一道题之后，剩下所有题的提交窗口全部消失」。
  // 本题级面板同口径：未作答题永不因次数判据隐藏（见 yktAnswerPanelState）。
  const allAnswered = problems.every((p) => p.myStatus !== "unanswered");
  if (allHaveRetryInfo && allAnswered && problems.every((p) => (p.remainingRetries as number) <= 0)) {
    return { eligible: false, reason: "retry-exhausted" };
  }
  // 兜底：题目都没有次数信息 → 用整卷 maxRetry（0=不可重交）+ 全部题已提交
  if (!allHaveRetryInfo && problems.every((p) => typeof p.remainingRetries !== "number") && (input.maxRetry ?? 0) <= 0) {
    const allSubmitted = problems.every((p) => p.myStatus === "submitted" || p.myStatus === "graded");
    if (allSubmitted) return { eligible: false, reason: "retry-exhausted" };
  }
  // 时间窗：未过截止放行；已过截止须允许补交且未过补交截止
  const now = input.now ?? Date.now();
  const deadline = parseYktLocalTime(input.deadline);
  if (deadline !== undefined && now >= deadline) {
    if (!input.lateAllowed) return { eligible: false, reason: "deadline" };
    const late = parseYktLocalTime(input.lateDeadline);
    if (late !== undefined && now >= late) return { eligible: false, reason: "deadline" };
  }
  // 展示用剩余次数：优先看**已作答**的题（未作答题带的是整卷计数，直接取 min 会把
  // 「刚交完一题」显示成整卷 0 次）；已作答题都没有次数信息时才回落到全量。
  const retryPool = (allAnswered ? problems : problems.filter((p) => p.myStatus !== "unanswered")).filter(
    (p) => typeof p.remainingRetries === "number",
  );
  const remaining = retryPool.length > 0
    ? Math.min(...retryPool.map((p) => p.remainingRetries as number))
    : undefined;
  return { eligible: true, ...(remaining === undefined ? {} : { remainingRetries: remaining }) };
}

/**
 * 单题作答面板状态（R27 fix，与 yktSubmitEligibility 的次数口径同源）。
 *
 * 为什么不能只看 `remainingRetries <= 0`：服务端 `user.my_count` 是**整卷**计数——
 * 交完第 1 题后，未作答的题也会带回 my_count=1，`剩余 = count − my_count` 于是对每题
 * 都变成 0。旧实现据此把每题的作答面板整块换成「本题作答次数已用尽」，用户看到的就是
 * 「提交一道题之后，剩下所有题的提交窗口全部消失」（实测 bug）。
 *
 * 现口径：**未作答的题永不因次数判据隐藏面板**（真实次数校验始终由官方接口执行）；
 * 已作答 / 已批改的题才按剩余次数判用尽。
 */
export function yktAnswerPanelState(
  p: Pick<YkProblem, "myStatus" | "remainingRetries">,
): "editor" | "exhausted" {
  const rem = p.remainingRetries;
  if (typeof rem !== "number") return "editor"; // 不限 / 未知
  return rem <= 0 && p.myStatus !== "unanswered" ? "exhausted" : "editor";
}
