/**
 * 清华 GitLab 页（git.tsinghua.edu.cn，REST API v4 直连）。
 *
 * 认证：复用统一认证会话——首次请求会被漫游到 id 完成换票，用户无需单独配置。
 * 布局：项目列表（我参与的 / 星标 / 搜索）→ 项目内四个页签——
 * 代码（分支 + 目录树 + 文件内容 + 根目录 README 渲染）、Issue、合并请求、流水线
 * （流水线展开作业，作业可看日志）。Issue 与合并请求支持评论与关闭/重开。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApp } from "../state/context.js";
import { PageHead } from "../components/Layout.js";
import { CollectStar } from "../components/Collect.js";
import { enc, noteAtomCache } from "../state/atoms.js";
import { IconChevron, IconDownload, IconExternal, IconPen, IconRefresh, IconSearch } from "../components/Icons.js";
import { confirmDanger, confirmOk } from "../lib/confirm.js";
import { openFormModal } from "../lib/formModal.js";
import { openExternal } from "./info/openExternal.js";
import { showToast } from "../state/toast.js";
import {
  awardsKey, discussionsKey, gitlabAddAward, gitlabAddNote, gitlabAssign, gitlabAwards, gitlabBranches,
  gitlabCreateIssue, gitlabCreateMergeRequest, gitlabCurrentUser, gitlabDeleteNote, gitlabDownloadArchive,
  gitlabDiscussions, gitlabFile, gitlabIssue, gitlabIssuesPage, gitlabJobTrace, gitlabMerge, gitlabMergeRequest,
  gitlabMergeRequestChanges, gitlabMergeRequestsPage, gitlabPages, gitlabPipelineJobs, gitlabPipelinesPage,
  gitlabProject, gitlabProjectsPage, gitlabRemoveAward, gitlabReply, gitlabRequestCounts, gitlabResolveDiscussion,
  gitlabSearchPage, gitlabSetState, gitlabStarredPage, gitlabTreePage, gitlabUpdateDiscussionNote, gitlabResetAuth,
  isMergeRequest, useGitlabQuery,
  type GitlabIssueState, type GitlabList,
} from "../state/gitlab.js";
import type {
  GitAward, GitBranch, GitDiscussion, GitFile, GitIssue, GitJob, GitMergeRequest, GitMergeRequestChanges,
  GitNote, GitPipeline, GitPipelineStatus, GitProjectDetail, GitUser,
} from "@onethu/info-lib";

const PROJECT_URL = "https://git.tsinghua.edu.cn";

/** 可回应（reaction）的表情名：GitLab 的 award emoji 用冒号里的名字。
 *  表格只决定「选择器里显示什么」——按名字贴任意 GitLab 认识的 emoji 都行（见下面的输入框）。 */
const REACTION_NAMES: Array<[string, string]> = [
  ["thumbsup", "👍"], ["thumbsdown", "👎"], ["laugh", "😄"], ["hooray", "🎉"], ["confused", "😕"],
  ["heart", "❤️"], ["eyes", "👀"], ["rocket", "🚀"], ["tada", "🎊"], ["smile", "😊"],
  ["grinning", "😀"], ["joy", "😂"], ["sweat_smile", "😅"], ["wink", "😉"], ["blush", "😊"],
  ["thinking", "🤔"], ["neutral_face", "😐"], ["sunglasses", "😎"], ["sleeping", "😴"], ["cry", "😢"],
  ["sob", "😭"], ["scream", "😱"], ["pray", "🙏"], ["clap", "👏"], ["muscle", "💪"],
  ["ok_hand", "👌"], ["wave", "👋"], ["raised_hands", "🙌"], ["punch", "👊"], ["v", "✌️"],
  ["point_up", "☝️"], ["pray_tone1", "🙏"], ["fire", "🔥"], ["sparkles", "✨"], ["star", "⭐"],
  ["star2", "🌟"], ["zap", "⚡"], ["boom", "💥"], ["100", "💯"], ["white_check_mark", "✅"],
  ["heavy_check_mark", "✔️"], ["x", "❌"], ["warning", "⚠️"], ["question", "❓"], ["exclamation", "❗"],
  ["bulb", "💡"], ["pushpin", "📌"], ["paperclip", "📎"], ["memo", "📝"], ["pencil2", "✏️"],
  ["mag", "🔍"], ["lock", "🔒"], ["unlock", "🔓"], ["bell", "🔔"], ["clock1", "🕐"],
  ["hourglass", "⏳"], ["speech_balloon", "💬"], ["email", "📧"], ["inbox_tray", "📥"], ["outbox_tray", "📤"],
  ["clipboard", "📋"], ["bookmark", "🔖"], ["label", "🏷️"], ["link", "🔗"], ["wrench", "🔧"],
  ["hammer", "🔨"], ["construction", "🚧"], ["package", "📦"], ["truck", "🚚"], ["recycle", "♻️"],
  ["chart_with_upwards_trend", "📈"], ["bar_chart", "📊"], ["trophy", "🏆"], ["medal_sports", "🏅"], ["1st_place_medal", "🥇"],
  ["dart", "🎯"], ["game_die", "🎲"], ["video_game", "🎮"], ["camera", "📷"], ["movie_camera", "🎥"],
  ["headphones", "🎧"], ["musical_note", "🎵"], ["microphone", "🎤"], ["art", "🎨"], ["computer", "💻"],
  ["keyboard", "⌨️"], ["iphone", "📱"], ["floppy_disk", "💾"], ["tv", "📺"], ["satellite", "📡"],
  ["telescope", "🔭"], ["microscope", "🔬"], ["test_tube", "🧪"], ["dna", "🧬"], ["abacus", "🧮"],
  ["calculator", "🧮"], ["scissors", "✂️"], ["straight_ruler", "📏"], ["triangular_ruler", "📐"], ["pencil", "📝"],
  ["coffee", "☕"], ["beer", "🍺"], ["beers", "🍻"], ["pizza", "🍕"], ["hamburger", "🍔"],
  ["cake", "🍰"], ["birthday", "🎂"], ["gift", "🎁"], ["balloon", "🎈"], ["confetti_ball", "🎊"],
  ["runner", "🏃"], ["bicyclist", "🚴"], ["swimmer", "🏊"], ["soccer", "⚽"], ["basketball", "🏀"],
  ["sunny", "☀️"], ["cloud", "☁️"], ["umbrella", "☔"], ["snowflake", "❄️"], ["earth_asia", "🌏"],
  ["checkered_flag", "🏁"], ["triangular_flag_on_post", "🚩"], ["mega", "📣"], ["loudspeaker", "📢"], ["robot", "🤖"],
  ["alien", "👽"], ["ghost", "👻"], ["skull", "💀"], ["poop", "💩"], ["cat", "🐱"],
  ["dog", "🐶"], ["penguin", "🐧"], ["turtle", "🐢"], ["seedling", "🌱"], ["four_leaf_clover", "🍀"],
];

const REACTION_EMOJI: {[key: string]: string} = Object.fromEntries(REACTION_NAMES);

/** 流水线与作业状态 → 文案与色标 */
const PIPELINE_STATUS: {[key in GitPipelineStatus]: {label: string; tone: string}} = {
  created: { label: "已创建", tone: "dim" },
  waiting_for_resource: { label: "等待资源", tone: "dim" },
  preparing: { label: "准备中", tone: "run" },
  pending: { label: "排队中", tone: "run" },
  running: { label: "运行中", tone: "run" },
  success: { label: "通过", tone: "ok" },
  failed: { label: "失败", tone: "bad" },
  canceled: { label: "已取消", tone: "dim" },
  canceling: { label: "取消中", tone: "dim" },
  skipped: { label: "已跳过", tone: "dim" },
  manual: { label: "手动", tone: "warn" },
  scheduled: { label: "已排期", tone: "dim" },
};

function statusOf(status: string): { label: string; tone: string } {
  return PIPELINE_STATUS[status as GitPipelineStatus] ?? { label: status, tone: "dim" };
}

/** GitLab 时间戳 → 本地可读（今天显示时分，今年显示月日） */
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const same = d.getFullYear() === now.getFullYear();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (same && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return hm;
  if (same) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function fmtDuration(sec: number | null): string {
  if (sec === null || sec === undefined || sec <= 0) return "";
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
  return `${Math.floor(sec / 3600)} 时 ${Math.floor((sec % 3600) / 60)} 分`;
}

/** 文本文件才在应用内预览：二进制给「浏览器打开」出口 */
const TEXT_EXT = /\.(md|markdown|txt|json|ya?ml|toml|ini|cfg|conf|csv|tsv|py|js|jsx|ts|tsx|vue|svelte|java|kt|kts|c|h|cpp|hpp|cc|cs|go|rs|rb|php|sh|bash|zsh|ps1|sql|html?|css|scss|less|xml|tex|bib|m|r|jl|lua|pl|swift|dart|gradle|dockerfile|gitignore|gitattributes|properties|env|lock|patch|diff)$/i;

function isBinaryPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (/^(makefile|dockerfile|license|readme|changelog|authors|notice)$/i.test(name)) return false;
  return !TEXT_EXT.test(name) && !TEXT_EXT.test(`.${name.split(".").pop() ?? ""}`);
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** 根目录 README（GitLab 首页渲染的那份）：任意 readme 前缀的文件 */
function readmeEntry(entries: GitFile[]): GitFile | null {
  return entries.find((e) => e.type === "blob" && /^readme(\.|$)/i.test(e.name)) ?? null;
}

/* ══════════ 项目列表 ══════════ */

type ListMode = "member" | "starred";

function ProjectList({ onOpen }: { onOpen: (id: number) => void }): ReactNode {
  const [mode, setMode] = useState<ListMode>("member");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState(1);
  const key = query ? `projects:search:${query}:${pages}` : `projects:${mode}:${pages}`;
  const q = useGitlabQuery(key, () =>
    query
      ? gitlabPages((page) => gitlabSearchPage(query, page), pages)
      : mode === "member"
        ? gitlabPages(gitlabProjectsPage, pages)
        : gitlabPages(gitlabStarredPage, pages),
  );
  const list = q.data;

  // 见过的项目进本机原子缓存：收藏夹与 OH 的「一句话直达」才能离线搜到（不发请求）
  useEffect(() => {
    const items = q.data?.items;
    if (!items?.length) return;
    noteAtomCache({ gitlabProjects: items.map((p) => ({ id: p.id, name: p.name_with_namespace })) });
  }, [q.data]);

  return (
    <>
      <PageHead
        title="清华 GitLab"
        meta={<>git.tsinghua.edu.cn · 代码托管与协作</>}
        actions={
          <button className="btn btn-ghost" onClick={() => q.reload()} disabled={q.loading}>
            <IconRefresh /> {q.loading ? "读取中…" : "刷新"}
          </button>
        }
      />
      <div className="gitlab-toolbar">
        <div className="segmented">
          <button
            className={"seg" + (mode === "member" && !query ? " is-active" : "")}
            onClick={() => { setMode("member"); setQuery(""); setText(""); setPages(1); }}
          >
            我参与的
          </button>
          <button
            className={"seg" + (mode === "starred" && !query ? " is-active" : "")}
            onClick={() => { setMode("starred"); setQuery(""); setText(""); setPages(1); }}
          >
            星标
          </button>
        </div>
        <div className="gitlab-search">
          <IconSearch width={14} height={14} />
          <input
            className="input"
            placeholder="搜索项目（回车）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              setQuery(text.trim());
              setPages(1);
            }}
          />
          {query ? (
            <button className="btn mini" onClick={() => { setQuery(""); setText(""); setPages(1); }}>退出搜索</button>
          ) : null}
        </div>
      </div>
      {q.loading ? <p className="dim gitlab-hint">读取项目…</p> : null}
      {q.error ? <p className="gitlab-error">{q.error}</p> : null}
      {q.error ? (
        <button
          className="btn gitlab-retry"
          onClick={() => {
            void gitlabResetAuth()
              .then(() => {
                q.reload();
                showToast("已重置统一认证会话，正在重试");
              })
              .catch((e) => showToast(String(e).slice(0, 120)));
          }}
        >
          重置统一认证并重试
        </button>
      ) : null}
      <div className="gitlab-cards">
        {(list?.items ?? []).map((p) => (
          <div key={p.id} className="gitlab-card" role="button" tabIndex={0}
            onClick={() => onOpen(p.id)}
            onKeyDown={(e) => { if (e.key === "Enter") onOpen(p.id); }}
          >
            <div className="gitlab-card-main">
              <b>{p.name_with_namespace}</b>
              {p.description ? <span className="dim gitlab-desc">{p.description}</span> : null}
              <span className="dim gitlab-meta">最近活动 {fmtTime(p.last_activity_at)}{p.default_branch ? ` · 默认分支 ${p.default_branch}` : ""}</span>
            </div>
            <CollectStar
              atom={{ kind: "gitlab-proj", key: enc(p.id, p.name_with_namespace) }}
              title={p.name_with_namespace}
            />
          </div>
        ))}
        {!q.loading && !q.error && (list?.items.length ?? 0) === 0 ? (
          <p className="dim gitlab-hint">
            {query ? `没有匹配「${query}」的项目` : mode === "starred" ? "还没有星标项目" : "没有参与的项目"}
          </p>
        ) : null}
      </div>
      {list?.hasMore ? (
        <button className="btn gitlab-more" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>
          加载更多
        </button>
      ) : null}
    </>
  );
}

/* ══════════ 代码页签 ══════════ */

/** Markdown 正文（README / 描述 / 评论）。链接一律交给系统浏览器：
 *  直接在 WebView 里导航会把整个应用带走，且相对链接按项目地址解析才成立。 */
function MarkdownBody({ text, baseUrl }: { text: string; baseUrl?: string }): ReactNode {
  return (
    <div className="gitlab-md">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const raw = typeof href === "string" ? href : "";
            const target = (() => {
              if (!raw || raw.startsWith("#")) return "";
              try {
                return new URL(raw, baseUrl ?? PROJECT_URL).toString();
              } catch {
                return "";
              }
            })();
            if (!target) return <span>{children}</span>;
            return (
              <a
                href={target}
                onClick={(e) => {
                  e.preventDefault();
                  openExternal(target).catch(() => undefined);
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

function FileView({ projectId, file, refName, baseUrl, onBack }: {
  projectId: number;
  file: GitFile;
  refName: string;
  baseUrl: string;
  onBack: () => void;
}): ReactNode {
  const binary = isBinaryPath(file.path);
  const q = useGitlabQuery(binary ? null : `blob:${file.id}`, () => gitlabFile(projectId, file.id));
  const webUrl = `${baseUrl}/-/blob/${encodeURIComponent(refName)}/${file.path.split("/").map(encodeURIComponent).join("/")}`;
  return (
    <div className="gitlab-file">
      <div className="gitlab-file-head">
        <button className="btn btn-ghost" onClick={onBack}>
          <IconChevron style={{ transform: "rotate(180deg)" }} /> 返回目录
        </button>
        <span className="gitlab-file-path">{file.path}</span>
        <button className="btn" onClick={() => openExternal(webUrl)}>
          <IconExternal /> 浏览器打开
        </button>
      </div>
      {binary ? (
        <p className="dim gitlab-hint">二进制文件不在应用内预览，请用浏览器打开。</p>
      ) : q.loading ? (
        <p className="dim gitlab-hint">读取文件…</p>
      ) : q.error ? (
        <p className="gitlab-error">{q.error}</p>
      ) : isMarkdownPath(file.path) ? (
        <MarkdownBody text={q.data ?? ""} baseUrl={baseUrl} />
      ) : (
        <pre className="gitlab-pre">{q.data ?? ""}</pre>
      )}
    </div>
  );
}

function CodeTab({ projectId, defaultBranch, webUrl }: {
  projectId: number;
  defaultBranch: string;
  webUrl: string;
}): ReactNode {
  const [ref, setRef] = useState(defaultBranch);
  const [path, setPath] = useState("");
  const [openFile, setOpenFile] = useState<GitFile | null>(null);
  const [pages, setPages] = useState(1);
  const branches = useGitlabQuery(`branches:${projectId}`, () => gitlabBranches(projectId));
  const tree = useGitlabQuery(`tree:${projectId}:${ref}:${path}:${pages}`, () =>
    gitlabPages((page) => gitlabTreePage(projectId, path, ref, page), pages));
  const entries = tree.data?.items ?? [];
  const readme = path === "" ? readmeEntry(entries) : null;
  const readmeQuery = useGitlabQuery(readme ? `blob:${readme.id}` : null, () =>
    readme ? gitlabFile(projectId, readme.id) : Promise.resolve(""));

  useEffect(() => {
    setOpenFile(null);
    setPath("");
    setPages(1);
  }, [ref]);

  if (openFile) {
    return <FileView projectId={projectId} file={openFile} refName={ref} baseUrl={webUrl} onBack={() => setOpenFile(null)} />;
  }

  const crumbs = path === "" ? [] : path.split("/");
  return (
    <div className="gitlab-code">
      <div className="gitlab-code-bar">
        <select className="input gitlab-ref" value={ref} onChange={(e) => setRef(e.target.value)}>
          {(branches.data ?? []).map((b) => (
            <option key={b.name} value={b.name}>{b.name}{b.default ? "（默认）" : ""}</option>
          ))}
          {(branches.data ?? []).some((b) => b.name === ref) ? null : <option value={ref}>{ref}</option>}
        </select>
        <div className="gitlab-crumb">
          <b onClick={() => { setPath(""); setPages(1); }}>{ref || "根目录"}</b>
          {crumbs.map((c, i) => (
            <span key={c + i} className="gitlab-crumb-item" onClick={() => { setPath(crumbs.slice(0, i + 1).join("/")); setPages(1); }}>
              <IconChevron style={{ width: 12, height: 12 }} />
              {c}
            </span>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => tree.reload()} disabled={tree.loading}>
          <IconRefresh /> 刷新
        </button>
      </div>
      {branches.error ? <p className="gitlab-error">{branches.error}</p> : null}
      {tree.error ? <p className="gitlab-error">{tree.error}</p> : null}
      {tree.loading ? <p className="dim gitlab-hint">读取目录…</p> : null}
      <div className="cloud-list" role="listbox" aria-label="仓库文件">
        {!tree.loading && entries.length === 0 && !tree.error ? <p className="dim gitlab-hint">空目录</p> : null}
        {entries.map((e) => (
          <div key={e.id} className="cloud-row" role="button" tabIndex={0}
            onClick={() => {
              if (e.type === "tree") { setPath(e.path); setPages(1); }
              else setOpenFile(e);
            }}
            onKeyDown={(ev) => {
              if (ev.key !== "Enter") return;
              if (e.type === "tree") { setPath(e.path); setPages(1); }
              else setOpenFile(e);
            }}
          >
            <span className={`cloud-kind ${e.type === "tree" ? "dir" : "file"}`} />
            <span className="cloud-name">{e.name}</span>
            <span className="cloud-meta">{e.type === "tree" ? "目录" : ""}</span>
          </div>
        ))}
      </div>
      {tree.data?.hasMore ? (
        <button className="btn gitlab-more" onClick={() => setPages((n) => n + 1)} disabled={tree.loading}>加载更多</button>
      ) : null}
      {readme ? (
        <div className="gitlab-readme">
          <div className="gitlab-readme-head">
            <span>{readme.name}</span>
            <button className="btn mini" onClick={() => openExternal(`${webUrl}/-/blob/${encodeURIComponent(ref)}/${readme.path}`)}>浏览器打开</button>
          </div>
          {readmeQuery.loading ? <p className="dim gitlab-hint">读取 README…</p> : null}
          {readmeQuery.error ? <p className="gitlab-error">{readmeQuery.error}</p> : null}
          {readmeQuery.data ? <MarkdownBody text={readmeQuery.data} baseUrl={webUrl} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ══════════ Issue / 合并请求：列表与详情 ══════════ */

type RequestKind = "issue" | "mr";

/** 状态筛选：带条数（总数取自服务端的 x-total，不是当前这页的条数） */
function StateChips({ value, onChange, counts }: {
  value: GitlabIssueState;
  onChange: (v: GitlabIssueState) => void;
  counts?: { opened: number; closed: number; all: number };
}): ReactNode {
  const options: Array<[GitlabIssueState, string]> = [["opened", "进行中"], ["closed", "已关闭"], ["all", "全部"]];
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={"seg" + (value === v ? " is-active" : "")} onClick={() => onChange(v)}>
          {label}
          {counts ? <span className="seg-count">{counts[v]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** 作者头像（没有头像地址时退回首字母方块） */
function Avatar({ user, size = 20 }: { user?: GitUser | null; size?: number }): ReactNode {
  const [failed, setFailed] = useState(false);
  const name = user?.name ?? "";
  if (!user?.avatar_url || failed) {
    return (
      <span className="gitlab-avatar gitlab-avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.5 }}>
        {[...name][0]?.toUpperCase() ?? "?"}
      </span>
    );
  }
  return (
    <img
      className="gitlab-avatar"
      style={{ width: size, height: size }}
      src={user.avatar_url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** 表情回应（reaction）：已有回应按组显示，点一下切换自己的那枚 */
function ReactionBar({ kind, projectId, iid, noteId, me }: {
  kind: RequestKind;
  projectId: number;
  iid: number;
  /** 挂在评论上时给评论 id，挂在议题 / 合并请求本体上时不传 */
  noteId?: number;
  me: string;
}): ReactNode {
  const awards = useGitlabQuery<GitAward[]>(awardsKey(kind, projectId, iid, noteId), () =>
    gitlabAwards(kind, projectId, iid, noteId));
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState("");
  const [typed, setTyped] = useState("");
  /** 本会话本地确认过的增删：服务端那份列表要等重取才更新，靠这两份补上即时反馈。
   *  同一枚回应会同时出现在两份里，所以按 award id 去重（否则计数会翻倍）。 */
  const [added, setAdded] = useState<GitAward[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const list = (() => {
    const seen = new Set<number>();
    const out: GitAward[] = [];
    for (const a of [...(awards.data ?? []), ...added]) {
      if (seen.has(a.id) || removed.includes(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
    return out;
  })();

  const counts = new Map<string, { n: number; mine: number | null }>();
  for (const a of list) {
    const cur = counts.get(a.name) ?? { n: 0, mine: null };
    cur.n += 1;
    if (me && a.user?.username === me) cur.mine = a.id;
    counts.set(a.name, cur);
  }

  /** 选择器挂在 body 上（线程容器有 overflow: hidden，就地弹会被裁成半截） */
  const openPicker = (): void => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 300;
      const height = 268;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const above = rect.top - height - 6;
      setPos({ left, top: above >= 8 ? above : Math.min(rect.bottom + 6, window.innerHeight - height - 8) });
    }
    setPicking((p) => !p);
  };

  // 点外面 / Esc 收起；滚动或改窗口大小也收起（避免浮层与按钮错位）
  useEffect(() => {
    if (!picking) return;
    const onDown = (ev: MouseEvent): void => {
      const t = ev.target as Node;
      if (wrapRef.current?.contains(t) || popupRef.current?.contains(t)) return;
      setPicking(false);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setPicking(false);
    };
    const onMove = (): void => setPicking(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [picking]);

  const toggle = async (name: string, mine: number | null): Promise<void> => {
    if (busy || !name) return;
    setBusy(true);
    try {
      if (mine !== null) {
        await gitlabRemoveAward(kind, projectId, iid, mine, noteId);
        setAdded((prev) => prev.filter((a) => a.id !== mine));
        setRemoved((prev) => [...prev, mine]);
      } else {
        const award = await gitlabAddAward(kind, projectId, iid, name, noteId);
        setAdded((prev) => [...prev.filter((a) => a.id !== award.id), award]);
        setRemoved((prev) => prev.filter((id) => id !== award.id));
      }
      awards.reload();
    } catch (e) {
      // 已经没了 / 已经贴过：不当错误，静默重取一次即可
      const msg = String(e instanceof Error ? e.message : e);
      if (/404|409/.test(msg)) awards.reload();
      else showToast(msg.slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const shown = filter.trim()
    ? REACTION_NAMES.filter(([name]) => name.includes(filter.trim().toLowerCase()))
    : REACTION_NAMES;

  return (
    <div className="gitlab-reactions">
      {[...counts.entries()].map(([name, c]) => (
        <button
          key={name}
          type="button"
          className={"gitlab-reaction" + (c.mine !== null ? " is-mine" : "")}
          disabled={busy}
          title={`:${name}: ${c.mine !== null ? "（点击取消我的回应）" : "（点击回应）"}`}
          onClick={() => void toggle(name, c.mine)}
        >
          <span>{REACTION_EMOJI[name] ?? "🔖"}</span>
          {REACTION_EMOJI[name] ? null : <em className="gitlab-reaction-name">{name}</em>}
          <b>{c.n}</b>
        </button>
      ))}
      <div className="gitlab-emoji" ref={wrapRef}>
        <button
          type="button"
          className="gitlab-reaction"
          aria-expanded={picking}
          disabled={busy}
          title="添加回应"
          onClick={openPicker}
        >
          ＋
        </button>
      </div>
      {picking && pos
        ? createPortal(
            <div
              className="gitlab-emoji-popup"
              ref={popupRef}
              role="dialog"
              aria-label="选择回应"
              style={{ left: pos.left, top: pos.top }}
            >
              <input
                className="input"
                autoFocus
                placeholder="按名字筛选，或直接输入 GitLab 表情名"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") typeInName();
                }}
              />
              <div className="gitlab-emoji-grid">
                {shown.map(([name, emoji]) => (
                  <button
                    key={name}
                    type="button"
                    className="gitlab-emoji-item"
                    title={`:${name}:`}
                    onClick={() => { setPicking(false); setFilter(""); void toggle(name, counts.get(name)?.mine ?? null); }}
                  >
                    {emoji}
                  </button>
                ))}
                {shown.length === 0 ? <p className="dim gitlab-hint">没有匹配的表情名</p> : null}
              </div>
              <div className="gitlab-emoji-typed">
                <input
                  className="input"
                  placeholder="任意表情名，如 dart"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") typeInName(); }}
                />
                <button className="btn mini" type="button" onClick={() => typeInName()}>按名字贴</button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );

  /** 按名字贴：GitLab 认识的 emoji 都能这么用（表格只是快捷入口） */
  function typeInName(): boolean {
    const name = typed.trim().replace(/^:|:$/g, "");
    if (!name) return false;
    setPicking(false);
    setTyped("");
    setFilter("");
    void toggle(name, counts.get(name)?.mine ?? null);
    return true;
  }
}

/** 变更文件（合并请求的 diff）：按行上色，过大的差异只给提示 */
function ChangesView({ projectId, iid }: { projectId: number; iid: number }): ReactNode {
  const q = useGitlabQuery<GitMergeRequestChanges>(`mr-changes:${projectId}:${iid}`, () =>
    gitlabMergeRequestChanges(projectId, iid));
  if (q.loading) return <p className="dim gitlab-hint">读取变更…</p>;
  if (q.error) return <p className="gitlab-error">{q.error}</p>;
  const changes = q.data?.changes ?? [];
  if (changes.length === 0) return <p className="dim gitlab-hint">没有文件变更</p>;
  return (
    <div className="gitlab-changes">
      <div className="dim gitlab-meta">
        {changes.length} 个文件变更 · 原文见「浏览器打开」
      </div>
      {changes.map((c, i) => (
        <details key={c.new_path + i} className="gitlab-change" open={i === 0}>
          <summary>
            <span className={"gitlab-change-kind" + (c.new_file ? " add" : c.deleted_file ? " del" : "")}>
              {c.new_file ? "新增" : c.deleted_file ? "删除" : c.renamed_file ? "改名" : "修改"}
            </span>
            <code>{c.renamed_file ? `${c.old_path} → ${c.new_path}` : c.new_path}</code>
          </summary>
          {c.too_large ? (
            <p className="dim gitlab-hint">差异过大，不在应用内展开。</p>
          ) : (
            <pre className="gitlab-diff">{c.diff.split("\n").map((line, k) => (
              <span
                key={k}
                className={
                  line.startsWith("+") && !line.startsWith("+++") ? "add"
                    : line.startsWith("-") && !line.startsWith("---") ? "del"
                      : line.startsWith("@@") ? "hunk" : undefined
                }
              >
                {line}
                {"\n"}
              </span>
            ))}</pre>
          )}
        </details>
      ))}
    </div>
  );
}

/** 单条评论的编辑框（回复与编辑共用） */
function NoteEditor({ initial, busy, onSave, onCancel }: {
  initial: string;
  busy: boolean;
  onSave: (body: string) => void;
  onCancel: () => void;
}): ReactNode {
  const [text, setText] = useState(initial);
  return (
    <div className="gitlab-notebox">
      <textarea
        className="input"
        rows={4}
        placeholder="写评论（支持 Markdown）"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div className="gitlab-notebox-actions">
        <button className="btn btn-primary" disabled={busy || text.trim() === ""} onClick={() => onSave(text.trim())}>
          {busy ? "保存中…" : "保存"}
        </button>
        <button className="btn btn-ghost" disabled={busy} onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/** 一条评论（讨论里的 note）：正文 / 编辑 / 删除 / 表情回应 / 指派给作者 */

function NoteBox({ kind, projectId, iid, onDone }: {
  kind: RequestKind;
  projectId: number;
  iid: number;
  onDone: () => void;
}): ReactNode {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await gitlabAddNote(kind, projectId, iid, body);
      setText("");
      onDone();
      showToast("评论已发表");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="gitlab-notebox">
      <textarea
        className="input"
        rows={4}
        placeholder="写评论（支持 Markdown）"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="gitlab-notebox-actions">
        <button className="btn btn-primary" disabled={busy || text.trim() === ""} onClick={() => void submit()}>
          {busy ? "发送中…" : "发表评论"}
        </button>
      </div>
    </div>
  );
}

/** 一条评论（讨论里的 note）：正文 / 编辑 / 删除 / 表情回应 / 指派给作者 */
function NoteRow({ note, kind, projectId, iid, discussionId, me, baseUrl, depth, onChanged }: {
  note: GitNote;
  kind: RequestKind;
  projectId: number;
  iid: number;
  discussionId: string;
  me: string;
  baseUrl?: string;
  depth: number;
  onChanged: () => void;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = Boolean(me) && note.author?.username === me;
  const authorId = note.author?.id;

  const save = async (body: string): Promise<void> => {
    setBusy(true);
    try {
      await gitlabUpdateDiscussionNote(kind, projectId, iid, discussionId, note.id, body);
      setEditing(false);
      onChanged();
      showToast("评论已更新");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDanger("删除这条评论？删除后无法恢复。", {
      title: "即将删除评论，请确认！",
      confirmText: "确认删除",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await gitlabDeleteNote(kind, projectId, iid, discussionId, note.id);
      onChanged();
      showToast("评论已删除");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const assign = async (): Promise<void> => {
    if (!authorId) return;
    const ok = await confirmOk(`把这条${kind === "issue" ? " Issue" : "合并请求"}指派给 ${note.author?.name ?? "该评论作者"}？`);
    if (!ok) return;
    setBusy(true);
    try {
      await gitlabAssign(kind, projectId, iid, [authorId]);
      onChanged();
      showToast(`已指派给 ${note.author?.name ?? "该评论作者"}`);
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={"gitlab-note" + (depth > 0 ? " gitlab-reply" : "")}>
      <div className="gitlab-note-head">
        <Avatar user={note.author} size={22} />
        <b>{note.author?.name ?? "未知作者"}</b>
        <span className="dim">
          {fmtTime(note.created_at)}
          {note.updated_at && note.updated_at !== note.created_at ? "（已编辑）" : ""}
        </span>
        <span className="gitlab-note-actions">
          {!mine && authorId ? (
            <button className="btn mini" disabled={busy} onClick={() => void assign()}>指派给 TA</button>
          ) : null}
          {mine ? (
            <>
              <button className="btn mini" disabled={busy} onClick={() => setEditing((e) => !e)}>
                {editing ? "取消" : "编辑"}
              </button>
              <button className="btn mini" disabled={busy} onClick={() => void remove()}>删除</button>
            </>
          ) : null}
        </span>
      </div>
      {editing ? (
        <NoteEditor initial={note.body} busy={busy} onSave={(body) => void save(body)} onCancel={() => setEditing(false)} />
      ) : (
        <MarkdownBody text={note.body} baseUrl={baseUrl} />
      )}
      <ReactionBar kind={kind} projectId={projectId} iid={iid} noteId={note.id} me={me} />
    </div>
  );
}

/** 一个讨论：首条评论 + 回复 + 回复框 + 解决/重新打开 */
function DiscussionThread({ discussion, kind, projectId, iid, me, baseUrl, onChanged }: {
  discussion: GitDiscussion;
  kind: RequestKind;
  projectId: number;
  iid: number;
  me: string;
  baseUrl?: string;
  onChanged: () => void;
}): ReactNode {
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const notes = discussion.notes.filter((n) => !n.system);
  if (notes.length === 0) return null;
  const head = notes[0]!;
  const replies = notes.slice(1);
  const resolvable = notes.some((n) => n.resolvable);
  const resolved = notes.some((n) => n.resolved);

  const resolve = async (next: boolean): Promise<void> => {
    setBusy(true);
    try {
      await gitlabResolveDiscussion(kind, projectId, iid, discussion.id, next);
      onChanged();
      showToast(next ? "讨论已解决" : "讨论已重新打开");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const reply = async (body: string): Promise<void> => {
    setBusy(true);
    try {
      await gitlabReply(kind, projectId, iid, discussion.id, body);
      setReplying(false);
      onChanged();
      showToast("已回复");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={"gitlab-thread" + (resolved ? " is-resolved" : "")}>
      <NoteRow note={head} kind={kind} projectId={projectId} iid={iid} discussionId={discussion.id} me={me} baseUrl={baseUrl} depth={0} onChanged={onChanged} />
      {replies.map((n) => (
        <NoteRow key={n.id} note={n} kind={kind} projectId={projectId} iid={iid} discussionId={discussion.id} me={me} baseUrl={baseUrl} depth={1} onChanged={onChanged} />
      ))}
      <div className="gitlab-thread-actions">
        <button className="btn mini" disabled={busy} onClick={() => setReplying((r) => !r)}>
          {replying ? "取消回复" : "回复"}
        </button>
        {resolvable ? (
          <button className="btn mini" disabled={busy} onClick={() => void resolve(!resolved)}>
            {resolved ? "重新打开讨论" : "解决讨论"}
          </button>
        ) : null}
        {resolved ? <span className="gitlab-chip ok">已解决</span> : null}
      </div>
      {replying ? (
        <NoteEditor initial="" busy={busy} onSave={(body) => void reply(body)} onCancel={() => setReplying(false)} />
      ) : null}
    </div>
  );
}

function DiscussionList({ kind, projectId, iid, me, baseUrl, onChanged }: {
  kind: RequestKind;
  projectId: number;
  iid: number;
  me: string;
  baseUrl?: string;
  onChanged: () => void;
}): ReactNode {
  const [pages, setPages] = useState(1);
  const q = useGitlabQuery<GitlabList<GitDiscussion>>(discussionsKey(kind, projectId, iid, pages), () =>
    gitlabDiscussions(kind, projectId, iid, pages));
  const threads = (q.data?.items ?? []).filter((d) => d.notes.some((n) => !n.system));

  return (
    <>
      {q.loading ? <p className="dim gitlab-hint">读取讨论…</p> : null}
      {q.error ? <p className="gitlab-error">{q.error}</p> : null}
      {!q.loading && !q.error && threads.length === 0 ? <p className="dim gitlab-hint">还没有评论</p> : null}
      {threads.map((d) => (
        <DiscussionThread
          key={d.id}
          discussion={d}
          kind={kind}
          projectId={projectId}
          iid={iid}
          me={me}
          baseUrl={baseUrl}
          onChanged={onChanged}
        />
      ))}
      {q.data?.hasMore ? (
        <button className="btn gitlab-more" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>
          加载更多讨论
        </button>
      ) : null}
    </>
  );
}

function RequestDetail({ kind, projectId, iid, onBack, onChanged }: {
  kind: RequestKind;
  projectId: number;
  iid: number;
  onBack: () => void;
  onChanged: () => void;
}): ReactNode {
  const detailKey = `${kind}:${projectId}:${iid}`;
  const detail = useGitlabQuery<GitIssue | GitMergeRequest>(detailKey, () =>
    kind === "issue" ? gitlabIssue(projectId, iid) : gitlabMergeRequest(projectId, iid));
  // 项目地址与当前用户：正文里的相对链接要按项目地址解析，评论编辑/删除只给自己的
  const project = useGitlabQuery(`project:${projectId}`, () => gitlabProject(projectId));
  const me = useGitlabQuery<GitUser>(`me`, () => gitlabCurrentUser());
  const baseUrl = project.data?.web_url;
  const item = detail.data;
  const mr = item && isMergeRequest(item) ? item : null;
  const closed = item ? item.state === "closed" || item.state === "merged" : false;
  const [busy, setBusy] = useState(false);

  const refresh = (): void => {
    detail.reload();
    onChanged();
  };

  const toggleState = async (): Promise<void> => {
    if (!item || busy) return;
    const reopen = closed;
    const ok = await confirmOk(reopen
      ? `重新打开${kind === "issue" ? " Issue" : "合并请求"} !${iid}？`
      : `关闭${kind === "issue" ? " Issue" : "合并请求"} !${iid}？`);
    if (!ok) return;
    setBusy(true);
    try {
      await gitlabSetState(kind, projectId, iid, reopen ? "reopen" : "close");
      refresh();
      showToast(reopen ? "已重新打开" : "已关闭");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const merge = async (): Promise<void> => {
    if (!mr || busy) return;
    const ok = await confirmOk(`合入 !${mr.iid}（${mr.source_branch} → ${mr.target_branch}）？合入后源分支保留。`);
    if (!ok) return;
    setBusy(true);
    try {
      await gitlabMerge(projectId, iid);
      refresh();
      showToast("已合入");
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const assignees = (item as { assignees?: GitUser[] } | null)?.assignees ?? [];

  return (
    <div className="gitlab-detail">
      <div className="gitlab-file-head">
        <button className="btn btn-ghost" onClick={onBack}>
          <IconChevron style={{ transform: "rotate(180deg)" }} /> 返回列表
        </button>
        <span className="dim">!{iid}</span>
        <span style={{ flex: 1 }} />
        {mr && mr.state === "opened" && (mr.user?.can_merge ?? true) ? (
          <button className="btn btn-primary" disabled={busy} onClick={() => void merge()}>合入</button>
        ) : null}
        {item && item.state !== "merged" ? (
          <button className="btn" disabled={busy} onClick={() => void toggleState()}>
            {closed ? "重新打开" : "关闭"}
          </button>
        ) : null}
        {item ? (
          <button className="btn" onClick={() => openExternal(item.web_url)}>
            <IconExternal /> 浏览器打开
          </button>
        ) : null}
      </div>
      {detail.loading ? <p className="dim gitlab-hint">读取中…</p> : null}
      {detail.error ? <p className="gitlab-error">{detail.error}</p> : null}
      {item ? (
        <>
          <h2 className="gitlab-detail-title">
            {item.title}
            <span className={`gitlab-chip ${item.state === "opened" ? "ok" : "dim"}`}>
              {item.state === "merged" ? "已合入" : item.state === "opened" ? "进行中" : "已关闭"}
            </span>
            {mr?.draft ? <span className="gitlab-chip dim">草稿</span> : null}
            {mr?.has_conflicts ? <span className="gitlab-chip bad">有冲突</span> : null}
          </h2>
          <div className="dim gitlab-meta gitlab-meta-author">
            <Avatar user={item.author} size={22} />
            {item.author?.name ?? "未知作者"} 创建于 {fmtTime(item.created_at)}
            {mr?.state === "merged" ? ` · 合入于 ${fmtTime(mr.merged_at)}` : ""}
            {item.state === "closed" ? ` · 关闭于 ${fmtTime(item.closed_at)}` : ""}
            {mr ? ` · ${mr.source_branch} → ${mr.target_branch}` : ""}
            {mr?.detailed_merge_status ? ` · ${mr.detailed_merge_status}` : ""}
            {` · 指派：${assignees.length ? assignees.map((a) => a.name).join("、") : "无"}`}
            {item.labels?.length ? ` · 标签 ${item.labels.join("、")}` : ""}
          </div>
          {mr?.head_pipeline ? (
            <div className="dim gitlab-meta">流水线 #{mr.head_pipeline.id} · {statusOf(mr.head_pipeline.status).label}</div>
          ) : null}
          {item.description?.trim() ? <MarkdownBody text={item.description} baseUrl={baseUrl} /> : <p className="dim gitlab-hint">（没有描述）</p>}
          <ReactionBar kind={kind} projectId={projectId} iid={iid} me={me.data?.username ?? ""} />
          {mr ? (
            <>
              <div className="gitlab-section-head">文件变更</div>
              <ChangesView projectId={projectId} iid={iid} />
            </>
          ) : null}
          <div className="gitlab-section-head">评论（{item.user_notes_count ?? 0}）</div>
          <DiscussionList
            kind={kind}
            projectId={projectId}
            iid={iid}
            me={me.data?.username ?? ""}
            baseUrl={baseUrl}
            onChanged={refresh}
          />
          <div className="gitlab-section-head">写评论</div>
          <NoteBox kind={kind} projectId={projectId} iid={iid} onDone={refresh} />
        </>
      ) : null}
    </div>
  );
}

function RequestList({ kind, projectId, initialIid = null }: {
  kind: RequestKind;
  projectId: number;
  /** 原子深链：进入项目后直接打开这条 Issue / 合并请求 */
  initialIid?: number | null;
}): ReactNode {
  const [state, setState] = useState<GitlabIssueState>("opened");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [pages, setPages] = useState(1);
  const [openIid, setOpenIid] = useState<number | null>(initialIid);
  const prefix = kind === "issue" ? "issues" : "mrs";
  const key = `${prefix}:${projectId}:${state}:${query}:${pages}`;
  const q = useGitlabQuery<GitlabList<GitIssue | GitMergeRequest>>(key, () =>
    kind === "issue"
      ? gitlabPages((page) => gitlabIssuesPage(projectId, state, query, page), pages)
      : gitlabPages((page) => gitlabMergeRequestsPage(projectId, state, query, page), pages));
  // 三种状态的条数（服务端总条数；搜索时口径仍是全量，仅供定位规模）
  const counts = useGitlabQuery<{ opened: number; closed: number; all: number }>(
    `counts:${kind}:${projectId}`,
    () => gitlabRequestCounts(kind, projectId),
  );
  const list = q.data;

  // 见过的 Issue / 合并请求进本机原子缓存（同上：只记不拉）
  useEffect(() => {
    const items = q.data?.items;
    if (!items?.length) return;
    noteAtomCache(kind === "issue"
      ? { gitlabIssues: items.map((i) => ({ projectId, iid: i.iid, title: i.title })) }
      : { gitlabMergeRequests: items.map((i) => ({ projectId, iid: i.iid, title: i.title })) });
  }, [q.data, kind, projectId]);

  const createIssue = async (): Promise<void> => {
    const form = await openFormModal("新建 Issue", [
      { key: "title", label: "标题", required: true },
      { key: "description", label: "描述", kind: "textarea", placeholder: "支持 Markdown，可留空" },
    ]);
    if (!form?.title?.trim()) return;
    try {
      const issue = await gitlabCreateIssue(projectId, form.title.trim(), form.description ?? "");
      showToast(`已创建 Issue !${issue.iid}`);
      q.reload();
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    }
  };

  /** 从分支建合并请求：源分支来自仓库分支列表，目标分支缺省为默认分支 */
  const createMr = async (): Promise<void> => {
    let branches: GitBranch[] = [];
    try {
      branches = await gitlabBranches(projectId);
    } catch (e) {
      showToast(`读取分支失败：${String(e instanceof Error ? e.message : e).slice(0, 90)}`);
      return;
    }
    const options = branches.map((b) => ({ value: b.name, label: b.name + (b.default ? "（默认）" : "") }));
    if (options.length < 2) {
      showToast("这个仓库只有一条分支，没有可发起合并的分支对");
      return;
    }
    const target = branches.find((b) => b.default)?.name ?? branches[0]!.name;
    const source = branches.find((b) => b.name !== target)!.name;
    const form = await openFormModal("新建合并请求", [
      { key: "source", label: "源分支", kind: "select", options, default: source, required: true },
      { key: "target", label: "目标分支", kind: "select", options, default: target, required: true },
      { key: "title", label: "标题", required: true, placeholder: "缺省与源分支同名" },
      { key: "description", label: "描述", kind: "textarea", placeholder: "支持 Markdown，可留空" },
    ]);
    if (!form) return;
    const sourceBranch = form.source ?? "";
    const targetBranch = form.target ?? "";
    if (!sourceBranch || !targetBranch) return;
    if (sourceBranch === targetBranch) {
      showToast("源分支与目标分支不能相同");
      return;
    }
    try {
      const mr = await gitlabCreateMergeRequest(
        projectId,
        sourceBranch,
        targetBranch,
        form.title?.trim() || sourceBranch,
        form.description ?? "",
      );
      showToast(`已创建合并请求 !${mr.iid}`);
      q.reload();
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    }
  };

  if (openIid !== null) {
    return (
      <RequestDetail
        kind={kind}
        projectId={projectId}
        iid={openIid}
        onBack={() => setOpenIid(null)}
        onChanged={() => q.reload()}
      />
    );
  }

  return (
    <div className="gitlab-requests">
      <div className="gitlab-toolbar">
        <StateChips value={state} onChange={(v) => { setState(v); setPages(1); }} counts={counts.data ?? undefined} />
        <div className="gitlab-search">
          <IconSearch width={14} height={14} />
          <input
            className="input"
            placeholder={kind === "issue" ? "搜索 Issue（回车）" : "搜索合并请求（回车）"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setQuery(text.trim()); setPages(1); } }}
          />
          {query ? <button className="btn mini" onClick={() => { setQuery(""); setText(""); setPages(1); }}>退出搜索</button> : null}
        </div>
        <button className="btn" onClick={() => void (kind === "issue" ? createIssue() : createMr())}>
          <IconPen /> 新建
        </button>
      </div>
      {q.loading ? <p className="dim gitlab-hint">读取列表…</p> : null}
      {q.error ? <p className="gitlab-error">{q.error}</p> : null}
      <div className="cloud-list" role="listbox" aria-label={kind === "issue" ? "Issue 列表" : "合并请求列表"}>
        {(list?.items ?? []).map((item) => (
          <div key={item.id} className="cloud-row gitlab-req-row" role="button" tabIndex={0}
            onClick={() => setOpenIid(item.iid)}
            onKeyDown={(e) => { if (e.key === "Enter") setOpenIid(item.iid); }}
          >
            <span className={`gitlab-chip ${item.state === "opened" ? "ok" : item.state === "merged" ? "run" : "dim"}`}>
              {item.state === "merged" ? "已合入" : item.state === "opened" ? "进行中" : "已关闭"}
            </span>
            <Avatar user={item.author} />
            <span className="cloud-name">
              {item.title}
              <span className="dim gitlab-req-sub">
                {" "}!{item.iid} · {item.author?.name ?? "未知作者"} · {fmtTime(item.updated_at)}
                {isMergeRequest(item) ? ` · ${item.source_branch} → ${item.target_branch}` : ""}
              </span>
            </span>
            <span className="cloud-meta">{item.user_notes_count ? `${item.user_notes_count} 条评论` : ""}</span>
            <CollectStar
              atom={{ kind: kind === "issue" ? "gitlab-issue" : "gitlab-mr", key: enc(projectId, item.iid, item.title) }}
              title={item.title}
            />
          </div>
        ))}
        {!q.loading && !q.error && (list?.items.length ?? 0) === 0 ? (
          <p className="dim gitlab-hint">{kind === "issue" ? "没有匹配的 Issue" : "没有匹配的合并请求"}</p>
        ) : null}
      </div>
      {list?.hasMore ? (
        <button className="btn gitlab-more" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>加载更多</button>
      ) : null}
    </div>
  );
}

/* ══════════ 流水线页签 ══════════ */

function PipelineJobs({ projectId, pipeline, onBack }: {
  projectId: number;
  pipeline: GitPipeline;
  onBack: () => void;
}): ReactNode {
  const jobs = useGitlabQuery(`jobs:${projectId}:${pipeline.id}`, () => gitlabPipelineJobs(projectId, pipeline.id));
  const [openJob, setOpenJob] = useState<GitJob | null>(null);
  const trace = useGitlabQuery(openJob ? `trace:${projectId}:${openJob.id}` : null, () =>
    openJob ? gitlabJobTrace(projectId, openJob.id) : Promise.resolve(""));

  if (openJob) {
    return (
      <div className="gitlab-jobs">
        <div className="gitlab-file-head">
          <button className="btn btn-ghost" onClick={() => setOpenJob(null)}>
            <IconChevron style={{ transform: "rotate(180deg)" }} /> 返回作业列表
          </button>
          <span className="gitlab-file-path">{openJob.stage} / {openJob.name}</span>
          <button className="btn" onClick={() => openExternal(openJob.web_url)}>
            <IconExternal /> 浏览器打开
          </button>
        </div>
        {trace.loading ? <p className="dim gitlab-hint">读取日志…</p> : null}
        {trace.error ? <p className="gitlab-error">{trace.error}</p> : null}
        {trace.data !== null && !trace.loading ? <pre className="gitlab-pre gitlab-trace">{trace.data}</pre> : null}
      </div>
    );
  }

  return (
    <div className="gitlab-jobs">
      <div className="gitlab-file-head">
        <button className="btn btn-ghost" onClick={onBack}>
          <IconChevron style={{ transform: "rotate(180deg)" }} /> 返回流水线列表
        </button>
        <span className="dim">流水线 #{pipeline.id} · {statusOf(pipeline.status).label} · {pipeline.ref}</span>
        <button className="btn btn-ghost" onClick={() => jobs.reload()} disabled={jobs.loading}>
          <IconRefresh /> 刷新
        </button>
      </div>
      {jobs.loading ? <p className="dim gitlab-hint">读取作业…</p> : null}
      {jobs.error ? <p className="gitlab-error">{jobs.error}</p> : null}
      <div className="cloud-list" role="listbox" aria-label="作业列表">
        {(jobs.data ?? []).map((j) => (
          <div key={j.id} className="cloud-row" role="button" tabIndex={0}
            onClick={() => setOpenJob(j)}
            onKeyDown={(e) => { if (e.key === "Enter") setOpenJob(j); }}
          >
            <span className={`gitlab-chip ${statusOf(j.status).tone}`}>{statusOf(j.status).label}</span>
            <span className="cloud-name">{j.name}</span>
            <span className="cloud-meta">{j.stage}{j.duration ? ` · ${fmtDuration(j.duration)}` : ""}</span>
          </div>
        ))}
        {!jobs.loading && !jobs.error && (jobs.data ?? []).length === 0 ? <p className="dim gitlab-hint">这次流水线没有作业</p> : null}
      </div>
    </div>
  );
}

function PipelineTab({ projectId, defaultBranch }: { projectId: number; defaultBranch: string }): ReactNode {
  const [refText, setRefText] = useState(defaultBranch);
  const [ref, setRef] = useState(defaultBranch);
  const [pages, setPages] = useState(1);
  const [openPipeline, setOpenPipeline] = useState<GitPipeline | null>(null);
  const q = useGitlabQuery(`pipelines:${projectId}:${ref}:${pages}`, () =>
    gitlabPages((page) => gitlabPipelinesPage(projectId, ref, page), pages));

  /** 分支名逐字输入不触发请求：回车或失焦才提交 */
  const commit = (): void => {
    const next = refText.trim();
    if (next === ref) return;
    setRef(next);
    setPages(1);
  };

  if (openPipeline) {
    return <PipelineJobs projectId={projectId} pipeline={openPipeline} onBack={() => setOpenPipeline(null)} />;
  }
  return (
    <div className="gitlab-pipelines">
      <div className="gitlab-toolbar">
        <input
          className="input gitlab-ref"
          placeholder="分支 / 标签（留空为全部，回车查询）"
          value={refText}
          onChange={(e) => setRefText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          onBlur={commit}
        />
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => q.reload()} disabled={q.loading}>
          <IconRefresh /> 刷新
        </button>
      </div>
      {q.loading ? <p className="dim gitlab-hint">读取流水线…</p> : null}
      {q.error ? <p className="gitlab-error">{q.error}</p> : null}
      <div className="cloud-list" role="listbox" aria-label="流水线列表">
        {(q.data?.items ?? []).map((p) => (
          <div key={p.id} className="cloud-row" role="button" tabIndex={0}
            onClick={() => setOpenPipeline(p)}
            onKeyDown={(e) => { if (e.key === "Enter") setOpenPipeline(p); }}
          >
            <span className={`gitlab-chip ${statusOf(p.status).tone}`}>{statusOf(p.status).label}</span>
            <span className="cloud-name">#{p.id}<span className="dim gitlab-req-sub"> {p.ref} · {p.sha?.slice(0, 8)} · {p.source}</span></span>
            <span className="cloud-meta">{fmtTime(p.created_at)}{p.duration ? ` · ${fmtDuration(p.duration)}` : ""}</span>
          </div>
        ))}
        {!q.loading && !q.error && (q.data?.items.length ?? 0) === 0 ? <p className="dim gitlab-hint">没有流水线记录（该项目可能未启用 CI/CD）</p> : null}
      </div>
      {q.data?.hasMore ? (
        <button className="btn gitlab-more" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>加载更多</button>
      ) : null}
    </div>
  );
}

/* ══════════ 项目内视图 ══════════ */

type ProjectTab = "code" | "issues" | "mrs" | "pipelines";

/** 克隆地址与归档下载（GitHub 那个 Code 按钮）：两条克隆地址可复制，ZIP 走应用内下载 */
function CodeButton({ project }: { project: GitProjectDetail }): ReactNode {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent): void => {
      if (wrapRef.current?.contains(ev.target as Node)) return;
      setOpen(false);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = (text: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast("已复制"))
      .catch(() => showToast("复制失败，请手动选中复制"));
  };

  const download = (): void => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    gitlabDownloadArchive(project)
      .then((path) => showToast(`已下载到：${path}`))
      .catch((e) => showToast(`下载失败：${String(e instanceof Error ? e.message : e).slice(0, 90)}`))
      .finally(() => setBusy(false));
  };

  return (
    <div className="gitlab-code-btn" ref={wrapRef}>
      <button className="btn btn-primary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Code ▾
      </button>
      {open ? (
        <div className="gitlab-code-menu" role="dialog" aria-label="克隆与下载">
          {project.http_url_to_repo ? (
            <div className="gitlab-code-row">
              <span className="gitlab-code-label">克隆（HTTPS）</span>
              <code>{project.http_url_to_repo}</code>
              <button className="btn mini" onClick={() => copy(project.http_url_to_repo)}>复制</button>
            </div>
          ) : null}
          {project.ssh_url_to_repo ? (
            <div className="gitlab-code-row">
              <span className="gitlab-code-label">克隆（SSH）</span>
              <code>{project.ssh_url_to_repo}</code>
              <button className="btn mini" onClick={() => copy(project.ssh_url_to_repo)}>复制</button>
            </div>
          ) : null}
          <button className="btn gitlab-code-zip" disabled={busy} onClick={download}>
            <IconDownload /> {busy ? "下载中…" : `下载 ZIP（${project.default_branch || "默认分支"}）`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectView({ projectId, initialTab, initialIid = null, onBack }: {
  projectId: number;
  initialTab: ProjectTab;
  initialIid?: number | null;
  onBack: () => void;
}): ReactNode {
  const [tab, setTab] = useState<ProjectTab>(initialTab);
  const detail = useGitlabQuery(`project:${projectId}`, () => gitlabProject(projectId));
  const project = detail.data;

  if (detail.loading) {
    return <p className="dim gitlab-hint">读取项目…</p>;
  }
  if (detail.error || !project) {
    return (
      <>
        <p className="gitlab-error">{detail.error ?? "项目不存在或无权访问"}</p>
        <button className="btn" onClick={onBack}>返回项目列表</button>
      </>
    );
  }

  const tabs: Array<[ProjectTab, string]> = [
    ["code", "代码"],
    ["issues", `Issue（${project.open_issues_count ?? 0}）`],
    ["mrs", "合并请求"],
    ["pipelines", "流水线"],
  ];

  return (
    <>
      {/* 返回入口放左上角（与进入项目后的浏览动线一致），标题与操作分列其后 */}
      <div className="page-head gitlab-project-head">
        <div className="gitlab-project-title">
          <button className="btn btn-ghost gitlab-back" onClick={onBack}>← 项目列表</button>
          <div>
            <h1>{project.name}</h1>
            <div className="page-head-meta">
              {project.path_with_namespace} · {project.visibility === "private" ? "私有" : project.visibility === "internal" ? "内部" : "公开"}
              {project.archived ? " · 已归档" : ""}
            </div>
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-ghost" onClick={() => detail.reload()} disabled={detail.loading}>
            <IconRefresh /> 刷新
          </button>
          <CodeButton project={project} />
          <button className="btn" onClick={() => openExternal(project.web_url)}>
            <IconExternal /> 浏览器打开
          </button>
        </div>
      </div>
      {project.description ? <p className="dim gitlab-desc">{project.description}</p> : null}
      <div className="segmented gitlab-tabs">
        {tabs.map(([v, label]) => (
          <button key={v} className={"seg" + (tab === v ? " is-active" : "")} onClick={() => setTab(v)}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <CollectStar
          atom={{ kind: "gitlab-proj", key: enc(project.id, project.name_with_namespace) }}
          title={project.name_with_namespace}
        />
      </div>
      {project.empty_repo ? (
        <p className="dim gitlab-hint">这是一个空仓库（还没有任何提交）。</p>
      ) : (
        <>
          {tab === "code" ? <CodeTab projectId={project.id} defaultBranch={project.default_branch} webUrl={project.web_url} /> : null}
          {tab === "issues" ? <RequestList kind="issue" projectId={project.id} initialIid={initialIid} /> : null}
          {tab === "mrs" ? <RequestList kind="mr" projectId={project.id} initialIid={initialIid} /> : null}
          {tab === "pipelines" ? <PipelineTab projectId={project.id} defaultBranch={project.default_branch} /> : null}
        </>
      )}
    </>
  );
}

/* ══════════ 页面 ══════════ */

export default function GitLabPage(): ReactNode {
  const { navParams } = useApp();
  const [projectId, setProjectId] = useState<number | null>(navParams?.gitlabProject ?? null);
  /** 原子深链目标：进入项目后落到指定页签，并打开指定 Issue / 合并请求 */
  const tab = (navParams?.gitlabTab ?? "code") as ProjectTab;
  const initialIid = navParams?.gitlabKind === "issue" || navParams?.gitlabKind === "mr"
    ? navParams?.gitlabIid ?? null
    : null;

  useEffect(() => {
    const id = navParams?.gitlabProject;
    if (id !== undefined && id !== null) setProjectId(id);
  }, [navParams?.gitlabProject]);

  return (
    <div className="page">
      {projectId === null ? (
        <ProjectList onOpen={(id) => setProjectId(id)} />
      ) : (
        <ProjectView
          key={`${projectId}:${tab}:${navParams?.gitlabKind ?? ""}:${initialIid ?? ""}`}
          projectId={projectId}
          initialTab={tab}
          initialIid={initialIid}
          onBack={() => setProjectId(null)}
        />
      )}
    </div>
  );
}
