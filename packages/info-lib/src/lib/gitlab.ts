import {InfoHelper} from "../index";
import {roamingWrapper, roamingWrapperWithMocks} from "./core";
import {stringify, uFetch, uFetchMethod, platformFetchWith} from "../utils/network";
import * as cheerio from "cheerio";
import {GITLAB_API_BASE_URL, GITLAB_WEB_BASE_URL} from "../constants/strings";
import {GitLabApiError} from "../utils/error";
import {
    MOCK_GIT_NAMESPACES,
    MOCK_GIT_PERSONAL_PROJECTS,
    MOCK_GIT_RECENT_PROJECTS, MOCK_PROJECT_BRANCH,
    MOCK_PROJECT_DETAIL,
} from "../mocks/gitlab";
import {Award, Branch, Discussion, File, Issue, Job, MergeRequest, MergeRequestChanges, Namespace, Note, Pipeline, Project, ProjectDetail, User} from "../models/gitlab/gitlab";

const fetchGitLabRaw = async (path: string, query?: object, post?: object) => {
    try {
        return await uFetch(
            GITLAB_API_BASE_URL + path + (query ? `?${stringify(query)}` : ""),
            post ? JSON.stringify(post) as never as object : undefined,
            60000,
            "UTF-8",
            true,
            "application/json",
        );
    } catch (e) {
        throw new GitLabApiError(e instanceof Error ? e.message : String(e));
    }
};

const fetchGitLab = async (path: string, query?: object, post?: object) => {
    try {
        return await fetchGitLabRaw(path, query, post).then(JSON.parse);
    } catch (e) {
        throw new GitLabApiError(e instanceof Error ? e.message : String(e));
    }
};

/** 写操作（POST/PUT）：原版 uFetch 只发 GET/POST，更新类接口需显式方法。
 *  会话 cookie 认证下 GitLab 还校验 CSRF（Gitlab::RequestForgeryProtection 读
 *  X-CSRF-Token），缺了写请求会被拒成 401——令牌是每会话的，从已登录页面上的 meta 取一份缓存。 */
const CSRF_TTL_MS = 10 * 60_000;
let csrfCache: {token: string; at: number} | null = null;

const gitlabCsrfToken = async (force = false): Promise<string> => {
    if (!force && csrfCache !== null && Date.now() - csrfCache.at < CSRF_TTL_MS) {
        return csrfCache.token;
    }
    const html = await uFetch(`${GITLAB_WEB_BASE_URL}/`);
    const token = cheerio.load(html)("meta[name=csrf-token]").attr("content") ?? "";
    if (token === "") {
        throw new GitLabApiError("取不到 GitLab 写操作所需的 CSRF 令牌（会话可能已失效）");
    }
    csrfCache = {token, at: Date.now()};
    return token;
};

const fetchGitLabWrite = async (path: string, method: "POST" | "PUT" | "DELETE", payload: object = {}) => {
    // 删除类接口成功时是 204 空响应体：无条件 JSON.parse 会抛错，进而被漫游包装器当成
    // 会话失效去重试一次，重试时资源已不存在 → 404 冒到界面上（2026-10-08 实测：
    // 取消表情回应 DELETE 成功 204 之后又发一次同样的 DELETE 收到 404）
    const send = async (force: boolean) => {
        const text = await uFetchMethod(GITLAB_API_BASE_URL + path, method, payload, {"X-CSRF-Token": await gitlabCsrfToken(force)});
        return text.trim() === "" ? null : JSON.parse(text);
    };
    try {
        return await send(false);
    } catch (e) {
        // 令牌随会话轮换：写请求被拒时换一枚新令牌重试一次，其余错误照旧抛
        if (e instanceof GitLabApiError && /40[13]|422/.test(e.message)) {
            csrfCache = null;
            return await send(true);
        }
        throw e;
    }
};

/** 分页与过滤参数：空串与 undefined 一律不带（stringify 会把它们编码成 "undefined"） */
const apiQuery = (base: {[key: string]: string | number | undefined}): {[key: string]: string | number} => {
    const out: {[key: string]: string | number} = {};
    for (const [key, value] of Object.entries(base)) {
        if (value === undefined || value === "") continue;
        out[key] = value;
    }
    return out;
};

/** 列表页大小：与 GitLab 上限一致，翻页判据为「本页返回条数是否满页」 */
const PER_PAGE = 50;

const probeGitLab = async () => {
    await fetchGitLab("/version");
};

export const getNamespaces = async (
    helper: InfoHelper,
    page: number,
): Promise<Namespace[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return await fetchGitLab("/namespaces", {page: page});
        },
        MOCK_GIT_NAMESPACES,
    );

export const getRecentProjects = async (
    helper: InfoHelper,
    page: number,
): Promise<Project[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            const result = await fetchGitLab("/projects", {
                membership: true,
                archived: false,
                simple: true,
                order_by: "last_activity_at",
                page: page,
            });
            if (result.length === 0) {
                await probeGitLab();
            }
            return result;
        },
        page === 1 ? MOCK_GIT_RECENT_PROJECTS : [],
    );

export const getPersonalProjects = async (
    helper: InfoHelper,
    name: string,
    page: number,
): Promise<Project[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            const result = await fetchGitLab(`/users/${name}/projects`, {
                simple: true,
                order_by: "last_activity_at",
                page: page,
            });
            if (result.length === 0) {
                await probeGitLab();
            }
            return result;
        },
        page === 1 ? MOCK_GIT_PERSONAL_PROJECTS : [],
    );

export const getStarredProjects = async (
    helper: InfoHelper,
    page: number,
): Promise<Project[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            const result = await fetchGitLab("/projects", {
                starred: true,
                simple: true,
                order_by: "last_activity_at",
                page: page,
            });
            if (result.length === 0) {
                await probeGitLab();
            }
            return result;
        },
        page === 1 ? MOCK_GIT_RECENT_PROJECTS : [],
    );

export const searchProjects = async (
    helper: InfoHelper,
    search: string,
    page: number,
): Promise<Project[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return await fetchGitLab("/search", {scope: "projects", search, page});
        },
        [],
    );

export const getProjectDetail = async (
    helper: InfoHelper,
    id: number,
): Promise<ProjectDetail> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return await fetchGitLab(`/projects/${id}`);
        },
        MOCK_PROJECT_DETAIL,
    );

export const getProjectTree = async (
    helper: InfoHelper,
    id: number,
    path: string,
    ref: string,
    page: number,
): Promise<File[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return await fetchGitLab(`/projects/${id}/repository/tree`, {path, ref, page});
        },
        [],
    );

export const getProjectBranches = async (
    helper: InfoHelper,
    id: number,
): Promise<Branch[]> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return await fetchGitLab(`/projects/${id}/repository/branches`);
        },
        [MOCK_PROJECT_BRANCH],
    );

export const getProjectFileBlob = async (
    helper: InfoHelper,
    id: number,
    sha: string,
): Promise<string> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return await fetchGitLabRaw(`/projects/${id}/repository/blobs/${sha}/raw`);
        },
        "",
    );

export const renderMarkdown = async (
    helper: InfoHelper,
    text: string,
): Promise<string> =>
    roamingWrapperWithMocks(
        helper,
        "gitlab",
        "",
        async () => {
            return (await fetchGitLab("/markdown", undefined, {text})).html;
        },
        "",
    );

/** 议题 / 合并请求的条数：列表体里不带总数，总数在 x-total 响应头里（按状态各取一次） */
export const getRequestCounts = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
): Promise<{opened: number; closed: number; all: number}> =>
    roamingWrapper(helper, "gitlab", "", async () => {
        const base = `/projects/${id}/${kind === "issue" ? "issues" : "merge_requests"}`;
        const total = async (state: string): Promise<number> => {
            const res = await platformFetchWith(`${GITLAB_API_BASE_URL}${base}?state=${state}&per_page=1`);
            const header = new Map(res.headers.map(([k, v]) => [k.toLowerCase(), v])).get("x-total");
            if (header === undefined) {
                throw new GitLabApiError(`取不到条目总数（HTTP ${res.status}）`);
            }
            return Number(header);
        };
        const [opened, closed] = await Promise.all([total("opened"), total("closed")]);
        return {opened, closed, all: opened + closed};
    });

/** 当前登录用户（个人项目、Issue 归属等展示用） */
export const getCurrentUser = async (helper: InfoHelper): Promise<User> =>
    roamingWrapper(helper, "gitlab", "", async () => fetchGitLab("/user"));

export const getProjectIssues = async (
    helper: InfoHelper,
    id: number,
    state: string,
    search: string,
    page: number,
): Promise<Issue[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`/projects/${id}/issues`, apiQuery({state, search, per_page: PER_PAGE, page})));

export const getProjectIssue = async (
    helper: InfoHelper,
    id: number,
    iid: number,
): Promise<Issue> =>
    roamingWrapper(helper, "gitlab", "", async () => fetchGitLab(`/projects/${id}/issues/${iid}`));

export const getIssueNotes = async (
    helper: InfoHelper,
    id: number,
    iid: number,
): Promise<Note[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`/projects/${id}/issues/${iid}/notes`, apiQuery({sort: "asc", per_page: PER_PAGE})));

export const getProjectMergeRequests = async (
    helper: InfoHelper,
    id: number,
    state: string,
    search: string,
    page: number,
): Promise<MergeRequest[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`/projects/${id}/merge_requests`, apiQuery({state, search, per_page: PER_PAGE, page})));

export const getProjectMergeRequest = async (
    helper: InfoHelper,
    id: number,
    iid: number,
): Promise<MergeRequest> =>
    roamingWrapper(helper, "gitlab", "", async () => fetchGitLab(`/projects/${id}/merge_requests/${iid}`));

export const getMergeRequestNotes = async (
    helper: InfoHelper,
    id: number,
    iid: number,
): Promise<Note[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`/projects/${id}/merge_requests/${iid}/notes`, apiQuery({sort: "asc", per_page: PER_PAGE})));

export const getProjectPipelines = async (
    helper: InfoHelper,
    id: number,
    ref: string,
    page: number,
): Promise<Pipeline[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`/projects/${id}/pipelines`, apiQuery({ref, per_page: PER_PAGE, page})));

export const getPipelineJobs = async (
    helper: InfoHelper,
    id: number,
    pipelineId: number,
): Promise<Job[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`/projects/${id}/pipelines/${pipelineId}/jobs`, apiQuery({per_page: PER_PAGE})));

/** 作业日志（纯文本，服务端已按 ANSI 着色） */
export const getJobTrace = async (
    helper: InfoHelper,
    id: number,
    jobId: number,
): Promise<string> =>
    roamingWrapper(helper, "gitlab", "", async () => fetchGitLabRaw(`/projects/${id}/jobs/${jobId}/trace`));

export const createProjectIssue = async (
    helper: InfoHelper,
    id: number,
    title: string,
    description: string,
): Promise<Issue> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/issues`, "POST", {title, description}));

/** 关闭或重开 Issue（state_event 取 close / reopen） */
export const setIssueState = async (
    helper: InfoHelper,
    id: number,
    iid: number,
    state: "close" | "reopen",
): Promise<Issue> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/issues/${iid}`, "PUT", {state_event: state}));

export const addIssueNote = async (
    helper: InfoHelper,
    id: number,
    iid: number,
    body: string,
): Promise<Note> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/issues/${iid}/notes`, "POST", {body}));

/** 关闭或重开合并请求（state_event 取 close / reopen；不合入、不删除源分支） */
export const setMergeRequestState = async (
    helper: InfoHelper,
    id: number,
    iid: number,
    state: "close" | "reopen",
): Promise<MergeRequest> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/merge_requests/${iid}`, "PUT", {state_event: state}));

export const addMergeRequestNote = async (
    helper: InfoHelper,
    id: number,
    iid: number,
    body: string,
): Promise<Note> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/merge_requests/${iid}/notes`, "POST", {body}));

/** 改写自己的评论（GitLab 只允许作者本人改） */
export const updateIssueNote = async (
    helper: InfoHelper,
    id: number,
    iid: number,
    noteId: number,
    body: string,
): Promise<Note> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/issues/${iid}/notes/${noteId}`, "PUT", {body}));

export const updateMergeRequestNote = async (
    helper: InfoHelper,
    id: number,
    iid: number,
    noteId: number,
    body: string,
): Promise<Note> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/merge_requests/${iid}/notes/${noteId}`, "PUT", {body}));

/* ── 讨论（thread）：评论线程、回复、编辑、删除、解决 ── */

const threadBase = (kind: "issue" | "mr", id: number, iid: number): string =>
    kind === "issue" ? `/projects/${id}/issues/${iid}` : `/projects/${id}/merge_requests/${iid}`;

export const getDiscussions = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    page: number,
): Promise<Discussion[]> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLab(`${threadBase(kind, id, iid)}/discussions`, apiQuery({per_page: PER_PAGE, page})));

/** 发一条新评论（在 GitLab 里即开一个新讨论） */
export const createDiscussion = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    body: string,
): Promise<Discussion> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`${threadBase(kind, id, iid)}/discussions`, "POST", {body}));

/** 回复某条评论（同一讨论里追加一条） */
export const addDiscussionNote = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    discussionId: string,
    body: string,
): Promise<Note> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`${threadBase(kind, id, iid)}/discussions/${discussionId}`, "POST", {body}));

export const updateDiscussionNote = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    discussionId: string,
    noteId: number,
    body: string,
): Promise<Note> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`${threadBase(kind, id, iid)}/discussions/${discussionId}/notes/${noteId}`, "PUT", {body}));

export const deleteDiscussionNote = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    discussionId: string,
    noteId: number,
): Promise<void> =>
    roamingWrapper(helper, "gitlab", "", async () => {
        await fetchGitLabWrite(`${threadBase(kind, id, iid)}/discussions/${discussionId}/notes/${noteId}`, "DELETE");
    });

/** 解决 / 重新打开整个讨论（GitLab 网页上评论右侧那个 Resolve） */
export const resolveDiscussion = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    discussionId: string,
    resolved: boolean,
): Promise<void> =>
    roamingWrapper(helper, "gitlab", "", async () => {
        await fetchGitLabWrite(
            `${threadBase(kind, id, iid)}/discussions/${discussionId}?resolved=${resolved ? "true" : "false"}`,
            "PUT",
        );
    });

/** 指派（assignee_ids 传空数组表示取消全部指派） */
export const assignTo = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    userIds: number[],
): Promise<void> =>
    roamingWrapper(helper, "gitlab", "", async () => {
        await fetchGitLabWrite(threadBase(kind, id, iid), "PUT", {assignee_ids: userIds});
    });

/* ── 表情回应（award emoji）：议题 / 合并请求 / 二者评论，三条路径同形 ── */

const awardPath = (kind: "issue" | "mr", id: number, iid: number, noteId?: number): string => {
    const base = kind === "issue" ? `/projects/${id}/issues/${iid}` : `/projects/${id}/merge_requests/${iid}`;
    return noteId === undefined ? `${base}/award_emoji` : `${base}/notes/${noteId}/award_emoji`;
};

export const getAwards = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    noteId?: number,
): Promise<Award[]> =>
    roamingWrapper(helper, "gitlab", "", async () => fetchGitLab(awardPath(kind, id, iid, noteId)));

export const addAward = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    name: string,
    noteId?: number,
): Promise<Award> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`${awardPath(kind, id, iid, noteId)}?name=${encodeURIComponent(name)}`, "POST"));

export const removeAward = async (
    helper: InfoHelper,
    kind: "issue" | "mr",
    id: number,
    iid: number,
    awardId: number,
    noteId?: number,
): Promise<void> =>
    roamingWrapper(helper, "gitlab", "", async () => {
        await fetchGitLabWrite(`${awardPath(kind, id, iid, noteId)}/${awardId}`, "DELETE");
    });

/* ── 合并请求：变更、新建、合入 ── */

export const getMergeRequestChanges = async (
    helper: InfoHelper,
    id: number,
    iid: number,
): Promise<MergeRequestChanges> =>
    roamingWrapper(helper, "gitlab", "", async () => fetchGitLab(`/projects/${id}/merge_requests/${iid}/changes`));

export const createMergeRequest = async (
    helper: InfoHelper,
    id: number,
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description: string,
): Promise<MergeRequest> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/merge_requests`, "POST", {
            source_branch: sourceBranch,
            target_branch: targetBranch,
            title,
            description,
        }));

/** 合入（不代删源分支、不改提交信息：这两项留给 GitLab 网页端） */
export const mergeMergeRequest = async (
    helper: InfoHelper,
    id: number,
    iid: number,
): Promise<MergeRequest> =>
    roamingWrapper(helper, "gitlab", "", async () =>
        fetchGitLabWrite(`/projects/${id}/merge_requests/${iid}/merge`, "PUT"));
