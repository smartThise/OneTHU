import { msg as i18nMsg, resolveMessage, type UiText } from "../i18n/index.js";
import { getLocale as getUiLocale } from "../i18n/index.js";
import { t as i18n, rich as i18nRich, useLocale as useUiLocale } from "../i18n/index.js";
/**
 * 「软件更新」分区（设置 → 关于，2026-10-12 合并版）。
 *
 * 一节、一个按钮、**双源并行查询 + 优先级选源**（用户不需要选库/选源）：
 *   GitHub Releases 与 清华云盘官方镜像分享链接同时查；同版本优先校内云盘，
 *   GitHub 严格更新才用 GitHub；一侧失败自动用另一侧。结果卡里注明**实际走了哪条**。
 *
 * 流程：检查更新 →（有新版）「下载并安装」→ 用户确认 → 分段下载（进度可见、可取消、
 * sha256 校验）→ **自动拉起系统安装页**（桌面=系统默认方式打开 DMG/EXE；安卓=系统安装器
 * 确认页）。下载与安装由用户触发；稍后提醒与启动弹窗共用按版本保存的提醒期限。
 *
 * 挂载：`<SoftwareUpdateSection />`（设置 → 关于）。不传 props 即官方双源；
 * 联调时可用 `customManifestUrl` 指向一份 mock 清单。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatSize } from "../lib/attach.js";
import { confirmOk } from "../lib/confirm.js";
import { currentVersion, isDismissed } from "../lib/update.js";
import { readDownloadThreads } from "../lib/downloadPrefs.js";
import { consumeUpdateReview, snoozeUpdate, type UpdateSnooze } from "../lib/updateReminder.js";
import {
  checkForUpdate, downloadUpdate, installDownloaded, platformKey,
  PLATFORM_LABEL, SOURCE_LABEL, updateSourceLabel, updateFallbackText, updateFailureText, type UpdateCheckResult, type UpdateProgress, type UpdateSource,
} from "../lib/updater.js";
import { AccordionItem, Btn, Grow, Inline, Input, Progress, Select, Stack } from "@onethu/gui";

/** Deferred nested values keep app labels live while external reasons stay verbatim. */
interface UpdateNotice { text: UiText; params?: Record<string, UiText> }
function resolveUpdateNotice(notice: UpdateNotice): string {
  if (typeof notice.text === "string" || !notice.params) return resolveMessage(notice.text);
  return resolveMessage({ ...notice.text, params: { ...notice.text.params, ...Object.fromEntries(Object.entries(notice.params).map(([key, value]) => [key, resolveMessage(value)])) } });
}

type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "downloaded" | "error";

export interface SoftwareUpdateSectionProps {
  /** 联调/验收用：直接查这份清单 URL（不填 = 官方双源自动切换） */
  customManifestUrl?: string;
  /** A login-screen review reuses the already fetched release. */
  initialResult?: UpdateCheckResult | null;
  autoCheck?: boolean;
  /** Stop work immediately when a modal starts closing, before its exit unmount. */
  active?: boolean;
  onSnooze?: () => void;
  onChecked?: (result: UpdateCheckResult) => void;
}

export function SoftwareUpdateSection({ customManifestUrl, initialResult, autoCheck = false, active = true, onSnooze, onChecked }: SoftwareUpdateSectionProps = {}): ReactNode {
  const uiLocale = useUiLocale();

  const [phase, setPhase] = useState<Phase>("idle");
  const [res, setRes] = useState<UpdateCheckResult | null>(null);
  const [msg, saveMsg] = useState<UpdateNotice>({ text: "" });
  const [err, saveErr] = useState<UpdateNotice>({ text: "" });
  const setMsg = (text: UiText, params?: Record<string, UiText>) => saveMsg({ text, params });
  const setErr = (text: UiText, params?: Record<string, UiText>) => saveErr({ text, params });
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [reminderDuration, setReminderDuration] = useState<UpdateSnooze>("day");
  const [savedReminder, setSavedReminder] = useState<UpdateSnooze | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const initialReview = useRef<UpdateCheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  /* 自定义更新源默认收起；与其它折叠菜单同一组件，展开态才显示输入行。 */
  const [customOpen, setCustomOpen] = useState(false);
  const checkController = useRef<AbortController | null>(null);
  const checkSequence = useRef(0);
  const [checkingSource, setCheckingSource] = useState<UpdateSource | null>(null);
  const autoStarted = useRef(false);
  const mounted = useRef(true);
  const activeRef = useRef(active); activeRef.current = active;
  const downloadController = useRef<AbortController | null>(null);
  const downloadSequence = useRef(0);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    downloadSequence.current++;
    downloadController.current?.abort(); downloadController.current = null;
  }; }, []);
  useEffect(() => () => { checkSequence.current++; checkController.current?.abort(); }, []);
  useEffect(() => {
    if (active) return;
    checkSequence.current++; checkController.current?.abort(); checkController.current = null;
    downloadSequence.current++; downloadController.current?.abort(); downloadController.current = null;
    setBusy(false);
    setPhase(previous => previous === "checking" ? "idle" : previous === "downloading" ? (res?.ok && res.hasUpdate ? "available" : "idle") : previous);
  }, [active]);
  const version = currentVersion();
  const plat = platformKey();

  useEffect(() => {
    const review = initialResult ?? initialReview.current ?? consumeUpdateReview();
    initialReview.current = review;
    if (!review) return;
    setRes(review); setPhase(!review.ok ? "error" : review.hasUpdate ? "available" : "latest"); setCheckedAt(Date.now());
    const timer = window.setTimeout(() => sectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 240);
    return () => window.clearTimeout(timer);
  }, []);

  const check = useCallback(async (): Promise<void> => {
    if (!activeRef.current || checkController.current) return;
    const controller = new AbortController();
    checkController.current = controller;
    const sequence = ++checkSequence.current;
    setBusy(true);
    setPhase("checking");
    setErr("");
    setMsg("");
    setSavedReminder(null);
    setProgress(null);
    setRes(null);
    try {
    const r = await checkForUpdate({
      customManifestUrl: (customUrl || customManifestUrl || "").trim() || undefined,
      signal: controller.signal,
      onSource: source => { if (activeRef.current && checkSequence.current === sequence) setCheckingSource(source); },
    });
    if (!activeRef.current || checkSequence.current !== sequence) return;
    setRes(r);
    onChecked?.(r);
    setBusy(false);
    setCheckedAt(Date.now());
    if (!r.ok) {
      setPhase("error");
      setErr(""); // The structured attempts below are translated when rendered.
      return;
    }
    setDismissed(Boolean(r.latest && isDismissed(r.latest)));
    if (r.hasUpdate) {
      setPhase("available");
      setMsg(i18nMsg("components.softwareupdatesection.3b98279a2021", { latest: String(r.latest), current: String(r.current) }));
    } else {
      setPhase("latest");
      setMsg("");
    }
    } catch (error) {
      if (!activeRef.current || checkSequence.current !== sequence) return;
      setPhase("error");
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      if (checkSequence.current === sequence) { setBusy(false); checkController.current = null; }
    }
  }, [customManifestUrl, customUrl, onChecked]);

  useEffect(() => {
    if (!active || !autoCheck || initialReview.current || autoStarted.current) return;
    // A deferred start survives React StrictMode's setup/cleanup/setup cycle.
    const timer = window.setTimeout(() => { autoStarted.current = true; void check(); }, 0);
    return () => window.clearTimeout(timer);
  }, [active, autoCheck, check]);

  const cancelCheck = (): void => {
    checkSequence.current++;
    checkController.current?.abort(); checkController.current = null;
    setBusy(false); setPhase("idle"); setMsg(i18nMsg("update.checkCancelled"));
  };

  /** 下载 + 拉起安装页（下载完自动打开安装器；安卓只拉起确认页） */
  const downloadAndInstall = useCallback(async (): Promise<void> => {
    const r = res;
    if (!activeRef.current || downloadController.current || !r?.ok || !r.downloadUrl || !r.downloadName) return;
    const controller = new AbortController();
    downloadController.current = controller;
    const sequence = ++downloadSequence.current;
    const current = (): boolean => mounted.current && activeRef.current && downloadSequence.current === sequence && !controller.signal.aborted;
    try {
    const asset = r.asset;
    const sizeText = asset?.size ? formatSize(asset.size) : i18n("components.softwareupdatesection.f8f5f153c20d");
    const ok = await confirmOk(
      i18nMsg("components.softwareupdatesection.f22fe456ba20", { value: String(updateSourceLabel(r) || i18n("components.softwareupdatesection.4d8c1c5b4283")), latest: String(r.latest), value2: String(PLATFORM_LABEL[plat]), downloadName: String(r.downloadName), sizeText: String(sizeText) }),
    );
    if (!ok || !current()) return;
    setBusy(true);
    setPhase("downloading");
    setErr("");
    setMsg(i18nMsg("components.softwareupdatesection.faa2f14dfa0b", { downloadName: String(r.downloadName) }));
    setProgress({ phase: "probe", received: 0, total: asset?.size ?? 0, percent: 0 });
    const d = await downloadUpdate({
      url: r.downloadUrl,
      fileName: r.downloadName,
      expectSize: asset?.size,
      expectSha256: asset?.sha256,
      // 设置 → 下载 里的线程数（默认 8）；原生侧会在服务器不支持 Range 时自动回落单流。
      threads: readDownloadThreads(),
      signal: controller.signal,
      onProgress: value => { if (current()) setProgress(value); },
    });
    if (!current()) return;
    if (!d.ok) {
      setBusy(false);
      setPhase("error");
      setErr(d.cancelled ? i18nMsg("components.softwareupdatesection.505052ea96fc") : i18nMsg("components.softwareupdatesection.6dd57693b44a", { value: "" }), d.cancelled ? undefined : { value: d.error ?? i18nMsg("components.softwareupdatesection.a1a9da9ee6ed") });
      return;
    }
    setLocalPath(d.path ?? "");
    setPhase("downloaded");
    setMsg(i18nMsg("components.softwareupdatesection.388289c18d09", { value: String(d.size ? formatSize(d.size) : "?"), value2: "" }), { value2: d.verified ? i18nMsg("components.softwareupdatesection.9957c2dd1877") : "" });
    const inst = await installDownloaded(d.path ?? "");
    if (!current()) return;
    setBusy(false);
    if (inst.ok) {
      setMsg(i18nMsg("components.softwareupdatesection.1e178bb2ba4b", { path: String(d.path), value: "" }), { value: inst.hintMessage ?? inst.hint ?? i18nMsg("components.softwareupdatesection.78ed0342345e") });
    } else {
      setPhase("error");
      setErr(i18nMsg("components.softwareupdatesection.fe8283074c76", { path: String(d.path), value: "" }), { value: inst.errorMessage ?? inst.error ?? i18nMsg("components.softwareupdatesection.a1a9da9ee6ed") });
    }
    } finally {
      if (downloadController.current === controller) downloadController.current = null;
      if (current()) setBusy(false);
    }
  }, [plat, res]);

  const cancelDownload = (): void => {
    downloadSequence.current++;
    downloadController.current?.abort(); downloadController.current = null;
    setBusy(false); setPhase("error");
    setMsg(""); setProgress(null);
    setErr(i18nMsg("components.softwareupdatesection.505052ea96fc"));
  };

  const onDismiss = useCallback((): void => {
    if (res?.latest) snoozeUpdate(res.latest, reminderDuration);
    setDismissed(true);
    setSavedReminder(reminderDuration);
    onSnooze?.();
  }, [res, reminderDuration, onSnooze]);
  const reminderLabels = { hour: i18n("update.prompt.hour"), day: i18n("update.prompt.day"), week: i18n("update.prompt.week") };

  const pct = progress?.percent ?? 0;
  const showBar = phase === "downloading";
  const sourceLabel = res ? updateSourceLabel(res) : "";
  const srcLine = sourceLabel ? i18n("components.softwareupdatesection.5b6dd039fc20", { sourceLabel }) : "";
  const fallbackReason = res ? updateFallbackText(res) : "";
  const messageText = resolveUpdateNotice(msg);
  const errorText = phase === "error" && res && !res.ok ? updateFailureText(res) : resolveUpdateNotice(err);
  const shaLine = res?.ok && res.hasUpdate
    ? res.hashAvailable
      ? i18n("components.softwareupdatesection.3c0fc35e4fb6")
      : i18n("components.softwareupdatesection.e18465dcfa9e")
    : "";

  return (
    <div ref={sectionRef} id="row-检查-OneTHU-更新" data-set-id="row-set-update">
      <Stack gap={2}>
      <div>
        <div className="setting-title">{i18nRich("components.softwareupdatesection.c692dd3f13e4", { value: res?.ok && res.hasUpdate ? <span className="update-badge">{i18n("components.softwareupdatesection.daedea385864")}</span> : null })}</div>
        <div className="setting-desc">{i18nRich("components.softwareupdatesection.1aec2113851b", { version: version, value: PLATFORM_LABEL[plat] })}</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Btn variant="solid" tone="brand" loading={phase === "checking"} disabled={busy} onClick={() => void check()}>
          {phase === "checking" ? i18n("update.checkingSource", { source: checkingSource ? SOURCE_LABEL[checkingSource] : "" }) : i18n("components.softwareupdatesection.7f68ebad19ba")}
        </Btn>
        {phase === "checking" ? <Btn variant="outline" onClick={cancelCheck}>{i18n("common.cancel")}</Btn> : null}
        {phase === "available" || (phase === "error" && res?.ok && res.hasUpdate) ? (
          <Btn variant="outline" disabled={busy} onClick={() => void downloadAndInstall()}>
            {phase === "error" ? i18n("components.softwareupdatesection.ea0add721b8e") : i18n("components.softwareupdatesection.ac69f68b7010")}
          </Btn>
        ) : null}
        {showBar ? <Btn variant="ghost" onClick={cancelDownload}>{i18n("components.softwareupdatesection.2cd0f3be8738")}</Btn> : null}
        {phase === "downloaded" && localPath ? (
          <Btn variant="outline" disabled={!active || busy} onClick={() => { if (activeRef.current) void installDownloaded(localPath); }}>{i18n("components.softwareupdatesection.20f2c779de7a")}</Btn>
        ) : null}
      </div>

      {res?.ok && res.hasUpdate && !busy ? <Stack gap={2}>
        <Select value={reminderDuration} aria-label={i18n("update.prompt.delay")} onChange={value => { if (value === "hour" || value === "day" || value === "week") setReminderDuration(value); }} options={[
          { value: "hour", label: i18n("update.prompt.hour") }, { value: "day", label: i18n("update.prompt.day") }, { value: "week", label: i18n("update.prompt.week") },
        ]}/>
        <Btn variant="ghost" onClick={onDismiss}>{i18n("update.prompt.later")}</Btn>
        {savedReminder ? <div className="setting-desc" role="status">{i18n("update.prompt.saved", { duration: reminderLabels[savedReminder] })}</div> : null}
      </Stack> : null}

      {showBar ? (
        <div>
          <Progress value={Math.max(0, Math.min(100, pct)) / 100} aria-label={i18n("components.softwareupdatesection.fad86bf65f72")} />
          <div className="setting-desc">
            {progress?.total
              ? `${Math.round(pct)}%（${formatSize(progress.received)} / ${formatSize(progress.total)}）`
              : i18n("components.softwareupdatesection.165defdf8038", { value: String(progress ? formatSize(progress.received) : "0") })}
            {i18n("components.softwareupdatesection.8314625c2f52")}
          </div>
        </div>
      ) : null}

      {phase === "latest" && res?.ok ? (
        <div className="setting-desc">{i18nRich("components.softwareupdatesection.1b6ff015b8a8", { current: res.current, value: checkedAt ? i18n("components.softwareupdatesection.71ebab125a66", { checkedAt: new Date(checkedAt).toLocaleTimeString(getUiLocale(), { hour: "2-digit", minute: "2-digit" }) }) : "" })}</div>
      ) : null}

      {messageText ? <div className="setting-desc" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{messageText}</div> : null}
      {errorText ? <div className="error-note" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{errorText}</div> : null}

      {res?.ok && res.hasUpdate ? (
        <div className="setting-desc" style={{ whiteSpace: "pre-wrap" }}>
          {i18n("components.softwareupdatesection.d54a23c91b8f", { latest: String(res.latest), value: String(res.releasedAt ? `（${res.releasedAt}）` : "") })
            + `${srcLine ? `\n${srcLine}` : ""}`
            + `${fallbackReason ? i18n("components.softwareupdatesection.18697440c895", { fallbackReason }) : ""}`
            + i18n("components.softwareupdatesection.43e805b35d14", { value: String(res.asset?.name ?? res.downloadName), value2: String(res.asset?.size ? ` · ${formatSize(res.asset.size)}` : "") })
            + `${shaLine ? `\n${shaLine}` : ""}`
            + `${res.belowMin ? i18n("components.softwareupdatesection.cffe690b5ead", { minVersion: String(res.manifest?.minVersion) }) : ""}`
            + `${dismissed ? `\n${i18n("update.prompt.paused")}` : ""}`
            + `${res.notes ? i18n("components.softwareupdatesection.e5958649985d", { notes: String(res.notes) }) : ""}`}
        </div>
      ) : null}

      {plat === "android" && phase !== "idle" ? (
        <div className="setting-desc">{i18n("components.softwareupdatesection.b7d7aca618eb")}</div>
      ) : null}

      <AccordionItem
        id="custom-source"
        title={i18n("components.softwareupdatesection.7e21bf73a0ef")}
        open={customOpen}
        onToggle={() => setCustomOpen((value) => !value)}
      >
        <Stack gap={2}>
          <Inline gap={2} wrap>
            <Grow>
              <Input placeholder={i18n("components.softwareupdatesection.b71ae82b4fba")} value={customUrl} onChange={(value) => setCustomUrl(value)} />
            </Grow>
            <Btn variant="outline" disabled={busy || !customUrl.trim()} onClick={() => void check()}>{i18n("components.softwareupdatesection.abae77ee2a3f")}</Btn>
            <Btn variant="outline" disabled={busy || !customUrl} onClick={() => { setCustomUrl(""); }}>{i18n("components.softwareupdatesection.4370d1b15447")}</Btn>
          </Inline>
          <div className="setting-desc">{i18nRich("components.softwareupdatesection.87c4f699e972", { github: SOURCE_LABEL.github, cloud: SOURCE_LABEL.cloud })}</div>
        </Stack>
      </AccordionItem>
    </Stack>    
    </div>
  );
}
