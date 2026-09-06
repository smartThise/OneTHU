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


---

## 八、Rust 骨干插件（课程 R1 合规形态）★ Harness 必读

> 课程硬性要求 R1：**核心业务逻辑（数据处理、算法流程、API 调用编排）必须用 Rust 写，
> 主控流程必须在 Rust 里。** 因此 OneTHU Harness 不能写成 JS 模块插件，而要用本节形态：
> 一个 Rust 编译出的**独立进程（sidecar）**，agent 主控循环（LLM 调用、工具编排、
> token 统计、上下文管理）全部在 Rust 里；OneTHU 宿主负责拉起进程、喂原子数据、渲染进度。

### 8.1 形态与安装

```
my-harness/
├── manifest.json     # 清单（kind: "rust"）
└── onethu-harness    # cargo build --release 出的二进制（名字与 manifest.bin 一致）
```

manifest.json（注意 kind 与 bin）：

```json
{
  "id": "onethu.harness",
  "kind": "rust",
  "bin": "onethu-harness",
  "name": "OneTHU Harness",
  "version": "0.1.0",
  "description": "大模型驱动的校园助手（Rust 骨干）",
  "permissions": ["user:read", "info:read", "card:read", "dorm:read",
                  "library:read", "library:book", "nav", "ui", "storage", "net:external"],
  "settings": [
    { "key": "apiKey", "label": "API Key", "type": "password", "placeholder": "sk-…" },
    { "key": "baseUrl", "label": "API Endpoint", "type": "text", "default": "https://api.deepseek.com/v1" },
    { "key": "model", "label": "模型", "type": "text", "default": "deepseek-chat" },
    { "key": "priceIn", "label": "输入价格 $/1M tokens", "type": "text", "default": "0.27" },
    { "key": "priceOut", "label": "输出价格 $/1M tokens", "type": "text", "default": "1.10" },
    { "key": "budget", "label": "Token 预算", "type": "text", "default": "200000" }
  ]
}
```

安装：桌面端 OneTHU → 设置 → 插件 → 「Rust 骨干插件（选 manifest.json）」选 manifest.json
（二进制须在**同目录同名**）。仅桌面端可用（Android 无任意路径执行）；装的是本地路径，
删除只是解除登记，不删文件。

### 8.2 JSON-RPC 协议（stdio，每行一个 JSON）

**宿主 → 插件（stdin）**

| 消息 | 说明 |
|---|---|
| `{"jsonrpc":"2.0","id":1,"method":"activate","params":{"settings":{…},"permissions":[…]}}` | 进程拉起后立即握手。**必须应答**，约定 result 里带命令清单：`{"commands":[{"id":"run","title":"执行任务","inputLabel":"指令","inputPlaceholder":"…"}]}`（管理页据此渲染按钮） |
| `{"jsonrpc":"2.0","id":2,"method":"run","params":{"command":"run","input":"用户指令"}}` | 用户点了命令按钮。超长任务边跑边发 progress；**必须应答**最终结果（string 展示） |
| `{"jsonrpc":"2.0","method":"interrupt","params":{}}` | 用户点了「打断」（通知，无 id 不应答）——立即停止当前 run 并以 error 或部分结果应答 |
| `{"jsonrpc":"2.0","id":3,"method":"dispose","params":{}}` | 停用/卸载前优雅退出，应答后自行 exit(0) |

**插件 → 宿主（stdout）**

| 消息 | 说明 |
|---|---|
| `{"jsonrpc":"2.0","id":100,"method":"onethu.call","params":{"ns":"library","method":"floors","args":[392,0]}}` | 调用 §三 的任一 API：`ns`+`method`+`args`（方法签名去掉 `onethu.` 前缀）。宿主转 webview 门面执行（**同样的权限门禁**），把返回值写回 `"result"`；无权限/出错时收到 `"error":{"message":"…"}` |
| `{"jsonrpc":"2.0","method":"progress","params":{"text":"正在查询北馆 3 楼…","step":2,"total":6}}` | 实时进度（R4），管理页轨迹面板即时渲染 |
| `{"jsonrpc":"2.0","method":"log","params":{"line":"…"}}` | 轨迹面板日志行 |

stderr（`eprintln!`）与非 JSON 的 stdout 行也会作为 log 显示——开发期随便打。

### 8.3 最小 Rust 骨架（已实测：与宿主模拟器 5/5 握手通过；仓库 `docs/examples/harness-skel/` 可直接 cargo build）

> **已踩平的坑**：`for line in stdin().lock().lines()` 全程持锁，循环体内再
> `stdin().lock()` 读 onethu 应答 = std 锁不可重入 → **死锁**（实测）。必须像下面这样
> 全程只 lock 一次、`onethu()` 复用同一个 `&mut StdinLock`。

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
            Some("interrupt") => { /* 打断当前任务（R4）：置标志位，agent 循环每步检查 */ }
            _ => {}
        }
    }
}
```

真实 Harness 在此骨架上生长：reqwest 调 LLM（OpenAI 兼容 `/chat/completions`）、
工具循环每步经 `onethu.call` 取数/订座、每步发 progress、累计 usage → 价格换算（R6）。
注意 run 的应答须在 10 分钟内返回（宿主默认超时；进程不会被杀，只是该次调用报超时，
长任务自行分段或先快速应答再后台跑）。

### 8.4 R1–R6 → OneTHU 宿主能力对照

| 要求 | 落点 |
|---|---|
| R1 核心 Rust | 整个 sidecar 二进制；JS 侧只有宿主胶水（不属于插件） |
| R2 界面 | OneTHU 管理页即是 UI（触发命令、展示结果）；无需自写 UI |
| R3 模型配置 | manifest.settings（Endpoint/Key/模型/价格/预算），管理页表单可改 |
| R4 进度+打断 | `progress` 通知（step/total）→ 轨迹面板；「打断」按钮 → `interrupt` 通知 |
| R5 上下文历史 | 用 `onethu.call storage.set/get` 把会话 JSON 存进插件私有存储；轨迹面板显示工作流；管理页展开即「非黑盒」 |
| R6 token 统计 | LLM 响应的 usage.prompt/completion_tokens 在 Rust 侧累计 × settings 价格；经 run 应答或 progress 展示；预算到量自动停 |

### 8.5 约束与坑

- **权限与 JS 插件同轨**：`onethu.call` 未声明的权限照样被门禁拒绝（错误消息含权限名）。
- 单线程顺序调用足够（agent 循环天然顺序）；并发调用需自己管理请求 id 配对。
- run 应答超时默认 10 分钟（自调用发出计到应答到达；progress 不重置计时）。超时只是该次调用报错，进程仍在跑、可继续 onethu.call/progress、可打断。
- 退出码非 0 / stdout 关闭 → 宿主发 `exit` 事件并在 UI 标记，进程表自动清理。
- 二进制路径含空格没问题；**不要**依赖工作目录（宿主不保证 cwd）。

---

## 九、对话面板契约（dock 协议）★ 对话型插件必读

> OneTHU 宿主内置一个**通用对话面板**（ChatDock，左下角常驻气泡）：任何 rust 插件只要在
> activate 应答的 `commands` 里声明 `dock: true` 的命令，宿主即自动为其渲染面板。
> 面板只是宿主胶水，**全部 agent 逻辑仍在插件 Rust 进程内**（R1 不受影响）。

### 9.1 activate 应答约定

```json
{ "commands": [
  { "id": "chat", "title": "对话", "inputLabel": "对 Harness 说",
    "inputPlaceholder": "…", "dock": true },
  { "id": "new_session", "title": "新建会话" },
  { "id": "export_session", "title": "导出会话 JSON", "inputLabel": "会话 id（留空=当前）" }
] }
```

- `dock: true` 的命令即对话入口：面板发消息 = `run { command: "<该命令 id>", input: "<用户输入>" }`。
- 其余命令照旧渲染在插件管理页（输入框、执行、结果显示）。

### 9.2 chat 命令的结果（结构化 JSON，管理页会显示其序列化文本）

```json
{
  "type": "chat", "ok": true,
  "answer": "模型最终回答（或模板确认语/打断语）",
  "sessionId": "s…", "interrupted": false,
  "confirm": { "summary": "将执行的操作摘要" },
  "usage":         { "prompt": 0, "completion": 0, "calls": 0, "costUsd": 0 },
  "sessionUsage":  { "prompt": 0, "completion": 0, "costUsd": 0 },
  "totalUsage":    { "prompt": 0, "completion": 0, "calls": 0, "costUsd": 0,
                     "budgetUsd": 2, "budgetLeftUsd": 1.9 }
}
```

- `confirm` 非空时面板渲染「确认执行 / 取消」按钮（用户确认 = 发送文本「确认」）。
- `ok: false` 时 `error` 字段为失败原因（面板按错误气泡渲染）。

### 9.3 进度通知扩展（progress.params.kind）

| kind | params | 面板行为 |
|---|---|---|
| `delta` | `text`（回答增量） | 追加到流式气泡 |
| `think` | `text`（思考增量，建议 ≥160 字节再发） | 「思考中」指示 |
| `tool` | `text`（工具轨迹行） | 轨迹区追加 |
| `notice` | `text`（状态行，如「思考中…（第 2 步）」） | 状态显示 |
| `usage` | `payload`（9.2 的用量结构） | 底栏实时刷新 |

不带 `kind` 的 progress/log/exit 仍走插件管理页轨迹面板，两不误。

### 9.4 面板会话管理命令（约定命名）

`new_session` / `list_sessions` / `switch_session`(input=id) / `delete_session`(input=id) /
`export_session`(input=id，空=当前) / `import_session`(input=会话 JSON) /
`usage_report` / `selftest`。各自返回结构化 JSON（见 OneTHU-Harness README）。

参考实现：`plugins/OneTHU-Harness`（子模块，https://github.com/smartThise/OneTHU-Harness）。
