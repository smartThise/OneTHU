/** 作业只读详情（learnX AssignmentDetail）：提交/批改情况 + 说明富文本 + 四类附件；提交/撤回已移植（tjzy）*/
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconDownload } from "../../components/Icons.js";
import { learn, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { useApp } from "../../state/context.js";
import { invalidateLearnCache, useLearnData } from "../../state/data.js";
import { BackButton, RichContent, fmtDateTime, gradeLabel, timeLeft } from "./shared.js";
import { openExternal } from "../info/openExternal.js";
import { parseLearnTime } from "@onethu/core";
import type { HomeworkPageDetail, LearnAttachment } from "@onethu/core";

type DescState = "idle" | "skip" | "loading" | "ok" | "error";

export function AssignmentDetailPage() {
  const { navParams, status } = useApp();
  const { data, state, error, reload } = useLearnData();
  const [desc, setDesc] = useState("");
  const [descState, setDescState] = useState<DescState>("idle");
  const [descError, setDescError] = useState("");
  const [page, setPage] = useState<HomeworkPageDetail | null>(null);
  const [pageState, setPageState] = useState<DescState>("idle");
  const [pageError, setPageError] = useState("");
  const [subContent, setSubContent] = useState("");
  const [subFile, setSubFile] = useState<File | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [subMsg, setSubMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const subTouched = useRef(false); // 用户改过输入框后不再用上次提交内容预填
  const [dlHint, setDlHint] = useState<string | null>(null);
  const [dlBusy, setDlBusy] = useState("");

  const courseId = navParams?.courseId ?? "";
  const itemId = navParams?.itemId ?? "";

  const h = useMemo(
    () => data?.homework.find((x) => x.courseId === courseId && x.id === itemId) ?? null,
    [data, courseId, itemId],
  );
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [data, courseId]);

  // 说明懒加载：列表 content 为空时经 learn.getHomeworkDetail(baseId) 兜底（thu-learn-lib 同款接口）
  useEffect(() => {
    if (!h || descState !== "idle") return;
    const hasContent = (h.content ?? "").replace(/<[^>]*>/g, "").trim().length > 0;
    if (hasContent || !h.baseId) {
      setDescState("skip");
      return;
    }
    setDescState("loading");
    learn
      .getHomeworkDetail(h.baseId)
      .then((d) => {
        setDesc(d.description);
        setDescState("ok");
      })
      .catch((err) => {
        setDescError(explainNetworkError(err));
        setDescState("error");
      });
  }, [h, descState]);

  // 附件懒加载：只存在于作业详情 HTML 页（列表/detail JSON 均不含）
  useEffect(() => {
    if (!h || pageState !== "idle") return;
    if (status === "demo") {
      setPageState("skip"); // 演示模式不打真实接口
      return;
    }
    setPageState("loading");
    learn
      .getHomeworkPageDetail(courseId, h.id)
      .then((d) => {
        setPage(d);
        setPageState("ok");
      })
      .catch((err) => {
        setPageError(explainNetworkError(err));
        setPageState("error");
      });
  }, [h, pageState, courseId, status]);

  const downloadAtt = async (a: LearnAttachment) => {
    setDlBusy(a.id || a.downloadUrl);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(a.downloadUrl, a.name || `learn-attachment-${a.id}`);
      setDlHint(`已下载到：${path}`);
    } catch (err) {
      setDlHint("下载失败：" + explainNetworkError(err));
    } finally {
      setDlBusy("");
    }
  };

  const retryPage = () => {
    setPageError("");
    setPageState("idle");
  };

  const retryDesc = () => {
    setDescState("idle");
    setDescError("");
  };

  // 提交面板预填上次提交正文（mobile AssignmentSubmission：content 初值 = submittedContent 去标签）
  useEffect(() => {
    if (pageState !== "ok" || !page?.submittedContent) return;
    if (subTouched.current || subContent.trim()) return;
    const prefill = page.submittedContent.replace(/<[^>]*>/g, "").replace("-->", "").trim();
    if (prefill) setSubContent(prefill);
    // eslint 不在依赖里列 subContent：预填只应发生一次（用户未输入时）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, page]);

  if (!h) {
    return (
      <>
        <PageHead title="作业详情" actions={<BackButton to={navParams?.from ?? "learn-assignments"} courseId={navParams?.courseId} />} />
        {state === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state === "error" ? (
          <ErrorNote text={error ?? ""} onRetry={() => void reload()} />
        ) : (
          <Card><Empty text="未找到该作业，可能数据已刷新，请返回列表重试。" /></Card>
        )}
      </>
    );
  }

  const left = timeLeft(h.deadline);
  // mobile AssignmentDetail：dayjs().isAfter(dayjs(deadline)) → 提交按钮 disabled
  const pastDeadline = (() => {
    const d = parseLearnTime(h.deadline);
    return d ? d.getTime() <= Date.now() : false;
  })();
  const chips: Array<{ text: string; cls: string }> = [];
  if (h.completionType !== undefined) {
    chips.push({ text: h.completionType === 2 ? "小组完成" : "个人完成", cls: "chip-gray" });
  }
  // 注意：没有「提交方式」字段（学生端列表接口不存在该字段），不做线上/线下断言。

  // 四类附件（thu-learn-lib parseHomeworkAtUrl 文档序）：作业/答案/我的提交/批改
  const attGroups: Array<{ label: string; a?: LearnAttachment }> = page
    ? [
        { label: "作业附件", a: page.attachment },
        { label: "答案附件", a: page.answerAttachment },
        { label: "我的提交", a: page.submittedAttachment },
        { label: "批改附件", a: page.gradeAttachment },
      ]
    : [];
  const attFound = attGroups.filter((g) => g.a);

  const doSubmit = async (remove: boolean): Promise<void> => {
    if (subBusy) return;
    if (!remove && !subContent.trim() && !subFile) { setSubMsg("请填写提交内容或选择附件"); return; }
    setSubBusy(true);
    setSubMsg("");
    try {
      const r = await learn.submitHomework(h.id, { content: subContent.trim() || undefined, file: subFile, remove });
      if (r.ok) {
        setSubMsg(remove ? "已撤回附件" : "提交成功");
        setSubContent("");
        setSubFile(null);
        if (fileRef.current) fileRef.current.value = "";
        // 状态与四类附件即时刷新：清 learn 缓存全量重拉（mobile 提交成功后
        // dispatch(getAssignmentsForCourse) 同语义），并重置附件懒加载重取 viewCj
        invalidateLearnCache();
        setPage(null);
        setPageState("idle");
        void reload();
      } else {
        setSubMsg(r.msg || "提交失败");
      }
    } catch (e) {
      setSubMsg(explainNetworkError(e));
    } finally {
      setSubBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title={h.title}
        meta={`${course?.name ?? "课程"} · ${fmtDateTime(h.deadline)} 截止`}
        actions={
          <>
            <BackButton to={navParams?.from ?? "learn-assignments"} courseId={navParams?.courseId} />
            <button className="btn" onClick={() => void openExternal(h.url)} title="在系统浏览器打开">
              网页端打开
            </button>
          </>
        }
      />

      <Card className="detail-head">
        <div className="chips">
          <span className={`chip ${left.overdue ? "chip-red" : "chip-amber"}`}>
            <span className="dot" />
            {left.text}
          </span>
          {chips.map((c) => (
            <span key={c.text} className={`chip ${c.cls}`}>{c.text}</span>
          ))}
        </div>
        <div className="detail-meta">
          发布于 {fmtDateTime(h.publishTime)}
          {h.lateDeadline ? ` · 补交截止 ${fmtDateTime(h.lateDeadline)}` : ""}
        </div>
      </Card>

      <Card className="detail-sec">
        <div className="detail-sec-head">提交情况</div>
        <div className="kv">
          <span>状态</span>
          <b className={h.submitted ? "" : "t-red"}>{h.submitted ? "已提交" : "未提交"}</b>
        </div>
        {h.submitted && h.submitTime ? (
          <div className="kv">
            <span>{h.lateSubmission ? "补交时间" : "提交时间"}</span>
            <b>{fmtDateTime(h.submitTime)}</b>
          </div>
        ) : null}
      </Card>

      {h.graded ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">批改情况</div>
          <div className="kv"><span>成绩</span><b>{gradeLabel(h.grade) || "已批改"}</b></div>
          {h.graderName ? (
            <div className="kv"><span>批改人</span><b>{h.graderName}</b></div>
          ) : null}
          {h.gradeTime ? (
            <div className="kv"><span>批改时间</span><b>{fmtDateTime(h.gradeTime)}</b></div>
          ) : null}
          {h.gradeContent ? (
            <div className="kv kv-wide"><span>批语</span><b>{h.gradeContent}</b></div>
          ) : null}
        </Card>
      ) : null}

      {(pageState !== "idle" && pageState !== "skip") || attFound.length ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">附件</div>
          {pageState === "loading" ? <div className="detail-meta">正在解析附件…</div> : null}
          {pageState === "error" ? (
            <div className="kv kv-wide">
              <span>附件</span>
              <span className="t-red">{pageError}</span>
              <button className="btn btn-ghost" onClick={retryPage}>重试</button>
            </div>
          ) : null}
          {attFound.map(({ label, a }) => {
            const key = a!.id || a!.downloadUrl;
            return (
              <div className="kv kv-wide" key={label}>
                <span>{label}</span>
                <b>{a!.name || `附件 ${key}`}{a!.size ? `（${a!.size}）` : ""}</b>
                <button
                  className="btn btn-ghost"
                  onClick={() => openFilePreview({ name: a!.name || `附件 ${key}`, url: a!.downloadUrl })}
                >
                  预览
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={dlBusy === key}
                  onClick={() => void downloadAtt(a!)}
                >
                  <IconDownload width={14} height={14} />
                  {dlBusy === key ? "下载中…" : "下载"}
                </button>
              </div>
            );
          })}
        </Card>
      ) : null}

      {dlHint ? (
        <div className="error-note" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{dlHint}</span>
        </div>
      ) : null}

      <Card className="detail-sec">
        <div className="detail-sec-head">作业说明</div>
        {descState === "loading" ? (
          <div style={{ padding: "6px 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="skeleton" style={{ height: 12, width: "78%" }} />
            <div className="skeleton" style={{ height: 12, width: "52%" }} />
          </div>
        ) : descState === "error" ? (
          <div className="kv kv-wide">
            <span>说明</span>
            <span className="t-red">{descError}</span>
            <button className="btn btn-ghost" onClick={retryDesc}>重试</button>
          </div>
        ) : (
          <RichContent html={h.content || desc || undefined} fallback="暂无作业说明。" />
        )}
      </Card>

      {/* 提交卡只按详情页事实渲染：viewCj 页面解析出提交表单控件（hasSubmitForm）才出现。
          OJ 等无需网堂提交的作业页面没有表单 → 不渲染。提交/撤回成功后
          invalidateLearnCache + reload + 重取 viewCj（下方 doSubmit），页面控件变化
          （如已提交后变为可再次提交/撤回附件）随重取结果即时反映。 */}
      {page?.hasSubmitForm ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">{h.submitted ? "再次提交 / 修改附件" : "提交作业"}</div>
          <div style={{ padding: "8px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea
              className="input"
              style={{ minHeight: 88, resize: "vertical" }}
              placeholder="提交内容（可留空，附件可选）"
              value={subContent}
              onChange={(e) => { subTouched.current = true; setSubContent(e.target.value); }}
              disabled={subBusy}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={fileRef} type="file" style={{ fontSize: 12 }} onChange={(e) => setSubFile(e.target.files?.[0] ?? null)} disabled={subBusy} />
              <span style={{ flex: 1 }} />
              <button
                className="btn"
                disabled={subBusy || pastDeadline}
                title={pastDeadline ? "已过截止时间（mobile 同款禁用提交）" : undefined}
                onClick={() => void doSubmit(false)}
              >
                {subBusy ? "提交中…" : "提交"}
              </button>
              {h.submitted ? (
                <button
                  className="btn"
                  disabled={subBusy}
                  style={{ color: "var(--red)" }}
                  title="isDeleted=1：仅撤回已上传附件（mobile removeAttachment 语义）"
                  onClick={() => void doSubmit(true)}
                >
                  撤回附件
                </button>
              ) : null}
            </div>
            {pastDeadline ? (
              <div style={{ fontSize: 12, color: "var(--red)" }}>已过截止时间，提交入口已停用（撤回附件仍可用）。</div>
            ) : null}
            {h.submitted && h.submitTime ? (
              <div style={{ fontSize: 12, color: "var(--text-dim, #888)" }}>上次提交于 {fmtDateTime(h.submitTime)}</div>
            ) : null}
            {subMsg ? <div style={{ fontSize: 12, color: subMsg.includes("成功") || subMsg.includes("撤回") ? "var(--green)" : "var(--red)" }}>{subMsg}</div> : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
