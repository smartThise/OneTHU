# 插件 API 完整清单（0.11）

中文 · [English](en/api-surface.md)

> 此表由 `node tools/docs-api-surface.mjs` 从 `OnethuApi` 声明生成。

当前声明包含 **41 个命名空间、297 个方法入口**，含嵌套调用入口。语义、示例与权限模型见 [API 参考](api-reference.md) 和 [插件开发指南](plugin-development.md)。权限列只列出门面中可直接识别的字面量校验；其余方法须结合门面上下文核对，不代表免授权。

接口声明是类型契约；平台能力、当前模式、登录状态和服务端权限仍可能限制实际调用。声明中的复合参数与返回类型按原样保留。

## session

| 调用 | 权限 | 声明 |
|---|---|---|
| `session.status` | `user:read` | `status(): string;` |
| `session.username` | `user:read` | `username(): string &#124; null;` |

## user

| 调用 | 权限 | 声明 |
|---|---|---|
| `user.info` | 见门面实现 | `info(): Promise<import("@onethu/core").BasicUserInfo>;` |

## contacts

| 调用 | 权限 | 声明 |
|---|---|---|
| `contacts.list` | 见门面实现 | `list(query?: string, kind?: "personal" &#124; "organization" &#124; "all"): Promise<unknown>;` |
| `contacts.get` | 见门面实现 | `get(id: string): Promise<unknown>;` |

## organizations

| 调用 | 权限 | 声明 |
|---|---|---|
| `organizations.list` | 见门面实现 | `list(query?: string): Promise<unknown>;` |
| `organizations.get` | 见门面实现 | `get(id: string): Promise<unknown>;` |
| `organizations.create` | 见门面实现 | `create(name: string, brief?: string): Promise<unknown>;` |
| `organizations.update` | 见门面实现 | `update(id: string, patch: { name?: string; brief?: string }): Promise<unknown>;` |
| `organizations.saveProject` | 见门面实现 | `saveProject(id: string, name: string, description: string, status: "planned" &#124; "active" &#124; "done", owner: string, projectId?: string): Promise<unknown>;` |
| `organizations.removeProject` | 见门面实现 | `removeProject(id: string, projectId: string): Promise<unknown>;` |
| `organizations.saveAnnouncement` | 见门面实现 | `saveAnnouncement(id: string, title: string, body: string, pinned?: boolean, announcementId?: string): Promise<unknown>;` |
| `organizations.removeAnnouncement` | 见门面实现 | `removeAnnouncement(id: string, announcementId: string): Promise<unknown>;` |

## xiaoda

| 调用 | 权限 | 声明 |
|---|---|---|
| `xiaoda.status` | 见门面实现 | `status(): Promise<unknown>;` |
| `xiaoda.agents` | 见门面实现 | `agents(): Promise<unknown>;` |
| `xiaoda.models` | 见门面实现 | `models(): Promise<unknown>;` |
| `xiaoda.balance` | 见门面实现 | `balance(): Promise<unknown>;` |
| `xiaoda.conversations` | 见门面实现 | `conversations(page?: number): Promise<unknown>;` |
| `xiaoda.conversation` | 见门面实现 | `conversation(id: string): Promise<unknown>;` |
| `xiaoda.skills` | 见门面实现 | `skills(query?: string, page?: number): Promise<unknown>;` |
| `xiaoda.skill` | 见门面实现 | `skill(id: string): Promise<unknown>;` |
| `xiaoda.installed` | 见门面实现 | `installed(): Promise<unknown>;` |
| `xiaoda.importSkill` | 见门面实现 | `importSkill(id: string): Promise<unknown>;` |
| `xiaoda.enableSkill` | 见门面实现 | `enableSkill(id: string, enabled: boolean): Promise<unknown>;` |
| `xiaoda.removeSkill` | 见门面实现 | `removeSkill(id: string): Promise<unknown>;` |
| `xiaoda.ask` | 见门面实现 | `ask(agentId: string, question: string): Promise<unknown>;` |

## vault

| 调用 | 权限 | 声明 |
|---|---|---|
| `vault.list` | 见门面实现 | `list(): Promise<unknown>;` |
| `vault.items` | 见门面实现 | `items(id: string): Promise<unknown>;` |
| `vault.item` | 见门面实现 | `item(id: string, itemId: string): Promise<unknown>;` |
| `vault.readText` | 见门面实现 | `readText(id: string, itemId: string, offset?: number, maxChars?: number): Promise<unknown>;` |
| `vault.create` | 见门面实现 | `create(name: string): Promise<unknown>;` |
| `vault.rename` | 见门面实现 | `rename(id: string, name: string): Promise<unknown>;` |
| `vault.addText` | 见门面实现 | `addText(id: string, title: string, text: string): Promise<unknown>;` |
| `vault.addAtom` | 见门面实现 | `addAtom(id: string, kind: string, key: string): Promise<unknown>;` |
| `vault.addFile` | 见门面实现 | `addFile(id: string, repoId: string, path: string): Promise<unknown>;` |
| `vault.removeItem` | 见门面实现 | `removeItem(id: string, itemId: string): Promise<unknown>;` |
| `vault.share` | 见门面实现 | `share(id: string): Promise<unknown>;` |
| `vault.importCode` | 见门面实现 | `importCode(code: string): Promise<unknown>;` |

## info

| 调用 | 权限 | 声明 |
|---|---|---|
| `info.schedule` | 见门面实现 | `schedule(startDate: string, endDate: string): Promise<import("@onethu/core").ScheduleEntry[]>;` |
| `info.report` | 见门面实现 | `report(): Promise<import("@onethu/core").ReportRow[]>;` |
| `info.exams` | 见门面实现 | `exams(): Promise<import("@onethu/core").ExamEntry[]>;` |
| `info.deadlines` | 见门面实现 | `deadlines(): Promise<import("@onethu/core").DeadlineItem[]>;` |
| `info.news` | 见门面实现 | `news(page?: number): Promise<import("@onethu/core").NewsItem[]>;` |
| `info.newsDetail` | 见门面实现 | `newsDetail(xxid: string): Promise<import("@onethu/core").NewsDetail>;` |
| `info.searchNews` | 见门面实现 | `searchNews(keyword: string, page?: number): Promise<import("@onethu/core").NewsItem[]>;` |
| `info.newsSub` | 见门面实现 | `newsSub(page?: number, subscriptionId?: string): Promise<import("@onethu/core").NewsItem[]>;` |
| `info.schoolCalendar` | 见门面实现 | `schoolCalendar(): Promise<import("@onethu/core").SchoolCalendarData>;` |
| `info.classroomList` | 见门面实现 | `classroomList(): Promise<import("@onethu/core").Classroom[]>;` |
| `info.classroomState` | 见门面实现 | `classroomState(building: string, week: number): Promise<import("@onethu/core").ClassroomStateResult>;` |
| `info.invoices` | 见门面实现 | `invoices(page: number): Promise<import("@onethu/core").InvoicePage>;` |
| `info.bankPayments` | 见门面实现 | `bankPayments(): Promise<import("@onethu/core").BankPaymentByMonth[]>;` |
| `info.graduateIncome` | 见门面实现 | `graduateIncome(begin: string, end: string): Promise<import("@onethu/core").GraduateIncome[] &#124; null>;` |
| `info.dormScore` | 见门面实现 | `dormScore(): Promise<string &#124; null>;` |
| `info.physicalExam` | 见门面实现 | `physicalExam(): Promise<Array<[string, string]>>;` |
| `info.assessmentList` | 见门面实现 | `assessmentList(): Promise<Array<[string, boolean, string]>>;` |

## learn

| 调用 | 权限 | 声明 |
|---|---|---|
| `learn.semesters` | 见门面实现 | `semesters(): Promise<string[]>;` |
| `learn.courses` | 见门面实现 | `courses(semesterId?: string): Promise<{ semester: string; courses: import("@onethu/core").CourseInfo[] }>;` |
| `learn.homework` | 见门面实现 | `homework(semesterId?: string): Promise<Array<import("@onethu/core").Homework & { courseName: string }>>;` |
| `learn.notifications` | 见门面实现 | `notifications(semesterId?: string): Promise<Array<import("@onethu/core").Notification & { courseName: string }>>;` |
| `learn.files` | 见门面实现 | `files(courseId: string, semesterId?: string): Promise<import("@onethu/core").CourseFile[]>;` |
| `learn.download` | 见门面实现 | `download(fileId: string, filename?: string): Promise<string>;` |
| `learn.reply` | `learn:write` | `reply(wlkcid: string, threadId: string, content: string): Promise<void>;` |
| `learn.post` | `learn:write` | `post(wlkcid: string, bqid: string, title: string, html: string): Promise<void>;` |
| `learn.bbsBoards` | 见门面实现 | `bbsBoards(wlkcid: string): Promise<import("@onethu/core").LearnBbsBoard[]>;` |
| `learn.bbsThreads` | 见门面实现 | `bbsThreads(wlkcid: string, opts?: { bqid?: string; kind?: "yb" &#124; "jh" &#124; "cy"; start?: number; length?: number }): Promise<{ total: number; threads: import("@onethu/core").LearnBbsThreadSummary[] }>;` |
| `learn.bbsThread` | 见门面实现 | `bbsThread(wlkcid: string, threadId: string, bqId?: string): Promise<import("@onethu/core").LearnBbsThreadDetail>;` |
| `learn.bbsPosts` | 见门面实现 | `bbsPosts(wlkcid: string, threadId: string, pageNum: number): Promise<import("@onethu/core").LearnBbsPost[]>;` |

## venue

| 调用 | 权限 | 声明 |
|---|---|---|
| `venue.scenes` | `venue:read` | `scenes(): Promise<import("@onethu/core").VenueScene[]>;` |
| `venue.currentPage` | `venue:read` | `currentPage(params: { sceneUuid: string; reserveDate: string; classTypeUuid?: string; siteType?: string }): Promise<import("@onethu/core").VenueSite[] &#124; null>;` |
| `venue.myRecords` | `venue:read` | `myRecords(page?: number): Promise<import("@onethu/core").VenueRecord[]>;` |
| `venue.cancel` | `venue:book` | `cancel(resvUuid: string): Promise<void>;` |
| `venue.jump` | `venue:read` | `jump(sceneUuid: string): string;` |

## xk

| 调用 | 权限 | 声明 |
|---|---|---|
| `xk.search` | `xk:read` | `search(opts: { kcm?: string; kch?: string; teacher?: string; semester?: string; page?: number }): Promise<import("@onethu/core").XkSearchResult>;` |
| `xk.catalog` | `xk:read` | `catalog(sem?: string): Promise<import("@onethu/core").XkCourse[]>;` |
| `xk.selected` | `xk:read` | `selected(sem?: string): Promise<import("@onethu/core").SelectedCourse[]>;` |
| `xk.detail` | `xk:read` | `detail(teacherId: string, code: string): Promise<import("@onethu/core").XkCourseDetail &#124; null>;` |
| `xk.reviews` | `xk:read` | `reviews(course: string, teacher?: string): Promise<{ course: string; teacher: string; count: number; avg: number; reviews: { count?: number; results: Array<Record<string, unknown>> }; } &#124; null>;` |

## cal

| 调用 | 权限 | 声明 |
|---|---|---|
| `cal.agenda` | `cal:read` | `agenda(startYmd?: string, endYmd?: string): Promise<Array<{ uid: string; title: string; date: string; start: string; end: string; allDay: boolean; location?: string; note?: string; source: "cloud" &#124; "local"; }>>;` |
| `cal.add` | `cal:write` | `add(title: string, dateYmd: string, startHm: string, endHm: string, opts?: { location?: string; note?: string; allDay?: boolean; local?: boolean; }): Promise<{ uid: string; where: "cloud" &#124; "local" }>;` |
| `cal.edit` | `cal:write` | `edit(uid: string, ch: { title?: string; date?: string; start?: string; end?: string; location?: string; note?: string; allDay?: boolean; toCloud?: boolean; }): Promise<{ uid: string; where: "cloud" &#124; "local" }>;` |
| `cal.remove` | `cal:write` | `remove(uid: string): Promise<{ removed: true }>;` |

## mail

| 调用 | 权限 | 声明 |
|---|---|---|
| `mail.list` | 见门面实现 | `list(folder: string, limit: number): Promise<{ total: number; mails: Array<{ uid: number; subject: string; from: string; dateMs: number; seen: boolean }>; }>;` |
| `mail.read` | 见门面实现 | `read(folder: string, uid: number): Promise<{ subject: string; from: string; to: string; dateMs: number; text: string; html: string &#124; null; }>;` |
| `mail.search` | 见门面实现 | `search(folder: string, query: string): Promise<Array<{ uid: number; subject: string; from: string; dateMs: number; seen: boolean }>>;` |
| `mail.send` | 见门面实现 | `send(to: string, cc: string, subject: string, body: string): Promise<{ sent: true }>;` |

## cloud

| 调用 | 权限 | 声明 |
|---|---|---|
| `cloud.repos` | 见门面实现 | `repos(): Promise<Array<{ id: string; name: string; mtime: number; size: number }>>;` |
| `cloud.list` | 见门面实现 | `list(repoId: string, path: string): Promise<Array<{ name: string; kind: "dir" &#124; "file"; size: number; mtime: number }>>;` |
| `cloud.search` | 见门面实现 | `search(repoId: string, query: string): Promise<Array<{ name: string; kind: "dir" &#124; "file"; size: number; mtime: number }>>;` |
| `cloud.download` | 见门面实现 | `download(repoId: string, path: string): Promise<string>;` |
| `cloud.upload` | 见门面实现 | `upload(repoId: string, parentDir: string, localPath: string, replace: boolean): Promise<{ size: number }>;` |
| `cloud.share` | 见门面实现 | `share(repoId: string, path: string, expireDays: number): Promise<{ link: string; token: string }>;` |

## memory

| 调用 | 权限 | 声明 |
|---|---|---|
| `memory.search` | 见门面实现 | `search(q: { query?: string; tags?: string[]; type?: string; folder?: string; limit?: number }): Promise<Array<{ permalink: string; title: string; type: string; tags: string[]; path: string; modified: string; score: number; snippet: string; via?: string; }>>;` |
| `memory.read` | 见门面实现 | `read(permalink: string): Promise<string>;` |
| `memory.list` | 见门面实现 | `list(opts?: { folder?: string; tag?: string }): Promise<Array<{ permalink: string; title: string; type: string; folder: string; tags: string[]; modified: string; }>>;` |
| `memory.refresh` | 见门面实现 | `refresh(): Promise<{ count: number }>;` |
| `memory.ready` | 见门面实现 | `ready(): Promise<boolean>;` |
| `memory.write` | 见门面实现 | `write(input: { title: string; observations: Array<{ category: string; text: string; context?: string }>; relations?: Array<{ rel: string; target: string; context?: string }>; tags?: string[]; type?: string; folder?: string; origin?: string; }): Promise<{ permalink: string; path: string }>;` |
| `memory.append` | 见门面实现 | `append(permalink: string, category: string, text: string, context?: string): Promise<{ ok: true }>;` |
| `memory.edit` | 见门面实现 | `edit(permalink: string, find: string, replace: string): Promise<{ ok: true }>;` |
| `memory.delete` | 见门面实现 | `delete(permalink: string, reason?: string): Promise<{ trashedTo: string }>;` |

## ext

| 调用 | 权限 | 声明 |
|---|---|---|
| `ext.skillSearch` | `ui` | `skillSearch(query?: string): Promise<unknown>;` |
| `ext.skillCompute` | `ui` | `skillCompute(code: string, input: unknown): Promise<unknown>;` |
| `ext.skillRun` | `ui` | `skillRun(id: string, path: string, input: unknown): Promise<unknown>;` |
| `ext.skillLoad` | `ui` | `skillLoad(id: string): Promise<unknown>;` |
| `ext.skillReadFile` | `ui` | `skillReadFile(id: string, path: string): Promise<unknown>;` |
| `ext.toolCreate` | `ui` | `toolCreate(name: string, description: string, steps: unknown): void;` |
| `ext.toolList` | 见门面实现 | `toolList(): Array<{ id: string; name: string; description: string }>;` |
| `ext.toolRun` | 见门面实现 | `toolRun(id: string): Promise<{ ok: boolean; error?: string }>;` |
| `ext.toolDelete` | 见门面实现 | `toolDelete(id: string): void;` |
| `ext.flowCreate` | `ui` | `flowCreate(name: string, trigger: unknown, steps: unknown): { id: string };` |
| `ext.flowList` | 见门面实现 | `flowList(): Array<{ id: string; name: string; trigger: unknown; enabled: boolean; lastRun?: number; lastOk?: boolean; lastError?: string }>;` |
| `ext.flowRun` | `ui` | `flowRun(id: string): Promise<{ ok: boolean; error?: string }>;` |
| `ext.flowUpdate` | `ui` | `flowUpdate(id: string, patch: { name?: string; trigger?: unknown; steps?: unknown; enabled?: boolean }): { ok: boolean };` |
| `ext.flowSetEnabled` | `ui` | `flowSetEnabled(id: string, on: boolean): { ok: boolean };` |
| `ext.flowDelete` | `ui` | `flowDelete(id: string): void;` |
| `ext.widgetCreate` | `ui` | `widgetCreate(name: string, html: string, x?: number, y?: number): { id: string };` |
| `ext.widgetList` | 见门面实现 | `widgetList(): Array<{ id: string; name: string; createdAt: number }>;` |
| `ext.widgetDelete` | `ui` | `widgetDelete(id: string): void;` |
| `ext.onePageCreate` | `ui` | `onePageCreate(name: string, icon?: string): { id: string };` |
| `ext.onePageList` | 见门面实现 | `onePageList(): Array<{ id: string; name: string; kind: string; icon: string }>;` |
| `ext.onePageDelete` | `ui` | `onePageDelete(id: string): { ok: boolean; reason?: string };` |
| `ext.onePageRename` | `ui` | `onePageRename(id: string, name: string): void;` |
| `ext.onePageSetIcon` | `ui` | `onePageSetIcon(id: string, icon: string): { ok: boolean };` |
| `ext.onePageOpen` | `ui` | `onePageOpen(id: string): void;` |
| `ext.onePageItems` | `ui` | `onePageItems(boardId: string): Array<{ id: string; kind: string; text?: string; x: number; y: number; w: number; h: number }>;` |
| `ext.onePageAddItem` | 见门面实现 | `onePageAddItem(boardId: string, kind: string, payload: unknown, x: number, y: number, w?: number, h?: number): Promise<{ id: string }>;` |
| `ext.onePageMoveItem` | `ui` | `onePageMoveItem(boardId: string, itemId: string, x: number, y: number): void;` |
| `ext.onePageRemoveItem` | `ui` | `onePageRemoveItem(boardId: string, itemId: string): void;` |
| `ext.onePageAddAtom` | `ui` | `onePageAddAtom(target: { to?: string; boardId?: string } &#124; null, atomKey: string): { ok: boolean; boardId: string; added?: string; reason?: string };` |
| `ext.homeDock.set` | 见门面实现 | `set(pageId?: string, on?: boolean): { ok: boolean; pageId: string; label: string; docked: string[]; dockable: string[]; entries: Array<{ page: string; label: string; plugin: boolean }>; };` |
| `ext.workspaceList` | 见门面实现 | `workspaceList(): Array<{ id: string; name: string; live: boolean; tabs: number }>;` |
| `ext.workspaceCreate` | `ui` | `workspaceCreate(name: string, tabIds?: unknown): { id: string };` |
| `ext.workspaceOpen` | `ui` | `workspaceOpen(id: string): boolean;` |
| `ext.workspaceCollapse` | `ui` | `workspaceCollapse(id: string): boolean;` |
| `ext.workspaceClose` | `ui` | `workspaceClose(id: string): boolean;` |
| `ext.workspaceDissolve` | `ui` | `workspaceDissolve(id: string): boolean;` |
| `ext.workspaceDelete` | `ui` | `workspaceDelete(id: string): boolean;` |
| `ext.tabList` | 见门面实现 | `tabList(): Array<{ id: string; title: string; page: string }>;` |
| `ext.tabOpen` | `ui` | `tabOpen(page: string): { id: string };` |
| `ext.tabClose` | `ui` | `tabClose(id: string): boolean;` |
| `ext.tabDuplicate` | `ui` | `tabDuplicate(id: string): { id: string };` |
| `ext.tabFocus` | `ui` | `tabFocus(id: string): boolean;` |
| `ext.wallpaperSet` | `ui` | `wallpaperSet(scope: string, ref: string &#124; null): void;` |
| `ext.wallpaperGet` | `ui` | `wallpaperGet(): { global: string &#124; null };` |
| `ext.voiceSet` | `ui` | `voiceSet(patch: unknown): { autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: string };` |
| `ext.voiceGet` | `ui` | `voiceGet(): { autoSpeak: boolean; voiceName: string; pitch: number; rate: number; backend: string };` |
| `ext.prefSet` | `ui` | `prefSet(patch: unknown): void;` |
| `ext.prefGet` | `ui` | `prefGet(): { capsuleTap: string; voiceTarget: string };` |
| `ext.themeScheduleSet` | `ui` | `themeScheduleSet(opts: unknown): { followSystem: boolean; dayThemeId: string &#124; null; nightThemeId: string &#124; null };` |
| `ext.notifySet` | `ui` | `notifySet(patch: unknown): unknown;` |
| `ext.notifyGet` | `ui` | `notifyGet(): unknown;` |
| `ext.hwTimelineSet` | `ui` | `hwTimelineSet(minutes: number): { minutes: number };` |
| `ext.hwReminderSet` | `ui` | `hwReminderSet(id: string, minutes: number &#124; null): void;` |
| `ext.eventAdd` | `ui` | `eventAdd(ev: unknown): Promise<{ uid: string }>;` |
| `ext.eventDelete` | `ui` | `eventDelete(uid: string): Promise<void>;` |
| `ext.eventList` | `ui` | `eventList(): Array<{ uid: string; summary: string; start: number; end: number; allDay?: boolean }>;` |
| `ext.pluginInstalledList` | `plugins:call` | `pluginInstalledList(): Promise<Array<{ id: string; name: string; enabled: boolean }>>;` |
| `ext.pluginInstallFromRepo` | `plugins:call` | `pluginInstallFromRepo(repo: string, entry?: string): Promise<{ id: string; name: string }>;` |
| `ext.pluginEnableToggle` | `plugins:call` | `pluginEnableToggle(id: string, on: boolean): Promise<void>;` |
| `ext.pluginUninstall` | `plugins:call` | `pluginUninstall(id: string): Promise<void>;` |
| `ext.themeApply` | `ui` | `themeApply(name: string, vars: unknown): { id: string };` |
| `ext.themeList` | 见门面实现 | `themeList(): Array<{ id: string; name: string; active: boolean }>;` |
| `ext.themeActivate` | 见门面实现 | `themeActivate(id: string &#124; null): void;` |
| `ext.themeDelete` | 见门面实现 | `themeDelete(id: string): void;` |
| `ext.phoneWidgetSet` | `ui` | `phoneWidgetSet(title: string, rows: unknown): { ok: boolean; rows: number };` |

## kongjian

| 调用 | 权限 | 声明 |
|---|---|---|
| `kongjian.page` | `dorm:read` | `page(opts?: { spaceId?: string; roomId?: string; date?: string }): Promise<import("@onethu/core").KongjianPage>;` |
| `kongjian.my` | `dorm:read` | `my(): Promise<import("@onethu/core").KongjianRecord[]>;` |
| `kongjian.book` | `kongjian:book` | `book(bookUrl: string, info_: { name: string; sid: string; tel: string; other: string }): Promise<string>;` |
| `kongjian.cancel` | `kongjian:book` | `cancel(target: string): Promise<void>;` |

## visit

| 调用 | 权限 | 声明 |
|---|---|---|
| `visit.fill` | `nav` | `fill(patch: Record<string, unknown>, opts?: { open?: boolean }): { ok: boolean; opened: boolean; filled: string[] };` |

## gitlab

| 调用 | 权限 | 声明 |
|---|---|---|
| `gitlab.projects` | 见门面实现 | `projects(page?: number): Promise<import("@onethu/info-lib").GitProject[]>;` |
| `gitlab.starred` | 见门面实现 | `starred(page?: number): Promise<import("@onethu/info-lib").GitProject[]>;` |
| `gitlab.search` | 见门面实现 | `search(search: string, page?: number): Promise<import("@onethu/info-lib").GitProject[]>;` |
| `gitlab.project` | 见门面实现 | `project(id: number): Promise<import("@onethu/info-lib").GitProjectDetail>;` |
| `gitlab.branches` | 见门面实现 | `branches(id: number): Promise<import("@onethu/info-lib").GitBranch[]>;` |
| `gitlab.tree` | 见门面实现 | `tree(id: number, path: string, ref: string, page?: number): Promise<import("@onethu/info-lib").GitFile[]>;` |
| `gitlab.file` | 见门面实现 | `file(id: number, sha: string): Promise<string>;` |
| `gitlab.issues` | 见门面实现 | `issues(id: number, opts?: { state?: "opened" &#124; "closed" &#124; "all"; search?: string; page?: number }): Promise<import("@onethu/info-lib").GitIssue[]>;` |
| `gitlab.issue` | 见门面实现 | `issue(id: number, iid: number): Promise<import("@onethu/info-lib").GitIssue>;` |
| `gitlab.issueNotes` | 见门面实现 | `issueNotes(id: number, iid: number): Promise<import("@onethu/info-lib").GitNote[]>;` |
| `gitlab.mergeRequests` | 见门面实现 | `mergeRequests(id: number, opts?: { state?: "opened" &#124; "closed" &#124; "all"; search?: string; page?: number }): Promise<import("@onethu/info-lib").GitMergeRequest[]>;` |
| `gitlab.mergeRequest` | 见门面实现 | `mergeRequest(id: number, iid: number): Promise<import("@onethu/info-lib").GitMergeRequest>;` |
| `gitlab.mergeRequestNotes` | 见门面实现 | `mergeRequestNotes(id: number, iid: number): Promise<import("@onethu/info-lib").GitNote[]>;` |
| `gitlab.pipelines` | 见门面实现 | `pipelines(id: number, opts?: { ref?: string; page?: number }): Promise<import("@onethu/info-lib").GitPipeline[]>;` |
| `gitlab.jobs` | 见门面实现 | `jobs(id: number, pipelineId: number): Promise<import("@onethu/info-lib").GitJob[]>;` |
| `gitlab.jobTrace` | 见门面实现 | `jobTrace(id: number, jobId: number): Promise<string>;` |
| `gitlab.createIssue` | 见门面实现 | `createIssue(id: number, title: string, description: string): Promise<import("@onethu/info-lib").GitIssue>;` |
| `gitlab.comment` | 见门面实现 | `comment(kind: "issue" &#124; "mr", id: number, iid: number, body: string): Promise<import("@onethu/info-lib").GitNote>;` |
| `gitlab.updateComment` | 见门面实现 | `updateComment(kind: "issue" &#124; "mr", id: number, iid: number, noteId: number, body: string): Promise<import("@onethu/info-lib").GitNote>;` |
| `gitlab.discussions` | 见门面实现 | `discussions(kind: "issue" &#124; "mr", id: number, iid: number, page?: number): Promise<import("@onethu/info-lib").GitDiscussion[]>;` |
| `gitlab.reply` | 见门面实现 | `reply(kind: "issue" &#124; "mr", id: number, iid: number, discussionId: string, body: string): Promise<import("@onethu/info-lib").GitNote>;` |
| `gitlab.deleteComment` | 见门面实现 | `deleteComment(kind: "issue" &#124; "mr", id: number, iid: number, discussionId: string, noteId: number): Promise<void>;` |
| `gitlab.resolveDiscussion` | 见门面实现 | `resolveDiscussion(kind: "issue" &#124; "mr", id: number, iid: number, discussionId: string, resolved: boolean): Promise<void>;` |
| `gitlab.assignees` | 见门面实现 | `assignees(kind: "issue" &#124; "mr", id: number, iid: number, userIds: number[]): Promise<void>;` |
| `gitlab.requestCounts` | 见门面实现 | `requestCounts(kind: "issue" &#124; "mr", id: number): Promise<{ opened: number; closed: number; all: number }>;` |
| `gitlab.awards` | 见门面实现 | `awards(kind: "issue" &#124; "mr", id: number, iid: number, noteId?: number): Promise<import("@onethu/info-lib").GitAward[]>;` |
| `gitlab.react` | 见门面实现 | `react(kind: "issue" &#124; "mr", id: number, iid: number, name: string, noteId?: number): Promise<import("@onethu/info-lib").GitAward>;` |
| `gitlab.unreact` | 见门面实现 | `unreact(kind: "issue" &#124; "mr", id: number, iid: number, awardId: number, noteId?: number): Promise<void>;` |
| `gitlab.mergeRequestChanges` | 见门面实现 | `mergeRequestChanges(id: number, iid: number): Promise<import("@onethu/info-lib").GitMergeRequestChanges>;` |
| `gitlab.createMergeRequest` | 见门面实现 | `createMergeRequest(id: number, sourceBranch: string, targetBranch: string, title: string, description: string): Promise<import("@onethu/info-lib").GitMergeRequest>;` |
| `gitlab.mergeMergeRequest` | 见门面实现 | `mergeMergeRequest(id: number, iid: number): Promise<import("@onethu/info-lib").GitMergeRequest>;` |
| `gitlab.setState` | 见门面实现 | `setState(kind: "issue" &#124; "mr", id: number, iid: number, state: "close" &#124; "reopen"): Promise<void>;` |

## coursex

| 调用 | 权限 | 声明 |
|---|---|---|
| `coursex.semesters` | 见门面实现 | `semesters(): Promise<import("@onethu/core").CourseXSemester[]>;` |
| `coursex.search` | 见门面实现 | `search(q: string, semester?: string): Promise<import("@onethu/core").CourseXSummary[]>;` |
| `coursex.detail` | 见门面实现 | `detail(id: string): Promise<import("@onethu/core").CourseXDetail &#124; { id: string; error: string } &#124; null>;` |

## card

| 调用 | 权限 | 声明 |
|---|---|---|
| `card.info` | 见门面实现 | `info(): Promise<import("@onethu/core").CardInfo>;` |
| `card.transactions` | 见门面实现 | `transactions(start: string, end: string): Promise<import("@onethu/core").CardTransaction[]>;` |

## dorm

| 调用 | 权限 | 声明 |
|---|---|---|
| `dorm.eleRemainder` | 见门面实现 | `eleRemainder(): Promise<import("@onethu/core").EleRemainder>;` |
| `dorm.elePayRecord` | 见门面实现 | `elePayRecord(): Promise<import("@onethu/core").ElePayRecord[]>;` |

## library

| 调用 | 权限 | 声明 |
|---|---|---|
| `library.list` | 见门面实现 | `list(): Promise<import("@onethu/core").Library[]>;` |
| `library.floors` | 见门面实现 | `floors(libraryId: number, dateChoice?: 0 &#124; 1): Promise<import("@onethu/core").LibraryFloor[]>;` |
| `library.sections` | 见门面实现 | `sections(floor: { id: number; zhNameTrace: string }, dateChoice?: 0 &#124; 1): Promise<import("@onethu/core").LibrarySection[]>;` |
| `library.seats` | 见门面实现 | `seats(section: { id: number; zhNameTrace: string }, dateChoice?: 0 &#124; 1): Promise<import("@onethu/core").LibrarySeat[]>;` |
| `library.records` | 见门面实现 | `records(): Promise<import("@onethu/core").LibBookRecord[]>;` |
| `library.book` | 见门面实现 | `book(seat: { id: number; type?: string }, sectionId: number, dateChoice?: 0 &#124; 1): Promise<{ status?: number; msg?: string }>;` |
| `library.cancel` | 见门面实现 | `cancel(recordId: string): Promise<void>;` |

## libroom

| 调用 | 权限 | 声明 |
|---|---|---|
| `libroom.list` | 见门面实现 | `list(): Promise<import("@onethu/core").LibRoomInfo[]>;` |
| `libroom.resources` | 见门面实现 | `resources(date: string, kindId: number): Promise<import("@onethu/core").LibRoomRes[]>;` |
| `libroom.records` | 见门面实现 | `records(): Promise<import("@onethu/core").LibRoomBookRecord[]>;` |
| `libroom.book` | 见门面实现 | `book(roomRes: import("@onethu/core").LibRoomRes, start: string, end: string, memberAccNos?: number[]): Promise<void>;` |
| `libroom.cancel` | 见门面实现 | `cancel(uuid: string): Promise<void>;` |
| `libroom.fuzzyMember` | 见门面实现 | `fuzzyMember(keyword: string): Promise<import("@onethu/core").LibFuzzySearchResult[]>;` |

## network

| 调用 | 权限 | 声明 |
|---|---|---|
| `network.balance` | 见门面实现 | `balance(): Promise<import("@onethu/core").NetworkBalance>;` |
| `network.devices` | 见门面实现 | `devices(): Promise<import("@onethu/core").NetworkDevice[]>;` |
| `network.deviceCount` | 见门面实现 | `deviceCount(): Promise<number>;` |
| `network.accountInfo` | 见门面实现 | `accountInfo(): Promise<import("@onethu/core").NetworkAccountInfo>;` |

## nav

| 调用 | 权限 | 声明 |
|---|---|---|
| `nav.go` | `nav` | `go(page: string, params?: Record<string, unknown>): boolean;` |
| `nav.searchAtoms` | `nav` | `searchAtoms(query: string, limit?: number): Promise<Array<{ kind: string; key: string; title: string; sub?: string; group: string }>>;` |
| `nav.searchRow` | `nav` | `searchRow(ref: { routeId?: string; query?: string }): Promise<{ ok: boolean; id?: string; title?: string; breadcrumb?: string[]; landedOn?: string; note?: string; reason?: string; candidates?: Array<{ id: string; title: string }> }>;` |
| `nav.routeTable` | `nav` | `routeTable(): Promise<Array<{ id: string; title: string; desc: string; aliases: string[]; breadcrumb: string[]; kind: string; tier: string; view: string; tab: string; section: string; note: string }>>;` |
| `nav.openAtom` | `nav` | `openAtom(ref: { kind: string; key: string }): Promise<boolean>;` |
| `nav.usage` | `nav` | `usage(limit?: number): Promise<{ total: number; kinds: number; top: Array<{ kind: string; key: string; title: string; group: string; n: number; last: number }>; recent: Array<{ kind: string; key: string; title: string; n: number; last: number }>; }>;` |
| `nav.clearUsage` | `nav` | `clearUsage(): Promise<void>;` |

## ui

| 调用 | 权限 | 声明 |
|---|---|---|
| `ui.toast` | `ui` | `toast(text: string): void;` |
| `ui.confirm` | `ui` | `confirm( msg: string, opts?: { danger?: boolean; title?: string; confirmText?: string }, ): Promise<boolean>;` |
| `ui.form` | `ui` | `form(title: string, fields: Array<{ key: string; label: string; kind?: "text" &#124; "textarea" &#124; "password" &#124; "select"; placeholder?: string; default?: string; required?: boolean; options?: Array<{ value: string; label: string }>; }>): Promise<Record<string, string> &#124; null>;` |
| `ui.webModal` | `webview` | `webModal(url: string): Promise<void>;` |
| `ui.clipboard.write` | `ui` | `write(text: string): Promise<void>;` |
| `ui.clipboard.read` | `clipboard:read` | `read(): Promise<string>;` |
| `ui.getTabRoot` | `ui` | `getTabRoot(pageKey: string): HTMLElement &#124; null;` |
| `ui.onTabReady` | `ui` | `onTabReady(pageKey: string, cb: (root: HTMLElement) => void): () => void;` |

## favorites

| 调用 | 权限 | 声明 |
|---|---|---|
| `favorites.add` | `ui` | `add(key: string, folderId?: string): void;` |
| `favorites.list` | `ui` | `list(): Array<{ folderId: string; folderTitle: string; key: string }>;` |
| `favorites.addAtom` | `ui` | `addAtom(ref: { kind: string; key: string }, meta?: { title: string; sub?: string; group?: string; iconSvg?: string }, folderId?: string): void;` |
| `favorites.kinds` | `ui` | `kinds(): Array<{ kind: string; group: string; source: "registered" &#124; "static" }>;` |

## services

| 调用 | 权限 | 声明 |
|---|---|---|
| `services.search` | `info:read` | `search(query: string, limit?: number): Promise<Array<{ id: string; name: string; department?: string; url: string; score: number }>>;` |
| `services.open` | `info:read` | `open(service: { id?: string; name?: string; url?: string }): Promise<boolean>;` |

## notify

| 调用 | 权限 | 声明 |
|---|---|---|
| `notify.send` | `notify` | `send(opts: { title: string; body?: string; afterSeconds?: number; key?: string; page?: string }): Promise<{ ok: boolean; id: string; reason?: string; }>;` |
| `notify.cancel` | `notify` | `cancel(key: string): Promise<boolean>;` |
| `notify.status` | `notify` | `status(request?: boolean): Promise<{ ok: boolean; backend: string; granted: boolean; exact: boolean; reason?: string }>;` |

## widget

| 调用 | 权限 | 声明 |
|---|---|---|
| `widget.list` | `widget` | `list(): Array<{ id: string; title: string; slot: string &#124; null }>;` |
| `widget.slots` | `widget` | `slots(): number;` |
| `widget.instances` | `widget` | `instances(): Promise<Array<{ id: string; shape: string; binding: unknown }>>;` |
| `widget.getFallback` | `widget` | `getFallback(): Promise<unknown>;` |
| `widget.setFallback` | `widget` | `setFallback(binding: { kind: "today" } &#124; { kind: "folder"; folderId: string } &#124; { kind: "detail" &#124; "shortcut"; atom: { kind: string; key: string } } &#124; null): Promise<boolean>;` |
| `widget.bind` | `widget` | `bind(id: string, binding: { kind: "today" } &#124; { kind: "folder"; folderId: string } &#124; { kind: "detail" &#124; "shortcut"; atom: { kind: string; key: string } } &#124; null): Promise<boolean>;` |
| `widget.unbind` | `widget` | `unbind(id: string): Promise<boolean>;` |

## storage

| 调用 | 权限 | 声明 |
|---|---|---|
| `storage.get` | `storage` | `get<T = string>(key: string): T &#124; null;` |
| `storage.set` | `storage` | `set<T = string>(key: string, value: T): void;` |
| `storage.keys` | `storage` | `keys(): string[];` |
| `storage.remove` | `storage` | `remove(key: string): void;` |

## settings

| 调用 | 权限 | 声明 |
|---|---|---|
| `settings.get` | `storage` | `get(): Record<string, string>;` |

## net

| 调用 | 权限 | 声明 |
|---|---|---|
| `net.fetch` | 见门面实现 | `fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>;` |

## ws

| 调用 | 权限 | 声明 |
|---|---|---|
| `ws.open` | 见门面实现 | `open(url: string, opts?: { headers?: Record<string, string>; connectTimeoutMs?: number }): Promise<string>;` |
| `ws.send` | `ws:external` | `send(session: string, data: string, encoding?: "text" &#124; "b64"): Promise<void>;` |
| `ws.recv` | `ws:external` | `recv(session: string, timeoutMs?: number): Promise<{ kind: "text" &#124; "binary" &#124; "closed"; text?: string; b64?: string } &#124; null>;` |
| `ws.close` | `ws:external` | `close(session: string): Promise<void>;` |
| `ws.closeAll` | `ws:external` | `closeAll(): Promise<void>;` |

## plugins

| 调用 | 权限 | 声明 |
|---|---|---|
| `plugins.list` | `plugins:call` | `list(): Promise<Array<{ pluginId: string; pluginName: string; commands: Array<{ id: string; title: string; inputLabel?: string }> }>>;` |
| `plugins.call` | `plugins:call` | `call(pluginId: string, cmdId: string, input?: string): Promise<unknown>;` |

## browser

| 调用 | 权限 | 声明 |
|---|---|---|
| `browser.probe` | `ui` | `probe(): Promise<unknown>;` |
| `browser.launch` | `ui` | `launch(mode: string): Promise<unknown>;` |
| `browser.navigate` | `ui` | `navigate(url: string): Promise<void>;` |
| `browser.eval` | `ui` | `eval(js: string): Promise<unknown>;` |
| `browser.snapshot` | `ui` | `snapshot(): Promise<unknown>;` |
| `browser.close` | `ui` | `close(): Promise<unknown>;` |

## ts

| 调用 | 权限 | 声明 |
|---|---|---|
| `ts.status` | `tsinghua:sdk` | `status(): Promise<"ready" &#124; "expired" &#124; "logged-out">;` |
| `ts.ensure` | `tsinghua:sdk` | `ensure(): Promise<void>;` |
| `ts.username` | `tsinghua:sdk` | `username(): Promise<string &#124; null>;` |
| `ts.client` | `tsinghua:sdk` | `client(opts?: { mode?: "auto" &#124; "webvpn" &#124; "direct" }): { fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<Response>; resolve(url: string): string; };` |

## llm

| 调用 | 权限 | 声明 |
|---|---|---|
| `llm.chat` | `llm` | `chat(input: string): Promise<{ text: string; model: string; provider: string }>;` |
| `llm.provider` | `llm` | `provider(): Promise<string>;` |

## theme

| 调用 | 权限 | 声明 |
|---|---|---|
| `theme.list` | `theme` | `list(): Promise<Array<{ id: string; name: string; version: string; dark: boolean }>>;` |
| `theme.active` | 见门面实现 | `active(): Promise<string &#124; null>;` |
| `theme.apply` | `theme` | `apply(id: string &#124; null): Promise<void>;` |
| `theme.schedule` | 见门面实现 | `schedule(): Promise<{ followSystem: boolean; dayThemeId: string &#124; null; nightThemeId: string &#124; null; systemDark: boolean }>;` |
| `theme.setFollowSystem` | 见门面实现 | `setFollowSystem(on: boolean): Promise<void>;` |
| `theme.setDayNight` | 见门面实现 | `setDayNight(dayId: string &#124; null, nightId: string &#124; null): Promise<void>;` |

## yuketang

| 调用 | 权限 | 声明 |
|---|---|---|
| `yuketang.status` | `exthw:read` | `status(): Promise<unknown>;` |
| `yuketang.courses` | `exthw:read` | `courses(): Promise<unknown>;` |
| `yuketang.contents` | `exthw:read` | `contents(classroomId?: string): Promise<unknown>;` |
| `yuketang.homework` | `exthw:read` | `homework(classroomId?: string, days?: number): Promise<unknown>;` |
| `yuketang.homeworkDetail` | `exthw:read` | `homeworkDetail(classroomId: string, leafTypeId: string): Promise<unknown>;` |
| `yuketang.leafDetail` | `exthw:read` | `leafDetail(classroomId: string, leafId: string): Promise<unknown>;` |
| `yuketang.noticeDetail` | `exthw:read` | `noticeDetail(classroomId: string, noticeIds: string[]): Promise<unknown>;` |

## exthw

| 调用 | 权限 | 声明 |
|---|---|---|
| `exthw.snapshot` | `exthw:read` | `snapshot(): Promise<{ items: Array<{ source: string; course: string; title: string; deadline: string &#124; null; url: string &#124; null; submitted: boolean; graded: boolean; score: number &#124; null }>; errors: Record<string, string>; state: string; lastAt: number; configured: boolean; }>;` |
| `exthw.refresh` | `exthw:refresh` | `refresh(): Promise<void>;` |
