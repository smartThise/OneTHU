# PORTED —— thu-info-lib 剩余可运行功能数据层移植清单

基准源码对照 `thu-info-app/packages/thu-info-lib/src/lib/*.ts`，完整保留原有端点、请求参数与解析逻辑。
传输层统一接入 OneTHU `HttpClient`（校内内网域名走动态 WebVPN 包装，`learn` 与 `app.cs` 直连）；
业务会话漫游复用 `#roamInfoService(yyfwid)`（对应原库 roam `"default"`）与 `#roamIdService`
（对应原库 roam `"id"`）。纯解析函数按业务域拆分为独立模块（`finance` / `hygiene` / `fitness` / `evaluation` /
`classroom` / `calendar` / `neth` 及共享工具 `htmltext`），网络 I/O 统一挂载在 `InfoClient`（`client.ts`）。

## 错误分类铁律

| 情形 | 行为 |
| --- | --- |
| 登录页特征（WebVPN 门户页 title、登录页 title、m.myhome 登录控件、usereg 验证码页） | 抛出 `AuthRequiredError`。**注意**：「time out用户登陆超时或访问内容不存在」为教务系统的通用报错文案（内容缺失或无访问权限时均返回此页），需按普通业务异常或无权限处理并保持当前登录态 |
| 无成绩 / 成绩未出 / 非评估期 / 无卫生检查数据 / 无代发记录 / 无权限（本科生查研究生专项目） | 返回空数组、`null` 或「暂无可查成绩」行（供 UI 展示「暂无」或「专项目」） |
| 上游瘫痪 / 确认维护页 / JSON 结构破损 | 抛出 `ServiceUnavailableError`（保持精确 `name`，供 UI 展示静态维护提示并保留当前登录态）；其余未知异常响应统一抛出普通 `Error`，由界面如实提示「获取失败」 |

## 方法清单

### 校园财务三件（finance.ts；lib basics.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getInvoiceList(page)` | `getInvoiceList` | dzpj `POST /invoiceSys/getList.do`（page/limit:20/columnName:"inv_date"/sort:"desc"；先 `#roamInvoice` 取票兑付 `/roam/roamAuth.do`） | `InvoicePage { data: Invoice[]; count }` |
| `getInvoicePDF(uuid)` | `getInvoicePDF` | dzpj `GET /invoice/showInvPdf.do?uuid=` → 字节 base64 | `string` |
| `getBankPayment(foundation?, loadPartial?)` | `getBankPayment` | yhdf `POST /yhdfcx/search.do`（基金会 `/yhdfcx_jjh/search.do`）。实测漫游链路 roam.jsp?ticket→login.do→roam.jsp 后经页面跳转才落入查询页：取年份顺序依次尝试漫游落地页 → 页内跳转一跳（meta refresh / JS location）→ 直接 GET search.do 兜底；单次 POST `year=` 同名重复键（`loadPartial` 取前 3 个年份，UI 默认 `true`，POST 前写 `[BANK]` 调试日志） | `BankPaymentByMonth[] { month, payment[11 列] }`（无选项时返回 `[]`） |
| `getGraduateIncome(begin, end)` | `getGraduateIncome` | zzjl.graduate `POST /b/yjsjzxt/v_yjszzjl_yjscwdfmx_cx/pageList`（ffkssj/ffjssj/nd/rows:1000/page/sidx:id/sord:asc） | `GraduateIncome[]`；**`null` 表示无权限或无数据**（本科生访问时常规返回非 JSON 页面，UI 显示「研究生专项目」并保持当前登录态）；若返回 JSON 但缺少 `object.rows` 则抛出 `ServiceUnavailableError` |

### 宿舍卫生（hygiene.ts；lib dorm.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getDormScore()` | `getDormScore` | id roam `0a993de7…/0` → m.myhome `GET /weixin/weixin_health_linechart.aspx?id=0` → 图表图 `#weixin_health_linechartCtrl1_Chart1` src 字节 base64 | `string \| null`（无图表元素时返回 `null`；仅命中 m.myhome 真实登录页控件时抛出 `AuthRequiredError`，其余通用报错页或无权限页均保留登录态） |

### 体测成绩（fitness.ts；lib basics.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getPhysicalExamResult()` | `getPhysicalExamResult`（含 `physicalExamResultTotal` 参考总分公式逐字移植，固定 27 行字段映射） | zhjw `GET /tyjx.tyjx_tc_xscjb.do?m=jsonCj`（会话路径复用与课表同款的 `#ensureZhjw`，并以 lib tyjx yyfw 漫游兜底） | `[项目, 结果][]` 固定 27 行；`success==="false"` 返回 `[["状态","暂无可查成绩"]]`（与原库一致）；非 JSON 响应按维护页 → `ServiceUnavailableError`、登录或门户页 → `AuthRequiredError`、其余情形 → 普通 `Error` 分类 |

### 教学评估（evaluation.ts；lib basics.ts + models/home/assessment.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getAssessmentList()` | `getAssessmentList` | jxgl `GET /jxpg/f/jxpg/wj/xs/pgkcList`（td[5]/td[9]/td[11] onclick Body('…')） | `[课程名, 是否已评, 表单URL][]`；非评估期或无数据时返回 `[]` |
| `getAssessmentForm(url)` | `getAssessmentForm` | 列表项 URL（#xswjtxFormid inputs / #kcpgjgDtos[0].jtjy / #kcpjfs / .tab-pane 1、3 → 教师/助教） | `AssessmentForm` |
| `postAssessmentForm(form)` | `postAssessmentForm` | jxgl `POST /jxpg/b/jxpg/pgjg/xs/zancunjs`（serialize 同名字段序） | `void`；`result!=="success"` 时抛出上游 `msg` |

### 教室资源（classroom.ts；lib basics.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getClassroomList()` | `getClassroomList` | zhjw `GET /portal3rd.do?url=/portal3rd.do&m=jasJy_Xs_Js_index`（href 内 classroom=…&weeknumber=…） | `Classroom[]`（列表为空时抛出 `ServiceUnavailableError`） |
| `getClassroomState(building, week)` | `getClassroomState` | zhjw `GET /pk.classroomctrl.do?m=qyClassroomState&classroom=<GB2312 %xx>&weeknumber=`（`arbitraryEncodeGb2312` 等价于原库 `arbitraryEncode`） | `ClassroomStateResult { validWeekNumbers, currentWeekNumber, datesOfCurrentWeek×7, classroomStates(42 格 status) }` |

### 校历（calendar.ts；lib basics.ts + schedule.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getSchoolCalendar()` | `getCalendar`（`parseCalendarData` 周一对齐与 `weekCount` 逻辑与原库一致） | learn yyfw 漫游 `3E401364…` → 首页 `_csrf` → `GET /b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester?_csrf=` | `SchoolCalendarData` |
| `getCalendarYear()` | `getSchoolCalendarYear` | app.cs `GET /Api/SchoolCalendarYear`（公网直连） | `number` |
| `getCalendarImageUrl(year, semester, lang)` | `getCalendarImageUrl` | 纯拼接 `https://app.cs.tsinghua.edu.cn/xiaoli/{lang}/{year}-{1\|2}.jpg` | `string` |

### 课表夏季学期 CR 兜底（crSchedule.ts；thu-info-community 0317434e #910）

夏季学期（学期号以 `-3` 结尾）教务 `bks_jxrl_all` JSONP 接口固定返回空结果，需改从 CR
选课系统一级课表拉取课程安排。`getSchedule()` 内置该兜底逻辑：当 JSONP 为空且查询区间末端落在 6–8 月时，
自动根据区间推算 `(y-1)-y-3` 学期号，从校历读取同号学期的 `firstDay` 与 `weekCount`，再经 `zhjwxk` 模块的
`fetchZhjwxkPage`（`xklogin` SSO 链路 + `crFetch` 三判据）抓取 `xkBks.vxkBksXkbBs.do?m=kbSearch`。

| 函数 | lib 来源 | 说明 |
| --- | --- | --- |
| `parseSecondaryWeek` | 同名逐字 | 逗号分隔范围表达式（"8-11,13"）→ 逐周回调 |
| `parseWeekPattern` | 同名逐字 | 全周/单周/双周/前八周/后八周/范围（归一化去「第」「周」后匹配） |
| `parseCRSchedule` | 同名逐字 | setInitValue 函数体 strHTML/strHTML1 块解析（块锚 `a{session}_{day}`；`\s+` 宽松换行为上游第三次修复） |

OneTHU 结构适配：`ScheduleEntry` 采用扁平结构，按（课程块，周次）直接展开为单次条目
（`date = firstDay+(week-1)*7+dayOfWeek-1`），省去原库的 `Schedule{activeTime}` 归并及
`scheduleTimeAdd`，日期换算直接使用原生 `Date`。兜底请求若遇到异常则静默返回 `[]`。CR 会话按用户名缓存 `ZhjwxkSession`（复用 `zhjwxk` 按实例身份维护的 60s 热缓存）。

### 校园网 thos/usereg（neth.ts；lib network.ts —— 上游服务停摆，按原样保留实现）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getNetworkVerificationImageUrl()` | `getNetworkVerificationImageUrl` | usereg `GET /site/captcha?refresh=1` → 返回 `/site/captcha?_=ts` | `string` |
| `loginUsereg(code)` | `loginUsereg` | `POST /site/validate-user`（X-CSRF-Token + XHR 头；密码采用 RSA PKCS#1 v1.5，`neth.ts` 内置零依赖等价实现替代 `jsencrypt`）→ `POST /login`（_csrf-8800 + LoginForm 字段集） | `void` |
| `getOnlineDevices()` | `getOnlineDevices` | `GET /home` → `#w1-container` tr[data-key] 五列 | `NetworkDevice[]` |
| `getNetworkBalance()` | `getNetworkBalance` | `GET /home` → `#w3-container` 首行五列 | `NetworkBalance` |
| `getNetworkAccountInfo()` | `getNetworkAccountInfo` | `GET /home`（状态）+ `/users`（#w0 td 0/1/2/3/5/6/7）+ `/user/online-num` | `NetworkAccountInfo` |
| `logoutNetwork(device)` | `logoutNetwork` | `POST /home/delete?id=&user_mac=` + `_csrf-8800` | `void` |
| `loginNetwork(ip, internet)` | `loginNetwork` | `POST /certification`（CertificationForm[ip]/[password]/[type]） | 成功提示 `string` |

页面解析失败时统一抛出 `ServiceUnavailableError`；命中 `loginform-verifycode` 或 WebVPN 门户页时抛出 `AuthRequiredError`。

### 体育场馆预约（sports.ts；lib sports.ts 全量 382 行）

端点直接沿用原库 `SPORTS_*` WebVPN 常量（定义于 `urls.ts`；其中 `/http/` 段对应 `gymbook` 服务器
`HOST_MAP["50"]`，`zjjs` 支付两段对应 `fa-online`）。全部请求统一经由 `#serviceRoamed(SPORTS_ROAM_ID)`
（对应原库 `roamingWrapperWithMocks("default", 5539ECF8…)`）配合 `#withRenew` 发起。

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getSportsResources(gymId, itemId, date)` | `getSportsResources`（限额+手机号+资源三路并发） | 限额 `gymBookAction.do?ms=viewGymBook`（`limitBookCount/limitBookInit`）+ `hadContactOrNot`（明文 `do_not`=未配置）+ `cacheAction.do?ms=viewBook`（resourceArray/addCost/markResStatus/markStatusColor 四步） | `SportsResourcesInfo`（无资源时返回 `data:[]`） |
| `getSportsCaptchaUrlMethod()` | `getSportsCaptchaUrlMethod`（原库返回 URL） | `GET Kaptcha.jpg?N=`（随机数防缓存） | **由 core 带会话拉取图片并转为 `data:image/...;base64` Data URL**（便于前端直接渲染，与 `usereg` 的 `getNetworkVerificationImage` 做法一致） |
| `makeSportsReservation(totalCost, phone, receiptTitle, gymId, itemId, date, captcha, resHashId, skipPayment)` | `makeSportsReservation` | 下单 `gymbook/gymBookAction.do?ms=saveGymBook`（表单逐字段）→ 产生费用且未传 `skipPayment` 时继续执行：`payAction.do?ms=newPay`（GBK 表单）→ form.action → `var id/token` → `zjjs check.do`（code!=="0" → Error）→ `#payForm`+`channelId=0101` → `webPay.do` → `biz_content` → qrCode 支付码 | 支付码 `string \| undefined`（`totalCost=0` 或 `skipPayment` 时返回 `undefined`）。**漫游自动重试仅包裹下单阶段**（未成单时可安全重试；进入支付阶段后若失败直接报错返回，与原库一致避免重复锁场下单） |
| `getSportsReservationRecords()` | `getSportsReservationRecords` | 未支付 `getOrdersForNopay`（tbody tr 12 列：1/3/5/7/9 文本 + 11 动作格 span[time]/payNow/unsubscribeOnline/unsubscribe）+ 已支付 `getOrdersForUnpay`（`tr[style='display:none']` 嵌套表首行 td 2-5，method=已支付） | `SportsReservationRecord[]`（缺少表格结构时抛出 `ServiceUnavailableError`；无记录时返回 `[]`） |
| `paySportsReservation(payId, receiptTitle)` | `paySportsReservation` | `payAction.do?ms=newPayForLater`（book_ids/xm）→ 同上支付链 | 支付码 `string` |
| `unsubscribeSportsReservation(bookId)` | `unsubscribeSportsReservation` | `POST gymBookAction.do?ms=unsubscribe`（bookId） | `void` |
| `updateSportsPhoneNumber(phone)` | `updateSportsPhoneNumber`（手机号正则逐字一致） | URL 拼 `cell_phone=&gzzh=学号`（学号取内存凭据 `username`） | `void`；响应含「找回密码」时抛出 `AuthRequiredError`（与原库 `LibError` 判据一致） |

常量与类型导出：`VALID_RECEIPT_TITLES`（`["清华大学","清华大学工会","清华大学教育基金会"]`）、
`sportsIdInfoList`（8 个场馆元数据）及 `ValidReceiptTitle` 类型（由 `index.ts` 统一再导出）。

实现细节说明：① 支付表单页响应为 GBK 编码，桌面传输层（`reqwest` charset 解码）已自动转为 UTF-8；请求体中的中文收据抬头（`xm`）按 UTF-8 发送（原库采用 GBK 编码，该字段仅用于线上申领发票，界面已注明发票申领以线下为主）；② 原库的 cheerio 子树下标访问（如 `children[11].children[5].children[1]`）改用「`td` 切分 + `onclick` 正则（对 `unsubscribe` 使用负向先行断言排除 `unsubscribeOnline`）+ `tr/tbody` 深度扫描提取嵌套表格」的轻量微 DOM 等价实现。

## 已知偏差（有意为之）

- 研讨间（`cab.lib`）认证复用了与 `#libraryAccessToken` 相同的 10 分钟 TTL 缓存及跨实例单飞机制：实测每次进入图书馆页面都重跑整条 `cab` 漫游链（`ic-web/auth/address` → `authcenter` → `lbredirect`×2）会导致预约与记录页明显卡顿。会话真正过期时由 `#cabFetch` 失效钩子配合 `#withLibRoom` 自动重试恢复，调用 `forceEnsure("libroom")` 也会主动清空缓存。
- 原库的 cheerio 遍历统一替换为基于正则与轻量微 DOM 的 `td` 解析；银行代发金额列与教室名称直接提取整格文本（原库依赖首个子元素或特定文本节点，易受 HTML 空白字符影响），容错性更好。
- 原库的 `AssessmentError`、`ClassroomStateError`、`DormAuthError` 等细分异常统一收敛到上文三类错误规则：无数据返回空结果，页面结构损坏抛出 `ServiceUnavailableError`，保持错误体系精简一致。
- `ClassroomStatus` 使用 `const` 对象保留原库的数值枚举值，便于在 `node --experimental-strip-types` 下直接运行。
- 宿舍卫生接口位于 `m.myhome`（HTTPS，WebVPN hex `fdb94c852f…` 已解码核实），与电费查询所使用的 `myhome.tsinghua.edu.cn`（HTTP）分属不同站点，各自维护独立会话。
- 原库硬编码的全部 WebVPN hex 路径（`core.ts` 中的 `HOST_MAP`）均已逐一经 AES 解码核对，确认对应真实校内域名（`jxgl.cic` / `zhjw.cic` / `dzpj` / `yhdf` / `zzjl.graduate` / `learn` / `usereg` / `m.myhome` / `app.cs`）。
