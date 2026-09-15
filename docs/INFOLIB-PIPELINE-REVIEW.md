# Info App 管线全面审查与 OneTHU 移植方案（2026-09-16）

> 审查基线：thu-info-app **3.17.0**（monorepo @ `22a0ff9`，2026-09-15 发布；lib 已并入 monorepo，
> 独立仓库 thu-info-lib 止于 7.1.5 / 2023-09-21 并挂出 deprecation notice）。
> OneTHU 侧：dev @ `e96e7f0`，稳定基线 **`4fe0400`**（main）。

---

## 〇、结论先行

1. **Info app 从来不"适配两种环境"——它把"环境"这个概念从客户端删掉了。**
   全部业务流量（含网络学堂、信息门户、教务、图书馆、宿舍、发票……）永远走
   `webvpn.tsinghua.edu.cn/<协议>/<hex域>/<路径>` 这一条管线。校园网和蜂窝网在客户端
   看来完全同构：webvpn 网关从哪里都可达（它本来就是为校外设计的，校内也通）。
2. **OneTHU 只能校园网用的根因是 founding assumption 反了**：
   「校园网直连为主、WebVPN 为辅」→ 两条活会话通道（直连 learn/id/info + 包装其余）→
   同一上游账号从两扇门反复进出互踢 + 重定向链跨"公网/内网"边界要在客户端逐跳补包装
   （校外一跳没包住就是死链超时）+ info.tsinghua.edu.cn 直连（内网门户，校外不可达）。
3. **"多次重构和嵌入 info app 仍然无用"的三重原因**：
   ①移植的是器官（解析器/端点），不是血脉（网络拓扑与会话命名空间）；
   ②vendor 的 7.1.5 落后上游 **394 个 commit**，登录链本身已失效（2024-07 起需要 SM2
   加密 + 二次认证，7.1.5 都没有）；
   ③vendor 之后 lib 从未接管方向盘——只接了个探针页，全 app 仍跑在旧 core 上。
4. **正确移植单位是"拓扑"而不是"函数"**：WebVPN 即网络；公网白名单收缩为
   {id, card, oauth, webvpn(, app.cs/git)}；登录链=lib `login()`（含 2FA hooks）；
   会话自愈=lib `roamingWrapper/verifyAndReLogin` 单漏斗。稳定版以 4fe0400 为基线不动，
   移植在 dev 分支推进。

---

## 一、Info app（3.17.0）双环境"完美适配"的真相

### 1.1 五大支柱

**支柱一：WebVPN 是唯一的网络。**
`packages/thu-info-lib/src/constants/strings.ts` 里所有业务 URL 都是硬编码的 webvpn 包装形态。
抽查最意外的两个（这也是 OneTHU 一直直连的域）：

```ts
// 信息门户 —— 学校在 wengine 注册的名字是 info2021（hex …f9f94793756…），不是 info
USER_DATA_URL = "https://webvpn.tsinghua.edu.cn/https/77…383ff3f/b/info/gxfw_fg/common/grjbxx"
// 网络学堂 —— 连 learn 都走包装！
LEARN_HOME_URL = "https://webvpn.tsinghua.edu.cn/https/77…cc97bcc/f/wlxt/index/course/student/index"
```

lib 从头到尾没有出现过 `info.tsinghua.edu.cn`。校历学期接口直接用包装的 learn URL
（basics.ts:676 `getCalendar`）。HOST_MAP 里 zhjw/jxgl/zhjwxk/ecard/learn/mails/
fa-online/dzpj/yhdf/usereg/thos/zzjl.graduate/madmodel 全部注册在案。

**支柱二：公网白名单小到不能再小。**
直连的只有：`id.tsinghua.edu.cn`（CAS 登录/二次认证/受信设备管理）、`card.tsinghua.edu.cn`
（校园卡业务 API）、`oauth.tsinghua.edu.cn`（lb-auth lbredirect）、`app.cs.tsinghua.edu.cn`
（THU Info 自家后端）、`git.tsinghua.edu.cn`。这些域**生来就是公网的**——登录链自己要用。
不存在"校园网内走直连更快所以直连"的优化。

**支柱三：登录后只有一个会话命名空间。**
登录链严格串行跑一次（core.ts `login`）：

```
clearCookies → GET webvpn/login?oauth_login=true → 解析 id 登录页 #sm2publicKey
→ POST id/do/off/ui/auth/login/check（i_pass = "04"+SM2(password, pubKey)，fingerPrint）
→ 若"二次认证"：FIND_APPROACHES → hooks 问用户选方式 → SEND_CODE → VERITY(_TOTP)_CODE
   → （可选）SAVE_FINGER 信任本设备指纹 → 之后登录免 2FA
→ 跟随回调锚点落回 webvpn（webvpn 会话建立）
→ roam(helper,"id","10000ea055dd…")   ← 关键：把 CAS 会话装进 wengine
```

`roam("id")` 之后，wengine 在服务端持有你的 CAS 会话；任何包装应用的 CAS SSO
（learn/zhjw/library…）都在 wengine 内部透明完成。客户端唯一需要保活的只有
webvpn.tsinghua.edu.cn 一个物理域的会话 cookie——所以 RN 端一个原生 cookie store、
Node 端一张扁平 cookie 表就够，根本不需要按域分桶的 cookie jar。

**支柱四：自愈是一个 40 行的单漏斗。**
`roamingWrapper`：操作失败 → `roam(policy)` 重试（自身失败再试一次）→
`operation(漫游落地页)` → 仍失败 → `verifyAndReLogin`（探 `USER_DATA_URL`，死则用内存
密码完整重登）→ 再漫游、再重放。没有广播总线、没有熔断矩阵、没有 era 快照——
登录本身单飞（`outstandingLoginPromise`，超时 3 分钟以容纳交互式 2FA）。

**支柱五：传输层无聊到不存在。**
RN 端 `cross-fetch` + 原生 cookie store（每个物理域一套，自动随请求带）；Node 端手动
逐跳跟随重定向+扁平表记账。客户端**从不改写重定向目标**——因为包装世界里重定向
永远不离开 webvpn 域，服务端替你把整个 SSO 链走完。最新版唯一的传输层新增是
`RTNNetworkUtils`（鸿蒙原生的 redirect 探测，纯平台补丁）。

### 1.2 相对 7.1.5 的关键演进（OneTHU vendor 版缺失的全部）

| 时间 | 变更 | 对 OneTHU 的意义 |
|---|---|---|
| 2024-07-10 | **2FA for WebVPN**（hooks 模型） | OneTHU 用 demoLogin 自己复刻了同款（finger3/SAVE_FINGER）——证明需要，但维护两份 |
| 2024-07-12 | **SM2 登录**（`04`+sm-crypto 加密 i_pass） | 7.1.5 明文 i_pass 已不可用/不可靠 |
| 2024+ | roam 新 policy：`cr`/`id_website`；`getWebVPNUrl` 走 oauth lb-auth lbredirect | 选课 CR、id 设备管理（forgetDevice） |
| 2025-07-16 | **CR kbSearch 夏季学期课表兜底**（#910） | OneTHU 手工移植过同一 commit（crSchedule.ts）——漂移证据 |
| 2026-09-12 | 按节次显示课表（#958）、THOS 原生服务（#950） | 新功能面 |
| 合计 | **394 commits**（依赖升级除外含大量解析修复） | vendor 快照已腐烂 |

---

## 二、OneTHU 为什么只能校园网用：三个根因

### 根因一：双通道 = 双会话命名空间（自伤性架构）

`packages/core/src/http.ts` 的分流（恒按域名策略）：

```ts
PUBLIC_DIRECT_HOSTS = { learn, webvpn, id, oauth, info, card }   // 直连
其余（zhjw.cic / zhjwxk.cic / myhome / usereg / …）              // webvpn 包装
```

登录后两条通道**同时常驻使用**：learn 直连、info 直连、id 直连出票、其余包装。
THU 各服务端是单会话策略（同一账号新登录踢旧登录），于是同一上游会话被两扇门
反复建立/顶掉。OneTHU 为此造的补偿机器全部记录在案：

- `session.ts` era 快照体系（`#infoEraCookies/#learnEraCookies/#cardEraCookies`）+
  `#seedJar()` 六域灌装矩阵——注释自述「字符串里只有一个 JSESSIONID：learn 登录会
  覆盖 roam-id 刚建立的 info 会话」；
- `transport.ts` `hopCookieProvider`（逐跳按真实域供 cookie）+ `hopUrlWrapper`
  （链内续包装防通道分裂）；
- `sessionPlane.ts` 全局串行会话平面、三级修复阶梯、广播节流（f879741 修的
  「85 秒 1946 请求」自激风暴正是这套机器的产物）；
- 4fe0400 稳定基线的标题本身就是补偿：「选课隔离通道 v2——拷贝全局桶代替独立登录
  （webvpn 单会话互踢根治）」。

**info app 没有其中任何一行代码，因为它只有一个命名空间，冲突在物理上不可能发生。**

### 根因二：跨边界重定向的客户端补包装（校外死链的直接来源）

直连 id/oauth 会 302 指向内网域（cab.lib、seat 等）。校内：怎么跳都通（全校可达），
bug 隐形。校外：一跳没包住 = TCP 死等 → `transport.ts` 注释原话「校外超时死链、
校内通道分裂」。`hopUrlWrapper` 的粘性 webvpn 续轨就是为缝这个洞而生——但它是
补丁：正确做法是让重定向根本不出 webvpn 域（支柱五）。

### 根因三：info.tsinghua.edu.cn 直连（首页级故障）

从 0.1.0（f907fcc）起 `INFO_PREFIX = "https://info.tsinghua.edu.cn"` 直连，全部
门户/新闻/通知/漫游 yyfw 流量走它，且它在 `PUBLIC_DIRECT_HOSTS` 里永不被包装。
而学校给 wengine 注册的门户名是 **info2021.tsinghua.edu.cn**（hex `…f9f94793756…`），
info app 全部门户流量走包装 info2021。校内两者等价；校外 info 直连是内网服务。
这就是「OneTHU 只能校园网内使用」的首页级来源（新闻/通知/日程漫游/个人信息全灭）。

### 误读纠正：commit 7757c5c「照抄 info 的直连哲学」

info app 没有"直连哲学"。它有一个**生来公网的极小白名单**和一条**永走的 webvpn
管线**。OneTHU 把 learn/info 放进直连白名单的那一刻，就把 info app 唯一重要的
设计——单命名空间——拆掉了。后来「webvpn 粘性开关」实验（失败回退）、「拔掉粘性
开关改恒按域名策略」都在同一个错误假设里打转：**问题从来不是"何时包装"，而是
"不该有第二扇门"。**

---

## 三、为什么"多次重构和嵌入 info app"仍然无用

1. **移植的是器官，不是血脉。** 100+ 轮（见记忆「会话稳定性专项」）把 lib 的解析器、
   端点、CR 兜底、sports、dzpj 漫游特判逐个搬进自有架构——每次都正确，但周围的
   双通道架构每轮都在产生新的互踢形态。函数级移植永远追不上拓扑级缺陷。
2. **vendor 快照是 2023-09 的 7.1.5，落后 394 commits。** 其 `login()` 发明文
   `i_pass`、无 2FA hooks——对今天的服务端登录链根本走不通。OneTHU 自己的
   demoLogin（SM2+2FA+SAVE_FINGER，804 行）实际比 vendor 的新，形成"新链在自家、
   旧链在 vendor"的倒挂。
3. **lib 从未接管方向盘。** 2d16526「硬换数据层第一步」只接了 `InfoLibProbe.tsx`
   探针页（登录→课表→个人信息→图书馆 四项），全 app 30 个数据页面仍跑旧 core。
   "嵌入"没有发生接线意义上的移植。

---

## 四、移植方案：照抄拓扑，而不是照抄函数

**北极星：OneTHU 的每一个字节流量，要么发向生来公网的白名单域，要么发向
webvpn.tsinghua.edu.cn。没有第三种目的地。**

### Phase 0 —— 基线纪律（立即）

- main = 稳定线，钉在 `4fe0400`（打 tag `stable-4fe`）。发布/热修只从 main。
- 全部移植工作在 dev；每个 Phase 落一个可回滚 commit 序列，真机双环境
  （校园 Wi-Fi + 蜂窝/家庭网关外网）验收后才合 dev 稳定段。

### Phase 1 —— lib 刷新到 3.17.0（机械，1 天）

- 用 monorepo `packages/thu-info-lib`（@22a0ff9）整树替换 `packages/info-lib/src`
  （保留 OneTHU 的 `network.ts` 平台注入模式：`setPlatformFetch/setPlatformClearCookies`，
  该文件是唯一许可的改动面；7.1.5 时代对 basics/cr/dorm/library/sports 的六处小改
  需逐一对上游确认是否已被上游修复吸收）。
- `package.json` 增 `sm-crypto@^0.5.0`；确认 cheerio/iconv-lite/he 版本随上游。
- 验收：`pnpm -r --if-present run typecheck` + 现有测试绿。

### Phase 2 —— 登录链统一到 lib（拆 demoLogin，2-3 天）

- `helper.twoFactorMethodHook/twoFactorAuthHook/trustFingerprintHook/
  trustFingerprintNameHook` 用 futures 模式接现有 2FA UI（照 thu-info-app
  `src/redux/store.ts:250-330` 逐行抄）。
- `CampusSession` 收缩为：`helper.login()` + `finger3` 注入（`helper.fingerprint` 对齐
  现有 store 的指纹，受信设备连续）+ `clearCookieHandler`（清平台 jar）。
- **退役**：`demoLogin.ts` 全部、`#loginRaw` 的 need_2fa 手工状态机、
  `demoEnterLearn`/learn 二次验证墙（lib 世界里 learn 经包装+wengine 持有的 CAS
  会话透明 SSO，根本没有"learn 登录"这一步）。
- 探针页验收①升级为：登录（真实 2FA 流程）+ `getSchedule/getUserInfo/getLibraryList`。

### Phase 3 —— URL 大切换（拓扑收编，3-5 天，核心一击）

- `PUBLIC_DIRECT_HOSTS` 收缩为 `{webvpn, id, oauth, card}`（app.cs/git 按需）。
  **删除 info、learn。**
- info 系全部端点 → 包装 info2021（优先直接采用 lib 导出的 URL 常量；OneTHU 特有
  端点用已验证的 AES-CFB 编码器包 info2021 域名）。
- learn 系全部端点 → 包装 learn（HOST_MAP hex）。
- zhjwxk（选课）与 venue 维持现有包装通道不动（它们已在 webvpn 管线内）。
- 传输层 `hopUrlWrapper` 降级为防御性兜底（保留但预期不再触发）。
- 验收：探针页跑通 + 首页（新闻/通知/日程/作业/课表）蜂窝网实测。

### Phase 4 —— 会话平面坍缩（拆补偿机器，2-3 天）

- 会话自愈改 lib 语义：模块失败 → `roamingWrapper` 语义（core 客户端调用点包一层
  或直接换 lib API）；周期保活 = `verifyAndReLogin`（探 `USER_DATA_URL` 包装版）。
- **退役**：era 快照族、`#seedJar` 域矩阵、`sessionPlane.ts` 广播/阶梯（保留最小
  softRelogin 节流防风控：失败指数退避 1→30min 这一条保留，来自 2026-09-14 定案）。
- `http.ts` 的 `wengineInterstitial` 探测+cookie 舞步移入 platformFetch 适配器
  （平台关注点，对 lib 透明，命中时 dance 一次再重放）。

### Phase 5 —— UI 数据层逐页切 lib API（并行推进，1-2 周弹性）

- lib 有 141 个公开 API；OneTHU 30 个 info tab 全部被覆盖（含 OneTHU 手工移植过的
  finance/hygiene/fitness/evaluation/classroom/sports/CR——直接换调 lib，删自维护副本）。
- 切换顺序按风险升序：News/Calendar/Profile（只读）→ Report/Exams → Dorm/Card →
  Library/LibRoom（会话敏感，最后切）。
- 每页一个 commit；`packages/core/src/info/*` 按页退休，`PORTED.md` 同步勾销。

### Phase 6 —— 移动桥对齐（RN 内嵌模式，1-2 天）

- 桥模式 `platformFetch = bridgeFetch`（RN 原生 fetch + 原生 cookie store——
  与 THU Info 完全同款网络环境），桌面 `platformFetch = tauriFetch`（Rust 连接池——
  0b5e6e7 的决定性修复保留）。
- learn 嫁接提供者（e96e7f0 `#learnGraft`/`adoptBridgeSession` 补建 webvpn 会话）
  在 Phase 3 后自然退役：learn 也在 webvpn 命名空间，无需第二会话。

### 风险登记

| 风险 | 缓解 |
|---|---|
| 选课通道与统一会话的互踢回归 | Phase 3 显式不动 zhjwxk 通道；4fe0400 的隔离桶方案保留至 Phase 5 后单独评估 |
| wengine 对 info2021 以外域的包装限制 | 只用 HOST_MAP 在册域 + lib 常量；自定义域先在探针页验 |
| 双环境验收盲区 | 每个 Phase 出口跑同一份「双环境矩阵」：校园 Wi-Fi / 蜂窝各跑探针+首页+三页抽样 |
| lib 上游 breaking | vendor 锁 commit（22a0ff9）；升级=显式 diff 审查 |
| THU 风控（高频重登锤 2FA 墙） | 保留 softRelogin 指数退避；`roamingWrapper` 的重试天然低频 |

### 完成定义（DoD）

1. 代码里不存在对 `info.tsinghua.edu.cn`、`learn.tsinghua.edu.cn` 的直连请求
   （grep 可证）。
2. `demoLogin.ts`、era 快照、`sessionPlane.ts`、`hopUrlWrapper` 触发路径全部删除或
   降级为 dead code 兜底。
3. 蜂窝网（关 Wi-Fi）冷启动 → 登录（含 2FA）→ 首页全绿 → 抽查 5 页功能全绿；
   校园网同矩阵全绿。
4. main（4fe0400 基线）不受影响；dev 上移植为一组可 bisect 的提交序列。

---

## 附：本次审查的证据清单

- 最新 lib 全 webvpn 常量：`/tmp/thu-info-app-latest/packages/thu-info-lib/src/constants/strings.ts`
- learn/info2021 包装实证：strings.ts `LEARN_HOME_URL`、`USER_DATA_URL`；basics.ts:676
- SM2/2FA 引入时间：monorepo `9aa65551`（2024-07-12）、`7264b45c`（2024-07-10）
- lib 演进规模：`git log --since=2023-09-24 -- packages/thu-info-lib | wc -l` = 394
- app 侧 hooks 接线范本：`apps/thu-info-app/src/redux/store.ts:250-330`
- OneTHU 直连白名单：`packages/core/src/http.ts:70-81`（info/learn 在列）
- era 快照/seedJar：`packages/core/src/auth/session.ts:493-523`
- 跳转续包装：`apps/desktop/src/lib/transport.ts:25-32`（hopUrlWrapper 及注释）
- vendor 未接管：全仓只有 `apps/desktop/src/pages/InfoLibProbe.tsx` 引用 `@onethu/info-lib`
- vendor 与原版 7.1.5 差异面：仅 network.ts + 六个 lib 文件小改（diff 实测）
