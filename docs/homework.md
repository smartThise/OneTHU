# 作业区：聚合、忽略与提交

> 最后更新：2026-11-18 01:30

作业区汇聚了网络学堂与外部作业源（雨课堂 / TUOJ / Tyche / DSA OJ）的课程任务，在「全部作业」与「今日」两处视图中统一呈现。关于各外部平台的登录接入、凭据维护与会话恢复机制，请参阅 [external-homework.md](./external-homework.md)。

本文档说明作业区的核心交互与工程实现：分组与忽略逻辑、网络学堂的附件上传与必交附件预检、雨课堂主观题原生作答与提交，以及由此确立的学术诚信准则与技术护栏。

## 1. 分组与数据来源

| 来源 | 说明 |
|---|---|
| 网络学堂 | 校内课程作业；数据拉取接口见 [api-reference.md §9](./api-reference.md) |
| 外部作业源 | 雨课堂 / TUOJ（AI 版与经典版）/ Tyche / DSA OJ，统一映射为 `ExternalHomework` 并以 `ext:` 前缀并入列表 |

作业页设有六个分组：进行中、已逾期、已交、已批、已忽略、全部。**旁听课堂**（雨课堂 `role=6`）的作业在当前分组底部单独归入「旁听作业」小节展示，独立于正式课程的分组计数、「全部」列表与首页作业卡片之外。逾期状态按「未提交且已过截止时间」判定，时间字符串统一由 core 的 `parseLearnTime` 解析（同时兼容外部源的 `"YYYY-MM-DD HH:mm"` 与标准 ISO 格式）；若遇到无法解析的时间格式，条目会稳妥保留在「进行中」分组。

「今日」页的截止卡片、首页作业小组件以及本地通知投递计划均读取同一份底层作业数据，确保三处的展示与过滤口径完全一致。

## 2. 忽略（R21c）

将某项作业设为忽略后，该条目会从常规作业列表、日程截止视图、首页小组件计数与推送提醒计划中收起，统一移入「已忽略」分组；**远端平台上的原始数据保持原样**，随时可在「已忽略」分组中一键恢复。

| 项 | 说明 |
|---|---|
| 适用范围 | 任意状态的作业（进行中 / 已逾期 / 已交 / 已批）均可忽略，网络学堂与外部作业源采用同一交互 |
| 入口 | 每条作业行常驻「忽略 / 恢复」按钮（独立于提醒开关）；点击忽略时会弹出二次确认框，提示错过截止时间的风险与后续恢复路径 |
| 呈现 | 已忽略的条目以浅灰样式附带「已忽略」标签，仅在「已忽略」分组中列出，从其余分组及「全部」视图中收起 |
| 存储 | 保存在本机 `onethu.hw.ignored.v1` 中，单条记录结构为 `{id, title, at}`，最多保留 500 条 |
| 键设计 | 采用全局唯一键：网络学堂直接使用 `xszyid`，外部源 ID 带有 `ext:` 前缀，通知提醒计划共用同一 ID，使列表过滤与提醒过滤严格同步 |
| 同步范围 | 作业页各分组与计数、网络学堂未交角标、日程 DDL 视图、首页小组件及本地通知投递计划 |

状态管理实现位于 `apps/desktop/src/state/hwIgnore.ts`（读写 `localStorage` 并通过 `useSyncExternalStore` 向各处视图同步广播），配套回归测试为 `tools/hw-ignore-test.mjs`。

## 3. 网络学堂：附件与提交

### 3.1 附件上传与拍照

提交网络学堂作业时，正文内容与附件至少需填写或上传一项。Android 客户端额外提供「拍照上传」按钮，通过 `capture="environment"` 直接唤起后置相机拍摄作业；桌面端则打开系统文件选择器。客户端平台识别采用多维环境信号（`isAndroidNavigator`）综合判断——由于主窗口为兼容校园网页使用了桌面端伪装 UA，相关细节可参阅 [android-release-traps.md §3](./android-release-traps.md)。

### 3.2 必交附件预检（R21c）

对于教师要求必须上传附件的作业，若未附带文件直接提交，网络学堂服务端会返回 `{"result":"error","msg":"请上传附件"}`。由于网络学堂的作业详情 JSON 中未提供单独的「必交附件」字段，应用在首次收到该服务端拒绝响应后会将其记录在本机，并在后续提交前提前校验提醒：

| 环节 | 行为 |
|---|---|
| 服务端拒绝 | 记录该项作业需交附件（调用 `markNeedFile`，写入 `onethu.learn.needFile.v1`，上限 200 条） |
| 本地预检 | 再次点击提交而未选附件时，直接在本地拦截并提示「本作业要求必须带附件：请选择文件或拍照上传后再提交」 |
| 提交成功 | 附带文件提交成功后自动清除该记录（`clearNeedFile`），以兼容教师中途放宽附件要求的情形 |
| 替换附件 | 网络学堂要求每次提交保留有效内容；若尝试单独清空已有附件被拒，界面会引导直接选择新附件覆盖上传 |

相关实现位于 `apps/desktop/src/state/learnAttachmentReq.ts` 与 `apps/desktop/src/pages/learn/AssignmentDetailPage.tsx`；测试脚本为 `tools/learn-need-file-test.mjs` 与 `tools/learn-camera-upload-test.mjs`。

### 3.4 通知的已读状态（R23）

网络学堂列表接口仅通过服务端字段 `sfyd` 标记课程通知是否已读。早期版本仅依赖服务端回传，导致无附件通知点开后仍显示未读、带附件通知也需等下次刷新列表才会更新状态。现已改为本地即时记录与服务端置读双路同步：

| 环节 | 行为 |
|---|---|
| 打开详情 | 立即写入本机已读记录（`onethu.learn.noticeRead.v1`），通知列表与「未读」分组即时更新并跨会话保留 |
| 服务端同步 | 进入详情页时统一请求 `beforeViewXs` 接口，同步触发服务端置读并拉取附件信息 |
| 合并规则 | 本地已读集合与服务端 `sfyd` 字段取并集，任一侧标为已读即稳定显示为已读 |

配套回归测试：`tools/notice-read-test.mjs`。

### 3.3 请求体序列化

网络学堂专线的请求体统一交由 `apps/desktop/src/lib/bodySerialize.ts` 序列化，供 `nativeFetch` 与 `tauriFetch` 两套底层请求封装共同调用。此前网络学堂专线流量全部经由 `nativeFetch` 发送，而 `FormData` 分支最初仅写在 `tauriFetch` 中，曾导致附件表单被序列化为字面量字符串 `"[object FormData]"` 且缺失 `multipart` 的 `Content-Type` 头（触发服务端 400 `Required String parameter 'xszyid' is not present`）；抽离统一序列化模块后由 `tools/learn-submit-body-test.mjs` 持续守护。

## 4. 雨课堂主观题原生作答（R20-C2）

雨课堂主观题支持直接在应用内撰写并提交，无需跳出到外部浏览器。内置编辑器工具栏与雨课堂官方保持一致，提供加粗、斜体、下划线、文字与背景颜色、有序与无序列表、代码块、插图及数学公式输入：

| 能力 | 实现要点 |
|---|---|
| 插图 | 支持工具栏选图、相机拍照（`capture="environment"`）、剪贴板粘贴与文件拖拽四种方式，统一通过官方正文插图接口（`get_aliyun_oss_token` 表单直传）上传，确保教师批改端正常显示。**所有图片标签均强制附加 `referrerpolicy="no-referrer"`**：因对象存储 CDN 的 Referer 白名单未包含应用本地源（`tauri.localhost` 会触发 403），插入、粘贴、受控重渲染、草稿恢复与提交前均统一调用 `yktBody.hardenYktImgs` 加固 |
| 公式 | 输入 LaTeX 源码并通过内置 KaTeX 实时预览；编辑态使用 `img.kfformula` 承载，提交时由 `toSubmitHtml()` 转换为雨课堂官方格式（1px 占位 GIF 的 `src` 与 `data-latex` 属性并存），外层包裹 `<div class="custom_ueditor_cn_body">` |
| 草稿 | 按「课堂 + 题目」维度自动保存在 `localStorage` 中，提交成功后清理本地草稿；再次打开题目时优先回填服务端已保存的 `my_answer` |
| 提交 | 点击「提交作答」（或「提交（剩余 N 次）」）后弹出二次确认框，清晰展示剩余可交次数与覆盖规则，确认后调用 `submitYktSubjective` 发出请求 |
| 状态回读 | 提交成功后立即重新向服务端拉取最新作答与批改状态，以服务端实测数据刷新界面 |
| 剩余次数 | 根据 `late_submission` 字段计算可交次数，同时兼容对象（含 `deduct_score`）与纯数字两种返回结构 |

相关实现位于 `apps/desktop/src/components/exthw/YktSubjectiveEditor.tsx`、`apps/desktop/src/state/exthw.ts` 与 `packages/core/src/exthw/yuketang.ts`。接口协议分析与实测记录见 [外部作业源-需求与实现方案.md §31](./外部作业源-需求与实现方案.md)，回归测试见 `tools/ykt-submit-test.mjs`。

## 5. 学术红线

OneTHU 的作业提交功能严格定位于「辅助学生本人亲笔作答的便捷排版与提交工具」——应用仅负责题干与富文本排版渲染、本人作答配图上传，以及在用户手动确认后发出提交请求这三项基础操作。

**明确禁止的功能范围**：

1. 由 AI（包括内置 OH 助手、外部 Agent 或任何大模型工具链）生成、改写、润色或补全作业答案；
2. 由 AI 触发提交，或提供自动提交、批量提交、定时提交及失败自动重交；
3. 提供任何形式的「一键完成作业」快捷入口；
4. 从题库、互联网或他人作答等外部来源抓取现成答案填入编辑器。

**工程护栏**（通过自动化测试持续强制校验）：

- 底层提交接口（如 `submitYktProblemSubjective` 等）完全隔离在插件宿主的可调用工具注册表之外，大模型工具调用循环无权触及任何提交能力；`tools/c2-redline-test.mjs` 会静态扫描并断言插件工具清单中绝无 `submit*` 或 `problem_apply` 相关条目；
- 提交操作强制绑定真实的用户点击与二次确认弹窗，表单回车、定时器或脚本事件代理均无法绕过确认框直达提交函数；
- 作答编辑器内未设任何「AI 生成 / 补全 / 续写」按钮，OH 助手面板与主观题编辑器在代码与状态上完全解耦。

此外，外部作业源的列表与试卷页面保持只读展示，所有考试与试卷均隐藏提交入口，详细规则见 [external-homework.md §3.1](./external-homework.md)。

## 6. 测试工具

| 工具 | 覆盖范围 |
|---|---|
| `tools/hw-ignore-test.mjs` | 作业忽略状态：新增、恢复、容量上限、异常数据容错与多视图订阅同步 |
| `tools/audited-hw-test.mjs` | 旁听作业分栏展示：独立于正式分组计数、「全部」列表与首页卡片之外 |
| `tools/notice-read-test.mjs` | 课程通知已读同步：本地即时置读、与服务端状态取并集及跨会话保持 |
| `tools/learn-need-file-test.mjs` | 必交附件本地记忆：拒绝记录、成功清除与条数上限 |
| `tools/learn-camera-upload-test.mjs` | 移动端拍照上传与桌面端文件选择的平台识别分流 |
| `tools/learn-submit-body-test.mjs` | 网络学堂请求体序列化（`FormData` 转标准 `multipart`） |
| `tools/ykt-submit-test.mjs` | 雨课堂主观题提交：请求签名、`multipart` 字段顺序与回调结果校验 |
| `tools/c2-redline-test.mjs` | 学术红线静态与行为护栏校验 |
