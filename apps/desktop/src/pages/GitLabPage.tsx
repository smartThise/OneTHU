/**
 * 清华 GitLab 页（git.tsinghua.edu.cn，REST API v4 直连）。
 *
 * 认证：复用统一认证会话——首次请求会被漫游到 id 完成换票，用户无需单独配置。
 * 布局：项目列表（我参与的 / 星标 / 搜索）→ 项目内四个页签——
 * 代码（分支 + 目录树 + 文件内容 + 根目录 README 渲染）、Issue、合并请求、流水线
 * （流水线展开作业，作业可看日志）。Issue 与合并请求支持评论与关闭/重开。
 *
 * 2026-10-14 OneGUI 换血（同云盘页 7a1805de 判例）：
 * · 项目卡 = Card flush interactive + Row（IconGitLab accent 头件）；文件树 / Issue 行 / 合并请求行 /
 *   作业行 / 流水线行 = Card flush + List divided + Row（trailing 动作组同云盘判例）；
 * · 分栏切换 = OG Segment（省下 .segmented/.seg），搜索行 = Input type=search + Grow + Btn，
 *   错误/提示走 Banner（可带「重置统一认证」动作），首屏骨架 LoadingBlock，空态 EmptyState；
 * · 项目头 / 详情头 / 文件头 / 流水线作业头 = OG PageHead（onBack + 标题 Text mono），
 *   目录面包屑 = Breadcrumb，Code ▾ 克隆菜单与表情选择器 = Popover（库管浮层落位与点外收起）；
 * · 流水线/CI 状态徽标 = Tag tone（成功 success / 失败 error / 运行中 info / 手动 warning / 其余 neutral），
 *   commit SHA / 分支名 = Text mono；diff 块的 +/- 行按"代码数据"经 OG tone 工具类上语义色
 *   （-og-success / -og-error 令牌，同数据色判例）；README/评论正文 react-markdown 任意 HTML 视口
 *   沿用 .gitlab-md 排印豁免块（globals 里仅存的一组 GitLab 类，同 MailPage/.dock-md 判例）。
 * 行为/数据零改动：仓库切换（分片 noteAtomCache / 深链）、文件树导航、Issue/MR 读写、评论、
 * 流水线触发/重试、API 错误流（重置统一认证）全部原样保留。
 */
import { vaultCatchGitlabProject } from "../lib/vaultCatch.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApp } from "../state/context.js";
import { PageHead } from "../components/Layout.js";
import { CollectStar } from "../components/Collect.js";
import { enc, noteAtomCache } from "../state/atoms.js";
import { confirmDanger, confirmOk } from "../lib/confirm.js";
import { openFormModal } from "../lib/formModal.js";
import { openExternal } from "./info/openExternal.js";
import { showToast } from "../state/toast.js";
import {
  Accordion, AccordionItem, Avatar as OGAvatar, Banner, Breadcrumb, Btn, Card, Chip, CodeBlock, Divider,
  EmptyState, Grow, Icon, IconChevron, IconDownload, IconExternal, IconFile, IconFolder, IconGitLab, IconPen,
  IconPlus, IconRefresh, IconSearch, IconTrace, Inline, Input, IconBtn, List, LoadingBlock, PageHead as OGPageHead, Popover, Row,
  Section, Segment, Select, Spacer, Spinner, Stack, Tag, TextArea, Text,
} from "@onethu/gui";
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
import { t as i18n } from "../i18n/index.js";


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

/** OneGUI 卡片/徽标的语义色档（旧 .gitlab-chip 五色映射到这里） */
type StateTone = "neutral" | "success" | "error" | "warning" | "info";

/** 流水线与作业状态 → 文案与色标（徽标一律 Tag tone；dim → neutral、run → info） */
const PIPELINE_STATUS: {[key in GitPipelineStatus]: {label: string; tone: StateTone}} = {
  created: { label: "已创建", tone: "neutral" },
  waiting_for_resource: { label: "等待资源", tone: "neutral" },
  preparing: { label: "准备中", tone: "info" },
  pending: { label: "排队中", tone: "info" },
  running: { label: "运行中", tone: "info" },
  success: { label: "通过", tone: "success" },
  failed: { label: "失败，可点重试", tone: "error" },
  canceled: { label: "已取消", tone: "neutral" },
  canceling: { label: "取消中", tone: "neutral" },
  skipped: { label: "已跳过", tone: "neutral" },
  manual: { label: "手动", tone: "warning" },
  scheduled: { label: "已排期", tone: "neutral" },
};

function statusOf(status: string): { label: string; tone: StateTone } {
  return PIPELINE_STATUS[status as GitPipelineStatus] ?? { label: status, tone: "neutral" };
}

/** 状态徽标：一处把「状态差值态文案 / 类型徽标」统一成 Tag */
function StatusTag({ status }: { status: string }): ReactNode {
  const s = statusOf(status);
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

/** Issue / 合并请求状态徽标（opened→success 旧 .ok、merged→info 旧 .run、closed→neutral 旧 .dim） */
function ReqStateTag({ state }: { state: string }): ReactNode {
  return (
    <Tag tone={state === "opened" ? "success" : state === "merged" ? "info" : "neutral"}>
      {state === "merged" ? "已合入" : state === "opened" ? "进行中" : "已关闭"}
    </Tag>
  );
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

/** 行首类型图标：目录 accent、文件 content 色（靠库里的字色工具类） */
function kindIcon(type: GitFile["type"]): ReactNode {
  return type === "tree"
    ? <IconFolder size="sm" className="og-text--t-brand" title={i18n("auto.pages.GitLabPage.1")} />
    : <IconFile size="sm" title={i18n("auto.pages.GitLabPage.2")} />;
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
    <Stack gap={2}>
      <PageHead
        title={i18n("auto.pages.GitLabPage.3")}
        meta={<>{i18n("auto.pages.GitLabPage.4")}</>}
        actions={
          <Btn variant="ghost" onClick={() => q.reload()} disabled={q.loading} icon={<IconRefresh size="sm" />}>{q.loading ? "读取中…" : "刷新"}</Btn>
        }
      />
      <Inline gap={2} wrap>
        <Segment
          value={query ? "" : mode}
          onChange={(value) => {
            setMode(value === "starred" ? "starred" : "member");
            setQuery("");
            setText("");
            setPages(1);
          }}
          options={[
            { value: "member", label: i18n("auto.pages.GitLabPage.p1") },
            { value: "starred", label: i18n("auto.pages.GitLabPage.p2") },
          ]}
        />
        <Grow>
          <Input
            type="search"
            size="md"
            icon={<IconSearch size="sm" />}
            placeholder={i18n("auto.pages.GitLabPage.5")}
            aria-label={i18n("auto.pages.GitLabPage.6")}
            value={text}
            onChange={(value) => setText(value)}
            onEnter={(value) => { setQuery(value.trim()); setPages(1); }}
          />
        </Grow>
        {query ? (
          <Btn variant="outline" onClick={() => { setQuery(""); setText(""); setPages(1); }}>{i18n("auto.pages.GitLabPage.7")}</Btn>
        ) : null}
      </Inline>
      {q.loading && !list ? (
        <Card flush><LoadingBlock rows={3} /></Card>
      ) : q.loading ? (
        <Inline gap={1}><Spinner size="sm" /><Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.8")}</Text></Inline>
      ) : null}
      {q.error ? (
        <Banner tone="error" action={
          <Btn variant="outline" size="sm" onClick={() => {
              void gitlabResetAuth()
                .then(() => {
                  q.reload();
                  showToast(i18n("auto.pages.GitLabPage.msg1"));
                })
                .catch((e) => showToast(String(e).slice(0, 120)));
            }}>{i18n("auto.pages.GitLabPage.9")}</Btn>
        }>{q.error}</Banner>
      ) : null}
      {(list?.items ?? []).map((p) => (
        <Card
          key={p.id}
          flush
          interactive
          role="button"
          tabIndex={0}
          data-vault-catch={vaultCatchGitlabProject({ id: p.id, name: p.name_with_namespace, path: p.path_with_namespace })}
          onClick={() => onOpen(p.id)}
          onKeyDown={(e) => { if (e.key === "Enter") onOpen(p.id); }}
        >
          <Row
            flush
            leading={<IconGitLab size="lg" title={i18n("auto.pages.GitLabPage.10")} />}
            title={p.name_with_namespace}
            sub={p.description || undefined}
            meta={
              <>
                {i18n("auto.pages.GitLabPage.11")}{fmtTime(p.last_activity_at)}
                {p.default_branch ? <> {i18n("auto.pages.GitLabPage.12")}<Text slot="label" mono>{p.default_branch}</Text></> : null}
              </>
            }
            trailing={
              <CollectStar
                atom={{ kind: "gitlab-proj", key: enc(p.id, p.name_with_namespace) }}
                title={p.name_with_namespace}
              />
            }
          />
        </Card>
      ))}
      {!q.loading && !q.error && (list?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={<IconGitLab size="xl" />}
          title={query ? `没有匹配「${query}」的项目` : mode === "starred" ? "还没有星标项目" : "没有参与的项目"}
        />
      ) : null}
      {list?.hasMore ? (
        <Btn variant="outline" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>{i18n("auto.pages.GitLabPage.13")}</Btn>
      ) : null}
    </Stack>
  );
}

/* ══════════ 代码页签 ══════════ */

/** Markdown 正文（README / 描述 / 评论）。链接一律交给系统浏览器：
 *  直接在 WebView 里导航会把整个应用带走，且相对链接按项目地址解析才成立。
 *  容器走 .gitlab-md 排印豁免块（react-markdown 任意 HTML 视口，同 MailPage/.dock-md 判例）。 */
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
    <Stack gap={2}>
      <OGPageHead
        onBack={onBack}
        title={<Text slot="body" mono truncate>{file.path}</Text>}
        actions={
          <Btn variant="outline" onClick={() => openExternal(webUrl)} icon={<IconExternal size="sm" />}>{i18n("auto.pages.GitLabPage.14")}</Btn>
        }
      />
      {binary ? (
        <Text as="p" tone="faint">{i18n("auto.pages.GitLabPage.15")}</Text>
      ) : q.loading ? (
        <Card flush><LoadingBlock rows={3} /></Card>
      ) : q.error ? (
        <Banner tone="error">{q.error}</Banner>
      ) : isMarkdownPath(file.path) ? (
        <Stack pad={2}>
          <MarkdownBody text={q.data ?? ""} baseUrl={baseUrl} />
        </Stack>
      ) : (
        <div style={{ maxHeight: "62vh", overflowY: "auto" }}>
          <CodeBlock code={q.data ?? ""} />
        </div>
      )}
    </Stack>
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
    <Stack gap={2}>
      <Inline gap={2} wrap>
        <Select value={ref} onChange={(value) => setRef(value)} aria-label={i18n("auto.pages.GitLabPage.16")}>
          {(branches.data ?? []).map((b) => (
            <option key={b.name} value={b.name}>{b.name}{b.default ? "（默认）" : ""}</option>
          ))}
          {(branches.data ?? []).some((b) => b.name === ref) ? null : <option value={ref}>{ref}</option>}
        </Select>
        <Grow>
          <Breadcrumb
            items={[
              { label: ref || "根目录", onClick: () => { setPath(""); setPages(1); } },
              ...crumbs.map((c, i) => ({ label: c, onClick: () => { setPath(crumbs.slice(0, i + 1).join("/")); setPages(1); } })),
            ]}
            separator={<IconChevron size="sm" />}
          />
        </Grow>
        <Btn variant="ghost" onClick={() => tree.reload()} disabled={tree.loading} icon={<IconRefresh size="sm" />}>{i18n("auto.pages.GitLabPage.17")}</Btn>
      </Inline>
      {branches.error ? <Banner tone="error">{branches.error}</Banner> : null}
      {tree.error ? <Banner tone="error">{tree.error}</Banner> : null}
      {tree.loading ? (
        <Inline gap={1}><Spinner size="sm" /><Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.18")}</Text></Inline>
      ) : null}
      {tree.loading && !entries.length ? (
        <Card flush><LoadingBlock rows={4} /></Card>
      ) : (
        <Card flush role="listbox" aria-label={i18n("auto.pages.GitLabPage.19")}>
          <List divided>
            {entries.map((e) => (
              <Row
                key={e.id}
                flush
                role="button"
                onClick={() => {
                  if (e.type === "tree") { setPath(e.path); setPages(1); }
                  else setOpenFile(e);
                }}
                onKeyDown={(ev) => {
                  if (ev.key !== "Enter") return;
                  if (e.type === "tree") { setPath(e.path); setPages(1); }
                  else setOpenFile(e);
                }}
                leading={kindIcon(e.type)}
                title={e.name}
                trailing={<>{e.type === "tree" ? "目录" : ""}</>}
              />
            ))}
          </List>
          {!tree.loading && !tree.error && entries.length === 0 ? (
            <EmptyState title={i18n("auto.pages.GitLabPage.20")} />
          ) : null}
        </Card>
      )}
      {tree.data?.hasMore ? (
        <Btn variant="outline" onClick={() => setPages((n) => n + 1)} disabled={tree.loading}>{i18n("auto.pages.GitLabPage.13")}</Btn>
      ) : null}
      {readme ? (
        <Card flush>
          <Inline gap={2} pad={3} vAlign="center">
            <Text slot="label" tone="quiet">{readme.name}</Text>
            <Spacer />
            <Btn variant="outline" size="sm" icon={<IconExternal size="sm" />}
              onClick={() => openExternal(`${webUrl}/-/blob/${encodeURIComponent(ref)}/${readme.path}`)}
            >{i18n("auto.pages.GitLabPage.14")}</Btn>
          </Inline>
          <Divider />
          {readmeQuery.loading ? (
            <Stack pad={3}><LoadingBlock rows={3} /></Stack>
          ) : readmeQuery.error ? (
            <Stack pad={3}><Banner tone="error">{readmeQuery.error}</Banner></Stack>
          ) : readmeQuery.data ? (
            <Stack pad={3}>
              <MarkdownBody text={readmeQuery.data} baseUrl={webUrl} />
            </Stack>
          ) : null}
        </Card>
      ) : null}
    </Stack>
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
    <Segment
      value={value}
      onChange={(v) => onChange(v as GitlabIssueState)}
      options={options.map(([v, label]) => ({ value: v, label: counts ? `${label} ${counts[v]}` : label }))}
    />
  );
}

/** 作者头像（没有头像地址时退回首字母方块）：OG Avatar + onError 兜底 */
function AuthorAvatar({ user }: { user?: GitUser | null }): ReactNode {
  const [failed, setFailed] = useState(false);
  if (user?.avatar_url && !failed) {
    return (
      <span className="og-avatar og-avatar--sm">
        <img src={user.avatar_url} alt="" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  return <OGAvatar name={user?.name || "?"} size="sm" />;
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
    <div ref={wrapRef}>
      <Inline gap={1} wrap>
        {[...counts.entries()].map(([name, c]) => (
          <Chip
            key={name}
            size="sm"
            selected={c.mine !== null}
            disabled={busy}
            aria-label={`:${name}:（${c.mine !== null ? "点击取消我的回应" : "点击回应"}）`}
            onClick={() => void toggle(name, c.mine)}
          >
            {REACTION_EMOJI[name] ?? name} {c.n}
          </Chip>
        ))}
        <IconBtn
          label={i18n("auto.pages.GitLabPage.21")}
          variant="outline"
          size="sm"
          icon={<IconPlus size="sm" />}
          aria-expanded={picking}
          disabled={busy}
          onClick={() => setPicking((p) => !p)}
        />
      </Inline>
      {/* 表情选择器：挂 body 上的库浮层（线程容器有 overflow: hidden，就地弹会被裁成半截） */}
      <Popover
        open={picking}
        onClose={() => setPicking(false)}
        anchor={wrapRef.current ?? undefined}
        side="top"
        label={i18n("auto.pages.GitLabPage.22")}
      >
        <div style={{ width: "320px", maxWidth: "88vw" }}>
          <Stack gap={2}>
          <Input
            autoFocus
            placeholder={i18n("auto.pages.GitLabPage.23")}
            value={filter}
            onChange={(value) => setFilter(value)}
            onEnter={() => typeInName()}
          />
          <div style={{ maxHeight: "168px", overflowY: "auto" }}>
            <Inline gap={1} wrap>
              {shown.map(([name, emoji]) => (
                <Btn
                  key={name}
                  variant="ghost"
                  size="sm"
                  titleAttr={`:${name}:`}
                  onClick={() => { setPicking(false); setFilter(""); void toggle(name, counts.get(name)?.mine ?? null); }}
                >
                  {emoji}
                </Btn>
              ))}
              {shown.length === 0 ? <Text slot="micro" tone="faint">{i18n("auto.pages.GitLabPage.24")}</Text> : null}
            </Inline>
          </div>
          <Inline gap={2}>
            <Grow>
              <Input
                placeholder={i18n("auto.pages.GitLabPage.25")}
                value={typed}
                onChange={(value) => setTyped(value)}
                onEnter={() => typeInName()}
              />
            </Grow>
            <Btn variant="outline" onClick={() => typeInName()}>{i18n("auto.pages.GitLabPage.26")}</Btn>
          </Inline>
          </Stack>
        </div>
      </Popover>
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
  if (q.loading) return <LoadingBlock rows={3} />;
  if (q.error) return <Banner tone="error">{q.error}</Banner>;
  const changes = q.data?.changes ?? [];
  if (changes.length === 0) return <EmptyState title={i18n("auto.pages.GitLabPage.27")} />;
  return (
    <Stack gap={2}>
      <Text slot="micro" tone="faint">{changes.length} {i18n("auto.pages.GitLabPage.28")}</Text>
      <Accordion defaultOpenKeys={changes.length ? ["c0"] : []}>
        {changes.map((c, i) => (
          <AccordionItem
            key={c.new_path + i}
            id={`c${i}`}
            title={<Text slot="label" mono>{c.renamed_file ? `${c.old_path} → ${c.new_path}` : c.new_path}</Text>}
            trailing={
              <Tag tone={c.new_file ? "success" : c.deleted_file ? "error" : "neutral"}>
                {c.new_file ? "新增" : c.deleted_file ? "删除" : c.renamed_file ? "改名" : "修改"}
              </Tag>
            }
          >
            {c.too_large ? (
              <Text as="p" tone="faint">{i18n("auto.pages.GitLabPage.29")}</Text>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <Stack gap={0}>
                  {c.diff.split("\n").map((line, k) => (
                    <Text
                      key={k}
                      as="span"
                      slot="label"
                      mono
                      nowrap
                      tone={
                        line.startsWith("+") && !line.startsWith("+++") ? "success"
                          : line.startsWith("-") && !line.startsWith("---") ? "error"
                            : line.startsWith("@@") ? "brand" : undefined
                      }
                    >
                      {line}
                    </Text>
                  ))}
                </Stack>
              </div>
            )}
          </AccordionItem>
        ))}
      </Accordion>
    </Stack>
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
    <Stack gap={2}>
      <TextArea
        rows={4}
        placeholder={i18n("auto.pages.GitLabPage.30")}
        value={text}
        autoFocus
        onChange={(value) => setText(value)}
      />
      <Inline gap={2}>
        <Btn variant="solid" tone="brand" size="sm" disabled={busy || text.trim() === ""} onClick={() => onSave(text.trim())}>{busy ? "保存中…" : "保存"}</Btn>
        <Btn variant="ghost" size="sm" disabled={busy} onClick={onCancel}>{i18n("auto.pages.GitLabPage.31")}</Btn>
      </Inline>
    </Stack>
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
      showToast(i18n("auto.pages.GitLabPage.msg2"));
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    const ok = await confirmDanger("删除这条评论？删除后无法恢复。", {
      title: i18n("auto.pages.GitLabPage.p3"),
      confirmText: i18n("auto.pages.GitLabPage.p4"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await gitlabDeleteNote(kind, projectId, iid, discussionId, note.id);
      onChanged();
      showToast(i18n("auto.pages.GitLabPage.msg3"));
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

  const body = (
    <>
      <Inline gap={2} wrap vAlign="center">
        <AuthorAvatar user={note.author} />
        <Text slot="label" weight="semibold">{note.author?.name ?? "未知作者"}</Text>
        <Text slot="label" tone="faint">
          {fmtTime(note.created_at)}
          {note.updated_at && note.updated_at !== note.created_at ? "（已编辑）" : ""}
        </Text>
        <Spacer />
        <Inline gap={1}>
          {!mine && authorId ? (
            <Btn variant="outline" size="sm" disabled={busy} onClick={() => void assign()}>{i18n("auto.pages.GitLabPage.32")}</Btn>
          ) : null}
          {mine ? (
            <>
              <Btn variant="outline" size="sm" disabled={busy} onClick={() => setEditing((e) => !e)}>{editing ? "取消" : "编辑"}</Btn>
              <Btn variant="outline" size="sm" disabled={busy} onClick={() => void remove()}>{i18n("auto.pages.GitLabPage.33")}</Btn>
            </>
          ) : null}
        </Inline>
      </Inline>
      {editing ? (
        <NoteEditor initial={note.body} busy={busy} onSave={(b) => void save(b)} onCancel={() => setEditing(false)} />
      ) : (
        <MarkdownBody text={note.body} baseUrl={baseUrl} />
      )}
      <ReactionBar kind={kind} projectId={projectId} iid={iid} noteId={note.id} me={me} />
    </>
  );

  if (depth > 0) {
    /* 回复缩进：左侧竖分隔线做铁轨（与旧 22px 缩进同语义，几何走 OG 间距档） */
    return (
      <div role="listitem">
        <Inline gap={2} pad={3} vAlign="stretch">
          <Divider vertical />
          <Grow><Stack gap={2}>{body}</Stack></Grow>
        </Inline>
      </div>
    );
  }
  return (
    <div role="listitem">
      <Stack gap={2} pad={3}>{body}</Stack>
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
      showToast(i18n("auto.pages.GitLabPage.msg4"));
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card flush>
      <List divided>
        <NoteRow note={head} kind={kind} projectId={projectId} iid={iid} discussionId={discussion.id} me={me} baseUrl={baseUrl} depth={0} onChanged={onChanged} />
        {replies.map((n) => (
          <NoteRow key={n.id} note={n} kind={kind} projectId={projectId} iid={iid} discussionId={discussion.id} me={me} baseUrl={baseUrl} depth={1} onChanged={onChanged} />
        ))}
      </List>
      <Divider />
      <Inline gap={2} wrap pad={3}>
        <Btn variant="outline" size="sm" disabled={busy} onClick={() => setReplying((r) => !r)}>{replying ? "取消回复" : "回复"}</Btn>
        {resolvable ? (
          <Btn variant="outline" size="sm" disabled={busy} onClick={() => void resolve(!resolved)}>{resolved ? "重新打开讨论" : "解决讨论"}</Btn>
        ) : null}
        {resolved ? <Tag tone="success">{i18n("auto.pages.GitLabPage.34")}</Tag> : null}
      </Inline>
      {replying ? (
        <>
          <Divider />
          <Stack pad={3}>
            <NoteEditor initial="" busy={busy} onSave={(b) => void reply(b)} onCancel={() => setReplying(false)} />
          </Stack>
        </>
      ) : null}
    </Card>
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
    <Stack gap={2}>
      {q.loading && !q.data ? <Card flush><LoadingBlock rows={3} /></Card> : q.loading ? (
        <Inline gap={1}><Spinner size="sm" /><Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.35")}</Text></Inline>
      ) : null}
      {q.error ? <Banner tone="error">{q.error}</Banner> : null}
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
      {!q.loading && !q.error && threads.length === 0 ? <EmptyState title={i18n("auto.pages.GitLabPage.36")} /> : null}
      {q.data?.hasMore ? (
        <Btn variant="outline" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>{i18n("auto.pages.GitLabPage.37")}</Btn>
      ) : null}
    </Stack>
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
      showToast(i18n("auto.pages.GitLabPage.msg5"));
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };

  const assignees = (item as { assignees?: GitUser[] } | null)?.assignees ?? [];

  return (
    <Stack gap={2}>
      <OGPageHead
        onBack={onBack}
        title={item
          ? (
            <Inline gap={2} wrap>
              <Text slot="title">{item.title}</Text>
              <ReqStateTag state={item.state} />
              {mr?.draft ? <Tag tone="neutral">{i18n("auto.pages.GitLabPage.38")}</Tag> : null}
              {mr?.has_conflicts ? <Tag tone="error">{i18n("auto.pages.GitLabPage.39")}</Tag> : null}
            </Inline>
          )
          : <Text slot="title">{`!${iid}`}</Text>}
        sub={
          item ? (
            <Inline gap={2} wrap>
              <AuthorAvatar user={item.author} />
              <Text slot="label" tone="quiet">
                {item.author?.name ?? "未知作者"} {i18n("auto.pages.GitLabPage.40")}{fmtTime(item.created_at)}
              </Text>
              {mr ? (
                <Text slot="label" tone="faint" mono>{mr.source_branch} → {mr.target_branch}</Text>
              ) : null}
              {item.labels?.length ? <Tag tone="brand">{item.labels.join("、")}</Tag> : null}
            </Inline>
          )
          : null}
        actions={
          <Inline gap={2} wrap>
            {mr && mr.state === "opened" && (mr.user?.can_merge ?? true) ? (
              <Btn variant="solid" tone="brand" disabled={busy} onClick={() => void merge()}>{i18n("auto.pages.GitLabPage.41")}</Btn>
            ) : null}
            {item && item.state !== "merged" ? (
              <Btn variant="outline" disabled={busy} onClick={() => void toggleState()}>{closed ? "重新打开" : "关闭"}</Btn>
            ) : null}
            {item ? (
              <Btn variant="outline" onClick={() => openExternal(item.web_url)} icon={<IconExternal size="sm" />}>{i18n("auto.pages.GitLabPage.14")}</Btn>
            ) : null}
          </Inline>
        }
      />
      {detail.loading ? <Card flush><LoadingBlock rows={4} /></Card> : null}
      {detail.error ? <Banner tone="error">{detail.error}</Banner> : null}
      {item ? (
        <>
          <Stack pad={2}>
            <Text slot="label" tone="faint">
              {mr?.state === "merged" ? `合入于 ${fmtTime(mr.merged_at)} · ` : ""}
              {item.state === "closed" ? `关闭于 ${fmtTime(item.closed_at)} · ` : ""}
              {mr?.detailed_merge_status ? `${mr.detailed_merge_status} · ` : ""}
              {`指派：${assignees.length ? assignees.map((a) => a.name).join("、") : "无"}`}
            </Text>
          </Stack>
          {mr?.head_pipeline ? (
            <Inline gap={2}>
              <Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.42")}{mr.head_pipeline.id}</Text>
              <StatusTag status={mr.head_pipeline.status} />
            </Inline>
          ) : null}
          {item.description?.trim() ? (
            <Stack pad={2}><MarkdownBody text={item.description} baseUrl={baseUrl} /></Stack>
          ) : <Text as="p" tone="faint">{i18n("auto.pages.GitLabPage.43")}</Text>}
          <ReactionBar kind={kind} projectId={projectId} iid={iid} me={me.data?.username ?? ""} />
          {mr ? (
            <Section title={i18n("auto.pages.GitLabPage.44")}>
              <ChangesView projectId={projectId} iid={iid} />
            </Section>
          ) : null}
          <Section title={`评论（${item.user_notes_count ?? 0}）`}>
            <DiscussionList
              kind={kind}
              projectId={projectId}
              iid={iid}
              me={me.data?.username ?? ""}
              baseUrl={baseUrl}
              onChanged={refresh}
            />
          </Section>
          <Section title={i18n("auto.pages.GitLabPage.45")}>
            <NoteBox kind={kind} projectId={projectId} iid={iid} onDone={refresh} />
          </Section>
        </>
      ) : null}
    </Stack>
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
      showToast(i18n("auto.pages.GitLabPage.msg6"));
    } catch (e) {
      showToast(String(e instanceof Error ? e.message : e).slice(0, 120));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap={2}>
      <TextArea
        rows={4}
        placeholder={i18n("auto.pages.GitLabPage.30")}
        value={text}
        onChange={(value) => setText(value)}
      />
      <Inline gap={2}>
        <Btn variant="solid" tone="brand" disabled={busy || text.trim() === ""} onClick={() => void submit()}>{busy ? "发送中…" : "发表评论"}</Btn>
      </Inline>
    </Stack>
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
      { key: "title", label: i18n("auto.pages.GitLabPage.p5"), required: true },
      { key: "description", label: i18n("auto.pages.GitLabPage.p6"), kind: "textarea", placeholder: i18n("auto.pages.GitLabPage.p7") },
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
      showToast(i18n("auto.pages.GitLabPage.msg7"));
      return;
    }
    const target = branches.find((b) => b.default)?.name ?? branches[0]!.name;
    const source = branches.find((b) => b.name !== target)!.name;
    const form = await openFormModal("新建合并请求", [
      { key: "source", label: i18n("auto.pages.GitLabPage.p8"), kind: "select", options, default: source, required: true },
      { key: "target", label: i18n("auto.pages.GitLabPage.p9"), kind: "select", options, default: target, required: true },
      { key: "title", label: i18n("auto.pages.GitLabPage.p10"), required: true, placeholder: i18n("auto.pages.GitLabPage.p11") },
      { key: "description", label: i18n("auto.pages.GitLabPage.p12"), kind: "textarea", placeholder: i18n("auto.pages.GitLabPage.p13") },
    ]);
    if (!form) return;
    const sourceBranch = form.source ?? "";
    const targetBranch = form.target ?? "";
    if (!sourceBranch || !targetBranch) return;
    if (sourceBranch === targetBranch) {
      showToast(i18n("auto.pages.GitLabPage.msg8"));
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
    <Stack gap={2}>
      <Inline gap={2} wrap>
        <StateChips value={state} onChange={(v) => { setState(v); setPages(1); }} counts={counts.data ?? undefined} />
        <Grow>
          <Input
            type="search"
            size="md"
            icon={<IconSearch size="sm" />}
            placeholder={kind === "issue" ? "搜索 Issue（回车）" : "搜索合并请求（回车）"}
            aria-label={kind === "issue" ? "搜索 Issue" : "搜索合并请求"}
            value={text}
            onChange={(value) => setText(value)}
            onEnter={(value) => { setQuery(value.trim()); setPages(1); }}
          />
        </Grow>
        {query ? <Btn variant="outline" onClick={() => { setQuery(""); setText(""); setPages(1); }}>{i18n("auto.pages.GitLabPage.7")}</Btn> : null}
        <Btn variant="outline" onClick={() => void (kind === "issue" ? createIssue() : createMr())} icon={<IconPen size="sm" />}>{i18n("auto.pages.GitLabPage.46")}</Btn>
      </Inline>
      {q.loading && !list ? <Card flush><LoadingBlock rows={4} /></Card> : q.loading ? (
        <Inline gap={1}><Spinner size="sm" /><Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.47")}</Text></Inline>
      ) : null}
      {q.error ? <Banner tone="error">{q.error}</Banner> : null}
      <Card flush role="listbox" aria-label={kind === "issue" ? "Issue 列表" : "合并请求列表"}>
        <List divided>
          {(list?.items ?? []).map((item) => (
            <Row
              key={item.id}
              flush
              role="button"
              onClick={() => setOpenIid(item.iid)}
              onKeyDown={(e) => { if (e.key === "Enter") setOpenIid(item.iid); }}
              leading={<AuthorAvatar user={item.author} />}
              title={item.title}
              sub={
                <>
                  {`!${item.iid} · ${item.author?.name ?? "未知作者"} · ${fmtTime(item.updated_at)}`}
                  {isMergeRequest(item) ? (
                    <> · <Text slot="label" mono>{item.source_branch} → {item.target_branch}</Text></>
                  ) : null}
                </>
              }
              trailing={
                <>
                  <ReqStateTag state={item.state} />
                  <CollectStar
                    atom={{ kind: kind === "issue" ? "gitlab-issue" : "gitlab-mr", key: enc(projectId, item.iid, item.title) }}
                    title={item.title}
                  />
                </>
              }
            />
          ))}
        </List>
        {!q.loading && !q.error && (list?.items.length ?? 0) === 0 ? (
          <EmptyState icon={<IconGitLab size="xl" />} title={kind === "issue" ? "没有匹配的 Issue" : "没有匹配的合并请求"} />
        ) : null}
      </Card>
      {list?.hasMore ? (
        <Btn variant="outline" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>{i18n("auto.pages.GitLabPage.13")}</Btn>
      ) : null}
    </Stack>
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
      <Stack gap={2}>
        <OGPageHead
          onBack={() => setOpenJob(null)}
          title={<Text slot="body" mono truncate>{openJob.stage} / {openJob.name}</Text>}
          actions={<Btn variant="outline" onClick={() => openExternal(openJob.web_url)} icon={<IconExternal size="sm" />}>{i18n("auto.pages.GitLabPage.14")}</Btn>}
        />
        {trace.loading ? <Card flush><LoadingBlock rows={3} /></Card> : null}
        {trace.error ? <Banner tone="error">{trace.error}</Banner> : null}
        {trace.data !== null && !trace.loading ? (
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <CodeBlock code={trace.data} />
          </div>
        ) : null}
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      <OGPageHead
        onBack={onBack}
        title={<Text slot="title">{`流水线 #${pipeline.id}`}</Text>}
        sub={
          <Inline gap={2} wrap>
            <StatusTag status={pipeline.status} />
            <Text slot="label" tone="faint" mono>{pipeline.ref}</Text>
          </Inline>
        }
        actions={
          <Btn variant="ghost" onClick={() => jobs.reload()} disabled={jobs.loading} icon={<IconRefresh size="sm" />}>{i18n("auto.pages.GitLabPage.17")}</Btn>
        }
      />
      {jobs.loading && !jobs.data ? <Card flush><LoadingBlock rows={3} /></Card> : jobs.loading ? (
        <Inline gap={1}><Spinner size="sm" /><Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.48")}</Text></Inline>
      ) : null}
      {jobs.error ? <Banner tone="error">{jobs.error}</Banner> : null}
      <Card flush role="listbox" aria-label={i18n("auto.pages.GitLabPage.49")}>
        <List divided>
          {(jobs.data ?? []).map((j) => (
            <Row
              key={j.id}
              flush
              role="button"
              onClick={() => setOpenJob(j)}
              onKeyDown={(e) => { if (e.key === "Enter") setOpenJob(j); }}
              leading={<IconTrace size="lg" title={i18n("auto.pages.GitLabPage.50")} />}
              title={j.name}
              meta={<StatusTag status={j.status} />}
              trailing={<>{j.stage}{j.duration ? ` · ${fmtDuration(j.duration)}` : ""}</>}
            />
          ))}
        </List>
        {!jobs.loading && !jobs.error && (jobs.data ?? []).length === 0 ? (
          <EmptyState title={i18n("auto.pages.GitLabPage.51")} />
        ) : null}
      </Card>
    </Stack>
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
    <Stack gap={2}>
      <Inline gap={2} wrap>
        <Input
          aria-label={i18n("auto.pages.GitLabPage.52")}
          placeholder={i18n("auto.pages.GitLabPage.53")}
          value={refText}
          onChange={(value) => setRefText(value)}
          onEnter={(value) => { setRefText(value); const next = value.trim(); if (next !== ref) { setRef(next); setPages(1); } }}
          onFocusChange={(focused) => { if (!focused) commit(); }}
        />
        <Spacer />
        <Btn variant="ghost" onClick={() => q.reload()} disabled={q.loading} icon={<IconRefresh size="sm" />}>{i18n("auto.pages.GitLabPage.17")}</Btn>
      </Inline>
      {q.loading && !q.data ? <Card flush><LoadingBlock rows={4} /></Card> : q.loading ? (
        <Inline gap={1}><Spinner size="sm" /><Text slot="label" tone="faint">{i18n("auto.pages.GitLabPage.54")}</Text></Inline>
      ) : null}
      {q.error ? <Banner tone="error">{q.error}</Banner> : null}
      <Card flush role="listbox" aria-label={i18n("auto.pages.GitLabPage.55")}>
        <List divided>
          {(q.data?.items ?? []).map((p) => (
            <Row
              key={p.id}
              flush
              role="button"
              onClick={() => setOpenPipeline(p)}
              onKeyDown={(e) => { if (e.key === "Enter") setOpenPipeline(p); }}
              leading={<IconTrace size="lg" title={i18n("auto.pages.GitLabPage.56")} />}
              title={`#${p.id}`}
              meta={<StatusTag status={p.status} />}
              sub={
                <>
                  <Text slot="label" mono>{p.ref}</Text>
                  {p.sha ? <> · <Text slot="label" mono>{p.sha.slice(0, 8)}</Text></> : null}
                  {p.source ? <> · {p.source}</> : null}
                </>
              }
              trailing={<>{fmtTime(p.created_at)}{p.duration ? ` · ${fmtDuration(p.duration)}` : ""}</>}
            />
          ))}
        </List>
        {!q.loading && !q.error && (q.data?.items.length ?? 0) === 0 ? (
          <EmptyState title={i18n("auto.pages.GitLabPage.57")} />
        ) : null}
      </Card>
      {q.data?.hasMore ? (
        <Btn variant="outline" onClick={() => setPages((n) => n + 1)} disabled={q.loading}>{i18n("auto.pages.GitLabPage.13")}</Btn>
      ) : null}
    </Stack>
  );
}

/* ══════════ 项目内视图 ══════════ */

type ProjectTab = "code" | "issues" | "mrs" | "pipelines";

/** 克隆地址与归档下载（GitHub 那个 Code 按钮）：两条克隆地址可复制，ZIP 走应用内下载 */
function CodeButton({ project }: { project: GitProjectDetail }): ReactNode {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const copy = (text: string): void => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(i18n("auto.pages.GitLabPage.msg9")))
      .catch(() => showToast(i18n("auto.pages.GitLabPage.msg10")));
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

  const cloneRow = (label: string, url: string): ReactNode => (
    <Inline gap={2} key={label}>
      <Text slot="label" tone="faint">{label}</Text>
      <Grow><Text slot="label" mono truncate>{url}</Text></Grow>
      <Btn variant="outline" size="sm" onClick={() => copy(url)}>{i18n("auto.pages.GitLabPage.58")}</Btn>
    </Inline>
  );

  return (
    <div ref={wrapRef}>
      <Btn variant="solid" tone="brand" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Code ▾
      </Btn>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={wrapRef.current ?? undefined}
        align="center"
        label={i18n("auto.pages.GitLabPage.59")}
      >
        <Stack gap={2}>
          {project.http_url_to_repo ? cloneRow("克隆（HTTPS）", project.http_url_to_repo) : null}
          {project.ssh_url_to_repo ? cloneRow("克隆（SSH）", project.ssh_url_to_repo) : null}
          <Btn variant="outline" block disabled={busy} icon={<IconDownload size="sm" />} onClick={download}>
            {busy ? "下载中…" : `下载 ZIP（${project.default_branch || "默认分支"}）`}
          </Btn>
        </Stack>
      </Popover>
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

  const tabs: Array<[ProjectTab, string, string]> = [
    ["code", "代码", ""],
    ["issues", "Issue", `${project?.open_issues_count ?? 0}`],
    ["mrs", "合并请求", ""],
    ["pipelines", "流水线", ""],
  ];

  if (detail.loading) {
    return (
      <Stack gap={2}>
        <Card flush><LoadingBlock rows={3} /></Card>
      </Stack>
    );
  }
  if (detail.error || !project) {
    return (
      <Stack gap={2}>
        <Banner tone="error" action={<Btn variant="outline" size="sm" onClick={onBack}>{i18n("auto.pages.GitLabPage.60")}</Btn>}>
          {detail.error ?? "项目不存在或无权访问"}
        </Banner>
      </Stack>
    );
  }

  return (
    <Stack gap={2}>
      {/* 返回入口在页头（与进入项目后的浏览动线一致），标题与操作分列其后 */}
      <OGPageHead
        onBack={onBack}
        title={project.name}
        sub={
          <>
            {project.path_with_namespace} · {project.visibility === "private" ? "私有" : project.visibility === "internal" ? "内部" : "公开"}
            {project.archived ? " · 已归档" : ""}
          </>
        }
        actions={
          <Inline gap={2} wrap>
            <Btn variant="ghost" onClick={() => detail.reload()} disabled={detail.loading} icon={<IconRefresh size="sm" />}>{i18n("auto.pages.GitLabPage.17")}</Btn>
            <CodeButton project={project} />
            <Btn variant="outline" onClick={() => openExternal(project.web_url)} icon={<IconExternal size="sm" />}>{i18n("auto.pages.GitLabPage.14")}</Btn>
            <CollectStar
              atom={{ kind: "gitlab-proj", key: enc(project.id, project.name_with_namespace) }}
              title={project.name_with_namespace}
            />
          </Inline>
        }
      />
      {project.description ? <Stack pad={2}><Text slot="label" tone="quiet" clamp={2}>{project.description}</Text></Stack> : null}
      <Inline gap={2} wrap>
        <Segment
          value={tab}
          onChange={(value) => setTab(value as ProjectTab)}
          options={tabs.map(([v, label, count]) => ({ value: v, label: count ? `${label}（${count}）` : label }))}
        />
      </Inline>
      {project.empty_repo ? (
        <Text as="p" tone="faint">{i18n("auto.pages.GitLabPage.61")}</Text>
      ) : (
        <>
          {tab === "code" ? <CodeTab projectId={project.id} defaultBranch={project.default_branch} webUrl={project.web_url} /> : null}
          {tab === "issues" ? <RequestList kind="issue" projectId={project.id} initialIid={initialIid} /> : null}
          {tab === "mrs" ? <RequestList kind="mr" projectId={project.id} initialIid={initialIid} /> : null}
          {tab === "pipelines" ? <PipelineTab projectId={project.id} defaultBranch={project.default_branch} /> : null}
        </>
      )}
    </Stack>
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
