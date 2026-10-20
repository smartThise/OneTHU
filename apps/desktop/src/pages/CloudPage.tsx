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
 *
 * 2026-10-14 OneGUI 换血：资料库格（Grid+Card flush interactive+Row）、文件/批量/搜索行
 * （Card flush + List divided + Row：目录=IconFolder accent、文件=IconFile content-2 内容语义）、
 * 移动弹层（OG Modal，原生 select 保留——WKWebView 系统绘制实录）、库内搜索（OG Input type=search
 * + Spinner/Tag 状态）、配额条（Progress）、空态（EmptyState）全部来自 @onethu/gui。
 * 同步删除 .cloud-onboard/.cloud-toolbar/.cloud-crumb 系列 / .cloud-quota 系列 / .cloud-grid / .cloud-repo 系列 /
 * .cloud-search 系列 /.cloud-error/.cloud-spinner(+@keyframes cloud-spin)/.cloud-actions/
 * .cloud-search-result-head/.cloud-row.skeleton-row 私有 CSS；
 * .cloud-list/.cloud-row/.cloud-kind/.cloud-name/.cloud-meta 仍被 GitLabPage 共用，待其迁移再烧。
 */
import { vaultCatchCloudFile } from "../lib/vaultCatch.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useApp } from "../state/context.js";
import { openExternal } from "./info/openExternal.js";
import {
  ensureSeafileLoaded, getSeafileToken,
  refreshSeafileAccount, refreshRepos, useSeafile, useSeafileDir,
  seafileDownload, seafileShare, seafileSearch, refreshDir,
  type SeafileEntry, type SeafileRepo,
} from "../state/seafile.js";
import { ConnectGate } from "../components/ConnectGate.js";
import { openFilePreview } from "../components/FilePreview.js";
import { showToast } from "../state/toast.js";
import { confirmDanger, promptText } from "../lib/confirm.js";
import {
  Breadcrumb, Btn, Card, Checkbox, EmptyState, Grid, Grow, IconChevron, IconExternal, IconFile,
  IconFolder, IconFolderPlus, IconRefresh, IconSearch, IconUpload, Inline, Input, List, LoadingBlock,
  Modal, Progress, Row, Select, Spacer, Spinner, Stack, Surface, Tag, Text,
} from "@onethu/gui";
import { t as i18n } from "../i18n/index.js";


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
    { title: isDir ? "删除文件夹，请确认！" : "删除文件，请确认！", confirmText: i18n("auto.pages.CloudPage.p1") },
  );
  if (!ok) return false;
  await invoke("seafile_delete", { token: getSeafileToken(), repoId: repo.id, path, kind: e.kind });
  return true;
}

/** 行首类型图标：内容语义走 OG 语义令牌（目录=accent、文件=content-2，靠库里的字色工具类） */
function kindIcon(kind: SeafileEntry["kind"]): ReactNode {
  return kind === "dir"
    ? <IconFolder size="sm" className="og-text--t-brand" title={i18n("auto.pages.CloudPage.1")} />
    : <IconFile size="sm" title={i18n("auto.pages.CloudPage.2")} />;
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
    <Modal
      open
      onClose={onClose}
      title={`移动「${entry.name}」到…`}
      foot={
        <>
          <Btn variant="outline" onClick={onClose}>{i18n("auto.pages.CloudPage.3")}</Btn>
          <Btn variant="outline" disabled={selfNest || isSamePlace} onClick={() => onDone(repoId, path)}>
            {i18n("auto.pages.CloudPage.4")}{isSamePlace ? "（已在原位）" : ""}
          </Btn>
        </>
      }
    >
      <Stack gap={3}>
        <Select value={repoId} aria-label={i18n("auto.pages.CloudPage.5")} onChange={(value) => { setRepoId(value); setPath("/"); }}>
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Breadcrumb
          items={[
            { label: i18n("auto.pages.CloudPage.p2"), onClick: () => setPath("/") },
            ...crumbs.map((c, i) => ({ label: c, onClick: () => setPath("/" + crumbs.slice(0, i + 1).join("/")) })),
          ]}
          separator={<IconChevron size="sm" />}
        />
        {error && <Text as="p" slot="micro" tone="error">{error}</Text>}
        {/* WKWebView 合成层怪病（v4 实录：DOM 正确、字面样式仍全白）——目标文件夹
            改用原生 select（系统绘制）：选中即进入该层，面包屑点返回上级。 */}
        <Select value="" aria-label={i18n("auto.pages.CloudPage.6")} onChange={(value) => {
            const v = value;
            if (v) setPath(`${path === "/" ? "" : path}/${v}`);
          }}>
          <option value="">
            {loading
              ? "正在读取文件夹…"
              : dirs.length
                ? `进入子文件夹（当前层 ${dirs.length} 个）▸`
                : "当前层没有子文件夹——可直接点「移动到这里」"}
          </option>
          {dirs.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
        </Select>
        {selfNest && <Text as="p" slot="micro" tone="error">{i18n("auto.pages.CloudPage.7")}</Text>}
      </Stack>
    </Modal>
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
      { title: `删除 ${items.length} 项，请确认！`, confirmText: i18n("auto.pages.CloudPage.p3") },
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
      <Stack gap={3}>
        <Text slot="title" as="h2">{i18n("auto.pages.CloudPage.8")}</Text>
        <div style={{ maxWidth: "520px" }}>
          <Card>
            <Stack gap={2}>
              <Text as="p">{i18n("auto.pages.CloudPage.9")}</Text>
              <Text as="p">{i18n("auto.pages.CloudPage.10")}</Text>
              <Text as="p">{i18n("auto.pages.CloudPage.11")}</Text>
              <Inline gap={2}>
                <Btn variant="outline" onClick={() => setBindOpen(true)}>{i18n("auto.pages.CloudPage.12")}</Btn>
              </Inline>
              <ConnectGate need="cloud" open={bindOpen} onClose={() => setBindOpen(false)} />
              <Text as="p" slot="micro" tone="faint">{i18n("auto.pages.CloudPage.13")}</Text>
            </Stack>
          </Card>
        </div>
      </Stack>
    );
  }

  /* ── 文件浏览器（已入库） ── */
  if (repo) {
    const entries = dir.entries;
    const crumbs = path === "/" ? [] : path.slice(1).split("/");
    const allSelected = entries.length > 0 && entries.every((e) => selSet.has(e.name));
    return (
      <Stack gap={2}>
        <Inline gap={2} wrap>
          <Btn variant="outline" onClick={() => { setRepo(null); setPath("/"); setSearchHits(null); setSearchText(""); exitSel(); }}>{i18n("auto.pages.CloudPage.14")}</Btn>
          <Grow>
            <Breadcrumb
              items={[
                { label: repo.name, onClick: () => { setPath("/"); setSearchHits(null); setSearchText(""); } },
                ...crumbs.map((c, i) => ({ label: c, onClick: () => { setPath("/" + crumbs.slice(0, i + 1).join("/")); setSearchHits(null); setSearchText(""); } })),
              ]}
              separator={<IconChevron size="sm" />}
            />
          </Grow>
          <Btn variant="outline" disabled={batchBusy} icon={<IconFolderPlus size="sm" />} titleAttr={i18n("auto.pages.CloudPage.15")} onClick={async () => {
              const name = await promptText("新建文件夹", { placeholder: i18n("auto.pages.CloudPage.p4") });
              if (!name) return;
              try {
                await invoke("seafile_mkdir", { token: getSeafileToken(), repoId: repo.id, path: `${path === "/" ? "" : path}/${name}` });
                showToast(`已创建「${name}」`);
                refreshDir(repo.id, path).catch(() => undefined);
              } catch (e) {
                showToast(`创建失败：${String(e).slice(0, 80)}`);
              }
            }}>{i18n("auto.pages.CloudPage.15")}</Btn>
          <Btn variant="outline" disabled={busy || batchBusy} onClick={() => {
              if (selMode) { exitSel(); return; }
              setSearchHits(null);
              setSearchText("");
              setSelMode(true);
            }}>{selMode ? "退出批量" : "批量"}</Btn>
          <Btn variant="outline" disabled={busy || selMode} icon={<IconUpload size="sm" />} onClick={async () => {
              const r = await invoke<string[]>("seafile_pick_upload", {
                token: getSeafileToken(), repoId: repo.id, parentDir: path,
              }).catch((e) => { showToast(`上传失败：${String(e).slice(0, 80)}`); return null; });
              if (r && r.length) {
                showToast(r.length > 1 ? `已上传 ${r.length} 个文件` : (r[0] ?? "已上传"));
                refreshRepos().catch(() => undefined);
                refreshDir(repo.id, path).catch(() => undefined); // 立刻刷当前目录（缓存失效）
              }
            }}>{i18n("auto.pages.CloudPage.16")}</Btn>
        </Inline>

        {!selMode && (
          <Inline gap={2} wrap>
            <div style={{ flex: "1 1 auto", minWidth: 0, maxWidth: "min(520px, 100%)" }}>
              <Input
                type="search"
                size="md"
                icon={searching ? <Spinner size="sm" /> : <IconSearch size="sm" />}
                placeholder={`在「${repo.name}」内搜文件名（回车搜索）`}
                aria-label={`在「${repo.name}」内搜文件名`}
                value={searchText}
                disabled={searching}
                onChange={setSearchText}
                onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
              />
            </div>
            {!searching && (searchHits || searchMeta) && (
              <Btn variant="outline" onClick={() => { searchSeqRef.current++; setSearchHits(null); setSearchMeta(null); setSearchText(""); }}>{i18n("auto.pages.CloudPage.17")}</Btn>
            )}
            {searching && <Tag tone="brand">{i18n("auto.pages.CloudPage.18")}</Tag>}
          </Inline>
        )}

        {dir.loading && <Text as="p" tone="faint">{i18n("auto.pages.CloudPage.19")}</Text>}
        {dir.error && <Text as="p" slot="micro" tone="error">{dir.error}</Text>}

        {selMode ? (
          <Card flush role="listbox" aria-label={i18n("auto.pages.CloudPage.20")}>
            <List divided>
              {entries.map((e) => {
                const toggle = (): void => setSelSet((s) => { const n = new Set(s); if (n.has(e.name)) n.delete(e.name); else n.add(e.name); return n; });
                return (
                  <Row
                    key={e.name}
                    flush
                    selected={selSet.has(e.name)}
                    role="button"
                    onClick={toggle}
                    onKeyDown={(ev) => { if (ev.key === "Enter") toggle(); }}
                    leading={<Checkbox checked={selSet.has(e.name)} onChange={() => undefined} />}
                    title={e.name}
                    trailing={<>{e.kind === "file" ? fmtSize(e.size) : "文件夹"}{e.mtime ? ` · ${fmtMtime(e.mtime)}` : ""}</>}
                  />
                );
              })}
            </List>
            {entries.length === 0 && !dir.loading && <EmptyState title={i18n("auto.pages.CloudPage.21")} />}
            <div style={{ position: "sticky", bottom: 0 }}>
              <Surface radius="none">
                <Inline gap={2} wrap>
                  <Btn variant="outline" onClick={() => setSelSet(allSelected ? new Set() : new Set(entries.map((x) => x.name)))}>{allSelected ? "取消全选" : "全选"}</Btn>
                  <Text slot="label" tone="faint">{i18n("auto.pages.CloudPage.22")}{selSet.size} {i18n("auto.pages.CloudPage.23")}</Text>
                  <Spacer />
                  <Btn variant="outline" disabled={!selSet.size || batchBusy} onClick={() => void batchDownload()}>{batchBusy ? "处理中…" : `下载（${selSet.size}）`}</Btn>
                  <Btn variant="outline" disabled={!selSet.size || batchBusy} onClick={() => void batchDelete()}>{i18n("auto.pages.CloudPage.24")}{selSet.size}）</Btn>
                </Inline>
              </Surface>
            </div>
          </Card>
        ) : searching ? (
          <Card flush>
            <LoadingBlock rows={4} />
          </Card>
        ) : searchHits !== null ? (
          <Stack gap={2}>
            {searchMeta && (
              <Inline vAlign="baseline" gap={2} wrap>
                <Text slot="subtitle">“{searchMeta.q}”</Text>
                <Text slot="micro" tone="faint">{searchHits.length} {i18n("auto.pages.CloudPage.25")}{(searchMeta.ms / 1000).toFixed(1)}s</Text>
              </Inline>
            )}
            {searchHits.length === 0 && searchMeta ? (
              <EmptyState title={`没有匹配「${searchMeta.q}」的文件`} />
            ) : (
              <Card flush>
                <List divided>
                  {searchHits.map((f, i) => (
                    <Row
                      key={i}
                      flush
                      leading={kindIcon(f.kind)}
                      title={f.name}
                      trailing={<>{fmtSize(f.size)}{f.mtime ? ` · ${fmtMtime(f.mtime)}` : ""}</>}
                    />
                  ))}
                </List>
              </Card>
            )}
          </Stack>
        ) : (
          <Card flush role="listbox" aria-label={i18n("auto.pages.CloudPage.26")}>
            <List divided>
              {entries.map((e) => (
                <Row
                  key={e.name}
                  flush
                  role="button"
                  data-vault-catch={vaultCatchCloudFile({ name: e.name, kind: e.kind, repoId: repo.id, repoName: repo.name, path: `${path === "/" ? "" : path}/${e.name}`, size: e.size })}
                  onClick={() => {
                    if (e.kind === "dir") setPath(`${path === "/" ? "" : path}/${e.name}`);
                    else previewCloudFile(repo.id, `${path === "/" ? "" : path}/${e.name}`, e.name);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key !== "Enter") return;
                    if (e.kind === "dir") setPath(`${path === "/" ? "" : path}/${e.name}`);
                    else previewCloudFile(repo.id, `${path === "/" ? "" : path}/${e.name}`, e.name);
                  }}
                  leading={kindIcon(e.kind)}
                  title={e.name}
                  trailing={
                    <>
                      {e.kind === "file" ? fmtSize(e.size) : ""}{e.mtime ? ` · ${fmtMtime(e.mtime)}` : ""}
                      <Btn size="sm" variant="outline" titleAttr={i18n("auto.pages.CloudPage.27")} onClick={(ev) => { ev.stopPropagation(); setMoving(e); }}>{i18n("auto.pages.CloudPage.28")}</Btn>
                      <Btn size="sm" variant="outline" titleAttr={e.kind === "dir" ? "删除文件夹（含全部内容）" : "删除文件"} onClick={(ev) => {
                          ev.stopPropagation();
                          void deleteEntry(repo, `${path === "/" ? "" : path}/${e.name}`, e).then((ok) => {
                            if (!ok) return;
                            refreshDir(repo.id, path).catch(() => undefined);
                            refreshRepos().catch(() => undefined);
                          }).catch((err) => showToast(`删除失败：${String(err).slice(0, 80)}`));
                        }}>{i18n("auto.pages.CloudPage.29")}</Btn>
                      {e.kind === "file" && (
                        <>
                          <Btn size="sm" variant="outline" titleAttr={i18n("auto.pages.CloudPage.30")} onClick={(ev) => { ev.stopPropagation(); seafileDownload(repo.id, `${path === "/" ? "" : path}/${e.name}`).catch((err) => showToast(String(err).slice(0, 90))); }}>{i18n("auto.pages.CloudPage.31")}</Btn>
                          <Btn size="sm" variant="outline" titleAttr={i18n("auto.pages.CloudPage.32")} disabled={sharing === e.name} onClick={(ev) => {
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
                            }}>{sharing === e.name ? "…" : "分享"}</Btn>
                        </>
                      )}
                    </>
                  }
                />
              ))}
            </List>
            {entries.length === 0 && !dir.loading && <EmptyState title={i18n("auto.pages.CloudPage.21")} />}
          </Card>
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
      </Stack>
    );
  }

  /* ── 资料库网格 ── */
  return (
    <Stack gap={3}>
      <Inline gap={2} wrap>
        <Text slot="title" as="h2">{i18n("auto.pages.CloudPage.8")}</Text>
        {account ? (
          <Text slot="micro" tone="faint">
            {account.name || account.email} · {fmtSize(account.usage)} / {fmtSize(account.total)}
          </Text>
        ) : busy ? (
          <Text slot="micro" tone="faint">{i18n("auto.pages.CloudPage.33")}</Text>
        ) : null}
        <Spacer />
        <Inline gap={2}>
          <Btn variant="outline" disabled={busy} icon={<IconFolderPlus size="sm" />} titleAttr={i18n("auto.pages.CloudPage.34")} onClick={async () => {
              const name = await promptText("新建资料库", { placeholder: i18n("auto.pages.CloudPage.p5") });
              if (!name) return;
              try {
                await invoke("seafile_create_repo", { token: getSeafileToken(), name });
                showToast(`已创建资料库「${name}」`);
                refreshRepos().catch(() => undefined);
              } catch (e) {
                showToast(`创建失败：${String(e).slice(0, 80)}`);
              }
            }}>{i18n("auto.pages.CloudPage.34")}</Btn>
          <Btn variant="outline" disabled={busy} icon={<IconRefresh size="sm" />} onClick={() => { refreshSeafileAccount().catch(() => undefined); refreshRepos().catch(() => undefined); }}>{i18n("auto.pages.CloudPage.35")}</Btn>
          <Text as="span" slot="micro" tone="faint">{i18n("auto.pages.CloudPage.36")}</Text>
        </Inline>
      </Inline>
      {account && (
        <Progress value={account.usage / Math.max(account.total, 1)} size="sm" />
      )}
      {lastError && <Text as="p" slot="micro" tone="error">{lastError}</Text>}
      {busy && <Text as="p" tone="faint">{i18n("auto.pages.CloudPage.37")}</Text>}
      {repos.length === 0 && !busy ? (
        <EmptyState title={i18n("auto.pages.CloudPage.38")} />
      ) : (
        <Grid min="md">
          {repos.map((r) => (
            <Card
              key={r.id}
              flush
              interactive
              role="button"
              tabIndex={0}
              data-vault-catch={vaultCatchCloudFile({ name: r.name, kind: "dir", repoId: r.id, repoName: r.name, path: "/", size: r.size })}
              onClick={() => { setRepo(r); setPath("/"); setSearchHits(null); exitSel(); }}
              onKeyDown={(ev) => { if (ev.key === "Enter") { setRepo(r); setPath("/"); } }}
            >
              <Row
                flush
                leading={<IconFolder size="lg" className="og-text--t-brand" title={i18n("auto.pages.CloudPage.39")} />}
                title={r.name}
                sub={`${fmtSize(r.size)}${r.mtime ? ` · ${fmtMtime(r.mtime)}` : ""}`}
              />
            </Card>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
