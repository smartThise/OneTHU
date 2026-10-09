export interface Namespace {
    id: number;
    name: string;
    path: string;
    kind: string;
    full_path: string;
    parent_id: number;
}

export interface User {
    id: number;
    name: string;
    username: string;
    state: string;
    /** 头像地址（GitLab 自托管，公网可达；列表与详情展示用） */
    avatar_url?: string | null;
}

export interface Project {
    id: number;
    description: string;
    name: string;
    name_with_namespace: string;
    path: string;
    path_with_namespace: string;
    created_at: string;
    default_branch: string;
    forks_count: number;
    star_count: number;
    last_activity_at: string;
    web_url: string;
    /** 克隆地址（HTTPS / SSH）：项目页那个 Code 按钮展示的就是这两条 */
    http_url_to_repo: string;
    ssh_url_to_repo: string;
    namespace: Namespace;
}

export interface ProjectDetail extends Project {
    empty_repo: boolean;
    archived: boolean;
    visibility: "private" | "internal" | "public";
    owner: User;
    issues_enabled: boolean;
    merge_requests_enabled: boolean;
    wiki_enabled: boolean;
    jobs_enabled: boolean;
    snippets_enabled: boolean;
    can_create_merge_request_in: boolean;
    open_issues_count: number;
}

export interface File {
    id: string;
    name: string;
    type: "tree" | "blob";
    path: string;
    mode: string;
}

export interface Commit {
    id: string;
    short_id: string;
    created_at: string;
    parent_ids?: string[];
    title: string;
    message: string;
    author_name: string;
    author_email: string;
    authored_date: string;
    committer_name: string;
    committer_email: string;
    committed_date: string;
}

export interface Branch {
    name: string;
    merged: boolean;
    protected: boolean;
    developers_can_push: boolean;
    developers_can_merge: boolean;
    can_push: boolean;
    default: boolean;
    commit: Commit;
}

export interface Issue {
    id: number;
    iid: number;
    project_id: number;
    title: string;
    description: string;
    state: "opened" | "closed";
    created_at: string;
    updated_at: string;
    closed_at: string | null;
    labels: string[];
    user_notes_count: number;
    web_url: string;
    author: User;
    assignees: User[];
}

export interface MergeRequest {
    id: number;
    iid: number;
    project_id: number;
    title: string;
    description: string;
    state: "opened" | "closed" | "merged" | "locked";
    source_branch: string;
    target_branch: string;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    closed_at: string | null;
    draft: boolean;
    has_conflicts: boolean;
    labels: string[];
    user_notes_count: number;
    changes_count?: string;
    /** 服务端就该请求者给出的合并状态与权限（决定界面是否给「合入」入口） */
    detailed_merge_status?: string;
    user?: {can_merge: boolean};
    web_url: string;
    author: User;
    assignees: User[];
    reviewers: User[];
    head_pipeline: Pipeline | null;
}

/** 表情回应（award emoji）：可挂在议题、合并请求或其评论上 */
export interface Award {
    id: number;
    name: string;
    user: User;
    created_at: string;
    updated_at: string;
    awardable_type: string;
    awardable_id: number;
}

/** 变更文件（合并请求的 /changes 返回）：diff 是统一格式的整段文本 */
export interface DiffChange {
    old_path: string;
    new_path: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
    too_large?: boolean;
    diff: string;
}

export interface MergeRequestChanges extends MergeRequest {
    changes: DiffChange[];
}

export interface Note {
    id: number;
    body: string;
    author: User;
    created_at: string;
    updated_at: string;
    /** 系统自动生成的动态（改标签、推提交等），不作为评论呈现 */
    system: boolean;
    /** 可解决（讨论里的评论）；resolved 为当前解决状态 */
    resolvable?: boolean;
    resolved?: boolean;
    resolved_at?: string | null;
    resolved_by?: User | null;
    /** 讨论里的评论类型（null 为普通评论，DiffNote 为代码行评论） */
    type?: string | null;
}

/** 讨论（thread）：GitLab 的评论线程——首条评论 + 若干回复，可整体解决/重新打开 */
export interface Discussion {
    id: string;
    individual_note: boolean;
    notes: Note[];
}

export type PipelineStatus =
    | "created"
    | "waiting_for_resource"
    | "preparing"
    | "pending"
    | "running"
    | "success"
    | "failed"
    | "canceled"
    | "canceling"
    | "skipped"
    | "manual"
    | "scheduled";

export interface Pipeline {
    id: number;
    iid: number;
    project_id: number;
    status: PipelineStatus;
    source: string;
    ref: string;
    sha: string;
    web_url: string;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    finished_at: string | null;
    duration: number | null;
    queued_duration: number | null;
    user: User | null;
}

export interface Job {
    id: number;
    name: string;
    stage: string;
    status: PipelineStatus;
    ref: string;
    allow_failure: boolean;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    duration: number | null;
    web_url: string;
    user: User | null;
}
