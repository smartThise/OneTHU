# OneTHU 项目介绍与插件接口指南

> 面向对象：准备开发 OneTHU 插件（第一个官方插件：**OneTHU Harness**——大模型驱动的
> 自动查询/总结/跳转/图书馆预约助手）的 Agent 或开发者。
> 本文自足：读完即可不动 OneTHU 本体代码写出一个完整插件。

---

## 一、OneTHU 是什么

OneTHU 是清华大学校园服务一体化桌面/移动应用（Tauri 2 + React + TypeScript，pnpm monorepo）：

```
packages/core            领域核心（不依赖 UI）
  ├─ src/auth/           登录与会话：id 统一认证（SM2 + checkSingle + 2FA）、
  │                      webvpn 包装、learn/card/info 各服务漫游
  ├─ src/info/           InfoClient：约 70 个原子操作（成绩/考试/新闻/图书馆/
  │                      研讨间/校园卡/电费/校园网/空教室/发票…），内置会话自愈
  │                      （#withRenew 失登自动重建）、TTL 缓存、乐观会话
  ├─ src/http.ts         HttpClient：per-domain cookie 桶、webvpn 包装分流、
  │                      重登单飞、wengine 引导页处理
  └─ src/crypto/webvpn.ts  wengine 域名加解密（webvpnWrap/decodeUrl）
apps/desktop             桌面/移动壳（同一套代码构建 macOS dmg 与 Android apk）
  ├─ src/lib/clients.ts  单例装配：http / info / session
  ├─ src/lib/transport.rs↔ts  Rust reqwest 逐跳传输（无 CORS、显式 Cookie、
  │                      重定向链续包装——「粘性 webvpn」防通道分裂）
  ├─ src/plugins/        ★ 插件系统（本文对象）
  └─ src/pages/          页面（今日/网络学堂/课表/信息/生活/预约/选课/收藏夹/设置）
```

### 网络层三条铁律（写 Harness 时如果直接用 net.fetch 也要知道）

1. **票据通道定律**：CAS 票据兑在哪个通道，会话就建在哪个通道。OneTHU 内部已处理好，
   插件经 `onethu.*` 调用完全无感；只有 `onethu.net.fetch` 访问**清华内网**时需要自己注意
   （内网域校外不可达，需要 webvpn 包装——建议 Harness 不直接碰内网，全走 onethu.*）。
2. **会话自愈**：任何 `onethu.*` 调用在会话失效时会自动重建后重试（relogin 单飞），
   失败抛 `AuthRequiredError`（message 含「会话未能建立」字样）——Harness 应提示用户
   重新打开应用登录，而不是无限重试。
3. **45s 超时**：所有请求（含 net.fetch）45 秒兜底超时，不会无限悬挂。

---

## 二、插件系统模型（v1）

### 2.1 插件是什么

一个 **ES 模块文本**（.js 文件），两个导出：

```js
export const manifest = {
  id: "onethu.harness",          // 唯一 id（小写字母/数字/`.`/`-`）
  name: "OneTHU Harness",
  version: "0.1.0",
  author: "你的名字",
  description: "大模型驱动的校园助手",
  permissions: ["user:read", "info:read", "library:read", "library:book", "nav", "ui", "storage", "net:external"],
  settings: [                     // 可选：应用代渲染的设置表单
    { key: "apiKey", label: "API Key", type: "password", placeholder: "sk-…" },
    { key: "baseUrl", label: "API Base URL", type: "text", default: "https://api.deepseek.com" },
    { key: "model", label: "模型", type: "text", default: "deepseek-chat" },
  ],
};

export default async function activate(ctx) {
  // ctx: { onethu, registerCommand, log }
  ctx.registerCommand(
    { id: "run", title: "执行任务", inputLabel: "指令", inputPlaceholder: "例：帮我看看明天图书馆哪里有空位" },
    async (input) => { /* …agent loop… */ return "结果文本"; },
  );
  return { dispose() { /* 可选：停用清理 */ } };
}
```

- 安装入口：**设置 → 插件**（粘贴代码或选 .js 文件）。
- 插件代码在应用同域执行，是**受信代码**；权限门禁约束的是 `onethu.*` API 的可见面
  （未声明权限的方法调用抛 `PluginPermissionError`），不是代码沙箱。
- 生命周期：安装即激活；停用 = 调 dispose 后卸载模块；删除 = 停用 + 清除插件私有存储。
  应用启动时自动恢复激活所有已启用的插件。
- 设置值由用户在管理页填写，插件用 `ctx.onethu.settings.get()` 读取（`Record<string,string>`）。
- 命令带可选输入框（`inputLabel`），管理页点按钮执行，返回值 string 直接展示。

### 2.2 权限清单（manifest.permissions）

| 权限 | 管理解释 | 门禁的 API |
|---|---|---|
| `user:read` | 基本信息+会话状态 | session.*, user.* |
| `info:read` | 信息门户只读 | info.* |
| `card:read` | 校园卡只读 | card.* |
| `dorm:read` | 宿舍只读 | dorm.* |
| `library:read` | 图书馆查询（座位+研讨间） | library/libroom 的读方法 |
| `library:book` | 图书馆预约/取消（写） | library.book/cancel、libroom.book/cancel |
| `network:read` | 校园网账户只读 | network.* |
| `nav` | 应用内跳转 | nav.go |
| `ui` | toast | ui.toast |
| `storage` | 私有存储 | storage.*、settings.get |
| `net:external` | 外部 HTTP 请求 | net.fetch |

注意：**v1 不暴露任何体育馆（sports）接口**（官方约束：Harness 不含体育馆），
也不暴露充值/改密等资金与凭据写操作。

---

## 三、API 完整参考（ctx.onethu.*）

所有方法均返回 Promise（除 session.status/username、ui.toast、storage 同步族、nav.go）。
失败统一 throw `Error`；会话类失败为 `AuthRequiredError`。

### 3.1 session / user

| 方法 | 返回 | 说明 |
|---|---|---|
| `session.status()` | `"ready" \| "demo" \| "logged-out" \| "connecting" \| "2fa" \| "booting"` | 应用会话状态；执行任务前建议检查为 `ready` |
| `session.username()` | `string \| null` | 登录名（学号或自定义用户名） |
| `user.info()` | `BasicUserInfo { name, studentId, gender?, department?, major?, email? }` | 基本信息（会触发一次 info 漫游，首次几秒） |

### 3.2 info（权限 info:read）

| 方法 | 参数 | 返回 |
|---|---|---|
| `info.schedule(start, end)` | `"YYYY-MM-DD"` 起/止 | `ScheduleEntry[]`：courseName/teacher/date/location/startTime/endTime/weekText/category |
| `info.report()` | — | `ReportRow[]`：name/credit/grade/point/semester |
| `info.exams()` | — | `ExamEntry[]`：courseName/date/startTime/endTime/location |
| `info.deadlines()` | — | `DeadlineItem[]`：title/begin?/end?（学校重要事项） |
| `info.news(page?)` | 页码从 1 | `NewsItem[]`：name/xxid/date?/source? |
| `info.newsDetail(xxid)` | 新闻 id | `NewsDetail`（正文文本） |
| `info.searchNews(keyword, page?)` | — | `NewsItem[]` |
| `info.schoolCalendar()` | — | `SchoolCalendarData`：学期起止 + nextSemesterList |
| `info.classroomList()` | — | `Classroom[]`：name（楼栋）/searchName |
| `info.classroomState(building, week)` | 楼栋 name、周次 | `ClassroomStateResult`：validWeekNumbers/currentWeekNumber/classroomStates（每教室每节次占用） |
| `info.invoices(page)` | 页码 | `InvoicePage { data, count }` |
| `info.bankPayments()` | — | `BankPaymentByMonth[]` |
| `info.graduateIncome(begin, end)` | 日期串 | `GraduateIncome[] \| null`（仅研究生有数据） |
| `info.dormScore()` | — | `string \| null`（宿舍卫生分） |
| `info.physicalExam()` | — | `[项目, 结论][]` |
| `info.assessmentList()` | — | `[课程名, 是否已评, 链接][]` |

### 3.3 card / dorm / network

| 方法 | 返回 |
|---|---|
| `card.info()` | `CardInfo { balance, userId, userName, departmentName?, cardStatus?, … }`（balance 单位元） |
| `card.transactions(start, end)` | `CardTransaction[]`：summary/timestamp/amount/balance/address? |
| `dorm.eleRemainder()` | `EleRemainder { remainder(度), updateTime }` |
| `dorm.elePayRecord()` | `ElePayRecord[]`：name/time/channel/value/status（从未充值账号返回 `[]`） |
| `network.balance()` | `NetworkBalance { productName, usedBytes, accountBalance, … }` |
| `network.devices()` | `NetworkDevice[]`：ip4/mac/loggedAt |
| `network.deviceCount()` | `number` |
| `network.accountInfo()` | `NetworkAccountInfo { realName, userGroup, allowedDevices, … }` |

### 3.4 library（座位，权限 library:read；book/cancel 需 library:book）

调用链是**对象传递**：`list() → floors() → sections() → seats() → book()`，后一步的入参
就是前一步返回数组里的元素（或其 id）。`dateChoice`：`0`=今天、`1`=明天。

| 方法 | 参数 | 返回 |
|---|---|---|
| `library.list()` | — | `Library[]`：id/zhName（如「北馆(李文正馆)」） |
| `library.floors(libraryId, dateChoice=0)` | — | `LibraryFloor[]`：id/zhName/zhNameTrace/**available/total**（余量） |
| `library.sections(floor, dateChoice=0)` | floors() 元素 | `LibrarySection[]`：id/zhName/zhNameTrace/available/total |
| `library.seats(section, dateChoice=0)` | sections() 元素 | `LibrarySeat[]`：id/zhName/type?/status?/hasPower? |
| `library.book(seat, sectionId, dateChoice=0)` | seats() 元素 + 所属 section id | `{ status?, msg? }`（成功 status=1 或 msg 含成功语义；具体判 msg） |
| `library.records()` | — | `LibBookRecord[]`：id/pos/time/status/delId? |
| `library.cancel(recordId)` | records().id | `void` |

### 3.5 libroom（研讨间，权限同上；userId 全部自动注入）

| 方法 | 参数 | 返回 |
|---|---|---|
| `libroom.list()` | — | `LibRoomInfo[]`：kindId/kindName（如「音乐室」「研讨间」）/rooms |
| `libroom.resources(date, kindId)` | `"YYYY-MM-DD"`、list().kindId | `LibRoomRes[]`：devId/devName/roomName/**limit/maxMinute**/…（含该资源当日可约时段，字段随类型） |
| `libroom.book(roomRes, start, end, memberAccNos=[])` | resources() 元素、`"YYYY-MM-DD HH:00"` 起/止 | `void`（失败 throw，message 含原因） |
| `libroom.records()` | — | `LibRoomBookRecord[]`：uuid/devName/date/begin/end/members |
| `libroom.cancel(uuid)` | records().uuid | `void` |
| `libroom.fuzzyMember(keyword)` | 姓名或学号 | `LibFuzzySearchResult[]`：id(label)/department（id 即拼团用的 accNo） |

**研讨间注意**：①成员上限看 `roomRes.limit`（发起人不算在内时按 UI 同语义传）；
②首次使用研讨间的账号需在原站绑定过邮箱，OneTHU 已做自动绑定
（学号@mails.tsinghua.edu.cn），极少数未初始化账号会报「会话未能建立」，让用户进
应用「预约」页手动进一次即可；③时长上限 `maxMinute`。

### 3.6 nav / ui / storage / settings / net

| 方法 | 说明 |
|---|---|
| `nav.go(page, params?)` | 应用内跳转。page 取值与 params 见 §四 |
| `ui.toast(text)` | 底部气泡 3 秒（不阻塞） |
| `storage.get<T>(key)` / `set(key,v)` / `keys()` / `remove(key)` | 插件私有 KV（JSON 序列化；卸载即清） |
| `settings.get()` | `Record<string,string>`：用户在管理页填写的设置值 |
| `net.fetch(url, init?)` | **外部** HTTP(S)：`init { method?, headers?, body? }` → 标准 `Response`（`res.json()/res.text()`）。经 Rust 传输层：无 CORS、无浏览器禁改头、45s 超时、跟随重定向。**不要**用它访问清华内网（校外不可达），校内业务一律走 onethu.* |

`net.fetch` 调大模型示例（DeepSeek）：

```js
const res = await ctx.onethu.net.fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: prompt }],
  }),
});
if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
const data = await res.json();
const reply = data.choices[0].message.content;
```

Anthropic 兼容端点同理换 header（`x-api-key` + `anthropic-version`）。

---

## 四、页面路由（nav.go 可用值）

| page | 说明 | 常用 params |
|---|---|---|
| `today` | 今日首页 | — |
| `learn` | 网络学堂 | — |
| `schedule` | 课表 | — |
| `info` | 信息聚合页 | `infoTab: "report"\|"exams"\|"news"\|"calendar"\|"profile"\|"courseinfo"\|"fitness"\|"evaluation"`、`infoNewsId`(新闻直达) |
| `life` | 生活聚合页 | `lifeTab: "dorm"\|"card"\|"washer"\|"hygiene"\|"invoice"\|"payroll"\|"gradincome"\|"network"` |
| `reserve` | 预约聚合页 | `reserveTab: "lib"\|"room"\|"classroom"\|"sports"\|"kongjian"` |
| `zhjwxk` | 选课系统 | — |
| `otherinfo` | 其他 Info 应用 | — |
| `settings` | 设置 | — |
| `learn-course` 等子页 | 网络学堂详情 | `courseId`、`itemId`（详见 state/app.tsx 的 LearnNav） |

例：订完座位跳过去看——`ctx.onethu.nav.go("reserve", { reserveTab: "lib" })`。

---

## 五、Harness 制作配方（建议实现）

1. **设置项**：`apiKey`(password)、`baseUrl`(text)、`model`(text)、可选 `maxSteps`(number 文本)。
2. **命令**：`run`（带指令输入框）。执行流程：
   1. `session.status()` ≠ `"ready"` → 直接返回「请先打开应用登录」；
   2. 组装系统提示词（含当前日期、`user.info()` 摘要）；
   3. **工具循环**：给模型的工具用普通函数调用协议（或 JSON 指令协议），每个工具
      就是一次 `onethu.*` 调用。建议工具集：
      `query_schedule / query_exams / query_card / query_ele / query_news / search_news /
       query_library_seats(libId,dateChoice) / book_library_seat(libId,floorIdx,sectionIdx,seatIdx,dateChoice) /
       query_libroom_resources(kindId,date) / book_libroom(...) / my_reservations / cancel_reservation /
       navigate(page,params) / notify(text)`；
   4. 每步把工具结果 JSON 回灌模型，直到模型给最终答复（限步防环，建议 ≤12 步）；
   5. **预约类工具（book/cancel）建议加确认**：模型先说意图 → 用户在输入框回「y」再执行，
      或直接执行但在 toast 里报结果（v1 简单起见可后者，设置项留 `confirmBeforeBook` 开关）。
3. **对象传递的坑**：模型只给 id 不够——`book(seat, sectionId)` 的 seat 必须是 seats()
   返回的元素（含 type 等字段）。工具实现里自己按 id 查找元素再传，别让模型编对象。
4. **总结类任务**：`report()+exams()+deadlines()` 拼给模型即可；新闻用 `searchNews`。
5. **日期**：所有接口日期串 `"YYYY-MM-DD"`；`dateChoice` 是枚举不是日期——今天 0 明天 1。
6. **日志**：`ctx.log(line)` 进应用调试通道（桌面 `/tmp/onethu-debug.log`，Android
   `adb logcat -s onethu`），排障神器。
7. **错误分类处理**：`PluginPermissionError`（缺权限→提示重装授权）、`AuthRequiredError`
   （会话失效→提示重开应用）、网络/解析错误（重试一次再报）。

---

## 六、最小可安装示例（hello 插件）

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

安装：设置 → 插件 → 粘贴 → 安装插件 → 展开卡片 → （可选填设置）→ 点「查余额并跳转」。

## 七、调试与反馈

- 插件日志：`[PLUGIN:<id>] <line>`（应用调试通道，见 §五.6）。
- 插件本身抛错：管理页命令按钮下直接显示前 200 字符。
- 权限不足：调用被门禁拦截抛 `PluginPermissionError`，message 说明缺哪个权限。
- OneTHU 本体仓库：`/Volumes/PortableSSD/Projects/thuapp/OneTHU`（main 分支）；类型
  定义真源：`apps/desktop/src/plugins/types.ts`（API 面）与 `packages/core/src/info/types.ts`（领域类型）。

