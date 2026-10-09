/**
 * 清华 GitLab 集成护栏（源码级断言）。
 *
 * 覆盖四件事，任一处改动导致失效即红：
 * ① 数据层：漫游链的 CSRF 令牌取自 meta[name=csrf-token]、API 路径与写操作用的方法；
 * ② 界面接线：路由（Page / TOP_PAGES）、侧栏入口、App 渲染、深链参数；
 * ③ 原子化：页面原子 + 项目 / Issue / 合并请求三种实体原子（resolve 与搜索都通）；
 * ④ 插件 API：权限声明、门禁命名空间、内置 OH 清单已并入两项权限。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const core = read("packages/info-lib/src/lib/core.ts");
const api = read("packages/info-lib/src/lib/gitlab.ts");
const network = read("packages/info-lib/src/utils/network.ts");
const models = read("packages/info-lib/src/models/gitlab/gitlab.ts");
const index = read("packages/info-lib/src/index.ts");
const pageSrc = read("apps/desktop/src/pages/GitLabPage.tsx");
const state = read("apps/desktop/src/state/gitlab.ts");
const infoLibSrc = read("apps/desktop/src/lib/infoLib.ts");
const app = read("apps/desktop/src/state/app.tsx");
const layout = read("apps/desktop/src/components/Layout.tsx");
const appRoot = read("apps/desktop/src/App.tsx");
const atoms = read("apps/desktop/src/state/atoms.tsx");
const types = read("apps/desktop/src/plugins/types.ts");
const facade = read("apps/desktop/src/plugins/facade.ts");
const loader = read("apps/desktop/src/plugins/loader.ts");
const css = read("apps/desktop/src/styles/global.css");

// 回应选择器的表情表规模（对齐 GitLab 常用表情）
const REACTION_BLOCK = pageSrc.slice(pageSrc.indexOf("const REACTION_NAMES"), pageSrc.indexOf("const REACTION_EMOJI"));
const REACTION_COUNT = { n: [...REACTION_BLOCK.matchAll(/\["[a-z0-9_+-]+", "/g)].length, ok: true };
REACTION_COUNT.ok = REACTION_COUNT.n >= 100;

/* ---------- ① 数据层 ---------- */
// 登录页的 CSRF 值只在 meta 里；input 不带 value（按 input 取会得到 undefined，
// thuid POST 被静默打回登录页——2026-10-07 真机实测）
assert.ok(core.includes('meta[name=csrf-token]'), "gitlab 漫游必须从 meta[name=csrf-token] 取 CSRF 令牌");
assert.ok(core.includes('LoginError("Failed to get gitlab csrf token.")'), "取不到 CSRF 令牌必须在原地抛错");
assert.ok(core.includes('data.includes("/users/auth/thuid")'), "已登录判定必须看 thuid 表单是否存在（sign_out 文本会随版本变）");
// 授权跳转有两种正常落点：统一认证会话仍在时 OAuth 一步过票直接回 GitLab（无 id 表单），
// 否则落到 id 登录页。按「一定要有 id 表单」写会把过票成功误判成失败（2026-10-07 实录）
assert.ok(core.includes("platformFetchWith(GITLAB_AUTH_URL"), "授权跳转必须带落点回执（要区分两种落点）");
assert.ok(/if \(!auth\.text\.includes\("\/users\/auth\/thuid"\)\) \{\s*return auth\.text;/.test(core),
  "过票成功（无 id 表单、也不在登录页）必须按成功返回");
assert.ok(core.includes("GitLab 授权未完成（落到 ${auth.finalUrl}"), "失败信息必须带落点地址，否则无从定位");
// 回调被打回登录页 = 统一认证那枚授权码已被用过（实测同一 sig 下 code 跨轮恒定）：
// 必须当场识别并给可操作的出口，而不是把 401 抛到界面上让人反复重试
assert.ok(core.includes("统一认证返回的授权已被使用，GitLab 拒绝了这次回调"), "必须识别「授权码已被使用」这一形态");
assert.ok(core.includes("platformFetchWith(new URL(action, ID_HOST_URL)") , "确认页那一跳必须带落点回执");
assert.ok(state.includes("export async function gitlabResetAuth") && state.includes("nativeCookieClear()"),
  "必须提供重置统一认证会话的出口（清 id/oauth 域后重走完整登录）");
assert.ok(pageSrc.includes("重置统一认证并重试"), "界面上必须给出这个出口");
// GitLab 会话票跨进程保活：_gitlab_session 是会话 cookie，而本机 cookie 仓是进程内内存，
// 不落盘就每次重启都要重走一遍统一认证换票（老授权卡住时表现为「每次更新都 401」）
assert.ok(infoLibSrc.includes("restoreGitlabSession") && infoLibSrc.includes("rememberGitlabSession"),
  "GitLab 会话票必须落盘并在启动时种回原生仓");
assert.ok(infoLibSrc.includes('"_gitlab_session"') && infoLibSrc.includes("nativeSeedCookies(GITLAB_ORIGIN"),
  "会话票必须按域名取、按域名种");
assert.ok(state.includes("await restoreGitlabSession()"), "首次用到 GitLab 前必须先种回会话票");
// id 单点登录确认页（checkSingle）：id 会话仍在但服务端要求确认续用——
// 2026-10-07 应用内实录的落点就是这个页面（没有 id 密码表单、也不是 GitLab 登录页）
assert.ok(core.includes("form[action*='checkSingle']"), "必须识别 checkSingle 确认页");
assert.ok(/fields\.i_rememberme = "on"/.test(core) && /fields\.fingerGenPrint = helper\.fingerGenPrint/.test(core),
  "确认页必须回传 i_rememberme 与受信指纹（缺了会被判成全新登录而索要二次认证）");
// 字段顺序：页面隐藏字段先收，本项目三个字段后覆盖（反了会被页面里的空值盖掉）
assert.ok(core.indexOf("input[type=hidden]") < core.indexOf('fields.fingerGenPrint = helper.fingerGenPrint'),
  "隐藏字段必须在指纹字段之前合并，否则真值被页面空值覆盖");
// 页面内漫游没有二次认证界面：要验证码时必须当场报错，不许挂着等
assert.ok(!/case "gitlab"[\s\S]*?twoFactorAuth\(helper\)/.test(core.slice(core.indexOf('case "gitlab"'), core.indexOf('case "gitlab"') + 4000)),
  "gitlab 漫游不得调用 twoFactorAuth（无界面可弹，会永久挂起）");
assert.ok(core.includes("请退出登录后重新登录，二次认证时勾选「信任此设备」"), "二次认证必须给可操作的处理指引");

// 端点与写方法的 HTTP 动作
for (const path of [
  "/projects/${id}/issues",
  "/projects/${id}/issues/${iid}",
  "/projects/${id}/issues/${iid}/notes",
  "/projects/${id}/merge_requests",
  "/projects/${id}/merge_requests/${iid}",
  "/projects/${id}/merge_requests/${iid}/notes",
  "/projects/${id}/pipelines",
  "/projects/${id}/pipelines/${pipelineId}/jobs",
  "/projects/${id}/jobs/${jobId}/trace",
  "/user",
]) {
  assert.ok(api.includes(path), `缺少 GitLab 端点：${path}`);
}
assert.ok(api.includes('fetchGitLabWrite(`/projects/${id}/issues`, "POST"'), "新建 Issue 必须是 POST /projects/:id/issues");
assert.ok(api.includes('"PUT", {state_event: state}'), "关闭/重开必须是 PUT + state_event（GitLab 的写法）");
assert.ok(api.includes('fetchGitLabWrite(`/projects/${id}/issues/${iid}/notes`, "POST"'), "Issue 评论必须是 POST notes");
assert.ok(network.includes("uFetchMethod"), "PUT 需要网络层的显式方法请求（原版 uFetch 只发 GET/POST）");
assert.ok(network.includes('"GET" | "POST" | "PUT" | "DELETE"'), "uFetchMethod 必须支持 PUT/DELETE");

// 分页：每页 50，空串与 undefined 不进查询串（stringify 会把它们编成 "undefined"）
// 写操作必须带 CSRF 令牌：会话 cookie 认证下 GitLab 的 RequestForgeryProtection 校验
// X-CSRF-Token，缺了就是 401（2026-10-08 应用内实录：发表评论 401）
assert.ok(api.includes('"X-CSRF-Token": await gitlabCsrfToken(force)'), "写请求必须带 X-CSRF-Token");
assert.ok(api.includes("meta[name=csrf-token]") && api.includes("GITLAB_WEB_BASE_URL}/`"), "CSRF 令牌必须从已登录页面的 meta 取");
assert.ok(/csrfCache = null;\s*return await send\(true\)/.test(api), "写请求被拒时必须换新令牌重试一次");
assert.ok(network.includes("extraHeaders"), "网络层必须支持附加请求头（CSRF 靠它带出去）");

// 评论可编辑：PUT notes/:note_id（GitLab 只允许作者本人改）
assert.ok(api.includes('fetchGitLabWrite(`/projects/${id}/issues/${iid}/notes/${noteId}`, "PUT"'), "Issue 评论改写必须是 PUT notes/:id");
assert.ok(api.includes('fetchGitLabWrite(`/projects/${id}/merge_requests/${iid}/notes/${noteId}`, "PUT"'), "合并请求评论改写必须是 PUT notes/:id");
for (const m of ["updateGitIssueNote", "updateGitMergeRequestNote"]) {
  assert.ok(index.includes(m), `InfoHelper 未挂载：${m}`);
}

// 讨论（thread）：评论线程、回复、编辑、删除、解决、指派
assert.ok(api.includes("`${threadBase(kind, id, iid)}/discussions`"), "讨论列表 / 新建讨论端点缺失");
assert.ok(api.includes("`${threadBase(kind, id, iid)}/discussions/${discussionId}`"), "回复（往讨论里追加评论）端点缺失");
assert.ok(api.includes("`${threadBase(kind, id, iid)}/discussions/${discussionId}/notes/${noteId}`"), "讨论内评论的编辑 / 删除端点缺失");
assert.ok(api.includes('"DELETE"'), "删除评论必须用 DELETE");
assert.ok(api.includes("?resolved=${resolved ? \"true\" : \"false\"}"), "解决 / 重新打开讨论必须带 resolved 参数");
assert.ok(api.includes("{assignee_ids: userIds}"), "指派必须走 PUT issue/merge_request 的 assignee_ids");
for (const m of ["getGitDiscussions", "createGitDiscussion", "addGitDiscussionNote", "updateGitDiscussionNote", "deleteGitDiscussionNote", "resolveGitDiscussion", "assignGitTo"]) {
  assert.ok(index.includes(m), `InfoHelper 未挂载：${m}`);
}
assert.ok(/export interface Discussion \{/.test(models), "缺少讨论模型");
for (const f of ["resolvable", "resolved", "resolved_by"]) {
  assert.ok(models.includes(f), `评论模型缺少字段：${f}`);
}

// 表情回应（award emoji）：议题 / 合并请求 / 评论三条路径
assert.ok(api.includes("/award_emoji") && api.includes("`${base}/notes/${noteId}/award_emoji`"), "表情回应端点缺失（含评论上的）");
assert.ok(api.includes("?name=${encodeURIComponent(name)}"), "贴表情必须带 name 参数");
for (const m of ["getGitAwards", "addGitAward", "removeGitAward"]) {
  assert.ok(index.includes(m), `InfoHelper 未挂载：${m}`);
}

// 合并请求：变更、新建、合入
assert.ok(api.includes("/merge_requests/${iid}/changes"), "合并请求变更端点缺失");
assert.ok(api.includes('fetchGitLabWrite(`/projects/${id}/merge_requests`, "POST"'), "新建合并请求必须是 POST /merge_requests");
assert.ok(api.includes("/merge_requests/${iid}/merge`, \"PUT\""), "合入必须是 PUT /merge_requests/:iid/merge");
for (const m of ["getGitMergeRequestChanges", "createGitMergeRequest", "mergeGitMergeRequest"]) {
  assert.ok(index.includes(m), `InfoHelper 未挂载：${m}`);
}

// 删除类接口成功是 204 空响应体：无条件 JSON.parse 会抛错 → 漫游重试 → 二次删除收到 404
assert.ok(/text\.trim\(\) === "" \? null : JSON\.parse\(text\)/.test(api), "写操作必须容忍 204 空响应体");

assert.ok(api.includes("const PER_PAGE = 50;"), "列表页大小必须是 50");assert.ok(api.includes("value === undefined || value === \"\"") && api.includes("continue;"), "查询串必须过滤空值");
assert.ok(api.includes("throw new GitLabApiError(e instanceof Error ? e.message : String(e))"),
  "GitLab 错误必须带上原始原因（否则界面只能显示空错误）");

// 传输层：GitLab 必须直连——被 webvpn 包装时回调换票落在包装路径上，
// API 侧仍算未登录（2026-10-07 实录：页面报 Unexpected response status code: 401 (version)）
const transport = read("apps/desktop/src/lib/transport.ts");
assert.ok(transport.includes('h !== "git.tsinghua.edu.cn"'), "git.tsinghua.edu.cn 必须在原生直连白名单里");

// 模型字段：界面与插件契约用到的都在
for (const field of ["iid", "state", "user_notes_count", "web_url", "head_pipeline", "source_branch", "target_branch"]) {
  assert.ok(models.includes(field), `GitLab 模型缺少字段：${field}`);
}
assert.ok(/export interface Job \{/.test(models), "缺少作业模型");
assert.ok(/export interface Note \{/.test(models), "缺少评论模型");

// helper 方法挂载（桌面端经 @onethu/info-lib 调用）
for (const m of ["getGitProjectIssues", "getGitIssueNotes", "getGitProjectMergeRequests", "getGitProjectPipelines", "getGitJobTrace", "createGitProjectIssue", "setGitIssueState", "addGitMergeRequestNote"]) {
  assert.ok(index.includes(m), `InfoHelper 未挂载方法：${m}`);
}
assert.ok(index.includes("PipelineStatus as GitPipelineStatus"), "GitLab 模型类型必须从包出口导出");

/* ---------- ② 界面接线 ---------- */
assert.ok(/^\s*\| "gitlab" \/\/ 清华 GitLab/m.test(app), "Page 联合类型缺少 gitlab");
assert.ok(app.includes('"cloud", "gitlab", "thubook"'), "TOP_PAGES 必须含 gitlab（否则侧栏/标题/hash 落兜底）");
for (const param of ["gitlabProject?: number", "gitlabTab?:", "gitlabKind?:", "gitlabIid?: number"]) {
  assert.ok(app.includes(param), `LearnNav 缺少深链参数：${param}`);
}
assert.ok(layout.includes('{ page: "gitlab", label: "GitLab", icon: IconGitLab }'), "侧栏必须有 GitLab 入口");
// 导航注册表（分类 / 搜索 / 底栏用）也要有
assert.ok(read("apps/desktop/src/state/navigation.ts").includes('id: "gitlab"'), "导航注册表必须登记 GitLab");
assert.ok(appRoot.includes('page === "gitlab" && <GitLabPage />'), "App 必须渲染 GitLab 页");
assert.ok(read("apps/desktop/src/components/Icons.tsx").includes("export const IconGitLab"), "缺少 GitLab 图标");

// 页内四件事：代码（含 README 渲染与分支切换）、Issue、合并请求、流水线（含作业日志）
assert.ok(pageSrc.includes("readmeEntry") && pageSrc.includes("<MarkdownBody"), "根目录 README 必须渲染为 Markdown");
assert.ok(pageSrc.includes("gitlabBranches") && pageSrc.includes("gitlab-ref"), "代码页签必须有分支切换");
assert.ok(pageSrc.includes('["pipelines", "流水线"]'), "缺少流水线页签");
assert.ok(pageSrc.includes("gitlabJobTrace") && pageSrc.includes("gitlab-trace"), "作业必须能看日志");
assert.ok(pageSrc.includes("remarkGfm"), "Markdown 渲染必须带 GFM（表格/清单）");
// 正文里的链接必须交给系统浏览器（WebView 内导航会把整个应用带走）
assert.ok(pageSrc.includes("components={{") && pageSrc.includes("openExternal(target)"), "Markdown 链接必须用系统浏览器打开");
assert.ok(pageSrc.includes("new URL(raw, baseUrl ?? PROJECT_URL)"), "相对链接必须按项目地址解析");
// 评论区：讨论线程（回复 / 编辑 / 删除 / 解决重开 / 指派给评论作者）+ 表情回应
assert.ok(pageSrc.includes("function DiscussionThread") && pageSrc.includes("function DiscussionList"), "评论区必须按讨论线程渲染");
assert.ok(pageSrc.includes("gitlabReply") && pageSrc.includes('"回复"'), "评论必须能回复");
assert.ok(pageSrc.includes("gitlabDeleteNote") && pageSrc.includes('"删除"'), "自己的评论必须能删除（并先确认）");
assert.ok(pageSrc.includes("gitlabResolveDiscussion") && pageSrc.includes('"解决讨论"'), "讨论必须能解决 / 重新打开");
assert.ok(pageSrc.includes("gitlabAssign(") && pageSrc.includes("指派给 TA"), "必须能把议题指派给评论作者");
assert.ok(pageSrc.includes("function ReactionBar"), "评论与议题都必须有表情回应条");
// 回应选择器：可筛选、可按名字贴任意 GitLab emoji、点外面 / Esc 收起、切换后本地即时反映
assert.ok(pageSrc.includes('placeholder="按名字筛选，或直接输入 GitLab 表情名"'), "选择器必须有名字筛选");
assert.ok(pageSrc.includes('placeholder="任意表情名，如 dart"') && pageSrc.includes("按名字贴"), "必须能按名字贴任意 GitLab emoji");
assert.ok(pageSrc.includes('document.addEventListener("mousedown"') && pageSrc.includes("Escape"), "选择器必须点外面 / Esc 收起");
// 选择器必须用 portal 挂到 body：线程容器 overflow: hidden，就地弹会被裁成半截（实测）
assert.ok(pageSrc.includes("createPortal(") && pageSrc.includes("popupRef"), "选择器必须用 portal 挂到 body 并单独认自己的点击");
assert.ok(/\.gitlab-emoji-popup \{[^}]*position: fixed;/.test(css), "选择器必须是固定定位（配合 portal）");
// 计数按 award id 去重 + 记录已删除的 id：本地追加与服务端重取到的是同一枚，不去重就翻倍
assert.ok(pageSrc.includes("const seen = new Set<number>()") && pageSrc.includes("removed.includes(a.id)"),
  "回应计数必须按 award id 去重并排除已删除的");
assert.ok(pageSrc.includes("setAdded") && pageSrc.includes("/404|409/"), "切换后必须本地即时反映，且把 404/409 当已生效而不是报错");
assert.ok(REACTION_COUNT.ok, `表情表太小（${REACTION_COUNT.n} 项）——按 GitLab 常用表情对齐时应远多于 8 项`);
// 计数与头像
assert.ok(api.includes('new Map(res.headers.map(([k, v]) => [k.toLowerCase(), v])).get("x-total")'), "条数必须取服务端 x-total");
assert.ok(pageSrc.includes("gitlabRequestCounts") && pageSrc.includes("seg-count"), "状态筛选必须显示条数");
assert.ok(pageSrc.includes("function Avatar") && pageSrc.includes("<Avatar user={item.author} />"), "列表必须显示作者头像");
assert.ok(models.includes("avatar_url"), "用户模型必须带头像地址");
// 项目页：返回入口在左上角；克隆地址与 ZIP 下载走 GitHub 那个 Code 按钮
assert.ok(pageSrc.includes("gitlab-project-head") && pageSrc.includes('className="btn btn-ghost gitlab-back"'),
  "项目页的返回入口必须在左上角");
assert.ok(/\.gitlab-file-head \{[^}]*position: sticky;/.test(css), "文件页的返回入口必须停在左上角（粘顶）");
assert.ok(models.includes("http_url_to_repo") && models.includes("ssh_url_to_repo"), "项目模型必须带两条克隆地址");
assert.ok(pageSrc.includes("function CodeButton") && pageSrc.includes("下载 ZIP"), "项目页必须有 Code 按钮（克隆地址 + ZIP）");
assert.ok(state.includes("export async function gitlabDownloadArchive") && state.includes('invoke<string>("download_file"'),
  "ZIP 归档必须走应用内带会话的下载通道");
assert.ok(!pageSrc.includes("function EmojiPicker") && !pageSrc.includes("setSelectionRange"),
  "往评论正文插字符那版表情入口已按用户要求去掉（表情改为服务端回应）");
// 合并请求：变更、新建、合入
assert.ok(pageSrc.includes("<ChangesView") && pageSrc.includes("gitlab-diff"), "合并请求必须展示文件变更");
assert.ok(pageSrc.includes("gitlabCreateMergeRequest") && pageSrc.includes('openFormModal("新建合并请求"'), "必须能从分支新建合并请求");
assert.ok(pageSrc.includes("gitlabMerge(") && pageSrc.includes("mr.user?.can_merge"), "合入入口必须按服务端给的合并权限显示");
assert.ok(pageSrc.includes('placeholder="写评论（支持 Markdown）"'), "详情页必须有评论输入");
// 写操作：关闭/重开走确认弹窗；新建 Issue 走表单
assert.ok(pageSrc.includes("await confirmOk("), "关闭/重开必须先确认");
assert.ok(pageSrc.includes('openFormModal("新建 Issue"'), "新建 Issue 必须走表单弹窗");
assert.ok(pageSrc.includes('item.state !== "merged"'), "已合入的合并请求不得再给关闭/重开按钮");
// 二进制文件不硬塞进 <pre>
assert.ok(pageSrc.includes("isBinaryPath"), "二进制文件必须给浏览器出口而不是渲染乱码");
// 深链：项目 + 页签 + 实体
assert.ok(pageSrc.includes("navParams?.gitlabProject") && pageSrc.includes("initialIid"), "原子深链未接通");
// 见过的实体进本机缓存（搜索不发明请求）
assert.ok(pageSrc.includes("noteAtomCache"), "GitLab 实体必须写进本机原子缓存");
// 样式齐备（缺类名会让页面裸奔）
for (const cls of [".gitlab-card", ".gitlab-chip", ".gitlab-md", ".gitlab-pre", ".gitlab-trace", ".gitlab-note"]) {
  assert.ok(css.includes(cls), `缺少样式：${cls}`);
}

/* ---------- ③ 原子化 ---------- */
assert.ok(atoms.includes('key: "gitlab", title: "GitLab"'), "缺少 GitLab 页面原子");
for (const kind of ['kind === "gitlab-proj"', 'kind === "gitlab-issue" || kind === "gitlab-mr"']) {
  assert.ok(atoms.includes(kind), `resolveAtom 未处理：${kind}`);
}
assert.ok(atoms.includes('nav("gitlab", { gitlabProject: pid })'), "项目原子必须深链到该项目");
assert.ok(atoms.includes("gitlabIid: iidNum"), "Issue / 合并请求原子必须深链到该条");
for (const cache of ["gitlabProjects", "gitlabIssues", "gitlabMergeRequests"]) {
  assert.ok(atoms.includes(cache + "?"), `原子动态缓存缺少：${cache}`);
  assert.ok(atoms.includes("dyn." + cache), `searchAtoms 未索引：${cache}`);
}
// key 一律走 enc（~ 分隔，含 ~ 的标题会被替换），不手拼
assert.ok(!pageSrc.includes("~~"), "原子 key 必须用 enc(...) 拼，不得手写 ~~");

/* ---------- ④ 插件 API ---------- */
for (const perm of ['| "gitlab:read"', '| "gitlab:write"']) {
  assert.ok(types.includes(perm), `权限联合类型缺少：${perm}`);
}
for (const perm of ['{ id: "gitlab:read"', '{ id: "gitlab:write"']) {
  assert.ok(types.includes(perm), `权限清单（安装确认页）缺少：${perm}`);
}
assert.ok(types.includes("gitlab: {") && types.includes("createIssue(id: number, title: string, description: string)"), "OnethuApi 缺少 gitlab 命名空间");
for (const m of ["projects(", "starred(", "search(", "project(", "branches(", "tree(", "file(", "issues(", "issue(", "issueNotes(", "mergeRequests(", "mergeRequest(", "mergeRequestNotes(", "pipelines(", "jobs(", "jobTrace(", "comment(", "setState("]) {
  assert.ok(types.includes(m), `gitlab 命名空间缺少方法：${m}`);
}
assert.ok(facade.includes('}, perms, "gitlab:read");'), "gitlab 读方法必须挂在 gitlab:read 门禁上");
assert.ok(facade.includes('}, perms, "gitlab:write");'), "gitlab 写方法必须挂在 gitlab:write 门禁上");
assert.ok(facade.includes('gitlab: { ...gitlabRead, ...gitlabWrite }'), "门面未挂 gitlab 命名空间");
// 内置 OH：清单里并入两项权限，老注册表自愈（否则 dock 报未获授权）
assert.ok(loader.includes('"gitlab:read", "gitlab:write"'), "内置 OH 清单必须声明 gitlab 权限");

// 回应选择器的表情表规模（对齐 GitLab 常用表情）

console.log("gitlab-integration-test: 全部断言通过（数据层 / 界面 / 原子 / 插件 API）");
