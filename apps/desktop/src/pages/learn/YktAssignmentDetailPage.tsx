/**
 * R20-B2：雨课堂作业原生只读详情页（learn-ykt-detail，docs 28.7 B2）。
 *
 * 存在意义：雨课堂官方网页版未做移动端适配（霖实测：小字 + 横向滚动），此前移动端
 * 只能靠 R20-A 的桌面模式 WebView 整页缩放看。本页以**移动端优先**的排版原生呈现
 * 整卷明细：头部信息条（作业名 / 截止时间 / 重交上限 maxRetry / 是否允许迟交
 * lateAllowed / 我的得分与批改状态）+ 题目列表（序号 / 题型 typeText / 分值 score）
 * + 我的作答（myAnswerHtml + attachments）+ 老师评语（remark + comments）。
 * 桌面端同样可正常打开（单列自适应布局，不依赖触屏）。
 *
 * 数据：core getExerciseDetail（R20-B1）经 state 层薄包装 fetchYktExerciseDetail
 * （凭据 / universalFetch 注入）。loading / error 态齐备：失败**保留原始错误文案**
 * 并 log_debug 留痕，绝不静默吞；错误态提供「重试」与「浏览器打开」双出口。
 *
 * 入口（R20-B2b）：作业列表 / 今日页 / 搜索等所有作业行点击统一走 openHomeworkRow
 * 三态分流（lib/homeworkEntry.ts；纯判定 pickHomeworkRoute 在 lib/yktDetail.ts）——
 * 雨课堂 + 详情参数齐备 → **全平台默认**直达本页（不再限 Android 宿主，PC 同样原生），
 * 参数缺失才回退 R20-A。官方页降为页内备用出口：页头「浏览器打开」按钮
 * （openExternalHomework 分流不变：桌面 = 系统浏览器，移动 = 应用内桌面模式 WebView）。
 *
 * 红线（B2 只读，写死在渲染逻辑里）：
 *  - 本页**不渲染任何提交 / 作答输入入口**——提交属 R20-C1/C2；
 *  - 试卷（kind exam / 源 type 20）同样只读，无提交相关 UI；
 *  - 题型 9（外链 OJ）只显示外链跳转（externalUrl → 系统浏览器），不渲染作答区。
 *
 * R20-C1（本阶段）：详情页新增「作答 / 提交」入口，仅在资格判定
 * （lib/yktDetail.ts yktSubmitEligibility 纯函数）通过时渲染——未过截止（已过则须
 * 允许补交且未过补交截止）∧ 未超 max_retry；试卷（exam / type 20 / 6）与全外链题
 * （题型 9）永不出口（红线）。点击 → 应用内二次确认 → 应用内 WebView 打开 R16b
 * 学生端直链并注入当前会话 Cookie（lib/yktSubmitWebview.ts，桌面 Rust 窗口 /
 * 移动 Dialog WebView）；官方页内的确认与拦截原样保留，不替代、不绕过；关闭/返回后
 * 立即重新拉取真实状态（禁止乐观更新）。
 *
 * 题干渲染（R20-B3）：题干 / 我的作答 / 作业说明统一走 components/exthw/ProblemBody——
 * 本地内联沙箱文档（sandbox srcdoc iframe）：xuetangx-com-encrypted-font 加密字体经
 * loadYktFont 下载缓存（7 天 TTL / 失败 10min 退避 / magic 校验）挂 @font-face，
 * $…$ 与 $$…$$ 走内置 KaTeX（离线自包含），图片带 Cookie/Referer 代理重试，
 * 失败逐环降级（剥加密 span 保原文 / 保留 $ 原文 / 占位框+文件名），永不白屏。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { YkExerciseDetail, YkProblem } from "@onethu/core";
import { BackButton, timeLeft } from "./shared.js";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { ProblemBody } from "../../components/exthw/ProblemBody.js";
import { YktSubjectiveEditor, toSubmitHtml } from "../../components/exthw/YktSubjectiveEditor.js";
import { useApp } from "../../state/context.js";
import type { LearnNav, Page } from "../../state/app.js";
import { fetchYktExerciseDetail, getYktCookie, submitYktSubjective } from "../../state/exthw.js";
import { explainNetworkError } from "../../lib/transport.js";
import { confirmOk } from "../../lib/confirm.js";
import { openExternalHomework } from "../../lib/extHwBrowse.js";
import { openYktSubmitWebview } from "../../lib/yktSubmitWebview.js";
import { openExternal } from "../info/openExternal.js";
import {
  dedupeYktRemarks,
  yktAttachmentsText,
  yktExerciseSummary,
  yktIsExternalLinkProblem,
  yktScoreText,
  yktStatusChip,
  yktSubmitEligibility,
  yktTypeText,
} from "../../lib/yktDetail.js";

type LoadState = "loading" | "ok" | "error";

/** 重交上限文案（归一化保守口径：缺失/0 → 不可重交；docs 28.4 实测 max_retry=0/1/3 均有出现） */
function fmtMaxRetry(n: number | undefined): string {
  return n !== undefined && n > 0 ? `${n} 次` : "不可重交";
}

/** 老师评语（remark / comments）按纯文本渲染：实测快照均为纯文本（非 HTML），
 *  纯文本 + pre-wrap 不会吃掉换行，也避免把评语当 HTML 注入。
 *  R20-B3 fix：两字段同文时只渲染一处（dedupeYktRemarks，保留具名批注口径）。 */
function YktPlainText({ text }: { text: string }) {
  return <div className="ykt-plain">{text}</div>;
}

/** 可折叠区块头（R20-B3 fix ③）：「我的作答」「老师评语」支持折叠/展开。
 *  口径（霖 2026-09-21）：**不记忆**——每次进入详情页一律默认展开；折叠只在当次
 *  浏览内有效。纯展示开关，不影响数据拉取。
 *  可见性（霖真机反馈「看不出能折叠」）：整头做成 chip 按钮——底色块 + 悬停反馈 +
 *  箭头转向 + 尾部「收起/展开」文字，多重信号一眼可点。 */
function CollapsibleSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true); // 默认展开，不记忆
  return (
    <>
      <button
        type="button"
        className={`ykt-sec-toggle${open ? "" : " is-closed"}`}
        aria-expanded={open}
        title={open ? "点击收起" : "点击展开"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ykt-sec-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="ykt-sec-label">{label}</span>
        <span className="ykt-sec-hint">{open ? "收起" : "展开"}</span>
      </button>
      {open ? children : null}
    </>
  );
}

/** R20-C2：逐题原生作答面板（主观题，docs §31.2 / §32 学术红线）。
 *  草稿：localStorage 按 classroom+题 持久化（官方同款语义；提交成功即清）。
 *  提交：编辑器 HTML → toSubmitHtml（官方公式形态 + UEditor 包裹）→ 用户确认对话框
 *  （展示剩余次数）→ core submitYktProblemSubjective → 成功后重拉真实状态（禁止乐观更新）。
 *  ⛔ 红线：无任何 AI 生成入口；提交只能由用户点击本按钮触发。 */
function YktAnswerPanel({ p, classroomId, onSubmitted }: { p: YkProblem; classroomId: string; onSubmitted: () => void }) {
  const draftKey = `onethu-ykt-draft-${classroomId}-${p.problemId}`;
  const [html, setHtml] = useState(() => {
    try {
      return localStorage.getItem(draftKey) ?? p.myAnswerHtml ?? "";
    } catch {
      return p.myAnswerHtml ?? "";
    }
  });
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    // 草稿防抖落盘（600ms）；提交成功后 removeItem，重进以服务端 my_answer 回填
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, html);
      } catch {
        /* 存储满/隐私模式：草稿降级为仅内存 */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [html, draftKey]);

  const remaining = p.remainingRetries;
  const unlimited = typeof remaining !== "number" || remaining >= 999;
  const exhausted = typeof remaining === "number" && remaining <= 0;
  const hasContent = html.replace(/<[^>]*>/g, "").trim().length > 0 || /<img\b/i.test(html);

  const doSubmit = async (): Promise<void> => {
    if (busy || uploading > 0) return;
    const content = toSubmitHtml(html);
    if (!hasContent) {
      setErr("作答内容为空：请输入文字或插入解题图片。");
      return;
    }
    const ok = await confirmOk(
      `确认提交第 ${p.index} 题作答？\n\n剩余提交次数：${unlimited ? "不限次" : `${remaining} 次`}\n提交将覆盖此前的作答（雨课堂官方截止/次数校验同步生效）。`,
    );
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      await submitYktSubjective({ classroomId, problemId: p.problemId, contentHtml: content });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      onSubmitted();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      void invoke("log_debug", {
        line: `R20-C2 主观题提交失败（problem=${p.problemId}）: ${msg.slice(0, 300)}`,
      }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (exhausted) {
    return (
      <div className="ykt-ans ykt-answer-panel">
        <div className="ykt-ans-empty">本题作答次数已用尽</div>
      </div>
    );
  }
  return (
    <div className="ykt-ans ykt-answer-panel">
      <YktSubjectiveEditor
        value={html}
        onChange={setHtml}
        classroomId={classroomId}
        onUploadingChange={setUploading}
        onError={setErr}
        disabled={busy}
      />
      {err ? <div className="ykt-answer-err">{err}</div> : null}
      <div className="ykt-answer-actions">
        <button
          className="btn btn-primary"
          disabled={busy || uploading > 0 || !hasContent}
          onClick={() => void doSubmit()}
          title="提交后可在剩余次数内重做（覆盖旧答案）"
        >
          {busy ? "提交中…" : uploading > 0 ? "图片上传中…" : unlimited ? "提交作答" : `提交（剩余 ${remaining} 次）`}
        </button>
      </div>
    </div>
  );
}

/** 单题卡：序号 + 题型 + 分值 + 批改徽标；题干 / 我的作答 + 附件 / 老师评语。
 *  题型 9（外链 OJ）：只渲染外链跳转（红线），作答与评语区一律不给。
 *  题干 / 作答正文（R20-B3）：ProblemBody 内联沙箱渲染（加密字体 + LaTeX + 图片代理）。
 *  R20-C2：answer 槽位渲染逐题原生作答编辑器（主观题 + 资格通过时）。 */
function ProblemCard({ p, fontUrl, cookies, answer }: { p: YkProblem; fontUrl?: string; cookies: string; answer?: ReactNode }) {
  const chip = yktStatusChip(p);
  const ext9 = yktIsExternalLinkProblem(p);
  const attText = yktAttachmentsText(p.myAnswerAttachments);
  const hasAnswer = Boolean(p.myAnswerHtml || attText);
  // R20-B3 fix：remark 与 comment[] 同文时只渲染一处（雨课堂已批改题两字段常同文，
  // 详见 lib/yktDetail.ts dedupeYktRemarks 口径说明）；不同文时全部保留。
  const remarkView = dedupeYktRemarks(p);
  const hasRemark = Boolean(remarkView.remark || remarkView.comments?.length);
  return (
    <Card className="ykt-problem">
      <div className="ykt-problem-head">
        <b className="ykt-problem-no">第 {p.index} 题</b>
        <span className="ykt-problem-type">{yktTypeText(p)}</span>
        {p.score > 0 ? <span className="ykt-problem-score">{yktScoreText(p.score)} 分</span> : null}
        <span className={`chip ${chip.cls} ykt-problem-chip`}>
          <span className="dot" />
          {chip.text}
        </span>
      </div>
      {ext9 ? (
        <div className="ykt-problem-body">
          {p.bodyHtml ? <ProblemBody html={p.bodyHtml} fontUrl={fontUrl} cookies={cookies} title={`第 ${p.index} 题题干`} /> : null}
          {p.externalUrl ? (
            <button className="btn ykt-ext-btn" onClick={() => void openExternal(p.externalUrl!)}>
              打开外链题目 ↗
            </button>
          ) : (
            <div className="ykt-ans-empty">外链题目：未取到外链地址，请从雨课堂网页版打开。</div>
          )}
          {/* 红线：题型 9 只显示外链跳转，不渲染作答输入/评语区 */}
        </div>
      ) : (
        <>
          {p.bodyHtml ? (
            <div className="ykt-problem-body">
              <ProblemBody html={p.bodyHtml} fontUrl={fontUrl} cookies={cookies} title={`第 ${p.index} 题题干`} />
            </div>
          ) : null}
          {answer}
          {hasAnswer ? (
            <div className="ykt-ans">
              <CollapsibleSection label="我的作答">
                {p.myAnswerHtml ? <ProblemBody html={p.myAnswerHtml} fontUrl={fontUrl} cookies={cookies} title={`第 ${p.index} 题我的作答`} /> : null}
                {attText ? <div className="ykt-ans-att">附件：{attText}</div> : null}
              </CollapsibleSection>
            </div>
          ) : p.myStatus === "unanswered" ? (
            <div className="ykt-ans-empty">未作答</div>
          ) : (
            /* R24 fix：已交 / 已批但服务端未回传作答正文（实测存在此响应形态）→
               明示「已提交」而非静默空白（此前整块不渲染，用户误以为没交） */
            <div className="ykt-ans-empty">已提交（服务端未返回作答正文{p.submitTime ? ` · ${p.submitTime}` : ""}）</div>
          )}
          {hasRemark ? (
            <div className="ykt-remark">
              <CollapsibleSection label="老师评语">
                {remarkView.remark ? <YktPlainText text={remarkView.remark} /> : null}
                {(remarkView.comments ?? []).map((c, i) => (
                  <div className="ykt-remark-item" key={i}>
                    {c.name ? <b>{c.name}：</b> : null}
                    <YktPlainText text={c.content} />
                  </div>
                ))}
              </CollapsibleSection>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function YktAssignmentDetailPage({ ykt: yktProp, from: fromProp }: { ykt?: NonNullable<LearnNav["ykt"]>; from?: Page } = {}) {
  const { navParams } = useApp();
  // 宽屏分栏内嵌（§2.8.2）时由 props 直给，路由页仍走 navParams
  const ykt = yktProp ?? navParams?.ykt ?? null;
  const from = fromProp ?? navParams?.from ?? "learn";
  const [detail, setDetail] = useState<YkExerciseDetail | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [tick, setTick] = useState(0);
  // R20-C1：官方作答页拉起中 / 拉起失败提示（失败不静默吞，给重试）
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  const leafTypeId = ykt?.leafTypeId ?? "";
  const classroomId = ykt?.classroomId ?? "";

  useEffect(() => {
    // 参数缺失（深链残缺 / 列表行未透出 leafTypeId）不发请求：直接参数缺失错误态
    if (!leafTypeId || !classroomId) return;
    let cancelled = false;
    setState("loading");
    setErrMsg("");
    fetchYktExerciseDetail(leafTypeId, classroomId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setState("ok");
      })
      .catch((e: unknown) => {
        // 红线：保留原始错误文案（core 抛的 errcode / 会话失效上下文），log_debug 留痕，不静默吞
        const msg = explainNetworkError(e);
        if (cancelled) return;
        setErrMsg(msg);
        setState("error");
        void invoke(
          "log_debug",
          { line: `R20-B2 雨课堂作业详情拉取失败（leaf=${leafTypeId} classroom=${classroomId}）: ${msg.slice(0, 300)}` },
        ).catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [leafTypeId, classroomId, tick]);

  /* 参数缺失：导航链路问题，明确提示（不在无参状态下瞎猜作业） */
  if (!ykt || !leafTypeId || !classroomId) {
    return (
      <>
        <PageHead title="雨课堂作业" actions={<BackButton to={from} />} />
        <Card>
          <Empty text="这个入口不完整，请从作业列表重新进入。" />
        </Card>
      </>
    );
  }

  const meta = `${ykt.courseName || "雨课堂"}${ykt.deadline ? ` · ${ykt.deadline} 截止` : ""}`;
  const summary = yktExerciseSummary(detail?.problems ?? []);
  const left = timeLeft(ykt.deadline ?? "");
  // R20-C1：作答/提交入口资格（纯函数；试卷 / 全外链题 / 过截止 / 超次数 → 不出口）
  const eligibility = yktSubmitEligibility({
    kind: ykt.kind,
    deadline: ykt.deadline,
    lateAllowed: detail?.lateAllowed,
    lateDeadline: detail?.lateDeadline,
    maxRetry: detail?.maxRetry,
    problems: detail?.problems,
  });
  // R20-B3：题干渲染的资源通道 Cookie（未登录为空串，字体/图片侧自然降级）
  const yktCookie = getYktCookie();
  const openInWeb = (): void => {
    // R20-A 通道（分流在 openExternalHomework）：桌面 = 系统浏览器；移动 = 应用内桌面模式 WebView
    if (ykt.externalUrl) void openExternalHomework(ykt.externalUrl);
  };
  /** R20-C1：二次确认 → 应用内 WebView 打开官方作答页 → 关闭后重拉真实状态（禁止乐观更新）。 */
  const openSubmit = async (): Promise<void> => {
    const url = ykt.externalUrl;
    if (!url || submitBusy) return;
    const ok = await confirmOk(
      "将打开雨课堂官方作答页完成提交。\n\n页面内是雨课堂官方提交逻辑（含其自身的截止/次数校验与二次确认），请在其中确认后提交；关闭或返回后本页会自动刷新真实状态。",
    );
    if (!ok) return;
    setSubmitBusy(true);
    setSubmitErr("");
    try {
      // 当前会话 Cookie 仅作 invoke 参数内存传递（不打印 / 不落盘）
      await openYktSubmitWebview(url, getYktCookie());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSubmitErr(msg);
      void invoke("log_debug", { line: `R20-C1 打开官方作答页失败: ${msg.slice(0, 300)}` }).catch(() => undefined);
    } finally {
      setSubmitBusy(false);
      // 关闭/返回后立即重新拉取真实状态（禁止乐观更新）
      setTick((t) => t + 1);
    }
  };

  let body: ReactNode;
  if (state === "loading") {
    body = <SkeletonRows rows={5} />;
  } else if (state === "error") {
    body = (
      <>
        <Card>
          <ErrorNote text={errMsg} onRetry={() => setTick((t) => t + 1)} />
          <div className="detail-meta" style={{ padding: "0 16px 10px" }}>
            详情拉取失败不影响列表状态；可用右上角「浏览器打开」走官方页面（R20-A 通道）。
          </div>
        </Card>
      </>
    );
  } else {
    const d = detail!;
    body = (
      <>
        {/* 头部信息条：状态徽标（截止倒计时 / 整卷批改 / 试卷）+ 作业信息键值 */}
        <Card className="detail-head">
          <div className="chips">
            {left.text ? (
              <span className={`chip ${left.overdue ? "chip-red" : "chip-amber"}`}>
                <span className="dot" />
                {left.text}
              </span>
            ) : null}
            <span className={`chip ${summary.chip.cls}`}>{summary.chip.text}</span>
            {ykt.kind === "exam" ? (
              <span className="tag-exam" title="试卷（永不提供提交入口）">考试</span>
            ) : null}
          </div>
          {eligibility.eligible ? (
            <div className="detail-meta">提交将通过应用内官方作答页完成（雨课堂官方确认 / 拦截原样保留）。</div>
          ) : null}
        </Card>

        <Card className="detail-sec">
          <div className="detail-sec-head">作业信息</div>
          <div className="kv">
            <span>截止时间</span>
            <b>{ykt.deadline || "未知"}</b>
          </div>
          {d.lateDeadline ? (
            <div className="kv">
              <span>补交截止</span>
              <b>{d.lateDeadline}</b>
            </div>
          ) : null}
          <div className="kv">
            <span>重交上限</span>
            <b>{fmtMaxRetry(d.maxRetry)}</b>
          </div>
          <div className="kv">
            <span>是否允许迟交</span>
            <b>{d.lateAllowed ? "允许补交" : "不允许补交"}</b>
          </div>
          <div className="kv">
            <span>作答进度</span>
            <b>
              {summary.answered}/{summary.total} 题
            </b>
          </div>
          {summary.scoreSum !== undefined ? (
            <div className="kv">
              <span>我的得分</span>
              <b>{yktScoreText(summary.scoreSum)}（已批题目合计）</b>
            </div>
          ) : null}
        </Card>

        {d.description ? (
          <Card className="detail-sec">
            <div className="detail-sec-head">作业说明</div>
            <div className="ykt-problem-body">
              <ProblemBody html={d.description} fontUrl={d.fontUrl} cookies={yktCookie} title="作业说明" />
            </div>
          </Card>
        ) : null}

        {/* 题目列表（R20-C2：主观题在资格通过时渲染逐题原生作答编辑器；
            客观题/试卷/超次数仍只读——官方页兜底入口保留） */}
        {d.problems.length === 0 ? (
          <Card>
            <Empty text="本作业暂无题目明细（可能接口未返回 problems）。" />
          </Card>
        ) : (
          d.problems.map((p) => (
            <ProblemCard
              key={p.problemId || p.index}
              p={p}
              fontUrl={d.fontUrl}
              cookies={yktCookie}
              answer={
                p.type === 5 && p.problemId && eligibility.eligible ? (
                  <YktAnswerPanel p={p} classroomId={classroomId} onSubmitted={() => setTick((t) => t + 1)} />
                ) : undefined
              }
            />
          ))
        )}
      </>
    );
  }

  return (
    <>
      <PageHead
        title={state === "ok" && detail?.name ? detail.name : ykt.title || "雨课堂作业"}
        meta={meta}
        actions={
          <>
            <BackButton to={from} />
            {eligibility.eligible && ykt.externalUrl ? (
              <button
                className="btn btn-primary"
                disabled={submitBusy}
                onClick={() => void openSubmit()}
                title="应用内打开雨课堂官方作答页（官方提交逻辑原样保留）"
              >
                {submitBusy ? "作答页已打开…" : "作答 / 提交"}
              </button>
            ) : null}
            {ykt.externalUrl ? (
              <button className="btn" onClick={openInWeb} title="在系统浏览器或应用内打开官方页">
                浏览器打开
              </button>
            ) : null}
          </>
        }
      />
      {submitErr ? (
        <Card>
          <ErrorNote text={`打开官方作答页失败：${submitErr}`} onRetry={() => void openSubmit()} />
        </Card>
      ) : null}
      {body}
    </>
  );
}
