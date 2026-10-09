/**
 * 清华 GitLab（git.tsinghua.edu.cn）状态层。
 *
 * 认证：复用统一认证会话。lib 的 roamingWrapper 在 API 返回非 2xx 时自动走
 * 「GitLab 登录页 → 清华 OAuth → id 登录页 → 回调换票」并重放那次请求，
 * 因此本层只负责把凭据灌进 helper，不自己处理登录跳转。
 * 数据：项目 / 目录 / 文件 / Issue / 合并请求 / 流水线全部走带失效的键缓存，
 * 进页刷新，写操作后按前缀失效。
 */
import { useEffect, useRef, useState } from "react";
import { helper, libHydrateCredentials, restoreGitlabSession } from "../lib/infoLib.js";
import { explainNetworkError, nativeCookieClear } from "../lib/transport.js";
import { http } from "../lib/clients.js";
import type {
  GitAward,
  GitBranch,
  GitDiscussion,
  GitFile,
  GitIssue,
  GitJob,
  GitMergeRequest,
  GitMergeRequestChanges,
  GitNote,
  GitPipeline,
  GitProject,
  GitProjectDetail,
  GitUser,
} from "@onethu/info-lib";

/** GitLab 列表页大小（与 lib 侧一致）：返回满页即认为还有下一页 */
const PAGE_SIZE = 50;

export type GitlabIssueState = "opened" | "closed" | "all";

/* ══════════ 会话 ══════════ */

/** 把「记住密码」的凭据灌进 lib helper：漫游换票需要它，进程重启后它为空 */
async function requireSession(): Promise<void> {
  // 先把上次的 GitLab 会话票种回原生 cookie 仓：效期内能续用就不必再走一遍
  // 统一认证换票（那条链碰到老授权卡住时会一直把回调打回登录页 → 401）
  await restoreGitlabSession();
  await libHydrateCredentials();
  if (!helper.userId) {
    throw new Error("GitLab 需要统一认证会话：请在登录页重新登录一次（勾选记住密码）");
  }
}

/**
 * 重置统一认证会话（清 id 与 oauth 两个域的票，与本应用登录前那一步是同一动作）：
 * 统一认证侧对 GitLab 这个客户端会反复发回同一枚已消费的授权码（实测：同一 sig 下
 * code 跨轮恒定），兑付失败后回调被打回登录页，光重试无解；清掉这两个域后，下次漫游
 * 会走完整登录，重新换一枚授权码。
 */
export async function gitlabResetAuth(): Promise<void> {
  await nativeCookieClear();
  cache.clear();
  bump();
}

/* ══════════ 数据面 ══════════ */

/**
 * 列表类接口一律单页取回（插件 API 直接用页号）；界面用本函数把 pages 页拼成一段列表，
 * 返回是否还有下一页（满页即可能还有）。
 */
export async function gitlabPages<T>(
  load: (page: number) => Promise<T[]>,
  pages: number,
): Promise<GitlabList<T>> {
  const items: T[] = [];
  let last: T[] = [];
  for (let page = 1; page <= pages; page++) {
    last = await load(page);
    items.push(...last);
    if (last.length < PAGE_SIZE) break;
  }
  return { items, hasMore: last.length >= PAGE_SIZE };
}

export interface GitlabList<T> {
  items: T[];
  hasMore: boolean;
}

/** Issue 与合并请求的联合视图：合并请求多出分支、草稿、合入时间与流水线字段 */
export function isMergeRequest(item: GitIssue | GitMergeRequest): item is GitMergeRequest {
  return "source_branch" in item;
}

export async function gitlabProjectsPage(page: number): Promise<GitProject[]> {
  await requireSession();
  return helper.getGitRecentProjects(page);
}

export async function gitlabStarredPage(page: number): Promise<GitProject[]> {
  await requireSession();
  return helper.getGitStarredProjects(page);
}

export async function gitlabSearchPage(search: string, page: number): Promise<GitProject[]> {
  await requireSession();
  return helper.searchGitProjects(search, page);
}

export async function gitlabProject(id: number): Promise<GitProjectDetail> {
  await requireSession();
  return helper.getGitProjectDetail(id);
}

export async function gitlabBranches(id: number): Promise<GitBranch[]> {
  await requireSession();
  const branches = await helper.getGitProjectBranches(id);
  return [...branches].sort((a, b) => Number(b.default) - Number(a.default));
}

export async function gitlabTreePage(id: number, path: string, ref: string, page: number): Promise<GitFile[]> {
  await requireSession();
  return helper.getGitProjectTree(id, path, ref, page);
}

/** 文件正文（按 blob sha 取 raw；目录列表已经带回 sha） */
export async function gitlabFile(id: number, sha: string): Promise<string> {
  await requireSession();
  return helper.getGitProjectFileBlob(id, sha);
}

export async function gitlabIssuesPage(
  id: number,
  state: GitlabIssueState,
  search: string,
  page: number,
): Promise<GitIssue[]> {
  await requireSession();
  return helper.getGitProjectIssues(id, state, search, page);
}

export async function gitlabIssue(id: number, iid: number): Promise<GitIssue> {
  await requireSession();
  return helper.getGitProjectIssue(id, iid);
}

export async function gitlabIssueNotes(id: number, iid: number): Promise<GitNote[]> {
  await requireSession();
  return helper.getGitIssueNotes(id, iid);
}

export async function gitlabMergeRequestsPage(
  id: number,
  state: GitlabIssueState,
  search: string,
  page: number,
): Promise<GitMergeRequest[]> {
  await requireSession();
  return helper.getGitProjectMergeRequests(id, state, search, page);
}

export async function gitlabMergeRequest(id: number, iid: number): Promise<GitMergeRequest> {
  await requireSession();
  return helper.getGitProjectMergeRequest(id, iid);
}

export async function gitlabMergeRequestNotes(id: number, iid: number): Promise<GitNote[]> {
  await requireSession();
  return helper.getGitMergeRequestNotes(id, iid);
}

export async function gitlabPipelinesPage(id: number, ref: string, page: number): Promise<GitPipeline[]> {
  await requireSession();
  return helper.getGitProjectPipelines(id, ref, page);
}

export async function gitlabPipelineJobs(id: number, pipelineId: number): Promise<GitJob[]> {
  await requireSession();
  return helper.getGitPipelineJobs(id, pipelineId);
}

export async function gitlabJobTrace(id: number, jobId: number): Promise<string> {
  await requireSession();
  return helper.getGitJobTrace(id, jobId);
}

/** 议题 / 合并请求三种状态的条数（总数取自服务端 x-total） */
export async function gitlabRequestCounts(
  kind: "issue" | "mr",
  id: number,
): Promise<{ opened: number; closed: number; all: number }> {
  await requireSession();
  return helper.getGitRequestCounts(kind, id);
}

/** 下载仓库归档（ZIP）：与网络学堂附件同一条通道（带会话 Cookie 直取字节再落盘） */
export async function gitlabDownloadArchive(
  project: { web_url: string; name: string; default_branch: string },
  ref?: string,
): Promise<string> {
  const branch = ref || project.default_branch || "master";
  const filename = `${project.name}-${branch}.zip`;
  const url = `${project.web_url}/-/archive/${encodeURIComponent(branch)}/${encodeURIComponent(filename)}`;
  const cookies = http.jar
    .getCookies(new URL(url))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("download_file", { url, cookies, filename });
}

/** 当前登录用户（判断哪些评论是自己发的，才给编辑入口） */
export async function gitlabCurrentUser(): Promise<GitUser> {
  await requireSession();
  return helper.getGitCurrentUser();
}

/* ══════════ 讨论（评论线程）══════════ */

export function discussionsKey(kind: "issue" | "mr", id: number, iid: number, pages: number): string {
  return `discussions:${kind}:${id}:${iid}:${pages}`;
}

export async function gitlabDiscussions(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  pages: number,
): Promise<GitlabList<GitDiscussion>> {
  await requireSession();
  return gitlabPages((page) => helper.getGitDiscussions(kind, id, iid, page), pages);
}

/** 发新评论（新讨论）；返回后由调用方刷新线程列表 */
export async function gitlabCreateDiscussion(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  body: string,
): Promise<GitDiscussion> {
  await requireSession();
  const d = await helper.createGitDiscussion(kind, id, iid, body);
  invalidateGitlab(`discussions:${kind}:${id}:${iid}:`);
  invalidateGitlab(`${kind}:${id}:${iid}`);
  return d;
}

export async function gitlabReply(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  discussionId: string,
  body: string,
): Promise<GitNote> {
  await requireSession();
  const note = await helper.addGitDiscussionNote(kind, id, iid, discussionId, body);
  invalidateGitlab(`discussions:${kind}:${id}:${iid}:`);
  invalidateGitlab(`${kind}:${id}:${iid}`);
  return note;
}

export async function gitlabUpdateDiscussionNote(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  discussionId: string,
  noteId: number,
  body: string,
): Promise<GitNote> {
  await requireSession();
  const note = await helper.updateGitDiscussionNote(kind, id, iid, discussionId, noteId, body);
  invalidateGitlab(`discussions:${kind}:${id}:${iid}:`);
  return note;
}

export async function gitlabDeleteNote(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  discussionId: string,
  noteId: number,
): Promise<void> {
  await requireSession();
  await helper.deleteGitDiscussionNote(kind, id, iid, discussionId, noteId);
  invalidateGitlab(`discussions:${kind}:${id}:${iid}:`);
  invalidateGitlab(`${kind}:${id}:${iid}`);
}

export async function gitlabResolveDiscussion(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  discussionId: string,
  resolved: boolean,
): Promise<void> {
  await requireSession();
  await helper.resolveGitDiscussion(kind, id, iid, discussionId, resolved);
  invalidateGitlab(`discussions:${kind}:${id}:${iid}:`);
}

/** 指派（userIds 传空数组取消全部指派） */
export async function gitlabAssign(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  userIds: number[],
): Promise<void> {
  await requireSession();
  await helper.assignGitTo(kind, id, iid, userIds);
  invalidateGitlab(`${kind}:${id}:${iid}`);
  invalidateGitlab(`${kind === "issue" ? "issues" : "mrs"}:${id}:`);
}

/* ══════════ 表情回应（award emoji）══════════ */

/** 缓存键：评论上的回应按 noteId 分开存 */
export function awardsKey(kind: "issue" | "mr", id: number, iid: number, noteId?: number): string {
  return `awards:${kind}:${id}:${iid}:${noteId ?? 0}`;
}

export async function gitlabAwards(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  noteId?: number,
): Promise<GitAward[]> {
  await requireSession();
  return helper.getGitAwards(kind, id, iid, noteId);
}

export async function gitlabAddAward(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  name: string,
  noteId?: number,
): Promise<GitAward> {
  await requireSession();
  const award = await helper.addGitAward(kind, id, iid, name, noteId);
  invalidateGitlab(awardsKey(kind, id, iid, noteId));
  return award;
}

export async function gitlabRemoveAward(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  awardId: number,
  noteId?: number,
): Promise<void> {
  await requireSession();
  await helper.removeGitAward(kind, id, iid, awardId, noteId);
  invalidateGitlab(awardsKey(kind, id, iid, noteId));
}

/* ══════════ 合并请求：变更、新建、合入 ══════════ */

export async function gitlabMergeRequestChanges(id: number, iid: number): Promise<GitMergeRequestChanges> {
  await requireSession();
  return helper.getGitMergeRequestChanges(id, iid);
}

export async function gitlabCreateMergeRequest(
  id: number,
  sourceBranch: string,
  targetBranch: string,
  title: string,
  description: string,
): Promise<GitMergeRequest> {
  await requireSession();
  const mr = await helper.createGitMergeRequest(id, sourceBranch, targetBranch, title, description);
  invalidateGitlab(`mrs:${id}:`);
  return mr;
}

export async function gitlabMerge(id: number, iid: number): Promise<GitMergeRequest> {
  await requireSession();
  const mr = await helper.mergeGitMergeRequest(id, iid);
  invalidateGitlab(`mrs:${id}:`);
  invalidateGitlab(`mr:${id}:${iid}`);
  return mr;
}

/* ══════════ 写操作 ══════════ */

export async function gitlabCreateIssue(id: number, title: string, description: string): Promise<GitIssue> {
  await requireSession();
  const issue = await helper.createGitProjectIssue(id, title, description);
  invalidateGitlab(`issues:${id}:`);
  return issue;
}

export async function gitlabAddNote(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  body: string,
): Promise<GitNote> {
  await requireSession();
  const note = kind === "issue"
    ? await helper.addGitIssueNote(id, iid, body)
    : await helper.addGitMergeRequestNote(id, iid, body);
  invalidateGitlab(kind === "issue" ? `issue:${id}:${iid}` : `mr:${id}:${iid}`);
  return note;
}

export async function gitlabSetState(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  state: "close" | "reopen",
): Promise<void> {
  await requireSession();
  if (kind === "issue") await helper.setGitIssueState(id, iid, state);
  else await helper.setGitMergeRequestState(id, iid, state);
  invalidateGitlab(kind === "issue" ? `issues:${id}:` : `mrs:${id}:`);
  invalidateGitlab(`${kind === "issue" ? "issue" : "mr"}:${id}:${iid}`);
}

/** 改写自己的评论（GitLab 只允许作者本人改） */
export async function gitlabUpdateNote(
  kind: "issue" | "mr",
  id: number,
  iid: number,
  noteId: number,
  body: string,
): Promise<GitNote> {
  await requireSession();
  const note = kind === "issue"
    ? await helper.updateGitIssueNote(id, iid, noteId, body)
    : await helper.updateGitMergeRequestNote(id, iid, noteId, body);
  invalidateGitlab(kind === "issue" ? `issue:${id}:${iid}` : `mr:${id}:${iid}`);
  return note;
}

/* ══════════ 键缓存与订阅 ══════════ */

const cache = new Map<string, { at: number; data: unknown }>();
const listeners = new Set<() => void>();
/** 缓存新鲜期：过期后再次挂载即重取（远端状态会被别人改，长驻会话不能只看首次结果） */
const TTL_MS = 60_000;
let version = 0;

function bump(): void {
  version++;
  listeners.forEach((fn) => fn());
}

function cached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

/** 失效某前缀下的全部缓存（写操作后调用），并让挂载中的查询重取 */
export function invalidateGitlab(prefix: string): void {
  let hit = false;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      hit = true;
    }
  }
  if (hit) bump();
}

export interface GitlabQuery<T> {
  loading: boolean;
  error: string | null;
  data: T | null;
  reload: () => void;
}

/**
 * 键控查询：同一 key 在新鲜期内只取一次，reload / invalidate 后重取。
 * key 为 null 表示不查询（如未选中项目）。
 */
export function useGitlabQuery<T>(key: string | null, load: () => Promise<T>): GitlabQuery<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const [ver, setVer] = useState(version);
  const [state, setState] = useState<{ loading: boolean; error: string | null; data: T | null }>(() => {
    const hit = key === null ? null : cached<T>(key);
    return { loading: key !== null && hit === null, error: null, data: hit };
  });

  useEffect(() => {
    const fn = () => setVer(version);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (key === null) {
      setState({ loading: false, error: null, data: null });
      return;
    }
    const hit = cached<T>(key);
    if (hit !== null) {
      setState({ loading: false, error: null, data: hit });
      return;
    }
    let alive = true;
    setState({ loading: true, error: null, data: null });
    loadRef.current().then(
      (data) => {
        if (!alive) return;
        cache.set(key, { at: Date.now(), data });
        setState({ loading: false, error: null, data });
      },
      (e) => {
        if (!alive) return;
        setState({ loading: false, error: explainNetworkError(e), data: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, ver]);

  return {
    ...state,
    reload: () => {
      if (key !== null) cache.delete(key);
      bump();
    },
  };
}
