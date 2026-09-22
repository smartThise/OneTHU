# `onethu.*` API 参考

> 最后更新：2026-09-22 22:59

本文档描述插件可用的全部接口。每个命名空间对应一类校园业务系统或应用能力。

**调用形式**

- JS 插件：`ctx.onethu.<namespace>.<method>(...)`
- Rust 插件：`onethu.call { ns, method, args }`，`args` 按位置传递

**接口真源**：`apps/desktop/src/plugins/types.ts`（API 面）、`apps/desktop/src/plugins/facade.ts`（实现与门禁）。

## 0. 通用约定

**异步性**：除 `session.*`、`ui.toast`、`ui.getTabRoot`、`ui.onTabReady`、
`favorites.add` / `favorites.addAtom` / `favorites.kinds`、`storage.*`、`nav.go` 外均为
异步方法，返回 `Promise`（`nav.searchAtoms` / `nav.openAtom` 亦为异步）。

**错误**

| 错误 | 触发条件 | 处理建议 |
|---|---|---|
| `PluginPermissionError` | 清单未声明所需权限 | 权限声明缺失，提示用户重新安装并授权 |
| `AuthRequiredError` | 会话失效且自动重建失败 | 提示用户重新登录，不应重试 |
| 其他 `Error` | 网络或数据异常 | 可重试一次 |

**数据格式**：日期为 `"YYYY-MM-DD"`，时间为 `"HH:MM"`；`dateChoice` 为枚举
（0 = 今天，1 = 明天）。

**链式调用**：形如 `library.list → floors → sections → seats → book` 的调用链，
后一步入参必须是前一步返回的元素本体，不应按标识符构造对象。

**结构化结果**：命令的返回值除纯字符串外，可返回 `CommandResult` 对象，管理页按
区块渲染：

```js
return {
  text: "共 5 条通知",                       // 顶部摘要行（可选）
  markdown: "## 今日通知\n| 课程 | 内容 |\n|---|---|\n| 高数 | 作业发布 |",  // Markdown 正文（GFM 表格/列表/代码块）
  items: [                                   // 条目列表（title 必填）
    { title: "高数作业发布", subtitle: "第三章习题", meta: "2026-09-19 截止" }
  ],
  kv: [{ k: "今日课程", v: "3 节" }]         // 键值对汇总
};
```

**超时与网络**：所有请求 45 秒超时。清华校内域名在校外网络不可达；校内业务统一经
本 API 访问，`net.fetch` 仅用于校外地址。

## 0.1 权限总表

| 权限 | 覆盖的接口 |
|---|---|
| `user:read` | `session.*`、`user.*` |
| `info:read` | `info.*`、`coursex.*`、`services.search` / `services.open`（在线服务目录，发起校园请求） |
| `learn:read` / `learn:write` | `learn.*` 的读方法 / 写方法 |
| `venue:read` / `venue:book` | `venue` 查询 / 退订 |
| `xk:read` | `xk.*` |
| `dorm:read` | `dorm.*`、`kongjian.page`、`kongjian.my` |
| `kongjian:book` | `kongjian.book`、`kongjian.cancel` |
| `cal:read` / `cal:write` | `cal.agenda` / `cal.add`、`cal.edit`、`cal.remove` |
| `card:read` | `card.*` |
| `library:read` / `library:book` | 图书馆与研讨间查询 / 预约与取消 |
| `network:read` | `network.*` |
| `mail:read` / `mail:write` | `mail` 读方法 / `mail.send` |
| `cloud:read` / `cloud:write` | `cloud.repos`、`list`、`search`、`download` / `upload`、`share` |
| `llm` | `llm.*` |
| `theme` | `theme.*` |
| `exthw:read` / `exthw:refresh` | `exthw.snapshot` / `exthw.refresh` |
| `tsinghua:sdk` | `ts.*`（以用户登录态访问任意清华校内服务） |
| `clipboard:read` | `ui.clipboard.read`（读取系统剪贴板，敏感） |
| `plugins:call` | `plugins.list` / `plugins.call`（联动插件：列出并执行其他已启用插件的命令，含写操作） |
| `css` | `registerCss`（注入全局样式，影响整个应用外观；安装时重点确认） |
| `webview` | `ui.webModal` |
| `nav` | `nav.go` / `nav.searchAtoms` / `nav.openAtom` / `nav.usage` / `nav.clearUsage` |
| `ui` | `ui.*`（`toast`、`confirm`、`form`、`clipboard.write`、`getTabRoot`、`onTabReady`、`favorites.*`） |
| `storage` | `storage.*`、`settings.get` |
| `net:external` | `net.fetch` |
| `widget` | `registerWidget`（声明 Android 桌面小组件：宿主解析后由原生渲染）、`widget.instances` / `bind` / `unbind` / `getFallback` / `setFallback`（读写桌面上每一块小组件显示的内容） |
| `notify` | `notify.send` / `notify.cancel` / `notify.status`（发送系统通知，三端） |

---

## 1. `session` / `user`

对应清华统一认证会话状态与个人基本信息（来自信息门户）。

**权限** `user:read`

| 方法 | 返回 | 说明 |
|---|---|---|
| `session.status()` | 字符串枚举 | `"ready"`（可用）、`"logged-out"`、`"connecting"`、`"2fa"`（等待二次认证）、`"booting"`。调用业务接口前应确认状态为 `"ready"` |
| `session.username()` | `string \| null` | 学号或自定义用户名 |
| `user.info()` | `BasicUserInfo` | 首次调用触发信息门户会话建立，耗时数秒 |

```jsonc
// user.info()
{ "name": "张三", "studentId": "2023011234", "gender": "male",
  "department": "计算机科学与技术系", "major": "计算机科学与技术",
  "email": "zhangsan@mails.tsinghua.edu.cn" }
```

## 2. `llm`

对应应用内置的模型对话能力（由官方 Harness 插件提供）。插件无需自行配置密钥：
底层自动在「清华 MadModel 免费服务（校园网内免登录）」与「用户自费 API」之间选择，
二者均不可用时返回包含处理指引的错误。调度机制见
[architecture.md §5](./architecture.md)。

**权限** `llm`

### `llm.chat(input)`

发起单轮对话。请求携带 Harness 会话上下文与工具链，可直接完成课表查询、座位预约等
操作。

| 参数 | 类型 | 说明 |
|---|---|---|
| `input` | string | 自然语言输入 |

**返回** `{ text: string; model: string; provider: string }`。`text` 为回答文本，
`model` 为本次使用的模型标识，`provider` 为模型来源标识。

**错误**：校外网络且未配置自费密钥、超出预算、会话失效时抛出，消息包含处理指引。

```js
const { text, model } = await ctx.onethu.llm.chat("明天有哪些课？");
```

### `llm.provider()`

返回当前模型源设置：`"madmodel"`（清华免费服务）或 `"custom"`（自费 API）。修改该
设置需引导用户在插件设置页操作。

## 3. `theme`

对应应用外观系统。主题由 CSS 变量覆盖构成，不改变布局结构；声明 `dark: true` 的主题
激活时，原生控件同步切换为深色。支持配置昼夜两套主题并跟随系统深色模式切换。

**权限** `theme`

| 方法 | 返回 / 说明 |
|---|---|
| `theme.list()` | `Array<{ id, name, version, dark }>`，已安装的全部主题 |
| `theme.active()` | 当前选中的主题 id；`null` 表示使用内置默认外观 |
| `theme.apply(id \| null)` | 应用指定主题。副作用：退出昼夜跟随模式 |
| `theme.schedule()` | `{ followSystem, dayThemeId, nightThemeId, systemDark }`。跟随模式下由 `systemDark` 决定实际生效主题 |
| `theme.setFollowSystem(on)` | 启用或关闭跟随系统深色模式 |
| `theme.setDayNight(dayId, nightId)` | 设置昼夜两套主题，`null` 表示默认外观 |

```js
// 昼夜方案：浅色使用默认外观，深色使用凝夜主题，并跟随系统
await ctx.onethu.theme.setDayNight(null, "onethu.theme.night");
await ctx.onethu.theme.setFollowSystem(true);
```

主题插件（`category: "theme"` 清单与 `ThemeDef`）的开发说明见
[plugin-development.md §3.4](./plugin-development.md)。

## 4. `exthw`

对应外部作业源聚合接口，覆盖雨课堂、TUOJ（AI 版与经典版）、Tyche、DSA OJ 四个作业系统。
各源的凭据维护与故障恢复机制见 [external-homework.md](./external-homework.md)。

**权限** `exthw:read`（快照）、`exthw:refresh`（刷新）

### `exthw.snapshot()`

返回作业聚合快照。

**返回** `ExtHwSnapshot`

| 字段 | 类型 | 说明 |
|---|---|---|
| `items` | `ExternalHomework[]` | 作业条目 |
| `errors` | `Record<string, string>` | 按源标识归集的错误信息 |
| `state` | string | 聚合状态 |
| `lastAt` | number | 最近一次刷新完成时间（毫秒时间戳） |
| `configured` | boolean | 是否已配置任一作业源；为 `false` 时调用方不应使用本接口数据 |

`items` 元素（`ExternalHomework`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 源内稳定唯一标识（列表 key 与去重，不含 `ext:` 前缀） |
| `source` | string | 源标识：`yuketang`、`tuoj`、`tuojClassic`、`tyche`、`dsa` |
| `courseName` / `title` | string | 课程名与作业标题 |
| `deadline` | string | 截止时间，统一为 `"YYYY-MM-DD HH:MM"`（本地时区） |
| `kind` | `"homework"` \| `"exam"` | 作业或试卷 |
| `url` | string? | 详情链接（指向学生端页面） |
| `submitted` | boolean | 提交状态。各源独立查询得出；查询失败或无法判定时为 `false`（保守） |
| `submittedCount` / `totalCount` | number? | 已提交题数 / 总题数（仅雨课堂有精确数据） |
| `graded` | boolean? | 批改状态。目前仅雨课堂可判定，其余源缺省视为未批改 |
| `audited` | boolean? | 是否旁听课堂（雨课堂 `role===6`；未知 role 不标记） |
| `score` | number? | 得分，**仅在已提交且已出分 / 已批改时设置**（未出分时不返回 0） |
| `totalScore` | number? | 卷面满分，与 `score` 成对出现；题面分值全缺失时不设 |
| `leafTypeId` / `classroomId` | string? | 雨课堂整卷明细参数（`get_exercise_list` 的路径段与 `classroom_id`），供应用内原生详情页使用 |

**得分口径**（雨课堂）：考试取 `/v/exam/cover` 的 `result.score`；已批改作业取「已批改题目的
有效得分合计」，满分取「题面分值合计」；两者均只在**整卷已批改**时透出，避免在批改完成前
返回部分分数造成误导。详情页与批改评语的呈现方式见 [external-homework.md](./external-homework.md)。

`exthw.*` 只提供 `snapshot()` 与 `refresh()` 两个方法：**作业详情页与提交入口属于应用内
功能**（原生页面 + 内嵌官方作答页），不经插件 API 暴露，插件侧只读取聚合快照。

```jsonc
{
  "items": [
    { "source": "tyche", "course": "程序设计", "title": "作业 3",
      "deadline": "2026-09-25 23:59", "url": "https://…",
      "submitted": true, "graded": true, "score": 100 },
    { "source": "yuketang", "course": "线性代数", "title": "第 2 周练习",
      "deadline": "2026-09-21 08:00", "url": null,
      "submitted": false, "graded": false, "score": null }
  ],
  "errors": { "tuoj": "需要二次认证" },
  "state": "idle",
  "lastAt": 1758271200000,
  "configured": true
}
```

### `exthw.refresh()`

触发全部作业源刷新。各源设有独立的频控与并发去重；TUOJ 会话失效时自动重新漫游一次。

## 5. `ts` — 清华服务接入 SDK

对接对象为任意清华校内服务，包括尚未被宿主实现为独立命名空间的系统（各院系系统、
实验室预约、研究院门户等）。本命名空间将宿主维护的会话层能力开放给插件复用：webvpn
通道分流、统一认证凭据、cookie 池、会话失效后的自动重登与请求重放。

**权限** `tsinghua:sdk`。该权限允许插件以用户登录态访问任意清华校内服务，安装确认
页需向用户明确说明。

### `ts.status()`

主会话探活。

**返回** `"ready"`（可用）、`"expired"`（会话失效）、`"logged-out"`（未登录）。

### `ts.ensure()`

确保主会话可用：探活并按需透明建立。不可用时抛出 `AuthRequiredError`。

### `ts.username()`

**返回** `string | null`，当前登录名。

### `ts.client(opts?)`

创建面向清华服务的 HTTP 客户端。该客户端共享宿主主会话 cookie 池，因此登录凭据、
设备指纹与各系统既有会话均被继承；请求经宿主传输层发出（45 秒超时、无同源策略
限制），响应含登录页特征时宿主自动重新登录并重放一次。

| 参数 | 类型 | 说明 |
|---|---|---|
| `opts.mode` | `"auto"` \| `"webvpn"` \| `"direct"` | 通道分流模式，缺省 `"auto"`。`auto` 按宿主现行规则分流；`direct` 强制直连；`webvpn` 按包装会话桶规则 |

**返回**客户端对象：

| 方法 | 说明 |
|---|---|
| `fetch(url, init?)` | 发起请求。`init` 为 `{ method?, headers?, body? }`；返回标准 `Response` |
| `resolve(url)` | 返回按分流规则解析后的实际请求地址，用于调试与展示 |

**分流规则**（`auto` 模式，与宿主传输层同源）：

| 目标地址 | 通道 |
|---|---|
| `id`、`oauth`、`webvpn` 域及各白名单公网域（如 `ai.tuoj.thusaac.com`） | 直连 |
| `learn.tsinghua.edu.cn` | 直连 |
| 其余校内域名（`info`、`zhjw.cic`、各院系系统等） | 经 webvpn 包装 |

白名单依据实测结论确定：这些域名经包装会导致会话隔离或票据失效，因此即便指定
`mode: "webvpn"` 也保持直连。

**统一认证（CAS）对接的系统**：会话存活时直接请求业务地址即可。未认证请求会被
重定向至统一认证，宿主持有的 CAS 会话自动完成票据兑换并返回业务页，插件收到的是
最终业务响应，无需处理重定向链。对接流程非标准的系统，参考
`packages/core/src/exthw/tuojCas.ts` 的显式漫游实现。

```js
export const manifest = {
  id: "onethu.dept-notices",
  name: "院系通知",
  version: "0.1.0",
  permissions: ["tsinghua:sdk"],
};

export default async function activate(ctx) {
  ctx.registerCommand({ id: "fetch", title: "拉取最新通知" }, async () => {
    await ctx.onethu.ts.ensure();                 // 会话不可用时抛错，由用户重新登录
    const client = ctx.onethu.ts.client();        // auto：校内域自动经 webvpn
    const res = await client.fetch("https://dept.example.tsinghua.edu.cn/api/notices");
    if (!res.ok) return `请求失败：HTTP ${res.status}`;
    const { items } = await res.json();
    return items.slice(0, 5).map((n) => `${n.date} ${n.title}`).join("\n");
  });
}
```

`ts.client()` 亦可用于需要保持同一会话连续操作的场景（多次调用返回的客户端共享同一
cookie 池，无需额外处理）。

## 6. `plugins` — 联动插件

列出并执行其他已启用插件的命令，用于插件间联动（如 OH 对话工具化）。需
`plugins:call` 权限——该权限允许触发任意已启用插件的命令（含写操作），安装确认
需重点说明。

| 方法 | 说明 |
|---|---|
| `plugins.list()` | 列出已启用 JS 插件及其命令（`{pluginId, pluginName, commands[]}`） |
| `plugins.call(pluginId, cmdId, input?)` | 执行某插件命令，返回该命令的原始结果 |

```js
const cmds = await ctx.onethu.plugins.list();
// [{ pluginId: "onethu.dept-notices", pluginName: "院系通知", commands: [{ id: "fetch", title: "拉取最新通知", inputLabel: undefined }] }]
const r = await ctx.onethu.plugins.call("onethu.dept-notices", "fetch", "");
```

## 7. `info`

对应清华信息门户（info.tsinghua.edu.cn），提供教务与生活事务的官方记录数据。学习
行为类数据（作业、讨论）见 §9。

**权限** `info:read`

| 方法 | 参数 | 返回 |
|---|---|---|
| `info.schedule(start, end)` | `"YYYY-MM-DD"` 起止日期 | `ScheduleEntry[]`：`{ courseName, teacher, date, location, startTime, endTime, weekText, category }`，为周次展开后的具体课次 |
| `info.report()` | — | 成绩单：`{ name, credit, grade, point, semester }` |
| `info.exams()` | — | 考试安排：`courseName`、`date`、`startTime`、`endTime`、`location` |
| `info.deadlines()` | — | 门户重要事项倒计时 |
| `info.news(page?)` | 页码从 1 起 | 新闻列表：`{ name, xxid, date, source }` |
| `info.newsDetail(xxid)` | 新闻 id | 新闻正文 |
| `info.searchNews(keyword, page?)` | — | 新闻搜索结果 |
| `info.newsSub(page?, subscriptionId?)` | — | 订阅源聚合流 |
| `info.schoolCalendar()` | — | 学期起止与校历节点 |
| `info.classroomList()` | — | 空教室楼栋列表 |
| `info.classroomState(building, week)` | 楼栋名、周次 | 该周各教室占用情况 |
| `info.invoices(page)` | 页码 | 电子发票分页数据 |
| `info.bankPayments()` | — | 银行代扣记录 |
| `info.graduateIncome(begin, end)` | 日期范围 | 助研津贴，仅研究生账号可用，可能为 `null` |
| `info.dormScore()` | — | 宿舍卫生分，可能为 `null` |
| `info.physicalExam()` | — | 体测结论列表 |
| `info.assessmentList()` | — | 评教完成状态列表 |

```jsonc
// info.schedule("2026-09-14", "2026-09-20") 元素
{ "courseName": "数据结构", "teacher": "李四", "date": "2026-09-16",
  "location": "六教6A215", "startTime": "08:00", "endTime": "09:35",
  "weekText": "第1-16周", "category": "讲授课" }
```

## 8. `coursex`

对应 courseX 课程共享计划，提供跨学期课程信息检索，无需登录凭据。

**权限** `info:read`

| 方法 | 说明 |
|---|---|
| `coursex.semesters()` | 学期列表 |
| `coursex.search(q, semester?)` | 按关键词检索课程摘要 |
| `coursex.detail(id)` | 课程详情；查无详情时返回 `{ id, error }` 或 `null` |

## 9. `learn`

对应清华网络学堂（web.learn.tsinghua.edu.cn），提供课程、作业、通知、课件与课程
讨论区。

**权限** `learn:read`；`learn.reply` 与 `learn.post` 需 `learn:write`（写操作）

| 方法 | 说明 |
|---|---|
| `learn.semesters()` | 学期标识列表 |
| `learn.courses(semesterId?)` | 课程列表；缺省为当前学期 |
| `learn.homework(semesterId?)` | 作业列表，含截止时间与提交状态，附课程名 |
| `learn.notifications(semesterId?)` | 课程通知，附课程名 |
| `learn.files(courseId, semesterId?)` | 课件列表 |
| `learn.bbsBoards(wlkcid)` | 讨论区版面列表 |
| `learn.bbsThreads(wlkcid, opts?)` | 帖子列表；`opts` 支持 `bqid`、`kind`（`"yb"` / `"jh"` / `"cy"`）、分页 |
| `learn.bbsThread(wlkcid, threadId, bqId?)` | 帖子详情 |
| `learn.bbsPosts(wlkcid, threadId, pageNum)` | 回复分页 |
| `learn.reply(wlkcid, threadId, content)` | 回帖（写操作，纯文本正文） |
| `learn.post(wlkcid, bqid, title, html)` | 发帖（写操作，HTML 正文） |

## 10. `cal`

对应应用日程功能。用户配置清华邮箱 CalDAV 后写操作同步至云端日历，未配置时写入
本地。`agenda` 合并云端与本地日程并展开重复规则。

**权限** `cal:read`（查询）、`cal:write`（增删改）

| 方法 | 说明 |
|---|---|
| `cal.agenda(startYmd?, endYmd?)` | 缺省为今天起 14 天；返回 `{ uid, title, date, start, end, allDay, location?, note?, source }[]`，`source` 为 `"cloud"` 或 `"local"` |
| `cal.add(title, dateYmd, startHm, endHm, opts?)` | 新建；`opts` 支持 `location`、`note`、`allDay`、`local`；返回 `{ uid, where }` |
| `cal.edit(uid, ch)` | 修改；仅传入需变更的字段，`location` / `note` 传空串表示清除 |
| `cal.remove(uid)` | 删除；自动路由至云端或本地 |

## 11. `venue`

对应清华大学体育部场馆中心。**接口范围限制**：依据体育部 2025-12-03 公告第七条第
12 款，通过脚本提交预约将被暂停预订权限 6 个月，因此宿主仅提供查询、退订与官方页面
跳转，不提供预约提交接口。

**权限** `venue:read`（查询）、`venue:book`（退订）

| 方法 | 说明 |
|---|---|
| `venue.scenes()` | 场景列表 |
| `venue.currentPage({ sceneUuid, reserveDate, classTypeUuid?, siteType? })` | 指定日期的可约场地 |
| `venue.myRecords(page?)` | 我的预约记录 |
| `venue.cancel(resvUuid)` | 退订（写操作） |
| `venue.jump(sceneUuid)` | 返回官方预约页地址，预约操作应引导用户在该页面完成 |

## 12. `xk`

对应清华选课系统的只读数据，不包含选课提交操作。

**权限** `xk:read`

| 方法 | 说明 |
|---|---|
| `xk.search({ kcm?, kch?, teacher?, semester?, page? })` | 课程检索；`kcm` 为课程名，`kch` 为课号 |
| `xk.catalog(sem?)` | 课程目录 |
| `xk.selected(sem?)` | 已选课程 |
| `xk.detail(teacherId, code)` | 课程详情 |
| `xk.reviews(course, teacher?)` | 社区课程评价；返回 `{ course, teacher, count, avg, reviews }` 或 `null` |

## 13. `kongjian`

对应宿舍公共空间预约。

**权限** `dorm:read`（查询）、`kongjian:book`（预约与取消）

| 方法 | 说明 |
|---|---|
| `kongjian.page(opts?)` | 空间、房间与场次结构；`opts` 支持 `spaceId`、`roomId`、`date` |
| `kongjian.my()` | 我的预约记录 |
| `kongjian.book(bookUrl, info)` | 预约（写操作）；`bookUrl` 来自 `page` 返回，`info` 为 `{ name, sid, tel, other }` |
| `kongjian.cancel(target)` | 取消（写操作） |

## 14. `card` / `dorm` / `network`

分别对应校园卡结算中心、学生宿舍服务与校园网自助服务。

**权限** `card:read` / `dorm:read` / `network:read`

| 方法 | 返回 |
|---|---|
| `card.info()` | `{ balance, userName, userId, departmentName?, cardStatus? }`，`balance` 单位为元 |
| `card.transactions(start, end)` | 消费流水：`{ summary, timestamp, amount, balance, address? }` |
| `dorm.eleRemainder()` | `{ remainder, updateTime }`，`remainder` 单位为度 |
| `dorm.elePayRecord()` | 充值记录；从未充值时返回空数组 |
| `network.balance()` | 用量与账户余额：`{ productName, usedBytes, accountBalance }` |
| `network.devices()` | 在线设备：`{ ip4, mac, loggedAt }` |
| `network.deviceCount()` | 在线设备数量 |
| `network.accountInfo()` | 账户信息：`{ realName, userGroup, allowedDevices }` |

## 15. `library` / `libroom`

分别对应图书馆座位预约系统与研讨间预约系统。

**权限** `library:read`（查询）、`library:book`（预约与取消）

图书馆调用链为对象传递：`list()` → `floors(libraryId, dateChoice)` →
`sections(floor, dateChoice)` → `seats(section, dateChoice)` →
`book(seat, sectionId, dateChoice)`。`dateChoice` 取值 0（今天）或 1（明天）。

| 方法 | 说明 |
|---|---|
| `library.list()` | 楼栋列表：`{ id, zhName }` |
| `library.floors(libraryId, dateChoice?)` | 楼层列表，含 `available` / `total` 余量 |
| `library.sections(floor, dateChoice?)` | 区域列表，入参为 `floors` 返回元素 |
| `library.seats(section, dateChoice?)` | 座位列表，入参为 `sections` 返回元素 |
| `library.book(seat, sectionId, dateChoice?)` | 预约（写操作）；返回 `{ status?, msg? }`，结果以 `msg` 内容判定 |
| `library.records()` | 我的预约记录 |
| `library.cancel(recordId)` | 取消预约（写操作） |
| `libroom.list()` | 研讨间类型列表：`{ kindId, kindName, rooms }` |
| `libroom.resources(date, kindId)` | 指定日期的可约资源，含 `limit`（人数上限）与 `maxMinute`（时长上限） |
| `libroom.book(roomRes, start, end, memberAccNos?)` | 预约（写操作）；起止格式 `"YYYY-MM-DD HH:00"`，成员账号来自 `fuzzyMember` |
| `libroom.records()` | 我的预约记录 |
| `libroom.cancel(uuid)` | 取消预约（写操作） |
| `libroom.fuzzyMember(keyword)` | 按姓名或学号检索成员，用于拼团预约 |

研讨间系统对首次使用的账号可能返回「会话未能建立」，用户进入应用「预约」页面访问
一次即可完成初始化。

## 16. `mail` / `cloud`

分别对应清华邮箱与清华云盘（Seafile）。

**权限** `mail:read` / `mail:write`、`cloud:read` / `cloud:write`

| 方法 | 说明 |
|---|---|
| `mail.list(folder, limit)` | 邮件头列表；`folder` 取 `"INBOX"` 或 `"Sent Items"`；返回总数与 `{ uid, subject, from, dateMs, seen }` 列表 |
| `mail.read(folder, uid)` | 读取邮件正文，同时标记为已读 |
| `mail.search(folder, query)` | 服务端检索 |
| `mail.send(to, cc, subject, body)` | 发送邮件（写操作）；多地址由应用拆分 |
| `cloud.repos()` | 资料库列表 |
| `cloud.list(repoId, path)` | 目录内容：`{ name, kind, size, mtime }` |
| `cloud.search(repoId, query)` | 按文件名检索 |
| `cloud.download(repoId, path)` | 下载至 `~/Downloads`，返回本地路径 |
| `cloud.upload(repoId, parentDir, localPath, replace)` | 上传（写操作）；`localPath` 支持 `~` |
| `cloud.share(repoId, path, expireDays)` | 生成分享链接（写操作）；`expireDays` 为 0 表示永久 |

## 17. `nav` / `ui` / `storage` / `settings`

| 方法 | 权限 | 说明 |
|---|---|---|
| `nav.go(page, params?)` | `nav` | 应用内跳转，路由表见 §19 |
| `nav.searchAtoms(query, limit?)` | `nav` | 按关键词检索全应用可跳转原子，返回 `{kind, key, title, sub?, group}[]`（缺省 12 条，上限 50）。只查静态注册表 + 本机缓存，**不发起任何校园请求** |
| `nav.openAtom(ref)` | `nav` | 打开一个原子，行为等同于用户点击收藏夹中的同一项（跳转功能页 / 切换聚合页页签 / 打开官方服务页）；无法解析时返回 `false`，不会进入空白页。见 §20 |
| `nav.usage(limit?)` | `nav` | 本机使用统计：`{total, kinds, top[], recent[]}`（每项含 `kind`/`key`/`title`/`n`/`last`，可直接交给 `nav.openAtom`）。仅含本机点击记录，不含校园数据；缺省 10 条，上限 30 |
| `nav.clearUsage()` | `nav` | 清空本机使用统计（仅在用户主动要求时调用；**不影响收藏夹**） |
| `services.search(query, limit?)` | `info:read` | 检索在线服务（服务大厅）目录，返回 `{id,name,department,url,score}[]`。**会发起校园请求**（先校验会话再取目录），仅在 `nav.searchAtoms` 的本机检索无结果时调用。支持简称匹配：「亲友预约」以 40 分以上命中「亲友来访预约」；仅后缀不同的名称（如「亲友预约」与「亲友入校报备」）以 20~39 分进入候选。命中结果写回本机原子缓存 |
| `services.open(service)` | `info:read` | 在应用内打开服务官方页（桌面独立窗口 / Android 全屏 WebView，与主窗口共享登录态）；`url` 须来自 `search`；打开失败返回 `false` |
| `ui.toast(text)` | `ui` | 底部提示，显示 3 秒 |
| `ui.webModal(url)` | `webview` | 在应用内 WebView 模态窗口打开地址（Android 端用于浏览外部页面）；仅支持 `https://`；桌面端抛出错误，调用方应捕获后改用系统浏览器 |
| `ui.confirm(msg, opts?)` | `ui` | 应用内确认弹窗（Promise 化），resolve 值表示用户是否确认；`{danger: true}` 使用危险操作样式，`{title, confirmText}` 自定标题与确认按钮文案（危险样式建议显式给，宿主兜底为「此操作不可撤销，请确认 / 确认执行」） |
| `ui.form(title, fields)` | `ui` | 通用表单弹窗，`fields` 为 `{key, label, kind?, placeholder?, default?, required?, options?}[]`（kind: text/textarea/password/select）；resolve 为键值对象，取消时 resolve `null` |
| `ui.clipboard.write(text)` | `ui` | 写系统剪贴板 |
| `ui.clipboard.read()` | `clipboard:read` | 读取系统剪贴板（敏感权限：可读取密码管理器复制的口令，单独列示） |
| `ui.getTabRoot(pageKey)` / `ui.onTabReady(pageKey, cb)` | `ui` | 本插件功能页的 DOM 挂载容器（自由渲染）；仅限 `plugin:<本插件id>:` 前缀 |
| `favorites.add(key, folderId?)` / `favorites.list()` | `ui` | 收藏本插件原子：key 形如 `<tabId>~<原子key>`，kind 自动补全为本插件；`list` 返回本插件已被收藏的收藏夹与 key。见 plugin-development §6.4 |
| `favorites.addAtom(ref, meta?, folderId?)` / `favorites.kinds()` | `ui` | 收藏任意已注册种类的原子（跨插件）：`ref` 为 `{kind, key}`，`meta` 提供展示元数据且在该种类未注册时内联注册为静态种类（OH 收藏工具经此通道）；`kinds` 列出全部可收藏种类 |
| `notify.send(opts)` | `notify` | 排一条系统通知：`{title, body?, afterSeconds?, key?, page?}`；返回 `{ok, id, reason?}`。通知 id 为 `plugin:<插件id>:<key>`，归插件所有，宿主重排不撤 |
| `notify.cancel(key)` | `notify` | 撤销本插件排下的某条通知 |
| `notify.status(request?)` | `notify` | 后端与授权状态：`{ok, backend, granted, exact, reason?}`；`request=true` 才发起授权请求 |
| `widget.list()` / `widget.slots()` | `widget` | 本插件已声明的小组件与所占槽位（未占槽为 `null`）/ 本平台预留槽位数 |
| `widget.instances()` | `widget` | 桌面上每一块小组件：`[{id, shape, binding}]`（binding 形如 `{kind:"today"}` / `{kind:"folder",folderId}` / `{kind:"detail"\|"shortcut",atom}`） |
| `widget.bind(id, binding)` / `widget.unbind(id)` | `widget` | 切换某一块的内容 / 恢复默认；目标不存在（收藏夹已删除、原子无法解析）时返回 `false`，且不写入配置。插件不能添加或删除小组件 |
| `widget.getFallback()` / `widget.setFallback(binding)` | `widget` | 新放置且尚未选择内容的小组件所使用的默认内容 |
| `storage.get(key)` / `set(key, value)` / `keys()` / `remove(key)` | `storage` | 插件私有键值存储，按插件标识隔离，JSON 序列化，卸载时清除 |
| `settings.get()` | `storage` | 返回用户在插件设置页填写的值 |

## 18. `net`

外部网络请求接口，经 Rust 传输层发出，不受 WebView 同源策略限制，支持自定义请求头，
45 秒超时，跟随重定向。仅用于访问校外地址；清华校内业务应使用前述命名空间。

**权限** `net:external`

```js
// 调用 OpenAI 兼容接口（应用内已有免配置的 ctx.onethu.llm.chat，优先使用后者）
const res = await ctx.onethu.net.fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) throw new Error(`LLM ${res.status}`);
const reply = (await res.json()).choices[0].message.content;
```

调用 Anthropic 兼容接口时替换为 `x-api-key` 与 `anthropic-version` 请求头。

## 19. 页面路由

`nav.go(page, params?)` 的 `page` 取值：

| page | 页面 | params |
|---|---|---|
| `today` | 今日首页 | — |
| `learn` | 网络学堂 | — |
| `schedule` | 日程 | — |
| `info` | 信息聚合 | `infoTab`：`report` / `exams` / `news` / `calendar` / `profile` / `courseinfo` 等；`infoNewsId` 直达新闻 |
| `life` | 生活聚合 | `lifeTab`：`dorm` / `card` / `washer` / `invoice` / `payroll` / `gradincome` / `network` 等 |
| `reserve` | 预约聚合 | `reserveTab`：`lib` / `room` / `classroom` / `sports` / `kongjian` |
| `zhjwxk` | 选课系统 | — |
| `settings` / `plugins` | 设置 / 插件管理 | — |
| `plugin:<插件id>:<页签id>` | 插件自建功能页（`registerTab`，见 plugin-development §6.3） | — |
| `learn-course` | 课程详情 | `courseId`；`courseTab`（`notices`/`assignments`/`files`/`groups`/`forum`）、`bbsBoard` 可直达板块 |
| `learn-assignments` / `learn-notices` / `learn-files` | 学堂聚合列表 | `courseId` 可限定课程 |
| `learn-assignment-detail` / `learn-notice-detail` / `learn-file-detail` | 作业 / 通知 / 文件只读详情 | `courseId`、`itemId` |
| `learn-forum-thread` | 讨论区话题 | `courseId`、`itemId`（话题）、`bqid`（板块） |
| `learn-ykt-detail` | 雨课堂作业原生详情（只读，见 external-homework.md） | `ykt`：`{ leafTypeId, classroomId, externalUrl?, title?, deadline?, courseName?, kind? }` |
| `trace` / `otherinfo` / `thos` / `mail` / `cloud` / `thubook` / `folder` | 寻迹 / 其他 Info 应用 / 在线服务 / 邮箱 / 云盘 / THUbook / 收藏夹 | `folder` 需 `folderId` |

插件页签的 pageKey 由 `plugin:<插件id>:<页签id>` 构成，插件注册的收藏原子深链即指向
该路由。插件未安装、已停用或未注册该页签时，页面显示降级提示而非空白。

## 20. 原子（`{kind, key}`）：收藏与「一句话直达」的共同引用

应用内所有可跳转对象均以原子引用 `{ kind, key }` 表示，包括功能页面、今日组件、操作、
课程、作业、通知、文件、在线服务、场馆、教学楼、洗衣机楼、图书馆、新闻与插件自定义条目。
收藏夹只保存引用（`favorites.addAtom(ref, meta?)`），点击时由宿主解析为页面跳转，因此同一
引用在收藏夹、桌面小组件、OH 对话与插件搜索中的行为一致。

- **kind**：原子种类。`page` / `action` / `widget-*` 等为静态注册；`course` /
  `assignment` / `thos-service` / `sports-v` 等为动态实体（数据来自本机缓存）；
  `plugin:<插件id>` 为插件注册的种类。
- **key**：种类内的稳定标识，由宿主 `enc(...parts)` 以 `~` 连接、`dec(key)` 还原。
  调用方不应自行拼接 key，应将 `nav.searchAtoms` 返回的 `key` 原样回传。
- **`thos-service`**：在线服务（服务大厅）条目，key = `enc(id, name, department)`。
  由在线服务页打开过目录后写入本机缓存，收藏与「一句话直达」共用同一份引用；打开动作在
  应用内官方页面完成（三端一致：桌面独立窗口、Android 全屏 WebView，登录态与主窗口共享）。
- **无法解析即视为失效**：`nav.openAtom` 对已删除数据或已停用插件的引用返回 `false`；
  收藏夹与桌面小组件降级显示，不进入空白页面。插件应据此组织回复，不应承诺无法完成的
  操作。

**检索范围**：`nav.searchAtoms(query, limit?)` 只检索静态注册表与本机缓存，**不发起任何
校园请求**，因此响应快且离线可用，但只能返回本机出现过的实体。宿主侧实现真源见
`apps/desktop/src/state/atoms.tsx`（`searchAtoms` / `resolveAtom`）。

### 20.1 本机使用统计（`nav.usage`）

今日页的「最近使用」「猜你喜欢」与 OH 的 `query_usage` 读取同一份记录
`onethu.usage.counts.v1`，每项为 `{n, last, title?, sub?, group?}`，最多 120 条。
记录点位于应用内部：由侧边栏或入口卡进入页面（`recordPageAtomUse`），以及任意原子被打开
（`resolveAtom` 返回的 `open` 统一记录）。因此收藏夹点击、桌面小组件与 OH `openAtom`
均计入统计。

两条约束：

1. **统计不改写收藏夹**。收藏代表用户的显式意图，推荐仅作为入口，是否收藏由用户决定。
2. **统计仅存于本机**，内容为入口使用次数，不含成绩、课程内容等校园数据；插件读取须声明
   `nav` 权限，用户可随时清空（`nav.clearUsage`）。

### 20.2 服务名打分（`services.search` 的 `score`）

分值定义如下（实现与测试：`apps/desktop/src/lib/serviceMatch.ts`、
`tools/service-match-test.mjs`）：

| 分值 | 判定 | 调用方处理 |
|---|---|---|
| 100 | 与服务名完全相等 | 直接打开 |
| 80 ~ 95 | 服务名包含查询串 | 直接打开 |
| 70 | 查询串包含服务名 | 直接打开 |
| 40 ~ 60 | 查询串为服务名子序列（字符顺序一致，可不连续） | 直接打开（`SERVICE_CONFIDENT` 阈值） |
| 20 ~ 35 | 近似匹配（最长公共子串不少于 2 个汉字） | 仅作候选：先请用户确认服务名称 |
| 0 | 不匹配 | 视为无匹配 |

`SERVICE_CONFIDENT`（40 分）为自动打开的下限，低于该分值只返回候选，由用户确认后再打开。
该阈值用于保证跳转正确性：误跳转至错误官方页面的代价高于一次确认。
