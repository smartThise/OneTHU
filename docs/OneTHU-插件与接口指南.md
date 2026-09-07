# OneTHU 插件与接口规范

| | |
|---|---|
| **规范版本** | v1（随 OneTHU 0.8.0） |
| **适用对象** | OneTHU 插件开发者（JS 模块 / Rust sidecar / Android 内嵌三形态） |
| **接口真源** | `apps/desktop/src/plugins/types.ts`（API 面与权限）、`facade.ts`（门禁实现）、`packages/core/src/info/types.ts`（领域类型） |
| **参考实现** | [plugins/OneTHU-Harness](https://github.com/smartThise/OneTHU-Harness)（OH，官方骨干插件） |

> 本文档自足：读完可不动 OneTHU 本体代码写出一个完整插件。接口行为以真源代码为准，
> 与本文冲突时以代码为准并提 Issue 修正文档。

## 目录

1. [插件系统概述](#一插件系统概述)
2. [插件模型与清单规范](#二插件模型与清单规范)
3. [权限模型](#三权限模型)
4. [onethu.* API 参考](#四onethu-api-参考)
5. [页面路由参考](#五页面路由参考)
6. [网络与错误约定](#六网络与错误约定)
7. [JS 模块插件开发](#七js-模块插件开发)
8. [Rust sidecar 插件协议](#八rust-sidecar-插件协议)
9. [对话面板（dock）协议](#九对话面板dock-协议)
10. [Android 内嵌形态](#十android-内嵌形态)
11. [调试与日志](#十一调试与日志)
12. [参考实现与示例](#十二参考实现与示例)

---

## 一、插件系统概述

OneTHU 插件系统支持三种形态，共用**同一套权限门禁与 `onethu.*` 数据面**：

| 形态 | 载体 | 运行位置 | 适用平台 | 安装方式 |
|---|---|---|---|---|
| **JS 模块**（默认） | ES 模块文本（.js） | 应用 webview，同域受信执行 | 全平台 | 设置 → 插件 → 粘贴代码 / 选文件 |
| **Rust sidecar** | 独立二进制 + manifest.json | 独立进程，stdio JSON-RPC | 桌面三端 | 设置 → 插件 → 选 manifest.json（二进制同目录同名） |
| **Rust 内嵌** | 核心直接编进 App | App 进程内（无独立进程） | 仅 Android（官方内置） | 随 APK 分发，不可卸载 |

- 插件是**受信代码**（同域执行 / 本机二进制）：权限门禁约束的是 `onethu.*` API 的可见面，
  不是代码沙箱。
- 插件可安装、可停用、可删除，但**不得改变应用架构**：一切操作走公共原子接口
  `onethu.*`，不触碰应用内部状态与 DOM。
- 会话自愈、超时、重试等网络健壮性全部由宿主承担，插件只处理业务语义。

### 网络层三条约定

1. **票据通道**：CAS 票据兑在哪个通道，会话建在哪个通道。OneTHU 内部已处理，经
   `onethu.*` 调用的插件完全无感。仅 `onethu.net.fetch` 直访清华内网需自行注意
   （内网域校外不可达——建议插件不直接碰内网，全走 `onethu.*`）。
2. **会话自愈**：任何 `onethu.*` 调用在会话失效时自动重建后重试；失败抛
   `AuthRequiredError`（message 含「会话未能建立」）——插件应提示用户重新登录，而非重试。
3. **45s 超时**：所有请求（含 net.fetch）45 秒兜底超时，不会无限悬挂。

---

## 二、插件模型与清单规范

### 2.1 manifest 字段（PluginManifest）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 唯一 id（建议反域名，如 `onethu.harness`；小写字母/数字/`.`/`-`） |
| `kind` | `"js" \| "rust"` | | 形态，默认 `js` |
| `bin` | string | rust 专用 | 二进制文件名（随 manifest.json 同目录选取） |
| `name` | string | ✓ | 显示名 |
| `version` | string | ✓ | 版本号 |
| `author` | string | | 作者 |
| `description` | string | | 描述 |
| `permissions` | PluginPermission[] | ✓ | 权限清单（§三），安装时用户逐项确认 |
| `settings` | PluginSettingField[] | | 设置表单（应用代渲染，插件不自带 UI） |

### 2.2 设置项字段（PluginSettingField）

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 设置键（插件经 `onethu.settings.get()` 读取） |
| `label` | string | 表单标签 |
| `type` | `"text" \| "password" \| "textarea"` | 输入类型，默认 text |
| `placeholder` | string | 占位文案 |
| `default` | string | 默认值 |

### 2.3 命令（PluginCommand）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 命令 id（run 的参数 `command` 即此值） |
| `title` | string | 管理页按钮文案 |
| `inputLabel` | string | 输入框标签；不填则无输入框 |
| `inputPlaceholder` | string | 输入框占位 |
| `dock` | boolean | rust 插件可选：标记为对话面板命令（§九） |

### 2.4 生命周期

- **安装即激活**；应用启动自动恢复激活所有已启用的插件。
- **停用** = 调 dispose 后卸载；**删除** = 停用 + 清除插件私有存储。
- 安装记录（PluginRecord，localStorage 持久化）含 `builtin`（App 一部分，不可卸载，
  管理页徽标「内置」）与 `embedded`（核心编进 App，Android 内置）两个标志位。

---

## 三、权限模型

manifest `permissions` 声明，安装时用户逐项确认；调用未授权方法抛
`PluginPermissionError`（message 说明缺哪个权限）。**JS / Rust sidecar / Android 内嵌
三形态同一套门禁，无绕过路径。**

| 权限 | 说明 | 门禁的 API 面 |
|---|---|---|
| `user:read` | 基本信息 + 会话状态 | `session.*`、`user.*` |
| `info:read` | 信息门户只读查询 | `info.*`、`coursex.*` |
| `learn:read` | 网络学堂只读 | `learn.*`（读方法） |
| `learn:write` | 网络学堂发帖/回帖（写，需确认） | `learn.reply`、`learn.post` |
| `venue:read` | 体育场馆查询 | `venue.scenes/currentPage/myRecords/jump` |
| `venue:book` | 场馆预约退订（仅退订，见下） | `venue.cancel` |
| `xk:read` | 选课数据只读 | `xk.*` |
| `kongjian:book` | 宿舍公共空间预约/取消（写） | `kongjian.book`、`kongjian.cancel` |
| `card:read` | 校园卡只读 | `card.*` |
| `dorm:read` | 宿舍只读 + 公共空间查询 | `dorm.*`、`kongjian.page/my` |
| `library:read` | 图书馆/研讨间查询 | `library`/`libroom` 读方法 |
| `library:book` | 图书馆预约/取消（写） | `library.book/cancel`、`libroom.book/cancel` |
| `network:read` | 校园网账户只读 | `network.*` |
| `nav` | 应用内跳转 | `nav.go` |
| `ui` | toast 提示 | `ui.toast` |
| `storage` | 插件私有存储 | `storage.*`、`settings.get` |
| `net:external` | 外部 HTTP 请求（大模型 API 等） | `net.fetch` |

**体育场馆法规边界**：宿主**不提供场馆预约提交接口**（`venue` 只有查询、我的预约、
退订与 `jump` 跳转官方页）。依据清华大学体育部场馆中心 2025-12-03 公告第七条第 12 款，
脚本/插件途径预订场地将被封禁预订权限 6 个月——插件同样不得以任何方式绕行。
亦不暴露充值、改密等资金与凭据写操作。

---

## 四、onethu.* API 参考

JS 插件经 `ctx.onethu.<ns>.<method>(...)` 调用；Rust 插件经
`onethu.call { ns, method, args }` 调用（方法签名去掉 `onethu.` 前缀，args 按位置传）。
除 `session.*`、`ui.toast`、`storage.*`（同步族）、`nav.go` 外均返回 Promise；
失败统一 throw，会话类失败为 `AuthRequiredError`。

### 4.1 session / user（user:read）

| 方法 | 返回 | 说明 |
|---|---|---|
| `session.status()` | `"ready" \| "demo" \| "logged-out" \| "connecting" \| "2fa" \| "booting"` | 应用会话状态；执行任务前建议检查为 `ready` |
| `session.username()` | `string \| null` | 登录名（学号或自定义用户名） |
| `user.info()` | `BasicUserInfo { name, studentId, gender?, department?, major?, email? }` | 基本信息（首次触发 info 漫游，需数秒） |

### 4.2 info（info:read）

| 方法 | 参数 | 返回 |
|---|---|---|
| `info.schedule(start, end)` | `"YYYY-MM-DD"` 起/止 | `ScheduleEntry[]`：courseName/teacher/date/location/startTime/endTime/weekText/category |
| `info.report()` | — | `ReportRow[]`：name/credit/grade/point/semester |
| `info.exams()` | — | `ExamEntry[]`：courseName/date/startTime/endTime/location |
| `info.deadlines()` | — | `DeadlineItem[]`：title/begin?/end? |
| `info.news(page?)` | 页码从 1 | `NewsItem[]`：name/xxid/date?/source? |
| `info.newsDetail(xxid)` | 新闻 id | `NewsDetail`（正文） |
| `info.searchNews(keyword, page?)` | — | `NewsItem[]` |
| `info.newsSub(page?, subscriptionId?)` | — | `NewsItem[]`（用户订阅源聚合流） |
| `info.schoolCalendar()` | — | `SchoolCalendarData`：学期起止 + 节点 |
| `info.classroomList()` | — | `Classroom[]`：name/searchName |
| `info.classroomState(building, week)` | 楼栋 name、周次 | `ClassroomStateResult`：validWeekNumbers/currentWeekNumber/classroomStates |
| `info.invoices(page)` | 页码 | `InvoicePage { data, count }` |
| `info.bankPayments()` | — | `BankPaymentByMonth[]` |
| `info.graduateIncome(begin, end)` | 日期串 | `GraduateIncome[] \| null`（仅研究生） |
| `info.dormScore()` | — | `string \| null`（宿舍卫生分） |
| `info.physicalExam()` | — | `[项目, 结论][]` |
| `info.assessmentList()` | — | `[课程名, 是否已评, 链接][]` |

### 4.3 coursex（info:read；跨学期课程检索）

| 方法 | 参数 | 返回 |
|---|---|---|
| `coursex.semesters()` | — | `CourseXSemester[]` |
| `coursex.search(q, semester?)` | 关键词、学期 id | `CourseXSummary[]` |
| `coursex.detail(id)` | 课程 id | `CourseXDetail \| { id, error } \| null` |

### 4.4 learn（learn:read；reply/post 需 learn:write）

| 方法 | 参数 | 返回 |
|---|---|---|
| `learn.semesters()` | — | `string[]`（学期 id 列表） |
| `learn.courses(semesterId?)` | 学期 id（缺省=当前） | `{ semester, courses: CourseInfo[] }` |
| `learn.homework(semesterId?)` | — | `(Homework & { courseName })[]` |
| `learn.notifications(semesterId?)` | — | `(Notification & { courseName })[]` |
| `learn.files(courseId, semesterId?)` | 课程 id | `CourseFile[]` |
| `learn.bbsBoards(wlkcid)` | 课程 id | `LearnBbsBoard[]`（讨论区版面） |
| `learn.bbsThreads(wlkcid, opts?)` | `{ bqid?, kind?: "yb"\|"jh"\|"cy", start?, length? }` | `{ total, threads: LearnBbsThreadSummary[] }` |
| `learn.bbsThread(wlkcid, threadId, bqId?)` | — | `LearnBbsThreadDetail` |
| `learn.bbsPosts(wlkcid, threadId, pageNum)` | — | `LearnBbsPost[]` |
| `learn.reply(wlkcid, threadId, content)` | 课程/帖子 id、正文 | `void`（**写**） |
| `learn.post(wlkcid, bqid, title, html)` | 版面 id、标题、HTML 正文 | `void`（**写**） |

### 4.5 venue（venue:read；cancel 需 venue:book）

| 方法 | 参数 | 返回 |
|---|---|---|
| `venue.scenes()` | — | `VenueScene[]`（场景列表） |
| `venue.currentPage(params)` | `{ sceneUuid, reserveDate, classTypeUuid?, siteType? }` | `VenueSite[] \| null`（可约场地） |
| `venue.myRecords(page?)` | 页码（默认 1） | `VenueRecord[]` |
| `venue.cancel(resvUuid)` | 记录 uuid | `void`（**写**，仅退订自己的预约） |
| `venue.jump(sceneUuid)` | 场景 uuid | `string`（官方预约页 URL——预约提交必须跳官方页完成） |

### 4.6 xk（xk:read）

| 方法 | 参数 | 返回 |
|---|---|---|
| `xk.search(opts)` | `{ kcm?, kch?, teacher?, semester?, page? }` | `XkSearchResult` |
| `xk.catalog(sem?)` | 学期 id | `XkCourse[]` |
| `xk.selected(sem?)` | — | `SelectedCourse[]` |
| `xk.detail(teacherId, code)` | 教师 id、课号 | `XkCourseDetail \| null` |
| `xk.reviews(course, teacher?)` | 课名、教师名 | `{ course, teacher, count, avg, reviews } \| null`（社区评价） |

### 4.7 kongjian（page/my 需 dorm:read；book/cancel 需 kongjian:book）

| 方法 | 参数 | 返回 |
|---|---|---|
| `kongjian.page(opts?)` | `{ spaceId?, roomId?, date? }` | `KongjianPage`（空间/房间/场次树） |
| `kongjian.my()` | — | `KongjianRecord[]` |
| `kongjian.book(bookUrl, info_)` | 页面返回的 bookUrl、`{ name, sid, tel, other }` | `string`（结果页） |
| `kongjian.cancel(target)` | 记录目标 | `void`（**写**） |

### 4.8 card / dorm / network

| 方法 | 返回 |
|---|---|
| `card.info()` | `CardInfo { balance(元), userId, userName, departmentName?, cardStatus?, … }` |
| `card.transactions(start, end)` | `CardTransaction[]`：summary/timestamp/amount/balance/address? |
| `dorm.eleRemainder()` | `EleRemainder { remainder(度), updateTime }` |
| `dorm.elePayRecord()` | `ElePayRecord[]`：name/time/channel/value/status（从未充值返回 `[]`） |
| `network.balance()` | `NetworkBalance { productName, usedBytes, accountBalance, … }` |
| `network.devices()` | `NetworkDevice[]`：ip4/mac/loggedAt |
| `network.deviceCount()` | `number` |
| `network.accountInfo()` | `NetworkAccountInfo { realName, userGroup, allowedDevices, … }` |

### 4.9 library（读 library:read；book/cancel 需 library:book）

调用链是**对象传递**：`list() → floors() → sections() → seats() → book()`，后一步入参
是前一步返回数组的元素（或其 id）。`dateChoice`：`0`=今天、`1`=明天。

| 方法 | 参数 | 返回 |
|---|---|---|
| `library.list()` | — | `Library[]`：id/zhName（如「北馆(李文正馆)」） |
| `library.floors(libraryId, dateChoice=0)` | — | `LibraryFloor[]`：id/zhName/zhNameTrace/**available/total** |
| `library.sections(floor, dateChoice=0)` | floors() 元素 | `LibrarySection[]`：id/zhName/zhNameTrace/available/total |
| `library.seats(section, dateChoice=0)` | sections() 元素 | `LibrarySeat[]`：id/zhName/type?/status?/hasPower? |
| `library.book(seat, sectionId, dateChoice=0)` | seats() 元素 + 所属 section id | `{ status?, msg? }`（成功判 msg 语义） |
| `library.records()` | — | `LibBookRecord[]`：id/pos/time/status/delId? |
| `library.cancel(recordId)` | records().id | `void`（**写**） |

### 4.10 libroom（研讨间；读 library:read，book/cancel 需 library:book）

| 方法 | 参数 | 返回 |
|---|---|---|
| `libroom.list()` | — | `LibRoomInfo[]`：kindId/kindName（如「音乐室」「研讨间」）/rooms |
| `libroom.resources(date, kindId)` | `"YYYY-MM-DD"`、list().kindId | `LibRoomRes[]`：devId/devName/roomName/**limit/maxMinute**/…（含当日可约时段） |
| `libroom.book(roomRes, start, end, memberAccNos=[])` | resources() 元素、`"YYYY-MM-DD HH:00"` 起/止、成员 accNo | `void`（失败 throw） |
| `libroom.records()` | — | `LibRoomBookRecord[]`：uuid/devName/date/begin/end/members |
| `libroom.cancel(uuid)` | records().uuid | `void`（**写**） |
| `libroom.fuzzyMember(keyword)` | 姓名或学号 | `LibFuzzySearchResult[]`：id(label)/department（id 即拼团 accNo） |

研讨间注意：①成员上限看 `roomRes.limit`；②首次使用的账号需在原站绑定过邮箱
（OneTHU 已自动绑 `学号@mails.tsinghua.edu.cn`，极少数未初始化账号报「会话未能建立」，
让用户进应用「预约」页手动进一次即可）；③时长上限 `maxMinute`。

### 4.11 nav / ui / storage / settings / net

| 方法 | 说明 |
|---|---|
| `nav.go(page, params?)` | 应用内跳转（page/params 见 §五） |
| `ui.toast(text)` | 底部气泡 3 秒（不阻塞） |
| `storage.get<T>(key)` / `set(key,v)` / `keys()` / `remove(key)` | 插件私有 KV（JSON 序列化；卸载即清） |
| `settings.get()` | `Record<string,string>`：用户在管理页填写的设置值 |
| `net.fetch(url, init?)` | **外部** HTTP(S)：`init { method?, headers?, body? }` → 标准 `Response`。经 Rust 传输层：无 CORS、无浏览器禁改头、45s 超时、跟随重定向。**不要**用它访问清华内网，校内业务一律走 onethu.* |

---

## 五、页面路由参考（nav.go）

| page | 说明 | 常用 params |
|---|---|---|
| `today` | 今日首页 | — |
| `learn` | 网络学堂 | — |
| `schedule` | 课表 | — |
| `info` | 信息聚合页 | `infoTab: "report"\|"exams"\|"news"\|"calendar"\|"profile"\|"courseinfo"\|"fitness"\|"evaluation"`、`infoNewsId`（新闻直达） |
| `life` | 生活聚合页 | `lifeTab: "dorm"\|"card"\|"washer"\|"hygiene"\|"invoice"\|"payroll"\|"gradincome"\|"network"` |
| `reserve` | 预约聚合页 | `reserveTab: "lib"\|"room"\|"classroom"\|"sports"\|"kongjian"` |
| `zhjwxk` | 选课系统 | — |
| `otherinfo` | 其他 Info 应用 | — |
| `settings` | 设置 | — |
| `plugins` | 插件管理页 | — |
| `learn-course` 等子页 | 网络学堂详情 | `courseId`、`itemId`（详见 `state/app.tsx` 的 LearnNav） |

例：订完座位跳过去看——`onethu.nav.go("reserve", { reserveTab: "lib" })`。

---

## 六、网络与错误约定

### 6.1 错误类型

| 错误 | 判定 | 插件应当 |
|---|---|---|
| `PluginPermissionError` | 类名 / message 含「未获授权」 | 提示用户重装并授予对应权限 |
| `AuthRequiredError` | message 含「会话未能建立」 | 提示用户打开应用重新登录，**不要**重试 |
| 网络/解析错误 | 其余 `Error` | 可重试一次再报错 |

### 6.2 net.fetch 调大模型示例（DeepSeek，OpenAI 兼容）

```js
const res = await ctx.onethu.net.fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
});
if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
const reply = (await res.json()).choices[0].message.content;
```

Anthropic 兼容端点换 header（`x-api-key` + `anthropic-version`）即可。

---

## 七、JS 模块插件开发

一个 ES 模块文本，两个导出：

```js
export const manifest = {
  id: "onethu.hello",
  name: "Hello 插件",
  version: "0.1.0",
  description: "读余额 + 跳转 + toast 的最小演示",
  permissions: ["user:read", "card:read", "nav", "ui"],
};

export default async function activate(ctx) {
  ctx.registerCommand(
    { id: "demo", title: "查余额并跳转", inputLabel: "备注", inputPlaceholder: "随便写" },
    async (input) => {
      const c = await ctx.onethu.card.info();
      ctx.onethu.ui.toast(`${c.userName} 余额 ¥${c.balance.toFixed(2)}`);
      ctx.onethu.nav.go("life", { lifeTab: "card" });
      return `余额 ${c.balance} 元；备注：${input || "(无)"}；会话 ${ctx.onethu.session.status()}`;
    },
  );
}
```

- `ctx`：`{ onethu, registerCommand(cmd, run), log(line) }`；activate 返回值可含
  `dispose()` 供停用清理。
- 安装：设置 → 插件 → 粘贴代码 → 安装 → 展开卡片 →（可选填设置）→ 点命令按钮；
  返回值 string 直接展示，异常显示前 200 字符。
- 日期一律 `"YYYY-MM-DD"`；`dateChoice` 是枚举不是日期（今天 0 / 明天 1）。
- 对象传递的坑：`book(seat, sectionId)` 的 seat 必须是 seats() 返回的元素——工具实现里
  自己按 id 查找元素再传，别让外部（如 LLM）编造对象。

---

## 八、Rust sidecar 插件协议

### 8.1 形态与安装

```
my-plugin/
├── manifest.json      # 清单（kind: "rust"，bin 与二进制同名）
└── my-plugin-binary   # cargo build --release 产物
```

安装：桌面端 OneTHU → 设置 → 插件 → 「Rust 骨干插件（选 manifest.json）」。
仅桌面端（macOS/Windows/Linux）；Android 无任意路径执行权限，第三方 Rust 插件
不支持移动端（见 `docs/mobile-rust-plugin-advisory.md`）。

### 8.2 JSON-RPC 协议（stdio，每行一个 JSON）

**宿主 → 插件（stdin）**

| 消息 | 说明 |
|---|---|
| `{"jsonrpc":"2.0","id":1,"method":"activate","params":{"settings":{…},"permissions":[…]}}` | 进程拉起后立即握手。**必须应答**，result 约定含命令清单 `{"commands":[{ "id","title","inputLabel?","inputPlaceholder?","dock?" }]}` |
| `{"jsonrpc":"2.0","id":2,"method":"run","params":{"command":"chat","input":"用户输入"}}` | 执行命令。长任务边跑边发 progress；**必须应答**最终结果（string 或 §九 结构化 JSON） |
| `{"jsonrpc":"2.0","method":"interrupt","params":{}}` | 打断（通知，无 id 不应答）——立即停止当前 run 并以 error 或部分结果应答 |
| `{"jsonrpc":"2.0","id":3,"method":"dispose","params":{}}` | 停用/卸载前优雅退出；应答后自行 exit(0) |

**插件 → 宿主（stdout）**

| 消息 | 说明 |
|---|---|
| `{"jsonrpc":"2.0","id":100,"method":"onethu.call","params":{"ns":"library","method":"floors","args":[392,0]}}` | 调用 §四 任一 API：`ns`+`method`+`args`（按位置）。宿主转 webview 门面（同一套权限门禁）执行后回写 `"result"`；无权限/出错收到 `"error":{"message":"…"}` |
| `{"jsonrpc":"2.0","method":"progress","params":{…}}` | 实时进度（§九.3：`text/step/total` 或带 `kind`） |
| `{"jsonrpc":"2.0","method":"log","params":{"line":"…"}}` | 轨迹面板日志行 |

stderr（`eprintln!`）与非 JSON 的 stdout 行也会作为 log 显示——开发期随便打。

### 8.3 最小 Rust 骨架

> **已踩平的坑**：`for line in stdin().lock().lines()` 全程持锁，循环体内再
> `stdin().lock()` 读应答 = std 锁不可重入 → **死锁**。必须全程只 lock 一次，
> `onethu()` 复用同一个 `&mut StdinLock`。

```rust
use serde_json::{json, Value};
use std::io::{BufRead, StdinLock, Write};

fn send(v: &Value) {
    let mut s = serde_json::to_string(v).unwrap();
    s.push('\n');
    let _ = std::io::stdout().write_all(s.as_bytes());
    let _ = std::io::stdout().flush();
}

/// 调一次宿主 API：复用外层唯一的 stdin 锁（嵌套 lock 必死锁）
fn onethu(in_: &mut StdinLock, id: &mut u64, ns: &str, method: &str, args: Value) -> Result<Value, String> {
    *id += 1;
    let rid = *id;
    send(&json!({"jsonrpc":"2.0","id":rid,"method":"onethu.call","params":{"ns":ns,"method":method,"args":args}}));
    let mut line = String::new();
    in_.read_line(&mut line).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if let Some(err) = v.get("error") { return Err(err.to_string()); }
    Ok(v.get("result").cloned().unwrap_or(Value::Null))
}

fn main() {
    let mut next_id: u64 = 1000;
    let stdin = std::io::stdin();
    let mut handle = stdin.lock(); // 全程唯一锁
    let mut line = String::new();
    loop {
        line.clear();
        if handle.read_line(&mut line).unwrap_or(0) == 0 { break; }
        let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let mid = msg.get("id").cloned();
        match msg.get("method").and_then(|m| m.as_str()) {
            Some("activate") => send(&json!({"jsonrpc":"2.0","id":mid,"result":{"commands":[
                {"id":"run","title":"执行任务","inputLabel":"指令","inputPlaceholder":"例：明天图书馆哪有空座"}]}})),
            Some("run") => {
                send(&json!({"jsonrpc":"2.0","method":"progress","params":{"text":"开始…","step":1,"total":2}}));
                let status = onethu(&mut handle, &mut next_id, "session", "status", json!([]));
                send(&json!({"jsonrpc":"2.0","id":mid,"result":format!("会话状态：{status:?}")}));
            }
            Some("dispose") => { if let Some(id) = mid { send(&json!({"jsonrpc":"2.0","id":id,"result":null})); } std::process::exit(0); }
            Some("interrupt") => { /* 置标志位，agent 循环每步检查（R4） */ }
            _ => {}
        }
    }
}
```

（可运行骨架在 `docs/examples/harness-skel/`，可直接 `cargo build`。）

### 8.4 时序与约束

- **run 应答超时默认 10 分钟**（自调用发出计到应答到达；progress 不重置计时）。
  超时只是该次调用报错：进程仍在跑、可继续 onethu.call/progress、可打断。
- 单线程顺序调用足够（agent 循环天然顺序）；并发调用需自己管理请求 id 配对。
- 退出码非 0 / stdout 关闭 → 宿主发 `exit` 事件并在 UI 标记，进程表自动清理。
- 二进制路径含空格没问题；**不要**依赖工作目录（宿主不保证 cwd）。
- onethu.call 未声明的权限照样被门禁拒绝（错误消息含权限名）——行为与 JS 插件一致。

---

## 九、对话面板（dock）协议

宿主内置**通用对话面板**（ChatDock，左下角常驻气泡）：任何 rust 插件只要在 activate
应答的 `commands` 里声明 `dock: true` 的命令，宿主即自动为其渲染面板。面板只是宿主
胶水，agent 逻辑全部在插件侧（不影响 R1）。

### 9.1 activate 应答约定

```json
{ "commands": [
  { "id": "chat", "title": "对话", "inputLabel": "对 OH 说",
    "inputPlaceholder": "…", "dock": true },
  { "id": "new_session", "title": "新建会话" },
  { "id": "export_session", "title": "导出会话 JSON", "inputLabel": "会话 id（留空=当前）" }
]}
```

`dock: true` 的命令即对话入口：面板发消息 = `run { command: "<该命令 id>", input: "<用户输入>" }`；
其余命令照旧渲染在插件管理页。

### 9.2 chat 命令结果（结构化 JSON）

```json
{
  "type": "chat", "ok": true,
  "answer": "模型最终回答（或确认语/打断语）",
  "sessionId": "s…", "interrupted": false,
  "confirm": { "summary": "将执行的操作摘要" },
  "usage":         { "prompt": 0, "completion": 0, "calls": 0, "costUsd": 0 },
  "sessionUsage":  { "prompt": 0, "completion": 0, "costUsd": 0 },
  "totalUsage":    { "prompt": 0, "completion": 0, "calls": 0, "costUsd": 0,
                     "budgetUsd": 2, "budgetLeftUsd": 1.9 }
}
```

- `confirm` 非空时面板渲染「确认执行 / 取消」（用户确认 = 发送文本「确认」）——
  **所有写操作（订/退/发帖）必须走此两段式**。
- `ok: false` 时 `error` 字段为失败原因（面板按错误气泡渲染）。

### 9.3 进度通知扩展（progress.params.kind）

| kind | params | 面板行为 |
|---|---|---|
| `delta` | `text`（回答增量） | 追加到流式气泡 |
| `think` | `text`（思考增量，建议 ≥160 字节再发） | 「思考中」指示 |
| `tool` | `text`（工具轨迹行） | 轨迹区追加 |
| `notice` | `text`（状态行，如「思考中…（第 2 步）」） | 状态显示 |
| `usage` | §9.2 的用量结构 | 底栏实时刷新 |

不带 `kind` 的 progress/log/exit 走插件管理页轨迹面板，两不误。

### 9.4 会话管理命令（约定命名）

`new_session` / `list_sessions` / `switch_session`(input=id) / `delete_session`(input=id) /
`export_session`(input=id，空=当前) / `import_session`(input=会话 JSON) /
`usage_report` / `selftest`。各自返回结构化 JSON（参考 OneTHU-Harness README）。

---

## 十、Android 内嵌形态

Android WebView 沙箱无任意路径二进制执行权限，§八 sidecar 不可用。官方 Harness 的
解法：**同一份 Rust 核心直接编进 App 进程**（无独立进程；协议不走 stdio，走 Tauri
命令桥）。第三方插件不适用本形态（见 `docs/mobile-rust-plugin-advisory.md`）。

### 10.1 工作区结构

`plugins/OneTHU-Harness` 是 Cargo 工作区：

```
core/   onethu-harness-core（库）：agent/llm/tools/session/usage/config，
        只依赖 host.rs 的两个 trait——Host（onethu.call 数据面 + 打断标志）、
        Emit（progress/log 通知）——不含任何 stdio/进程概念
bin/    onethu-harness（薄壳）：StdioHost/StdioEmit + stdin/stdout 泵（桌面形态）
```

宿主无关性是内嵌的前提：OneTHU `src-tauri` 以 path 依赖引入 core，App 内桥实现
Host/Emit。

### 10.2 宿主命令（src-tauri/harness_embed.rs）

| Tauri 命令 | 签名 | 语义 |
|---|---|---|
| `harness_start(pluginId)` | async | 起 agent 线程 + 桥线程，返回 activate 应答（commands 清单） |
| `harness_call(pluginId, method, params, timeoutMs?)` | async（执行体在线程池） | activate/run/dispose 同通道；非 chat 的 run 走快速路就地分发，不被在跑长任务阻塞 |
| `harness_notify(pluginId, "interrupt", {})` | async | AtomicBool 快路径打断（与 stdio 读线程同语义） |
| `harness_rpc_reply(pluginId, id, ok, result)` | async | webview 门面执行完 onethu.call 后回写 |
| `harness_stop(pluginId)` | async | 摘表 + 打断 + Dispose + 补发 exit 事件 |
| `harness_bridge_take(pluginId)` | async 长轮询 | JS 泵专用：挂起至多 25s 等待队列，一次取走整批待处理 onethu.call |

> **实现红线（0.8.0 实录）**：宿主命令必须 async。Tauri v2 同步命令在主线程执行——
> 曾因同步版 `harness_bridge_take` 用 Condvar 空等 25s 独占主线程，导致安卓端全部
> 操作 ≥10s 的全局冻结。现全部命令 async + 阻塞等待落线程池。

### 10.3 调用链

```
core Host::call ─▶ 桥线程 ─▶ 全局 tokio mpsc 队列 ──唤醒──▶ JS 泵 harness_bridge_take
                                                            │ 批量取走
                                                            ▼
                                              webview 门面 bindRustApi
                                            （与 JS/sidecar 插件同一套权限门禁）
                                                            │ invoke http_request
                                                            │ （Rust reqwest，异步）
                                                            ▼
                                          harness_rpc_reply ─▶ 桥线程回写 core
```

- 门面未绑定时的回执走**双命令兜底**：先试 `harness_rpc_reply`，失败再试
  `plugin_rpc_reply`（sidecar 通道），杜绝回执丢失导致的挂等。
- `Emit::notify` → `plugin-event` 事件，与 plugins.rs 的 sidecar 泵逐字段一致，
  对话面板/轨迹面板零改动复用。
- 设置与会话存储仍经 storage.* 落 webview localStorage，每次 run 实时读。

### 10.4 内置种子与形态路由

- loader.ts 在 Android UA（`/android/i.test(navigator.userAgent)`）下开机种入
  `onethu.harness` 内置记录（`builtin + embedded: true`，镜像子模块 manifest.json）；
  管理页可停用/配置但**不可删除**，删除后下次开机自动恢复。
- rust.ts 按 `embeddedIds` 分轨：调用/通知/回执分别走 `harness_*` 或 `plugin_*`
  命令；桌面端行为零变化（文件选择器安装 manifest.json + 二进制 sidecar）。

---

## 十一、调试与日志

- 插件日志：`ctx.log(line)`（JS）/ `log` 通知 + stderr（Rust）→ 应用调试通道，
  前缀 `[PLUGIN:<id>]`。桌面 `/tmp/onethu-debug.log`；Android `adb logcat -s onethu`。
- 命令异常：管理页命令按钮下直接显示前 200 字符；对话面板按错误气泡渲染。
- Rust sidecar 端到端自测（不依赖 OneTHU 与真实网络）：宿主模拟器
  `test/sim_host.mjs`——假 OpenAI SSE 服务器 + 宿主门面，覆盖握手→工具循环→
  流式→用量→会话→两段式确认→dispose 全链断言。

## 十二、参考实现与示例

| 资源 | 位置 |
|---|---|
| OH（官方骨干插件，sidecar + 内嵌双形态） | [plugins/OneTHU-Harness](https://github.com/smartThise/OneTHU-Harness) |
| Rust sidecar 可编译骨架 | `docs/examples/harness-skel/` |
| 宿主模拟器（端到端自测） | OneTHU-Harness `test/sim_host.mjs` |
| API 面与权限真源 | `apps/desktop/src/plugins/types.ts` |
| 领域类型真源 | `packages/core/src/info/types.ts` |
| 移动端 Rust 插件通告 | `docs/mobile-rust-plugin-advisory.md` |

---

### 文档版本记录

| 版本 | 要点 |
|---|---|
| v1（0.8.0） | 全量重写：权限表 11→17 项（learn/venue/xk/kongjian 新增）；API 参考 12→18 命名空间（learn/venue/xk/kongjian/coursex 新增）；Android 内嵌章节更新为异步桥（长轮询批量泵 + 全命令 async）；对话面板协议独立成章 |
| v0（0.7.x） | 初版指南：JS 插件 + 11 项权限 + sidecar 协议 + 初代内嵌桥 |
