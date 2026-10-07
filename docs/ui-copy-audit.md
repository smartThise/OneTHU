# UI 文案审计（§4.5 对照表 · 续篇）

状态：**已落地**。本表经你审定后执行，词表扩展与全部改写同一批提交，中间没有留红。
> 最后更新：2026-09-25 20:30

## 一、审定意见（已按此执行）

1. 语气比原来的极客风好，但有些过于口语 —— 改为**书面语表达，保留亲民与普适性**：
去掉「没收藏上」「试试」「点一下」这类口语助词，保留「请重试」「请刷新」「稍后再试」这类明确动作。
2. 用户可见文案里，「原子」统一改叫 **「收藏项」**。

## 二、量法与结果

扫描 `apps/desktop/src/pages` 与 `appsrc/components` 下的全部 `.tsx/.ts`，
取「看着是给人看的」字面量（含中文、出现在 JSX 文本或常见 UI 属性里），跳过注释行、块注释续行与带 `ui-copy-lint-ok` 的行。

| 阶段 | 结果 |
| --- | --- |
| 扩展词表后首次扫描 | 违规 **63** 处（R1 术语 42 / R4 语气 21 / R2 超长 0） |
| 改写后 | 违规 **0** 处 |
| 另人工清出的扫描范围外用户可见文案 | 7 处（启动提示 1、toast 1、组件/收藏标题 3、插件权限说明 2） |

扫描范围的边界：日志与排障行不列入（`state/exthw.ts` 的 `logLine`、`info/tabStates.tsx` 的 TAB-HEAL 等，用户看不到），
其余未被自动扫描的目录（`App.tsx`、`state/`、`plugins/`）已按人工逐条过一遍，用户可见的都已改，诊断用的按原样保留。

## 三、词表（本轮新增）

| 词 | 处置 |
| --- | --- |
| 原子 | 收藏项 |
| 会话 | 登录状态（聊天语境除外，`ChatDock` 里指对话，不动） |
| 凭据、凭证 | 绑定（「账号与凭据」→「账号与绑定」） |
| 接口 | 数据、来源、网络地址 |
| CAS、SM2、manifest、插件宿主、WebVPN | 加入禁用词（WebVPN 原规则漏了大小写标志，一并补上） |
| R4 语气 | 完整句里的失败类字眼必须带行动词；以「：」结尾的「前缀 + 详情」不算违规；状态标签走行内豁免并写明理由 |

## 四、逐条对照

### 语气（错误与空态带行动词）

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| learn/AssignmentDetailPage.tsx:235 | 提交失败 | 提交未成功，请稍后重试 |
| learn/AssignmentDetailPage.tsx:265 | 撤回失败 | 撤回未成功，请稍后重试 |
| learn/CourseDetailPage.tsx:254 | 分组加载失败 | 分组没有加载出来，请刷新后重试 |
| info/SportsTab.tsx:43 | 体育预约服务暂不可用（info app 同样无法使用） | 体育预约暂不可用，请在「清华体育」App 中预约 |
| info/tabStates.tsx:80 | 该服务暂不可用（上游服务维护中） | 该服务暂不可用（正在维护），请稍后再试 |
| info/NewsTab.tsx:484、504 | 服务端返回删除失败 | 删除未成功，请刷新后重试 |
| info/NewsTab.tsx:508 | 服务端返回添加失败 | 添加未成功，请刷新后重试 |
| info/ThosPage.tsx:49 | 办理失败 | 办理未成功，请重试 |
| info/ThosPage.tsx:186 | 服务目录加载失败 | 服务列表没有加载出来，请刷新后重试 |
| info/ThosPage.tsx:193 | 在线服务连接失败（会话可能已失效） | 连不上在线服务，登录可能已过期，请重新登录 |
| info/ThosPage.tsx:271 | 收藏保存失败 | 收藏未保存，请再试一次 |
| components/RootErrorBoundary.tsx:47 | 界面渲染出错，已停在当前页面 | 本页出现问题，已停留在当前页面，可刷新页面重试 |
| components/FilePreview.tsx:108、829 | 未知错误 | 出现未知问题，请重新打开 |
| components/FilePreview.tsx:143 | 预览渲染出错，已停在这一条上（应用其余功能不受影响）。 | 这一条预览失败，其他内容不受影响；可换一条，或用上方「打开」查看原文件。 |
| components/FilePreview.tsx:617 | mammoth 模块加载失败 | docx 预览组件没有加载成功，请重新打开 |
| components/NotifySettingsSection.tsx:104 | 通知未授权 | 通知权限未开启，请在系统设置中打开 |
| pages/Settings.tsx:536 | 复制失败，可改用导入框核对 | 复制未成功，请改用下方的导入框核对 |
| pages/Settings.tsx:1792 | 系统取色不可用，已改用「清华紫」主题。 | 系统取色暂不可用，已自动改用「清华紫」主题，稍后可在外观里手动更换。 |

行内豁免（理由写在代码行尾）：

| 位置 | 文案 | 理由 |
| --- | --- | --- |
| pages/Plugins.tsx:248 | 加载失败 | 状态标签，同一行操作区就有「日志」按钮 |
| components/NotifyBridge.tsx:39 | [notify] 启动失败 | 只进 `console.warn`，用户看不到 |
| info/tabStates.tsx:32 | 会话重建成功→自动重拉 | 排障日志，TAB-HEAL 前缀即诊断标记 |

### 技术细节

| 位置 | 现在 | 改成 |
| --- | --- | --- |
| Settings.tsx:62、259 | 账号与凭据 | 账号与绑定 |
| Settings.tsx（雨课堂区 9 处、导出/导入标题 3 处） | 会话 / 会话健康 / 检查会话 / 导出会话 | 登录状态（如「登录状态：尚未检查」「检查登录状态」） |
| learn/YktAssignmentDetailPage.tsx:471 | 本作业暂无题目明细（可能接口未返回 problems）。 | 本作业暂无题目明细（老师端未提供）。 |
| info/LibraryTab.tsx:351、579、608、LibRoomTab.tsx:542 | 需要登录会话（未获取到学号） | 需要先登录（未读取到学号） |
| info/LibraryTab.tsx:351 | 馆列表为空（seat.lib 返回空 list，会话可能未建立） | 馆列表为空（数据源未返回内容，登录状态可能未建立） |
| info/VenueSportsTab.tsx:217 | 未能自动登录（统一身份会话可能已失效） | 未能自动登录（统一身份登录可能已过期） |
| zhjwxk/Courses.tsx:198 | 官方教评获取失败（教务会话或网络），稍后重试 | 官方教评获取未成功（教务登录或网络问题），请稍后重试 |
| zhjwxk/Courses.tsx:851 | 暂无培养方案数据（可能该学期未配置培养方案，或会话已过期） | 暂无培养方案数据（该学期可能未配置，或登录已过期） |
| components/ThemePickerModal.tsx、Settings.tsx | 基础令牌 | 默认外观 / 应用自带配色 |
| components/ExtHwLoginModal.tsx:310 | 我已登录，读取会话 | 我已登录，读取登录信息 |
| components/OnboardingTour.tsx:532 | 会话失效时在 设置 → 外部作业源 重登。 | 登录过期时在 设置 → 外部作业源 重登。 |
| plugins/types.ts:50、72 | 登录会话状态 / 任意外部 HTTP(S) 接口 | 登录状态 / 任意外部网络地址（HTTP(S)） |
| info/DormTab.tsx:199 | 清华水站 dingshui.bjqzhd.com · 公开接口 | 清华水站 dingshui.bjqzhd.com · 公开数据（域名保留：来源标注对用户有意义，不按「URL 必须折叠」处理） |

### 禁用词：「原子」→「收藏项」

涉及 6 个文件（FolderPage 6 处、Collect 3 处、WidgetBindModal 6 处、WidgetSettingsSection 1 处、FavAtomPicker 1 处），
另清出 3 处扫描范围外的（`state` 的组件标题、收藏项详情标题、选课页说明）。
**只动用户可见文案**，数据层与 `FavAtom`、`atom` 等标识符未动，收藏行为不变。

## 五、遗留

1. 「技术细节（状态码 / URL）收进『详情』折叠区」**未做完**：本轮只做措辞改写。真正折叠需要折叠组件支持，
   且部分页面没有折叠位（如 `DormTab` 的来源标注）。计划表里这一格保持未勾。
2. `ChatDock` 里的「会话」指聊天对话，不属于本次禁用的登录语境，保持原样（lint 若将来扫到该目录，需按语境豁免）。
3. 扫描器的注释识别本轮补了**块注释跨行**跟踪（此前 `/* ... */` 的续行行首没有 `*`，会被当成代码文本误报一条）。
1. **新增 `thos-service` 原子类型**：THOS 服务列表加载时写入原子缓存；解析器提供标题/部门与打开动作。
   完成后可同时满足：① 服务行星号（统一收藏，可入收藏夹）与图钉并列；② OH 以单句指令打开对应服务页。
2. **体育馆改为应用内打开并共享登录态**：复用在线服务方案（桌面独立子窗口 / 手机全屏 Dialog），
   需在 `venue_sso_set` 链上补齐体育馆域的会话票收集。
3. **今日页加入「最近使用 / 猜你喜欢」**：基于本地使用计数（`onethu.usage.counts.v1`），
   作为可选添加的卡片（默认关闭），并把统计暴露为 OH 可读的内部信息；不默认、不自动写入收藏。
4. **两处深色白底**：雨课堂 LaTeX 区域、培养方案右侧完成情况。已排查
   `yktBody.ts` / `yktKatex.ts` / `katexInlineCss.ts` / `ProblemBody.tsx` / `zhjwxk/Courses.tsx`，
   未发现硬编码白色（后者已用主题令牌），需要具体页面与入口才能定位生效规则。

## 追加（2026-09-20 深夜批）：场馆 · 今日推荐 · 雨课堂深色

| 项 | 处理 |
|---|---|
| 体育官方预约页 | 改为**应用内共享登录态**（桌面独立窗口 / Android 全屏 WebView），按钮文案「在应用内打开官方预约页」+「改用系统浏览器」兜底；预约动作仍由用户在官方页面完成 |
| 今日页 | 新增「最近使用」「猜你喜欢」两张卡（卡体为空则整卡不渲染）：只读本机点击记录，**不自动修改收藏夹**；说明文字「和你在用的地方同类 / 多数人天天用 / 顺手看看」≤42 字 |
| 雨课堂公式区 | 内联文档补深色档（opaque origin 继承不到主题变量，原只有浅色档）——深色主题下不再白底黑字 |
| 在线服务 | 星号（统一收藏原子）与图钉（在常用）语义分离并并列；不出现内部键名 |

## 追加（2026-09-20 夜·二批）：常用预置 · 导览能力补齐 · 首页行样式

| 项 | 处理 |
|---|---|
| 在线服务「常用服务」预置 | 修根因：预置按严格子串匹配「亲友来访」，学校侧正式名（如「亲友入校报备」）匹配不到，且**只要有一项命中就写"已预置"标记** → 缺失项始终无法补齐。改为复用口语容错分档（≥20 取相似度最高的一条）+ **逐关键词记账** + 版本号（老标记视为未记账，按新规则补一次）；预置动作留一行日志（记录已预置项与待补项） |
| 导览新增「今日页留哪些卡」 | 默认全部保留 = 当前全面版首页；取消的卡收进「添加卡片」，其余卡位与顺序保持不动（不整体重排） |
| 导览场景 chip | 与卡片勾选统一为同一份判定（此前 chip 走 applyScenarios、卡片走另一套，"点了等于没点"）；落盘按**当前朝向**写，横竖屏各一份布局均可对应 |
| 今日页「最近使用 / 猜你喜欢」 | 行样式与「最近通知」一致（细色条 + 标题/说明 + 右箭头），去掉该排 accent 底色的方图标块（用户反馈为"原子选择条很怪"） |

### 追加：导览选卡把首页选空了（2026-09-20 夜·三批）

用户实录：「导览里只留了最近使用和猜你喜欢，点开今日是空的」。日志 `[TODAY] 朝向=portrait
主栏=[] 侧栏=[] 收起=36` 定位到根因：卡片 chip 默认**全部已选**，用户希望"选中"那两张时，
实际将其取消选中（其余各项也已被逐个取消）→ 落盘为"一张不留"。

三处修法：
1. 落盘兜底：`applyTodayCards` 收到空集时至少保留「今日概览」，并写一行 `[ONBOARD]` 日志；
2. 界面明示：卡片步骤标题旁显示「已留 N 张」，0 张时红字警告"今日页会没有任何卡片"；
3. 一键恢复：首页确实没有任何卡片时，空白提示中直接提供「恢复默认布局」按钮（无需进入编辑/添加卡片）；
4. 两张推荐卡改为**空态说明**（不再整卡消失）：只保留这两张卡的用户不会面对空白区域；
   并修掉「猜你喜欢」起步项里的无效 key（`thos` 注册表里不存在 → 整条推荐被静默丢弃）。

---

# 附：2026-09-21 批次（R21）——四条用户反馈的根因与修法

## ① PDF 手机预览回归（「0.9.0 当时可以」）

**根因不是 pdf.js 实现有误，而是该分支从未执行**：`FilePreview` 用裸 UA 正则判断安卓
（`/android/i.test(navigator.userAgent)`），但主窗口 UA 被 tauri.conf.json 伪装成
Windows Chrome/79（webvpn 票绑定）→ 真机恒 false → 9-13 的 pdf.js 分支从未在真机
执行，一直渲染安卓上空白的 `<embed>`。这正是 `androidHost.ts` R18c 修复过的同类缺陷。

修法（`FilePreview.tsx` + `lib/androidHost.ts:choosePdfRenderMode`）：
- 安卓判定走多信号（UA + userAgentData + platform）；
- `navigator.pdfViewerEnabled` 为真（内核自带渲染器）→ 回到 `<embed>`（显示效果最佳）；
  否则走 pdf.js canvas 自绘，**modern → legacy 两级构建兜底**（老内核缺
  `Promise.withResolvers` 等 API 时 legacy 有垫片）；
- 失败均有日志留痕（`[FILE-PREVIEW]`，可由 logcat 抓取）+「换内嵌渲染」「系统应用打开」两个出口。

护栏：`tools/pdf-render-mode-test.mjs`（分档断言 + **全 src 扫描禁止再出现裸 UA 判断安卓**）。

## ②③ 安卓小组件：刷新延迟 + 深色跟随

**延迟根因**：「JS 算、原生画」架构中快照文本在推送时刻即已固定（"还有 9 小时"），
`updatePeriodMillis` 30 分钟重画得到的仍是同一段文本。**深色根因**：布局/卡片底硬编码浅色。

修法（`widgetSnapshot.ts` 契约扩展 + `OnethuWidget.kt` 重画重算 + `WidgetTicker`）：
- 快照行新增机器时间字段 `at/until/rel/loc` + 快照级 `counts/titleAt`；
- 原生每次重画按**当前时钟**重算：倒计时文案、正在上课（加粗+次行重排）、
  过期行剔除（从顶重新装填）、脚注计数、标题日期；
- 触发 = 30 分钟兜底自续 tick + 最近 at/until 翻转点的 AlarmManager 精准闹钟
  （`setExactAndAllowWhileIdle`，未授权降级 `setAndAllowWhileIdle`；重启由既有
  BOOT receiver 覆盖——`refreshAll` 现在会自动重排 tick）；
- 深色：布局色抽 `values(-night)/widget_colors.xml`、卡底 `drawable-night/onethu_widget_bg`，
  启动器重 inflate 自动跟随系统；行内 Span 色渲染时按 uiMode 选择配色。

语义锚 = `state/widgetNativeRender.ts`（两端同步的纯函数参考），
护栏 = `tools/widget-native-render-test.mjs`。

**续修（2026-09-25，用户把卡片拖大后的两处实录）**：「能显示的行数远少于实际拥有的空间」
与「总是显示还有 2 项」。根因是行数按「矮/中/高」三档估算并封顶 5 行（快照也只带 5 行候选），
而脚注的「还有」直接用快照里算死的 `counts.more`。修法：
- 快照按 `WIDGET_MAX_ROWS`（20）给足候选行，原生按**真实高度**逐行量文本铺满
  （`fitRows`/`lineHeightPx`，布局备 20 条槽位，仍放不下的才不显示）；
- 脚注前半段只数**卡片上真的显示出来的行**，「还有 N 项」= 可见行 − 已显示行 + 快照外的
  `counts.more`，两者之和恒等于仍有效的条目总数（卡片拉大时「还有」实时变小）。

**追加（2026-09-25，PC 上「通知里的图片都不能正常显示」）**：真机/PC 现场查下去是**会话失效**——
原生 `fetch_binary` 判定拿回的是登录页时直接抛字符串「会话已失效，需要重新登录」（`lib.rs:1181`），
而 `RichContent` 的 `catch {` 不接错误、只把图调暗到 0.45，唯一的留痕还只记 URL（`log_debug`
落在 `/tmp/onethu-debug.log`，Windows 上是 `D:\tmp\…`），数据页那条会话提示链又完全不覆盖
这条图片旁路——于是界面只剩几个碎图，用户推不到「该重新登录了」。修法：
- `catch (e)` 接住原因：写进 `title`（悬停可看）与 `log_debug` 行；
- 会话类失败（`lib/sessionErrors.ts` 的 `isSessionExpiredError`，认字符串错误与
  `SessionExpiredError` 两种）弹一次**屏幕正中**的提示「图片加载失败，请重新登录」
  （`showToast` 新增 `center` 档位，`toast-host is-center`），一次内容最多一次（10s 去重——
  一页十几张图会一起失败）。
护栏 = `tools/session-img-toast-test.mjs`（判定 9 态 + 接线与样式守卫）。

## ④ Windows 用户端出现 127.0.0.1:5180

CI 的 `tauri build` 产物资产内嵌、永不出现 5180；出现即说明拿到的是 **dev/手动 cargo
构建**（与 0.7.2 安卓事故同类：判据只能是构建方式，`strings` 找端点串两种构建都命中）。
修法：`lib.rs` setup 首部 dev 守卫——`tauri::is_dev()` 且 dev server 连不上时弹原生
对话框说明「这是开发版构建，请安装正式版」后退出，用户无需再依据浏览器错误页自行推断原因。

## ⑤ 在线服务/体育点击 webview 无响应

逐环节静态排查：Rust 移动端链路错误已冒出（265cc35）、Kotlin openWebModal 无静默
拒绝路径、`openThosInApp`/`openVenueInApp` 失败必 toast/回落浏览器。本轮归一：
`ThosPage.openOfficial` 原是第三份内联复份链（失败只 setError，横幅不显眼时等同
无响应），已委托 `openThosInApp`，全应用仅保留一份打开链。
**遗留**：若仍复现，唯一可能是指令悬挂（设备相关）。下次连接 adb 时可一次性定位：
点击一次 → `adb logcat -d | grep -E "THOS-UI|THOS-SEED|VENUE-PORTAL"`——
有 [THOS-UI] 无 [THOS-SEED] = JS→Rust 链路中断；有 [THOS-SEED] 无窗口 = 插件侧问题。

## 追加（09-21 下午二轮）：「跳浏览器」显性化 + 真机诊断通道

- **在线服务跳浏览器** = 应用内打开一直在失败（此前静默），新包按设计回落浏览器把失败显性化
  了。失败原因此前只进 logcat（安卓 log_debug 无 /tmp 落点），用户无法读取，形成信息断层。
  本轮：①失败原因直接进 toast（截 60 字）；②`loadRemembered` 纳入 try（其 reject 时
  此前整条链静默终止）；③日志落 `app_data_dir/logs/onethu-debug.log`，设置→关于→
  「导出日志」一键转存系统下载（saveDownload 桥）。下一次点击即可拿到确切失败原因。
- **校内启动 20s**：与 reqwest 缺省 20s 一致，但耗时发生在哪一段需要实测。本轮
  `loadReal` 分段计时（LR-STAGE +ms）+ `http_request` 逐跳计时（NATIVE-HOP 状态+毫秒）
  全部落日志文件，导出即可获得。疑似方向（待数据证实/证伪）：校内对某直连/公网端点 hang 至
  超时而校外快速失败；或 webvpn 包装链校内 RTT 膨胀。
- info app 机制对照：其 RN 网络层与 WebView 共用同一 CookieManager，会话天然互通；
  本项目对应实现 = openWebModal 进页种票/出页回灌。机制一致，失败发生在链路某处，待日志定位。

## 定案（09-21 晚，用户日志已确认）

**在线服务/体育「点了没反应→跳浏览器」真因**：`SeedCookiesArgs`/`OpenWebModalArgs`
漏了 `@InvokeArg` 注解——tauri Android 靠它生成 Jackson 构造器并 keep；R8 release 包下
`parseArgs` 必然失败（`no Creators`），debug 包不经过 R8，因此桌面阶段测试结果均正常。修法：补注解 +
Args 全部去 lateinit + consumer-rules 整包 keep 兜底。此教训对后续新增插件命令通用：
**参数类必须 @InvokeArg**。

**校内 20s**：日志确认每 webvpn 请求 4-6.4s（含 wengine-vpn/cookie 5.8s），外网同链
300-500ms/请求 → 冷启动=漫游链(12s)+并行抓取(9.4s)。启动链已加 NET-RESOLVE 解析日志
（v4/v6 混合判定 IPv6 连接 stall 假说），待下一份校内日志确定 mitigation 方案。

## 追加（09-21 晚三）：通知权限时机 + 设置页语气专业化

- **通知权限首次申请**（用户反馈：定位权限进寻迹就问，通知权限从不问）：新增
  `state/notifyPermissionAsk.ts` 一次性申请，导览结束（或本就无需导览）后 800ms 触发；
  已询问过不重复发起、被拒绝不反复弹出、平台无通知后端时不写标记。设置页仍如实展示状态，
  并提供进入系统设置的入口。
- **按钮去重**：「权限与系统设置」行原有四个按钮（试一下 / 自检 / 打开系统设置 /
  重新检测），现合并为「发送测试通知 / 诊断 / 打开系统设置（按需）」，诊断同时刷新状态；
  行标题改为「通知权限」。
- **语气专业化**：Settings / NotifySettingsSection / WidgetSettingsSection 三轮替换，
  去掉口语句式与第一人称（「看到了就说明这条链通了」「投递失败，看日志」「反馈给我」
  「还没登录」「内容格式不对」「——请用桌面端」等），统一为陈述式产品文案。
- 护栏 `tools/permission-and-copy-test.mjs`：一次性申请与导览接线、按钮不重复、
  口语黑名单（防回归）。
