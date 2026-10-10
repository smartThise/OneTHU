/**
 * 云盘页 —— 清华云盘（Seafile 定制版，Web API 直连）。
 *
 * 认证：静默直连链自动获取访问口令（seafileAuto），XOR 混淆落 seafile.cfg.json。
 * 布局：资料库网格 → 点入库变文件浏览器（面包屑 + 目录/文件行 + 上传/搜索）。
 * 上传走系统选择器 → Rust 直传（字节不过 JS）；下载落 ~/Downloads；
 * 分享生成 /f/ 链接（复制 + 系统浏览器打开）。
 * 2026-10-10 补充：常见格式预览（复用 FilePreview，云盘字节源）、批量下载/删除
 * （批量选择模式）、新建资料库/文件夹、移动文件（跨库目录树选择器）。
 * 删除一律 confirmDanger（alert 级）；新建/移动走普通输入弹层（promptText）。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state/context.js";
import { openExternal } from "./info/openExternal.js";
import {
  ensureSeafileLoaded, clearSeafileToken, getSeafileToken,
  refreshSeafileAccount, refreshRepos, useSeafile, useSeafileDir,
  seafileDownload, seafileShare, seafileSearch, refreshDir,
  type SeafileEntry, type SeafileRepo,
} from "../state/seafile.js";
import { ConnectGate } from "../components/ConnectGate.js";
import { IconRefresh, IconUpload, IconSearch, IconChevron, IconExternal, IconFolderPlus } from "../components/Icons.js";
import { openFilePreview } from "../components/FilePreview.js";
import { showToast } from "../state/toast.js";
import { confirmDanger, promptText } from "../lib/confirm.js";

/** 字节数 → 人类可读 */
function fmtSize(b: number): string {
  if (b < 0) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function fmtMtime(sec: number): string {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  const now = new Date();
  const same = d.getFullYear() === now.getFullYear();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (same && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm;
  if (same) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 常见格式 → dataURL mime（FilePreview 的 <img>/<embed> 通道用；其余按扩展名分流） */
const IMG_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
};
function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMG_MIME[ext]) return IMG_MIME[ext]!;
  if (ext === "pdf") return "application/pdf";
  return "application/octet-stream";
}

/** 云盘文件的预览通道：read_bytes 拉字节（预览上限内），下载走 seafile_download */
function previewCloudFile(repoId: string, path: string, name: string): void {
  openFilePreview({
    name,
    url: "",
    fetchB64: async () => {
      const b64 = await invoke<string>("seafile_read_bytes", {
        token: getSeafileToken(), repoId, path, maxBytes: 48 * 1024 * 1024,
      });
      return { mime: mimeOf(name), b64 };
    },
    download: () => seafileDownload(repoId, path),
  });
}

/** 删除单个文件/目录（alert 级确认——目录整棵递归删，必须醒目） */
async function deleteEntry(repo: SeafileRepo, path: string, e: SeafileEntry): Promise<boolean> {
  const isDir = e.kind === "dir";
  const ok = await confirmDanger(
    isDir
      ? `删除文件夹「${e.name}」？\n\n该文件夹及其全部内容将从云盘永久删除，此操作不可撤销。`
      : `删除文件「${e.name}」（${fmtSize(e.size)}）？\n\n此操作不可撤销。`,
    { title: isDir ? "删除文件夹，请确认！" : "删除文件，请确认！", confirmText: "确认删除" },
  );
  if (!ok) return false;
  await invoke("seafile_delete", { token: getSeafileToken(), repoId: repo.id, path, kind: e.kind });
  return true;
}

/* ── 移动弹层：库下拉 + 目录树逐层展开 ─────────────────────────── */

function MoveModal({
  repos, srcRepoId, srcDir, entry, initialDirs, onClose, onDone,
}: {
  repos: SeafileRepo[];
  srcRepoId: string;
  srcDir: string;
  entry: SeafileEntry;
  /** 当前目录的缓存子目录（弹窗首屏零网络，见 useSeafileDir 的 15s TTL） */
  initialDirs: SeafileEntry[] | null;
  onClose: () => void;
  onDone: (dstRepoId: string, dstDir: string) => void;
}): ReactNode {
  const [repoId, setRepoId] = useState(srcRepoId);
  // 初始层=发起目录：首屏直接用页面缓存渲染（零网络等待），后台再拉新鲜数据覆盖
  const [path, setPath] = useState(srcDir);
  const [dirs, setDirs] = useState<SeafileEntry[]>(initialDirs ?? []);
  const [loading, setLoading] = useState(initialDirs === null);
  const [error, setError] = useState<string | null>(null);
  /** 诊断：渲染后读真实 DOM（行数/首行文字/计算色）——state 有数据但屏上空白时定性 */
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      const el = listRef.current;
      const first = el?.firstElementChild as HTMLElement | null;
      const cs = first ? getComputedStyle(first) : null;
      void import("../lib/clients.js").then(({ logLine }) =>
        logLine(
          `[CLOUD-MOVE] DOM: rows=${el?.childElementCount ?? -1} box=${el?.clientHeight ?? -1}x${el?.clientWidth ?? -1} firstText="${(first?.textContent ?? "").slice(0, 24)}" color=${cs?.color ?? "?"} display=${cs?.display ?? "?"} fontSize=${cs?.fontSize ?? "?"}`,
        ).catch(() => undefined),
      );
    }, 900);
    return () => clearTimeout(t);
  }, [loading, dirs.length, error]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    invoke<SeafileEntry[]>("seafile_dir", { token: getSeafileToken(), repoId, path })
      .then((es) => {
        const onlyDirs = es.filter((x) => x.kind === "dir");
        void import("../lib/clients.js").then(({ logLine }) =>
          logLine(`[CLOUD-MOVE] 目录列表 ok：共 ${es.length} 项，其中文件夹 ${onlyDirs.length} 个（repo=${repoId.slice(0, 8)}… path=${path}）`).catch(() => undefined),
        );
        setDirs(onlyDirs);
      })
      .catch((e) => {
        void import("../lib/clients.js").then(({ logLine }) =>
          logLine(`[CLOUD-MOVE] 目录列表失败：${String(e).slice(0, 90)}`).catch(() => undefined),
        );
        setError(String(e).slice(0, 90));
      })
      .finally(() => setLoading(false));
  }, [repoId, path]);

  const crumbs = path === "/" ? [] : path.slice(1).split("/");
  // 移动目录到自身子目录：服务器会拒绝，前端直接禁掉按钮
  const entryFullPath = `${srcDir === "/" ? "" : srcDir}/${entry.name}/`;
  const selfNest = entry.kind === "dir" && repoId === srcRepoId && ("/" + [...crumbs, ""].join("/") + "/").startsWith(entryFullPath);
  const isSamePlace = repoId === srcRepoId && path === srcDir;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", color: "#1e1432", borderRadius: 16, padding: 18, width: "min(460px, 94vw)", maxHeight: "80dvh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <b style={{ fontSize: 15 }}>移动「{entry.name}」到…〔v4〕</b>
          <span style={{ flex: 1 }} />
          <button className="btn mini" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <select
          className="input"
          style={{ width: "100%", marginBottom: 8 }}
          value={repoId}
          onChange={(e) => { setRepoId(e.target.value); setPath("/"); }}
        >
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          <b className="cloud-crumb-item" onClick={() => setPath("/")}>根目录</b>
          {crumbs.map((c, i) => (
            <span key={i} className="cloud-crumb-item" onClick={() => setPath("/" + crumbs.slice(0, i + 1).join("/"))}>
              <IconChevron style={{ width: 12, height: 12 }} />{c}
            </span>
          ))}
        </div>
        <div ref={listRef} style={{ border: "1px solid #d8dce6", borderRadius: 8, height: 260, overflowY: "auto", padding: 4, background: "#fff", color: "#1e1432", boxSizing: "border-box" }}>
          {loading && <p style={{ padding: 10, margin: 0, color: "#8a8f99" }}>正在读取文件夹…</p>}
          {error && <p className="cloud-error" style={{ padding: 10, margin: 0 }}>{error}</p>}
          {!loading && !error && dirs.length === 0 && <p style={{ padding: 10, margin: 0, color: "#8a8f99" }}>没有子文件夹（将移动到当前位置）</p>}
          {dirs.map((d) => (
            <div
              key={d.name}
              className="cloud-row"
              role="button"
              tabIndex={0}
              onClick={() => setPath(`${path === "/" ? "" : path}/${d.name}`)}
              onKeyDown={(ev) => { if (ev.key === "Enter") setPath(`${path === "/" ? "" : path}/${d.name}`); }}
            >
              <span style={{ width: 8, height: 8, borderRadius: 2, background: "#6d7ff0", flex: "none", display: "inline-block" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#1e1432", fontSize: 14 }}>{d.name}</span>
            </div>
          ))}
        </div>
        {selfNest && <p className="cloud-error" style={{ margin: "8px 0 0" }}>不能移动到自身内部的文件夹</p>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn" onClick={onClose}>取消</button>
          <button
            className="btn primary"
            disabled={selfNest || isSamePlace}
            onClick={() => onDone(repoId, path)}
          >
            移动到这里{isSamePlace ? "（已在原位）" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 页面 ─────────────────────────────────────────────────────── */

export default function CloudPage(): ReactNode {
  const { navParams } = useApp();
  const { configured, account, repos, busy, lastError } = useSeafile();
  const [bindOpen, setBindOpen] = useState(false); // §4.3：口令输入统一走 ConnectGate
  const [repo, setRepo] = useState<SeafileRepo | null>(null);
  const [path, setPath] = useState("/");
  const [sharing, setSharing] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchHits, setSearchHits] = useState<SeafileEntry[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchMeta, setSearchMeta] = useState<{ q: string; ms: number } | null>(null);
  const searchSeqRef = useRef(0);
  const dir = useSeafileDir(repo?.id ?? null, repo ? path : null);

  /* 批量选择模式 */
  const [selMode, setSelMode] = useState(false);
  const [selSet, setSelSet] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  /* 移动弹层目标 */
  const [moving, setMoving] = useState<SeafileEntry | null>(null);

  // 挂载：恢复配置 + 拉账号与资料库
  useEffect(() => {
    (async () => {
      await ensureSeafileLoaded();
      if (getSeafileToken()) {
        refreshSeafileAccount().catch(() => undefined);
        refreshRepos().catch(() => undefined);
      }
    })();
  }, [configured]);

  // 深链：cloudRepo 指定库
  useEffect(() => {
    const rid = navParams?.cloudRepo;
    if (rid && repo?.id !== rid) {
      const r = repos.find((x) => x.id === rid);
      if (r) { setRepo(r); setPath("/"); }
    }
  }, [navParams?.cloudRepo, repos]);

  const exitSel = (): void => { setSelMode(false); setSelSet(new Set()); };

  /** 库内搜索：服务器端整库扫描秒级耗时——立即反馈「搜索中」+ 完成显示耗时，过期响应丢弃 */
  const runSearch = async (): Promise<void> => {
    const q = searchText.trim();
    const repoId = repo?.id;
    if (!q || !repoId || searching) return;
    const seq = ++searchSeqRef.current;
    const t0 = performance.now();
    setSearching(true);
    setSearchMeta({ q, ms: 0 });
    try {
      const hits = await seafileSearch(repoId, q);
      if (seq !== searchSeqRef.current) return; // 已发起新搜索/退出：过期结果丢弃
      setSearchHits(hits);
      setSearchMeta({ q, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      if (seq === searchSeqRef.current) {
        showToast(`搜索失败：${String(e).slice(0, 80)}`);
        setSearchHits(null);
        setSearchMeta(null);
      }
    } finally {
      if (seq === searchSeqRef.current) setSearching(false);
    }
  };

  /** 单项移动落地 */
  const doMove = async (dstRepoId: string, dstDir: string): Promise<void> => {
    const cur = repo;
    const src = path;
    const entry = moving;
    if (!cur || !entry) return;
    setMoving(null);
    try {
      await invoke("seafile_move", {
        token: getSeafileToken(),
        repoId: cur.id,
        path: `${src === "/" ? "" : src}/${entry.name}`,
        kind: entry.kind,
        dstRepo: dstRepoId,
        dstDir,
        newName: "",
      });
      showToast(`已移动「${entry.name}」`);
      refreshDir(cur.id, src).catch(() => undefined);
      refreshRepos().catch(() => undefined);
      if (dstRepoId !== cur.id) refreshDir(dstRepoId, dstDir).catch(() => undefined);
    } catch (e) {
      showToast(`移动失败：${String(e).slice(0, 90)}`);
    }
  };

  /** 批量下载：顺序拉（并行会同时占满带宽，逐个更稳，进度 toast） */
  const batchDownload = async (): Promise<void> => {
    const cur = repo;
    if (!cur || !dir.entries) return;
    const items = dir.entries.filter((e) => e.kind === "file" && selSet.has(e.name));
    if (!items.length) return;
    setBatchBusy(true);
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const e = items[i]!;
      try {
        await seafileDownload(cur.id, `${path === "/" ? "" : path}/${e.name}`);
        ok++;
      } catch (err) {
        showToast(`「${e.name}」下载失败：${String(err).slice(0, 60)}`);
      }
      if (i < items.length - 1) showToast(`下载中 ${i + 1}/${items.length}…`, 1200);
    }
    setBatchBusy(false);
    exitSel();
    showToast(`已下载 ${ok}/${items.length} 个文件`);
  };

  /** 批量删除（alert 级确认） */
  const batchDelete = async (): Promise<void> => {
    const cur = repo;
    if (!cur || !dir.entries) return;
    const items = dir.entries.filter((e) => selSet.has(e.name));
    if (!items.length) return;
    const names = items.map((x) => `· ${x.name}${x.kind === "dir" ? "（文件夹）" : ""}`);
    const shown = names.slice(0, 6).join("\n") + (names.length > 6 ? `\n… 等共 ${names.length} 项` : "");
    const ok = await confirmDanger(
      `删除以下 ${items.length} 项？\n\n${shown}\n\n所选文件与文件夹（含内容）将从云盘永久删除，此操作不可撤销。`,
      { title: `删除 ${items.length} 项，请确认！`, confirmText: "确认删除" },
    );
    if (!ok) return;
    setBatchBusy(true);
    let done = 0;
    for (const e of items) {
      try {
        await invoke("seafile_delete", {
          token: getSeafileToken(), repoId: cur.id,
          path: `${path === "/" ? "" : path}/${e.name}`, kind: e.kind,
        });
        done++;
      } catch (err) {
        showToast(`「${e.name}」删除失败：${String(err).slice(0, 60)}`);
      }
    }
    setBatchBusy(false);
    exitSel();
    showToast(`已删除 ${done}/${items.length} 项`);
    refreshDir(cur.id, path).catch(() => undefined);
    refreshRepos().catch(() => undefined);
  };

  /* ── 未配置：引导页 ── */
  if (!configured) {
    return (
      <div className="page">
        <h2>清华云盘</h2>
        <div className="cloud-onboard">
          <p>连接后可浏览与下载清华云盘文件。</p>
          <p>首次连接会在应用内打开云盘页面。</p>
          <p>登录后读取现有访问口令，不会自动生成或重置。</p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn primary" onClick={() => setBindOpen(true)}>
              连接云盘
            </button>
          </div>
          <ConnectGate need="cloud" open={bindOpen} onClose={() => setBindOpen(false)} />
          <p className="dim" style={{ fontSize: "var(--text-xs)" }}>
            访问口令仅保存在本机，用于连接清华云盘。
          </p>
        </div>
      </div>
    );
  }

  /* ── 文件浏览器（已入库） ── */
  if (repo) {
    const entries = dir.entries;
    const crumbs = path === "/" ? [] : path.slice(1).split("/");
    const allSelected = entries.length > 0 && entries.every((e) => selSet.has(e.name));
    return (
      <div className="page">
        <div className="cloud-toolbar">
          <button className="btn" onClick={() => { setRepo(null); setPath("/"); setSearchHits(null); setSearchText(""); exitSel(); }}>← 资料库</button>
          <div className="cloud-crumb">
            <b onClick={() => { setPath("/"); setSearchHits(null); setSearchText(""); }}>{repo.name}</b>
            {crumbs.map((c, i) => (
              <span key={i} className="cloud-crumb-item" onClick={() => { setPath("/" + crumbs.slice(0, i + 1).join("/")); setSearchHits(null); setSearchText(""); }}>
                <IconChevron style={{ width: 12, height: 12 }} />
                {c}
              </span>
            ))}
          </div>
          <button
            className="btn"
            disabled={batchBusy}
            title="新建文件夹"
            onClick={async () => {
              const name = await promptText("新建文件夹", { placeholder: "文件夹名称" });
              if (!name) return;
              try {
                await invoke("seafile_mkdir", { token: getSeafileToken(), repoId: repo.id, path: `${path === "/" ? "" : path}/${name}` });
                showToast(`已创建「${name}」`);
                refreshDir(repo.id, path).catch(() => undefined);
              } catch (e) {
                showToast(`创建失败：${String(e).slice(0, 80)}`);
              }
            }}
          >
            <IconFolderPlus style={{ width: 14, height: 14 }} /> 新建文件夹
          </button>
          <button
            className="btn"
            disabled={busy || batchBusy}
            onClick={() => {
              if (selMode) { exitSel(); return; }
              setSearchHits(null);
              setSearchText("");
              setSelMode(true);
            }}
          >
            {selMode ? "退出批量" : "批量"}
          </button>
          <button
            className="btn"
            disabled={busy || selMode}
            onClick={async () => {
              const r = await invoke<string[]>("seafile_pick_upload", {
                token: getSeafileToken(), repoId: repo.id, parentDir: path,
              }).catch((e) => { showToast(`上传失败：${String(e).slice(0, 80)}`); return null; });
              if (r && r.length) {
                showToast(r.length > 1 ? `已上传 ${r.length} 个文件` : (r[0] ?? "已上传"));
                refreshRepos().catch(() => undefined);
                refreshDir(repo.id, path).catch(() => undefined); // 立刻刷当前目录（缓存失效）
              }
            }}
          >
            <IconUpload style={{ width: 14, height: 14 }} /> 上传
          </button>
        </div>

        {!selMode && (
          <div className={`cloud-search${searching ? " searching" : ""}`}>
            <span className="cloud-search-icon">
              {searching ? <span className="cloud-spinner" aria-label="搜索中" /> : <IconSearch style={{ width: 14, height: 14 }} />}
            </span>
            <input
              placeholder={`在「${repo.name}」内搜文件名（回车搜索）`}
              value={searchText}
              disabled={searching}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
            />
            {!searching && (searchHits || searchMeta) && (
              <button className="btn mini" onClick={() => { searchSeqRef.current++; setSearchHits(null); setSearchMeta(null); setSearchText(""); }}>退出搜索</button>
            )}
            {searching && <span className="cloud-search-status">搜索中…</span>}
          </div>
        )}

        {dir.loading && <p className="dim" style={{ padding: "16px 12px" }}>读取中…</p>}
        {dir.error && <p className="cloud-error">{dir.error}</p>}

        {selMode ? (
          <div className="cloud-list" role="listbox" aria-label="批量选择">
            {entries.map((e) => {
              const toggle = (): void => setSelSet((s) => { const n = new Set(s); if (n.has(e.name)) n.delete(e.name); else n.add(e.name); return n; });
              return (
                <div
                  key={e.name}
                  className="cloud-row"
                  role="button"
                  tabIndex={0}
                  onClick={toggle}
                  onKeyDown={(ev) => { if (ev.key === "Enter") toggle(); }}
                >
                  <input
                    type="checkbox"
                    style={{ width: 16, height: 16, flex: "none" }}
                    checked={selSet.has(e.name)}
                    onChange={() => undefined}
                    onClick={(ev) => ev.stopPropagation()}
                  />
                  <span className={`cloud-kind ${e.kind}`} />
                  <span className="cloud-name">{e.name}</span>
                  <span className="cloud-meta">{e.kind === "file" ? fmtSize(e.size) : "文件夹"}{e.mtime ? ` · ${fmtMtime(e.mtime)}` : ""}</span>
                </div>
              );
            })}
            {entries.length === 0 && !dir.loading && <p className="dim" style={{ padding: 16 }}>空目录</p>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 0", position: "sticky", bottom: 0, background: "var(--bg, #fff)", borderTop: "1px solid var(--border-soft, rgba(127,127,127,.2))" }}>
              <button
                className="btn"
                onClick={() => setSelSet(allSelected ? new Set() : new Set(entries.map((x) => x.name)))}
              >
                {allSelected ? "取消全选" : "全选"}
              </button>
              <span className="dim" style={{ alignSelf: "center", fontSize: 13 }}>已选 {selSet.size} 项</span>
              <span style={{ flex: 1 }} />
              <button className="btn" disabled={!selSet.size || batchBusy} onClick={() => void batchDownload()}>
                {batchBusy ? "处理中…" : `下载（${selSet.size}）`}
              </button>
              <button
                className="btn"
                style={{ color: "#e5484d", borderColor: "#e5484d" }}
                disabled={!selSet.size || batchBusy}
                onClick={() => void batchDelete()}
              >
                删除（{selSet.size}）
              </button>
            </div>
          </div>
        ) : searching ? (
          <div className="cloud-list" aria-busy="true">
            <div className="cloud-row skeleton-row"><span className="cloud-kind file" /><span className="cloud-name"><span className="skeleton" style={{ width: "38%" }} /></span></div>
            <div className="cloud-row skeleton-row"><span className="cloud-kind file" /><span className="cloud-name"><span className="skeleton" style={{ width: "52%" }} /></span></div>
            <div className="cloud-row skeleton-row"><span className="cloud-kind file" /><span className="cloud-name"><span className="skeleton" style={{ width: "31%" }} /></span></div>
            <div className="cloud-row skeleton-row"><span className="cloud-kind file" /><span className="cloud-name"><span className="skeleton" style={{ width: "44%" }} /></span></div>
          </div>
        ) : searchHits !== null ? (
          <div>
            {searchMeta && (
              <div className="cloud-search-result-head">
                <b>“{searchMeta.q}”</b>
                <span>{searchHits.length} 个结果 · {(searchMeta.ms / 1000).toFixed(1)}s</span>
              </div>
            )}
            <div className="cloud-list">
              {searchHits.length === 0 && searchMeta && <p className="dim" style={{ padding: 16 }}>没有匹配「{searchMeta.q}」的文件</p>}
              {searchHits.map((f, i) => (
                <div className="cloud-row" key={i}>
                  <span className={`cloud-kind ${f.kind}`} />
                  <span className="cloud-name">{f.name}</span>
                  <span className="cloud-meta">{fmtSize(f.size)}{f.mtime ? ` · ${fmtMtime(f.mtime)}` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="cloud-list" role="listbox" aria-label="云盘文件">
            {entries.length === 0 && !dir.loading && <p className="dim" style={{ padding: 16 }}>空目录</p>}
            {entries.map((e) => (
              <div
                key={e.name}
                className="cloud-row"
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (e.kind === "dir") setPath(`${path === "/" ? "" : path}/${e.name}`);
                  else previewCloudFile(repo.id, `${path === "/" ? "" : path}/${e.name}`, e.name);
                }}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter") return;
                  if (e.kind === "dir") setPath(`${path === "/" ? "" : path}/${e.name}`);
                  else previewCloudFile(repo.id, `${path === "/" ? "" : path}/${e.name}`, e.name);
                }}
              >
                <span className={`cloud-kind ${e.kind}`} />
                <span className="cloud-name">{e.name}</span>
                <span className="cloud-meta">{e.kind === "file" ? fmtSize(e.size) : ""}{e.mtime ? ` · ${fmtMtime(e.mtime)}` : ""}</span>
                <span className="cloud-actions">
                  <button className="btn mini" title="移动到其他位置" onClick={(ev) => { ev.stopPropagation(); setMoving(e); }}>
                    移动
                  </button>
                  <button
                    className="btn mini"
                    style={{ color: "#e5484d" }}
                    title={e.kind === "dir" ? "删除文件夹（含全部内容）" : "删除文件"}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void deleteEntry(repo, `${path === "/" ? "" : path}/${e.name}`, e).then((ok) => {
                        if (!ok) return;
                        refreshDir(repo.id, path).catch(() => undefined);
                        refreshRepos().catch(() => undefined);
                      }).catch((err) => showToast(`删除失败：${String(err).slice(0, 80)}`));
                    }}
                  >
                    删除
                  </button>
                  {e.kind === "file" && (
                    <>
                      <button
                        className="btn mini"
                        title="下载到 Downloads"
                        onClick={(ev) => { ev.stopPropagation(); seafileDownload(repo.id, `${path === "/" ? "" : path}/${e.name}`).catch((err) => showToast(String(err).slice(0, 90))); }}
                      >
                        下载
                      </button>
                      <button
                        className="btn mini"
                        title="生成分享链接"
                        disabled={sharing === e.name}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSharing(e.name);
                          seafileShare(repo.id, `${path === "/" ? "" : path}/${e.name}`, 0)
                            .then(async (link) => {
                              await navigator.clipboard.writeText(link).catch(() => undefined);
                              showToast(`分享链接已复制（7 天内有效设置请用网页端）`);
                              openExternal(link).catch(() => undefined);
                            })
                            .catch((err) => showToast(String(err).slice(0, 90)))
                            .finally(() => setSharing(null));
                        }}
                      >
                        {sharing === e.name ? "…" : "分享"}
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {moving && (
          <MoveModal
            repos={repos}
            srcRepoId={repo.id}
            srcDir={path}
            entry={moving}
            initialDirs={dir.entries ? dir.entries.filter((x) => x.kind === "dir") : null}
            onClose={() => setMoving(null)}
            onDone={(dst, dstDir) => void doMove(dst, dstDir)}
          />
        )}
      </div>
    );
  }

  /* ── 资料库网格 ── */
  return (
    <div className="page">
      <div className="cloud-toolbar">
        <h2 style={{ margin: 0 }}>清华云盘</h2>
        <span className="dim" style={{ fontSize: "var(--text-xs)" }}>
          {account ? `${account.name || account.email} · ${fmtSize(account.usage)} / ${fmtSize(account.total)}` : busy ? "连接中…" : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          disabled={busy}
          title="新建资料库"
          onClick={async () => {
            const name = await promptText("新建资料库", { placeholder: "资料库名称" });
            if (!name) return;
            try {
              await invoke("seafile_create_repo", { token: getSeafileToken(), name });
              showToast(`已创建资料库「${name}」`);
              refreshRepos().catch(() => undefined);
            } catch (e) {
              showToast(`创建失败：${String(e).slice(0, 80)}`);
            }
          }}
        >
          <IconFolderPlus style={{ width: 14, height: 14 }} /> 新建资料库
        </button>
        <button className="btn" disabled={busy} onClick={() => { refreshSeafileAccount().catch(() => undefined); refreshRepos().catch(() => undefined); }}>
          <IconRefresh style={{ width: 14, height: 14 }} /> 刷新
        </button>
        <button
          className="btn"
          onClick={async () => {
            const ok = await confirmDanger(
              "断开清华云盘？\n\n⚠️ 几乎所有高级与智能功能都依赖云盘，断开后将失去：\n· 跨设备记忆与主对话同步（AI 记忆只留本机）\n· IM 附件转存云盘（微信/飞书收文件仅可查看）\n· 云盘页浏览/下载与文件归档\n· 记忆库与对话历史的多端漫游\n\n确定要断开吗？（随时可在云盘页一键重连）",
              { title: "断开云盘", confirmText: "确认断开" },
            );
            if (!ok) return;
            await clearSeafileToken();
            showToast("已断开云盘（记忆/附件转为本地模式，随时可重连）");
          }}
        >
          <IconExternal style={{ width: 14, height: 14 }} /> 断开
        </button>
      </div>
      {account && (
        <div className="cloud-quota">
          <div className="cloud-quota-bar">
            <div style={{ width: `${Math.min(100, (account.usage / Math.max(account.total, 1)) * 100)}%` }} />
          </div>
        </div>
      )}
      {lastError && <p className="cloud-error">{lastError}</p>}
      {busy && <p className="dim" style={{ padding: "12px 12px 0" }}>加载资料库…</p>}
      <div className="cloud-grid">
        {repos.map((r) => (
          <div key={r.id} className="cloud-repo" role="button" tabIndex={0}
            onClick={() => { setRepo(r); setPath("/"); setSearchHits(null); exitSel(); }}
            onKeyDown={(ev) => { if (ev.key === "Enter") { setRepo(r); setPath("/"); } }}
          >
            <div className="cloud-repo-icon">▤</div>
            <div className="cloud-repo-body">
              <b>{r.name}</b>
              <span className="dim">{fmtSize(r.size)}{r.mtime ? ` · ${fmtMtime(r.mtime)}` : ""}</span>
            </div>
          </div>
        ))}
        {repos.length === 0 && !busy && <p className="dim" style={{ padding: 16 }}>没有可见的资料库</p>}
      </div>
    </div>
  );
}
