import type { CourseInfo, Homework } from "@onethu/core";
import {
  Banner, Btn, Inline, Input, Row, Segment, Select, Sheet, Stack, Surface, Text, TextArea,
} from "@onethu/gui";
/**
 * 附件动作面板（需求 7）：拿到附件后选「转存云盘 / 交作业（网络学堂 + 雨课堂）/ 发讨论区」。
 *
 * 外壳全收编进 OneGUI（dev3 换血）：旧版自带 SHEET_CSS/`.ohaa-*` 家族样式全部拆除，
 * 遮罩/面板/head/foot/退场动画由 `Sheet` 库件给（portal 到 body、Esc/遮罩关闭、
 * 手机贴底+抓手+安全区都是同一套库件语言）。`lib/attachActions.ts` 里的执行管线、
 * `ConfirmFn` 内联确认闸、结果呈现这三件事仍是本组件自己负责。
 *
 * ## 设计口径
 *  - **确认在面板内完成**（内联确认条，`ConfirmFn` 注入给 lib）：悬浮窗里不依赖宿主是否挂了
 *    `<ConfirmHost/>`，也保证用户在按下「提交」前一眼看到「交到哪份作业、带哪个文件」。
 *  - **上下文不凭空猜**：云盘资料库/目录、课程、作业、板块都要用户看得见地选；
 *    能自动带出的（最近截止的作业）会带出来并**明确标注「可改」**，不静默决定。
 *  - **结果诚实**：`ok / needUi / error` 三态直出（Banner success|warning|error）；`needUi`
 *    时给出下一步（应用内路由提示，雨课堂还会给「打开官方作答页」的真实可点按钮）。
 *  - 不用 `useApp()`：本组件要能在悬浮窗里跑（那里没有 AppProvider）。需要回本体时走
 *    `onDone(result)`，由宿主决定怎么导航。
 *  - 零手写样式：外观档位在 `AttachActionsScope.ts`（scope: ohaa.sheet）里登记；
 *    ChatDock 的点外守卫用 `[data-og-scope="ohaa.sheet"]` 找这层面板。
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { formatSize, sendToOh, type AttachFile } from "../lib/attach.js";
import {
  postDiscussion, rememberedCloudTarget, saveAllToCloud, submitHomework,
  type AttachActionUi, type AttachActionResult, type ConfirmFn,
} from "../lib/attachActions.js";
import { getLearnSnapshot, refreshLearnDataSilently, subscribeLearnData } from "../state/data.js";
import { getExtHwSnapshot, getYktCookie, refreshExtHw, subscribeExtHw } from "../state/exthw.js";
import { ensureSeafileLoaded, openDir, refreshRepos, useSeafile, type SeafileEntry } from "../state/seafile.js";
import { learn, logLine } from "../lib/clients.js";
import { openYktSubmitWebview } from "../lib/yktSubmitWebview.js";
import { confirmOk } from "../lib/confirm.js";
import { isTauri } from "../lib/transport.js";
import { ATTACH_SHEET_SCOPE } from "./AttachActionsScope.js";
import { t as i18n } from "../i18n/index.js";


export type AttachActionId = "cloud" | "homework" | "discussion" | "oh";

export interface AttachActionDone {
  action: AttachActionId;
  result: AttachActionResult;
  files: AttachFile[];
}

export interface AttachActionsSheetProps {
  /** 待处理的附件（生命周期归调用方：本组件不回收 previewUrl） */
  files: AttachFile[];
  /** 关闭面板 */
  onClose?: () => void;
  /** 动作跑完（宿主可据此导航 `result.ui.route` / 记日志 / 刷新列表） */
  onDone?: (done: AttachActionDone) => void;
  initialAction?: AttachActionId;
}

const ACTIONS: Array<{ id: AttachActionId; label: string }> = [
  { id: "cloud", label: "转存云盘" },
  { id: "homework", label: "交作业" },
  { id: "discussion", label: "发讨论区" },
  { id: "oh", label: "问 OH" },
];

/** 路由 → 人话（`needUi` 提示用；不引导航，导航归宿主） */
const ROUTE_LABEL: Record<string, string> = {
  cloud: "云盘页",
  learn: "网络学堂",
  "learn-assignments": "全部作业",
  "learn-assignment-detail": "作业详情页",
  "learn-ykt-detail": "雨课堂作业页",
  "learn-forum-thread": "课程讨论区",
};

/** 结果文案里叠着多行 `\n`：pre-wrap 是排版几何（不是 R2 外观，onegui-guard 不数它） */
const PREWRAP_STYLE: CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word" };

function uiHint(ui: AttachActionUi | undefined): string {
  if (!ui) return "";
  const where = ui.route ? ROUTE_LABEL[ui.route] ?? ui.route : "";
  return where ? `${ui.message}（位置：${where}）` : ui.message;
}

/** 截止时间升序里第一份「未交」的作业 —— 只用于**带出默认值**（面板会标注可改） */
function mostUrgent<T>(list: T[], deadline: (x: T) => string, done: (x: T) => boolean): T | undefined {
  const pending = list.filter((x) => !done(x));
  const pool = pending.length > 0 ? pending : list;
  return [...pool].sort((a, b) => (deadline(a) || "9999").localeCompare(deadline(b) || "9999"))[0];
}

export function AttachActionsSheet({
  files, onClose, onDone, initialAction = "cloud",
}: AttachActionsSheetProps): ReactNode {
  const [action, setAction] = useState<AttachActionId>(initialAction);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ action: AttachActionId; r: AttachActionResult } | null>(null);

  const first = files[0];
  const many = files.length > 1;

  /* ── 面板内联确认（注入给 lib；本组件不依赖宿主是否挂了 ConfirmHost） ──
   * resolver 放 ref 不放 state：结算走函数调用而不是「在 updater 里做副作用」
   * （StrictMode 下 updater 可能被调两次，resolve 只能有一次真动作）。 */
  const confirmResolve = useRef<((v: boolean) => void) | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const askConfirm = useCallback<ConfirmFn>(
    (msg) =>
      new Promise<boolean>((resolve) => {
        confirmResolve.current?.(false); // 新请求顶掉旧请求（旧者按取消结算，防悬挂）
        confirmResolve.current = resolve;
        setConfirmMsg(msg);
      }),
    [],
  );
  const answerConfirm = useCallback((v: boolean): void => {
    const fn = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmMsg(null);
    fn?.(v);
  }, []);

  const close = useCallback((): void => {
    // 面板关掉时若有悬着的确认条：按「取消」结算，绝不让写入悬空
    answerConfirm(false);
    onClose?.();
  }, [answerConfirm, onClose]);

  const finish = useCallback((id: AttachActionId, r: AttachActionResult): void => {
    setResult({ action: id, r });
    onDone?.({ action: id, result: r, files });
  }, [files, onDone]);

  /* ══════════ ① 云盘：资料库 / 目录 ══════════ */
  const sf = useSeafile();
  const [sfReady, setSfReady] = useState(false);
  const [repoId, setRepoId] = useState("");
  const [dir, setDir] = useState("/OH附件");
  const [dirEntries, setDirEntries] = useState<SeafileEntry[] | null>(null);
  const [dirMsg, setDirMsg] = useState("");

  useEffect(() => {
    const memo = rememberedCloudTarget();
    if (memo) {
      setRepoId((cur) => cur || memo.repoId);
      setDir(memo.dir || "/OH附件");
    }
    void ensureSeafileLoaded().then(() => setSfReady(true)).catch(() => setSfReady(true));
  }, []);

  useEffect(() => {
    if (!sfReady || !sf.configured || sf.repos.length > 0) return;
    void refreshRepos().catch(() => undefined);
  }, [sfReady, sf.configured, sf.repos.length]);

  // 只有一个资料库就带出来（用户看得见）；多个库**不猜**，让他自己选
  useEffect(() => {
    if (repoId) return;
    const only = sf.repos.length === 1 ? sf.repos[0] : undefined;
    if (only) setRepoId(only.id);
  }, [repoId, sf.repos]);

  const browseDir = useCallback(async (): Promise<void> => {
    if (!repoId) return;
    setDirMsg("正在读目录…");
    setDirEntries(null);
    try {
      const entries = await openDir(repoId, dir);
      setDirEntries(entries.filter((e) => e.kind === "dir"));
      setDirMsg(entries.length === 0 ? "这个目录还是空的" : "");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDirMsg(`读目录失败：${msg}（目录还不存在的话，上传时会自动创建）`);
    }
  }, [dir, repoId]);

  /* ══════════ ② 交作业：课程 / 作业 ══════════ */
  const learnBundle = useSyncExternalStore(subscribeLearnData, getLearnSnapshot);
  const [learnLoading, setLearnLoading] = useState(false);
  const [platform, setPlatform] = useState<"learn" | "ykt">("learn");
  const [courseId, setCourseId] = useState("");
  const [hwId, setHwId] = useState("");
  const [content, setContent] = useState("");
  const [autoPicked, setAutoPicked] = useState("");

  const courses: CourseInfo[] = learnBundle?.courses ?? [];
  const homeworks: Homework[] = useMemo(
    () => (learnBundle?.homework ?? []).filter((h) => !h.source),
    [learnBundle],
  );
  const courseHw = useMemo(() => homeworks.filter((h) => h.courseId === courseId), [courseId, homeworks]);

  const loadLearn = useCallback(async (): Promise<void> => {
    setLearnLoading(true);
    try {
      await refreshLearnDataSilently();
    } finally {
      setLearnLoading(false);
    }
  }, []);

  // 数据还没进内存（悬浮窗口刚起来时常见）：不自动跑重活，交给用户点「加载」——
  // 但主界面里通常已经有缓存，这里就顺手带出「最近截止的未交作业」。
  useEffect(() => {
    if (action !== "homework" && action !== "discussion") return;
    if (courseId || hwId || platform !== "learn" || homeworks.length === 0) return;
    const urgent = mostUrgent(homeworks, (h) => h.deadline, (h) => h.submitted);
    if (!urgent) return;
    setCourseId(urgent.courseId);
    setHwId(urgent.id);
    const cn = courses.find((c) => c.id === urgent.courseId)?.name ?? urgent.courseId;
    setAutoPicked(`已带出最近截止的作业：${cn} · ${urgent.title}（可改）`);
  }, [action, courseId, courses, homeworks, hwId, platform]);

  const yktItems = useSyncExternalStore(subscribeExtHw, getExtHwSnapshot).items.filter((i) => i.source === "yuketang");
  const [yktCourse, setYktCourse] = useState("");
  const [yktLeaf, setYktLeaf] = useState("");
  const [extLoading, setExtLoading] = useState(false);
  const yktCourses = useMemo(
    () => Array.from(new Set(yktItems.map((i) => i.courseName))).sort(),
    [yktItems],
  );
  const yktRows = useMemo(() => yktItems.filter((i) => i.courseName === yktCourse), [yktCourse, yktItems]);

  useEffect(() => {
    if (platform !== "ykt" || yktCourse || yktItems.length === 0) return;
    const urgent = mostUrgent(yktItems, (i) => i.deadline, (i) => i.submitted);
    if (!urgent) return;
    setYktCourse(urgent.courseName);
    setYktLeaf(urgent.id);
    setAutoPicked(`已带出最近截止的雨课堂作业：${urgent.courseName} · ${urgent.title}（可改）`);
  }, [platform, yktCourse, yktItems]);

  const selectedYkt = yktRows.find((i) => i.id === yktLeaf) ?? undefined;
  const selectedLearnHw = courseHw.find((h) => h.id === hwId) ?? undefined;

  /* ══════════ ③ 发讨论区 ══════════ */
  const [mode, setMode] = useState<"new" | "reply">("new");
  const [boardId, setBoardId] = useState("");
  const [boards, setBoards] = useState<Array<{ bqid: string; name: string }>>([]);
  const [boardsMsg, setBoardsMsg] = useState("");
  const [title, setTitle] = useState(first ? `附件：${first.name}` : "");
  const [body, setBody] = useState("");
  const [threadId, setThreadId] = useState("");

  useEffect(() => {
    if (action !== "discussion" || !courseId) return;
    let alive = true;
    setBoardsMsg("正在拉板块…");
    learn.getBbsBoards(courseId)
      .then((b) => {
        if (!alive) return;
        setBoards(b);
        setBoardsMsg(b.length === 0 ? "这门课没有拿到板块列表（可能未开放讨论区）" : "");
      })
      .catch((e: unknown) => {
        if (alive) setBoardsMsg(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [action, courseId]);

  /* ══════════ 动作执行 ══════════ */
  const runCloud = useCallback(async (): Promise<void> => {
    if (!repoId) {
      finish("cloud", { ok: false, needUi: true, error: "先选一个云盘资料库", ui: { route: "cloud", message: "去云盘页选一个资料库" } });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await saveAllToCloud(files, { repoId, dir, confirm: askConfirm });
      finish("cloud", r);
    } finally {
      setBusy(false);
    }
  }, [askConfirm, dir, files, finish, repoId]);

  const runHomework = useCallback(async (): Promise<void> => {
    if (!first) return;
    setBusy(true);
    setResult(null);
    try {
      if (platform === "ykt") {
        if (!selectedYkt) {
          finish("homework", { ok: false, needUi: true, error: "先选一份雨课堂作业", ui: { route: "learn-assignments", message: "去「全部作业」里选" } });
          return;
        }
        const r = await submitHomework(first, {
          platform: "ykt",
          assignmentId: selectedYkt.leafTypeId ?? "",
          classroomId: selectedYkt.classroomId ?? "",
          externalUrl: selectedYkt.url,
          title: selectedYkt.title,
          courseName: selectedYkt.courseName,
          confirm: askConfirm,
        });
        finish("homework", r);
        return;
      }
      if (!courseId || !hwId || !selectedLearnHw) {
        finish("homework", { ok: false, needUi: true, error: "先选课程和作业（作业要属于所选课程）", ui: { route: "learn-assignments", message: "去「全部作业」里选一份" } });
        return;
      }
      const cn = courses.find((c) => c.id === courseId)?.name ?? "";
      const r = await submitHomework(first, {
        platform: "learn",
        courseId,
        assignmentId: hwId,
        title: selectedLearnHw.title,
        courseName: cn,
        content,
        confirm: askConfirm,
      });
      finish("homework", r);
    } finally {
      setBusy(false);
    }
  }, [askConfirm, content, courseId, courses, finish, first, hwId, platform, selectedLearnHw, selectedYkt]);

  const runDiscussion = useCallback(async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const cn = courses.find((c) => c.id === courseId)?.name ?? "";
      const bn = boards.find((b) => b.bqid === boardId)?.name ?? "";
      const r = await postDiscussion(first ?? null, {
        courseId,
        boardId: mode === "new" ? boardId : undefined,
        threadId: mode === "reply" ? threadId : undefined,
        title: mode === "new" ? title : undefined,
        body,
        courseName: cn,
        boardName: bn,
        confirm: askConfirm,
      });
      finish("discussion", r);
    } finally {
      setBusy(false);
    }
  }, [askConfirm, boardId, boards, body, courseId, courses, finish, first, mode, threadId, title]);

  /** ④ 问 OH（需求 6 的「OH 直接收附件」）：把附件作为一条完整消息发给 OH。
   *  图片会随消息带上字节，**是否真按图像喂模型由 harness 的多模态开关决定**
   *  （前端不镜像那个状态）；答案直接显示在结果区。 */
  const runOh = useCallback(async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const r = await sendToOh(files);
      finish("oh", { ok: true, answer: r.answer, images: r.images });
    } catch (e) {
      finish("oh", { ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, [files, finish]);

  /** needUi 的官方页兜底：雨课堂官方作答页（带当前会话 Cookie，用户自己提交） */
  const [officialBusy, setOfficialBusy] = useState(false);
  const openOfficial = useCallback(async (url: string): Promise<void> => {
    if (officialBusy) return;
    const ok = await confirmOk(
      "将打开雨课堂官方作答页完成提交。\n\n附件要在官方页里再选一次；页面内是雨课堂官方提交逻辑（含其自身的截止/次数校验与二次确认），"
        + "请在其中确认后提交。关闭或返回后回到本面板。",
    );
    if (!ok) return;
    const cookie = getYktCookie();
    if (!cookie) {
      setResult((cur) => (cur ? { ...cur, r: { ...cur.r, error: "雨课堂未登录：请先在 设置 → 外部作业源 登录雨课堂" } } : cur));
      return;
    }
    setOfficialBusy(true);
    try {
      await openYktSubmitWebview(url, cookie);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      void logLine(`[附件] 打开雨课堂官方作答页失败：${msg}`).catch(() => undefined);
      setResult((cur) => (cur ? { ...cur, r: { ...cur.r, error: msg } } : cur));
    } finally {
      setOfficialBusy(false);
    }
  }, [officialBusy]);

  if (!first) return null;

  const showResult = result !== null;
  const r = result?.r;

  return (
    <Sheet open onClose={close} title={i18n("auto.components.AttachActionsSheet.1")} scope={ATTACH_SHEET_SCOPE}>
      <Stack gap={3}>
        {/* ── 文件清单（Row：leading=缩略图 / title=文件名 / meta=大小） ── */}
        <Stack gap={1}>
          {files.map((f, i) => (
            <Row
              key={`${f.name}-${i}`}
              size="sm"
              leading={f.previewUrl ? (
                <img src={f.previewUrl} alt="" style={{ display: "block", width: 34, height: 34, objectFit: "cover" }} />
              ) : null}
              title={f.name}
              meta={`· ${formatSize(f.size)}`}
            />
          ))}
        </Stack>

        {/* ── 动作切换（旧 tabs 语义 → Segment radiogroup，库的统一控件语言） ── */}
        <Segment
          block
          options={ACTIONS.map((a) => ({ value: a.id, label: a.label }))}
          value={action}
          onChange={(value) => {
            setAction(value as AttachActionId);
            setResult(null);
          }}
        />

        {/* ── ① 转存云盘 ── */}
        {action === "cloud" ? (
          <Stack gap={3}>
            {!sfReady ? <Text slot="label" as="div" tone="faint">{i18n("auto.components.AttachActionsSheet.2")}</Text> : null}
            {sfReady && !sf.configured ? (
              <Banner tone="warning" title={i18n("auto.components.AttachActionsSheet.3")} />
            ) : null}
            <Stack gap={1}>
              <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.4")}</Text>
              <Select value={repoId} onChange={(value) => setRepoId(value)}>
                <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                {sf.repos.map((rp) => (
                  <option key={rp.id} value={rp.id}>{rp.name}</option>
                ))}
              </Select>
            </Stack>
            <Stack gap={1}>
              <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.6")}</Text>
              <Inline gap={2}>
                <Input value={dir} onChange={(value) => { setDir(value); setDirEntries(null); }} />
                <Btn variant="outline" disabled={!repoId} onClick={() => void browseDir()}>{i18n("auto.components.AttachActionsSheet.7")}</Btn>
              </Inline>
              {dirMsg ? <Text slot="label" as="div" tone="faint">{dirMsg}</Text> : null}
              {dirEntries && dirEntries.length > 0 ? (
                <Surface level={2} radius="md" pad="sm">
                  <Stack gap={0}>
                    {dirEntries.map((e) => (
                      <Row
                        key={e.name}
                        size="sm"
                        title={e.name}
                        onClick={() => {
                          const base = dir.endsWith("/") ? dir.slice(0, -1) : dir;
                          setDir(`${base}/${e.name}`);
                          setDirEntries(null);
                        }}
                      />
                    ))}
                  </Stack>
                </Surface>
              ) : null}
            </Stack>
            <Text slot="label" as="div" tone="faint">
              {i18n("auto.components.AttachActionsSheet.8")}{many ? `共 ${files.length} 个文件，按顺序逐个上传。` : ""}
            </Text>
            <Inline gap={2} justify="end">
              <Btn variant="outline" onClick={close}>{i18n("auto.components.AttachActionsSheet.9")}</Btn>
              <Btn variant="solid" tone="brand" disabled={busy || !repoId || !sf.configured} onClick={() => void runCloud()}>{busy ? "上传中…" : "上传到云盘"}</Btn>
            </Inline>
          </Stack>
        ) : null}

        {/* ── ② 交作业 ── */}
        {action === "homework" ? (
          <Stack gap={3}>
            <Segment
              size="sm"
              options={[
                { value: "learn", label: i18n("auto.components.AttachActionsSheet.p1") },
                { value: "ykt", label: i18n("auto.components.AttachActionsSheet.p2") },
              ]}
              value={platform}
              onChange={(value) => {
                setPlatform(value as "learn" | "ykt");
                setAutoPicked("");
                setResult(null);
              }}
            />

            {many ? <Banner tone="warning" title={`交作业一次只交一份，这里用第 1 个：${first.name}`} /> : null}

            {homeworks.length === 0 ? (
              <Text slot="label" as="div" tone="faint">
                {i18n("auto.components.AttachActionsSheet.10")}<Btn variant="outline" disabled={learnLoading} onClick={() => void loadLearn()}>{learnLoading ? "加载中…" : "加载课程与作业"}</Btn>
              </Text>
            ) : null}
            {autoPicked ? <Text slot="label" as="div" tone="faint">{autoPicked}</Text> : null}

            {platform === "learn" ? (
              <Stack gap={3}>
                <Stack gap={1}>
                  <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.11")}</Text>
                  <Select value={courseId} onChange={(value) => { setCourseId(value); setHwId(""); }}>
                    <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Stack>
                <Stack gap={1}>
                  <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.12")}</Text>
                  <Select value={hwId} onChange={(value) => setHwId(value)} disabled={!courseId}>
                    <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                    {courseHw.map((h) => (
                      <option key={h.id} value={h.id}>{h.title}{h.submitted ? "（已交）" : ""}</option>
                    ))}
                  </Select>
                </Stack>
                <Stack gap={1}>
                  <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.13")}</Text>
                  <TextArea value={content} onChange={(value) => setContent(value)} placeholder={i18n("auto.components.AttachActionsSheet.14")} />
                </Stack>
                <Text slot="label" as="div" tone="faint">
                  {i18n("auto.components.AttachActionsSheet.15")}</Text>
                <Inline gap={2} justify="end">
                  <Btn variant="outline" onClick={close}>{i18n("auto.components.AttachActionsSheet.9")}</Btn>
                  <Btn variant="solid" tone="brand" disabled={busy || !selectedLearnHw} onClick={() => void runHomework()}>{busy ? "提交中…" : "提交作业"}</Btn>
                </Inline>
              </Stack>
            ) : (
              <Stack gap={3}>
                <Banner
                  tone="warning"
                  title={i18n("auto.components.AttachActionsSheet.16")}
                />
                {yktItems.length === 0 ? (
                  <Text slot="label" as="div" tone="faint">
                    {i18n("auto.components.AttachActionsSheet.17")}<Btn variant="outline" disabled={extLoading} onClick={() => { setExtLoading(true); void refreshExtHw().finally(() => setExtLoading(false)); }}>{extLoading ? "刷新中…" : "刷新雨课堂作业"}</Btn>
                  </Text>
                ) : null}
                <Stack gap={1}>
                  <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.18")}</Text>
                  <Select value={yktCourse} onChange={(value) => { setYktCourse(value); setYktLeaf(""); }}>
                    <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                    {yktCourses.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Stack>
                <Stack gap={1}>
                  <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.19")}</Text>
                  <Select value={yktLeaf} onChange={(value) => setYktLeaf(value)} disabled={!yktCourse}>
                    <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                    {yktRows.map((i) => (
                      <option key={i.id} value={i.id}>{i.title}{i.submitted ? "（已交）" : ""}</option>
                    ))}
                  </Select>
                </Stack>
                <Inline gap={2} justify="end">
                  <Btn variant="outline" onClick={close}>{i18n("auto.components.AttachActionsSheet.9")}</Btn>
                  <Btn variant="solid" tone="brand" disabled={busy || !selectedYkt} onClick={() => void runHomework()}>{busy ? "处理中…" : "去官方页提交"}</Btn>
                </Inline>
              </Stack>
            )}
          </Stack>
        ) : null}

        {/* ── ③ 发讨论区 ── */}
        {action === "discussion" ? (
          <Stack gap={3}>
            <Segment
              size="sm"
              options={[
                { value: "new", label: i18n("auto.components.AttachActionsSheet.p3") },
                { value: "reply", label: i18n("auto.components.AttachActionsSheet.p4") },
              ]}
              value={mode}
              onChange={(value) => {
                setMode(value as "new" | "reply");
                setResult(null);
              }}
            />
            <Stack gap={1}>
              <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.11")}</Text>
              <Select value={courseId} onChange={(value) => { setCourseId(value); setBoardId(""); setHwId(""); }}>
                <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              {courses.length === 0 ? (
                <Text slot="label" as="div" tone="faint">
                  {i18n("auto.components.AttachActionsSheet.20")}<Btn variant="outline" disabled={learnLoading} onClick={() => void loadLearn()}>{learnLoading ? "加载中…" : "加载课程列表"}</Btn>
                </Text>
              ) : null}
            </Stack>
            {mode === "new" ? (
              <Stack gap={1}>
                <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.21")}</Text>
                <Select value={boardId} onChange={(value) => setBoardId(value)} disabled={!courseId}>
                  <option value="">{i18n("auto.components.AttachActionsSheet.5")}</option>
                  {boards.map((b) => <option key={b.bqid} value={b.bqid}>{b.name}</option>)}
                </Select>
                {boardsMsg ? <Text slot="label" as="div" tone="faint">{boardsMsg}</Text> : null}
              </Stack>
            ) : (
              <Stack gap={1}>
                <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.22")}</Text>
                <Input value={threadId} onChange={(value) => setThreadId(value)} placeholder={i18n("auto.components.AttachActionsSheet.23")} />
              </Stack>
            )}
            <Stack gap={1}>
              <Text slot="label" tone="faint">{i18n("auto.components.AttachActionsSheet.24")}</Text>
              <TextArea value={body} onChange={(value) => setBody(value)} placeholder={i18n("auto.components.AttachActionsSheet.25")} />
            </Stack>
            <Text slot="label" as="div" tone="faint">
              {i18n("auto.components.AttachActionsSheet.26")}{first.name}（{formatSize(first.size)}{i18n("auto.components.AttachActionsSheet.27")}</Text>
            <Inline gap={2} justify="end">
              <Btn variant="outline" onClick={close}>{i18n("auto.components.AttachActionsSheet.9")}</Btn>
              <Btn variant="solid" tone="brand" disabled={busy || !courseId} onClick={() => void runDiscussion()}>{busy ? "发布中…" : "发布"}</Btn>
            </Inline>
          </Stack>
        ) : null}

        {/* ── ④ 问 OH（把附件作为一条消息发给 OH） ── */}
        {action === "oh" ? (
          <Stack gap={3}>
            <Text slot="label" as="div" tone="faint">
              {i18n("auto.components.AttachActionsSheet.28")}{files.some((f) => f.mime.startsWith("image/"))
                ? "图片会随消息带上：开了「多模态」开关时按图像模态直接喂给模型（图片文字都能读）；没开时只发送文字说明与预览。"
                : "非图片附件只带名称/类型/大小与文本预览。"}
              {i18n("auto.components.AttachActionsSheet.29")}</Text>
            <Text slot="label" as="div" tone="faint">
              {many ? `${files.length} 个附件会一起发；` : ""}
              {i18n("auto.components.AttachActionsSheet.30")}</Text>
            <Inline gap={2} justify="end">
              <Btn variant="outline" onClick={close}>{i18n("auto.components.AttachActionsSheet.9")}</Btn>
              <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void runOh()}>{busy ? "发送中…" : "发给 OH"}</Btn>
            </Inline>
          </Stack>
        ) : null}

        {/* ── 结果（Banner success|warning|error；多行 \n 原文案保留，按钮行几何内联只此一处） ── */}
        {showResult && r ? (
          <Banner tone={r.ok ? "success" : r.needUi ? "warning" : "error"}>
            <div style={PREWRAP_STYLE}>
              {r.ok ? (r.path ? `已上传：${r.path}` : "已完成") : `${r.needUi ? "需要你继续一步" : "没做成"}\n${r.error ?? ""}`}
              {r.needUi ? `\n${uiHint(r.ui)}` : ""}
              {r.ok && r.answer ? `\n\nOH：${r.answer}` : ""}
              {r.ok && typeof r.images === "number" ? `\n（本次随消息附带 ${r.images} 张图片）` : ""}
            </div>
            {r.needUi && r.ui?.officialUrl && r.ui.officialChannel === "ykt-submit-webview" && isTauri ? (
              <div style={{ marginTop: 8 }}>
                <Btn variant="solid" tone="brand" disabled={officialBusy} onClick={() => void openOfficial(r.ui!.officialUrl!)}>{officialBusy ? "打开中…" : "打开雨课堂官方作答页"}</Btn>
              </div>
            ) : null}
            {r.ok ? (
              <div style={{ marginTop: 8 }}>
                <Btn variant="outline" onClick={close}>{i18n("auto.components.AttachActionsSheet.31")}</Btn>
              </div>
            ) : null}
          </Banner>
        ) : null}

        {/* ── 内联确认（写操作的最后一道闸；confirmResolve ref 约定不变） ── */}
        {confirmMsg ? (
          <Surface level={2} pad="md" radius="md">
            <Stack gap={2}>
              <div style={PREWRAP_STYLE}>
                <Text as="div">{confirmMsg}</Text>
              </div>
              <Inline gap={2} justify="end">
                <Btn variant="outline" onClick={() => answerConfirm(false)}>{i18n("auto.components.AttachActionsSheet.9")}</Btn>
                <Btn variant="solid" tone="error" onClick={() => answerConfirm(true)}>{i18n("auto.components.AttachActionsSheet.32")}</Btn>
              </Inline>
            </Stack>
          </Surface>
        ) : null}
      </Stack>
    </Sheet>
  );
}

/* 旧的手写样式（SHEET_CSS + `.ohaa-*` 家族 + 死掉的 inputStyle）已全部拆除：
   - 遮罩/面板/标题栏/关闭钮/退场动画 = OG Sheet（overlay.tsx 的模态族壳）；
   - 文件行/目录行 = OG Row；动作/平台/模式切换 = OG Segment；
   - 字段 = Stack + Text(slot=label)；warn 与结果/确认 = OG Banner / Surface；
   - 材质档位登记在 AttachActionsScope.ts（scope: ohaa.sheet），面板零 <style>。 */
