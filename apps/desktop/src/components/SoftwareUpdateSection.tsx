import { Input } from "@onethu/gui";
/**
 * 「软件更新」分区（设置 → 关于，2026-10-12 合并版）。
 *
 * 一节、一个按钮、**双源自动切换**（用户不需要选库/选源）：
 *   主源 GitHub Releases（`releases/latest/download/latest.json`，外网）→
 *   备用 清华云盘官方镜像分享链接（校内可达）→ 结果卡里注明**实际走了哪条**。
 *
 * 流程：检查更新 →（有新版）「下载并安装」→ 用户确认 → 分段下载（进度可见、可取消、
 * sha256 校验）→ **自动拉起系统安装页**（桌面=系统默认方式打开 DMG/EXE；安卓=系统安装器
 * 确认页）。**绝不静默下载/安装**；「忽略此版本」沿用 `lib/update.js` 的 `dismissTag`
 * （与历史启动提醒共用同一份 localStorage 键）。
 *
 * 挂载：`<SoftwareUpdateSection />`（设置 → 关于）。不传 props 即官方双源；
 * 联调时可用 `customManifestUrl` 指向一份 mock 清单。
 */
import { useCallback, useState, type ReactNode } from "react";
import { formatSize } from "../lib/attach.js";
import { confirmOk } from "../lib/confirm.js";
import { currentVersion, dismissTag, isDismissed } from "../lib/update.js";
import {
  cancelUpdateDownload, checkForUpdate, downloadUpdate, installDownloaded, platformKey,
  PLATFORM_LABEL, SOURCE_LABEL, type UpdateCheckResult, type UpdateProgress,
} from "../lib/updater.js";
import { Btn, Progress, Stack } from "@onethu/gui";
import { t as i18n } from "../i18n/index.js";


type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "downloaded" | "error";

export interface SoftwareUpdateSectionProps {
  /** 联调/验收用：直接查这份清单 URL（不填 = 官方双源自动切换） */
  customManifestUrl?: string;
}

export function SoftwareUpdateSection({ customManifestUrl }: SoftwareUpdateSectionProps = {}): ReactNode {
  const [phase, setPhase] = useState<Phase>("idle");
  const [res, setRes] = useState<UpdateCheckResult | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [localPath, setLocalPath] = useState("");
  const [checkedAt, setCheckedAt] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const version = currentVersion();
  const plat = platformKey();

  const check = useCallback(async (): Promise<void> => {
    setBusy(true);
    setPhase("checking");
    setErr("");
    setMsg("");
    setProgress(null);
    const r = await checkForUpdate({ customManifestUrl: (customUrl || customManifestUrl || "").trim() || undefined });
    setRes(r);
    setBusy(false);
    setCheckedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    if (!r.ok) {
      setPhase("error");
      setErr(r.error ?? "检查失败");
      return;
    }
    setDismissed(Boolean(r.latest && isDismissed(r.latest)));
    if (r.hasUpdate) {
      setPhase("available");
      setMsg(`发现新版本 v${r.latest}（当前 v${r.current}）`);
    } else {
      setPhase("latest");
      setMsg("");
    }
  }, [customManifestUrl, customUrl]);

  /** 下载 + 拉起安装页（下载完自动打开安装器；安卓只拉起确认页） */
  const downloadAndInstall = useCallback(async (): Promise<void> => {
    const r = res;
    if (!r?.ok || !r.downloadUrl || !r.downloadName) return;
    const asset = r.asset;
    const sizeText = asset?.size ? formatSize(asset.size) : "大小未知";
    const ok = await confirmOk(
      `将从更新源下载安装包并交给系统安装器：\n\n`
        + `来源：${r.sourceLabel ?? "未知"}\n版本：v${r.latest}\n平台：${PLATFORM_LABEL[plat]}\n`
        + `文件：${r.downloadName}（${sizeText}）\n落点：应用缓存目录下的 updates/\n\n`
        + `点「确定」= 开始下载；下载完成后由系统安装器接手（安卓会在系统页里再确认一次，不会静默安装）。`,
    );
    if (!ok) return;
    setBusy(true);
    setPhase("downloading");
    setErr("");
    setMsg(`正在下载 ${r.downloadName}…`);
    setProgress({ phase: "probe", received: 0, total: asset?.size ?? 0, percent: 0 });
    const d = await downloadUpdate({
      url: r.downloadUrl,
      fileName: r.downloadName,
      expectSize: asset?.size,
      expectSha256: asset?.sha256,
      onProgress: setProgress,
    });
    if (!d.ok) {
      setBusy(false);
      setPhase("error");
      setErr(d.cancelled ? "已取消下载（没有留下残缺文件）" : `下载失败：${d.error ?? "未知原因"}`);
      return;
    }
    setLocalPath(d.path ?? "");
    setPhase("downloaded");
    setMsg(`下载完成（${d.size ? formatSize(d.size) : "?"}${d.verified ? " · sha256 已校验" : ""}），正在拉起系统安装页…`);
    const inst = await installDownloaded(d.path ?? "");
    setBusy(false);
    if (inst.ok) {
      setMsg(`已下载到 ${d.path}\n${inst.hint ?? "已拉起系统安装页。"}`);
    } else {
      setPhase("error");
      setErr(`已下载到 ${d.path}，但拉起安装页失败：${inst.error ?? "未知原因"}（可手动打开该文件）`);
    }
  }, [plat, res]);

  const onDismiss = useCallback((): void => {
    if (res?.latest) dismissTag(res.latest);
    setDismissed(true);
  }, [res]);

  const pct = progress?.percent ?? 0;
  const showBar = phase === "downloading";
  const srcLine = res?.sourceLabel ? `来源：${res.sourceLabel}` : "";
  const shaLine = res?.ok && res.hasUpdate
    ? res.hashAvailable
      ? "sha256：清单已提供，下载时逐段校验（不符即拒绝安装）"
      : "sha256：该源未提供（按文件大小校验）"
    : "";

  return (
    <div id="row-检查-OneTHU-更新">
      <Stack gap={2}>
      <div>
        <div className="setting-title">
          {i18n("auto.components.SoftwareUpdateSection.1")}{res?.ok && res.hasUpdate ? <span className="update-badge">{i18n("auto.components.SoftwareUpdateSection.2")}</span> : null}
        </div>
        <div className="setting-desc">
          {i18n("auto.components.SoftwareUpdateSection.3")}{version} · {PLATFORM_LABEL[plat]}）
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Btn variant="solid" tone="brand" loading={phase === "checking"} disabled={busy} onClick={() => void check()}>
          {phase === "checking" ? "检查中…" : "检查更新"}
        </Btn>
        {phase === "available" || (phase === "error" && res?.ok && res.hasUpdate) ? (
          <Btn variant="outline" disabled={busy} onClick={() => void downloadAndInstall()}>
            {phase === "error" ? "重试：下载并安装" : "下载并安装"}
          </Btn>
        ) : null}
        {showBar ? <Btn variant="ghost" onClick={() => void cancelUpdateDownload()}>{i18n("auto.components.SoftwareUpdateSection.4")}</Btn> : null}
        {phase === "downloaded" && localPath ? (
          <Btn variant="outline" onClick={() => void installDownloaded(localPath)}>{i18n("auto.components.SoftwareUpdateSection.5")}</Btn>
        ) : null}
        {res?.ok && res.hasUpdate && !dismissed ? (
          <Btn variant="ghost" onClick={onDismiss}>{i18n("auto.components.SoftwareUpdateSection.6")}</Btn>
        ) : null}
      </div>

      {showBar ? (
        <div>
          <Progress value={Math.max(0, Math.min(100, pct)) / 100} aria-label={i18n("auto.components.SoftwareUpdateSection.7")} />
          <div className="setting-desc">
            {progress?.total
              ? `${Math.round(pct)}%（${formatSize(progress.received)} / ${formatSize(progress.total)}）`
              : `已下载 ${progress ? formatSize(progress.received) : "0"}`}
            {" · 可随时取消"}
          </div>
        </div>
      ) : null}

      {phase === "latest" && res?.ok ? (
        <div className="setting-desc">{i18n("auto.components.SoftwareUpdateSection.8")}{res.current}{checkedAt ? ` · 检查时间 ${checkedAt}` : ""}）</div>
      ) : null}

      {msg ? <div className="setting-desc" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{msg}</div> : null}
      {err ? <div className="error-note" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{err}</div> : null}

      {res?.ok && res.hasUpdate ? (
        <div className="setting-desc" style={{ whiteSpace: "pre-wrap" }}>
          {`版本：v${res.latest}${res.releasedAt ? `（${res.releasedAt}）` : ""}`
            + `${srcLine ? `\n${srcLine}` : ""}`
            + `${res.fallbackReason ? `\n（已自动换源：${res.fallbackReason}）` : ""}`
            + `\n安装包：${res.asset?.name ?? res.downloadName}${res.asset?.size ? ` · ${formatSize(res.asset.size)}` : ""}`
            + `${shaLine ? `\n${shaLine}` : ""}`
            + `${res.belowMin ? `\n注意：当前版本低于清单要求的 v${res.manifest?.minVersion}，建议尽快更新。` : ""}`
            + `${dismissed ? "\n已忽略此版本的提醒（不影响下载与安装）。" : ""}`
            + `${res.notes ? `\n\n更新说明：\n${res.notes}` : ""}`}
        </div>
      ) : null}

      {plat === "android" && phase !== "idle" ? (
        <div className="setting-desc">
          {i18n("auto.components.SoftwareUpdateSection.9")}</div>
      ) : null}

      <details>
        <summary className="setting-desc" style={{ cursor: "pointer" }}>{i18n("auto.components.SoftwareUpdateSection.10")}</summary>
        <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>{<Input placeholder={i18n("auto.components.SoftwareUpdateSection.11")} value={customUrl} onChange={(value) => setCustomUrl(value)} />}</div>
          <Btn variant="outline" disabled={busy || !customUrl.trim()} onClick={() => void check()}>{i18n("auto.components.SoftwareUpdateSection.12")}</Btn>
          <Btn variant="outline" disabled={busy || !customUrl} onClick={() => { setCustomUrl(""); }}>{i18n("auto.components.SoftwareUpdateSection.13")}</Btn>
        </div>
        <div className="setting-desc" style={{ marginTop: 4 }}>
          {i18n("auto.components.SoftwareUpdateSection.14")}{SOURCE_LABEL.github} → {SOURCE_LABEL.cloud}）。
        </div>
      </details>
    </Stack>    
    </div>
  );
}
