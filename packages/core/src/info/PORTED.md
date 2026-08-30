# PORTED —— thu-info-lib 剩余可运行功能数据层移植清单

金标准源码：`thu-info-app/packages/thu-info-lib/src/lib/*.ts`（端点/参数/解析逐字移植）。
传输层适配：OneTHU `HttpClient`（校内非公网域名动态 WebVPN 包装；learn/app.cs 直连）；
业务会话漫游复用 `#roamInfoService(yyfwid)`（lib roam "default"）与 `#roamIdService`
（lib roam "id"）。解析纯函数按域分模块（finance/hygiene/fitness/evaluation/
classroom/calendar/neth + htmltext 共享工具），I/O 全部挂在 `InfoClient`（client.ts）。

## 错误分类铁律

| 情形 | 行为 |
| --- | --- |
| 登录页特征（WebVPN 门户页 title、登录页 title、m.myhome 登录控件、usereg 验证码页） | `AuthRequiredError`。**注意**：「time out用户登陆超时或访问内容不存在」是教务通用错误页（内容不存在/无权限同文案），**不是**登录页，不触发失登 |
| 无成绩 / 成绩未出 / 非评估期 / 无卫生检查数据 / 无代发记录 / 无权限（本科生查研究生专项目） | 空数组 / `null` / 「暂无可查成绩」行（UI 显示「暂无」或「专项目」） |
| 上游瘫痪 / 确认维护页 / JSON 结构破损 | `ServiceUnavailableError`（name 精确，UI 静态维护文案，绝不触发失登自愈）；无法证实瘫痪的异常响应 → 普通 Error 诚实报「获取失败」 |

## 方法清单

### 校园财务三件（finance.ts；lib basics.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getInvoiceList(page)` | `getInvoiceList` | dzpj `POST /invoiceSys/getList.do`（page/limit:20/columnName:"inv_date"/sort:"desc"；先 `#roamInvoice` 取票兑付 `/roam/roamAuth.do`） | `InvoicePage { data: Invoice[]; count }` |
| `getInvoicePDF(uuid)` | `getInvoicePDF` | dzpj `GET /invoice/showInvPdf.do?uuid=` → 字节 base64 | `string` |
| `getBankPayment(foundation?, loadPartial?)` | `getBankPayment` | yhdf `POST /yhdfcx/search.do`（基金会 `/yhdfcx_jjh/search.do`）。实测漫游链路 roam.jsp?ticket→login.do→roam.jsp 后经页面跳转才落查询页：取年份顺序 = 漫游落地页 → 页内跳转一跳（meta refresh / JS location）→ 直接 GET search.do 兜底；单次 POST `year=` 同名重复键（`loadPartial`=前 3 个年份，UI 默认 true，POST 前写 `[BANK]` 调试日志） | `BankPaymentByMonth[] { month, payment[11 列] }`（无选项 → `[]`） |
| `getGraduateIncome(begin, end)` | `getGraduateIncome` | zzjl.graduate `POST /b/yjsjzxt/v_yjszzjl_yjscwdfmx_cx/pageList`（ffkssj/ffjssj/nd/rows:1000/page/sidx:id/sord:asc） | `GraduateIncome[]`；**null = 无权限/无数据**（响应非 JSON，本科生常态，UI 显示「研究生专项目」，绝不报失登）；JSON 但缺 object.rows → `ServiceUnavailableError` |

### 宿舍卫生（hygiene.ts；lib dorm.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getDormScore()` | `getDormScore` | id roam `0a993de7…/0` → m.myhome `GET /weixin/weixin_health_linechart.aspx?id=0` → 图表图 `#weixin_health_linechartCtrl1_Chart1` src 字节 base64 | `string \| null`（无图表元素 → `null`；仅 m.myhome 真登录页控件 → `AuthRequiredError`，教务通用错误页/无权限页不算失登） |

### 体测成绩（fitness.ts；lib basics.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getPhysicalExamResult()` | `getPhysicalExamResult`（含 `physicalExamResultTotal` 参考总分公式逐字，固定 27 行字段映射） | zhjw `GET /tyjx.tyjx_tc_xscjb.do?m=jsonCj`（会话路径 = `#ensureZhjw` 与课表同款 + lib tyjx yyfw 漫游兜底） | `[项目, 结果][]` 固定 27 行；`success==="false"` → `[["状态","暂无可查成绩"]]`（lib 原样）；响应非 JSON：维护页 → `ServiceUnavailableError`，登录/门户 → `AuthRequiredError`，其余 → 普通 Error |

### 教学评估（evaluation.ts；lib basics.ts + models/home/assessment.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getAssessmentList()` | `getAssessmentList` | jxgl `GET /jxpg/f/jxpg/wj/xs/pgkcList`（td[5]/td[9]/td[11] onclick Body('…')） | `[课程名, 是否已评, 表单URL][]`；非评估期/空 → `[]` |
| `getAssessmentForm(url)` | `getAssessmentForm` | 列表项 URL（#xswjtxFormid inputs / #kcpgjgDtos[0].jtjy / #kcpjfs / .tab-pane 1、3 → 教师/助教） | `AssessmentForm` |
| `postAssessmentForm(form)` | `postAssessmentForm` | jxgl `POST /jxpg/b/jxpg/pgjg/xs/zancunjs`（serialize 同名字段序） | `void`；`result!=="success"` 抛 msg |

### 教室资源（classroom.ts；lib basics.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getClassroomList()` | `getClassroomList` | zhjw `GET /portal3rd.do?url=/portal3rd.do&m=jasJy_Xs_Js_index`（href 内 classroom=…&weeknumber=…） | `Classroom[]`（空 → `ServiceUnavailableError`） |
| `getClassroomState(building, week)` | `getClassroomState` | zhjw `GET /pk.classroomctrl.do?m=qyClassroomState&classroom=<GB2312 %xx>&weeknumber=`（`arbitraryEncodeGb2312` 等价 lib arbitraryEncode） | `ClassroomStateResult { validWeekNumbers, currentWeekNumber, datesOfCurrentWeek×7, classroomStates(42 格 status) }` |

### 校历（calendar.ts；lib basics.ts + schedule.ts）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getSchoolCalendar()` | `getCalendar`（parseCalendarData 周一对齐 + weekCount 逐字） | learn yyfw 漫游 `3E401364…` → 首页 `_csrf` → `GET /b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester?_csrf=` | `SchoolCalendarData` |
| `getCalendarYear()` | `getSchoolCalendarYear` | app.cs `GET /Api/SchoolCalendarYear`（公网直连） | `number` |
| `getCalendarImageUrl(year, semester, lang)` | `getCalendarImageUrl` | 纯拼接 `https://app.cs.tsinghua.edu.cn/xiaoli/{lang}/{year}-{1\|2}.jpg` | `string` |

### 校园网 thos/usereg（neth.ts；lib network.ts —— 上游已瘫痪，照抄移植）

| 方法 | lib 来源 | 端点 | 返回 |
| --- | --- | --- | --- |
| `getNetworkVerificationImageUrl()` | `getNetworkVerificationImageUrl` | usereg `GET /site/captcha?refresh=1` → 返回 `/site/captcha?_=ts` | `string` |
| `loginUsereg(code)` | `loginUsereg` | `POST /site/validate-user`（X-CSRF-Token + XHR 头；密码 RSA PKCS#1 v1.5，neth.ts 无依赖自实现等价 jsencrypt）→ `POST /login`（_csrf-8800 + LoginForm 字段集） | `void` |
| `getOnlineDevices()` | `getOnlineDevices` | `GET /home` → `#w1-container` tr[data-key] 五列 | `NetworkDevice[]` |
| `getNetworkBalance()` | `getNetworkBalance` | `GET /home` → `#w3-container` 首行五列 | `NetworkBalance` |
| `getNetworkAccountInfo()` | `getNetworkAccountInfo` | `GET /home`（状态）+ `/users`（#w0 td 0/1/2/3/5/6/7）+ `/user/online-num` | `NetworkAccountInfo` |
| `logoutNetwork(device)` | `logoutNetwork` | `POST /home/delete?id=&user_mac=` + `_csrf-8800` | `void` |
| `loginNetwork(ip, internet)` | `loginNetwork` | `POST /certification`（CertificationForm[ip]/[password]/[type]） | 成功提示 `string` |

解析失败一律 `ServiceUnavailableError`；`loginform-verifycode`/WebVPN 门户页 → `AuthRequiredError`。

## 已知偏差（有意为之）

- cheerio 遍历以「逐 td 正则 / 微 DOM」等价实现；银行代发金额列、教室名取整格文本
  （lib 取首子元素/特定文本节点，HTML 空白敏感），解析更宽容。
- lib `AssessmentError`/`ClassroomStateError`/`DormAuthError` 等按铁律重新归类：
  无数据 → 空结果；结构失效 → `ServiceUnavailableError`；不新增错误类。
- `ClassroomStatus` 以 const 对象保持 lib 数值枚举（兼容 node --experimental-strip-types）。
- 卫生数据依赖 m.myhome（https）；moody hex `fdb94c852f…` 解码核实，与电费的
  `myhome.tsinghua.edu.cn`（http）是两个域，各自独立会话。
- lib 全部 webvpn 硬编码 hex（core.ts HOST_MAP）已逐一 AES 解码核实为真实域名
  （jxgl.cic/zhjw.cic/dzpj/yhdf/zzjl.graduate/learn/usereg/m.myhome/app.cs）。
