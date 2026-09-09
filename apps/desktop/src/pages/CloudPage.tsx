/**
 * 云盘页 —— 清华云盘（Seafile 定制版，Web API 直连）。
 *
 * 认证：一次性 Web API Token（profile 页生成，XOR 混淆落 seafile.cfg.json）。
 * 布局：资料库网格 → 点入库变文件浏览器（面包屑 + 目录/文件行 + 上传/搜索）。
 * 上传走系统选择器 → Rust 直传（字节不过 JS）；下载落 ~/Downloads；
 * 分享生成 /f/ 链接（复制 + 系统浏览器打开）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state/context.js";
import { openExternal } from "./info/openExternal.js";
import {
  ensureSeafileLoaded, setSeafileToken, clearSeafileToken, getSeafileToken,
  refreshSeafileAccount, refreshRepos, useSeafile, useSeafileDir,
  seafileDownload, seafileShare, seafileUpload, seafileSearch,
  type SeafileEntry, type SeafileRepo,
} from "../state/seafile.js";
import { IconRefresh, IconUpload, IconSearch, IconChevron, IconExternal } from "../components/Icons.js";
import { showToast } from "../state/toast.js";

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

const TOKEN_PAGE = "https://cloud.tsinghua.edu.cn/profile/#get-auth-token";

export default function CloudPage(): ReactNode {
  const { navParams } = useApp();
  const { configured, account, repos, busy, lastError } = useSeafile();
  const [repo, setRepo] = useState<SeafileRepo | null>(null);
  const [path, setPath] = useState("/");
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchHits, setSearchHits] = useState<SeafileEntry[] | null>(null);
  const dir = useSeafileDir(repo?.id ?? null, repo ? path : null);

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

  /* ── 未配置：引导页 ── */
  if (!configured) {
    return (
      <div className="page">
        <h2>清华云盘</h2>
        <div className="cloud-onboard">
          <p>
            清华云盘（Seafile）提供完整 Web API。认证只需一个 <b>API Token</b>（一次性生成，长期有效）：
          </p>
          <ol>
            <li>点下面按钮，用清华账号登录云盘网页端</li>
            <li>页面里找 <b>Web API Auth Token</b> 区域，点「生成链接」</li>
            <li>复制展示的 token 粘贴到此处</li>
          </ol>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => openExternal(TOKEN_PAGE)}>打开授权页面</button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 200 }}
              placeholder="粘贴 Seafile API Token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value.trim())}
            />
            <button
              className="btn primary"
              disabled={!tokenInput || savingToken}
              onClick={async () => {
                setSavingToken(true);
                try {
                  const acc = await setSeafileToken(tokenInput);
                  showToast(`云盘已连接：${acc.name || acc.email}`);
                  setTokenInput("");
                  refreshRepos().catch(() => undefined);
                } catch (e) {
                  showToast(`连接失败：${String(e).slice(0, 90)}`);
                } finally {
                  setSavingToken(false);
                }
              }}
            >
              {savingToken ? "连接中…" : "连接"}
            </button>
          </div>
          <p className="dim" style={{ fontSize: "var(--text-xs)" }}>
            Token 仅存本机（混淆落盘），用于直连 cloud.tsinghua.edu.cn。
          </p>
        </div>
      </div>
    );
  }

  /* ── 文件浏览器（已入库） ── */
  if (repo) {
    const entries = dir.entries;
    const crumbs = path === "/" ? [] : path.slice(1).split("/");
    return (
      <div className="page">
        <div className="cloud-toolbar">
          <button className="btn" onClick={() => { setRepo(null); setPath("/"); setSearchHits(null); setSearchText(""); }}>← 资料库</button>
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
            disabled={busy}
            onClick={async () => {
              const r = await invoke<string[]>("seafile_pick_upload", {
                token: getSeafileToken(), repoId: repo.id, parentDir: path,
              }).catch((e) => { showToast(`上传失败：${String(e).slice(0, 80)}`); return null; });
              if (r && r.length) {
                showToast(r.length > 1 ? `已上传 ${r.length} 个文件` : (r[0] ?? "已上传"));
                refreshRepos().catch(() => undefined);
              }
            }}
          >
            <IconUpload style={{ width: 14, height: 14 }} /> 上传
          </button>
        </div>

        <div className="cloud-search">
          <IconSearch style={{ width: 14, height: 14 }} />
          <input
            placeholder={`在「${repo.name}」内搜文件名…`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && searchText.trim()) {
                try {
                  const hits = await seafileSearch(repo.id, searchText.trim());
                  setSearchHits(hits);
                  showToast(`搜到 ${hits.length} 个结果`);
                } catch (err) {
                  showToast(`搜索失败：${String(err).slice(0, 80)}`);
                }
              }
            }}
          />
          {searchHits && (
            <button className="btn" onClick={() => { setSearchHits(null); setSearchText(""); }}>× 退出</button>
          )}
        </div>

        {dir.loading && <p className="dim" style={{ padding: "16px 12px" }}>读取中…</p>}
        {dir.error && <p className="cloud-error">{dir.error}</p>}

        {searchHits !== null ? (
          <div className="cloud-list">
            {searchHits.length === 0 && <p className="dim" style={{ padding: 16 }}>没有匹配的文件</p>}
            {searchHits.map((f, i) => (
              <div className="cloud-row" key={i}>
                <span className={`cloud-kind ${f.kind}`} />
                <span className="cloud-name">{f.name}</span>
                <span className="cloud-meta">{fmtSize(f.size)}{f.mtime ? ` · ${fmtMtime(f.mtime)}` : ""}</span>
              </div>
            ))}
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
                onClick={() => { if (e.kind === "dir") setPath(`${path === "/" ? "" : path}/${e.name}`); }}
                onKeyDown={(ev) => { if (ev.key === "Enter" && e.kind === "dir") setPath(`${path === "/" ? "" : path}/${e.name}`); }}
              >
                <span className={`cloud-kind ${e.kind}`} />
                <span className="cloud-name">{e.name}</span>
                <span className="cloud-meta">{e.kind === "file" ? fmtSize(e.size) : ""}{e.mtime ? ` · ${fmtMtime(e.mtime)}` : ""}</span>
                {e.kind === "file" && (
                  <span className="cloud-actions">
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
                  </span>
                )}
              </div>
            ))}
          </div>
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
        <button className="btn" disabled={busy} onClick={() => { refreshSeafileAccount().catch(() => undefined); refreshRepos().catch(() => undefined); }}>
          <IconRefresh style={{ width: 14, height: 14 }} /> 刷新
        </button>
        <button className="btn" onClick={() => clearSeafileToken().then(() => showToast("已断开云盘"))}>
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
            onClick={() => { setRepo(r); setPath("/"); setSearchHits(null); }}
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
