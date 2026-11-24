import { courseDisplayName } from "../../lib/learnLanguage.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../../i18n/index.js";
import { vaultCatchAttachment } from "../../lib/vaultCatch.js";
import { Input } from "@onethu/gui";
import { Btn } from "@onethu/gui";
/** 作业只读详情（learnX AssignmentDetail）：提交/批改情况 + 说明富文本 + 四类附件；提交/撤回已移植（tjzy）*/
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { CollectStar } from "../../components/Collect.js";
import { enc } from "../../state/atoms.js";
import { IconDownload } from "../../components/Icons.js";
import { learn, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { openFilePreview } from "../../components/FilePreview.js";
import { RichEditor } from "../../components/RichEditor.js";
import { useApp } from "../../state/context.js";
import { invalidateLearnCache, useLearnData } from "../../state/data.js";
import { withLearnRecovery } from "../../lib/reload.js";
import { BackButton, RichContent, fmtDateTime, gradeLabel, timeLeft } from "./shared.js";
import { useLearnNavSemester } from "./shared.js";
import { openExternal } from "../info/openExternal.js";
import { DownloadOpenButtons } from "../../components/DownloadOpenButtons.js";
import { isAndroidNavigator } from "../../lib/androidHost.js";
import { clearNeedFile, isNeedFile, markNeedFile } from "../../state/learnAttachmentReq.js";
import { parseLearnTime } from "@onethu/core";
import type { HomeworkPageDetail, LearnAttachment } from "@onethu/core";

type DescState = "idle" | "skip" | "loading" | "ok" | "error";

export function AssignmentDetailPage({ courseId: courseIdProp, itemId: itemIdProp }: { courseId?: string; itemId?: string } = {}) {
  const uiLocale = useUiLocale();

  useLearnNavSemester();
  const { navParams, navigate } = useApp();

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
  // 拍照直接上传（R21c，参照雨课堂作答编辑器）：capture=environment 直调后置相机。
  // 判定必须走多信号 isAndroidNavigator——主窗口 UA 被伪装成 Windows，裸 UA 判定恒 false。
  const cameraRef = useRef<HTMLInputElement>(null);
  /** 该作业是否已被服务端判定为必须带附件（附件区显示提示；提交前预检） */
  const [needFileHint, setNeedFileHint] = useState(false);
  const isAndroid = useMemo(() => isAndroidNavigator(navigator), [uiLocale]);
  const subTouched = useRef(false); // 用户改过输入框后不再用上次提交内容预填
  /* 动作分离（用户语义）：提交恒走 isDeleted=0（正文+所选新附件一次覆盖）；
     撤回附件是附件区里的独立按钮、独立请求（isDeleted=1），与提交互不掺和 */
  const [customName, setCustomName] = useState("");
  const [subOk, setSubOk] = useState(true);
  const [dlHint, setDlHint] = useState<{ text: string; path?: string } | null>(null);
  const [dlBusy, setDlBusy] = useState("");

  // 宽屏分栏内嵌（§2.8.2）时由 props 直给，路由页仍走 navParams
  const courseId = courseIdProp ?? navParams?.courseId ?? "";
  const itemId = itemIdProp ?? navParams?.itemId ?? "";

  const h = useMemo(
    () => data?.homework.find((x) => x.courseId === courseId && x.id === itemId) ?? null,
    [uiLocale, data, courseId, itemId],
  );
  // 该作业是否被服务端判定过「必须带附件」：进页时按本地记忆回填
  useEffect(() => {
    setNeedFileHint(isNeedFile(h?.id ?? ""));
  }, [h?.id]);
  const course = useMemo(() => data?.courses.find((c) => c.id === courseId), [uiLocale, data, courseId]);

  // 说明懒加载：列表 content 为空时经 learn.getHomeworkDetail(baseId) 兜底（thu-learn-lib 同款接口）
  useEffect(() => {
    if (!h || descState !== "idle") return;
    const hasContent = (h.content ?? "").replace(/<[^>]*>/g, "").trim().length > 0;
    if (hasContent || !h.baseId) {
      setDescState("skip");
      return;
    }
    const baseId = h.baseId;
    setDescState("loading");
    withLearnRecovery(() => learn.getHomeworkDetail(baseId))
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
    setPageState("loading");
    withLearnRecovery(() => learn.getHomeworkPageDetail(courseId, h.id))
      .then((d) => {
        setPage(d);
        setPageState("ok");
      })
      .catch((err) => {
        setPageError(explainNetworkError(err));
        setPageState("error");
      });
  }, [h, pageState, courseId]);

  const downloadAtt = async (a: LearnAttachment) => {
    setDlBusy(a.id || a.downloadUrl);
    setDlHint(null);
    try {
      const path = await downloadLearnUrl(a.downloadUrl, a.name || `learn-attachment-${a.id}`);
      setDlHint({ text: i18n("pages.learn.assignmentdetailpage.2d2ab24375ce", { path: String(path) }), path });
    } catch (err) {
      setDlHint({ text: i18n("pages.learn.assignmentdetailpage.90f9253844e7") + explainNetworkError(err) });
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
    const prefill = page.submittedContent.trim();
    if (prefill) setSubContent(prefill);
    // eslint 不在依赖里列 subContent：预填只应发生一次（用户未输入时）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState, page]);

  if (!h) {
    return (
      <>
        <PageHead title={i18n("pages.learn.assignmentdetailpage.d4af30a738c7")} actions={<BackButton to={navParams?.from ?? "learn-assignments"} courseId={navParams?.courseId} courseTab="assignments" />} />
        {state === "loading" ? (
          <SkeletonRows rows={4} />
        ) : state === "error" ? (
          <ErrorNote text={error ?? ""} onRetry={() => void reload()} />
        ) : (
          <Card><Empty
            text={i18n("pages.learn.assignmentdetailpage.2cf55742e084")}
            action={<Btn variant="ghost" onClick={() => navigate("learn")}>{i18n("pages.learn.assignmentdetailpage.c9521a639f12")}</Btn>}
          /></Card>
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
    chips.push({ text: h.completionType === 2 ? i18n("pages.learn.assignmentdetailpage.a51ed50447a4") : i18n("pages.learn.assignmentdetailpage.2299fee95921"), cls: "chip-gray" });
  }
  // 注意：没有「提交方式」字段（学生端列表接口不存在该字段），不做线上/线下断言。

  // 四类附件（thu-learn-lib parseHomeworkAtUrl 文档序）：作业/答案/我的提交/批改
  const attGroups: Array<{ label: string; a?: LearnAttachment }> = page
    ? [
        { label: i18n("pages.learn.assignmentdetailpage.d262ea7dc366"), a: page.attachment },
        { label: i18n("pages.learn.assignmentdetailpage.dd6352fd16c7"), a: page.answerAttachment },
        { label: i18n("pages.learn.assignmentdetailpage.1ebfdb88cf58"), a: page.submittedAttachment },
        { label: i18n("pages.learn.assignmentdetailpage.13a5b5219771"), a: page.gradeAttachment },
      ]
    : [];
  const attFound = attGroups.filter((g) => g.a);

  /** Quill 空内容判定：产物是 "<p><br></p>" 之类，纯 trim 不够（learnX removeTags 同源） */
  const richEmpty = (html: string): boolean =>
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .trim() === "";
  const refreshAfterOp = (): void => {
    // 状态与四类附件即时刷新：清 learn 缓存全量重拉（mobile 提交成功后
    // dispatch(getAssignmentsForCourse) 同语义），并重置附件懒加载重取 viewCj
    invalidateLearnCache();
    setPage(null);
    setPageState("idle");
    void reload();
  };
  const opFail = (e: unknown): void => {
    setSubOk(false);
    const msg = e instanceof Error ? e.message : explainNetworkError(e);
    // R21c 用户令：调试现场只进日志，不给用户看（此前把 lastDebug 拼在提示尾部）
    const dbg = (learn.lastDebug ?? "").trim();
    if (dbg) {
      void import("../../lib/clients.js")
        .then((m) => m.logLine(i18n("pages.learn.assignmentdetailpage.f6343b8cf8f0", { msg: String(msg), value: String(dbg.slice(0, 400)) })))
        .catch(() => undefined);
    }
    setSubMsg(msg);
  };

  /** 提交（独立动作，恒走 isDeleted=0）：正文 + 所选新附件（若有）一次覆盖提交 */
  const doSubmit = async (): Promise<void> => {
    if (subBusy) return;
    if (!subFile && richEmpty(subContent)) { setSubOk(false); setSubMsg(i18n("pages.learn.assignmentdetailpage.ffaca36e997c")); return; }
    // R21c 预检：该作业曾被服务端以「请上传附件」拒绝 → 无附件提交必再被拒，
    // 本地直接拦下（不发请求），并把原因说清楚。
    if (!subFile && isNeedFile(h.id)) {
      setSubOk(false);
      setSubMsg(i18n("pages.learn.assignmentdetailpage.b7d31b81f628"));
      return;
    }
    setSubBusy(true);
    setSubMsg("");
    try {
      // 自定义文件名：只换主名、保留扩展名（learnX replaceName 同款，用户输入的点全剥掉）
      let file = subFile;
      if (file && customName.trim()) {
        const dot = file.name.lastIndexOf(".");
        const ext = dot >= 0 ? file.name.slice(dot) : "";
        file = new File([file], customName.trim() + ext, { type: file.type });
      }
      const r = await learn.submitHomework(h.id, { content: subContent, file, remove: false });
      if (!r.ok) {
        const why = r.msg ?? "";
        if (/请上传附件/.test(why)) {
          markNeedFile(h.id); // 服务端权威判定：记下来，之后本地预检拦下
          setNeedFileHint(true);
          throw new Error(i18n("pages.learn.assignmentdetailpage.b7d31b81f628"));
        }
        throw new Error(why || i18n("pages.learn.assignmentdetailpage.272f3e83a699"));
      }
      clearNeedFile(h.id); // 本次带附件提交成功 → 要求以最新为准
      setSubOk(true);
      setSubMsg(i18n("pages.learn.assignmentdetailpage.205dfc7ce8cd"));
      setSubContent("");
      setSubFile(null);
      setCustomName("");
      if (fileRef.current) fileRef.current.value = "";
      refreshAfterOp();
    } catch (e) {
      opFail(e);
    } finally {
      setSubBusy(false);
    }
  };

  /** 撤回附件（独立动作）：isDeleted=1 空手请求；必交附件作业会被服务器以
   *  「请上传附件」拒绝（2026-09-06 实证），失败时明示替代路径。 */
  const doRemove = async (): Promise<void> => {
    if (subBusy) return;
    setSubBusy(true);
    setSubMsg("");
    try {
      const r = await learn.submitHomework(h.id, { remove: true });
      if (!r.ok) {
        const why = r.msg ?? "";
        throw new Error(
          /请上传附件/.test(why)
            ? i18n("pages.learn.assignmentdetailpage.deeb0897ac4a")
            : why || i18n("pages.learn.assignmentdetailpage.b45762984aa4"),
        );
      }
      setSubOk(true);
      setSubMsg(i18n("pages.learn.assignmentdetailpage.df26c6e8713c"));
      refreshAfterOp();
    } catch (e) {
      opFail(e);
    } finally {
      setSubBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title={h.title}
        meta={i18n("pages.learn.assignmentdetailpage.e17b3089f7be", { value: String(courseDisplayName(course) ?? i18n("pages.learn.assignmentdetailpage.60db1afb4022")), value2: String(fmtDateTime(h.deadline)) })}
        actions={
          <>
            <BackButton to={navParams?.from ?? "learn-assignments"} courseId={navParams?.courseId} courseTab="assignments" />
            <CollectStar
              atom={{ kind: "assignment", key: enc(h.courseId, h.id, h.title, course?.name ?? "", data?.semester.id ?? "") }}
              title={h.title}
            />
            <Btn variant="outline" onClick={() => void openExternal(h.url)} titleAttr={i18n("pages.learn.assignmentdetailpage.81ce4f7cb8ae")}>{i18n("pages.learn.assignmentdetailpage.16f19a676cae")}</Btn>
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
        <div className="detail-meta">{i18nRich("pages.learn.assignmentdetailpage.9f7f10c2207d", { value: fmtDateTime(h.publishTime), value2: h.lateDeadline ? i18n("pages.learn.assignmentdetailpage.b05aa8be7054", { value: String(fmtDateTime(h.lateDeadline)) }) : "" })}</div>
      </Card>

      <Card className="detail-sec">
        <div className="detail-sec-head">{i18n("pages.learn.assignmentdetailpage.c35e5710ecdb")}</div>
        <div className="kv">
          <span>{i18n("pages.learn.assignmentdetailpage.6320b4a8722a")}</span>
          <b className={h.submitted ? "" : "t-red"}>{h.submitted ? i18n("pages.learn.assignmentdetailpage.bc37a6110a07") : i18n("pages.learn.assignmentdetailpage.8032af4a590f")}</b>
        </div>
        {h.submitted && h.submitTime ? (
          <div className="kv">
            <span>{h.lateSubmission ? i18n("pages.learn.assignmentdetailpage.3aaa13c526ef") : i18n("pages.learn.assignmentdetailpage.6bc352ca0ce0")}</span>
            <b>{fmtDateTime(h.submitTime)}</b>
          </div>
        ) : null}
      </Card>

      {h.graded ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">{i18n("pages.learn.assignmentdetailpage.cf532be09add")}</div>
          <div className="kv"><span>{i18n("pages.learn.assignmentdetailpage.fdcd1bd074c9")}</span><b>{gradeLabel(h.grade) || i18n("pages.learn.assignmentdetailpage.d42baf1647c8")}</b></div>
          {h.graderName ? (
            <div className="kv"><span>{i18n("pages.learn.assignmentdetailpage.aef634f6b580")}</span><b>{h.graderName}</b></div>
          ) : null}
          {h.gradeTime ? (
            <div className="kv"><span>{i18n("pages.learn.assignmentdetailpage.9bc9d4470d81")}</span><b>{fmtDateTime(h.gradeTime)}</b></div>
          ) : null}
          {h.gradeContent ? (
            <div className="kv kv-wide"><span>{i18n("pages.learn.assignmentdetailpage.6a250414e278")}</span><b>{h.gradeContent}</b></div>
          ) : null}
        </Card>
      ) : null}

      {(pageState !== "idle") || attFound.length ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">{i18n("pages.learn.assignmentdetailpage.c7225dbf105e")}</div>
          {pageState === "loading" ? <div className="detail-meta">{i18n("pages.learn.assignmentdetailpage.39d0d9a70496")}</div> : null}
          {pageState === "error" ? (
            <div className="kv kv-wide">
              <span>{i18n("pages.learn.assignmentdetailpage.c7225dbf105e")}</span>
              <span className="t-red">{pageError}</span>
              <Btn variant="ghost" onClick={retryPage}>{i18n("pages.learn.assignmentdetailpage.b8784c8dd563")}</Btn>
            </div>
          ) : null}
          {(() => {
            const c = page?.submittedContent ?? "";
            const hasBody = c.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim().length > 0;
            if (hasBody) {
              return (
                /* detail-sec 卡片左右 padding 为 0，行距由 .kv 自带——预览块须自带同样的 16px 边距 */
                <div style={{ padding: "4px 16px 0", marginBottom: 6 }}>
                  <div className="detail-meta" style={{ fontWeight: 600, marginBottom: 4 }}>{i18n("pages.learn.assignmentdetailpage.b18ae752b8e6")}</div>
                  <RichContent html={c} />
                </div>
              );
            }
            /* 空态静默：未提交（或服务器本就无正文）时不渲染预览块 */
            return null;
          })()}
          {attFound.map(({ label, a }) => {
            const key = a!.id || a!.downloadUrl;
            return (
              <div className="kv kv-wide" key={label} data-vault-catch={vaultCatchAttachment({ kind: "learn", name: a!.name || i18n("pages.learn.assignmentdetailpage.4010ecf7cd09", { key: String(key) }), url: a!.downloadUrl, label })}>
                <span>{label}</span>
                <b>{a!.name || i18n("pages.learn.assignmentdetailpage.4010ecf7cd09", { key: String(key) })}{a!.size ? `（${a!.size}）` : ""}</b>
                <Btn variant="ghost" onClick={() => openFilePreview({ name: a!.name || i18n("pages.learn.assignmentdetailpage.4010ecf7cd09", { key: String(key) }), url: a!.downloadUrl })}>{i18n("pages.learn.assignmentdetailpage.13d61fea9f17")}</Btn>
                <Btn variant="ghost" disabled={dlBusy === key} onClick={() => void downloadAtt(a!)}><IconDownload width={14} height={14} />{dlBusy === key ? i18n("pages.learn.assignmentdetailpage.bcc2333dc631") : i18n("pages.learn.assignmentdetailpage.4673a2306165")}</Btn>
              </div>
            );
          })}
        </Card>
      ) : null}

      {dlHint ? (
        <div className="error-note dl-done-note" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>{dlHint.text}</span>
          {/* R23：下载完成就地给「打开文件/打开目录」（霖需求；失败态无 path 不渲染按钮） */}
          {dlHint.path ? <DownloadOpenButtons path={dlHint.path} /> : null}
        </div>
      ) : null}

      <Card className="detail-sec">
        <div className="detail-sec-head">{i18n("pages.learn.assignmentdetailpage.f3be30c77097")}</div>
        {descState === "loading" ? (
          <div style={{ padding: "6px 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="skeleton" style={{ height: 12, width: "78%" }} />
            <div className="skeleton" style={{ height: 12, width: "52%" }} />
          </div>
        ) : descState === "error" ? (
          <div className="kv kv-wide">
            <span>{i18n("pages.learn.assignmentdetailpage.4262c45dc797")}</span>
            <span className="t-red">{descError}</span>
            <Btn variant="ghost" onClick={retryDesc}>{i18n("pages.learn.assignmentdetailpage.b8784c8dd563")}</Btn>
          </div>
        ) : (
          <RichContent html={h.content || desc || undefined} fallback={i18n("pages.learn.assignmentdetailpage.f2b212ab6bd2")} />
        )}
      </Card>

      {/* 提交卡只按详情页事实渲染：viewCj 页面解析出提交表单控件（hasSubmitForm）才出现。
          OJ 等无需网堂提交的作业页面没有表单 → 不渲染。提交/撤回成功后
          invalidateLearnCache + reload + 重取 viewCj（下方 doSubmit），页面控件变化
          （如已提交后变为可再次提交/撤回附件）随重取结果即时反映。 */}
      {page?.hasSubmitForm ? (
        <Card className="detail-sec">
          <div className="detail-sec-head">{h.submitted ? i18n("pages.learn.assignmentdetailpage.bd33e412694b") : i18n("pages.learn.assignmentdetailpage.dfb054a0aec6")}</div>
          <div style={{ padding: "8px 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {/* 正文：讨论区同款 Quill 富文本编辑器（zynr 产物即 HTML，与站点提交语义一致） */}
            <RichEditor
              value={subContent}
              onChange={(html) => { subTouched.current = true; setSubContent(html); }}
              placeholder={i18n("pages.learn.assignmentdetailpage.eb587d998b72")}
              maxHeight={220}
            />
            {/* 附件区自成一体：选择/清除/自定义名/撤回（独立请求），与提交按钮无关 */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <input
                ref={fileRef}
                type="file"
                style={{ fontSize: 12 }}
                onChange={(e) => setSubFile(e.target.files?.[0] ?? null)}
                disabled={subBusy}
              />
              {isAndroid ? (
                <>
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f) setSubFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Btn variant="outline" disabled={subBusy} titleAttr={i18n("pages.learn.assignmentdetailpage.af1ceaee5c87")} onClick={() => cameraRef.current?.click()}>{i18n("pages.learn.assignmentdetailpage.1edb50ac35be")}</Btn>
                </>
              ) : null}
              {subFile ? (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center", color: "var(--accent)" }}>{i18nRich("pages.learn.assignmentdetailpage.4a01c31b199b", { name: subFile.name })}<Btn variant="ghost" disabled={subBusy} onClick={() => { setSubFile(null); setCustomName(""); if (fileRef.current) fileRef.current.value = ""; }}>{i18n("pages.learn.assignmentdetailpage.bce2377283c2")}</Btn>
                </span>
              ) : null}
              {page?.submittedAttachment ? (
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  <span style={{ color: "var(--og-content-disabled)" }}>{i18nRich("pages.learn.assignmentdetailpage.36a5f279113f", { name: page.submittedAttachment.name })}</span>
                  <Btn variant="ghost" disabled={subBusy} titleAttr={i18n("pages.learn.assignmentdetailpage.7da05f7e2250")} onClick={() => void doRemove()}>{i18n("pages.learn.assignmentdetailpage.c44cbffc601a")}</Btn>
                </span>
              ) : null}
              {page?.submittedAttachment && subFile ? (
                <span style={{ color: "var(--og-content-disabled)", fontSize: 12 }}>{i18n("pages.learn.assignmentdetailpage.fa9362087d80")}</span>
              ) : null}
            </div>
            {needFileHint ? (
              <div className="exthw-note is-warn">{i18n("pages.learn.assignmentdetailpage.1faef135bf90")}</div>
            ) : null}
            {subFile ? (
              <Input placeholder={i18n("pages.learn.assignmentdetailpage.3023aaec3376", { value: String(subFile.name.includes(".") ? subFile.name.slice(subFile.name.lastIndexOf(".")) : "") })} value={customName} onChange={(value) => setCustomName(value.replaceAll(".", ""))} disabled={subBusy} />
            ) : null}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1 }} />
              <Btn variant="solid" tone="brand" disabled={subBusy || pastDeadline || (!subFile && richEmpty(subContent))} titleAttr={pastDeadline ? i18n("pages.learn.assignmentdetailpage.c118a2400f5a") : undefined} onClick={() => void doSubmit()}>{subBusy ? i18n("pages.learn.assignmentdetailpage.18931020ad52") : i18n("pages.learn.assignmentdetailpage.08a85f4ab4ba")}</Btn>
            </div>
            {pastDeadline ? (
              <div style={{ fontSize: 12, color: "var(--red)" }}>{i18n("pages.learn.assignmentdetailpage.5e883449e2fa")}</div>
            ) : null}
            {h.submitted && h.submitTime ? (
              <div style={{ fontSize: 12, color: "var(--og-content-disabled)" }}>{i18nRich("pages.learn.assignmentdetailpage.c514d7c4f9f2", { value: fmtDateTime(h.submitTime) })}</div>
            ) : null}
            {subMsg ? <div style={{ fontSize: 12, color: subOk ? "var(--green)" : "var(--red)", wordBreak: "break-all" }}>{subMsg}</div> : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}
